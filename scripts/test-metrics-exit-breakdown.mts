// E6.1 — exitBreakdown por PERNA de saída.   node scripts/test-metrics-exit-breakdown.mts
// Sintético versionado (pipeline real: CSV NT8 → ciclos → motor) com ORÁCULO independente (as contas saem das linhas do CSV, não do motor)
// + (se existirem) as fixtures reais LOCAIS, sem números embutidos e sem nada real no repositório.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade, ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainTrades } from "../src/lib/evidence/explain-trade.ts"
import { analyticsTradeFromEvidence } from "../src/lib/evidence/to-analytics.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { aggregateTrades, calculateMetrics, exitBreakdown, exitReasonOf, toAnalyticsTrades, type AnalyticsTrade, type ExitBreakdownResult } from "../src/lib/metrics/index.ts"
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
const cents = (x: number) => Math.round(x * 100)
const REASONS = ["TARGET", "STOP", "MANUAL", "UNKNOWN"] as const

// ── fixture: um ciclo por dia; cada linha = uma perna de saída (horários distintos) ──

interface LegDef { qty?: number; exitPrice: number; exitLabel: string; exitAt: string }
interface CycleDef { name: string; legs: LegDef[]; bucket: string; partial?: boolean }
const H = (day: number, hms: string) => `${String(day).padStart(2, "0")}/03/2026 ${hms}`
const CYCLES: CycleDef[] = [
  { name: "todas-target", legs: [{ exitPrice: 2004, exitLabel: "Target1", exitAt: "10:10:00" }, { exitPrice: 2008, exitLabel: "Target2", exitAt: "10:20:00" }], bucket: "TARGET" },
  { name: "todas-stop", legs: [{ exitPrice: 1996, exitLabel: "Stop1", exitAt: "10:10:00" }, { exitPrice: 1994, exitLabel: "Stop2", exitAt: "10:20:00" }], bucket: "STOP" },
  { name: "manual", legs: [{ exitPrice: 2001, exitLabel: "Zerar", exitAt: "10:10:00" }], bucket: "MANUAL" },
  { name: "target-e-stop", legs: [{ exitPrice: 2006, exitLabel: "Target1", exitAt: "10:10:00" }, { exitPrice: 1995, exitLabel: "Stop1", exitAt: "10:20:00" }], bucket: "MIXED" },
  { name: "conhecido-e-desconhecido", legs: [{ exitPrice: 2004, exitLabel: "Target1", exitAt: "10:10:00" }, { exitPrice: 2002, exitLabel: "Saida X", exitAt: "10:20:00" }], bucket: "MIXED", partial: true },
  { name: "tudo-desconhecido", legs: [{ exitPrice: 2002, exitLabel: "Saida X", exitAt: "10:10:00" }, { exitPrice: 1999, exitLabel: "", exitAt: "10:20:00" }], bucket: "UNKNOWN" },
  { name: "quantidades-diferentes", legs: [{ qty: 3, exitPrice: 2005, exitLabel: "Target1", exitAt: "10:10:00" }, { qty: 2, exitPrice: 1997, exitLabel: "Stop1", exitAt: "10:20:00" }, { qty: 1, exitPrice: 2001, exitLabel: "Zerar", exitAt: "10:30:00" }], bucket: "MIXED" },
]
// o ciclo "entra" com a soma das quantidades de uma vez; cada linha é um lote com a quantidade da perna
const rowsOf = (): SynthRow[] =>
  CYCLES.flatMap((c, i) => c.legs.map((l) => ({ qty: l.qty ?? 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: H(2 + i, "09:00:00"), exitAt: H(2 + i, l.exitAt), exitLabel: l.exitLabel })))
const CSV = synthCsv(rowsOf())

