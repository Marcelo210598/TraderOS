// Ligação das rotas do AI Partner (E7-14): junta a sessão, o plano lido do BANCO, o limite de taxa e as dependências de produção. Nenhuma regra de negócio aqui (ela está em src/lib/infra/ai-partner-imports.ts).
import { randomUUID } from "node:crypto"
import { auth } from "@/auth"
import { CHAT_USER_PER_MIN, GROQ_GLOBAL_TURNS_PER_MIN, type AiPartnerChatCtx } from "@/lib/infra/ai-partner-chat"
import { buildAiPartnerChatDeps } from "@/lib/infra/ai-partner-chat-deps"
import { isAiPartnerUserAllowed } from "@/lib/ai-partner-ui/guards"
import { buildAiPartnerDeps } from "@/lib/infra/ai-partner-deps"
import type { AiPartnerCtx, AiPartnerDeps } from "@/lib/infra/ai-partner-imports"
import { prisma } from "@/lib/prisma"
import { hit } from "@/lib/rate-limit"
// Montado uma vez por instância; faltando R2_* ou SALT_MASTER_KEY fica null ⇒ a rota responde 503 NOT_CONFIGURED (feature apagada).
let cached: AiPartnerDeps | null | undefined
const depsOnce = (): AiPartnerDeps | null => {
  if (cached === undefined) { const r = buildAiPartnerDeps(process.env, prisma); cached = r.ok ? r.deps : null }
  return cached
}

export async function aiPartnerCtx(): Promise<AiPartnerCtx> {
  const session = await auth()
  return {
    userId: session?.user?.id ?? null,
    deps: depsOnce(),
    getPlan: async (id) => (await prisma.user.findUnique({ where: { id }, select: { plan: true } }))?.plan ?? null, // do BANCO a cada pedido (o JWT só renova a cada 1 h)
    rateLimit: (id) => hit(`ai-partner-import:${id}`, 10, 60),
  }
}

// Chat (E7-15c): montado uma vez por instância; faltando R2_*, SALT_MASTER_KEY ou GROQ_API_KEY a rota responde 503 NOT_CONFIGURED. O plano vem do BANCO; o limite por usuário e a guarda global da Groq usam o mesmo limitador.
let cachedChat: ReturnType<typeof buildAiPartnerChatDeps> | undefined
export async function aiPartnerChatCtx(): Promise<AiPartnerChatCtx> {
  const session = await auth()
  if (cachedChat === undefined) cachedChat = buildAiPartnerChatDeps(process.env, prisma)
  const built = cachedChat
  return {
    userId: session?.user?.id ?? null,
    deps: built.ok && isAiPartnerUserAllowed(process.env, session?.user?.email) ? built.deps : null, // E7-18: fora da lista de e-mails ⇒ 503 NOT_CONFIGURED (feature "apagada")
    getPlan: async (id) => (await prisma.user.findUnique({ where: { id }, select: { plan: true } }))?.plan ?? null,
    rateLimit: (id) => hit(`ai-partner-chat:${id}`, CHAT_USER_PER_MIN, 60),
    globalGuard: () => hit("ai-partner-chat-global", GROQ_GLOBAL_TURNS_PER_MIN, 60),
    makeModel: (deadlineAt) => { if (!built.ok) throw new Error("chat não configurado"); return built.makeModel(deadlineAt) },
    clock: { iso: () => new Date().toISOString(), ms: () => Date.now() },
    newLeaseId: () => randomUUID(),
  }
}
