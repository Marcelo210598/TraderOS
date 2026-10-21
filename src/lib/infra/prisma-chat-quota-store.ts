// ChatQuotaStore sobre o Postgres via Prisma (E7-15b): MESMO contrato do de memória. Tabela `ai_chat_usage`, PK (userId, month); datas em TEXTO ISO (comparação lexicográfica == cronológica: 24 caracteres UTC).
//   · RESERVA = UM `updateMany` atômico: where { userId, month, used < limite, OR [lease nulo, lease < agora] } data { used +1, lease novo }. 1 linha ⇒ reservou. 0 linhas ⇒ lê a linha: usado ≥ limite ⇒ QUOTA_EXCEEDED
//     (prioridade), senão TURN_IN_PROGRESS; linha ausente ⇒ `create` com used 1 (violação de unicidade P2002 ⇒ repete o `updateMany` UMA vez, sem laço).
//   · LIQUIDAÇÃO só pelo dono do lease (where inclui leaseId); REFUND também exige used > 0.
//   · Qualquer falha do banco, resposta malformada ou linha corrompida ⇒ STORAGE_ERROR (fail-closed), sem mensagem, SQL, URL nem userId. Sem `@prisma/client`, sem SQL cru, sem ambiente: o cliente é INJETADO.
import { CHAT_LEASE_MS, addMs, fail, parseReserve, parseSettle, parseUsage, type ChatQuotaStore } from "./chat-quota-store.ts"
import { attempt, countOf, isIsoString, isRecord, type PrismaModelPort } from "./prisma-port.ts"
import { isValidUserId } from "./raw-file-storage.ts"

/** Só o que este adaptador exige do cliente: a tabela `aiChatUsage` (o cliente real satisfaz isto e a `PrismaPort` do E7-13 ao mesmo tempo). */
export interface PrismaChatUsagePort { readonly aiChatUsage: PrismaModelPort }
const METHODS = ["findUnique", "create", "updateMany", "deleteMany"] as const
export const isChatUsagePort = (x: unknown): x is PrismaChatUsagePort => isRecord(x) && isRecord(x.aiChatUsage) && METHODS.every((m) => typeof (x.aiChatUsage as Record<string, unknown>)[m] === "function")

interface UsageRow { readonly used: number; readonly leaseUntil: string | null }
/** Valida a linha que voltou do banco; qualquer desvio ⇒ null (o chamador responde STORAGE_ERROR). */
const parseRow = (raw: unknown, userId: string, month: string): UsageRow | null => {
  if (!isRecord(raw) || raw.userId !== userId || raw.month !== month) return null
  const { used, leaseId, leaseUntil, updatedAt } = raw
  if (typeof used !== "number" || !Number.isInteger(used) || used < 0) return null
  if (!(leaseId === null || typeof leaseId === "string") || !(leaseUntil === null || typeof leaseUntil === "string") || !isIsoString(updatedAt)) return null
  return { used, leaseUntil }
}

export function createPrismaChatQuotaStore(db: PrismaChatUsagePort): ChatQuotaStore {
  if (!isChatUsagePort(db)) throw new TypeError("cliente Prisma inválido")
  const model = db.aiChatUsage
  const keyOf = (userId: string, month: string): { userId_month: { userId: string; month: string } } => ({ userId_month: { userId, month } })
  return {
    async reserve(raw) {
      const req = parseReserve(raw)
      if (req === null) return fail("INVALID_ARGS")
      const { userId, month, limit, leaseId, now } = req
      const leaseUntil = addMs(now, CHAT_LEASE_MS)
      for (let round = 0; round < 2; round += 1) {
        const upd = await attempt(() => model.updateMany({
          where: { userId, month, used: { lt: limit }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
          data: { used: { increment: 1 }, leaseId, leaseUntil, updatedAt: now },
        }))
        const n = upd.ok ? countOf(upd.value) : null
        if (n === null) return fail("STORAGE_ERROR")
        if (n === 1) return { ok: true }
        if (n > 1) return fail("STORAGE_ERROR") // a PK garante no máximo 1 linha: outra coisa é corrupção
        const read = await attempt(() => model.findUnique({ where: keyOf(userId, month) }))
        if (!read.ok) return fail("STORAGE_ERROR")
        if (read.value === null || read.value === undefined) {
          if (round === 1) return fail("STORAGE_ERROR")
          const made = await attempt(() => model.create({ data: { userId, month, used: 1, leaseId, leaseUntil, updatedAt: now } }))
          if (made.ok) return { ok: true }
          if (!made.unique) return fail("STORAGE_ERROR")
          continue // perdeu a corrida da criação: tenta o updateMany uma vez
        }
        const row = parseRow(read.value, userId, month)
        if (row === null) return fail("STORAGE_ERROR")
        return row.used >= limit ? { ok: false, code: "QUOTA_EXCEEDED", used: row.used, limit } : { ok: false, code: "TURN_IN_PROGRESS" }
      }
      return fail("STORAGE_ERROR")
    },
    async settle(raw) {
      const req = parseSettle(raw)
      if (req === null) return fail("INVALID_ARGS")
      const { userId, month, leaseId, outcome, now } = req
      const r = await attempt(() => outcome === "REFUND"
        ? model.updateMany({ where: { userId, month, leaseId, used: { gt: 0 } }, data: { leaseId: null, leaseUntil: null, used: { decrement: 1 }, updatedAt: now } })
        : model.updateMany({ where: { userId, month, leaseId }, data: { leaseId: null, leaseUntil: null, updatedAt: now } }))
      const n = r.ok ? countOf(r.value) : null
      return n === null || n > 1 ? fail("STORAGE_ERROR") : { ok: true, applied: n === 1 }
    },
    async usage(raw) {
      const req = parseUsage(raw)
      if (req === null) return fail("INVALID_ARGS")
      const r = await attempt(() => model.findUnique({ where: keyOf(req.userId, req.month) }))
      if (!r.ok) return fail("STORAGE_ERROR")
      if (r.value === null || r.value === undefined) return { ok: true, used: 0 }
      const row = parseRow(r.value, req.userId, req.month)
      return row === null ? fail("STORAGE_ERROR") : { ok: true, used: row.used }
    },
    async deleteForUser(userId) {
      if (!isValidUserId(userId)) return fail("INVALID_ARGS")
      const r = await attempt(() => model.deleteMany({ where: { userId } }))
      const n = r.ok ? countOf(r.value) : null
      return n === null ? fail("STORAGE_ERROR") : { ok: true, deleted: n }
    },
  }
}
