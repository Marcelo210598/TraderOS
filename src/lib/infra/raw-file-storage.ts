// Armazenamento do arquivo BRUTO do usuário (E7-1; contrato e decisões em docs/ai-partner/E7-0-contrato-de-armazenamento.md). O artefato guardado é o texto UTF-8 EXATO que a pipeline recebeu: a chave é o
// `fileSha256` (SHA-256 desses bytes), conferido em `put` e em `get`. API tipada por RESULTADO: nenhum método rejeita nem lança; os erros são códigos fixos, sem mensagem, sem caminho e sem eco do valor.
// A chave `users/{userId}/imports/{sha}.csv` é montada SÓ aqui (nunca vem do chamador). Esta implementação é a de MEMÓRIA (testes); o disco está em raw-file-storage-disk.ts. Só ./hash.ts (o único que conhece node:crypto).
import { sha256Hex } from "./hash.ts"

/** Teto de um arquivo (≈ 135 mil trades de CSV). Acima ⇒ TOO_LARGE (fail-closed). */
export const MAX_RAW_FILE_BYTES = 25 * 1024 * 1024

export type RawFileErrorCode = "INVALID_ARGS" | "TOO_LARGE" | "HASH_MISMATCH" | "NOT_FOUND" | "CORRUPT" | "STORAGE_ERROR"
export interface RawFileFailure { readonly ok: false; readonly code: RawFileErrorCode }

export interface RawFileStorage {
  /** Idempotente por conteúdo (1ª vez `created:true`, repetida `created:false`); recusa se sha256(bytes) ≠ fileSha256; nunca sobrescreve com conteúdo diferente. */
  put(userId: string, fileSha256: string, bytes: Uint8Array): Promise<{ readonly ok: true; readonly created: boolean } | RawFileFailure>
  /** Ausente ⇒ NOT_FOUND; guardado mas com SHA-256 diferente ⇒ CORRUPT (nunca devolve os bytes ruins). Devolve uma CÓPIA. */
  get(userId: string, fileSha256: string): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | RawFileFailure>
  delete(userId: string, fileSha256: string): Promise<{ readonly ok: true; readonly existed: boolean } | RawFileFailure>
  /** Apaga TUDO do usuário; devolve quantos arquivos. Idempotente (0 se não há). */
  deleteAllForUser(userId: string): Promise<{ readonly ok: true; readonly deleted: number } | RawFileFailure>
}

const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const SHA256_RE = /^[0-9a-f]{64}$/
export const isValidUserId = (x: unknown): x is string => typeof x === "string" && USER_ID_RE.test(x)
export const isValidSha256 = (x: unknown): x is string => typeof x === "string" && SHA256_RE.test(x)
export const rawFileFailure = (code: RawFileErrorCode): RawFileFailure => ({ ok: false, code })

/** A chave do objeto; null se algum id é inválido (nunca monta caminho com entrada não validada). */
export function rawFileKey(userId: unknown, fileSha256: unknown): string | null {
  return isValidUserId(userId) && isValidSha256(fileSha256) ? `users/${userId}/imports/${fileSha256}.csv` : null
}

/** Valida os argumentos do `put` e devolve uma CÓPIA dos bytes (sem aliasing). Entrada hostil (Proxy/getter que lança) ⇒ INVALID_ARGS. */
export function checkPutArgs(userId: unknown, fileSha256: unknown, bytes: unknown): { readonly ok: true; readonly bytes: Uint8Array } | RawFileFailure {
  try {
    if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return rawFileFailure("INVALID_ARGS")
    if (!(bytes instanceof Uint8Array)) return rawFileFailure("INVALID_ARGS")
    const length = bytes.byteLength
    if (length === 0) return rawFileFailure("INVALID_ARGS")
    if (length > MAX_RAW_FILE_BYTES) return rawFileFailure("TOO_LARGE")
    const copy = new Uint8Array(bytes)
    if (sha256Hex(copy) !== fileSha256) return rawFileFailure("HASH_MISMATCH")
    return { ok: true, bytes: copy }
  } catch {
    return rawFileFailure("INVALID_ARGS")
  }
}

/** Implementação em MEMÓRIA (testes e desenvolvimento). */
export function createMemoryRawFileStorage(): RawFileStorage {
  const store = new Map<string, Uint8Array>()
  return {
    async put(userId, fileSha256, bytes) {
      try {
        const checked = checkPutArgs(userId, fileSha256, bytes)
        if (!checked.ok) return checked
        const key = rawFileKey(userId, fileSha256)
        if (key === null) return rawFileFailure("INVALID_ARGS")
        if (store.has(key)) return { ok: true, created: false }
        store.set(key, checked.bytes)
        return { ok: true, created: true }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async get(userId, fileSha256) {
      try {
        const key = rawFileKey(userId, fileSha256)
        if (key === null) return rawFileFailure("INVALID_ARGS")
        const found = store.get(key)
        if (found === undefined) return rawFileFailure("NOT_FOUND")
        return { ok: true, bytes: new Uint8Array(found) }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async delete(userId, fileSha256) {
      try {
        const key = rawFileKey(userId, fileSha256)
        if (key === null) return rawFileFailure("INVALID_ARGS")
        return { ok: true, existed: store.delete(key) }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async deleteAllForUser(userId) {
      try {
        if (!isValidUserId(userId)) return rawFileFailure("INVALID_ARGS")
        const prefix = `users/${userId}/` // a barra final evita que "abc" case com "abcd"
        let deleted = 0
        for (const key of [...store.keys()]) if (key.startsWith(prefix)) { store.delete(key); deleted++ }
        return { ok: true, deleted }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
  }
}
