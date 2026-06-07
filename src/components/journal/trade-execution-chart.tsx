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
  NQ: "CME_MINI:NQ1!", ES: "CME_MINI:ES1!", YM: "CBOT_MINI:YM1!",
  RTY: "CME_MINI:RTY1!", MNQ: "CME_MINI:MNQ1!", MES: "CME_MINI:MES1!",
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

  // All prices as deltas from entry (entry = 0)
  const exitDelta = exitPrice - entryPrice
  const mfeDelta = mfe != null ? (isLong ? +mfe : -mfe) : null
  const maeDelta = mae != null ? (isLong ? -mae : +mae) : null

  // Build the display range — always give enough padding so the trade zone
  // occupies at least 30% of chart height
  const allDeltas = [0, exitDelta, mfeDelta, maeDelta].filter((v): v is number => v != null)
  const rawMax = Math.max(...allDeltas)
  const rawMin = Math.min(...allDeltas)
  const tradeSize = Math.abs(exitDelta)

  // Pad = enough to make the zone cover ~30-40% of chart, minimum 1pt
  const pad = Math.max(tradeSize * 1.2, Math.abs(rawMax - rawMin) * 0.4, 1)
  const displayMax = rawMax + pad
  const displayMin = rawMin - pad
  const displayRange = displayMax - displayMin

  const yPct = (delta: number) => ((displayMax - delta) / displayRange) * 100
  const yPctStr = (delta: number) => `${yPct(delta)}%`

  // Zone (trade body)
  const zoneTopDelta = Math.max(0, exitDelta)
  const zoneBotDelta = Math.min(0, exitDelta)
  const zoneTopY = yPct(zoneTopDelta)
  const zoneBotY = yPct(zoneBotDelta)
  const zoneH = Math.max(zoneBotY - zoneTopY, 2)

  const zoneColor = isWin
    ? { bg: "bg-profit/20", border: "border-profit/50", glow: "shadow-[0_0_8px_rgba(0,200,100,0.2)]" }
    : isLoss
    ? { bg: "bg-loss/20", border: "border-loss/50", glow: "shadow-[0_0_8px_rgba(255,80,80,0.15)]" }
    : { bg: "bg-muted/30", border: "border-border", glow: "" }

  const lineColor = isWin ? "border-profit" : isLoss ? "border-loss" : "border-foreground/40"

  // Exit efficiency
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
        <div className="relative h-52 select-none">

          {/* ── MAE shadow ── */}
          {maeDelta != null && (
            <>
              <div
                className="absolute left-10 right-24 bg-loss/8"
                style={{
                  top: `${Math.min(yPct(0), yPct(maeDelta))}%`,
                  height: `${Math.max(Math.abs(yPct(maeDelta) - yPct(0)), 1)}%`,
                }}
              />
              {/* MAE dashed line */}
              <div
                className="absolute left-0 right-0 flex items-center"
                style={{ top: yPctStr(maeDelta), transform: "translateY(-50%)" }}
              >
                <div className="w-10 shrink-0 text-right pr-1.5">
                  <span className="text-[9px] font-mono text-loss/60">{maeDelta.toFixed(1)}</span>
                </div>
                <div className="flex-1 border-t border-dashed border-loss/35" />
                <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
                  <span className="text-[9px] font-mono text-loss/70">{(isLong ? entryPrice + maeDelta : entryPrice - maeDelta).toFixed(2)}</span>
                  <span className="text-[8px] text-loss/40 font-mono">MAE</span>
                </div>
              </div>
            </>
          )}

          {/* ── MFE missed zone ── */}
          {mfeDelta != null && (
            <>
              <div
                className="absolute left-10 right-24 bg-teal/6"
                style={{
                  top: `${Math.min(yPct(exitDelta), yPct(mfeDelta))}%`,
                  height: `${Math.max(Math.abs(yPct(mfeDelta) - yPct(exitDelta)), 1)}%`,
                }}
              />
              {/* MFE dashed line */}
              <div
                className="absolute left-0 right-0 flex items-center"
                style={{ top: yPctStr(mfeDelta), transform: "translateY(-50%)" }}
              >
                <div className="w-10 shrink-0 text-right pr-1.5">
                  <span className="text-[9px] font-mono text-teal/60">+{mfe!.toFixed(1)}</span>
                </div>
                <div className="flex-1 border-t border-dashed border-teal/35" />
                <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
                  <span className="text-[9px] font-mono text-teal/80">{(isLong ? entryPrice + mfe! : entryPrice - mfe!).toFixed(2)}</span>
                  <span className="text-[8px] text-teal/50 font-mono">MFE</span>
                </div>
              </div>
            </>
          )}

          {/* ── Trade BODY (filled zone) ── */}
          <div
            className={cn(
              "absolute left-10 right-24 border-l-2 rounded-sm",
              zoneColor.bg, zoneColor.border, zoneColor.glow
            )}
            style={{ top: `${zoneTopY}%`, height: `${zoneH}%` }}
          />

          {/* ── EXIT line ── */}
          <div
            className="absolute left-0 right-0 flex items-center z-10"
            style={{ top: yPctStr(exitDelta), transform: "translateY(-50%)" }}
          >
            <div className="w-10 shrink-0 text-right pr-1.5">
              <span className={cn("text-[10px] font-mono font-bold",
                isWin ? "text-profit" : isLoss ? "text-loss" : "text-foreground/60"
              )}>
                {exitDelta >= 0 ? "+" : ""}{exitDelta.toFixed(2)}
              </span>
            </div>
            <div className={cn("flex-1 border-t-2", lineColor)} />
            <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
              <span className={cn("text-[11px] font-mono font-bold",
                isWin ? "text-profit" : isLoss ? "text-loss" : "text-foreground/80"
              )}>
                {exitPrice.toFixed(2)}
              </span>
              <span className="text-[9px] text-muted-foreground/50 font-mono">saída</span>
            </div>
          </div>

          {/* ── ENTRY line ── */}
          <div
            className="absolute left-0 right-0 flex items-center z-10"
            style={{ top: yPctStr(0), transform: "translateY(-50%)" }}
          >
            <div className="w-10 shrink-0 text-right pr-1.5">
              <span className="text-[10px] font-mono text-foreground/50">0</span>
            </div>
            <div className="flex-1 border-t-2 border-foreground/30" />
            <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
              <span className="text-[11px] font-mono font-semibold text-foreground/70">
                {entryPrice.toFixed(2)}
              </span>
              <span className="text-[9px] text-muted-foreground/50 font-mono">entrada</span>
            </div>
          </div>

          {/* pts axis label */}
          <div className="absolute left-0 top-1">
            <span className="text-[9px] text-muted-foreground/30 font-mono">pts</span>
          </div>
        </div>

        {/* Stats bar */}
        <div className={cn(
          "mt-3 pt-3 border-t border-border grid gap-3",
          exitEff != null ? "grid-cols-3" : mfe != null ? "grid-cols-3" : "grid-cols-2"
        )}>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Capturado</p>
            <p className={cn("text-sm font-bold font-mono",
              isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground"
            )}>
              {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts
            </p>
          </div>

          {mfe != null ? (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">MFE</p>
              <p className="text-sm font-bold font-mono text-teal">+{mfe.toFixed(1)} pts</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">Amplitude</p>
              <p className="text-sm font-bold font-mono text-foreground/70">
                {Math.abs(exitDelta).toFixed(2)} pts
              </p>
            </div>
          )}

          {exitEff != null && (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">Eficiência</p>
              <p className={cn("text-sm font-bold font-mono",
                exitEff >= 70 ? "text-profit" : exitEff >= 40 ? "text-yellow-400" : "text-loss"
              )}>
                {exitEff}%
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
