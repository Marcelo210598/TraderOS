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

  // Convert everything to POINT OFFSETS from entry (entry = 0)
  // exitDelta: how many pts the price moved (positive = price went up)
  const exitDelta = exitPrice - entryPrice

  // MFE/MAE in price offset terms
  // MFE: max favorable movement
  // For LONG: price went UP (positive delta)
  // For SHORT: price went DOWN (negative delta)
  const mfeDelta = mfe != null ? (isLong ? +mfe : -mfe) : null
  // MAE: max adverse movement
  // For LONG: price went DOWN (negative delta)
  // For SHORT: price went UP (positive delta)
  const maeDelta = mae != null ? (isLong ? -mae : +mae) : null

  // Collect all deltas to determine display range
  const allDeltas = [0, exitDelta]
  if (mfeDelta != null) allDeltas.push(mfeDelta)
  if (maeDelta != null) allDeltas.push(maeDelta)

  const rawMax = Math.max(...allDeltas)
  const rawMin = Math.min(...allDeltas)
  const rawRange = rawMax - rawMin

  // Minimum visible range: at least 15 pts for readability
  const MIN_RANGE = 15
  const pad = Math.max(rawRange * 0.28, (MIN_RANGE - rawRange) / 2 + rawRange * 0.15)
  const displayMax = rawMax + pad
  const displayMin = rawMin - pad
  const displayRange = displayMax - displayMin

  // Map a delta (in pts from entry) to SVG y% (0 = top, 100 = bottom)
  const yPct = (delta: number): string =>
    `${((displayMax - delta) / displayRange) * 100}%`
  const yNum = (delta: number): number =>
    ((displayMax - delta) / displayRange) * 100

  // Zone calculations
  const zoneTopDelta = Math.max(0, exitDelta)
  const zoneBotDelta = Math.min(0, exitDelta)
  const zoneTopPct = yNum(zoneTopDelta)
  const zoneBotPct = yNum(zoneBotDelta)
  const zoneHeight = Math.max(zoneBotPct - zoneTopPct, 1.5)

  // MFE "missed" zone (between exit and mfe)
  const mfeMissedTopPct = mfeDelta != null ? yNum(Math.max(mfeDelta, exitDelta)) : null
  const mfeMissedBotPct = mfeDelta != null ? yNum(Math.min(mfeDelta, exitDelta)) : null

  // MAE "held through" zone (between entry and mae)
  const maeShadowTopPct = maeDelta != null ? yNum(Math.max(0, maeDelta)) : null
  const maeShadowBotPct = maeDelta != null ? yNum(Math.min(0, maeDelta)) : null

  // Exit efficiency
  const exitEff = mfe != null && mfe > 0 ? Math.round((pnlPoints / mfe) * 100) : null

  // Color
  const zoneColor = isWin ? "bg-profit/15 border-l-2 border-profit/40"
    : isLoss ? "bg-loss/15 border-l-2 border-loss/40"
    : "bg-muted/20 border-l-2 border-border"

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
        {/* Chart area — point-relative scale */}
        <div className="relative h-52 select-none">

          {/* MAE shadow zone */}
          {maeShadowTopPct != null && maeShadowBotPct != null && (
            <div
              className="absolute left-10 right-24 bg-loss/5 border-l border-loss/20"
              style={{
                top: `${Math.min(maeShadowTopPct, maeShadowBotPct)}%`,
                height: `${Math.max(Math.abs(maeShadowBotPct - maeShadowTopPct), 1)}%`,
              }}
            />
          )}

          {/* Profit / Loss zone */}
          <div
            className={cn("absolute left-10 right-24", zoneColor)}
            style={{ top: `${zoneTopPct}%`, height: `${zoneHeight}%` }}
          />

          {/* MFE missed zone */}
          {mfeMissedTopPct != null && mfeMissedBotPct != null && (
            <div
              className="absolute left-10 right-24 bg-teal/6 border-l border-teal/25"
              style={{
                top: `${Math.min(mfeMissedTopPct, mfeMissedBotPct)}%`,
                height: `${Math.max(Math.abs(mfeMissedBotPct - mfeMissedTopPct), 1)}%`,
              }}
            />
          )}

          {/* ── MFE line ── */}
          {mfeDelta != null && (
            <PriceLine
              yPct={yPct(mfeDelta)}
              leftLabel={`+${mfe!.toFixed(1)}`}
              rightLabel={`${(isLong ? entryPrice + mfe! : entryPrice - mfe!).toFixed(1)}`}
              rightTag="MFE"
              lineStyle="dashed"
              color="teal"
            />
          )}

          {/* ── EXIT line ── */}
          <PriceLine
            yPct={yPct(exitDelta)}
            leftLabel={`${exitDelta >= 0 ? "+" : ""}${exitDelta.toFixed(2)}`}
            rightLabel={exitPrice.toFixed(2)}
            rightTag="saída"
            lineStyle="solid-thick"
            color={isWin ? "profit" : isLoss ? "loss" : "neutral"}
          />

          {/* ── ENTRY line ── */}
          <PriceLine
            yPct={yPct(0)}
            leftLabel="0"
            rightLabel={entryPrice.toFixed(2)}
            rightTag="entrada"
            lineStyle="solid-thick"
            color="neutral"
          />

          {/* ── MAE line ── */}
          {maeDelta != null && (
            <PriceLine
              yPct={yPct(maeDelta)}
              leftLabel={`${maeDelta.toFixed(1)}`}
              rightLabel={`${(isLong ? entryPrice + maeDelta : entryPrice + maeDelta).toFixed(1)}`}
              rightTag="MAE"
              lineStyle="dashed"
              color="loss"
            />
          )}

          {/* Left axis label */}
          <div className="absolute left-0 top-1">
            <span className="text-[9px] text-muted-foreground/40 font-mono">pts</span>
          </div>
        </div>

        {/* Stats */}
        <div className={cn(
          "mt-3 pt-3 border-t border-border grid gap-3",
          exitEff != null ? "grid-cols-3" : "grid-cols-2"
        )}>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">P&L capturado</p>
            <p className={cn("text-sm font-bold font-mono",
              isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground"
            )}>
              {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts
            </p>
          </div>

          {mfe != null ? (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">MFE disponível</p>
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

// ── Sub-component: single horizontal price line ────────────────────────────
interface PriceLineProps {
  yPct: string
  leftLabel: string
  rightLabel: string
  rightTag: string
  lineStyle: "solid-thick" | "dashed"
  color: "profit" | "loss" | "teal" | "neutral"
}

const colorMap = {
  profit: { line: "border-profit", text: "text-profit", dim: "text-profit/60" },
  loss: { line: "border-loss", text: "text-loss", dim: "text-loss/60" },
  teal: { line: "border-teal/60", text: "text-teal/80", dim: "text-teal/50" },
  neutral: { line: "border-foreground/40", text: "text-foreground/70", dim: "text-muted-foreground/60" },
}

function PriceLine({ yPct, leftLabel, rightLabel, rightTag, lineStyle, color }: PriceLineProps) {
  const c = colorMap[color]
  return (
    <div
      className="absolute left-0 right-0 flex items-center gap-0"
      style={{ top: yPct, transform: "translateY(-50%)" }}
    >
      {/* Left label (pts offset) */}
      <div className="w-10 shrink-0 text-right pr-1.5">
        <span className={cn("text-[10px] font-mono font-medium", c.dim)}>{leftLabel}</span>
      </div>

      {/* Line */}
      <div className={cn(
        "flex-1",
        lineStyle === "solid-thick" ? `border-t-2 ${c.line}` : `border-t border-dashed ${c.line}`
      )} />

      {/* Right label (price + tag) */}
      <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
        <span className={cn("text-[10px] font-mono font-bold", c.text)}>{rightLabel}</span>
        <span className="text-[9px] text-muted-foreground/50 font-mono uppercase">{rightTag}</span>
      </div>
    </div>
  )
}
