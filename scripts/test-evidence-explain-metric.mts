// Evidence E4 — explainMetric: MetricsResult + trace → MetricEvidence → TradeEvidence → SourceRowRef → ImportRef.
//   node scripts/test-evidence-explain-metric.mts
// O oráculo dos testes sintéticos é a TABELA `SPEC` (pontos por trade, escrita à mão), não o motor. Fixtures reais: locais, sem números embutidos.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade, ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle, type ExplainMetricOk, type ExplainMetricResult, type MetricSource } from "../src/lib/evidence/explain-metric.ts"
import { explainTrades } from "../src/lib/evidence/explain-trade.ts"
import { computeEvidenceHash, tradeFingerprint, tradeFingerprintFromEvidence, tradeSetHash } from "../src/lib/evidence/hash.ts"
import { findAccountNameLeak } from "../src/lib/evidence/redact.ts"
import { EvidenceBundleSchema, MetricEvidenceSchema } from "../src/lib/evidence/schema.ts"
import { canonicalJson, sha256Hex } from "../src/lib/infra/hash.ts"
import { parseDelimited } from "../src/lib/ingest/csv.ts"
import { accountRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { ANCHOR_ROLES, METRIC_IDS, aggregateTrades, aggregateTradesTraced, calculateMetrics, calculateMetricsTraced, toAnalyticsTrades, type AnalyticsTrade, type ContributorRole } from "../src/lib/metrics/index.ts"
import { probeFromEvidence, synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const ok = (r: ExplainMetricResult): ExplainMetricOk => {
  assert.equal(r.ok, true, r.ok ? "" : `${(r as { code: string; message: string }).code}: ${(r as { message: string }).message}`)
  return r as ExplainMetricOk
}
const err = (r: ExplainMetricResult, code: string) => {
  assert.equal(r.ok, false)
  assert.equal((r as { code: string }).code, code)
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const idsOf = (e: ExplainMetricOk, role: ContributorRole) => e.metricEvidence.contributors.items.filter((c) => c.role === role).map((c) => c.tradeId)
const sorted = (xs: string[]) => [...xs].sort()

// ── população sintética: 14 ciclos, 2 contas, resultado conhecido por TABELA ──

interface Spec { acc: string; pts: number }
const SPEC: Spec[] = [
  { acc: "Sim101", pts: 4 }, { acc: "Sim101", pts: 3 }, { acc: "Sim101", pts: -2 }, { acc: "Sim101", pts: -3 }, { acc: "Sim101", pts: -1 },
  { acc: "Sim101", pts: 6 }, { acc: "Sim101", pts: 0 }, { acc: "Sim101", pts: 2 }, { acc: "Sim101", pts: -4 }, { acc: "Sim101", pts: 5 },
  { acc: "Sim102", pts: 1 }, { acc: "Sim102", pts: -1 }, { acc: "Sim102", pts: 7 }, { acc: "Sim102", pts: 3 },
]
const COMMISSION = 2.4
const netC = (s: Spec) => Math.round((s.pts * 10 - COMMISSION) * 100) // líquido em centavos (1 contrato MGC, 10 US$/ponto)
const grossC = (s: Spec) => s.pts * 1000
const rowsOf = (spec: Spec[]): SynthRow[] =>
  spec.map((s, i) => ({
    account: s.acc,
    entryPrice: 2000,
    exitPrice: 2000 + s.pts,
    entryAt: `${String(i + 2).padStart(2, "0")}/03/2026 ${String(9 + (i % 4)).padStart(2, "0")}:00:00`,
    exitAt: `${String(i + 2).padStart(2, "0")}/03/2026 ${String(9 + (i % 4)).padStart(2, "0")}:10:00`,
  }))
const FILE = "Sim101_Sim102-marco.csv"
const imp = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: FILE })
const rec = imp.importRecord as ImportRecord
const T = imp.trades
const TID = T.map((t) => t.tradeId as string)
const A = toAnalyticsTrades(T)
const records = [rec]
const explain = (metricId: string, source: MetricSource, trades: AnalyticsTrade[] = A, importRecords = records) => explainMetric({ metricId, source, trades, importRecords })
const total = (trades: AnalyticsTrade[] = A, args: Parameters<typeof calculateMetricsTraced>[1] = {}) => {
  const { result, trace } = calculateMetricsTraced(trades, args)
  return { result, trace, source: { kind: "METRICS", result, trace } as MetricSource }
}
const spec = (pred: (s: Spec, i: number) => boolean) => SPEC.flatMap((s, i) => (pred(s, i) ? [TID[i]] : []))

test("a população sintética tem 14 ciclos cronológicos em 2 contas (índice da tabela = índice do trade)", () => {
  assert.equal(T.length, 14)
  T.forEach((t, i) => assert.equal(t.account.sourceName, SPEC[i].acc))
  assert.deepEqual(T.map((t) => Math.round((t.pnl.net as number) * 100)), SPEC.map(netC))
})

// ── NÃO-REGRESSÃO: traced ≡ normal ───────────────────────────────────────────

test("NÃO-REGRESSÃO: calculateMetrics ≡ calculateMetricsTraced().result (JSON canônico idêntico, incl. tradeSetHash) em vários cenários", () => {
  const scenarios: Array<Parameters<typeof calculateMetrics>[1]> = [
    {},
    { pnlBasis: "GROSS" },
    { filters: { account: ["Sim101"] } },
    { filters: { hour: [9, 10] }, tradeIdsLimit: 5 },
    { timeZone: "America/New_York", timeAnchor: "EXIT", rBasis: "POINTS" },
    { filters: { account: "Sim999" } }, // população vazia
  ]
  for (const args of scenarios) {
    const normal = calculateMetrics(A, args)
    const traced = calculateMetricsTraced(A, args)
    assert.equal(canonicalJson(traced.result), canonicalJson(normal), canonicalJson(args))
    assert.equal(traced.result.population.tradeSetHash, normal.population.tradeSetHash)
  }
})

test("NÃO-REGRESSÃO: aggregateTrades ≡ aggregateTradesTraced().result (grupos, hashes e avisos idênticos)", () => {
  for (const args of [{ groupBy: "hour" }, { groupBy: "account" }, { groupBy: ["account", "hour"] }, { groupBy: "symbol", pnlBasis: "GROSS" }, { groupBy: "dayOfWeek", tradeIdsLimit: 3 }, { groupBy: "account", metrics: ["netPnl", "winRate"] }] as const) {
    const normal = aggregateTrades(A, args as never)
    const traced = aggregateTradesTraced(A, args as never)
    assert.equal(canonicalJson(traced.result), canonicalJson(normal), canonicalJson(args))
    assert.deepEqual(traced.result.groups.map((g) => g.tradeSetHash), normal.groups.map((g) => g.tradeSetHash))
    assert.equal(traced.result.total.population.tradeSetHash, normal.total.population.tradeSetHash)
    assert.equal(traced.trace.groups.length, normal.groups.length)
  }
})

test("NÃO-REGRESSÃO (código): explain-metric.ts não importa motor/filtro/preparo/sequência e não faz conta com P&L — só copia", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/lib/evidence/explain-metric.ts", import.meta.url)), "utf8").replace(/\/\/.*$/gm, "")
  assert.ok(!/from "\.\.\/metrics\/(calculate|filter|prepare|sequence|exact|catalog)/.test(src))
  assert.ok(!/\.pnl\.(net|gross)|pnlC|netC|fromCents|toCents|\bsum\(|Math\.(round|max|min)/.test(src))
  assert.ok(!/Date\.now|new Date|Math\.random|randomUUID/.test(src))
})

// ── cobertura do catálogo ────────────────────────────────────────────────────

test("TRACE: toda métrica do catálogo está no trace; sem conjunto natural = exatamente totalTrades, medianR, currentDrawdown, recoveryFactor", () => {
  const { trace } = total()
  assert.deepEqual(Object.keys(trace.metrics).sort(), [...METRIC_IDS].sort())
  assert.deepEqual(Object.entries(trace.metrics).filter(([, m]) => !m.applicable).map(([k]) => k).sort(), ["currentDrawdown", "medianR", "recoveryFactor", "totalTrades"])
  assert.deepEqual([trace.limit, trace.populationSize], [500, 14])
})

test("TODAS as métricas explicadas: ok=true, schema estrito, tradeSetHash da Evidence = do MetricsResult, bundle selado válido", () => {
  const { result, source } = total()
  for (const id of METRIC_IDS) {
    const e = ok(explain(id, source))
    const m = e.metricEvidence
    assert.equal(MetricEvidenceSchema.safeParse(m).success, true, id)
    assert.equal(m.population.tradeSetHash, result.population.tradeSetHash, id) // conferido, não recalculado
    assert.deepEqual([m.value, m.unit, m.basis, m.sampleSize, m.reason, m.definitionVersion, m.engineVersion], [result.metrics[id].value, result.metrics[id].unit, result.metrics[id].basis, result.metrics[id].sampleSize, result.metrics[id].reason, result.metrics[id].definitionVersion, result.engineVersion], id)
    assert.deepEqual(m.coverage, result.metrics[id].coverage)
    assert.deepEqual(m.period, result.period)
    assert.deepEqual(m.population.tradeIds, result.population.tradeIds)
    assert.equal(m.verifiability, "FULL")
    assert.equal(EvidenceBundleSchema.safeParse(metricEvidenceBundle(e)).success, true, id)
  }
})

// ── contribuintes: exatamente o que o trace registrou ────────────────────────

test("CLASSIFICAÇÃO: winners/losers/breakeven = conjuntos WINNER/LOSER/BREAKEVEN da tabela (base NET: o empate bruto é perdedor líquido)", () => {
  const { source } = total()
  const win = spec((s) => netC(s) > 0)
  const loss = spec((s) => netC(s) < 0)
  assert.deepEqual(sorted(idsOf(ok(explain("winners", source)), "WINNER")), sorted(win))
  assert.deepEqual(sorted(idsOf(ok(explain("losers", source)), "LOSER")), sorted(loss))
  const be = ok(explain("breakeven", source))
  assert.deepEqual(be.metricEvidence.contributors.items, [])
  assert.equal(be.metricEvidence.contributors.applicable, true)
  const rate = ok(explain("winRate", source))
  assert.deepEqual([idsOf(rate, "WINNER").length, idsOf(rate, "LOSER").length, idsOf(rate, "BREAKEVEN").length, idsOf(rate, "EXCLUDED_NO_PNL").length], [win.length, loss.length, 0, 0])
  assert.equal(rate.metricEvidence.contributors.roleCounts.WINNER, win.length)
  assert.equal(ok(explain("winners", source)).metricEvidence.value, win.length)
})

test("CLASSIFICAÇÃO (base GROSS): o trade de 0 pontos vira BREAKEVEN", () => {
  const { source } = total(A, { pnlBasis: "GROSS" })
  assert.deepEqual(idsOf(ok(explain("breakeven", source)), "BREAKEVEN"), spec((s) => grossC(s) === 0))
  assert.deepEqual(sorted(idsOf(ok(explain("winners", source)), "WINNER")), sorted(spec((s) => grossC(s) > 0)))
})

test("SOMAS: netPnl/grossPnl/commission/fees = INCLUDED nos trades com o componente conhecido; EXCLUDED_UNKNOWN nos demais (trace do motor)", () => {
  const { source } = total()
  const n = ok(explain("netPnl", source))
  assert.deepEqual(sorted(idsOf(n, "INCLUDED")), sorted(TID))
  assert.equal(idsOf(n, "EXCLUDED_UNKNOWN").length, 0)
  // trade sem líquido/comissão ⇒ excluído desses totais (e sem P&L na base NET ⇒ fora da classificação)
  const mut = clone(T)
  mut[2].pnl.net = null
  mut[2].pnl.netStatus = "UNAVAILABLE"
  mut[2].pnl.commission = null
  const Am = toAnalyticsTrades(mut)
  const t2 = total(Am)
  assert.deepEqual(idsOf(ok(explain("netPnl", t2.source, Am)), "EXCLUDED_UNKNOWN"), [TID[2]])
  assert.deepEqual(idsOf(ok(explain("commission", t2.source, Am)), "EXCLUDED_UNKNOWN"), [TID[2]])
  assert.deepEqual(idsOf(ok(explain("classifiedTrades", t2.source, Am)), "EXCLUDED_NO_PNL"), [TID[2]])
  assert.equal(idsOf(ok(explain("winners", t2.source, Am)), "WINNER").includes(TID[2]), false)
  assert.deepEqual(idsOf(ok(explain("grossPnl", t2.source, Am)), "EXCLUDED_UNKNOWN"), [])
})

test("VENCEDORES/PERDEDORES: winnersTotal/averageWinner → WINNER; losersTotal/averageLoser → LOSER; payoff/PF → WINNER+LOSER; averageTrade → INCLUDED", () => {
  const { source } = total()
  const win = sorted(spec((s) => netC(s) > 0))
  const loss = sorted(spec((s) => netC(s) < 0))
  for (const m of ["winnersTotal", "averageWinner"]) assert.deepEqual(sorted(idsOf(ok(explain(m, source)), "WINNER")), win, m)
  for (const m of ["losersTotal", "averageLoser"]) assert.deepEqual(sorted(idsOf(ok(explain(m, source)), "LOSER")), loss, m)
  for (const m of ["payoffRatio", "profitFactor"]) {
    const e = ok(explain(m, source))
    assert.deepEqual([sorted(idsOf(e, "WINNER")), sorted(idsOf(e, "LOSER"))], [win, loss], m)
  }
  assert.deepEqual(sorted(idsOf(ok(explain("averageTrade", source)), "INCLUDED")), sorted(TID))
  assert.equal(idsOf(ok(explain("winnersTotal", source)), "LOSER").length, 0) // sem papéis a mais
})

test("EXTREMOS: largestWinner/largestLoser → LARGEST_*; top3 → TOP_WINNER com rank 1..3 (+ WINNER como denominador)", () => {
  const { source } = total()
  const bestIdx = SPEC.findIndex((s) => s.pts === 7)
  const worstIdx = SPEC.findIndex((s) => s.pts === -4)
  assert.deepEqual(ok(explain("largestWinner", source)).metricEvidence.contributors.items, [{ tradeId: TID[bestIdx], role: "LARGEST_WINNER", rank: 1 }])
  assert.deepEqual(ok(explain("largestLoser", source)).metricEvidence.contributors.items, [{ tradeId: TID[worstIdx], role: "LARGEST_LOSER", rank: 1 }])
  const top = ok(explain("top3WinnersSharePct", source))
  const byPts = (p: number) => TID[SPEC.findIndex((s) => s.pts === p)]
  assert.deepEqual(top.metricEvidence.contributors.items.filter((c) => c.role === "TOP_WINNER"), [
    { tradeId: byPts(7), role: "TOP_WINNER", rank: 1 },
    { tradeId: byPts(6), role: "TOP_WINNER", rank: 2 },
    { tradeId: byPts(5), role: "TOP_WINNER", rank: 3 },
  ])
  assert.equal(idsOf(top, "WINNER").length, SPEC.filter((s) => netC(s) > 0).length)
  const share = ok(explain("largestWinnerSharePct", source))
  assert.deepEqual(share.metricEvidence.contributors.items.filter((c) => c.role === "LARGEST_WINNER").map((c) => c.tradeId), [byPts(7)])
})

// oráculo de sequência escrito à mão a partir da tabela (mesma definição do data-contract)
const eqs = (() => {
  let e = 0
  return SPEC.map((s) => (e += netC(s)))
})()

test("DRAWDOWN: PEAK / WINDOW (exclusiva) / TROUGH / RECOVERY pelos índices do cálculo, com rank = posição na sequência", () => {
  // oráculo: mesmo critério do data-contract (pico inicial 0; maior queda; 1ª ocorrência; recuperação = 1º eq ≥ pico depois do fundo)
  let peak = 0, peakIdx = -1, maxDD = 0, ddPeak = -1, ddTrough = -1, ddPeakVal = 0
  eqs.forEach((e, i) => {
    if (e > peak) { peak = e; peakIdx = i }
    if (peak - e > maxDD) { maxDD = peak - e; ddPeak = peakIdx; ddTrough = i; ddPeakVal = peak }
  })
  const rec = eqs.findIndex((e, j) => j > ddTrough && e >= ddPeakVal)
  assert.ok(maxDD > 0 && ddTrough > ddPeak + 1)
  const e = ok(explain("maxDrawdown", total().source))
  const items = e.metricEvidence.contributors.items
  assert.deepEqual(items.filter((c) => c.role === "DRAWDOWN_PEAK"), ddPeak >= 0 ? [{ tradeId: TID[ddPeak], role: "DRAWDOWN_PEAK", rank: ddPeak + 1 }] : [])
  assert.deepEqual(items.filter((c) => c.role === "DRAWDOWN_WINDOW").map((c) => [c.tradeId, c.rank]), TID.map((id, i) => [id, i + 1] as [string, number]).filter(([, r]) => r - 1 > ddPeak && r - 1 < ddTrough))
  assert.deepEqual(items.filter((c) => c.role === "DRAWDOWN_TROUGH"), [{ tradeId: TID[ddTrough], role: "DRAWDOWN_TROUGH", rank: ddTrough + 1 }])
  assert.deepEqual(items.filter((c) => c.role === "DRAWDOWN_RECOVERY"), rec >= 0 ? [{ tradeId: TID[rec], role: "DRAWDOWN_RECOVERY", rank: rec + 1 }] : [])
  assert.equal(e.metricEvidence.value, maxDD / 100)
  // o motor já guardava peak/trough em details: o trace concorda com eles
  const r = total().result
  assert.equal(r.metrics.maxDrawdown.details?.troughTradeId, TID[ddTrough])
  assert.equal(r.metrics.maxDrawdown.details?.peakTradeId ?? null, ddPeak >= 0 ? TID[ddPeak] : null)
})

test("SEQUÊNCIAS: STREAK_RUN = a maior série de vitórias/derrotas (1ª ocorrência) e a série atual, com rank = posição", () => {
  const sign = SPEC.map((s) => Math.sign(netC(s)))
  const longest = (target: number) => {
    let best = 0, bestStart = -1, run = 0, start = -1
    sign.forEach((v, i) => {
      if (v === target) { if (run === 0) start = i; run += 1; if (run > best) { best = run; bestStart = start } } else run = 0
    })
    return { best, bestStart }
  }
  const { source } = total()
  for (const [metric, target] of [["maxConsecutiveWins", 1], ["maxConsecutiveLosses", -1]] as const) {
    const { best, bestStart } = longest(target)
    const items = ok(explain(metric, source)).metricEvidence.contributors.items
    assert.deepEqual(items, TID.slice(bestStart, bestStart + best).map((id, k) => ({ tradeId: id, role: "STREAK_RUN", rank: bestStart + k + 1 })), metric)
  }
  const cur = ok(explain("currentStreak", source)).metricEvidence.contributors.items
  const last = sign[sign.length - 1]
  let len = 0
  for (let i = sign.length - 1; i >= 0 && sign[i] === last; i--) len += 1
  assert.deepEqual(cur.map((c) => c.tradeId), TID.slice(TID.length - len))
})

test("R: R_POSITIVE / R_NEGATIVE / R_ZERO / EXCLUDED_R_UNKNOWN pelo trace; averageWinnerR só positivos; medianR sem contribuintes (não se inventa papel)", () => {
  const mut = clone(T)
  const rs: Array<number | null> = [1.5, 0.5, -1, -1, 0, null, null, null, null, null, null, null, null, null]
  rs.forEach((r, i) => {
    mut[i].r.net = r
    mut[i].r.netReason = r === null ? "RISK_UNKNOWN" : null
  })
  const Ar = toAnalyticsTrades(mut)
  const { source } = total(Ar)
  const tr = ok(explain("totalR", source, Ar))
  assert.deepEqual(idsOf(tr, "R_POSITIVE"), [TID[0], TID[1]].sort())
  assert.deepEqual(sorted(idsOf(tr, "R_NEGATIVE")), sorted([TID[2], TID[3]]))
  assert.deepEqual(idsOf(tr, "R_ZERO"), [TID[4]])
  assert.deepEqual(sorted(idsOf(tr, "EXCLUDED_R_UNKNOWN")), sorted(TID.slice(5)))
  assert.deepEqual(sorted(idsOf(ok(explain("averageWinnerR", source, Ar)), "R_POSITIVE")), sorted([TID[0], TID[1]]))
  assert.deepEqual(Object.keys(ok(explain("averageWinnerR", source, Ar)).metricEvidence.contributors.roleCounts), ["R_POSITIVE"])
  const med = ok(explain("medianR", source, Ar)).metricEvidence
  assert.deepEqual([med.contributors.applicable, med.contributors.items.length, med.value === null], [false, 0, false])
  // sem R conhecido (população original): tudo EXCLUDED_R_UNKNOWN
  assert.equal(idsOf(ok(explain("totalR", total().source)), "EXCLUDED_R_UNKNOWN").length, 14)
})

test("PONTOS: INCLUDED com um único instrumento; EXCLUDED_UNKNOWN (todos) com instrumentos misturados", () => {
  assert.equal(idsOf(ok(explain("totalPoints", total().source)), "INCLUDED").length, 14)
  const mut = clone(T)
  mut[0].instrument.root = "MNQ"
  const Am = toAnalyticsTrades(mut)
  const e = ok(explain("totalPoints", total(Am).source, Am))
  assert.equal(e.metricEvidence.reason, "MIXED_INSTRUMENTS")
  assert.equal(idsOf(e, "EXCLUDED_UNKNOWN").length, 14)
  assert.equal(idsOf(e, "INCLUDED").length, 0)
})

test("SEM NATURAL: totalTrades, currentDrawdown, recoveryFactor → applicable=false, sem itens (a população já está em population.tradeIds)", () => {
  for (const id of ["totalTrades", "currentDrawdown", "recoveryFactor"]) {
    const m = ok(explain(id, total().source)).metricEvidence
    assert.deepEqual([m.contributors.applicable, m.contributors.complete, m.contributors.items, m.contributors.roleCounts], [false, true, [], {}], id)
  }
  assert.equal(ok(explain("totalTrades", total().source)).metricEvidence.population.tradeIds?.length, 14)
})

test("VOCABULÁRIO FECHADO: nenhum papel fora da lista aprovada em nenhuma métrica", () => {
  const allowed = new Set<string>(["WINNER", "LOSER", "BREAKEVEN", "EXCLUDED_NO_PNL", "INCLUDED", "EXCLUDED_UNKNOWN", "LARGEST_WINNER", "LARGEST_LOSER", "TOP_WINNER", "R_POSITIVE", "R_NEGATIVE", "R_ZERO", "EXCLUDED_R_UNKNOWN", "DRAWDOWN_PEAK", "DRAWDOWN_WINDOW", "DRAWDOWN_TROUGH", "DRAWDOWN_RECOVERY", "STREAK_RUN"])
  const { source } = total()
  for (const id of METRIC_IDS) for (const c of ok(explain(id, source)).metricEvidence.contributors.items) assert.ok(allowed.has(c.role), `${id}: ${c.role}`)
  assert.equal(allowed.size, 18)
})

// ── rastreabilidade: cadeia completa ─────────────────────────────────────────

test("CADEIA: MetricEvidence → tradeIds/contribuintes → TradeEvidence → SourceRowRef(importId,rowNo,rowHash) → ImportRef; todo id resolve", () => {
  const e = ok(explain("netPnl", total().source))
  const have = new Set(e.tradeEvidences.map((t) => t.tradeId))
  assert.deepEqual(sorted([...have]), sorted(TID))
  for (const id of [...(e.metricEvidence.population.tradeIds as string[]), ...e.metricEvidence.contributors.items.map((c) => c.tradeId)]) assert.ok(have.has(id), id)
  const imports = new Map(e.importRefs.map((i) => [i.importId, i]))
  for (const t of e.tradeEvidences) {
    assert.ok(imports.has(t.importId))
    assert.ok(t.sourceRows.every((r) => r.importId === t.importId && r.rowHash?.length === 64 && Number.isInteger(r.rowNo)))
    assert.equal(t.provenance, "COMPLETE")
  }
  assert.equal(e.importRefs.length, 1)
  assert.equal(e.importRefs[0].fileSha256, rec.fileSha256)
  assert.equal(e.metricEvidence.population.provenance.withoutIdentity, 0)
})

// ── filtros, grupos e privacidade de contas ──────────────────────────────────

const REF1 = accountRef("Sim101") as string
const REF2 = accountRef("Sim102") as string

test("FILTRO account: query.filters.account vira accountRefs (nunca o nome); população filtrada e TradeEvidence só dela", () => {
  const { result, source } = total(A, { filters: { account: ["Sim102", "Sim101 "] } })
  const e = ok(explain("netPnl", source))
  assert.deepEqual(e.metricEvidence.query.filters, { accountRefs: sorted([REF1, REF2]) })
  assert.equal("account" in e.metricEvidence.query.filters, false)
  const only1 = total(A, { filters: { account: "Sim101" } })
  const e1 = ok(explain("netPnl", only1.source))
  assert.deepEqual(e1.metricEvidence.query.filters, { accountRefs: [REF1] })
  assert.equal(e1.metricEvidence.population.afterFilters, 10)
  assert.equal(e1.tradeEvidences.length, 10)
  assert.ok(e1.tradeEvidences.every((t) => t.accountRef === REF1))
  assert.equal(e1.metricEvidence.population.tradeSetHash, only1.result.population.tradeSetHash)
  assert.notEqual(e1.metricEvidence.population.tradeSetHash, result.population.tradeSetHash)
  assert.equal(findAccountNameLeak(e1, ["Sim101", "Sim102"]), null)
})

test("FILTRO account sem correspondência: população vazia explicada (ref determinístico, sem o nome pedido)", () => {
  const { source } = total(A, { filters: { account: "Sim999", hour: 9 } })
  const e = ok(explain("netPnl", source))
  assert.deepEqual(e.metricEvidence.query.filters, { hour: 9, accountRefs: [accountRef("Sim999")] })
  assert.deepEqual([e.metricEvidence.population.afterFilters, e.metricEvidence.population.tradeIds, e.tradeEvidences.length, e.metricEvidence.value], [0, [], 0, null])
  assert.ok(!JSON.stringify(e).includes("Sim999"))
})

function aggregate(groupBy: Parameters<typeof aggregateTradesTraced>[1]["groupBy"], extra: object = {}) {
  const { result, trace } = aggregateTradesTraced(A, { groupBy, ...extra } as never)
  return { result, trace, src: (index: number | null): MetricSource => ({ kind: "AGGREGATE", result, trace, scope: index === null ? { kind: "TOTAL" } : { kind: "GROUP", index } }) }
}

test("GRUPOS por account: groupBy/groupKey com accountRef; população do grupo = ids da conta; tradeSetHash do grupo conferido; sampleFlag", () => {
  const g = aggregate("account")
  assert.equal(g.result.groups.length, 2)
  g.result.groups.forEach((grp, i) => {
    const e = ok(explain("netPnl", g.src(i)))
    const m = e.metricEvidence
    assert.deepEqual([m.scope, m.query.groupBy, m.sampleFlag], ["GROUP", ["account"], grp.sampleFlag])
    assert.deepEqual(m.query.groupKey, [grp.key[0] === "Sim101" ? REF1 : REF2])
    assert.equal(m.population.tradeSetHash, grp.tradeSetHash)
    assert.equal(m.population.afterFilters, grp.sampleSize)
    assert.deepEqual(sorted(m.population.tradeIds as string[]), sorted(spec((s) => s.acc === grp.key[0])))
    assert.deepEqual([m.period, m.dataQuality, m.warnings], [null, null, []]) // o motor não calcula isso por grupo: não se inventa
    assert.ok(e.tradeEvidences.every((t) => t.accountRef === (grp.key[0] === "Sim101" ? REF1 : REF2)))
    assert.equal(m.value, grp.metrics.netPnl.value)
    assert.equal(findAccountNameLeak(e, ["Sim101", "Sim102"]), null)
  })
})

test("GRUPOS por hour e account×hour: todas as métricas × todos os grupos explicados; soma das amostras = população; chave com ref só na dimensão account", () => {
  for (const by of ["hour", ["account", "hour"], "symbol", "dayOfWeek"] as const) {
    const g = aggregate(by as never)
    assert.equal(g.result.groups.reduce((a, x) => a + x.sampleSize, 0), 14)
    g.result.groups.forEach((grp, i) => {
      for (const id of METRIC_IDS) {
        const e = ok(explain(id, g.src(i)))
        assert.equal(e.metricEvidence.population.tradeSetHash, grp.tradeSetHash)
        assert.equal(e.metricEvidence.value, grp.metrics[id].value)
      }
    })
  }
  const g = aggregate(["account", "hour"])
  const e = ok(explain("netPnl", g.src(0)))
  assert.deepEqual(e.metricEvidence.query.groupBy, ["account", "hour"])
  assert.match(e.metricEvidence.query.groupKey?.[0] as string, /^acc_/)
  assert.match(e.metricEvidence.query.groupKey?.[1] as string, /^\d\d$/)
})

test("AGGREGATE TOTAL: o total do agregado é explicado como população inteira (groupBy null)", () => {
  const g = aggregate("hour")
  const e = ok(explain("netPnl", g.src(null)))
  assert.deepEqual([e.metricEvidence.scope, e.metricEvidence.query.groupBy, e.metricEvidence.query.groupKey], ["TOTAL", null, null])
  assert.equal(e.metricEvidence.population.tradeSetHash, g.result.total.population.tradeSetHash)
})

test("PRIVACIDADE: nenhum nome de conta em NENHUM valor/chave de MetricEvidence, TradeEvidence ou ImportRef (todas as métricas, total e grupos); fileName redigido com a lista completa", () => {
  const g = aggregate(["account", "hour"], { filters: { account: ["Sim101", "Sim102"] } })
  const all: ExplainMetricOk[] = []
  for (const id of METRIC_IDS) {
    all.push(ok(explain(id, g.src(null))))
    g.result.groups.forEach((_, i) => all.push(ok(explain(id, g.src(i)))))
  }
  assert.ok(all.length > 100)
  for (const e of all) {
    assert.equal(findAccountNameLeak([e.metricEvidence, e.tradeEvidences, e.importRefs], ["Sim101", "Sim102"]), null)
    assert.equal(e.importRefs[0].fileName, `${REF1}_${REF2}-marco.csv`)
  }
})

test("PRIVACIDADE (fail-closed): nome de conta que escape em warnings/filtros/estratégia ⇒ E_ACCOUNT_NAME_LEAK", () => {
  const t = total()
  const bad1 = clone(t.result)
  bad1.warnings.push({ code: "X", severity: "INFO", message: "conta Sim101 com problema" })
  err(explain("netPnl", { kind: "METRICS", result: bad1, trace: t.trace }), "E_ACCOUNT_NAME_LEAK")
  const bad2 = clone(t.result)
  bad2.query.filters.strategyName = "Sim102-estrategia"
  err(explain("netPnl", { kind: "METRICS", result: bad2, trace: t.trace }), "E_ACCOUNT_NAME_LEAK")
})

// ── limite: HASH_ONLY ────────────────────────────────────────────────────────

test("ACIMA DO LIMITE (tradeIdsLimit=5): tradeIds=null, HASH_ONLY, roleCounts completos, só âncoras, tradeSetHash da população COMPLETA", () => {
  const { result, source } = total(A, { tradeIdsLimit: 5 })
  const full = total()
  assert.equal(result.population.tradeSetHash, full.result.population.tradeSetHash) // o limite não muda o hash
  for (const id of ["winners", "winnersTotal", "largestWinner", "top3WinnersSharePct", "maxDrawdown", "maxConsecutiveLosses", "netPnl"]) {
    const m = ok(explain(id, source)).metricEvidence
    assert.deepEqual([m.verifiability, m.population.tradeIds, m.population.tradeSetHash], ["HASH_ONLY", null, result.population.tradeSetHash], id)
    assert.equal(m.contributors.complete, false, id)
    assert.ok(m.contributors.items.every((c) => ANCHOR_ROLES.has(c.role)), id)
    assert.deepEqual(m.contributors.roleCounts, full.trace.metrics[id].roleCounts, id) // contagens completas, iguais às da população inteira
  }
  const w = ok(explain("winners", source))
  assert.deepEqual([w.metricEvidence.contributors.items, w.tradeEvidences], [[], []]) // não finge que uma lista parcial é a população
  assert.equal(w.metricEvidence.contributors.roleCounts.WINNER, 8)
  const lg = ok(explain("largestWinner", source))
  assert.deepEqual(lg.tradeEvidences.map((t) => t.tradeId), [TID[SPEC.findIndex((s) => s.pts === 7)]]) // só a âncora
  const dd = ok(explain("maxDrawdown", source)).metricEvidence.contributors
  assert.ok(dd.items.length > 0 && dd.items.every((c) => ["DRAWDOWN_PEAK", "DRAWDOWN_TROUGH", "DRAWDOWN_RECOVERY"].includes(c.role))) // janela e sequências não são âncoras
  assert.ok((dd.roleCounts.DRAWDOWN_WINDOW ?? 0) > 0) // mas a contagem da janela continua completa
  assert.deepEqual(ok(explain("maxConsecutiveLosses", source)).metricEvidence.contributors.items, []) // série não é âncora acima do limite
  assert.ok((ok(explain("maxConsecutiveLosses", source)).metricEvidence.contributors.roleCounts.STREAK_RUN ?? 0) >= 3)
})

test("ACIMA DO LIMITE (padrão 500): população de 505 ciclos ⇒ HASH_ONLY sem mudar nada no padrão", () => {
  const rows: SynthRow[] = Array.from({ length: 505 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 5 + Math.floor(i / 20), 12 + Math.floor((i % 20) / 4), (i % 4) * 15))
    const f = (x: Date, mins: number) => {
      const y = new Date(x.getTime() + mins * 60000)
      const p = (n: number) => String(n).padStart(2, "0")
      return `${p(y.getUTCDate())}/${p(y.getUTCMonth() + 1)}/${y.getUTCFullYear()} ${p(y.getUTCHours())}:${p(y.getUTCMinutes())}:00`
    }
    return { entryPrice: 2000, exitPrice: 2000 + ((i % 7) - 3), entryAt: f(d, 0), exitAt: f(d, 10) }
  })
  const big = runImportPipeline(synthCsv(rows), { sourceTz: BRT })
  assert.equal(big.trades.length, 505)
  const Ab = toAnalyticsTrades(big.trades)
  const { result, trace } = calculateMetricsTraced(Ab)
  const m = ok(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result, trace }, trades: Ab, importRecords: [big.importRecord as ImportRecord] })).metricEvidence
  assert.deepEqual([m.verifiability, m.population.tradeIds, m.population.afterFilters, m.contributors.complete], ["HASH_ONLY", null, 505, false])
  assert.equal(m.contributors.roleCounts.INCLUDED, 505)
  assert.equal(m.population.tradeSetHash, result.population.tradeSetHash)
  const lw = ok(explainMetric({ metricId: "largestWinner", source: { kind: "METRICS", result, trace }, trades: Ab, importRecords: [big.importRecord as ImportRecord] }))
  assert.equal(lw.tradeEvidences.length, 1)
  assert.equal(canonicalJson(calculateMetrics(Ab)), canonicalJson(result))
})

