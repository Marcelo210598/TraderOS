// Evidence E5.2 — verifyEvidence V3 (população/fingerprint/tradeSetHash) e V4 (métricas pelo MESMO motor).   node scripts/test-evidence-verify-math.mts
// O oráculo dos testes de drawdown é uma TABELA escrita à mão (não o motor). Fixtures reais: locais, sem números embutidos.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade, ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle, type MetricSource } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { verifyEvidence, type VerifyReport } from "../src/lib/evidence/verify.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { METRIC_IDS, aggregateTrades, aggregateTradesTraced, calculateMetrics, calculateMetricsTraced, toAnalyticsTrades, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk } from "./_evidence-fixtures.mts"

const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const SPEC = [4, 3, -2, -3, -1, 6, 0, 2, -4, 5, 1, -1, 7, 3]
const rowsOf = (pts: number[], opts: { account?: (i: number) => string; exitSame?: boolean } = {}) =>
  pts.map((p, i) => ({
    account: opts.account ? opts.account(i) : i < 10 ? "Sim101" : "Sim102",
    entryPrice: 2000,
    exitPrice: 2000 + p,
    entryAt: `${String(i + 2).padStart(2, "0")}/03/2026 ${String(9 + (i % 4)).padStart(2, "0")}:00:00`,
    exitAt: opts.exitSame ? "20/03/2026 12:00:00" : `${String(i + 2).padStart(2, "0")}/03/2026 ${String(9 + (i % 4)).padStart(2, "0")}:10:00`,
  }))
const imp = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: "Sim101_Sim102-marco.csv" })
const rec = imp.importRecord as ImportRecord
const A = toAnalyticsTrades(withRisk(imp.trades)) // com stops variados: R válido e os 3 motivos de R ausente

function bundle(metricId: string, trades: AnalyticsTrade[] = A, records: ImportRecord[] = [rec], args: Parameters<typeof calculateMetricsTraced>[1] = {}): EvidenceBundle {
  const { result, trace } = calculateMetricsTraced(trades, args)
  const r = explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades, importRecords: records })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
function groupBundle(by: string | readonly string[], index: number, metricId: string, trades: AnalyticsTrade[] = A, records: ImportRecord[] = [rec], args: Parameters<typeof aggregateTradesTraced>[1] = {} as Any): EvidenceBundle {
  const ag = aggregateTradesTraced(trades, { ...args, groupBy: by as Any })
  const r = explainMetric({ metricId, source: { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index } }, trades, importRecords: records })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
const reseal = (b: Any): Any => {
  try {
    return { ...b, evidenceHash: computeEvidenceHash(b) }
  } catch {
    return b
  }
}
const edit = (b: EvidenceBundle, fn: (x: Any) => void, sealed = true): Any => {
  const c = clone(b) as Any
  fn(c)
  return sealed ? reseal(c) : c
}
const check = (rep: VerifyReport, id: string) => {
  const c = rep.checks.find((x) => x.id === id)
  assert.ok(c, `check ${id} ausente`)
  return c
}
const fails = (rep: VerifyReport) => rep.checks.filter((c) => c.status === "FAIL").map((c) => c.id)
const blockingSkips = (rep: VerifyReport) => rep.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE").map((c) => `${c.id}:${c.code}`)
const tradeOf = (b: Any, n = 0) => b.evidence.trades[n]

// ── bundle íntegro ───────────────────────────────────────────────────────────

test("ÍNTEGRO: as 39 métricas do catálogo (com R, motivos de R ausente e pontos) ⇒ VALID; V3/V4 PASS; só NOT_APPLICABLE é pulado", () => {
  assert.equal(METRIC_IDS.length, 39)
  for (const id of METRIC_IDS) {
    const rep = verifyEvidence(bundle(id))
    assert.equal(rep.status, "VALID", `${id}: ${JSON.stringify(rep.checks.filter((c) => c.status !== "PASS").map((c) => [c.id, c.code, c.detail.slice(0, 80)]))}`)
    for (const cid of ["V3.population", "V3.provenance", "V4.versions", "V4.query", "V4.population", "V4.metric-value", "V4.metric-fields", "V4.contributors", "V4.quality"]) assert.equal(check(rep, cid).status, "PASS", `${id}: ${cid}`)
    assert.equal(check(rep, "V4.anchors").code, "S_NOT_APPLICABLE")
  }
  // com rBasis POINTS, P&L bruto, âncora de saída e fuso diferentes
  for (const args of [{ rBasis: "POINTS" as const }, { pnlBasis: "GROSS" as const }, { timeAnchor: "EXIT" as const, timeZone: "America/New_York" }, { minSample: 5 }]) {
    for (const id of ["totalR", "averageR", "totalPoints", "netPnl", "maxDrawdown", "winRate"]) assert.equal(verifyEvidence(bundle(id, A, [rec], args)).status, "VALID", `${id} ${JSON.stringify(args)}`)
  }
})

test("NÃO-REGRESSÃO: motor normal ≡ traced; o V4 usa o MESMO motor (não há fórmula no verificador)", () => {
  for (const args of [{}, { rBasis: "POINTS" as const }, { pnlBasis: "GROSS" as const }]) assert.equal(canonicalJson(calculateMetricsTraced(A, args).result), canonicalJson(calculateMetrics(A, args)))
  const g = aggregateTradesTraced(A, { groupBy: "account" })
  assert.equal(canonicalJson(g.result), canonicalJson(aggregateTrades(A, { groupBy: "account" })))
})

// ── V3: fingerprint / tradeSetHash ───────────────────────────────────────────

test("V3 rowHash alterado COM novo evidenceHash e tradeSetHash declarado inalterado (ciclo e trade-linha): V1 PASSA, V3 acusa V_TRADESET_HASH_MISMATCH ⇒ TAMPERED", () => {
  const rows = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: "x.csv", reconstructCycles: false })
  for (const [label, b] of [["ciclo", bundle("netPnl")], ["linha", bundle("netPnl", toAnalyticsTrades(withRisk(rows.trades)), [rows.importRecord as ImportRecord])]] as const) {
    const forged = edit(b, (x) => (x.evidence.trades[2].sourceRows[0].rowHash = "f".repeat(64)))
    const rep = verifyEvidence(forged)
    assert.equal(rep.status, "TAMPERED", label)
    assert.equal(check(rep, "V1.seal").status, "PASS", label)
    assert.equal(check(rep, "V3.population").status, "FAIL", label)
    assert.equal(check(rep, "V3.population").code, "V_TRADESET_HASH_MISMATCH")
    assert.equal(forged.evidence.metrics[0].population.tradeSetHash, b.evidence.metrics[0].population.tradeSetHash, "o declarado ficou inalterado")
  }
})

