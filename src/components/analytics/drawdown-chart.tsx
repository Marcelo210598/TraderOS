"use client"

import { cn, signedUsd } from "@/lib/utils"
import { ExplainButton } from "./explain-modal"
import { ScrubPlot, makeYPct, xPct } from "./scrub-plot"

interface DrawdownPoint {
  label: string
  dd: number      // sempre 0 ou negativo
  cumPnl: number  // para tooltip
}

interface DrawdownChartProps {
  points: DrawdownPoint[]
  maxDrawdown: number
  currentDrawdown: number
}

export function DrawdownChart({ points, maxDrawdown, currentDrawdown }: DrawdownChartProps) {
  const hasDrawdown = maxDrawdown > 0

  if (points.length === 0) return null

  const minVal = Math.min(...points.map((p) => p.dd), -1)
  const toY = makeYPct(minVal, 0)
  const count = points.length

  const coords = points.map((p, i) => ({ x: xPct(i, count), y: toY(p.dd) }))
  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ")
  const zeroY = toY(0)
  const areaD = `${pathD} L ${coords[count - 1].x} ${zeroY} L ${coords[0].x} ${zeroY} Z`

  const ticks = Array.from({ length: 4 }, (_, i) => {
    const v = (minVal / 3) * i
    return { y: toY(v), label: v === 0 ? "$0" : `-$${Math.abs(v).toFixed(0)}` }
  })

  const labelStep = Math.max(1, Math.floor(count / 6))
  const xLabels = points.filter((_, i) => i % labelStep === 0 || i === count - 1).map((p) => p.label)
  const dotColor = currentDrawdown > 0 ? "rgb(234 179 8)" : "rgb(239 68 68)"

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Drawdown</h2>
            <ExplainButton topic="drawdown" label="o que é?" />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Distância do pico da equity — quanto você perdeu do melhor momento
          </p>
        </div>
        <div className="flex gap-4 text-right shrink-0 ml-4">
          <div>
            <p className={cn("text-base font-bold font-mono", maxDrawdown > 0 ? "text-loss" : "text-profit")}>
              {maxDrawdown > 0 ? `-$${maxDrawdown.toFixed(0)}` : "$0"}
            </p>
            <p className="text-[10px] text-muted-foreground">max drawdown</p>
          </div>
          <div>
            <p className={cn("text-base font-bold font-mono", currentDrawdown > 0 ? "text-yellow-400" : "text-profit")}>
              {currentDrawdown > 0 ? `-$${currentDrawdown.toFixed(0)}` : "$0"}
            </p>
            <p className="text-[10px] text-muted-foreground">atual</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        {!hasDrawdown ? (
          <div className="flex items-center justify-center gap-2 py-8 text-profit">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-sm font-semibold">Sem drawdown registrado</p>
              <p className="text-xs text-muted-foreground">Sua equity nunca caiu abaixo do pico. Continue assim.</p>
            </div>
          </div>
        ) : (
          <ScrubPlot
            count={count}
            yPcts={coords.map((c) => c.y)}
            ticks={ticks}
            xLabels={xLabels}
            dotColor={dotColor}
            height={160}
            tooltip={(i) => {
              const p = points[i]
              const peakAtPoint = p.cumPnl - p.dd
              return (
                <div className="space-y-0.5">
                  <p className="text-muted-foreground">Trade #{i + 1} · {p.label}</p>
                  <p className={cn("font-mono font-bold text-sm", p.dd < 0 ? "text-loss" : "text-profit")}>
                    {p.dd < 0 ? `-$${Math.abs(p.dd).toFixed(0)}` : "$0"}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">abaixo do pico</span>
                  </p>
                  <p className="font-mono text-muted-foreground">
                    equity {signedUsd(p.cumPnl)} · pico {signedUsd(peakAtPoint)}
                  </p>
                </div>
              )
            }}
          >
            <defs>
              <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(239 68 68)" stopOpacity="0.30" />
                <stop offset="100%" stopColor="rgb(239 68 68)" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <path d={areaD} fill="url(#ddGradient)" />
            <path
              d={pathD} fill="none" stroke="rgb(239 68 68)" strokeWidth="1.5"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            />
          </ScrubPlot>
        )}
      </div>
    </div>
  )
}
