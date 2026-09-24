"use client"

import { useState } from "react"
import { Lock, AlertTriangle, Target, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { DRAWDOWN_LABEL, DRAWDOWN_TYPES, type DrawdownType, type Frame } from "@/lib/drawdown-engine"
import { INSTRUMENTS, pointValueFor } from "@/lib/instruments"
import { TYPE_FEATURE, canUse, typeAllowed, usd, type AccountRules } from "@/lib/drawdown-rules"
import type { PlanKey } from "@/lib/plans"
import { askUpgrade } from "./rules-form"
import { DrawdownChart } from "./drawdown-chart"
import { Marker, RULE_STYLE, TARGET_COLOR, zoneOf } from "./rule-style"

interface ResultPanelProps {
  frames: Frame[]
  rules: AccountRules
  plan: PlanKey
  /** regra oficial da conta (modo Real) — vira o foco inicial */
  highlight?: DrawdownType
  xLabels: string[]
  stepLabel: (frame: Frame) => string
}

export function ResultPanel({ frames, rules, plan, highlight, xLabels, stepLabel }: ResultPanelProps) {
  const [hidden, setHidden] = useState<Set<DrawdownType>>(new Set())
  const [focusPick, setFocusPick] = useState<DrawdownType | null>(null)
  const last = frames[frames.length - 1]

  // foco = escolha do usuário > regra da conta > Intraday (a única rígida liberada em todos os planos)
  const preferred = focusPick ?? highlight ?? "INTRADAY"
  const focus = typeAllowed(plan, preferred) ? preferred : "INTRADAY"

  const isShown = (t: DrawdownType) => typeAllowed(plan, t) && !hidden.has(t)
  const toggle = (t: DrawdownType) => {
    if (!typeAllowed(plan, t)) {
      const f = TYPE_FEATURE[t]
      if (f) askUpgrade(f)
      return
    }
    if (t === focus) return // o foco sempre aparece
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const snap = last.rules[focus]
  const zone = zoneOf(snap.margin, rules.maxDrawdown, snap.status === "BREACHED")

  return (
    <div className="space-y-4">
      <MarginHero frame={last} rules={rules} focus={focus} />
      <Stats last={last} rules={rules} />
      <StatusBadges last={last} rules={rules} plan={plan} />

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p className="text-sm font-semibold">
            Corredor de segurança <span className="text-muted-foreground font-normal">· {DRAWDOWN_LABEL[focus]}</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Comparar</span>
            {DRAWDOWN_TYPES.filter((t) => t !== focus).map((t) => {
              const ok = typeAllowed(plan, t)
              const on = isShown(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggle(t)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                    on ? "border-border bg-muted/50 text-foreground" : "border-border/50 text-muted-foreground/60"
                  )}
                >
                  {ok ? <Marker shape={RULE_STYLE[t].shape} color={RULE_STYLE[t].color} size={9} /> : <Lock className="w-3 h-3" />}
                  {RULE_STYLE[t].short}
                </button>
              )
            })}
          </div>
        </div>
        <DrawdownChart
          frames={frames}
          rules={rules}
          focus={focus}
          visible={isShown}
          zoneColor={zone.color}
          xLabels={xLabels}
          stepLabel={stepLabel}
        />
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          A área sombreada é o espaço entre o seu patrimônio e o limite da regra em foco — quanto mais fina, mais perto de quebrar.
        </p>
      </div>

      <Scoreboard frame={last} rules={rules} plan={plan} focus={focus} onFocus={setFocusPick} />
      <RiskCard frame={last} rules={rules} plan={plan} focus={focus} />
      <ConsistencyCard last={last} rules={rules} plan={plan} />
    </div>
  )
}

// ─── Herói: margem da regra em foco ──────────────────────────────────────────

