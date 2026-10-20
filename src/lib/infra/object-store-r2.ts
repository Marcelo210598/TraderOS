// Cliente S3/R2 que implementa a porta ObjectStore (E7-11, D-R1…D-R7): é o que leva o RawFileStorage (E7-10) para o Cloudflare R2 sem SDK. Assinatura SigV4 PRÓPRIA (≈40 linhas; HMAC vem de ./hash.ts, o único dono do node:crypto);
// a conformidade é provada pelo vetor oficial da AWS, por um servidor S3 falso que reverifica a assinatura com implementação independente e pela sonda/teste AO VIVO (R2 aceitou esta forma em 20/10/2026).
//   · putIfAbsent = PUT com `If-None-Match: *` (200 ⇒ created:true; 412 ⇒ created:false: o R2 faz CAS de verdade);  · get = GET (404 ⇒ NOT_FOUND; corpo lido com TETO, Content-Length acima ⇒ erro sem ler);
//   · delete = HEAD (404 ⇒ existed:false) e DELETE (o R2 responde 204 existindo ou não: `existed` é INFORMATIVO, HEAD+DELETE não é atômico);
//   · deleteByPrefix = LIST paginado + DELETE por chave (DELETE é operação GRÁTIS no R2; LIST é classe A, 1 por 1.000 chaves), concorrência 8, no máx. 10.000 páginas; falha no meio ⇒ STORAGE_ERROR (parcial; repetir conclui).
// Erros são códigos fixos: 404 do get ⇒ NOT_FOUND; qualquer outra coisa (401/403, 429/5xx, rede, timeout de 30 s, forma inesperada) ⇒ STORAGE_ERROR; SEM retry. Nada lança, nada ecoa mensagem, URL, corpo, chave de acesso ou secret.
// `loadR2Config(env)` recebe o ambiente por PARÂMETRO (este módulo nunca lê process.env); o secret fica não enumerável e fora de JSON/String/inspect. Chaves e prefixos são validados ANTES de qualquer requisição.
import { hmacSha256, sha256Hex } from "./hash.ts"
import type { ObjectStore } from "./object-store.ts"

export const R2_MAX_LIST_PAGES = 10_000
const DELETE_CONCURRENCY = 8
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OBJECT_BYTES = 26 * 1024 * 1024 // 25 MiB de CSV + folga do gzip
const MAX_LIST_BYTES = 4 * 1024 * 1024

// ───────────────────────────── configuração ─────────────────────────────
export interface R2Config { readonly accountId: string; readonly bucket: string; readonly accessKeyId: string; readonly secretAccessKey: string }
const HEX32 = /^[0-9a-f]{32}$/, HEX64 = /^[0-9a-f]{64}$/, BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

export function loadR2Config(env: unknown): { readonly ok: true; readonly config: R2Config } | { readonly ok: false; readonly code: "R2_CONFIG_INVALID" } {
  try {
    if (!isRecord(env)) return { ok: false, code: "R2_CONFIG_INVALID" }
    const { R2_ACCOUNT_ID: accountId, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secret } = env
    if (typeof accountId !== "string" || !HEX32.test(accountId) || typeof bucket !== "string" || !BUCKET.test(bucket) || typeof accessKeyId !== "string" || !HEX32.test(accessKeyId) || typeof secret !== "string" || !HEX64.test(secret)) return { ok: false, code: "R2_CONFIG_INVALID" }
    const config = { accountId, bucket, accessKeyId } as { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string }
    Object.defineProperty(config, "secretAccessKey", { value: secret, enumerable: false }) // fora de spread/JSON/inspect
    Object.defineProperty(config, "toJSON", { value: () => ({ accountId, bucket, accessKeyId, secretAccessKey: "[redigido]" }), enumerable: false })
    Object.defineProperty(config, "toString", { value: () => "[R2Config]", enumerable: false })
    return { ok: true, config: Object.freeze(config) }
  } catch {
    return { ok: false, code: "R2_CONFIG_INVALID" }
  }
}

