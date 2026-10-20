// Servidor S3 FALSO em memória, como função `fetch` (E7-11): o cliente R2 fala com ele sem rede. Ele REVERIFICA a assinatura SigV4 com uma implementação INDEPENDENTE (node:crypto aqui, no teste), então um cliente
// com assinatura errada recebe 403 como receberia do R2 de verdade (a sonda ao vivo de 20/10 mostrou que o R2 aceita esta mesma forma). Suporta PUT (com If-None-Match:* ⇒ 412), GET, HEAD, DELETE (204 sempre, como o R2)
// e ListObjectsV2 com prefixo e paginação (1.000 por página; o token é a ÚLTIMA chave, como o StartAfter do S3, então apagar durante a paginação não pula nada). Injeção de falhas e registro das requisições.
import { createHash, createHmac } from "node:crypto"

export interface FakeS3Config { readonly accountId: string; readonly bucket: string; readonly accessKeyId: string; readonly secretAccessKey: string }
export interface LoggedRequest { readonly method: string; readonly url: string; readonly headers: Record<string, string>; readonly body: Uint8Array | null }
export type Fault = { readonly when: (r: LoggedRequest) => boolean; readonly respond: (() => Response) | "throw" | "hang"; readonly times?: number }

const sha = (b: string | Uint8Array): string => createHash("sha256").update(b).digest("hex")
const hmac = (k: string | Buffer, d: string): Buffer => createHmac("sha256", k).update(d).digest()
const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const err = (status: number, code: string): Response => new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>fake</Message></Error>`, { status })

export function createFakeS3(cfg: FakeS3Config, opts: { pageSize?: number; now?: () => Date } = {}): {
  fetch: (url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array | null; signal?: AbortSignal | null }) => Promise<Response>
  objects: Map<string, Uint8Array>
  log: LoggedRequest[]
  faults: Fault[]
  stats: { maxInFlightDeletes: number }
} {
  const objects = new Map<string, Uint8Array>()
  const log: LoggedRequest[] = []
  const faults: Fault[] = []
  const stats = { maxInFlightDeletes: 0 }
  const now = opts.now ?? ((): Date => new Date())
  const pageSize = opts.pageSize ?? 1000
  let inFlight = 0
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`

  /** 403 se a assinatura não bate (recalculada do ZERO a partir do que chegou), 400 se o hash do corpo mente. */
  const authenticate = (method: string, url: URL, headers: Record<string, string>, body: Uint8Array | null): Response | null => {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(h.authorization ?? "")
    if (m === null) return err(403, "AccessDenied")
    const [, access, date, signedList, signature] = m
    if (access !== cfg.accessKeyId) return err(403, "InvalidAccessKeyId")
    if (h["x-amz-content-sha256"] !== sha(body ?? new Uint8Array(0))) return err(400, "XAmzContentSHA256Mismatch")
    const amzDate = h["x-amz-date"] ?? ""
    if (!/^\d{8}T\d{6}Z$/.test(amzDate) || amzDate.slice(0, 8) !== date) return err(403, "AccessDenied")
    const skew = Math.abs(Date.parse(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`) - now().getTime())
    if (!(skew < 15 * 60 * 1000)) return err(403, "RequestTimeTooSkewed")
    const names = signedList.split(";")
    if (!names.includes("host") || !names.includes("x-amz-date") || !names.includes("x-amz-content-sha256")) return err(403, "AccessDenied")
    if (h["if-none-match"] !== undefined && !names.includes("if-none-match")) return err(403, "AccessDenied") // cabeçalho de condição tem que estar ASSINADO
    const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&")
    const canonical = [method, url.pathname, query, names.map((n) => `${n}:${(h[n] ?? "").trim()}\n`).join(""), signedList, h["x-amz-content-sha256"]].join("\n")
    const toSign = ["AWS4-HMAC-SHA256", amzDate, `${date}/auto/s3/aws4_request`, sha(canonical)].join("\n")
    const key = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, date), "auto"), "s3"), "aws4_request")
    return createHmac("sha256", key).update(toSign).digest("hex") === signature ? null : err(403, "SignatureDoesNotMatch")
  }

  const fetchImpl = async (input: string | URL, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array | null; signal?: AbortSignal | null } = {}): Promise<Response> => {
    const url = new URL(String(input)), method = init.method ?? "GET"
    const headers = init.headers ?? {}, body = init.body ?? null
    const logged: LoggedRequest = { method, url: url.toString(), headers: { ...headers }, body: body === null ? null : new Uint8Array(body) }
    log.push(logged)
    for (const f of faults) {
      if (f.times !== undefined && f.times <= 0) continue
      if (!f.when(logged)) continue
      if (f.times !== undefined) (f as { times: number }).times -= 1
      if (f.respond === "throw") throw new Error("SEGREDO-DA-REDE /chave/interna")
      if (f.respond === "hang") return new Promise<Response>((_, reject) => { init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))) })
      return f.respond()
    }
    if (url.host !== host) return err(403, "AccessDenied")
    const denied = authenticate(method, url, headers, body)
    if (denied !== null) return denied
    const prefixPath = `/${cfg.bucket}`
    if (url.pathname !== prefixPath && !url.pathname.startsWith(`${prefixPath}/`)) return err(404, "NoSuchBucket")
    const key = decodeURIComponent(url.pathname.slice(prefixPath.length + 1))

    if (key === "" && method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? ""
      const after = url.searchParams.get("continuation-token") === null ? "" : Buffer.from(url.searchParams.get("continuation-token")!, "base64").toString("utf8")
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort()
      const page = all.slice(0, pageSize), truncated = all.length > pageSize
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${cfg.bucket}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${Buffer.from(page[page.length - 1], "utf8").toString("base64")}</NextContinuationToken>` : ""}${page.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join("")}</ListBucketResult>`, { status: 200 })
    }
    if (method === "PUT") {
      if (headers["If-None-Match"] === "*" || headers["if-none-match"] === "*") { if (objects.has(key)) return err(412, "PreconditionFailed") }
      objects.set(key, new Uint8Array(body ?? new Uint8Array(0)))
      return new Response(null, { status: 200 })
    }
    if (method === "GET" || method === "HEAD") {
      const found = objects.get(key)
      if (found === undefined) return method === "HEAD" ? new Response(null, { status: 404 }) : err(404, "NoSuchKey")
      return new Response(method === "HEAD" ? null : new Uint8Array(found), { status: 200, headers: { "content-length": String(found.length) } })
    }
    if (method === "DELETE") {
      inFlight += 1; stats.maxInFlightDeletes = Math.max(stats.maxInFlightDeletes, inFlight)
      await new Promise((r) => setTimeout(r, 0)) // deixa a concorrência observável
      objects.delete(key); inFlight -= 1
      return new Response(null, { status: 204 }) // 204 existindo ou não, como o R2 (medido)
    }
    return err(405, "MethodNotAllowed")
  }
  return { fetch: fetchImpl, objects, log, faults, stats }
}
