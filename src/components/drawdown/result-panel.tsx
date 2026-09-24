"use client"

import { useState } from "react"
import { Lock, AlertTriangle, Target, CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrubPlot, formatAxis, makeYPct, xPct } from "@/components/analytics/scrub-plot"
import { DRAWDOWN_LABEL, DRAWDOWN_TYPES, type DrawdownType, type Frame } from "@/lib/drawdown-engine"
import { TYPE_FEATURE, typeAllowed, usd, type AccountRules } from "@/lib/drawdown-rules"
import type { PlanKey } from "@/lib/plans"
import { askUpgrade } from "./rules-form"

// Uma cor/traço por regra — igual no gráfico, na legenda e nos cards.
const STYLE: Record<DrawdownType, { color: string; dash?: string }> = {
  INTRADAY: { color: "#f43f5e", dash: "5 3" },
  END_OF_DAY: { color: "#3b82f6", dash: "7 3 1 3" },
  END_OF_POSITION: { color: "#a78bfa", dash: "1.5 3" },
  STATIC: { color: "#22c55e" },
}
const TARGET_COLOR = "#eab308"

interface ResultPanelProps {
  frames: Frame[]
  rules: AccountRules
  plan: PlanKey
  /** regra oficial da conta (modo Real) — ganha destaque nos cards */
  highlight?: DrawdownType
  xLabels: string[]
  /** legenda do passo no tooltip (ex.: "Passo 3") */
  stepLabel: (frame: Frame) => string
}

export function ResultPanel({ frames, rules, plan, highlight, xLabels, stepLabel }: ResultPanelProps) {
  const [hidden, setHidden] = useState<Set<DrawdownType>>(new Set())
  const last = frames[frames.length - 1]

  const isShown = (t: DrawdownType) => typeAllowed(plan, t) && !hidden.has(t)
  const toggle = (t: DrawdownType) => {
    if (!typeAllowed(plan, t)) {
      const f = TYPE_FEATURE[t]
      if (f) askUpgrade(f)
      return
    }
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <Stats last={last} rules={rules} />
      <StatusBadges last={last} rules={rules} plan={plan} />

      <div className="bg-card border border-border rounded-xl p-4">
        <Chart frames={frames} rules={rules} isShown={isShown} xLabels={xLabels} stepLabel={stepLabel} />
        <div className="flex flex-wrap gap-1.5 mt-3">
          {DRAWDOWN_TYPES.map((t) => {
            const ok = typeAllowed(plan, t)
            const on = isShown(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border transition-colors",
                  on ? "border-border bg-muted/40 text-foreground" : "border-border/50 text-muted-foreground/60"
                )}
              >
                {ok ? (
                  <svg width="18" height="6" aria-hidden>
                    <line x1="0" x2="18" y1="3" y2="3" stroke={STYLE[t].color} strokeWidth="2" strokeDasharray={STYLE[t].dash} opacity={on ? 1 : 0.35} />
                  </svg>
                ) : (
                  <Lock className="w-3 h-3" />
                )}
                {DRAWDOWN_LABEL[t]}
              </button>
            )
          })}
          <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 text-muted-foreground">
            <span className="w-4 h-0.5 rounded" style={{ background: "#e5e7eb" }} />
            Patrimônio
          </span>
          {rules.profitTarget !== null && (
            <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 text-muted-foreground">
              <span className="w-4 h-0.5 rounded" style={{ background: TARGET_COLOR }} />
              Meta
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {DRAWDOWN_TYPES.map((t) => (
          <RuleCard key={t} type={t} frame={last} plan={plan} highlighted={highlight === t} />
        ))}
      </div>

      <ConsistencyCard last={last} rules={rules} plan={plan} />
    </div>
  )
}

function Stats({ last, rules }: { last: Frame; rules: AccountRules }) {
  const items = [
    { label: "Dia atual", value: String(last.day) },
    {
      label: "Dias operados",
      value: rules.minTradingDays ? `${last.daysTraded}/${rules.minTradingDays}` : String(last.daysTraded),
    },
    { label: "Negociações", value: String(last.trades) },
    { label: "Saldo realizado", value: usd(last.balance) },
    { label: "Resultado em aberto", value: usd(last.open, { sign: true }) },
    { label: "Patrimônio (equity)", value: usd(last.equity) },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map((s) => (
        <div key={s.label} className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
          <p className="text-lg font-bold font-mono mt-0.5">{s.value}</p>
        </div>
      ))}
    </div>
  )
}

