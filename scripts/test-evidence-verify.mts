// Evidence E5.1 (+ ajustes do E5.2) — verifyEvidence: V0 formato · V1 selo · V2 referências.   node scripts/test-evidence-verify.mts
// Este arquivo isola V0–V2 (os ataques estruturais); V3/V4 (população e métricas) têm testes próprios em test-evidence-verify-math.mts.
// Aqui os asserts de isolamento olham só os checks V0–V2 (`failedIds`), porque desde o E5.2 uma adulteração também pode acender V3/V4.
// Sintético versionado + (se existirem) as fixtures reais LOCAIS, sem números embutidos e sem nada real no repositório.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade, ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle, type MetricSource } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { FAIL_CODES, verifyEvidence, type VerifyReport } from "../src/lib/evidence/verify.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { METRIC_IDS, aggregateTradesTraced, calculateMetricsTraced, toAnalyticsTrades, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
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

// ── população sintética (14 ciclos, 2 contas; a mesma do E4) ─────────────────

const SPEC = [4, 3, -2, -3, -1, 6, 0, 2, -4, 5, 1, -1, 7, 3]
const rowsOf = (pts: number[]) =>
  pts.map((p, i) => ({
    account: i < 10 ? "Sim101" : "Sim102",
    entryPrice: 2000,
    exitPrice: 2000 + p,
    entryAt: `${String(i + 2).padStart(2, "0")}/03/2026 ${String(9 + (i % 4)).padStart(2, "0")}:00:00`,
    exitAt: `${String(i + 2).padStart(2, "0")}/03/2026 ${String(9 + (i % 4)).padStart(2, "0")}:10:00`,
  }))
const imp = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: "Sim101_Sim102-marco.csv" })
const rec = imp.importRecord as ImportRecord
const A = toAnalyticsTrades(withRisk(imp.trades))
// segundo import (outra configuração ⇒ outro importId ⇒ outros tradeId), para testar troca de importId entre imports REAIS do bundle
const imp2 = runImportPipeline(synthCsv(rowsOf(SPEC.slice(0, 5))), { sourceTz: "America/New_York", fileName: "outro.csv" })
const rec2 = imp2.importRecord as ImportRecord
const AMIX = toAnalyticsTrades([...withRisk(imp.trades), ...withRisk(imp2.trades)])

function bundleOf(metricId: string, trades: AnalyticsTrade[] = A, records: ImportRecord[] = [rec], args: Parameters<typeof calculateMetricsTraced>[1] = {}): EvidenceBundle {
  const { result, trace } = calculateMetricsTraced(trades, args)
  const r = explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades, importRecords: records })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
/** Recalcula o selo como um atacante faria; se o bundle está malformado demais para o selo, mantém o hash antigo (o formato já acusa). */
const reseal = (b: Any): Any => {
  try {
    return { ...b, evidenceHash: computeEvidenceHash(b) }
  } catch {
    return b
  }
}
const WIN = bundleOf("winners") // população FULL com contribuintes WINNER
const NETPNL = bundleOf("netPnl")
const TOTAL = bundleOf("totalTrades") // sem contribuintes (applicable=false)
const HASH_ONLY = bundleOf("largestWinner", A, [rec], { tradeIdsLimit: 3 })
const MIX = bundleOf("netPnl", AMIX, [rec, rec2])

const check = (rep: VerifyReport, id: string) => {
  const c = rep.checks.find((x) => x.id === id)
  assert.ok(c, `check ${id} ausente`)
  return c
}
/** Checks V0–V2 que falharam (isolamento do ataque estrutural; V3/V4 podem acusar além disso desde o E5.2). */
const failedIds = (rep: VerifyReport) => rep.checks.filter((c) => c.status === "FAIL" && (c.level === "V0" || c.level === "V1" || c.level === "V2")).map((c) => c.id)
/** Exatamente os checks `ids` falham (isolamento do ataque), com o status geral e o código esperados. */
function expectFail(rep: VerifyReport, status: VerifyReport["status"], ids: string[], codes?: string[]) {
  assert.equal(rep.status, status, `${rep.status} ≠ ${status}: ${JSON.stringify(rep.checks.filter((c) => c.status === "FAIL").map((c) => [c.id, c.code, c.detail]))}`)
  assert.deepEqual(failedIds(rep), ids)
  ids.forEach((id, i) => assert.equal(check(rep, id).code, codes ? codes[i] : FAIL_CODES[id as keyof typeof FAIL_CODES]))
}
const edit = (b: EvidenceBundle, fn: (x: Any) => void, sealed = true): Any => {
  const c = clone(b) as Any
  fn(c)
  return sealed ? reseal(c) : c
}

// ── bundle limpo ─────────────────────────────────────────────────────────────