// ── erros ────────────────────────────────────────────────────────────────────

test("E_POPULATION_IDENTITY_MISSING: trade sem tradeId/importId na população ⇒ RECUSA (o motor continua calculando normalmente)", () => {
  const mut = clone(T)
  delete mut[3].tradeId
  const Am = toAnalyticsTrades(mut)
  const t = total(Am)
  assert.equal(t.result.population.provenance.withoutIdentity, 1)
  assert.equal(t.result.metrics.netPnl.value, total().result.metrics.netPnl.value) // números intactos
  const r = explain("netPnl", t.source, Am)
  err(r, "E_POPULATION_IDENTITY_MISSING")
  assert.ok(!("metricEvidence" in r))
  const mut2 = clone(T)
  delete mut2[0].importId
  const Am2 = toAnalyticsTrades(mut2)
  err(explain("netPnl", total(Am2).source, Am2), "E_POPULATION_IDENTITY_MISSING")
})

test("ERROS: E_TRADE_UNRESOLVED, E_IMPORT_UNRESOLVED, E_METRIC_UNKNOWN, E_SCOPE_INVALID, E_RESULT_TRACE_MISMATCH", () => {
  const t = total()
  err(explain("netPnl", t.source, A.slice(1)), "E_TRADE_UNRESOLVED")
  err(explain("netPnl", t.source, A, []), "E_IMPORT_UNRESOLVED")
  err(explain("naoExiste", t.source), "E_METRIC_UNKNOWN")
  const g = aggregate("hour")
  err(explain("netPnl", g.src(99)), "E_SCOPE_INVALID")
  const other = total(A, { filters: { account: "Sim101" } })
  err(explain("netPnl", { kind: "METRICS", result: t.result, trace: other.trace }), "E_RESULT_TRACE_MISMATCH") // trace de outra chamada
  const g2 = aggregate("account")
  err(explain("netPnl", { kind: "AGGREGATE", result: g.result, trace: g2.trace, scope: { kind: "GROUP", index: 0 } }), "E_RESULT_TRACE_MISMATCH")
  const aggSub = aggregateTradesTraced(A, { groupBy: "hour", metrics: ["netPnl"] })
  err(explain("winRate", { kind: "AGGREGATE", result: aggSub.result, trace: aggSub.trace, scope: { kind: "GROUP", index: 0 } }), "E_METRIC_UNKNOWN") // métrica não pedida no agregado
  // id do motor ≠ tradeId (ids de outro sistema ainda não são suportados): recusa, não adivinha
  const renamed = A.map((x, i) => (i === 0 ? { ...x, id: "outro-id" } : x))
  err(explain("netPnl", total(renamed).source, renamed), "E_TRADE_UNRESOLVED")
})

