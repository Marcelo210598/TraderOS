"use client"

interface DayData {
  label: string
  pnl: number
  trades: number
}

const MOCK_DATA: DayData[] = [
  { label: "Seg", pnl: 412, trades: 3 },
  { label: "Ter", pnl: -200, trades: 2 },
  { label: "Qua", pnl: 625, trades: 4 },
  { label: "Qui", pnl: 187, trades: 2 },
  { label: "Sex", pnl: -112, trades: 3 },
  { label: "Seg", pnl: 350, trades: 2 },
  { label: "Ter", pnl: 212, trades: 5 },
]

export function PerformanceChart() {
  const maxAbs = Math.max(...MOCK_DATA.map((d) => Math.abs(d.pnl)))
  const cumulativePnL = MOCK_DATA.reduce((acc, d) => acc + d.pnl, 0)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Performance da Semana</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos 7 dias de operação</p>
        </div>
        <div className="text-right">
          <p
            className={`text-lg font-bold font-mono ${cumulativePnL >= 0 ? "text-profit" : "text-loss"}`}
          >
            {cumulativePnL >= 0 ? "+" : ""}${cumulativePnL.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground">acumulado</p>
        </div>
      </div>

      <div className="p-4">
        {/* Barras */}
        <div className="flex items-end gap-2 h-28">
          {MOCK_DATA.map((day, i) => {
            const heightPercent = maxAbs > 0 ? (Math.abs(day.pnl) / maxAbs) * 100 : 0
            const isPositive = day.pnl >= 0

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="relative group w-full flex justify-center" style={{ height: `${heightPercent}%`, minHeight: 4 }}>
                  <div
                    className={`w-full rounded-t-sm transition-opacity ${
                      isPositive ? "bg-profit" : "bg-loss"
                    } group-hover:opacity-80`}
                    style={{ height: "100%" }}
                  />
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-md px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <p className={`font-mono font-bold ${isPositive ? "text-profit" : "text-loss"}`}>
                      {isPositive ? "+" : ""}${day.pnl}
                    </p>
                    <p className="text-muted-foreground">{day.trades} trades</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Labels */}
        <div className="flex gap-2 mt-2">
          {MOCK_DATA.map((day, i) => (
            <div key={i} className="flex-1 text-center">
              <span className="text-[10px] text-muted-foreground font-mono">{day.label}</span>
            </div>
          ))}
        </div>

        {/* Linha zero */}
        <div className="mt-3 h-px bg-border/50 relative">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 font-mono">
            $0
          </span>
        </div>
      </div>
    </div>
  )
}