test("BUNDLE LIMPO: V0, V1 e V2 passam; população FULL ⇒ VALID (V3/V4 PASS ou NOT_APPLICABLE); acima do limite ⇒ UNVERIFIABLE (V3/V4 SKIPPED com motivo, nunca PASS)", () => {
  for (const b of [WIN, NETPNL, TOTAL, MIX]) {
    const rep = verifyEvidence(b)
    assert.equal(rep.status, "VALID", JSON.stringify(rep.checks.filter((c) => c.status !== "PASS").map((c) => [c.id, c.code])))
    for (const c of rep.checks.filter((x) => x.level === "V0" || x.level === "V1" || x.level === "V2")) assert.equal(c.status, "PASS", `${c.id}: ${c.detail}`)
    // o único SKIPPED permitido num VALID é "não se aplica"
    assert.ok(rep.checks.every((c) => c.status !== "SKIPPED" || c.code === "S_NOT_APPLICABLE"))
    assert.equal(rep.schema, "verify/1")
    assert.deepEqual(rep.limitations.map((l) => l.code), ["L_SEAL_NOT_SIGNATURE", "L_SELECTION_NOT_PROVEN", "L_ORIGIN_NOT_PROVEN"]) // o que nem VALID afirma
  }
  const h = verifyEvidence(HASH_ONLY)
  assert.equal(h.status, "UNVERIFIABLE")
  for (const c of h.checks.filter((x) => x.level === "V0" || x.level === "V1" || x.level === "V2")) assert.equal(c.status, "PASS")
  assert.equal(check(h, "V3.population").status, "SKIPPED")
  assert.equal(check(h, "V3.population").code, "S_HASH_ONLY")
  const ids = verifyEvidence(WIN).checks.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.length, 31)
  assert.deepEqual(verifyEvidence(WIN).checks.map((c) => c.level), ["V0", "V0", "V0", "V0", "V0", "V1", ...Array(13).fill("V2"), "V3", "V3", ...Array(10).fill("V4")])
})

// ── V0: formato ──────────────────────────────────────────────────────────────

test("V0 campo extra: no topo, no trade, no ImportRef, na métrica e dentro de sub-objetos reaproveitados do Canonical — INVALID_FORMAT; V1–V4 SKIPPED (não FAIL)", () => {
  const cases: Array<[string, (x: Any) => void, string]> = [
    ["topo", (x) => (x.extra = 1), "V0.structure"],
    ["trade.sourceName", (x) => (x.evidence.trades[0].sourceName = "Sim101"), "V0.structure"],
    ["trade.account", (x) => (x.evidence.trades[0].account = { sourceName: "Sim101" }), "V0.structure"],
    ["ImportRef", (x) => (x.evidence.imports[0].sourceName = "Sim101"), "V0.structure"],
    ["MetricEvidence", (x) => (x.evidence.metrics[0].extra = true), "V0.structure"],
    ["MetricEvidence.query", (x) => (x.evidence.metrics[0].query.extra = true), "V0.structure"],
    // o schema reaproveita sub-schemas do Canonical que NÃO são strict: ali o campo seria descartado em silêncio no parse
    ["entry.at.sourceName", (x) => (x.evidence.trades[0].entry.at.sourceName = "Sim101"), "V0.unknown-fields"],
    ["entryLegs[0].sourceName", (x) => (x.evidence.trades[0].entryLegs[0].sourceName = "Sim101"), "V0.unknown-fields"],
    ["exitLegs[0].pnl.x", (x) => (x.evidence.trades[0].exitLegs[0].pnl.x = 1), "V0.unknown-fields"],
    ["exitSummary.x", (x) => (x.evidence.trades[0].exitSummary.x = 1), "V0.unknown-fields"],
  ]
  for (const [name, fn, which] of cases) {
    const rep = verifyEvidence(edit(NETPNL, fn))
    assert.equal(rep.status, "INVALID_FORMAT", name)
    assert.equal(check(rep, which).status, "FAIL", `${name}: ${which}`)
    assert.equal(check(rep, which).code, FAIL_CODES[which as keyof typeof FAIL_CODES])
    for (const c of rep.checks.filter((x) => x.level !== "V0")) {
      assert.equal(c.status, "SKIPPED", `${name}: ${c.id}`)
      assert.equal(c.code, "S_FORMAT_INVALID")
    }
  }
  assert.match(check(verifyEvidence(edit(NETPNL, (x) => (x.evidence.trades[0].entryLegs[0].sourceName = "Sim101"))), "V0.unknown-fields").detail, /evidence\.trades\[0\]\.entryLegs\[0\]\.sourceName/)
  assert.match(check(verifyEvidence(edit(NETPNL, (x) => (x.evidence.trades[0].sourceName = "Sim101"))), "V0.structure").detail, /sourceName/)
})

