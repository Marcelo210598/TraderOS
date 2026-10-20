// Montador das dependências de PRODUÇÃO do AI Partner (E7-14, D-F10): arquivo bruto no R2 (com gzip), metadados e sais no Postgres via Prisma, sal cifrado com a chave mestra. Tudo a partir do ambiente PASSADO (este módulo
// nunca lê process.env) e do cliente Prisma INJETADO. Faltou ou veio inválido QUALQUER peça (R2_*, SALT_MASTER_KEY, cliente) ⇒ `NOT_CONFIGURED`: a rota fica apagada (503) em vez de quebrar. Nunca lança e nunca ecoa valor.
import type { AiPartnerDeps } from "./ai-partner-imports.ts"
import { createSaltCipher } from "./cipher.ts"
import { createR2ObjectStore, loadR2Config, type R2FetchLike } from "./object-store-r2.ts"
import { createPrismaImportSourceStore } from "./prisma-import-source-store.ts"
import { isPrismaPort, isRecord } from "./prisma-port.ts"
import { createPrismaSaltStore } from "./prisma-salt-store.ts"
import { createObjectRawFileStorage } from "./raw-file-storage-object.ts"
import { createPersistentSalts } from "./salt-store.ts"

export type AiPartnerDepsResult = { readonly ok: true; readonly deps: AiPartnerDeps } | { readonly ok: false; readonly code: "NOT_CONFIGURED" }
const NOT_CONFIGURED: AiPartnerDepsResult = Object.freeze({ ok: false, code: "NOT_CONFIGURED" })

export function buildAiPartnerDeps(env: unknown, prisma: unknown, options: { readonly fetch?: R2FetchLike } = {}): AiPartnerDepsResult {
  try {
    if (!isRecord(env) || !isPrismaPort(prisma)) return NOT_CONFIGURED
    const r2 = loadR2Config(env); if (!r2.ok) return NOT_CONFIGURED
    const cipher = createSaltCipher(env as Readonly<Record<string, string | undefined>>); if (!cipher.ok) return NOT_CONFIGURED
    const rawStorage = createObjectRawFileStorage(createR2ObjectStore(r2.config, options.fetch !== undefined ? { fetch: options.fetch } : {}))
    const importStore = createPrismaImportSourceStore(prisma)
    const salts = createPersistentSalts({ store: createPrismaSaltStore(prisma), cipher: cipher.cipher })
    return { ok: true, deps: { rawStorage, importStore, salts } }
  } catch {
    return NOT_CONFIGURED
  }
}
