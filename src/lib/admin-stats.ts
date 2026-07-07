import { prisma } from "@/lib/prisma"

export interface UsageStats {
  totalUsers: number
  plans: { FREE: number; TRADER: number; PRO: number }
  admins: number
  online: number      // ativos nos últimos ~5 min
  activeToday: number // lastSeen nas últimas 24h
  active7d: number
  signups: { today: number; d7: number; d30: number }
  engagement: { usersWithTrade: number; trades7d: number; trades30d: number }
}

// Métricas de uso do app (Admin). lastSeenAt alimenta online/ativos (throttle no layout).
export async function getUsageStats(): Promise<UsageStats> {
  const now = Date.now()
  const min = (n: number) => new Date(now - n * 60_000)
  const day = (n: number) => new Date(now - n * 86_400_000)

  const [total, byPlan, byRole, s1, s7, s30, online, aToday, a7, trades7, trades30, tradeUsers] =
    await Promise.all([
      prisma.user.count(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).user.groupBy({ by: ["plan"], _count: { _all: true } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.user.count({ where: { createdAt: { gte: day(1) } } }),
      prisma.user.count({ where: { createdAt: { gte: day(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: day(30) } } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).user.count({ where: { lastSeenAt: { gte: min(5) } } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).user.count({ where: { lastSeenAt: { gte: day(1) } } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).user.count({ where: { lastSeenAt: { gte: day(7) } } }),
      prisma.trade.count({ where: { createdAt: { gte: day(7) } } }),
      prisma.trade.count({ where: { createdAt: { gte: day(30) } } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).trade.groupBy({ by: ["userId"] }),
    ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planCount = (p: string) => (byPlan as any[]).find((x) => x.plan === p)?._count._all ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admins = (byRole as any[]).find((x) => x.role === "ADMIN")?._count._all ?? 0

  return {
    totalUsers: total,
    plans: { FREE: planCount("FREE"), TRADER: planCount("TRADER"), PRO: planCount("PRO") },
    admins,
    online,
    activeToday: aToday,
    active7d: a7,
    signups: { today: s1, d7: s7, d30: s30 },
    engagement: {
      usersWithTrade: (tradeUsers as unknown[]).length,
      trades7d: trades7,
      trades30d: trades30,
    },
  }
}
