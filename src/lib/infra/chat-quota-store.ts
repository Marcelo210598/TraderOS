// Armazenamento da COTA MENSAL do chat do AI Partner + trava de 1 turno ativo (E7-15b, D-C3…D-C6). Interface `ChatQuotaStore` + implementação em MEMÓRIA (a do Postgres está em prisma-chat-quota-store.ts e
// obedece ao MESMO contrato, testado nas duas).
//   · `reserve` é a operação atômica: reserva 1 turno SE (usado < limite) E (não há lease ativo, ou o lease venceu). Lease vale enquanto `agora ≤ leaseUntil` (no instante exato ainda segura); passou disso, outro turno
//     pode assumir e o consumo do turno morto FICA contado (fail-closed). Prioridade: usado ≥ limite ⇒ QUOTA_EXCEEDED mesmo com lease em andamento.
//   · `settle` só vale para o DONO do lease (leaseId): CONSUME libera e mantém o uso; REFUND libera e devolve 1 (nunca abaixo de 0). Idempotente (`applied:false`).
//   · O relógio entra por argumento (`now`, ISO UTC de 24 caracteres): sem relógio nem aleatório de módulo.
// Nada lança; erros são códigos fixos, sem eco de userId/leaseId/mensagem.
import { isValidUserId } from "./raw-file-storage.ts"

/** Duração do lease (o turno ativo): maior que o `maxDuration` da rota do chat (E7-15c). */
export const CHAT_LEASE_MS = 90_000

/** O "usuário" reservado que guarda o pool global do Free (D-C12): nunca é um usuário real e é recusado nas operações de usuário. */
export const FREE_POOL_USER_ID = "pool-free-chat"

export type ChatQuotaFailureCode = "INVALID_ARGS" | "STORAGE_ERROR"
export interface ChatQuotaFailure { readonly ok: false; readonly code: ChatQuotaFailureCode }
export interface ReserveRequest { readonly userId: string; readonly month: string; readonly limit: number; readonly leaseId: string; readonly now: string }
export type ReserveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "QUOTA_EXCEEDED"; readonly used: number; readonly limit: number }
  | { readonly ok: false; readonly code: "TURN_IN_PROGRESS" }
  | ChatQuotaFailure
export type SettleOutcome = "CONSUME" | "REFUND"
export interface SettleRequest { readonly userId: string; readonly month: string; readonly leaseId: string; readonly outcome: SettleOutcome; readonly now: string }
export interface ChatQuotaStore {
  reserve(req: ReserveRequest): Promise<ReserveResult>
  settle(req: SettleRequest): Promise<{ readonly ok: true; readonly applied: boolean } | ChatQuotaFailure>
  usage(req: { readonly userId: string; readonly month: string }): Promise<{ readonly ok: true; readonly used: number } | ChatQuotaFailure>
  /** Exclusão da CONTA (D-C8): apaga as linhas de TODOS os meses do usuário. NÃO é chamada pelo expurgo de dados de IA. */
  deleteForUser(userId: string): Promise<{ readonly ok: true; readonly deleted: number } | ChatQuotaFailure>
  /** Pool global do Free (D-C12): toma 1 turno do mês SE ainda há (atômico, sem lease). */
  poolTake(req: { readonly month: string; readonly limit: number; readonly now: string }): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: "POOL_EXHAUSTED" } | ChatQuotaFailure>
  /** Devolve 1 ao pool (nunca abaixo de 0); `applied:false` se já estava em 0. */
  poolGive(req: { readonly month: string; readonly now: string }): Promise<{ readonly ok: true; readonly applied: boolean } | ChatQuotaFailure>
  poolUsage(req: { readonly month: string }): Promise<{ readonly ok: true; readonly used: number } | ChatQuotaFailure>
}

// ── validação (a mesma régua para memória e Postgres) ──
export const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/
export const LEASE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const MAX_LIMIT = 1_000_000
/** Usuário válido E diferente do usuário reservado do pool. */
export const isRealUserId = (x: unknown): x is string => isValidUserId(x) && x !== FREE_POOL_USER_ID
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const onlyKeys = (x: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k))
/** ISO UTC de 24 caracteres que existe de verdade (round trip). */
export const isIsoUtc = (x: unknown): x is string => typeof x === "string" && ISO_RE.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString() === x
export const addMs = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString()
export const fail = (code: ChatQuotaFailureCode): ChatQuotaFailure => ({ ok: false, code })

/** Mês civil em UTC (`YYYY-MM`) de um instante ISO qualquer (o fuso do texto é respeitado e convertido). Entrada inválida ⇒ RangeError. */
export function monthKey(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new RangeError("instante inválido")
  return new Date(t).toISOString().slice(0, 7)
}

export const parseReserve = (x: unknown): ReserveRequest | null =>
  isRecord(x) && onlyKeys(x, ["userId", "month", "limit", "leaseId", "now"]) && isRealUserId(x.userId) && typeof x.month === "string" && MONTH_RE.test(x.month) && typeof x.limit === "number" && Number.isInteger(x.limit) && x.limit >= 1 && x.limit <= MAX_LIMIT && typeof x.leaseId === "string" && LEASE_ID_RE.test(x.leaseId) && isIsoUtc(x.now)
    ? { userId: x.userId, month: x.month, limit: x.limit, leaseId: x.leaseId, now: x.now }
    : null
