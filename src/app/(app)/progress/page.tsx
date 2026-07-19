import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { XpCard } from "@/components/progress/xp-card"
import { AchievementsGrid } from "@/components/progress/achievements-grid"
import { StreaksPanel } from "@/components/progress/streaks-panel"
import { getLevelFromXp } from "@/lib/xp"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { signedUsd } from "@/lib/utils"

export const metadata: Metadata = { title: "Progress" }

export default async function ProgressPage() {
  const session = await auth()
  const user = session!.user

  const [dbUser, trades, userAchievements, streaks, setupCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { xp: true, level: true } }),
    prisma.trade.findMany({
      where: { userId: user.id },
      select: { result: true, pnl: true, date: true },
      orderBy: { date: "desc" },
    }),
    prisma.userAchievement.findMany({
      where: { userId: user.id },
      select: { achievementId: true, earnedAt: true },
    }),
    prisma.streak.findMany({ where: { userId: user.id } }),
    prisma.setup.count({ where: { userId: user.id, isActive: true } }),
  ])

  const xp = dbUser?.xp ?? 0
  const { level, currentXp, xpNeeded, progress } = getLevelFromXp(xp)

  const totalTrades = trades.length
  const wins = trades.filter((t) => t.result === "WIN").length
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0

  // Calcular win streak atual
  let winStreak = 0
  for (const trade of trades) {
    if (trade.result === "WIN") winStreak++
    else break
  }

  // Journal streak (dias com pelo menos 1 trade, consecutivos até hoje)
  const tradeDays = new Set(trades.map((t) => t.date.toISOString().slice(0, 10)))
  let journalStreak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (tradeDays.has(d.toISOString().slice(0, 10))) journalStreak++
    else if (i > 0) break
  }

  const earnedAchievements = userAchievements.map((a) => ({
    achievementId: a.achievementId,
    earnedAt: a.earnedAt.toISOString(),
  }))

  const streaksFormatted = streaks.map((s) => ({
    type: s.type,
    current: s.current,
    best: s.best,
  }))

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Progress"
        subtitle="Sua evolução como trader"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* XP Card */}
        <XpCard
          xp={xp}
          level={level}
          currentXp={currentXp}
          xpNeeded={xpNeeded}
          progress={progress}
          totalTrades={totalTrades}
          winRate={winRate}
        />

        {/* Tabs: Conquistas / Streaks */}
        <Tabs defaultValue="conquistas">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="conquistas" className="data-[selected]:bg-accent data-[selected]:text-teal">
              🏆 Conquistas ({earnedAchievements.length})
            </TabsTrigger>
            <TabsTrigger value="streaks" className="data-[selected]:bg-accent data-[selected]:text-teal">
              🔥 Streaks
            </TabsTrigger>
            <TabsTrigger value="historico" className="data-[selected]:bg-accent data-[selected]:text-teal">
              📈 Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="conquistas" className="mt-4">
            <AchievementsGrid
              earned={earnedAchievements}
              tradeCount={totalTrades}
              winStreak={winStreak}
              journalStreak={journalStreak}
              setupCount={setupCount}
            />
          </TabsContent>

          <TabsContent value="streaks" className="mt-4">
            <StreaksPanel streaks={streaksFormatted} />
            {streaksFormatted.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-6 text-center space-y-2">
                <p className="text-2xl">🎯</p>
                <p className="text-sm font-medium text-foreground">Sem streaks ainda</p>
                <p className="text-xs text-muted-foreground">
                  Registre trades consistentemente para começar a acumular streaks.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="historico" className="mt-4">
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Estatísticas gerais</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Total de trades", value: totalTrades.toString() },
                  { label: "Wins", value: wins.toString(), color: "text-profit" },
                  { label: "Losses", value: (totalTrades - wins).toString(), color: "text-loss" },
                  { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? "text-profit" : "text-loss" },
                  {
                    label: "P&L total",
                    value: (() => {
                      const total = trades.reduce((a, t) => a + Number(t.pnl), 0)
                      return signedUsd(total)
                    })(),
                    color: trades.reduce((a, t) => a + Number(t.pnl), 0) >= 0 ? "text-profit" : "text-loss",
                  },
                  { label: "Conquistas", value: earnedAchievements.length.toString(), color: "text-teal" },
                  { label: "Nível atual", value: level.toString(), color: "text-teal" },
                  { label: "XP total", value: xp.toLocaleString(), color: "text-teal" },
                ].map((s) => (
                  <div key={s.label} className="bg-muted/50 rounded-xl p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-xl font-bold font-mono mt-1 ${s.color ?? "text-foreground"}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
