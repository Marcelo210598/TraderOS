// E6.6-1: resolvedor de `path` + tabela de unidade por folha + renderSlot. Testes escritos ANTES do código (src/lib/agent/slot-path.ts ainda NÃO existe).
// Expectativa: scripts/expectations/agent-answer.expected.json → path_cases, e66_1.leaf_table, e66_1.path_cases_added.
//   node scripts/test-agent-slot-path.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderSlot, resolveSlot } from "../src/lib/agent/slot-path.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// ── views construídas à mão (passam nos schemas de views.ts) ─────────────────
const cov = (used: number, total: number, ratio: number) => ({ used, total, ratio })
const mv = (metricId: string, value: number | null, unit: string, reason: string | null, extra: Any = {}): Any => ({ metricId, value, unit, basis: null, sampleSize: value === null ? 0 : 10, coverage: cov(value === null ? 0 : 10, 10, value === null ? 0 : 1), reason, ...extra })
const V_QUERY: Any = { metrics: [mv("netPnl", 1234.56, "usd", null, { basis: "NET" }), mv("profitFactor", null, "ratio", "DENOMINATOR_ZERO"), mv("totalPoints", 12.5, "points", null), mv("winRate", 55.56, "percent", null), mv("averageR", -0.5, "R", null)], period: { from: "2026-01-05", to: "2026-01-30" } }
// E6.6-V: o motivo da indisponibilidade viaja ao lado (null sem motivo continua sendo erro de formato — W-cases em test-agent-views-reason.mts)
const bucket = (reason: string, count: number, pnlNet: number | null, share: number | null): Any => ({ reason, unit: "TRADE", count, pnlNet, pnlNetReason: null, share, shareReason: null, coverage: cov(count, count, 1) })
const V_EXIT: Any = { buckets: [bucket("TARGET", 3, 150, 0.25), bucket("STOP", 1, null, null)], reconciliation: "RECONCILED" }
const V_GROUPS: Any = { groupBy: ["account"], groups: [{ key: ["Conta A"], sampleFlag: "LOW", sampleSize: 4, metrics: [mv("netPnl", 80, "usd", null)] }] }
const DELTAS = [{ metricId: "netPnl", unit: "usd", a: 100, aReason: null, b: 150, bReason: null, delta: -50, ratio: 0.6667, reason: null }, { metricId: "profitFactor", unit: "ratio", a: null, aReason: null, b: 1.5, bReason: null, delta: null, ratio: null, reason: null }]
const V_COMPARE: Any = { a: { key: ["Conta A"], sampleSize: 4 }, b: { key: ["Conta B"], sampleSize: 6 }, deltas: DELTAS, conclusive: false }
const V_RANK: Any = { rows: [{ rank: 1, key: ["Conta A"], value: mv("netPnl", 80, "usd", null), sampleFlag: "OK", tiedWithPrevious: false, contribution: 0.2556, contributionReason: null }], orderedBy: "netPnl" }
const V_ANALYSIS_NULL: Any = { buckets: [bucket("TARGET", 3, 150, 0.25)], comparison: null }
const V_ANALYSIS: Any = { buckets: [bucket("TARGET", 3, 150, 0.25)], comparison: V_COMPARE }
const leg = (role: string, price: number | null, label: string): Any => ({ role, price, quantity: 2, label, pnlNet: role === "EXIT" ? 40 : null })
const V_EXPLAIN: Any = { page: 1, pageCount: 1, total: 1, trades: [{ ordinal: 1, instrument: "MNQ", direction: "LONG", quantity: 2, entryLocal: "2026-01-05T09:30:00", exitLocal: "2026-01-05T09:40:00", entryPrice: 21034.25, exitPrice: 21054.5, pnlNet: 40, pnlGross: 41.2, exitReason: "TARGET", accountAlias: "Conta A", legs: [leg("ENTRY", 21034.25, "Entry"), leg("EXIT", 21054.5, "Target1")] }] }

const render = (viewId: string, view: Any, path: string): Any => renderSlot(viewId as never, view, path)
const ok = (viewId: string, view: Any, path: string, text: string): void => assert.deepEqual(render(viewId, view, path), { ok: true, text }, `${viewId} ${path}`)
const err = (viewId: string, view: Any, path: string, code: string): void => assert.deepEqual(render(viewId, view, path), { ok: false, code }, `${viewId} ${path}`)

