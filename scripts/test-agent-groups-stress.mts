// ESTRESSE 50×10 do metrics.groups — CORREÇÃO (E6.6, expectativa e66_stress: S1, S2, S3a, S4a, S7). Entra no test:domain com N = 500. Desempenho (S3b, S5, S6, S8, S9): scripts/test-agent-groups-perf.mts.
//   node scripts/test-agent-groups-stress.mts
import assert from "node:assert/strict"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { newAliasTable } from "../src/lib/agent/label.ts"
import { MAX_GROUPS, metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { aggregateTrades } from "../src/lib/metrics/index.ts"
import { AN, IDS10, grid, symmetric, type Any } from "./_stress-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const ERR = (code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability: "metrics.groups@1", ok: false, data: null, evidence: null, limits: [], error: { code } })
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 300)}`); return r }
const D50 = symmetric(50, 10) // 500 trades, 50 grupos de 10
const run = (args: unknown, fx = D50, o: Any = {}): Any => metricsGroups(args, fx.ctx({ aliases: newAliasTable("s1"), ...o }))
const SEVERITY = ["OK", "LOW", "TINY"]

test("S1 — 50×10 (N=500): as 500 células (valor, unidade, base, amostra, cobertura, motivo) == aggregateTrades DIRETO; 50 grupos; Σ tamanhos == 500 == declared; scope GROUP; verify VALID; evidenceRef idêntico em 2 chamadas", () => {
  assert.equal(D50.trades.length, 500)
  const d: Any = aggregateTrades(D50.trades, { groupBy: ["day"], metrics: IDS10, ...AN } as Any)
  const r = okOf(run({ groupBy: ["day"], metricIds: IDS10 }).result)
  assert.equal(r.data.groups.length, MAX_GROUPS)
  assert.equal(d.groups.length, 50)
  let cells = 0
  d.groups.forEach((g: Any, i: number) => {
    const v = r.data.groups[i]
    assert.equal(v.sampleSize, g.sampleSize, `grupo ${i}`)
    assert.equal(v.metrics.length, 10)
    IDS10.forEach((id, j) => { const w = g.metrics[id]; assert.deepEqual(v.metrics[j], { metricId: id, value: w.value, unit: w.unit, basis: w.basis, sampleSize: w.sampleSize, coverage: { used: w.coverage.used, total: w.coverage.total, ratio: w.coverage.ratio }, reason: w.reason }, `${i}.${id}`); cells++ })
  })
  assert.equal(cells, 500)
  assert.equal(r.data.groups.reduce((n: number, g: Any) => n + g.sampleSize, 0), 500)
  assert.equal(r.evidence.population.declared, 500)
  assert.equal(r.evidence.scope, "GROUP")
  assert.equal(r.evidence.verdict.verify.status, "VALID")
  assert.equal(okOf(run({ groupBy: ["day"], metricIds: IDS10 }).result).evidence.evidenceRef, r.evidence.evidenceRef)
})

test("S2 — PARTIÇÃO/ORDEM: os 50 grupos na ordem do motor, chaves 'DD/MM/AAAA' distintas, nenhum vazio, sampleFlag do handle = o PIOR dos 50", () => {
  const d: Any = aggregateTrades(D50.trades, { groupBy: ["day"], metrics: ["totalTrades"], ...AN } as Any)
  const r = okOf(run({ groupBy: ["day"], metricIds: ["totalTrades"] }).result)
  const keys = r.data.groups.map((g: Any) => g.key[0])
  assert.equal(new Set(keys).size, 50)
  assert.ok(keys.every((k: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(k)))
  assert.deepEqual(r.data.groups.map((g: Any) => g.sampleSize), d.groups.map((g: Any) => g.sampleSize))
  assert.ok(r.data.groups.every((g: Any) => g.sampleSize === 10))
  const worst = d.groups.reduce((w: number, g: Any) => Math.max(w, SEVERITY.indexOf(g.sampleFlag)), -1)
  assert.equal(r.evidence.population.sampleFlag, SEVERITY[worst])
})

test("S3a — FRONTEIRA (10 métricas, N=500): 50 grupos ⇒ ok; 51 grupos ⇒ ARGS_INVALID e nunca trunca (o G6 cobre 1 métrica)", () => {
  assert.equal(okOf(run({ groupBy: ["day"], metricIds: IDS10 }).result).data.groups.length, 50)
  const D51 = symmetric(51, 10)
  assert.deepEqual(run({ groupBy: ["day"], metricIds: IDS10 }, D51).result, ERR("ARGS_INVALID"))
  assert.equal(run({ groupBy: ["day"], metricIds: IDS10 }, D51).entry, null)
})

test("S4a — 2 DIMENSÕES (day × hour): 5 dias × 10 horas = 50 grupos × 10 métricas (N=500) ⇒ ok e == oráculo; 6 dias × 10 horas = 60 grupos ⇒ ARGS_INVALID", () => {
  const G50 = grid(5, 10, 10)
  assert.equal(G50.trades.length, 500)
  const d: Any = aggregateTrades(G50.trades, { groupBy: ["day", "hour"], metrics: IDS10, ...AN } as Any)
  const r = okOf(run({ groupBy: ["day", "hour"], metricIds: IDS10 }, G50).result)
  assert.equal(r.data.groups.length, 50)
  assert.equal(d.groups.length, 50)
  d.groups.forEach((g: Any, i: number) => {
    assert.equal(r.data.groups[i].sampleSize, g.sampleSize, `grupo ${i}`)
    IDS10.forEach((id, j) => assert.equal(r.data.groups[i].metrics[j].value, g.metrics[id].value, `${i}.${id}`))
  })
  assert.equal(r.data.groups.reduce((n: number, g: Any) => n + g.sampleSize, 0), 500)
  assert.deepEqual(run({ groupBy: ["day", "hour"], metricIds: IDS10 }, grid(6, 10, 8)).result, ERR("ARGS_INVALID"))
})

test("S7 — PUREZA E TAMANHO: ctx (trades, importRecords, aliases) não muda (snapshot e congelado fundo); view ≤ 128 KB; sem nome de conta/arquivo/acc_/hash de 64 hex", () => {
  const deepFreeze = (o: Any): void => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(deepFreeze) } }
  const fx = symmetric(50, 10)
  const aliases = newAliasTable("s1")
  const c = fx.ctx({ aliases })
  const snap = [JSON.stringify(c.trades), JSON.stringify(c.importRecords), JSON.stringify(aliases)]
  const out = metricsGroups({ groupBy: ["day"], metricIds: IDS10 }, c)
  assert.deepEqual([JSON.stringify(c.trades), JSON.stringify(c.importRecords), JSON.stringify(aliases)], snap)
  deepFreeze(c.trades); deepFreeze(c.importRecords)
  assert.doesNotThrow(() => metricsGroups({ groupBy: ["day"], metricIds: IDS10 }, c))
  const r = okOf(out.result)
  const size = JSON.stringify(r.data).length
  assert.ok(size <= 128 * 1024, `view com ${size} bytes`)
  const dump = JSON.stringify(r)
  for (const leak of ["Sim101", "acc_", "str_", "segredo-estresse", fx.rec.importId]) assert.equal(dump.includes(leak), false, `vazou: ${leak}`)
  assert.equal(/[0-9a-f]{64}/.test(dump), false)
})

console.log(`\n${passed} testes ok`)