// oráculo: contas das linhas do CSV (mesma fórmula do gerador: bruto = Δpreço × 10 × qtd; comissão = 2,4 × qtd; líquido = bruto − comissão)
const reasonOfLabel = (l: string): (typeof REASONS)[number] => (/^target/i.test(l) ? "TARGET" : /^stop/i.test(l) ? "STOP" : /^zerar/i.test(l) ? "MANUAL" : "UNKNOWN")
interface Oracle { reason: (typeof REASONS)[number]; qty: number; gross: number; comm: number; net: number }
const ORACLE: Oracle[][] = CYCLES.map((c) =>
  c.legs.map((l) => {
    const qty = l.qty ?? 1
    const gross = cents((l.exitPrice - 2000) * 10 * qty)
    const comm = cents(2.4 * qty)
    return { reason: reasonOfLabel(l.exitLabel), qty, gross, comm, net: gross - comm }
  }),
)
const expected = (r: (typeof REASONS)[number]) => {
  const xs = ORACLE.flat().filter((o) => o.reason === r)
  return { legs: xs.length, qty: xs.reduce((a, o) => a + o.qty, 0), gross: xs.reduce((a, o) => a + o.gross, 0), comm: xs.reduce((a, o) => a + o.comm, 0), net: xs.reduce((a, o) => a + o.net, 0) }
}

const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "e6-1.csv" })
const rec = imp.importRecord as ImportRecord
const trades: AnalyticsTrade[] = toAnalyticsTrades(imp.trades)
const run = (ts: AnalyticsTrade[] = trades, args: Parameters<typeof exitBreakdown>[1] = {}) => exitBreakdown(ts, { timeZone: BRT, ...args })
const bd = run()

test("FIXTURE: 7 ciclos, 14 pernas, buckets por trade (E6.0) como no oráculo; cada linha do CSV vira UMA perna", () => {
  assert.equal(imp.trades.length, CYCLES.length)
  assert.deepEqual(imp.trades.map((t) => t.exitLegs!.length), CYCLES.map((c) => c.legs.length))
  assert.deepEqual(imp.trades.map((t) => exitReasonOf(t).bucket), CYCLES.map((c) => c.bucket))
  assert.deepEqual(imp.trades.map((t) => exitReasonOf(t).partial), CYCLES.map((c) => c.partial ?? false))
  assert.equal(bd.total.legs, ORACLE.flat().length)
})

test("MOTIVOS POR PERNA (1–7): TARGET/STOP/MANUAL/UNKNOWN com quantidade, bruto, comissão e líquido IGUAIS ao oráculo das linhas; MIXED não existe por perna", () => {
  assert.deepEqual(Object.keys(bd.byReason), [...REASONS])
  for (const r of REASONS) {
    const e = expected(r)
    const g = bd.byReason[r]
    assert.equal(g.legs, e.legs, `${r}: pernas`)
    assert.equal(g.quantity, e.qty, `${r}: quantidade`)
    assert.equal(g.gross.cents, e.legs ? e.gross : null, `${r}: bruto`)
    assert.equal(g.commission.cents, e.legs ? e.comm : null, `${r}: comissão`)
    assert.equal(g.net.cents, e.legs ? e.net : null, `${r}: líquido`)
    assert.equal(g.fees.cents, e.legs ? 0 : null, `${r}: taxas (0 vindo da linha, conhecido) `)
    assert.equal(g.net.legsKnown, e.legs)
    assert.equal(g.net.legsUnavailable, 0)
  }
  assert.ok(bd.byReason.TARGET.legs > 0 && bd.byReason.STOP.legs > 0 && bd.byReason.MANUAL.legs > 0 && bd.byReason.UNKNOWN.legs > 0)
  assert.equal("MIXED" in bd.byReason, false)
})

test("SEM ATRIBUIR O TRADE INTEIRO A UM MOTIVO: 'target-e-stop' separa o resultado de cada saída; o bucket MIXED do trade não recebe P&L de perna", () => {
  const ix = CYCLES.findIndex((c) => c.name === "target-e-stop")
  const t = imp.trades[ix]
  const [tg, st] = ORACLE[ix]
  assert.equal(cents(t.pnl.net!), tg.net + st.net)
  const only = run([trades[ix]])
  assert.equal(only.byReason.TARGET.net.cents, tg.net)
  assert.equal(only.byReason.STOP.net.cents, st.net)
  assert.equal(only.byReason.MANUAL.net.cents, null)
  assert.equal(only.total.net.cents, tg.net + st.net)
  assert.deepEqual([only.byReason.TARGET.legsInMixedTrades, only.byReason.STOP.legsInMixedTrades], [1, 1])
  assert.deepEqual(only.population.tradesByBucket, { TARGET: 0, STOP: 0, MANUAL: 0, MIXED: 1, UNKNOWN: 0 })
})

