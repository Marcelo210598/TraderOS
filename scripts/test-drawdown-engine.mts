// Testes do motor de drawdown (sem framework): node scripts/test-drawdown-engine.mts
import assert from "node:assert/strict"
import {
  consistency,
  DEFAULT_RULES,
  SCENARIOS,
  simulate,
  stepsFromTrades,
  type DrawdownRules,
  type Step,
} from "../src/lib/drawdown-engine.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const rules: DrawdownRules = { ...DEFAULT_RULES } // 50k, meta 3k, DD 2k, trava no saldo inicial
const last = (steps: Step[], r = rules) => {
  const frames = simulate(r, steps)
  return frames[frames.length - 1]
}
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!.steps

test("estado inicial: limites em 48.000, margem 2.000, nada quebrado", () => {
  const f = simulate(rules, [])[0]
  for (const t of ["INTRADAY", "END_OF_DAY", "END_OF_POSITION", "STATIC"] as const) {
    assert.equal(f.rules[t].limit, 48000)
    assert.equal(f.rules[t].margin, 2000)
    assert.equal(f.rules[t].status, "OK")
  }
})

test("cenário 'lucro aberto devolvido' (7 passos): margens 1.000 / 2.000 / 2.000 / 2.500", () => {
  const steps = scenario("lucro-devolvido")
  assert.equal(steps.length, 7)
  const frames = simulate(rules, steps)
  // após +1.500 em aberto (passo 3): só o intraday sobe
  assert.equal(frames[3].rules.INTRADAY.limit, 49500)
  assert.equal(frames[3].rules.END_OF_POSITION.limit, 48000)
  // fechou em +500 (passo 6): EoP sobe pro saldo realizado; EOD ainda não
  assert.equal(frames[6].rules.END_OF_POSITION.limit, 48500)
  assert.equal(frames[6].rules.END_OF_DAY.limit, 48000)
  // encerrou o dia (passo 7): EOD alcança
  const f = frames[7]
  assert.equal(f.equity, 50500)
  assert.equal(f.rules.INTRADAY.margin, 1000)
  assert.equal(f.rules.END_OF_DAY.margin, 2000)
  assert.equal(f.rules.END_OF_POSITION.margin, 2000)
  assert.equal(f.rules.STATIC.margin, 2500)
})

test("cenário 'sobe e quebra': só o intraday quebra", () => {
  const f = last(scenario("sobe-e-quebra"))
  assert.equal(f.rules.INTRADAY.status, "BREACHED")
  assert.equal(f.rules.INTRADAY.breachedAtStep, 8)
  assert.equal(f.rules.END_OF_DAY.status, "OK")
  assert.equal(f.rules.END_OF_POSITION.status, "OK")
  assert.equal(f.rules.STATIC.status, "OK")
})

test("referência da aula: equity 51.600, 2 negociações → limites/margens/progresso do simulador", () => {
  const f = last([
    { type: "MOVE", delta: 600 },
    { type: "CLOSE" },
    { type: "MOVE", delta: 1000 },
    { type: "CLOSE" },
  ])
  assert.equal(f.equity, 51600)
  assert.equal(f.trades, 2)
  assert.equal(f.daysTraded, 1)
  assert.equal(f.toTarget, 1400)
  assert.deepEqual([f.rules.INTRADAY.limit, f.rules.INTRADAY.margin], [49600, 2000])
  assert.deepEqual([f.rules.END_OF_POSITION.limit, f.rules.END_OF_POSITION.margin], [49600, 2000])
  assert.deepEqual([f.rules.END_OF_DAY.limit, f.rules.END_OF_DAY.margin], [48000, 3600])
  assert.deepEqual([f.rules.STATIC.limit, f.rules.STATIC.margin], [48000, 3600])
  assert.equal(Math.round(f.rules.INTRADAY.progress! * 100), 59)
  assert.equal(Math.round(f.rules.STATIC.progress! * 100), 72)
})

test("trava do trailing: limite não passa do saldo inicial", () => {
  const steps: Step[] = [{ type: "MOVE", delta: 3000 }, { type: "CLOSE" }, { type: "END_DAY" }]
  const locked = last(steps)
  assert.equal(locked.rules.INTRADAY.limit, 50000)
  assert.equal(locked.rules.END_OF_DAY.limit, 50000)
  const free = last(steps, { ...rules, trailingLock: null })
  assert.equal(free.rules.INTRADAY.limit, 51000)
  assert.equal(free.rules.END_OF_DAY.limit, 51000)
  assert.equal(free.rules.STATIC.limit, 48000)
})

