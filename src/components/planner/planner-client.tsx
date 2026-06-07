"use client"

import { useState } from "react"
import { CheckCircle2, Circle, Trash2, Plus, Target, ShieldAlert, FileText, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface TradePlan {
  id: string
  date: string
  maxLoss: number
  profitTarget: number
  setupsPlanned: string[]
  notes: string | null
  executed: boolean
}

interface Setup {
  id: string
  name: string
}

interface Props {
  plans: TradePlan[]
  setups: Setup[]
  todayStr: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
}

function PlanHistoryCard({ plan, onToggleExecuted, onDelete }: {
  plan: TradePlan
  onToggleExecuted: (id: string, executed: boolean) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn(
      "bg-card border rounded-xl overflow-hidden",
      plan.executed ? "border-profit/20" : "border-border"
    )}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className={cn(
          "w-2 h-2 rounded-full shrink-0",
          plan.executed ? "bg-profit" : "bg-muted-foreground/40"
        )} />
        <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">{formatDate(plan.date)}</span>
        <span className="text-sm font-medium text-foreground flex-1">
          Stop <span className="text-loss font-mono">${plan.maxLoss}</span>
          {" · "}
          Alvo <span className="text-profit font-mono">${plan.profitTarget}</span>
        </span>
        {plan.executed && (
          <span className="text-[10px] font-mono text-profit bg-profit/10 px-2 py-0.5 rounded-full">executado</span>
        )}
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          {plan.setupsPlanned.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {plan.setupsPlanned.map((s) => (
                <span key={s} className="text-[11px] bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full font-mono">
                  {s}
                </span>
              ))}
            </div>
          )}
          {plan.notes && (
            <p className="text-xs text-muted-foreground leading-relaxed">{plan.notes}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onToggleExecuted(plan.id, !plan.executed)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all",
                plan.executed
                  ? "border-profit/30 text-profit bg-profit/10 hover:bg-profit/20"
                  : "border-border text-muted-foreground hover:border-profit/30 hover:text-profit"
              )}
            >
              {plan.executed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
              {plan.executed ? "Executado" : "Marcar como executado"}
            </button>
            <button
              onClick={() => onDelete(plan.id)}
              className="ml-auto text-muted-foreground hover:text-loss transition-colors p-1.5 rounded-lg hover:bg-loss/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PlannerClient({ plans: initialPlans, setups, todayStr }: Props) {
  const [plans, setPlans] = useState<TradePlan[]>(initialPlans)
  const [saving, setSaving] = useState(false)
  const [setupInput, setSetupInput] = useState("")

  const todayPlan = plans.find((p) => p.date.slice(0, 10) === todayStr)
  const history = plans.filter((p) => p.date.slice(0, 10) !== todayStr)

  const [maxLoss, setMaxLoss] = useState(todayPlan?.maxLoss ?? 500)
  const [profitTarget, setProfitTarget] = useState(todayPlan?.profitTarget ?? 1000)
  const [selectedSetups, setSelectedSetups] = useState<string[]>(todayPlan?.setupsPlanned ?? [])
  const [notes, setNotes] = useState(todayPlan?.notes ?? "")

  const rrRatio = profitTarget > 0 && maxLoss > 0 ? (profitTarget / maxLoss).toFixed(1) : "—"

  function toggleSetup(name: string) {
    setSelectedSetups((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    )
  }

  function addCustomSetup() {
    const trimmed = setupInput.trim()
    if (!trimmed || selectedSetups.includes(trimmed)) return
    setSelectedSetups((prev) => [...prev, trimmed])
    setSetupInput("")
  }

  async function savePlan() {
    setSaving(true)
    try {
      const res = await fetch("/api/trade-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayStr, maxLoss, profitTarget, setupsPlanned: selectedSetups, notes }),
      })
      if (!res.ok) throw new Error("Erro ao salvar")
      const updated: TradePlan = await res.json()
      setPlans((prev) => {
        const filtered = prev.filter((p) => p.date.slice(0, 10) !== todayStr)
        return [updated, ...filtered]
      })
    } finally {
      setSaving(false)
    }
  }

  async function toggleExecuted(id: string, executed: boolean) {
    const res = await fetch(`/api/trade-plans/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executed }),
    })
    if (!res.ok) return
    const updated: TradePlan = await res.json()
    setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)))
  }

  async function deletePlan(id: string) {
    const res = await fetch(`/api/trade-plans/${id}`, { method: "DELETE" })
    if (!res.ok) return
    setPlans((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* Plano de hoje */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Plano de hoje</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(todayStr + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
          </div>
          {todayPlan?.executed && (
            <span className="flex items-center gap-1 text-xs text-profit bg-profit/10 border border-profit/20 px-2.5 py-1 rounded-full font-mono">
              <CheckCircle2 className="w-3 h-3" /> executado
            </span>
          )}
        </div>

        {/* Max Loss + Target */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ShieldAlert className="w-3.5 h-3.5 text-loss" /> Max Loss
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">$</span>
              <input
                type="number"
                value={maxLoss}
                onChange={(e) => setMaxLoss(Number(e.target.value))}
                className="w-full pl-7 pr-3 py-2.5 bg-background border border-border rounded-lg text-sm font-mono text-loss focus:outline-none focus:ring-1 focus:ring-loss/50"
                min={0}
                step={50}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="w-3.5 h-3.5 text-profit" /> Profit Target
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">$</span>
              <input
                type="number"
                value={profitTarget}
                onChange={(e) => setProfitTarget(Number(e.target.value))}
                className="w-full pl-7 pr-3 py-2.5 bg-background border border-border rounded-lg text-sm font-mono text-profit focus:outline-none focus:ring-1 focus:ring-profit/50"
                min={0}
                step={50}
              />
            </div>
          </div>
        </div>

        {/* R:R badge */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Risco/Retorno:</span>
          <span className={cn(
            "text-xs font-mono font-bold px-2.5 py-0.5 rounded-full",
            Number(rrRatio) >= 2 ? "bg-profit/10 text-profit" :
            Number(rrRatio) >= 1.5 ? "bg-yellow-500/10 text-yellow-500" :
            "bg-loss/10 text-loss"
          )}>
            1:{rrRatio}
          </span>
        </div>

        {/* Setups */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Setups planejados</label>
          <div className="flex flex-wrap gap-1.5">
            {setups.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleSetup(s.name)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-all font-mono",
                  selectedSetups.includes(s.name)
                    ? "bg-teal/15 border-teal/40 text-teal"
                    : "bg-muted/30 border-border text-muted-foreground hover:border-teal/30"
                )}
              >
                {s.name}
              </button>
            ))}
            {selectedSetups.filter(s => !setups.find(st => st.name === s)).map((s) => (
              <button
                key={s}
                onClick={() => toggleSetup(s)}
                className="text-xs px-2.5 py-1 rounded-full border bg-teal/15 border-teal/40 text-teal font-mono"
              >
                {s} ✕
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={setupInput}
              onChange={(e) => setSetupInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomSetup()}
              placeholder="Adicionar setup customizado..."
              className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
            <button
              onClick={addCustomSetup}
              className="px-3 py-1.5 bg-muted border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileText className="w-3.5 h-3.5" /> Notas pré-sessão
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contexto do mercado, níveis importantes, regras para hoje..."
            rows={3}
            className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-border leading-relaxed"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={savePlan}
            disabled={saving}
            className="flex-1 py-2.5 bg-teal text-teal-foreground rounded-xl text-sm font-medium hover:bg-teal/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Salvando..." : todayPlan ? "Atualizar plano" : "Salvar plano"}
          </button>
          {todayPlan && (
            <button
              onClick={() => toggleExecuted(todayPlan.id, !todayPlan.executed)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm border transition-all",
                todayPlan.executed
                  ? "bg-profit/10 border-profit/30 text-profit"
                  : "border-border text-muted-foreground hover:border-profit/30 hover:text-profit"
              )}
            >
              {todayPlan.executed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              {todayPlan.executed ? "Executado" : "Marcar"}
            </button>
          )}
        </div>
      </div>

      {/* Histórico */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Histórico</h3>
          {history.map((plan) => (
            <PlanHistoryCard
              key={plan.id}
              plan={plan}
              onToggleExecuted={toggleExecuted}
              onDelete={deletePlan}
            />
          ))}
        </div>
      )}

      {plans.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <p className="text-sm text-muted-foreground">Nenhum plano ainda. Crie o plano de hoje acima.</p>
        </div>
      )}
    </div>
  )
}
