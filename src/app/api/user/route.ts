import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { cancelSubscription } from "@/lib/asaas"
import { notifyAdminsAccountDeleted } from "@/lib/admin"

// Exclusão de conta self-service (LGPD Art. 18, V/VI — direito à exclusão dos dados).
// Todas as tabelas com userId têm onDelete: Cascade a partir de User, então
// prisma.user.delete apaga trades, setups, check-ins, planos, notificações, API keys
// e a própria assinatura de uma vez. A ÚNICA coisa que não cai em cascata sozinha é a
// cobrança recorrente no Asaas — por isso cancelamos ela ANTES de apagar o usuário.
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      subscription: { select: { asaasSubscriptionId: true, status: true } },
    },
  })
  if (!user) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  const subId = user.subscription?.asaasSubscriptionId
  if (subId && user.subscription?.status === "ACTIVE") {
    try {
      await cancelSubscription(subId)
    } catch (err) {
      console.error("[DELETE /api/user] falha ao cancelar assinatura Asaas", err)
      return NextResponse.json(
        { error: "Não consegui cancelar sua assinatura ativa agora. Tente de novo em instantes ou fale com o suporte." },
        { status: 502 }
      )
    }
  }

  await prisma.user.delete({ where: { id: userId } })

  notifyAdminsAccountDeleted({ email: user.email, name: user.name }).catch(() => null)

  return NextResponse.json({ ok: true })
}