test("V0 schema desconhecido/ausente/de outro tipo — INVALID_FORMAT com V_SCHEMA_UNKNOWN", () => {
  for (const v of ["evidence/2", "evidence/0", "", "EVIDENCE/1", 1, null, undefined]) {
    const rep = verifyEvidence(edit(NETPNL, (x) => (x.schema = v)))
    assert.equal(rep.status, "INVALID_FORMAT")
    assert.equal(check(rep, "V0.schema-id").status, "FAIL")
    assert.equal(check(rep, "V0.schema-id").code, "V_SCHEMA_UNKNOWN")
  }
  const noSchema = clone(NETPNL) as Any
  delete noSchema.schema
  assert.match(check(verifyEvidence(noSchema), "V0.schema-id").detail, /ausente/)
  assert.equal(check(verifyEvidence(clone(NETPNL)), "V0.schema-id").status, "PASS")
})

test("V0 campo obrigatório ausente e tipo inválido — INVALID_FORMAT com V_FORMAT_INVALID e o caminho do problema", () => {
  const cases: Array<[string, (x: Any) => void, RegExp]> = [
    ["trade.r ausente", (x) => delete x.evidence.trades[0].r, /trades\.0\.r/],
    ["trade.pointsPerContract ausente", (x) => delete x.evidence.trades[0].pointsPerContract, /pointsPerContract/],
    ["metrics[0].value ausente", (x) => delete x.evidence.metrics[0].value, /metrics\.0\.value/],
    ["evidence.trades ausente", (x) => delete x.evidence.trades, /evidence\.trades/],
    ["claim ausente", (x) => delete x.claim, /claim/],
    ["subject ausente", (x) => delete x.subject, /subject/],
    ["value string", (x) => (x.evidence.metrics[0].value = "x"), /metrics\.0\.value/],
    ["tradeIds string", (x) => (x.evidence.metrics[0].population.tradeIds = "a"), /tradeIds/],
    ["rowNo fracionário", (x) => (x.evidence.trades[0].sourceRows[0].rowNo = 1.5), /rowNo/],
    ["tradeSetHash curto", (x) => (x.evidence.metrics[0].population.tradeSetHash = "abc"), /tradeSetHash/],
    ["role desconhecido", (x) => (x.evidence.metrics[0].contributors.roleCounts.QUALQUER = 1), /QUALQUER|roleCounts/],
    ["evidence não-objeto", (x) => (x.evidence = []), /evidence/],
  ]
  for (const [name, fn, re] of cases) {
    const rep = verifyEvidence(edit(WIN, fn))
    assert.equal(rep.status, "INVALID_FORMAT", name)
    assert.equal(check(rep, "V0.structure").status, "FAIL", name)
    assert.equal(check(rep, "V0.structure").code, "V_FORMAT_INVALID")
    assert.match(check(rep, "V0.structure").detail, re, name)
  }
})

test("V0 evidenceHash ausente, truncado, malformado, em maiúsculas ou de tipo errado — INVALID_FORMAT com V_SEAL_MALFORMED (nunca TAMPERED)", () => {
  const good = NETPNL.evidenceHash
  const cases: Array<[string, unknown]> = [
    ["truncado", good.slice(0, 40)],
    ["longo demais", `${good}0`],
    ["não-hex", `${good.slice(0, 63)}g`],
    ["maiúsculas", good.toUpperCase()],
    ["vazio", ""],
    ["número", 123],
    ["null", null],
  ]
  for (const [name, v] of cases) {
    const rep = verifyEvidence({ ...clone(NETPNL), evidenceHash: v })
    assert.equal(rep.status, "INVALID_FORMAT", name)
    assert.equal(check(rep, "V0.seal-format").code, "V_SEAL_MALFORMED", name)
    assert.equal(check(rep, "V1.seal").status, "SKIPPED", name)
  }
  const absent = clone(NETPNL) as Any
  delete absent.evidenceHash
  const rep = verifyEvidence(absent)
  assert.equal(rep.status, "INVALID_FORMAT")
  assert.match(check(rep, "V0.seal-format").detail, /ausente/)
})

test("V0 entradas que não são bundle (null, undefined, array, string, número, {}): relatório INVALID_FORMAT, sem exceção", () => {
  const cyclic: Any = {}
  cyclic.self = cyclic
  for (const v of [null, undefined, [], "x", 42, true, {}, [NETPNL], cyclic, () => 1, Symbol("s"), 10n]) {
    const rep = verifyEvidence(v as unknown)
    assert.equal(rep.status, "INVALID_FORMAT")
    assert.equal(check(rep, "V0.structure").status, "FAIL")
    assert.equal(rep.checks.length, 31)
    assert.ok(rep.checks.every((c) => c.status !== "PASS" || c.level === "V0"))
    assert.equal(check(rep, "V3.population").code, "S_FORMAT_INVALID")
  }
})

