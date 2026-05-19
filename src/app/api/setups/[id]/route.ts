import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const updateSetupSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().optional().nullable(),
  rules: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const setup = await prisma.setup.findFirst({ where: { id, userId: session.user.id } })
  if (!setup) return NextResponse.json({ error: "Setup não encontrado" }, { status: 404 })

  const body = await req.json()
  const parsed = updateSetupSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.setup.update({ where: { id }, data: parsed.data })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const setup = await prisma.setup.findFirst({ where: { id, userId: session.user.id } })
  if (!setup) return NextResponse.json({ error: "Setup não encontrado" }, { status: 404 })

  // Soft delete
  await prisma.setup.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