test("limite diário: encosta em −1.200 no dia e zera ao encerrar", () => {
  const r: DrawdownRules = { ...rules, dailyLossLimit: 1200 }
  const hit = last([{ type: "MOVE", delta: -1200 }], r)
  assert.equal(hit.dailyLossHit, true)
  const ok = last([{ type: "MOVE", delta: -1000 }], r)
  assert.equal(ok.dailyLossHit, false)
  const reset = last([{ type: "MOVE", delta: -1200 }, { type: "CLOSE" }, { type: "END_DAY" }], r)
  assert.equal(reset.dailyLossHit, false)
  assert.equal(reset.day, 2)
})

test("meta tocada em aberto × atingida fechada", () => {
  const open = last([{ type: "MOVE", delta: 3000 }])
  assert.equal(open.targetTouchedOpen, true)
  assert.equal(open.targetReachedClosed, false)
  const closed = last([{ type: "MOVE", delta: 3000 }, { type: "CLOSE" }])
  assert.equal(closed.targetReachedClosed, true)
  assert.equal(closed.toTarget, 0)
})

test("consistência: números reais da LucidFlex (22–24/09)", () => {
  const dia3 = consistency([411.5, 22, 239], 50)!
  assert.equal(dia3.pct, 61.19)
  assert.equal(dia3.ok, false)
  assert.ok(Math.abs(dia3.extraNeeded - 150.5) < 0.01)
  const dia2 = consistency([411.5, 22], 50)!
  assert.equal(dia2.pct, 94.93)
  // depois de +$150,50 em outros dias fica exatamente no limite
  assert.equal(consistency([411.5, 22, 239, 150.5], 50)!.ok, true)
})

test("consistência: base ABS_SUM (planilha Apex) diverge da líquida quando há perdas", () => {
  const days = [500, -300, 200]
  assert.equal(consistency(days, 30, "NET_PROFIT")!.pct, 125)
  assert.equal(consistency(days, 30, "ABS_SUM")!.pct, 50)
  assert.equal(consistency([-100, -50], 30)!.pct, null)
})

test("frame carrega consistência dos dias simulados", () => {
  const r: DrawdownRules = { ...rules, consistencyMaxPct: 50 }
  const f = last(scenario("escada"), r)
  assert.equal(f.day, 5)
  assert.equal(f.daysTraded, 4)
  assert.equal(f.consistency!.pct, 25)
  assert.equal(f.consistency!.ok, true)
})

test("stepsFromTrades: trades reais da LucidFlex com virada do dia às 18h BRT", () => {
  // trading day às 18h BRT: desloca +6h antes de pegar a data (UTC-3 → a virada cai em 21h UTC)
  const dayKeyOf = (ms: number) => new Date(ms - 3 * 3600e3 + 6 * 3600e3).toISOString().slice(0, 10)
  const t = (iso: string, pnl: number, mfe: number | null = null, mae: number | null = null) => ({
    date: Date.parse(iso),
    pnl,
    mfe,
    mae,
  })
  const steps = stepsFromTrades(
    [
      t("2026-09-22T13:30:00Z", 411.5), // 10h30 BRT dia 22
      t("2026-09-23T00:30:00Z", -175.5), // 21h30 BRT dia 22 → já é o trading day 23
      t("2026-09-23T13:30:00Z", 197.5, 260, 72), // dia 23
    ],
    dayKeyOf
  )
  const f = last(steps, { ...rules, consistencyMaxPct: 50 })
  assert.equal(f.balance, 50000 + 411.5 - 175.5 + 197.5)
  assert.equal(f.trades, 3)
  // dia 22 (só o trade da manhã) = +411,5; dia 23 (noite de 22 + manhã de 23) = +22
  assert.equal(steps.filter((s) => s.type === "END_DAY").length, 1)
  assert.equal(f.consistency!.bestDay, 411.5)
  assert.equal(f.consistency!.pct, 94.93)
  // pior caso: pico do 3º trade (260) vem antes do fundo (−72) → intraday já viu o pico
  const peak = Math.max(...simulate(rules, steps).map((x) => x.equity))
  assert.equal(peak, 50000 + 411.5 - 175.5 + 260)
})

console.log(`\n${passed} testes ok`)