test("V3 P&L, R, comissão, instante e identidade alterados (selo recalculado) ⇒ V3 acusa; trade extra/removido/trocado idem", () => {
  const b = bundle("netPnl")
  const cases: Array<[string, (x: Any) => void]> = [
    ["pnl.net", (x) => (tradeOf(x).pnl.net += 50)],
    ["pnl.gross", (x) => (tradeOf(x).pnl.gross += 50)],
    ["pnl.commission", (x) => (tradeOf(x).pnl.commission += 1)],
    ["r.net", (x) => (tradeOf(x).r.net = 7.5)],
    ["r.points", (x) => (tradeOf(x).r.points = 7.5)],
    ["entry instant", (x) => (tradeOf(x).entry.at.instantUtc = "2030-01-01T00:00:00.000Z")],
    ["exit instant", (x) => (tradeOf(x).exit.at.instantUtc = "2030-01-01T00:00:00.000Z")],
    ["rowHash", (x) => (tradeOf(x).sourceRows[0].rowHash = "0".repeat(64))],
    ["importId (e ImportRef)", (x) => { tradeOf(x).importId = `imp_${"0".repeat(32)}`; tradeOf(x).sourceRows.forEach((r: Any) => (r.importId = `imp_${"0".repeat(32)}`)) }],
    ["reconstrução (confidence)", (x) => (tradeOf(x).reconstruction.confidence = tradeOf(x).reconstruction.confidence === "HIGH" ? "LOW" : "HIGH")],
    ["reconstrução (integrity)", (x) => (tradeOf(x).reconstruction.integrity = "BROKEN")],
    ["trade trocado por clone de outro (mesmo id)", (x) => { const o = clone(tradeOf(x, 1)); o.tradeId = tradeOf(x, 0).tradeId; x.evidence.trades[0] = o }],
  ]
  for (const [name, fn] of cases) {
    const rep = verifyEvidence(edit(b, fn))
    assert.equal(rep.status, "TAMPERED", name)
    assert.equal(check(rep, "V3.population").status === "FAIL" || fails(rep).length > 0, true, name)
    assert.ok(fails(rep).some((id) => id.startsWith("V3") || id.startsWith("V4") || id.startsWith("V2")), name)
  }
  // os que mexem em campo coberto pelo fingerprint acendem V3 especificamente
  for (const name of ["pnl.net", "pnl.gross", "pnl.commission", "r.net", "r.points", "entry instant", "exit instant", "rowHash", "reconstrução (confidence)", "reconstrução (integrity)"]) {
    const fn = cases.find((c) => c[0] === name)![1]
    assert.equal(check(verifyEvidence(edit(b, fn)), "V3.population").status, "FAIL", name)
  }
})

test("V3 tradeSetHash declarado alterado ⇒ V3 e V4.population acusam; ordem dos trades no bundle é irrelevante (hash independe da ordem)", () => {
  const b = bundle("netPnl")
  const rep = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].population.tradeSetHash = "b".repeat(64))))
  assert.equal(rep.status, "TAMPERED")
  assert.deepEqual(fails(rep).sort(), ["V3.population", "V4.population"])
  const shuffled = edit(b, (x) => { x.evidence.trades.reverse(); x.evidence.metrics[0].population.tradeIds.reverse() })
  assert.equal(verifyEvidence(shuffled).status, "VALID")
})

test("V3 trade removido / extra / ImportRef removido ou trocado: V2 acusa e V3/V4 viram SKIPPED (S_REFS_BROKEN) — nunca PASS; extra não afeta V3/V4", () => {
  const b = bundle("netPnl")
  const removed = verifyEvidence(edit(b, (x) => x.evidence.trades.shift()))
  assert.equal(removed.status, "TAMPERED")
  assert.equal(check(removed, "V3.population").status, "SKIPPED")
  assert.equal(check(removed, "V3.population").code, "S_REFS_BROKEN")
  assert.equal(check(removed, "V4.metric-value").code, "S_REFS_BROKEN")
  const extra = verifyEvidence(edit(b, (x) => x.evidence.trades.push({ ...clone(x.evidence.trades[0]), tradeId: `trd_${"e".repeat(32)}` })))
  assert.equal(extra.status, "TAMPERED")
  assert.deepEqual(fails(extra), ["V2.unreferenced-trades"]) // V3/V4 conferem só a população declarada: o extra não entra
  assert.equal(check(extra, "V3.population").status, "PASS")
  const noImport = verifyEvidence(edit(b, (x) => (x.evidence.imports = [])))
  assert.deepEqual(fails(noImport), ["V2.import-refs"])
  const swapped = verifyEvidence(edit(b, (x) => (tradeOf(x).importId = `imp_${"0".repeat(32)}`)))
  assert.equal(swapped.status, "TAMPERED")
  assert.ok(fails(swapped).includes("V3.population")) // o importId está no fingerprint
})

// ── V4: métricas ─────────────────────────────────────────────────────────────