// ───────────────────────────── SigV4 ─────────────────────────────
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
const uriEncode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export interface SigV4Input {
  readonly method: string
  /** Caminho JÁ codificado, como vai na URL. */
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  /** Todos os cabeçalhos ASSINADOS (host, x-amz-date, …). */
  readonly headers: Readonly<Record<string, string>>
  readonly payloadHash: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** `YYYYMMDDTHHMMSSZ`. */
  readonly amzDate: string
  readonly region: string
  readonly service: string
}
export function sigV4Authorization(i: SigV4Input): { readonly authorization: string; readonly signature: string } {
  const date = i.amzDate.slice(0, 8)
  const lower = Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")] as const).sort(([a], [b]) => (a < b ? -1 : 1))
  const signedHeaders = lower.map(([k]) => k).join(";")
  const query = Object.entries(i.query).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&")
  const canonical = [i.method, i.path, query, lower.map(([k, v]) => `${k}:${v}\n`).join(""), signedHeaders, i.payloadHash].join("\n")
  const scope = `${date}/${i.region}/${i.service}/aws4_request`
  const toSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, sha256Hex(canonical)].join("\n")
  const key = [date, i.region, i.service, "aws4_request"].reduce<Uint8Array>((k, part) => hmacSha256(k, part), new TextEncoder().encode(`AWS4${i.secretAccessKey}`))
  const signature = toHex(hmacSha256(key, toSign))
  return { authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signature }
}

// ───────────────────────────── validação de chave ─────────────────────────────
/** Só [A-Za-z0-9_.-/], 1–1024, sem barra inicial, sem `//`, nenhum segmento `.` ou `..`. Vale para chave e para prefixo (que pode terminar em `/`). */
const validKey = (x: unknown): x is string => {
  if (typeof x !== "string" || x.length < 1 || x.length > 1024 || !/^[A-Za-z0-9_.\-/]+$/.test(x) || x.startsWith("/") || x.includes("//")) return false
  return x.split("/").every((seg) => seg !== "." && seg !== "..")
}
const xmlUnescape = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
const fail = (code: "INVALID_ARGS" | "NOT_FOUND" | "STORAGE_ERROR"): { readonly ok: false; readonly code: typeof code } => ({ ok: false, code })

export type R2FetchLike = FetchLike
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal: AbortSignal }) => Promise<Response>

