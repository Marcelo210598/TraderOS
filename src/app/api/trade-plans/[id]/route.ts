import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const plan = await prisma.tradePlan.findUnique({ where: { id } })
  if (!plan || plan.userId !== session.user.id) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const allowedFields = ["executed", "notes", "maxLoss", "profitTarget", "setupsPlanned"]
  const data: Record<string, unknown> = {}
  for (const key of allowedFields) {
    if (key in body) data[key] = body[key]
  }

  const updated = await prisma.tradePlan.update({
    where: { id },
    data,
  })

  return NextResponse.json({
    ...updated,
    maxLoss: Number(updated.maxLoss),
    profitTarget: Number(updated.profitTarget),
    date: updated.date.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const plan = await prisma.tradePlan.findUnique({ where: { id } })
  if (!plan || plan.userId !== session.user.id) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  await prisma.tradePlan.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