export const parseSettle = (x: unknown): SettleRequest | null =>
  isRecord(x) && onlyKeys(x, ["userId", "month", "leaseId", "outcome", "now"]) && isRealUserId(x.userId) && typeof x.month === "string" && MONTH_RE.test(x.month) && typeof x.leaseId === "string" && LEASE_ID_RE.test(x.leaseId) && (x.outcome === "CONSUME" || x.outcome === "REFUND") && isIsoUtc(x.now)
    ? { userId: x.userId, month: x.month, leaseId: x.leaseId, outcome: x.outcome, now: x.now }
    : null
export const parsePoolTake = (x: unknown): { month: string; limit: number; now: string } | null =>
  isRecord(x) && onlyKeys(x, ["month", "limit", "now"]) && typeof x.month === "string" && MONTH_RE.test(x.month) && typeof x.limit === "number" && Number.isInteger(x.limit) && x.limit >= 1 && x.limit <= MAX_LIMIT && isIsoUtc(x.now) ? { month: x.month, limit: x.limit, now: x.now } : null
export const parsePoolGive = (x: unknown): { month: string; now: string } | null =>
  isRecord(x) && onlyKeys(x, ["month", "now"]) && typeof x.month === "string" && MONTH_RE.test(x.month) && isIsoUtc(x.now) ? { month: x.month, now: x.now } : null
export const parsePoolUsage = (x: unknown): { month: string } | null => (isRecord(x) && onlyKeys(x, ["month"]) && typeof x.month === "string" && MONTH_RE.test(x.month) ? { month: x.month } : null)
export const parseUsage = (x: unknown): { userId: string; month: string } | null =>
  isRecord(x) && onlyKeys(x, ["userId", "month"]) && isRealUserId(x.userId) && typeof x.month === "string" && MONTH_RE.test(x.month) ? { userId: x.userId, month: x.month } : null

interface Row { used: number; leaseId: string | null; leaseUntil: string | null }

export function createMemoryChatQuotaStore(): ChatQuotaStore {
  const rows = new Map<string, Row & { userId: string }>()
  const key = (userId: string, month: string): string => `${userId}|${month}`
  const pool = new Map<string, number>()
  return {
    async reserve(raw) {
      const req = parseReserve(raw)
      if (req === null) return fail("INVALID_ARGS")
      const row = rows.get(key(req.userId, req.month))
      const lease = { leaseId: req.leaseId, leaseUntil: addMs(req.now, CHAT_LEASE_MS) }
      if (row === undefined) { rows.set(key(req.userId, req.month), { userId: req.userId, used: 1, ...lease }); return { ok: true } }
      if (row.used >= req.limit) return { ok: false, code: "QUOTA_EXCEEDED", used: row.used, limit: req.limit }
      if (row.leaseUntil !== null && !(row.leaseUntil < req.now)) return { ok: false, code: "TURN_IN_PROGRESS" }
      row.used += 1; row.leaseId = lease.leaseId; row.leaseUntil = lease.leaseUntil
      return { ok: true }
    },
    async settle(raw) {
      const req = parseSettle(raw)
      if (req === null) return fail("INVALID_ARGS")
      const row = rows.get(key(req.userId, req.month))
      if (row === undefined || row.leaseId !== req.leaseId) return { ok: true, applied: false }
      if (req.outcome === "REFUND") { if (!(row.used > 0)) return { ok: true, applied: false }; row.used -= 1 }
      row.leaseId = null; row.leaseUntil = null
      return { ok: true, applied: true }
    },
    async usage(raw) {
      const req = parseUsage(raw)
      if (req === null) return fail("INVALID_ARGS")
      return { ok: true, used: rows.get(key(req.userId, req.month))?.used ?? 0 }
    },
    async poolTake(raw) {
      const req = parsePoolTake(raw)
      if (req === null) return fail("INVALID_ARGS")
      const used = pool.get(req.month) ?? 0
      if (used >= req.limit) return { ok: false, code: "POOL_EXHAUSTED" }
      pool.set(req.month, used + 1)
      return { ok: true }
    },
    async poolGive(raw) {
      const req = parsePoolGive(raw)
      if (req === null) return fail("INVALID_ARGS")
      const used = pool.get(req.month) ?? 0
      if (!(used > 0)) return { ok: true, applied: false }
      pool.set(req.month, used - 1)
      return { ok: true, applied: true }
    },
    async poolUsage(raw) {
      const req = parsePoolUsage(raw)
      return req === null ? fail("INVALID_ARGS") : { ok: true, used: pool.get(req.month) ?? 0 }
    },
    async deleteForUser(userId) {
      if (!isRealUserId(userId)) return fail("INVALID_ARGS")
      let deleted = 0
      for (const [k, row] of [...rows]) if (row.userId === userId) { rows.delete(k); deleted += 1 }
      return { ok: true, deleted }
    },
  }
}
