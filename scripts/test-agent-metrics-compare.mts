// E6.6-8: capacidade `metrics.compare@1` (comparação de dois grupos OU de dois períodos). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_8 (D8-1…D8-6, K1–K12, mutações, fixtures CY e CZ).
//   node scripts/test-agent-metrics-compare.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { REASON_TEXTS, formatNumber, formatUnavailable, type DisplayUnit } from "../src/lib/agent/format.ts"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { renderSlot } from "../src/lib/agent/slot-path.ts"
import { renderAnswer } from "../src/lib/agent/render.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { projectCompare } from "../src/lib/agent-capabilities/project.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { METRIC_IDS, compareGroups, comparePeriods, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
const E8: Any = exp.e66_8
const enc = (s: string) => new TextEncoder().encode(s)
const BRT = "America/Sao_Paulo"
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`

// ── CY (a do E6.6-7: 6 trades, minSample 4) ─────────────────────────────────
const AN = { timeZone: BRT, minSample: 4 } as const
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const CSV_Y = synthCsv(CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any))))
const impY = runImportPipeline(CSV_Y, { sourceTz: BRT, fileName: "segredo-comparacao-y.csv" })
const recY = impY.importRecord as ImportRecord
const TY = toAnalyticsTrades(withRisk(impY.trades))

// ── CZ (24 trades, 12 dias úteis × 09:00 e 14:00; ASSIMÉTRICA: A ≠ B; minSample 10) ──
const ANZ = { timeZone: BRT, minSample: 10 } as const
const DAYS = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17]
const CZ = DAYS.flatMap((day, i) => [9, 14].map((hour, j) => ({ account: "Sim101", hour, day, exit: (j === 0 ? i % 3 === 0 : i % 2 === 0) ? 1996 : 2004 })))
const CSV_Z = synthCsv(CZ.map((c): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: c.exit, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, 10)}`, exitLabel: c.exit === 2004 ? "Target1" : "Stop1" } as Any)))
const impZ = runImportPipeline(CSV_Z, { sourceTz: BRT, fileName: "segredo-comparacao-z.csv" })
const recZ = impZ.importRecord as ImportRecord
const TZ = toAnalyticsTrades(withRisk(impZ.trades))
const FILES_Z = { [recZ.importId]: enc(CSV_Z) }

