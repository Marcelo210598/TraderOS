import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const setupSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().optional().nullable(),
  rules: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const setups = await prisma.setup.findMany({
    where: { userId: session.user.id, isActive: true },
    include: {
      _count: { select: { trades: true } },
      trades: {
        select: { result: true, pnl: true },
        orderBy: { date: "desc" },
        take: 100,
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // Calcular stats por setup
  const setupsWithStats = setups.map((s) => {
    const wins = s.trades.filter((t) => t.result === "WIN").length
    const total = s.trades.length
    const totalPnl = s.trades.reduce((acc, t) => acc + Number(t.pnl), 0)
    return {
      ...s,
      trades: undefined,
      stats: {
        total,
        wins,
        losses: s.trades.filter((t) => t.result === "LOSS").length,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
        totalPnl: Number(totalPnl.toFixed(2)),
      },
    }
  })

  return NextResponse.json(setupsWithStats)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (session.user.plan === "FREE") {
    return NextResponse.json(
      { error: "A Biblioteca de Setups requer plano Trader ou Pro." },
      { status: 403 }
    )
  }

  const body = await req.json()
  const parsed = setupSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const setup = await prisma.setup.create({
    data: { ...parsed.data, userId: session.user.id },
  })

  return NextResponse.json(setup, { status: 201 })
}
