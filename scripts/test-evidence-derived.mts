// E6.3 — Evidence dos derivados (ranking, contribuição, comparação do E6.2) e verificação V6.   node scripts/test-evidence-derived.mts
// Sintético versionado (pipeline NT8: CSV → ciclos → motor → Evidence) + (se existirem) as fixtures reais LOCAIS, sem números embutidos.
// O verificador V6 NÃO tem fórmula própria: reexecuta as funções reais do E6.2 sobre os TradeEvidence do bundle. Estes testes provam isso
// adulterando valor, delta, chave, dimensão, referência e selo (refeito) e exigindo detecção — e provam que SKIPPED nunca vira PASS.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived, type ExplainDerivedInput } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash, normalizeForHash } from "../src/lib/evidence/hash.ts"
import { EvidenceBundleSchema, type EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { CHECK_CATALOG, verifyEvidence, type VerifyReport } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { canonicalJson, sha256Hex } from "../src/lib/infra/hash.ts"
import { accountRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { calculateMetrics, calculateMetricsTraced, compareGroups, exitBreakdown, exitReasonAnalysis, rankGroups, toAnalyticsTrades, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const J = JSON.stringify
const BRT = "America/Sao_Paulo"
const V6 = CHECK_CATALOG.filter((c) => c.level === "V6").map((c) => c.id)
const chk = (r: VerifyReport, id: string) => r.checks.find((c) => c.id === id)!
const fails = (r: VerifyReport) => r.checks.filter((c) => c.status === "FAIL").map((c) => c.id)

// ── fixture: 8 ciclos (2 contas × 2 horas × motivos variados) em 2 semanas ───

interface CyDef { account: string; entryHour: number; day: number; legs: Array<{ qty?: number; exitPrice: number; label: string; min: number }> }
const CY: CyDef[] = [
  { account: "Sim101", entryHour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", entryHour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim101", entryHour: 14, day: 4, legs: [{ exitPrice: 1994, label: "Stop1", min: 10 }, { exitPrice: 1992, label: "Stop2", min: 20 }] },
  { account: "Sim102", entryHour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", entryHour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim102", entryHour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2002, label: "Saida X", min: 20 }] },
  { account: "Sim102", entryHour: 9, day: 10, legs: [{ exitPrice: 2002, label: "Saida X", min: 10 }, { exitPrice: 1999, label: "", min: 20 }] },
  { account: "Sim101", entryHour: 14, day: 11, legs: [{ qty: 3, exitPrice: 2005, label: "Target1", min: 10 }, { qty: 2, exitPrice: 1997, label: "Stop1", min: 20 }, { qty: 1, exitPrice: 2001, label: "Zerar", min: 30 }] },
]
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (day: number) => `${String(day).padStart(2, "0")}/03/2026`
const rowsOf = (): SynthRow[] =>
  CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: l.qty ?? 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.entryHour)}`, exitAt: `${dd(c.day)} ${hh(c.entryHour, l.min)}`, exitLabel: l.label })))
const CSV = synthCsv(rowsOf())
const FILE = "Sim101_Sim102-marco.csv"
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: FILE })
const rec = imp.importRecord as ImportRecord
const T: AnalyticsTrade[] = toAnalyticsTrades(imp.trades)
const OB = { timeZone: BRT, minSample: 4 } as const
const SECRETS = ["Sim101", "Sim102", "Estrategia Teste", FILE]
// Rótulos de ordem: o TradeEvidence (E3, anterior) já os carrega em `exitLegs[].sourceLabel` e `sourceRows[].entryLabel/exitLabel` — o E5b precisa deles para reconferir o motivo contra
// o CSV. O E6.3 NÃO os replica em nenhuma parte do derivado; fora desse campo conhecido do TradeEvidence eles não existem em lugar nenhum.
const LABELS = ["Target1", "Target2", "Stop1", "Stop2", "Zerar", "Saida X"]
const LABEL_KEYS = new Set(["sourceLabel", "entryLabel", "exitLabel"]) // campos do TradeEvidence (E3) que já carregam o rótulo de origem
const withoutSourceLabel = (x: unknown) => J(x, (k, v) => (LABEL_KEYS.has(k) ? undefined : v))

function build(spec: ExplainDerivedInput["spec"], over: Partial<ExplainDerivedInput> = {}): EvidenceBundle {
  const r = explainDerived({ spec: { options: OB, ...spec }, trades: T, importRecords: [rec], ...over })
  assert.equal(r.ok, true, r.ok ? "" : `${(r as Any).code}: ${(r as Any).message}`)
  return derivedEvidenceBundle(r as Any)
}
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const mutate = (b: EvidenceBundle, fn: (x: Any) => void, sealed = true): Any => {
  const c = clone(b) as Any
  fn(c)
  return sealed ? reseal(c) : c
}
const d0 = (b: Any) => b.evidence.derived[0]

// ── 1–6: derivados íntegros ──────────────────────────────────────────────────

const RANK_HOUR = build({ op: "GROUP_RANKING", args: { groupBy: "hour" } })
const RANK_ACC = build({ op: "GROUP_RANKING", args: { groupBy: "account" } })
const CMP_ACC = build({ op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: "Sim101" }, b: { account: "Sim102" } } })
const CMP_HOUR = build({ op: "GROUP_COMPARISON", args: { groupBy: "hour", a: { hour: "09" }, b: { hour: "14" } } })
const CMP_PER = build({ op: "PERIOD_COMPARISON", args: { a: { from: "2026-03-02", to: "2026-03-08" }, b: { from: "2026-03-09", to: "2026-03-15" } } })
const ANALYSIS = build({ op: "EXIT_REASON_ANALYSIS", args: {} })
const CMP_LEG = build({ op: "EXIT_REASON_COMPARISON_LEGS", args: { a: "STOP", b: "TARGET" } })
const CMP_TRADE = build({ op: "EXIT_REASON_COMPARISON_TRADES", args: { a: "STOP", b: "TARGET" } })
const LEG_RANK = build({ op: "LEG_GROUP_RANKING", args: { groupBy: "hour", reason: "STOP" } })
const ALL: Array<[string, EvidenceBundle]> = [["ranking por hora", RANK_HOUR], ["ranking por conta", RANK_ACC], ["comparação de contas", CMP_ACC], ["comparação por hora", CMP_HOUR], ["comparação de períodos", CMP_PER], ["análise por motivo", ANALYSIS], ["STOP×TARGET (pernas)", CMP_LEG], ["STOP×TARGET (trades)", CMP_TRADE], ["ranking de pernas STOP por hora", LEG_RANK]]

test("ÍNTEGROS (1–6): ranking, comparação de contas/horas/períodos, motivo de saída (análise, pernas, trades) e ranking por pernas ⇒ schema ok, V6 todo PASS, status VALID", () => {
  for (const [label, b] of ALL) {
    assert.equal(EvidenceBundleSchema.safeParse(b).success, true, label)
    const rep = verifyEvidence(b)
    assert.equal(rep.status, "VALID", `${label}: ${J(rep.checks.filter((c) => c.status !== "PASS" && c.code !== "S_NOT_APPLICABLE"))}`)
    for (const id of V6) assert.equal(chk(rep, id).status, "PASS", `${label} ${id}: ${chk(rep, id).detail}`)
    assert.deepEqual(fails(rep), [], label)
    assert.equal(b.claim.kind, "DERIVED")
    assert.equal(b.subject.type, "DERIVED")
    assert.equal(b.subject.id, d0(b).derivedId)
    assert.deepEqual(b.evidence.metrics, [])
  }
  assert.equal(CHECK_CATALOG.length, 39)
})

test("CONTRATO: operação, unidade (TRADE/LEG/TRADE_AND_LEG), versões, população FULL com TradeEvidence, refs de pernas só em operações de perna", () => {
  const unit = (b: Any) => d0(b).analysis.unit
  assert.deepEqual([RANK_HOUR, CMP_PER, CMP_TRADE].map(unit), ["TRADE", "TRADE", "TRADE"])
  assert.deepEqual([CMP_LEG, LEG_RANK].map(unit), ["LEG", "LEG"])
  assert.equal(unit(ANALYSIS), "TRADE_AND_LEG")
  for (const [, b] of ALL) {
    const d = d0(b)
    assert.deepEqual([d.analysis.schema, d.verifiability], ["metrics-analysis/1", "FULL"])
    assert.equal(d.population.tradeIds.length, d.population.afterFilters)
    assert.equal(b.evidence.trades.length, d.population.afterFilters)
    assert.match(d.derivedId, /^drv_[0-9a-f]{32}$/)
    assert.equal(d.computedAt, null)
  }
  assert.equal(d0(RANK_HOUR).refs.legs.applicable, false)
  assert.equal(d0(LEG_RANK).refs.legs.applicable, true)
  assert.ok(d0(LEG_RANK).refs.legs.items.length > 0)
  assert.deepEqual(Object.keys(d0(LEG_RANK).refs.legs.items[0]).sort(), ["legIndex", "rowNos", "tradeId"])
  // unidade preservada no próprio resultado
  assert.equal(d0(ANALYSIS).result.legs.unit, "LEG")
  assert.equal(d0(ANALYSIS).result.trades.unit, "TRADE")
})

// ── 7–11: UNKNOWN/MIXED, confidence, indisponível, inexistente, divergência ─

test("UNKNOWN e MIXED (7) e CONFIDENCE/LIMITAÇÕES (8): preservados e resumidos (pior confiança, limitações, reconciliação); UNKNOWN presente ⇒ UNKNOWN_EXIT_REASON; nada convertido", () => {
  const d = d0(ANALYSIS)
  assert.deepEqual(d.result.trades.rows.map((r: Any) => r.bucket), ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])
  assert.ok(d.result.trades.rows.find((r: Any) => r.bucket === "UNKNOWN").trades >= 1)
  assert.ok(d.result.trades.rows.find((r: Any) => r.bucket === "MIXED").trades >= 1)
  assert.ok(d.summary.limitations.includes("UNKNOWN_EXIT_REASON"))
  assert.ok(["LIMITED", "UNRELIABLE"].includes(d.summary.confidence))
  assert.equal(d.summary.reconciliation, "FULL")
  assert.equal(d.summary.inference, "DESCRIPTIVE_ONLY")
  // resumo = pior confiança das linhas
  const order = { OK: 0, LIMITED: 1, UNRELIABLE: 2 } as Any
  const rows = [...d.result.legs.rows, ...d.result.trades.rows]
  assert.equal(d.summary.confidence, rows.map((r: Any) => r.confidence).reduce((a: string, b: string) => (order[b] > order[a] ? b : a)))
  // ranking por exitReason também carrega MIXED/UNKNOWN como linhas listadas
  const rk = build({ op: "GROUP_RANKING", args: { groupBy: "exitReason" } })
  assert.deepEqual(d0(rk).result.rows.map((r: Any) => r.key.key[0]).sort(), ["MANUAL", "MIXED", "STOP", "TARGET", "UNKNOWN"])
  assert.equal(verifyEvidence(rk).status, "VALID")
  // E6.2 mantém OK/LIMITED/UNRELIABLE: ranking de conta com minSample alto ⇒ LIMITED por amostra baixa
  const low = build({ op: "GROUP_RANKING", args: { groupBy: "account" }, options: { ...OB, minSample: 30 } })
  assert.ok(d0(low).summary.limitations.includes("SAMPLE_LOW"))
  assert.equal(verifyEvidence(low).status, "VALID")
})

test("INDISPONÍVEL (9): métrica sem valor continua value:null com motivo (nunca 0) e sem ranking artificial; o V6 confirma a ausência", () => {
  const b = build({ op: "GROUP_RANKING", args: { groupBy: "hour", metric: "totalR" } })
  const rows = d0(b).result.rows
  assert.ok(rows.every((r: Any) => r.value.value === null && r.value.available === false && r.value.reason))
  assert.ok(rows.every((r: Any) => r.rank === null))
  assert.ok(rows.every((r: Any) => r.limitations.includes("METRIC_UNAVAILABLE") && r.confidence === "UNRELIABLE"))
  assert.equal(d0(b).summary.confidence, "UNRELIABLE")
  assert.equal(verifyEvidence(b).status, "VALID")
  // adulterar a ausência (inventar um valor/posição) é detectado
  const inv = mutate(b, (x) => { d0(x).result.rows[0].value.value = 0; d0(x).result.rows[0].rank = 1 })
  assert.equal(chk(verifyEvidence(inv), "V6.result").status, "FAIL")
  assert.equal(chk(verifyEvidence(inv), "V6.derived").status, "FAIL")
})

test("GRUPO INEXISTENTE (10): não inventa observação — lado com amostra 0, GROUP_NOT_FOUND, UNRELIABLE; o V6 reproduz e confirma", () => {
  const b = build({ op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: "Sim101" }, b: { account: "Sim999" } } })
  const d = d0(b)
  assert.equal(d.result.b.sampleSize, 0)
  assert.ok(d.result.limitations.includes("GROUP_NOT_FOUND"))
  assert.equal(d.summary.confidence, "UNRELIABLE")
  assert.ok(d.result.metrics.every((m: Any) => m.delta === null))
  assert.equal(J(b).includes("Sim999"), false, "nem o nome pedido pode ecoar")
  assert.equal(verifyEvidence(b).status, "VALID")
  // período vazio idem
  const p = build({ op: "PERIOD_COMPARISON", args: { a: { from: "2026-03-02", to: "2026-03-08" }, b: { from: "2027-01-01", to: "2027-01-07" } } })
  assert.ok(d0(p).result.limitations.includes("PERIOD_EMPTY"))
  assert.equal(verifyEvidence(p).status, "VALID")
})

test("DIVERGÊNCIA de reconciliação (11): resumo DIVERGENT e UNRELIABLE (nunca 'reconciliado'); valores das pernas ≠ do trade ficam à mostra; V6 confirma o que foi declarado", () => {
  const ts = T.map((x, i) => (i === 3 ? { ...x, trade: (() => { const t = clone(x.trade); t.exitLegs![0].pnl.net = (t.exitLegs![0].pnl.net as number) + 1; return t })() } : x))
  const b = build({ op: "EXIT_REASON_ANALYSIS", args: {} }, { trades: ts })
  const d = d0(b)
  assert.equal(d.summary.reconciliation, "DIVERGENT")
  assert.equal(d.result.reconciliation.status, "DIVERGENT")
  assert.ok(d.summary.limitations.includes("RECONCILIATION_DIVERGENT"))
  assert.equal(d.summary.confidence, "UNRELIABLE")
  assert.equal(verifyEvidence(b).status, "VALID", "VALID = reproduzível; a divergência continua DECLARADA (summary)")
  // esconder a divergência (declarar FULL) é detectado
  const hide = mutate(b, (x) => { d0(x).summary.reconciliation = "FULL"; d0(x).result.reconciliation.status = "FULL"; d0(x).summary.confidence = "OK" })
  const rep = verifyEvidence(hide)
  assert.equal(chk(rep, "V6.quality").status, "FAIL")
  assert.equal(rep.status, "TAMPERED")
  const leg = exitBreakdown(ts, OB)
  assert.equal(d.result.reconciliation.divergentTotal, leg.reconciliation.divergentTotal)
  const lr = build({ op: "LEG_GROUP_RANKING", args: { groupBy: "account", reason: "TARGET" } }, { trades: ts })
  assert.equal(d0(lr).summary.reconciliation, "DIVERGENT")
})

// ── 12–16: adulteração, referências, dimensão trocada, selo ─────────────────

test("ADULTERAÇÃO (12–13): valor derivado alterado, delta alterado, contribuição e posição — com o selo REFEITO — são detectados pelo V6 (TAMPERED); sem refazer o selo cai no V1", () => {
  const val = mutate(RANK_HOUR, (x) => { d0(x).result.rows[0].net.value += 1 })
  const rv = verifyEvidence(val)
  assert.equal(chk(rv, "V6.result").status, "FAIL")
  assert.equal(rv.status, "TAMPERED")
  assert.equal(chk(rv, "V1.seal").status, "PASS", "selo refeito: só o V6 pega")
  const delta = mutate(CMP_ACC, (x) => { const m = d0(x).result.metrics.find((q: Any) => q.metric === "netPnl"); m.delta += 0.01 })
  const rd = verifyEvidence(delta)
  assert.equal(chk(rd, "V6.derived").status, "FAIL")
  assert.equal(chk(rd, "V6.result").status, "PASS", "só o derivado mudou")
  const ratio = mutate(CMP_ACC, (x) => { d0(x).result.metrics.find((q: Any) => q.metric === "netPnl").ratio = 99 })
  assert.equal(chk(verifyEvidence(ratio), "V6.derived").status, "FAIL")
  const contrib = mutate(RANK_HOUR, (x) => { d0(x).result.rows[0].contributionToTotal.value = 0.9999 })
  assert.equal(chk(verifyEvidence(contrib), "V6.derived").status, "FAIL")
  const rank = mutate(RANK_HOUR, (x) => { const r = d0(x).result.rows; const a = r.findIndex((q: Any) => q.rank === 1); const b = r.findIndex((q: Any) => q.rank === 2); if (a >= 0 && b >= 0) { r[a].rank = 2; r[b].rank = 1 } })
  assert.equal(chk(verifyEvidence(rank), "V6.derived").status, "FAIL")
  const quality = mutate(RANK_HOUR, (x) => { d0(x).result.rows[0].sampleFlag = d0(x).result.rows[0].sampleFlag === "OK" ? "LOW" : "OK" })
  assert.equal(chk(verifyEvidence(quality), "V6.quality").status, "FAIL")
  const conf = mutate(RANK_HOUR, (x) => { d0(x).summary.confidence = d0(x).summary.confidence === "OK" ? "UNRELIABLE" : "OK"; d0(x).summary.limitations = ["INVENTADA"] })
  assert.equal(chk(verifyEvidence(conf), "V6.quality").status, "FAIL")
  // sem refazer o selo
  const raw = mutate(RANK_HOUR, (x) => { d0(x).result.rows[0].net.value += 1 }, false)
  assert.equal(chk(verifyEvidence(raw), "V1.seal").status, "FAIL")
  assert.equal(verifyEvidence(raw).status, "TAMPERED")
})

test("REFERÊNCIAS (14): trade da população inexistente, pernas citadas inexistentes/de outro trade, shape incoerente — V6.refs FAIL (TAMPERED); recálculo não é feito sobre população quebrada", () => {
  const missing = mutate(RANK_HOUR, (x) => { d0(x).population.tradeIds[0] = "trd_inexistente" })
  const r1 = verifyEvidence(missing)
  assert.equal(chk(r1, "V6.refs").status, "FAIL")
  assert.equal(r1.status, "TAMPERED")
  assert.equal(chk(r1, "V6.result").status, "SKIPPED") // não recalcula sobre referência quebrada
  assert.notEqual(chk(r1, "V6.result").status, "PASS")
  const leg = mutate(LEG_RANK, (x) => { d0(x).refs.legs.items[0].legIndex = 99 })
  assert.equal(chk(verifyEvidence(leg), "V6.refs").status, "FAIL")
  const rows = mutate(LEG_RANK, (x) => { d0(x).refs.legs.items[0].rowNos = [9999] })
  assert.equal(chk(verifyEvidence(rows), "V6.refs").status, "FAIL")
  const foreign = mutate(LEG_RANK, (x) => { d0(x).refs.legs.items[0].tradeId = "trd_de_fora" })
  assert.equal(chk(verifyEvidence(foreign), "V6.refs").status, "FAIL")
  const shape = mutate(RANK_HOUR, (x) => { d0(x).population.afterFilters += 1 })
  assert.equal(chk(verifyEvidence(shape), "V6.refs").status, "FAIL")
  const notApplicable = mutate(RANK_HOUR, (x) => { d0(x).refs.legs.items = [{ tradeId: d0(x).population.tradeIds[0], legIndex: 0, rowNos: [1] }] })
  assert.equal(chk(verifyEvidence(notApplicable), "V6.refs").status, "FAIL")
  // trade extra no bundle sem referência (V2) e derivado sem subject
  const stray = mutate(RANK_HOUR, (x) => { x.evidence.trades.push(clone(T.length ? x.evidence.trades[0] : null)); x.evidence.trades[x.evidence.trades.length - 1].tradeId = "trd_extra" })
  assert.ok(fails(verifyEvidence(stray)).length > 0)
  const subj = mutate(RANK_HOUR, (x) => { x.subject.id = "drv_00000000000000000000000000000000" })
  assert.equal(chk(verifyEvidence(subj), "V2.subject").status, "FAIL")
  // população trocada por outra do mesmo bundle: hash não fecha
  const hash = mutate(RANK_HOUR, (x) => { d0(x).population.tradeSetHash = "0".repeat(64) })
  assert.equal(chk(verifyEvidence(hash), "V6.population").status, "FAIL")
})

test("GRUPO / DIMENSÃO TROCADOS (15): groupBy, chave de grupo, filtro, operação e unidade adulterados (selo refeito) ⇒ detectado; V6 não aceita 'outra pergunta' com o mesmo resultado", () => {
  const dim = mutate(RANK_HOUR, (x) => { d0(x).query.args.groupBy = "account" })
  const r1 = verifyEvidence(dim)
  assert.ok(chk(r1, "V6.result").status === "FAIL" || chk(r1, "V6.derived").status === "FAIL" || chk(r1, "V6.quality").status === "FAIL")
  assert.equal(r1.status, "TAMPERED")
  const key = mutate(RANK_HOUR, (x) => { d0(x).result.rows[0].key.key = ["23"] })
  assert.equal(chk(verifyEvidence(key), "V6.result").status, "FAIL")
  const sides = mutate(CMP_ACC, (x) => { const { a, b } = d0(x).query.args; d0(x).query.args.a = b; d0(x).query.args.b = a })
  assert.equal(verifyEvidence(sides).status, "TAMPERED")
  const metric = mutate(RANK_HOUR, (x) => { d0(x).query.args.metric = "grossPnl" })
  assert.equal(verifyEvidence(metric).status, "TAMPERED")
  const order = mutate(RANK_HOUR, (x) => { d0(x).query.args.order = "ASC" })
  assert.equal(verifyEvidence(order).status, "TAMPERED")
  const filt = mutate(RANK_HOUR, (x) => { d0(x).query.filters.hour = 9 })
  assert.equal(verifyEvidence(filt).status, "TAMPERED")
  const op = mutate(CMP_LEG, (x) => { d0(x).analysis.op = "EXIT_REASON_COMPARISON_TRADES" })
  assert.equal(chk(verifyEvidence(op), "V6.query").status, "FAIL", "unidade/op incoerentes")
  const unit = mutate(RANK_HOUR, (x) => { d0(x).analysis.unit = "LEG" })
  assert.equal(chk(verifyEvidence(unit), "V6.query").status, "FAIL")
  const opts = mutate(RANK_HOUR, (x) => { d0(x).query.options.timeZone = "Lugar/Nenhum" })
  assert.equal(chk(verifyEvidence(opts), "V6.query").status, "FAIL")
  const args = mutate(RANK_HOUR, (x) => { d0(x).query.args = { groupBy: "hour", inventado: 1 } })
  assert.equal(chk(verifyEvidence(args), "V6.query").status, "FAIL")
  const unitMix = mutate(ANALYSIS, (x) => { d0(x).result.legs.rows[0].net.value += 1 })
  assert.equal(chk(verifyEvidence(unitMix), "V6.result").status, "FAIL")
})

test("SELO REFEITO (16): adulteração coordenada de valor+resumo é pega pelo recálculo (o selo só prova integridade interna, não assinatura); campos desconhecidos viram INVALID_FORMAT", () => {
  const b = mutate(RANK_HOUR, (x) => { d0(x).result.rows[0].net.value += 1; d0(x).summary.limitations = ["COISA"] })
  assert.equal(verifyEvidence(b).status, "TAMPERED")
  const extra = mutate(RANK_HOUR, (x) => { d0(x).extra = 1 })
  assert.equal(verifyEvidence(extra).status, "INVALID_FORMAT")
  const badId = mutate(RANK_HOUR, (x) => { d0(x).derivedId = "xyz" })
  assert.equal(verifyEvidence(badId).status, "INVALID_FORMAT")
  const claim = mutate(RANK_HOUR, (x) => { x.claim.kind = "OUTRO" })
  assert.equal(verifyEvidence(claim).status, "INVALID_FORMAT")
  assert.ok(verifyEvidence(RANK_HOUR).limitations.some((l) => l.code === "L_SEAL_NOT_SIGNATURE"))
})

// ── 17–18: HASH_ONLY, versões, associação inverificável ─────────────────────

test("HASH_ONLY (17): população acima do limite ⇒ só o tradeSetHash; V6 SKIPPED S_HASH_ONLY (nunca PASS), UNVERIFIABLE, sem FAIL; trades e pernas ficam fora do bundle", () => {
  const b = build({ op: "LEG_GROUP_RANKING", args: { groupBy: "hour", reason: "STOP" }, options: { ...OB, tradeIdsLimit: 3 } })
  const d = d0(b)
  assert.deepEqual([d.verifiability, d.population.tradeIds, b.evidence.trades.length, b.evidence.imports.length], ["HASH_ONLY", null, 0, 0])
  assert.deepEqual([d.refs.legs.applicable, d.refs.legs.items], [true, null])
  assert.ok(d.result.rows.length > 0)
  const rep = verifyEvidence(b)
  assert.equal(rep.status, "UNVERIFIABLE")
  assert.deepEqual(fails(rep), [])
  for (const id of ["V6.population", "V6.result", "V6.derived", "V6.quality", "V6.determinism"]) {
    assert.equal(chk(rep, id).status, "SKIPPED", id)
    assert.equal(chk(rep, id).code, "S_HASH_ONLY", id)
  }
  assert.equal(chk(rep, "V6.refs").status, "PASS")
  // HASH_ONLY adulterado continua sem acusação indevida E sem confirmação
  const forged = mutate(b, (x) => { d0(x).result.rows[0].net.value += 1 })
  assert.equal(verifyEvidence(forged).status, "UNVERIFIABLE")
  assert.equal(chk(verifyEvidence(forged), "V1.seal").status, "PASS")
  // população HASH_ONLY com tradeIds fabricados é incoerente
  const fake = mutate(b, (x) => { d0(x).population.tradeIds = ["trd_a"] })
  assert.equal(chk(verifyEvidence(fake), "V6.refs").status, "FAIL")
})

test("VERSÕES INCOMPATÍVEIS (18): contrato/definição/motor diferentes ⇒ SKIPPED S_VERSION_INCOMPATIBLE (não é adulteração), UNVERIFIABLE; nunca PASS", () => {
  for (const [path, v] of [["definitionVersion", "0.0.1"], ["engineVersion", "metrics/0.0.1"], ["schema", "metrics-analysis/0"]] as const) {
    const b = mutate(RANK_HOUR, (x) => { d0(x).analysis[path] = v })
    const rep = verifyEvidence(b)
    assert.equal(rep.status, "UNVERIFIABLE", path)
    assert.equal(chk(rep, "V6.versions").code, "S_VERSION_INCOMPATIBLE")
    for (const id of ["V6.result", "V6.derived", "V6.quality"]) assert.equal(chk(rep, id).status, "SKIPPED", `${path} ${id}`)
    assert.deepEqual(fails(rep), [], path)
  }
})

test("ASSOCIAÇÃO INVERIFICÁVEL: dimensão/filtro sem referência na Evidence (estratégia, setup…) ⇒ SKIPPED S_ASSOCIATION_UNVERIFIABLE, nunca confirmado; chave sai como strategyRef", () => {
  const b = build({ op: "GROUP_RANKING", args: { groupBy: "strategy" } })
  const d = d0(b)
  assert.deepEqual(d.result.rows.map((r: Any) => r.key.key[0]), [strategyRef("Estrategia Teste")])
  const rep = verifyEvidence(b)
  assert.equal(rep.status, "UNVERIFIABLE")
  assert.equal(chk(rep, "V6.query").code, "S_ASSOCIATION_UNVERIFIABLE")
  assert.equal(chk(rep, "V6.result").status, "SKIPPED")
  assert.deepEqual(fails(rep), [])
  assert.equal(J(b).includes("Estrategia Teste"), false)
  // filtro por estratégia: guardado como ref; população verificável, associação não
  const f = build({ op: "GROUP_RANKING", args: { groupBy: "hour" }, filters: { strategyName: "Estrategia Teste" } })
  assert.deepEqual(d0(f).query.filters.strategyName, strategyRef("Estrategia Teste"))
  assert.equal(chk(verifyEvidence(f), "V6.query").code, "S_ASSOCIATION_UNVERIFIABLE")
  assert.equal(J(f).includes("Estrategia Teste"), false)
})

// ── 19–22: determinismo, privacidade, hashes, não regressão ─────────────────

test("DETERMINISMO (19): mesma entrada ⇒ mesmo derivado, mesmo derivedId e mesmo evidenceHash; ordem de chegada dos trades não altera; sem relógio/random", () => {
  for (const spec of [{ op: "GROUP_RANKING", args: { groupBy: ["account", "hour"] } }, { op: "EXIT_REASON_ANALYSIS", args: {} }, { op: "PERIOD_COMPARISON", args: { a: { from: "2026-03-02", to: "2026-03-08" }, b: { from: "2026-03-09", to: "2026-03-15" } } }] as const) {
    const a = build(spec as Any)
    assert.equal(J(build(spec as Any)), J(a))
    assert.equal(J(build(spec as Any, { trades: [...T].reverse() })), J(a))
    assert.equal(a.evidenceHash, build(spec as Any).evidenceHash)
  }
  const src = readFileSync(fileURLToPath(new URL("../src/lib/evidence/derived.ts", import.meta.url)), "utf8") + readFileSync(fileURLToPath(new URL("../src/lib/evidence/explain-derived.ts", import.meta.url)), "utf8")
  assert.equal(/Date\.now|new Date\(|Math\.random|randomUUID/.test(src.replace(/\/\/.*$/gm, "")), false)
  // o derivedId depende de operação/argumentos/população
  assert.notEqual(d0(RANK_HOUR).derivedId, d0(RANK_ACC).derivedId)
  assert.notEqual(d0(CMP_ACC).derivedId, d0(build({ op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: "Sim102" }, b: { account: "Sim101" } } })).derivedId)
  // o tradeSetHash do derivado muda se a população muda
  assert.notEqual(d0(build({ op: "GROUP_RANKING", args: { groupBy: "hour" }, filters: { account: "Sim101" } })).population.tradeSetHash, d0(RANK_HOUR).population.tradeSetHash)
})

test("PRIVACIDADE (20): nenhum nome de conta, estratégia, rótulo de ordem ou nome de arquivo em bundle, resultado ou relatório; só accountRef/strategyRef; sal respeitado; trava fail-closed", () => {
  for (const [label, b] of ALL) {
    const rep = verifyEvidence(b)
    for (const s of SECRETS) {
      assert.equal(J(b).includes(s), false, `${label}: vazou ${s}`)
      assert.equal(J(rep).includes(s), false, `${label} (relatório): vazou ${s}`)
    }
    // rótulos de ordem: nunca no derivado nem no relatório; no bundle só nesses campos do TradeEvidence (pré-existentes, E3)
    for (const l of LABELS) {
      assert.equal(J(d0(b)).includes(l), false, `${label}: derivado com rótulo ${l}`)
      assert.equal(J(rep).includes(l), false, `${label} (relatório): rótulo ${l}`)
      assert.equal(withoutSourceLabel(b).includes(l), false, `${label}: rótulo ${l} fora de sourceLabel`)
    }
  }
  assert.deepEqual(d0(CMP_ACC).result.a.key.key, [accountRef("Sim101")])
  assert.deepEqual(d0(CMP_ACC).query.args.a, { account: accountRef("Sim101") })
  assert.deepEqual(d0(build({ op: "GROUP_RANKING", args: { groupBy: "hour" }, filters: { account: ["Sim102", "Sim101"] } })).query.filters.account, [accountRef("Sim101"), accountRef("Sim102")].sort())
  // sal: import e derivado com o mesmo sal ⇒ refs salgados e verificação ok
  const salted = runImportPipeline(CSV, { sourceTz: BRT, fileName: FILE, accountRefSalt: "sal-teste" })
  const ts = toAnalyticsTrades(salted.trades)
  const rs = explainDerived({ spec: { op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: "Sim101" }, b: { account: "Sim102" } }, options: OB }, trades: ts, importRecords: [salted.importRecord as ImportRecord], opts: { accountRefSalt: "sal-teste" } })
  assert.equal(rs.ok, true)
  const sb = derivedEvidenceBundle(rs as Any)
  assert.deepEqual(d0(sb).result.a.key.key, [accountRef("Sim101", "sal-teste")])
  assert.notEqual(d0(sb).result.a.key.key[0], accountRef("Sim101"))
  assert.equal(verifyEvidence(sb).status, "VALID")
  assert.equal(J(sb).includes("sal-teste"), false, "o sal nunca é gravado")
  // fail-closed: nome de conta em filtro livre (setup) vaza ⇒ erro, resultado descartado
  const leak = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "hour" }, filters: { setup: "ajuste da Sim101" }, options: OB }, trades: T, importRecords: [rec] })
  assert.deepEqual([leak.ok, (leak as Any).code], [false, "E_ACCOUNT_NAME_LEAK"])
  const leak2 = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "hour" }, filters: { setup: "Estrategia Teste v2" }, options: OB }, trades: T, importRecords: [rec] })
  assert.deepEqual([leak2.ok, (leak2 as Any).code], [false, "E_STRATEGY_NAME_LEAK"])
  // pedidos inválidos são recusados com código
  const bad = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "naoExiste" } }, trades: T, importRecords: [rec] })
  assert.deepEqual([bad.ok, (bad as Any).code], [false, "E_DERIVED_SPEC_INVALID"])
  const noRec = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "hour" }, options: OB }, trades: T, importRecords: [] })
  assert.deepEqual([noRec.ok, (noRec as Any).code], [false, "E_IMPORT_UNRESOLVED"])
  const dup = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "hour" }, options: OB }, trades: [...T, T[0]], importRecords: [rec] })
  assert.deepEqual([dup.ok, (dup as Any).code], [false, "E_DUPLICATE_TRADE_ID"])
  const noId = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "hour" }, options: OB }, trades: T.map((t, i) => (i === 0 ? { ...t, trade: { ...t.trade, tradeId: undefined, importId: undefined } } : t)) as AnalyticsTrade[], importRecords: [rec] })
  assert.equal(noId.ok, false)
})

test("tradeSetHash e HASHES (21): o tradeSetHash do derivado = o do motor (E2); bundles SEM derivados hasheiam exatamente como antes (aditivo); com derivados o evidenceHash muda — esperado", () => {
  assert.equal(d0(RANK_HOUR).population.tradeSetHash, calculateMetrics(T, OB).population.tradeSetHash)
  assert.equal(d0(RANK_HOUR).population.tradeSetHash, rankGroups(T, { groupBy: "hour", ...OB }).population.tradeSetHash)
  // bundle de MÉTRICA: sem a chave `derived`; hash idêntico ao cálculo "antigo" (sem derivados) refeito à mão
  const t = calculateMetricsTraced(T, OB)
  const mb = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [rec] }) as Any)
  assert.equal("derived" in mb.evidence, false)
  const legacy = (b: Any) => {
    const by = (xs: Any[], k: (x: Any) => string) => [...xs].sort((a, c) => (k(a) < k(c) ? -1 : k(a) > k(c) ? 1 : 0))
    const { evidenceHash: _h, ...rest } = b
    void _h
    return sha256Hex(`meutrade/evidence/1\0${canonicalJson({ ...rest, evidence: { imports: by(rest.evidence.imports.map(({ importedAt: _i, ...i }: Any) => (void _i, i)), (i) => i.importId), trades: by(rest.evidence.trades, (x) => x.tradeId), metrics: by(rest.evidence.metrics.map(({ computedAt: _c, ...m }: Any) => (void _c, m)), (m) => canonicalJson(m)) } })}`)
  }
  assert.equal(mb.evidenceHash, legacy(mb))
  assert.equal(computeEvidenceHash({ ...mb, evidence: { ...mb.evidence, derived: [] } }), mb.evidenceHash, "derived vazio ≡ ausente")
  // com derivados o selo muda e continua determinístico
  assert.notEqual(RANK_HOUR.evidenceHash, legacy(RANK_HOUR))
  assert.equal(RANK_HOUR.evidenceHash, computeEvidenceHash(RANK_HOUR))
  // computedAt fica fora do hash
  const withClock = mutate(RANK_HOUR, (x) => { d0(x).computedAt = "2026-10-12T00:00:00Z" }, false)
  assert.equal(computeEvidenceHash(withClock), RANK_HOUR.evidenceHash)
  assert.equal(J(normalizeForHash(withClock)).includes("computedAt"), false)
  // trades da população: fingerprint/identidade preservados
  const ids = new Set(RANK_HOUR.evidence.trades.map((x) => x.tradeId))
  assert.deepEqual([...ids].sort(), T.map((x) => x.id).sort())
})

test("NÃO REGRESSÃO (22): V0–V4 inalterados em bundles de métrica (V6 = NOT_APPLICABLE, mesmo status); resultado do derivado = chamada direta ao E6.2; E6.0/E6.1 idênticos; métrica+derivado no mesmo bundle ⇒ V4 e V6 passam", () => {
  const t = calculateMetricsTraced(T, OB)
  assert.deepEqual(calculateMetrics(T, OB), t.result, "calculateMetrics ≡ calculateMetricsTraced(...).result")
  const mb = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [rec] }) as Any)
  const rep = verifyEvidence(mb)
  assert.equal(rep.status, "VALID")
  for (const id of V6) assert.deepEqual([chk(rep, id).status, chk(rep, id).code], ["SKIPPED", "S_NOT_APPLICABLE"])
  assert.equal(rep.checks.filter((c) => c.level !== "V6" && c.status === "FAIL").length, 0)
  // direto: o resultado armazenado é exatamente o do E6.2 (sem filtros base, inputTrades = afterFilters)
  const direct = JSON.parse(J(rankGroups(T, { groupBy: "hour", ...OB })))
  assert.deepEqual(d0(RANK_HOUR).result, direct)
  assert.deepEqual(d0(CMP_ACC).result, JSON.parse(J(compareGroups(T, { groupBy: "account", a: { account: "Sim101" }, b: { account: "Sim102" }, ...OB }))))
  assert.deepEqual(d0(ANALYSIS).result, JSON.parse(J(exitReasonAnalysis(T, OB))))
  // misto: métrica + derivado
  const mixed = reseal({ ...mb, claim: { ...mb.claim }, evidence: { ...mb.evidence, derived: [d0(RANK_HOUR)] } })
  const rm = verifyEvidence(mixed)
  assert.equal(rm.status, "VALID", J(rm.checks.filter((c) => c.status !== "PASS" && c.code !== "S_NOT_APPLICABLE")))
  assert.equal(chk(rm, "V4.metric-value").status, "PASS")
  assert.equal(chk(rm, "V6.result").status, "PASS")
  // E6.1 e E6.0 intactos
  const bd = exitBreakdown(T, OB)
  assert.equal(d0(ANALYSIS).result.legs.total.legs, bd.total.legs)
  assert.deepEqual(d0(ANALYSIS).result.trades.rows.map((r: Any) => r.trades), (["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"] as const).map((k) => bd.population.tradesByBucket[k]))
  // E3/E4: a Evidence de trade e de métrica continuam gerando o mesmo (testes próprios no test:domain)
})

test("E5b (origem) CONTINUA SEPARADO: verifyEvidenceSource lê o bundle de derivados, confere cada trade contra o CSV e NÃO alega prova da origem do derivado; adulterar o CSV é detectado", () => {
  const files = { [rec.importId]: new TextEncoder().encode(CSV) }
  const rep = verifyEvidenceSource(ALL[0][1], files, {})
  assert.notEqual(rep.status, "INVALID_FORMAT")
  assert.ok(["SOURCE_VERIFIED", "SOURCE_VERIFIED_PARTIAL"].includes(rep.status), rep.status)
  assert.equal(rep.checks.filter((c) => c.status === "FAIL").length, 0)
  const wrong = verifyEvidenceSource(ALL[0][1], { [rec.importId]: new TextEncoder().encode(CSV.replace("2008", "2009")) }, {})
  assert.notEqual(wrong.status, "SOURCE_VERIFIED")
  assert.ok(verifyEvidence(ALL[0][1]).limitations.some((l) => l.code === "L_ORIGIN_NOT_PROVEN"))
})

// ── fixtures reais LOCAIS ────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] derivados reais: nenhum FAIL em bundle íntegro, adulterações detectadas, UNKNOWN preservado, sem nomes em claro`, () => {
    const text = readFileSync(join(DIR, name), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    const ts = toAnalyticsTrades(run.trades)
    const salt = (ctx as Any).accountRefSalt as string | undefined
    const accounts = [...new Set(run.trades.map((t) => t.account.sourceName).filter((n): n is string => !!n))]
    const specs: Array<ExplainDerivedInput["spec"]> = [
      { op: "GROUP_RANKING", args: { groupBy: "account" } },
      { op: "GROUP_RANKING", args: { groupBy: "hour" } },
      { op: "GROUP_RANKING", args: { groupBy: "exitReason" } },
      { op: "GROUP_RANKING", args: { groupBy: "week" } },
      { op: "EXIT_REASON_ANALYSIS", args: {} },
      { op: "EXIT_REASON_COMPARISON_LEGS", args: { a: "STOP", b: "TARGET" } },
      { op: "EXIT_REASON_COMPARISON_TRADES", args: { a: "STOP", b: "TARGET" } },
      { op: "LEG_GROUP_RANKING", args: { groupBy: ["direction", "hour"], reason: "STOP" } },
    ]
    if (accounts.length >= 2) specs.push({ op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: accounts[0] }, b: { account: accounts[1] } } })
    const plain = calculateMetrics(ts)
    if (plain.period.fromLocalDate && plain.period.toLocalDate && plain.period.fromLocalDate < plain.period.toLocalDate) specs.push({ op: "PERIOD_COMPARISON", args: { a: { from: plain.period.fromLocalDate, to: plain.period.fromLocalDate }, b: { from: plain.period.toLocalDate, to: plain.period.toLocalDate } } })
    const secrets = new Set<string>()
    for (const t of run.trades) {
      if (t.account.sourceName) secrets.add(t.account.sourceName.trim())
      if (t.labels.strategyName) secrets.add(t.labels.strategyName.trim())
      for (const l of t.exitLegs ?? []) if (l.sourceLabel && l.sourceLabel.trim().length >= 4) secrets.add(l.sourceLabel.trim())
    }
    const status: Record<string, number> = {}
    let attacks = 0
    let detected = 0
    for (const sp of specs) {
      const r = explainDerived({ spec: sp, trades: ts, importRecords: [run.importRecord as ImportRecord], opts: { accountRefSalt: salt } })
      assert.equal(r.ok, true, r.ok ? "" : `${sp.op}: ${(r as Any).code} ${(r as Any).message}`)
      const b = derivedEvidenceBundle(r as Any)
      const rep = verifyEvidence(b)
      assert.deepEqual(fails(rep), [], `${sp.op}: ${J(rep.checks.filter((c) => c.status === "FAIL"))}`)
      status[rep.status] = (status[rep.status] ?? 0) + 1
      for (const id of V6) assert.notEqual(chk(rep, id).status, "FAIL")
      if (rep.status !== "VALID") for (const c of rep.checks.filter((x) => x.status === "SKIPPED" && x.code !== "S_NOT_APPLICABLE")) assert.match(c.code as string, /^S_/)
      assert.equal(EvidenceBundleSchema.safeParse(b).success, true)
      for (const s of secrets) assert.equal(withoutSourceLabel(b).includes(s), false, `${sp.op}: vazou nome/rótulo da origem (fora de sourceLabel)`)
      for (const s of secrets) assert.equal(J(d0(b)).includes(s), false, `${sp.op}: derivado com nome/rótulo da origem`)
      // valores alterados (selo refeito) ⇒ detectados quando a população é verificável
      if (d0(b).verifiability === "FULL" && !rep.checks.some((c) => c.id === "V6.query" && c.status === "SKIPPED")) {
        const m = mutate(b, (x) => {
          const res = d0(x).result
          const row = res.rows?.[0] ?? res.legs?.rows?.[0] ?? res.metrics?.[0]
          const cell = row?.net ?? row?.a ?? row
          if (cell && typeof cell.value === "number") cell.value += 1
          else if (res.population) res.population.tradeSetHash = "f".repeat(64)
          else d0(x).summary.limitations.push("INVENTADA")
        })
        attacks += 1
        if (verifyEvidence(m).status === "TAMPERED") detected += 1
      }
    }
    assert.equal(detected, attacks, `ataques detectados ${detected}/${attacks}`)
    // UNKNOWN preservado: a análise real declara a parcela, sem mapeamento inventado
    const an = d0(derivedEvidenceBundle(explainDerived({ spec: { op: "EXIT_REASON_ANALYSIS", args: {} }, trades: ts, importRecords: [run.importRecord as ImportRecord], opts: { accountRefSalt: salt } }) as Any))
    assert.equal(an.result.reconciliation.unknownLegs, exitBreakdown(ts).byReason.UNKNOWN.legs)
    assert.equal(an.population.tradeSetHash, plain.population.tradeSetHash)
    console.log(`  → real: ${specs.length} derivados · ${J(status)} · ataques ${detected}/${attacks} · pernas UNKNOWN ${an.result.reconciliation.unknownLegs}/${an.result.legs.total.legs} · confiança do resumo ${an.summary.confidence}`)
  })
}

console.log(`\n${passed} testes ok`)
