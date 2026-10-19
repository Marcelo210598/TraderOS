// Exclusão em cascata / LGPD Art. 18 (E7-7, D-LGPD-1…10): o coordenador que apaga os dados de um usuário nos stores da infra. Operação TERMINAL e IRREVERSÍVEL (hard delete); uma carência, se o produto quiser,
// é da camada de produto/conta, que simplesmente espera antes de chamar. O BLOQUEIO de escrita da conta durante o expurgo também NÃO é daqui (D-LGPD-6): os stores não trancam, e registerImport/ensure recriariam dados.
//   · `purgeUserData`: arquivos brutos → metadados de import → conversas → sais → cache. PARA no primeiro erro (o sal NUNCA é destruído se uma etapa anterior falhou) e é repetível até zerar.
//   · `deleteImportFile`: arquivo bruto PRIMEIRO, linha depois (um arquivo órfão com dado pessoal é pior que uma linha apontando para arquivo ausente, que já falha limpo com FILE_NOT_AVAILABLE).
//   · `deleteConversation`: só a conversa; os arquivos e os sais do usuário seguem.
//   · Quando algo foi de fato apagado, o cache do usuário também é purgado (D-LGPD-9): não dá para saber quais bundles derivam do arquivo/da conversa.
// IMPORTANTE (limites): backups/snapshots/versões em nuvem NÃO são cobertos; o cache é por processo; `rm` não é apagamento físico em SSD. O CSV bruto é TEXTO PURO: apagar o sal NÃO o torna irrecuperável — o arquivo é apagado de verdade.
// Erros são resultados tipados com código fixo e `failedStore`; nada lança, nada ecoa o userId, caminho, nome de arquivo ou mensagem.
import type { BundleCache } from "./bundle-cache.ts"
import type { ConversationStore } from "./conversation-store.ts"
import type { ImportSourceStore } from "./import-source-store.ts"
import { isValidSha256, isValidUserId, type RawFileStorage } from "./raw-file-storage.ts"
import type { SaltStore } from "./salt-store.ts"

export interface PurgeDeps {
  readonly rawStorage: RawFileStorage
  readonly importStore: ImportSourceStore
  readonly conversationStore: ConversationStore
  readonly saltStore: SaltStore
  /** Opcional: sem cache, `cacheEntries` é 0. */
  readonly cache?: BundleCache
}
export type PurgeStore = "rawFiles" | "importSources" | "conversations" | "salts"
export type PurgeFailure = {
  readonly ok: false
  readonly code: "INVALID_ARGS" | "STORAGE_ERROR"
  /** Qual etapa falhou (null quando o pedido nem começou). */
  readonly failedStore: PurgeStore | null
  /** O que as etapas ANTERIORES já apagaram. */
  readonly done: Readonly<Record<string, number | boolean>>
}
const invalid: PurgeFailure = Object.freeze({ ok: false, code: "INVALID_ARGS", failedStore: null, done: Object.freeze({}) })
const storeFail = (failedStore: PurgeStore, done: Record<string, number | boolean>): PurgeFailure => ({ ok: false, code: "STORAGE_ERROR", failedStore, done })

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const hasFns = (o: unknown, names: readonly string[]): boolean => isRecord(o) && names.every((n) => typeof o[n] === "function")
const cacheOk = (c: unknown): boolean => c === undefined || hasFns(c, ["purgeUser"])
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const onlyKeys = (x: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k))

/** Roda uma etapa de um store: devolve o valor se `ok`, ou null se devolveu falha OU lançou. */
async function step<T extends { readonly ok: boolean }>(run: () => Promise<T>): Promise<Extract<T, { ok: true }> | null> {
  try {
    const r = await run()
    return r.ok ? (r as Extract<T, { ok: true }>) : null
  } catch {
    return null
  }
}
const purgeCache = (cache: BundleCache | undefined, userId: string): number => {
  try { return cache === undefined ? 0 : cache.purgeUser(userId) } catch { return 0 }
}

export interface PurgeReport {
  readonly ok: true
  readonly purged: { readonly rawFiles: number; readonly importSources: number; readonly conversations: number; readonly salts: boolean; readonly cacheEntries: number }
}

