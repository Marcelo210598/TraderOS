import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys = await (prisma as any).userApiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, key: true, lastUsed: true, createdAt: true },
  })

  return NextResponse.json(keys)
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // Limite de 3 keys por usuário
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = await (prisma as any).userApiKey.count({ where: { userId: session.user.id } })
  if (count >= 3) {
    return NextResponse.json({ error: "Limite de 3 API Keys atingido" }, { status: 400 })
  }

  const key = `traderos_${crypto.randomBytes(24).toString("hex")}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (prisma as any).userApiKey.create({
    data: { id: crypto.randomUUID(), userId: session.user.id, key },
    select: { id: true, name: true, key: true, createdAt: true },
  })

  return NextResponse.json(created, { status: 201 })
}