// ── E5.0: E_DUPLICATE_TRADE_ID ───────────────────────────────────────────────

test("E_DUPLICATE_TRADE_ID: o MESMO arquivo importado 2× ⇒ recusa explícita com a causa real (não E_TRADE_UNRESOLVED), sem dedupe silencioso e sem tratar '#2' como identidade", () => {
  const again = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: "reimportado.csv" })
  assert.equal(again.importRecord?.importId, rec.importId) // mesmo conteúdo + mesmas configurações ⇒ mesmo importId ⇒ mesmos tradeId
  const dup = toAnalyticsTrades([...T, ...again.trades])
  assert.equal(dup.length, 28)
  assert.ok(dup.some((a) => a.id.endsWith("#2")), "o motor desambigua com sufixo (comportamento do motor, inalterado)")
  const engine = total(dup)
  assert.equal(engine.result.metrics.totalTrades.value, 28) // o motor continua calculando e contando cada ocorrência
  const r = explain("netPnl", engine.source, dup)
  err(r, "E_DUPLICATE_TRADE_ID")
  const m = (r as { message: string }).message
  assert.match(m, /mais de uma vez/)
  assert.match(m, /mesmo arquivo importado duas vezes/)
  assert.match(m, new RegExp(`importId ${rec.importId}`))
  assert.match(m, /14 tradeId\(s\)/)
  assert.ok(/(trd_[0-9a-f]{32}) ×2/.test(m))
  assert.ok(!m.includes("Sim10")) // sem nome de conta
  assert.equal((r as { message: string }).message, (explain("netPnl", engine.source, dup) as { message: string }).message) // determinístico
  // o id do motor com '#2' NÃO vira identidade: nada de Evidence parcial
  assert.equal(explain("netPnl", engine.source, dup).ok, false)
})