test("V4 value, basis, sampleSize, coverage e reason alterados (selo recalculado) ⇒ V4.metric-value / V4.metric-fields; NET→GROSS nas opções ⇒ valor e basis divergem", () => {
  const b = bundle("netPnl")
  assert.equal(check(verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].value += 0.01))), "V4.metric-value").status, "FAIL")
  assert.equal(check(verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].value = null))), "V4.metric-value").code, "V_METRIC_VALUE_MISMATCH")
  for (const fn of [
    (x: Any) => (x.evidence.metrics[0].unit = "R"),
    (x: Any) => (x.evidence.metrics[0].basis = "GROSS"),
    (x: Any) => (x.evidence.metrics[0].sampleSize += 1),
    (x: Any) => (x.evidence.metrics[0].coverage.used -= 1),
    (x: Any) => (x.evidence.metrics[0].coverage.ratio = 0.5),
    (x: Any) => (x.evidence.metrics[0].reason = "algo"),
  ]) {
    const rep = verifyEvidence(edit(b, fn))
    assert.equal(rep.status, "TAMPERED")
    assert.equal(check(rep, "V4.metric-fields").status, "FAIL")
    assert.equal(check(rep, "V4.metric-fields").code, "V_METRIC_FIELD_MISMATCH")
  }
  // NET → GROSS nas opções: numa métrica que USA a base (averageTrade), o valor e o basis divergem
  const avg = bundle("averageTrade")
  const gross = verifyEvidence(edit(avg, (x) => (x.evidence.metrics[0].query.options.pnlBasis = "GROSS")))
  assert.equal(gross.status, "TAMPERED")
  assert.equal(check(gross, "V4.metric-value").status, "FAIL")
  assert.equal(check(gross, "V4.metric-fields").status, "FAIL") // basis "NET" declarado ≠ "GROSS" recalculado
  // o mesmo no basis declarado, sem mexer nas opções
  assert.equal(check(verifyEvidence(edit(avg, (x) => (x.evidence.metrics[0].basis = "GROSS"))), "V4.metric-fields").status, "FAIL")
  // netPnl SEMPRE soma o líquido: a opção pnlBasis não entra na conta dele, então o que se declara é reproduzido (nada a acusar)
  assert.equal(verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].query.options.pnlBasis = "GROSS"))).status, "VALID")
  const asPoints = verifyEvidence(edit(bundle("totalR"), (x) => (x.evidence.metrics[0].query.options.rBasis = "POINTS")))
  assert.equal(asPoints.status, "TAMPERED")
})

test("V4 contributors trocado, roleCounts alterado, papel trocado (selo recalculado) ⇒ V_CONTRIBUTORS_MISMATCH em V4 (e/ou V2)", () => {
  const b = bundle("winners")
  const swap = verifyEvidence(edit(b, (x) => { const items = x.evidence.metrics[0].contributors.items; const other = x.evidence.trades.find((t: Any) => !items.some((i: Any) => i.tradeId === t.tradeId)); items[0].tradeId = other.tradeId }))
  assert.equal(swap.status, "TAMPERED")
  assert.equal(check(swap, "V4.contributors").status, "FAIL") // as referências ainda fecham (V2 passa); só o motor sabe que não é esse trade
  assert.deepEqual(fails(swap), ["V4.contributors"])
  const counts = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].contributors.roleCounts.WINNER += 1)))
  assert.ok(fails(counts).includes("V4.contributors") && fails(counts).includes("V2.contributor-counts"))
  const role = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].contributors.items[0].role = "LOSER")))
  assert.equal(role.status, "TAMPERED")
  assert.equal(check(role, "V4.contributors").code, "V_CONTRIBUTORS_MISMATCH")
})

test("V4 qualidade, período e avisos alterados (TOTAL) ⇒ V_QUALITY_MISMATCH; grupo com qualidade preenchida idem", () => {
  const b = bundle("netPnl")
  for (const fn of [
    (x: Any) => (x.evidence.metrics[0].dataQuality.level = "EMPTY"),
    (x: Any) => (x.evidence.metrics[0].dataQuality.r.unknownByReason.RISK_UNKNOWN = 99),
    (x: Any) => (x.evidence.metrics[0].period.fromLocalDate = "1999-01-01"),
    (x: Any) => x.evidence.metrics[0].warnings.pop(),
    (x: Any) => x.evidence.metrics[0].warnings.push({ code: "W_INVENTADO", severity: "WARNING", message: "x" }),
  ]) {
    const rep = verifyEvidence(edit(b, fn))
    assert.equal(rep.status, "TAMPERED")
    assert.equal(check(rep, "V4.quality").code, "V_QUALITY_MISMATCH")
  }
  const g = groupBundle("account", 0, "netPnl")
  assert.equal(check(verifyEvidence(edit(g, (x) => (x.evidence.metrics[0].warnings = [{ code: "W", severity: "INFO", message: "x" }]))), "V4.quality").status, "FAIL")
})

test("V4 opções inválidas ⇒ V_QUERY_INVALID (fuso, minSample, âncora, limite) — TAMPERED, sem exceção", () => {
  const b = bundle("netPnl")
  for (const fn of [
    (x: Any) => { x.evidence.metrics[0].query.options.timeZone = "Foo/Bar"; x.evidence.metrics[0].query.timeZone = "Foo/Bar" },
    (x: Any) => (x.evidence.metrics[0].query.options.minSample = 0),
    (x: Any) => (x.evidence.metrics[0].query.options.timeAnchor = "MIDDLE"),
    (x: Any) => (x.evidence.metrics[0].query.options.tradeIdsLimit = -1),
    (x: Any) => delete x.evidence.metrics[0].query.options.pnlBasis,
    (x: Any) => (x.evidence.metrics[0].query.timeZone = "UTC"), // diverge de options.timeZone
  ]) {
    const rep = verifyEvidence(edit(b, fn))
    assert.equal(rep.status, "TAMPERED")
    assert.equal(check(rep, "V4.query").code, "V_QUERY_INVALID")
  }
})

// ── versões incompatíveis ────────────────────────────────────────────────────

test("VERSÕES incompatíveis (engineVersion, definitionVersion) ⇒ UNVERIFIABLE (S_VERSION_INCOMPATIBLE), NÃO TAMPERED; métrica desconhecida no motor atual ⇒ TAMPERED", () => {
  const b = bundle("netPnl")
  for (const fn of [(x: Any) => (x.evidence.metrics[0].engineVersion = "metrics/0.9.0"), (x: Any) => (x.evidence.metrics[0].definitionVersion = "2")]) {
    const rep = verifyEvidence(edit(b, fn))
    assert.equal(rep.status, "UNVERIFIABLE")
    assert.deepEqual(fails(rep), [])
    assert.equal(check(rep, "V4.versions").code, "S_VERSION_INCOMPATIBLE")
    assert.equal(check(rep, "V4.metric-value").code, "S_VERSION_INCOMPATIBLE")
    assert.equal(check(rep, "V3.population").status, "PASS") // a população continua verificável
  }
  // versão antiga + valor adulterado: não se acusa (não dá para recalcular com este motor)
  const oldAndForged = verifyEvidence(edit(b, (x) => { x.evidence.metrics[0].engineVersion = "metrics/0.9.0"; x.evidence.metrics[0].value += 5 }))
  assert.equal(oldAndForged.status, "UNVERIFIABLE")
  const unknown = verifyEvidence(edit(b, (x) => { x.evidence.metrics[0].metricId = "metricaInventada"; x.subject.id = "metricaInventada" }))
  assert.equal(unknown.status, "TAMPERED")
  assert.equal(check(unknown, "V4.versions").code, "V_METRIC_UNKNOWN")
})

