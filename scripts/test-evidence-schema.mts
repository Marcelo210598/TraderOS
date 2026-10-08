// Evidence E2 — schema evidence/1, tradeSetHash (SHA-256) e evidenceHash.   node scripts/test-evidence-schema.mts
// Não há geradores de Evidence ainda (E3–E5): os bundles aqui são montados no próprio teste a partir do pipeline/métricas.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade } from "../src/lib/domain/canonical.ts"
import { computeEvidenceHash, EVIDENCE_SCHEMA, sealEvidence, tradeFingerprint, tradeSetHash } from "../src/lib/evidence/hash.ts"
import { explainMetric, type ExplainMetricOk } from "../src/lib/evidence/explain-metric.ts"
import { explainTrades } from "../src/lib/evidence/explain-trade.ts"
import { EvidenceBundleSchema, MetricEvidenceSchema, TradeEvidenceSchema, type EvidenceBundle, type MetricEvidence, type TradeEvidence } from "../src/lib/evidence/schema.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { aggregateTrades, calculateMetrics, calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"

const CSV = readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/ninjatrader-ptbr-cycles.csv", import.meta.url)), "utf8")
const imp = runImportPipeline(CSV, { sourceTz: "America/Sao_Paulo", fileName: "cycles.csv" })
const trades = imp.trades

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const hashOf = (ts: CanonicalTrade[], args: Parameters<typeof calculateMetrics>[1] = {}) => calculateMetrics(toAnalyticsTrades(ts), args).population.tradeSetHash
const reverseKeys = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(reverseKeys) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reverseKeys(v)])) : x

// ── montagem de um bundle de teste ───────────────────────────────────────────

const explained = explainTrades(trades, imp.importRecord!).map((r) => {
  assert.equal(r.ok, true)
  return r as Extract<(typeof explainTrades extends (...a: never[]) => (infer R)[] ? R : never), { ok: true }>
})
const tradeEvidenceOf = (t: CanonicalTrade): TradeEvidence => explained[trades.indexOf(t)].tradeEvidence

function metricEvidenceOf(metricId: string, computedAt: string | null = null): MetricEvidence {
  const analytics = toAnalyticsTrades(trades)
  const { result, trace } = calculateMetricsTraced(analytics)
  const r = explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades: analytics, importRecords: [imp.importRecord!] })
  assert.equal(r.ok, true, r.ok ? "" : r.message)
  return { ...(r as ExplainMetricOk).metricEvidence, computedAt }
}

const unsealed = (importedAt: string | null = null, computedAt: string | null = null): Omit<EvidenceBundle, "evidenceHash"> => ({
  schema: EVIDENCE_SCHEMA,
  claim: { kind: "METRIC", statement: "net P&L total" },
  subject: { type: "METRIC", id: "netPnl" },
  evidence: { imports: [{ ...explained[0].importRef, importedAt }], trades: trades.map(tradeEvidenceOf), metrics: [metricEvidenceOf("netPnl", computedAt)] },
})
const sealed = () => sealEvidence(unsealed())

// ── tradeSetHash ─────────────────────────────────────────────────────────────

test("tradeSetHash: SHA-256 (64 hex) em MetricsResult e em cada GroupResult; hash53 (14 chars) não existe mais", () => {
  const r = calculateMetrics(toAnalyticsTrades(trades))
  assert.match(r.population.tradeSetHash, /^[0-9a-f]{64}$/)
  const agg = aggregateTrades(toAnalyticsTrades(trades), { groupBy: "symbol" })
  assert.match(agg.total.population.tradeSetHash, /^[0-9a-f]{64}$/)
  assert.ok(agg.groups.length >= 2)
  assert.ok(agg.groups.every((g) => /^[0-9a-f]{64}$/.test(g.tradeSetHash)))
  assert.equal(new Set(agg.groups.map((g) => g.tradeSetHash)).size, agg.groups.length)
})

test("tradeSetHash: independe da ORDEM dos trades e é reprodutível entre execuções", () => {
  assert.equal(hashOf(trades), hashOf([...trades].reverse()))
  assert.equal(hashOf(trades), hashOf(trades))
  const again = runImportPipeline(CSV, { sourceTz: "America/Sao_Paulo", fileName: "outro.csv" })
  assert.equal(hashOf(again.trades), hashOf(trades)) // nome do arquivo não entra
})

test("tradeSetHash: cobre a população COMPLETA — o limite de tradeIds não muda o hash e acima dele a lista some", () => {
  const all = hashOf(trades)
  const limited = calculateMetrics(toAnalyticsTrades(trades), { tradeIdsLimit: 1 })
  assert.equal(limited.population.tradeIds, null)
  assert.equal(limited.population.tradeSetHash, all)
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...clone(trades[0]), tradeId: `trd_${i}`, source: { ...trades[0].source, rowNo: i + 2 } })) as CanonicalTrade[]
  const base = calculateMetrics(toAnalyticsTrades(ten), { tradeIdsLimit: 3 }).population
  assert.equal(base.tradeIds, null)
  const edited = clone(ten)
  edited[9].pnl.net = (edited[9].pnl.net ?? 0) + 0.25 // alteração num trade que nunca apareceria numa lista truncada
  assert.notEqual(calculateMetrics(toAnalyticsTrades(edited), { tradeIdsLimit: 3 }).population.tradeSetHash, base.tradeSetHash)
})

