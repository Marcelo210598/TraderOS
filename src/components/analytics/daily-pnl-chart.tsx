"use client"

import { useState } from "react"
import { cn, signedUsd } from "@/lib/utils"
import type { DayPnl } from "@/lib/analytics-insights"

// "2026-09-22" -> "22/09"
const shortDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`

export function DailyPnlChart({ days }: { days: DayPnl[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.pnl)), 1)
  const info = selected != null ? days[selected] : null

  return (
    <div>
      <p className="min-h-5 text-xs mb-2 font-mono">
        {info ? (
          <>
            <span className="text-muted-foreground">{shortDay(info.key)} · {info.trades} trade{info.trades > 1 ? "s" : ""} · </span>
            <span className={cn("font-bold", info.pnl >= 0 ? "text-profit" : "text-loss")}>{signedUsd(info.pnl)}</span>
          </>
        ) : (
          <span className="text-muted-foreground/70 font-sans">Toque numa barra pra ver o dia</span>
        )}
      </p>

      <div className="overflow-x-auto">
        <div className="relative h-36" style={{ minWidth: Math.max(days.length * 22, 0) }}>
          <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
          <div className="absolute inset-0 flex items-stretch gap-1">
            {days.map((d, i) => {
              const h = Math.max((Math.abs(d.pnl) / maxAbs) * 50, 2)
              return (
                <button
                  key={d.key}
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onMouseLeave={() => setSelected(null)}
                  onClick={() => setSelected(i)}
                  aria-label={`${shortDay(d.key)}: ${signedUsd(d.pnl)}`}
                  className="relative flex-1 min-w-[14px] group"
                >
                  <span
                    className={cn(
                      "absolute left-0 right-0 rounded-sm transition-opacity",
                      d.pnl >= 0 ? "bottom-1/2 bg-profit/70" : "top-1/2 bg-loss/70",
                      selected === i ? "opacity-100" : "opacity-80 group-hover:opacity-100",
                    )}
                    style={{ height: `${h}%` }}
                  />
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex gap-1 mt-1" style={{ minWidth: Math.max(days.length * 22, 0) }}>
          {days.map((d, i) => (
            <span key={d.key} className="flex-1 min-w-[14px] text-center text-[9px] text-muted-foreground font-mono">
              {days.length <= 10 || i % Math.ceil(days.length / 8) === 0 ? shortDay(d.key) : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