test("E_DUPLICATE_TRADE_ID: vale para QUALQUER repetição no conjunto (um trade 2×, população filtrada que exclui a cópia, limite baixo/HASH_ONLY); conjunto sem repetição segue ok", () => {
  const one = toAnalyticsTrades([...T, T[0]])
  err(explain("netPnl", total(one).source, one), "E_DUPLICATE_TRADE_ID")
  assert.match((explain("netPnl", total(one).source, one) as { message: string }).message, new RegExp(`${TID[0]} ×2`))
  // o filtro deixa a cópia FORA da população, mas o conjunto de entrada continua ambíguo ⇒ recusa
  const filtered = total(toAnalyticsTrades([...T, T[0]]), { filters: { account: "Sim102" } })
  err(explain("netPnl", filtered.source, one), "E_DUPLICATE_TRADE_ID")
  const low = total(one, { tradeIdsLimit: 3 })
  err(explain("netPnl", low.source, one), "E_DUPLICATE_TRADE_ID")
  // vários repetidos: a mensagem é determinística e cita o menor id
  const two = toAnalyticsTrades([...T, T[5], T[1]])
  const msg = (explain("netPnl", total(two).source, two) as { message: string }).message
  assert.match(msg, /2 tradeId\(s\)/)
  assert.match(msg, new RegExp(`${[TID[1], TID[5]].sort()[0]} ×2`))
  // sem repetição: continua ok (inclusive com trades de dois imports diferentes)
  ok(explain("netPnl", total().source))
  const other = runImportPipeline(synthCsv(rowsOf(SPEC.slice(0, 5))), { sourceTz: "America/New_York", fileName: "outro.csv" }) // outro import (outra config) ⇒ outros tradeId
  assert.notEqual(other.importRecord?.importId, rec.importId)
  const mixed = toAnalyticsTrades([...T, ...other.trades])
  ok(explain("netPnl", total(mixed).source, mixed, [rec, other.importRecord as ImportRecord]))
  // sem tradeId (fallback posicional) o erro correto continua sendo o de identidade ausente
  const Am = toAnalyticsTrades(T.map((t) => { const { tradeId: _t, importId: _i, ...rest } = t; void _t; void _i; return rest as CanonicalTrade }))
  err(explain("netPnl", total(Am).source, Am), "E_POPULATION_IDENTITY_MISSING")
})

