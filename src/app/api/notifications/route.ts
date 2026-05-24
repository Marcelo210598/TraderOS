import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const notifications = await (prisma as any).notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  })

  const unreadCount = notifications.filter((n: any) => !n.read).length

  return NextResponse.json({ notifications, unreadCount })
}
