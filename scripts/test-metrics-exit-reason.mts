// E6.0 — dimensão `exitReason` (motivo de saída AGREGADO POR TRADE) + strategyRef na Evidence.   node scripts/test-metrics-exit-reason.mts
// Sintético versionado (pipeline real: CSV NT8 → ciclos → motor) + (se existirem) as fixtures reais LOCAIS, sem números embutidos.
// Regra (data-contract §15.1): conjunto de motivos distintos de TODAS as pernas de saída; 1 → esse; ≥2 → MIXED (partial se inclui UNKNOWN);
// sem pernas → UNKNOWN. Nunca se infere do P&L.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade, ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { explainTrade } from "../src/lib/evidence/explain-trade.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { analyticsTradeFromEvidence } from "../src/lib/evidence/to-analytics.ts"
import { verifyEvidence, type VerifyReport } from "../src/lib/evidence/verify.ts"
import { accountRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import {
  EXIT_REASON_BUCKETS,
  EXIT_REASON_LABELS,
  aggregateTrades,
  aggregateTradesTraced,
  calculateMetrics,
  exitReasonOf,
  filterTrades,
  toAnalyticsTrades,
  type AnalyticsTrade,
} from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const STRATEGY = "Estrategia Teste" // nome embutido pelo gerador sintético

// ── 1. A REGRA, isolada (tabela do contrato) ─────────────────────────────────

type Leg = { reason: string; role?: string }
const legs = (...reasons: string[]) => reasons.map((reason, i) => ({ reason, role: i === reasons.length - 1 ? "EXIT" : "SCALE_OUT" }))
const rule = (ls: Leg[] | null | undefined, byReason?: Record<string, number>) =>
  exitReasonOf({ exitLegs: ls as Any, exitSummary: byReason ? ({ finalReason: null, finalReasons: [], byReason, mixed: false } as Any) : null })

test("REGRA: um motivo em todas as saídas → esse motivo; várias saídas do MESMO motivo continuam sendo esse motivo", () => {
  assert.deepEqual(rule(legs("TARGET")), { bucket: "TARGET", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("TARGET", "TARGET", "TARGET")), { bucket: "TARGET", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("STOP", "STOP")), { bucket: "STOP", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("MANUAL")), { bucket: "MANUAL", partial: false, source: "LEGS" })
})

test("REGRA: motivos conhecidos distintos → MIXED (não é partial); a ordem das pernas não muda nada", () => {
  assert.deepEqual(rule(legs("TARGET", "STOP")), { bucket: "MIXED", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("STOP", "TARGET")), { bucket: "MIXED", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("TARGET", "STOP", "MANUAL")), { bucket: "MIXED", partial: false, source: "LEGS" })
})

test("REGRA: só desconhecidos → UNKNOWN; conhecido + desconhecido → MIXED com partial=true (nada é descartado em silêncio)", () => {
  assert.deepEqual(rule(legs("UNKNOWN")), { bucket: "UNKNOWN", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("UNKNOWN", "UNKNOWN")), { bucket: "UNKNOWN", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("TARGET", "UNKNOWN")), { bucket: "MIXED", partial: true, source: "LEGS" })
  assert.deepEqual(rule(legs("UNKNOWN", "STOP")), { bucket: "MIXED", partial: true, source: "LEGS" })
  assert.deepEqual(rule(legs("TARGET", "STOP", "UNKNOWN")), { bucket: "MIXED", partial: true, source: "LEGS" })
})

test("REGRA: sem pernas → UNKNOWN (source NONE); sem pernas mas com resumo → mesma regra sobre byReason (source SUMMARY); valor fora do enum nunca é conhecido", () => {
  assert.deepEqual(rule(null), { bucket: "UNKNOWN", partial: false, source: "NONE" })
  assert.deepEqual(rule([]), { bucket: "UNKNOWN", partial: false, source: "NONE" })
  assert.deepEqual(rule(undefined), { bucket: "UNKNOWN", partial: false, source: "NONE" })
  assert.deepEqual(rule(null, { STOP: 2 }), { bucket: "STOP", partial: false, source: "SUMMARY" })
  assert.deepEqual(rule(null, { TARGET: 1, STOP: 1 }), { bucket: "MIXED", partial: false, source: "SUMMARY" })
  assert.deepEqual(rule(null, { TARGET: 1, UNKNOWN: 1 }), { bucket: "MIXED", partial: true, source: "SUMMARY" })
  assert.deepEqual(rule(null, { STOP: 0 }), { bucket: "UNKNOWN", partial: false, source: "NONE" }) // qtd 0 não conta
  assert.deepEqual(rule(legs("ALVO_INVENTADO")), { bucket: "UNKNOWN", partial: false, source: "LEGS" })
  assert.deepEqual(rule(legs("TARGET", "ALVO_INVENTADO")), { bucket: "MIXED", partial: true, source: "LEGS" })
  assert.deepEqual([...EXIT_REASON_BUCKETS], ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])
})

