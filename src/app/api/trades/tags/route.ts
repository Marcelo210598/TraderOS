import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tags = await (prisma as any).tradeTag.groupBy({
    by: ["name"],
    where: { trade: { userId: session.user.id } },
    _count: { name: true },
    orderBy: { _count: { name: "desc" } },
    take: 50,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json((tags as any[]).map((t) => t.name as string))
}
