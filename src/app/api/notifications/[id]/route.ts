import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params

  await (prisma as any).notification.updateMany({
    where: { id, userId: session.user.id },
    data: { read: true },
  })

  return NextResponse.json({ ok: true })
}
