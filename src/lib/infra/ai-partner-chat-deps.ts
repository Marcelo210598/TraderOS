// Montador das dependências de PRODUÇÃO do chat do AI Partner (E7-15c, D-G8): as do upload (R2, sais, importações) + conversas e cota no Postgres + o modelo (Groq). Tudo a partir do ambiente PASSADO (nunca lê
// process.env) e do cliente Prisma INJETADO. Faltou ou veio inválido QUALQUER peça (R2_*, SALT_MASTER_KEY, GROQ_API_KEY, GROQ_MODEL, tabela de uso) ⇒ `NOT_CONFIGURED`: a rota fica apagada (503). Nunca lança, nunca ecoa valor.
import type { AiPartnerChatDeps } from "./ai-partner-chat.ts"
import { buildAiPartnerDeps } from "./ai-partner-deps.ts"
import { createGroqModelPort, type GroqFetch } from "./groq-client.ts"
import { createConversations } from "./conversation-store.ts"
import { createPrismaChatQuotaStore, isChatUsagePort } from "./prisma-chat-quota-store.ts"
import { createPrismaConversationStore } from "./prisma-conversation-store.ts"
import { isRecord } from "./prisma-port.ts"
import type { ModelPort } from "./chat-turn.ts"
import type { R2FetchLike } from "./object-store-r2.ts"

export type AiPartnerChatDepsResult =
  | { readonly ok: true; readonly deps: AiPartnerChatDeps; readonly makeModel: (deadlineAt: number) => ModelPort }
  | { readonly ok: false; readonly code: "NOT_CONFIGURED" }
const NOT_CONFIGURED: AiPartnerChatDepsResult = Object.freeze({ ok: false, code: "NOT_CONFIGURED" })

export function buildAiPartnerChatDeps(env: unknown, prisma: unknown, options: { readonly fetch?: GroqFetch & R2FetchLike } = {}): AiPartnerChatDepsResult {
  try {
    if (!isRecord(env) || !isChatUsagePort(prisma)) return NOT_CONFIGURED
    const base = buildAiPartnerDeps(env, prisma, options.fetch !== undefined ? { fetch: options.fetch as R2FetchLike } : {})
    if (!base.ok) return NOT_CONFIGURED
    const apiKey = env.GROQ_API_KEY, model = env.GROQ_MODEL
    if (typeof apiKey !== "string") return NOT_CONFIGURED
    const groqFetch: GroqFetch = options.fetch ?? ((url, init) => fetch(url, init) as never)
    // valida a chave/modelo agora (o cliente lança TypeError em configuração inválida): o prazo é do turno e entra em `makeModel`
    createGroqModelPort({ apiKey, ...(typeof model === "string" ? { model } : {}), fetch: groqFetch, now: () => 0, deadlineAt: 1 })
    if (model !== undefined && typeof model !== "string") return NOT_CONFIGURED
    const conversations = createConversations({ store: createPrismaConversationStore(prisma as never) })
    const deps: AiPartnerChatDeps = { rawStorage: base.deps.rawStorage, importStore: base.deps.importStore, salts: base.deps.salts, conversations, quota: createPrismaChatQuotaStore(prisma), ...(base.deps.cache !== undefined ? { cache: base.deps.cache } : {}) }
    const makeModel = (deadlineAt: number): ModelPort => createGroqModelPort({ apiKey, ...(typeof model === "string" ? { model } : {}), fetch: groqFetch, now: () => Date.now(), deadlineAt })
    return { ok: true, deps, makeModel }
  } catch {
    return NOT_CONFIGURED
  }
}
