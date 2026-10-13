// E6.6-4: pipeline comum das capacidades (src/lib/agent-capabilities/assess.ts): bundle → verify → source → buildVerdict → handle e limits. Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_4 (assessBundle, population_by_subject, limitsOf, cases P1–P12, decisões D4-1..D4-4).
// Bundles REAIS do motor (CSV sintético → importação → métricas/derivados → Evidence), nunca montados à mão; o E5b roda de verdade quando há arquivo.
//   node scripts/test-agent-assess.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { EvidenceHandleSchema } from "../src/lib/agent/contract.ts"
import { PHRASES, STRUCTURAL_TEXT } from "../src/lib/agent/phrases.ts"
import { assessBundle, codesOf, limitsOf, resolveSourceStatus, sourceCodesOf } from "../src/lib/agent-capabilities/assess.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const enc = (s: string) => new TextEncoder().encode(s)

// ── dados sintéticos e bundles reais ─────────────────────────────────────────
const BRT = "America/Sao_Paulo"
const OB = { timeZone: BRT, minSample: 4 } as const
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
]
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const rows = (): SynthRow[] => CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any)))
const CSV = synthCsv(rows())
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "e664.csv" })
const rec = imp.importRecord as ImportRecord
const T = toAnalyticsTrades(imp.trades)
const FILES = { [rec.importId]: enc(CSV) }
const t = calculateMetricsTraced(T, OB)
const METRIC: Any = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [rec] }) as Any)
const derived = (limit?: number): Any => derivedEvidenceBundle(explainDerived({ spec: { options: { ...OB, ...(limit ? { tradeIdsLimit: limit } : {}) }, op: "GROUP_RANKING", args: { groupBy: "account" } } as Any, trades: T, importRecords: [rec] }) as Any)
const DERIVED = derived()
const DERIVED_HASH_ONLY = derived(2)
const EPOCH = "s1"
const assess = (b: unknown, o: Any = {}): Any => assessBundle(b, { refEpoch: EPOCH, ...o })
const withFiles = (files: Any = FILES): Any => ({ source: { files } })
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria avaliar: ${JSON.stringify(r)}`); return r }
const REFUSED = { ok: false, code: "ENGINE_REFUSED" }
const STRUCT = { code: "VERIFICATION_INFRA_MISSING", text: STRUCTURAL_TEXT }

test("P1 — bundle de MÉTRICA real, sem arquivo: verify VALID, source NOT_RUN, NOT_VERIFIED; ref = 'ev_' + 32 hex do selo; subject, escopo, população, época, frescor; limits = [estrutural]; o handle passa no schema do contrato", () => {
  const r = okOf(assess(METRIC))
  const h = r.handle
  assert.equal(h.evidenceRef, `ev_${METRIC.evidenceHash.slice(0, 32)}`)
  assert.equal(h.evidenceHash, METRIC.evidenceHash)
  assert.deepEqual(h.subject, { type: "METRIC", id: "netPnl" })
  assert.equal(h.scope, "TOTAL")
  assert.deepEqual(h.population, { declared: 5, verifiability: "FULL" })
  assert.equal(h.refEpoch, EPOCH)
  assert.equal(h.freshness, "CURRENT")
  assert.deepEqual(h.verdict, { verify: { status: "VALID", codes: [] }, source: { status: "NOT_RUN", codes: [] }, combined: "NOT_VERIFIED" })
  assert.deepEqual(r.limits, [STRUCT])
  assert.equal(EvidenceHandleSchema.safeParse(h).success, true)
})

test("P2 — o MESMO bundle COM o arquivo original correto (E5b real): SOURCE_VERIFIED ⇒ VERIFIED; limits == [] (nada a declarar); source.codes sem S_NOT_APPLICABLE", () => {
  const r = okOf(assess(METRIC, withFiles()))
  assert.deepEqual(r.handle.verdict, { verify: { status: "VALID", codes: [] }, source: { status: "SOURCE_VERIFIED", codes: [] }, combined: "VERIFIED" })
  assert.deepEqual(r.limits, [])
  const d = okOf(assess(DERIVED, withFiles()))
  assert.equal(d.handle.verdict.combined, "VERIFIED")
})

test("P3 — arquivo ERRADO (um preço alterado): SOURCE_MISMATCH ⇒ TAMPERED_OR_MISMATCH; sem lançar; arquivo faltando para o importId ⇒ também não VERIFIED", () => {
  const wrong = { [rec.importId]: enc(CSV.replace("2004", "2005")) }
  const r = okOf(assess(METRIC, withFiles(wrong)))
  assert.equal(r.handle.verdict.source.status, "SOURCE_MISMATCH")
  assert.equal(r.handle.verdict.combined, "TAMPERED_OR_MISMATCH")
  const missing = okOf(assess(METRIC, withFiles({})))
  assert.notEqual(missing.handle.verdict.combined, "VERIFIED")
  assert.notEqual(missing.handle.verdict.source.status, "SOURCE_VERIFIED")
})

test("P4 — bundle ADULTERADO (valor mudado sem refazer o selo): verify TAMPERED ⇒ TAMPERED_OR_MISMATCH; o ref ainda vem do evidenceHash do bundle; sem arquivo continua NOT_RUN", () => {
  const bad = clone(METRIC)
  bad.evidence.metrics[0].value = bad.evidence.metrics[0].value + 1
  const r = okOf(assess(bad))
  assert.equal(r.handle.verdict.verify.status, "TAMPERED")
  assert.equal(r.handle.verdict.source.status, "NOT_RUN")
  assert.equal(r.handle.verdict.combined, "TAMPERED_OR_MISMATCH")
  assert.ok(r.handle.verdict.verify.codes.includes("V_SEAL_MISMATCH"))
  assert.equal(r.handle.evidenceRef, `ev_${bad.evidenceHash.slice(0, 32)}`)
})

test("P5 — formato inválido ⇒ { ok:false, code:'ENGINE_REFUSED' } (Q17): {}, null, 5, texto, array, selo ausente, selo não-hex, campo extra, schema desconhecido; nunca lança", () => {
  const noHash = clone(METRIC); delete noHash.evidenceHash
  const badHash = { ...clone(METRIC), evidenceHash: "z".repeat(64) }
  const extra = { ...clone(METRIC), extra: 1 }
  const schema = { ...clone(METRIC), schema: "evidence/9" }
  const noMetric = clone(METRIC); noMetric.evidence.metrics = []
  for (const b of [{}, null, undefined, 5, "x", [], noHash, badHash, extra, schema]) { assert.doesNotThrow(() => assess(b)); assert.deepEqual(assess(b), REFUSED, JSON.stringify(b)?.slice(0, 40)) }
  assert.deepEqual(assess(noMetric), REFUSED, "subject METRIC sem métrica no bundle")
})

test("P6 — DERIVADO real (GROUP_RANKING): subject DERIVED, escopo GROUP, população e confiança do derivado; HASH_ONLY sem arquivo ⇒ verify UNVERIFIABLE (S_HASH_ONLY) + limits [S_HASH_ONLY, estrutural]; HASH_ONLY com arquivo ⇒ source UNVERIFIABLE (S_NO_IMPORTS, S_POPULATION_PARTIAL) + limits [S_NO_IMPORTS, S_HASH_ONLY]", () => {
  const a = okOf(assess(DERIVED))
  assert.equal(a.handle.subject.type, "DERIVED")
  assert.equal(a.handle.subject.id, DERIVED.subject.id)
  assert.equal(a.handle.scope, "GROUP")
  assert.deepEqual(a.handle.population, { declared: 5, verifiability: "FULL", confidence: "UNRELIABLE" })
  assert.equal(a.handle.verdict.combined, "NOT_VERIFIED")
  const h = okOf(assess(DERIVED_HASH_ONLY))
  assert.deepEqual(h.handle.population, { declared: 5, verifiability: "HASH_ONLY", confidence: "UNRELIABLE" })
  assert.deepEqual(h.handle.verdict.verify, { status: "UNVERIFIABLE", codes: ["S_HASH_ONLY"] })
  assert.equal(h.handle.verdict.source.status, "NOT_RUN")
  assert.deepEqual(h.limits.map((l: Any) => l.code), ["S_HASH_ONLY", "VERIFICATION_INFRA_MISSING"])
  assert.equal(h.limits[0].text, PHRASES.S_HASH_ONLY)
  const f = okOf(assess(DERIVED_HASH_ONLY, withFiles()))
  assert.deepEqual(f.handle.verdict.source, { status: "UNVERIFIABLE", codes: ["S_NO_IMPORTS", "S_POPULATION_PARTIAL"] })
  assert.equal(f.handle.verdict.combined, "NOT_VERIFIED")
  assert.deepEqual(f.limits.map((l: Any) => l.code), ["S_NO_IMPORTS", "S_HASH_ONLY"], "ordem do catálogo; sem estrutural (o source rodou); sem a parcial (só vale em VERIFIED_PARTIAL)")
})

test("P7 — resolveSourceStatus (Q11): só INVALID_FORMAT muda — com verify VALID ⇒ null (recusa); com verify INVALID_FORMAT ⇒ UNVERIFIABLE; os outros 4 passam iguais para qualquer verify", () => {
  for (const s of ["SOURCE_VERIFIED", "SOURCE_VERIFIED_PARTIAL", "SOURCE_MISMATCH", "UNVERIFIABLE"]) for (const v of ["VALID", "TAMPERED", "UNVERIFIABLE", "INVALID_FORMAT"]) assert.equal(resolveSourceStatus(s as never, v as never), s, `${s}×${v}`)
  for (const v of ["VALID", "TAMPERED", "UNVERIFIABLE"]) assert.equal(resolveSourceStatus("INVALID_FORMAT" as never, v as never), null, `INVALID_FORMAT×${v}`)
  assert.equal(resolveSourceStatus("INVALID_FORMAT" as never, "INVALID_FORMAT" as never), "UNVERIFIABLE")
  assert.equal(resolveSourceStatus("NOT_RUN" as never, "VALID" as never), null, "NOT_RUN não é resposta do E5b: só nasce da ausência do arquivo")
  for (const bad of [["OUTRO", "VALID"], [null, "VALID"], ["SOURCE_VERIFIED", "OUTRO"], [undefined, undefined]]) assert.equal(resolveSourceStatus(bad[0] as never, bad[1] as never), null, JSON.stringify(bad))
})

test("P5b — bundle que PASSA no schema mas o verificador marca INVALID_FORMAT (valor não canônico em campo livre: Infinity) ⇒ ENGINE_REFUSED (D4-3); nunca vira handle TAMPERED", () => {
  const odd = clone(METRIC)
  odd.evidence.metrics[0].query.filters = { x: 1 }
  const bad: Any = { ...odd }
  bad.evidence = { ...odd.evidence, metrics: [{ ...odd.evidence.metrics[0], query: { ...odd.evidence.metrics[0].query, filters: { x: Number.POSITIVE_INFINITY } } }] }
  assert.deepEqual(assess(bad), REFUSED)
})

test("P5c — códigos: codesOf ignora checks PASS (mesmo com código) e S_NOT_APPLICABLE, deduplica na ordem; sourceCodesOf soma as limitações que são frases PARCIAIS (L_SALT_*) e ignora as demais (L_SELECTION_NOT_PROVEN…)", () => {
  assert.deepEqual(codesOf([{ status: "PASS", code: "V_X_PASS" }, { status: "SKIPPED", code: "S_NOT_APPLICABLE" }, { status: "FAIL", code: "V_SEAL_MISMATCH" }, { status: "SKIPPED", code: "S_HASH_ONLY" }, { status: "FAIL", code: "V_SEAL_MISMATCH" }, { status: "FAIL", code: null }]), ["V_SEAL_MISMATCH", "S_HASH_ONLY"])
  assert.deepEqual(sourceCodesOf({ checks: [{ status: "SKIPPED", code: "S_POPULATION_PARTIAL" }], limitations: [{ code: "L_SELECTION_NOT_PROVEN" }, { code: "L_SALT_CHECK_DIVERGENT" }, { code: "L_SALT_ID_NOT_RESOLVED" }, { code: "L_SALT_CHECK_DIVERGENT" }] }), ["S_POPULATION_PARTIAL", "L_SALT_CHECK_DIVERGENT", "L_SALT_ID_NOT_RESOLVED"])
  assert.deepEqual(sourceCodesOf({ checks: [], limitations: [] }), [])
})

test("P5d — população do METRIC vem de `afterFilters` (não de `inputTrades`): bundle com filtro de datas declara só os trades que passaram", () => {
  const f = calculateMetricsTraced(T, { ...OB, filters: { from: "2026-03-05" } as Any })
  const b: Any = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: f.result, trace: f.trace }, trades: T, importRecords: [rec] }) as Any)
  const m = b.evidence.metrics[0].population
  assert.ok(m.afterFilters < m.inputTrades, `o filtro precisa excluir trades (${m.afterFilters} < ${m.inputTrades})`)
  assert.equal(okOf(assess(b)).handle.population.declared, m.afterFilters)
})

test("P8 — overrides de população mesclados (sampleFlag, conclusive, confidence); só chaves definidas entram; valores fora do contrato ⇒ ENGINE_REFUSED", () => {
  const r = okOf(assess(METRIC, { population: { sampleFlag: "LOW", conclusive: false } }))
  assert.deepEqual(r.handle.population, { declared: 5, verifiability: "FULL", sampleFlag: "LOW", conclusive: false })
  const u = okOf(assess(METRIC, { population: { sampleFlag: undefined, conclusive: undefined } }))
  assert.deepEqual(u.handle.population, { declared: 5, verifiability: "FULL" })
  const d = okOf(assess(DERIVED, { population: { confidence: "OK" } }))
  assert.equal(d.handle.population.confidence, "OK", "o override vence o do bundle")
  assert.deepEqual(assess(METRIC, { population: { sampleFlag: "ENORME" } }), REFUSED)
  assert.deepEqual(assess(METRIC, { population: { conclusive: "sim" } }), REFUSED)
})

test("P9 — NÃO altera o bundle (deep-equal antes/depois; o selo recalculado continua o mesmo), é determinístico (sem relógio) e o ref é endereçado por conteúdo", () => {
  const b = clone(METRIC)
  const snap = JSON.stringify(b)
  const r1 = assess(b), r2 = assess(b)
  assert.equal(JSON.stringify(b), snap)
  assert.equal(JSON.stringify(r1), JSON.stringify(r2))
  assert.equal(computeEvidenceHash(b), b.evidenceHash)
  const other: Any = okOf(assess(DERIVED))
  assert.notEqual(other.handle.evidenceRef, r1.handle.evidenceRef)
})

test("P10 — refEpoch inválido ('', 'S1', null, número, 33 caracteres) ⇒ ENGINE_REFUSED; sem opções ⇒ ENGINE_REFUSED", () => {
  for (const e of ["", "S1", "-a", null, undefined, 5, "x".repeat(33)]) assert.deepEqual(assessBundle(METRIC, { refEpoch: e as never }), REFUSED, String(e))
  assert.deepEqual(assessBundle(METRIC, undefined as never), REFUSED)
  assert.deepEqual(assessBundle(METRIC, null as never), REFUSED)
})

test("P11 — entrada hostil que LANÇA dentro do pipeline (getter, Proxy, arquivos hostis) ⇒ ENGINE_REFUSED sem exceção", () => {
  const getter: Any = clone(METRIC)
  Object.defineProperty(getter, "evidence", { enumerable: true, get() { throw new Error("getter hostil") } })
  assert.doesNotThrow(() => assess(getter))
  assert.deepEqual(assess(getter), REFUSED)
  const proxy = new Proxy({}, { get() { throw new Error("proxy hostil") }, has() { throw new Error("proxy hostil") }, ownKeys() { throw new Error("proxy hostil") } })
  assert.deepEqual(assess(proxy), REFUSED)
  const hostileFiles: Any = new Proxy({}, { get() { throw new Error("arquivos hostis") } })
  assert.doesNotThrow(() => assess(METRIC, { source: { files: hostileFiles } }))
  assert.deepEqual(assess(METRIC, { source: { files: hostileFiles } }), REFUSED)
})

test("P12 — limitsOf(handle): específico (ordem do catálogo) → [parcial só em VERIFIED_PARTIAL] → estrutural por ÚLTIMO; handle VERIFIED ⇒ []; códigos fora do catálogo ignorados; texto SEMPRE do catálogo (nunca o cru do verificador)", () => {
  const mk = (verify: Any, source: Any, combined: string): Any => ({ verdict: { verify, source, combined } })
  assert.deepEqual(limitsOf(mk({ status: "VALID", codes: [] }, { status: "SOURCE_VERIFIED", codes: [] }, "VERIFIED")), [])
  const l1 = limitsOf(mk({ status: "UNVERIFIABLE", codes: ["S_HASH_ONLY", "S_NO_METRICS", "V_QUALQUER"] }, { status: "NOT_RUN", codes: [] }, "NOT_VERIFIED"))
  assert.deepEqual(l1, [{ code: "S_NO_METRICS", text: PHRASES.S_NO_METRICS }, { code: "S_HASH_ONLY", text: PHRASES.S_HASH_ONLY }, STRUCT])
  const l2 = limitsOf(mk({ status: "VALID", codes: [] }, { status: "SOURCE_VERIFIED_PARTIAL", codes: ["S_POPULATION_PARTIAL", "L_SALT_CHECK_DIVERGENT"] }, "VERIFIED_PARTIAL"))
  assert.deepEqual(l2.map((x: Any) => x.code), ["S_POPULATION_PARTIAL", "L_SALT_CHECK_DIVERGENT"])
  const l3 = limitsOf(mk({ status: "VALID", codes: [] }, { status: "UNVERIFIABLE", codes: ["S_POPULATION_PARTIAL", "S_NO_IMPORTS"] }, "NOT_VERIFIED"))
  assert.deepEqual(l3.map((x: Any) => x.code), ["S_NO_IMPORTS"], "parcial NÃO entra em NOT_VERIFIED")
  const tampered = limitsOf(mk({ status: "TAMPERED", codes: ["V_SEAL_MISMATCH"] }, { status: "NOT_RUN", codes: [] }, "TAMPERED_OR_MISMATCH"))
  assert.deepEqual(tampered, [STRUCT], "integridade não é limit (a frase INTEGRITY_* é escolhida pelo modelo)")
  for (const l of [...l1, ...l2, ...l3]) assert.equal(l.text, (PHRASES as Any)[l.code])
  assert.equal(JSON.stringify(exp.e66_4.cases.length), "16")
})

console.log(`\n${passed} testes ok`)
