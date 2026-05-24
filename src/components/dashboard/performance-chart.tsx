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
  const hasAnyTrades = data.some((d) => d.trades > 0)

  if (!hasAnyTrades) {
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
          <p className="text-xs text-muted-foreground">
            Registre seu primeiro trade para ver o gráfico aqui.
          </p>
        </div>
      </div>
    )
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)), 1)
  const cumulativePnL = data.reduce((acc, d) => acc + d.pnl, 0)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos 7 dias</p>
        </div>
        <div className="text-right">
          <p
            className={`text-lg font-bold font-mono ${
              cumulativePnL >= 0 ? "text-profit" : "text-loss"
            }`}
          >
            {cumulativePnL >= 0 ? "+" : ""}${cumulativePnL.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground">acumulado</p>
        </div>
      </div>

      <div className="px-5 pt-4 pb-5">
        {/* Área do gráfico */}
        <div className="flex items-end gap-1.5" style={{ height: 140 }}>
          {data.map((day, i) => {
            const isEmpty = day.trades === 0
            // Limita a 80% da altura máxima para caber o valor acima
            const barHeight = isEmpty
              ? 3
              : Math.max(Math.round((Math.abs(day.pnl) / maxAbs) * 112), 6)
            const isPositive = day.pnl > 0

            return (
              <div
                key={i}
                className="relative flex-1 flex flex-col items-center justify-end"
                style={{ height: 140 }}
              >
                {/* Valor acima da barra */}
                {!isEmpty && (
                  <span
                    className={`text-[9px] font-mono font-bold mb-1 leading-none ${
                      isPositive ? "text-profit" : "text-loss"
                    }`}
                  >
                    {isPositive ? "+" : ""}$
                    {Math.abs(day.pnl) >= 1000
                      ? `${(Math.abs(day.pnl) / 1000).toFixed(1)}k`
                      : Math.abs(day.pnl).toFixed(0)}
                  </span>
                )}

                {/* Barra */}
                <div
                  className={`group relative w-full rounded-t-sm transition-opacity hover:opacity-80 ${
                    isEmpty
                      ? "bg-muted/40 rounded-sm"
                      : isPositive
                      ? "bg-profit"
                      : "bg-loss"
                  }`}
                  style={{ height: barHeight }}
                >
                  {/* Tooltip */}
                  {!isEmpty && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                      <p
                        className={`font-mono font-bold ${
                          isPositive ? "text-profit" : "text-loss"
                        }`}
                      >
                        {isPositive ? "+" : ""}${day.pnl.toFixed(2)}
                      </p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">
                        {day.trades} trade{day.trades > 1 ? "s" : ""}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Linha zero */}
        <div className="h-px bg-border/60 my-1" />

        {/* Labels de data */}
        <div className="flex gap-1.5">
          {data.map((day, i) => (
            <div key={i} className="flex-1 text-center">
              <span
                className={`text-[9px] font-mono ${
                  day.trades > 0 ? "text-muted-foreground" : "text-muted-foreground/40"
                }`}
              >
                {day.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