test("CONHECIDO + DESCONHECIDO (5): a perna desconhecida NÃO é descartada nem vira target; fica em UNKNOWN e o trade segue MIXED+partial", () => {
  const ix = CYCLES.findIndex((c) => c.name === "conhecido-e-desconhecido")
  const only = run([trades[ix]])
  assert.equal(only.byReason.TARGET.legs, 1)
  assert.equal(only.byReason.UNKNOWN.legs, 1)
  assert.equal(only.byReason.UNKNOWN.net.cents, ORACLE[ix][1].net)
  assert.equal(only.byReason.UNKNOWN.legsInPartialTrades, 1)
  assert.equal(only.byReason.TARGET.legsInPartialTrades, 1)
  assert.equal(only.byReason.UNKNOWN.byRule.NONE, 1)
  assert.equal(only.byReason.TARGET.byRule.LABEL_RULE, 1)
  assert.ok(only.warnings.some((w) => w.code === "W_UNKNOWN_REASON_SHARE"))
})

test("TRADE INTEIRAMENTE DESCONHECIDO (6): tudo em UNKNOWN; 'desconhecido' ≠ 'sem stop' (nenhum campo diz que não houve stop)", () => {
  const ix = CYCLES.findIndex((c) => c.name === "tudo-desconhecido")
  const only = run([trades[ix]])
  assert.deepEqual(REASONS.map((r) => only.byReason[r].legs), [0, 0, 0, 2])
  assert.equal(only.byReason.UNKNOWN.net.cents, ORACLE[ix].reduce((a, o) => a + o.net, 0))
  assert.equal(only.byReason.STOP.net.cents, null) // sem pernas STOP = sem valor, não "0 em stops"
  assert.equal(only.byReason.STOP.contributionToNet, null)
  assert.equal(JSON.stringify(only).includes("noStop"), false)
})

test("QUANTIDADES DIFERENTES (7): 3×alvo, 2×stop, 1×manual — quantidade e valor por perna exatos; a quantidade das pernas fecha com a do trade", () => {
  const ix = CYCLES.findIndex((c) => c.name === "quantidades-diferentes")
  const only = run([trades[ix]])
  assert.deepEqual([only.byReason.TARGET.quantity, only.byReason.STOP.quantity, only.byReason.MANUAL.quantity], [3, 2, 1])
  assert.equal(only.total.quantity, imp.trades[ix].quantity)
  assert.equal(only.reconciliation.quantity.divergent, 0)
  assert.deepEqual([only.byReason.TARGET.net.cents, only.byReason.STOP.net.cents, only.byReason.MANUAL.net.cents], ORACLE[ix].map((o) => o.net))
})

test("COMISSÃO E TAXAS (8): vêm da linha, por perna, sem alocação nossa; Σ por motivo = oráculo; taxas conhecidas (0) não viram 'indisponível'", () => {
  for (const r of REASONS) assert.equal(bd.byReason[r].commission.cents, expected(r).comm)
  assert.equal(bd.total.commission.cents, ORACLE.flat().reduce((a, o) => a + o.comm, 0))
  assert.equal(bd.total.fees.cents, 0)
  assert.equal(bd.total.fees.legsUnavailable, 0)
})

// ── valores ausentes, divergência ────────────────────────────────────────────

const withLegs = (mut: (t: CanonicalTrade, i: number) => void, only?: number[]): AnalyticsTrade[] =>
  trades.map((a, i) => {
    if (only && !only.includes(i)) return a
    const t = clone(a.trade)
    mut(t, i)
    return { ...a, trade: t }
  })

