"use client"

import { cn, signedUsd } from "@/lib/utils"

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
  const range = maxVal - minVal || 1

  const W = 800
  const H = 160
  const PAD = 8

  // Normaliza para SVG
  function toY(v: number) {
    return PAD + ((maxVal - v) / range) * (H - PAD * 2)
  }

  const step = (W - PAD * 2) / Math.max(points.length - 1, 1)

  const pathD = points
    .map((p, i) => {
      const x = PAD + i * step
      const y = toY(p.cumPnl)
      return `${i === 0 ? "M" : "L"} ${x} ${y}`
    })
    .join(" ")

  // Área preenchida
  const firstX = PAD
  const lastX = PAD + (points.length - 1) * step
  const zeroY = toY(0)
  const areaD = `${pathD} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`

  const finalPnl = points[points.length - 1].cumPnl
  const isPositive = finalPnl >= 0

  // Labels do eixo X (no máximo 7)
  const labelStep = Math.max(1, Math.floor(points.length / 6))
  const xLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1)

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
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? "rgb(34 197 94)" : "rgb(239 68 68)"} stopOpacity="0.25" />
              <stop offset="100%" stopColor={isPositive ? "rgb(34 197 94)" : "rgb(239 68 68)"} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Linha zero */}
          {minVal < 0 && maxVal > 0 && (
            <line
              x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY}
              stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="4 3"
              className="text-muted-foreground"
            />
          )}

          {/* Área */}
          <path d={areaD} fill="url(#equityGradient)" />

          {/* Linha */}
          <path
            d={pathD}
            fill="none"
            stroke={isPositive ? "rgb(34 197 94)" : "rgb(239 68 68)"}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Último ponto */}
          <circle
            cx={PAD + (points.length - 1) * step}
            cy={toY(finalPnl)}
            r="4"
            fill={isPositive ? "rgb(34 197 94)" : "rgb(239 68 68)"}
          />
        </svg>

        {/* Labels do eixo X */}
        <div className="flex justify-between mt-1 px-1">
          {xLabels.map((p, i) => (
            <span key={i} className="text-[9px] text-muted-foreground font-mono">
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
