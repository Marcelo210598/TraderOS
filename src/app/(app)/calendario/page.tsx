import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Calendário" }

export default async function CalendarioPage() {
  const session = await auth()
  const user = session!.user
  const today = new Date()
  const monthStart = startOfMonth(today)
  const monthEnd = endOfMonth(today)

  const trades = await prisma.trade.findMany({
    where: {
      userId: user.id,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { date: true, result: true, pnl: true },
    orderBy: { date: "asc" },
  })

  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const weekDayStart = getDay(monthStart) // 0=Dom ... 6=Sáb
  const blanks = Array.from({ length: weekDayStart })

  function dayTrades(day: Date) {
    return trades.filter((t) => isSameDay(new Date(t.date), day))
  }

  const totalPnl = trades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const wins = trades.filter((t) => t.result === "WIN").length
  const losses = trades.filter((t) => t.result === "LOSS").length

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Calendário"
        subtitle={format(today, "MMMM 'de' yyyy", { locale: ptBR })}
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-5">
        {/* Stats do mês */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">P&L do mês</p>
            <p className={cn("text-xl font-bold font-mono mt-1", totalPnl >= 0 ? "text-profit" : "text-loss")}>
              {totalPnl >= 0 ? "+" : ""}${Math.abs(totalPnl).toFixed(0)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Wins / Losses</p>
            <p className="text-xl font-bold font-mono mt-1">
              <span className="text-profit">{wins}W</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-loss">{losses}L</span>
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Dias operados</p>
            <p className="text-xl font-bold font-mono mt-1 text-foreground">
              {new Set(trades.map((t) => format(new Date(t.date), "yyyy-MM-dd"))).size}
            </p>
          </div>
        </div>

        {/* Calendário */}
        <div className="bg-card border border-border rounded-xl p-4">
          {/* Header dos dias da semana */}
          <div className="grid grid-cols-7 mb-2">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                {d}
              </div>
            ))}
          </div>

          {/* Dias */}
          <div className="grid grid-cols-7 gap-1">
            {blanks.map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {days.map((day) => {
              const dt = dayTrades(day)
              const dayPnl = dt.reduce((acc, t) => acc + Number(t.pnl), 0)
              const hasWin = dt.some((t) => t.result === "WIN")
              const hasLoss = dt.some((t) => t.result === "LOSS")
              const hasTraded = dt.length > 0
              const today_ = isToday(day)

              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-colors relative",
                    today_ && "ring-1 ring-teal",
                    hasTraded
                      ? dayPnl > 0
                        ? "bg-profit/15 text-profit font-semibold"
                        : dayPnl < 0
                        ? "bg-loss/15 text-loss font-semibold"
                        : "bg-muted text-muted-foreground"
                      : "text-muted-foreground/50"
                  )}
                >
                  <span className="text-xs font-mono">{format(day, "d")}</span>
                  {hasTraded && (
                    <span className="text-[9px] font-mono mt-0.5">
                      {dayPnl >= 0 ? "+" : ""}${Math.abs(dayPnl).toFixed(0)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Legenda */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-profit/20" />
              <span className="text-xs text-muted-foreground">Dia lucrativo</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-loss/20" />
              <span className="text-xs text-muted-foreground">Dia negativo</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded ring-1 ring-teal" />
              <span className="text-xs text-muted-foreground">Hoje</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
