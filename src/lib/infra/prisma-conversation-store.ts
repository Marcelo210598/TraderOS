// ConversationStore sobre o Postgres via Prisma (E7-13): o log de deltas (v1, v2, …) com a MESMA semântica do de memória/disco — create (DUPLICATE), load (lacuna ⇒ CORRUPT; delta ilegível ⇒ CorruptDelta só dele),
// commit com concorrência otimista (CONFLICT), delete e deleteAllForUser. Tabelas `ai_conversations` (PK userId+conversationId, coluna `version` = cabeça do log) e `ai_conversation_deltas` (PK userId+conversationId+version,
// FK ⇒ conversa com ON DELETE CASCADE). O corpo do delta é o MESMO JSON do arquivo em disco, como TEXTO (ida e volta exata), relido pela mesma régua (`parseStoredDelta`).
// COMMIT: numa transação, `updateMany where version = expected` (0 linhas ⇒ NOT_FOUND se a conversa não existe, senão CONFLICT) e o INSERT do delta; a violação da PK do delta é a 2ª linha de defesa (⇒ CONFLICT, e a transação
// inteira desfaz o avanço da versão). Cliente INJETADO (prisma-port.ts); nada lança; erros são códigos fixos, sem mensagem, SQL, URL ou valor.
import { checkCommitArgs, conversationStoreFailure, isId, parseMeta, parseStoredDelta, type ConversationMeta, type ConversationStore, type CorruptDelta, type StoredDelta } from "./conversation-store.ts"
import { attempt, countOf, isPrismaPort, isRecord, isUniqueViolation, type PrismaPort } from "./prisma-port.ts"

/** A corrida perdida dentro da transação (versão que mudou, ou PK do delta duplicada): desfaz tudo e vira CONFLICT. */
class CasLost extends Error {}

export function createPrismaConversationStore(db: PrismaPort): ConversationStore {
  if (!isPrismaPort(db)) throw new TypeError("cliente Prisma inválido")
  const key = (userId: string, conversationId: string): { userId_conversationId: { userId: string; conversationId: string } } => ({ userId_conversationId: { userId, conversationId } })
  return {
    async create(metaIn) {
      if (!isRecord(metaIn) || !isId(metaIn.userId) || !isId(metaIn.conversationId) || parseMeta(metaIn, metaIn.userId, metaIn.conversationId) === null) return conversationStoreFailure("INVALID_ARGS")
      const m = metaIn as unknown as ConversationMeta
      const r = await attempt(() => db.aiConversation.create({ data: { userId: m.userId, conversationId: m.conversationId, epoch: m.epoch, createdAt: m.createdAt, version: 0 } }))
      return r.ok ? { ok: true } : conversationStoreFailure(r.unique ? "DUPLICATE" : "STORAGE_ERROR")
    },
    async load(userId, conversationId) {
      if (!isId(userId) || !isId(conversationId)) return conversationStoreFailure("INVALID_ARGS")
      const conv = await attempt(() => db.aiConversation.findUnique({ where: key(userId, conversationId) }))
      if (!conv.ok) return conversationStoreFailure("STORAGE_ERROR")
      if (conv.value === null) return conversationStoreFailure("NOT_FOUND")
      if (!isRecord(conv.value)) return conversationStoreFailure("STORAGE_ERROR")
      const meta = parseMeta({ conversationId: conv.value.conversationId, createdAt: conv.value.createdAt, epoch: conv.value.epoch, userId: conv.value.userId }, userId, conversationId)
      const head = conv.value.version
      if (meta === null || typeof head !== "number" || !Number.isInteger(head) || head < 0) return conversationStoreFailure("CORRUPT")
      const rows = await attempt(() => db.aiConversationDelta.findMany({ where: { userId, conversationId }, orderBy: { version: "asc" } }))
      if (!rows.ok || !Array.isArray(rows.value)) return conversationStoreFailure("STORAGE_ERROR")
      const versions = rows.value.map((r) => (isRecord(r) ? r.version : undefined))
      if (versions.length !== head || versions.some((v, i) => v !== i + 1)) return conversationStoreFailure("CORRUPT") // lacuna no log, ou cabeça ≠ nº de deltas
      const deltas: Array<StoredDelta | CorruptDelta> = rows.value.map((r, i) => {
        const version = i + 1
        let parsed: StoredDelta | null = null
        try { parsed = isRecord(r) && typeof r.body === "string" ? parseStoredDelta(JSON.parse(r.body), version) : null } catch { parsed = null }
        return parsed ?? { version, corrupt: true }
      })
      return { ok: true, meta, deltas }
    },
    async commit(userId, conversationId, expectedVersion, delta, createdAt) {
      const checked = checkCommitArgs(userId, conversationId, expectedVersion, delta, createdAt)
      if ("ok" in checked) return checked
      const body = JSON.stringify({ alias: checked.delta.alias, createdAt, ...(checked.delta.messages !== undefined ? { messages: checked.delta.messages } : {}), rotateTo: checked.delta.rotateTo, specs: checked.delta.specs, version: expectedVersion + 1, writes: checked.delta.writes })
      const version = expectedVersion + 1
      const r = await attempt(() => db.$transaction(async (tx) => {
        const upd = countOf(await tx.aiConversation.updateMany({ where: { userId, conversationId, version: expectedVersion }, data: { version } }))
        if (upd === null) throw new Error("resposta inesperada") // vira STORAGE_ERROR (nunca sai a mensagem)
        if (upd === 0) return (await tx.aiConversation.findUnique({ where: key(userId, conversationId) })) === null ? ("NOT_FOUND" as const) : ("CONFLICT" as const)
        try { await tx.aiConversationDelta.create({ data: { userId, conversationId, version, body } }) } catch (e) { if (isUniqueViolation(e)) throw new CasLost(); throw e }
        return "OK" as const
      }))
      if (!r.ok) return conversationStoreFailure(r.error instanceof CasLost ? "CONFLICT" : "STORAGE_ERROR")
      return r.value === "OK" ? { ok: true, version } : r.value === "NOT_FOUND" || r.value === "CONFLICT" ? conversationStoreFailure(r.value) : conversationStoreFailure("STORAGE_ERROR")
    },
    async delete(userId, conversationId) {
      if (!isId(userId) || !isId(conversationId)) return conversationStoreFailure("INVALID_ARGS")
      const r = await attempt(() => db.aiConversation.deleteMany({ where: { userId, conversationId } })) // os deltas saem pelo ON DELETE CASCADE
      const n = r.ok ? countOf(r.value) : null
      return n === null ? conversationStoreFailure("STORAGE_ERROR") : { ok: true, existed: n > 0 }
    },
    async deleteAllForUser(userId) {
      if (!isId(userId)) return conversationStoreFailure("INVALID_ARGS")
      const r = await attempt(() => db.aiConversation.deleteMany({ where: { userId } }))
      const n = r.ok ? countOf(r.value) : null
      return n === null ? conversationStoreFailure("STORAGE_ERROR") : { ok: true, deleted: n }
    },
  }
}
