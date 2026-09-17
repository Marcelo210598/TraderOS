import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomBytes } from "crypto"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params

  // includeAnalysis é opcional — por padrão o link público NÃO expõe notas
  // pessoais nem a análise da Vega (só dado objetivo do trade). O dono decide
  // ativar por link, não é um ajuste global de conta.
  const body = await req.json().catch(() => ({}))
  const includeAnalysis = body?.includeAnalysis === true

  const owned = await prisma.trade.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, shareToken: true },
  })
  if (!owned) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })

  if (owned.shareToken) {
    await prisma.trade.update({
      where: { id },
      data: { shareIncludeAnalysis: includeAnalysis },
    })
    return NextResponse.json({ token: owned.shareToken, includeAnalysis })
  }

  const token = randomBytes(12).toString("base64url")
  await prisma.trade.update({
    where: { id },
    data: { shareToken: token, shareIncludeAnalysis: includeAnalysis },
  })

  return NextResponse.json({ token, includeAnalysis })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const owned = await prisma.trade.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  await prisma.trade.update({ where: { id }, data: { shareToken: null } })
  return NextResponse.json({ ok: true })
}