// ── E5.0: a Evidence tem tudo para refazer fingerprint, tradeSetHash e métricas (inclusive R e pontos) ─────────────

/** Sem verifyEvidence (E5.1+): só PROVA que, partindo dos TradeEvidence, o MESMO motor chega ao mesmo resultado (R e pontos incluídos). */
function roundTrip(trades: CanonicalTrade[], record: ImportRecord, label: string): { rKnown: number } {
  const enriched = withRisk(trades)
  const An = toAnalyticsTrades(enriched)
  const evs = explainTrades(enriched, record).map((r) => ok2(r)).map((r) => r.tradeEvidence)
  const probes = evs.map(probeFromEvidence)
  assert.equal(tradeSetHash(evs.map(tradeFingerprintFromEvidence)), calculateMetrics(An).population.tradeSetHash, `${label}: tradeSetHash refeito da Evidence`)
  let rKnown = 0
  const optSets: Array<Parameters<typeof calculateMetricsTraced>[1]> = [{}, { rBasis: "POINTS" }, { pnlBasis: "GROSS" }, { timeZone: "America/New_York", timeAnchor: "EXIT" }, { tradeIdsLimit: 3 }, { minSample: 2 }]
  for (const opts of optSets) {
    const a = calculateMetricsTraced(An, opts)
    const b = calculateMetricsTraced(probes, opts)
    assert.equal(canonicalJson(b.result), canonicalJson(a.result), `${label} ${JSON.stringify(opts)}: resultado completo (métricas, população, qualidade, avisos)`)
    assert.equal(canonicalJson(b.trace), canonicalJson(a.trace), `${label} ${JSON.stringify(opts)}: trace`)
    if (opts && opts.rBasis === "POINTS") assert.ok(a.result.metrics.totalR.sampleSize === 0 || a.result.metrics.totalR.basis !== null)
    rKnown = Math.max(rKnown, a.result.metrics.totalR.sampleSize)
  }
  for (const by of ["hour", "direction", "dayOfWeek"] as const) {
    assert.equal(canonicalJson(aggregateTrades(probes, { groupBy: by })), canonicalJson(aggregateTrades(An, { groupBy: by })), `${label} groupBy ${by}`)
  }
  return { rKnown }
}
const ok2 = (r: { ok: boolean }): { tradeEvidence: import("../src/lib/evidence/schema.ts").TradeEvidence } => {
  assert.equal(r.ok, true)
  return r as never
}