// ── 2. Pipeline real: CSV sintético → ciclos de várias pernas ────────────────

interface Cycle { name: string; rows: Array<Pick<SynthRow, "exitPrice" | "exitLabel"> & { exitAt: string }>; expect: string; partial?: boolean; entryPrice?: number }
const H = (day: number, hms: string) => `${String(day).padStart(2, "0")}/03/2026 ${hms}`
// um ciclo por dia (todas as linhas entram no mesmo instante ⇒ posição 0→2→0). `entryPrice` 2000; resultado (P&L) varia de propósito.
const CYCLES: Cycle[] = [
  { name: "alvo-simples", rows: [{ exitPrice: 2004, exitLabel: "Target1", exitAt: "10:10:00" }], expect: "TARGET" },
  { name: "alvo-duas-saidas", rows: [{ exitPrice: 2004, exitLabel: "Target1", exitAt: "10:10:00" }, { exitPrice: 2008, exitLabel: "Target2", exitAt: "10:20:00" }], expect: "TARGET" },
  { name: "stop-simples", rows: [{ exitPrice: 1996, exitLabel: "Stop1", exitAt: "10:10:00" }], expect: "STOP" },
  { name: "stop-no-lucro", rows: [{ exitPrice: 2003, exitLabel: "Stop1", exitAt: "10:10:00" }], expect: "STOP" }, // break-even/trailing: nome Stop, resultado positivo
  { name: "alvo-no-prejuizo", rows: [{ exitPrice: 1999, exitLabel: "Target1", exitAt: "10:10:00" }], expect: "TARGET" }, // nome Target, resultado negativo
  { name: "manual", rows: [{ exitPrice: 2001, exitLabel: "Zerar", exitAt: "10:10:00" }], expect: "MANUAL" },
  { name: "alvo-e-stop", rows: [{ exitPrice: 2004, exitLabel: "Target1", exitAt: "10:10:00" }, { exitPrice: 1995, exitLabel: "Stop1", exitAt: "10:20:00" }], expect: "MIXED" },
  { name: "stop-e-manual", rows: [{ exitPrice: 1995, exitLabel: "Stop1", exitAt: "10:10:00" }, { exitPrice: 2002, exitLabel: "Zerar", exitAt: "10:20:00" }], expect: "MIXED" },
  { name: "rotulo-desconhecido", rows: [{ exitPrice: 2002, exitLabel: "Saida X", exitAt: "10:10:00" }], expect: "UNKNOWN" },
  { name: "sem-rotulo", rows: [{ exitPrice: 2002, exitLabel: "", exitAt: "10:10:00" }], expect: "UNKNOWN" },
  { name: "alvo-e-desconhecido", rows: [{ exitPrice: 2004, exitLabel: "Target1", exitAt: "10:10:00" }, { exitPrice: 2002, exitLabel: "Saida X", exitAt: "10:20:00" }], expect: "MIXED", partial: true },
]
const rowsOf = (): SynthRow[] =>
  CYCLES.flatMap((c, i) =>
    c.rows.map((r) => ({ entryPrice: c.entryPrice ?? 2000, exitPrice: r.exitPrice, entryAt: H(2 + i, "09:00:00"), exitAt: H(2 + i, r.exitAt), exitLabel: r.exitLabel })),
  )