function MarginHero({ frame, rules, focus }: { frame: Frame; rules: AccountRules; focus: DrawdownType }) {
  const snap = frame.rules[focus]
  const zone = zoneOf(snap.margin, rules.maxDrawdown, snap.status === "BREACHED")
  const pct = Math.max(0, Math.min(1, snap.margin / rules.maxDrawdown))
  const style = RULE_STYLE[focus]

  return (
    <div className="bg-card border border-border rounded-xl p-5" style={{ borderLeftColor: zone.color, borderLeftWidth: 4 }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Marker shape={style.shape} color={style.color} size={9} />
            Quanto ainda posso perder · {DRAWDOWN_LABEL[focus]}
          </p>
          <p className="text-4xl font-bold font-mono mt-1" style={{ color: zone.color }}>
            {usd(Math.max(0, snap.margin))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            de {usd(rules.maxDrawdown)} de drawdown · limite em <span className="font-mono text-foreground">{usd(snap.limit)}</span>
          </p>
        </div>
        <div className="text-right space-y-1.5">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border"
            style={{ color: zone.color, borderColor: `${zone.color}66`, background: `${zone.color}1a` }}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {zone.label}
          </span>
          {frame.toTarget !== null && (
            <p className="text-xs text-muted-foreground">
              {frame.toTarget === 0 ? "Meta batida" : <>Faltam <span className="font-mono text-foreground">{usd(frame.toTarget)}</span> pra meta</>}
            </p>
          )}
          {snap.status === "BREACHED" && snap.breachedAtStep !== null && (
            <p className="text-[11px] text-loss">Quebrou no passo {snap.breachedAtStep}</p>
          )}
        </div>
      </div>

      {/* termômetro: fatia do drawdown que ainda resta, com as faixas de zona */}
      <div className="mt-4">
        <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: zone.color }} />
          <span className="absolute top-0 bottom-0 w-px bg-background/80" style={{ left: "30%" }} />
          <span className="absolute top-0 bottom-0 w-px bg-background/80" style={{ left: "60%" }} />
        </div>
        <div className="flex text-[10px] text-muted-foreground mt-1">
          <span style={{ width: "30%" }}>Perigo</span>
          <span style={{ width: "30%" }}>Atenção</span>
          <span>Folgado</span>
        </div>
      </div>
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
    { label: "Patrimônio", value: usd(last.equity) },
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
  else if (last.targetTouchedOpen) badges.push({ key: "t2", text: "Meta tocada em aberto — feche pra valer", tone: "info" })
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
          {b.tone === "warn" ? <AlertTriangle className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" style={{ color: TARGET_COLOR }} />}
          {b.text}
        </span>
      ))}
    </div>
  )
}

// ─── Placar das regras ───────────────────────────────────────────────────────