test("V0 valor que a estrutura aceita mas não é JSON puro (NaN em filterReport): INVALID_FORMAT com V_FORMAT_NOT_CANONICAL; selo não é calculado", () => {
  const bad = clone(NETPNL) as Any
  bad.evidence.metrics[0].population.filterReport.x = Number.NaN
  const rep = verifyEvidence(bad)
  assert.equal(rep.status, "INVALID_FORMAT")
  assert.equal(check(rep, "V0.canonical-json").code, "V_FORMAT_NOT_CANONICAL")
  assert.equal(check(rep, "V1.seal").status, "SKIPPED")
})

// ── V1: selo ─────────────────────────────────────────────────────────────────

test("V1 bundle íntegro: o selo recalculado (computeEvidenceHash, JSON canônico + SHA-256) bate", () => {
  for (const b of [WIN, NETPNL, TOTAL, HASH_ONLY, MIX]) {
    const c = check(verifyEvidence(b), "V1.seal")
    assert.equal(c.status, "PASS")
    assert.equal(computeEvidenceHash(b), b.evidenceHash)
  }
})

test("V1 conteúdo alterado SEM recalcular o selo ⇒ TAMPERED só por V_SEAL_MISMATCH (a estrutura continua coerente, então V2 passa)", () => {
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.evidence.metrics[0].value += 1), false)), "TAMPERED", ["V1.seal"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.evidence.trades[0].pnl.net = 999), false)), "TAMPERED", ["V1.seal"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.claim.statement = "outra"), false)), "TAMPERED", ["V1.seal"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.evidence.imports[0].fileSha256 = "0".repeat(64)), false)), "TAMPERED", ["V1.seal"])
})

test("V1 evidenceHash trocado por outro hash BEM FORMADO ⇒ TAMPERED (V_SEAL_MISMATCH); truncado/malformado é INVALID_FORMAT (V0)", () => {
  const flipped = `${NETPNL.evidenceHash.slice(0, 63)}${NETPNL.evidenceHash.endsWith("0") ? "1" : "0"}`
  expectFail(verifyEvidence({ ...clone(NETPNL), evidenceHash: flipped }), "TAMPERED", ["V1.seal"])
  expectFail(verifyEvidence({ ...clone(NETPNL), evidenceHash: "0".repeat(64) }), "TAMPERED", ["V1.seal"])
  assert.equal(verifyEvidence({ ...clone(NETPNL), evidenceHash: NETPNL.evidenceHash.slice(0, 63) }).status, "INVALID_FORMAT")
})

test("V1 conteúdo alterado COM selo recalculado: V1 PASSA — recalcular o selo NÃO torna o bundle confiável; V3/V4 (E5.2) acusam a inconsistência ⇒ TAMPERED", () => {
  const cases: Array<[string, (x: Any) => void, string[]]> = [
    ["value", (x) => (x.evidence.metrics[0].value += 1), ["V4.metric-value"]],
    ["pnl.net", (x) => (x.evidence.trades[0].pnl.net += 100), ["V3.population", "V4.population"]],
    ["r.net", (x) => (x.evidence.trades[0].r.net = 9), ["V3.population", "V4.population"]],
    ["tradeSetHash declarado", (x) => (x.evidence.metrics[0].population.tradeSetHash = "a".repeat(64)), ["V3.population", "V4.population"]],
  ]
  for (const [name, fn, caught] of cases) {
    const rep = verifyEvidence(edit(NETPNL, fn))
    assert.equal(check(rep, "V1.seal").status, "PASS", name)
    assert.deepEqual(failedIds(rep), [], `${name}: V0–V2 não acusam`)
    assert.equal(rep.status, "TAMPERED", name)
    for (const id of caught) assert.equal(check(rep, id).status, "FAIL", `${name}: ${id}`)
  }
})

test("V1 fora do hash exatamente o que o contrato define: importedAt, computedAt e o próprio evidenceHash; ordem de chaves e de listas é irrelevante", () => {
  const touched = edit(NETPNL, (x) => {
    x.evidence.imports[0].importedAt = "2030-01-01T00:00:00.000Z"
    x.evidence.metrics[0].computedAt = "2030-01-01T00:00:00.000Z"
  }, false)
  assert.equal(check(verifyEvidence(touched), "V1.seal").status, "PASS")
  const reversedKeys = (o: Any): Any => (Array.isArray(o) ? o.map(reversedKeys) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reversedKeys(v)])) : o)
  assert.deepEqual(verifyEvidence(reversedKeys(MIX)), verifyEvidence(MIX))
  const shuffled = clone(MIX) as Any
  shuffled.evidence.trades.reverse()
  shuffled.evidence.imports.reverse()
  assert.deepEqual(verifyEvidence(shuffled), verifyEvidence(MIX))
})

// ── V2: referências ──────────────────────────────────────────────────────────

