// E6.6-V (PD-2): as PromptViews carregam o MOTIVO ao lado de toda folha numérica anulável (exit.breakdown, metrics.compare, rank.groups, exit.analysis).
// Testes escritos ANTES da mudança em views.ts/slot-path.ts. Expectativa: scripts/expectations/agent-answer.expected.json → e66_V (W1–W11).
//   node scripts/test-agent-views-reason.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderSlot, resolveSlot, LEAF_TABLE } from "../src/lib/agent/slot-path.ts"
import { PROMPT_VIEWS } from "../src/lib/agent/views.ts"
import { calculateMetrics, compareGroups, exitReasonAnalysis, rankGroups, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
import { mk, NY } from "./_metrics-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const cov = { used: 3, total: 3, ratio: 1 }
const bucket = (o: Any = {}): Any => ({ reason: "TARGET", unit: "TRADE", count: 3, pnlNet: 150, pnlNetReason: null, share: 0.25, shareReason: null, coverage: cov, ...o })
const delta = (o: Any = {}): Any => ({ metricId: "netPnl", unit: "usd", a: 100, aReason: null, b: 150, bReason: null, delta: 50, ratio: 1.5, reason: null, ...o })
const compare = (deltas: Any[]): Any => ({ a: { key: ["Conta A"], sampleSize: 4 }, b: { key: ["Conta B"], sampleSize: 6 }, deltas, conclusive: false })
const mv = (): Any => ({ metricId: "netPnl", value: 80, unit: "usd", basis: "NET", sampleSize: 4, coverage: cov, reason: null })
const row = (o: Any = {}): Any => ({ rank: 1, key: ["Conta A"], value: mv(), sampleFlag: "OK", tiedWithPrevious: false, contribution: 0.2556, contributionReason: null, ...o })
const render = (id: string, view: Any, path: string): Any => renderSlot(id as never, view, path)
const ok = (id: string, view: Any, path: string, text: string): void => assert.deepEqual(render(id, view, path), { ok: true, text }, `${id} ${path}`)
const err = (id: string, view: Any, path: string, code: string): void => assert.deepEqual(render(id, view, path), { ok: false, code }, `${id} ${path}`)
const EB = "exit.breakdown@1"

test("W1 — exit.breakdown: pnlNet/share null com motivo ⇒ 'indisponível (…)'; slot do motivo = texto cru; motivo null ⇒ FORMAT_INVALID", () => {
  const v: Any = { buckets: [bucket(), bucket({ reason: "STOP", pnlNet: null, pnlNetReason: "NO_NET_PNL", share: null, shareReason: "DENOMINATOR_ZERO" })], reconciliation: "RECONCILED" }
  ok(EB, v, "buckets[1].pnlNet", "indisponível (não há resultado líquido nos trades)")
  ok(EB, v, "buckets[1].share", "indisponível (o denominador é zero)")
  ok(EB, v, "buckets[1].pnlNetReason", "não há resultado líquido nos trades")
  ok(EB, v, "buckets[1].shareReason", "o denominador é zero")
  err(EB, v, "buckets[0].shareReason", "FORMAT_INVALID")
  err(EB, v, "buckets[0].pnlNetReason", "FORMAT_INVALID")
  ok(EB, v, "buckets[0].pnlNet", "US$ 150,00")
  ok(EB, v, "buckets[0].share", "25,00%")
})

test("W2 — motivo COM valor não-null (aviso de cobertura parcial): o slot de valor mostra o NÚMERO; o aviso é citável pelo slot do motivo", () => {
  const v: Any = { buckets: [bucket({ shareReason: "DENOMINATOR_PARTIAL_COVERAGE" })], reconciliation: "RECONCILED" }
  ok(EB, v, "buckets[0].share", "25,00%")
  ok(EB, v, "buckets[0].shareReason", "o denominador tem cobertura parcial")
})

test("W3/W4/W6 — metrics.compare e exit.analysis: a/b com o motivo do lado, delta e ratio com o motivo da comparação (UNAVAILABLE_*, RATIO_*)", () => {
  const C = "metrics.compare@1"
  const v = compare([delta({ a: null, aReason: "NO_TRADES", delta: null, ratio: null, reason: "UNAVAILABLE_A" }), delta({ a: 0, b: 5, delta: 5, ratio: null, reason: "RATIO_A_ZERO" }), delta()])
  ok(C, v, "deltas[0].a", "indisponível (não há trades)")
  ok(C, v, "deltas[0].b", "US$ 150,00")
  ok(C, v, "deltas[0].delta", "indisponível (o valor não está disponível no lado A da comparação)")
  ok(C, v, "deltas[0].ratio", "indisponível (o valor não está disponível no lado A da comparação)")
  ok(C, v, "deltas[0].aReason", "não há trades")
  ok(C, v, "deltas[0].reason", "o valor não está disponível no lado A da comparação")
  ok(C, v, "deltas[1].delta", "US$ 5,00")
  ok(C, v, "deltas[1].ratio", "indisponível (o valor de A é zero e a razão não se aplica)")
  ok(C, v, "deltas[1].reason", "o valor de A é zero e a razão não se aplica")
  err(C, v, "deltas[2].reason", "FORMAT_INVALID")
  ok(C, v, "deltas[2].ratio", "1,5000")
  const both = compare([delta({ a: null, aReason: "NO_TRADES", b: null, bReason: "NO_TRADES", delta: null, ratio: null, reason: "UNAVAILABLE_BOTH" })])
  ok("exit.analysis@1", { buckets: [bucket()], comparison: both }, "comparison.deltas[0].delta", "indisponível (o valor não está disponível em nenhum dos dois lados da comparação)")
  ok("exit.analysis@1", { buckets: [bucket({ pnlNet: null, pnlNetReason: "NO_LEGS" })], comparison: null }, "buckets[0].pnlNet", "indisponível (não há ordens registradas)")
  err("exit.analysis@1", { buckets: [bucket()], comparison: null }, "comparison.deltas[0].delta", "SLOT_PATH_INVALID")
})

test("W5 — rank.groups: contribution null com motivo ⇒ 'indisponível (…)'; motivo citável", () => {
  const R = "rank.groups@1"
  const v: Any = { rows: [row({ contribution: null, contributionReason: "NUMERATOR_UNAVAILABLE" }), row()], orderedBy: "netPnl" }
  ok(R, v, "rows[0].contribution", "indisponível (o numerador não está disponível)")
  ok(R, v, "rows[0].contributionReason", "o numerador não está disponível")
  ok(R, v, "rows[1].contribution", "25,56%")
  err(R, v, "rows[1].contributionReason", "FORMAT_INVALID")
})

test("W7 — motivo FORA do catálogo ou null com valor null ⇒ FORMAT_INVALID (nunca texto de reserva, nunca zero, nunca em branco)", () => {
  const v: Any = { buckets: [bucket({ share: null, shareReason: "NOT_A_CODE" }), bucket({ share: null, shareReason: null }), bucket({ share: null, shareReason: "" })], reconciliation: "RECONCILED" }
  for (const i of [0, 1, 2]) err(EB, v, `buckets[${i}].share`, "FORMAT_INVALID")
  err(EB, v, "buckets[0].shareReason", "FORMAT_INVALID")
  for (const bad of ["__proto__", "constructor", "denominator_zero"]) err(EB, { buckets: [bucket({ share: null, shareReason: bad })], reconciliation: "RECONCILED" }, "buckets[0].share", "FORMAT_INVALID")
})

test("W8 — formato ANTIGO (sem os campos de motivo) ⇒ VIEW_INVALID em exit.breakdown, metrics.compare, rank.groups e exit.analysis; campo T0 extra continua VIEW_INVALID", () => {
  const oldB = (): Any => { const b = bucket(); delete b.pnlNetReason; delete b.shareReason; return b }
  err(EB, { buckets: [oldB()], reconciliation: "RECONCILED" }, "buckets[0].count", "VIEW_INVALID")
  err("exit.analysis@1", { buckets: [oldB()], comparison: null }, "buckets[0].count", "VIEW_INVALID")
  for (const k of ["aReason", "bReason", "reason"]) { const d = delta(); delete d[k]; err("metrics.compare@1", compare([d]), "deltas[0].a", "VIEW_INVALID") }
  const r = row(); delete r.contributionReason
  err("rank.groups@1", { rows: [r], orderedBy: "x" }, "rows[0].rank", "VIEW_INVALID")
  for (const k of ["pnlNetReason", "shareReason"]) { const b = bucket(); delete b[k]; err(EB, { buckets: [b], reconciliation: "RECONCILED" }, "buckets[0].count", "VIEW_INVALID") }
  err(EB, { buckets: [{ ...bucket(), rowHash: "a" }], reconciliation: "RECONCILED" }, "buckets[0].count", "VIEW_INVALID")
  err(EB, { buckets: [bucket({ pnlNetReason: 5 })], reconciliation: "RECONCILED" }, "buckets[0].count", "VIEW_INVALID")
  assert.equal(PROMPT_VIEWS[EB].safeParse({ buckets: [bucket()], reconciliation: "RECONCILED" }).success, true)
})

test("W9 — resolveSlot: irmão-motivo com tipo errado (número) ou HERDADO ⇒ SLOT_PATH_INVALID", () => {
  const v: Any = { buckets: [bucket({ share: null, shareReason: 5 })], reconciliation: "RECONCILED" }
  assert.deepEqual(resolveSlot(EB, v, "buckets[0].share"), { ok: false, code: "SLOT_PATH_INVALID" })
  const inherited: Any = { buckets: [Object.assign(Object.create({ shareReason: "DENOMINATOR_ZERO" }), { reason: "TARGET", unit: "TRADE", count: 1, pnlNet: null, share: null, coverage: cov })], reconciliation: "RECONCILED" }
  assert.deepEqual(resolveSlot(EB, inherited, "buckets[0].share"), { ok: false, code: "SLOT_PATH_INVALID" })
  const r: Any = resolveSlot(EB, { buckets: [bucket({ share: null, shareReason: "DENOMINATOR_ZERO" })], reconciliation: "RECONCILED" }, "buckets[0].share")
  assert.equal(r.ok, true)
  assert.equal(r.leaf.reason, "DENOMINATOR_ZERO")
})

// ── W10: o motor SEMPRE dá motivo quando o valor é null (a premissa em que a view se apoia) ──
const D = [
  { id: "a1", account: "ACC-A", dir: "LONG" as const, entry: 21000, exit: 21010, at: "2026-01-05 09:35:00", stop: 20990 },
  { id: "a2", account: "ACC-A", dir: "SHORT" as const, entry: 21000, exit: 21006, at: "2026-01-06 09:40:00" },
  { id: "b1", account: "ACC-B", dir: "LONG" as const, entry: 21000, exit: 21003, at: "2026-01-12 09:55:00", stop: 20990 },
  { id: "b2", account: "ACC-B", dir: "LONG" as const, entry: 21000, exit: 20990, at: "2026-01-13 09:58:00" },
  { id: "n1", account: null, dir: "LONG" as const, entry: 21000, exit: 21001, at: "2026-01-14 10:05:00" },
]
const trades: AnalyticsTrade[] = D.map((d) => mk({ id: d.id, direction: d.dir, entry: d.entry, exit: d.exit, entryAt: d.at, exitAt: d.at.replace(/:00$/, ":30"), tz: NY, account: d.account, stop: d.stop ?? null }))
const scan = (o: unknown, where: string, hits: { nulls: number; withReason: number }): void => {
  if (Array.isArray(o)) { o.forEach((x, i) => scan(x, `${where}[${i}]`, hits)); return }
  if (typeof o !== "object" || o === null) return
  const r = o as Any
  if ("value" in r && "reason" in r && (r.value === null || typeof r.value === "number")) { // Cell ou Fraction
    if (r.value === null) { hits.nulls += 1; assert.equal(typeof r.reason, "string", `${where}: value null sem reason`); assert.ok(r.reason.length > 0, where); hits.withReason += 1 }
  }
  if ("delta" in r && "ratio" in r && "reason" in r) { // MetricComparison
    if (r.delta === null) { hits.nulls += 1; assert.equal(typeof r.reason, "string", `${where}: delta null sem reason`) }
    else if (r.ratio === null) { hits.nulls += 1; assert.equal(typeof r.reason, "string", `${where}: ratio null sem reason`) }
  }
  for (const [k, v] of Object.entries(r)) scan(v, `${where}.${k}`, hits)
}
test("W10 — INVARIANTE DO MOTOR: em rankGroups, compareGroups e exitReasonAnalysis (população normal, com grupo desconhecido, filtro vazio e população vazia) todo value null tem reason string; todo delta/ratio null tem reason (LIMITAÇÃO: só estes cenários)", () => {
  const hits = { nulls: 0, withReason: 0 }
  const O = { timeZone: NY, minSample: 2, redact: false } // nomes crus SÓ no teste local (para casar `where`); nunca na view do agente
  for (const pop of [trades, [] as AnalyticsTrade[], trades.slice(0, 1)]) {
    scan(rankGroups(pop, { groupBy: "account", ...O }), "rank", hits)
    scan(rankGroups(pop, { groupBy: "account", metric: "profitFactor", ...O }), "rankPF", hits)
    scan(exitReasonAnalysis(pop, O), "exit", hits)
    scan(calculateMetrics(pop, O), "metrics", hits)
  }
  scan(compareGroups(trades, { groupBy: "account", a: { account: "ACC-A" }, b: { account: "ACC-B" }, metrics: ["netPnl", "profitFactor", "winRate"], ...O }), "cmpGroups", hits)
  scan(compareGroups(trades, { groupBy: "account", a: { account: "ACC-A" }, b: { account: "NAO-EXISTE" }, metrics: ["netPnl", "profitFactor"], ...O }), "cmpMissing", hits)
  scan(compareGroups([] as AnalyticsTrade[], { groupBy: "account", a: { account: "ACC-A" }, b: { account: "ACC-B" }, ...O }), "cmpEmpty", hits)
  assert.ok(hits.nulls >= 10, `os cenários só exercitaram ${hits.nulls} valores null (a varredura precisa de nulls de verdade)`)
})

// ── W11: guarda de COMPLETUDE ─────────────────────────────────────────────
function nullableNumberLeaves(schema: Any, path: string, out: string[]): void {
  const def = schema._zod.def
  if (def.type === "object") for (const [k, v] of Object.entries(def.shape as Record<string, Any>)) nullableNumberLeaves(v, path ? `${path}.${k}` : k, out)
  else if (def.type === "array") nullableNumberLeaves(def.element, `${path}[]`, out)
  else if (def.type === "nullable") {
    if (def.innerType._zod.def.type === "number") out.push(path)
    else nullableNumberLeaves(def.innerType, path, out)
  }
}
test("W11 — COMPLETUDE: toda folha `number | null` das views de métrica (exceto evidence.explain, PD-3) está na tabela COM `reasonField`; achar uma sem motivo derruba o teste", () => {
  let found = 0
  for (const id of Object.keys(PROMPT_VIEWS)) {
    if (id === "evidence.explain@1") continue
    const leaves: string[] = []
    nullableNumberLeaves(PROMPT_VIEWS[id as keyof typeof PROMPT_VIEWS], "", leaves)
    for (const p of leaves) {
      const table: Any = LEAF_TABLE[id as keyof typeof LEAF_TABLE]
      // exit.analysis aninha `comparison` (CompareView anulável): o prefixo vira `comparison.`
      assert.ok(Object.hasOwn(table, p), `${id}: folha anulável ${p} fora da tabela`)
      assert.equal(typeof table[p].reasonField, "string", `${id}: folha anulável ${p} SEM reasonField`)
      found += 1
    }
  }
  assert.ok(found >= 12, `a varredura achou só ${found} folhas anuláveis (travessia do zod quebrada?)`)
  assert.equal(exp.e66_V.cases.length, 11)
})

console.log(`\n${passed} testes ok`)