test("E5.0 RECONSTRUÇÃO: só com os TradeEvidence o MESMO motor reproduz o resultado inteiro (R líquido e em pontos, pontos, P&L bruto/líquido, fusos, limite, grupos) e o tradeSetHash", () => {
  const { rKnown } = roundTrip(T, rec, "sintético ciclos")
  assert.ok(rKnown >= 5, "o teste exercita R de verdade (não só nulos)")
  const g = calculateMetrics(toAnalyticsTrades(withRisk(T)), { rBasis: "POINTS" })
  assert.ok(g.metrics.totalR.value !== null && g.metrics.averageR.value !== null)
  assert.ok(calculateMetrics(toAnalyticsTrades(withRisk(T))).metrics.totalPoints.value !== null)
  const rows = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: FILE, reconstructCycles: false })
  roundTrip(rows.trades, rows.importRecord as ImportRecord, "sintético linhas")
})

// ── E5.0: estabilidade (golden calculado no commit ANTERIOR ao E5.0, 88cdad3) ────────────────────────────────────

test("ESTABILIDADE (E5.0): tradeSetHash, resultado do motor e agregado por conta idênticos aos do commit anterior (valores pinados; as métricas não mudaram)", () => {
  const r = calculateMetrics(A)
  assert.equal(rec.importId, "imp_b6208386baa51db36221fdd120140405")
  assert.equal(r.population.tradeSetHash, "7125463aaf3d57b775ab431a76ed5f7660ebd6c30c1a0bf1319cd08f4e178e7a")
  assert.equal(sha256Hex(canonicalJson(r)), "f1517292df68b2026455f428458acd2c9aaccd5ef19205e3aaae7ab63adde394")
  const g = aggregateTrades(A, { groupBy: "account" })
  assert.deepEqual(g.groups.map((x) => x.tradeSetHash), ["27c00f752dd603be2bbd3e71ef22b43021d1da98c51f89ca68a41dc886cdd69c", "d1e5bc1e646bbf3e10af930b0a60ed5a723342c2d9960e0aed9a3b30fdd3c7b3"])
  assert.equal(sha256Hex(canonicalJson(g)), "f84abf4949a25d6804a2e689350eeb0f5446c8e67103f74f3ff4df0d62edec54")
  // e traced ≡ normal continua valendo
  assert.equal(canonicalJson(calculateMetricsTraced(A).result), canonicalJson(r))
})

