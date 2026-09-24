"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Lock, Play, SkipForward, Undo2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { SCENARIOS, simulate, type Step } from "@/lib/drawdown-engine"
import { DEFAULT_ACCOUNT_RULES, canUse, enforcePlan, type AccountRules } from "@/lib/drawdown-rules"
import type { PlanKey } from "@/lib/plans"
import { RulesForm, askUpgrade } from "./rules-form"
import { ResultPanel } from "./result-panel"

const BTN =
  "text-xs font-medium px-3 py-2 rounded-md border border-border bg-muted/40 hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1.5"

const MOVES = [100, 500, -100, -500]

export function SimulateTab({ plan }: { plan: PlanKey }) {
  const [rules, setRules] = useState<AccountRules>(DEFAULT_ACCOUNT_RULES)
  const [steps, setSteps] = useState<Step[]>([])
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const effective = useMemo(() => enforcePlan(plan, rules), [plan, rules])
  const frames = useMemo(() => simulate(effective, steps), [effective, steps])
  const last = frames[frames.length - 1]
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!
  const scenariosOpen = canUse(plan, "scenarios")

  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setPlaying(false)
  }
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  const push = (s: Step) => setSteps((prev) => [...prev, s])
  const reset = () => {
    stop()
    setSteps([])
  }

  function nextStep() {
    push(scenario.steps[Math.min(steps.length, scenario.steps.length - 1)])
  }

  function playScenario() {
    stop()
    setSteps([])
    setPlaying(true)
    let i = 0
    timer.current = setInterval(() => {
      if (i >= scenario.steps.length) return stop()
      const s = scenario.steps[i]
      i += 1
      setSteps((prev) => [...prev, s])
    }, 650)
  }

  // "Próximo passo" só faz sentido enquanto os passos atuais seguem o cenário escolhido
  const followsScenario = steps.every((s, i) => JSON.stringify(s) === JSON.stringify(scenario.steps[i]))
  const remaining = followsScenario ? scenario.steps.length - steps.length : scenario.steps.length

  return (
    <div className="space-y-4">
      <RulesForm rules={rules} onChange={setRules} plan={plan} mode="simular" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold">Operar</p>
          <div className="flex flex-wrap gap-2">
            {MOVES.map((m) => (
              <button
                key={m}
                type="button"
                className={cn(BTN, m > 0 ? "text-profit" : "text-loss")}
                onClick={() => push({ type: "MOVE", delta: m })}
              >
                {m > 0 ? `+$${m}` : `−$${Math.abs(m)}`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN} disabled={last.open === 0} onClick={() => push({ type: "CLOSE" })}>
              Fechar posição
            </button>
            <button type="button" className={BTN} onClick={() => push({ type: "END_DAY" })}>
              Encerrar dia
            </button>
            <button type="button" className={BTN} disabled={steps.length === 0} onClick={() => setSteps((p) => p.slice(0, -1))}>
              <Undo2 className="w-3.5 h-3.5" /> Desfazer
            </button>
            <button type="button" className={BTN} onClick={reset}>
              <RotateCcw className="w-3.5 h-3.5" /> Reiniciar
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Mexa no resultado em aberto, feche a posição e encerre o dia — cada regra reage de um jeito.
          </p>
        </div>

        <div className="relative bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Cenários prontos</p>
            {!scenariosOpen && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Lock className="w-3 h-3" /> Pro
              </span>
            )}
          </div>
          <div className={cn("space-y-3", !scenariosOpen && "opacity-50 pointer-events-none select-none")}>
            <select
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
              value={scenarioId}
              onChange={(e) => {
                reset()
                setScenarioId(e.target.value)
              }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">{scenario.description}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} disabled={playing || (followsScenario && remaining <= 0)} onClick={nextStep}>
                <SkipForward className="w-3.5 h-3.5" /> Próximo passo ({remaining})
              </button>
              <button type="button" className={cn(BTN, "bg-primary/15 border-primary/40")} disabled={playing} onClick={playScenario}>
                <Play className="w-3.5 h-3.5" /> Reproduzir
              </button>
            </div>
          </div>
          {!scenariosOpen && (
            <button
              type="button"
              onClick={() => askUpgrade("scenarios")}
              className="absolute inset-0 cursor-pointer"
              aria-label="Cenários prontos: liberado no plano Pro"
            />
          )}
        </div>
      </div>

      <ResultPanel
        frames={frames}
        rules={effective}
        plan={plan}
        xLabels={["Início", steps.length ? `Passo ${steps.length}` : ""]}
        stepLabel={(f) => (f.step === 0 ? "Início" : `Passo ${f.step}`)}
      />
      <p className="text-[11px] text-muted-foreground/70">
        Simulação educativa. Cada mesa tem suas regras e elas mudam — confira as da sua antes de operar.
      </p>
    </div>
  )
}