// ── proveniência incompleta ──────────────────────────────────────────────────

test("PROVENIÊNCIA incompleta ⇒ UNVERIFIABLE (S_PROVENANCE_INCOMPLETE), V3 passa mas VALID é recusado; contagens incoerentes ⇒ V_PROVENANCE_MISMATCH", () => {
  // trade sem rowHash em uma linha de origem (declarado pelo próprio pipeline/explainTrade como INCOMPLETE)
  const cycles = withRisk(imp.trades).map((t, i) => (i === 0 ? ({ ...t, sourceRows: t.sourceRows!.map((r, k) => (k === 0 ? { ...r, rowHash: undefined } : r)) } as CanonicalTrade) : t))
  const B = toAnalyticsTrades(cycles)
  const { result, trace } = calculateMetricsTraced(B)
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result, trace }, trades: B, importRecords: [rec] })
  assert.equal(r.ok, true)
  const inc = metricEvidenceBundle(r as Any)
  assert.ok(inc.evidence.trades.some((t) => t.provenance === "INCOMPLETE"))
  const rep = verifyEvidence(inc)
  assert.equal(rep.status, "UNVERIFIABLE")
  assert.deepEqual(fails(rep), [])
  assert.equal(check(rep, "V3.population").status, "PASS")
  assert.equal(check(rep, "V3.provenance").code, "S_PROVENANCE_INCOMPLETE")
  assert.match(check(rep, "V3.provenance").detail, /não dá para alegar verificação completa/)
  // declarar identidade ausente no bundle limpo ⇒ também UNVERIFIABLE
  const declared = verifyEvidence(edit(bundle("netPnl"), (x) => { x.evidence.metrics[0].population.provenance = { withIdentity: 13, withoutIdentity: 1 } }))
  assert.equal(declared.status, "UNVERIFIABLE")
  assert.equal(check(declared, "V3.provenance").code, "S_PROVENANCE_INCOMPLETE")
  const bad = verifyEvidence(edit(bundle("netPnl"), (x) => { x.evidence.metrics[0].population.provenance = { withIdentity: 3, withoutIdentity: 0 } }))
  assert.equal(bad.status, "TAMPERED")
  assert.equal(check(bad, "V3.provenance").code, "V_PROVENANCE_MISMATCH")
})

// ── HASH_ONLY ────────────────────────────────────────────────────────────────

test("HASH_ONLY: UNVERIFIABLE; V3/V4 SKIPPED (S_HASH_ONLY), nunca reconstrói hash com amostra; checks parciais continuam (V0–V2, proveniência das âncoras)", () => {
  for (const id of ["netPnl", "winners", "largestWinner", "maxDrawdown", "top3WinnersSharePct"]) {
    const b = bundle(id, A, [rec], { tradeIdsLimit: 3 })
    assert.equal(b.evidence.metrics[0].verifiability, "HASH_ONLY")
    const rep = verifyEvidence(b)
    assert.equal(rep.status, "UNVERIFIABLE", id)
    assert.deepEqual(fails(rep), [])
    assert.notEqual(rep.status as string, "VALID")
    for (const cid of ["V3.population", "V4.population", "V4.metric-value", "V4.metric-fields", "V4.contributors", "V4.quality"]) assert.equal(check(rep, cid).code, "S_HASH_ONLY", `${id} ${cid}`)
    for (const c of rep.checks.filter((x) => x.level === "V0" || x.level === "V1" || x.level === "V2")) assert.equal(c.status, "PASS", `${id} ${c.id}`)
    assert.equal(check(rep, "V3.provenance").status, "PASS") // das âncoras presentes
  }
})

test("HASH_ONLY âncoras: largestWinner/largestLoser conferidos pelo MESMO motor sobre a âncora; adulteração detectada; demais métricas ⇒ S_NO_ANCHOR_CHECK (não afirma)", () => {
  for (const id of ["largestWinner", "largestLoser"]) {
    const b = bundle(id, A, [rec], { tradeIdsLimit: 3 })
    assert.equal(check(verifyEvidence(b), "V4.anchors").status, "PASS", id)
    // valor adulterado (selo recalculado) ⇒ acusa
    const v = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].value += 1)))
    assert.equal(v.status, "TAMPERED")
    assert.equal(check(v, "V4.anchors").code, "V_ANCHOR_MISMATCH")
    // pnl da âncora adulterado ⇒ acusa
    const p = verifyEvidence(edit(b, (x) => { const a = x.evidence.metrics[0].contributors.items[0]; const t = x.evidence.trades.find((q: Any) => q.tradeId === a.tradeId); t.pnl.net += 100; t.pnl.gross += 100 }))
    assert.equal(p.status, "TAMPERED")
    assert.equal(check(p, "V4.anchors").status, "FAIL")
    // âncora removida da lista (roleCounts continua dizendo que existe) ⇒ V2 acusa
    const r = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].contributors.items = x.evidence.metrics[0].contributors.items.filter((i: Any) => i.role !== (id === "largestWinner" ? "LARGEST_WINNER" : "LARGEST_LOSER")))))
    assert.equal(r.status, "TAMPERED")
    assert.equal(check(r, "V2.contributor-counts").status, "FAIL")
  }
  const other = verifyEvidence(bundle("netPnl", A, [rec], { tradeIdsLimit: 3 }))
  assert.equal(check(other, "V4.anchors").code, "S_NO_ANCHOR_CHECK")
  // LIMITE assumido: valor de netPnl adulterado em população HASH_ONLY NÃO é detectável sem a população completa ⇒ fica UNVERIFIABLE, sem afirmar nada
  const forged = verifyEvidence(edit(bundle("netPnl", A, [rec], { tradeIdsLimit: 3 }), (x) => (x.evidence.metrics[0].value += 1)))
  assert.equal(forged.status, "UNVERIFIABLE")
  assert.deepEqual(fails(forged), [])
  assert.equal(check(forged, "V4.metric-value").code, "S_HASH_ONLY")
})