export async function purgeUserData(deps: PurgeDeps, req: { readonly userId: string }): Promise<PurgeReport | PurgeFailure> {
  try {
    if (!isRecord(deps) || !hasFns(deps.rawStorage, ["deleteAllForUser"]) || !hasFns(deps.importStore, ["deleteAllForUser"]) || !hasFns(deps.conversationStore, ["deleteAllForUser"]) || !hasFns(deps.saltStore, ["deleteAllForUser"]) || !cacheOk(deps.cache)) return invalid
    if (!isRecord(req) || !onlyKeys(req, ["userId"]) || !isValidUserId(req.userId)) return invalid
    const userId = req.userId
    const raw = await step(() => deps.rawStorage.deleteAllForUser(userId))
    if (raw === null) return storeFail("rawFiles", {})
    const imports = await step(() => deps.importStore.deleteAllForUser(userId))
    if (imports === null) return storeFail("importSources", { rawFiles: raw.deleted })
    const conversations = await step(() => deps.conversationStore.deleteAllForUser(userId))
    if (conversations === null) return storeFail("conversations", { rawFiles: raw.deleted, importSources: imports.deleted })
    const salts = await step(() => deps.saltStore.deleteAllForUser(userId)) // por ÚLTIMO: se algo antes falhou, o sal fica e a reexecução é possível
    if (salts === null) return storeFail("salts", { rawFiles: raw.deleted, importSources: imports.deleted, conversations: conversations.deleted })
    const cacheEntries = purgeCache(deps.cache, userId)
    return { ok: true, purged: { rawFiles: raw.deleted, importSources: imports.deleted, conversations: conversations.deleted, salts: salts.deleted > 0, cacheEntries } }
  } catch {
    return invalid
  }
}

export interface DeleteImportFileReport { readonly ok: true; readonly rawFile: boolean; readonly importSource: boolean; readonly cacheEntries: number }

export async function deleteImportFile(deps: PurgeDeps, req: { readonly userId: string; readonly fileSha256: string }): Promise<DeleteImportFileReport | PurgeFailure> {
  try {
    if (!isRecord(deps) || !hasFns(deps.rawStorage, ["delete"]) || !hasFns(deps.importStore, ["delete"]) || !cacheOk(deps.cache)) return invalid
    if (!isRecord(req) || !onlyKeys(req, ["userId", "fileSha256"]) || !isValidUserId(req.userId) || !isValidSha256(req.fileSha256)) return invalid
    const { userId, fileSha256 } = req
    const raw = await step(() => deps.rawStorage.delete(userId, fileSha256)) // 1º o arquivo (D-LGPD-7)
    if (raw === null) return storeFail("rawFiles", {})
    const row = await step(() => deps.importStore.delete(userId, fileSha256)) // 2º a linha
    if (row === null) return storeFail("importSources", { rawFile: raw.existed })
    const cacheEntries = raw.existed || row.existed ? purgeCache(deps.cache, userId) : 0
    return { ok: true, rawFile: raw.existed, importSource: row.existed, cacheEntries }
  } catch {
    return invalid
  }
}

export interface DeleteConversationReport { readonly ok: true; readonly existed: boolean; readonly cacheEntries: number }

export async function deleteConversation(deps: PurgeDeps, req: { readonly userId: string; readonly conversationId: string }): Promise<DeleteConversationReport | PurgeFailure> {
  try {
    if (!isRecord(deps) || !hasFns(deps.conversationStore, ["delete"]) || !cacheOk(deps.cache)) return invalid
    if (!isRecord(req) || !onlyKeys(req, ["userId", "conversationId"]) || !isValidUserId(req.userId) || typeof req.conversationId !== "string" || !CONVERSATION_ID_RE.test(req.conversationId)) return invalid
    const { userId, conversationId } = req
    const gone = await step(() => deps.conversationStore.delete(userId, conversationId))
    if (gone === null) return storeFail("conversations", {})
    return { ok: true, existed: gone.existed, cacheEntries: gone.existed ? purgeCache(deps.cache, userId) : 0 }
  } catch {
    return invalid
  }
}