test("P1 — metrics.query: valor com a unidade da folha IRMÃ (usd, points, percent, R), indisponível com motivo, contagem, fração, motivo cru, data", () => {
  const Q = "metrics.query@1"
  ok(Q, V_QUERY, "metrics[0].value", "US$ 1.234,56")
  ok(Q, V_QUERY, "metrics[2].value", "12,50 pts")
  ok(Q, V_QUERY, "metrics[3].value", "55,56%")
  ok(Q, V_QUERY, "metrics[4].value", "-0,5000 R")
  ok(Q, V_QUERY, "metrics[1].value", "indisponível (o denominador é zero)")
  ok(Q, V_QUERY, "metrics[0].sampleSize", "10")
  ok(Q, V_QUERY, "metrics[0].coverage.used", "10")
  ok(Q, V_QUERY, "metrics[0].coverage.total", "10")
  ok(Q, V_QUERY, "metrics[0].coverage.ratio", "100,00%")
  ok(Q, V_QUERY, "metrics[1].coverage.ratio", "0,00%")
  ok(Q, V_QUERY, "metrics[1].reason", "o denominador é zero")
  err(Q, V_QUERY, "metrics[0].reason", "FORMAT_INVALID") // reason null: nunca em branco
  ok(Q, V_QUERY, "period.from", "05/01/2026")
  ok(Q, V_QUERY, "period.to", "30/01/2026")
})

test("P2 — a unidade vem da TABELA/folha irmã, NUNCA do nome: o mesmo campo `value` formata como usd, points, percent ou R conforme o irmão `unit`; metricId não influi", () => {
  const v = clone(V_QUERY)
  v.metrics[0].metricId = "totalPoints" // nome de métrica de pontos, mas unit = usd
  ok("metrics.query@1", v, "metrics[0].value", "US$ 1.234,56")
  v.metrics[2].metricId = "netPnl" // nome de dinheiro, mas unit = points
  ok("metrics.query@1", v, "metrics[2].value", "12,50 pts")
  const w = clone(V_COMPARE)
  w.deltas[0].unit = "R"
  w.deltas[0].a = 1.5
  ok("metrics.compare@1", w, "deltas[0].a", "1,5000 R")
})

test("P3 — exit.breakdown: motivo de SAÍDA (enum exitReason, NÃO o catálogo de indisponibilidade), contagem, usd, fração, reconciliação; null sem `reason` irmão ⇒ erro; `unit` não é folha", () => {
  const E = "exit.breakdown@1"
  ok(E, V_EXIT, "buckets[0].reason", "alvo")
  ok(E, V_EXIT, "buckets[1].reason", "stop")
  ok(E, V_EXIT, "buckets[0].count", "3")
  ok(E, V_EXIT, "buckets[0].pnlNet", "US$ 150,00")
  ok(E, V_EXIT, "buckets[0].share", "25,00%")
  ok(E, V_EXIT, "buckets[0].coverage.ratio", "100,00%")
  ok(E, V_EXIT, "reconciliation", "conciliado")
  err(E, V_EXIT, "buckets[1].pnlNet", "FORMAT_INVALID")
  err(E, V_EXIT, "buckets[1].share", "FORMAT_INVALID")
  err(E, V_EXIT, "buckets[0].unit", "SLOT_PATH_INVALID")
})