function StatusBadges({ last, rules, plan }: { last: Frame; rules: AccountRules; plan: PlanKey }) {
  const badges: { key: string; text: string; tone: "warn" | "good" | "info" }[] = []
  if (last.targetReachedClosed) badges.push({ key: "t1", text: "Meta atingida (fechada)", tone: "good" })
  else if (last.targetTouchedOpen) badges.push({ key: "t2", text: "Meta tocada em aberto", tone: "info" })
  if (rules.dailyLossLimit !== null && plan !== "FREE" && last.dailyLossHit)
    badges.push({ key: "d", text: `Limite diário de ${usd(rules.dailyLossLimit)} atingido hoje`, tone: "warn" })
  if (!badges.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <span
          key={b.key}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium",
            b.tone === "warn" && "border-loss/40 bg-loss/10 text-loss",
            b.tone === "good" && "border-profit/40 bg-profit/10 text-profit",
            b.tone === "info" && "border-yellow-400/40 bg-yellow-400/10 text-yellow-400"
          )}
        >
          {b.tone === "warn" ? <AlertTriangle className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" />}
          {b.text}
        </span>
      ))}
    </div>
  )
}

function stepPath(xs: number[], ys: number[]) {
  return ys.map((y, i) => (i === 0 ? `M ${xs[0]} ${y}` : `H ${xs[i]} V ${y}`)).join(" ")
}

function Chart({
  frames,
  rules,
  isShown,
  xLabels,
  stepLabel,
}: {
  frames: Frame[]
  rules: AccountRules
  isShown: (t: DrawdownType) => boolean
  xLabels: string[]
  stepLabel: (frame: Frame) => string
}) {
  const count = frames.length
  const target = rules.profitTarget === null ? null : rules.startBalance + rules.profitTarget
  const shown = DRAWDOWN_TYPES.filter(isShown)

  const values = [
    ...frames.map((f) => f.equity),
    rules.startBalance,
    rules.startBalance - rules.maxDrawdown,
    ...(target !== null ? [target] : []),
    ...shown.flatMap((t) => frames.map((f) => f.rules[t].limit)),
  ]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.04 || 50
  const toY = makeYPct(lo - pad, hi + pad)
  const xs = frames.map((_, i) => xPct(i, count))
  const equityYs = frames.map((f) => toY(f.equity))

  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / 4
    return { y: toY(v), label: formatAxis(v) }
  })

  const hLine = (v: number, color: string, dash?: string, opacity = 1) => (
    <line
      x1="0" x2="100" y1={toY(v)} y2={toY(v)}
      stroke={color} strokeWidth="1.5" strokeDasharray={dash} strokeOpacity={opacity}
      vectorEffect="non-scaling-stroke"
    />
  )

  return (
    <ScrubPlot
      count={count}
      yPcts={equityYs}
      ticks={ticks}
      xLabels={xLabels}
      dotColor="#e5e7eb"
      height={260}
      tooltip={(i) => {
        const f = frames[i]
        return (
          <div className="space-y-1">
            <p className="font-semibold">{stepLabel(f)}</p>
            <p className="font-mono">Patrimônio {usd(f.equity)}</p>
            {shown.map((t) => (
              <p key={t} className="font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: STYLE[t].color }} />
                {DRAWDOWN_LABEL[t]}: {usd(f.rules[t].limit)}
                <span className="text-muted-foreground">(margem {usd(f.rules[t].margin)})</span>
              </p>
            ))}
          </div>
        )
      }}
    >
      {hLine(rules.startBalance, "#9ca3af", "1 3", 0.6)}
      {target !== null && hLine(target, TARGET_COLOR)}
      {shown.map((t) => (
        <path
          key={t}
          d={stepPath(xs, frames.map((f) => toY(f.rules[t].limit)))}
          fill="none"
          stroke={STYLE[t].color}
          strokeWidth="1.8"
          strokeDasharray={STYLE[t].dash}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${equityYs[i]}`).join(" ")}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </ScrubPlot>
  )
}

function RuleCard({
  type,
  frame,
  plan,
  highlighted,
}: {
  type: DrawdownType
  frame: Frame
  plan: PlanKey
  highlighted: boolean
}) {
  const ok = typeAllowed(plan, type)
  const feat = TYPE_FEATURE[type]
  const snap = frame.rules[type]
  const { color } = STYLE[type]
  const mask = (v: string) => (ok ? v : "••••")

  const rows: [string, string][] = [
    ["Limite atual", mask(usd(snap.limit))],
    ["Margem até o limite", mask(usd(snap.margin))],
    ["Dias operados", String(frame.daysTraded)],
    ["Negociações", String(frame.trades)],
    ["Falta para a meta", frame.toTarget === null ? "—" : mask(usd(frame.toTarget))],
  ]

  return (
    <div
      className={cn(
        "relative bg-card border rounded-xl p-4 overflow-hidden",
        highlighted ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
        ok && snap.status === "BREACHED" && "border-loss/60"
      )}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-semibold" style={{ color }}>
            {DRAWDOWN_LABEL[type]}
          </p>
          {highlighted && <p className="text-[10px] text-primary uppercase tracking-wider mt-0.5">Regra desta conta</p>}
        </div>
        {ok ? (
          snap.status === "OK" ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-profit">
              <CheckCircle2 className="w-3.5 h-3.5" /> OK
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-loss">
              <XCircle className="w-3.5 h-3.5" /> QUEBROU
            </span>
          )
        ) : (
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>

      <dl className={cn("space-y-1.5", !ok && "opacity-50 select-none")}>
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {ok && snap.status === "BREACHED" && snap.breachedAtStep !== null && (
        <p className="text-[10px] text-loss mt-2">Quebrou no passo {snap.breachedAtStep}.</p>
      )}

      {snap.progress !== null && (
        <div className={cn("mt-3", !ok && "opacity-50")}>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${ok ? snap.progress * 100 : 0}%`, background: color }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Limite {ok ? `${Math.round(snap.progress * 100)}%` : "—"}</span>
            <span>Meta</span>
          </div>
        </div>
      )}

      {!ok && feat && (
        <button
          type="button"
          onClick={() => askUpgrade(feat)}
          className="absolute inset-0 cursor-pointer"
          aria-label={`${DRAWDOWN_LABEL[type]} bloqueado — ver planos`}
        />
      )}
    </div>
  )
}