test("P&L AUSENTE (9): perna sem net/gross fica FORA da soma, com cobertura; nunca vira zero; reconciliação marca NOT_COMPARABLE; aviso W_VALUE_UNAVAILABLE", () => {
  const ix = CYCLES.findIndex((c) => c.name === "todas-target")
  const ts = withLegs((t) => { t.exitLegs![1].pnl.net = null; t.exitLegs![1].pnl.gross = null }, [ix])
  const r = run(ts)
  assert.equal(r.byReason.TARGET.net.legsUnavailable, 1)
  assert.equal(r.byReason.TARGET.net.legsKnown, expected("TARGET").legs - 1)
  assert.equal(r.byReason.TARGET.net.cents, expected("TARGET").net - ORACLE[ix][1].net, "só as pernas conhecidas; a ausente NÃO entra como 0")
  assert.equal(r.byReason.TARGET.gross.legsUnavailable, 1)
  assert.equal(r.byReason.TARGET.contributionToNet, null, "total incompleto ⇒ sem fração do todo")
  assert.equal(r.reconciliation.fields.net.notComparable.LEG_VALUE_MISSING, 1)
  assert.ok(r.warnings.some((w) => w.code === "W_VALUE_UNAVAILABLE"))
  assert.equal(r.reconciliation.fields.net.divergent, 0, "ausente não é divergência")
  // só motivo sem NENHUM valor: null (e não 0)
  const none = withLegs((t) => { for (const l of t.exitLegs!) { l.pnl.net = null; l.pnl.gross = null; l.pnl.commission = null; l.pnl.fees = null } })
  const rn = run(none)
  for (const f of ["net", "gross", "commission", "fees"] as const) assert.deepEqual([rn.total[f].cents, rn.total[f].value, rn.total[f].legsKnown], [null, null, 0])
  assert.equal(rn.byReason.TARGET.averageNet, null)
})

test("BASE DESCONHECIDA no trade: net/gross das pernas NÃO são afirmados (a base só existe no trade); comissão/taxas continuam; reconciliação diz BASIS_UNKNOWN", () => {
  const ix = CYCLES.findIndex((c) => c.name === "manual")
  const ts = withLegs((t) => { t.pnl.basis = "UNKNOWN"; t.pnl.net = null; t.pnl.gross = null }, [ix])
  const r = run([ts[ix]])
  assert.equal(r.byReason.MANUAL.net.legsKnown, 0)
  assert.equal(r.byReason.MANUAL.net.legsUnavailable, 1)
  assert.equal(r.byReason.MANUAL.net.cents, null)
  assert.equal(r.byReason.MANUAL.commission.cents, ORACLE[ix][0].comm)
  assert.equal(r.reconciliation.fields.net.notComparable.BASIS_UNKNOWN, 1)
  assert.equal(r.reconciliation.fields.commission.divergent, 0)
})

test("DIVERGÊNCIA (10): soma das pernas ≠ total do trade ⇒ MOSTRADA (campo, trade, diferença em centavos), contada e avisada — nunca forçada; quantidade também", () => {
  const ix = CYCLES.findIndex((c) => c.name === "target-e-stop")
  const ts = withLegs((t) => { t.exitLegs![0].pnl.net = (t.exitLegs![0].pnl.net as number) + 1; t.exitLegs![1].quantity += 0.5 }, [ix])
  const r = run(ts)
  assert.equal(r.reconciliation.fields.net.divergent, 1)
  assert.equal(r.reconciliation.quantity.divergent, 1)
  assert.equal(r.reconciliation.divergentTotal, 2)
  const d = r.reconciliation.divergences.find((x) => x.field === "net")!
  assert.deepEqual([d.tradeId, d.diffScaled], [trades[ix].id, 100])
  assert.equal(d.legsScaled - d.tradeScaled, 100)
  assert.ok(r.warnings.some((w) => w.code === "W_RECONCILIATION_DIVERGENT"))
  // os números das pernas são os que a perna traz (não "corrigidos" para fechar com o trade)
  assert.equal(r.byReason.TARGET.net.cents, expected("TARGET").net + 100)
  // os outros trades continuam conciliados
  assert.equal(r.reconciliation.fields.net.reconciled, CYCLES.length - 1)
})

// ── rastreabilidade, privacidade ─────────────────────────────────────────────