test("P4 — metrics.groups, metrics.compare, rank.groups, exit.analysis, evidence.explain: folhas da tabela", () => {
  ok("metrics.groups@1", V_GROUPS, "groups[0].sampleSize", "4")
  ok("metrics.groups@1", V_GROUPS, "groups[0].sampleFlag", "amostra pequena")
  ok("metrics.groups@1", V_GROUPS, "groups[0].key[0]", "Conta A")
  ok("metrics.groups@1", V_GROUPS, "groups[0].metrics[0].value", "US$ 80,00")
  ok("metrics.compare@1", V_COMPARE, "a.sampleSize", "4")
  ok("metrics.compare@1", V_COMPARE, "b.key[0]", "Conta B")
  ok("metrics.compare@1", V_COMPARE, "deltas[0].delta", "-US$ 50,00")
  ok("metrics.compare@1", V_COMPARE, "deltas[0].a", "US$ 100,00")
  ok("metrics.compare@1", V_COMPARE, "deltas[0].ratio", "0,6667")
  err("metrics.compare@1", V_COMPARE, "deltas[1].delta", "FORMAT_INVALID") // null sem reason irmão (achado registrado no e66_1.leaf_table)
  ok("rank.groups@1", V_RANK, "rows[0].rank", "1")
  ok("rank.groups@1", V_RANK, "rows[0].value.value", "US$ 80,00")
  ok("rank.groups@1", V_RANK, "rows[0].contribution", "25,56%")
  ok("rank.groups@1", V_RANK, "rows[0].sampleFlag", "amostra adequada")
  ok("exit.analysis@1", V_ANALYSIS, "buckets[0].share", "25,00%")
  ok("exit.analysis@1", V_ANALYSIS, "comparison.deltas[0].delta", "-US$ 50,00")
  err("exit.analysis@1", V_ANALYSIS_NULL, "comparison.deltas[0].delta", "SLOT_PATH_INVALID") // descer em null
  err("exit.analysis@1", V_ANALYSIS_NULL, "comparison.a.sampleSize", "SLOT_PATH_INVALID")
  const X = "evidence.explain@1"
  ok(X, V_EXPLAIN, "page", "1")
  ok(X, V_EXPLAIN, "total", "1")
  ok(X, V_EXPLAIN, "trades[0].ordinal", "1")
  ok(X, V_EXPLAIN, "trades[0].quantity", "2")
  ok(X, V_EXPLAIN, "trades[0].direction", "compra")
  ok(X, V_EXPLAIN, "trades[0].entryPrice", "21.034,25")
  ok(X, V_EXPLAIN, "trades[0].exitPrice", "21.054,50")
  ok(X, V_EXPLAIN, "trades[0].pnlNet", "US$ 40,00")
  ok(X, V_EXPLAIN, "trades[0].pnlGross", "US$ 41,20")
  ok(X, V_EXPLAIN, "trades[0].exitReason", "alvo")
  ok(X, V_EXPLAIN, "trades[0].accountAlias", "Conta A")
  ok(X, V_EXPLAIN, "trades[0].legs[1].price", "21.054,50")
  ok(X, V_EXPLAIN, "trades[0].legs[1].quantity", "2")
  ok(X, V_EXPLAIN, "trades[0].legs[1].pnlNet", "US$ 40,00")
  ok(X, V_EXPLAIN, "trades[0].legs[1].label", "Target1")
  err(X, V_EXPLAIN, "trades[0].legs[0].pnlNet", "FORMAT_INVALID") // null sem motivo
  err(X, V_EXPLAIN, "trades[0].instrument", "SLOT_PATH_INVALID")
  err(X, V_EXPLAIN, "trades[0].entryLocal", "SLOT_PATH_INVALID")
  err(X, V_EXPLAIN, "trades[0].legs[0].role", "SLOT_PATH_INVALID")
})

test("P5 — path_cases.ok: cada path válido da expectativa resolve (a folha existe e é da tabela)", () => {
  const cases: Array<[string, Any, string]> = [
    ["metrics.query@1", V_QUERY, "metrics[0].value"], ["metrics.query@1", V_QUERY, "metrics[0].reason"], ["metrics.query@1", V_QUERY, "metrics[1].coverage.ratio"], ["metrics.query@1", V_QUERY, "period.from"],
    ["metrics.groups@1", V_GROUPS, "groups[0].metrics[0].value"], ["rank.groups@1", V_RANK, "rows[0].value.value"], ["metrics.compare@1", V_COMPARE, "deltas[1].delta"],
    ["exit.breakdown@1", V_EXIT, "buckets[0].pnlNet"], ["evidence.explain@1", V_EXPLAIN, "trades[0].legs[1].label"],
  ]
  assert.equal(cases.length, exp.path_cases.ok.length)
  for (const [id, view, path] of cases) assert.equal(resolveSlot(id as never, view, path).ok, true, `${id} ${path}`)
})

