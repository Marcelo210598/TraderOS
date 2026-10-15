// E6.6-5-A: alias de ENTRADA (conta). `resolveAlias` (label.ts, puro) + `alias-input.ts` + filtro `account` em metrics.query/groups/exit.breakdown/compare + `account` como 10ª dimensão
// do compare. Testes escritos ANTES do código. Expectativa: scripts/expectations/agent-answer.expected.json → e66_5a (D5A-1…D5A-6, A1–A12, R1–R13).
//   node scripts/test-agent-alias-input.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { allocateAlias, newAliasTable, resolveAlias, type AliasTable } from "../src/lib/agent/label.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { refView } from "../src/lib/evidence/derived.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { aggregateTradesTraced, calculateMetrics, compareGroups, comparePeriods, exitReasonAnalysis, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
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
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const CSV = synthCsv(CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any))))
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "segredo-alias.csv" })
const rec = imp.importRecord as ImportRecord
const T = toAnalyticsTrades(withRisk(imp.trades))
const FILES = { [rec.importId]: enc(CSV) }
const REF = (name: string, trades: Any = T, salt = ""): string => { const rv = refView(trades, salt); const i = trades.findIndex((t: Any) => t.trade.account.sourceName === name); return rv[i].trade.account.sourceName }
const REF101 = REF("Sim101"), REF102 = REF("Sim102")
const ctx = (o: Any = {}): Any => ({ trades: T, importRecords: [rec], refEpoch: "s1", analysis: AN, ...o })
// a tabela da CONVERSA: vem de um metrics.groups real (Conta A = Sim101, Conta B = Sim102)
const CONV: AliasTable = (metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, ctx({ aliases: newAliasTable("s1") })) as Any).aliases
const SWAPPED: AliasTable = (() => { const a = allocateAlias(newAliasTable("s1"), "conta", REF102, "s1") as Any; return (allocateAlias(a.table, "conta", REF101, "s1") as Any).table })()
const ERR = (capability: string, code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability, ok: false, data: null, evidence: null, limits: [], error: { code } })
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 300)}`); return r }
const q = (args: unknown, c: Any = ctx({ aliases: CONV })): Any => metricsQuery(args, c).result
const gr = (args: unknown, c: Any = ctx({ aliases: CONV })): Any => metricsGroups(args, c)
const ex = (args: unknown, c: Any = ctx({ aliases: CONV })): Any => exitBreakdown(args, c).result
const cp = (args: unknown, c: Any = ctx({ aliases: CONV })): Any => metricsCompare(args, c).result
const METRICS = ["totalTrades", "netPnl", "winRate"]

test("A1 — resolveAlias (puro): formato exato; ida e volta com allocateAlias em TODO o domínio (A…ZZZ = 18.278); época, índice, kind, caixa, espaço, 4 letras, protótipo e não-string ⇒ { ok:false } fixo; tabela intacta", () => {
  const refs = Array.from({ length: 18278 }, (_, i) => `acc_${i.toString(16).padStart(24, "0")}`)
  const table: AliasTable = Object.freeze({ epoch: "s1", conta: Object.freeze(refs), estrategia: Object.freeze([]), rotulo: Object.freeze([]) })
  for (let i = 0; i < refs.length; i++) {
    const a = allocateAlias(table, "conta", refs[i], "s1") as Any
    assert.equal(a.ok, true)
    assert.deepEqual(resolveAlias(table, "conta", a.alias, "s1"), { ok: true, ref: refs[i] }, a.alias)
  }
  assert.deepEqual(resolveAlias(table, "conta", "Conta A", "s1"), { ok: true, ref: refs[0] })
  assert.deepEqual(resolveAlias(table, "conta", "Conta Z", "s1"), { ok: true, ref: refs[25] })
  assert.deepEqual(resolveAlias(table, "conta", "Conta AA", "s1"), { ok: true, ref: refs[26] })
  assert.deepEqual(resolveAlias(table, "conta", "Conta ZZ", "s1"), { ok: true, ref: refs[701] })
  assert.deepEqual(resolveAlias(table, "conta", "Conta AAA", "s1"), { ok: true, ref: refs[702] })
  assert.deepEqual(resolveAlias(table, "conta", "Conta ZZZ", "s1"), { ok: true, ref: refs[18277] })
  // estratégia e rótulo
  const t2 = (allocateAlias((allocateAlias(newAliasTable("s1"), "estrategia", `str_${"a".repeat(24)}`, "s1") as Any).table, "rotulo", `lbl_${"b".repeat(24)}`, "s1") as Any).table
  assert.deepEqual(resolveAlias(t2, "estrategia", "Estratégia A", "s1"), { ok: true, ref: `str_${"a".repeat(24)}` })
  assert.deepEqual(resolveAlias(t2, "rotulo", "rótulo personalizado A", "s1"), { ok: true, ref: `lbl_${"b".repeat(24)}` })
  const NO = { ok: false }
  const small = (allocateAlias(newAliasTable("s1"), "conta", REF101, "s1") as Any).table as AliasTable
  const bad: Array<[string, Any]> = [
    ["época diferente", [small, "conta", "Conta A", "s2"]], ["tabela de outra época", [small, "conta", "Conta A", "s0"]], ["índice fora da lista", [small, "conta", "Conta B", "s1"]], ["kind errado", [small, "estrategia", "Conta A", "s1"]], ["alias de outro kind", [small, "conta", "Estratégia A", "s1"]],
    ["caixa baixa", [small, "conta", "conta A", "s1"]], ["letra minúscula", [small, "conta", "Conta a", "s1"]], ["espaço extra no meio", [small, "conta", "Conta  A", "s1"]], ["espaço no fim", [small, "conta", "Conta A ", "s1"]], ["espaço no início", [small, "conta", " Conta A", "s1"]],
    ["4 letras", [small, "conta", "Conta AAAA", "s1"]], ["sem letra", [small, "conta", "Conta ", "s1"]], ["só o prefixo sem espaço", [small, "conta", "Conta", "s1"]], ["vazio", [small, "conta", "", "s1"]], ["dígito", [small, "conta", "Conta 1", "s1"]], ["acento trocado", [small, "estrategia", "Estrategia A", "s1"]],
    ["protótipo", [small, "conta", "__proto__", "s1"]], ["constructor", [small, "conta", "constructor", "s1"]], ["kind desconhecido", [small, "outro", "Conta A", "s1"]], ["kind protótipo", [small, "__proto__", "Conta A", "s1"]],
    ["não-string", [small, "conta", 5, "s1"]], ["null", [small, "conta", null, "s1"]], ["undefined", [small, "conta", undefined, "s1"]], ["época inválida", [small, "conta", "Conta A", ""]], ["tabela null", [null, "conta", "Conta A", "s1"]], ["tabela sem lista", [{ epoch: "s1" }, "conta", "Conta A", "s1"]], ["tabela com lista que não é array", [{ epoch: "s1", conta: "x", estrategia: [], rotulo: [] }, "conta", "Conta A", "s1"]],
  ]
  for (const [why, args] of bad) { assert.doesNotThrow(() => (resolveAlias as Any)(...args)); assert.deepEqual((resolveAlias as Any)(...args), NO, why) }
  assert.equal(JSON.stringify((resolveAlias as Any)(small, "conta", "ZZ_MARCADOR_ZZ", "s1")).includes("ZZ_MARCADOR_ZZ"), false, "não ecoa a entrada")
  assert.deepEqual(small.conta, [REF101])
  assert.equal(Object.isFrozen(small), true)
  assert.deepEqual(resolveAlias(small, "conta", "Conta B", "s1"), NO)
  assert.deepEqual(small.conta, [REF101], "resolver nunca aloca")
})

test("A2 — metrics.query com filters.account: 'Conta A' == calculateMetrics DIRETO com 'Sim101' (4 trades); 'Conta B' ⇒ Sim102 (2); lista ['Conta A','Conta B'] == sem filtro; VALID; sem arquivo NOT_VERIFIED; com arquivo VERIFIED", () => {
  const val = (r: Any): Any[] => r.data.metrics.map((m: Any) => [m.metricId, m.value])
  const direct = (account?: string[]): Any[] => { const d: Any = calculateMetrics(T, { filters: account ? { account } : {}, ...AN } as Any); return METRICS.map((id) => [id, d.metrics[id].value]) }
  const a = okOf(q({ metricIds: METRICS, filters: { account: "Conta A" } }))
  assert.deepEqual(val(a), direct(["Sim101"]))
  assert.equal(a.evidence.population.declared, 4)
  const b = okOf(q({ metricIds: METRICS, filters: { account: "Conta B" } }))
  assert.deepEqual(val(b), direct(["Sim102"]))
  assert.equal(b.evidence.population.declared, 2)
  const both = okOf(q({ metricIds: METRICS, filters: { account: ["Conta A", "Conta B"] } }))
  assert.deepEqual(val(both), direct())
  assert.equal(both.evidence.population.declared, 6)
  assert.notDeepEqual(val(a), val(b))
  assert.equal(a.evidence.verdict.verify.status, "VALID")
  assert.equal(a.evidence.verdict.combined, "NOT_VERIFIED")
  assert.equal(okOf(q({ metricIds: METRICS, filters: { account: "Conta A" } }, ctx({ aliases: CONV, source: { files: FILES } }))).evidence.verdict.combined, "VERIFIED")
  // com a tabela trocada, 'Conta A' é a Sim102
  assert.deepEqual(val(okOf(q({ metricIds: METRICS, filters: { account: "Conta A" } }, ctx({ aliases: SWAPPED })))), direct(["Sim102"]))
  // combinado com outro filtro
  const c: Any = calculateMetrics(T, { filters: { account: ["Sim101"], hour: 9 }, ...AN } as Any)
  assert.deepEqual(val(okOf(q({ metricIds: METRICS, filters: { account: "Conta A", hour: 9 } }))), METRICS.map((id) => [id, c.metrics[id].value]))
})

test("A3 — metrics.groups com filters.account + groupBy hour == direto (aggregateTradesTraced com 'Sim101'); a tabela devolvida em `aliases` não ganha nem perde entrada", () => {
  const out = gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: { account: "Conta A" } })
  const r = okOf(out.result)
  const d: Any = aggregateTradesTraced(T, { groupBy: ["hour"], metrics: ["totalTrades"], filters: { account: "Sim101" }, ...AN } as Any).result
  assert.deepEqual(r.data.groups.map((g: Any) => [g.key, g.sampleSize]), d.groups.map((g: Any) => [[`${g.key[0]}:00`], g.sampleSize]))
  assert.equal(r.evidence.population.declared, d.total.population.afterFilters)
  assert.deepEqual(out.aliases.conta, CONV.conta)
  assert.equal(out.aliases.epoch, "s1")
  // groupBy account com filtro account: o alias devolvido continua o da conversa
  const g2 = gr({ groupBy: ["account"], metricIds: ["totalTrades"], filters: { account: "Conta B" } })
  const r2 = okOf(g2.result)
  assert.deepEqual(r2.data.groups.map((g: Any) => [g.key, g.sampleSize]), [[["Conta B"], 2]])
  assert.deepEqual(g2.aliases.conta, CONV.conta)
})

test("A4 — exit.breakdown com filters.account == exitReasonAnalysis DIRETO com 'Sim101'; VALID; com arquivo VERIFIED", () => {
  const d: Any = exitReasonAnalysis(T, { filters: { account: "Sim101" }, ...AN } as Any)
  const r = okOf(ex({ filters: { account: "Conta A" } }, ctx({ aliases: CONV, source: { files: FILES } })))
  assert.equal(r.evidence.verdict.combined, "VERIFIED")
  assert.equal(r.evidence.population.declared, 4)
  const legs = r.data.buckets.filter((b: Any) => b.unit === "LEG").map((b: Any) => [b.reason, b.count, b.pnlNet])
  const trades = r.data.buckets.filter((b: Any) => b.unit === "TRADE").map((b: Any) => [b.reason, b.count, b.pnlNet])
  assert.deepEqual(legs, d.legs.rows.map((x: Any) => [x.reason, x.legs, x.net.value]))
  assert.deepEqual(trades, d.trades.rows.map((x: Any) => [x.bucket, x.trades, x.net.value]))
  const all = okOf(ex({}, ctx({ aliases: CONV })))
  assert.notDeepEqual(all.data.buckets, r.data.buckets)
})

test("A5 — metrics.compare GROUP por conta: 'Conta A' vs 'Conta B' == compareGroups DIRETO (Sim101 vs Sim102); chaves vêm da TABELA da conversa (trocada ⇒ Conta A é a Sim102); account+hour; a == b depois de resolver ⇒ ARGS_INVALID", () => {
  const d: Any = compareGroups(T, { groupBy: ["account"], a: { account: "Sim101" }, b: { account: "Sim102" }, metrics: ["totalTrades", "netPnl"], ...AN } as Any)
  const r = okOf(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades", "netPnl"] }))
  assert.deepEqual(r.data.a, { key: ["Conta A"], sampleSize: 4 })
  assert.deepEqual(r.data.b, { key: ["Conta B"], sampleSize: 2 })
  assert.deepEqual(r.data.deltas.map((x: Any) => [x.metricId, x.a, x.b, x.delta]), d.metrics.map((m: Any) => [m.metric, m.a.value, m.b.value, m.delta]))
  assert.deepEqual(r.data.deltas.map((x: Any) => [x.metricId, x.a, x.b, x.delta]), [["totalTrades", 4, 2, -2], ["netPnl", 8, 12.8, 4.8]])
  assert.equal(r.evidence.verdict.verify.status, "VALID")
  assert.equal(okOf(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades"] }, ctx({ aliases: CONV, source: { files: FILES } }))).evidence.verdict.combined, "VERIFIED")
  // tabela trocada: 'Conta A' = Sim102 (2 trades), 'Conta B' = Sim101 (4)
  const sw = okOf(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades"] }, ctx({ aliases: SWAPPED })))
  assert.deepEqual(sw.data.a, { key: ["Conta A"], sampleSize: 2 })
  assert.deepEqual(sw.data.b, { key: ["Conta B"], sampleSize: 4 })
  // 2 dimensões
  const d2: Any = compareGroups(T, { groupBy: ["account", "hour"], a: { account: "Sim101", hour: "09" }, b: { account: "Sim102", hour: "09" }, metrics: ["totalTrades"], ...AN } as Any)
  const r2 = okOf(cp({ mode: "GROUP", groupBy: ["account", "hour"], a: { account: "Conta A", hour: 9 }, b: { account: "Conta B", hour: 9 }, metricIds: ["totalTrades"] }))
  assert.deepEqual(r2.data.a, { key: ["Conta A", "09:00"], sampleSize: d2.a.sampleSize })
  assert.deepEqual(r2.data.b, { key: ["Conta B", "09:00"], sampleSize: d2.b.sampleSize })
  // a == b depois de resolver: dois aliases do MESMO ref
  const dup = (allocateAlias(CONV, "conta", REF101, "s1") as Any).table
  assert.deepEqual(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta A" }, metricIds: ["totalTrades"] }), ERR("metrics.compare@1", "ARGS_INVALID"))
  assert.equal(dup, CONV)
  // sem tabela / alias fora dela
  assert.deepEqual(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades"] }, ctx()), ERR("metrics.compare@1", "ARGS_INVALID"))
  assert.deepEqual(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta Z" }, metricIds: ["totalTrades"] }), ERR("metrics.compare@1", "ARGS_INVALID"))
  assert.deepEqual(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Sim101" }, b: { account: "Sim102" }, metricIds: ["totalTrades"] }), ERR("metrics.compare@1", "ARGS_INVALID"))
})

test("A6 — metrics.compare PERIOD com filters.account alias == comparePeriods DIRETO com o nome; VALID e, com arquivo, VERIFIED", () => {
  const a = { from: "2026-03-02", to: "2026-03-06" }, b = { from: "2026-03-09", to: "2026-03-10" }
  const d: Any = comparePeriods(T, { a, b, metrics: ["totalTrades", "netPnl"], filters: { account: "Sim101" }, ...AN } as Any)
  const r = okOf(cp({ mode: "PERIOD", a, b, metricIds: ["totalTrades", "netPnl"], filters: { account: "Conta A" } }, ctx({ aliases: CONV, source: { files: FILES } })))
  assert.deepEqual(r.data.deltas.map((x: Any) => [x.metricId, x.a, x.b, x.delta]), d.metrics.map((m: Any) => [m.metric, m.a.value, m.b.value, m.delta]))
  assert.equal(r.evidence.verdict.combined, "VERIFIED")
  const semFiltro = okOf(cp({ mode: "PERIOD", a, b, metricIds: ["totalTrades", "netPnl"] }))
  assert.notDeepEqual(semFiltro.data.deltas, r.data.deltas)
})

test("A7 — FALHAS ⇒ ARGS_INVALID fixo e sem eco: sem tabela, época diferente, alias fora da tabela, formato errado, nome cru, lista vazia, 9 aliases, ref sem trade, tabela malformada; strategy/setup/timeframe continuam fora", () => {
  const F = (account: unknown, c: Any = ctx({ aliases: CONV })): Any => q({ metricIds: ["netPnl"], filters: { account } }, c)
  const ARGS = ERR("metrics.query@1", "ARGS_INVALID")
  const orphan = (allocateAlias(CONV, "conta", `acc_${"c".repeat(24)}`, "s1") as Any).table // 'Conta C' existe na tabela, mas nenhum trade tem esse ref
  const nines = Array.from({ length: 9 }, () => "Conta A")
  const cases: Array<[string, Any]> = [
    ["sem ctx.aliases", F("Conta A", ctx())], ["época da tabela diferente", F("Conta A", ctx({ aliases: newAliasTable("s0") }))], ["tabela de outra época com a conta", F("Conta A", ctx({ aliases: (allocateAlias(newAliasTable("s0"), "conta", REF101, "s0") as Any).table }))],
    ["alias fora da tabela", F("Conta Z")], ["alias de um índice vazio", F("Conta C")], ["caixa baixa", F("conta A")], ["espaço duplo", F("Conta  A")], ["4 letras", F("Conta AAAA")], ["Estratégia A em account", F("Estratégia A")],
    ["nome cru Sim101", F("Sim101")], ["nome cru Sim102", F(["Sim102"])], ["lista vazia", F([])], ["9 aliases", F(nines)], ["não-string", F(5)], ["null", F(null)], ["objeto", F({ a: 1 })],
    ["ref sem trade em ctx.trades", F("Conta C", ctx({ aliases: orphan }))],
    ["tabela malformada (conta não é array)", F("Conta A", ctx({ aliases: { epoch: "s1", conta: "x", estrategia: [], rotulo: [] } }))], ["tabela sem epoch", F("Conta A", ctx({ aliases: { conta: [REF101], estrategia: [], rotulo: [] } }))], ["tabela null", F("Conta A", ctx({ aliases: null }))],
  ]
  for (const [why, r] of cases) assert.deepEqual(r, ARGS, why)
  for (const filters of [{ strategy: "Estratégia A" }, { strategyId: "x" }, { strategyName: "x" }, { setup: "x" }, { timeframe: "M5" }, { strategyVersionId: "x" }]) {
    assert.deepEqual(q({ metricIds: ["netPnl"], filters }), ARGS, JSON.stringify(filters))
    assert.deepEqual(ex({ filters }), ERR("exit.breakdown@1", "ARGS_INVALID"), JSON.stringify(filters))
    assert.deepEqual(gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters }).result, ERR("metrics.groups@1", "ARGS_INVALID"), JSON.stringify(filters))
  }
  for (const dim of ["strategy", "session", "setup", "timeframe", "strategyVersion"]) assert.deepEqual(cp({ mode: "GROUP", groupBy: [dim], a: { [dim]: "x" }, b: { [dim]: "y" }, metricIds: ["totalTrades"] }), ERR("metrics.compare@1", "ARGS_INVALID"), dim)
  // as 4 capacidades recusam igual
  assert.deepEqual(ex({ filters: { account: "Conta Z" } }), ERR("exit.breakdown@1", "ARGS_INVALID"))
  assert.deepEqual(gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: { account: "Conta Z" } }).result, ERR("metrics.groups@1", "ARGS_INVALID"))
  assert.deepEqual(cp({ mode: "PERIOD", a: { from: "2026-03-02", to: "2026-03-06" }, b: { from: "2026-03-09", to: "2026-03-10" }, metricIds: ["totalTrades"], filters: { account: "Conta Z" } }), ERR("metrics.compare@1", "ARGS_INVALID"))
})

test("A8 — PRIVACIDADE: com filtro/dimensão por conta o envelope NÃO contém 'Sim101', 'Sim102', 'acc_' nem o nome do arquivo; o envelope de ARGS_INVALID não ecoa o alias pedido", () => {
  const dumps = [
    q({ metricIds: METRICS, filters: { account: "Conta A" } }, ctx({ aliases: CONV, source: { files: FILES } })),
    gr({ groupBy: ["account"], metricIds: ["totalTrades"], filters: { account: ["Conta A", "Conta B"] } }).result,
    ex({ filters: { account: "Conta B" } }),
    cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades", "netPnl"] }),
    cp({ mode: "PERIOD", a: { from: "2026-03-02", to: "2026-03-06" }, b: { from: "2026-03-09", to: "2026-03-10" }, metricIds: ["totalTrades"], filters: { account: "Conta A" } }),
  ].map((r) => (okOf(r), JSON.stringify(r)))
  for (const d of dumps) { for (const leak of ["Sim101", "Sim102", "acc_", "segredo-alias", REF101, REF102, rec.importId]) assert.equal(d.includes(leak), false, `vazou: ${leak}`); assert.equal(/[0-9a-f]{64}/.test(d), false) }
  const bad = JSON.stringify(q({ metricIds: METRICS, filters: { account: "Conta Z" } }))
  assert.equal(bad.includes("Conta Z"), false)
  assert.equal(JSON.stringify(q({ metricIds: METRICS, filters: { account: "Sim101" } })).includes("Sim101"), false)
})

test("A9 — SAL (medido): (a) import SALGADO normal (o trade carrega account.ref): resolve com o sal certo e == direto; com o sal ERRADO resolve igual, mas com o ARQUIVO o source vira UNVERIFIABLE e combined NOT_VERIFIED (nunca VERIFIED falso); sem sal ⇒ ENGINE_REFUSED. (b) trade SEM account.ref: sal certo resolve; sal ERRADO ⇒ ARGS_INVALID", () => {
  const SALT = "sal-de-teste-do-alias-0123456789abcdef0123456789abcdef0123456789"
  const WRONG = "outro-sal-completamente-diferente-0123456789abcdef0123456789abcd"
  const salted: Any = runImportPipeline(CSV, { sourceTz: BRT, fileName: "salgado-alias.csv", accountRefSalt: SALT } as Any)
  const sRec = salted.importRecord as ImportRecord
  const sFiles = { [sRec.importId]: enc(CSV) }
  const TS = toAnalyticsTrades(withRisk(salted.trades))
  const base: Any = { trades: TS, importRecords: [sRec], refEpoch: "s1", analysis: AN }
  const table: AliasTable = (metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, { ...base, accountRefSalt: SALT, aliases: newAliasTable("s1") }) as Any).aliases
  assert.equal(table.conta.length, 2)
  assert.equal(table.conta[0], REF("Sim101", TS, SALT))
  const args = { metricIds: METRICS, filters: { account: "Conta A" } }
  const good = okOf(q(args, { ...base, accountRefSalt: SALT, aliases: table }))
  const d: Any = calculateMetrics(TS, { filters: { account: ["Sim101"] }, ...AN } as Any)
  assert.deepEqual(good.data.metrics.map((m: Any) => [m.metricId, m.value]), METRICS.map((id) => [id, d.metrics[id].value]))
  assert.equal(good.evidence.population.declared, 4)
  const sourceOf = (salt: string): Any => okOf(q(args, { ...base, accountRefSalt: salt, aliases: table, source: { files: sFiles, options: { accountRefSalt: salt } } })).evidence.verdict
  assert.equal(sourceOf(SALT).combined, "VERIFIED")
  const wrong = sourceOf(WRONG)
  assert.equal(wrong.source.status, "UNVERIFIABLE")
  assert.equal(wrong.combined, "NOT_VERIFIED")
  assert.deepEqual(q(args, { ...base, aliases: table }), ERR("metrics.query@1", "ENGINE_REFUSED"))
  const cmp = okOf(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades"] }, { ...base, accountRefSalt: SALT, aliases: table }))
  assert.deepEqual([cmp.data.a.key, cmp.data.b.key, cmp.data.a.sampleSize, cmp.data.b.sampleSize], [["Conta A"], ["Conta B"], 4, 2])
  // (b) trade SEM account.ref (legado): o sal é o que reproduz o ref
  const TS2: Any = TS.map((t: Any) => ({ ...t, trade: { ...t.trade, account: { ...t.trade.account, ref: undefined } } }))
  const base2: Any = { trades: TS2, importRecords: [sRec], refEpoch: "s1", analysis: AN }
  const g2: Any = metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, { ...base2, accountRefSalt: SALT, aliases: newAliasTable("s1") })
  assert.equal(g2.result.ok, true)
  const ok2 = okOf(q(args, { ...base2, accountRefSalt: SALT, aliases: g2.aliases }))
  assert.deepEqual(ok2.data.metrics.map((m: Any) => [m.metricId, m.value]), METRICS.map((id) => [id, d.metrics[id].value]))
  assert.deepEqual(q(args, { ...base2, accountRefSalt: WRONG, aliases: g2.aliases }), ERR("metrics.query@1", "ARGS_INVALID"))
})

test("A10 — PUREZA: ctx.aliases congelado não é alterado; mesma saída em duas chamadas; getter de `aliases` que lança ⇒ ENGINE_REFUSED sem lançar; ctx.trades não é alterado", () => {
  const deepFreeze = (o: Any): void => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(deepFreeze) } }
  const frozen: Any = JSON.parse(JSON.stringify(CONV)); deepFreeze(frozen)
  const c = ctx({ aliases: frozen })
  const snap = [JSON.stringify(c.trades), JSON.stringify(c.importRecords), JSON.stringify(frozen)]
  const args = { metricIds: METRICS, filters: { account: "Conta A" } }
  const a = q(args, c), b = q(args, c)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  assert.deepEqual([JSON.stringify(c.trades), JSON.stringify(c.importRecords), JSON.stringify(frozen)], snap)
  const hostile: Any = ctx()
  Object.defineProperty(hostile, "aliases", { enumerable: true, get() { throw new Error("getter hostil") } })
  const calls: Array<[string, () => Any]> = [
    ["metrics.query", () => metricsQuery(args, hostile).result], ["metrics.groups", () => metricsGroups({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: { account: "Conta A" } }, hostile).result],
    ["exit.breakdown", () => exitBreakdown({ filters: { account: "Conta A" } }, hostile).result], ["metrics.compare", () => metricsCompare({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades"] }, hostile).result],
  ]
  for (const [cap, f] of calls) { assert.doesNotThrow(f, cap); assert.deepEqual(f(), ERR(`${cap}@1`, "ENGINE_REFUSED"), cap) }
  // sem filtro de conta a tabela nem é lida: a resposta é normal
  assert.equal(okOf(metricsQuery({ metricIds: METRICS }, hostile).result).ok, true)
})

test("A11 — ESTÁTICA: Q0 lista 10 arquivos; label.ts não importa nada; alias-input.ts só importa ../agent/, ../evidence/derived.ts e ./; QUERY_FILTERS_SCHEMA sem strategy*/setup/timeframe; nenhum arquivo novo importa explain-*", () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  assert.deepEqual(importsOf(read("src/lib/agent/label.ts")), [])
  const ai = read("src/lib/agent-capabilities/alias-input.ts")
  for (const p of importsOf(ai)) assert.ok(/^\.\.\/agent\//.test(p) || p === "../evidence/derived.ts" || p.startsWith("./") || p === "zod", `alias-input.ts: import fora do permitido: ${p}`)
  assert.equal(/explain-(?:trade|metric|derived)/.test(ai), false)
  assert.equal(/\bDate\b|Math\.random|process\.env|userId/.test(ai), false)
  const schema = read("src/lib/agent-capabilities/metrics-query.ts")
  const at = schema.indexOf("QUERY_FILTERS_SCHEMA = z")
  const body = schema.slice(at, schema.indexOf("QUERY_OPTIONS_SCHEMA"))
  assert.ok(/account:/.test(body))
  for (const k of ["strategy", "strategyId", "strategyName", "setup", "timeframe", "strategyVersion"]) assert.equal(new RegExp(`\\b${k}\\s*:`).test(body), false, `QUERY_FILTERS_SCHEMA não pode ter ${k}`)
  const staticTest = readFileSync(`${ROOT}scripts/test-agent-capabilities-static.mts`, "utf8")
  assert.ok(staticTest.includes('"alias-input.ts"'))
  assert.ok(staticTest.includes("os 10 arquivos esperados"))
})

test("A12 — TESTES EXISTENTES: nome cru de conta continua ARGS_INVALID nas 4 capacidades (sem tabela e com tabela); compare por conta sem tabela continua ARGS_INVALID", () => {
  for (const c of [ctx(), ctx({ aliases: CONV })]) {
    assert.deepEqual(q({ metricIds: ["netPnl"], filters: { account: "Sim101" } }, c), ERR("metrics.query@1", "ARGS_INVALID"))
    assert.deepEqual(ex({ filters: { account: "Sim101" } }, c), ERR("exit.breakdown@1", "ARGS_INVALID"))
    assert.deepEqual(gr({ groupBy: ["hour"], metricIds: ["totalTrades"], filters: { account: "Sim101" } }, c).result, ERR("metrics.groups@1", "ARGS_INVALID"))
    assert.deepEqual(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Sim101" }, b: { account: "Sim102" }, metricIds: ["totalTrades"] }, c), ERR("metrics.compare@1", "ARGS_INVALID"))
  }
  assert.deepEqual(cp({ mode: "GROUP", groupBy: ["account"], a: { account: "Conta A" }, b: { account: "Conta B" }, metricIds: ["totalTrades"] }, ctx()), ERR("metrics.compare@1", "ARGS_INVALID"))
})

console.log(`\n${passed} testes ok`)
