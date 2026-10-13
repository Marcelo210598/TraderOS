// E6.6-4: envelope das capacidades (handleView, okResult, errorResult) e projeção por lista branca (projectMetricValue). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_4 (envelope, projectMetricValue, casos E1–E3 e J1).
//   node scripts/test-agent-envelope.mts
import assert from "node:assert/strict"
import { AGENT_CONTRACT_VERSION, CapabilityErrorCodeSchema, EvidenceHandleViewSchema } from "../src/lib/agent/contract.ts"
import { MetricValueViewSchema } from "../src/lib/agent/views.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"
import { errorResult, handleView, okResult } from "../src/lib/agent-capabilities/envelope.ts"
import { projectMetricValue } from "../src/lib/agent-capabilities/project.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const handle = (): Any => ({
  evidenceRef: `ev_${"a".repeat(32)}`, evidenceHash: "a".repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: 5, verifiability: "FULL", sampleFlag: "OK" },
  refEpoch: "s1", freshness: "CURRENT", verdict: buildVerdict({ status: "VALID", codes: [] }, { status: "NOT_RUN", codes: [] }),
})
const view = (): Any => ({ metrics: [{ metricId: "netPnl", value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null }], period: { from: null, to: null } })
const LIMITS = [{ code: "VERIFICATION_INFRA_MISSING", text: "texto" }]

test("E1 — handleView: SEM evidenceHash, só as 6 chaves da lista branca, CÓPIA (mutar o resultado não altera o handle), passa em EvidenceHandleViewSchema; extras do handle não vazam", () => {
  const h = handle()
  const v: Any = handleView({ ...h, extra: "vaza?", rowHash: "x" })
  assert.deepEqual(Object.keys(v).sort(), ["evidenceRef", "freshness", "population", "refEpoch", "scope", "subject", "verdict"])
  assert.equal("evidenceHash" in v, false)
  assert.equal(EvidenceHandleViewSchema.safeParse(v).success, true)
  v.population.declared = 999
  v.verdict.verify.codes.push("V_X")
  v.subject.id = "outro"
  assert.equal(h.population.declared, 5)
  assert.deepEqual(h.verdict.verify.codes, [])
  assert.equal(h.subject.id, "netPnl")
  assert.deepEqual(handleView(h), handleView(h))
  assert.deepEqual(v.population, { declared: 999, verifiability: "FULL", sampleFlag: "OK" }, "population copiada INTEIRA (inclui sampleFlag)")
  const full: Any = handle(); full.population = { declared: 5, verifiability: "FULL", sampleFlag: "LOW", conclusive: false, confidence: "LIMITED" }
  assert.deepEqual(handleView(full).population, full.population)
})

test("E2 — okResult: envelope válido (contract, capability, ok, data, evidence sem hash, limits); view inválida/T0 ⇒ ENGINE_REFUSED sem detalhe; evidência inconsistente ⇒ ENGINE_REFUSED; capacidade sem view ⇒ ENGINE_REFUSED", () => {
  const r: Any = okResult("metrics.query@1", view(), handle(), LIMITS)
  assert.deepEqual(Object.keys(r).sort(), ["capability", "contract", "data", "evidence", "limits", "ok"])
  assert.equal(r.contract, AGENT_CONTRACT_VERSION)
  assert.equal(r.ok, true)
  assert.equal(r.capability, "metrics.query@1")
  assert.deepEqual(r.data, view())
  assert.equal("evidenceHash" in r.evidence, false)
  assert.deepEqual(r.limits, LIMITS)
  const refused = { contract: AGENT_CONTRACT_VERSION, capability: "metrics.query@1", ok: false, data: null, evidence: null, limits: [], error: { code: "ENGINE_REFUSED" } }
  const t0 = view(); t0.metrics[0].rowHash = "a".repeat(64)
  assert.deepEqual(okResult("metrics.query@1", t0, handle(), LIMITS), refused)
  assert.deepEqual(okResult("metrics.query@1", { metrics: "x" }, handle(), LIMITS), refused)
  assert.deepEqual(okResult("metrics.query@1", view(), { ...handle(), verdict: { ...handle().verdict, combined: "VERIFIED" } }, LIMITS), refused, "combined inconsistente")
  assert.deepEqual(okResult("metrics.query@1", view(), handle(), [{ code: "texto livre", text: "x" }]), refused, "limit com código fora do contrato")
  assert.deepEqual(okResult("evidence.refresh@1" as never, view(), handle(), LIMITS), { ...refused, capability: "evidence.refresh@1" })
  assert.throws(() => okResult("x@1" as never, view(), handle(), LIMITS), RangeError, "capacidade desconhecida é erro de programação")
  assert.doesNotThrow(() => okResult("metrics.query@1", null, null as never, null as never))
  assert.deepEqual(okResult("metrics.query@1", null, null as never, null as never), refused)
  assert.equal(JSON.stringify(r).includes("a".repeat(64)), false, "o hash completo não sai no envelope")
})

