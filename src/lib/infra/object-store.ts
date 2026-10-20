// Porta de ARMAZENAMENTO DE OBJETOS (E7-10, D-O1): a menor superfície que o RawFileStorage precisa de um provedor S3-compatível (R2). Quem implementa o provedor de verdade (E7-11) só traduz estas 4 operações;
// o domínio nunca conhece SDK nem fornecedor. API tipada por RESULTADO: nenhum método rejeita nem lança; erros são códigos fixos, sem mensagem, sem chave e sem eco.
//   · `putIfAbsent`: grava SÓ se a chave não existe (`created:false` se já existia; nunca sobrescreve);  · `deleteByPrefix`: apaga todos os objetos cuja chave começa com o prefixo.
// Esta é a implementação em MEMÓRIA (testes e desenvolvimento), com `keys()` extra só para inspeção. Sem imports.
export type ObjectStoreCode = "INVALID_ARGS" | "NOT_FOUND" | "STORAGE_ERROR"
export interface ObjectStoreFailure { readonly ok: false; readonly code: ObjectStoreCode }

export interface ObjectStore {
  putIfAbsent(key: string, bytes: Uint8Array): Promise<{ readonly ok: true; readonly created: boolean } | ObjectStoreFailure>
  get(key: string): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | ObjectStoreFailure>
  delete(key: string): Promise<{ readonly ok: true; readonly existed: boolean } | ObjectStoreFailure>
  deleteByPrefix(prefix: string): Promise<{ readonly ok: true; readonly deleted: number } | ObjectStoreFailure>
}

const fail = (code: ObjectStoreCode): ObjectStoreFailure => ({ ok: false, code })
const isKey = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 1024

export function createMemoryObjectStore(): ObjectStore & { keys(): string[] } {
  const objects = new Map<string, Uint8Array>()
  return {
    async putIfAbsent(key, bytes) {
      if (!isKey(key) || !(bytes instanceof Uint8Array)) return fail("INVALID_ARGS")
      if (objects.has(key)) return { ok: true, created: false }
      objects.set(key, new Uint8Array(bytes))
      return { ok: true, created: true }
    },
    async get(key) {
      if (!isKey(key)) return fail("INVALID_ARGS")
      const found = objects.get(key)
      return found === undefined ? fail("NOT_FOUND") : { ok: true, bytes: new Uint8Array(found) }
    },
    async delete(key) {
      if (!isKey(key)) return fail("INVALID_ARGS")
      return { ok: true, existed: objects.delete(key) }
    },
    async deleteByPrefix(prefix) {
      if (!isKey(prefix)) return fail("INVALID_ARGS")
      let deleted = 0
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) { objects.delete(key); deleted += 1 }
      return { ok: true, deleted }
    },
    keys: () => [...objects.keys()],
  }
}
