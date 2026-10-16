// E6.6-5-A2: alias de ENTRADA da ESTRATÉGIA. `resolveStrategyKeys` (alias-input.ts) + filtro `strategy` em metrics.query/groups/exit.breakdown/exit.analysis/rank.groups/compare + `strategy` como 11ª dimensão do compare.
// Testes escritos ANTES do código. Expectativa: scripts/expectations/agent-answer.expected.json → e66_5a2 (D5A2-1…D5A2-9, B1–B12, RS1–RS22).
//   node scripts/test-agent-alias-strategy.mts
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { allocateAlias, newAliasTable, type AliasTable } from "../src/lib/agent/label.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { resolveStrategyKeys } from "../src/lib/agent-capabilities/alias-input.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { QUERY_FILTERS_SCHEMA, metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { VERIFIABLE_DIMS, VERIFIABLE_FILTERS } from "../src/lib/evidence/derived.ts"
import { strategyRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { aggregateTradesTraced, calculateMetrics, compareGroups, exitReasonAnalysis, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const enc = (s: string) => new TextEncoder().encode(s)
const BRT = "America/Sao_Paulo"
const AN = { timeZone: BRT, minSample: 4 } as const
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
// a CY do alias de conta (6 trades): Sim101 = 0,1,4,5 · Sim102 = 2,3; horas 9,9,14,9,14,10
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const CSV = synthCsv(CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any))))
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "segredo-estrategia.csv" })
const rec = imp.importRecord as ImportRecord
const T0 = toAnalyticsTrades(withRisk(imp.trades)) // todos com strategyName 'Estrategia Teste' e sem strategyId (F1)
const FILES = { [rec.importId]: enc(CSV) }

/** Sobrescreve os campos de estratégia do AnalyticsTrade (o synthCsv fixa o texto). id === null ⇒ sem strategyId. */
const mod = (a: Any, id: string | null, name: string | null): Any => {
  const rest: Any = { ...a }
  delete rest.strategyId
  return { ...rest, ...(id === null ? {} : { strategyId: id }), trade: { ...a.trade, labels: { ...a.trade.labels, strategyName: name } } }
}
const variant = (base: Any[], f: (i: number) => [string | null, string | null]): Any[] => base.map((a, i) => { const [id, name] = f(i); return mod(a, id, name) })
// variante de 3 estratégias: S1 = trades 0–1 (nome) · S2 = 2–3 (nome) · ID-S3 = 4–5 (id 'ID-S3' + nome 'nome do S3'); a chave é strategyId ?? strategyName
const TV = variant(T0, (i) => (i < 2 ? [null, "S1"] : i < 4 ? [null, "S2"] : ["ID-S3", "nome do S3"]))
// F7: o trade 2 tem id 'ID-S3' e nome 'S2' (o filtro por NOME 'S2' pegaria 2 trades; a chave 'S2' tem 1)
const TF7 = variant(T0, (i) => (i < 2 ? [null, "S1"] : i === 2 ? ["ID-S3", "S2"] : i === 3 ? [null, "S2"] : ["ID-S3", "nome do S3"]))
// F6: colisão — o trade 4 tem strategyId 'S1' (e nome 'outro'); os trades 0–1 têm NOME 'S1' sem id ⇒ o grupo 'S1' tem 3 trades, mas nenhum filtro do motor reproduz isso
const TF6 = variant(T0, (i) => (i < 2 ? [null, "S1"] : i < 4 ? [null, "S2"] : i === 4 ? ["S1", "outro"] : ["ID-S3", "nome do S3"]))
// F5: um trade sem estratégia nenhuma
const TN = variant(T0, (i) => (i === 0 ? [null, null] : i === 1 ? [null, "S1"] : i < 4 ? [null, "S2"] : ["ID-S3", "nome do S3"]))