function ConsistencyCard({ last, rules, plan }: { last: Frame; rules: AccountRules; plan: PlanKey }) {
  if (plan !== "PRO") {
    return (
      <button
        type="button"
        onClick={() => askUpgrade("consistency")}
        className="w-full text-left bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3 opacity-70 hover:opacity-100 transition-opacity"
      >
        <span className="text-sm font-semibold">Consistência (maior dia ÷ lucro)</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Lock className="w-3.5 h-3.5" /> Pro
        </span>
      </button>
    )
  }
  const c = last.consistency
  if (rules.consistencyMaxPct === null) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground">
        Consistência: defina o limite (%) da sua mesa nas regras acima pra acompanhar aqui.
      </div>
    )
  }
  if (!c || c.pct === null) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground">
        Consistência: ainda sem lucro fechado pra calcular (limite {rules.consistencyMaxPct}%).
      </div>
    )
  }
  return (
    <div className={cn("bg-card border rounded-xl p-4", c.ok ? "border-profit/40" : "border-yellow-400/40")}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Consistência</p>
          <p className={cn("text-2xl font-bold font-mono", c.ok ? "text-profit" : "text-yellow-400")}>{c.pct.toFixed(2)}%</p>
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5 text-right">
          <p>
            Maior dia <span className="font-mono text-foreground">{usd(c.bestDay)}</span> · base{" "}
            <span className="font-mono text-foreground">{usd(c.base)}</span>
          </p>
          <p>
            Limite <span className="font-mono text-foreground">{rules.consistencyMaxPct}%</span>
            {c.ok ? " — dentro da regra" : ` — faltam ~${usd(c.extraNeeded)} de lucro em outros dias`}
          </p>
        </div>
      </div>
    </div>
  )
}