test("REFERÊNCIAS (11): cada perna aponta tradeId + legIndex + rowNos (≠ CSV inteiro); legSetHash muda se uma linha de origem, um rowHash ou um valor muda", () => {
  for (const r of REASONS) {
    for (const ref of bd.byReason[r].legRefs!) {
      const t = imp.trades.find((x) => x.tradeId === ref.tradeId)!
      const leg = t.exitLegs![ref.legIndex]
      assert.equal(leg.reason, r)
      assert.deepEqual(ref.rowNos, [...leg.rowRefs].sort((a, b) => a - b))
      assert.deepEqual(Object.keys(ref).sort(), ["legIndex", "rowNos", "tradeId"])
    }
  }
  assert.equal(bd.total.legRefs!.length, bd.total.legs)
  assert.deepEqual(bd.total.legRefs!.map((x) => [x.tradeId, x.legIndex]), [...bd.total.legRefs!].sort((a, b) => (a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : a.legIndex - b.legIndex)).map((x) => [x.tradeId, x.legIndex]))
  // hash
  const h0 = bd.total.legSetHash
  assert.notEqual(run(withLegs((t) => { t.sourceRows![0].rowHash = "x".repeat(64) }, [0])).total.legSetHash, h0)
  assert.notEqual(run(withLegs((t) => { t.exitLegs![0].rowRefs = [999] }, [0])).total.legSetHash, h0)
  assert.notEqual(run(withLegs((t) => { t.exitLegs![0].pnl.commission = 9.99 }, [0])).total.legSetHash, h0)
  assert.notEqual(run(withLegs((t) => { t.exitLegs![0].reason = "MANUAL" }, [0])).total.legSetHash, h0)
  // acima do limite: só o hash
  const lim = run(trades, { tradeIdsLimit: 3 })
  assert.equal(lim.total.legRefs, null)
  assert.equal(lim.total.legSetHash, h0)
  assert.equal(lim.population.tradeIds, null)
})

test("PRIVACIDADE (12): nenhum rótulo de origem (sourceLabel), nome de conta ou de estratégia no resultado; só ids, índices, rowNos e valores", () => {
  const j = JSON.stringify(bd)
  for (const forbidden of ["Target1", "Target2", "Stop1", "Stop2", "Zerar", "Saida X", "sourceLabel", "Sim101", "Estrategia Teste", "e6-1.csv"]) assert.equal(j.includes(forbidden), false, `vazou: ${forbidden}`)
  // mesmo com rótulo "sensível" na origem
  const secret = runImportPipeline(synthCsv([{ entryPrice: 2000, exitPrice: 2004, entryAt: H(2, "09:00:00"), exitAt: H(2, "10:00:00"), exitLabel: "Segredo do Joao" }]), { sourceTz: BRT })
  const r = run(toAnalyticsTrades(secret.trades))
  assert.equal(JSON.stringify(r).includes("Segredo"), false)
  assert.equal(r.byReason.UNKNOWN.legs, 1)
})

test("EVIDENCE: o breakdown feito a partir da Evidence (TradeEvidence → motor) é IDÊNTICO ao do Canonical (mesmos valores, refs, hashes) — reproduzível", () => {
  const ev = explainTrades(imp.trades, rec)
  const probes = ev.map((e) => {
    assert.equal(e.ok, true)
    return analyticsTradeFromEvidence((e as Any).tradeEvidence)
  })
  const fromEv = run(probes)
  assert.equal(JSON.stringify(fromEv), JSON.stringify(bd))
  // e nada do que a Evidence esconde (conta/estratégia/rótulos) é necessário para o resultado
  assert.equal(JSON.stringify(fromEv).includes("Estrategia Teste"), false)
})

// ── determinismo, regressão E6.0, reconciliação ──────────────────────────────

test("DETERMINISMO (13): mesma entrada ⇒ JSON idêntico; ordem de chegada dos trades não altera nada", () => {
  assert.equal(JSON.stringify(run()), JSON.stringify(bd))
  assert.equal(JSON.stringify(run([...trades].reverse())), JSON.stringify(bd))
})

test("REGRESSÃO E6.0 (14): buckets por trade batem com a dimensão exitReason; tradeSetHash/população = os do motor; métricas do total intactas", () => {
  const ag = aggregateTrades(trades, { groupBy: "exitReason", timeZone: BRT })
  const counts = Object.fromEntries(ag.groups.map((g) => [g.key[0], g.sampleSize]))
  for (const [k, n] of Object.entries(bd.population.tradesByBucket)) assert.equal(counts[k] ?? 0, n, `bucket ${k}`)
  const plain = calculateMetrics(trades, { timeZone: BRT })
  assert.equal(bd.population.tradeSetHash, plain.population.tradeSetHash)
  assert.equal(bd.population.afterFilters, plain.population.afterFilters)
  assert.deepEqual(bd.population.tradeIds, plain.population.tradeIds)
  assert.deepEqual(ag.total.metrics, plain.metrics)
  // regra do E6.0 intacta no mesmo input
  assert.deepEqual(imp.trades.map((t) => exitReasonOf(t).bucket), CYCLES.map((c) => c.bucket))
})