test("P6 — path_cases.invalid_SLOT_PATH_INVALID: cada caso inválido da expectativa ⇒ { ok:false, code:'SLOT_PATH_INVALID' } sem lançar", () => {
  const Q = "metrics.query@1"
  const long = `metrics[0].${"a".repeat(220)}`
  const cases: string[] = [
    "metrics[5].value", "metrics.value", "metrics[0]", "metrics[0].coverage", "metrics[0].nope", "metrics[0].value.x", "__proto__", "constructor", "toString", "hasOwnProperty", "metrics[0].__proto__",
    "evidenceHash", "metrics[01].value", "metrics[ 0 ].value", long,
    "metrics[0].metricId", "metrics[0].unit" /* `basis` virou folha de slot no E6.6-2b (PD-1 b): ver test-agent-basis-slot.mts */, "", ".", "metrics[0].", ".metrics[0].value", "metrics[0]value", "metrics[-1].value", "metrics[0].value ", "metrics[1000].value", "constructor.name", "prototype", "__defineGetter__", "valueOf", "metrics[0].constructor", "metrics[0].coverage.__proto__",
  ]
  assert.equal(exp.path_cases.invalid_SLOT_PATH_INVALID.length, 15)
  for (const p of cases) {
    assert.doesNotThrow(() => resolveSlot(Q, V_QUERY, p), p)
    assert.deepEqual(resolveSlot(Q, V_QUERY, p), { ok: false, code: "SLOT_PATH_INVALID" }, JSON.stringify(p).slice(0, 60))
    assert.deepEqual(render(Q, V_QUERY, p), { ok: false, code: "SLOT_PATH_INVALID" }, `render ${JSON.stringify(p).slice(0, 60)}`)
  }
  for (const p of [5, null, undefined, {}, [], ["metrics[0].value"]]) assert.deepEqual(resolveSlot(Q, V_QUERY, p as never), { ok: false, code: "SLOT_PATH_INVALID" }, `path de tipo errado ${String(p)}`)
  for (const id of ["x@1", "", "evidence.refresh@1", "__proto__", "constructor", "toString", null, undefined, 5]) assert.deepEqual(resolveSlot(id as never, V_QUERY, "metrics[0].value"), { ok: false, code: "SLOT_PATH_INVALID" }, `viewId ${String(id)}`)
})

test("P7 — só PROPRIEDADES PRÓPRIAS: propriedade herdada não conta; a chave 'hasOwnProperty' própria não muda o resultado; objeto/array como valor da folha ⇒ inválido (nunca devolve objeto)", () => {
  const Q = "metrics.query@1"
  const inheritedMetric = Object.create({ value: 5, unit: "usd", reason: null }) // value/unit só no protótipo
  const v1: Any = { metrics: [inheritedMetric], period: { from: null, to: null } }
  assert.deepEqual(resolveSlot(Q, v1, "metrics[0].value"), { ok: false, code: "SLOT_PATH_INVALID" })
  // herança como ÚNICA defesa: folhas sem unidade irmã (o `unit` próprio de outra checagem não ajuda)
  const v1b: Any = { metrics: [Object.create({ sampleSize: 5 })], period: { from: null, to: null } }
  assert.deepEqual(resolveSlot(Q, v1b, "metrics[0].sampleSize"), { ok: false, code: "SLOT_PATH_INVALID" })
  assert.deepEqual(resolveSlot("evidence.explain@1", Object.create({ page: 1 }), "page"), { ok: false, code: "SLOT_PATH_INVALID" })
  assert.equal(resolveSlot(Q, { metrics: [{ sampleSize: 5 }], period: { from: null, to: null } }, "metrics[0].sampleSize").ok, true, "contraprova: própria passa")
  const v2 = clone(V_QUERY)
  v2.hasOwnProperty = 5
  v2.metrics[0].hasOwnProperty = "x"
  assert.equal(resolveSlot(Q, v2, "metrics[0].value").ok, true)
  const v3 = clone(V_QUERY)
  v3.metrics[0].value = { a: 1 } // objeto onde deveria haver número
  assert.deepEqual(resolveSlot(Q, v3, "metrics[0].value"), { ok: false, code: "SLOT_PATH_INVALID" })
  v3.metrics[0].value = [1]
  assert.deepEqual(resolveSlot(Q, v3, "metrics[0].value"), { ok: false, code: "SLOT_PATH_INVALID" })
  const v4 = JSON.parse('{"metrics":[{"__proto__":{"value":9},"metricId":"x"}],"period":{"from":null,"to":null}}') // __proto__ como chave PRÓPRIA (JSON.parse)
  assert.deepEqual(resolveSlot(Q, v4, "metrics[0].value"), { ok: false, code: "SLOT_PATH_INVALID" })
  assert.deepEqual(resolveSlot(Q, v4, "metrics[0].__proto__"), { ok: false, code: "SLOT_PATH_INVALID" })
})

