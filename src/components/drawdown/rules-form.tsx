"use client"

import { useState, type ReactNode } from "react"
import { Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { openUpgradeModal } from "@/lib/upgrade"
import { PLAN_LABEL, type PlanKey } from "@/lib/plans"
import { DRAWDOWN_LABEL, DRAWDOWN_TYPES } from "@/lib/drawdown-engine"
import {
  FEATURE_MIN_PLAN,
  PRESETS,
  TYPE_FEATURE,
  canUse,
  enforcePlan,
  typeAllowed,
  upsellReason,
  type AccountRules,
  type DrawdownFeature,
} from "@/lib/drawdown-rules"

const INPUT =
  "w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"

export function askUpgrade(feature: DrawdownFeature) {
  openUpgradeModal({ reason: upsellReason(feature), suggestedPlan: FEATURE_MIN_PLAN[feature] })
}

/** Campo com cadeado: fica visível e desabilitado; clique/toque abre o aviso de upgrade. */
export function Field({
  label,
  feature,
  plan,
  hint,
  children,
}: {
  label: string
  feature?: DrawdownFeature
  plan: PlanKey
  hint?: string
  children: ReactNode
}) {
  const locked = feature ? !canUse(plan, feature) : false
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {locked && feature && (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-primary">
            <Lock className="w-2.5 h-2.5" />
            {PLAN_LABEL[FEATURE_MIN_PLAN[feature]]}
          </span>
        )}
      </div>
      <div className="relative">
        <div className={cn(locked && "opacity-50 pointer-events-none select-none")} aria-hidden={locked}>
          {children}
        </div>
        {locked && feature && (
          <button
            type="button"
            onClick={() => askUpgrade(feature)}
            className="absolute inset-0 rounded-md cursor-pointer"
            aria-label={`${label}: ${upsellReason(feature)}`}
          />
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

/** Input numérico com texto local (deixa apagar/digitar) e valor confirmado só quando válido. */
export function NumInput({
  value,
  onChange,
  nullable = false,
  disabled,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  nullable?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const fmt = (v: number | null) => (v === null ? "" : String(v))
  const [txt, setTxt] = useState(fmt(value))
  const [prev, setPrev] = useState(value)
  const parse = (t: string): number | null | undefined => {
    if (t.trim() === "") return nullable ? null : undefined
    const n = Number(t.replace(",", "."))
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  // valor mudou por fora (preset, reset): sincroniza o texto sem efeito
  if (value !== prev) {
    setPrev(value)
    if (parse(txt) !== value) setTxt(fmt(value))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      className={INPUT}
      value={txt}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => {
        setTxt(e.target.value)
        const n = parse(e.target.value)
        if (n !== undefined) onChange(n)
      }}
    />
  )
}

interface RulesFormProps {
  rules: AccountRules
  onChange: (next: AccountRules) => void
  plan: PlanKey
  /** Real: mostra a regra oficial da conta e a virada do dia. Simular: roda as 4 lado a lado. */
  mode: "real" | "simular"
}

export function RulesForm({ rules, onChange, plan, mode }: RulesFormProps) {
  const set = <K extends keyof AccountRules>(key: K, value: AccountRules[K]) => onChange({ ...rules, [key]: value })
  const presetsLocked = !canUse(plan, "presets")

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    onChange(enforcePlan(plan, { ...rules, ...p.rules } as AccountRules))
  }

  const activePreset = PRESETS.find((p) => p.rules.preset === rules.preset)

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Preset de mesa" feature="presets" plan={plan}>
          <select
            className={INPUT}
            value={activePreset?.id ?? ""}
            disabled={presetsLocked}
            onChange={(e) => e.target.value && applyPreset(e.target.value)}
          >
            <option value="">Personalizada</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Saldo inicial ($)" plan={plan}>
          <NumInput value={rules.startBalance} onChange={(v) => v && set("startBalance", v)} />
        </Field>
        <Field label="Meta de lucro ($)" plan={plan}>
          <NumInput value={rules.profitTarget} nullable onChange={(v) => set("profitTarget", v)} placeholder="sem meta" />
        </Field>
        <Field label="Drawdown máximo ($)" plan={plan}>
          <NumInput value={rules.maxDrawdown} onChange={(v) => v && set("maxDrawdown", v)} />
        </Field>
      </div>

      {activePreset && <p className="text-[11px] text-muted-foreground -mt-1">{activePreset.note}</p>}

      {mode === "real" && (
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Regra de drawdown desta conta</span>
          <div className="flex flex-wrap gap-1.5">
            {DRAWDOWN_TYPES.map((t) => {
              const ok = typeAllowed(plan, t)
              const feat = TYPE_FEATURE[t]
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => (ok ? set("type", t) : feat && askUpgrade(feat))}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border font-medium transition-colors",
                    rules.type === t
                      ? "bg-primary/15 border-primary/40 text-foreground"
                      : "bg-muted/40 border-border text-muted-foreground hover:text-foreground",
                    !ok && "opacity-60"
                  )}
                >
                  {!ok && <Lock className="w-3 h-3" />}
                  {DRAWDOWN_LABEL[t]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Trava do trailing" feature="trailingLock" plan={plan} hint="O limite não sobe além desse nível">
          <select
            className={INPUT}
            value={rules.trailingLock === null ? "none" : "start"}
            disabled={!canUse(plan, "trailingLock")}
            onChange={(e) => set("trailingLock", e.target.value === "start" ? rules.startBalance : null)}
          >
            <option value="start">No saldo inicial</option>
            <option value="none">Sem trava</option>
          </select>
        </Field>
        <Field label="Limite de perda diário ($)" feature="dailyLossLimit" plan={plan}>
          <NumInput
            value={rules.dailyLossLimit}
            nullable
            disabled={!canUse(plan, "dailyLossLimit")}
            onChange={(v) => set("dailyLossLimit", v)}
            placeholder="sem limite"
          />
        </Field>
        <Field label="Consistência máx. (%)" feature="consistency" plan={plan} hint="Maior dia ÷ lucro">
          <NumInput
            value={rules.consistencyMaxPct}
            nullable
            disabled={!canUse(plan, "consistency")}
            onChange={(v) => set("consistencyMaxPct", v === null ? null : Math.min(v, 100))}
            placeholder="sem regra"
          />
        </Field>
        <Field label="Base da consistência" feature="consistency" plan={plan}>
          <select
            className={INPUT}
            value={rules.consistencyBase}
            disabled={!canUse(plan, "consistency")}
            onChange={(e) => set("consistencyBase", e.target.value as AccountRules["consistencyBase"])}
          >
            <option value="NET_PROFIT">Lucro líquido</option>
            <option value="ABS_SUM">Soma dos dias (absoluto)</option>
          </select>
        </Field>
        {mode === "real" && (
          <Field label="Virada do dia (hora BR)" feature="dayRollover" plan={plan} hint="0 = dia do calendário; 18 = trading day">
            <NumInput
              value={rules.dayRolloverHour}
              disabled={!canUse(plan, "dayRollover")}
              onChange={(v) => v !== null && set("dayRolloverHour", Math.min(23, Math.floor(v)))}
            />
          </Field>
        )}
        <Field label="Dias mínimos de operação" feature="minTradingDays" plan={plan}>
          <NumInput
            value={rules.minTradingDays}
            nullable
            disabled={!canUse(plan, "minTradingDays")}
            onChange={(v) => set("minTradingDays", v === null ? null : Math.floor(v))}
            placeholder="sem mínimo"
          />
        </Field>
      </div>
    </div>
  )
}
