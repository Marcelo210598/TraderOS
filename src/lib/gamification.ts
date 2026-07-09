import { prisma } from "./prisma"
import { ACHIEVEMENTS_CONFIG, XP_REWARDS } from "./xp"

export async function giveXp(userId: string, amount: number) {
  await prisma.user.update({
    where: { id: userId },
    data: { xp: { increment: amount } },
  })
}

// Atualiza JOURNAL_ENTRIES streak após registrar trade
export async function updateJournalStreak(userId: string, tradeDate: Date) {
  const day = new Date(tradeDate)
  day.setHours(0, 0, 0, 0)
  const yesterday = new Date(day)
  yesterday.setDate(yesterday.getDate() - 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma.streak as any).findUnique({
    where: { userId_type: { userId, type: "JOURNAL_ENTRIES" } },
  })

  if (!existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.streak as any).create({
      data: { userId, type: "JOURNAL_ENTRIES", current: 1, best: 1, lastUpdated: day },
    })
    return
  }

  const last = new Date(existing.lastUpdated)
  last.setHours(0, 0, 0, 0)
  if (last.getTime() === day.getTime()) return // já contou hoje

  const newCurrent = last.getTime() === yesterday.getTime() ? existing.current + 1 : 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.streak as any).update({
    where: { userId_type: { userId, type: "JOURNAL_ENTRIES" } },
    data: {
      current: newCurrent,
      best: Math.max(newCurrent, existing.best),
      lastUpdated: day,
    },
  })
}

// Atualiza PROFITABLE_DAYS streak — recalcula P&L do dia
export async function updateProfitableDaysStreak(userId: string, tradeDate: Date) {
  const day = new Date(tradeDate)
  day.setHours(0, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(23, 59, 59, 999)
  const yesterday = new Date(day)
  yesterday.setDate(yesterday.getDate() - 1)

  const dayTrades = await prisma.trade.findMany({
    where: { userId, date: { gte: day, lte: dayEnd } },
    select: { pnl: true },
  })
  const isProfitable = dayTrades.reduce((s, t) => s + Number(t.pnl), 0) > 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma.streak as any).findUnique({
    where: { userId_type: { userId, type: "PROFITABLE_DAYS" } },
  })

  if (!existing) {
    if (isProfitable) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.streak as any).create({
        data: { userId, type: "PROFITABLE_DAYS", current: 1, best: 1, lastUpdated: day },
      })
    }
    return
  }

  const last = new Date(existing.lastUpdated)
  last.setHours(0, 0, 0, 0)

  if (last.getTime() === day.getTime()) {
    // Mesmo dia — reavalia se ainda é lucrativo
    if (!isProfitable && existing.current > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.streak as any).update({
        where: { userId_type: { userId, type: "PROFITABLE_DAYS" } },
        data: { current: 0 },
      })
    }
    return
  }

  if (!isProfitable) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.streak as any).update({
      where: { userId_type: { userId, type: "PROFITABLE_DAYS" } },
      data: { current: 0 },
    })
    return
  }

  const newCurrent = last.getTime() === yesterday.getTime() ? existing.current + 1 : 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.streak as any).update({
    where: { userId_type: { userId, type: "PROFITABLE_DAYS" } },
    data: {
      current: newCurrent,
      best: Math.max(newCurrent, existing.best),
      lastUpdated: day,
    },
  })
}

// Atualiza CHECK_INS streak após check-in
export async function updateCheckInStreak(userId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma.streak as any).findUnique({
    where: { userId_type: { userId, type: "CHECK_INS" } },
  })

  if (!existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.streak as any).create({
      data: { userId, type: "CHECK_INS", current: 1, best: 1, lastUpdated: today },
    })
    return
  }

  const last = new Date(existing.lastUpdated)
  last.setHours(0, 0, 0, 0)
  if (last.getTime() === today.getTime()) return

  const newCurrent = last.getTime() === yesterday.getTime() ? existing.current + 1 : 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.streak as any).update({
    where: { userId_type: { userId, type: "CHECK_INS" } },
    data: {
      current: newCurrent,
      best: Math.max(newCurrent, existing.best),
      lastUpdated: today,
    },
  })
}

// Garante que o registro Achievement existe no banco (id = chave do config)
async function ensureAchievement(ach: (typeof ACHIEVEMENTS_CONFIG)[number]) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.achievement as any).upsert({
      where: { id: ach.key },
      update: {},
      create: {
        id: ach.key,
        name: ach.name,
        description: ach.description,
        icon: ach.icon,
        type: ach.type,
        requirement: ach.requirement,
        xpReward: ach.xpReward,
      },
    })
  } catch { /* ignora se já existe */ }
}

// Checa e concede conquistas não ganhas ainda. Retorna as novas.
export async function checkAndAwardAchievements(userId: string): Promise<string[]> {
  // Barato primeiro: se o usuário já ganhou TODAS as conquistas, não há nada a
  // recalcular — evita puxar o histórico inteiro de trades a cada trade novo
  // (essa função roda a cada POST do sync do bot, ~14x/dia).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const earnedRaw = await (prisma.userAchievement as any).findMany({
    where: { userId },
    select: { achievementId: true },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const earnedIds = new Set<string>(earnedRaw.map((a: any) => a.achievementId as string))
  if (earnedIds.size >= ACHIEVEMENTS_CONFIG.length) return []

  const [trades, setupCount] = await Promise.all([
    prisma.trade.findMany({
      where: { userId },
      select: { result: true, pnl: true, date: true },
      orderBy: { date: "desc" },
    }),
    prisma.setup.count({ where: { userId, isActive: true } }),
  ])
  const totalTrades = trades.length
  const wins = trades.filter((t) => t.result === "WIN").length
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0

  let winStreak = 0
  for (const t of trades) {
    if (t.result === "WIN") winStreak++
    else break
  }

  const tradeDays = new Set(trades.map((t) => new Date(t.date).toISOString().slice(0, 10)))
  let journalStreak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (tradeDays.has(d.toISOString().slice(0, 10))) journalStreak++
    else if (i > 0) break
  }

  const monthPnl = new Map<string, number>()
  for (const t of trades) {
    const key = new Date(t.date).toISOString().slice(0, 7)
    monthPnl.set(key, (monthPnl.get(key) ?? 0) + Number(t.pnl))
  }
  const hasGreenMonth = [...monthPnl.values()].some((v) => v > 0)

  const newlyAwarded: string[] = []

  for (const ach of ACHIEVEMENTS_CONFIG) {
    if (earnedIds.has(ach.key)) continue

    let earned = false
    switch (ach.type) {
      case "TRADES_COUNT":    earned = totalTrades >= ach.requirement; break
      case "WIN_STREAK":      earned = winStreak >= ach.requirement; break
      case "JOURNAL_STREAK":  earned = journalStreak >= ach.requirement; break
      case "SETUP_LIBRARY":   earned = setupCount >= ach.requirement; break
      case "PNL_MILESTONE":   earned = hasGreenMonth; break
      case "CONSISTENCY":     earned = totalTrades >= 30 && winRate >= ach.requirement; break
    }

    if (earned) {
      await ensureAchievement(ach)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma.userAchievement as any).create({
          data: { userId, achievementId: ach.key },
        })
        await giveXp(userId, ach.xpReward)
        newlyAwarded.push(ach.key)
      } catch { /* já ganhou, ignora */ }
    }
  }

  return newlyAwarded
}