const ctxOf = (trades: Any[], o: Any = {}): Any => ({ trades, importRecords: [rec], refEpoch: "s1", analysis: AN, ...o })
const tableOf = (trades: Any[], o: Any = {}): AliasTable => (metricsGroups({ groupBy: ["strategy"], metricIds: ["totalTrades"] }, ctxOf(trades, { aliases: newAliasTable("s1"), ...o })) as Any).aliases
const CONV = tableOf(TV) // Estratégia A = ID-S3 · B = S1 · C = S2 (ordem do motor, pela chave)
const REF = (key: string, salt = ""): string => strategyRef(key, salt) as string
const ERR = (capability: string, code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability, ok: false, data: null, evidence: null, limits: [], error: { code } })
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 300)}`); return r }
const NO = { ok: false } as const

const q = (args: unknown, c: Any = ctxOf(TV, { aliases: CONV })): Any => metricsQuery(args, c).result
const gr = (args: unknown, c: Any = ctxOf(TV, { aliases: CONV })): Any => metricsGroups(args, c)
const ex = (args: unknown, c: Any = ctxOf(TV, { aliases: CONV })): Any => exitBreakdown(args, c).result
const ea = (args: unknown, c: Any = ctxOf(TV, { aliases: CONV })): Any => exitAnalysis(args, c).result
const rk = (args: unknown, c: Any = ctxOf(TV, { aliases: CONV })): Any => rankGroupsCapability(args, c).result
const cp = (args: unknown, c: Any = ctxOf(TV, { aliases: CONV })): Any => metricsCompare(args, c).result
const METRICS = ["totalTrades", "netPnl", "winRate"]
const val = (r: Any): Any[] => r.data.metrics.map((m: Any) => [m.metricId, m.value])
const direct = (trades: Any[], filters: Any): Any[] => { const d: Any = calculateMetrics(trades, { filters, ...AN } as Any); return METRICS.map((id) => [id, d.metrics[id].value]) }
const GA = { mode: "GROUP", metricIds: ["totalTrades", "netPnl"] } as const

test("B1 — resolveStrategyKeys (puro): 'Estratégia B' ⇒ strategyName ['S1']; 'C' ⇒ ['S2']; 'A' ⇒ strategyId ['ID-S3']; lista de nomes ordenada; id + nome misturados ⇒ ok:false; falhas de tabela/formato ⇒ ok:false; ctx intacto; nunca lança", () => {
  const c = ctxOf(TV, { aliases: CONV })
  assert.deepEqual(resolveStrategyKeys("Estratégia B", c), { ok: true, field: "strategyName", values: ["S1"] })
  assert.deepEqual(resolveStrategyKeys("Estratégia C", c), { ok: true, field: "strategyName", values: ["S2"] })
  assert.deepEqual(resolveStrategyKeys("Estratégia A", c), { ok: true, field: "strategyId", values: ["ID-S3"] })
  assert.deepEqual(resolveStrategyKeys(["Estratégia C", "Estratégia B"], c), { ok: true, field: "strategyName", values: ["S1", "S2"] })
  assert.deepEqual(resolveStrategyKeys(["Estratégia A", "Estratégia B"], c), NO, "id + nome na mesma lista")
  assert.deepEqual(resolveStrategyKeys(["Estratégia B", "Estratégia B"], c), { ok: true, field: "strategyName", values: ["S1"] }, "repetido colapsa")
  const orphan = (allocateAlias(CONV, "estrategia", `str_${"c".repeat(24)}`, "s1") as Any).table
  const bad: Array<[string, Any, Any]> = [
    ["sem tabela", "Estratégia B", ctxOf(TV)], ["época diferente", "Estratégia B", ctxOf(TV, { aliases: newAliasTable("s0") })], ["alias fora", "Estratégia Z", c], ["Conta A", "Conta A", c], ["sem letra", "Estratégia", c],
    ["minúscula", "estratégia B", c], ["4 letras", "Estratégia AAAA", c], ["lista vazia", [], c], ["9 aliases", Array.from({ length: 9 }, () => "Estratégia B"), c], ["não-string", 5, c], ["ref sem trade", "Estratégia D", ctxOf(TV, { aliases: orphan })],
    ["tabela malformada", "Estratégia B", ctxOf(TV, { aliases: { epoch: "s1", conta: [], estrategia: "x", rotulo: [] } })], ["tabela null", "Estratégia B", ctxOf(TV, { aliases: null })],
  ]
  const otherEpoch = (allocateAlias(newAliasTable("s0"), "estrategia", REF("S1"), "s0") as Any).table // 'Estratégia A' = S1, mas na época s0
  assert.deepEqual(resolveStrategyKeys("Estratégia A", ctxOf(TV, { aliases: otherEpoch })), NO, "tabela de outra época COM a estratégia")
  assert.deepEqual(resolveStrategyKeys("Estratégia A", ctxOf(TV, { aliases: otherEpoch, refEpoch: "s0" })), { ok: true, field: "strategyName", values: ["S1"] }, "controle: a mesma tabela na época certa resolve")
  for (const [why, a, cc] of bad) assert.deepEqual(resolveStrategyKeys(a, cc), NO, why)
  const snap = [JSON.stringify(c.trades), JSON.stringify(CONV)]
  resolveStrategyKeys("Estratégia B", c)
  assert.deepEqual([JSON.stringify(c.trades), JSON.stringify(CONV)], snap)
  assert.equal(Object.isFrozen(CONV), true)
})

test("B2 — metrics.query com filters.strategy == calculateMetrics DIRETO: 'B' ⇒ {strategyName:S1} (2); 'A' ⇒ {strategyId:ID-S3} (2); ['B','C'] ⇒ {strategyName:[S1,S2]} (4); combinado com hour; handle VALID", () => {
  const b = okOf(q({ metricIds: METRICS, filters: { strategy: "Estratégia B" } }))
  assert.deepEqual(val(b), direct(TV, { strategyName: ["S1"] }))
  assert.equal(b.evidence.population.declared, 2)
  assert.equal(b.evidence.verdict.verify.status, "UNVERIFIABLE") // strategy não é verificável (D5A2-5)
  const a = okOf(q({ metricIds: METRICS, filters: { strategy: "Estratégia A" } }))
  assert.deepEqual(val(a), direct(TV, { strategyId: ["ID-S3"] }))
  assert.equal(a.evidence.population.declared, 2)
  const bc = okOf(q({ metricIds: METRICS, filters: { strategy: ["Estratégia B", "Estratégia C"] } }))
  assert.deepEqual(val(bc), direct(TV, { strategyName: ["S1", "S2"] }))
  assert.equal(bc.evidence.population.declared, 4)
  assert.notDeepEqual(val(b), val(a))
  const h = okOf(q({ metricIds: METRICS, filters: { strategy: "Estratégia C", hour: 9 } }))
  assert.deepEqual(val(h), direct(TV, { strategyName: ["S2"], hour: 9 }))
  // tabela TROCADA: 'Estratégia A' = S2
  const sw = (["S2", "S1"] as const).reduce((t, k) => (allocateAlias(t, "estrategia", REF(k), "s1") as Any).table, newAliasTable("s1"))
  assert.deepEqual(val(okOf(q({ metricIds: METRICS, filters: { strategy: "Estratégia A" } }, ctxOf(TV, { aliases: sw })))), direct(TV, { strategyName: ["S2"] }))
})

test("B3 — EXATIDÃO (D5A2-4): trade com id E nome (F7) e colisão id×nome (F6) ⇒ ARGS_INVALID para a estratégia afetada; as outras estratégias da mesma variante continuam resolvendo", () => {
  const c7 = ctxOf(TF7, { aliases: tableOf(TF7) }) // A = ID-S3 (3 trades) · B = S1 (2) · C = S2 (1)
  const F7 = (s: string): Any => q({ metricIds: METRICS, filters: { strategy: s } }, c7)
  assert.deepEqual(F7("Estratégia C"), ERR("metrics.query@1", "ARGS_INVALID"), "S2: o motor devolveria 2, a chave tem 1")
  assert.deepEqual(val(okOf(F7("Estratégia B"))), direct(TF7, { strategyName: ["S1"] }))
  assert.deepEqual(val(okOf(F7("Estratégia A"))), direct(TF7, { strategyId: ["ID-S3"] }))
  const c6 = ctxOf(TF6, { aliases: tableOf(TF6) }) // A = ID-S3 (1) · B = S1 (3, colisão) · C = S2 (2)
  const F6 = (s: string): Any => q({ metricIds: METRICS, filters: { strategy: s } }, c6)
  assert.deepEqual(F6("Estratégia B"), ERR("metrics.query@1", "ARGS_INVALID"), "o grupo S1 tem 3 trades; nenhum filtro do motor reproduz")
  assert.deepEqual(val(okOf(F6("Estratégia C"))), direct(TF6, { strategyName: ["S2"] }))
  assert.deepEqual(val(okOf(F6("Estratégia A"))), direct(TF6, { strategyId: ["ID-S3"] }))
  // PROPRIEDADE (por que comparar o TAMANHO do conjunto equivale a comparar os índices): o grupo da chave K está SEMPRE contido no que o motor selecionaria pelo campo escolhido,
  // então "mesmo tamanho" ⇒ "mesmo conjunto". 4000 atribuições aleatórias (id/nome) de 6 trades; o teste calcula o grupo e o conjunto selecionado POR CONTA PRÓPRIA.
  let seed = 12345 // mulberry32 (Math.imul: sem estouro de precisão do float)
  const rnd = (n: number): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n) }
  const ALPHA = [null, "a", "b", "c"]
  let checked = 0
  for (let it = 0; it < 4000; it++) {
    const asg = T0.map(() => [ALPHA[rnd(4)], ALPHA[rnd(4)]] as [string | null, string | null])
    const tr = T0.map((a: Any, i: number) => mod(a, asg[i][0], asg[i][1]))
    const keyOf = (i: number): string | null => asg[i][0] ?? asg[i][1]
    for (const K of new Set(tr.map((_: Any, i: number) => keyOf(i)).filter((k: string | null): k is string => k !== null))) {
      const G = tr.map((_: Any, i: number) => i).filter((i: number) => keyOf(i) === K)
      const withId = G.filter((i: number) => asg[i][0] !== null).length
      if (withId !== 0 && withId !== G.length) continue // misto: recusado antes da exatidão
      const S = tr.map((_: Any, i: number) => i).filter((i: number) => (withId === 0 ? asg[i][1] : asg[i][0]) === K)
      assert.ok(G.every((i: number) => S.includes(i)), "grupo ⊄ selecionado")
      checked++
    }
  }
  assert.ok(checked > 5000, `a propriedade precisa checar muitas chaves (medido: 7719); checou ${checked}`)
  // a recusa vale nas 6 capacidades (mesma função)
  const bad = { strategy: "Estratégia C" }
  assert.deepEqual(ex({ filters: bad }, c7), ERR("exit.breakdown@1", "ARGS_INVALID"))
  assert.deepEqual(ea({ filters: bad }, c7), ERR("exit.analysis@1", "ARGS_INVALID"))
  assert.deepEqual(gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: bad }, c7).result, ERR("metrics.groups@1", "ARGS_INVALID"))
  assert.deepEqual(rk({ groupBy: ["hour"], filters: bad }, c7), ERR("rank.groups@1", "ARGS_INVALID"))
  assert.deepEqual(cp({ mode: "PERIOD", a: { from: "2026-03-02", to: "2026-03-06" }, b: { from: "2026-03-09", to: "2026-03-10" }, metricIds: ["totalTrades"], filters: bad }, c7), ERR("metrics.compare@1", "ARGS_INVALID"))
})

test("B4 — handle com ARQUIVO (F10/F11): filtro por estratégia ⇒ verify UNVERIFIABLE [S_ASSOCIATION_UNVERIFIABLE], source VERIFIED, combined NOT_VERIFIED, limit S_ASSOCIATION_UNVERIFIABLE; nunca VERIFIED; hour no mesmo ctx segue VERIFIED (controle); sem arquivo source NOT_RUN", () => {
  const tab = tableOf(T0) // todos os 6 trades = 'Estrategia Teste' ⇒ Estratégia A
  const cs = ctxOf(T0, { aliases: tab, source: { files: FILES } })
  const r = okOf(q({ metricIds: METRICS, filters: { strategy: "Estratégia A" } }, cs))
  assert.deepEqual(val(r), direct(T0, {}))
  assert.equal(r.evidence.population.declared, 6)
  assert.equal(r.evidence.verdict.verify.status, "UNVERIFIABLE")
  assert.deepEqual(r.evidence.verdict.verify.codes, ["S_ASSOCIATION_UNVERIFIABLE"])
  assert.equal(r.evidence.verdict.source.status, "SOURCE_VERIFIED")
  assert.equal(r.evidence.verdict.combined, "NOT_VERIFIED")
  assert.deepEqual(r.limits.map((l: Any) => l.code), ["S_ASSOCIATION_UNVERIFIABLE"])
  assert.equal(okOf(q({ metricIds: METRICS, filters: { hour: 9 } }, cs)).evidence.verdict.combined, "VERIFIED")
  const no = okOf(q({ metricIds: METRICS, filters: { strategy: "Estratégia A" } }, ctxOf(T0, { aliases: tab })))
  assert.equal(no.evidence.verdict.source.status, "NOT_RUN")
  assert.equal(no.evidence.verdict.combined, "NOT_VERIFIED")
})

test("B5 — metrics.groups, exit.breakdown, exit.analysis e rank.groups com filters.strategy == oráculo; metrics.groups não aloca alias novo para a estratégia filtrada", () => {
  const f = { strategy: "Estratégia B" } // S1 = trades 0–1 (hora 9, contas Sim101)
  const out = gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: f })
  const g = okOf(out.result)
  const d: Any = aggregateTradesTraced(TV, { groupBy: ["hour"], metrics: ["totalTrades"], filters: { strategyName: ["S1"] }, ...AN } as Any).result
  assert.deepEqual(g.data.groups.map((x: Any) => [x.key, x.sampleSize]), d.groups.map((x: Any) => [[`${x.key[0]}:00`], x.sampleSize]))
  assert.equal(g.evidence.population.declared, d.total.population.afterFilters)
  assert.deepEqual(out.aliases.estrategia, CONV.estrategia)
  assert.deepEqual(okOf(gr({ groupBy: ["strategy"], metricIds: ["totalTrades"], filters: f }).result).data.groups.map((x: Any) => [x.key, x.sampleSize]), [[["Estratégia B"], 2]])
  const e: Any = exitReasonAnalysis(TV, { filters: { strategyName: ["S1"] }, ...AN } as Any)
  const eb = okOf(ex({ filters: f }))
  assert.equal(eb.evidence.population.declared, 2)
  assert.deepEqual(eb.data.buckets.filter((b: Any) => b.unit === "LEG").map((b: Any) => [b.reason, b.count, b.pnlNet]), e.legs.rows.map((x: Any) => [x.reason, x.legs, x.net.value]))
  assert.notDeepEqual(eb.data.buckets, okOf(ex({})).data.buckets)
  const an = okOf(ea({ filters: f }))
  assert.equal(an.evidence.population.declared, 2)
  assert.notEqual(JSON.stringify(an.data), JSON.stringify(okOf(ea({})).data))
  const rank = okOf(rk({ groupBy: ["hour"], filters: f }))
  assert.equal(rank.evidence.population.declared, 2)
  const total = rank.data.rows.reduce((s: number, r2: Any) => s + r2.value.value, 0)
  assert.equal(Math.round(total * 100) / 100, (calculateMetrics(TV, { filters: { strategyName: ["S1"] }, ...AN } as Any) as Any).metrics.netPnl.value)
})

test("B6 — metrics.compare por estratégia: B × C == compareGroups DIRETO (where strategy S1 × S2); alias do mesmo ref ⇒ ARGS_INVALID; tabela da conversa trocada manda nas chaves; strategy+hour; id-keyed usa o ID real; colisão F6 vira UM grupo de 3", () => {
  const dir = (trades: Any[], gb: string[], a: Any, b: Any): Any => compareGroups(trades, { groupBy: gb, a, b, metrics: ["totalTrades", "netPnl"], ...AN } as Any)
  const d = dir(TV, ["strategy"], { strategy: "S1" }, { strategy: "S2" })
  const r = okOf(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia B" }, b: { strategy: "Estratégia C" } }))
  assert.deepEqual(r.data.a, { key: ["Estratégia B"], sampleSize: d.a.sampleSize })
  assert.deepEqual(r.data.b, { key: ["Estratégia C"], sampleSize: d.b.sampleSize })
  assert.deepEqual(r.data.deltas.map((x: Any) => [x.metricId, x.a, x.b, x.delta]), d.metrics.map((m: Any) => [m.metric, m.a.value, m.b.value, m.delta]))
  assert.equal(r.evidence.verdict.verify.status, "UNVERIFIABLE")
  // a == b
  assert.deepEqual(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia B" }, b: { strategy: "Estratégia B" } }), ERR("metrics.compare@1", "ARGS_INVALID"))
  // a == b decidido pelo REF: tabela montada à mão com o MESMO ref em dois aliases (allocateAlias nunca faz isso; o schema não vê, o texto dos aliases é diferente)
  const dupT: AliasTable = Object.freeze({ epoch: "s1", conta: Object.freeze([]), estrategia: Object.freeze([REF("S1"), REF("S1")]), rotulo: Object.freeze([]) }) as Any
  assert.deepEqual(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia A" }, b: { strategy: "Estratégia B" } }, ctxOf(TV, { aliases: dupT })), ERR("metrics.compare@1", "ARGS_INVALID"))
  // tabela TROCADA: 'Estratégia A' = S2 e 'Estratégia B' = S1
  const sw = (["S2", "S1"] as const).reduce((t, k) => (allocateAlias(t, "estrategia", REF(k), "s1") as Any).table, newAliasTable("s1"))
  const ds = dir(TV, ["strategy"], { strategy: "S2" }, { strategy: "S1" })
  const rs = okOf(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia A" }, b: { strategy: "Estratégia B" } }, ctxOf(TV, { aliases: sw })))
  assert.deepEqual([rs.data.a, rs.data.b], [{ key: ["Estratégia A"], sampleSize: ds.a.sampleSize }, { key: ["Estratégia B"], sampleSize: ds.b.sampleSize }])
  assert.deepEqual(rs.data.deltas.map((x: Any) => [x.a, x.b]), ds.metrics.map((m: Any) => [m.a.value, m.b.value]))
  // strategy + hour
  const d2 = dir(TV, ["strategy", "hour"], { strategy: "S1", hour: "09" }, { strategy: "S2", hour: "09" })
  const r2 = okOf(cp({ ...GA, groupBy: ["strategy", "hour"], a: { strategy: "Estratégia B", hour: 9 }, b: { strategy: "Estratégia C", hour: 9 } }))
  assert.deepEqual([r2.data.a, r2.data.b], [{ key: ["Estratégia B", "09:00"], sampleSize: d2.a.sampleSize }, { key: ["Estratégia C", "09:00"], sampleSize: d2.b.sampleSize }])
  // id-keyed: 'Estratégia A' = ID-S3 usa o ID real no where
  const d3 = dir(TV, ["strategy"], { strategy: "ID-S3" }, { strategy: "S1" })
  const r3 = okOf(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia A" }, b: { strategy: "Estratégia B" } }))
  assert.deepEqual([r3.data.a, r3.data.b], [{ key: ["Estratégia A"], sampleSize: d3.a.sampleSize }, { key: ["Estratégia B"], sampleSize: d3.b.sampleSize }])
  assert.deepEqual(r3.data.deltas.map((x: Any) => [x.a, x.b]), d3.metrics.map((m: Any) => [m.a.value, m.b.value]))
  // F6: no compare por DIMENSÃO a chave é só texto ⇒ o grupo 'S1' tem 3 trades (no filtro seria ARGS_INVALID, B3)
  const c6 = ctxOf(TF6, { aliases: tableOf(TF6) })
  const d6 = dir(TF6, ["strategy"], { strategy: "S1" }, { strategy: "S2" })
  assert.equal(d6.a.sampleSize, 3)
  const r6 = okOf(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia B" }, b: { strategy: "Estratégia C" } }, c6))
  assert.deepEqual([r6.data.a, r6.data.b], [{ key: ["Estratégia B"], sampleSize: 3 }, { key: ["Estratégia C"], sampleSize: 2 }])
  // com arquivo (T0): continua não verificável
  const tab = tableOf(T0)
  assert.equal(okOf(cp({ ...GA, groupBy: ["strategy", "hour"], a: { strategy: "Estratégia A", hour: 9 }, b: { strategy: "Estratégia A", hour: 14 } }, ctxOf(T0, { aliases: tab, source: { files: FILES } }))).evidence.verdict.combined, "NOT_VERIFIED")
})

test("B7 — FALHAS ⇒ ARGS_INVALID fixo e sem eco, nas 6 capacidades: nome/id/ref cru, 'Conta A' em strategy e 'Estratégia A' em account, sem tabela, época diferente, alias fora, formato errado, lista vazia, 9, grupo sem estratégia, ref sem trade; campos crus e setup/timeframe/strategyVersion continuam fora; getter hostil ⇒ ENGINE_REFUSED", () => {
  const C = ctxOf(TV, { aliases: CONV })
  const orphan = (allocateAlias(CONV, "estrategia", `str_${"c".repeat(24)}`, "s1") as Any).table
  const ctxTN = ctxOf(TN, { aliases: tableOf(TN) }) // 4 grupos: '(desconhecido)' não tem alias
  const filtersBad: Array<[string, Any, Any]> = [
    ["sem tabela", "Estratégia B", ctxOf(TV)], ["época diferente", "Estratégia B", ctxOf(TV, { aliases: newAliasTable("s0") })], ["alias fora da tabela", "Estratégia Z", C], ["alias de índice vazio", "Estratégia D", C],
    ["caixa baixa", "estratégia B", C], ["espaço duplo", "Estratégia  B", C], ["4 letras", "Estratégia AAAA", C], ["nome cru S1", "S1", C], ["nome cru da CY", "Estrategia Teste", C], ["nome cru do id-keyed", "nome do S3", C], ["id cru", "ID-S3", C],
    ["ref cru", REF("S1"), C], ["Conta A em strategy", "Conta A", C], ["lista vazia", [], C], ["9 aliases", Array.from({ length: 9 }, () => "Estratégia B"), C], ["não-string", 5, C], ["null", null, C], ["objeto", { a: 1 }, C],
    ["ref da tabela sem trade", "Estratégia D", ctxOf(TV, { aliases: orphan })], ["grupo (desconhecido) não tem alias", "Estratégia E", ctxTN], ["id + nome misturados", ["Estratégia A", "Estratégia B"], C],
  ]
  const callers: Array<[string, (f: Any, c: Any) => Any, Any]> = [
    ["metrics.query@1", (s, c) => q({ metricIds: ["netPnl"], filters: { strategy: s } }, c), null], ["exit.breakdown@1", (s, c) => ex({ filters: { strategy: s } }, c), null], ["exit.analysis@1", (s, c) => ea({ filters: { strategy: s } }, c), null],
    ["metrics.groups@1", (s, c) => gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: { strategy: s } }, c).result, null], ["rank.groups@1", (s, c) => rk({ groupBy: ["hour"], filters: { strategy: s } }, c), null],
    ["metrics.compare@1", (s, c) => cp({ mode: "PERIOD", a: { from: "2026-03-02", to: "2026-03-06" }, b: { from: "2026-03-09", to: "2026-03-10" }, metricIds: ["totalTrades"], filters: { strategy: s } }, c), null],
  ]
  for (const [cap, call] of callers) for (const [why, s, cc] of filtersBad) assert.deepEqual(call(s, cc), ERR(cap, "ARGS_INVALID"), `${cap}: ${why}`)
  // 'Estratégia A' em account
  assert.deepEqual(q({ metricIds: ["netPnl"], filters: { account: "Estratégia A" } }, C), ERR("metrics.query@1", "ARGS_INVALID"))
  // dimensão do compare
  const D = (a: unknown, b: unknown, c: Any = C): Any => cp({ ...GA, groupBy: ["strategy"], a: { strategy: a }, b: { strategy: b } }, c)
  for (const [why, a, b, cc] of [["nome cru", "S1", "S2", C], ["sem tabela", "Estratégia B", "Estratégia C", ctxOf(TV)], ["alias fora", "Estratégia B", "Estratégia Z", C], ["Conta A", "Conta A", "Estratégia B", C], ["ref sem trade", "Estratégia B", "Estratégia D", ctxOf(TV, { aliases: orphan })], ["(desconhecido)", "Estratégia B", "Estratégia E", ctxTN]] as Array<[string, string, string, Any]>) assert.deepEqual(D(a, b, cc), ERR("metrics.compare@1", "ARGS_INVALID"), `compare: ${why}`)
  // campos crus e texto livre continuam fora
  for (const filters of [{ strategyId: "x" }, { strategyName: "x" }, { setup: "x" }, { timeframe: "M5" }, { strategyVersion: "x" }, { strategyVersionId: "x" }]) {
    assert.deepEqual(q({ metricIds: ["netPnl"], filters }), ERR("metrics.query@1", "ARGS_INVALID"), JSON.stringify(filters))
    assert.deepEqual(ex({ filters }), ERR("exit.breakdown@1", "ARGS_INVALID"), JSON.stringify(filters))
    assert.deepEqual(ea({ filters }), ERR("exit.analysis@1", "ARGS_INVALID"), JSON.stringify(filters))
    assert.deepEqual(rk({ groupBy: ["hour"], filters }), ERR("rank.groups@1", "ARGS_INVALID"), JSON.stringify(filters))
    assert.deepEqual(gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters }).result, ERR("metrics.groups@1", "ARGS_INVALID"), JSON.stringify(filters))
  }
  // o SCHEMA já barra nome/id/ref cru (a resolução também; aqui só o schema, sem depender dela)
  for (const bad of ["S1", "Estrategia Teste", "ID-S3", REF("S1"), "Conta A", "estratégia A", "Estratégia", "Estratégia AAAA", "Estratégia a", " Estratégia A", "Estratégia A "]) assert.equal(QUERY_FILTERS_SCHEMA.safeParse({ strategy: bad }).success, false, `schema aceitou: ${bad}`)
  for (const good of ["Estratégia A", "Estratégia ZZ", "Estratégia AAA", ["Estratégia A", "Estratégia B"]]) assert.equal(QUERY_FILTERS_SCHEMA.safeParse({ strategy: good }).success, true, `schema recusou: ${JSON.stringify(good)}`)
  // D5A2-1: o rank.groups só ganhou o FILTRO por estratégia — agrupar o ranking por strategy segue fora (as dimensões do rank NÃO são as do compare)
  assert.deepEqual(rk({ groupBy: ["strategy"] }), ERR("rank.groups@1", "ARGS_INVALID"))
  for (const dim of ["session", "setup", "timeframe", "strategyVersion"]) assert.deepEqual(cp({ ...GA, groupBy: [dim], a: { [dim]: "x" }, b: { [dim]: "y" } }), ERR("metrics.compare@1", "ARGS_INVALID"), dim)
  // getter hostil ⇒ ENGINE_REFUSED, sem lançar; sem filtro/dimensão de estratégia a tabela nem é lida
  const hostile: Any = ctxOf(TV)
  Object.defineProperty(hostile, "aliases", { enumerable: true, get() { throw new Error("getter hostil") } })
  for (const [cap, call] of callers) { assert.doesNotThrow(() => call("Estratégia B", hostile), cap); assert.deepEqual(call("Estratégia B", hostile), ERR(cap, "ENGINE_REFUSED"), cap) }
  assert.deepEqual(D("Estratégia B", "Estratégia C", hostile), ERR("metrics.compare@1", "ENGINE_REFUSED"))
  assert.equal(okOf(metricsQuery({ metricIds: METRICS }, hostile).result).ok, true)
})

test("B8 — PRIVACIDADE: nenhum resultado (ok ou erro) das 6 capacidades contém 'S1', 'S2', 'ID-S3', 'nome do S3', 'Estrategia Teste', str_, acc_, hash de 64 hex ou o nome do arquivo; o erro não ecoa o alias pedido", () => {
  const dumps = [
    q({ metricIds: METRICS, filters: { strategy: ["Estratégia A", "Estratégia A"] } }), q({ metricIds: METRICS, filters: { strategy: ["Estratégia B", "Estratégia C"] } }, ctxOf(TV, { aliases: CONV, source: { files: FILES } })),
    gr({ groupBy: ["strategy"], metricIds: ["totalTrades"], filters: { strategy: ["Estratégia B", "Estratégia C"] } }).result, ex({ filters: { strategy: "Estratégia B" } }), ea({ filters: { strategy: "Estratégia B" } }), rk({ groupBy: ["hour"], filters: { strategy: ["Estratégia B", "Estratégia C"] } }),
    cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia A" }, b: { strategy: "Estratégia B" } }), cp({ mode: "PERIOD", a: { from: "2026-03-02", to: "2026-03-06" }, b: { from: "2026-03-09", to: "2026-03-10" }, metricIds: ["totalTrades"], filters: { strategy: "Estratégia C" } }),
  ].map((r) => (okOf(r), JSON.stringify(r)))
  for (const d of dumps) {
    for (const leak of ["ID-S3", "nome do S3", "Estrategia Teste", "str_", "acc_", "Sim101", "Sim102", "segredo-estrategia", rec.importId, REF("S1"), REF("S2"), REF("ID-S3")]) assert.equal(d.includes(leak), false, `vazou: ${leak}`)
    assert.equal(/\bS[12]\b/.test(d), false, "vazou S1/S2")
    assert.equal(/[0-9a-f]{64}/.test(d), false)
  }
  const bad = JSON.stringify(q({ metricIds: METRICS, filters: { strategy: "Estratégia Z" } }))
  assert.equal(bad.includes("Estratégia Z"), false)
  assert.equal(JSON.stringify(q({ metricIds: METRICS, filters: { strategy: "S1" } })).includes("S1"), false)
})

test("B9 — SAL (medido): import SALGADO; a estratégia NÃO carrega ref no trade, então o sal manda na resolução: sal certo resolve e == direto; sal ERRADO ⇒ ARGS_INVALID; sem sal ⇒ ENGINE_REFUSED", () => {
  const SALT = "sal-de-teste-da-estrategia-0123456789abcdef0123456789abcdef01234567"
  const WRONG = "outro-sal-completamente-diferente-0123456789abcdef0123456789abcd"
  const salted: Any = runImportPipeline(CSV, { sourceTz: BRT, fileName: "salgado-estrategia.csv", accountRefSalt: SALT } as Any)
  const sRec = salted.importRecord as ImportRecord
  const TS = variant(toAnalyticsTrades(withRisk(salted.trades)), (i) => (i < 2 ? [null, "S1"] : i < 4 ? [null, "S2"] : ["ID-S3", "nome do S3"]))
  const base: Any = { trades: TS, importRecords: [sRec], refEpoch: "s1", analysis: AN }
  const table: AliasTable = (metricsGroups({ groupBy: ["strategy"], metricIds: ["totalTrades"] }, { ...base, accountRefSalt: SALT, aliases: newAliasTable("s1") }) as Any).aliases
  assert.deepEqual(table.estrategia, [REF("ID-S3", SALT), REF("S1", SALT), REF("S2", SALT)])
  const args = { metricIds: METRICS, filters: { strategy: "Estratégia B" } }
  const good = okOf(q(args, { ...base, accountRefSalt: SALT, aliases: table }))
  assert.deepEqual(val(good), direct(TS, { strategyName: ["S1"] }))
  assert.equal(good.evidence.population.declared, 2)
  assert.deepEqual(q(args, { ...base, accountRefSalt: WRONG, aliases: table }), ERR("metrics.query@1", "ARGS_INVALID"))
  assert.deepEqual(q(args, { ...base, aliases: table }), ERR("metrics.query@1", "ENGINE_REFUSED"))
  const cmp = okOf(cp({ ...GA, groupBy: ["strategy"], a: { strategy: "Estratégia B" }, b: { strategy: "Estratégia C" } }, { ...base, accountRefSalt: SALT, aliases: table }))
  assert.deepEqual([cmp.data.a.key, cmp.data.b.key, cmp.data.a.sampleSize, cmp.data.b.sampleSize], [["Estratégia B"], ["Estratégia C"], 2, 2])
})

test("B10 — CONVERSA ponta a ponta: metrics.groups(strategy) ⇒ tabela ⇒ metrics.query(filters.strategy) ⇒ ledger ⇒ validateAnswer; o alias do grupo e o do filtro são os MESMOS; número de evidência por estratégia é recusado no validador (ASSERT e LABELED), igual ao groupBy strategy que já existia; contas e estratégias na mesma tabela", () => {
  const g = gr({ groupBy: ["strategy"], metricIds: ["totalTrades"] }, ctxOf(T0, { aliases: newAliasTable("s1") }))
  assert.deepEqual(okOf(g.result).data.groups.map((x: Any) => [x.key, x.sampleSize]), [[["Estratégia A"], 6]])
  const out = metricsQuery({ metricIds: ["totalTrades"], filters: { strategy: "Estratégia A" } }, ctxOf(T0, { aliases: g.aliases, source: { files: FILES } }))
  const r = okOf(out.result)
  assert.equal(r.evidence.population.declared, 6)
  const ref = r.evidence.evidenceRef
  const ledger = (addEvidence((newLedger("s1") as Any).ledger, out.entry) as Any).ledger
  // MEDIDO (16/10): associação não verificável ⇒ o validador recusa o NÚMERO tanto em ASSERT quanto em LABELED (NUMBER_FROM_UNVERIFIED_EVIDENCE) — igual ao groupBy strategy que já existia (política D5A2-5, não regressão)
  const mk = (path: string, mode: string): Any => validateAnswer({ answer: { segments: [{ kind: "slot", ref, path }], claims: [{ ref, path, mode }] }, ledger, stop: null, question: "" } as Any)
  for (const mode of ["ASSERT", "LABELED"]) assert.deepEqual((mk("metrics[0].value", mode)).reasons, ["NUMBER_FROM_UNVERIFIED_EVIDENCE"], mode)
  const gref = okOf(g.result).evidence.evidenceRef
  const gledger = (addEvidence((newLedger("s1") as Any).ledger, g.entry) as Any).ledger
  assert.deepEqual((validateAnswer({ answer: { segments: [{ kind: "slot", ref: gref, path: "groups[0].key[0]" }], claims: [{ ref: gref, path: "groups[0].key[0]", mode: "ASSERT" }] }, ledger: gledger, stop: null, question: "" } as Any) as Any).reasons, ["NUMBER_FROM_UNVERIFIED_EVIDENCE"], "o groupBy strategy já era assim")
  // conta E estratégia na MESMA tabela, nos dois filtros ao mesmo tempo (== direto com os dois nomes)
  const t1: Any = (metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, ctxOf(TV, { aliases: newAliasTable("s1") })) as Any).aliases
  const both: Any = (metricsGroups({ groupBy: ["strategy"], metricIds: ["totalTrades"] }, ctxOf(TV, { aliases: t1 })) as Any).aliases
  assert.equal(both.conta.length, 2)
  assert.equal(both.estrategia.length, 3)
  // S1 (Sim101) + S2 (Sim102) com a conta A (Sim101): o filtro de conta CORTA (se ele sumisse, viriam 4 trades em vez de 2)
  const c = okOf(q({ metricIds: METRICS, filters: { account: "Conta A", strategy: ["Estratégia B", "Estratégia C"] } }, ctxOf(TV, { aliases: both })))
  assert.deepEqual(val(c), direct(TV, { account: ["Sim101"], strategyName: ["S1", "S2"] }))
  assert.equal(c.evidence.population.declared, 2)
  assert.notDeepEqual(val(c), direct(TV, { strategyName: ["S1", "S2"] }))
})

test("B11 — ESTÁTICA: Q0 segue com 14 arquivos; alias-input.ts só importa ../agent/, ../evidence/derived.ts e ./; label.ts intacto (sem imports); QUERY_FILTERS_SCHEMA tem `strategy:` mas não strategyId/strategyName/setup/timeframe/strategyVersion; strategy segue FORA de VERIFIABLE_*; applyAccountFilter não existe mais; os 6 chamadores usam applyAliasFilters; nenhum arquivo importa explain-* além dos de sempre", () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  assert.deepEqual(importsOf(read("src/lib/agent/label.ts")), [])
  const ai = read("src/lib/agent-capabilities/alias-input.ts")
  for (const p of importsOf(ai)) assert.ok(/^\.\.\/agent\//.test(p) || p === "../evidence/derived.ts" || p.startsWith("./") || p === "zod", `alias-input.ts: import fora do permitido: ${p}`)
  assert.equal(/explain-(?:trade|metric|derived)/.test(ai), false)
  assert.equal(/\bDate\b|Math\.random|process\.env|userId/.test(ai), false)
  const schema = read("src/lib/agent-capabilities/metrics-query.ts")
  const body = schema.slice(schema.indexOf("QUERY_FILTERS_SCHEMA = z"), schema.indexOf("QUERY_OPTIONS_SCHEMA"))
  assert.ok(/\baccount:/.test(body) && /\bstrategy:/.test(body))
  for (const k of ["strategyId", "strategyName", "setup", "timeframe", "strategyVersion"]) assert.equal(new RegExp(`\\b${k}\\s*:`).test(body), false, `QUERY_FILTERS_SCHEMA não pode ter ${k}`)
  assert.equal((VERIFIABLE_FILTERS as readonly string[]).some((k) => /strateg/.test(k)), false)
  assert.equal(VERIFIABLE_DIMS.has("strategy"), false)
  const dir = readdirSync(`${ROOT}src/lib/agent-capabilities`).filter((f) => f.endsWith(".ts"))
  assert.equal(dir.length, 14, "Q0: 14 arquivos")
  for (const f of dir) assert.equal(/applyAccountFilter/.test(read(`src/lib/agent-capabilities/${f}`)), false, `${f} ainda usa applyAccountFilter`)
  for (const f of ["metrics-query", "metrics-groups", "exit-breakdown", "exit-analysis", "rank-groups", "metrics-compare"]) assert.ok(/applyAliasFilters/.test(read(`src/lib/agent-capabilities/${f}.ts`)), `${f} precisa usar applyAliasFilters`)
  assert.ok(/strategy/.test(read("src/lib/agent-capabilities/project.ts").slice(read("src/lib/agent-capabilities/project.ts").indexOf("COMPARE_DIMENSIONS ="), read("src/lib/agent-capabilities/project.ts").indexOf("COMPARE_DIMENSIONS =") + 200)))
})

test("B12 — REGRESSÃO do alias de conta: sem estratégia no filtro, nada muda (resolução de conta == direto); nome cru de conta segue ARGS_INVALID; a tabela de conta sozinha não resolve estratégia", () => {
  const acc: Any = (metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, ctxOf(TV, { aliases: newAliasTable("s1") })) as Any).aliases
  const r = okOf(q({ metricIds: METRICS, filters: { account: "Conta A" } }, ctxOf(TV, { aliases: acc })))
  assert.deepEqual(val(r), direct(TV, { account: ["Sim101"] }))
  assert.deepEqual(q({ metricIds: METRICS, filters: { account: "Sim101" } }, ctxOf(TV, { aliases: acc })), ERR("metrics.query@1", "ARGS_INVALID"))
  assert.deepEqual(q({ metricIds: METRICS, filters: { strategy: "Estratégia A" } }, ctxOf(TV, { aliases: acc })), ERR("metrics.query@1", "ARGS_INVALID"))
})

console.log(`\n${passed} testes ok`)