test("P8 — resolveSlot devolve a FOLHA (tipo, valor, unidade) sem formatar; a unidade vem da tabela/irmã e uma unidade irmã inválida ⇒ inválido", () => {
  const r: Any = resolveSlot("metrics.query@1", V_QUERY, "metrics[2].value")
  assert.equal(r.ok, true)
  assert.equal(r.leaf.kind, "number")
  assert.equal(r.leaf.value, 12.5)
  assert.equal(r.leaf.unit, "points")
  const c: Any = resolveSlot("metrics.query@1", V_QUERY, "metrics[0].coverage.ratio")
  assert.equal(c.leaf.unit, "fraction")
  const bad = clone(V_QUERY)
  bad.metrics[0].unit = "EUR"
  assert.deepEqual(resolveSlot("metrics.query@1", bad, "metrics[0].value"), { ok: false, code: "SLOT_PATH_INVALID" })
  assert.equal((resolveSlot("exit.breakdown@1", V_EXIT, "buckets[0].reason") as Any).leaf.kind, "enum")
  assert.equal((resolveSlot("metrics.query@1", V_QUERY, "metrics[1].reason") as Any).leaf.kind, "reason")
})

test("V1 — renderSlot valida a view no schema de PROMPT_VIEWS: campo extra (rowHash), unidade inválida, tipo errado ⇒ VIEW_INVALID e NUNCA o valor", () => {
  const Q = "metrics.query@1"
  const extra = clone(V_QUERY)
  extra.metrics[0].rowHash = "a".repeat(64)
  err(Q, extra, "metrics[0].value", "VIEW_INVALID")
  const unit = clone(V_QUERY)
  unit.metrics[0].unit = "EUR"
  err(Q, unit, "metrics[0].value", "VIEW_INVALID")
  err(Q, { metrics: "x" }, "metrics[0].value", "VIEW_INVALID")
  for (const x of [null, undefined, 5, "x", []]) { assert.doesNotThrow(() => render(Q, x, "metrics[0].value")); err(Q, x, "metrics[0].value", "VIEW_INVALID") }
  err("x@1", V_QUERY, "metrics[0].value", "SLOT_PATH_INVALID")
  const lbl = clone(V_EXPLAIN)
  lbl.trades[0].legs[0].label = "lbl_" + "a".repeat(24) // rótulo bruto na view: o schema da view recusa
  err("evidence.explain@1", lbl, "trades[0].legs[0].label", "VIEW_INVALID")
})

test("V2 — erros de renderSlot são SEMPRE { ok:false, code } e não ecoam path nem valor", () => {
  const MARK = "ZZ_MARCADOR_ZZ"
  const rs = [render("metrics.query@1", V_QUERY, `metrics[0].${MARK}`), render("metrics.query@1", { metrics: MARK }, "metrics[0].value"), render("metrics.query@1", V_QUERY, "metrics[0].reason")]
  for (const r of rs) { assert.equal(r.ok, false); assert.deepEqual(Object.keys(r).sort(), ["code", "ok"]); assert.equal(JSON.stringify(r).includes(MARK), false) }
})

test("L1 — a tabela de folhas cobre cada caso `invalid_extra` e `view_with_extra_field` da expectativa (conferência de que o teste não esqueceu nenhum)", () => {
  assert.equal(exp.e66_1.path_cases_added.invalid_extra.length, 9)
  assert.ok(exp.e66_1.path_cases_added.view_with_extra_field.includes("VIEW_INVALID"))
  assert.equal(exp.e66_1.path_cases_added.ok_with_values.length, 6)
  // os 6 ok_with_values
  ok("metrics.query@1", V_QUERY, "metrics[0].value", "US$ 1.234,56")
  ok("metrics.query@1", V_QUERY, "metrics[0].coverage.ratio", "100,00%")
  ok("exit.breakdown@1", V_EXIT, "buckets[0].reason", "alvo")
  err("metrics.query@1", V_QUERY, "metrics[0].reason", "FORMAT_INVALID")
  ok("rank.groups@1", V_RANK, "rows[0].value.value", "US$ 80,00")
  ok("exit.analysis@1", V_ANALYSIS, "comparison.deltas[0].delta", "-US$ 50,00")
})

console.log(`\n${passed} testes ok`)