test("RECONCILIAÇÃO SEM DUPLA CONTAGEM (15): Σ motivos = total; cada linha de origem em UMA perna; Σ líquido das pernas = Σ líquido dos trades = netPnl do motor; tudo CONCILIADO", () => {
  for (const f of ["net", "gross", "commission", "fees"] as const) {
    assert.equal(REASONS.reduce((a, r) => a + (bd.byReason[r][f].cents ?? 0), 0), bd.total[f].cents, `Σ ${f}`)
    assert.equal(REASONS.reduce((a, r) => a + bd.byReason[r][f].legsKnown, 0), bd.total[f].legsKnown)
  }
  assert.equal(REASONS.reduce((a, r) => a + bd.byReason[r].legs, 0), bd.total.legs)
  assert.equal(REASONS.reduce((a, r) => a + bd.byReason[r].quantity, 0), bd.total.quantity)
  const f = bd.reconciliation.fields
  for (const k of ["net", "gross", "commission", "fees"] as const) assert.deepEqual([f[k].reconciled, f[k].divergent], [CYCLES.length, 0], k)
  assert.equal(bd.reconciliation.divergentTotal, 0)
  assert.deepEqual(bd.reconciliation.rows, { duplicatedRowRefs: 0, uncoveredSourceRows: 0, tradesChecked: CYCLES.length })
  // contra o motor INDEPENDENTE (calculateMetrics): Σ das pernas = netPnl total
  const plain = calculateMetrics(trades, { timeZone: BRT })
  assert.equal(bd.total.net.cents, cents(plain.metrics.netPnl.value as number))
  assert.equal(f.net.legsCents, f.net.tradeCents)
  // contribuição: Σ frações = 1 quando completo
  const sumContrib = REASONS.reduce((a, r) => a + (bd.byReason[r].contributionToNet ?? 0), 0)
  assert.ok(Math.abs(sumContrib - 1) < 1e-3, `Σ contribuições = ${sumContrib}`)
  assert.equal(bd.warnings.some((w) => w.code === "W_RECONCILIATION_DIVERGENT" || w.code === "W_ROW_REFS_INCONSISTENT"), false)
  // dupla contagem detectada se a mesma linha estiver em duas pernas
  const dup = run(withLegs((t) => { t.exitLegs![1].rowRefs = [...t.exitLegs![0].rowRefs] }, [0]))
  assert.equal(dup.reconciliation.rows.duplicatedRowRefs, 1)
  assert.ok(dup.warnings.some((w) => w.code === "W_ROW_REFS_INCONSISTENT"))
})

test("VAZIO E FILTROS: população vazia ⇒ tudo null/0 sem erro; filtro exitReason restringe aos trades do bucket; trade-linha fica fora e é CONTADO", () => {
  const empty = run([])
  assert.equal(empty.total.legs, 0)
  assert.equal(empty.total.net.cents, null)
  assert.equal(empty.population.tradesWithLegs, 0)
  const mixed = run(trades, { filters: { exitReason: "MIXED" } })
  assert.equal(mixed.population.afterFilters, CYCLES.filter((c) => c.bucket === "MIXED").length)
  assert.equal(mixed.total.legs, CYCLES.filter((c) => c.bucket === "MIXED").reduce((a, c) => a + c.legs.length, 0))
  const flat = runImportPipeline(CSV, { sourceTz: BRT, reconstructCycles: false })
  const r = run(toAnalyticsTrades(flat.trades))
  assert.deepEqual([r.total.legs, r.population.tradesWithLegs, r.population.tradesWithoutLegs], [0, 0, flat.trades.length])
  assert.ok(r.warnings.some((w) => w.code === "W_TRADES_WITHOUT_LEGS"))
  assert.deepEqual(r.population.tradesByBucket, { TARGET: 0, STOP: 0, MANUAL: 0, MIXED: 0, UNKNOWN: flat.trades.length })
})

