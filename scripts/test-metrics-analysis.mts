// E6.2 — ranking, contribuição e comparação de grupos.   node scripts/test-metrics-analysis.mts
// Dois conjuntos SINTÉTICOS com oráculo à mão: (A) trades montados com `mk` (contas, horas, direções, semanas, R) para ranking/comparação;
// (B) ciclos do pipeline NT8 (CSV sintético) para motivo de saída por perna/trade. + (se existirem) as fixtures reais LOCAIS,
// sem números embutidos e sem nada real no repositório. Inferência só descritiva: nenhum teste espera p-valor ou "significativo".
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { accountRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import {
  aggregateTrades,
  calculateMetrics,
  compareExitReasons,
  compareGroups,
  comparePeriods,
  compareTradeBuckets,
  exitBreakdown,
  exitReasonAnalysis,
  rankGroups,
  rankGroupsByExitLegs,
  toAnalyticsTrades,
  type AnalyticsTrade,
  type Dimension,
} from "../src/lib/metrics/index.ts"
import { mk, NY } from "./_metrics-fixtures.mts"
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
const cents = (x: number) => Math.round(x * 100)
const J = JSON.stringify

// ── (A) trades: contas × horas × direções × semanas ──────────────────────────
// MNQ, 1 contrato, US$ 2/ponto, comissão 1,00 + taxas 0,20 (líquido = bruto − 1,20). Horários em NY (opção timeZone: NY).

const ALFA = "ACC-ALFA-SECRETA"
const BETA = "ACC-BETA-SECRETA"
const STRAT = "Estrat-Secreta"
interface Def { id: string; account: string | null; dir: "LONG" | "SHORT"; entry: number; exit: number; at: string; stop?: number }
const D: Def[] = [
  // ALFA, 09h, LONG — semana de 05/01 (5) e 12/01 (1); com stop (R conhecido)
  { id: "a1", account: ALFA, dir: "LONG", entry: 21000, exit: 21010, at: "2026-01-05 09:35:00", stop: 20990 },
  { id: "a2", account: ALFA, dir: "LONG", entry: 21000, exit: 21005, at: "2026-01-06 09:40:00", stop: 20990 },
  { id: "a3", account: ALFA, dir: "LONG", entry: 21000, exit: 21008, at: "2026-01-07 09:45:00", stop: 20990 },
  { id: "a4", account: ALFA, dir: "LONG", entry: 21000, exit: 20998, at: "2026-01-08 09:50:00", stop: 20990 },
  // ALFA, 14h, SHORT — sem stop
  { id: "a5", account: ALFA, dir: "SHORT", entry: 21000, exit: 21006, at: "2026-01-09 14:05:00" },
  { id: "a6", account: ALFA, dir: "SHORT", entry: 21000, exit: 21004, at: "2026-01-12 14:10:00" },
  { id: "a7", account: ALFA, dir: "SHORT", entry: 21000, exit: 20999, at: "2026-01-13 14:15:00" },
  { id: "a8", account: ALFA, dir: "SHORT", entry: 21000, exit: 21008, at: "2026-01-14 14:20:00" },
  // BETA: 2 trades (amostra minúscula), 09h LONG, semana de 12/01
  { id: "b1", account: BETA, dir: "LONG", entry: 21000, exit: 21003, at: "2026-01-12 09:55:00", stop: 20990 },
  { id: "b2", account: BETA, dir: "LONG", entry: 21000, exit: 21004, at: "2026-01-13 09:58:00", stop: 20990 },
  // conta desconhecida (null), 10h LONG
  { id: "n1", account: null, dir: "LONG", entry: 21000, exit: 21001, at: "2026-01-14 10:05:00" },
]
const mkDef = (d: Def): AnalyticsTrade => {
  const exitAt = d.at.replace(/(\d\d):(\d\d):00$/, (_m, h, mi) => `${h}:${String(Number(mi) + 1).padStart(2, "0")}:00`)
  const t = mk({ id: d.id, direction: d.dir, entry: d.entry, exit: d.exit, entryAt: d.at, exitAt, tz: NY, account: d.account, strategyName: STRAT, stop: d.stop ?? null })
  return t
}
const T: AnalyticsTrade[] = D.map(mkDef)
const net = (d: Def) => cents((d.dir === "LONG" ? d.exit - d.entry : d.entry - d.exit) * 2) - 120
const O = { timeZone: NY, minSample: 5 } as const
const sumNet = (xs: Def[]) => xs.reduce((a, d) => a + net(d), 0)
const NET_ALL = sumNet(D)
const by = (f: (d: Def) => boolean) => D.filter(f)

// ── 1–3. ranking, contribuição, amostras ─────────────────────────────────────

test("RANKING (1): hora 09 (ganho) × 14 (perda) × 10; DESC e ASC; valores = oráculo à mão; rank só nos elegíveis", () => {
  const r = rankGroups(T, { groupBy: "hour", ...O })
  const h = (k: string) => r.rows.find((x) => x.key.key[0] === k)!
  assert.equal(h("09").net.value, sumNet(by((d) => d.at.includes(" 09:"))) / 100)
  assert.equal(h("14").net.value, sumNet(by((d) => d.at.includes(" 14:"))) / 100)
  assert.ok((h("09").net.value as number) > 0 && (h("14").net.value as number) < 0)
  assert.deepEqual(r.rows.filter((x) => x.rank !== null).map((x) => x.key.key[0]), ["09", "14"]) // 10h (1 trade) é TINY ⇒ sem posição
  assert.equal(h("09").rank, 1)
  const asc = rankGroups(T, { groupBy: "hour", order: "ASC", ...O })
  assert.deepEqual(asc.rows.filter((x) => x.rank !== null).map((x) => x.key.key[0]), ["14", "09"])
  assert.equal(r.unit, "TRADE")
  assert.equal(r.inference, "DESCRIPTIVE_ONLY")
  assert.equal(r.metric.id, "netPnl")
  const byAvg = rankGroups(T, { groupBy: "hour", metric: "averageTrade", ...O })
  assert.equal(byAvg.metric.unit, "usd")
  assert.throws(() => rankGroups(T, { groupBy: "hour", metric: "naoExiste", ...O }), /Métrica desconhecida/)
})

test("CONTRIBUIÇÃO (2): líquido do grupo ÷ líquido total com denominador válido; Σ ≈ 1; denominador zero ⇒ null com motivo (nunca 0)", () => {
  const r = rankGroups(T, { groupBy: "hour", ...O })
  assert.equal(r.total.net.value, NET_ALL / 100)
  for (const row of r.rows) {
    const expected = Math.round((((row.net.value as number) * 100) / NET_ALL) * 1e4) / 1e4
    assert.equal(row.contributionToTotal.value, expected)
    assert.equal(row.contributionToTotal.reason, null)
  }
  const sum = r.rows.reduce((a, x) => a + (x.contributionToTotal.value as number), 0)
  assert.ok(Math.abs(sum - 1) < 1e-3, `Σ = ${sum}`)
  // fração do recorte
  assert.equal(r.rows.reduce((a, x) => a + (x.shareOfTrades.value as number), 0) > 0.999, true)
  // total ZERO: líquidos +11,80 e −11,80 ⇒ sem denominador: fração null com motivo (nunca 0)
  const z = [
    mk({ id: "z1", direction: "LONG", entry: 21000, exit: 21005, entryAt: "2026-01-05 09:35:00", exitAt: "2026-01-05 09:40:00", tz: NY, account: ALFA }),
    mk({ id: "z2", direction: "SHORT", entry: 21000, exit: 21003.8, entryAt: "2026-01-05 10:35:00", exitAt: "2026-01-05 10:40:00", tz: NY, account: ALFA }),
  ]
  const zr = rankGroups(z, { groupBy: "direction", ...O })
  assert.equal(zr.total.net.value, 0)
  for (const row of zr.rows) assert.deepEqual([row.contributionToTotal.value, row.contributionToTotal.reason], [null, "DENOMINATOR_ZERO"])
})

test("AMOSTRAS DIFERENTES (3): OK/LOW/TINY por grupo; TINY listado e FORA da numeração (não descartado); aviso de amostra; confiança acompanha", () => {
  const r = rankGroups(T, { groupBy: "hour", ...O })
  const flag = Object.fromEntries(r.rows.map((x) => [x.key.key[0], x.sampleFlag]))
  assert.deepEqual(flag, { "09": "OK", "10": "TINY", "14": "LOW" }) // 6, 1, 4 trades com minSample 5
  assert.equal(r.rows.length, 3, "nenhum grupo some")
  const tiny = r.rows.find((x) => x.sampleFlag === "TINY")!
  assert.equal(tiny.rank, null)
  assert.deepEqual([tiny.confidence, tiny.limitations.includes("SAMPLE_TINY")], ["UNRELIABLE", true])
  const low = r.rows.find((x) => x.sampleFlag === "LOW")!
  assert.deepEqual([low.confidence, low.limitations], ["LIMITED", ["SAMPLE_LOW"]])
  assert.equal(r.rows.find((x) => x.sampleFlag === "OK")!.confidence, "OK")
  assert.equal(r.summary.lowOrTinyGroups, 2)
  assert.ok(r.warnings.some((w) => w.code === "W_LOW_SAMPLE") && r.warnings.some((w) => w.code === "W_UNRANKED_GROUPS"))
  // unidade e contagem: sampleSize = trades
  assert.equal(r.rows.reduce((a, x) => a + x.sampleSize, 0), D.length)
})

// ── 5–7. comparações ─────────────────────────────────────────────────────────

test("CONTAS com accountRef (5): comparação A×B sai com ref (nunca o nome); deltas exatos; sal muda o ref; redact:false é opt-in explícito", () => {
  const c = compareGroups(T, { groupBy: "account", a: { account: ALFA }, b: { account: BETA }, ...O })
  assert.equal(c.kind, "GROUP_COMPARISON")
  assert.equal(c.unit, "TRADE")
  assert.equal(c.a.key!.key[0], accountRef(ALFA))
  assert.equal(c.b.key!.key[0], accountRef(BETA))
  assert.equal(J(c).includes(ALFA) || J(c).includes(BETA), false)
  const alfa = by((d) => d.account === ALFA)
  const beta = by((d) => d.account === BETA)
  const m = Object.fromEntries(c.metrics.map((x) => [x.metric, x]))
  assert.equal(m.netPnl.a.value, sumNet(alfa) / 100)
  assert.equal(m.netPnl.b.value, sumNet(beta) / 100)
  assert.equal(m.netPnl.delta, (sumNet(beta) - sumNet(alfa)) / 100)
  assert.equal(m.totalTrades.delta, beta.length - alfa.length)
  assert.deepEqual([c.a.sampleFlag, c.b.sampleFlag, c.sampleAdequate], ["OK", "TINY", false])
  assert.equal(m.netPnl.conclusive, false, "amostra TINY de um lado ⇒ não conclusivo")
  assert.equal(c.confidence, "UNRELIABLE")
  const salted = compareGroups(T, { groupBy: "account", a: { account: ALFA }, b: { account: BETA }, refSalt: "sal", ...O })
  assert.equal(salted.a.key!.key[0], accountRef(ALFA, "sal"))
  assert.notEqual(salted.a.key!.key[0], c.a.key!.key[0])
  const clear = compareGroups(T, { groupBy: "account", a: { account: ALFA }, b: { account: BETA }, redact: false, ...O })
  assert.equal(clear.a.key!.key[0], ALFA)
})

test("PERÍODOS (6): semana de 05/01 × semana de 12/01 pelo MESMO motor; valores = oráculo; sobreposição e período vazio são ditos", () => {
  const w1 = { from: "2026-01-05", to: "2026-01-11" }
  const w2 = { from: "2026-01-12", to: "2026-01-18" }
  const c = comparePeriods(T, { a: w1, b: w2, ...O })
  assert.equal(c.kind, "PERIOD_COMPARISON")
  const inW = (lo: string, hi: string) => by((d) => d.at.slice(0, 10) >= lo && d.at.slice(0, 10) <= hi)
  const m = Object.fromEntries(c.metrics.map((x) => [x.metric, x]))
  assert.equal(m.totalTrades.a.value, inW(w1.from, w1.to).length)
  assert.equal(m.totalTrades.b.value, inW(w2.from, w2.to).length)
  assert.equal(m.netPnl.a.value, sumNet(inW(w1.from, w1.to)) / 100)
  assert.equal(m.netPnl.delta, (sumNet(inW(w2.from, w2.to)) - sumNet(inW(w1.from, w1.to))) / 100)
  assert.deepEqual(c.a.period, w1)
  assert.equal(c.limitations.includes("PERIODS_OVERLAP"), false)
  // o resultado de cada lado é o do motor com o filtro
  assert.equal(c.a.tradeSetHash, calculateMetrics(T, { ...O, filters: w1 }).population.tradeSetHash)
  const overlap = comparePeriods(T, { a: w1, b: { from: "2026-01-09", to: "2026-01-16" }, ...O })
  assert.ok(overlap.limitations.includes("PERIODS_OVERLAP"))
  const empty = comparePeriods(T, { a: w1, b: { from: "2027-01-01", to: "2027-01-07" }, ...O })
  assert.ok(empty.limitations.includes("PERIOD_EMPTY"))
  assert.equal(empty.confidence, "UNRELIABLE")
  assert.equal(empty.metrics.find((x) => x.metric === "netPnl")!.delta, null)
  assert.throws(() => comparePeriods(T, { a: { from: "2026-02-01", to: "2026-01-01" }, b: w2, ...O }), /posterior/)
})

test("HORÁRIO e DIREÇÃO (7): hora 09 × 14, LONG × SHORT e hora×direção (multidimensão); sempre todas as dimensões nos dois lados", () => {
  const h = compareGroups(T, { groupBy: "hour", a: { hour: "09" }, b: { hour: "14" }, ...O })
  const m = Object.fromEntries(h.metrics.map((x) => [x.metric, x]))
  assert.equal(m.netPnl.a.value, sumNet(by((d) => d.at.includes(" 09:"))) / 100)
  assert.equal(m.netPnl.b.value, sumNet(by((d) => d.at.includes(" 14:"))) / 100)
  const dir = compareGroups(T, { groupBy: "direction", a: { direction: "LONG" }, b: { direction: "SHORT" }, ...O })
  assert.equal(dir.metrics.find((x) => x.metric === "netPnl")!.a.value, sumNet(by((d) => d.dir === "LONG")) / 100)
  assert.equal(dir.metrics.find((x) => x.metric === "netPnl")!.b.value, sumNet(by((d) => d.dir === "SHORT")) / 100)
  const hd = compareGroups(T, { groupBy: ["hour", "direction"], a: { hour: "09", direction: "LONG" }, b: { hour: "14", direction: "SHORT" }, ...O })
  assert.equal(hd.metrics.find((x) => x.metric === "totalTrades")!.a.value, by((d) => d.at.includes(" 09:") && d.dir === "LONG").length)
  assert.throws(() => compareGroups(T, { groupBy: ["hour", "direction"], a: { hour: "09" }, b: { hour: "14" }, ...O }), /TODAS as dimensões/)
  assert.throws(() => rankGroups(T, { groupBy: "hour", where: { direction: "LONG" }, ...O }), /exige a dimensão em groupBy/)
  // ranking com recorte: só LONG, ranqueando por hora
  const r = rankGroups(T, { groupBy: ["direction", "hour"], where: { direction: "LONG" }, ...O })
  assert.equal(r.subset.trades, by((d) => d.dir === "LONG").length)
  assert.equal(r.rows.length, 2) // LONG: 09 e 10
  assert.equal(r.subset.net.value, sumNet(by((d) => d.dir === "LONG")) / 100)
  assert.ok(r.rows.every((x) => x.contributionToSubset.value !== null))
})

// ── 9, 11. cobertura parcial e não comparáveis ───────────────────────────────

test("DADOS AUSENTES / COBERTURA PARCIAL (9): R só nos trades com stop — cobertura mostrada, grupo sem R fica sem valor (null, não 0) e sem posição", () => {
  const r = rankGroups(T, { groupBy: "account", metric: "totalR", ...O })
  const alfa = r.rows.find((x) => x.key.key[0] === accountRef(ALFA))!
  assert.equal(alfa.value.coverage.used, 4) // a1..a4 têm stop
  assert.equal(alfa.value.coverage.total, 8)
  assert.equal(alfa.value.coverage.ratio, 0.5)
  assert.ok(alfa.limitations.includes("COVERAGE_PARTIAL"))
  assert.equal(alfa.confidence, "LIMITED")
  const unk = r.rows.find((x) => x.unknownGroup)!
  assert.equal(unk.value.value, null)
  assert.equal(unk.value.available, false)
  assert.ok(unk.value.reason)
  assert.equal(unk.rank, null)
  assert.ok(unk.limitations.includes("METRIC_UNAVAILABLE") && unk.limitations.includes("UNKNOWN_GROUP"))
  assert.equal(unk.confidence, "UNRELIABLE")
  // R nunca inferido do resultado: sem stop ⇒ nenhum R
  assert.equal(compareGroups(T, { groupBy: "direction", a: { direction: "LONG" }, b: { direction: "SHORT" }, metrics: ["totalR"], ...O }).metrics[0].b.available, false)
})

test("NÃO COMPARÁVEL (11): grupo inexistente, métrica indisponível, razão com sinais opostos ou A=0 — sempre dito, nunca 0 nem NaN", () => {
  const nf = compareGroups(T, { groupBy: "account", a: { account: ALFA }, b: { account: "ACC-FANTASMA" }, ...O })
  assert.ok(nf.limitations.includes("GROUP_NOT_FOUND"))
  assert.equal(nf.confidence, "UNRELIABLE")
  assert.equal(nf.b.sampleSize, 0)
  assert.ok(nf.metrics.every((m) => m.delta === null || m.metric === "x"))
  assert.equal(J(nf).includes("ACC-FANTASMA"), false, "nem o nome pedido pode ecoar")
  const hr = compareGroups(T, { groupBy: "hour", a: { hour: "09" }, b: { hour: "14" }, ...O })
  const net = hr.metrics.find((m) => m.metric === "netPnl")!
  assert.equal(net.ratio, null)
  assert.equal(net.reason, "RATIO_SIGN_DIFFERS")
  assert.notEqual(net.delta, null)
  assert.equal(net.conclusive, false)
  const same = compareGroups(T, { groupBy: "hour", a: { hour: "09" }, b: { hour: "09" }, ...O })
  const sn = same.metrics.find((m) => m.metric === "netPnl")!
  assert.deepEqual([sn.delta, sn.ratio], [0, 1])
  // A = 0 ⇒ razão indisponível
  const zero = compareGroups(T, { groupBy: "hour", a: { hour: "09" }, b: { hour: "10" }, metrics: ["breakeven" as never], ...O })
  assert.equal(zero.metrics[0].a.value, 0)
  assert.equal(zero.metrics[0].ratio, null)
  assert.equal(zero.metrics[0].reason, "RATIO_A_ZERO")
  // nenhum campo numérico é NaN/Infinity em lugar nenhum
  assert.equal(/NaN|Infinity/.test(J([nf, hr, same, zero])), false)
})

// ── 12–14 (parte A) ──────────────────────────────────────────────────────────

test("PRIVACIDADE (12, trades): conta e estratégia só como accountRef/strategyRef em ranking e comparação; nome nunca, mesmo ecoado em where/a/b", () => {
  const r1 = rankGroups(T, { groupBy: "account", ...O })
  const r2 = rankGroups(T, { groupBy: "strategy", ...O })
  const r3 = rankGroups(T, { groupBy: ["account", "hour"], where: { account: ALFA }, ...O })
  const c = compareGroups(T, { groupBy: "strategy", a: { strategy: STRAT }, b: { strategy: STRAT }, ...O })
  for (const x of [r1, r2, r3, c]) for (const secret of [ALFA, BETA, STRAT]) assert.equal(J(x).includes(secret), false, `vazou ${secret}`)
  assert.deepEqual(r2.rows.map((x) => x.key.key[0]), [strategyRef(STRAT)])
  assert.deepEqual(r1.rows.filter((x) => !x.unknownGroup).map((x) => x.key.key[0]).sort(), [accountRef(ALFA), accountRef(BETA)].sort())
  assert.deepEqual(r3.where!.key, [accountRef(ALFA)])
  assert.match(r1.rows[0].key.label, /^(acc_|\(desconhecido\))/)
})

test("DETERMINISMO (13, trades): mesma entrada ⇒ JSON idêntico; ordem de chegada dos trades não altera ranking nem comparação; empate documentado", () => {
  const a = J(rankGroups(T, { groupBy: ["account", "hour"], ...O }))
  assert.equal(J(rankGroups(T, { groupBy: ["account", "hour"], ...O })), a)
  assert.equal(J(rankGroups([...T].reverse(), { groupBy: ["account", "hour"], ...O })), a)
  const c = J(compareGroups(T, { groupBy: "account", a: { account: ALFA }, b: { account: BETA }, ...O }))
  assert.equal(J(compareGroups([...T].reverse(), { groupBy: "account", a: { account: ALFA }, b: { account: BETA }, ...O })), c)
  // empate de valor: maior amostra primeiro, depois a chave; `tiedWithPrevious` marca o empate
  const mkTie = (id: string, hour: string, min: number) => mk({ id, direction: "LONG", entry: 21000, exit: 21010, entryAt: `2026-01-05 ${hour}:${String(min).padStart(2, "0")}:00`, exitAt: `2026-01-05 ${hour}:${String(min + 1).padStart(2, "0")}:00`, tz: NY, account: "Z" })
  const tie = [mkTie("t1", "09", 10), mkTie("t2", "09", 20), mkTie("t3", "09", 30), mkTie("t4", "10", 10), mkTie("t5", "10", 20), mkTie("t6", "10", 30), mkTie("t7", "10", 40)]
  const r = rankGroups(tie, { groupBy: "hour", metric: "averageTrade", timeZone: NY, minSample: 1 })
  assert.deepEqual(r.rows.map((x) => [x.key.key[0], x.rank, x.tiedWithPrevious]), [["10", 1, false], ["09", 2, true]])
  assert.equal(r.ordering, "value, then larger sample, then key")
})

test("REGRESSÃO E6.0/E6.1 (14, trades): tradeSetHash dos grupos = o do motor; breakdown do subconjunto tem o mesmo hash; total do motor intacto", () => {
  const ag = aggregateTrades(T, { groupBy: "hour", ...O })
  const r = rankGroups(T, { groupBy: "hour", ...O })
  for (const row of r.rows) assert.equal(row.tradeSetHash, ag.groups.find((g) => g.key[0] === row.key.key[0])!.tradeSetHash)
  assert.deepEqual(ag.total.metrics, calculateMetrics(T, O).metrics)
  assert.equal(r.population.tradeSetHash, calculateMetrics(T, O).population.tradeSetHash)
  // trades-linha (mk): sem pernas ⇒ exit.legs 0, status NO_LEGS, tudo UNKNOWN — "não sei", dito
  for (const row of r.rows) assert.deepEqual([row.exit.legs, row.exit.reconciliation.status, row.exit.tradesByBucket.UNKNOWN], [0, "NO_LEGS", row.sampleSize])
})

// ── (B) ciclos do pipeline: motivo de saída ──────────────────────────────────

const BRT = "America/Sao_Paulo"
interface CyDef { name: string; account: string; entryHour: number; day: number; legs: Array<{ qty?: number; exitPrice: number; label: string; min: number }> }
const CY: CyDef[] = [
  { name: "c1", account: "Sim101", entryHour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { name: "c2", account: "Sim101", entryHour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { name: "c3", account: "Sim101", entryHour: 14, day: 4, legs: [{ exitPrice: 1994, label: "Stop1", min: 10 }, { exitPrice: 1992, label: "Stop2", min: 20 }] },
  { name: "c4", account: "Sim102", entryHour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { name: "c5", account: "Sim102", entryHour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { name: "c6", account: "Sim102", entryHour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2002, label: "Saida X", min: 20 }] },
  { name: "c7", account: "Sim102", entryHour: 9, day: 10, legs: [{ exitPrice: 2002, label: "Saida X", min: 10 }, { exitPrice: 1999, label: "", min: 20 }] },
  { name: "c8", account: "Sim101", entryHour: 14, day: 11, legs: [{ qty: 3, exitPrice: 2005, label: "Target1", min: 10 }, { qty: 2, exitPrice: 1997, label: "Stop1", min: 20 }, { qty: 1, exitPrice: 2001, label: "Zerar", min: 30 }] },
]
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (day: number) => `${String(day).padStart(2, "0")}/03/2026`
const CSV2 = synthCsv(
  CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: l.qty ?? 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.entryHour)}`, exitAt: `${dd(c.day)} ${hh(c.entryHour, l.min)}`, exitLabel: l.label }))),
)
const imp = runImportPipeline(CSV2, { sourceTz: BRT, fileName: "e6-2.csv" })
const CT: AnalyticsTrade[] = toAnalyticsTrades(imp.trades)
const OB = { timeZone: BRT, minSample: 5 } as const
const REASONS = ["TARGET", "STOP", "MANUAL", "UNKNOWN"] as const
const legCents = (reason: string) => CY.flatMap((c) => c.legs.filter((l) => reasonOf(l.label) === reason).map((l) => cents((l.exitPrice - 2000) * 10 * (l.qty ?? 1)) - cents(2.4 * (l.qty ?? 1)))).reduce((a, b) => a + b, 0)
const reasonOf = (l: string) => (/^target/i.test(l) ? "TARGET" : /^stop/i.test(l) ? "STOP" : /^zerar/i.test(l) ? "MANUAL" : "UNKNOWN")
const nLegs = (reason: string) => CY.flatMap((c) => c.legs.filter((l) => reasonOf(l.label) === reason)).length

test("MOTIVO DE SAÍDA (8): pernas (UNIDADE: LEG) e trades (UNIDADE: TRADE) lado a lado; valores = oráculo; MIXED só no lado trade; 5 buckets sempre presentes", () => {
  const a = exitReasonAnalysis(CT, OB)
  assert.equal(a.legs.unit, "LEG")
  assert.equal(a.trades.unit, "TRADE")
  assert.deepEqual([...a.legs.rows.map((r) => r.reason)].sort(), [...REASONS].sort())
  assert.equal(a.legs.rows.some((r) => (r.reason as string) === "MIXED"), false)
  assert.deepEqual(a.trades.rows.map((r) => r.bucket), ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])
  for (const r of REASONS) {
    const row = a.legs.rows.find((x) => x.reason === r)!
    assert.equal(row.legs, nLegs(r), `${r} pernas`)
    assert.equal(row.net.value, legCents(r) / 100, `${r} líquido da perna`)
  }
  assert.equal(a.legs.total.legs, CY.reduce((a2, c) => a2 + c.legs.length, 0))
  // lado trade: MIXED tem trades e P&L de TRADE (inteiro), diferente do que as pernas dizem
  const mixed = a.trades.rows.find((r) => r.bucket === "MIXED")!
  assert.equal(mixed.trades, 3) // c4, c6 e c8 (c7 só tem saídas desconhecidas ⇒ UNKNOWN)
  assert.equal(a.trades.rows.reduce((s, r) => s + r.trades, 0), CY.length)
  assert.equal(a.trades.total.net.value, calculateMetrics(CT, OB).metrics.netPnl.value)
  // pernas × trades: o líquido do bucket MIXED (trade) NÃO é atribuído a nenhum motivo de perna
  const legSum = a.legs.rows.reduce((s, r) => s + (r.net.value as number) * 100, 0)
  assert.equal(Math.round(legSum), Math.round((a.legs.total.net.value as number) * 100))
  assert.equal(Math.round(legSum), Math.round((a.trades.total.net.value as number) * 100))
  assert.equal(a.reconciliation.status, "FULL")
})

test("UNKNOWN e MIXED (4): preservados em ranking de grupos, em buckets e em pernas; aparecem em listagem, contagem e confiança — nunca removidos para 'melhorar' o ranking", () => {
  const r = rankGroups(CT, { groupBy: "exitReason", ...OB })
  assert.deepEqual(r.rows.map((x) => x.key.key[0]).sort(), ["MANUAL", "MIXED", "STOP", "TARGET", "UNKNOWN"])
  assert.equal(r.rows.reduce((s, x) => s + x.sampleSize, 0), CY.length)
  const unk = r.rows.find((x) => x.key.key[0] === "UNKNOWN")!
  const mix = r.rows.find((x) => x.key.key[0] === "MIXED")!
  assert.ok(unk.sampleSize >= 1 && mix.sampleSize >= 1)
  assert.equal(mix.key.label, "Misto (motivos diferentes)")
  assert.equal(r.rows.some((x) => x.rank !== null && x.sampleFlag === "TINY"), false)
  // contexto de saída por grupo (unidade: trades e pernas, separadas)
  assert.equal(mix.exit.tradesByBucket.MIXED, mix.sampleSize)
  assert.ok(mix.exit.mixedTradesShare === 1)
  const a = exitReasonAnalysis(CT, OB)
  const uRow = a.legs.rows.find((x) => x.reason === "UNKNOWN")!
  assert.ok(uRow.limitations.includes("UNKNOWN_EXIT_REASON"))
  assert.ok(a.legs.rows.find((x) => x.reason === "STOP")!.limitations.includes("UNKNOWN_EXIT_REASON"), "a parcela UNKNOWN rebaixa a leitura dos motivos conhecidos")
  assert.equal(a.reconciliation.unknownLegs, nLegs("UNKNOWN"))
  assert.equal(a.reconciliation.unknownLegsShare, Math.round((nLegs("UNKNOWN") / a.legs.total.legs) * 1e4) / 1e4)
  // sem desconhecidos ⇒ a limitação some
  const clean = exitReasonAnalysis(CT.filter((t) => !t.trade.exitLegs!.some((l) => l.reason === "UNKNOWN")), OB)
  assert.equal(clean.legs.rows.every((x) => !x.limitations.includes("UNKNOWN_EXIT_REASON")), true)
})

test("STOP × TARGET (perguntas 1–2): comparação por perna (US$) e por trade (R só com stop informado); deltas exatos; contribuição ao líquido; ranking por líquido das pernas", () => {
  const a = exitReasonAnalysis(CT, OB)
  const c = compareExitReasons(a, "STOP", "TARGET")
  assert.equal(c.unit, "LEG")
  assert.equal(c.kind, "EXIT_REASON_COMPARISON")
  const m = Object.fromEntries(c.metrics.map((x) => [x.metric, x]))
  assert.equal(m.netPnl.a.value, legCents("STOP") / 100)
  assert.equal(m.netPnl.b.value, legCents("TARGET") / 100)
  assert.equal(m.netPnl.delta, (legCents("TARGET") - legCents("STOP")) / 100)
  assert.equal(m.legs.a.value, nLegs("STOP"))
  assert.equal(c.inference, "DESCRIPTIVE_ONLY")
  assert.equal(c.sampleAdequate, true) // 5 pernas de cada lado, minSample 5
  const strict = compareExitReasons(exitReasonAnalysis(CT, { ...OB, minSample: 6 }), "STOP", "TARGET")
  assert.deepEqual([strict.sampleAdequate, strict.a.sampleFlag, strict.metrics.find((x) => x.metric === "netPnl")!.conclusive], [false, "LOW", false])
  // ranking dos motivos pelo líquido das pernas (ASC: maior perda primeiro)
  const asc = exitReasonAnalysis(CT, { ...OB, order: "ASC" })
  const ranked = asc.legs.rows.filter((r) => r.rank !== null)
  assert.deepEqual(ranked.map((r) => r.net.value), [...ranked.map((r) => r.net.value as number)].sort((x, y) => x - y))
  const contrib = a.legs.rows.reduce((s, r) => s + (r.contributionToLegNet.value ?? 0), 0)
  assert.ok(Math.abs(contrib - 1) < 1e-3)
  // pergunta 5: R por bucket de TRADE — as linhas sintéticas não têm stop ⇒ R indisponível, dito (não inferido)
  const t = compareTradeBuckets(a, "STOP", "TARGET")
  assert.equal(t.unit, "TRADE")
  const r = t.metrics.find((x) => x.metric === "averageR")!
  assert.deepEqual([r.a.available, r.b.available, r.delta], [false, false, null])
  assert.ok(r.a.reason)
  // com R conhecido (stop informado), o comparativo existe e herda a cobertura
  const withStops = CT.map((x, i) => ({ ...x, trade: { ...clone(x.trade), r: { net: i % 2 ? -1 : 2, netReason: null, points: null }, risk: { ...clone(x.trade.risk), reason: null } } as Any }))
  const a2 = exitReasonAnalysis(withStops as AnalyticsTrade[], OB)
  const stopRow = a2.trades.rows.find((x) => x.bucket === "STOP")!
  assert.equal(stopRow.averageR.available, true)
  assert.equal(stopRow.averageR.coverage.ratio, 1)
})

test("ONDE se perde nos stops (pergunta 6): pernas STOP por hora/conta; valores = oráculo; só pernas do motivo; denominador = pernas STOP dos grupos; recorte `where`", () => {
  const r = rankGroupsByExitLegs(CT, { groupBy: "hour", reason: "STOP", ...OB })
  assert.equal(r.unit, "LEG")
  assert.equal(r.reason, "STOP")
  const stopLegs = CY.flatMap((c) => c.legs.filter((l) => reasonOf(l.label) === "STOP").map((l) => ({ h: c.entryHour, l, c })))
  const net = (xs: typeof stopLegs) => xs.reduce((a, { l }) => a + cents((l.exitPrice - 2000) * 10 * (l.qty ?? 1)) - cents(2.4 * (l.qty ?? 1)), 0)
  for (const h of [9, 14]) {
    const row = r.rows.find((x) => x.key.key[0] === String(h).padStart(2, "0"))!
    assert.equal(row.legs, stopLegs.filter((x) => x.h === h).length)
    assert.equal(row.net.value, net(stopLegs.filter((x) => x.h === h)) / 100)
  }
  assert.equal(r.reasonTotal.legs, stopLegs.length)
  assert.equal(r.reasonTotal.net.value, net(stopLegs) / 100)
  const sum = r.rows.reduce((s, x) => s + (x.contributionToReasonNet.value ?? 0), 0)
  assert.ok(Math.abs(sum - 1) < 1e-3)
  assert.equal(r.rows[0].rank, 1) // ASC por padrão: a maior perda primeiro
  assert.ok((r.rows[0].net.value as number) <= (r.rows[1].net.value as number))
  const acc = rankGroupsByExitLegs(CT, { groupBy: ["account", "hour"], reason: "STOP", where: { account: "Sim101" }, ...OB })
  assert.ok(acc.rows.every((x) => x.key.key[0] === accountRef("Sim101")))
  assert.equal(J(acc).includes("Sim101"), false)
  assert.throws(() => rankGroupsByExitLegs(CT, { groupBy: "hour", reason: "MIXED" as never, ...OB }), /Motivo de perna inválido/)
  // cada linha leva a reconciliação do SEU subconjunto
  assert.ok(r.rows.every((x) => ["FULL", "PARTIAL", "DIVERGENT", "NO_LEGS"].includes(x.reconciliation.status)))
})

test("COBERTURA PARCIAL nas pernas (9): perna sem líquido fica fora da soma, com cobertura e limitação; nunca vira zero", () => {
  const ts = CT.map((x, i) => (i === 0 ? { ...x, trade: (() => { const t = clone(x.trade); t.exitLegs![1].pnl.net = null; t.exitLegs![1].pnl.gross = null; return t })() } : x))
  const a = exitReasonAnalysis(ts, OB)
  const row = a.legs.rows.find((r) => r.reason === "TARGET")!
  assert.equal(row.net.coverage.used, row.legs - 1)
  assert.ok(row.limitations.includes("COVERAGE_PARTIAL"))
  assert.equal(row.net.value, (legCents("TARGET") - cents((2008 - 2000) * 10) + cents(2.4)) / 100)
  assert.equal(a.reconciliation.status, "PARTIAL")
  assert.equal(row.contributionToLegNet.reason, "DENOMINATOR_PARTIAL_COVERAGE")
})

test("DIVERGÊNCIA perna×trade (10): estado DIVERGENT, confiança UNRELIABLE em todas as linhas de pernas; valores observados nas pernas ≠ valores do trade, lado a lado; nada é corrigido", () => {
  const base = exitReasonAnalysis(CT, OB)
  const ts = CT.map((x, i) => (i === 3 ? { ...x, trade: (() => { const t = clone(x.trade); t.exitLegs![0].pnl.net = (t.exitLegs![0].pnl.net as number) + 1; return t })() } : x))
  const a = exitReasonAnalysis(ts, OB)
  assert.equal(a.reconciliation.status, "DIVERGENT")
  assert.ok(a.reconciliation.divergentTotal >= 1)
  for (const r of a.legs.rows.filter((x) => x.legs > 0)) {
    assert.ok(r.limitations.includes("RECONCILIATION_DIVERGENT"), r.reason)
    assert.equal(r.confidence, "UNRELIABLE")
  }
  // o lado TRADE não muda (P&L do trade inteiro); o lado PERNA mostra o que a perna traz (+1,00)
  assert.deepEqual(a.trades.rows.map((r) => r.net.value), base.trades.rows.map((r) => r.net.value))
  assert.equal(a.legs.total.net.value, (base.legs.total.net.value as number) + 1)
  assert.ok(a.warnings.some((w) => w.code === "W_RECONCILIATION_DIVERGENT"))
  // o ranking por grupo carrega a divergência do subconjunto onde ela está
  const rg = rankGroupsByExitLegs(ts, { groupBy: "account", reason: "TARGET", ...OB })
  assert.ok(rg.rows.some((x) => x.reconciliation.status === "DIVERGENT"))
  assert.ok(rg.rows.some((x) => x.reconciliation.status !== "DIVERGENT") || rg.rows.length === 1)
  const c = compareExitReasons(a, "STOP", "TARGET")
  assert.ok(c.limitations.includes("RECONCILIATION_DIVERGENT"))
  assert.equal(c.confidence, "UNRELIABLE")
})

test("PRIVACIDADE (12, motivo de saída): nenhum rótulo de ordem (sourceLabel), conta, estratégia ou arquivo; só refs, índices e valores", () => {
  const all = [exitReasonAnalysis(CT, OB), rankGroups(CT, { groupBy: ["account", "exitReason"], ...OB }), rankGroupsByExitLegs(CT, { groupBy: "account", reason: "STOP", ...OB })]
  all.push(compareExitReasons(all[0] as Any, "STOP", "TARGET") as Any)
  for (const x of all) for (const s of ["Target1", "Target2", "Stop1", "Stop2", "Zerar", "Saida X", "sourceLabel", "Sim101", "Sim102", "Estrategia Teste", "e6-2.csv"]) assert.equal(J(x).includes(s), false, `vazou ${s}`)
})

test("DETERMINISMO (13, motivo de saída) e REGRESSÃO E6.0/E6.1 (14): resultado idêntico entre execuções/ordens; breakdown e buckets inalterados; hash do subconjunto = hash do grupo", () => {
  const a = J(exitReasonAnalysis(CT, OB))
  assert.equal(J(exitReasonAnalysis([...CT].reverse(), OB)), a)
  assert.equal(J(rankGroupsByExitLegs([...CT].reverse(), { groupBy: "hour", reason: "STOP", ...OB })), J(rankGroupsByExitLegs(CT, { groupBy: "hour", reason: "STOP", ...OB })))
  const bd = exitBreakdown(CT, OB)
  const an = exitReasonAnalysis(CT, OB)
  for (const r of REASONS) assert.equal(an.legs.rows.find((x) => x.reason === r)!.legSetHash, bd.byReason[r].legSetHash)
  assert.deepEqual(an.trades.rows.map((r) => r.trades), (["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"] as const).map((b) => bd.population.tradesByBucket[b]))
  const ag = aggregateTrades(CT, { groupBy: "exitReason", ...OB })
  const rk = rankGroups(CT, { groupBy: "exitReason", ...OB })
  for (const g of ag.groups) assert.equal(rk.rows.find((x) => x.key.key[0] === g.key[0])!.tradeSetHash, g.tradeSetHash)
  for (const [i, g] of ag.groups.entries()) {
    const ids = new Set(CT.filter((t) => exitBreakdown([t], OB).population.tradesByBucket[g.key[0] as "TARGET"] === 1).map((t) => t.id))
    assert.equal(ids.size, g.sampleSize, `grupo ${i}`)
    assert.equal(exitBreakdown(CT.filter((t) => ids.has(t.id)), OB).population.tradeSetHash, g.tradeSetHash)
  }
})

// ── fixtures reais LOCAIS ────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] rankings/comparações/motivo de saída reconciliam com o motor, preservam UNKNOWN/MIXED, sem nomes em claro`, () => {
    const text = readFileSync(join(DIR, name), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    const ts = toAnalyticsTrades(run.trades)
    const salt = (ctx as Any).accountRefSalt as string | undefined
    const plain = calculateMetrics(ts)
    const netCents = Math.round((plain.metrics.netPnl.value as number) * 100)
    const dims: Dimension[] = ["account", "hour", "dayOfWeek", "symbol", "session", "direction", "exitReason", "week"]
    const summary: Record<string, string> = {}
    for (const d of dims) {
      const r = rankGroups(ts, { groupBy: d, refSalt: salt })
      assert.equal(r.rows.reduce((s, x) => s + x.sampleSize, 0), run.trades.length, `${d}: Σ amostras`)
      assert.equal(r.rows.reduce((s, x) => s + Math.round((x.net.value ?? 0) * 100), 0), netCents, `${d}: Σ líquido = total`)
      assert.equal(r.population.tradeSetHash, plain.population.tradeSetHash)
      const ranked = r.rows.filter((x) => x.rank !== null)
      assert.deepEqual(ranked.map((x) => x.rank), ranked.map((_, i) => i + 1))
      assert.equal(r.rows.length, r.summary.groups)
      summary[d] = `${r.rows.length}g/${ranked.length}r`
    }
    const ex = rankGroups(ts, { groupBy: "exitReason", refSalt: salt })
    assert.ok(ex.rows.some((x) => ["UNKNOWN", "MIXED", "STOP", "TARGET", "MANUAL"].includes(x.key.key[0] as string)))
    // motivo de saída
    const a = exitReasonAnalysis(ts)
    const bd = exitBreakdown(ts)
    assert.equal(a.legs.total.legs, bd.total.legs)
    for (const r of REASONS) assert.equal(a.legs.rows.find((x) => x.reason === r)!.legs, bd.byReason[r].legs)
    assert.equal(a.trades.rows.reduce((s, r) => s + r.trades, 0), run.trades.length)
    assert.equal(a.reconciliation.divergentTotal, bd.reconciliation.divergentTotal)
    // perguntas 1–2/6 executam e carregam cobertura
    const cmp = compareExitReasons(a, "STOP", "TARGET")
    assert.equal(/NaN|Infinity/.test(J(cmp)), false)
    const where = rankGroupsByExitLegs(ts, { groupBy: ["direction", "hour"], reason: "STOP", refSalt: salt })
    assert.equal(where.reasonTotal.legs, bd.byReason.STOP.legs)
    // comparação entre as duas primeiras contas (se houver) usa ref
    const accs = rankGroups(ts, { groupBy: "account", refSalt: salt }).rows.filter((x) => !x.unknownGroup)
    const names2 = [...new Set(run.trades.map((t) => t.account.sourceName).filter((n): n is string => !!n))]
    if (names2.length >= 2) {
      const c = compareGroups(ts, { groupBy: "account", a: { account: names2[0] }, b: { account: names2[1] }, refSalt: salt })
      assert.equal(c.a.key!.key[0], accountRef(names2[0], salt ?? ""))
    }
    // período: primeira × segunda metade das datas (mesmo motor)
    const dates = [...new Set(plain.period.fromLocalDate ? [plain.period.fromLocalDate, plain.period.toLocalDate!] : [])]
    if (dates.length === 2 && dates[0] < dates[1]) {
      const p = comparePeriods(ts, { a: { from: dates[0], to: dates[0] }, b: { from: dates[1], to: dates[1] } })
      assert.equal(/NaN|Infinity/.test(J(p)), false)
    }
    // privacidade real: nenhum nome de conta/estratégia/rótulo de ordem
    const secrets = new Set<string>()
    for (const t of run.trades) {
      if (t.account.sourceName) secrets.add(t.account.sourceName.trim())
      if (t.labels.strategyName) secrets.add(t.labels.strategyName.trim())
      for (const l of t.exitLegs ?? []) if (l.sourceLabel && l.sourceLabel.trim().length >= 4) secrets.add(l.sourceLabel.trim())
    }
    const blob = J([rankGroups(ts, { groupBy: ["account", "strategy"], refSalt: salt }), rankGroups(ts, { groupBy: "account", refSalt: salt }), a, where, cmp])
    for (const s of secrets) assert.equal(blob.includes(s), false, "algo da origem vazou")
    void accs
    const dist = Object.fromEntries(a.trades.rows.map((r) => [r.bucket, r.trades]))
    console.log(`  → real: ${run.trades.length} ciclos · grupos/ranqueados ${JSON.stringify(summary)} · buckets ${J(dist)} · pernas UNKNOWN ${a.reconciliation.unknownLegs}/${a.legs.total.legs} · status ${a.reconciliation.status}`)
  })
}

console.log(`\n${passed} testes ok`)
