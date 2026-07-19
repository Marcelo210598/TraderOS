import { cn, signedUsd } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus, BookOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface Trade {
  id: string
  dateFormatted: string
  instrument: string
  direction: "LONG" | "SHORT"
  pnl: number
  pnlPoints: number
  result: "WIN" | "LOSS" | "BREAKEVEN"
  setup?: string | null
}

interface RecentTradesProps {
  trades: Trade[]
}

export function RecentTrades({ trades }: RecentTradesProps) {
  if (trades.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Trades Recentes</h2>
          <a href="/journal" className="text-xs text-teal hover:underline font-medium">
            Ver todos
          </a>
        </div>
        <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
          <BookOpen className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-foreground">Nenhum trade registrado</p>
          <p className="text-xs text-muted-foreground">Registre seu primeiro trade no Journal.</p>
          <a
            href="/journal/novo"
            className="mt-2 text-xs text-teal hover:underline font-medium"
          >
            + Novo trade
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Trades Recentes</h2>
        <a href="/journal" className="text-xs text-teal hover:underline font-medium">
          Ver todos
        </a>
      </div>

      <div className="divide-y divide-border">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors"
          >
            <div
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                trade.result === "WIN"
                  ? "bg-profit/10"
                  : trade.result === "LOSS"
                  ? "bg-loss/10"
                  : "bg-muted"
              )}
            >
              {trade.result === "WIN" ? (
                <TrendingUp className="w-4 h-4 text-profit" />
              ) : trade.result === "LOSS" ? (
                <TrendingDown className="w-4 h-4 text-loss" />
              ) : (
                <Minus className="w-4 h-4 text-muted-foreground" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground font-mono">
                  {trade.instrument}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-4 border-0 font-mono",
                    trade.direction === "LONG"
                      ? "bg-profit/10 text-profit"
                      : "bg-loss/10 text-loss"
                  )}
                >
                  {trade.direction}
                </Badge>
                {trade.setup && (
                  <span className="text-xs text-muted-foreground truncate hidden sm:block">
                    · {trade.setup}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{trade.dateFormatted}</p>
            </div>

            <div className="text-right shrink-0">
              <p
                className={cn(
                  "text-sm font-bold font-mono",
                  trade.result === "WIN"
                    ? "text-profit"
                    : trade.result === "LOSS"
                    ? "text-loss"
                    : "text-muted-foreground"
                )}
              >
                {signedUsd(trade.pnl)}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {trade.pnlPoints > 0 ? "+" : ""}
                {trade.pnlPoints.toFixed(2)} pts
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