test("FINGERPRINT: muda com importId, rowHash, tradeId e identidade da reconstrução (não só com valores financeiros)", () => {
  const h0 = hashOf(trades)
  const mut = (fn: (ts: CanonicalTrade[]) => void) => {
    const ts = clone(trades)
    fn(ts)
    return hashOf(ts)
  }
  assert.notEqual(mut((ts) => { ts[0].importId = "imp_outro" }), h0)
  assert.notEqual(mut((ts) => { ts[0].tradeId = "trd_outro" }), h0)
  assert.notEqual(mut((ts) => { ts[0].sourceRows![0].rowHash = "0".repeat(64) }), h0)
  assert.notEqual(mut((ts) => { ts[0].reconstruction!.confidence = "LOW" }), h0)
  assert.notEqual(mut((ts) => { ts[0].reconstruction!.completeness = "UNVERIFIED_HEAD" }), h0)
  assert.notEqual(mut((ts) => { ts[0].reconstruction!.method = "FILLS_FLAT_TO_FLAT" }), h0)
  assert.notEqual(mut((ts) => { ts[0].granularity = "SOURCE_ROW" }), h0)
  assert.notEqual(mut((ts) => { ts[0].pnl.commission = (ts[0].pnl.commission ?? 0) + 0.01 }), h0)
  assert.equal(mut(() => {}), h0)
  // imports diferentes ⇒ populações diferentes, mesmo com valores iguais
  const other = runImportPipeline(CSV.replace("Sim101", "Sim101"), { sourceTz: "America/New_York" })
  assert.notEqual(hashOf(other.trades), h0)
})

test("tradeFingerprint/tradeSetHash direto: ordem das entradas e das rowHashes irrelevante", () => {
  const fps = trades.map((t, i) => tradeFingerprint(`id${i}`, t))
  assert.equal(tradeSetHash(fps), tradeSetHash([...fps].reverse()))
  assert.notEqual(tradeSetHash(fps), tradeSetHash(fps.slice(1)))
  assert.notEqual(tradeSetHash([]), tradeSetHash(fps))
})

// ── fallback sem identidade ──────────────────────────────────────────────────

test("FALLBACK: trade sem identidade continua funcionando (id posicional) mas a proveniência incompleta é SINALIZADA", () => {
  const stripped = clone(trades).map((t) => {
    delete t.tradeId
    delete t.importId
    return t
  })
  const r = calculateMetrics(toAnalyticsTrades(stripped))
  assert.deepEqual(r.population.provenance, { withIdentity: 0, withoutIdentity: stripped.length })
  assert.ok(r.population.tradeIds!.every((id) => id.startsWith("file:")))
  const w = r.warnings.find((x) => x.code === "W_TRADE_IDENTITY_MISSING")
  assert.ok(w && w.severity === "INFO")
  const full = calculateMetrics(toAnalyticsTrades(trades))
  assert.deepEqual(full.population.provenance, { withIdentity: trades.length, withoutIdentity: 0 })
  assert.equal(full.warnings.some((x) => x.code === "W_TRADE_IDENTITY_MISSING"), false)
  assert.ok(full.population.tradeIds!.every((id) => id.startsWith("trd_")))
  assert.notEqual(r.population.tradeSetHash, full.population.tradeSetHash)
  // os NÚMEROS são idênticos com ou sem identidade — só a proveniência (e os ids citados em `details`) mudam
  const numbers = (m: typeof r.metrics) => Object.values(m).map((x) => [x.metric, x.value, x.sampleSize, x.coverage, x.available, x.reason, x.basis])
  assert.deepEqual(numbers(r.metrics), numbers(full.metrics))
})

// ── schema evidence/1 ────────────────────────────────────────────────────────

test("SCHEMA: bundle montado a partir do pipeline e das métricas é válido (evidence/1)", () => {
  const b = sealed()
  const parsed = EvidenceBundleSchema.safeParse(b)
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)))
  assert.equal(b.schema, "evidence/1")
  assert.ok(b.evidence.trades.every((t) => t.provenance === "COMPLETE" && /^acc_/.test(t.accountRef ?? "")))
  assert.ok(b.evidence.trades.every((t) => t.sourceRows.every((r) => r.importId === b.evidence.imports[0].importId && r.rowHash?.length === 64)))
})

