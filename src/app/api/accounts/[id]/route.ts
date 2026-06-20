import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  initialBalance: z.number().min(0).max(100_000_000).optional(),
  currency: z.enum(["USD", "BRL", "EUR"]).optional(),
})

// Edita uma conta da Carteira (nome, saldo inicial, moeda) — só do próprio usuário.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Garante que a conta é do usuário antes de editar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma as any).tradingAccount.updateMany({
    where: { id, userId: session.user.id },
    data: parsed.data,
  })
  if (updated.count === 0) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