// ── rowHash no fingerprint dos trades SOURCE_ROW (ajuste pós-E5.0) ───────────────────────────────────────────────

test("ROWHASH NO FINGERPRINT (SOURCE_ROW): entra no tradeSetHash nos DOIS caminhos; trocar o rowHash muda o hash; ciclos e métricas ficam idênticos", () => {
  const rowsImp = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: FILE, reconstructCycles: false })
  const rowTrades = rowsImp.trades
  assert.ok(rowTrades.every((t) => t.granularity === "SOURCE_ROW" && typeof t.source.rowHash === "string" && t.source.rowHash.length === 64))
  const evs = explainTrades(rowTrades, rowsImp.importRecord as ImportRecord).map((r) => ok2(r).tradeEvidence)
  // canônico: o rowHash do trade-linha entra; evidência: o da única linha TRADE_VALUES — o MESMO
  rowTrades.forEach((t, i) => {
    const fp = tradeFingerprint(t.tradeId as string, t)
    assert.deepEqual(fp.rowHashes, [t.source.rowHash])
    assert.deepEqual(tradeFingerprintFromEvidence(evs[i]).rowHashes, [t.source.rowHash])
    assert.equal(canonicalJson(tradeFingerprintFromEvidence(evs[i])), canonicalJson(fp))
  })
  // trocar o rowHash (só ele) muda o fingerprint e o tradeSetHash — antes do ajuste isso passava despercebido
  const base = tradeSetHash(rowTrades.map((t) => tradeFingerprint(t.tradeId as string, t)))
  const changed = rowTrades.map((t, i) => (i === 3 ? ({ ...t, source: { ...t.source, rowHash: "0".repeat(64) } } as CanonicalTrade) : t))
  assert.notEqual(tradeSetHash(changed.map((t) => tradeFingerprint(t.tradeId as string, t))), base)
  // ciclo: fingerprint idêntico ao anterior (os rowHashes já vinham de sourceRows)
  T.forEach((t) => assert.deepEqual(tradeFingerprint(t.tradeId as string, t).rowHashes, (t.sourceRows ?? []).map((r) => r.rowHash).sort()))
  // pinado: a população de ciclos NÃO mudou; a de linhas mudou SÓ no hash (metricsSha/valuesSha/groupMetricsSha idênticos aos do commit anterior)
  assert.equal(calculateMetrics(A).population.tradeSetHash, "7125463aaf3d57b775ab431a76ed5f7660ebd6c30c1a0bf1319cd08f4e178e7a")
  const Ar = toAnalyticsTrades(rowTrades)
  const rr = calculateMetrics(Ar)
  const gr = aggregateTrades(Ar, { groupBy: "account" })
  assert.equal(rr.population.tradeSetHash, "f6e990c2dea8955b2474fa37e1e2b3ee03884145b5dc6258481a0a3c74ec43b0") // era aba84302… antes do ajuste
  assert.equal(sha256Hex(canonicalJson(rr.metrics)), "a1f4f77d1a8612db3cee4f7801bf3f9ed5ce9efd2f06e813c1f32f0243a6b765") // valores das métricas: IGUAIS
  assert.equal(sha256Hex(canonicalJson({ ...rr, population: { ...rr.population, tradeSetHash: null } })), "2e0da9bbdd6dae242a6b286e1b3b6e8bbb17e2749b071be86bd8000db6db134a") // resultado inteiro menos o hash: IGUAL
  assert.equal(sha256Hex(canonicalJson(gr.groups.map((x) => ({ key: x.key, metrics: x.metrics })))), "f69e0b71717bf29a2c0cb7bff854f43449a7d05cfa5b3cccc5df0579490d9292")
  assert.deepEqual(gr.groups.map((x) => x.tradeSetHash), ["0f5b2d826a1d1e9bb3512974d19fa4f30d1b98500e191643f6f81a3eec664ca5", "0c177784938c102a52877417ba3d9f51acc38f7e23c0df86dc479b3c053cc3a5"])
  assert.equal(canonicalJson(calculateMetricsTraced(Ar).result), canonicalJson(rr)) // traced ≡ normal
})

/**
 * Adulteração do rowHash (E5.0+): o atacante troca o rowHash na Evidence e RECALCULA o evidenceHash (selo válido); não mexe no `tradeSetHash`
 * declarado. A única coisa que acusa é refazer o tradeSetHash a partir dos TradeEvidence e comparar com o declarado — é o que o E5 fará (V3);
 * aqui se prova só o PRIMITIVO (fingerprint da Evidence), sem verifyEvidence.
 */
function tamperRowHashCase(granularity: "SOURCE_ROW" | "POSITION_CYCLE") {
  const cycles = granularity === "POSITION_CYCLE"
  const run = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: FILE, ...(cycles ? {} : { reconstructCycles: false }) })
  const An = toAnalyticsTrades(run.trades)
  const t = total(An)
  const e = ok(explain("netPnl", t.source, An, [run.importRecord as ImportRecord]))
  const bundle = metricEvidenceBundle(e)
  const declared = bundle.evidence.metrics[0].population.tradeSetHash
  const recompute = (b: typeof bundle) => tradeSetHash(b.evidence.trades.map(tradeFingerprintFromEvidence))
  assert.equal(recompute(bundle), declared, "bundle íntegro: o hash refeito da Evidence = o declarado")
  // adultera o rowHash de UM trade e recalcula o selo
  const forged = clone(bundle)
  forged.evidence.trades[2].sourceRows[0].rowHash = "f".repeat(64)
  forged.evidenceHash = computeEvidenceHash(forged)
  assert.notEqual(forged.evidenceHash, bundle.evidenceHash)
  assert.equal(computeEvidenceHash(forged), forged.evidenceHash, "o selo (evidenceHash) recalculado é VÁLIDO: o selo sozinho não acusa")
  assert.equal(forged.evidence.metrics[0].population.tradeSetHash, declared, "o tradeSetHash declarado ficou inalterado")
  return { mismatch: recompute(forged) !== declared }
}

test("ADULTERAÇÃO do rowHash (SOURCE_ROW): evidenceHash recalculado e tradeSetHash declarado inalterado ⇒ o hash refeito da Evidence DIVERGE (detecta o mismatch)", () => {
  assert.equal(tamperRowHashCase("SOURCE_ROW").mismatch, true)
  assert.equal(tamperRowHashCase("POSITION_CYCLE").mismatch, true) // ciclo já detectava; segue detectando
})

test("ADULTERAÇÃO do rowHash: sem o rowHash no fingerprint (comportamento ANTERIOR) o trade-linha passaria despercebido — o teste acima depende do ajuste", () => {
  const run = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: FILE, reconstructCycles: false })
  const evs = explainTrades(run.trades, run.importRecord as ImportRecord).map((r) => ok2(r).tradeEvidence)
  const old = (e: ReturnType<typeof tradeFingerprintFromEvidence>) => ({ ...e, rowHashes: [] as string[] }) // fingerprint de trade-linha como era antes (rowHashes vazio)
  const before = tradeSetHash(evs.map((e) => old(tradeFingerprintFromEvidence(e))))
  const forged = clone(evs)
  forged[2].sourceRows[0].rowHash = "f".repeat(64)
  assert.equal(tradeSetHash(forged.map((e) => old(tradeFingerprintFromEvidence(e)))), before, "no desenho antigo o rowHash adulterado não mudava o hash")
  assert.notEqual(tradeSetHash(forged.map(tradeFingerprintFromEvidence)), tradeSetHash(evs.map(tradeFingerprintFromEvidence)), "agora muda")
})

// ── determinismo ─────────────────────────────────────────────────────────────

