import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { giveXp, checkAndAwardAchievements } from "@/lib/gamification"
import { XP_REWARDS } from "@/lib/xp"

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

  const setupsWithStats = setups.map((s) => {
    const winTrades = s.trades.filter((t) => t.result === "WIN")
    const lossTrades = s.trades.filter((t) => t.result === "LOSS")
    const total = s.trades.length
    const totalPnl = s.trades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossWins = winTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossLosses = Math.abs(lossTrades.reduce((acc, t) => acc + Number(t.pnl), 0))
    return {
      ...s,
      trades: undefined,
      stats: {
        total,
        wins: winTrades.length,
        losses: lossTrades.length,
        winRate: total > 0 ? Math.round((winTrades.length / total) * 100) : 0,
        totalPnl: Number(totalPnl.toFixed(2)),
        avgPnl: total > 0 ? Number((totalPnl / total).toFixed(2)) : 0,
        profitFactor: grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 999 : 0,
        avgWin: winTrades.length > 0 ? Number((grossWins / winTrades.length).toFixed(2)) : 0,
        avgLoss: lossTrades.length > 0 ? Number((grossLosses / lossTrades.length).toFixed(2)) : 0,
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

  await giveXp(session.user.id, XP_REWARDS.SETUP_CREATED)
  await checkAndAwardAchievements(session.user.id)

  return NextResponse.json(setup, { status: 201 })
}
