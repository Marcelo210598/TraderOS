// E6.6-10: capacidade `exit.analysis@1` (quebra por motivo de saída + comparação opcional de dois motivos). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_10 (D10-1…D10-8, Y1–Y14, YM1–YM16, fixtures CY e CZ).
//   node scripts/test-agent-exit-analysis.mts
import assert from "node:assert/strict"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { formatNumber, formatUnavailable, type DisplayUnit } from "../src/lib/agent/format.ts"
import { newAliasTable } from "../src/lib/agent/label.ts"
import { renderSlot } from "../src/lib/agent/slot-path.ts"
import { ExitAnalysisViewSchema } from "../src/lib/agent/views.ts"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { mapReconciliation, projectExitBreakdown, projectExitComparison } from "../src/lib/agent-capabilities/project.ts"
import { explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { compareExitReasons, compareTradeBuckets, exitReasonAnalysis, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const enc = (s: string) => new TextEncoder().encode(s)
const BRT = "America/Sao_Paulo"
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const mkRows = (rows: Any[]): SynthRow[] => rows.flatMap((c) => c.legs.map((l: Any): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any)))

// ── CY (6 trades, minSample 4) ──
const AN = { timeZone: BRT, minSample: 4 } as const
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const CSV_Y = synthCsv(mkRows(CY))
const impY = runImportPipeline(CSV_Y, { sourceTz: BRT, fileName: "segredo-saida-y.csv" })
const recY = impY.importRecord as ImportRecord
const TY = toAnalyticsTrades(withRisk(impY.trades))

// ── CZ (24 trades, 12 dias × 09:00 e 14:00; minSample 10) ──
const ANZ = { timeZone: BRT, minSample: 10 } as const
const DAYS = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17]
const CZ = DAYS.flatMap((day, i) => [9, 14].map((hour, j) => { const stop = j === 0 ? i % 3 === 0 : i % 2 === 0; return { account: "Sim101", hour, day, legs: [{ exitPrice: stop ? 1996 : 2004, label: stop ? "Stop1" : "Target1", min: 10 }] } }))
const CSV_Z = synthCsv(mkRows(CZ))
const impZ = runImportPipeline(CSV_Z, { sourceTz: BRT, fileName: "segredo-saida-z.csv" })
const recZ = impZ.importRecord as ImportRecord
const TZ = toAnalyticsTrades(withRisk(impZ.trades))
const FILES_Z = { [recZ.importId]: enc(CSV_Z) }