const CSV = synthCsv(rowsOf())
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "e6-0.csv" })
const rec = imp.importRecord as ImportRecord
const trades: AnalyticsTrade[] = toAnalyticsTrades(imp.trades)

test("FIXTURE: 11 ciclos (um por cenário), todos POSITION_CYCLE, com pernas de saída reais do pipeline", () => {
  assert.equal(imp.trades.length, CYCLES.length)
  assert.ok(imp.trades.every((t) => t.granularity === "POSITION_CYCLE" && (t.exitLegs?.length ?? 0) >= 1))
  assert.deepEqual(imp.trades.map((t) => t.exitLegs!.length), CYCLES.map((c) => c.rows.length))
})

test("PIPELINE → BUCKET: cada ciclo cai no bucket do oráculo à mão (target/stop/manual/misto/desconhecido/sem rótulo/conhecido+desconhecido)", () => {
  imp.trades.forEach((t, i) => {
    const r = exitReasonOf(t)
    assert.equal(r.bucket, CYCLES[i].expect, CYCLES[i].name)
    assert.equal(r.partial, CYCLES[i].partial ?? false, `${CYCLES[i].name}: partial`)
    assert.equal(r.source, "LEGS", CYCLES[i].name)
  })
  // o motor lê o MESMO bucket que a função de regra
  const probe = filterTrades(trades, {}, { timeZone: BRT })
  assert.equal(probe.trades.length, CYCLES.length)
})

test("NÃO INFERE DO P&L: 'Stop' com lucro continua STOP, 'Target' com prejuízo continua TARGET; mesmo rótulo com resultado oposto ⇒ mesmo bucket", () => {
  const byName = (n: string) => imp.trades[CYCLES.findIndex((c) => c.name === n)]
  assert.ok((byName("stop-no-lucro").pnl.net ?? 0) > 0 && exitReasonOf(byName("stop-no-lucro")).bucket === "STOP")
  assert.ok((byName("alvo-no-prejuizo").pnl.net ?? 0) < 0 && exitReasonOf(byName("alvo-no-prejuizo")).bucket === "TARGET")
  // ciclo sem rótulo conhecido com lucro e com prejuízo: ambos UNKNOWN (não vira TARGET/STOP pelo sinal)
  const lucro = runImportPipeline(synthCsv([{ entryPrice: 2000, exitPrice: 2010, entryAt: H(2, "09:00:00"), exitAt: H(2, "10:00:00"), exitLabel: "Saida X" }]), { sourceTz: BRT }).trades[0]
  const perda = runImportPipeline(synthCsv([{ entryPrice: 2000, exitPrice: 1990, entryAt: H(2, "09:00:00"), exitAt: H(2, "10:00:00"), exitLabel: "Saida X" }]), { sourceTz: BRT }).trades[0]
  assert.deepEqual([exitReasonOf(lucro).bucket, exitReasonOf(perda).bucket], ["UNKNOWN", "UNKNOWN"])
})

test("MAPA DO USUÁRIO: rótulo desconhecido mapeado pelo usuário vira conhecido (USER_MAP) e muda o bucket; sem mapa continua UNKNOWN", () => {
  const withMap = runImportPipeline(CSV, { sourceTz: BRT, exitReasonMap: [{ pattern: "^saida x", reason: "MANUAL" }] })
  const i = CYCLES.findIndex((c) => c.name === "rotulo-desconhecido")
  const j = CYCLES.findIndex((c) => c.name === "alvo-e-desconhecido")
  assert.equal(exitReasonOf(withMap.trades[i]).bucket, "MANUAL")
  assert.deepEqual([exitReasonOf(withMap.trades[j]).bucket, exitReasonOf(withMap.trades[j]).partial], ["MIXED", false]) // agora conhecido: MIXED completo
  assert.equal(exitReasonOf(imp.trades[i]).bucket, "UNKNOWN")
})

