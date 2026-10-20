// SaltStore sobre o Postgres via Prisma (E7-13): MESMA interface e mesma semântica do de memória/disco (DUPLICATE em chave repetida, NOT_FOUND, CONFLICT no CAS do replaceCipher, retire idempotente, linha ilegível ⇒ CorruptRow
// sem derrubar as outras), com o cliente INJETADO (ver prisma-port.ts). Tabela `ai_user_salts`, PK (userId, saltId); datas em TEXTO (ida e volta exata); ciphertext/nonce em bytea. A mesma régua de formato dos outros stores
// (`parseSaltRow`) vale na entrada E em tudo que volta do banco. Nada lança; erros são códigos fixos (violação de unicidade ⇒ DUPLICATE; qualquer outra falha ⇒ STORAGE_ERROR), sem mensagem, SQL, URL ou valor.
import { SALT_ID_RE } from "../domain/canonical.ts"
import type { Sealed } from "./cipher.ts"
import { attempt, countOf, isIsoString, isPrismaPort, isRecord, type PrismaPort } from "./prisma-port.ts"
import { isValidUserId } from "./raw-file-storage.ts"
import { parseSaltRow, saltStoreFailure, type SaltRow, type SaltStore, type StoredRow } from "./salt-store.ts"

const bytesOf = (x: unknown): unknown => (x instanceof Uint8Array ? new Uint8Array(x) : x)
const candidateOf = (raw: Record<string, unknown>): unknown => ({ userId: raw.userId, saltId: raw.saltId, status: raw.status, saltCheck: raw.saltCheck, ciphertext: bytesOf(raw.ciphertext), nonce: bytesOf(raw.nonce), keyVersion: raw.keyVersion, createdAt: raw.createdAt, retiredAt: raw.retiredAt })
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((v, i) => v === b[i])
/** Um `Sealed` válido? (usa a régua da linha, com uma linha-modelo só para conferir o formato). */
const sealedOk = (next: Sealed): boolean => parseSaltRow({ userId: "u", saltId: "s1", status: "ACTIVE", saltCheck: `slt_${"0".repeat(24)}`, ciphertext: next?.ciphertext, nonce: next?.nonce, keyVersion: next?.keyVersion, createdAt: "2026-01-01T00:00:00.000Z", retiredAt: null }) !== null

export function createPrismaSaltStore(db: PrismaPort): SaltStore {
  if (!isPrismaPort(db)) throw new TypeError("cliente Prisma inválido")
  const model = db.aiUserSalt
  const key = (userId: string, saltId: string): { userId_saltId: { userId: string; saltId: string } } => ({ userId_saltId: { userId, saltId } })
  return {
    async loadUser(userId) {
      if (!isValidUserId(userId)) return saltStoreFailure("INVALID_ARGS")
      const r = await attempt(() => model.findMany({ where: { userId } }))
      if (!r.ok || !Array.isArray(r.value)) return saltStoreFailure("STORAGE_ERROR")
      const rows: StoredRow[] = r.value.map((raw): StoredRow => {
        const parsed = isRecord(raw) ? parseSaltRow(candidateOf(raw)) : null
        if (parsed !== null && parsed.userId === userId) return parsed
        return { userId, saltId: isRecord(raw) && typeof raw.saltId === "string" && SALT_ID_RE.test(raw.saltId) ? raw.saltId : "invalid", corrupt: true }
      })
      rows.sort((a, b) => (a.saltId < b.saltId ? -1 : a.saltId > b.saltId ? 1 : 0))
      return { ok: true, rows }
    },
    async append(row) {
      const parsed = parseSaltRow(row)
      if (parsed === null) return saltStoreFailure("INVALID_ARGS")
      const r = await attempt(() => model.create({ data: { ...parsed } }))
      return r.ok ? { ok: true } : saltStoreFailure(r.unique ? "DUPLICATE" : "STORAGE_ERROR")
    },
    async retire(userId, saltId, retiredAt) {
      if (!isValidUserId(userId) || typeof saltId !== "string" || !SALT_ID_RE.test(saltId) || !isIsoString(retiredAt)) return saltStoreFailure("INVALID_ARGS")
      const found = await attempt(() => model.findUnique({ where: key(userId, saltId) }))
      if (!found.ok) return saltStoreFailure("STORAGE_ERROR")
      if (found.value === null) return saltStoreFailure("NOT_FOUND")
      if (!isRecord(found.value)) return saltStoreFailure("STORAGE_ERROR")
      if (found.value.status !== "ACTIVE") return { ok: true } // aposentada: idempotente, sem escrever
      const upd = await attempt(() => model.updateMany({ where: { userId, saltId, status: "ACTIVE" }, data: { status: "RETIRED", ciphertext: null, nonce: null, keyVersion: null, retiredAt } }))
      return upd.ok && countOf(upd.value) !== null ? { ok: true } : saltStoreFailure("STORAGE_ERROR") // 0 linhas: outro processo aposentou entre a leitura e a escrita — mesmo resultado
    },
    async replaceCipher(userId, saltId, expected, next) {
      if (!isValidUserId(userId) || typeof saltId !== "string" || !SALT_ID_RE.test(saltId) || !isRecord(expected) || !Number.isInteger(expected.keyVersion) || !(expected.nonce instanceof Uint8Array) || !sealedOk(next)) return saltStoreFailure("INVALID_ARGS")
      const found = await attempt(() => model.findUnique({ where: key(userId, saltId) }))
      if (!found.ok) return saltStoreFailure("STORAGE_ERROR")
      if (found.value === null) return saltStoreFailure("NOT_FOUND")
      if (!isRecord(found.value)) return saltStoreFailure("STORAGE_ERROR")
      const cur: SaltRow | null = parseSaltRow(candidateOf(found.value))
      if (cur === null || cur.status !== "ACTIVE" || cur.keyVersion !== expected.keyVersion || cur.nonce === null || !sameBytes(cur.nonce, expected.nonce)) return saltStoreFailure("CONFLICT")
      // o CAS de verdade é na escrita: só troca se a linha AINDA tem (keyVersion, nonce) esperados
      const upd = await attempt(() => model.updateMany({ where: { userId, saltId, status: "ACTIVE", keyVersion: expected.keyVersion, nonce: expected.nonce }, data: { ciphertext: next.ciphertext, nonce: next.nonce, keyVersion: next.keyVersion } }))
      const n = upd.ok ? countOf(upd.value) : null
      return n === null ? saltStoreFailure("STORAGE_ERROR") : n === 0 ? saltStoreFailure("CONFLICT") : { ok: true }
    },
    async listUsers() {
      const r = await attempt(() => model.findMany({ select: { userId: true }, distinct: ["userId"] }))
      if (!r.ok || !Array.isArray(r.value)) return saltStoreFailure("STORAGE_ERROR")
      const ids = new Set<string>()
      for (const row of r.value) if (isRecord(row) && isValidUserId(row.userId)) ids.add(row.userId)
      return { ok: true, userIds: [...ids].sort() }
    },
    async deleteAllForUser(userId) {
      if (!isValidUserId(userId)) return saltStoreFailure("INVALID_ARGS")
      const r = await attempt(() => model.deleteMany({ where: { userId } }))
      const n = r.ok ? countOf(r.value) : null
      return n === null ? saltStoreFailure("STORAGE_ERROR") : { ok: true, deleted: n }
    },
  }
}