test("V2 trade removido (selo recalculado): V_REF_TRADE_MISSING na população; sem recalcular o selo, V1 também acusa", () => {
  const removed = (b: EvidenceBundle, sealed: boolean) => edit(b, (x) => x.evidence.trades.shift(), sealed)
  // no netPnl todo trade é contribuinte (INCLUDED): a falta aparece na população E nos contributors
  expectFail(verifyEvidence(removed(NETPNL, true)), "TAMPERED", ["V2.population-refs", "V2.contributor-refs"])
  expectFail(verifyEvidence(removed(NETPNL, false)), "TAMPERED", ["V1.seal", "V2.population-refs", "V2.contributor-refs"])
  // métrica sem contribuintes (totalTrades): só a população acusa
  expectFail(verifyEvidence(edit(TOTAL, (x) => x.evidence.trades.shift())), "TAMPERED", ["V2.population-refs"])
  // em população acima do limite (HASH_ONLY) o trade removido é uma âncora
  const h = verifyEvidence(edit(HASH_ONLY, (x) => x.evidence.trades.shift()))
  assert.equal(h.status, "TAMPERED")
  assert.ok(failedIds(h).includes("V2.contributor-refs"))
  assert.equal(check(h, "V2.contributor-refs").code, "V_REF_TRADE_MISSING")
})

test("V2 trade extra (sem referência): V_TRADE_UNREFERENCED; trade duplicado: V_DUP_TRADE_ID (identidade duplicada não vira duas)", () => {
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.trades.push({ ...clone(x.evidence.trades[0]), tradeId: `trd_${"e".repeat(32)}` }))), "TAMPERED", ["V2.unreferenced-trades"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.trades.push(clone(x.evidence.trades[0])))), "TAMPERED", ["V2.trade-ids-unique"])
  // id repetido também na lista da população: não é aceito
  const rep = verifyEvidence(edit(NETPNL, (x) => (x.evidence.metrics[0].population.tradeIds[1] = x.evidence.metrics[0].population.tradeIds[0])))
  assert.equal(rep.status, "TAMPERED")
  assert.ok(failedIds(rep).includes("V2.population-shape"))
  assert.match(check(rep, "V2.population-shape").detail, /id repetido/)
  // ImportRef duplicado
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.imports.push(clone(x.evidence.imports[0])))), "TAMPERED", ["V2.import-ids-unique"])
  // sem métricas (bundle de trade): a regra de "trade sem referência" não se aplica → SKIPPED, e ainda não é VALID
  const noMetrics = edit(NETPNL, (x) => (x.evidence.metrics = []))
  const nm = verifyEvidence(noMetrics)
  assert.equal(check(nm, "V2.unreferenced-trades").status, "SKIPPED")
  assert.equal(check(nm, "V2.unreferenced-trades").code, "S_NO_METRICS")
  assert.equal(nm.status, "TAMPERED") // subject METRIC já não resolve
  assert.equal(check(nm, "V3.population").code, "S_NO_METRICS") // sem métricas V3/V4 não têm o que conferir (SKIPPED bloqueante, nunca PASS)
  assert.equal(check(nm, "V2.subject").code, "V_SUBJECT_UNRESOLVED")
})

test("V2 ImportRef removido ⇒ V_REF_IMPORT_MISSING; importId do trade trocado por um inexistente ⇒ ImportRef ausente + linhas divergentes + ImportRef órfão", () => {
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.evidence.imports = []))), "TAMPERED", ["V2.import-refs"])
  const rep = verifyEvidence(edit(MIX, (x) => (x.evidence.imports = x.evidence.imports.slice(0, 1))))
  assert.equal(rep.status, "TAMPERED")
  assert.deepEqual(failedIds(rep), ["V2.import-refs"])
  const swapped = verifyEvidence(edit(NETPNL, (x) => (x.evidence.trades[0].importId = `imp_${"0".repeat(32)}`)))
  assert.equal(swapped.status, "TAMPERED")
  assert.deepEqual(failedIds(swapped), ["V2.import-refs", "V2.row-import"])
  assert.equal(check(swapped, "V2.import-refs").code, "V_REF_IMPORT_MISSING")
  assert.equal(check(swapped, "V2.row-import").code, "V_ROWREF_IMPORT_MISMATCH")
  // ImportRef sem nenhum trade
  const orphan = verifyEvidence(edit(NETPNL, (x) => x.evidence.imports.push({ ...clone(x.evidence.imports[0]), importId: `imp_${"7".repeat(32)}` })))
  expectFail(orphan, "TAMPERED", ["V2.import-unreferenced"])
})

test("V2 importId do trade trocado por OUTRO import real do bundle ⇒ só as sourceRows divergem (V_ROWREF_IMPORT_MISMATCH); sourceRows[].importId divergente idem", () => {
  const otherId = rec2.importId
  const t0 = (MIX.evidence.trades.find((t) => t.importId === rec.importId) as Any).tradeId as string
  const rep = verifyEvidence(edit(MIX, (x) => (x.evidence.trades.find((t: Any) => t.tradeId === t0).importId = otherId)))
  expectFail(rep, "TAMPERED", ["V2.row-import"])
  const rep2_ = verifyEvidence(edit(NETPNL, (x) => (x.evidence.trades[0].sourceRows[0].importId = `imp_${"1".repeat(32)}`)))
  expectFail(rep2_, "TAMPERED", ["V2.row-import"])
})

