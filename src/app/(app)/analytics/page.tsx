import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { EquityCurve } from "@/components/analytics/equity-curve"
import { DrawdownChart } from "@/components/analytics/drawdown-chart"
import { WhatIfSimulator } from "@/components/analytics/what-if-simulator"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import Link from "next/link"
import {
  TrendingUp, TrendingDown, Target, Activity,
  Clock, BarChart2, Zap, Award, Flame, AlertTriangle,
} from "lucide-react"

export const metadata: Metadata = { title: "Analytics" }

export default async function AnalyticsPage() {
  const session = await auth()
  const user = session!.user

  // select estreito: só as colunas usadas nas métricas/gráficos — evita puxar
  // notes/aiAnalysis (textos longos) de todo o histórico.
  const trades = await prisma.trade.findMany({
    where: { userId: user.id },
    select: {
      date: true,
      instrument: true,
      pnl: true,
      pnlPoints: true,
      result: true,
      sessionType: true,
      mfe: true,
      mae: true,
      setup: { select: { id: true, name: true } },
    },
    orderBy: { date: "asc" },
  })

  if (trades.length === 0) {
    return (
      <div className="flex flex-col flex-1 overflow-auto">
        <Header
          title="Analytics"
          userName={user.name}
          userEmail={user.email}
          userImage={user.image}
          userPlan={user.plan ?? "FREE"}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 p-8">
            <div className="flex justify-center text-muted-foreground/40">
              <svg viewBox="0 0 160 100" fill="none" className="w-40 h-24" xmlns="http://www.w3.org/2000/svg">
                <line x1="24" y1="8" x2="24" y2="76" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                <line x1="24" y1="76" x2="148" y2="76" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                <line x1="24" y1="56" x2="148" y2="56" stroke="currentColor" strokeWidth="0.75" strokeDasharray="4 4" opacity="0.3"/>
                <line x1="24" y1="40" x2="148" y2="40" stroke="currentColor" strokeWidth="0.75" strokeDasharray="4 4" opacity="0.3"/>
                <line x1="24" y1="24" x2="148" y2="24" stroke="currentColor" strokeWidth="0.75" strokeDasharray="4 4" opacity="0.3"/>
                <rect x="34" y="52" width="16" height="24" rx="3" fill="currentColor" opacity="0.12"/>
                <rect x="58" y="44" width="16" height="32" rx="3" fill="currentColor" opacity="0.12"/>
                <rect x="82" y="60" width="16" height="16" rx="3" fill="currentColor" opacity="0.12"/>
                <rect x="106" y="48" width="16" height="28" rx="3" fill="currentColor" opacity="0.12"/>
              </svg>
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-foreground">Nenhum trade ainda</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Registre seus primeiros trades no Journal para ver analytics completos aqui.
              </p>
            </div>
            <Link
              href="/journal/novo"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              + Registrar Trade
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Métricas gerais ──────────────────────────────────────────────────────
  const totalTrades = trades.length
  const wins = trades.filter((t) => t.result === "WIN")
  const losses = trades.filter((t) => t.result === "LOSS")
  const breakevens = trades.filter((t) => t.result === "BREAKEVEN")

  const winRate = Math.round((wins.length / totalTrades) * 100)
  const totalPnl = trades.reduce((a, t) => a + Number(t.pnl), 0)

  const winPnl = wins.reduce((a, t) => a + Number(t.pnl), 0)
  const lossPnl = Math.abs(losses.reduce((a, t) => a + Number(t.pnl), 0))
  const profitFactor = lossPnl > 0 ? winPnl / lossPnl : winPnl > 0 ? 99 : 0

  const avgWinner = wins.length > 0 ? winPnl / wins.length : 0
  const avgLoser = losses.length > 0 ? lossPnl / losses.length : 0
  const expectancy = (winRate / 100) * avgWinner - ((100 - winRate) / 100) * avgLoser

  // ── Equity curve ────────────────────────────────────────────────────────
  let cumPnl = 0
  const equityPoints = trades.map((t) => {
    cumPnl += Number(t.pnl)
    return {
      label: format(new Date(t.date), "dd/MM"),
      cumPnl: Math.round(cumPnl * 100) / 100,
    }
  })

  // ── Drawdown analysis ────────────────────────────────────────────────────
  let peak = 0
  let maxDrawdown = 0
  const drawdownPoints = equityPoints.map((pt) => {
    if (pt.cumPnl > peak) peak = pt.cumPnl
    const dd = peak - pt.cumPnl
    if (dd > maxDrawdown) maxDrawdown = dd
    return { label: pt.label, dd: -dd, cumPnl: pt.cumPnl }
  })
  const finalEquity = equityPoints[equityPoints.length - 1]?.cumPnl ?? 0
  const currentDrawdown = Math.max(0, peak - finalEquity)

  // ── Streak analysis ───────────────────────────────────────────────────────
  let maxWinStreak = 0
  let maxLossStreak = 0
  let curWin = 0
  let curLoss = 0
  for (const t of trades) {
    if (t.result === "WIN") {
      curWin++; curLoss = 0
      if (curWin > maxWinStreak) maxWinStreak = curWin
    } else if (t.result === "LOSS") {
      curLoss++; curWin = 0
      if (curLoss > maxLossStreak) maxLossStreak = curLoss
    } else {
      curWin = 0; curLoss = 0
    }
  }
  const currentStreakValue = curWin > 0 ? curWin : curLoss > 0 ? -curLoss : 0

  // ── MFE / MAE aggregate ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradesWithMfe = trades.filter((t) => (t as any).mfe != null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradesWithMae = trades.filter((t) => (t as any).mae != null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgMfe = tradesWithMfe.length > 0 ? tradesWithMfe.reduce((a, t) => a + Number((t as any).mfe), 0) / tradesWithMfe.length : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avgMae = tradesWithMae.length > 0 ? tradesWithMae.reduce((a, t) => a + Number((t as any).mae), 0) / tradesWithMae.length : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradesWithBoth = trades.filter((t) => (t as any).mfe != null && Number((t as any).mfe) > 0 && Number(t.pnlPoints) > 0)
  const avgCaptureRate = tradesWithBoth.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? tradesWithBoth.reduce((a, t) => a + Math.min(Number(t.pnlPoints) / Number((t as any).mfe), 1), 0) / tradesWithBoth.length
    : null

  // ── Breakdown por sessão ────────────────────────────────────────────────
  const sessions = ["AM", "PM", "OVERNIGHT"] as const
  const sessionStats = sessions.map((s) => {
    const st = trades.filter((t) => t.sessionType === s)
    const sw = st.filter((t) => t.result === "WIN")
    const sPnl = st.reduce((a, t) => a + Number(t.pnl), 0)
    return {
      session: s,
      total: st.length,
      wins: sw.length,
      winRate: st.length > 0 ? Math.round((sw.length / st.length) * 100) : 0,
      pnl: sPnl,
    }
  }).filter((s) => s.total > 0)

  // ── Breakdown por instrumento ────────────────────────────────────────────
  const instrumentMap = new Map<string, { total: number; wins: number; pnl: number }>()
  for (const t of trades) {
    const cur = instrumentMap.get(t.instrument) ?? { total: 0, wins: 0, pnl: 0 }
    instrumentMap.set(t.instrument, {
      total: cur.total + 1,
      wins: cur.wins + (t.result === "WIN" ? 1 : 0),
      pnl: cur.pnl + Number(t.pnl),
    })
  }
  const instrumentStats = Array.from(instrumentMap.entries())
    .map(([name, v]) => ({
      name,
      total: v.total,
      winRate: Math.round((v.wins / v.total) * 100),
      pnl: v.pnl,
    }))
    .sort((a, b) => b.total - a.total)

  // ── Breakdown por setup ─────────────────────────────────────────────────
  const setupMap = new Map<string, { name: string; total: number; wins: number; pnl: number }>()
  for (const t of trades) {
    if (!t.setup) continue
    const cur = setupMap.get(t.setup.id) ?? { name: t.setup.name, total: 0, wins: 0, pnl: 0 }
    setupMap.set(t.setup.id, {
      name: t.setup.name,
      total: cur.total + 1,
      wins: cur.wins + (t.result === "WIN" ? 1 : 0),
      pnl: cur.pnl + Number(t.pnl),
    })
  }
  const setupStats = Array.from(setupMap.values())
    .sort((a, b) => b.total - a.total)

  // ── Melhor / Pior trade ─────────────────────────────────────────────────
  const sortedByPnl = [...trades].sort((a, b) => Number(b.pnl) - Number(a.pnl))
  const bestTrade = sortedByPnl[0]
  const worstTrade = sortedByPnl[sortedByPnl.length - 1]

  // ── Dia da semana ────────────────────────────────────────────────────────
  const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
  const dowMap = new Map<number, { total: number; wins: number; pnl: number }>()
  for (const t of trades) {
    const dow = new Date(t.date).getDay()
    const cur = dowMap.get(dow) ?? { total: 0, wins: 0, pnl: 0 }
    dowMap.set(dow, { total: cur.total + 1, wins: cur.wins + (t.result === "WIN" ? 1 : 0), pnl: cur.pnl + Number(t.pnl) })
  }
  const dowStats = [1, 2, 3, 4, 5] // Seg-Sex
    .map((d) => ({ day: DOW[d], ...(dowMap.get(d) ?? { total: 0, wins: 0, pnl: 0 }) }))

  const maxDowTotal = Math.max(...dowStats.map((d) => d.total), 1)

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Analytics"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-4 lg:p-6 space-y-5 max-w-5xl mx-auto w-full">

        {/* ── KPIs principais ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "P&L Total", value: `${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(0)}`, color: totalPnl >= 0 ? "text-profit" : "text-loss", icon: BarChart2 },
            { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? "text-profit" : "text-loss", icon: Target },
            { label: "Profit Factor", value: profitFactor >= 99 ? "∞" : profitFactor.toFixed(2), color: profitFactor >= 1.5 ? "text-profit" : profitFactor >= 1 ? "text-yellow-400" : "text-loss", icon: TrendingUp },
            { label: "Expectância", value: `${expectancy >= 0 ? "+" : ""}$${Math.abs(expectancy).toFixed(0)}`, color: expectancy >= 0 ? "text-profit" : "text-loss", icon: Zap },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <s.icon className="w-3.5 h-3.5 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
              <p className={cn("text-2xl font-bold font-mono", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Equity Curve ── */}
        <EquityCurve points={equityPoints} />

        {/* ── Drawdown Chart ── */}
        <DrawdownChart
          points={drawdownPoints}
          maxDrawdown={maxDrawdown}
          currentDrawdown={currentDrawdown}
        />

        {/* ── Drawdown & Streaks ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Max Drawdown",
              value: maxDrawdown > 0 ? `-$${maxDrawdown.toFixed(0)}` : "$0",
              sub: "pior recuperação",
              color: maxDrawdown > 0 ? "text-loss" : "text-foreground",
              icon: TrendingDown,
            },
            {
              label: "Drawdown Atual",
              value: currentDrawdown > 0 ? `-$${currentDrawdown.toFixed(0)}` : "$0",
              sub: currentDrawdown > 0 ? "abaixo do pico" : "no topo",
              color: currentDrawdown > 0 ? "text-yellow-400" : "text-profit",
              icon: AlertTriangle,
            },
            {
              label: "Max Win Streak",
              value: maxWinStreak.toString(),
              sub: "wins seguidos",
              color: "text-profit",
              icon: Flame,
            },
            {
              label: "Max Loss Streak",
              value: maxLossStreak.toString(),
              sub: "losses seguidos",
              color: maxLossStreak >= 5 ? "text-loss" : "text-foreground",
              icon: Activity,
            },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <s.icon className="w-3.5 h-3.5 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
              <p className={cn("text-2xl font-bold font-mono", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Streak atual */}
        {currentStreakValue !== 0 && (
          <div className={cn(
            "rounded-xl border px-5 py-3 flex items-center gap-3",
            currentStreakValue > 0 ? "bg-profit/5 border-profit/20" : "bg-loss/5 border-loss/20"
          )}>
            <span className="text-xl">{currentStreakValue > 0 ? "🔥" : "🧊"}</span>
            <div>
              <p className={cn("text-sm font-semibold", currentStreakValue > 0 ? "text-profit" : "text-loss")}>
                {currentStreakValue > 0
                  ? `${currentStreakValue} win${currentStreakValue > 1 ? "s" : ""} seguidos!`
                  : `${Math.abs(currentStreakValue)} loss${Math.abs(currentStreakValue) > 1 ? "es" : ""} seguidos`}
              </p>
              <p className="text-xs text-muted-foreground">streak atual com base nos últimos trades</p>
            </div>
          </div>
        )}

        {/* ── MFE / MAE ── */}
        {(avgMfe != null || avgMae != null) && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">MFE / MAE — Qualidade de Execução</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Baseado em {tradesWithMfe.length} trade{tradesWithMfe.length !== 1 ? "s" : ""} com dados registrados
              </p>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {avgMfe != null && (
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Avg MFE</p>
                  <p className="text-2xl font-bold font-mono text-profit">+{avgMfe.toFixed(1)} pts</p>
                  <p className="text-[10px] text-muted-foreground">potencial médio a favor</p>
                </div>
              )}
              {avgMae != null && (
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Avg MAE</p>
                  <p className="text-2xl font-bold font-mono text-loss">-{avgMae.toFixed(1)} pts</p>
                  <p className="text-[10px] text-muted-foreground">excursão adversa média</p>
                </div>
              )}
              {avgCaptureRate != null && (
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Taxa de Captura</p>
                  <p className={cn("text-2xl font-bold font-mono", avgCaptureRate >= 0.6 ? "text-profit" : avgCaptureRate >= 0.4 ? "text-yellow-400" : "text-loss")}>
                    {(avgCaptureRate * 100).toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">do potencial MFE capturado</p>
                </div>
              )}
            </div>
            {avgCaptureRate != null && avgCaptureRate < 0.5 && (
              <div className="px-5 pb-4">
                <p className="text-xs text-yellow-400/80 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2">
                  ⚠ Você está capturando menos de 50% do potencial dos seus trades. Considere ajustar seus alvos ou trailing stop.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Avg Winner / Loser + Trades ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />Avg Winner vs Loser
            </p>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-profit font-medium">Avg Win</span>
                  <span className="text-profit font-mono font-bold">+${avgWinner.toFixed(0)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-profit rounded-full" style={{ width: `${Math.min((avgWinner / Math.max(avgWinner, avgLoser, 1)) * 100, 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-loss font-medium">Avg Loss</span>
                  <span className="text-loss font-mono font-bold">-${avgLoser.toFixed(0)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-loss rounded-full" style={{ width: `${Math.min((avgLoser / Math.max(avgWinner, avgLoser, 1)) * 100, 100)}%` }} />
                </div>
              </div>
              <div className="pt-1 border-t border-border flex justify-between text-xs">
                <span className="text-muted-foreground">Risco/Retorno</span>
                <span className={cn("font-mono font-bold", avgLoser > 0 && avgWinner / avgLoser >= 1.5 ? "text-profit" : "text-foreground")}>
                  {avgLoser > 0 ? `1:${(avgWinner / avgLoser).toFixed(2)}` : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />Distribuição de Trades
            </p>
            <div className="space-y-2">
              {[
                { label: "Wins", count: wins.length, color: "bg-profit", text: "text-profit" },
                { label: "Losses", count: losses.length, color: "bg-loss", text: "text-loss" },
                { label: "Breakeven", count: breakevens.length, color: "bg-muted-foreground", text: "text-muted-foreground" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={item.text}>{item.label}</span>
                    <span className={cn("font-mono font-bold", item.text)}>{item.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full", item.color)} style={{ width: `${(item.count / totalTrades) * 100}%` }} />
                  </div>
                </div>
              ))}
              <div className="pt-1 border-t border-border flex justify-between text-xs">
                <span className="text-muted-foreground">Total</span>
                <span className="font-mono font-bold text-foreground">{totalTrades}</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5" />Melhor / Pior Trade
            </p>
            <div className="space-y-3">
              <div className="bg-profit/5 border border-profit/20 rounded-lg p-2.5">
                <p className="text-[10px] text-muted-foreground">Melhor trade</p>
                <p className="text-lg font-bold font-mono text-profit mt-0.5">
                  +${Number(bestTrade.pnl).toFixed(0)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {bestTrade.instrument} · {format(new Date(bestTrade.date), "dd/MM/yyyy")}
                </p>
              </div>
              <div className="bg-loss/5 border border-loss/20 rounded-lg p-2.5">
                <p className="text-[10px] text-muted-foreground">Pior trade</p>
                <p className="text-lg font-bold font-mono text-loss mt-0.5">
                  ${Number(worstTrade.pnl).toFixed(0)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {worstTrade.instrument} · {format(new Date(worstTrade.date), "dd/MM/yyyy")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Performance por Sessão ── */}
        {sessionStats.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Performance por Sessão</h2>
            </div>
            <div className="divide-y divide-border">
              {sessionStats.map((s) => (
                <div key={s.session} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-20 shrink-0">
                    <span className="text-xs font-mono font-semibold text-foreground">{s.session}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden flex-1">
                        <div
                          className={cn("h-full rounded-full", s.winRate >= 50 ? "bg-profit" : "bg-loss")}
                          style={{ width: `${s.winRate}%` }}
                        />
                      </div>
                      <span className={cn("text-xs font-mono font-bold w-10 text-right", s.winRate >= 50 ? "text-profit" : "text-loss")}>
                        {s.winRate}%
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{s.total} trades · {s.wins}W/{s.total - s.wins}L</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-sm font-bold font-mono", s.pnl >= 0 ? "text-profit" : "text-loss")}>
                      {s.pnl >= 0 ? "+" : ""}${Math.abs(s.pnl).toFixed(0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Performance por Instrumento ── */}
          {instrumentStats.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Por Instrumento</h2>
              </div>
              <div className="divide-y divide-border">
                {instrumentStats.map((s) => (
                  <div key={s.name} className="flex items-center gap-4 px-5 py-3">
                    <span className="text-sm font-mono font-bold text-foreground w-12 shrink-0">{s.name}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex-1">
                          <div
                            className={cn("h-full rounded-full", s.winRate >= 50 ? "bg-profit" : "bg-loss")}
                            style={{ width: `${s.winRate}%` }}
                          />
                        </div>
                        <span className={cn("text-xs font-mono w-10 text-right", s.winRate >= 50 ? "text-profit" : "text-loss")}>
                          {s.winRate}%
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{s.total} trades</p>
                    </div>
                    <span className={cn("text-sm font-mono font-bold shrink-0", s.pnl >= 0 ? "text-profit" : "text-loss")}>
                      {s.pnl >= 0 ? "+" : ""}${Math.abs(s.pnl).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Performance por Setup ── */}
          {setupStats.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <Target className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Por Setup</h2>
              </div>
              <div className="divide-y divide-border">
                {setupStats.map((s) => {
                  const wr = Math.round((s.wins / s.total) * 100)
                  return (
                    <div key={s.name} className="flex items-center gap-4 px-5 py-3">
                      <span className="text-xs font-medium text-foreground flex-1 truncate">{s.name}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={cn("text-xs font-mono", wr >= 50 ? "text-profit" : "text-loss")}>{wr}%</span>
                        <span className="text-xs text-muted-foreground">{s.total}t</span>
                        <span className={cn("text-sm font-mono font-bold", s.pnl >= 0 ? "text-profit" : "text-loss")}>
                          {s.pnl >= 0 ? "+" : ""}${Math.abs(s.pnl).toFixed(0)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Simulador "E se" ── */}
        <WhatIfSimulator
          trades={trades.map(t => ({
            pnl: Number(t.pnl),
            pnlPoints: Number(t.pnlPoints),
            result: t.result,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mfe: (t as any).mfe != null ? Number((t as any).mfe) : null,
          }))}
        />

        {/* ── Dia da semana ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Performance por Dia da Semana</h2>
          </div>
          <div className="p-5">
            <div className="flex items-end gap-3 h-28">
              {dowStats.map((d) => {
                const barH = d.total > 0 ? Math.max((d.total / maxDowTotal) * 100, 8) : 3
                const wr = d.total > 0 ? Math.round((d.wins / d.total) * 100) : 0
                const isGood = d.pnl > 0
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    {d.total > 0 && (
                      <span className={cn("text-[9px] font-mono font-bold", isGood ? "text-profit" : "text-loss")}>
                        {wr}%
                      </span>
                    )}
                    <div
                      className={cn("w-full rounded-t-sm transition-all", d.total > 0 ? (isGood ? "bg-profit/60" : "bg-loss/60") : "bg-muted/30")}
                      style={{ height: `${barH}%` }}
                    />
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3 mt-2">
              {dowStats.map((d) => (
                <div key={d.day} className="flex-1 text-center">
                  <p className="text-[10px] text-muted-foreground font-mono">{d.day}</p>
                  {d.total > 0 && (
                    <p className={cn("text-[9px] font-mono", d.pnl >= 0 ? "text-profit" : "text-loss")}>
                      {d.pnl >= 0 ? "+" : ""}${Math.abs(d.pnl).toFixed(0)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
