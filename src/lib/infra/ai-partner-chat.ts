// Tratador PURO da rota do chat do AI Partner (E7-15c, D-G5…D-G7): recebe um `Request` da web e um `ctx` INJETADO e devolve um `Response`. Não conhece Next, ambiente, rede nem a Groq (o modelo vem de `ctx.makeModel`).
// Fluxo do POST: sessão → configurado? → Origin (CSRF) → limite por minuto do usuário → corpo JSON com TETO de 8 KiB e chaves estritas { question, conversationId?, fileSha256? } → plano lido do BANCO → importação do turno
// (a mais recente, ou o `fileSha256` do PRÓPRIO usuário; sem importação ⇒ 409 NO_IMPORTS ANTES de qualquer custo) → `withChatQuota` { reserva do usuário (+ pool no Free) → guarda global da Groq → runChatTurn }.
// A guarda global roda DENTRO do turno, depois da reserva: assim um Free sem cota/pool nunca a consome nem trava pagantes (BUSY devolve a cota). Respostas: JSON com `Cache-Control: no-store`; erros `{ ok:false, code, error }`
// com mensagem FIXA — nunca ecoam a pergunta, exceção, SQL, URL nem chave. Nada lança.
import type { BundleCache } from "./bundle-cache.ts"
import { getChatUsage, withChatQuota } from "./chat-quota.ts"
import type { ChatQuotaStore } from "./chat-quota-store.ts"
import { runChatTurn, type ModelPort } from "./chat-turn.ts"
import { isId, type Conversations } from "./conversation-store.ts"
import type { ImportSourceStore } from "./import-source-store.ts"
import { isValidSha256, isValidUserId, type RawFileStorage } from "./raw-file-storage.ts"
import type { PersistentSalts } from "./salt-store.ts"

/** Turnos por minuto por usuário (a cota mensal é a proteção de custo; isto é só contra rajada). */
export const CHAT_USER_PER_MIN = 5
/** Turnos por minuto da ORGANIZAÇÃO inteira na Groq (plano base: 8K tokens/min). Medido no E7-16: ~1,5K tokens por turno ⇒ 4 turnos ≈ 6,3K < 8K (era 1 quando o turno custava 5–8K). Sobe com o plano Developer. */
export const GROQ_GLOBAL_TURNS_PER_MIN = 4
export const MAX_CHAT_BODY_BYTES = 8192
/** Prazo do turno: abaixo do `maxDuration` da rota (60 s) e do lease da reserva (90 s). */
export const TURN_DEADLINE_MS = 50_000
const MAX_QUESTION_CHARS = 4000
const PLANS = ["FREE", "TRADER", "PRO"] as const

export interface AiPartnerChatDeps {
  readonly rawStorage: RawFileStorage
  readonly importStore: ImportSourceStore
  readonly salts: Pick<PersistentSalts, "load">
  readonly conversations: Conversations
  readonly quota: ChatQuotaStore
  readonly cache?: BundleCache
}
export interface AiPartnerChatCtx {
  /** O usuário da sessão, ou null. */
  readonly userId: string | null
  /** O plano do usuário LIDO DO BANCO (a cada pedido). */
  getPlan(userId: string): Promise<unknown>
  rateLimit(userId: string): Promise<{ readonly ok: boolean; readonly retryAfterSec: number }>
  /** Guarda global da organização na Groq (por minuto). */
  globalGuard(): Promise<{ readonly ok: boolean; readonly retryAfterSec: number }>
  /** null ⇒ a feature está apagada neste ambiente (503 NOT_CONFIGURED). */
  readonly deps: AiPartnerChatDeps | null
  /** Cria o modelo do turno com o prazo ABSOLUTO (ms, época). */
  makeModel(deadlineAt: number): ModelPort
  readonly clock: { iso(): string; ms(): number }
  newLeaseId(): string
}

const MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "Pedido inválido.", TOO_LARGE: "Pedido grande demais.", UNSUPPORTED_MEDIA_TYPE: "Envie o pedido como JSON.", RATE_LIMITED: "Muitas requisições. Tente novamente em instantes.",
  FORBIDDEN_ORIGIN: "Origem não permitida.", NOT_CONFIGURED: "Recurso indisponível no momento.", NO_IMPORTS: "Importe um arquivo de trades antes de conversar.",
  QUOTA_EXCEEDED: "Você usou todos os turnos deste mês.", FREE_POOL_EXHAUSTED: "O teste gratuito deste mês acabou. Assine para continuar.", TURN_IN_PROGRESS: "Já há uma resposta em andamento.",
  BUSY: "Muitos pedidos agora. Tente novamente em instantes.", MODEL_UNAVAILABLE: "O assistente está indisponível agora. Tente novamente.", NOT_FOUND: "Conversa não encontrada.",
  TURN_CONFLICT: "A conversa mudou durante a resposta. Tente novamente.", CONVERSATION_FULL: "Esta conversa chegou ao limite. Comece uma nova.", STORAGE_ERROR: "Não foi possível processar agora. Tente novamente.",
}
const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } })
const fail = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => json(status, { ok: false, code, error: MESSAGES[code] ?? MESSAGES.STORAGE_ERROR, ...extra }, headers)
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const retryHeader = (sec: unknown): Record<string, string> => ({ "retry-after": String(Math.max(1, Math.ceil(Number(sec) || 1))) })

/** Lê o corpo ATÉ o teto (em fluxo). null ⇒ passou do teto. */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_CHAT_BODY_BYTES) { try { await req.body?.cancel() } catch { /* nada */ } return null }
  if (req.body === null) return new Uint8Array(0)
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_CHAT_BODY_BYTES) { try { await reader.cancel() } catch { /* nada */ } return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total); let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