test("TRADE-LINHA (sem pernas): reconstructCycles=false ⇒ todos UNKNOWN com source NONE — não é 'sem stop', é 'não sei'", () => {
  const flat = runImportPipeline(CSV, { sourceTz: BRT, reconstructCycles: false })
  assert.ok(flat.trades.length > 0 && flat.trades.every((t) => t.granularity !== "POSITION_CYCLE"))
  for (const t of flat.trades) assert.deepEqual(exitReasonOf(t), { bucket: "UNKNOWN", partial: false, source: "NONE" })
  const ag = aggregateTrades(toAnalyticsTrades(flat.trades), { groupBy: "exitReason", timeZone: BRT })
  assert.deepEqual(ag.groups.map((g) => [g.key[0], g.sampleSize]), [["UNKNOWN", flat.trades.length]])
})

// ── 3. Agrupamento ───────────────────────────────────────────────────────────

const agg = aggregateTrades(trades, { groupBy: "exitReason", timeZone: BRT })
const totalCents = (g: { metrics: Record<string, { value: number | null }> }) => Math.round((g.metrics.netPnl.value ?? 0) * 100)

test("AGRUPAMENTO: uma partição por bucket, ordem determinística, rótulo em PT, nenhum grupo 'sem chave' (UNKNOWN é valor, não ausência)", () => {
  const counts = new Map(agg.groups.map((g) => [g.key[0], g.sampleSize]))
  const expected = new Map<string, number>()
  for (const c of CYCLES) expected.set(c.expect, (expected.get(c.expect) ?? 0) + 1)
  assert.deepEqual([...counts].sort(), [...expected].sort())
  assert.ok(agg.groups.every((g) => g.key[0] !== null && g.label === EXIT_REASON_LABELS[g.key[0] as keyof typeof EXIT_REASON_LABELS]))
  assert.deepEqual(agg.groups.map((g) => g.key[0]), [...agg.groups.map((g) => g.key[0] as string)].sort()) // mesma ordenação do motor
  assert.deepEqual(agg.query.groupBy, ["exitReason"])
})

test("RECONCILIAÇÃO: Σ amostras = população; Σ P&L (centavos) e Σ trades por bucket = total; tradeIds dos grupos particionam exatamente os do total", () => {
  assert.equal(agg.groups.reduce((a, g) => a + g.sampleSize, 0), CYCLES.length)
  assert.equal(agg.total.population.afterFilters, CYCLES.length)
  assert.equal(agg.groups.reduce((a, g) => a + totalCents(g), 0), totalCents(agg.total))
  const t = aggregateTradesTraced(trades, { groupBy: "exitReason", timeZone: BRT })
  const all = t.trace.groups.flatMap((g) => g.population.tradeIds ?? [])
  assert.deepEqual([...all].sort(), [...(t.trace.groups.length ? t.result.total.population.tradeIds ?? [] : [])].sort())
  assert.equal(new Set(all).size, all.length, "nenhum trade em dois buckets")
  // MIXED e UNKNOWN presentes e explícitos
  for (const k of ["MIXED", "UNKNOWN"]) assert.ok(agg.groups.some((g) => g.key[0] === k), `bucket ${k} ausente`)
})