test("PRIVACIDADE: TradeEvidence só tem accountRef — `sourceName` é rejeitado em qualquer nível e o nome da conta não aparece no bundle", () => {
  const t = tradeEvidenceOf(trades[0])
  assert.equal(TradeEvidenceSchema.safeParse(t).success, true)
  assert.equal(TradeEvidenceSchema.safeParse({ ...t, sourceName: "Sim101" }).success, false)
  assert.equal(TradeEvidenceSchema.safeParse({ ...t, account: { sourceName: "Sim101" } }).success, false)
  assert.equal(TradeEvidenceSchema.safeParse({ ...t, accountRef: undefined }).success, false)
  // a chave do ciclo no Canonical TEM o nome da conta; na Evidence só o ref (o schema recusa o nome e exige a forma redigida)
  assert.equal(trades[0].reconstruction!.cycleKey.account, trades[0].account.sourceName)
  assert.equal(TradeEvidenceSchema.safeParse({ ...t, reconstruction: trades[0].reconstruction }).success, false)
  assert.equal(t.reconstruction!.cycleKey.accountRef, trades[0].account.ref)
  assert.equal("account" in t.reconstruction!.cycleKey, false)
  const name = trades[0].account.sourceName as string
  assert.ok(name.length > 0)
  assert.ok(!JSON.stringify(sealed()).includes(name))
  assert.ok(!Object.keys(TradeEvidenceSchema.shape).some((k) => /sourceName|accountName/i.test(k)))
})

test("SCHEMA estrito: campo desconhecido, schema errado e hash malformado são rejeitados; não há campo para copiar o CSV", () => {
  const b = sealed()
  assert.equal(EvidenceBundleSchema.safeParse({ ...b, extra: 1 }).success, false)
  assert.equal(EvidenceBundleSchema.safeParse({ ...b, schema: "evidence/2" }).success, false)
  assert.equal(EvidenceBundleSchema.safeParse({ ...b, evidenceHash: "abc" }).success, false)
  assert.equal(MetricEvidenceSchema.safeParse({ ...b.evidence.metrics[0], population: { ...b.evidence.metrics[0].population, tradeSetHash: "x".repeat(14) } }).success, false)
  assert.equal(TradeEvidenceSchema.safeParse({ ...b.evidence.trades[0], rawCsvLine: "1;MGC;..." }).success, false)
})

// ── evidenceHash ─────────────────────────────────────────────────────────────

test("evidenceHash: SHA-256 estável, reprodutível e coerente com computeEvidenceHash", () => {
  const a = sealed()
  const b = sealed()
  assert.match(a.evidenceHash, /^[0-9a-f]{64}$/)
  assert.equal(a.evidenceHash, b.evidenceHash)
  assert.equal(computeEvidenceHash(a), a.evidenceHash)
})

test("evidenceHash: importedAt e computedAt ficam FORA do hash", () => {
  const h = sealed().evidenceHash
  assert.equal(sealEvidence(unsealed("2026-10-08T12:00:00Z", "2026-10-08T12:00:01Z")).evidenceHash, h)
  assert.equal(sealEvidence(unsealed("2030-01-01T00:00:00Z", null)).evidenceHash, h)
  assert.equal(EvidenceBundleSchema.safeParse(sealEvidence(unsealed("2026-10-08T12:00:00Z", "2026-10-08T12:00:01Z"))).success, true)
})

test("evidenceHash: independe da ORDEM das chaves e da ordem das listas (imports, trades, metrics)", () => {
  const b = sealed()
  const reordered = reverseKeys(b) as EvidenceBundle
  assert.equal(computeEvidenceHash(reordered), b.evidenceHash)
  const shuffled = clone(b)
  shuffled.evidence.trades.reverse()
  shuffled.evidence.metrics.reverse()
  shuffled.evidence.imports.reverse()
  assert.equal(computeEvidenceHash(shuffled), b.evidenceHash)
})

test("evidenceHash: qualquer mudança material muda o hash (valor, população, linha, conta, claim)", () => {
  const b = sealed()
  const mut = (fn: (x: EvidenceBundle) => void) => {
    const c = clone(b)
    fn(c)
    return computeEvidenceHash(c)
  }
  assert.notEqual(mut((x) => { x.evidence.metrics[0].value = (x.evidence.metrics[0].value ?? 0) + 0.01 }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.evidence.metrics[0].population.tradeSetHash = "f".repeat(64) }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.evidence.trades[0].sourceRows[0].rowHash = "0".repeat(64) }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.evidence.trades[0].pnl.net = 1 }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.evidence.trades[0].accountRef = "acc_outra" }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.evidence.imports[0].fileSha256 = "0".repeat(64) }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.claim.statement = "outra afirmação" }), b.evidenceHash)
  assert.notEqual(mut((x) => { x.evidence.trades.pop() }), b.evidenceHash)
})

test("evidenceHash: o hash gravado não entra no cálculo (selar duas vezes dá o mesmo)", () => {
  const b = sealed()
  assert.equal(sealEvidence({ ...b, evidenceHash: undefined } as never).evidenceHash, b.evidenceHash)
  assert.equal(computeEvidenceHash({ ...b, evidenceHash: "0".repeat(64) }), b.evidenceHash)
})

console.log(`\n${passed} testes ok`)