test("DETERMINISMO: mesma entrada ⇒ mesma Evidence byte a byte e mesmo evidenceHash; ordem dos trades de entrada irrelevante; computedAt null", () => {
  const a = ok(explain("netPnl", total().source))
  const b = ok(explain("netPnl", total().source))
  assert.equal(canonicalJson(a), canonicalJson(b))
  assert.equal(metricEvidenceBundle(a).evidenceHash, metricEvidenceBundle(b).evidenceHash)
  assert.equal(a.metricEvidence.computedAt, null)
  const shuffled = [...A].reverse()
  const c = ok(explain("netPnl", total(shuffled).source, shuffled))
  assert.equal(metricEvidenceBundle(c).evidenceHash, metricEvidenceBundle(a).evidenceHash)
  const again = runImportPipeline(synthCsv(rowsOf(SPEC)), { sourceTz: BRT, fileName: FILE })
  const Aa = toAnalyticsTrades(again.trades)
  const d = ok(explain("netPnl", total(Aa).source, Aa, [again.importRecord as ImportRecord]))
  assert.equal(metricEvidenceBundle(d).evidenceHash, metricEvidenceBundle(a).evidenceHash)
  for (const id of METRIC_IDS) assert.equal(canonicalJson(ok(explain(id, total().source))), canonicalJson(ok(explain(id, total().source))), id)
})

// ── fixtures reais (locais; sem números embutidos) ───────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
const C = { imports: 0, ciclos: 0, linhas: 0, metrics: 0, groups: 0, tradeRefs: 0, contributors: 0, hashOnly: 0, roundTrips: 0, identityMissing: 0, resultDiv: 0, hashDiv: 0 }
const cents = (xs: Array<number | null>) => xs.reduce((a: number, b) => a + Math.round((b ?? 0) * 100), 0)
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  test(`REAL ${tag}: ciclos e linhas × todas as métricas × total/grupos por account e hour; sem divergência; sem vazamento; HASH_ONLY exercitado`, () => {
    C.imports += 1
    const accounts = [...new Set(parseDelimited(text).rows.map((r) => (r.fields["conta"] ?? "").trim()).filter(Boolean))]
    assert.ok(accounts.length > 0)
    for (const label of ["ciclos", "linhas"] as const) {
      const run = runImportPipeline(text, { ...ctx, fileName: `${accounts[0]}-${tag}.csv`, ...(label === "linhas" ? { reconstructCycles: false } : {}) })
      const record = run.importRecord as ImportRecord
      const An = toAnalyticsTrades(run.trades)
      C[label] += run.trades.length
      // não-regressão: traced ≡ normal, tradeSetHash idêntico
      const tm = calculateMetricsTraced(An)
      const normal = calculateMetrics(An)
      if (canonicalJson(tm.result) !== canonicalJson(normal)) C.resultDiv += 1
      if (tm.result.population.tradeSetHash !== normal.population.tradeSetHash) C.hashDiv += 1
      assert.ok(roundTrip(run.trades, record, `${tag} ${label}`).rKnown >= 0)
      C.roundTrips += 1
      const call = (id: string, source: MetricSource, trades = An) => {
        const r = explainMetric({ metricId: id, source, trades, importRecords: [record] })
        if (!r.ok && r.code === "E_POPULATION_IDENTITY_MISSING") C.identityMissing += 1
        const e = ok(r)
        C.metrics += 1
        C.tradeRefs += e.tradeEvidences.length
        C.contributors += e.metricEvidence.contributors.items.length
        if (e.metricEvidence.verifiability === "HASH_ONLY") C.hashOnly += 1
        assert.equal(findAccountNameLeak([e.metricEvidence, e.tradeEvidences, e.importRefs], accounts), null, `${label} ${id}: conta vazou`)
        assert.equal(e.metricEvidence.population.tradeSetHash, (source.kind === "METRICS" ? source.result.population.tradeSetHash : source.scope.kind === "TOTAL" ? source.result.total.population.tradeSetHash : source.result.groups[source.scope.index].tradeSetHash))
        // cadeia: todo id resolve para TradeEvidence com (importId,rowNo,rowHash) e ImportRef
        const have = new Map(e.tradeEvidences.map((t) => [t.tradeId, t]))
        for (const id2 of [...(e.metricEvidence.population.tradeIds ?? []), ...e.metricEvidence.contributors.items.map((c) => c.tradeId)]) assert.ok(have.has(id2))
        assert.ok(e.tradeEvidences.every((t) => t.sourceRows.every((r) => r.rowHash?.length === 64) && e.importRefs.some((i) => i.importId === t.importId)))
        return e
      }
      const total_ = { kind: "METRICS", result: tm.result, trace: tm.trace } as MetricSource
      for (const id of METRIC_IDS) call(id, total_)
      // consistência de família (conferência do teste, a partir dos valores dos TradeEvidence — não é o motor): winners/netPnl/winnersTotal
      const netOf = (e: ExplainMetricOk, ids: string[]) => cents(ids.map((i) => (e.tradeEvidences.find((t) => t.tradeId === i) as { pnl: { net: number | null } }).pnl.net))
      const wn = call("winners", total_)
      assert.equal(idsOf(wn, "WINNER").length, tm.result.metrics.winners.value)
      assert.ok(idsOf(wn, "WINNER").every((i) => netOf(wn, [i]) > 0))
      const np = call("netPnl", total_)
      assert.equal(netOf(np, idsOf(np, "INCLUDED")), Math.round((tm.result.metrics.netPnl.value as number) * 100))
      const wt = call("winnersTotal", total_)
      assert.equal(netOf(wt, idsOf(wt, "WINNER")), Math.round((tm.result.metrics.winnersTotal.value as number) * 100))
      // grupos por account e por hour (e account × hour)
      for (const by of ["account", "hour", ["account", "hour"]] as const) {
        const ag = aggregateTradesTraced(An, { groupBy: by as never })
        if (canonicalJson(ag.result) !== canonicalJson(aggregateTrades(An, { groupBy: by as never }))) C.resultDiv += 1
        ag.result.groups.forEach((grp, i) => {
          C.groups += 1
          for (const id of METRIC_IDS) call(id, { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: i } })
          if (by === "account") assert.ok(call("netPnl", { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: i } }).metricEvidence.query.groupKey?.every((k) => /^acc_/.test(k as string)))
        })
      }
      // HASH_ONLY: limite baixo (o hash continua o da população completa)
      const low = calculateMetricsTraced(An, { tradeIdsLimit: 3 })
      assert.equal(low.result.population.tradeSetHash, normal.population.tradeSetHash)
      for (const id of ["netPnl", "winners", "largestWinner", "maxDrawdown"]) {
        const e = call(id, { kind: "METRICS", result: low.result, trace: low.trace })
        assert.equal(e.metricEvidence.verifiability, run.trades.length > 3 ? "HASH_ONLY" : "FULL")
      }
      // determinismo
      const again = runImportPipeline(text, { ...ctx, fileName: `${accounts[0]}-${tag}.csv`, ...(label === "linhas" ? { reconstructCycles: false } : {}) })
      const Aa = toAnalyticsTrades(again.trades)
      const t2 = calculateMetricsTraced(Aa)
      const x = ok(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t2.result, trace: t2.trace }, trades: Aa, importRecords: [again.importRecord as ImportRecord] }))
      assert.equal(metricEvidenceBundle(x).evidenceHash, metricEvidenceBundle(call("netPnl", total_)).evidenceHash)
    }
  })
}
if (names.length) {
  console.log(`  → fixtures reais: ${C.imports} imports · ${C.ciclos} ciclos + ${C.linhas} trades-linha · ${C.metrics} métricas explicadas (ok=true) em ${C.groups} grupos + totais · ${C.tradeRefs} TradeEvidence referenciados · ${C.contributors} contribuintes · ${C.hashOnly} HASH_ONLY · ${C.identityMissing} E_POPULATION_IDENTITY_MISSING · divergências result normal×traced: ${C.resultDiv} · divergências de tradeSetHash: ${C.hashDiv} · reconstruções R/pontos a partir da Evidence: ${C.roundTrips}`)
}

console.log(`\n${passed} testes ok`)