function Scoreboard({
  frame,
  rules,
  plan,
  focus,
  onFocus,
}: {
  frame: Frame
  rules: AccountRules
  plan: PlanKey
  focus: DrawdownType
  onFocus: (t: DrawdownType) => void
}) {
  const open = DRAWDOWN_TYPES.filter((t) => typeAllowed(plan, t) && frame.rules[t].status === "OK")
  const margins = open.map((t) => frame.rules[t].margin)
  const tight = open.find((t) => frame.rules[t].margin === Math.min(...margins))
  const loose = open.find((t) => frame.rules[t].margin === Math.max(...margins))
  const gap = margins.length > 1 ? Math.max(...margins) - Math.min(...margins) : 0

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm font-semibold">Placar das regras</p>
        <span className="text-[10px] text-muted-foreground">toque numa regra pra colocar em foco</span>
      </div>
      {tight && loose && gap > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          Nesse cenário, <span className="font-semibold" style={{ color: RULE_STYLE[tight].color }}>{RULE_STYLE[tight].short}</span> é a mais
          apertada: <span className="font-mono text-foreground">{usd(gap)}</span> a menos de margem que{" "}
          <span className="font-semibold" style={{ color: RULE_STYLE[loose].color }}>{RULE_STYLE[loose].short}</span>.
        </p>
      )}

      <ul className="divide-y divide-border/60">
        {DRAWDOWN_TYPES.map((t) => {
          const ok = typeAllowed(plan, t)
          const feat = TYPE_FEATURE[t]
          const snap = frame.rules[t]
          const zone = zoneOf(snap.margin, rules.maxDrawdown, snap.status === "BREACHED")
          const pct = Math.max(0, Math.min(1, snap.margin / rules.maxDrawdown))
          const style = RULE_STYLE[t]
          return (
            <li key={t}>
              <button
                type="button"
                onClick={() => (ok ? onFocus(t) : feat && askUpgrade(feat))}
                className={cn(
                  "w-full text-left py-3 px-2 -mx-2 rounded-lg grid grid-cols-[1fr_auto] sm:grid-cols-[190px_1fr_170px_80px] items-center gap-x-4 gap-y-1.5 transition-colors",
                  t === focus ? "bg-muted/50" : "hover:bg-muted/30",
                  !ok && "opacity-60"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {ok ? <Marker shape={style.shape} color={style.color} /> : <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
                  {DRAWDOWN_LABEL[t]}
                  {t === focus && ok && <span className="text-[9px] uppercase tracking-wider text-primary">foco</span>}
                </span>
                <span
                  className="text-xs font-semibold sm:order-4 text-right"
                  style={{ color: ok ? zone.color : undefined }}
                >
                  {ok ? zone.label : "Bloqueada"}
                </span>
                <span className="col-span-2 sm:col-span-1 sm:order-2">
                  <span className="block h-2 rounded-full bg-muted overflow-hidden">
                    <span
                      className="block h-full rounded-full transition-all duration-500"
                      style={{ width: `${ok ? pct * 100 : 0}%`, background: zone.color }}
                    />
                  </span>
                </span>
                <span className="text-xs font-mono whitespace-nowrap sm:order-3 col-span-2 sm:col-span-1 flex sm:block justify-between">
                  <span className="sm:hidden text-muted-foreground">Margem · limite</span>
                  <span>
                    {ok ? (
                      <>
                        <span className="text-foreground">{usd(snap.margin)}</span>
                        <span className="text-muted-foreground"> · {usd(snap.limit)}</span>
                      </>
                    ) : (
                      "••••"
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Quanto cabe arriscar ────────────────────────────────────────────────────

const RISK_PCTS = [10, 25, 50]

function RiskCard({ frame, rules, plan, focus }: { frame: Frame; rules: AccountRules; plan: PlanKey; focus: DrawdownType }) {
  const [instrument, setInstrument] = useState("MNQ")
  const [stop, setStop] = useState("20")
  const [pct, setPct] = useState(25)
  const locked = !canUse(plan, "riskSizing")

  const margin = Math.max(0, frame.rules[focus].margin)
  const dailyRoom = rules.dailyLossLimit !== null ? Math.max(0, rules.dailyLossLimit + frame.dayPnl) : Infinity
  const budget = Math.min(margin * (pct / 100), dailyRoom)
  const stopPts = Number(stop.replace(",", "."))
  const pv = pointValueFor(instrument)
  const perContract = Number.isFinite(stopPts) && stopPts > 0 ? stopPts * pv : 0
  const contracts = perContract > 0 ? Math.floor(budget / perContract) : 0
  const maxStop1 = pv > 0 ? budget / pv : 0

  return (
    <div className="relative bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold">Quanto cabe arriscar agora</p>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Lock className="w-3 h-3" /> Starter
          </span>
        )}
      </div>

      <div className={cn("space-y-3", locked && "opacity-50 pointer-events-none select-none")}>
        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Ativo</span>
            <select
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm font-mono"
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
            >
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Stop (pts)</span>
            <input
              inputMode="decimal"
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm font-mono"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
            />
          </label>
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">% da margem</span>
            <div className="flex gap-1">
              {RISK_PCTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded-md border font-medium transition-colors",
                    pct === p ? "bg-primary/15 border-primary/40" : "bg-muted/40 border-border text-muted-foreground"
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Risco por trade</p>
            <p className="text-lg font-bold font-mono">{usd(Math.round(budget))}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Contratos</p>
            <p className="text-lg font-bold font-mono">{contracts}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stop máx. (1 ct)</p>
            <p className="text-lg font-bold font-mono">{maxStop1.toFixed(1)} pts</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {instrument} vale {usd(pv)} por ponto. Com stop de {Number.isFinite(stopPts) ? stopPts : 0} pts, 1 contrato arrisca{" "}
          {usd(perContract)}.
          {rules.dailyLossLimit !== null && dailyRoom < margin * (pct / 100) && " Limitado pelo que resta do limite diário."} Sugestão de
          gestão de risco, não recomendação de operação.
        </p>
      </div>

      {locked && (
        <button
          type="button"
          onClick={() => askUpgrade("riskSizing")}
          className="absolute inset-0 cursor-pointer rounded-xl"
          aria-label="Quanto cabe arriscar: liberado no plano Starter"
        />
      )}
    </div>
  )
}

// ─── Consistência ────────────────────────────────────────────────────────────

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
  const fill = Math.min(1, c.pct / 100)
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
          <p>{c.ok ? "Dentro da regra" : <>Faltam ~<span className="font-mono text-foreground">{usd(c.extraNeeded)}</span> de lucro em outros dias</>}</p>
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden mt-3">
        <div className="h-full rounded-full" style={{ width: `${fill * 100}%`, background: c.ok ? "#34d399" : "#facc15" }} />
        <span className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `${rules.consistencyMaxPct}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Marca = limite de {rules.consistencyMaxPct}%</p>
    </div>
  )
}