test("V2 referências a linhas penduradas (perna → rowNo inexistente) e rowNo duplicado no trade", () => {
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.trades[0].exitLegs[0].rowRefs.push(9999))), "TAMPERED", ["V2.row-dangling"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.trades[0].entryLegs[0].rowRefs.push(9999))), "TAMPERED", ["V2.row-dangling"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.trades[0].sourceRows.push(clone(x.evidence.trades[0].sourceRows[0])))), "TAMPERED", ["V2.row-unique"])
})

test("V2 contributor apontando para trade inexistente ⇒ V_REF_TRADE_MISSING; população com id inexistente idem", () => {
  expectFail(verifyEvidence(edit(WIN, (x) => (x.evidence.metrics[0].contributors.items[0].tradeId = `trd_${"9".repeat(32)}`))), "TAMPERED", ["V2.contributor-refs"])
  const pop = verifyEvidence(edit(WIN, (x) => (x.evidence.metrics[0].population.tradeIds[0] = `trd_${"9".repeat(32)}`)))
  assert.equal(pop.status, "TAMPERED")
  assert.equal(check(pop, "V2.population-refs").code, "V_REF_TRADE_MISSING")
  assert.ok(failedIds(pop).includes("V2.unreferenced-trades")) // o trade que perdeu a referência fica órfão
})

test("V2 roleCounts × contributors: contagem alterada, item removido, item repetido, papel fora de âncora em lista incompleta, métrica sem contribuintes com contagem", () => {
  expectFail(verifyEvidence(edit(WIN, (x) => (x.evidence.metrics[0].contributors.roleCounts.WINNER += 1))), "TAMPERED", ["V2.contributor-counts"])
  expectFail(verifyEvidence(edit(WIN, (x) => x.evidence.metrics[0].contributors.items.pop())), "TAMPERED", ["V2.contributor-counts"])
  expectFail(verifyEvidence(edit(WIN, (x) => (x.evidence.metrics[0].contributors.roleCounts.LOSER = 1))), "TAMPERED", ["V2.contributor-counts"])
  const dup = verifyEvidence(edit(WIN, (x) => x.evidence.metrics[0].contributors.items.push(clone(x.evidence.metrics[0].contributors.items[0]))))
  assert.equal(dup.status, "TAMPERED")
  assert.match(check(dup, "V2.contributor-counts").detail, /repetido/)
  expectFail(verifyEvidence(edit(TOTAL, (x) => (x.evidence.metrics[0].contributors.roleCounts.WINNER = 1))), "TAMPERED", ["V2.contributor-counts"])
  expectFail(verifyEvidence(edit(HASH_ONLY, (x) => (x.evidence.metrics[0].contributors.items[0].role = "WINNER"))), "TAMPERED", ["V2.contributor-counts"])
  const lower = verifyEvidence(edit(HASH_ONLY, (x) => (x.evidence.metrics[0].contributors.roleCounts.LARGEST_WINNER = 0)))
  expectFail(lower, "TAMPERED", ["V2.contributor-counts"])
  assert.equal(verifyEvidence(HASH_ONLY).status, "UNVERIFIABLE")
})

test("V2 forma da população: verifiability, tradeIds e afterFilters incoerentes entre si; subject que não resolve", () => {
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.evidence.metrics[0].verifiability = "HASH_ONLY"))), "TAMPERED", ["V2.population-shape"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.evidence.metrics[0].population.afterFilters += 1))), "TAMPERED", ["V2.population-shape"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => x.evidence.metrics[0].population.tradeIds.pop())), "TAMPERED", ["V2.population-shape"]) // o trade segue citado pelos contributors
  expectFail(verifyEvidence(edit(TOTAL, (x) => x.evidence.metrics[0].population.tradeIds.pop())), "TAMPERED", ["V2.population-shape", "V2.unreferenced-trades"]) // sem contributors, a lista é a única referência
  expectFail(verifyEvidence(edit(HASH_ONLY, (x) => (x.evidence.metrics[0].verifiability = "FULL"))), "TAMPERED", ["V2.population-shape"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.subject.id = "naoExiste"))), "TAMPERED", ["V2.subject"])
  expectFail(verifyEvidence(edit(NETPNL, (x) => (x.subject = { type: "TRADE", id: "trd_inexistente" }))), "TAMPERED", ["V2.subject"])
})

