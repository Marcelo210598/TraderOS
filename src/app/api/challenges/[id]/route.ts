import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const existing = await (prisma as any).challenge.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  await (prisma as any).challenge.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const existing = await (prisma as any).challenge.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  const updated = await (prisma as any).challenge.update({
    where: { id },
    data: {
      isActive: body.isActive !== undefined ? body.isActive : existing.isActive,
      updatedAt: new Date(),
    },
  })

  return NextResponse.json({ challenge: updated })
}
