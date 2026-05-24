import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { StatsCard } from "@/components/dashboard/stats-card"
import { RecentTrades } from "@/components/dashboard/recent-trades"
import { PerformanceChart } from "@/components/dashboard/performance-chart"
import { StreakWidget } from "@/components/dashboard/streak-widget"
import { DollarSign, TrendingUp, Target, Activity, BookOpen, Plus } from "lucide-react"

export const metadata: Metadata = { title: "Dashboard" }

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

export default async function DashboardPage() {
  const session = await auth()
  const user = session?.user

  const firstName = user?.name?.split(" ")[0] ?? "Trader"
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const [weeklyTrades, recentTradesRaw, streaks] = await Promise.all([
    prisma.trade.findMany({
      where: { userId: user!.id, date: { gte: sevenDaysAgo } },
      select: { date: true, pnl: true, result: true },
      orderBy: { date: "asc" },
    }),
    prisma.trade.findMany({
      where: { userId: user!.id },
      include: { setup: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 5,
    }),
    prisma.streak.findMany({ where: { userId: user!.id } }),
  ])

  // Métricas semanais
  const weekPnl = weeklyTrades.reduce((a, t) => a + Number(t.pnl), 0)
  const weekWins = weeklyTrades.filter((t) => t.result === "WIN").length
  const weekWinRate =
    weeklyTrades.length > 0 ? Math.round((weekWins / weeklyTrades.length) * 100) : 0
  const weekWinPnl = weeklyTrades
    .filter((t) => t.result === "WIN")
    .reduce((a, t) => a + Number(t.pnl), 0)
  const weekLossPnl = Math.abs(
    weeklyTrades
      .filter((t) => t.result === "LOSS")
      .reduce((a, t) => a + Number(t.pnl), 0)
  )
  const profitFactor =
    weekLossPnl > 0 ? weekWinPnl / weekLossPnl : weekWinPnl > 0 ? 99 : 0

  // Dados do gráfico — sempre 7 dias mesmo sem trades
  const dayMap = new Map<string, { pnl: number; trades: number }>()
  for (const t of weeklyTrades) {
    const key = t.date.toISOString().slice(0, 10)
    const existing = dayMap.get(key) ?? { pnl: 0, trades: 0 }
    dayMap.set(key, { pnl: existing.pnl + Number(t.pnl), trades: existing.trades + 1 })
  }
  const chartData: { label: string; pnl: number; trades: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const v = dayMap.get(key) ?? { pnl: 0, trades: 0 }
    const label = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
    chartData.push({ label, pnl: v.pnl, trades: v.trades })
  }

  // Trades recentes formatados
  const todayStr = new Date().toISOString().slice(0, 10)
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10)

  const recentTrades = recentTradesRaw.map((t) => {
    const dateStr = t.date.toISOString().slice(0, 10)
    const timeStr = t.date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    let dateFormatted: string
    if (dateStr === todayStr) dateFormatted = `Hoje, ${timeStr}`
    else if (dateStr === yesterdayStr) dateFormatted = `Ontem, ${timeStr}`
    else
      dateFormatted = `${t.date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      })}, ${timeStr}`

    return {
      id: t.id,
      dateFormatted,
      instrument: t.instrument,
      direction: t.direction as "LONG" | "SHORT",
      pnl: Number(t.pnl),
      pnlPoints: Number(t.pnlPoints),
      result: t.result as "WIN" | "LOSS" | "BREAKEVEN",
      setup: t.setup?.name ?? null,
    }
  })

  const streaksFormatted = streaks.map((s) => ({
    type: s.type,
    current: s.current,
    best: s.best,
  }))

  // Display helpers
  const pnlDisplay =
    weekPnl === 0
      ? "$0"
      : `${weekPnl > 0 ? "+" : ""}$${Math.abs(weekPnl).toFixed(0)}`
  const pfDisplay =
    profitFactor === 0 ? "—" : profitFactor >= 99 ? "∞" : profitFactor.toFixed(2)

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Dashboard"
        userName={user?.name}
        userEmail={user?.email}
        userImage={user?.image}
        userPlan={user?.plan ?? "FREE"}
      />

      <div className="flex-1 p-4 lg:p-8 space-y-5">
        {/* Saudação + CTA */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-bold text-foreground truncate">
              {greeting}, {firstName} 👋
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {weeklyTrades.length === 0
                ? "Nenhum trade nos últimos 7 dias. Bora começar!"
                : `${weeklyTrades.length} trade${weeklyTrades.length > 1 ? "s" : ""} nos últimos 7 dias`}
            </p>
          </div>
          <a
            href="/journal/novo"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Registrar</span> Trade
          </a>
        </div>

        {/* Métricas principais */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatsCard
            title="P&L 7 dias"
            value={pnlDisplay}
            icon={DollarSign}
            variant={weekPnl >= 0 ? (weekPnl > 0 ? "profit" : "neutral") : "loss"}
          />
          <StatsCard
            title="Win Rate"
            value={weekWinRate.toString()}
            suffix="%"
            icon={Target}
            variant="default"
          />
          <StatsCard
            title="Trades"
            value={weeklyTrades.length.toString()}
            icon={Activity}
            variant="neutral"
          />
          <StatsCard
            title="Profit Factor"
            value={pfDisplay}
            icon={TrendingUp}
            variant="default"
          />
        </div>

        {/* Check-in rápido */}
        <div className="bg-teal/5 border border-teal/20 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal/15 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-teal" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Check-in emocional</p>
              <p className="text-xs text-muted-foreground">
                Avalie seu estado antes de operar
              </p>
            </div>
          </div>
          <a
            href="/checkin"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-teal/30 text-teal text-xs font-medium hover:bg-teal/10 transition-colors shrink-0"
          >
            Fazer check-in
          </a>
        </div>

        {/* Gráfico + Streaks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <PerformanceChart data={chartData} />
          </div>
          <div>
            <StreakWidget streaks={streaksFormatted} />
          </div>
        </div>

        {/* Trades recentes */}
        <RecentTrades trades={recentTrades} />

        {/* Dica do dia */}
        <div className="bg-card border border-border rounded-xl px-5 py-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-base">💡</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              Dica do dia
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              A Apex exige que nenhum dia individual represente mais de{" "}
              <span className="text-teal font-medium">30% do seu lucro total</span> para aprovação
              (Consistency Rule). Monitore isso no{" "}
              <a href="/guardian" className="text-teal underline underline-offset-2">
                Guardian
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
