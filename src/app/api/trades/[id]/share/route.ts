import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomBytes } from "crypto"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params

  // Verifica ownership via SQL raw (evita problema de Prisma client desatualizado)
  const owned = await prisma.$queryRaw<{ id: string; share_token: string | null }[]>`
    SELECT id, share_token FROM trades WHERE id = ${id} AND user_id = ${session.user.id} LIMIT 1
  `
  if (owned.length === 0) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })

  const existing = owned[0].share_token
  if (existing) return NextResponse.json({ token: existing })

  const token = randomBytes(12).toString("base64url")
  await prisma.$executeRaw`UPDATE trades SET share_token = ${token} WHERE id = ${id}`

  return NextResponse.json({ token })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const owned = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM trades WHERE id = ${id} AND user_id = ${session.user.id} LIMIT 1
  `
  if (owned.length === 0) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  await prisma.$executeRaw`UPDATE trades SET share_token = NULL WHERE id = ${id}`
  return NextResponse.json({ ok: true })
}
