// Cache de bundles em memória (E7-5, D-R5/D-R6): guarda o bundle SELADO por (userId, ref), com despejo LRU por BYTES e single-flight por chave.
// Só o servidor usa (o modelo nunca vê um bundle). Não guarda falha, não congela nem copia o bundle (custo em 20 MiB; o teste prova que o consumo é só leitura) e só aceita bundle cujo ev_+hash É o ref da chave.
// Em memória do processo: em serverless cada instância tem o seu cache (limite declarado). Sem relógio, disco, rede nem ambiente. Nada lança depois de construído; erros são `{ ok:false, code }` com código fixo, sem eco.
import { isValidUserId } from "./raw-file-storage.ts"

export const DEFAULT_BUNDLE_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CONFIGURABLE_BYTES = 1024 * 1024 * 1024
const REF_RE = /^ev_[0-9a-f]{32}$/
const HASH_RE = /^[0-9a-f]{64}$/
const CODE_RE = /^[A-Z][A-Z0-9_]{1,40}$/

export type LoadResult = { readonly ok: true; readonly bundle: unknown } | { readonly ok: false; readonly code: string }
export type GetOrLoadResult =
  | { readonly ok: true; readonly bundle: unknown; readonly from: "cache" | "loaded" }
  | { readonly ok: false; readonly code: string }
export type PutResult = { readonly ok: true; readonly stored: boolean } | { readonly ok: false; readonly code: "INVALID_ARGS" }

export interface BundleCache {
  /** O bundle (a MESMA referência) ou null. Consultar refresca a posição no LRU. */
  get(userId: string, ref: string): unknown
  put(userId: string, ref: string, bundle: unknown): PutResult
  /** Acerto ⇒ `from:"cache"`; erro ⇒ UM loader por chave em voo (os concorrentes compartilham o resultado); só sucesso é guardado. */
  getOrLoad(userId: string, ref: string, loader: () => Promise<LoadResult>): Promise<GetOrLoadResult>
  stats(): { readonly entries: number; readonly bytes: number; readonly maxBytes: number }
  /** E7-7 (LGPD): tira TODOS os bundles do usuário (devolve quantos). Um voo iniciado ANTES não guarda o resultado depois (geração por usuário). Usuário inválido ⇒ 0. */
  purgeUser(userId: string): number
}

const refOfBundle = (bundle: unknown): string | null => {
  if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) return null
  const h = (bundle as { evidenceHash?: unknown }).evidenceHash
  return typeof h === "string" && HASH_RE.test(h) ? `ev_${h.slice(0, 32)}` : null
}
const sizeOf = (bundle: unknown): number | null => {
  try { const s = JSON.stringify(bundle); return typeof s === "string" ? Buffer.byteLength(s, "utf8") : null } catch { return null }
}
const keyOf = (userId: unknown, ref: unknown): string | null => (isValidUserId(userId) && typeof ref === "string" && REF_RE.test(ref) ? `${userId}\n${ref}` : null)
const fail = (code: string): { readonly ok: false; readonly code: string } => ({ ok: false, code })

export function createBundleCache(options: { readonly maxBytes?: number } = {}): BundleCache {
  const maxBytes = options.maxBytes ?? DEFAULT_BUNDLE_CACHE_BYTES
  if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CONFIGURABLE_BYTES) throw new TypeError("maxBytes inválido")
  const entries = new Map<string, { readonly bundle: unknown; readonly size: number }>() // a ordem de inserção É a ordem do LRU (o mais antigo primeiro)
  const flights = new Map<string, Promise<GetOrLoadResult>>()
  const generations = new Map<string, number>() // E7-7: sobe a cada purga do usuário; um voo só guarda se a geração não mudou desde que começou
  let bytes = 0

  const get = (userId: string, ref: string): unknown => {
    const key = keyOf(userId, ref)
    if (key === null) return null
    const hit = entries.get(key)
    if (hit === undefined) return null
    entries.delete(key); entries.set(key, hit) // refresca
    return hit.bundle
  }
  const put = (userId: string, ref: string, bundle: unknown): PutResult => {
    const key = keyOf(userId, ref)
    if (key === null || refOfBundle(bundle) !== ref) return { ok: false, code: "INVALID_ARGS" }
    const size = sizeOf(bundle)
    if (size === null) return { ok: false, code: "INVALID_ARGS" }
    if (size > maxBytes) return { ok: true, stored: false } // maior que o teto: não guarda e não despeja ninguém
    const old = entries.get(key)
    if (old !== undefined) { bytes -= old.size; entries.delete(key) }
    while (bytes + size > maxBytes) {
      const oldest = entries.keys().next()
      if (oldest.done === true) break
      bytes -= entries.get(oldest.value)!.size; entries.delete(oldest.value)
    }
    entries.set(key, { bundle, size }); bytes += size
    return { ok: true, stored: true }
  }
  const run = async (userId: string, ref: string, loader: () => Promise<LoadResult>, generation: number): Promise<GetOrLoadResult> => {
    let res: unknown
    try { res = await loader() } catch { return fail("STORAGE_ERROR") } // lança, rejeita ou lança síncrono: nunca ecoa a mensagem
    if (typeof res !== "object" || res === null) return fail("STORAGE_ERROR")
    const r = res as { ok?: unknown; bundle?: unknown; code?: unknown }
    if (r.ok === false) return typeof r.code === "string" && CODE_RE.test(r.code) ? fail(r.code) : fail("STORAGE_ERROR")
    if (r.ok !== true || r.bundle === null || r.bundle === undefined) return fail("STORAGE_ERROR")
    if (refOfBundle(r.bundle) !== ref) return fail("REF_MISMATCH")
    if ((generations.get(userId) ?? 0) !== generation) return { ok: true, bundle: r.bundle, from: "loaded" } // purgado no meio do voo: quem esperava recebe, mas NADA é guardado
    const stored = put(userId, ref, r.bundle)
    if (!stored.ok) return fail("STORAGE_ERROR")
    return { ok: true, bundle: r.bundle, from: "loaded" }
  }
  const getOrLoad = (userId: string, ref: string, loader: () => Promise<LoadResult>): Promise<GetOrLoadResult> => {
    const key = keyOf(userId, ref)
    if (key === null || typeof loader !== "function") return Promise.resolve(fail("INVALID_ARGS"))
    const hit = get(userId, ref)
    if (hit !== null) return Promise.resolve({ ok: true, bundle: hit, from: "cache" })
    const flying = flights.get(key)
    if (flying !== undefined) return flying
    const flight: Promise<GetOrLoadResult> = run(userId, ref, loader, generations.get(userId) ?? 0).finally(() => { if (flights.get(key) === flight) flights.delete(key) }) // sucesso OU falha: o voo termina e a falha não fica
    flights.set(key, flight)
    return flight
  }
  const purgeUser = (userId: string): number => {
    if (!isValidUserId(userId)) return 0
    generations.set(userId, (generations.get(userId) ?? 0) + 1)
    let removed = 0
    for (const [key, value] of [...entries]) if (key.startsWith(`${userId}\n`)) { entries.delete(key); bytes -= value.size; removed += 1 }
    for (const key of [...flights.keys()]) if (key.startsWith(`${userId}\n`)) flights.delete(key) // quem chegar depois começa um voo NOVO
    return removed
  }
  return { get, put, getOrLoad, stats: () => ({ entries: entries.size, bytes, maxBytes }), purgeUser }
}
