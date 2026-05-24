"use client"

import { cn } from "@/lib/utils"
import { CheckCircle, AlertTriangle, XCircle, TrendingDown, Target, Calendar, BarChart2 } from "lucide-react"

interface DayData {
  date: string
  pnl: number
}

interface AccountConfig {
  label: string
  balance: number
  drawdown: number
  target: number
  minDays: number
  maxContracts: number
}

interface ChallengeStatusProps {
  account: AccountConfig
  days: DayData[]
  totalPnl: number
}

function simulate(account: AccountConfig, days: DayData[]) {
  let balance = account.balance
  let hwm = account.balance
  let floor = account.balance - account.drawdown
  let isLocked = false
  let blown = false

  for (const d of days) {
    balance += d.pnl
    if (balance > hwm) {
      hwm = balance
      if (hwm >= account.balance + account.target) {
        isLocked = true
        floor = account.balance
      } else if (!isLocked) {
        floor = hwm - account.drawdown
      }
    }
    if (balance <= floor) {
      blown = true
      break
    }
  }

  const safetyMargin = balance - floor
  const profitProgress = Math.min(((balance - account.balance) / account.target) * 100, 100)
  const pctToTarget = Math.max(0, account.target - (balance - account.balance))

  return { balance, floor, safetyMargin, isLocked, blown, profitProgress, pctToTarget }
}

export function ChallengeStatus({ account, days, totalPnl }: ChallengeStatusProps) {
  const sim = simulate(account, days)

  const tradingDays = days.length
  const daysOk = tradingDays >= account.minDays

  // Consistency rule
  const profitDays = days.filter((d) => d.pnl > 0)
  const totalProfit = profitDays.reduce((a, d) => a + d.pnl, 0)
  const biggestDay = profitDays.length > 0 ? Math.max(...profitDays.map((d) => d.pnl)) : 0
  const biggestDayPct = totalProfit > 0 ? (biggestDay / totalProfit) * 100 : 0
  const consistencyOk = biggestDayPct <= 30

  const safetyPct = (sim.safetyMargin / account.drawdown) * 100
  const safetyColor =
    sim.blown ? "text-loss" :
    safetyPct < 30 ? "text-loss" :
    safetyPct < 60 ? "text-yellow-400" : "text-profit"

  const overallOk = !sim.blown && sim.profitProgress >= 100 && daysOk && consistencyOk

  return (
    <div className="space-y-4">
      {/* Status geral */}
      <div className={cn(
        "rounded-xl border p-4 flex items-center gap-3",
        sim.blown ? "bg-loss/10 border-loss/30" :
        overallOk ? "bg-profit/10 border-profit/30" :
        "bg-card border-border"
      )}>
        {sim.blown ? (
          <XCircle className="w-6 h-6 text-loss shrink-0" />
        ) : overallOk ? (
          <CheckCircle className="w-6 h-6 text-profit shrink-0" />
        ) : (
          <AlertTriangle className="w-6 h-6 text-yellow-400 shrink-0" />
        )}
        <div>
          <p className={cn("text-sm font-semibold", sim.blown ? "text-loss" : overallOk ? "text-profit" : "text-foreground")}>
            {sim.blown ? "Challenge encerrado (drawdown atingido)" :
             overallOk ? "Pronto para aprovação!" :
             "Em progresso"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sim.blown ? "O saldo simulado tocou o floor de liquidação." :
             overallOk ? "Todos os critérios atingidos com os trades registrados." :
             `Baseado em ${tradingDays} dias operados registrados no Journal.`}
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        {/* Progresso ao target */}
        <div className="bg-card border border-border rounded-xl p-4 col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Progresso ao Profit Target</p>
            </div>
            <span className="text-xs font-mono text-teal font-medium">
              {sim.profitProgress.toFixed(0)}%
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal to-teal/60 transition-all duration-500"
              style={{ width: `${Math.max(0, sim.profitProgress)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1.5">
            <span>${account.balance.toLocaleString()}</span>
            <span className={cn("font-medium", totalPnl >= 0 ? "text-profit" : "text-loss")}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)} registrado
            </span>
            <span>${(account.balance + account.target).toLocaleString()}</span>
          </div>
          {sim.pctToTarget > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1 text-center">
              Faltam <span className="text-teal font-mono font-medium">${sim.pctToTarget.toFixed(0)}</span> para o target
            </p>
          )}
        </div>

        {/* Drawdown */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Margem Drawdown</p>
          </div>
          <p className={cn("text-2xl font-bold font-mono", safetyColor)}>
            ${sim.safetyMargin.toFixed(0)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Floor: ${sim.floor.toFixed(0)} · {sim.isLocked ? "🔒 travado" : "trailing"}
          </p>
          {safetyPct < 30 && !sim.blown && (
            <p className="text-[10px] text-loss mt-1 font-medium">⚠ Zona de perigo!</p>
          )}
        </div>

        {/* Dias operados */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Dias Operados</p>
          </div>
          <p className={cn("text-2xl font-bold font-mono", daysOk ? "text-profit" : "text-foreground")}>
            {tradingDays}
            <span className="text-sm text-muted-foreground font-normal">/{account.minDays}</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {daysOk ? "✅ Mínimo atingido" : `Faltam ${account.minDays - tradingDays} dia(s)`}
          </p>
        </div>
      </div>

      {/* Consistency Rule */}
      <div className={cn(
        "rounded-xl border p-4",
        !consistencyOk ? "bg-loss/5 border-loss/20" : "bg-card border-border"
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-foreground">Consistency Rule (30%)</p>
          </div>
          {consistencyOk ? (
            <span className="text-[10px] text-profit font-medium flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> OK
            </span>
          ) : (
            <span className="text-[10px] text-loss font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Violação
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-[10px] text-muted-foreground">Melhor dia</p>
            <p className="text-sm font-bold font-mono text-foreground mt-0.5">
              +${biggestDay.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">% do total</p>
            <p className={cn("text-sm font-bold font-mono mt-0.5", biggestDayPct > 30 ? "text-loss" : "text-profit")}>
              {biggestDayPct.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Máx permitido</p>
            <p className="text-sm font-bold font-mono text-teal mt-0.5">
              30%
            </p>
          </div>
        </div>
        {!consistencyOk && (
          <p className="text-[10px] text-loss mt-3 leading-relaxed">
            Seu melhor dia representa <strong>{biggestDayPct.toFixed(1)}%</strong> do lucro total. A Apex rejeita relatórios acima de 30%. Você precisa que o total cresça ou redistribuir o lucro.
          </p>
        )}
      </div>
    </div>
  )
}
