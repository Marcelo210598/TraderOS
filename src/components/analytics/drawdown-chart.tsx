"use client"

import { cn } from "@/lib/utils"

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

  const W = 800
  const H = 140
  const PAD = 8

  const minVal = Math.min(...points.map((p) => p.dd), -1)
  const maxVal = 0
  const range = maxVal - minVal || 1

  function toY(v: number) {
    return PAD + ((maxVal - v) / range) * (H - PAD * 2)
  }

  const step = (W - PAD * 2) / Math.max(points.length - 1, 1)

  const pathD = points
    .map((p, i) => {
      const x = PAD + i * step
      const y = toY(p.dd)
      return `${i === 0 ? "M" : "L"} ${x} ${y}`
    })
    .join(" ")

  const firstX = PAD
  const lastX = PAD + (points.length - 1) * step
  const zeroY = toY(0)
  const areaD = `${pathD} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`

  // Ponto de maior drawdown
  const worstIdx = points.reduce((acc, p, i) => (p.dd < points[acc].dd ? i : acc), 0)
  const worstX = PAD + worstIdx * step
  const worstY = toY(points[worstIdx].dd)

  // Labels do eixo X (até 7)
  const labelStep = Math.max(1, Math.floor(points.length / 6))
  const xLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Drawdown</h2>
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
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
              <defs>
                <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(239 68 68)" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="rgb(239 68 68)" stopOpacity="0.04" />
                </linearGradient>
              </defs>

              {/* Linha zero (topo) */}
              <line
                x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY}
                stroke="currentColor" strokeOpacity="0.15" strokeWidth="1"
                className="text-muted-foreground"
              />

              {/* Grades horizontais */}
              {[0.25, 0.5, 0.75].map((ratio) => {
                const yPos = PAD + ratio * (H - PAD * 2)
                const val = maxVal - ratio * range
                return (
                  <g key={ratio}>
                    <line
                      x1={PAD} y1={yPos} x2={W - PAD} y2={yPos}
                      stroke="currentColor" strokeOpacity="0.07" strokeWidth="1"
                      className="text-muted-foreground"
                    />
                    <text
                      x={PAD + 2} y={yPos - 3}
                      fontSize="9" fill="currentColor" fillOpacity="0.35"
                      className="text-muted-foreground font-mono"
                    >
                      {val >= 0 ? "" : `-$${Math.abs(val).toFixed(0)}`}
                    </text>
                  </g>
                )
              })}

              {/* Área */}
              <path d={areaD} fill="url(#ddGradient)" />

              {/* Linha */}
              <path
                d={pathD}
                fill="none"
                stroke="rgb(239 68 68)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {/* Ponto de pior drawdown */}
              {hasDrawdown && (
                <g>
                  <circle cx={worstX} cy={worstY} r="4" fill="rgb(239 68 68)" />
                  <text
                    x={Math.min(worstX + 6, W - 60)}
                    y={worstY - 6}
                    fontSize="9"
                    fill="rgb(239 68 68)"
                    className="font-mono font-bold"
                  >
                    {`-$${Math.abs(points[worstIdx].dd).toFixed(0)}`}
                  </text>
                </g>
              )}

              {/* Ponto atual */}
              {currentDrawdown > 0 && (
                <circle
                  cx={lastX}
                  cy={toY(points[points.length - 1].dd)}
                  r="3"
                  fill="rgb(234 179 8)"
                />
              )}
            </svg>

            <div className="flex justify-between mt-1 px-1">
              {xLabels.map((p, i) => (
                <span key={i} className="text-[9px] text-muted-foreground font-mono">
                  {p.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
