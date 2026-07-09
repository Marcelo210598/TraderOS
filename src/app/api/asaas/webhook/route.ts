import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { PlanKey } from "@/lib/plans"
import { sendCapiEvent } from "@/lib/fbcapi"
import { sendGa4Event } from "@/lib/ga4"

// ─── Webhook do Asaas ─────────────────────────────────────────────────────────
// Configurar no painel Asaas (Integrações → Webhooks):
//   URL: https://SEU_DOMINIO/api/asaas/webhook
//   Token de autenticação: o mesmo valor de ASAAS_WEBHOOK_TOKEN
// O Asaas manda esse token no header "asaas-access-token".
//
// Eventos tratados:
//   PAYMENT_CONFIRMED / PAYMENT_RECEIVED → sobe o plano (accessSource=PAID)
//   PAYMENT_OVERDUE / PAYMENT_DELETED / PAYMENT_REFUNDED → desce p/ FREE
//     (NUNCA rebaixa quem é accessSource=MANUAL — comunidade liberada na mão)

interface AsaasWebhookBody {
  event: string
  payment?: {
    id: string
    customer?: string
    subscription?: string
    value?: number
    externalReference?: string | null
    status?: string
  }
}

// externalReference = "userId|PLAN|CYCLE"
function decodeRef(ref?: string | null): {
  userId: string
  plan: PlanKey
  cycle: string
} | null {
  if (!ref) return null
  const [userId, plan, cycle] = ref.split("|")
  if (!userId || (plan !== "TRADER" && plan !== "PRO")) return null
  return { userId, plan: plan as PlanKey, cycle: cycle ?? "MONTHLY" }
}

const UPGRADE_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"])
const DOWNGRADE_EVENTS = new Set([
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
])

export async function POST(req: NextRequest) {
  // 1) Autenticação do webhook
  const token = req.headers.get("asaas-access-token")
  if (!process.env.ASAAS_WEBHOOK_TOKEN || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as AsaasWebhookBody | null
  if (!body?.event) {
    return NextResponse.json({ received: true })
  }

  const { event, payment } = body
  const ref = decodeRef(payment?.externalReference)

  try {
    if (UPGRADE_EVENTS.has(event) && ref && payment) {
      const now = new Date()
      const periodEnd = new Date(now)
      if (ref.cycle === "YEARLY") periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      else periodEnd.setMonth(periodEnd.getMonth() + 1)

      await prisma.$transaction([
        prisma.user.update({
          where: { id: ref.userId },
          data: { plan: ref.plan, accessSource: "PAID" },
        }),
        prisma.subscription.upsert({
          where: { userId: ref.userId },
          create: {
            userId: ref.userId,
            plan: ref.plan,
            status: "ACTIVE",
            billingCycle: ref.cycle,
            asaasCustomerId: payment.customer ?? null,
            asaasSubscriptionId: payment.subscription ?? null,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          update: {
            plan: ref.plan,
            status: "ACTIVE",
            billingCycle: ref.cycle,
            asaasCustomerId: payment.customer ?? undefined,
            asaasSubscriptionId: payment.subscription ?? undefined,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        }),
      ])
      console.log(`[asaas/webhook] ${event} → ${ref.userId} subiu p/ ${ref.plan}`)

      // Retargeting: venda REAL confirmada (Purchase) via Conversions API.
      // event_id = payment.id dedup com qualquer disparo do browser.
      const buyer = await prisma.user.findUnique({
        where: { id: ref.userId },
        select: { email: true },
      })
      sendCapiEvent({
        eventName: "Purchase",
        email: buyer?.email,
        value: payment.value,
        currency: "BRL",
        eventId: payment.id,
      }).catch(() => null)
      sendGa4Event({
        eventName: "purchase",
        userKey: ref.userId,
        value: payment.value,
        currency: "BRL",
        transactionId: payment.id,
      }).catch(() => null)
    } else if (DOWNGRADE_EVENTS.has(event) && ref) {
      const user = await prisma.user.findUnique({
        where: { id: ref.userId },
        select: { accessSource: true },
      })
      // Nunca rebaixa acesso manual (comunidade)
      if (user && user.accessSource !== "MANUAL") {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: ref.userId },
            data: { plan: "FREE" },
          }),
          prisma.subscription.updateMany({
            where: { userId: ref.userId },
            data: { status: "PAST_DUE", plan: "FREE" },
          }),
        ])
        console.log(`[asaas/webhook] ${event} → ${ref.userId} rebaixado p/ FREE`)
      }
    }
  } catch (err) {
    // Loga mas devolve 200 — senão o Asaas reenfileira e pode pausar a fila.
    console.error("[asaas/webhook] erro processando", event, err)
  }

  return NextResponse.json({ received: true })
}
