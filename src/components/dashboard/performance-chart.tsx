"use client"

interface DayData {
  label: string
  pnl: number
  trades: number
}

interface PerformanceChartProps {
  data: DayData[]
}

export function PerformanceChart({ data }: PerformanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Performance</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Últimos 7 dias</p>
          </div>
        </div>
        <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
          <p className="text-3xl">📊</p>
          <p className="text-sm font-medium text-foreground">Nenhum trade ainda</p>
          <p className="text-xs text-muted-foreground">Registre seu primeiro trade para ver o gráfico aqui.</p>
        </div>
      </div>
    )
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)))
  const cumulativePnL = data.reduce((acc, d) => acc + d.pnl, 0)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos 7 dias</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold font-mono ${cumulativePnL >= 0 ? "text-profit" : "text-loss"}`}>
            {cumulativePnL >= 0 ? "+" : ""}${cumulativePnL.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground">acumulado</p>
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-end gap-2 h-40">
          {data.map((day, i) => {
            const heightPercent = maxAbs > 0 ? (Math.abs(day.pnl) / maxAbs) * 100 : 0
            const isPositive = day.pnl >= 0

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div
                  className="relative group w-full flex justify-center"
                  style={{ height: `${heightPercent}%`, minHeight: 4 }}
                >
                  <div
                    className={`w-full rounded-t-sm transition-opacity ${
                      isPositive ? "bg-profit" : "bg-loss"
                    } group-hover:opacity-80`}
                    style={{ height: "100%" }}
                  />
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-md px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <p className={`font-mono font-bold ${isPositive ? "text-profit" : "text-loss"}`}>
                      {isPositive ? "+" : ""}${day.pnl.toFixed(0)}
                    </p>
                    <p className="text-muted-foreground">{day.trades} trades</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex gap-2 mt-2">
          {data.map((day, i) => (
            <div key={i} className="flex-1 text-center">
              <span className="text-[10px] text-muted-foreground font-mono">{day.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 h-px bg-border/50 relative">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 font-mono">
            $0
          </span>
        </div>
      </div>
    </div>
  )
}
