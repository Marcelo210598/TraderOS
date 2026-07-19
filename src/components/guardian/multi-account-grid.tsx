"use client"

import { cn, signedUsd } from "@/lib/utils"
import { CheckCircle, AlertTriangle, XCircle, TrendingDown, Calendar, BarChart2, Target } from "lucide-react"
import { ACCOUNTS, simulate, type AccountKey, type DayData } from "@/lib/guardian"

interface AccountEntry {
  key: string
  days: DayData[]
  totalPnl: number
}

interface Props {
  accounts: AccountEntry[]
}

function AccountCard({ entry }: { entry: AccountEntry }) {
  const key = entry.key as AccountKey
  const config = ACCOUNTS[key]
  if (!config) return null

  const hasData = entry.days.length > 0

  if (!hasData) {
    return (
      <a
        href={`/guardian?account=${key}`}
        className="block bg-card border border-border rounded-xl p-4 hover:border-teal/30 transition-colors group"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-mono font-semibold text-foreground">{config.label}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            Sem trades
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Nenhum trade com label <span className="font-mono text-teal">{key}</span> registrado no Journal.
        </p>
        <p className="text-[10px] text-muted-foreground mt-2 group-hover:text-teal transition-colors">
          Ver calculadora →
        </p>
      </a>
    )
  }

  const sim = simulate(config, entry.days)
  const tradingDays = entry.days.length

  const profitDays = entry.days.filter((d) => d.pnl > 0)
  const totalProfit = profitDays.reduce((a, d) => a + d.pnl, 0)
  const biggestDay = profitDays.length > 0 ? Math.max(...profitDays.map((d) => d.pnl)) : 0
  const biggestDayPct = totalProfit > 0 ? (biggestDay / totalProfit) * 100 : 0
  const consistencyOk = biggestDayPct <= 30

  const daysOk = tradingDays >= config.minDays
  const overallOk = !sim.blown && sim.profitProgress >= 100 && daysOk && consistencyOk
  const safetyPct = (sim.safetyMargin / config.drawdown) * 100

  const statusBadge = sim.blown
    ? { label: "Encerrado", class: "border-loss/40 text-loss bg-loss/5" }
    : overallOk
    ? { label: "Pronto!", class: "border-profit/40 text-profit bg-profit/5" }
    : { label: "Em progresso", class: "border-yellow-500/30 text-yellow-400 bg-yellow-500/5" }

  const safetyColor =
    sim.blown ? "text-loss" :
    safetyPct < 30 ? "text-loss" :
    safetyPct < 60 ? "text-yellow-400" : "text-profit"

  return (
    <a
      href={`/guardian?account=${key}`}
      className={cn(
        "block bg-card border rounded-xl p-4 hover:border-teal/40 transition-all group",
        sim.blown ? "border-loss/20" : overallOk ? "border-profit/20" : "border-border"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-mono font-semibold text-foreground">{config.label}</span>
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", statusBadge.class)}>
          {statusBadge.label}
        </span>
      </div>

      {/* Barra de progresso */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <Target className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Profit Target</span>
          </div>
          <span className="text-[10px] font-mono text-teal font-medium">{sim.profitProgress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal to-teal/60"
            style={{ width: `${Math.max(0, sim.profitProgress)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-0.5">
          <span className={cn("font-medium", entry.totalPnl >= 0 ? "text-profit" : "text-loss")}>
            {signedUsd(entry.totalPnl)}
          </span>
          <span>meta ${config.target.toLocaleString()}</span>
        </div>
      </div>

      {/* KPIs linha */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-muted/30 rounded-lg p-2">
          <TrendingDown className="w-3 h-3 text-muted-foreground mx-auto mb-0.5" />
          <p className={cn("text-xs font-bold font-mono", safetyColor)}>
            ${sim.safetyMargin >= 1000 ? `${(sim.safetyMargin / 1000).toFixed(1)}k` : sim.safetyMargin.toFixed(0)}
          </p>
          <p className="text-[9px] text-muted-foreground">margem</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-2">
          <Calendar className="w-3 h-3 text-muted-foreground mx-auto mb-0.5" />
          <p className={cn("text-xs font-bold font-mono", daysOk ? "text-profit" : "text-foreground")}>
            {tradingDays}<span className="text-muted-foreground font-normal">/{config.minDays}</span>
          </p>
          <p className="text-[9px] text-muted-foreground">dias</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-2">
          <BarChart2 className="w-3 h-3 text-muted-foreground mx-auto mb-0.5" />
          {consistencyOk ? (
            <CheckCircle className="w-3.5 h-3.5 text-profit mx-auto mt-0.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-loss mx-auto mt-0.5" />
          )}
          <p className="text-[9px] text-muted-foreground mt-0.5">consist.</p>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-2.5 group-hover:text-teal transition-colors text-right">
        Ver detalhes →
      </p>
    </a>
  )
}

export function MultiAccountGrid({ accounts }: Props) {
  const withData = accounts.filter((a) => a.days.length > 0)
  const noData = accounts.filter((a) => a.days.length === 0)

  return (
    <div className="space-y-4">
      {withData.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhum trade com <span className="font-mono text-teal">accountLabel</span> configurado.
          <br />
          <span className="text-xs mt-1 block">Registre trades no Journal e defina o label da conta.</span>
        </div>
      )}

      {withData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-3">
            {withData.length} conta{withData.length > 1 ? "s" : ""} com trades registrados
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {withData.map((entry) => (
              <AccountCard key={entry.key} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {noData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-3">Contas sem trades</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {noData.map((entry) => (
              <AccountCard key={entry.key} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