const ctxY = (o: Any = {}): Any => ({ trades: TY, importRecords: [recY], refEpoch: "s1", analysis: AN, ...o })
const ctxZ = (o: Any = {}): Any => ({ trades: TZ, importRecords: [recZ], refEpoch: "s1", analysis: ANZ, ...o })
const run = (args: unknown, c: Any): Any => exitAnalysis(args, c)
const call = (args: unknown, c: Any): Any => run(args, c).result
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 400)}`); return r }
const ERR = (code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability: "exit.analysis@1", ok: false, data: null, evidence: null, limits: [], error: { code } })
const ARGS = ERR("ARGS_INVALID"), REFUSED = ERR("ENGINE_REFUSED")
const slot = (data: Any, path: string): Any => renderSlot("exit.analysis@1", data, path)
const C = (unit: string, a: string, b: string, extra: Any = {}): Any => ({ compare: { unit, a, b }, ...extra })

// ── oráculo: o motor DIRETO ──
const analysisOf = (T: Any, an: Any, filters: Any = {}, opts: Any = {}): Any => exitReasonAnalysis(T, { ...an, filters, ...opts } as Any)
const cmpDirect = (T: Any, an: Any, unit: "LEG" | "TRADE", a: string, b: string, filters: Any = {}, opts: Any = {}): Any => {
  const x = analysisOf(T, an, filters, opts)
  return unit === "LEG" ? compareExitReasons(x, a as never, b as never) : compareTradeBuckets(x, a as never, b as never)
}
const expDeltas = (c: Any): Any[] => c.metrics.map((m: Any) => ({ metricId: m.metric, unit: m.unit, a: m.a.value, aReason: m.a.reason, b: m.b.value, bReason: m.b.reason, delta: m.delta, ratio: m.ratio, reason: m.reason }))
const expConclusive = (c: Any): boolean => c.metrics.length > 0 && c.metrics.every((m: Any) => m.conclusive) && c.confidence === "OK"
const txt = (value: number | null, unit: DisplayUnit, reason: string | null): string => {
  if (value === null) { const u = formatUnavailable(reason) as Any; assert.equal(u.ok, true, `motivo fora do catálogo: ${reason}`); return u.text }
  const r = formatNumber(value, unit) as Any
  assert.equal(r.ok, true)
  return r.text
}
const checkSlots = (data: Any, c: Any): void => c.metrics.forEach((m: Any, i: number) => {
  assert.deepEqual(slot(data, `comparison.deltas[${i}].a`), { ok: true, text: txt(m.a.value, m.unit, m.a.reason) }, `deltas[${i}].a`)
  assert.deepEqual(slot(data, `comparison.deltas[${i}].b`), { ok: true, text: txt(m.b.value, m.unit, m.b.reason) }, `deltas[${i}].b`)
  assert.deepEqual(slot(data, `comparison.deltas[${i}].delta`), { ok: true, text: txt(m.delta, m.unit, m.reason) }, `deltas[${i}].delta`)
  assert.deepEqual(slot(data, `comparison.deltas[${i}].ratio`), { ok: true, text: txt(m.ratio, "ratio", m.reason) }, `deltas[${i}].ratio`)
})
const WORD: Record<string, string> = { TARGET: "alvo", STOP: "stop", MANUAL: "manual", MIXED: "misto", UNKNOWN: "desconhecido" }
const UNITW: Record<string, string> = { LEG: "pernas", TRADE: "trades" }

test("Y1 — ORÁCULO SEM compare (CZ): buckets e reconciliation == o motor DIRETO e == exit.breakdown no mesmo ctx; comparison null; slots dos buckets == formatador", () => {
  const r = okOf(call({}, ctxZ()))
  const d = analysisOf(TZ, ANZ)
  const pj: Any = projectExitBreakdown(d)
  assert.deepEqual(r.data.buckets, pj.buckets)
  assert.equal(r.data.reconciliation, mapReconciliation(d.reconciliation.status))
  assert.equal(r.data.reconciliation, "RECONCILED")
  assert.equal(r.data.comparison, null)
  assert.deepEqual(Object.keys(r.data).sort(), ["buckets", "comparison", "reconciliation"])
  const b = okOf(exitBreakdown({}, ctxZ()).result)
  assert.deepEqual(r.data.buckets, b.data.buckets)
  assert.equal(r.data.reconciliation, b.data.reconciliation)
  r.data.buckets.forEach((x: Any, i: number) => {
    assert.deepEqual(slot(r.data, `buckets[${i}].count`), { ok: true, text: String(x.count) })
    assert.deepEqual(slot(r.data, `buckets[${i}].pnlNet`), { ok: true, text: txt(x.pnlNet, "usd", x.pnlNetReason) })
  })
  assert.deepEqual(slot(r.data, "reconciliation"), { ok: true, text: "conciliado" })
  assert.deepEqual(slot(r.data, "comparison.a.sampleSize"), { ok: false, code: "SLOT_PATH_INVALID" })
})

test("Y2 — ORÁCULO COMPARE LEG (CZ STOP vs TARGET): lados, deltas e conclusive == compareExitReasons DIRETO; literais medidos à mão; slots; troca de lados muda", () => {
  const c = cmpDirect(TZ, ANZ, "LEG", "STOP", "TARGET")
  const r = okOf(call(C("LEG", "STOP", "TARGET"), ctxZ()))
  const cmp = r.data.comparison
  assert.deepEqual(cmp.a, { key: ["stop", "pernas"], sampleSize: 10 })
  assert.deepEqual(cmp.b, { key: ["alvo", "pernas"], sampleSize: 14 })
  assert.deepEqual(cmp.deltas, expDeltas(c))
  assert.equal(cmp.conclusive, expConclusive(c))
  assert.equal(cmp.conclusive, false, "medido: a métrica `legs` vem conclusive:false do motor")
  assert.deepEqual(cmp.deltas.map((d: Any) => [d.metricId, d.unit, d.a, d.b, d.delta, d.ratio, d.reason]), [["legs", "count", 10, 14, 4, 1.4, null], ["netPnl", "usd", -424, 526.4, 950.4, null, "RATIO_SIGN_DIFFERS"], ["averageNet", "usd", -42.4, 37.6, 80, null, "RATIO_SIGN_DIFFERS"], ["grossPnl", "usd", -400, 560, 960, null, "RATIO_SIGN_DIFFERS"]])
  checkSlots(r.data, c)
  assert.deepEqual(slot(r.data, "comparison.a.key[0]"), { ok: true, text: "stop" })
  assert.deepEqual(slot(r.data, "comparison.b.key[0]"), { ok: true, text: "alvo" })
  assert.deepEqual(slot(r.data, "comparison.a.sampleSize"), { ok: true, text: "10" })
  const sw = okOf(call(C("LEG", "TARGET", "STOP"), ctxZ()))
  assert.notDeepEqual(sw.data.comparison.deltas, cmp.deltas)
  assert.deepEqual(sw.data.comparison.a.key, ["alvo", "pernas"])
  assert.equal(sw.data.comparison.deltas[1].delta, -950.4)
  // os buckets e a reconciliação da análise não mudam por existir comparação
  assert.deepEqual(r.data.buckets, okOf(call({}, ctxZ())).data.buckets)
})

test("Y3 — ORÁCULO COMPARE TRADE (CZ STOP vs TARGET): == compareTradeBuckets DIRETO; key ['stop','trades']; netPnl, averageTrade, totalR, averageR; literais medidos; conclusive false", () => {
  const c = cmpDirect(TZ, ANZ, "TRADE", "STOP", "TARGET")
  const r = okOf(call(C("TRADE", "STOP", "TARGET"), ctxZ()))
  const cmp = r.data.comparison
  assert.deepEqual(cmp.a, { key: ["stop", "trades"], sampleSize: 10 })
  assert.deepEqual(cmp.b, { key: ["alvo", "trades"], sampleSize: 14 })
  assert.deepEqual(cmp.deltas, expDeltas(c))
  assert.equal(cmp.conclusive, expConclusive(c))
  assert.equal(cmp.conclusive, false)
  assert.deepEqual(cmp.deltas.map((d: Any) => [d.metricId, d.unit, d.a, d.b, d.delta, d.ratio, d.reason]), [["netPnl", "usd", -424, 526.4, 950.4, null, "RATIO_SIGN_DIFFERS"], ["averageTrade", "usd", -42.4, 37.6, 80, null, "RATIO_SIGN_DIFFERS"], ["totalR", "R", -38.0186, 30.7066, 68.7252, null, "RATIO_SIGN_DIFFERS"], ["averageR", "R", -4.7523, 7.6767, 12.429, null, "RATIO_SIGN_DIFFERS"]])
  checkSlots(r.data, c)
  assert.notDeepEqual(cmp.deltas, okOf(call(C("LEG", "STOP", "TARGET"), ctxZ())).data.comparison.deltas, "TRADE e LEG são comparações diferentes (métricas diferentes)")
})

test("Y4 — LADO AUSENTE (CZ): LEG MANUAL vs STOP, TRADE MIXED vs STOP, LEG UNKNOWN vs STOP ⇒ ok, sampleSize 0, NO_LEGS/NO_TRADES, UNAVAILABLE_A e RATIO_A_ZERO; slots 'indisponível (…)'", () => {
  const cases: Array<["LEG" | "TRADE", string, string, string]> = [["LEG", "MANUAL", "STOP", "NO_LEGS"], ["TRADE", "MIXED", "STOP", "NO_TRADES"], ["LEG", "UNKNOWN", "STOP", "NO_LEGS"]]
  for (const [unit, a, b, why] of cases) {
    const c = cmpDirect(TZ, ANZ, unit, a, b)
    const r = okOf(call(C(unit, a, b), ctxZ()))
    const cmp = r.data.comparison
    assert.deepEqual(cmp.a, { key: [WORD[a], UNITW[unit]], sampleSize: 0 }, `${unit} ${a}`)
    assert.deepEqual(cmp.deltas, expDeltas(c))
    const unavailable = cmp.deltas.filter((d: Any) => d.aReason === why)
    assert.equal(unavailable.length >= 3, true, `${unit} ${a}: aReason ${why}`)
    for (const d of unavailable) { assert.equal(d.a, null); assert.equal(d.delta, null); assert.equal(d.reason, "UNAVAILABLE_A") }
    assert.equal(cmp.conclusive, false)
    checkSlots(r.data, c)
  }
  const leg = okOf(call(C("LEG", "MANUAL", "STOP"), ctxZ()))
  assert.deepEqual([leg.data.comparison.deltas[0].a, leg.data.comparison.deltas[0].delta, leg.data.comparison.deltas[0].ratio, leg.data.comparison.deltas[0].reason], [0, 10, null, "RATIO_A_ZERO"])
  assert.deepEqual(slot(leg.data, "comparison.deltas[1].a"), { ok: true, text: "indisponível (não há ordens registradas)" })
  assert.deepEqual(slot(leg.data, "comparison.deltas[1].delta"), { ok: true, text: "indisponível (o valor não está disponível no lado A da comparação)" })
})

test("Y5 — AMOSTRA E CONFIANÇA (CY LEG STOP vs MANUAL): sizes 3 e 1; sampleFlag do handle 'TINY'; confidence 'UNRELIABLE'; conclusive false == motor", () => {
  const c = cmpDirect(TY, AN, "LEG", "STOP", "MANUAL")
  const r = okOf(call(C("LEG", "STOP", "MANUAL"), ctxY()))
  assert.deepEqual([r.data.comparison.a.sampleSize, r.data.comparison.b.sampleSize], [3, 1])
  assert.deepEqual(r.data.comparison.deltas, expDeltas(c))
  assert.equal(r.data.comparison.conclusive, false)
  assert.equal(r.evidence.population.sampleFlag, "TINY")
  assert.equal(r.evidence.population.confidence, "UNRELIABLE")
  assert.equal(r.evidence.population.conclusive, false)
})

test("Y6 — ARGS_INVALID: compare incompleto/unit inválida/a==b/MIXED em LEG/minúscula/desconhecido/extras/não-objeto/undefined/from>to/setup/nome cru de conta; nunca lança; envelope fixo", () => {
  assert.equal(okOf(call(C("TRADE", "MIXED", "STOP"), ctxZ())).ok, true)
  assert.equal(okOf(call(C("LEG", "UNKNOWN", "STOP"), ctxZ())).ok, true)
  const bad: unknown[] = [undefined, null, 5, "x", [], { foo: 1 }, { compare: null }, { compare: {} }, { compare: { unit: "LEG", a: "STOP" } }, { compare: { unit: "LEG", b: "STOP" } }, { compare: { a: "STOP", b: "TARGET" } },
    C("PERNA", "STOP", "TARGET"), C("leg", "STOP", "TARGET"), C("LEG", "STOP", "STOP"), C("TRADE", "TARGET", "TARGET"), C("LEG", "MIXED", "STOP"), C("LEG", "STOP", "MIXED"),
    C("LEG", "stop", "TARGET"), C("LEG", "STOP", "alvo"), C("LEG", "STOP", "OUTRO"), C("LEG", "STOP", 5), C("LEG", "STOP", null), C("TRADE", "STOP", "TARGET ", {}),
    { compare: { unit: "LEG", a: "STOP", b: "TARGET", extra: 1 } }, { ...C("LEG", "STOP", "TARGET"), foo: 1 }, { ...C("LEG", "STOP", "TARGET"), where: {} }, { compare: "LEG" }, { compare: ["LEG", "STOP", "TARGET"] },
    { filters: { from: "2026-03-10", to: "2026-03-02" } }, { filters: { setup: "x" } }, { filters: { account: "Sim101" } }, { filters: { account: "Conta Z" } }]
  for (const b of bad) { assert.doesNotThrow(() => call(b, ctxZ())); assert.deepEqual(call(b, ctxZ()), ARGS, JSON.stringify(b)) }
})

test("Y7 — HANDLE E VEREDITO: DERIVED, scope TOTAL; o 2º derivado muda o evidenceRef; sem arquivo NOT_VERIFIED + estrutural; com arquivo VERIFIED (com e sem compare); adulterado TAMPERED_OR_MISMATCH; population.conclusive só com compare", () => {
  const plain = okOf(call({}, ctxZ()))
  const withC = okOf(call(C("LEG", "STOP", "TARGET"), ctxZ()))
  for (const r of [plain, withC]) {
    assert.equal(r.evidence.subject.type, "DERIVED")
    assert.equal(r.evidence.scope, "TOTAL")
    assert.equal(r.evidence.population.declared, 24)
    assert.equal(r.evidence.verdict.verify.status, "VALID")
    assert.equal(r.evidence.verdict.combined, "NOT_VERIFIED")
    assert.deepEqual(r.limits.map((l: Any) => l.code), ["VERIFICATION_INFRA_MISSING"])
  }
  assert.notEqual(plain.evidence.evidenceRef, withC.evidence.evidenceRef, "a comparação entra no bundle (2º derivado)")
  assert.equal(Object.hasOwn(plain.evidence.population, "conclusive"), false)
  assert.equal(withC.evidence.population.conclusive, withC.data.comparison.conclusive)
  assert.equal(plain.evidence.subject.id, withC.evidence.subject.id, "subject = o derivado da ANÁLISE (derived[0])")
  const bundleOnly = okOf(exitBreakdown({}, ctxZ()).result)
  assert.equal(plain.evidence.subject.id, bundleOnly.evidence.subject.id)
  for (const args of [{}, C("LEG", "STOP", "TARGET"), C("TRADE", "STOP", "TARGET")]) {
    const good = okOf(call(args, ctxZ({ source: { files: FILES_Z } })))
    assert.equal(good.evidence.verdict.combined, "VERIFIED", JSON.stringify(args))
    assert.deepEqual(good.limits, [])
    const bad = okOf(call(args, ctxZ({ source: { files: { [recZ.importId]: enc(CSV_Z.replace("2004", "2005")) } } })))
    assert.equal(bad.evidence.verdict.combined, "TAMPERED_OR_MISMATCH", JSON.stringify(args))
  }
})

test("Y8 — sampleFlag DO HANDLE: CZ sem compare 'OK'; CY sem compare 'TINY'; CZ com compare MANUAL vs STOP 'TINY' (lado ausente conta); buckets de contagem 0 não rebaixam sozinhos", () => {
  assert.equal(okOf(call({}, ctxZ())).evidence.population.sampleFlag, "OK")
  assert.equal(okOf(exitBreakdown({}, ctxZ()).result).evidence.population.sampleFlag, "OK")
  assert.equal(okOf(call({}, ctxY())).evidence.population.sampleFlag, "TINY")
  assert.equal(okOf(call(C("LEG", "STOP", "TARGET"), ctxZ())).evidence.population.sampleFlag, "OK")
  assert.equal(okOf(call(C("LEG", "MANUAL", "STOP"), ctxZ())).evidence.population.sampleFlag, "TINY")
  assert.equal(okOf(call(C("TRADE", "MIXED", "STOP"), ctxZ())).evidence.population.sampleFlag, "TINY")
})

test("Y9 — RECONCILIAÇÃO: DIVERGENT (trade adulterado em CÓPIA) e NOT_COMPARABLE (sem ciclos) chegam à view e ao slot, == exit.breakdown; FULL ⇒ 'conciliado'; com compare a reconciliation continua a da ANÁLISE", () => {
  const tampered: Any[] = structuredClone(impY.trades)
  tampered[0].pnl.net = tampered[0].pnl.net + 5
  const tT = toAnalyticsTrades(withRisk(tampered))
  assert.equal(analysisOf(tT, AN).reconciliation.status, "DIVERGENT", "premissa")
  const flat = runImportPipeline(CSV_Y, { sourceTz: BRT, fileName: "plano.csv", reconstructCycles: false } as Any)
  const fT = toAnalyticsTrades(withRisk(flat.trades))
  assert.notEqual(analysisOf(fT, AN).reconciliation.status, "FULL", "premissa")
  const cases: Array<[string, Any, string, string]> = [["DIVERGENT", ctxY({ trades: tT }), "DIVERGENT", "divergente"], ["NOT_COMPARABLE", ctxY({ trades: fT, importRecords: [flat.importRecord] }), "NOT_COMPARABLE", "não comparável"], ["FULL", ctxY(), "RECONCILED", "conciliado"]]
  for (const [, c, word, text] of cases) {
    const r = okOf(call({}, c))
    assert.equal(r.data.reconciliation, word)
    assert.deepEqual(slot(r.data, "reconciliation"), { ok: true, text })
    assert.equal(r.data.reconciliation, okOf(exitBreakdown({}, c).result).data.reconciliation)
    const rc = okOf(call(C("LEG", "STOP", "TARGET"), c))
    assert.equal(rc.data.reconciliation, word, "com compare a reconciliation é a da análise")
  }
})

test("Y10 — UNIDADE NA CHAVE: LEG ⇒ 'pernas', TRADE ⇒ 'trades' nos dois lados e nos slots key[0]/key[1]; o sampleSize é o do motor na unidade certa (CY STOP: 3 pernas ≠ 2 trades)", () => {
  const leg = okOf(call(C("LEG", "STOP", "MANUAL"), ctxY()))
  const trd = okOf(call(C("TRADE", "STOP", "MANUAL"), ctxY()))
  assert.deepEqual(leg.data.comparison.a, { key: ["stop", "pernas"], sampleSize: 3 })
  assert.deepEqual(leg.data.comparison.b, { key: ["manual", "pernas"], sampleSize: 1 })
  assert.deepEqual(trd.data.comparison.a, { key: ["stop", "trades"], sampleSize: 2 })
  assert.deepEqual(trd.data.comparison.b, { key: ["manual", "trades"], sampleSize: 1 })
  for (const [r, w] of [[leg, "pernas"], [trd, "trades"]] as Any[]) {
    for (const side of ["a", "b"]) assert.deepEqual(slot(r.data, `comparison.${side}.key[1]`), { ok: true, text: w })
    assert.deepEqual(slot(r.data, "comparison.a.key[0]"), { ok: true, text: "stop" })
  }
  assert.equal(cmpDirect(TY, AN, "LEG", "STOP", "MANUAL").a.sampleSize, 3)
  assert.equal(cmpDirect(TY, AN, "TRADE", "STOP", "MANUAL").a.sampleSize, 2)
})

const CONV = (metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, ctxY({ aliases: newAliasTable("s1") })) as Any).aliases // Conta A = Sim101, Conta B = Sim102

test("Y11 — FILTROS E OPTIONS: filters reduzem a população da ANÁLISE e da COMPARAÇÃO (== direto); filters.account por alias; options.pnlBasis passa aos dois", () => {
  const f = { direction: "LONG", from: "2026-03-03", to: "2026-03-10" }
  const r = okOf(call(C("TRADE", "STOP", "TARGET", { filters: f }), ctxY()))
  const d = analysisOf(TY, AN, f)
  assert.deepEqual(r.data.buckets, (projectExitBreakdown(d) as Any).buckets)
  const c = cmpDirect(TY, AN, "TRADE", "STOP", "TARGET", f)
  assert.deepEqual(r.data.comparison.deltas, expDeltas(c))
  assert.deepEqual([r.data.comparison.a.sampleSize, r.data.comparison.b.sampleSize], [c.a.sampleSize, c.b.sampleSize])
  assert.notEqual(r.data.comparison.a.sampleSize + r.data.comparison.b.sampleSize, cmpDirect(TY, AN, "TRADE", "STOP", "TARGET").a.sampleSize + cmpDirect(TY, AN, "TRADE", "STOP", "TARGET").b.sampleSize, "o filtro precisa mudar a amostra")
  const acc = okOf(call(C("LEG", "STOP", "TARGET", { filters: { account: "Conta B" } }), ctxY({ aliases: CONV })))
  const dacc = analysisOf(TY, AN, { account: "Sim102" })
  assert.deepEqual(acc.data.buckets, (projectExitBreakdown(dacc) as Any).buckets)
  assert.deepEqual(acc.data.comparison.deltas, expDeltas(cmpDirect(TY, AN, "LEG", "STOP", "TARGET", { account: "Sim102" })))
  const net = okOf(call(C("LEG", "STOP", "TARGET"), ctxZ()))
  const gross = okOf(call(C("LEG", "STOP", "TARGET", { options: { pnlBasis: "GROSS" } }), ctxZ()))
  assert.deepEqual(gross.data.buckets, (projectExitBreakdown(analysisOf(TZ, ANZ, {}, { pnlBasis: "GROSS" })) as Any).buckets)
  assert.deepEqual(gross.data.comparison.deltas, expDeltas(cmpDirect(TZ, ANZ, "LEG", "STOP", "TARGET", {}, { pnlBasis: "GROSS" })))
  assert.notEqual(gross.evidence.evidenceRef, net.evidence.evidenceRef)
})

test("Y12 — SEGURANÇA: a saída não tem nome de conta, arquivo, importId, hashes, acc_/str_, sal, userId nem 'label'; salgado sem sal ⇒ ENGINE_REFUSED; ctx hostil ⇒ ENGINE_REFUSED sem lançar; T0 injetado na comparação não passa", () => {
  const r = okOf(call(C("LEG", "STOP", "TARGET"), ctxZ()))
  const dump = JSON.stringify(r)
  for (const leak of ["Sim101", "Sim102", "segredo-saida", recZ.importId, "tradeSetHash", "legSetHash", "evidenceHash", "rowHash", "rowNo", "fileSha256", "saltId", "userId", "acc_", "str_", "label"]) assert.equal(dump.includes(leak), false, `vazou: ${leak}`)
  assert.equal(/[0-9a-f]{64}/.test(dump), false)
  const SALT = "sal-de-teste-da-saida-0123456789abcdef"
  const salted = runImportPipeline(CSV_Z, { sourceTz: BRT, fileName: "salgado.csv", accountRefSalt: SALT } as Any)
  const base: Any = { trades: toAnalyticsTrades(withRisk(salted.trades)), importRecords: [salted.importRecord], refEpoch: "s1", analysis: ANZ }
  assert.deepEqual(call({}, base), REFUSED)
  assert.deepEqual(call(C("LEG", "STOP", "TARGET"), base), REFUSED)
  assert.equal(okOf(call(C("LEG", "STOP", "TARGET"), { ...base, accountRefSalt: SALT })).ok, true)
  const hostile: Any = ctxZ()
  Object.defineProperty(hostile, "trades", { enumerable: true, get() { throw new Error("getter hostil") } })
  for (const c of [hostile, null, undefined, 5, ctxZ({ importRecords: null }), ctxZ({ refEpoch: "" }), ctxZ({ trades: [null] })]) { assert.doesNotThrow(() => run(C("LEG", "STOP", "TARGET"), c as never)); assert.deepEqual(call(C("LEG", "STOP", "TARGET"), c as never), REFUSED) }
  const ex: Any = explainDerived({ spec: { op: "EXIT_REASON_COMPARISON_LEGS", args: { a: "STOP", b: "TARGET" }, filters: {}, options: { timeZone: BRT, minSample: 10 } } as never, trades: TZ, importRecords: [recZ] } as never)
  assert.equal(ex.ok, true)
  const dirty: Any = JSON.parse(JSON.stringify(ex.derived.result))
  dirty.secret = "SEGREDO_T0"; dirty.a.fileName = "SEGREDO_T0"
  dirty.metrics = dirty.metrics.map((m: Any) => ({ ...m, extra: "SEGREDO_T0", a: { ...m.a, details: { x: "SEGREDO_T0" } } }))
  const pj: Any = projectExitComparison(dirty, "LEG")
  assert.notEqual(pj, null)
  assert.equal(JSON.stringify(pj).includes("SEGREDO_T0"), false)
})

test("Y13 — PROJEÇÃO PURA: projectExitComparison recusa (null) kind errado, unit errada/ausente, motivo de saída fora do enum, unit de métrica inválida, lado null sem motivo, delta null sem reason, motivo fora do catálogo, entrada não-objeto; não muta; determinística; chave só por formatEnum", () => {
  const ex: Any = explainDerived({ spec: { op: "EXIT_REASON_COMPARISON_LEGS", args: { a: "STOP", b: "TARGET" }, filters: {}, options: { timeZone: BRT, minSample: 10 } } as never, trades: TZ, importRecords: [recZ] } as never)
  const good: Any = ex.derived.result
  const snap = JSON.stringify(good)
  const p1: Any = projectExitComparison(good, "LEG")
  assert.notEqual(p1, null)
  assert.equal(JSON.stringify(good), snap, "não muta a entrada")
  assert.deepEqual(projectExitComparison(good, "LEG"), p1)
  assert.deepEqual(p1.view.a, { key: ["stop", "pernas"], sampleSize: 10 })
  assert.equal(p1.worstFlag, "OK")
  assert.equal(p1.confidence, "LIMITED")
  assert.equal(projectExitComparison(good, "TRADE"), null, "unit pedida ≠ unit do result")
  assert.equal(projectExitComparison(good, "PERNA" as never), null)
  assert.equal(projectExitComparison(good, undefined as never), null)
  const mut = (f: (r: Any) => void): Any => { const c: Any = JSON.parse(snap); f(c); return projectExitComparison(c, "LEG") }
  assert.equal(mut((r) => { r.kind = "GROUP_COMPARISON" }), null)
  assert.equal(mut((r) => { r.unit = "TRADE" }), null)
  assert.equal(mut((r) => { delete r.unit }), null)
  assert.equal(mut((r) => { r.a.key.key = ["MIXED"] }), null, "MIXED não existe em pernas")
  assert.equal(mut((r) => { r.a.key.key = ["XYZ"] }), null)
  assert.equal(mut((r) => { r.a.key.key = [] }), null)
  assert.equal(mut((r) => { r.metrics[0].unit = "xyz" }), null)
  assert.equal(mut((r) => { r.metrics[1].a.value = null; r.metrics[1].a.reason = null }), null)
  assert.equal(mut((r) => { r.metrics[1].delta = null; r.metrics[1].reason = null }), null)
  assert.equal(mut((r) => { r.metrics[1].a.value = null; r.metrics[1].a.reason = "MOTIVO_INVENTADO" }), null)
  assert.equal(mut((r) => { r.metrics = [] }), null)
  assert.equal(mut((r) => { r.confidence = "ALTA" }), null)
  const lbl: Any = JSON.parse(snap); lbl.a.key.label = "SEGREDO_LABEL"
  assert.equal(JSON.stringify(projectExitComparison(lbl, "LEG")).includes("SEGREDO_LABEL"), false)
  for (const x of [null, undefined, 5, "x", [], {}]) assert.equal(projectExitComparison(x, "LEG"), null)
})

test("Y14 — SCHEMA E SLOTS (D10-3): ExitAnalysisViewSchema EXIGE reconciliation; o slot reconciliation renderiza as 3 palavras; comparison null ⇒ paths abaixo seguem SLOT_PATH_INVALID", () => {
  const r = okOf(call(C("LEG", "STOP", "TARGET"), ctxZ()))
  assert.equal(ExitAnalysisViewSchema.safeParse(r.data).success, true)
  const old: Any = { buckets: r.data.buckets, comparison: r.data.comparison }
  assert.equal(ExitAnalysisViewSchema.safeParse(old).success, false, "formato antigo (sem reconciliation) não vale mais")
  assert.deepEqual(renderSlot("exit.analysis@1", old, "buckets[0].count"), { ok: false, code: "VIEW_INVALID" })
  for (const [w, t] of [["RECONCILED", "conciliado"], ["DIVERGENT", "divergente"], ["NOT_COMPARABLE", "não comparável"]]) assert.deepEqual(slot({ ...r.data, reconciliation: w }, "reconciliation"), { ok: true, text: t })
  assert.equal(ExitAnalysisViewSchema.safeParse({ ...r.data, reconciliation: "OK" }).success, false)
  const nul = okOf(call({}, ctxZ()))
  assert.deepEqual(slot(nul.data, "comparison.deltas[0].delta"), { ok: false, code: "SLOT_PATH_INVALID" })
  assert.deepEqual(slot(nul.data, "comparison.a.key[0]"), { ok: false, code: "SLOT_PATH_INVALID" })
})

console.log(`\n${passed} testes do E6.6-10 (exit.analysis@1) passaram`)
