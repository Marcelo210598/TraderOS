"use client"

import { cn, signedUsd } from "@/lib/utils"
import { ScrubPlot, formatAxis, makeYPct, xPct } from "./scrub-plot"

interface Point {
  label: string
  cumPnl: number
}

interface EquityCurveProps {
  points: Point[]
}

export function EquityCurve({ points }: EquityCurveProps) {
  if (points.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Equity Curve</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Evolução do P&L acumulado</p>
        </div>
        <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
          <p className="text-3xl">📈</p>
          <p className="text-sm font-medium text-foreground">Nenhum trade ainda</p>
          <p className="text-xs text-muted-foreground">Registre trades para ver a evolução da sua conta.</p>
        </div>
      </div>
    )
  }

  const values = points.map((p) => p.cumPnl)
  const minVal = Math.min(...values, 0)
  const maxVal = Math.max(...values, 0)
  const toY = makeYPct(minVal, maxVal)
  const count = points.length

  const coords = points.map((p, i) => ({ x: xPct(i, count), y: toY(p.cumPnl) }))
  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ")
  const zeroY = toY(0)
  const areaD = `${pathD} L ${coords[count - 1].x} ${zeroY} L ${coords[0].x} ${zeroY} Z`

  const finalPnl = points[count - 1].cumPnl
  const isPositive = finalPnl >= 0
  const color = isPositive ? "rgb(34 197 94)" : "rgb(239 68 68)"

  // 5 marcas no eixo Y, do topo ao fundo
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = maxVal - ((maxVal - minVal) / 4) * i
    return { y: toY(v), label: formatAxis(v) }
  })

  // Labels do eixo X (no máximo 7)
  const labelStep = Math.max(1, Math.floor(count / 6))
  const xLabels = points.filter((_, i) => i % labelStep === 0 || i === count - 1).map((p) => p.label)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Equity Curve</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Evolução do P&L acumulado — {points.length} trades</p>
        </div>
        <div className="text-right">
          <p className={cn("text-lg font-bold font-mono", isPositive ? "text-profit" : "text-loss")}>
            {signedUsd(finalPnl)}
          </p>
          <p className="text-xs text-muted-foreground">acumulado</p>
        </div>
      </div>

      <div className="px-5 py-4">
        <ScrubPlot
          count={count}
          yPcts={coords.map((c) => c.y)}
          ticks={ticks}
          xLabels={xLabels}
          dotColor={color}
          tooltip={(i) => {
            const p = points[i]
            const delta = i > 0 ? p.cumPnl - points[i - 1].cumPnl : p.cumPnl
            return (
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Trade #{i + 1} · {p.label}</p>
                <p className={cn("font-mono font-bold text-sm", p.cumPnl >= 0 ? "text-profit" : "text-loss")}>
                  {signedUsd(p.cumPnl)} <span className="text-[10px] font-normal text-muted-foreground">acumulado</span>
                </p>
                <p className={cn("font-mono", delta >= 0 ? "text-profit" : "text-loss")}>
                  {signedUsd(delta)} <span className="text-[10px] text-muted-foreground">neste trade</span>
                </p>
              </div>
            )
          }}
        >
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {minVal < 0 && maxVal > 0 && (
            <line
              x1="0" x2="100" y1={zeroY} y2={zeroY}
              stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke" className="text-muted-foreground"
            />
          )}
          <path d={areaD} fill="url(#equityGradient)" />
          <path
            d={pathD} fill="none" stroke={color} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          />
        </ScrubPlot>
      </div>
    </div>
  )
}
