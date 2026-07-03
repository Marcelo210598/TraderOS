import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { createRecurrentPaymentLink, isAsaasConfigured } from "@/lib/asaas"
import { PLAN_LABEL, priceFor, type PlanKey, type BillingCycle } from "@/lib/plans"

const schema = z.object({
  plan: z.enum(["TRADER", "PRO"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  if (!isAsaasConfigured()) {
    return NextResponse.json(
      { error: "Pagamento não configurado no servidor." },
      { status: 503 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Plano inválido" }, { status: 400 })
  }

  const plan = parsed.data.plan as PlanKey
  const cycle = parsed.data.cycle as BillingCycle
  const value = priceFor(plan, cycle)
  if (value === null) {
    return NextResponse.json(
      { error: "Combinação de plano/ciclo inválida" },
      { status: 400 }
    )
  }

  const userId = session.user.id
  const planLabel = PLAN_LABEL[plan]
  const cycleLabel = cycle === "YEARLY" ? "anual" : "mensal"

  try {
    const link = await createRecurrentPaymentLink({
      name: `MeuTrade ${planLabel} (${cycleLabel})`,
      value,
      cycle,
      description: `Assinatura MeuTrade ${planLabel}`,
      // Codifica userId|plano|ciclo — propaga pras cobranças e o webhook decodifica.
      externalReference: `${userId}|${plan}|${cycle}`,
    })

    // Guarda o link/intenção na Subscription (plano só sobe quando o webhook confirma o pagamento).
    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan: "FREE", // ainda FREE até pagar
        status: "TRIALING",
        billingCycle: cycle,
      },
      update: {
        billingCycle: cycle,
      },
    })

    return NextResponse.json({ url: link.url })
  } catch (err) {
    console.error("[asaas/checkout]", err)
    return NextResponse.json(
      { error: "Não foi possível iniciar o checkout. Tente de novo." },
      { status: 502 }
    )
  }
}