test("E3 — errorResult: os 5 códigos ⇒ envelope ok:false com data/evidence nulos e limits []; código ou capacidade fora do contrato lança RangeError (erro de programação)", () => {
  for (const code of CapabilityErrorCodeSchema.options) assert.deepEqual(errorResult("rank.groups@1", code), { contract: AGENT_CONTRACT_VERSION, capability: "rank.groups@1", ok: false, data: null, evidence: null, limits: [], error: { code } })
  for (const bad of ["OUTRO", "", null, undefined, 5, "__proto__"]) assert.throws(() => errorResult("rank.groups@1", bad as never), RangeError, String(bad))
  assert.throws(() => errorResult("x@1" as never, "NOT_FOUND"), RangeError)
})

const engineMetric = (o: Any = {}): Any => ({ metric: "netPnl", value: 10.5, unit: "usd", sampleSize: 4, coverage: { used: 4, total: 4, ratio: 1 }, available: true, reason: null, basis: "NET", definitionVersion: "1", details: { tradeId: "t1" }, ...o })

test("J1 — projectMetricValue: copia os 7 campos um a um; descarta available/definitionVersion/details/extras (mesmo __proto__); ratio null com total 0 ⇒ 0; com total > 0 ⇒ null; valor null sem motivo ⇒ null; não finito ⇒ null; a saída passa em MetricValueViewSchema", () => {
  const p: Any = projectMetricValue(engineMetric())
  assert.deepEqual(p, { metricId: "netPnl", value: 10.5, unit: "usd", basis: "NET", sampleSize: 4, coverage: { used: 4, total: 4, ratio: 1 }, reason: null })
  assert.equal(MetricValueViewSchema.safeParse(p).success, true)
  const evil: Any = engineMetric({ rowHash: "x", sourceRows: [1], userId: "u", evidenceHash: "h", details: { saltId: "s" } })
  Object.defineProperty(evil, "__proto__", { value: { polluido: true }, enumerable: true })
  const q: Any = projectMetricValue(evil)
  assert.deepEqual(Object.keys(q).sort(), ["basis", "coverage", "metricId", "reason", "sampleSize", "unit", "value"])
  assert.deepEqual(Object.keys(q.coverage).sort(), ["ratio", "total", "used"])
  assert.equal(JSON.stringify(q).includes("polluido"), false)
  assert.deepEqual(projectMetricValue(engineMetric({ value: null, available: false, reason: "NO_TRADES", sampleSize: 0, coverage: { used: 0, total: 0, ratio: null } })), { metricId: "netPnl", value: null, unit: "usd", basis: "NET", sampleSize: 0, coverage: { used: 0, total: 0, ratio: 0 }, reason: "NO_TRADES" })
  assert.equal(projectMetricValue(engineMetric({ coverage: { used: 1, total: 4, ratio: null } })), null)
  assert.equal(projectMetricValue(engineMetric({ value: null, reason: null })), null)
  assert.equal(projectMetricValue(engineMetric({ value: Number.NaN })), null)
  assert.equal(projectMetricValue(engineMetric({ value: Number.POSITIVE_INFINITY })), null)
  assert.equal(projectMetricValue(engineMetric({ unit: "EUR" })), null)
  for (const bad of [null, undefined, 5, "x", [], {}]) { assert.doesNotThrow(() => projectMetricValue(bad as never)); assert.equal(projectMetricValue(bad as never), null) }
  const hostile: Any = engineMetric()
  Object.defineProperty(hostile, "value", { enumerable: true, get() { throw new Error("getter hostil") } })
  assert.equal(projectMetricValue(hostile), null)
  const snap = JSON.stringify(engineMetric())
  const e = engineMetric(); projectMetricValue(e)
  assert.equal(JSON.stringify(e), snap, "não altera a entrada")
  const out: Any = projectMetricValue(engineMetric()); out.coverage.used = 99
  assert.equal(projectMetricValue(engineMetric()).coverage.used, 4)
})

console.log(`\n${passed} testes ok`)