const ctxY = (o: Any = {}): Any => ({ trades: TY, importRecords: [recY], refEpoch: "s1", analysis: AN, ...o })
const ctxZ = (o: Any = {}): Any => ({ trades: TZ, importRecords: [recZ], refEpoch: "s1", analysis: ANZ, ...o })
const run = (args: unknown, c: Any): Any => metricsCompare(args, c)
const call = (args: unknown, c: Any): Any => run(args, c).result
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 400)}`); return r }
const ERR = (code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability: "metrics.compare@1", ok: false, data: null, evidence: null, limits: [], error: { code } })
const ARGS = ERR("ARGS_INVALID"), REFUSED = ERR("ENGINE_REFUSED")

const G = (groupBy: string[], a: Any, b: Any, metricIds: string[], extra: Any = {}): Any => ({ mode: "GROUP", groupBy, a, b, metricIds, ...extra })
const P = (a: Any, b: Any, metricIds: string[], extra: Any = {}): Any => ({ mode: "PERIOD", a, b, metricIds, ...extra })
const M5 = ["totalTrades", "netPnl", "winRate", "profitFactor", "averageTrade"]
const M4 = ["totalTrades", "netPnl", "winRate", "profitFactor"]

// ── oráculo: o mapeamento esperado, escrito aqui a partir do resultado DIRETO do motor ──
const directG = (T: Any, an: Any, groupBy: string[], a: Any, b: Any, metrics: string[], filters: Any = {}, opts: Any = {}): Any => compareGroups(T, { groupBy, a, b, metrics, filters, ...an, ...opts } as Any)
const directP = (T: Any, an: Any, a: Any, b: Any, metrics: string[], filters: Any = {}, opts: Any = {}): Any => comparePeriods(T, { a, b, metrics, filters, ...an, ...opts } as Any)
const expDeltas = (c: Any): Any[] => c.metrics.map((m: Any) => ({ metricId: m.metric, unit: m.unit, a: m.a.value, aReason: m.a.reason, b: m.b.value, bReason: m.b.reason, delta: m.delta, ratio: m.ratio, reason: m.reason }))
const expConclusive = (c: Any): boolean => c.metrics.length > 0 && c.metrics.every((m: Any) => m.conclusive) && c.confidence === "OK"
const txt = (value: number | null, unit: DisplayUnit, reason: string | null): string => {
  if (value === null) { const u = formatUnavailable(reason) as Any; assert.equal(u.ok, true, `motivo fora do catálogo: ${reason}`); return u.text }
  const r = formatNumber(value, unit) as Any
  assert.equal(r.ok, true, `formatador recusou ${value} (${unit})`)
  return r.text
}
const slot = (data: Any, path: string): Any => renderSlot("metrics.compare@1", data, path)
/** Para cada delta i: o texto esperado dos 4 slots (a, b, delta, ratio) — o formatador sobre o valor DIRETO. */
const checkSlots = (data: Any, c: Any): void => {
  c.metrics.forEach((m: Any, i: number) => {
    assert.deepEqual(slot(data, `deltas[${i}].a`), { ok: true, text: txt(m.a.value, m.unit, m.a.reason) }, `deltas[${i}].a`)
    assert.deepEqual(slot(data, `deltas[${i}].b`), { ok: true, text: txt(m.b.value, m.unit, m.b.reason) }, `deltas[${i}].b`)
    assert.deepEqual(slot(data, `deltas[${i}].delta`), { ok: true, text: txt(m.delta, m.unit, m.reason) }, `deltas[${i}].delta`)
    assert.deepEqual(slot(data, `deltas[${i}].ratio`), { ok: true, text: txt(m.ratio, "ratio", m.reason) }, `deltas[${i}].ratio`)
  })
}

test("K1 — ORÁCULO GROUP (CZ, hora 09 vs 14, 5 métricas): sampleSize, cada delta e `conclusive` == compareGroups DIRETO; literais da CZ escritos à mão; texto de cada slot (a, b, delta, ratio e seus motivos) == formatador sobre o valor direto", () => {
  const c = directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, M5)
  const r = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ()))
  assert.deepEqual(r.data.a, { key: ["09:00"], sampleSize: c.a.sampleSize })
  assert.deepEqual(r.data.b, { key: ["14:00"], sampleSize: c.b.sampleSize })
  assert.deepEqual(r.data.deltas, expDeltas(c))
  assert.equal(r.data.conclusive, expConclusive(c))
  assert.deepEqual(Object.keys(r.data).sort(), ["a", "b", "conclusive", "deltas"])
  // literais medidos em 15/10 (CZ_literais_medidos_em_15_10), escritos à mão
  assert.deepEqual([r.data.a.sampleSize, r.data.b.sampleSize], [12, 12])
  const lit = r.data.deltas.map((d: Any) => [d.metricId, d.a, d.b, d.delta, d.ratio, d.reason])
  assert.deepEqual(lit, [["totalTrades", 12, 12, 0, 1, null], ["netPnl", 131.2, -28.8, -160, null, "RATIO_SIGN_DIFFERS"], ["winRate", 66.67, 50, -16.67, 0.75, null], ["profitFactor", 1.7736, 0.8868, -0.8868, 0.5, null], ["averageTrade", 10.93, -2.4, -13.33, null, "RATIO_SIGN_DIFFERS"]])
  assert.equal(r.data.conclusive, true)
  checkSlots(r.data, c)
  assert.deepEqual(slot(r.data, "a.sampleSize"), { ok: true, text: "12" })
  assert.deepEqual(slot(r.data, "b.sampleSize"), { ok: true, text: "12" })
  assert.deepEqual(slot(r.data, "a.key[0]"), { ok: true, text: "09:00" })
  assert.deepEqual(slot(r.data, "deltas[1].ratio"), { ok: true, text: "indisponível (os valores têm sinais opostos e a razão não se aplica)" })
  // A e B não são intercambiáveis (a CZ é assimétrica de propósito)
  const sw = okOf(call(G(["hour"], { hour: 14 }, { hour: 9 }, M5), ctxZ()))
  assert.notDeepEqual(sw.data.deltas, r.data.deltas)
  assert.deepEqual(sw.data.a.key, ["14:00"])
  assert.equal(sw.data.deltas[1].delta, 160)
})

test("K2 — ORÁCULO PERIOD (CZ, 02–06/03 vs 09–13/03): view == comparePeriods DIRETO; a.key e b.key = 'DD/MM/AAAA a DD/MM/AAAA'; slots", () => {
  const a = { from: "2026-03-02", to: "2026-03-06" }, b = { from: "2026-03-09", to: "2026-03-13" }
  const c = directP(TZ, ANZ, a, b, M5)
  const r = okOf(call(P(a, b, M5), ctxZ()))
  assert.deepEqual(r.data.a, { key: ["02/03/2026 a 06/03/2026"], sampleSize: c.a.sampleSize })
  assert.deepEqual(r.data.b, { key: ["09/03/2026 a 13/03/2026"], sampleSize: c.b.sampleSize })
  assert.deepEqual([c.a.sampleSize, c.b.sampleSize], [10, 10])
  assert.deepEqual(r.data.deltas, expDeltas(c))
  assert.equal(r.data.conclusive, expConclusive(c))
  checkSlots(r.data, c)
  assert.deepEqual(slot(r.data, "a.key[0]"), { ok: true, text: "02/03/2026 a 06/03/2026" })
  assert.equal(r.evidence.scope, "TOTAL")
})

test("K3 — DIMENSÕES: as 9 permitidas funcionam (chave pelo groupKeyPart, tamanhos == direto); 2 dimensões; coerção (9 ⇒ '09'); fora da lista, week que não é segunda e exitReason UNKNOWN ⇒ ARGS_INVALID", () => {
  const cases: Array<[string, Any, Any, string[], string[], Any, Any]> = [
    ["day", { day: "2026-03-02" }, { day: "2026-03-03" }, ["02/03/2026"], ["03/03/2026"], { day: "2026-03-02" }, { day: "2026-03-03" }],
    ["tradingDay", { tradingDay: "2026-03-02" }, { tradingDay: "2026-03-03" }, ["02/03/2026"], ["03/03/2026"], { tradingDay: "2026-03-02" }, { tradingDay: "2026-03-03" }],
    ["week", { week: "2026-03-02" }, { week: "2026-03-09" }, ["semana de 02/03/2026"], ["semana de 09/03/2026"], { week: "2026-03-02" }, { week: "2026-03-09" }],
    ["month", { month: "2026-03" }, { month: "2026-04" }, ["03/2026"], ["04/2026"], { month: "2026-03" }, { month: "2026-04" }],
    ["dayOfWeek", { dayOfWeek: 1 }, { dayOfWeek: 2 }, ["Seg"], ["Ter"], { dayOfWeek: "1" }, { dayOfWeek: "2" }],
    ["hour", { hour: 9 }, { hour: 14 }, ["09:00"], ["14:00"], { hour: "09" }, { hour: "14" }],
    ["symbol", { symbol: "MGC" }, { symbol: "MNQ" }, ["MGC"], ["MNQ"], { symbol: "MGC" }, { symbol: "MNQ" }],
    ["direction", { direction: "LONG" }, { direction: "SHORT" }, ["compra"], ["venda"], { direction: "LONG" }, { direction: "SHORT" }],
    ["exitReason", { exitReason: "TARGET" }, { exitReason: "STOP" }, ["alvo"], ["stop"], { exitReason: "TARGET" }, { exitReason: "STOP" }],
  ]
  assert.equal(cases.length, 9)
  for (const [dim, a, b, ka, kb, da, db] of cases) {
    const c = directG(TZ, ANZ, [dim], da, db, ["totalTrades", "netPnl"])
    const r = okOf(call(G([dim], a, b, ["totalTrades", "netPnl"]), ctxZ()))
    assert.deepEqual(r.data.a, { key: ka, sampleSize: c.a.sampleSize }, `${dim} a`)
    assert.deepEqual(r.data.b, { key: kb, sampleSize: c.b.sampleSize }, `${dim} b`)
    assert.deepEqual(r.data.deltas, expDeltas(c), `${dim} deltas`)
  }
  // 2 dimensões, literais da CY (week e dayOfWeek+hour medidos na CY)
  const y2 = okOf(call(G(["dayOfWeek", "hour"], { dayOfWeek: 1, hour: 9 }, { dayOfWeek: 2, hour: 9 }, ["totalTrades"]), ctxY()))
  assert.deepEqual(y2.data.a, { key: ["Seg", "09:00"], sampleSize: 1 })
  assert.deepEqual(y2.data.b, { key: ["Ter", "09:00"], sampleSize: 1 })
  const yw = okOf(call(G(["week"], { week: "2026-03-02" }, { week: "2026-03-09" }, ["totalTrades"]), ctxY()))
  assert.deepEqual([yw.data.a.sampleSize, yw.data.b.sampleSize], [4, 2])
  // fora da lista / formato
  const base = (g: string, a: Any, b: Any) => G([g], a, b, ["totalTrades"])
  for (const bad of [base("account", { account: "Conta A" }, { account: "Conta B" }), base("strategy", { strategy: "Estratégia A" }, { strategy: "Estratégia B" }), base("session", { session: "AM" }, { session: "PM" }), base("setup", { setup: "x" }, { setup: "y" }), base("timeframe", { timeframe: "M5" }, { timeframe: "M15" }), base("strategyVersion", { strategyVersion: "1" }, { strategyVersion: "2" }),
    base("week", { week: "2026-03-03" }, { week: "2026-03-09" }), base("exitReason", { exitReason: "UNKNOWN" }, { exitReason: "STOP" })]) assert.deepEqual(call(bad, ctxZ()), ARGS, JSON.stringify(bad))
})

test("K4 — LADO AUSENTE (CY, direction LONG vs SHORT): resposta OK, b.sampleSize 0, bReason GROUP_NOT_FOUND, delta/ratio null com UNAVAILABLE_B, conclusive false; slots 'indisponível (…)'", () => {
  const c = directG(TY, AN, ["direction"], { direction: "LONG" }, { direction: "SHORT" }, M4)
  const r = okOf(call(G(["direction"], { direction: "LONG" }, { direction: "SHORT" }, M4), ctxY()))
  assert.deepEqual(r.data.a, { key: ["compra"], sampleSize: 6 })
  assert.deepEqual(r.data.b, { key: ["venda"], sampleSize: 0 })
  for (const d of r.data.deltas) { assert.equal(d.b, null); assert.equal(d.bReason, "GROUP_NOT_FOUND"); assert.equal(d.delta, null); assert.equal(d.ratio, null); assert.equal(d.reason, "UNAVAILABLE_B") }
  assert.deepEqual(r.data.deltas, expDeltas(c))
  assert.equal(r.data.conclusive, false)
  assert.deepEqual(slot(r.data, "deltas[0].b"), { ok: true, text: "indisponível (o grupo não existe nos dados)" })
  assert.deepEqual(slot(r.data, "deltas[0].delta"), { ok: true, text: "indisponível (o valor não está disponível no lado B da comparação)" })
  assert.deepEqual(slot(r.data, "b.sampleSize"), { ok: true, text: "0" })
  checkSlots(r.data, c)
})

test("K5 — MOTIVOS DE DELTA/RATIO: RATIO_SIGN_DIFFERS (CZ), UNAVAILABLE_B + NO_LOSERS (CY profitFactor), UNAVAILABLE_BOTH (CZ com exitReason TARGET), RATIO_A_ZERO (CZ com exitReason STOP, winRate); cada um renderiza o texto do catálogo no slot certo; delta não-null com ratio null mostra o número", () => {
  const z = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, ["netPnl"]), ctxZ()))
  assert.equal(z.data.deltas[0].reason, "RATIO_SIGN_DIFFERS")
  assert.deepEqual(slot(z.data, "deltas[0].delta"), { ok: true, text: txt(-160, "usd", null) }, "delta não-null mostra o NÚMERO")
  assert.deepEqual(slot(z.data, "deltas[0].ratio"), { ok: true, text: "indisponível (os valores têm sinais opostos e a razão não se aplica)" })
  const y = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, ["profitFactor"]), ctxY()))
  assert.equal(y.data.deltas[0].reason, "UNAVAILABLE_B")
  assert.equal(y.data.deltas[0].bReason, "NO_LOSERS")
  assert.deepEqual(slot(y.data, "deltas[0].b"), { ok: true, text: "indisponível (não há trade perdedor)" })
  assert.deepEqual(slot(y.data, "deltas[0].delta"), { ok: true, text: "indisponível (o valor não está disponível no lado B da comparação)" })
  const t = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades", "profitFactor"], { filters: { exitReason: "TARGET" } }), ctxZ()))
  assert.equal(t.data.deltas[1].reason, "UNAVAILABLE_BOTH")
  assert.deepEqual(slot(t.data, "deltas[1].delta"), { ok: true, text: "indisponível (o valor não está disponível em nenhum dos dois lados da comparação)" })
  const s = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, ["winRate"], { filters: { exitReason: "STOP" } }), ctxZ()))
  assert.equal(s.data.deltas[0].reason, "RATIO_A_ZERO")
  assert.deepEqual(slot(s.data, "deltas[0].ratio"), { ok: true, text: "indisponível (o valor de A é zero e a razão não se aplica)" })
  for (const [r, c] of [[z, directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, ["netPnl"])], [y, directG(TY, AN, ["hour"], { hour: "09" }, { hour: "14" }, ["profitFactor"])], [s, directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, ["winRate"], { exitReason: "STOP" })]] as Any[]) checkSlots(r.data, c)
})

test("K6 — HANDLE E VEREDITO: DERIVED; scope GROUP (GROUP) / TOTAL (PERIOD); declared = afterFilters; sampleFlag = PIOR lado; confidence do summary; conclusive (CZ true; CY false; CZ averageR/totalR false) == handle.population.conclusive; sem arquivo NOT_VERIFIED; com arquivo VERIFIED; adulterado TAMPERED_OR_MISMATCH", () => {
  const y = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M4), ctxY()))
  assert.equal(y.evidence.subject.type, "DERIVED")
  assert.equal(y.evidence.scope, "GROUP")
  assert.equal(y.evidence.population.declared, 6)
  assert.equal(y.evidence.population.sampleFlag, "TINY", "A=LOW, B=TINY ⇒ o PIOR")
  assert.equal(y.evidence.population.confidence, "UNRELIABLE")
  assert.equal(y.data.conclusive, false)
  assert.equal(y.evidence.population.conclusive, false)
  assert.equal(y.evidence.verdict.verify.status, "VALID")
  assert.equal(y.evidence.verdict.combined, "NOT_VERIFIED")
  assert.deepEqual(y.limits.map((l: Any) => l.code), ["VERIFICATION_INFRA_MISSING"])
  const z = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ()))
  assert.equal(z.evidence.population.declared, 24)
  assert.equal(z.evidence.population.sampleFlag, "OK")
  assert.equal(z.evidence.population.confidence, "OK")
  assert.equal(z.data.conclusive, true)
  assert.equal(z.evidence.population.conclusive, true)
  const rr = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, ["averageR", "totalR"]), ctxZ()))
  assert.equal(rr.evidence.population.confidence, "LIMITED")
  assert.equal(rr.data.conclusive, false)
  assert.equal(rr.evidence.population.conclusive, false)
  const p = okOf(call(P({ from: "2026-03-02", to: "2026-03-06" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades", "netPnl"]), ctxZ()))
  assert.equal(p.evidence.scope, "TOTAL")
  assert.equal(p.evidence.subject.type, "DERIVED")
  assert.equal(p.evidence.population.sampleFlag, "OK")
  const good = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ({ source: { files: FILES_Z } })))
  assert.equal(good.evidence.verdict.combined, "VERIFIED")
  assert.deepEqual(good.limits, [])
  const goodP = okOf(call(P({ from: "2026-03-02", to: "2026-03-06" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades"]), ctxZ({ source: { files: FILES_Z } })))
  assert.equal(goodP.evidence.verdict.combined, "VERIFIED")
  const bad = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ({ source: { files: { [recZ.importId]: enc(CSV_Z.replace("2004", "2005")) } } })))
  assert.equal(bad.evidence.verdict.combined, "TAMPERED_OR_MISMATCH")
})

test("K7 — FILTROS E BASE: filters (direction, symbol, exitReason, from/to) e options.pnlBasis chegam ao motor (== direto com os mesmos filtros); GROSS ≠ NET; from > to ⇒ ARGS_INVALID", () => {
  const f = { direction: "LONG", symbol: "MGC", from: "2026-03-03", to: "2026-03-16" }
  const c = directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, M5, f)
  const r = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5, { filters: f }), ctxZ()))
  assert.deepEqual(r.data.deltas, expDeltas(c))
  assert.deepEqual([r.data.a.sampleSize, r.data.b.sampleSize], [c.a.sampleSize, c.b.sampleSize])
  assert.notEqual(r.data.a.sampleSize, 12, "o filtro de datas precisa mudar a amostra nesta fixture")
  const net = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ()))
  const gross = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5, { options: { pnlBasis: "GROSS" } }), ctxZ()))
  assert.deepEqual(gross.data.deltas, expDeltas(directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, M5, {}, { pnlBasis: "GROSS" })))
  assert.notDeepEqual(gross.data.deltas, net.data.deltas, "a base do P&L precisa mudar o resultado nesta fixture")
  assert.notEqual(gross.evidence.evidenceRef, net.evidence.evidenceRef)
  assert.deepEqual(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5, { filters: { from: "2026-03-10", to: "2026-03-02" } }), ctxZ()), ARGS)
  const px = okOf(call(P({ from: "2026-03-02", to: "2026-03-06" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades"], { filters: { direction: "LONG" } }), ctxZ()))
  assert.deepEqual(px.data.deltas, expDeltas(directP(TZ, ANZ, { from: "2026-03-02", to: "2026-03-06" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades"], { direction: "LONG" })))
})

test("K8 — PRIVACIDADE: o envelope serializado NÃO contém nome de conta, nome de arquivo, importId, hashes (tradeSetHash, evidenceHash), refs acc_/str_, period cru, nem chave T0; a view só tem a lista branca; a projeção ignora campos extras do motor", () => {
  const c = directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, M5)
  const leaks = ["Sim101", "Sim102", "segredo-comparacao", recZ.importId, "tradeSetHash", "evidenceHash", "rowHash", "rowNo", "fileSha256", "saltId", "userId", "acc_", "str_", "label", c.a.tradeSetHash, c.b.tradeSetHash, ...TZ.slice(0, 3).map((t) => t.id)]
  const r = okOf(call(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ()))
  const dump = JSON.stringify(r)
  for (const leak of leaks) assert.equal(dump.includes(leak), false, `vazou: ${leak}`)
  assert.equal(/[0-9a-f]{64}/.test(dump), false)
  assert.deepEqual(Object.keys(r.data.a).sort(), ["key", "sampleSize"])
  assert.deepEqual(Object.keys(r.data.deltas[0]).sort(), ["a", "aReason", "b", "bReason", "delta", "metricId", "ratio", "reason", "unit"])
  const pr = okOf(call(P({ from: "2026-03-02", to: "2026-03-06" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades"]), ctxZ()))
  const pd = JSON.stringify(pr)
  for (const leak of ["2026-03-02", "2026-03-13", "tradeSetHash", "Sim101", "segredo-comparacao"]) assert.equal(pd.includes(leak), false, `PERIOD vazou: ${leak}`)
  assert.equal(pd.includes("02/03/2026 a 06/03/2026"), true)
  // T0 injetado no resultado do motor: a lista branca não o deixa passar
  const dirty: Any = JSON.parse(JSON.stringify(c))
  dirty.a.secret = "SEGREDO_T0"; dirty.b.fileName = "SEGREDO_T0"
  dirty.metrics = dirty.metrics.map((m: Any) => ({ ...m, extra: "SEGREDO_T0", a: { ...m.a, details: { x: "SEGREDO_T0" } } }))
  const pj: Any = projectCompare(dirty, "s1")
  assert.notEqual(pj, null)
  assert.equal(JSON.stringify(pj).includes("SEGREDO_T0"), false)
})

test("K9 — ARGS_INVALID (mode, extras, a == b, lados sem/ com dimensão a mais, groupBy, metricIds, valores, sobreposição, from > to, filters.from/to no PERIOD, conta/estratégia/setup em filtros, undefined…) nunca lança; ENGINE_REFUSED (sal ausente, ctx hostil, trades sem identidade); puro", () => {
  const B0 = G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades"])
  assert.equal(okOf(call(B0, ctxZ())).ok, true)
  const PA = { from: "2026-03-02", to: "2026-03-06" }, PB = { from: "2026-03-09", to: "2026-03-13" }
  const PB0 = P(PA, PB, ["totalTrades"])
  assert.equal(okOf(call(PB0, ctxZ())).ok, true)
  const eleven = METRIC_IDS.slice(0, 11)
  const bad: unknown[] = [undefined, null, 5, "x", [], {}, { mode: "X" }, { ...B0, mode: undefined }, { ...B0, foo: 1 }, { ...PB0, foo: 1 },
    G(["hour"], { hour: 9 }, { hour: 9 }, ["totalTrades"]), G(["hour"], { hour: 9 }, {}, ["totalTrades"]), G(["hour"], { hour: 9 }, { hour: 14, dayOfWeek: 1 }, ["totalTrades"]), G(["hour", "dayOfWeek"], { hour: 9 }, { hour: 14, dayOfWeek: 1 }, ["totalTrades"]),
    G(["hour", "hour"], { hour: 9 }, { hour: 14 }, ["totalTrades"]), G(["hour", "day", "month"], { hour: 9, day: "2026-03-02", month: "2026-03" }, { hour: 14, day: "2026-03-03", month: "2026-03" }, ["totalTrades"]), G([], {}, {}, ["totalTrades"]),
    G(["hour"], { hour: 9 }, { hour: 14 }, []), G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades", "totalTrades"]), G(["hour"], { hour: 9 }, { hour: 14 }, eleven), G(["hour"], { hour: 9 }, { hour: 14 }, ["naoExiste"]),
    G(["hour"], { hour: 24 }, { hour: 14 }, ["totalTrades"]), G(["hour"], { hour: 9.5 }, { hour: 14 }, ["totalTrades"]), G(["hour"], { hour: "09" }, { hour: 14 }, ["totalTrades"]), G(["dayOfWeek"], { dayOfWeek: 7 }, { dayOfWeek: 1 }, ["totalTrades"]),
    G(["day"], { day: "2026-02-30" }, { day: "2026-03-02" }, ["totalTrades"]), G(["month"], { month: "2026-13" }, { month: "2026-03" }, ["totalTrades"]), G(["direction"], { direction: "long" }, { direction: "SHORT" }, ["totalTrades"]),
    G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades"], { filters: { account: "Conta A" } }), G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades"], { filters: { strategyName: "x" } }), G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades"], { filters: { setup: "x" } }), G(["hour"], { hour: 9 }, { hour: 14 }, ["totalTrades"], { options: { pnlBasis: "X" } }),
    P({ from: "2026-03-02", to: "2026-03-09" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades"]), P({ from: "2026-03-02", to: "2026-03-10" }, { from: "2026-03-05", to: "2026-03-13" }, ["totalTrades"]), P({ from: "2026-03-06", to: "2026-03-02" }, PB, ["totalTrades"]), P(PA, PA, ["totalTrades"]),
    P({ from: "2026-02-30", to: "2026-03-06" }, PB, ["totalTrades"]), P(PA, PB, ["totalTrades"], { filters: { from: "2026-03-01" } }), P(PA, PB, ["totalTrades"], { filters: { to: "2026-03-30" } }), P(PA, PB, ["totalTrades"], { filters: { account: "Conta A" } }), P(PA, PB, []), P(PA, { from: "2026-03-09" }, ["totalTrades"])]
  for (const b of bad) { assert.doesNotThrow(() => call(b, ctxZ())); assert.deepEqual(call(b, ctxZ()), ARGS, JSON.stringify(b)) }
  // ENGINE_REFUSED
  const SALT = "sal-de-teste-da-comparacao-0123456789abcdef"
  const salted = runImportPipeline(CSV_Z, { sourceTz: BRT, fileName: "salgado.csv", accountRefSalt: SALT } as Any)
  const sRec = salted.importRecord as ImportRecord
  const base: Any = { trades: toAnalyticsTrades(withRisk(salted.trades)), importRecords: [sRec], refEpoch: "s1", analysis: ANZ }
  assert.deepEqual(metricsCompare(B0, base).result, REFUSED)
  assert.equal(okOf(metricsCompare(B0, { ...base, accountRefSalt: SALT }).result).ok, true)
  const noId = TZ.map((t) => ({ ...t, trade: { ...t.trade, tradeId: null, importId: null } })) as Any
  assert.deepEqual(call(B0, ctxZ({ trades: noId })), REFUSED)
  const hostile: Any = ctxZ()
  Object.defineProperty(hostile, "trades", { enumerable: true, get() { throw new Error("getter hostil") } })
  for (const c of [hostile, null, undefined, 5, ctxZ({ importRecords: null }), ctxZ({ refEpoch: "" }), ctxZ({ trades: [null] })]) {
    assert.doesNotThrow(() => metricsCompare(B0, c as never))
    const o = metricsCompare(B0, c as never)
    assert.deepEqual(o.result, REFUSED)
    assert.equal(o.entry, null)
  }
  const c = ctxZ()
  const snap = [JSON.stringify(c.trades), JSON.stringify(c.importRecords)]
  const a1 = run(B0, c), a2 = run(B0, c)
  assert.deepEqual([JSON.stringify(c.trades), JSON.stringify(c.importRecords)], snap)
  assert.equal(JSON.stringify(a1), JSON.stringify(a2))
})

test("K10 — projectCompare (puro): devolve { view, worstFlag, confidence } para o resultado do motor (GROUP e PERIOD); recusa (null) unit fora do UnitSchema, lado null sem motivo, delta null sem reason, motivo fora do catálogo, key vazia, sampleSize inválido, período inválido, metrics vazio, kind desconhecido, entrada hostil; nunca lança; não altera a entrada", () => {
  const cg: Any = directG(TY, AN, ["hour"], { hour: "09" }, { hour: "14" }, M4)
  const pg: Any = projectCompare(cg, "s1")
  assert.notEqual(pg, null)
  assert.equal(pg.worstFlag, "TINY")
  assert.equal(pg.confidence, "UNRELIABLE")
  assert.deepEqual(pg.view.a, { key: ["09:00"], sampleSize: 3 })
  assert.deepEqual(pg.view.deltas, expDeltas(cg))
  assert.equal(pg.view.conclusive, false)
  const cp: Any = directP(TZ, ANZ, { from: "2026-03-02", to: "2026-03-06" }, { from: "2026-03-09", to: "2026-03-13" }, ["totalTrades"])
  const pp: Any = projectCompare(cp, "s1")
  assert.deepEqual(pp.view.a.key, ["02/03/2026 a 06/03/2026"])
  assert.equal(pp.worstFlag, "OK")
  const clone = (): Any => JSON.parse(JSON.stringify(cg))
  const mut = (f: (x: Any) => void): Any => { const x = clone(); f(x); return x }
  const refuse: Array<[string, unknown]> = [
    ["unit fora do UnitSchema", mut((x) => { x.metrics[0].unit = "EUR" })],
    ["a null sem motivo", mut((x) => { x.metrics[3].a = { ...x.metrics[3].a, value: null, reason: null } })],
    ["b null sem motivo", mut((x) => { x.metrics[3].b = { ...x.metrics[3].b, value: null, reason: null } })],
    ["delta null sem reason", mut((x) => { x.metrics[0].delta = null; x.metrics[0].reason = null })],
    ["motivo fora do catálogo", mut((x) => { x.metrics[3].b.reason = "MOTIVO_INVENTADO" })],
    ["reason do delta fora do catálogo", mut((x) => { x.metrics[3].reason = "MOTIVO_INVENTADO" })],
    ["key vazia", mut((x) => { x.a.key.key = []; x.a.key.dims = [] })],
    ["key com valor fora do formato da dimensão", mut((x) => { x.a.key.key = ["99"] })],
    ["sampleSize negativo", mut((x) => { x.a.sampleSize = -1 })],
    ["sampleSize fracionário", mut((x) => { x.b.sampleSize = 1.5 })],
    ["metrics vazio", mut((x) => { x.metrics = [] })],
    ["kind desconhecido", mut((x) => { x.kind = "OUTRO" })],
    ["delta não finito", mut((x) => { x.metrics[0].delta = Number.POSITIVE_INFINITY })],
    ["sem a", mut((x) => { delete x.a })],
    ["sem metrics", mut((x) => { delete x.metrics })],
    ["período inválido", (() => { const x: Any = JSON.parse(JSON.stringify(cp)); x.a.period.from = "2026-13-45"; return x })()],
    ["PERIOD sem period", (() => { const x: Any = JSON.parse(JSON.stringify(cp)); x.a.period = null; return x })()],
  ]
  for (const [why, input] of refuse) { assert.doesNotThrow(() => projectCompare(input, "s1")); assert.equal(projectCompare(input, "s1"), null, why) }
  for (const bad of [null, undefined, 5, "x", [], {}, () => 1]) { assert.doesNotThrow(() => projectCompare(bad as never, "s1")); assert.equal(projectCompare(bad as never, "s1"), null, String(bad)) }
  assert.equal(projectCompare(cg, "" as never), null, "época inválida")
  const frozen: Any = JSON.parse(JSON.stringify(cg))
  const deepFreeze = (o: Any): void => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(deepFreeze) } }
  deepFreeze(frozen)
  assert.doesNotThrow(() => projectCompare(frozen, "s1"))
  assert.equal(JSON.stringify(frozen), JSON.stringify(cg))
})

test("K11 — FIM A FIM: ledger → validateAnswer → renderAnswer com slots de a.sampleSize, a.key, deltas a/b/delta/ratio e motivo; verificado + conclusivo ⇒ ASSERT válido e texto == formatador; sem arquivo ⇒ MISSING_NOT_VERIFIED_LABEL", () => {
  const out = run(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ({ source: { files: FILES_Z } }))
  const r = okOf(out.result)
  const ref = r.evidence.evidenceRef
  const ledger = (addEvidence((newLedger("s1") as Any).ledger, out.entry) as Any).ledger
  const paths = ["a.key[0]", "a.sampleSize", "b.sampleSize", "deltas[1].a", "deltas[1].b", "deltas[1].delta", "deltas[1].ratio"]
  const segs = [{ kind: "text", text: "Comparação:" }, ...paths.map((p) => ({ kind: "slot", ref, path: p })), { kind: "phrase", code: "POPULATION_DECLARED", ref }]
  const claims = paths.map((path) => ({ ref, path, mode: "ASSERT" }))
  const answer = { segments: segs, claims }
  const v: Any = validateAnswer({ answer, ledger, stop: null, question: "" })
  assert.equal(v.ok, true, JSON.stringify(v))
  const rendered: Any = renderAnswer({ answer, ledger, notices: [], stop: null, question: "" })
  assert.equal(rendered.ok, true)
  const c = directG(TZ, ANZ, ["hour"], { hour: "09" }, { hour: "14" }, M5), m = c.metrics[1]
  assert.deepEqual(rendered.rendered.segments.filter((s: Any) => s.kind === "value").map((s: Any) => s.text), ["09:00", "12", "12", txt(m.a.value, m.unit, m.a.reason), txt(m.b.value, m.unit, m.b.reason), txt(m.delta, m.unit, m.reason), txt(m.ratio, "ratio", m.reason)])
  assert.equal(rendered.rendered.banner.combined, "VERIFIED")
  // sem arquivo: o handle não é verificado
  const out2 = run(G(["hour"], { hour: 9 }, { hour: 14 }, M5), ctxZ())
  const ref2 = okOf(out2.result).evidence.evidenceRef
  const l2 = (addEvidence((newLedger("s1") as Any).ledger, out2.entry) as Any).ledger
  const a2 = { segments: [{ kind: "text", text: "Comparação:" }, { kind: "slot", ref: ref2, path: "deltas[1].delta" }, { kind: "phrase", code: "POPULATION_DECLARED", ref: ref2 }], claims: [{ ref: ref2, path: "deltas[1].delta", mode: "ASSERT" }] }
  assert.deepEqual((validateAnswer({ answer: a2, ledger: l2, stop: null, question: "" }) as Any).reasons, ["MISSING_NOT_VERIFIED_LABEL"])
  // slot que não existe nesta view
  const a3 = { segments: [{ kind: "slot", ref, path: "deltas[1].metricId" }], claims: [] }
  assert.equal((validateAnswer({ answer: a3, ledger, stop: null, question: "" }) as Any).ok, false)
})

test("K12 — CATÁLOGO: REASON_TEXTS tem GROUP_NOT_FOUND ('o grupo não existe nos dados', sem dígito), 30 motivos; e a EXPECTATIVA conhece os 12 casos, as 7 decisões D8 e a CZ", () => {
  assert.equal(Object.keys(REASON_TEXTS).length, 30)
  assert.equal(REASON_TEXTS.GROUP_NOT_FOUND, "o grupo não existe nos dados")
  assert.equal(/\d/.test(REASON_TEXTS.GROUP_NOT_FOUND), false)
  assert.deepEqual(formatUnavailable("GROUP_NOT_FOUND"), { ok: true, text: "indisponível (o grupo não existe nos dados)" })
  assert.equal((E8.cases as string[]).length, 12)
  assert.deepEqual(Object.keys(E8.decisions_D8), ["D8-1", "D8-2", "D8-3", "D8-4", "D8-5", "D8-6", "D8-7_E6.6-5-A"])
  assert.ok(E8.fixtures.CZ_nova.includes("24 trades"))
  assert.equal(E8.args.excluidas_por_decisao.length, 4)
})

console.log(`\n${passed} testes ok`)