test("TOTAL INALTERADO: as métricas financeiras do total são IDÊNTICAS com e sem a dimensão; tradeSetHash do total e tradeIds preservados", () => {
  const plain = calculateMetrics(trades, { timeZone: BRT })
  assert.deepEqual(agg.total.metrics, plain.metrics)
  assert.equal(agg.total.population.tradeSetHash, plain.population.tradeSetHash)
  assert.deepEqual(agg.total.population.tradeIds, plain.population.tradeIds)
  // e as mesmas contas por outras dimensões não mudam por a nova existir
  const dir = aggregateTrades(trades, { groupBy: "direction", timeZone: BRT })
  assert.deepEqual(dir.total.metrics, plain.metrics)
})

test("MULTIDIMENSÃO: exitReason × direction particiona sem perda; o bucket e o tradeId de cada trade batem com a função de regra", () => {
  const two = aggregateTrades(trades, { groupBy: ["exitReason", "direction"], timeZone: BRT })
  assert.equal(two.groups.reduce((a, g) => a + g.sampleSize, 0), CYCLES.length)
  assert.equal(two.groups.reduce((a, g) => a + totalCents(g), 0), totalCents(two.total))
  const tr = aggregateTradesTraced(trades, { groupBy: "exitReason", tradeIdsLimit: 500, timeZone: BRT })
  tr.result.groups.forEach((g, gi) => {
    for (const id of tr.trace.groups[gi].population.tradeIds ?? []) {
      const t = imp.trades.find((x) => x.tradeId === id)!
      assert.equal(exitReasonOf(t).bucket, g.key[0], `tradeId ${id} no bucket errado`)
    }
  })
})

test("DETERMINISMO: mesma entrada ⇒ resultado idêntico; ordem de chegada dos trades não altera grupos, hashes nem valores", () => {
  const a = aggregateTrades(trades, { groupBy: "exitReason", timeZone: BRT })
  const b = aggregateTrades(trades, { groupBy: "exitReason", timeZone: BRT })
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  const rev = aggregateTrades([...trades].reverse(), { groupBy: "exitReason", timeZone: BRT })
  assert.deepEqual(rev.groups.map((g) => [g.key, g.sampleSize, g.tradeSetHash]), a.groups.map((g) => [g.key, g.sampleSize, g.tradeSetHash]))
  assert.deepEqual(rev.groups.map((g) => totalCents(g)), a.groups.map((g) => totalCents(g)))
})

// ── 4. Filtro ────────────────────────────────────────────────────────────────

test("FILTRO exitReason: um valor, lista (OR), caixa normalizada; inválido recusa; relatório de exclusão reconcilia", () => {
  const stop = filterTrades(trades, { exitReason: "stop" }, { timeZone: BRT })
  assert.equal(stop.trades.length, CYCLES.filter((c) => c.expect === "STOP").length)
  assert.equal(stop.filters.exitReason, "STOP")
  const two = filterTrades(trades, { exitReason: ["MIXED", "UNKNOWN"] }, { timeZone: BRT })
  assert.equal(two.trades.length, CYCLES.filter((c) => c.expect === "MIXED" || c.expect === "UNKNOWN").length)
  assert.deepEqual(two.filters.exitReason, ["MIXED", "UNKNOWN"])
  assert.equal(two.report.input, CYCLES.length)
  assert.equal(two.report.kept + (two.report.excluded.exitReason?.mismatch ?? 0), CYCLES.length)
  assert.equal(two.report.excluded.exitReason?.unknown ?? 0, 0, "exitReason nunca é 'desconhecido por ausência'")
  assert.throws(() => filterTrades(trades, { exitReason: "ALVO" }, { timeZone: BRT }), /exitReason inválido/)
  const m = calculateMetrics(trades, { filters: { exitReason: "TARGET" }, timeZone: BRT })
  assert.equal(m.population.afterFilters, CYCLES.filter((c) => c.expect === "TARGET").length)
})

// ── 5. Evidence: dimensão verificável, adulteração detectada ─────────────────

