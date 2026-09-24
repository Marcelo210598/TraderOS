"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { simulate, stepsFromTrades, type TradeInput } from "@/lib/drawdown-engine"
import {
  DEFAULT_ACCOUNT_RULES,
  enforcePlan,
  loadStoredRules,
  saveStoredRules,
  tradingDayKeyBR,
  type AccountRules,
} from "@/lib/drawdown-rules"
import { formatShortDateBR } from "@/lib/date"
import type { PlanKey } from "@/lib/plans"
import { RulesForm, askUpgrade } from "./rules-form"
import { ResultPanel } from "./result-panel"

export interface DrawdownAccount {
  id: string
  name: string
  label: string
  initialBalance: number
}

interface RealTabProps {
  plan: PlanKey
  accounts: DrawdownAccount[]
  selectedId: string | null
  trades: TradeInput[]
}

export function RealTab({ plan, accounts, selectedId, trades }: RealTabProps) {
  const router = useRouter()
  const selected = accounts.find((a) => a.id === selectedId) ?? null

  if (!accounts.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        Nenhuma conta ainda. Registre trades no Journal (ou conecte o NinjaTrader) e sua conta aparece aqui pra acompanhar o drawdown.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {accounts.map((a, i) => {
          const locked = plan !== "PRO" && i > 0
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => (locked ? askUpgrade("multiAccount") : router.replace(`/drawdown?tab=real&conta=${a.id}`))}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border font-medium transition-colors",
                a.id === selectedId
                  ? "bg-primary/15 border-primary/40 text-foreground"
                  : "bg-muted/40 border-border text-muted-foreground hover:text-foreground",
                locked && "opacity-60"
              )}
            >
              {locked && <Lock className="w-3 h-3" />}
              {a.name}
            </button>
          )
        })}
      </div>
      {selected && <RealAccount key={selected.id} account={selected} plan={plan} trades={trades} />}
    </div>
  )
}

function RealAccount({ account, plan, trades }: { account: DrawdownAccount; plan: PlanKey; trades: TradeInput[] }) {
  const [rules, setRules] = useState<AccountRules>({
    ...DEFAULT_ACCOUNT_RULES,
    ...(account.initialBalance > 0 ? { startBalance: account.initialBalance, trailingLock: account.initialBalance } : {}),
  })
  const [saved, setSaved] = useState<"idle" | "ok" | "fail">("idle")

  // regras guardadas no navegador (v1) — carrega depois de montar pra não divergir do HTML do servidor
  useEffect(() => {
    const stored = loadStoredRules(account.id)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setRules(stored)
  }, [account.id])

  const effective = useMemo(() => enforcePlan(plan, rules), [plan, rules])
  const frames = useMemo(
    () => simulate(effective, stepsFromTrades(trades, (ms) => tradingDayKeyBR(ms, effective.dayRolloverHour))),
    [effective, trades]
  )

  const dates = trades.map((t) => t.date)
  const xLabels = dates.length
    ? [formatShortDateBR(Math.min(...dates)), formatShortDateBR(Math.max(...dates))]
    : ["", ""]

  function save() {
    setSaved(saveStoredRules(account.id, effective) ? "ok" : "fail")
    setTimeout(() => setSaved("idle"), 2500)
  }

  return (
    <div className="space-y-4">
      <RulesForm
        rules={rules}
        onChange={(r) => {
          setSaved("idle")
          setRules(r)
        }}
        plan={plan}
        mode="real"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          className="text-xs font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Salvar regras desta conta
        </button>
        {saved === "ok" && <span className="text-xs text-profit">Salvo neste navegador ✓</span>}
        {saved === "fail" && <span className="text-xs text-loss">Não consegui salvar (navegador bloqueou o armazenamento).</span>}
      </div>

      {trades.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          Essa conta ainda não tem trades. Quando você lançar, o drawdown é calculado automaticamente.
        </div>
      ) : (
        <>
          <ResultPanel
            frames={frames}
            rules={effective}
            plan={plan}
            highlight={effective.type}
            xLabels={xLabels}
            stepLabel={(f) => (f.step === 0 ? "Saldo inicial" : `Passo ${f.step}`)}
          />
          <p className="text-[11px] text-muted-foreground/70">
            O pico do Intraday é estimado pelo MFE dos seus trades, no pior caso (pico antes do fundo). End of Day, End of Position e
            Static usam só o saldo fechado. Compare sempre com o painel da sua mesa.
          </p>
        </>
      )}
    </div>
  )
}
