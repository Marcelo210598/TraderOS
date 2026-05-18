import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface Trade {
  id: string
  date: string
  instrument: string
  direction: "LONG" | "SHORT"
  pnl: number
  pnlPoints: number
  result: "WIN" | "LOSS" | "BREAKEVEN"
  setup?: string
}

const MOCK_TRADES: Trade[] = [
  {
    id: "1",
    date: "Hoje, 09:47",
    instrument: "NQ",
    direction: "LONG",
    pnl: 412.5,
    pnlPoints: 8.25,
    result: "WIN",
    setup: "ICT OB",
  },
  {
    id: "2",
    date: "Hoje, 10:15",
    instrument: "NQ",
    direction: "SHORT",
    pnl: -200,
    pnlPoints: -4.0,
    result: "LOSS",
    setup: "BOS Reversal",
  },
  {
    id: "3",
    date: "Ontem, 14:32",
    instrument: "ES",
    direction: "LONG",
    pnl: 187.5,
    pnlPoints: 3.75,
    result: "WIN",
    setup: "VWAP Bounce",
  },
  {
    id: "4",
    date: "Ontem, 09:05",
    instrument: "NQ",
    direction: "LONG",
    pnl: 0,
    pnlPoints: 0,
    result: "BREAKEVEN",
    setup: "ICT OB",
  },
  {
    id: "5",
    date: "16/05, 10:22",
    instrument: "NQ",
    direction: "SHORT",
    pnl: 625,
    pnlPoints: 12.5,
    result: "WIN",
    setup: "Fair Value Gap",
  },
]

export function RecentTrades() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Trades Recentes</h2>
        <a href="/journal" className="text-xs text-teal hover:underline font-medium">
          Ver todos
        </a>
      </div>

      <div className="divide-y divide-border">
        {MOCK_TRADES.map((trade) => (
          <div key={trade.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
            {/* Direção */}
            <div
              className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                trade.result === "WIN"
                  ? "bg-profit/10"
                  : trade.result === "LOSS"
                  ? "bg-loss/10"
                  : "bg-muted"
              )}
            >
              {trade.result === "WIN" ? (
                <TrendingUp className="w-3.5 h-3.5 text-profit" />
              ) : trade.result === "LOSS" ? (
                <TrendingDown className="w-3.5 h-3.5 text-loss" />
              ) : (
                <Minus className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground font-mono">
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
                    • {trade.setup}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{trade.date}</p>
            </div>

            {/* PnL */}
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
                {trade.pnl > 0 ? "+" : ""}
                {trade.pnl === 0 ? "0" : `$${Math.abs(trade.pnl).toFixed(0)}`}
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
