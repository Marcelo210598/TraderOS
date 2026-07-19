import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { CalendarNav } from "@/components/calendar/calendar-nav"
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  isSameMonth,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn, signedUsd } from "@/lib/utils"
import { TrendingUp, TrendingDown, Calendar, BarChart2, Trophy, Flame } from "lucide-react"

export const metadata: Metadata = { title: "Calendário" }

interface Props {
  searchParams: Promise<Record<string, string>>
}

export default async function CalendarioPage({ searchParams }: Props) {
  const session = await auth()
  const user = session!.user
  const sp = await searchParams

  // Mês selecionado via query param ou mês atual
  const baseDate = sp.month
    ? new Date(sp.month + "T12:00:00")
    : new Date()
  const monthStart = startOfMonth(baseDate)
  const monthEnd = endOfMonth(baseDate)

  const today = new Date()
  const isCurrentMonth = isSameMonth(baseDate, today)

  const prevMonthStr = format(subMonths(baseDate, 1), "yyyy-MM")
  const nextMonthStr = format(addMonths(baseDate, 1), "yyyy-MM")
  const monthLabel = format(baseDate, "MMMM 'de' yyyy", { locale: ptBR })

  // Fetch trades do mês
  const trades = await prisma.trade.findMany({
    where: {
      userId: user.id,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { date: true, result: true, pnl: true },
    orderBy: { date: "asc" },
  })

  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const weekDayStart = getDay(monthStart)
  const blanks = Array.from({ length: weekDayStart })

  function dayTrades(day: Date) {
    return trades.filter((t) => isSameDay(new Date(t.date), day))
  }

  // Stats do mês
  const totalPnl = trades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const wins = trades.filter((t) => t.result === "WIN").length
  const losses = trades.filter((t) => t.result === "LOSS").length
  const winRate =
    trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0

  // P&L por dia (agrupado)
  const dayMap = new Map<string, number>()
  for (const t of trades) {
    const key = format(new Date(t.date), "yyyy-MM-dd")
    dayMap.set(key, (dayMap.get(key) ?? 0) + Number(t.pnl))
  }
  const dayPnls = Array.from(dayMap.values())
  const tradingDays = dayPnls.length
  const profitDays = dayPnls.filter((p) => p > 0).length
  const lossDays = dayPnls.filter((p) => p < 0).length
  const bestDay = dayPnls.length > 0 ? Math.max(...dayPnls) : 0
  const worstDay = dayPnls.length > 0 ? Math.min(...dayPnls) : 0
  const avgProfitDay =
    profitDays > 0
      ? dayPnls.filter((p) => p > 0).reduce((a, b) => a + b, 0) / profitDays
      : 0
  const avgLossDay =
    lossDays > 0
      ? dayPnls.filter((p) => p < 0).reduce((a, b) => a + b, 0) / lossDays
      : 0

  const stats = [
    {
      label: "P&L do mês",
      value: signedUsd(totalPnl),
      color: totalPnl > 0 ? "text-profit" : totalPnl < 0 ? "text-loss" : "text-foreground",
      icon: BarChart2,
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      color: winRate >= 50 ? "text-profit" : winRate > 0 ? "text-loss" : "text-foreground",
      icon: TrendingUp,
    },
    {
      label: "Dias operados",
      value: `${tradingDays}`,
      color: "text-foreground",
      icon: Calendar,
    },
    {
      label: "Melhor dia",
      value: bestDay > 0 ? `+$${bestDay.toFixed(0)}` : "—",
      color: "text-profit",
      icon: Trophy,
    },
    {
      label: "Pior dia",
      value: worstDay < 0 ? `-$${Math.abs(worstDay).toFixed(0)}` : "—",
      color: "text-loss",
      icon: TrendingDown,
    },
    {
      label: "Dias lucrativos",
      value: tradingDays > 0 ? `${profitDays}/${tradingDays}` : "—",
      color: "text-teal",
      icon: Flame,
    },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Calendário"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-4 lg:p-6 max-w-4xl mx-auto w-full space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <s.icon className="w-3.5 h-3.5 text-muted-foreground/60" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              </div>
              <p className={cn("text-lg font-bold font-mono", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Calendário */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Navegação */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <CalendarNav
              label={monthLabel}
              prevMonth={prevMonthStr}
              nextMonth={nextMonthStr}
              isCurrentMonth={isCurrentMonth}
            />
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-profit/30 inline-block" />
                Lucrativo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-loss/30 inline-block" />
                Negativo
              </span>
              <span className="flex items-center gap-1.5 hidden sm:flex">
                <span className="w-2.5 h-2.5 rounded-sm ring-1 ring-teal inline-block" />
                Hoje
              </span>
            </div>
          </div>

          <div className="p-4">
            {/* Cabeçalho dias da semana */}
            <div className="grid grid-cols-7 mb-1">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground/60 py-1.5 uppercase tracking-wider">
                  {d}
                </div>
              ))}
            </div>

            {/* Grid de dias */}
            <div className="grid grid-cols-7 gap-1">
              {blanks.map((_, i) => <div key={`b-${i}`} />)}

              {days.map((day) => {
                const dt = dayTrades(day)
                const dayPnl = dt.reduce((acc, t) => acc + Number(t.pnl), 0)
                const hasTraded = dt.length > 0
                const isWinDay = dayPnl > 0
                const isLossDay = dayPnl < 0
                const isTodayDay = isToday(day)
                const dateStr = format(day, "yyyy-MM-dd")

                const cell = (
                  <div
                    className={cn(
                      "min-h-[56px] sm:min-h-[68px] rounded-lg p-1.5 flex flex-col transition-all",
                      isTodayDay && "ring-1 ring-teal ring-offset-1 ring-offset-card",
                      hasTraded
                        ? isWinDay
                          ? "bg-profit/10 hover:bg-profit/20 cursor-pointer"
                          : isLossDay
                          ? "bg-loss/10 hover:bg-loss/20 cursor-pointer"
                          : "bg-muted/60 hover:bg-muted cursor-pointer"
                        : "bg-muted/20"
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-mono self-start leading-none",
                        isTodayDay
                          ? "text-teal font-bold"
                          : hasTraded
                          ? "text-foreground/80"
                          : "text-muted-foreground/40"
                      )}
                    >
                      {format(day, "d")}
                    </span>

                    {hasTraded && (
                      <div className="mt-auto">
                        <p
                          className={cn(
                            "text-[10px] sm:text-xs font-bold font-mono leading-none",
                            isWinDay ? "text-profit" : isLossDay ? "text-loss" : "text-muted-foreground"
                          )}
                        >
                          {dayPnl > 0 ? "+" : dayPnl < 0 ? "-" : ""}$
                          {Math.abs(dayPnl) >= 1000
                            ? `${(Math.abs(dayPnl) / 1000).toFixed(1)}k`
                            : Math.abs(dayPnl).toFixed(0)}
                        </p>
                        <p className="text-[9px] text-muted-foreground/70 mt-0.5 hidden sm:block">
                          {dt.length}t
                        </p>
                      </div>
                    )}
                  </div>
                )

                return hasTraded ? (
                  <a
                    key={dateStr}
                    href={`/journal?from=${dateStr}&to=${dateStr}`}
                    title={`Ver trades de ${format(day, "dd/MM/yyyy")}`}
                  >
                    {cell}
                  </a>
                ) : (
                  <div key={dateStr}>{cell}</div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Resumo dos dias (só se tiver dados) */}
        {tradingDays > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Média por dia</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Dia lucrativo (avg)</span>
                  <span className="text-sm font-mono font-bold text-profit">
                    +${avgProfitDay.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Dia negativo (avg)</span>
                  <span className="text-sm font-mono font-bold text-loss">
                    -${Math.abs(avgLossDay).toFixed(0)}
                  </span>
                </div>
                <div className="h-px bg-border/50 my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Expectância diária</span>
                  <span
                    className={cn(
                      "text-sm font-mono font-bold",
                      totalPnl / tradingDays >= 0 ? "text-profit" : "text-loss"
                    )}
                  >
                    {signedUsd(totalPnl / tradingDays)}/dia
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Distribuição de dias</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm bg-profit/30" />
                    <span className="text-xs text-muted-foreground">Lucrativos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 rounded-full bg-profit/30" style={{ width: `${tradingDays > 0 ? (profitDays / tradingDays) * 80 : 0}px` }} />
                    <span className="text-sm font-mono font-bold text-profit">{profitDays}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm bg-loss/30" />
                    <span className="text-xs text-muted-foreground">Negativos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 rounded-full bg-loss/30" style={{ width: `${tradingDays > 0 ? (lossDays / tradingDays) * 80 : 0}px` }} />
                    <span className="text-sm font-mono font-bold text-loss">{lossDays}</span>
                  </div>
                </div>
                <div className="h-px bg-border/50 my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total de trades</span>
                  <span className="text-sm font-mono font-bold text-foreground">{trades.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
