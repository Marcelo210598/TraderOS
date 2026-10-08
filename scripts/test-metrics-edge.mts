// Casos de borda, dados insuficientes, instrumentos, precisão, outliers, metadados de evidência e integração com o
// pipeline de importação: node scripts/test-metrics-edge.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  METRIC_CATALOG,
  METRIC_IDS,
  MetricsInputError,
  toAnalyticsTrades,
  type MetricsResult,
} from "../src/lib/metrics/index.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { aggregateTrades, calculateMetrics, BRT, clean, mk, ten, val } from "./_metrics-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const codes = (r: MetricsResult) => r.warnings.map((w) => w.code)
const reason = (r: MetricsResult, m: string) => r.metrics[m].reason
const perReason = (r: MetricsResult) => r.dataQuality.r.unknownByReason

// trade simples: 10 pontos a favor (MNQ ⇒ US$ 20 bruto), sem custos ⇒ líquido = bruto
const win = (id: string, o: Partial<Parameters<typeof mk>[0]> = {}) =>
  mk({ id, direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00", commission: 0, fees: 0, ...o })
const loss = (id: string, o: Partial<Parameters<typeof mk>[0]> = {}) =>
  mk({ id, direction: "LONG", entry: 110, exit: 100, entryAt: "2026-01-12 10:35:00", exitAt: "2026-01-12 10:50:00", commission: 0, fees: 0, ...o })

// ── zero / um trade ──────────────────────────────────────────────────────────

test("ZERO trades: não quebra; tudo indisponível (null) com motivo; aviso W_NO_TRADES; qualidade EMPTY", () => {
  const r = calculateMetrics([])
  assert.equal(val(r, "totalTrades"), 0)
  for (const id of METRIC_IDS) {
    if (id === "totalTrades") continue
    const m = r.metrics[id]
    assert.equal(m.available, id === "classifiedTrades" ? true : false, id) // classifiedTrades = 0 é um 0 verdadeiro
  }
  assert.equal(val(r, "classifiedTrades"), 0)
  assert.equal(val(r, "winRate"), null)
  assert.equal(reason(r, "winRate"), "NO_PNL_DATA")
  assert.deepEqual(codes(r), ["W_NO_TRADES"])
  assert.equal(r.dataQuality.level, "EMPTY")
  assert.deepEqual(r.period, { fromLocalDate: null, toLocalDate: null, fromInstantUtc: null, toInstantUtc: null })
  assert.deepEqual(r.population.tradeIds, [])
  assert.deepEqual(aggregateTrades([], { groupBy: "hour" }).groups, [])
})

test("UM trade vencedor: win rate 100%, sem perdedor ⇒ profit factor INDISPONÍVEL (não infinito), drawdown 0", () => {
  const r = calculateMetrics([win("a")])
  assert.deepEqual(["totalTrades", "winners", "losers", "winRate", "netPnl", "averageTrade"].map((m) => val(r, m)), [1, 1, 0, 100, 20, 20])
  assert.equal(val(r, "profitFactor"), null)
  assert.equal(reason(r, "profitFactor"), "NO_LOSERS")
  assert.equal(val(r, "averageLoser"), null)
  assert.equal(val(r, "largestLoser"), null)
  assert.equal(val(r, "maxDrawdown"), 0) // 0 é valor válido (disponível)
  assert.equal(r.metrics.maxDrawdown.available, true)
  assert.equal(val(r, "recoveryFactor"), null)
  assert.equal(reason(r, "recoveryFactor"), "NO_DRAWDOWN")
  assert.deepEqual([val(r, "maxConsecutiveWins"), val(r, "currentStreak")], [1, 1])
  assert.ok(codes(r).includes("W_LOW_SAMPLE"))
})

test("UM trade perdedor: PF = 0 (sem ganhos, com perdas), drawdown = a perda, sequência atual −1", () => {
  const r = calculateMetrics([loss("a")])
  assert.deepEqual(["winRate", "lossRate", "profitFactor", "maxDrawdown", "currentDrawdown", "currentStreak", "netPnl"].map((m) => val(r, m)), [0, 100, 0, 20, 20, -1, -20])
  assert.equal(val(r, "averageWinner"), null)
  assert.equal(reason(r, "payoffRatio"), "NO_WINNERS")
})

test("TODOS vencedores / TODOS perdedores", () => {
  const w = calculateMetrics([win("a"), win("b", { exitAt: "2026-01-12 09:55:00" }), win("c", { exitAt: "2026-01-12 10:00:00" })])
  assert.deepEqual([val(w, "winRate"), val(w, "maxConsecutiveWins"), val(w, "maxConsecutiveLosses"), val(w, "maxDrawdown"), val(w, "netPnl")], [100, 3, 0, 0, 60])
  assert.equal(val(w, "profitFactor"), null)
  const l = calculateMetrics([loss("a"), loss("b", { exitAt: "2026-01-12 10:55:00" })])
  assert.deepEqual([val(l, "winRate"), val(l, "maxConsecutiveLosses"), val(l, "maxDrawdown"), val(l, "recoveryFactor"), val(l, "netPnl")], [0, 2, 40, -1, -40]) // recovery = lucro líquido / drawdown = −40/40 (negativo quando só perde)
  assert.equal(val(l, "winnersTotal"), 0) // soma vazia = 0 (válida) — diferente de "indisponível"
})

test("EMPATE (líquido exatamente 0): conta como breakeven, QUEBRA as sequências e não entra em win/loss", () => {
  // bruto 0,50 (0,25 pt × US$ 2) − comissão 0,50 = 0,00
  const be = mk({ id: "be", direction: "LONG", entry: 100, exit: 100.25, entryAt: "2026-01-12 09:55:00", exitAt: "2026-01-12 09:56:00", commission: 0.5, fees: 0 })
  const r = calculateMetrics([win("a"), win("b", { exitAt: "2026-01-12 09:52:00" }), be, win("c", { exitAt: "2026-01-12 10:00:00" })])
  assert.deepEqual(["winners", "losers", "breakeven", "winRate", "breakevenRate"].map((m) => val(r, m)), [3, 0, 1, 75, 25])
  assert.equal(val(r, "maxConsecutiveWins"), 2) // a,b | (empate quebra) | c
  assert.equal(val(r, "currentStreak"), 1)
})

test("P&L total negativo e média negativa", () => {
  const r = calculateMetrics([loss("a"), loss("b", { exitAt: "2026-01-12 10:55:00" }), win("c")])
  assert.deepEqual([val(r, "netPnl"), val(r, "averageTrade")], [-20, -6.67]) // −20/3 = −6,666… → −6,67 (meia afasta do zero)
})

// ── dados insuficientes ──────────────────────────────────────────────────────

test("sem NENHUM stop: todas as métricas de R indisponíveis (R_UNAVAILABLE) + aviso — nunca R inferido", () => {
  const r = calculateMetrics([win("a"), loss("b")])
  for (const m of ["totalR", "averageR", "medianR", "winRateR", "expectancyR", "averageWinnerR", "averageLoserR", "maxDrawdownR"]) {
    assert.equal(val(r, m), null, m)
    assert.equal(reason(r, m), "R_UNAVAILABLE", m)
  }
  assert.deepEqual(r.metrics.totalR.details, { unknownByReason: { RISK_UNKNOWN: 2 } })
  assert.equal(r.metrics.totalR.coverage.ratio, 0)
  assert.ok(codes(r).includes("W_R_UNAVAILABLE"))
  assert.equal(val(r, "netPnl"), 0) // o P&L segue disponível (R é outro eixo)
})

test("R PARCIAL: 50 trades com P&L, 20 com risco → totalTrades 50, R só nos 20, cobertura 40%", () => {
  const trades = Array.from({ length: 50 }, (_, i) =>
    mk({
      id: `p${String(i).padStart(2, "0")}`,
      direction: "LONG",
      entry: 100,
      exit: 110,
      entryAt: "2026-01-12 09:35:00",
      exitAt: `2026-01-12 ${String(9 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00`,
      commission: 0,
      fees: 0,
      stop: i < 20 ? 95 : null, // risco 5 pts = US$ 10 → R = 20/10 = +2,0
    }),
  )
  const r = calculateMetrics(trades)
  assert.equal(val(r, "totalTrades"), 50)
  assert.equal(val(r, "netPnl"), 1000)
  assert.deepEqual([val(r, "totalR"), val(r, "averageR"), val(r, "medianR")], [40, 2, 2]) // 20 × 2,0 — nunca 50 × 2,0
  const c = r.metrics.totalR.coverage
  assert.deepEqual([c.used, c.total, c.ratio], [20, 50, 0.4])
  assert.equal(r.metrics.winRateR.sampleSize, 20)
  assert.ok(codes(r).includes("W_R_PARTIAL_COVERAGE"))
  assert.ok(!codes(r).includes("W_LOW_SAMPLE")) // 50 ≥ 30
  assert.match(r.warnings.find((w) => w.code === "W_R_PARTIAL_COVERAGE")!.message, /20 de 50 trades \(40%\)/)
})

test("comissão DESCONHECIDA: o trade tem bruto mas NÃO tem líquido ⇒ fica fora das métricas líquidas (cobertura < 100%)", () => {
  const r = calculateMetrics([win("a"), win("b", { commission: null, fees: null }), loss("c")])
  assert.deepEqual([val(r, "grossPnl"), val(r, "netPnl")], [20, 0]) // bruto 20+20−20; líquido só de a e c: 20−20
  assert.deepEqual([r.metrics.grossPnl.coverage.used, r.metrics.netPnl.coverage.used, r.metrics.classifiedTrades.coverage.ratio], [3, 2, 0.6667])
  assert.equal(val(r, "classifiedTrades"), 2)
  assert.ok(codes(r).includes("W_PNL_PARTIAL_COVERAGE"))
  assert.ok(codes(r).includes("W_COMMISSION_PARTIAL"))
  assert.equal(val(r, "commission"), 0)
  assert.equal(r.metrics.commission.coverage.used, 2)
})

test("só COMISSÃO (taxas não informadas): líquido existe (COMMISSION_ONLY) e a cobertura de taxas é separada", () => {
  const r = calculateMetrics([win("a", { commission: 1, fees: null }), win("b", { commission: 1, fees: 0.5 })])
  assert.equal(val(r, "netPnl"), 37.5) // (20−1) + (20−1−0,5) = 19,00 + 18,50
  assert.deepEqual([r.metrics.commission.coverage.used, r.metrics.fees.coverage.used, val(r, "fees")], [2, 1, 0.5])
})

test("base BRUTA disponível mas LÍQUIDA não: pnlBasis GROSS classifica os mesmos trades que NET exclui", () => {
  const t = [win("a", { commission: null, fees: null }), loss("b", { commission: null, fees: null })]
  assert.equal(val(calculateMetrics(t), "classifiedTrades"), 0)
  assert.equal(val(calculateMetrics(t, { pnlBasis: "GROSS" }), "classifiedTrades"), 2)
  assert.equal(val(calculateMetrics(t, { pnlBasis: "GROSS" }), "winRate"), 50)
})

// ── instrumentos / pointValue ────────────────────────────────────────────────

test("pointValue por instrumento: NQ 200 · MNQ 20 · ES 500 · MES 50 (10 pontos, 1 contrato); DESCONHECIDO = null", () => {
  const mkRoot = (root: string) => mk({ id: root, root, direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00", commission: 0, fees: 0 })
  const expected: Record<string, number | null> = { NQ: 200, MNQ: 20, ES: 500, MES: 50, XYZ: null }
  for (const [root, gross] of Object.entries(expected)) {
    const t = mkRoot(root).trade
    assert.equal(t.pnl.gross, gross, root)
    assert.equal(t.instrument.pointValue, root === "XYZ" ? null : { NQ: 20, MNQ: 2, ES: 50, MES: 5 }[root], root)
  }
})

test("instrumento desconhecido NO CONJUNTO: fora das métricas em dólar (cobertura 4/5), com aviso; NUNCA vira NQ US$ 20", () => {
  const set = ["NQ", "MNQ", "ES", "MES", "XYZ"].map((root) =>
    mk({ id: root, root, direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00", commission: 0, fees: 0 }),
  )
  const r = calculateMetrics(set)
  assert.equal(val(r, "grossPnl"), 770) // 200 + 20 + 500 + 50 — o XYZ NÃO contribui com 20 (nem com nada)
  assert.equal(val(r, "netPnl"), 770)
  assert.deepEqual([r.metrics.netPnl.coverage.used, r.metrics.netPnl.coverage.total, val(r, "classifiedTrades"), val(r, "totalTrades")], [4, 5, 4, 5])
  assert.equal(r.dataQuality.instruments.unknown, 1)
  assert.equal(r.dataQuality.pnl.unknownBasis, 1)
  assert.equal(r.dataQuality.level, "PARTIAL")
  assert.ok(codes(r).includes("W_UNKNOWN_INSTRUMENT"))
  assert.ok(codes(r).includes("W_UNKNOWN_BASIS_EXCLUDED"))
  // pontos de instrumentos diferentes NÃO se somam
  assert.equal(val(r, "totalPoints"), null)
  assert.equal(reason(r, "totalPoints"), "MIXED_INSTRUMENTS")
  assert.deepEqual(r.metrics.totalPoints.details, { symbols: ["(desconhecido)", "ES", "MES", "MNQ", "NQ"] })
  // por símbolo: o grupo XYZ fica sem P&L em dólar
  const g = aggregateTrades(set, { groupBy: "symbol" })
  assert.deepEqual(g.groups.map((x) => [x.key[0], x.metrics.netPnl.value]), [["ES", 500], ["MES", 50], ["MNQ", 20], ["NQ", 200], [null, null]])
})

test("só instrumento DESCONHECIDO: nenhuma métrica em dólar; pontos indisponíveis (UNKNOWN_INSTRUMENT)", () => {
  const r = calculateMetrics([mk({ id: "x", root: "XYZ", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00" })])
  assert.deepEqual([val(r, "netPnl"), val(r, "grossPnl"), val(r, "classifiedTrades"), val(r, "winRate")], [null, null, 0, null])
  assert.equal(reason(r, "totalPoints"), "UNKNOWN_INSTRUMENT")
  assert.equal(reason(r, "netPnl"), "NO_NET_PNL")
})

test("instrumento desconhecido COM stop: R líquido indisponível (sem US$/ponto), mas R em PONTOS funciona (não precisa de pointValue)", () => {
  const t = [mk({ id: "x", root: "XYZ", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00", stop: 95 })]
  const net = calculateMetrics(t)
  assert.equal(val(net, "totalR"), null)
  assert.deepEqual(perReason(net), { RISK_USD_UNAVAILABLE: 1 })
  const pts = calculateMetrics(t, { rBasis: "POINTS" })
  assert.equal(val(pts, "totalR"), 2) // 10 pts / 5 pts de risco
})
test("MESMO instrumento ⇒ pontos por contrato somam (MNQ ×3 de +10 pt = +30)", () => {
  const r = calculateMetrics([win("a"), win("b", { exitAt: "2026-01-12 09:55:00" }), win("c", { exitAt: "2026-01-12 10:00:00" })])
  assert.deepEqual([val(r, "totalPoints"), val(r, "averagePoints")], [30, 10])
})

// ── precisão monetária ───────────────────────────────────────────────────────

const tiny = (id: string, i: number) => {
  // até 300 trades por dia útil fictício (dias 12..15/01): saída sempre depois da entrada, hora sempre válida
  const day = 12 + Math.floor(i / 300)
  const hh = String(9 + Math.floor((i % 300) / 60)).padStart(2, "0")
  const mm = String(i % 60).padStart(2, "0")
  // bruto 0,50 (0,25 pt × US$ 2) − comissão 0,40 = líquido 0,10; stop 0,25 pt abaixo ⇒ risco US$ 0,50 ⇒ R = 0,2
  return mk({ id, direction: "LONG", entry: 100, exit: 100.25, entryAt: `2026-01-${day} 08:00:00`, exitAt: `2026-01-${day} ${hh}:${mm}:00`, commission: 0.4, fees: 0, stop: 99.75 })
}

test("PRECISÃO: 3 trades de líquido 0,10 somam 0,30 (não 0,30000000000000004); média 0,10; R total 0,6", () => {
  assert.notEqual(0.1 + 0.1 + 0.1, 0.3)
  const r = calculateMetrics([tiny("a", 0), tiny("b", 1), tiny("c", 2)])
  assert.deepEqual([val(r, "netPnl"), val(r, "averageTrade"), val(r, "grossPnl"), val(r, "commission")], [0.3, 0.1, 1.5, 1.2])
  assert.deepEqual([val(r, "totalR"), val(r, "averageR"), val(r, "expectancyR")], [0.6, 0.2, 0.2])
})

test("PRECISÃO: 1.000 trades de 0,10 ⇒ líquido 100,00 e comissão 400,00 EXATOS; nenhuma métrica com cauda binária", () => {
  const set = Array.from({ length: 1000 }, (_, i) => tiny(`k${String(i).padStart(4, "0")}`, i))
  const r = calculateMetrics(set)
  assert.deepEqual([val(r, "netPnl"), val(r, "commission"), val(r, "grossPnl"), val(r, "averageTrade"), val(r, "totalR")], [100, 400, 500, 0.1, 200])
  for (const m of Object.values(r.metrics)) {
    if (m.value === null) continue
    if (m.unit === "usd" || m.unit === "percent") assert.ok(clean(m.value, 2), `${m.metric}=${m.value}`)
    if (m.unit === "R" || m.unit === "ratio") assert.ok(clean(m.value, 4), `${m.metric}=${m.value}`)
  }
})

test("PRECISÃO: taxas 0,7 + 0,6 + 0,3 em 3 trades = 1,60 (e líquido consistente)", () => {
  const f = (id: string, fees: number, exitAt: string) => win(id, { commission: 0, fees, exitAt })
  const r = calculateMetrics([f("a", 0.7, "2026-01-12 09:50:00"), f("b", 0.6, "2026-01-12 09:55:00"), f("c", 0.3, "2026-01-12 10:00:00")])
  assert.equal(val(r, "fees"), 1.6)
  assert.equal(val(r, "netPnl"), 58.4) // 3 × 20 − 1,6
})

// ── outliers ─────────────────────────────────────────────────────────────────

test("OUTLIER: 9 trades de +10 e um de +1.000: média 109 puxada, a mediana (R) e a dependência de outlier denunciam", () => {
  const set = [
    ...Array.from({ length: 9 }, (_, i) => mk({ id: `n${i}`, direction: "LONG", entry: 100, exit: 105, entryAt: "2026-01-12 09:35:00", exitAt: `2026-01-12 09:${40 + i}:00`, commission: 0, fees: 0, stop: 95 })), // +10, R +1
    mk({ id: "big", direction: "LONG", entry: 100, exit: 600, entryAt: "2026-01-12 11:00:00", exitAt: "2026-01-12 11:30:00", commission: 0, fees: 0, stop: 95 }), // +1000, R +100
  ]
  const r = calculateMetrics(set)
  assert.equal(val(r, "averageTrade"), 109)
  assert.equal(val(r, "averageR"), 10.9)
  assert.equal(val(r, "medianR"), 1) // robusta ao outlier
  assert.equal(val(r, "largestWinnerSharePct"), 91.74) // 1000 / 1090
  assert.equal(r.metrics.largestWinner.details?.tradeId, "big")
  assert.equal(val(r, "top3WinnersSharePct"), 93.58) // (1000+10+10) / 1090 = 1020/1090
})

// ── ordem / sequência ────────────────────────────────────────────────────────

test("ORDEM: drawdown independe da ordem do array (usa o horário de saída)", () => {
  const seq = [
    win("a", { exitAt: "2026-01-12 09:50:00" }),
    loss("b", { exitAt: "2026-01-12 10:00:00" }),
    loss("c", { exitAt: "2026-01-12 10:10:00" }),
    win("d", { exitAt: "2026-01-12 10:20:00" }),
  ]
  const a = calculateMetrics(seq)
  const b = calculateMetrics([seq[3], seq[1], seq[0], seq[2]])
  assert.deepEqual([val(a, "maxDrawdown"), val(a, "maxConsecutiveLosses")], [40, 2])
  assert.deepEqual(a.metrics, b.metrics)
})

test("ORDEM aproximada (sem hora de saída): metrics usam a data, e o resultado AVISA", () => {
  const d = [
    mk({ id: "d1", direction: "LONG", entry: 100, exit: 110, dateOnly: "2026-01-12", commission: 0, fees: 0 }),
    mk({ id: "d2", direction: "LONG", entry: 110, exit: 100, dateOnly: "2026-01-13", commission: 0, fees: 0 }),
  ]
  const r = calculateMetrics(d)
  assert.equal(r.dataQuality.order.approximate, true)
  assert.ok(codes(r).includes("W_ORDER_APPROXIMATE"))
  assert.equal(val(r, "maxDrawdown"), 20)
})

// ── metadados para evidência ─────────────────────────────────────────────────

test("EVIDÊNCIA: cada número carrega métrica, valor, amostra, cobertura, base e versão; o resultado, filtros/período/população", () => {
  const r = calculateMetrics(ten(), { filters: { direction: "SHORT" } })
  const w = r.metrics.winRate
  assert.deepEqual(
    { metric: w.metric, value: w.value, sampleSize: w.sampleSize, coverage: w.coverage, basis: w.basis, available: w.available, definitionVersion: w.definitionVersion },
    { metric: "winRate", value: 50, sampleSize: 4, coverage: { used: 4, total: 4, ratio: 1 }, basis: "NET", available: true, definitionVersion: "1" },
  )
  assert.equal(r.schema, "metrics-result/1")
  assert.equal(r.engineVersion, "metrics/1.0.0")
  assert.deepEqual(r.query.filters, { direction: "SHORT" })
  assert.deepEqual(r.query.options, { timeZone: "America/New_York", timeAnchor: "ENTRY", pnlBasis: "NET", rBasis: "NET", tradeIdsLimit: 500, minSample: 30 })
  assert.deepEqual(r.period, { fromLocalDate: "2026-01-12", toLocalDate: "2026-01-14", fromInstantUtc: "2026-01-12T15:10:00.000Z", toInstantUtc: "2026-01-15T00:00:00.000Z" })
  assert.equal(r.population.inputTrades, 10)
  assert.equal(r.population.afterFilters, 4)
  assert.match(r.population.tradeSetHash, /^[0-9a-f]{64}$/)
  assert.deepEqual(r.population.provenance, { withIdentity: 0, withoutIdentity: 4 }) // trades sintéticos sem identidade do pipeline
})

test("EVIDÊNCIA: acima do limite só o hash (sem a lista de ids); o hash identifica o MESMO conjunto", () => {
  const r = calculateMetrics(ten(), { tradeIdsLimit: 5 })
  assert.equal(r.population.tradeIds, null)
  assert.equal(r.population.tradeSetHash, calculateMetrics(ten()).population.tradeSetHash)
})

test("CATÁLOGO: toda métrica produzida está no catálogo (com a mesma unidade) e vice-versa", () => {
  const r = calculateMetrics(ten())
  assert.deepEqual(Object.keys(r.metrics).sort(), [...METRIC_IDS].sort())
  for (const def of METRIC_CATALOG) {
    assert.equal(r.metrics[def.id].unit, def.unit, def.id)
    assert.equal(r.metrics[def.id].definitionVersion, def.version, def.id)
    assert.ok(def.formula.length > 5, def.id)
  }
  assert.equal(new Set(METRIC_IDS).size, METRIC_IDS.length)
})

test("entrada inválida: id repetido e fuso inválido lançam erro explícito", () => {
  assert.throws(() => calculateMetrics([win("a"), win("a")]), (e: unknown) => e instanceof MetricsInputError && e.code === "E_DUPLICATE_ID")
  assert.throws(() => calculateMetrics(ten(), { timeZone: "Mars/Olympus" }), (e: unknown) => e instanceof MetricsInputError && e.code === "E_OPTIONS_INVALID")
  assert.throws(() => calculateMetrics(ten(), { minSample: 0 }), (e: unknown) => e instanceof MetricsInputError)
})

test("filtro sem resultado ⇒ população vazia com aviso (não quebra, não finge)", () => {
  const r = calculateMetrics(ten(), { filters: { hour: 3 } })
  assert.equal(r.population.afterFilters, 0)
  assert.deepEqual(codes(r), ["W_NO_TRADES"])
  assert.equal(val(r, "netPnl"), null)
})

// ── integração: pipeline de importação → métricas ────────────────────────────

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/_synthetic/${name}`, import.meta.url)), "utf8")

test("INTEGRAÇÃO NT8 EN: 5 linhas importadas → 4 com líquido (o XYZ desconhecido fica de fora) = −88,90; R indisponível", () => {
  const imp = runImportPipeline(fx("ninjatrader-en-trades.csv"), { sourceTz: BRT })
  const r = calculateMetrics(toAnalyticsTrades(imp.trades))
  assert.equal(val(r, "totalTrades"), 5)
  assert.equal(val(r, "netPnl"), -88.9) // 77,60 − 204,10 + 18,80 + 18,80
  assert.deepEqual([val(r, "classifiedTrades"), val(r, "winners"), val(r, "losers")], [4, 3, 1])
  assert.equal(r.metrics.netPnl.coverage.ratio, 0.8)
  assert.ok(codes(r).includes("W_R_UNAVAILABLE"))
  assert.ok(codes(r).includes("W_UNKNOWN_INSTRUMENT"))
  assert.equal(val(r, "totalPoints"), null) // instrumentos misturados (MNQ, NQ, XYZ)
})

test("INTEGRAÇÃO NT8 PT-BR: líquido −107,70 = bruto −100,00 − corretagem 4,60 − taxas 3,10 (custos separados)", () => {
  const imp = runImportPipeline(fx("ninjatrader-ptbr-grid.csv"), { sourceTz: BRT })
  const r = calculateMetrics(toAnalyticsTrades(imp.trades))
  assert.deepEqual([val(r, "netPnl"), val(r, "grossPnl"), val(r, "commission"), val(r, "fees")], [-107.7, -100, 4.6, 3.1])
  // bruto = 80 − 200 + 20 = −100 · corretagem 1,40+2,50+0,70 = 4,60 · taxas 1,00+1,60+0,50 = 3,10 ⇒ líquido −100 − 4,60 − 3,10
})

test("INTEGRAÇÃO template (só data): P&L de base desconhecida ⇒ nenhuma métrica de P&L; dia/dia da semana ainda agrupam", () => {
  const imp = runImportPipeline(fx("meutrade-template.csv"), {})
  const t = toAnalyticsTrades(imp.trades)
  const r = calculateMetrics(t)
  assert.equal(val(r, "totalTrades"), 3)
  assert.equal(val(r, "classifiedTrades"), 0)
  assert.equal(val(r, "netPnl"), null)
  assert.equal(r.dataQuality.pnl.unknownBasis, 3)
  assert.deepEqual(aggregateTrades(t, { groupBy: "day" }).groups.map((g) => g.key[0]), ["2025-01-15", "2025-01-16", "2025-01-17"])
  assert.equal(aggregateTrades(t, { groupBy: "hour" }).groups[0].label, "(sem horário)")
})

console.log(`\n${passed} testes ok`)
