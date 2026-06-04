import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomBytes } from "crypto"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const trade = await prisma.trade.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!trade) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })

  // Reutiliza token existente ou gera novo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingToken = (trade as any).shareToken
  if (existingToken) {
    return NextResponse.json({ token: existingToken })
  }

  const token = randomBytes(12).toString("base64url")
  await prisma.trade.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { shareToken: token } as any,
  })

  return NextResponse.json({ token })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const trade = await prisma.trade.findFirst({ where: { id, userId: session.user.id } })
  if (!trade) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  await prisma.trade.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { shareToken: null } as any,
  })

  return NextResponse.json({ ok: true })
}
