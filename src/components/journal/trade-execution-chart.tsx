import { cn } from "@/lib/utils"

interface Props {
  entryPrice: number
  exitPrice: number
  direction: "LONG" | "SHORT"
  pnlPoints: number
  result: "WIN" | "LOSS" | "BREAKEVEN"
  mfe?: number | null
  mae?: number | null
}

export function TradeExecutionChart({ entryPrice, exitPrice, direction, pnlPoints, result, mfe, mae }: Props) {
  const isLong = direction === "LONG"
  const isWin = result === "WIN"
  const isLoss = result === "LOSS"

  // All prices as deltas from entry (entry = 0)
  const exitDelta = exitPrice - entryPrice
  const mfeDelta = mfe != null ? (isLong ? +mfe : -mfe) : null
  const maeDelta = mae != null ? (isLong ? -mae : +mae) : null

  // Build the display range — always give enough padding so the trade zone
  // occupies at least 30% of chart height
  const allDeltas = [0, exitDelta, mfeDelta, maeDelta].filter((v): v is number => v != null)
  const rawMax = Math.max(...allDeltas)
  const rawMin = Math.min(...allDeltas)
  const tradeSize = Math.abs(exitDelta)

  // Pad = enough to make the zone cover ~30-40% of chart, minimum 1pt
  const pad = Math.max(tradeSize * 1.2, Math.abs(rawMax - rawMin) * 0.4, 1)
  const displayMax = rawMax + pad
  const displayMin = rawMin - pad
  const displayRange = displayMax - displayMin

  const yPct = (delta: number) => ((displayMax - delta) / displayRange) * 100
  const yPctStr = (delta: number) => `${yPct(delta)}%`

  // Corpo da vela (entrada -> saída) — igual open/close de um candle real
  const bodyTopDelta = Math.max(0, exitDelta)
  const bodyBotDelta = Math.min(0, exitDelta)
  const bodyTopY = yPct(bodyTopDelta)
  const bodyBotY = yPct(bodyBotDelta)
  const bodyH = Math.max(bodyBotY - bodyTopY, 3)

  // Pavio (wick) — do ponto mais favorável (MFE) ao mais adverso (MAE) tocado
  // durante o trade, igual high/low de um candle real. Sem MFE/MAE, o pavio
  // encolhe pro próprio corpo (sem inventar dado que não existe).
  const highDelta = Math.max(0, exitDelta, mfeDelta ?? -Infinity)
  const lowDelta = Math.min(0, exitDelta, maeDelta ?? Infinity)
  const wickTopY = yPct(highDelta)
  const wickBotY = yPct(lowDelta)

  const zoneColor = isWin
    ? { bg: "bg-profit/30", border: "border-profit", glow: "shadow-[0_0_12px_rgba(0,200,100,0.25)]" }
    : isLoss
    ? { bg: "bg-loss/30", border: "border-loss", glow: "shadow-[0_0_12px_rgba(255,80,80,0.2)]" }
    : { bg: "bg-muted/40", border: "border-border", glow: "" }
  const wickColor = isWin ? "bg-profit/60" : isLoss ? "bg-loss/60" : "bg-foreground/30"

  const lineColor = isWin ? "border-profit" : isLoss ? "border-loss" : "border-foreground/40"

  // Quando MAE/MFE bate exatamente na entrada ou na saída (ex: stop estourado
  // sem devolver nada — o caso mais comum de todos), as duas linhas caem na
  // MESMA altura e os textos ficam sobrepostos/ilegíveis. Em vez de desenhar
  // uma linha própria pra esses casos, vira um selinho colado na linha que já
  // existe (entrada ou saída).
  const near = (a: number, b: number) => Math.abs(yPct(a) - yPct(b)) < 4
  const maeMergesExit = maeDelta != null && near(maeDelta, exitDelta)
  const maeMergesEntry = maeDelta != null && !maeMergesExit && near(maeDelta, 0)
  const showMaeRow = maeDelta != null && !maeMergesExit && !maeMergesEntry
  const mfeMergesExit = mfeDelta != null && near(mfeDelta, exitDelta)
  const mfeMergesEntry = mfeDelta != null && !mfeMergesExit && near(mfeDelta, 0)
  const showMfeRow = mfeDelta != null && !mfeMergesExit && !mfeMergesEntry

  function Badge({ label, tone }: { label: string; tone: "profit" | "loss" }) {
    return (
      <span className={cn(
        "text-[8px] font-mono font-bold px-1 py-px rounded",
        tone === "profit" ? "bg-teal/15 text-teal/80" : "bg-loss/15 text-loss/70"
      )}>
        {label}
      </span>
    )
  }

  // Exit efficiency
  const exitEff = mfe != null && mfe > 0 ? Math.round((pnlPoints / mfe) * 100) : null

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Gráfico de Execução</h3>
        <span className={cn(
          "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
          isLong ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
        )}>
          {direction}
        </span>
      </div>

      <div className="p-4">
        <div className="relative h-52 select-none">

          {/* ── MAE (só desenha linha própria se não coincidir com entrada/saída) ── */}
          {showMaeRow && (
            <div
              className="absolute left-0 right-0 flex items-center"
              style={{ top: yPctStr(maeDelta!), transform: "translateY(-50%)" }}
            >
              <div className="w-10 shrink-0 text-right pr-1.5">
                <span className="text-[9px] font-mono text-loss/60">{maeDelta!.toFixed(1)}</span>
              </div>
              <div className="flex-1 border-t border-dashed border-loss/35" />
              <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
                <span className="text-[9px] font-mono text-loss/70">{(isLong ? entryPrice + maeDelta! : entryPrice - maeDelta!).toFixed(2)}</span>
                <span className="text-[8px] text-loss/40 font-mono">MAE</span>
              </div>
            </div>
          )}

          {/* ── MFE (só desenha linha própria se não coincidir com entrada/saída) ── */}
          {showMfeRow && (
            <div
              className="absolute left-0 right-0 flex items-center"
              style={{ top: yPctStr(mfeDelta!), transform: "translateY(-50%)" }}
            >
              <div className="w-10 shrink-0 text-right pr-1.5">
                <span className="text-[9px] font-mono text-teal/60">+{mfe!.toFixed(1)}</span>
              </div>
              <div className="flex-1 border-t border-dashed border-teal/35" />
              <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1">
                <span className="text-[9px] font-mono text-teal/80">{(isLong ? entryPrice + mfe! : entryPrice - mfe!).toFixed(2)}</span>
                <span className="text-[8px] text-teal/50 font-mono">MFE</span>
              </div>
            </div>
          )}

          {/* ── Vela: pavio (MFE↔MAE) + corpo (entrada↔saída) ── */}
          <div
            className="absolute left-10 right-24 flex justify-center pointer-events-none"
            style={{ top: `${wickTopY}%`, height: `${Math.max(wickBotY - wickTopY, 1)}%` }}
          >
            <div className={cn("w-0.5 h-full rounded-full", wickColor)} />
          </div>
          {/* caps nas pontas do pavio — deixa claro onde o preço bateu o extremo */}
          <div className="absolute left-10 right-24 flex justify-center pointer-events-none" style={{ top: `${wickTopY}%`, transform: "translateY(-50%)" }}>
            <div className={cn("w-1.5 h-1.5 rounded-full", wickColor)} />
          </div>
          <div className="absolute left-10 right-24 flex justify-center pointer-events-none" style={{ top: `${wickBotY}%`, transform: "translateY(-50%)" }}>
            <div className={cn("w-1.5 h-1.5 rounded-full", wickColor)} />
          </div>
          <div
            className="absolute left-10 right-24 flex justify-center pointer-events-none"
            style={{ top: `${bodyTopY}%`, height: `${bodyH}%` }}
          >
            <div className={cn("w-20 h-full rounded-md border-2", zoneColor.bg, zoneColor.border, zoneColor.glow)} />
          </div>

          {/* ── EXIT line ── */}
          <div
            className="absolute left-0 right-0 flex items-center z-10"
            style={{ top: yPctStr(exitDelta), transform: "translateY(-50%)" }}
          >
            <div className="w-10 shrink-0 text-right pr-1.5">
              <span className={cn("text-[10px] font-mono font-bold",
                isWin ? "text-profit" : isLoss ? "text-loss" : "text-foreground/60"
              )}>
                {exitDelta >= 0 ? "+" : ""}{exitDelta.toFixed(2)}
              </span>
            </div>
            <div className={cn("flex-1 border-t-2", lineColor)} />
            <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1 flex-wrap">
              <span className={cn("text-[11px] font-mono font-bold",
                isWin ? "text-profit" : isLoss ? "text-loss" : "text-foreground/80"
              )}>
                {exitPrice.toFixed(2)}
              </span>
              <span className="text-[9px] text-muted-foreground/50 font-mono">saída</span>
              {maeMergesExit && <Badge label="MAE" tone="loss" />}
              {mfeMergesExit && <Badge label="MFE" tone="profit" />}
            </div>
          </div>

          {/* ── ENTRY line ── */}
          <div
            className="absolute left-0 right-0 flex items-center z-10"
            style={{ top: yPctStr(0), transform: "translateY(-50%)" }}
          >
            <div className="w-10 shrink-0 text-right pr-1.5">
              <span className="text-[10px] font-mono text-foreground/50">0</span>
            </div>
            <div className="flex-1 border-t-2 border-foreground/30" />
            <div className="w-24 shrink-0 pl-1.5 flex items-baseline gap-1 flex-wrap">
              <span className="text-[11px] font-mono font-semibold text-foreground/70">
                {entryPrice.toFixed(2)}
              </span>
              <span className="text-[9px] text-muted-foreground/50 font-mono">entrada</span>
              {maeMergesEntry && <Badge label="MAE" tone="loss" />}
              {mfeMergesEntry && <Badge label="MFE" tone="profit" />}
            </div>
          </div>

          {/* pts axis label */}
          <div className="absolute left-0 top-1">
            <span className="text-[9px] text-muted-foreground/30 font-mono">pts</span>
          </div>
        </div>

        {/* Stats bar */}
        <div className={cn(
          "mt-3 pt-3 border-t border-border grid gap-3",
          exitEff != null ? "grid-cols-3" : mfe != null ? "grid-cols-3" : "grid-cols-2"
        )}>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Capturado</p>
            <p className={cn("text-sm font-bold font-mono",
              isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground"
            )}>
              {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts
            </p>
          </div>

          {mfe != null ? (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">MFE</p>
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