// ── grupos e associação ──────────────────────────────────────────────────────

test("GRUPOS: por conta, hora, direção e conta×hora ⇒ VALID (conta por accountRef; dimensões do grupo e sampleFlag conferidos pelo motor)", () => {
  for (const by of ["account", "hour", "direction", "dayOfWeek", ["account", "hour"]] as const) {
    const n = aggregateTrades(A, { groupBy: by as Any }).groups.length
    assert.ok(n >= 1)
    for (let i = 0; i < n; i++) {
      for (const id of ["netPnl", "totalR", "maxDrawdown", "profitFactor", "winRate", "totalPoints"]) {
        const rep = verifyEvidence(groupBundle(by, i, id))
        assert.equal(rep.status, "VALID", `${JSON.stringify(by)}#${i} ${id}: ${JSON.stringify(rep.checks.filter((c) => c.status !== "PASS" && c.code !== "S_NOT_APPLICABLE").map((c) => [c.id, c.code, c.detail.slice(0, 100)]))}`)
        assert.equal(check(rep, "V4.association").status, "PASS")
      }
    }
  }
})

test("GRUPOS adulterados: chave com outra conta/hora, sampleFlag trocado, groupBy removido ⇒ V_ASSOCIATION_MISMATCH", () => {
  const g = groupBundle("account", 0, "netPnl")
  const other = groupBundle("account", 1, "netPnl").evidence.metrics[0].query.groupKey
  assert.equal(check(verifyEvidence(edit(g, (x) => (x.evidence.metrics[0].query.groupKey = other))), "V4.association").code, "V_ASSOCIATION_MISMATCH")
  const h = groupBundle("hour", 0, "netPnl")
  assert.equal(check(verifyEvidence(edit(h, (x) => (x.evidence.metrics[0].query.groupKey = ["23"]))), "V4.association").status, "FAIL")
  assert.equal(check(verifyEvidence(edit(h, (x) => (x.evidence.metrics[0].sampleFlag = x.evidence.metrics[0].sampleFlag === "OK" ? "TINY" : "OK"))), "V4.association").status, "FAIL")
  assert.equal(check(verifyEvidence(edit(h, (x) => (x.evidence.metrics[0].query.groupBy = null))), "V4.association").status, "FAIL")
  assert.equal(check(verifyEvidence(edit(h, (x) => (x.evidence.metrics[0].sampleFlag = null))), "V4.association").status, "FAIL")
  // o valor do grupo continua verificado sobre os trades declarados
  assert.equal(check(verifyEvidence(edit(h, (x) => (x.evidence.metrics[0].value += 1))), "V4.metric-value").status, "FAIL")
  // escopo TOTAL não pode ter groupKey
  assert.equal(check(verifyEvidence(edit(bundle("netPnl"), (x) => (x.evidence.metrics[0].query.groupKey = ["x"]))), "V4.association").status, "FAIL")
})

test("ASSOCIAÇÃO impossível ⇒ SKIPPED (S_ASSOCIATION_UNVERIFIABLE), nunca PASS: grupo por estratégia/sessão, filtro de estratégia/sessão; o que tem referência é conferido", () => {
  for (const by of ["strategy", "session", ["account", "strategy"]] as const) {
    const rep = verifyEvidence(groupBundle(by, 0, "netPnl"))
    assert.equal(rep.status, "UNVERIFIABLE", JSON.stringify(by))
    assert.deepEqual(fails(rep), [])
    assert.equal(check(rep, "V4.association").code, "S_ASSOCIATION_UNVERIFIABLE")
    assert.match(check(rep, "V4.association").detail, /a Evidence não tem referência/)
    assert.equal(check(rep, "V4.metric-value").status, "PASS") // a conta sobre a população declarada continua verificada
  }
  const strat = verifyEvidence(bundle("netPnl", A, [rec], { filters: { strategyName: "Estrategia Teste" } } as Any))
  assert.equal(strat.status, "UNVERIFIABLE")
  assert.equal(check(strat, "V4.association").code, "S_ASSOCIATION_UNVERIFIABLE")
  // conta × estratégia: a conta é conferida por accountRef, a estratégia não
  const both = verifyEvidence(groupBundle(["account", "strategy"], 0, "netPnl"))
  assert.match(check(both, "V4.association").detail, /strategy/)
  assert.match(check(both, "V4.association").detail, /2 verificação/) // conta por accountRef + sampleFlag; a estratégia não
})

test("FILTROS: conta por accountRef, símbolo/direção/hora/dia derivados pelo MESMO motor; população que viola o filtro declarado ⇒ V_ASSOCIATION_MISMATCH (só prova consistência, não a seleção original)", () => {
  const acc = bundle("netPnl", A, [rec], { filters: { account: "Sim101" } } as Any)
  assert.equal(verifyEvidence(acc).status, "VALID")
  assert.equal(check(verifyEvidence(acc), "V4.association").status, "PASS")
  assert.equal(check(verifyEvidence(edit(acc, (x) => (x.evidence.metrics[0].query.filters.accountRefs = [`acc_${"0".repeat(24)}`]))), "V4.association").code, "V_ASSOCIATION_MISMATCH")
  const dir = bundle("netPnl", A, [rec], { filters: { direction: "LONG", hour: 9 } } as Any)
  assert.equal(verifyEvidence(dir).status, "VALID")
  const bad = verifyEvidence(edit(dir, (x) => (x.evidence.metrics[0].query.filters.direction = "SHORT")))
  assert.equal(bad.status, "TAMPERED")
  assert.equal(check(bad, "V4.association").status, "FAIL")
  // o bundle filtrado declara só a população filtrada: o verificador não sabe (nem afirma) o que ficou de fora
  assert.deepEqual(verifyEvidence(dir).limitations.map((l) => l.code), ["L_SEAL_NOT_SIGNATURE", "L_SELECTION_NOT_PROVEN", "L_ORIGIN_NOT_PROVEN"])
})

