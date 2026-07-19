"use client"

import { useState, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle, TrendingDown, BarChart2, Layers } from "lucide-react"
import { ACCOUNTS, type AccountKey } from "@/lib/guardian"

export const GUARDIAN_ALERT_KEY = "traderos_guardian_alert"

export type GuardianAlertLevel = "safe" | "warning" | "danger"

export interface GuardianAlertData {
  accountLabel: string
  safetyMargin: number
  drawdownMax: number
  balance: number
  floor: number
  level: GuardianAlertLevel
  savedAt: number
  source: "manual" | "auto"
}

// ACCOUNTS e AccountKey vêm de @/lib/guardian (contas Apex 2026 EOD — fonte única)

type TabId = "drawdown" | "consistency" | "scaling"

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "drawdown", label: "Drawdown", icon: TrendingDown },
  { id: "consistency", label: "Consistency Rule", icon: BarChart2 },
  { id: "scaling", label: "Scaling Plan", icon: Layers },
]

export function ApexCalculator() {
  const [tab, setTab] = useState<TabId>("drawdown")
  const [accountKey, setAccountKey] = useState<AccountKey>("PA100K")
  const account = ACCOUNTS[accountKey]

  // --- Tab 1: Drawdown ---
  const [currentBalance, setCurrentBalance] = useState("")
  const [highWaterMark, setHighWaterMark] = useState("")

  const drawdownCalc = useMemo(() => {
    const balance = parseFloat(currentBalance) || 0
    const hwm = parseFloat(highWaterMark) || balance
    const startBalance = account.balance

    const effectiveHwm = Math.max(hwm, balance, startBalance)
    const lockThreshold = startBalance + account.target
    const isLocked = effectiveHwm >= lockThreshold
    const drawdownFloor = isLocked ? startBalance : effectiveHwm - account.drawdown
    const safetyMargin = balance - drawdownFloor
    const profitProgress = Math.min(((balance - startBalance) / account.target) * 100, 100)
    const pctToTarget = Math.max(0, account.target - (balance - startBalance))

    return { drawdownFloor, safetyMargin, isLocked, profitProgress, pctToTarget, effectiveHwm }
  }, [currentBalance, highWaterMark, account])

  // Salva conta selecionada para o Dashboard usar no modo automático
  useEffect(() => {
    localStorage.setItem("traderos_guardian_account", accountKey)
  }, [accountKey])

  // Salva alerta manual no localStorage (modo manual do Guardian)
  useEffect(() => {
    if (!currentBalance) return
    const level: GuardianAlertLevel =
      drawdownCalc.safetyMargin < account.drawdown * 0.3 ? "danger"
      : drawdownCalc.safetyMargin < account.drawdown * 0.6 ? "warning"
      : "safe"
    const data: GuardianAlertData = {
      accountLabel: account.label,
      safetyMargin: drawdownCalc.safetyMargin,
      drawdownMax: account.drawdown,
      balance: parseFloat(currentBalance),
      floor: drawdownCalc.drawdownFloor,
      level,
      savedAt: Date.now(),
      source: "manual",
    }
    localStorage.setItem(GUARDIAN_ALERT_KEY, JSON.stringify(data))
  }, [drawdownCalc, account, currentBalance])

  // --- Tab 2: Consistency ---
  const [dailyPnls, setDailyPnls] = useState<string[]>(["", "", "", "", ""])

  const consistencyCalc = useMemo(() => {
    const values = dailyPnls.map((v) => parseFloat(v) || 0)
    const total = values.reduce((a, b) => a + b, 0)
    const maxAllowed = total > 0 ? total * 0.5 : 0
    const days = values.map((v, i) => ({
      day: i + 1,
      pnl: v,
      pct: total > 0 ? (v / total) * 100 : 0,
      violates: total > 0 && v > maxAllowed,
    }))
    const hasViolation = days.some((d) => d.violates)
    return { days, total, maxAllowed, hasViolation }
  }, [dailyPnls])

  function addDay() {
    if (dailyPnls.length < 20) setDailyPnls((p) => [...p, ""])
  }
  function removeDay(i: number) {
    setDailyPnls((p) => p.filter((_, idx) => idx !== i))
  }

  // --- Tab 3: Scaling ---
  const [traderProfit, setTraderProfit] = useState("")

  const scalingTiers = useMemo(() => {
    const base = account.maxContracts
    const step = Math.ceil(base / 5)
    const tiers = [
      { label: "Início", minProfit: 0, contracts: base },
      { label: "Tier 1", minProfit: account.target * 0.2, contracts: base + step },
      { label: "Tier 2", minProfit: account.target * 0.4, contracts: base + step * 2 },
      { label: "Tier 3", minProfit: account.target * 0.6, contracts: base + step * 3 },
      { label: "Tier 4", minProfit: account.target * 0.8, contracts: base + step * 4 },
      { label: "Tier 5 (Funded)", minProfit: account.target, contracts: base + step * 5 },
    ]
    const profit = parseFloat(traderProfit) || 0
    return tiers.map((t) => ({ ...t, active: profit >= t.minProfit }))
  }, [account, traderProfit])

  const currentTier = [...scalingTiers].reverse().find((t) => t.active)

  return (
    <div className="space-y-4">
      {/* Account selector */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ACCOUNTS) as AccountKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setAccountKey(key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all",
              accountKey === key
                ? "bg-teal/10 border-teal/40 text-teal"
                : "border-border text-muted-foreground hover:border-teal/30 hover:text-foreground"
            )}
          >
            {ACCOUNTS[key].label}
          </button>
        ))}
      </div>

      {/* Info row — dados oficiais da conta (Apex 2026 EOD) */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Drawdown máx", value: `$${account.drawdown.toLocaleString()}`, color: "text-loss" },
          { label: "Meta aprovação", value: `$${account.target.toLocaleString()}`, color: "text-profit" },
          { label: "Lucro mín/dia", value: `$${account.lucroMinDia.toLocaleString()}`, color: "text-foreground" },
          { label: "Gordura p/ saque", value: `$${account.gorduraSaque.toLocaleString()}`, color: "text-teal" },
          { label: "Máx saques", value: `${account.maxSaques}`, color: "text-foreground" },
          { label: "Dias mín", value: `${account.minDays} dias`, color: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="bg-muted/40 rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">{s.label}</p>
            <p className={cn("text-base font-bold font-mono", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all",
                tab === t.id
                  ? "bg-card text-teal border border-teal/20 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab: Drawdown */}
      {tab === "drawdown" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="apex-current-balance" className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">
                Saldo atual ($)
              </label>
              <input
                id="apex-current-balance"
                type="number"
                value={currentBalance}
                onChange={(e) => setCurrentBalance(e.target.value)}
                placeholder={account.balance.toString()}
                className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="apex-hwm" className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">
                High water mark ($)
              </label>
              <input
                id="apex-hwm"
                type="number"
                value={highWaterMark}
                onChange={(e) => setHighWaterMark(e.target.value)}
                placeholder="Pico do saldo"
                className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {currentBalance && (
            <div className="space-y-3">
              {/* Drawdown floor */}
              <div className={cn(
                "rounded-xl p-4 border",
                drawdownCalc.isLocked ? "bg-profit/5 border-profit/20" : "bg-card border-border"
              )}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Nível de liquidação (floor)</p>
                    <p className="text-2xl font-bold font-mono text-foreground mt-0.5">
                      ${drawdownCalc.drawdownFloor.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                    </p>
                  </div>
                  {drawdownCalc.isLocked ? (
                    <div className="flex items-center gap-1.5 text-profit text-xs font-medium">
                      <CheckCircle className="w-4 h-4" />
                      Drawdown travado
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <TrendingDown className="w-4 h-4" />
                      Trailing ativo
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Margem de segurança</p>
                    <p className={cn(
                      "text-lg font-bold font-mono mt-0.5",
                      drawdownCalc.safetyMargin < account.drawdown * 0.3 ? "text-loss" :
                      drawdownCalc.safetyMargin < account.drawdown * 0.6 ? "text-yellow-400" : "text-profit"
                    )}>
                      ${drawdownCalc.safetyMargin.toFixed(0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Falta pro target</p>
                    <p className="text-lg font-bold font-mono text-teal mt-0.5">
                      ${drawdownCalc.pctToTarget.toFixed(0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Progresso ao profit target</span>
                  <span className="text-teal font-mono font-medium">{drawdownCalc.profitProgress.toFixed(0)}%</span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal to-teal/60 transition-all duration-500"
                    style={{ width: `${Math.max(0, drawdownCalc.profitProgress)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                  <span>${account.balance.toLocaleString()}</span>
                  <span>${(account.balance + account.target).toLocaleString()}</span>
                </div>
              </div>

              {/* Safety warning */}
              {drawdownCalc.safetyMargin < account.drawdown * 0.3 && (
                <div className="flex items-center gap-2.5 bg-loss/10 border border-loss/20 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-loss shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-loss">Zona de perigo</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Margem abaixo de 30% do drawdown máximo. Reduza o tamanho das posições.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!currentBalance && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Digite seu saldo atual para ver os cálculos
            </div>
          )}
        </div>
      )}

      {/* Tab: Consistency Rule */}
      {tab === "consistency" && (
        <div className="space-y-4">
          <div className="bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Regra de Consistência:</strong> Nenhum dia pode representar mais de 50% do lucro total acumulado para aprovação do relatório.
          </div>

          <div className="space-y-2">
            {dailyPnls.map((val, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0 font-mono">Dia {i + 1}</span>
                <input
                  type="number"
                  value={val}
                  onChange={(e) => {
                    const next = [...dailyPnls]
                    next[i] = e.target.value
                    setDailyPnls(next)
                  }}
                  placeholder="0.00"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {consistencyCalc.days[i] && consistencyCalc.total > 0 && (
                  <div className={cn(
                    "w-16 text-right text-xs font-mono font-medium shrink-0",
                    consistencyCalc.days[i].violates ? "text-loss" : "text-profit"
                  )}>
                    {consistencyCalc.days[i].pct.toFixed(0)}%
                    {consistencyCalc.days[i].violates && " ⚠"}
                  </div>
                )}
                <button
                  onClick={() => removeDay(i)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-loss hover:bg-loss/10 transition-all shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addDay}
            disabled={dailyPnls.length >= 20}
            className="w-full py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-teal/30 hover:text-teal transition-all disabled:opacity-40"
          >
            + Adicionar dia
          </button>

          {consistencyCalc.total > 0 && (
            <div className={cn(
              "rounded-xl p-4 border",
              consistencyCalc.hasViolation ? "bg-loss/5 border-loss/20" : "bg-profit/5 border-profit/20"
            )}>
              <div className="flex items-center gap-2 mb-3">
                {consistencyCalc.hasViolation ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-loss" />
                    <span className="text-sm font-semibold text-loss">Violação detectada</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 text-profit" />
                    <span className="text-sm font-semibold text-profit">Tudo certo</span>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Lucro total</p>
                  <p className="font-mono font-bold text-foreground mt-0.5">
                    ${consistencyCalc.total.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Máx permitido/dia</p>
                  <p className="font-mono font-bold text-teal mt-0.5">
                    ${consistencyCalc.maxAllowed.toFixed(2)}
                  </p>
                </div>
              </div>
              {consistencyCalc.hasViolation && (
                <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                  Dias marcados com ⚠ precisam ter o lucro reduzido ou o total precisa crescer antes da avaliação.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Scaling Plan */}
      {tab === "scaling" && (
        <div className="space-y-4">
          <div>
            <label htmlFor="apex-trader-profit" className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">
              Lucro acumulado atual ($)
            </label>
            <input
              id="apex-trader-profit"
              type="number"
              value={traderProfit}
              onChange={(e) => setTraderProfit(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {currentTier && (
            <div className="bg-teal/5 border border-teal/20 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Contratos disponíveis agora</p>
                <p className="text-3xl font-bold font-mono text-teal mt-0.5">{currentTier.contracts}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{currentTier.label}</p>
              </div>
              {currentTier.label === "Tier 5 (Funded)" && (
                <div className="text-right">
                  <CheckCircle className="w-8 h-8 text-profit ml-auto mb-1" />
                  <p className="text-xs text-profit font-medium">Conta aprovada!</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {scalingTiers.map((tier, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border transition-all",
                  tier.active
                    ? "bg-teal/5 border-teal/20"
                    : "border-border opacity-50"
                )}
              >
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  tier.active ? "bg-teal" : "bg-muted"
                )} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{tier.label}</span>
                    <span className="text-xs font-bold font-mono text-teal">{tier.contracts} contratos</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Lucro ≥ ${tier.minProfit.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            Scaling plan baseado nas regras da Apex Trader Funding. Verifique sempre o contrato da sua avaliação.
          </p>
        </div>
      )}
    </div>
  )
}
