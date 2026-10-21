// Tela do AI Partner (E7-15e, D-U3/D-U4): cliente HTTP das rotas /api/ai-partner/{chat,imports}. `fetch` é injetado (prévia e testes usam um falso). Nunca lança: todo desfecho é
// { ok:true, … } ou { ok:false, code } com `code` do mapa de erros — código desconhecido do servidor vira BAD_RESPONSE e o texto de erro do servidor NUNCA é repassado.
// Só mesma origem, sem cache, sem cabeçalho extra (o navegador manda o cookie de sessão e o Origin).
import { ERROR_CODES } from "./errors.ts"

const CHAT_URL = "/api/ai-partner/chat"
const IMPORTS_URL = "/api/ai-partner/imports"
/** O tempo do cliente passa dos 60 s da rota (maxDuration) para não abortar antes do servidor responder. */
export const DEFAULT_TIMEOUT_MS = 75_000
/** Corpo do upload ≤ 4 MiB na rota; o multipart acrescenta cabeçalhos, então o arquivo tem folga de 2 KiB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 - 2048

export type Failure = { readonly ok: false; readonly code: string; readonly retryAfterSec?: number; readonly suggestedPlan?: "TRADER" | "PRO" }
export interface ChatReply { readonly ok: true; readonly conversationId: string; readonly outcome: "ANSWERED" | "STOPPED"; readonly response: unknown; readonly usage: { used: number; limit: number; remaining: number } | null }
export interface ImportRow { readonly fileSha256: string; readonly importId: string; readonly fileName: string | null; readonly fileBytes: number; readonly createdAt: string }
type FetchFn = (url: string, init: RequestInit) => Promise<Response>
export interface TransportOptions { readonly fetch: FetchFn; readonly timeoutMs?: number }
export interface Transport {
  sendChat(req: { question: string; conversationId: string | null }): Promise<ChatReply | Failure>
  listImports(): Promise<{ ok: true; imports: ImportRow[]; usage: Record<string, unknown> } | Failure>
  uploadImport(file: File): Promise<{ ok: true; created: boolean } | Failure>
  deleteImport(fileSha256: string): Promise<{ ok: true } | Failure>
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const fail = (code: string, extra: { retryAfterSec?: number; suggestedPlan?: "TRADER" | "PRO" } = {}): Failure => ({ ok: false, code, ...extra })
const SHA = /^[0-9a-f]{64}$/

type Raw = { readonly status: number; readonly headers: Headers; readonly body: unknown } | Failure
async function request(fetchFn: FetchFn, timeoutMs: number, url: string, init: RequestInit): Promise<Raw> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const res = await fetchFn(url, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal })
    let body: unknown = null
    try { body = JSON.parse(await res.text()) } catch { body = null }
    return { status: res.status, headers: res.headers, body }
  } catch {
    return fail(timedOut ? "TIMEOUT" : "NETWORK")
  } finally {
    clearTimeout(timer)
  }
}

/** Falha do servidor → código conhecido (ou UNAUTHENTICATED/BAD_RESPONSE). */
function failureOf(raw: { status: number; headers: Headers; body: unknown }): Failure {
  const code = isRecord(raw.body) && typeof raw.body.code === "string" ? raw.body.code : null
  if (code === null) return fail(raw.status === 401 ? "UNAUTHENTICATED" : "BAD_RESPONSE")
  if (!ERROR_CODES.includes(code)) return fail("BAD_RESPONSE")
  const header = raw.headers.get("retry-after")
  const extra: { retryAfterSec?: number; suggestedPlan?: "TRADER" | "PRO" } = {}
  if (header !== null && /^\d{1,5}$/.test(header)) extra.retryAfterSec = Number(header)
  if (isRecord(raw.body) && (raw.body.suggestedPlan === "TRADER" || raw.body.suggestedPlan === "PRO")) extra.suggestedPlan = raw.body.suggestedPlan
  return fail(code, extra)
}

const usageOf = (x: unknown): ChatReply["usage"] => (isRecord(x) && [x.used, x.limit, x.remaining].every((n) => typeof n === "number" && Number.isFinite(n)) ? { used: x.used as number, limit: x.limit as number, remaining: x.remaining as number } : null)

export function createHttpTransport(options: TransportOptions): Transport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const call = (url: string, init: RequestInit): Promise<Raw> => request(options.fetch, timeoutMs, url, init)
  return {
    async sendChat({ question, conversationId }) {
      try {
        if (typeof question !== "string") return fail("INVALID_ARGS")
        const body = JSON.stringify(conversationId === null ? { question } : { question, conversationId })
        const raw = await call(CHAT_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        if ("code" in raw) return raw
        const b = raw.body
        if (raw.status === 200 && isRecord(b) && b.ok === true && typeof b.conversationId === "string" && isRecord(b.response) && (b.outcome === "ANSWERED" || b.outcome === "STOPPED"))
          return { ok: true, conversationId: b.conversationId, outcome: b.outcome, response: b.response, usage: usageOf(b.usage) }
        return raw.status === 200 ? fail("BAD_RESPONSE") : failureOf(raw)
      } catch { return fail("NETWORK") }
    },
    async listImports() {
      try {
        const raw = await call(IMPORTS_URL, { method: "GET" })
        if ("code" in raw) return raw
        const b = raw.body
        if (raw.status !== 200) return failureOf(raw)
        if (!isRecord(b) || !Array.isArray(b.imports) || !isRecord(b.usage)) return fail("BAD_RESPONSE")
        const imports: ImportRow[] = []
        for (const r of b.imports) {
          if (!isRecord(r) || typeof r.fileSha256 !== "string" || !SHA.test(r.fileSha256) || typeof r.importId !== "string" || typeof r.fileBytes !== "number" || typeof r.createdAt !== "string" || (r.fileName !== null && typeof r.fileName !== "string")) return fail("BAD_RESPONSE")
          imports.push({ fileSha256: r.fileSha256, importId: r.importId, fileName: r.fileName as string | null, fileBytes: r.fileBytes, createdAt: r.createdAt })
        }
        return { ok: true, imports, usage: b.usage }
      } catch { return fail("NETWORK") }
    },
    async uploadImport(file) {
      try {
        if (typeof File === "undefined" || !(file instanceof File)) return fail("INVALID_ARGS")
        if (file.size > MAX_UPLOAD_BYTES) return fail("TOO_LARGE_FOR_ROUTE")
        const form = new FormData()
        form.append("file", file)
        const raw = await call(IMPORTS_URL, { method: "POST", body: form }) // sem content-type manual: o navegador acrescenta o boundary
        if ("code" in raw) return raw
        if ((raw.status === 200 || raw.status === 201) && isRecord(raw.body)) return { ok: true, created: raw.status === 201 }
        return raw.status === 200 || raw.status === 201 ? fail("BAD_RESPONSE") : failureOf(raw)
      } catch { return fail("NETWORK") }
    },
    async deleteImport(fileSha256) {
      try {
        if (typeof fileSha256 !== "string" || !SHA.test(fileSha256)) return fail("INVALID_ARGS")
        const raw = await call(`${IMPORTS_URL}/${fileSha256}`, { method: "DELETE" })
        if ("code" in raw) return raw
        if (raw.status === 200 && isRecord(raw.body) && raw.body.ok === true) return { ok: true }
        return raw.status === 200 ? fail("BAD_RESPONSE") : failureOf(raw)
      } catch { return fail("NETWORK") }
    },
  }
}