test("MAPA DO USUÁRIO: o mesmo rótulo desconhecido mapeado move a perna de UNKNOWN para o motivo mapeado (byRule USER_MAP); sem inventar mapa nas fixtures", () => {
  const mapped = runImportPipeline(CSV, { sourceTz: BRT, exitReasonMap: [{ pattern: "^saida x", reason: "MANUAL" }] })
  const r = run(toAnalyticsTrades(mapped.trades))
  assert.equal(r.byReason.MANUAL.byRule.USER_MAP, 2)
  assert.equal(r.byReason.UNKNOWN.legs, bd.byReason.UNKNOWN.legs - 2)
  assert.equal(r.total.net.cents, bd.total.net.cents)
})

// ── fixtures reais LOCAIS ────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] breakdown reconcilia com o motor e com os totais do trade; refs e privacidade ok; UNKNOWN preservado (sem mapa inventado)`, () => {
    const text = readFileSync(join(DIR, name), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const imported = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    const ts = toAnalyticsTrades(imported.trades)
    const r: ExitBreakdownResult = exitBreakdown(ts)
    const plain = calculateMetrics(ts)
    assert.equal(r.population.tradeSetHash, plain.population.tradeSetHash)
    assert.equal(r.total.legs, imported.trades.reduce((a, t) => a + (t.exitLegs?.length ?? 0), 0))
    assert.equal(REASONS.reduce((a, k) => a + r.byReason[k].legs, 0), r.total.legs)
    for (const f of ["net", "gross", "commission", "fees"] as const) assert.equal(REASONS.reduce((a, k) => a + (r.byReason[k][f].cents ?? 0), 0), r.total[f].cents ?? 0, `Σ ${f}`)
    // Σ líquido das pernas = netPnl do motor (todos os ciclos têm pernas e líquido conhecido nas fixtures atuais; senão a cobertura diz)
    if (r.total.net.legsUnavailable === 0 && plain.metrics.netPnl.coverage.ratio === 1) assert.equal(r.total.net.cents, cents(plain.metrics.netPnl.value as number))
    assert.equal(r.reconciliation.divergentTotal, 0, `divergências: ${JSON.stringify(r.reconciliation.divergences.map((d) => [d.field, d.diffScaled]))}`)
    assert.deepEqual([r.reconciliation.rows.duplicatedRowRefs, r.reconciliation.rows.uncoveredSourceRows], [0, 0])
    // referências batem com as pernas reais
    for (const k of REASONS) for (const ref of r.byReason[k].legRefs ?? []) assert.equal(imported.trades.find((t) => t.tradeId === ref.tradeId)!.exitLegs![ref.legIndex].reason, k)
    // privacidade: nenhum rótulo/conta/estratégia do arquivo real
    const j = JSON.stringify(r)
    const secrets = new Set<string>()
    for (const t of imported.trades) {
      if (t.account.sourceName) secrets.add(t.account.sourceName.trim())
      if (t.labels.strategyName) secrets.add(t.labels.strategyName.trim())
      for (const l of t.exitLegs ?? []) if (l.sourceLabel && l.sourceLabel.trim().length >= 4) secrets.add(l.sourceLabel.trim())
    }
    for (const s of secrets) assert.equal(j.includes(s), false, "algo da origem vazou")
    // Evidence → mesmo breakdown
    const salt = (ctx as Any).accountRefSalt as string | undefined
    const ev = explainTrades(imported.trades, imported.importRecord as ImportRecord, { accountRefSalt: salt })
    assert.ok(ev.every((e) => e.ok))
    assert.equal(JSON.stringify(exitBreakdown(ev.map((e) => analyticsTradeFromEvidence((e as Any).tradeEvidence)))), JSON.stringify(r))
    const dist = Object.fromEntries(REASONS.map((k) => [k, r.byReason[k].legs]))
    console.log(`  → real: ${imported.trades.length} ciclos · ${r.total.legs} pernas ${JSON.stringify(dist)} · net conhecido em ${r.total.net.legsKnown}/${r.total.legs} · divergências ${r.reconciliation.divergentTotal} · avisos ${r.warnings.map((w) => w.code).join(",") || "—"}`)
  })
}

console.log(`\n${passed} testes ok`)
