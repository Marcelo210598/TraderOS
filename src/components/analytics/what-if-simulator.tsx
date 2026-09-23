"use client"

import { useMemo, useState } from "react"
import { Zap } from "lucide-react"
import { cn, signedUsd } from "@/lib/utils"
import {
  MIN_BUCKET, MIN_SAMPLE, bestParam, dowLabel, dowStats, hourStats, pointGrid, runScenario, simulate,
  type InsightTrade, type ScenarioOpts,
} from "@/lib/analytics-insights"
import { ExplainButton } from "./explain-modal"
import { ScrubPlot, formatAxis, makeYPct, xPct } from "./scrub-plot"

type ScenarioId = "stop" | "alvo" | "stopalvo" | "perdasDia" | "tradesDia" | "horario" | "diaSemana" | "piores"

interface Props {
  trades: InsightTrade[]
}

const pts = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} pts`

export function WhatIfSimulator({ trades }: Props) {
  const maeVals = trades.filter((t) => t.mae != null).map((t) => Math.abs(t.mae!))
  const mfeVals = trades.filter((t) => t.mfe != null).map((t) => Math.abs(t.mfe!))
  const hasMae = maeVals.length >= 3
  const hasMfe = mfeVals.length >= 3

  const stopGrid = useMemo(() => pointGrid(hasMae ? Math.max(...maeVals) : 0), [hasMae, maeVals.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const targetGrid = useMemo(() => pointGrid(hasMfe ? Math.max(...mfeVals) : 0), [hasMfe, mfeVals.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const bestStop = useMemo(() => (hasMae ? bestParam(trades, "stopPts", stopGrid.values) : null), [trades, hasMae, stopGrid])
  const bestTarget = useMemo(() => (hasMfe ? bestParam(trades, "targetPts", targetGrid.values) : null), [trades, hasMfe, targetGrid])

  const baseTotal = useMemo(() => runScenario(trades, {}).total, [trades])
  // só vale como "melhor" o que realmente supera o resultado real
  const stopBeatsReal = bestStop != null && bestStop.total > baseTotal + 0.5
  const targetBeatsReal = bestTarget != null && bestTarget.total > baseTotal + 0.5
  const midOf = (vals: number[]) => vals[Math.floor(vals.length / 2)] ?? 0

  const [stop, setStop] = useState<number>(() => (stopBeatsReal ? bestStop!.value : midOf(stopGrid.values)))
  const [target, setTarget] = useState<number>(() => (targetBeatsReal ? bestTarget!.value : midOf(targetGrid.values)))
  const [maxLosses, setMaxLosses] = useState(2)
  const [maxTrades, setMaxTrades] = useState(3)
  const [active, setActive] = useState<ScenarioId>("stop")

  const worstHour = useMemo(() => {
    const worst = hourStats(trades).filter((h) => h.total >= MIN_BUCKET).sort((a, b) => a.pnl - b.pnl)[0]
    return worst && worst.pnl < 0 ? worst : null
  }, [trades])
  const worstDow = useMemo(() => {
    const worst = dowStats(trades).filter((d) => d.total >= MIN_BUCKET).sort((a, b) => a.pnl - b.pnl)[0]
    return worst && worst.pnl < 0 ? worst : null
  }, [trades])
  const hasLosses = trades.some((t) => t.pnl < 0)

  const scenarios = useMemo(() => {
    const list: { id: ScenarioId; label: string; opts: ScenarioOpts }[] = []
    if (hasMae) list.push({ id: "stop", label: `Stop de ${pts(stop)}`, opts: { stopPts: stop } })
    if (hasMfe) list.push({ id: "alvo", label: `Alvo de ${pts(target)}`, opts: { targetPts: target } })
    if (hasMae && hasMfe) list.push({ id: "stopalvo", label: "Stop + alvo juntos", opts: { stopPts: stop, targetPts: target } })
    list.push({ id: "perdasDia", label: `Parar após ${maxLosses} loss${maxLosses > 1 ? "es" : ""}/dia`, opts: { maxLossesPerDay: maxLosses } })
    list.push({ id: "tradesDia", label: `Máx. ${maxTrades} trades/dia`, opts: { maxTradesPerDay: maxTrades } })
    if (worstHour) list.push({ id: "horario", label: `Sem operar às ${worstHour.key}h`, opts: { excludeHour: worstHour.key } })
    if (worstDow) list.push({ id: "diaSemana", label: `Sem operar ${dowLabel(worstDow.key)}`, opts: { excludeDow: worstDow.key } })
    if (hasLosses) list.push({ id: "piores", label: "Sem os 3 piores losses", opts: { dropWorstLosses: 3 } })
    return list.map((s) => ({ ...s, m: runScenario(trades, s.opts) }))
  }, [trades, hasMae, hasMfe, stop, target, maxLosses, maxTrades, worstHour, worstDow, hasLosses])

  if (trades.length < 5) return null

  const base = runScenario(trades, {})
  const current = scenarios.find((s) => s.id === active) ?? scenarios[0]
  const activeId = current.id
  const bestId = scenarios.reduce((a, b) => (b.m.total > a.m.total ? b : a), scenarios[0]).id

  // Quais trades mudariam no cenário ativo (honestidade: mostra quem piora também)
  const { pnls, kept } = simulate(trades, current.opts)
  let improved = 0, improvedUsd = 0, worsened = 0, worsenedUsd = 0
  trades.forEach((t, i) => {
    const delta = (kept[i] ? pnls[i] : 0) - t.pnl
    if (delta > 0.5) { improved++; improvedUsd += delta } else if (delta < -0.5) { worsened++; worsenedUsd += delta }
  })

  // Gráfico: equity real vs cenário
  const all = [...base.cum, ...current.m.cum, 0]
  const minV = Math.min(...all)
  const maxV = Math.max(...all)
  const toY = makeYPct(minV, maxV)
  const n = trades.length
  const pathOf = (series: number[]) => series.map((v, i) => `${i === 0 ? "M" : "L"} ${xPct(i, n)} ${toY(v)}`).join(" ")
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = maxV - ((maxV - minV) / 4) * i
    return { y: toY(v), label: formatAxis(v) }
  })
  const diff = current.m.total - base.total

  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string, hint?: { text: string; apply?: () => void } | null) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-bold text-foreground">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-teal"
        aria-label={label}
      />
      {hint && (hint.apply ? (
        <button type="button" onClick={hint.apply} className="text-[11px] text-teal hover:underline text-left">
          {hint.text}
        </button>
      ) : (
        <p className="text-[11px] text-muted-foreground">{hint.text}</p>
      ))}
    </div>
  )

  const showStop = activeId === "stop" || activeId === "stopalvo"
  const showTarget = activeId === "alvo" || activeId === "stopalvo"

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-teal" />
          <h2 className="text-sm font-semibold text-foreground">Simulador &quot;E se...&quot;</h2>
          <ExplainButton topic="whatif" label="como funciona" />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Refaz seus {trades.length} trades reais mudando uma regra de cada vez. Escolha um cenário, ajuste e compare com o real.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {trades.length < MIN_SAMPLE && (
          <p className="text-xs text-yellow-400/90 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2">
            ⚠ Amostra pequena ({trades.length} trades): os resultados abaixo são pistas, não conclusão. Com 30+ trades ficam bem mais confiáveis.
          </p>
        )}

        {/* Cenários */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {scenarios.map((s) => {
            const d = s.m.total - base.total
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={cn(
                  "text-left rounded-xl border p-3 transition-all",
                  activeId === s.id ? "bg-teal/5 border-teal/40" : "bg-muted/30 border-border hover:border-muted-foreground/30",
                )}
              >
                <p className={cn("text-[11px] font-semibold leading-tight", activeId === s.id ? "text-teal" : "text-foreground")}>{s.label}</p>
                <p className={cn("text-lg font-bold font-mono mt-1.5", s.m.total >= 0 ? "text-profit" : "text-loss")}>{signedUsd(s.m.total)}</p>
                <p className={cn("text-[10px] font-mono", d > 0.5 ? "text-profit" : d < -0.5 ? "text-loss" : "text-muted-foreground")}>
                  {Math.abs(d) < 0.5 ? "igual ao real" : `${signedUsd(d)} vs real`}
                  {s.id === bestId && d > 0.5 && " · melhor"}
                </p>
              </button>
            )
          })}
        </div>

        {/* Painel do cenário ativo */}
        <div className="rounded-xl border border-teal/30 bg-teal/5 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-teal">{current.label}</p>
            <p className={cn("text-xs font-mono font-bold", diff > 0.5 ? "text-profit" : diff < -0.5 ? "text-loss" : "text-muted-foreground")}>
              {Math.abs(diff) < 0.5 ? "sem mudança" : `${signedUsd(diff)} vs real`}
            </p>
          </div>

          {(showStop || showTarget || activeId === "perdasDia" || activeId === "tradesDia") && (
            <div className="grid sm:grid-cols-2 gap-4">
              {showStop && slider("Stop simulado", stop, setStop, stopGrid.values[0], stopGrid.values[stopGrid.values.length - 1], stopGrid.step, pts,
                bestStop && (stopBeatsReal
                  ? { text: `Melhor stop histórico: ${pts(bestStop.value)} (${signedUsd(bestStop.total)} vs ${signedUsd(baseTotal)} real) — usar`, apply: () => setStop(bestStop.value) }
                  : { text: `Nenhum stop mais curto teria rendido mais que o seu real (${signedUsd(baseTotal)}): o seu stop atual está bem calibrado pra esses trades.` }))}
              {showTarget && slider("Alvo simulado", target, setTarget, targetGrid.values[0], targetGrid.values[targetGrid.values.length - 1], targetGrid.step, pts,
                bestTarget && (targetBeatsReal
                  ? { text: `Melhor alvo histórico: ${pts(bestTarget.value)} (${signedUsd(bestTarget.total)} vs ${signedUsd(baseTotal)} real) — usar`, apply: () => setTarget(bestTarget.value) }
                  : { text: `Nenhum alvo fixo teria rendido mais que a sua saída real (${signedUsd(baseTotal)}).` }))}
              {activeId === "perdasDia" && slider("Losses por dia até parar", maxLosses, setMaxLosses, 1, 5, 1, (v) => `${v}`)}
              {activeId === "tradesDia" && slider("Máximo de trades por dia", maxTrades, setMaxTrades, 1, 10, 1, (v) => `${v}`)}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { l: "P&L", v: signedUsd(current.m.total), c: current.m.total >= 0 ? "text-profit" : "text-loss", r: signedUsd(base.total) },
              { l: "Win rate", v: `${current.m.winRate}%`, c: current.m.winRate >= 50 ? "text-profit" : "text-loss", r: `${base.winRate}%` },
              { l: "Profit factor", v: current.m.profitFactor >= 99 ? "∞" : current.m.profitFactor.toFixed(2), c: "text-foreground", r: base.profitFactor >= 99 ? "∞" : base.profitFactor.toFixed(2) },
              { l: "Max drawdown", v: current.m.maxDrawdown > 0 ? `-$${current.m.maxDrawdown.toFixed(0)}` : "$0", c: "text-foreground", r: base.maxDrawdown > 0 ? `-$${base.maxDrawdown.toFixed(0)}` : "$0" },
              { l: "Trades", v: `${current.m.count}`, c: "text-foreground", r: `${base.count}` },
            ].map((x) => (
              <div key={x.l}>
                <p className="text-[10px] text-muted-foreground">{x.l}</p>
                <p className={cn("text-lg font-bold font-mono", x.c)}>{x.v}</p>
                <p className="text-[10px] text-muted-foreground font-mono">real: {x.r}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {improved + worsened === 0 ? (
              "Nenhum trade mudaria com esse ajuste."
            ) : (
              <>
                <span className="text-foreground font-medium">{improved + worsened} trades mudariam:</span>{" "}
                {improved > 0 && <><span className="text-profit font-medium">{improved} melhorariam ({signedUsd(improvedUsd)})</span>{worsened > 0 && ", "}</>}
                {worsened > 0 && <span className="text-loss font-medium">{worsened} piorariam ({signedUsd(worsenedUsd)})</span>}
                .{" "}
                {worsened > 0 && improved > 0 && "O cenário só vale a pena se o que melhora compensa o que piora — o resultado final já considera os dois."}
              </>
            )}
          </p>

          {/* Equity: real vs cenário */}
          <div>
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-1 pl-12">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-muted-foreground/60 inline-block" /> real</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-teal inline-block" /> cenário</span>
            </div>
            <ScrubPlot
              count={n}
              yPcts={current.m.cum.map(toY)}
              ticks={ticks}
              xLabels={[`trade 1`, `trade ${n}`]}
              dotColor="rgb(45 212 191)"
              height={150}
              tooltip={(i) => (
                <div className="space-y-0.5">
                  <p className="text-muted-foreground">Trade #{i + 1}</p>
                  <p className="font-mono">real <span className="font-bold">{signedUsd(base.cum[i])}</span></p>
                  <p className="font-mono text-teal">cenário <span className="font-bold">{signedUsd(current.m.cum[i])}</span></p>
                </div>
              )}
            >
              <path d={pathOf(base.cum)} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" className="text-muted-foreground" />
              <path d={pathOf(current.m.cum)} fill="none" stroke="rgb(45 212 191)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </ScrubPlot>
          </div>
        </div>
      </div>
    </div>
  )
}
