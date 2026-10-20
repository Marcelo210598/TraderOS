// ImportSourceStore sobre o Postgres via Prisma (E7-13): MESMA interface e semântica do de memória/disco (put idempotente por conteúdo, CONFLICT em conteúdo diferente, linha ilegível ⇒ CORRUPT/`corrupt` sem derrubar as outras,
// list ordenada por sha). Tabela `ai_import_sources`, PK (userId, fileSha256); o `context` vai como TEXTO JSON e as datas como TEXTO (ida e volta exata, a mesma comparação de idempotência dos outros stores).
// `parseImportSourceRow` (a régua dos outros stores) vale na entrada E em tudo que volta do banco. Cliente INJETADO (prisma-port.ts); nada lança; erros são códigos fixos, sem mensagem, SQL, URL ou valor.
import { importSourceFailure, parseImportSourceRow, type ImportSourceRow, type ImportSourceStore } from "./import-source-store.ts"
import { attempt, countOf, isPrismaPort, isRecord, type PrismaPort } from "./prisma-port.ts"
import { isValidSha256, isValidUserId } from "./raw-file-storage.ts"

const withoutCreatedAt = (r: ImportSourceRow): string => JSON.stringify({ ...r, createdAt: null })
/** A linha como o banco a devolve ⇒ a linha do store (ou null se ilegível). */
function fromDb(raw: unknown): ImportSourceRow | null {
  try {
    if (!isRecord(raw) || typeof raw.context !== "string") return null
    return parseImportSourceRow({ userId: raw.userId, fileSha256: raw.fileSha256, importId: raw.importId, fileName: raw.fileName, fileBytes: raw.fileBytes, hasBom: raw.hasBom, lineEnding: raw.lineEnding, hashBasis: raw.hashBasis, context: JSON.parse(raw.context), createdAt: raw.createdAt })
  } catch {
    return null
  }
}

export function createPrismaImportSourceStore(db: PrismaPort): ImportSourceStore {
  if (!isPrismaPort(db)) throw new TypeError("cliente Prisma inválido")
  const model = db.aiImportSource
  const key = (userId: string, fileSha256: string): { userId_fileSha256: { userId: string; fileSha256: string } } => ({ userId_fileSha256: { userId, fileSha256 } })
  return {
    async put(input) {
      const row = parseImportSourceRow(input)
      if (row === null) return importSourceFailure("INVALID_ARGS")
      const created = await attempt(() => model.create({ data: { ...row, context: JSON.stringify(row.context) } }))
      if (created.ok) return { ok: true, created: true }
      if (!created.unique) return importSourceFailure("STORAGE_ERROR")
      const have = await attempt(() => model.findUnique({ where: key(row.userId, row.fileSha256) })) // já existe: mesmo conteúdo ⇒ idempotente; senão CONFLICT (nunca sobrescreve)
      if (!have.ok || have.value === null || !isRecord(have.value)) return importSourceFailure("STORAGE_ERROR")
      const existing = fromDb(have.value)
      if (existing === null) return importSourceFailure("CORRUPT")
      return withoutCreatedAt(existing) === withoutCreatedAt(row) ? { ok: true, created: false } : importSourceFailure("CONFLICT")
    },
    async get(userId, fileSha256) {
      if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return importSourceFailure("INVALID_ARGS")
      const r = await attempt(() => model.findUnique({ where: key(userId, fileSha256) }))
      if (!r.ok) return importSourceFailure("STORAGE_ERROR")
      if (r.value === null) return importSourceFailure("NOT_FOUND")
      if (!isRecord(r.value)) return importSourceFailure("STORAGE_ERROR")
      const row = fromDb(r.value)
      return row !== null && row.userId === userId && row.fileSha256 === fileSha256 ? { ok: true, row } : importSourceFailure("CORRUPT")
    },
    async delete(userId, fileSha256) {
      if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return importSourceFailure("INVALID_ARGS")
      const r = await attempt(() => model.deleteMany({ where: { userId, fileSha256 } }))
      const n = r.ok ? countOf(r.value) : null
      return n === null ? importSourceFailure("STORAGE_ERROR") : { ok: true, existed: n > 0 }
    },
    async deleteAllForUser(userId) {
      if (!isValidUserId(userId)) return importSourceFailure("INVALID_ARGS")
      const r = await attempt(() => model.deleteMany({ where: { userId } }))
      const n = r.ok ? countOf(r.value) : null
      return n === null ? importSourceFailure("STORAGE_ERROR") : { ok: true, deleted: n }
    },
    async list(userId) {
      if (!isValidUserId(userId)) return importSourceFailure("INVALID_ARGS")
      const r = await attempt(() => model.findMany({ where: { userId } }))
      if (!r.ok || !Array.isArray(r.value)) return importSourceFailure("STORAGE_ERROR")
      const rows: ImportSourceRow[] = []
      let corrupt = 0
      for (const raw of r.value) { const row = fromDb(raw); if (row !== null && row.userId === userId) rows.push(row); else corrupt += 1 }
      rows.sort((a, b) => (a.fileSha256 < b.fileSha256 ? -1 : 1))
      return { ok: true, rows, corrupt }
    },
  }
}
