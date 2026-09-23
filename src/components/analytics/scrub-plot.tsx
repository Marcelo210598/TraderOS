"use client"

import { useRef, useState, type ReactNode, type PointerEvent } from "react"

// Área de plot compartilhada (Equity Curve + Drawdown): eixo Y com números,
// crosshair + tooltip no hover (mouse) e no toque/arraste (celular).
// O SVG usa viewBox 0-100 com preserveAspectRatio="none" e os textos/pontos
// são HTML posicionado em % — assim nada fica distorcido em telas diferentes.

const PLOT_TOP = 6
const PLOT_BOTTOM = 94

export function formatAxis(v: number) {
  const abs = Math.abs(v)
  const txt = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0)
  return `${v < 0 ? "-" : ""}$${txt}`
}

export const xPct = (i: number, count: number) => (count <= 1 ? 50 : (i / (count - 1)) * 100)

export function makeYPct(min: number, max: number) {
  const range = max - min || 1
  return (v: number) => PLOT_TOP + ((max - v) / range) * (PLOT_BOTTOM - PLOT_TOP)
}

interface ScrubPlotProps {
  count: number
  yPcts: number[]
  ticks: { y: number; label: string }[]
  xLabels: string[]
  dotColor: string
  height?: number
  tooltip: (index: number) => ReactNode
  children: ReactNode
}

export function ScrubPlot({ count, yPcts, ticks, xLabels, dotColor, height = 180, tooltip, children }: ScrubPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)

  function indexFromPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    return count <= 1 ? 0 : Math.round(ratio * (count - 1))
  }

  function handlePointer(e: PointerEvent<HTMLDivElement>) {
    const idx = indexFromPointer(e)
    if (idx != null) setActive(idx)
  }

  const shown = active ?? count - 1
  const x = xPct(shown, count)
  const align = x > 65 ? "-100%" : x < 35 ? "0%" : "-50%"

  return (
    <div>
      <div className="flex" style={{ height }}>
        {/* Eixo Y */}
        <div className="relative w-12 shrink-0">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground/70 font-mono"
              style={{ top: `${t.y}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>

        {/* Plot (captura mouse + toque; pan-y mantém o scroll vertical da página) */}
        <div
          ref={plotRef}
          className="relative flex-1 cursor-crosshair select-none"
          style={{ touchAction: "pan-y" }}
          onPointerDown={handlePointer}
          onPointerMove={handlePointer}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
            {ticks.map((t, i) => (
              <line
                key={i}
                x1="0" x2="100" y1={t.y} y2={t.y}
                stroke="currentColor" strokeOpacity="0.08" strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                className="text-muted-foreground"
              />
            ))}
            {children}
          </svg>

          {/* Crosshair vertical (só com ponto ativo) */}
          {active != null && (
            <div className="absolute top-0 bottom-0 w-px bg-muted-foreground/30 pointer-events-none" style={{ left: `${x}%` }} />
          )}

          {/* Ponto (último por padrão, ativo ao interagir) */}
          <div
            className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none ring-2 ring-card"
            style={{ left: `${x}%`, top: `${yPcts[shown]}%`, background: dotColor }}
          />

          {/* Tooltip */}
          {active != null && (
            <div
              className="absolute z-10 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
              style={{ left: `${x}%`, top: 0, transform: `translateX(${align})` }}
            >
              {tooltip(active)}
            </div>
          )}
        </div>
      </div>

      {/* Eixo X */}
      <div className="flex justify-between mt-1.5 pl-12 pr-1">
        {xLabels.map((l, i) => (
          <span key={i} className="text-[10px] text-muted-foreground font-mono">{l}</span>
        ))}
      </div>
    </div>
  )
}
