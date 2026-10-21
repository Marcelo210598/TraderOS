// Regras da cota mensal do chat (E7-15b, D-C1…D-C10): o invólucro que a rota do chat chama AO REDOR do turno (`withChatQuota`): reserva ANTES de qualquer chamada ao modelo (fail-closed), roda o turno, liquida.
//   · DEVOLVE a reserva quando nada foi entregue por falha nossa/upstream: INVALID_ARGS, SALT_REQUIRED, NOT_FOUND, STORAGE_ERROR, MODEL_ERROR, ou a fn LANÇAR. CONSOME em resposta (ok) e em TURN_CLOSED, TURN_CONFLICT,
//     LIMIT_EXCEEDED, COMMIT_REJECTED, código desconhecido ou resultado malformado (o modelo pode ter rodado: devolver aí daria uso grátis infinito).
//   · 1 turno ativo por usuário (o lease da reserva); erro ao liquidar NUNCA esconde a resposta já paga (o lease vence sozinho).
//   · Mês civil UTC; o limite vem do PLANO ATUAL a cada reserva (subir libera na hora; descer não apaga o uso). Apagar conversa/dados de IA NÃO toca aqui; só `deleteChatUsageForUser` (exclusão da conta).
//   · Relógio e gerador de leaseId são INJETADOS (sem Date.now/aleatório de módulo). Resultados sem userId, leaseId nem texto; nada lança.
import { PLAN_CHAT_QUOTAS, type PlanKey } from "../plans.ts"
import { fail, monthKey, type ChatQuotaFailure, type ChatQuotaStore } from "./chat-quota-store.ts"
import { isValidUserId } from "./raw-file-storage.ts"

export interface ChatQuotaDeps {
  readonly store: ChatQuotaStore
  /** Instante atual em ISO UTC de 24 caracteres (`toISOString()`). */
  readonly now: () => string
  /** Identificador único do turno (`[A-Za-z0-9_-]{1,64}`), ex.: um UUID. */
  readonly newLeaseId: () => string
}
export interface QuotaExceeded { readonly ok: false; readonly code: "QUOTA_EXCEEDED"; readonly limit: number; readonly used: number; readonly suggestedPlan: "TRADER" | "PRO" | null }
export type QuotaBlock = QuotaExceeded | { readonly ok: false; readonly code: "TURN_IN_PROGRESS" } | ChatQuotaFailure

const PLAN_ORDER: readonly PlanKey[] = ["FREE", "TRADER", "PRO"]
/** Códigos em que NADA foi entregue por falha nossa/upstream: a reserva é devolvida (D-C7). */
const REFUND_CODES: ReadonlySet<string> = new Set(["INVALID_ARGS", "SALT_REQUIRED", "NOT_FOUND", "STORAGE_ERROR", "MODEL_ERROR"])
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const isPlan = (x: unknown): x is PlanKey => typeof x === "string" && (PLAN_ORDER as readonly string[]).includes(x)
const depsOk = (d: unknown): d is ChatQuotaDeps => isRecord(d) && isRecord(d.store) && typeof d.now === "function" && typeof d.newLeaseId === "function"

/** O menor plano acima do atual cujo limite comporta o uso (null se nenhum). */
const suggestedPlanFor = (plan: PlanKey, used: number): "TRADER" | "PRO" | null => {
  for (const p of PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan) + 1)) if (PLAN_CHAT_QUOTAS[p] > used) return p as "TRADER" | "PRO"
  return null
}

export async function withChatQuota<T>(deps: ChatQuotaDeps, req: { readonly userId: string; readonly plan: PlanKey }, fn: () => Promise<T>): Promise<T | QuotaBlock> {
  try {
    if (!depsOk(deps) || !isRecord(req) || !isValidUserId(req.userId) || !isPlan(req.plan) || typeof fn !== "function") return fail("INVALID_ARGS")
    const { store } = deps
    const now = deps.now(), leaseId = deps.newLeaseId(), month = monthKey(now), limit = PLAN_CHAT_QUOTAS[req.plan]
    const got = await store.reserve({ userId: req.userId, month, limit, leaseId, now })
    if (!got.ok) {
      if (got.code === "QUOTA_EXCEEDED") return { ok: false, code: "QUOTA_EXCEEDED", limit: got.limit, used: got.used, suggestedPlan: suggestedPlanFor(req.plan, got.used) }
      return got.code === "TURN_IN_PROGRESS" ? { ok: false, code: "TURN_IN_PROGRESS" } : fail(got.code)
    }
    const settle = async (outcome: "CONSUME" | "REFUND"): Promise<void> => {
      try { await store.settle({ userId: req.userId, month, leaseId, outcome, now: deps.now() }) } catch { /* o lease vence sozinho */ }
    }
    let result: unknown
    try { result = await fn() } catch { await settle("REFUND"); return fail("STORAGE_ERROR") }
    if (!isRecord(result) || typeof result.ok !== "boolean") { await settle("CONSUME"); return fail("STORAGE_ERROR") }
    await settle(result.ok === false && typeof result.code === "string" && REFUND_CODES.has(result.code) ? "REFUND" : "CONSUME")
    return result as T
  } catch {
    return fail("STORAGE_ERROR")
  }
}

/** Uso do mês para a tela: { used, limit, remaining, resetsAt }. */
export async function getChatUsage(deps: ChatQuotaDeps, req: { readonly userId: string; readonly plan: PlanKey }): Promise<{ readonly ok: true; readonly used: number; readonly limit: number; readonly remaining: number; readonly resetsAt: string } | ChatQuotaFailure> {
  try {
    if (!depsOk(deps) || !isRecord(req) || !isValidUserId(req.userId) || !isPlan(req.plan)) return fail("INVALID_ARGS")
    const now = deps.now(), month = monthKey(now), limit = PLAN_CHAT_QUOTAS[req.plan]
    const u = await deps.store.usage({ userId: req.userId, month })
    if (!u.ok) return fail(u.code)
    const [y, m] = month.split("-").map(Number)
    return { ok: true, used: u.used, limit, remaining: Math.max(0, limit - u.used), resetsAt: new Date(Date.UTC(y, m, 1)).toISOString() }
  } catch {
    return fail("STORAGE_ERROR")
  }
}

/** Exclusão da CONTA (D-C8): apaga o uso de todos os meses. O expurgo de dados de IA (user-purge.ts) NÃO chama isto. */
export async function deleteChatUsageForUser(deps: ChatQuotaDeps, req: { readonly userId: string }): Promise<{ readonly ok: true; readonly deleted: number } | ChatQuotaFailure> {
  try {
    if (!depsOk(deps) || !isRecord(req) || !isValidUserId(req.userId)) return fail("INVALID_ARGS")
    return await deps.store.deleteForUser(req.userId)
  } catch {
    return fail("STORAGE_ERROR")
  }
}
