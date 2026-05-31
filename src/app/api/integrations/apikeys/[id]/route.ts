import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const key = await (prisma as any).userApiKey.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!key) return NextResponse.json({ error: "Chave não encontrada" }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
