// ESTRESSE 50×10 do metrics.groups — DESEMPENHO (E6.6, expectativa e66_stress: S3b, S5, S6, S8, S9). FORA do test:domain (tempo de parede é frágil em CI); precisa de --expose-gc.
//   npm run test:stress      (node --no-warnings --expose-gc scripts/test-agent-groups-perf.mts)
// Critérios RELATIVOS (razões medidas na MESMA execução); único absoluto: teto folgado (15 s) para 50×10 com 500 trades.
import assert from "node:assert/strict"
import { newAliasTable } from "../src/lib/agent/label.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { METRIC_IDS } from "../src/lib/metrics/index.ts"
import { IDS10, skewed, symmetric, type Any, type Fixture } from "./_stress-fixtures.mts"

const gc = (globalThis as Any).gc as (() => void) | undefined
assert.equal(typeof gc, "function", "rode com --expose-gc (npm run test:stress)")
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const call = (args: unknown, fx: Fixture, o: Any = {}): Any => metricsGroups(args, fx.ctx({ aliases: newAliasTable("s1"), ...o }))
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
/** Mediana (ms) de `reps` execuções depois de 1 de aquecimento. */
const timeIt = (f: () => unknown, reps = 3): number => { f(); const t: number[] = []; for (let i = 0; i < reps; i++) { const s = performance.now(); f(); t.push(performance.now() - s) } return median(t) }
const ARGS10 = { groupBy: ["day"], metricIds: IDS10 }
const ARGS1 = { groupBy: ["day"], metricIds: ["totalTrades"] }
const D500 = symmetric(50, 10)
const D2000 = symmetric(50, 40)
const REPORT: string[] = []

test("S3b — RECUSA BARATA: 60 grupos (≈2000 trades) ⇒ ARGS_INVALID em < 25% do tempo do caminho OK com 2000 trades (medido ≈ 2–6%)", () => {
  const D60 = symmetric(60, 33)
  assert.equal(call(ARGS10, D60).result.ok, false)
  const refuse = timeIt(() => call(ARGS10, D60))
  const ok = timeIt(() => call(ARGS10, D2000))
  REPORT.push(`S3b recusa ${refuse.toFixed(0)} ms × OK ${ok.toFixed(0)} ms ⇒ ${(refuse / ok * 100).toFixed(1)}%`)
  assert.ok(refuse < ok * 0.25, `recusa ${refuse.toFixed(0)} ms vs OK ${ok.toFixed(0)} ms`)
})

test("S5 — FORMA DA ESCALA: t(N=2000)/t(N=500) < 8 (medido ≈ 3; quadrático ≈ 16); t(50×10)/t(50×1) entre 2 e 12 (medido ≈ 5); teto absoluto 50×10 com 500 trades < 15 s", () => {
  const t500 = timeIt(() => call(ARGS10, D500))
  const t2000 = timeIt(() => call(ARGS10, D2000))
  const t1m = timeIt(() => call(ARGS1, D500))
  REPORT.push(`S5 t(500)=${t500.toFixed(0)} ms · t(2000)=${t2000.toFixed(0)} ms · razão ${(t2000 / t500).toFixed(2)} · 10 métricas/1 métrica ${(t500 / t1m).toFixed(2)}`)
  assert.ok(t2000 / t500 < 8, `razão de escala ${(t2000 / t500).toFixed(2)}`)
  const perMetric = t500 / t1m
  assert.ok(perMetric > 2 && perMetric < 12, `10 métricas / 1 métrica = ${perMetric.toFixed(2)}`)
  assert.ok(t500 < 15000, `50×10 com 500 trades levou ${t500.toFixed(0)} ms`)
})

test("S6 — VAZAMENTO: 30 chamadas 50×10 (N=500); o heap RETIDO após GC cresce < 10 MB entre a 10ª e a 30ª chamada (medido 0,7 → 0,8 MB)", () => {
  const retained = (): number => { gc!(); return process.memoryUsage().heapUsed }
  let at10 = 0
  for (let i = 1; i <= 30; i++) { call(ARGS10, D500); if (i === 10) at10 = retained() }
  const growth = (retained() - at10) / 1048576
  REPORT.push(`S6 crescimento retido 10ª→30ª: ${growth.toFixed(2)} MB`)
  assert.ok(growth < 10, `heap retido cresceu ${growth.toFixed(1)} MB`)
})

test("S8 — COM ARQUIVO (E5b): 50×10 N=500 ⇒ source VERIFIED e tempo < 2× o sem arquivo (medido ≈ 1,05×)", () => {
  const withFile = { source: { files: D500.files } }
  const r = call(ARGS10, D500, withFile).result
  assert.equal(r.ok, true)
  assert.equal(r.evidence.verdict.combined, "VERIFIED")
  const plain = timeIt(() => call(ARGS10, D500))
  const file = timeIt(() => call(ARGS10, D500, withFile))
  REPORT.push(`S8 sem arquivo ${plain.toFixed(0)} ms · com arquivo ${file.toFixed(0)} ms ⇒ ${(file / plain).toFixed(2)}×`)
  assert.ok(file < plain * 2, `com arquivo ${file.toFixed(0)} ms vs ${plain.toFixed(0)} ms`)
})

test("S9 — ASSIMETRIA (49 grupos de 1 trade + 1 grupo de 451) e métricas fora das 10 primeiras: corretude + guarda (custo independe da distribuição dos grupos e do lote de métricas; medido 0,98× e 0,98–1,02×)", () => {
  const SK = skewed(50, 500)
  assert.equal(SK.trades.length, 500)
  const r = call(ARGS10, SK).result
  assert.equal(r.ok, true)
  assert.equal(r.data.groups.reduce((n: number, g: Any) => n + g.sampleSize, 0), 500)
  assert.deepEqual(r.data.groups.map((g: Any) => g.sampleSize).sort((a: number, b: number) => b - a).slice(0, 2), [451, 1])
  const sym = timeIt(() => call(ARGS10, D500))
  const skew = timeIt(() => call(ARGS10, SK))
  REPORT.push(`S9 simétrica ${sym.toFixed(0)} ms · assimétrica ${skew.toFixed(0)} ms ⇒ ${(skew / sym).toFixed(2)}×`)
  // o custo depende do TOTAL de trades × (métricas+1), não de como os trades se distribuem entre os grupos (medido 0,98×); cada célula custa ∝ tamanho do seu grupo
  assert.ok(skew / sym > 0.5 && skew / sym < 2, `assimétrica/simétrica = ${(skew / sym).toFixed(2)}`)
  // as OUTRAS 29 métricas, em lotes de 10 (o catálogo tem 39): todas rodam e custam o mesmo que as 10 primeiras
  const all = METRIC_IDS as readonly string[]
  for (const [a, b] of [[10, 20], [20, 30], [30, 39]] as const) {
    const ids = all.slice(a, b)
    const r2 = call({ groupBy: ["day"], metricIds: ids }, D500).result
    assert.equal(r2.ok, true, `métricas ${a}–${b}: ${JSON.stringify(r2).slice(0, 120)}`)
    const t = timeIt(() => call({ groupBy: ["day"], metricIds: ids }, D500))
    REPORT.push(`S9 métricas ${a}–${b} (${ids.length}): ${t.toFixed(0)} ms ⇒ ${(t / sym).toFixed(2)}× o lote 0–10`)
    assert.ok(t / sym > 0.5 && t / sym < 2, `métricas ${a}–${b}: ${(t / sym).toFixed(2)}× o lote 0–10`)
  }
})

console.log(`\n${passed} testes ok`)
for (const l of REPORT) console.log("  medido:", l)