const explain = (source: Any, metricId = "netPnl", opts?: { accountRefSalt?: string }) => {
  const r = explainMetric({ metricId, source, trades, importRecords: [rec], opts })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const check = (r: VerifyReport, id: string) => r.checks.find((c) => c.id === id)!
const groupBundle = (key: string) => {
  const t = aggregateTradesTraced(trades, { groupBy: "exitReason", timeZone: BRT })
  const gi = t.result.groups.findIndex((g) => g.key[0] === key)
  assert.ok(gi >= 0, key)
  return explain({ kind: "AGGREGATE", result: t.result, trace: t.trace, scope: { kind: "GROUP", index: gi } })
}

test("EVIDENCE: grupo por exitReason é VERIFICADO na associação (PASS, não SKIPPED); a conversão Evidence→motor preserva o bucket de cada trade", () => {
  for (const k of ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"]) {
    const b = groupBundle(k)
    const rep = verifyEvidence(b)
    assert.equal(check(rep, "V4.association").status, "PASS", `${k}: ${check(rep, "V4.association").detail}`)
    assert.deepEqual(rep.checks.filter((c) => c.status === "FAIL"), [], k)
    assert.deepEqual(b.evidence.metrics[0].query.groupKey, [k])
    for (const te of b.evidence.trades) assert.equal(exitReasonOf(analyticsTradeFromEvidence(te).trade as CanonicalTrade).bucket, k)
  }
})

test("EVIDENCE: filtro exitReason também é verificado; TOTAL (sem a dimensão) segue com o mesmo veredito de antes", () => {
  const f = calculateMetricsTracedFiltered("STOP")
  const rep = verifyEvidence(f)
  assert.equal(check(rep, "V4.association").status, "PASS", check(rep, "V4.association").detail)
  assert.deepEqual(f.evidence.metrics[0].query.filters.exitReason, "STOP")
})
function calculateMetricsTracedFiltered(reason: string) {
  const t = aggregateTradesTraced(trades, { groupBy: "direction", filters: { exitReason: reason }, timeZone: BRT })
  return explain({ kind: "AGGREGATE", result: t.result, trace: t.trace, scope: { kind: "TOTAL" } })
}

test("ADULTERAÇÃO (com selo refeito): chave do grupo trocada, ou pernas/motivo de um trade trocados na Evidence ⇒ V4.association FAIL e TAMPERED", () => {
  const good = groupBundle("TARGET")
  assert.equal(verifyEvidence(good).status === "TAMPERED", false)
  const wrongKey = clone(good) as Any
  wrongKey.evidence.metrics[0].query.groupKey = ["STOP"]
  const r1 = verifyEvidence(reseal(wrongKey))
  assert.equal(check(r1, "V4.association").status, "FAIL")
  assert.equal(r1.status, "TAMPERED")
  const legTampered = clone(good) as Any
  legTampered.evidence.trades[0].exitLegs[0].reason = "STOP"
  const r2 = verifyEvidence(reseal(legTampered))
  assert.equal(check(r2, "V4.association").status, "FAIL", "um motivo trocado na perna tira o trade do grupo TARGET")
  assert.equal(r2.status, "TAMPERED")
  // sem refazer o selo: já cai no V1
  assert.equal(verifyEvidence(legTampered).status, "TAMPERED")
})

// ── 6. Privacidade: strategyRef ──────────────────────────────────────────────

test("strategyRef: determinístico, distingue estratégias, depende do sal, domínio próprio (≠ accountRef do mesmo texto), nome vazio ⇒ null", () => {
  const a = strategyRef(STRATEGY)
  assert.match(a!, /^str_[0-9a-f]{24}$/)
  assert.equal(strategyRef(STRATEGY), a)
  assert.equal(strategyRef(`  ${STRATEGY} `), a)
  assert.notEqual(strategyRef("Outra Estrategia"), a)
  assert.notEqual(strategyRef(STRATEGY, "sal"), a)
  assert.notEqual(strategyRef(STRATEGY)!.slice(4), accountRef(STRATEGY)!.slice(4))
  assert.deepEqual([strategyRef(null), strategyRef(""), strategyRef("   ")], [null, null, null])
})

test("PRIVACIDADE: o nome da estratégia não aparece em NENHUM campo da Evidence (trade, ciclo, métrica total/grupo, filtros, chave de grupo); só strategyRef", () => {
  const ref = strategyRef(STRATEGY)!
  // trade
  const te = explainTrade(imp.trades[0], rec)
  assert.equal(te.ok, true)
  const tj = JSON.stringify((te as Any).tradeEvidence)
  assert.equal(tj.includes(STRATEGY), false)
  assert.equal(tj.includes('"strategy"'), false)
  assert.equal((te as Any).tradeEvidence.reconstruction.cycleKey.strategyRef, ref)
  // métrica por grupo "strategy" + filtros por nome/id de estratégia
  const t = aggregateTradesTraced(trades, { groupBy: "strategy", timeZone: BRT })
  assert.equal(t.result.groups[0].key[0], STRATEGY, "o motor ainda agrupa pelo nome (privacidade é da Evidence, não do motor)")
  const gb = explain({ kind: "AGGREGATE", result: t.result, trace: t.trace, scope: { kind: "GROUP", index: 0 } })
  assert.deepEqual(gb.evidence.metrics[0].query.groupKey, [ref])
  assert.equal(JSON.stringify(gb).includes(STRATEGY), false)
  const tf = aggregateTradesTraced(trades, { groupBy: "direction", filters: { strategyName: STRATEGY, strategyId: "ID-INTERNO-1" }, timeZone: BRT })
  const fb = explain({ kind: "AGGREGATE", result: tf.result, trace: tf.trace, scope: { kind: "TOTAL" } }) as Any
  assert.deepEqual(fb.evidence.metrics[0].query.filters.strategyNameRefs, [ref])
  assert.deepEqual(fb.evidence.metrics[0].query.filters.strategyIdRefs, [strategyRef("ID-INTERNO-1")])
  assert.equal("strategyName" in fb.evidence.metrics[0].query.filters, false)
  assert.equal("strategyId" in fb.evidence.metrics[0].query.filters, false)
  assert.equal(JSON.stringify(fb).includes(STRATEGY), false)
  assert.equal(JSON.stringify(fb).includes("ID-INTERNO-1"), false)
  // sal diferente ⇒ ref diferente (mesmo mecanismo da conta)
  const salted = explain({ kind: "AGGREGATE", result: t.result, trace: t.trace, scope: { kind: "GROUP", index: 0 } }, "netPnl", { accountRefSalt: "sal" }) as Any
  assert.deepEqual(salted.evidence.metrics[0].query.groupKey, [strategyRef(STRATEGY, "sal")])
})

test("PRIVACIDADE (fail-closed): nome de estratégia que escape em issue/mensagem ⇒ E_STRATEGY_NAME_LEAK, resultado descartado (trade e métrica)", () => {
  const leaky = clone(imp.trades[0]) as Any
  leaky.issues = [...leaky.issues, { code: "X", severity: "INFO", message: `veio da ${STRATEGY}`, field: null, rowNo: null }]
  const r = explainTrade(leaky, rec)
  assert.equal(r.ok, false)
  assert.equal((r as Any).code, "E_STRATEGY_NAME_LEAK")
  const t = aggregateTradesTraced(trades, { groupBy: "direction", timeZone: BRT })
  const bad = clone(t.result) as Any
  bad.total.warnings.push({ code: "X", severity: "INFO", message: `estratégia ${STRATEGY}` })
  const m = explainMetric({ metricId: "netPnl", source: { kind: "AGGREGATE", result: bad, trace: t.trace, scope: { kind: "TOTAL" } } as Any, trades, importRecords: [rec] })
  assert.equal(m.ok, false)
  assert.equal((m as Any).code, "E_STRATEGY_NAME_LEAK")
})

test("IDENTIDADE INTACTA: strategyRef não altera tradeId/importId/rowHash nem o tradeSetHash (o nome da estratégia continua dentro do hash da linha)", () => {
  const again = runImportPipeline(CSV, { sourceTz: BRT, fileName: "e6-0.csv" })
  assert.deepEqual(again.trades.map((t) => t.tradeId), imp.trades.map((t) => t.tradeId))
  assert.equal(again.importRecord?.importId, rec.importId)
  const other = runImportPipeline(CSV.replaceAll(STRATEGY, "Outra Estrategia"), { sourceTz: BRT, fileName: "e6-0.csv" })
  assert.notDeepEqual(other.trades.map((t) => t.tradeId), imp.trades.map((t) => t.tradeId)) // a estratégia segue na identidade
})

// ── 7. Fixtures reais LOCAIS (sem números no repositório; só reconciliação) ──

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] exitReason reconcilia com o total; bucket = regra aplicada às pernas; strategyRef sem nome em claro; Evidence dos grupos VALID/associação PASS`, () => {
    const text = readFileSync(join(DIR, name), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    const rt = toAnalyticsTrades(run.trades)
    const ag = aggregateTradesTraced(rt, { groupBy: "exitReason" })
    const plain = calculateMetrics(rt)
    assert.equal(ag.result.groups.reduce((a, g) => a + g.sampleSize, 0), run.trades.length)
    assert.equal(ag.result.groups.reduce((a, g) => a + Math.round((g.metrics.netPnl.value ?? 0) * 100), 0), Math.round((plain.metrics.netPnl.value ?? 0) * 100))
    assert.deepEqual(ag.result.total.metrics, plain.metrics)
    assert.equal(ag.result.total.population.tradeSetHash, plain.population.tradeSetHash)
    ag.result.groups.forEach((g, gi) => {
      for (const id of ag.trace.groups[gi].population.tradeIds ?? []) assert.equal(exitReasonOf(run.trades.find((t) => t.tradeId === id)!).bucket, g.key[0])
    })
    // Evidence: cada grupo por exitReason (netPnl) passa na associação e não perde nada
    const salt = (ctx as Any).accountRefSalt as string | undefined
    let verifiedGroups = 0
    ag.result.groups.forEach((g, gi) => {
      const r = explainMetric({ metricId: "netPnl", source: { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: gi } }, trades: rt, importRecords: [run.importRecord as ImportRecord], opts: { accountRefSalt: salt } })
      assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
      const b = metricEvidenceBundle(r as Any)
      const rep = verifyEvidence(b)
      assert.deepEqual(rep.checks.filter((c) => c.status === "FAIL"), [], `grupo ${g.key[0]}`)
      assert.notEqual(check(rep, "V4.association").status, "FAIL")
      if (b.evidence.metrics[0].verifiability === "FULL") assert.equal(check(rep, "V4.association").status, "PASS", `grupo ${g.key[0]}: ${check(rep, "V4.association").detail}`)
      verifiedGroups += 1
    })
    // privacidade real: nenhum nome de estratégia da fixture em nenhum bundle de trade
    const strategies = [...new Set(run.trades.map((t) => t.labels.strategyName?.trim()).filter((n): n is string => !!n))]
    for (const t of run.trades.slice(0, 200)) {
      const e = explainTrade(t, run.importRecord as ImportRecord, { accountRefSalt: salt })
      if (!e.ok) continue
      const j = JSON.stringify(e.tradeEvidence)
      for (const s of strategies) assert.equal(j.includes(s), false, "nome de estratégia vazou")
    }
    const dist = Object.fromEntries(ag.result.groups.map((g) => [g.key[0], g.sampleSize]))
    console.log(`  → real: ${run.trades.length} ciclos · buckets ${JSON.stringify(dist)} · ${verifiedGroups} grupos verificados · estratégias distintas: ${strategies.length}`)
  })
}

console.log(`\n${passed} testes ok`)