interface ChatBody { readonly question: string; readonly conversationId: string | null; readonly fileSha256: string | null }
const parseBody = (x: unknown): ChatBody | null => {
  if (!isRecord(x) || Object.keys(x).some((k) => !["question", "conversationId", "fileSha256"].includes(k))) return null
  const { question, conversationId, fileSha256 } = x
  if (typeof question !== "string" || question.trim() === "" || question.length > MAX_QUESTION_CHARS) return null
  if (conversationId !== undefined && !isId(conversationId)) return null
  if (fileSha256 !== undefined && !isValidSha256(fileSha256)) return null
  return { question, conversationId: conversationId ?? null, fileSha256: fileSha256 ?? null }
}

export async function handleChatPost(ctx: AiPartnerChatCtx, req: Request): Promise<Response> {
  try {
    if (!isRecord(ctx) || !isValidUserId(ctx.userId)) return json(401, { error: "Não autorizado" })
    if (ctx.deps === null || !isRecord(ctx.deps)) return fail(503, "NOT_CONFIGURED")
    const { userId, deps } = ctx
    const origin = req.headers.get("origin")
    let own = ""
    try { own = new URL(req.url).origin } catch { own = "" }
    if (origin !== null && origin !== own) return fail(403, "FORBIDDEN_ORIGIN")
    try {
      const limit = await ctx.rateLimit(userId)
      if (!limit.ok) return fail(429, "RATE_LIMITED", {}, retryHeader(limit.retryAfterSec))
    } catch { /* o limitador fora do ar não derruba a feature: a cota segue limitando */ }

    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return fail(415, "UNSUPPORTED_MEDIA_TYPE")
    const bytes = await readCapped(req)
    if (bytes === null) return fail(413, "TOO_LARGE")
    let parsed: ChatBody | null = null
    try { parsed = parseBody(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) } catch { parsed = null }
    if (parsed === null) return fail(400, "INVALID_REQUEST")

    let plan: (typeof PLANS)[number] | null = null
    try { const p = await ctx.getPlan(userId); plan = (PLANS as readonly unknown[]).includes(p) ? (p as (typeof PLANS)[number]) : null } catch { plan = null }
    if (plan === null) return fail(500, "STORAGE_ERROR")

    // a importação do turno: ANTES de reservar cota, guarda global ou modelo
    const listed = await deps.importStore.list(userId)
    if (!listed.ok) return fail(500, "STORAGE_ERROR")
    const rows = [...listed.rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    const chosen = parsed.fileSha256 !== null ? rows.find((r) => r.fileSha256 === parsed.fileSha256) : rows[0]
    if (chosen === undefined) return fail(409, "NO_IMPORTS")
    const pin = { sources: [{ fileSha256: chosen.fileSha256 }], analysis: {} }
    const question = parsed.question, conversationId = parsed.conversationId

    const quotaDeps = { store: deps.quota, now: () => ctx.clock.iso(), newLeaseId: () => ctx.newLeaseId() }
    const outcome = await withChatQuota(quotaDeps, { userId, plan }, async (): Promise<unknown> => {
      let guard: { ok: boolean; retryAfterSec: number } = { ok: true, retryAfterSec: 0 }
      try { guard = await ctx.globalGuard() } catch { /* fail-open: a cota e o 429 da Groq seguem protegendo */ }
      if (!guard.ok) return { ok: false, code: "BUSY", retryAfterSec: guard.retryAfterSec }
      let model: ModelPort
      try { model = ctx.makeModel(ctx.clock.ms() + TURN_DEADLINE_MS) } catch { return { ok: false, code: "MODEL_ERROR" } }
      return runChatTurn({ deps: { rawStorage: deps.rawStorage, importStore: deps.importStore, conversations: deps.conversations, salts: deps.salts as never, ...(deps.cache !== undefined ? { cache: deps.cache } : {}) }, model, userId, pin, question, conversationId })
    }) as Record<string, unknown>

    if (outcome.ok === true) {
      const usage = await getChatUsage(quotaDeps, { userId, plan })
      return json(200, { ok: true, conversationId: outcome.conversationId, outcome: outcome.outcome, response: outcome.response, usage: usage.ok ? { used: usage.used, limit: usage.limit, remaining: usage.remaining } : null })
    }
    switch (outcome.code) {
      case "QUOTA_EXCEEDED": return fail(403, "QUOTA_EXCEEDED", { upgrade: true, limit: outcome.limit, used: outcome.used, suggestedPlan: outcome.suggestedPlan })
      case "FREE_POOL_EXHAUSTED": return fail(403, "FREE_POOL_EXHAUSTED", { upgrade: true, suggestedPlan: "TRADER" })
      case "TURN_IN_PROGRESS": return fail(409, "TURN_IN_PROGRESS")
      case "BUSY": return fail(429, "BUSY", {}, retryHeader(outcome.retryAfterSec))
      case "MODEL_ERROR": return fail(503, "MODEL_UNAVAILABLE")
      case "NOT_FOUND": return fail(404, "NOT_FOUND")
      case "SALT_REQUIRED": return fail(409, "NO_IMPORTS")
      case "TURN_CONFLICT": return fail(409, "TURN_CONFLICT")
      case "LIMIT_EXCEEDED": return fail(409, "CONVERSATION_FULL")
      case "INVALID_ARGS": return fail(400, "INVALID_REQUEST")
      default: return fail(500, "STORAGE_ERROR")
    }
  } catch {
    return fail(500, "STORAGE_ERROR")
  }
}
