// RawFileStorage sobre um ObjectStore, com GZIP (E7-10, D-O2…D-O6): é o caminho do R2/S3 (E7-11) sem acoplar o domínio a fornecedor e, de quebra, ~3–4× menos bytes guardados (CSV real do NT8 medido em 4,2×).
//   · chave `users/{userId}/imports/{sha}.csv.gz` montada SÓ aqui a partir de rawFileKey; o `fileSha256` segue sendo o dos bytes ORIGINAIS (conferido no put e DEPOIS do gunzip no get).
//   · gunzip com teto de 25 MiB na saída (defesa contra gzip bomb): acima ⇒ CORRUPT. Objeto ilegível, truncado ou com sha diferente ⇒ CORRUPT; nunca devolve bytes ruins nem apaga/sobrescreve o objeto.
//   · `put` = checkPutArgs → gzip → putIfAbsent; se o objeto já existia, ele é CONFERIDO (íntegro ⇒ created:false; corrompido ⇒ CORRUPT, sem consertar em silêncio).
//   · erro do provedor (rejeição, throw, forma inesperada, código desconhecido) ⇒ STORAGE_ERROR, sem mensagem/chave/eco. Nada lança.
// Limite declarado: a atomicidade do `putIfAbsent` depende do provedor real (a medir no E7-11); criptografia em repouso é a do provedor.
import { gunzipSync, gzipSync } from "node:zlib"
import { sha256Hex } from "./hash.ts"
import type { ObjectStore } from "./object-store.ts"
import { MAX_RAW_FILE_BYTES, checkPutArgs, isValidSha256, isValidUserId, rawFileFailure, rawFileKey, type RawFileFailure, type RawFileStorage } from "./raw-file-storage.ts"

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null
const objectKey = (userId: unknown, fileSha256: unknown): string | null => { const k = rawFileKey(userId, fileSha256); return k === null ? null : `${k}.gz` }

/** O que o provedor respondeu, validado: sucesso com a forma esperada, "NOT_FOUND" ou erro (qualquer outra coisa). */
type Reply<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "not_found" } | { readonly kind: "error" }
async function ask<T>(call: () => Promise<unknown>, valid: (r: Record<string, unknown>) => boolean): Promise<Reply<T>> {
  try {
    const r = await call()
    if (!isRecord(r)) return { kind: "error" }
    if (r.ok === false) return r.code === "NOT_FOUND" ? { kind: "not_found" } : { kind: "error" }
    return r.ok === true && valid(r) ? { kind: "ok", value: r as T } : { kind: "error" }
  } catch {
    return { kind: "error" }
  }
}

export function createObjectRawFileStorage(store: ObjectStore): RawFileStorage {
  if (!isRecord(store) || ["putIfAbsent", "get", "delete", "deleteByPrefix"].some((m) => typeof store[m] !== "function")) throw new TypeError("store inválido")

  /** Lê e confere um objeto: bytes ORIGINAIS íntegros, ou a falha tipada. */
  const readVerified = async (key: string, fileSha256: string): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | RawFileFailure> => {
    const got = await ask<{ bytes: Uint8Array }>(() => store.get(key), (r) => r.bytes instanceof Uint8Array)
    if (got.kind === "not_found") return rawFileFailure("NOT_FOUND")
    if (got.kind === "error") return rawFileFailure("STORAGE_ERROR")
    let original: Uint8Array
    try { original = new Uint8Array(gunzipSync(got.value.bytes, { maxOutputLength: MAX_RAW_FILE_BYTES })) } catch { return rawFileFailure("CORRUPT") }
    return original.byteLength > 0 && sha256Hex(original) === fileSha256 ? { ok: true, bytes: original } : rawFileFailure("CORRUPT")
  }

  return {
    async put(userId, fileSha256, bytes) {
      try {
        const checked = checkPutArgs(userId, fileSha256, bytes)
        if (!checked.ok) return checked
        const key = objectKey(userId, fileSha256)
        if (key === null) return rawFileFailure("INVALID_ARGS")
        const compressed = new Uint8Array(gzipSync(checked.bytes))
        const put = await ask<{ created: boolean }>(() => store.putIfAbsent(key, compressed), (r) => typeof r.created === "boolean")
        if (put.kind !== "ok") return rawFileFailure("STORAGE_ERROR")
        if (put.value.created) return { ok: true, created: true }
        const existing = await readVerified(key, fileSha256) // já havia um objeto: ele precisa estar íntegro
        return existing.ok ? { ok: true, created: false } : existing
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async get(userId, fileSha256) {
      try {
        const key = objectKey(userId, fileSha256)
        if (key === null || !isValidUserId(userId) || !isValidSha256(fileSha256)) return rawFileFailure("INVALID_ARGS")
        return await readVerified(key, fileSha256)
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async delete(userId, fileSha256) {
      try {
        const key = objectKey(userId, fileSha256)
        if (key === null) return rawFileFailure("INVALID_ARGS")
        const r = await ask<{ existed: boolean }>(() => store.delete(key), (x) => typeof x.existed === "boolean")
        return r.kind === "ok" ? { ok: true, existed: r.value.existed } : r.kind === "not_found" ? { ok: true, existed: false } : rawFileFailure("STORAGE_ERROR")
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async deleteAllForUser(userId) {
      try {
        if (!isValidUserId(userId)) return rawFileFailure("INVALID_ARGS")
        const r = await ask<{ deleted: number }>(() => store.deleteByPrefix(`users/${userId}/`), (x) => typeof x.deleted === "number" && Number.isInteger(x.deleted) && x.deleted >= 0) // a barra final: 'abc' não apaga 'abcd'
        return r.kind === "ok" ? { ok: true, deleted: r.value.deleted } : rawFileFailure("STORAGE_ERROR")
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
  }
}