export function createR2ObjectStore(config: R2Config, options: { readonly fetch?: FetchLike; readonly now?: () => Date; readonly timeoutMs?: number } = {}): ObjectStore {
  if (!isRecord(config) || typeof config.accountId !== "string" || typeof config.bucket !== "string" || typeof config.accessKeyId !== "string" || typeof config.secretAccessKey !== "string") throw new TypeError("config R2 inválida")
  const { accountId, bucket, accessKeyId } = config
  const secret = config.secretAccessKey
  const send = options.fetch ?? (fetch as unknown as FetchLike)
  const now = options.now ?? ((): Date => new Date())
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const host = `${accountId}.r2.cloudflarestorage.com`

  /** Uma requisição assinada. `handle` roda DENTRO do timeout (inclui ler o corpo). Qualquer falha de rede/abort/exceção ⇒ null. */
  async function exchange<T>(method: string, key: string, o: { query?: Record<string, string>; body?: Uint8Array; conditional?: boolean }, handle: (res: Response) => Promise<T>): Promise<T | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const path = key === "" ? `/${bucket}/` : `/${bucket}/${key.split("/").map(uriEncode).join("/")}`
      const query = o.query ?? {}
      const body = o.body
      const headers: Record<string, string> = { host, "x-amz-content-sha256": sha256Hex(body ?? new Uint8Array(0)), "x-amz-date": now().toISOString().replace(/[:-]|\.\d{3}/g, ""), ...(o.conditional === true ? { "if-none-match": "*" } : {}) }
      const { authorization } = sigV4Authorization({ method, path, query, headers, payloadHash: headers["x-amz-content-sha256"], accessKeyId, secretAccessKey: secret, amzDate: headers["x-amz-date"], region: "auto", service: "s3" })
      const qs = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&")
      const res = await send(`https://${host}${path}${qs === "" ? "" : `?${qs}`}`, { method, headers: { ...headers, authorization }, ...(body !== undefined ? { body } : {}), signal: controller.signal })
      return await handle(res)
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  const drain = async (res: Response): Promise<void> => { try { await res.body?.cancel() } catch { /* nada a fazer */ } }
  /** Lê o corpo ATÉ o teto; acima ⇒ null (e cancela). */
  const readCapped = async (res: Response, cap: number): Promise<Uint8Array | null> => {
    const declared = Number(res.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > cap) { await drain(res); return null }
    if (res.body === null) return new Uint8Array(0)
    const reader = res.body.getReader(), chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) { await reader.cancel().catch(() => undefined); return null }
      chunks.push(value)
    }
    const out = new Uint8Array(total); let at = 0
    for (const c of chunks) { out.set(c, at); at += c.byteLength }
    return out
  }
  const deleteKey = async (key: string): Promise<boolean> => (await exchange("DELETE", key, {}, async (res) => { await drain(res); return res.status === 204 || res.status === 200 })) === true

  return {
    async putIfAbsent(key, bytes) {
      try {
        if (!validKey(key) || !(bytes instanceof Uint8Array)) return fail("INVALID_ARGS")
        const body = new Uint8Array(bytes)
        const r = await exchange("PUT", key, { body, conditional: true }, async (res) => { await drain(res); return res.status })
        if (r === 200) return { ok: true, created: true }
        if (r === 412) return { ok: true, created: false }
        return fail("STORAGE_ERROR")
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
    async get(key) {
      try {
        if (!validKey(key)) return fail("INVALID_ARGS")
        const r = await exchange("GET", key, {}, async (res) => {
          if (res.status === 404) { await drain(res); return "NOT_FOUND" as const }
          if (res.status !== 200) { await drain(res); return null }
          return readCapped(res, MAX_OBJECT_BYTES)
        })
        if (r === "NOT_FOUND") return fail("NOT_FOUND")
        return r instanceof Uint8Array ? { ok: true, bytes: new Uint8Array(r) } : fail("STORAGE_ERROR")
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
    async delete(key) {
      try {
        if (!validKey(key)) return fail("INVALID_ARGS")
        const head = await exchange("HEAD", key, {}, async (res) => { await drain(res); return res.status })
        if (head === 404) return { ok: true, existed: false }
        if (head !== 200) return fail("STORAGE_ERROR")
        return (await deleteKey(key)) ? { ok: true, existed: true } : fail("STORAGE_ERROR")
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
    async deleteByPrefix(prefix) {
      try {
        if (!validKey(prefix)) return fail("INVALID_ARGS")
        let token: string | null = null, pages = 0, deleted = 0
        for (;;) {
          pages += 1
          if (pages > R2_MAX_LIST_PAGES) return fail("STORAGE_ERROR")
          const xml = await exchange("GET", "", { query: { "list-type": "2", prefix, ...(token !== null ? { "continuation-token": token } : {}) } }, async (res) => {
            if (res.status !== 200) { await drain(res); return null }
            const bytes = await readCapped(res, MAX_LIST_BYTES)
            return bytes === null ? null : new TextDecoder().decode(bytes)
          })
          if (xml === null || !xml.includes("<ListBucketResult")) return fail("STORAGE_ERROR")
          const truncated = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml)?.[1]
          if (truncated === undefined) return fail("STORAGE_ERROR")
          const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
          if (truncated === "true" && next === undefined) return fail("STORAGE_ERROR")
          const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => xmlUnescape(m[1]))
          if (!keys.every((k) => validKey(k) && k.startsWith(prefix))) return fail("STORAGE_ERROR") // NADA é apagado se a resposta traz o que não foi pedido
          let at = 0, broken = false
          const worker = async (): Promise<void> => {
            while (!broken && at < keys.length) {
              const k = keys[at++]
              if (await deleteKey(k)) deleted += 1; else broken = true
            }
          }
          await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, keys.length) }, worker))
          if (broken) return fail("STORAGE_ERROR") // parcial: repetir conclui
          if (truncated === "false") return { ok: true, deleted }
          token = xmlUnescape(next as string)
        }
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
  }
}
