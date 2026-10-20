// Ligação das rotas do AI Partner (E7-14): junta a sessão, o plano lido do BANCO, o limite de taxa e as dependências de produção. Nenhuma regra de negócio aqui (ela está em src/lib/infra/ai-partner-imports.ts).
import { auth } from "@/auth"
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