// ── ordem em empates de saída (E5.2 → resolvido pelo registro da ordem; testes completos em test-evidence-sequence.mts) ──

test("EMPATE DE SAÍDA: a Evidence registra a ordem do motor ⇒ métrica sequencial VALID (antes: UNVERIFIABLE); sem a ordem registrada ⇒ UNVERIFIABLE com motivo explícito", () => {
  const tie = runImportPipeline(synthCsv(rowsOf([2, -3, 4, 1], { exitSame: true, account: () => "Sim101" })), { sourceTz: BRT, fileName: "empate.csv", reconstructCycles: false })
  const T = toAnalyticsTrades(withRisk(tie.trades))
  const R = tie.importRecord as ImportRecord
  assert.equal(new Set(T.map((t) => t.trade.exit.at.instantUtc)).size, 1, "todas as saídas empatam")
  const winsA = calculateMetrics(T).metrics.maxConsecutiveWins.value
  const winsC = calculateMetrics([T[1], T[0], T[2], T[3]]).metrics.maxConsecutiveWins.value
  assert.notEqual(winsA, winsC, "a métrica depende da ordem de entrada")
  const ok = bundle("maxConsecutiveWins", T, [R])
  assert.equal(ok.evidence.metrics[0].population.sequence.dependent, true)
  assert.deepEqual(ok.evidence.metrics[0].population.sequence.order, T.map((t) => t.id)) // a ordem de entrada dos dados = a que o motor usou
  assert.equal(verifyEvidence(ok).status, "VALID")
  // tirar a ordem registrada (com selo refeito) NÃO vira VALID: UNVERIFIABLE com motivo explícito
  const stripped = verifyEvidence(edit(ok, (x) => (x.evidence.metrics[0].population.sequence.order = null)))
  assert.equal(stripped.status, "UNVERIFIABLE")
  assert.deepEqual(fails(stripped), [])
  for (const cid of ["V4.sequence", "V4.metric-value", "V4.metric-fields", "V4.contributors"]) assert.equal(check(stripped, cid).code, "S_ORDER_NOT_RECORDED")
  assert.match(check(stripped, "V4.sequence").detail, /não registra a ordem/)
  for (const id of ["netPnl", "winRate", "profitFactor", "totalR"]) assert.equal(verifyEvidence(bundle(id, T, [R])).status, "VALID", id)
  assert.equal(check(verifyEvidence(edit(bundle("netPnl", T, [R]), (x) => (x.evidence.metrics[0].value += 1))), "V4.metric-value").status, "FAIL")
})

// ── drawdown e R: oráculo à mão ──────────────────────────────────────────────

/**
 * Amostra de RISCO CONHECIDO (stop sempre 10 pts atrás da entrada; MGC US$ 10/ponto; comissão US$ 2,40; 1 contrato):
 *   net_i = 10·pts_i − 2,40 · risco = 10 pts × US$ 10 = US$ 100  ⇒  R_i = net_i / 100 = 0,1·pts_i − 0,024
 *   pts = [10, −20, −10, 40, −30, −10, 20]  ⇒  R = [0,976  −2,024  −1,024  3,976  −3,024  −1,024  1,976]
 *   equity R   = [0,976  −1,048  −2,072  1,904  −1,120  −2,144  −0,168]   (pico inicial 0)
 *   maxDrawdownR = 1,904 − (−2,144) = 4,048   pico = trade 4 · janela = trade 5 · vale = trade 6 · nunca recuperado (−0,168 < 1,904)
 *   totalR = −0,168 · averageR = −0,024 · medianR = −1,024 · winRateR = 3/7 = 42,86
 *   equity US$ = [97,60  −104,80  −207,20  190,40  −112,00  −214,40  −16,80]
 *   maxDrawdown = 190,40 + 214,40 = 404,80 · currentDrawdown = 190,40 + 16,80 = 207,20 · recoveryFactor = −16,80 / 404,80 = −0,0415
 *   Com rBasis POINTS: R_i = pts_i/10 = [1 −2 −1 4 −3 −1 2] ⇒ equity [1 −1 −2 2 −1 −2 0] ⇒ maxDrawdownR = 2 − (−2) = 4
 */
const DD_PTS = [10, -20, -10, 40, -30, -10, 20]
const ddImp = runImportPipeline(synthCsv(rowsOf(DD_PTS, { account: () => "Sim101" })), { sourceTz: BRT, fileName: "dd.csv" })
const ddTrades = withRisk(ddImp.trades, [10])
const DD = toAnalyticsTrades(ddTrades)
const ddRec = ddImp.importRecord as ImportRecord
const ddId = (n: number) => ddTrades[n - 1].tradeId as string

