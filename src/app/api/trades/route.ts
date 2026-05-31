import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { giveXp, updateJournalStreak, updateProfitableDaysStreak, checkAndAwardAchievements } from "@/lib/gamification"
import { XP_REWARDS } from "@/lib/xp"

const createTradeSchema = z.object({
  date: z.string(),
  instrument: z.string().min(1),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  pnl: z.number(),
  pnlPoints: z.number(),
  commission: z.number().min(0).default(0),
  result: z.enum(["WIN", "LOSS", "BREAKEVEN"]),
  sessionType: z.enum(["AM", "PM", "OVERNIGHT"]).default("AM"),
  accountLabel: z.string().default("PA"),
  setupId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  mfe: z.number().optional().nullable(),
  mae: z.number().optional().nullable(),
  tags: z.array(z.string()).default([]),
  screenshots: z.array(z.object({
    url: z.string().url(),
    key: z.string(),
    label: z.string().nullable().optional(),
  })).default([]),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, Number(searchParams.get("page") ?? 1))
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)))
  const result = searchParams.get("result")
  const instrument = searchParams.get("instrument")
  const setupId = searchParams.get("setupId")
  const tag = searchParams.get("tag")
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const where: Prisma.TradeWhereInput = {
    userId: session.user.id,
    ...(result && { result: result as "WIN" | "LOSS" | "BREAKEVEN" }),
    ...(instrument && { instrument }),
    ...(setupId && { setupId }),
    ...(tag && { tags: { some: { name: tag } } }),
    ...(from || to
      ? {
          date: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }
      : {}),
  }

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      include: {
        tags: true,
        setup: { select: { id: true, name: true } },
        screenshots: { select: { id: true, url: true, label: true }, take: 1 },
      },
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.trade.count({ where }),
  ])

  return NextResponse.json({
    trades,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // Limite do plano Free: 10 trades/mês
  if (session.user.plan === "FREE") {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const count = await prisma.trade.count({
      where: { userId: session.user.id, createdAt: { gte: startOfMonth } },
    })
    if (count >= 10) {
      return NextResponse.json(
        { error: "Limite de 10 trades/mês atingido no plano Free. Faça upgrade para continuar." },
        { status: 403 }
      )
    }
  }

  const body = await req.json()
  const parsed = createTradeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tags, screenshots, ...data } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trade = await (prisma.trade as any).create({
    data: {
      ...data,
      date: new Date(data.date),
      entryPrice: data.entryPrice,
      exitPrice: data.exitPrice,
      pnl: data.pnl,
      pnlPoints: data.pnlPoints,
      commission: data.commission,
      userId: session.user.id,
      tags: {
        create: tags.map((name) => ({ name })),
      },
      ...(screenshots.length > 0 && {
        screenshots: {
          create: screenshots.map((s) => ({ url: s.url, key: s.key, label: s.label ?? null })),
        },
      }),
    },
    include: { tags: true, setup: { select: { id: true, name: true } } },
  })

  // XP + streaks + conquistas
  await giveXp(session.user.id, XP_REWARDS.TRADE_REGISTERED)
  if (parsed.data.result === "WIN") {
    await giveXp(session.user.id, XP_REWARDS.WIN_TRADE)
  }
  const tradeDate = new Date(parsed.data.date)
  await updateJournalStreak(session.user.id, tradeDate)
  await updateProfitableDaysStreak(session.user.id, tradeDate)
  await checkAndAwardAchievements(session.user.id)

  return NextResponse.json(trade, { status: 201 })
}