test("V2 não deduplica nem altera identidades: o relatório descreve o problema, o bundle de entrada fica intacto", () => {
  const dupBundle = edit(NETPNL, (x) => x.evidence.trades.push(clone(x.evidence.trades[0])))
  const before = canonicalJson(dupBundle)
  verifyEvidence(dupBundle)
  assert.equal(canonicalJson(dupBundle), before)
})

// ── relatório: determinismo, honestidade e arquitetura ───────────────────────

test("DETERMINISMO: mesmo bundle ⇒ mesmo relatório byte a byte (sem relógio/random); cada check tem id único, resultado e explicação não vazia", () => {
  for (const b of [WIN, MIX, HASH_ONLY, edit(WIN, (x) => x.evidence.trades.shift()), edit(WIN, (x) => (x.extra = 1)), null]) {
    const a = verifyEvidence(b)
    assert.equal(canonicalJson(a), canonicalJson(verifyEvidence(b)))
    for (const c of a.checks) {
      assert.ok(["PASS", "FAIL", "SKIPPED"].includes(c.status))
      assert.ok(c.detail.length > 10, c.id)
      assert.equal(c.status === "PASS", c.code === null, `${c.id}: PASS ⇔ sem código`)
      assert.ok(c.status !== "FAIL" || /^V_/.test(c.code ?? ""))
      assert.ok(c.status !== "SKIPPED" || /^S_/.test(c.code ?? ""))
    }
  }
  const text = JSON.stringify(verifyEvidence(WIN))
  assert.ok(!/Sim10\d/.test(text)) // sem nome de conta
})