test("maxDrawdownR (dedicado): oráculo à mão — R conhecido, motor normal ≡ traced, MetricEvidence reproduz, V4 confirma, adulteração relevante é detectada", () => {
  const expectedR = [0.976, -2.024, -1.024, 3.976, -3.024, -1.024, 1.976]
  ddTrades.forEach((t, i) => assert.equal(t.r.net, expectedR[i], `R do trade ${i + 1}`))
  const normal = calculateMetrics(DD)
  const traced = calculateMetricsTraced(DD)
  assert.equal(canonicalJson(traced.result), canonicalJson(normal), "motor normal ≡ traced")
  assert.deepEqual(
    ["maxDrawdownR", "maxDrawdown", "currentDrawdown", "recoveryFactor", "totalR", "averageR", "medianR", "winRateR"].map((m) => normal.metrics[m].value),
    [4.048, 404.8, 207.2, -0.0415, -0.168, -0.024, -1.024, 42.86],
  )
  // contribuintes do trace: pico = trade 4 (rank 4), janela = trade 5, vale = trade 6, sem recuperação
  const mt = traced.trace.metrics.maxDrawdownR
  assert.deepEqual(mt.contributors?.map((c) => [c.role, c.tradeId, c.rank]), [["DRAWDOWN_PEAK", ddId(4), 4], ["DRAWDOWN_WINDOW", ddId(5), 5], ["DRAWDOWN_TROUGH", ddId(6), 6]])
  // MetricEvidence reproduz
  const b = bundle("maxDrawdownR", DD, [ddRec])
  const me = b.evidence.metrics[0]
  assert.equal(me.value, 4.048)
  assert.equal(me.unit, "R")
  assert.deepEqual(me.contributors.items.map((c) => [c.role, c.tradeId, c.rank]), [["DRAWDOWN_PEAK", ddId(4), 4], ["DRAWDOWN_WINDOW", ddId(5), 5], ["DRAWDOWN_TROUGH", ddId(6), 6]])
  // V4 confirma
  const rep = verifyEvidence(b)
  assert.equal(rep.status, "VALID")
  for (const cid of ["V3.population", "V4.population", "V4.metric-value", "V4.metric-fields", "V4.contributors", "V4.quality"]) assert.equal(check(rep, cid).status, "PASS", cid)
  // adulterações relevantes (selo recalculado)
  const wrongValue = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].value = 3.048)))
  assert.equal(wrongValue.status, "TAMPERED")
  assert.equal(check(wrongValue, "V4.metric-value").code, "V_METRIC_VALUE_MISMATCH")
  const wrongPeak = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].contributors.items[0].tradeId = ddId(3))))
  assert.equal(wrongPeak.status, "TAMPERED")
  assert.equal(check(wrongPeak, "V4.contributors").status, "FAIL")
  const forgedR = verifyEvidence(edit(b, (x) => (x.evidence.trades.find((t: Any) => t.tradeId === ddId(5)).r.net = -1)))
  assert.equal(forgedR.status, "TAMPERED")
  assert.equal(check(forgedR, "V3.population").status, "FAIL") // r.net faz parte do fingerprint: o trade da janela do drawdown foi mexido
  const forgedSeq = verifyEvidence(edit(b, (x) => { const t = x.evidence.trades.find((q: Any) => q.tradeId === ddId(5)); t.exit.at.instantUtc = "2020-01-01T00:00:00.000Z" }))
  assert.equal(forgedSeq.status, "TAMPERED") // reordenar a sequência de saída muda a curva — também está no fingerprint
})

test("maxDrawdownR com rBasis POINTS e as demais métricas de drawdown e de R conferem com a tabela à mão e passam no V4", () => {
  const pts = calculateMetrics(DD, { rBasis: "POINTS" })
  assert.equal(pts.metrics.maxDrawdownR.value, 4)
  assert.equal(pts.metrics.totalR.value, 0) // 1−2−1+4−3−1+2
  for (const args of [{}, { rBasis: "POINTS" as const }]) for (const id of ["maxDrawdownR", "maxDrawdown", "currentDrawdown", "recoveryFactor", "totalR", "averageR", "medianR", "winRateR", "expectancyR", "averageWinnerR", "averageLoserR"]) {
    const rep = verifyEvidence(bundle(id, DD, [ddRec], args))
    assert.equal(rep.status, "VALID", `${id} ${JSON.stringify(args)}`)
  }
  const forged = verifyEvidence(edit(bundle("maxDrawdownR", DD, [ddRec], { rBasis: "POINTS" }), (x) => (x.evidence.metrics[0].query.options.rBasis = "NET")))
  assert.equal(forged.status, "TAMPERED") // 4 (pontos) ≠ 4,048 (líquido)
})

test("MÉTRICAS DE R: o motivo de R ausente (netReason) e pointsPerContract NÃO estão no fingerprint — V4 os cobre quando a métrica do bundle depende deles; V3 não", () => {
  const b = bundle("totalR")
  const idx = b.evidence.trades.findIndex((t) => t.r.net === null && t.r.netReason !== null)
  assert.ok(idx >= 0)
  const reason = verifyEvidence(edit(b, (x) => (x.evidence.trades[idx].r.netReason = x.evidence.trades[idx].r.netReason === "RISK_UNKNOWN" ? "NET_PNL_UNAVAILABLE" : "RISK_UNKNOWN")))
  assert.equal(reason.status, "TAMPERED")
  assert.equal(check(reason, "V3.population").status, "PASS")
  assert.equal(check(reason, "V4.quality").status, "FAIL")
  const ppc = verifyEvidence(edit(bundle("totalPoints"), (x) => (x.evidence.trades[0].pointsPerContract += 1)))
  assert.equal(ppc.status, "TAMPERED")
  assert.equal(check(ppc, "V3.population").status, "PASS")
  assert.equal(check(ppc, "V4.metric-value").status, "FAIL")
})

test("LIMITE CONHECIDO (documentado, não escondido): campo do TradeEvidence que nem o fingerprint nem a métrica do bundle usam (ex.: pointsPerContract num bundle de netPnl) só é protegido pelo selo", () => {
  const rep = verifyEvidence(edit(bundle("netPnl"), (x) => (x.evidence.trades[0].pointsPerContract += 1)))
  assert.equal(rep.status, "VALID") // verdade: nada que o netPnl usa foi tocado — VALID significa "os números DESTE bundle são reproduzíveis", não "todo campo do trade é autêntico"
  assert.ok(rep.limitations.some((l) => l.code === "L_ORIGIN_NOT_PROVEN")) // a prova de autenticidade campo a campo é o CSV original (E5b)
})

// ── relatório ────────────────────────────────────────────────────────────────

test("RELATÓRIO: determinístico, 31 checks fixos, limitations sempre presentes; V3/V4 não vazam nome de conta", () => {
  for (const b of [bundle("netPnl"), groupBundle("account", 0, "netPnl"), bundle("netPnl", A, [rec], { tradeIdsLimit: 3 }), edit(bundle("netPnl"), (x) => (x.evidence.metrics[0].value += 1))]) {
    const a = verifyEvidence(b)
    assert.equal(canonicalJson(a), canonicalJson(verifyEvidence(clone(b))))
    assert.equal(a.checks.length, 31)
    assert.equal(a.limitations.length, 3)
    assert.ok(!/Sim10\d/.test(JSON.stringify(a)))
  }
})

