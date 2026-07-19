"use client"

import { useState } from "react"
import { cn, signedUsd } from "@/lib/utils"
import { Zap, TrendingUp, Minus } from "lucide-react"

interface SimpleTrade {
  pnl: number
  pnlPoints: number
  result: "WIN" | "LOSS" | "BREAKEVEN"
  mfe: number | null
}

interface Props {
  trades: SimpleTrade[]
}

type Scenario = "atual" | "mfe" | "sem3piores"

export function WhatIfSimulator({ trades }: Props) {
  const [active, setActive] = useState<Scenario>("atual")

  const tradesWithMfe = trades.filter(t => t.mfe != null && t.mfe > 0)
  if (trades.length < 5) return null

  // Cenário 1: atual
  const pnlAtual = trades.reduce((a, t) => a + t.pnl, 0)
  const winsAtual = trades.filter(t => t.result === "WIN").length
  const wrAtual = Math.round((winsAtual / trades.length) * 100)

  // Cenário 2: se saísse no MFE em todos os trades com MFE disponível
  let pnlMfe = 0
  let winsMfe = 0
  for (const t of trades) {
    if (t.mfe != null && t.mfe > 0) {
      // Simula saída no MFE (sempre win)
      pnlMfe += t.pnl + (t.mfe - t.pnlPoints) * (t.pnl / (t.pnlPoints || 1))
      winsMfe++
    } else {
      pnlMfe += t.pnl
      if (t.result === "WIN") winsMfe++
    }
  }
  const wrMfe = Math.round((winsMfe / trades.length) * 100)

  // Cenário 3: sem os 3 piores losses
  const sorted = [...trades].sort((a, b) => a.pnl - b.pnl)
  const worst3 = sorted.slice(0, 3).filter(t => t.pnl < 0)
  const worst3Pnl = worst3.reduce((a, t) => a + t.pnl, 0)
  const pnlSem3 = pnlAtual - worst3Pnl
  const winsSem3 = trades.filter(t => t.result === "WIN").length
  const totalSem3 = trades.length - worst3.length
  const wrSem3 = totalSem3 > 0 ? Math.round((winsSem3 / totalSem3) * 100) : wrAtual

  // Eficiência média de saída atual
  const avgEff = tradesWithMfe.length > 0
    ? Math.round(tradesWithMfe.reduce((a, t) => a + (t.pnlPoints / t.mfe!), 0) / tradesWithMfe.length * 100)
    : null

  const hasMfeData = tradesWithMfe.length >= 3

  const scenarios = [
    {
      id: "atual" as Scenario,
      label: "Atual",
      description: "Performance real dos seus trades",
      pnl: pnlAtual,
      wr: wrAtual,
      trades: trades.length,
      icon: Minus,
      color: "text-foreground",
      borderColor: "border-border",
      bgActive: "bg-card",
    },
    {
      id: "mfe" as Scenario,
      label: "Saída no MFE",
      description: `E se saísse sempre no máximo a favor? (${tradesWithMfe.length} trades com MFE)`,
      pnl: pnlMfe,
      wr: wrMfe,
      trades: trades.length,
      icon: TrendingUp,
      color: "text-teal",
      borderColor: "border-teal/30",
      bgActive: "bg-teal/5",
    },
    {
      id: "sem3piores" as Scenario,
      label: `Sem ${worst3.length} piores losses`,
      description: `Removendo os ${worst3.length} trades mais negativos: ${worst3.map(t => `$${t.pnl.toFixed(0)}`).join(", ")}`,
      pnl: pnlSem3,
      wr: wrSem3,
      trades: totalSem3,
      icon: Zap,
      color: "text-profit",
      borderColor: "border-profit/30",
      bgActive: "bg-profit/5",
    },
  ]

  const activeScenario = scenarios.find(s => s.id === active)!
  const diff = activeScenario.pnl - pnlAtual

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-teal" />
          <h2 className="text-sm font-semibold text-foreground">Simulador "E se..."</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Compare cenários para entender onde está deixando dinheiro na mesa
          {avgEff != null && ` · eficiência atual de saída: ${avgEff}%`}
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Botões de cenário */}
        <div className={cn("grid gap-2", hasMfeData ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
          {scenarios.filter(s => s.id !== "mfe" || hasMfeData).map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "text-left rounded-xl border p-3 transition-all",
                active === s.id
                  ? `${s.bgActive} ${s.borderColor}`
                  : "bg-muted/30 border-border hover:border-muted-foreground/30"
              )}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <s.icon className={cn("w-3.5 h-3.5", active === s.id ? s.color : "text-muted-foreground")} />
                <span className={cn("text-xs font-semibold", active === s.id ? s.color : "text-foreground")}>
                  {s.label}
                </span>
              </div>
              <p className={cn(
                "text-lg font-bold font-mono",
                s.pnl >= 0 ? "text-profit" : "text-loss"
              )}>
                {signedUsd(s.pnl)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.wr}% win rate · {s.trades} trades</p>
            </button>
          ))}
        </div>

        {/* Painel do cenário ativo */}
        <div className={cn(
          "rounded-xl border p-4 space-y-3 transition-all",
          activeScenario.bgActive, activeScenario.borderColor
        )}>
          <p className={cn("text-xs font-medium", activeScenario.color)}>{activeScenario.description}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground">P&L cenário</p>
              <p className={cn("text-xl font-bold font-mono", activeScenario.pnl >= 0 ? "text-profit" : "text-loss")}>
                {signedUsd(activeScenario.pnl)}
              </p>
            </div>
            {active !== "atual" && (
              <div>
                <p className="text-[10px] text-muted-foreground">vs atual</p>
                <p className={cn("text-xl font-bold font-mono", diff >= 0 ? "text-profit" : "text-loss")}>
                  {signedUsd(diff)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-muted-foreground">Win rate</p>
              <p className={cn("text-xl font-bold font-mono", activeScenario.wr >= 50 ? "text-profit" : "text-loss")}>
                {activeScenario.wr}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Trades</p>
              <p className="text-xl font-bold font-mono text-foreground">{activeScenario.trades}</p>
            </div>
          </div>

          {active === "mfe" && avgEff != null && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Sua eficiência de saída atual é <span className={cn("font-bold", avgEff >= 70 ? "text-profit" : avgEff >= 45 ? "text-yellow-400" : "text-loss")}>{avgEff}%</span>.
                {avgEff < 60
                  ? " Você está saindo bem antes do potencial máximo na maioria dos trades."
                  : " Boa captura de movimento — foco em manter consistência."}
              </p>
            </div>
          )}

          {active === "sem3piores" && worst3.length > 0 && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Esses {worst3.length} trades respondem por{" "}
                <span className="text-loss font-bold">${Math.abs(worst3Pnl).toFixed(0)}</span> de prejuízo
                ({Math.round((Math.abs(worst3Pnl) / (Math.abs(pnlAtual) || 1)) * 100)}% do resultado total).
                Identifique o padrão — setup? Sessão? Revenge trade?
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
