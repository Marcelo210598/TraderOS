import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  initialBalance: z.number().min(0).max(100_000_000).optional(),
  currency: z.enum(["USD", "BRL", "EUR"]).optional(),
  isArchived: z.boolean().optional(),
  // Tipo da conta (TEST | EVAL | PA | PA25K...). Ao mudar, reclassifica também
  // os trades da conta, pra Carteira e Journal ficarem consistentes.
  label: z.string().min(1).max(20).optional(),
})

// Edita uma conta da Carteira (nome, saldo inicial, moeda, tipo) — só do próprio usuário.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  const userId = session.user.id

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { label, ...accountData } = parsed.data
  // O que vai pra TradingAccount (inclui label, se veio)
  const accountUpdate = label != null ? { ...accountData, label } : accountData

  // Garante que a conta é do usuário antes de editar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma as any).tradingAccount.updateMany({
    where: { id, userId },
    data: accountUpdate,
  })
  if (updated.count === 0) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  // Se o tipo mudou, propaga pros trades da conta (accountLabel espelha o tipo)
  if (label != null) {
    await prisma.trade.updateMany({
      where: { accountId: id, userId },
      data: { accountLabel: label },
    })
  }

  return NextResponse.json({ ok: true })
}
