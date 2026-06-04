import { cn } from "@/lib/utils"
import { ExternalLink } from "lucide-react"

interface Props {
  entryPrice: number
  exitPrice: number
  direction: "LONG" | "SHORT"
  pnlPoints: number
  result: "WIN" | "LOSS" | "BREAKEVEN"
  mfe?: number | null
  mae?: number | null
  instrument: string
  date: Date
}

const TV_SYMBOL: Record<string, string> = {
  NQ: "CME_MINI:NQ1!",
  ES: "CME_MINI:ES1!",
  YM: "CBOT_MINI:YM1!",
  RTY: "CME_MINI:RTY1!",
  MNQ: "CME_MINI:MNQ1!",
  MES: "CME_MINI:MES1!",
}

function tvUrl(instrument: string, date: Date): string {
  const sym = TV_SYMBOL[instrument] ?? instrument
  const ts = Math.floor(date.getTime() / 1000)
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}&interval=5&timestamp=${ts}`
}

export function TradeExecutionChart({ entryPrice, exitPrice, direction, pnlPoints, result, mfe, mae, instrument, date }: Props) {
  const isLong = direction === "LONG"
  const isWin = result === "WIN"
  const isLoss = result === "LOSS"

  // Absolute price levels
  const mfePrice = mfe != null ? (isLong ? entryPrice + mfe : entryPrice - mfe) : null
  const maePrice = mae != null ? (isLong ? entryPrice - mae : entryPrice + mae) : null

  const allPrices = [entryPrice, exitPrice]
  if (mfePrice != null) allPrices.push(mfePrice)
  if (maePrice != null) allPrices.push(maePrice)

  const minP = Math.min(...allPrices)
  const maxP = Math.max(...allPrices)
  const raw = maxP - minP || Math.abs(entryPrice) * 0.005
  const pad = raw * 0.30
  const lo = minP - pad
  const hi = maxP + pad
  const span = hi - lo

  // y% — 0% = top (highest price), 100% = bottom (lowest price)
  const y = (price: number) => `${((hi - price) / span) * 100}%`

  // zone top/bottom as percent numbers for height calculation
  const yn = (price: number) => ((hi - price) / span) * 100

  const entryY = yn(entryPrice)
  const exitY = yn(exitPrice)
  const mfeYn = mfePrice != null ? yn(mfePrice) : null
  const maeYn = maePrice != null ? yn(maePrice) : null

  const profitTop = Math.min(entryY, exitY)
  const profitH = Math.max(Math.abs(exitY - entryY), 1.5)

  const mfeMissedTop = mfeYn != null ? Math.min(mfeYn, Math.min(entryY, exitY)) : null
  const mfeMissedH = mfeYn != null ? Math.abs(Math.min(entryY, exitY) - mfeYn) : null

  const maeRiskTop = maeYn != null ? Math.min(maeYn, Math.max(entryY, exitY)) : null
  const maeRiskH = maeYn != null ? Math.abs(maeYn - Math.max(entryY, exitY)) : null

  const exitEff = mfe != null && mfe > 0 ? Math.round((pnlPoints / mfe) * 100) : null

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Gráfico de Execução</h3>
          <span className={cn(
            "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
            isLong ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
          )}>
            {direction}
          </span>
        </div>
        <a
          href={tvUrl(instrument, date)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-teal transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          TradingView
        </a>
      </div>

      <div className="p-4">
        {/* Chart area */}
        <div className="relative h-52 select-none">

          {/* MAE risk zone */}
          {maeRiskTop != null && maeRiskH != null && maeRiskH > 0.5 && (
            <div
              className="absolute left-0 right-20 bg-loss/6 border-l-2 border-loss/20"
              style={{ top: `${maeRiskTop}%`, height: `${maeRiskH}%` }}
            />
          )}

          {/* Profit / Loss zone */}
          {profitH > 0 && (
            <div
              className={cn(
                "absolute left-0 right-20 border-l-2",
                isWin ? "bg-profit/12 border-profit/40" : isLoss ? "bg-loss/12 border-loss/40" : "bg-muted/20 border-border"
              )}
              style={{ top: `${profitTop}%`, height: `${profitH}%` }}
            />
          )}

          {/* MFE missed zone */}
          {mfeMissedTop != null && mfeMissedH != null && mfeMissedH > 0.5 && (
            <div
              className="absolute left-0 right-20 bg-teal/6 border-l-2 border-teal/20"
              style={{ top: `${mfeMissedTop}%`, height: `${mfeMissedH}%` }}
            />
          )}

          {/* MFE line */}
          {mfePrice != null && mfeYn != null && (
            <div className="absolute left-0 right-0 flex items-center" style={{ top: y(mfePrice), transform: "translateY(-50%)" }}>
              <div className="flex-1 border-t border-dashed border-teal/50 mr-1" />
              <div className="w-20 shrink-0 flex justify-between items-center">
                <span className="text-[9px] text-teal/60 font-mono uppercase">mfe</span>
                <span className="text-[10px] font-mono text-teal/80">{mfePrice.toFixed(0)}</span>
              </div>
            </div>
          )}

          {/* EXIT line */}
          <div className="absolute left-0 right-0 flex items-center" style={{ top: y(exitPrice), transform: "translateY(-50%)" }}>
            <div className={cn("flex-1 border-t-2 mr-1", isWin ? "border-profit" : isLoss ? "border-loss" : "border-muted-foreground")} />
            <div className="w-20 shrink-0 flex justify-between items-center">
              <span className="text-[9px] text-muted-foreground font-mono uppercase">saída</span>
              <span className={cn("text-[11px] font-mono font-bold", isWin ? "text-profit" : isLoss ? "text-loss" : "text-foreground")}>
                {exitPrice.toFixed(0)}
              </span>
            </div>
          </div>

          {/* ENTRY line */}
          <div className="absolute left-0 right-0 flex items-center" style={{ top: y(entryPrice), transform: "translateY(-50%)" }}>
            <div className="flex-1 border-t-2 border-foreground/50 mr-1" />
            <div className="w-20 shrink-0 flex justify-between items-center">
              <span className="text-[9px] text-muted-foreground font-mono uppercase">entrada</span>
              <span className="text-[11px] font-mono font-bold text-foreground/80">{entryPrice.toFixed(0)}</span>
            </div>
          </div>

          {/* MAE line */}
          {maePrice != null && (
            <div className="absolute left-0 right-0 flex items-center" style={{ top: y(maePrice), transform: "translateY(-50%)" }}>
              <div className="flex-1 border-t border-dashed border-loss/50 mr-1" />
              <div className="w-20 shrink-0 flex justify-between items-center">
                <span className="text-[9px] text-loss/60 font-mono uppercase">mae</span>
                <span className="text-[10px] font-mono text-loss/80">{maePrice.toFixed(0)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Stats bar */}
        <div className={cn(
          "mt-3 pt-3 border-t border-border grid gap-3",
          mfe != null ? "grid-cols-3" : "grid-cols-2"
        )}>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">P&L capturado</p>
            <p className={cn("text-sm font-bold font-mono", isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground")}>
              {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(1)} pts
            </p>
          </div>

          {mfe != null && (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">MFE disponível</p>
              <p className="text-sm font-bold font-mono text-teal">+{mfe.toFixed(1)} pts</p>
            </div>
          )}

          {exitEff != null ? (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">Eficiência</p>
              <p className={cn("text-sm font-bold font-mono",
                exitEff >= 70 ? "text-profit" : exitEff >= 45 ? "text-yellow-400" : "text-loss"
              )}>
                {exitEff}%
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">Amplitude</p>
              <p className="text-sm font-bold font-mono text-foreground/70">
                {Math.abs(exitPrice - entryPrice).toFixed(1)}
              </p>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 justify-center">
          {mfe != null && (
            <div className="flex items-center gap-1">
              <div className="w-3 border-t border-dashed border-teal/60" />
              <span className="text-[9px] text-muted-foreground/60">MFE (potencial)</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <div className={cn("w-3 border-t-2", isWin ? "border-profit" : "border-loss")} />
            <span className="text-[9px] text-muted-foreground/60">Saída</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 border-t-2 border-foreground/50" />
            <span className="text-[9px] text-muted-foreground/60">Entrada</span>
          </div>
          {mae != null && (
            <div className="flex items-center gap-1">
              <div className="w-3 border-t border-dashed border-loss/50" />
              <span className="text-[9px] text-muted-foreground/60">MAE (adverso)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