// ── fixtures reais (locais; sem números embutidos) ───────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
const C = { bundles: 0, valid: 0, unverifiable: 0, fails: 0, ambiguous: 0, hashOnly: 0, attacks: 0, detected: 0, missed: 0, tamperedStatus: 0 }
const bump = (v: number | null) => (v === null ? 1 : v + 1)
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  test(`REAL ${tag}: ciclos e linhas × com/sem R × todas as métricas × total/grupos/HASH_ONLY ⇒ zero FAIL em bundle limpo; ataques de população e de cálculo sempre detectados quando verificáveis`, () => {
    for (const label of ["ciclos", "linhas"] as const) for (const risk of [false, true]) {
      const run = runImportPipeline(text, { ...ctx, fileName: `conta-${tag}.csv`, ...(label === "linhas" ? { reconstructCycles: false } : {}) })
      const record = run.importRecord as ImportRecord
      const An = toAnalyticsTrades(risk ? withRisk(run.trades) : run.trades)
      const bundles: EvidenceBundle[] = []
      const push = (id: string, source: MetricSource) => {
        const r = explainMetric({ metricId: id, source, trades: An, importRecords: [record] })
        assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
        bundles.push(metricEvidenceBundle(r as Any))
      }
      const tm = calculateMetricsTraced(An)
      for (const id of METRIC_IDS) push(id, { kind: "METRICS", result: tm.result, trace: tm.trace })
      for (const by of ["account", "hour", ["account", "hour"], "direction", "dayOfWeek"] as const) {
        const ag = aggregateTradesTraced(An, { groupBy: by as Any })
        ag.result.groups.forEach((_, i) => { for (const id of METRIC_IDS) push(id, { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: i } }) })
      }
      const low = calculateMetricsTraced(An, { tradeIdsLimit: 3 })
      for (const id of ["netPnl", "winners", "largestWinner", "largestLoser", "maxDrawdown", "top3WinnersSharePct"]) push(id, { kind: "METRICS", result: low.result, trace: low.trace })

      bundles.forEach((b, n) => {
        C.bundles += 1
        const rep = verifyEvidence(b)
        const bad = rep.checks.filter((c) => c.status === "FAIL")
        C.fails += bad.length
        assert.deepEqual(bad.map((c) => [c.id, c.code, c.detail.slice(0, 160)]), [], `${label}/${risk} #${n} ${b.subject.id}`)
        assert.ok(rep.status === "VALID" || rep.status === "UNVERIFIABLE")
        if (rep.status === "VALID") {
          C.valid += 1
          assert.ok(rep.checks.every((c) => c.status === "PASS" || c.code === "S_NOT_APPLICABLE"))
        } else {
          C.unverifiable += 1
          const why = blockingSkips(rep)
          assert.ok(why.length > 0)
          // só os motivos conhecidos podem impedir VALID em dado limpo
          for (const w of why) assert.ok(/S_HASH_ONLY|S_ORDER_NOT_RECORDED|S_NO_ANCHOR_CHECK|S_ASSOCIATION_UNVERIFIABLE/.test(w), `${label} #${n} ${b.subject.id}: ${w}`)
          if (why.some((w) => w.includes("S_ORDER_NOT_RECORDED"))) C.ambiguous += 1
          if (why.some((w) => w.includes("S_HASH_ONLY"))) C.hashOnly += 1
        }
        if (n % 5 !== 0) return // ataques em amostra
        const me = b.evidence.metrics[0]
        const hasTrades = b.evidence.trades.length > 0 // HASH_ONLY sem âncoras (ex.: drawdown zero) não tem nenhum trade para adulterar
        const full = me.verifiability === "FULL" && hasTrades
        const attacks: Array<[string, (x: Any) => void, (r: VerifyReport) => boolean, boolean]> = [
          ["pnl.net", (x) => (x.evidence.trades[0].pnl.net = bump(x.evidence.trades[0].pnl.net)), (r) => check(r, "V3.population").status === "FAIL" || check(r, "V2.population-refs").status === "FAIL", full],
          ["rowHash", (x) => (x.evidence.trades[0].sourceRows[0].rowHash = "f".repeat(64)), (r) => check(r, "V3.population").status === "FAIL", full],
          ["tradeSetHash declarado", (x) => (x.evidence.metrics[0].population.tradeSetHash = "c".repeat(64)), (r) => check(r, "V3.population").status === "FAIL" && check(r, "V4.population").status === "FAIL", full],
          ["value", (x) => (x.evidence.metrics[0].value = bump(x.evidence.metrics[0].value)), (r) => check(r, "V4.metric-value").status === "FAIL", full && rep.checks.find((c) => c.id === "V4.metric-value")?.status === "PASS"],
          ["value (âncora)", (x) => (x.evidence.metrics[0].value = bump(x.evidence.metrics[0].value)), (r) => check(r, "V4.anchors").status === "FAIL", !full && (me.metricId === "largestWinner" || me.metricId === "largestLoser") && check(rep, "V4.anchors").status === "PASS"],
          ["engineVersion", (x) => (x.evidence.metrics[0].engineVersion = "metrics/0.0.1"), (r) => r.status === "UNVERIFIABLE" && !fails(r).length, true],
          ["trade removido", (x) => x.evidence.trades.shift(), (r) => r.status === "TAMPERED" && check(r, "V3.population").status !== "PASS", hasTrades],
        ]
        for (const [what, fn, detected, applicable] of attacks) {
          if (!applicable) continue
          C.attacks += 1
          const r = verifyEvidence(edit(b, fn))
          if (r.status === "TAMPERED") C.tamperedStatus += 1
          if (detected(r)) C.detected += 1
          else C.missed += 1
          assert.ok(detected(r), `${label}/${risk} #${n} ${b.subject.id}: ataque "${what}" não detectado como esperado (${r.status}: ${JSON.stringify(r.checks.filter((c) => c.status !== "PASS").map((c) => `${c.id}:${c.code}`))})`)
        }
      })
    }
  })
}
if (names.length) console.log(`  → fixtures reais: ${C.bundles} bundles verificados · ${C.valid} VALID, ${C.unverifiable} UNVERIFIABLE (${C.hashOnly} HASH_ONLY, ${C.ambiguous} com ordem não registrada) · ${C.fails} FAIL em bundles limpos · ${C.attacks} ataques em amostra: ${C.detected} detectados, ${C.missed} não detectados (${C.tamperedStatus} TAMPERED)`)

console.log(`\n${passed} testes ok`)