test("HONESTIDADE: SKIPPED nunca vira PASS; formato inválido não vira TAMPERED; só inconsistência vira TAMPERED; VALID exige zero FAIL e zero SKIPPED bloqueante", () => {
  const seen = new Set<string>()
  const inputs: unknown[] = [WIN, NETPNL, TOTAL, HASH_ONLY, MIX, null, {}, edit(WIN, (x) => x.evidence.trades.shift()), edit(WIN, (x) => (x.extra = 1)), edit(WIN, (x) => (x.evidence.metrics[0].value += 1), false)]
  for (const b of inputs) {
    const rep = verifyEvidence(b)
    seen.add(rep.status)
    if (rep.status === "INVALID_FORMAT") assert.ok(rep.checks.some((c) => c.level === "V0" && c.status === "FAIL") && rep.checks.every((c) => c.level === "V0" || c.status === "SKIPPED"))
    if (rep.status === "TAMPERED") assert.ok(rep.checks.every((c) => c.level !== "V0" || c.status === "PASS") && rep.checks.some((c) => c.status === "FAIL"))
    if (rep.status === "UNVERIFIABLE") assert.ok(rep.checks.every((c) => c.status !== "FAIL") && rep.checks.some((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE"))
    if (rep.status === "VALID") assert.ok(rep.checks.every((c) => c.status === "PASS" || (c.status === "SKIPPED" && c.code === "S_NOT_APPLICABLE")))
    for (const c of rep.checks) assert.ok(c.status !== "SKIPPED" || (c.code ?? "").startsWith("S_"), `${c.id}: SKIPPED sem motivo`)
  }
  assert.deepEqual([...seen].sort(), ["INVALID_FORMAT", "TAMPERED", "UNVERIFIABLE", "VALID"])
})

test("ARQUITETURA (código): verify.ts não é segundo motor nem segunda implementação de hash — só chama o motor existente (traced/aggregate/prepare), os hashes de hash.ts e a conversão mecânica; sem node:crypto, relógio, random nem conta com valores financeiros", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/lib/evidence/verify.ts", import.meta.url)), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort()
  assert.deepEqual(imports, ["../infra/hash.ts", "../metrics/calculate.ts", "../metrics/catalog.ts", "../metrics/prepare.ts", "../metrics/trace.ts", "../metrics/types.ts", "./hash.ts", "./schema.ts", "./to-analytics.ts"])
  const code = src.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``") // só código: mensagens e títulos podem citar termos
  assert.ok(!/node:crypto|createHash|sha256Hex|hashCanonical/.test(code), "o hash vem de computeEvidenceHash/tradeSetHash")
  assert.ok(!/Date\.now|new Date|Math\.random|randomUUID/.test(code))
  // o motor é chamado, nunca reimplementado: nenhuma conta com P&L/R/pontos e nenhuma fórmula de métrica
  assert.ok(!/\.pnl\.(net|gross|commission|fees)\s*[-+*/]|\.r\.(net|points)\s*[-+*/]|pointsPerContract\s*[-+*/]/.test(code))
  assert.ok(!/Math\.(max|min|sqrt|abs|round)|\.reduce\(/.test(code), "nenhuma agregação numérica própria")
  assert.ok(/calculateMetricsTraced\(/.test(code) && /aggregateTradesTraced\(/.test(code))
})

// ── fixtures reais (locais; sem números embutidos) ───────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
const C = { valid: 0, unverifiable: 0, bundles: 0, hashOnly: 0, groups: 0, attacks: 0, detected: 0, missed: 0, fails: 0 }
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  test(`REAL ${tag}: bundles limpos (ciclos e linhas × todas as métricas × total/grupos/HASH_ONLY) ⇒ nenhum FAIL (VALID ou UNVERIFIABLE com motivo); ataques de referência/selo sempre detectados`, () => {
    for (const label of ["ciclos", "linhas"] as const) {
      const run = runImportPipeline(text, { ...ctx, fileName: `conta-${tag}.csv`, ...(label === "linhas" ? { reconstructCycles: false } : {}) })
      const record = run.importRecord as ImportRecord
      const An = toAnalyticsTrades(withRisk(run.trades))
      const bundles: EvidenceBundle[] = []
      const push = (metricId: string, source: MetricSource) => {
        const r = explainMetric({ metricId, source, trades: An, importRecords: [record] })
        assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
        const b = metricEvidenceBundle(r as Any)
        bundles.push(b)
        if (b.evidence.metrics[0].verifiability === "HASH_ONLY") C.hashOnly += 1
      }
      const tm = calculateMetricsTraced(An)
      for (const id of METRIC_IDS) push(id, { kind: "METRICS", result: tm.result, trace: tm.trace })
      for (const by of ["account", "hour"] as const) {
        const ag = aggregateTradesTraced(An, { groupBy: by })
        ag.result.groups.forEach((_, i) => {
          C.groups += 1
          for (const id of METRIC_IDS) push(id, { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: i } })
        })
      }
      const low = calculateMetricsTraced(An, { tradeIdsLimit: 3 })
      for (const id of ["netPnl", "winners", "largestWinner", "maxDrawdown", "top3WinnersSharePct"]) push(id, { kind: "METRICS", result: low.result, trace: low.trace })
      bundles.forEach((b, n) => {
        C.bundles += 1
        const rep = verifyEvidence(b)
        const bad = rep.checks.filter((c) => c.status === "FAIL")
        C.fails += bad.length
        assert.deepEqual(bad.map((c) => [c.id, c.detail]), [], `${label} #${n} ${b.subject.id}`)
        assert.ok(rep.status === "VALID" || rep.status === "UNVERIFIABLE", rep.status)
        if (rep.status === "UNVERIFIABLE") assert.ok(rep.checks.some((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE"))
        C[rep.status === "VALID" ? "valid" : "unverifiable"] += 1
        assert.equal(canonicalJson(rep), canonicalJson(verifyEvidence(clone(b))))
        if (n % 7 !== 0) return // ataques em amostra (cada 7º bundle) para manter o teste rápido
        const attacks: Array<[string, (x: Any) => void, string, boolean]> = [
          ["trade removido", (x) => x.evidence.trades.shift(), "V_REF_TRADE_MISSING", true],
          ["trade extra", (x) => x.evidence.trades.push({ ...clone(x.evidence.trades[0]), tradeId: `trd_${"e".repeat(32)}` }), "V_TRADE_UNREFERENCED", true],
          ["ImportRef removido", (x) => (x.evidence.imports = []), "V_REF_IMPORT_MISSING", true],
          ["sourceRows.importId", (x) => (x.evidence.trades[0].sourceRows[0].importId = `imp_${"1".repeat(32)}`), "V_ROWREF_IMPORT_MISMATCH", true],
          ["roleCounts", (x) => { const rc = x.evidence.metrics[0].contributors.roleCounts; rc[Object.keys(rc)[0]] += 1 }, "V_CONTRIBUTORS_MISMATCH", Object.keys(b.evidence.metrics[0].contributors.roleCounts).length > 0],
          ["valor sem novo selo", (x) => { x.evidence.metrics[0].population.afterFilters += 0; x.claim.statement = "x" }, "V_SEAL_MISMATCH", true],
        ]
        for (const [what, fn, code, applicable] of attacks) {
          if (!applicable) continue
          C.attacks += 1
          const forged = edit(b, fn, what !== "valor sem novo selo")
          const r = verifyEvidence(forged)
          const hit = r.status === "TAMPERED" && r.checks.some((c) => c.code === code)
          if (hit) C.detected += 1
          else C.missed += 1
          assert.ok(hit, `${label} #${n} ${b.subject.id}: ${what} não detectado (${r.status}: ${JSON.stringify(r.checks.filter((c) => c.status === "FAIL").map((c) => c.code))})`)
        }
      })
    }
  })
}
if (names.length) console.log(`  → fixtures reais: ${C.bundles} bundles verificados (${C.groups} grupos; ${C.hashOnly} HASH_ONLY) · ${C.valid} VALID, ${C.unverifiable} UNVERIFIABLE · ${C.fails} FAIL em bundles limpos · ${C.attacks} ataques em amostra: ${C.detected} detectados, ${C.missed} não detectados`)

console.log(`\n${passed} testes ok`)
