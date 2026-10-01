// Testes das métricas sobre o dataset TEN (10 trades, tabelado em docs/ai-partner/metrics-audit-dataset.md).
// Todos os valores esperados foram calculados À MÃO (ver o documento). node scripts/test-metrics-core.mts
import assert from "node:assert/strict"
import { perTradeR } from "../src/lib/metrics/index.ts"
import { calculateMetrics, clean, mk, ten, val } from "./_metrics-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const R = calculateMetrics(ten()) // NET, R líquido, fuso NY

test("fixture TEN: bruto 115,00 · comissão 10,00 · taxas 2,00 · líquido 103,00 (115 − 12)", () => {
  assert.equal(val(R, "grossPnl"), 115)
  assert.equal(val(R, "commission"), 10)
  assert.equal(val(R, "fees"), 2)
  assert.equal(val(R, "netPnl"), 103)
})

test("contagens: 10 trades, 5 vencedores, 5 perdedores, 0 empates (líquido: t3 e t9 são −1,20)", () => {
  assert.deepEqual(
    ["totalTrades", "classifiedTrades", "winners", "losers", "breakeven"].map((m) => val(R, m)),
    [10, 10, 5, 5, 0],
  )
  assert.deepEqual(["winRate", "lossRate", "breakevenRate"].map((m) => val(R, m)), [50, 50, 0])
})

test("P&L: soma dos vencedores 189,00; perdedores −86,00; trade médio 10,30; médio vencedor 37,80; médio perdedor −17,20", () => {
  assert.deepEqual(
    ["winnersTotal", "losersTotal", "averageTrade", "averageWinner", "averageLoser"].map((m) => val(R, m)),
    [189, -86, 10.3, 37.8, -17.2],
  )
})

test("extremos: maior vencedor +58,80 (t4), maior perdedor −41,20 (t6) — com o id do trade", () => {
  assert.equal(val(R, "largestWinner"), 58.8)
  assert.equal(val(R, "largestLoser"), -41.2)
  assert.equal(R.metrics.largestWinner.details?.tradeId, "t4")
  assert.equal(R.metrics.largestLoser.details?.tradeId, "t6")
})

test("profit factor 189/86 = 2,1977 · payoff 37,80/17,20 = 2,1977", () => {
  assert.equal(val(R, "profitFactor"), 2.1977)
  assert.equal(val(R, "payoffRatio"), 2.1977)
})

test("dependência de outliers: maior vencedor = 31,11% do total ganho; top 3 = 72,17%", () => {
  assert.equal(val(R, "largestWinnerSharePct"), 31.11)
  assert.equal(val(R, "top3WinnersSharePct"), 72.17)
  assert.deepEqual(R.metrics.top3WinnersSharePct.details?.tradeIds, ["t4", "t1", "t10"]) // empate t1/t10 (38,80) desempata por id
})

test("R: só 5 dos 10 trades têm stop → cobertura 50%; R total +0,20, médio +0,04, mediano −0,06", () => {
  assert.deepEqual(["totalR", "averageR", "medianR"].map((m) => val(R, m)), [0.2, 0.04, -0.06])
  const c = R.metrics.totalR.coverage
  assert.deepEqual([c.used, c.total, c.ratio, R.metrics.totalR.sampleSize], [5, 10, 0.5, 5])
  assert.equal(R.dataQuality.r.known, 5)
})

test("R por trade: valores exatos e, onde falta, o MOTIVO (nunca estimado)", () => {
  const per = perTradeR(ten())
  const byId = Object.fromEntries(per.map((p) => [p.id, p]))
  assert.deepEqual(["t1", "t2", "t3", "t5", "t6"].map((id) => byId[id].r), [1.94, -1.06, -0.06, 1.44, -2.06])
  for (const id of ["t4", "t7", "t8", "t9", "t10"]) assert.deepEqual(byId[id], { id, r: null, reason: "RISK_UNKNOWN" })
})

test("R: win rate em R 40% (2 de 5); R médio vencedor +1,69; perdedor −1,06; expectancy = 0,04 (= média)", () => {
  assert.deepEqual(["winRateR", "averageWinnerR", "averageLoserR", "expectancyR"].map((m) => val(R, m)), [40, 1.69, -1.06, 0.04])
  assert.equal(val(R, "expectancyR"), val(R, "averageR"))
  // identidade: pW·avgW + pL·avgL
  const d = R.metrics.expectancyR.details as { pWinPct: number; pLossPct: number; averageWinnerR: number; averageLoserR: number }
  const check = (d.pWinPct / 100) * d.averageWinnerR + (d.pLossPct / 100) * d.averageLoserR
  assert.ok(Math.abs(check - 0.04) < 1e-9)
})

test("R em PONTOS (sem custos): total +0,50 · mediano 0 · win rate 40% (t3 vale 0)", () => {
  const p = calculateMetrics(ten(), { rBasis: "POINTS" })
  assert.deepEqual(["totalR", "medianR", "winRateR"].map((m) => val(p, m)), [0.5, 0, 40])
  assert.equal(p.metrics.totalR.basis, "R_POINTS")
})

test("drawdown ($): máx 41,20 (pico t5 → fundo t6), NÃO recuperado, atual 1,00, recovery factor 2,5", () => {
  assert.equal(val(R, "maxDrawdown"), 41.2)
  assert.equal(val(R, "currentDrawdown"), 1)
  assert.equal(val(R, "recoveryFactor"), 2.5)
  const d = R.metrics.maxDrawdown.details as Record<string, unknown>
  assert.deepEqual([d.peakTradeId, d.troughTradeId, d.recovered, d.tradesPeakToTrough, d.tradesToRecover], ["t5", "t6", false, 1, null])
  assert.deepEqual(d.windowTradeIds, ["t6"])
})

test("drawdown (R): máx 2,06 sobre a curva de R dos 5 trades com R (t1,t2,t3,t5,t6)", () => {
  assert.equal(val(R, "maxDrawdownR"), 2.06)
  assert.equal(R.metrics.maxDrawdownR.sampleSize, 5)
})

test("sequências: 2 vitórias seguidas (t4,t5), 2 derrotas (t2,t3), atual = +1 (t10)", () => {
  assert.deepEqual(["maxConsecutiveWins", "maxConsecutiveLosses", "currentStreak"].map((m) => val(R, m)), [2, 2, 1])
  assert.equal(R.metrics.maxConsecutiveWins.details?.startTradeId, "t4")
  assert.equal(R.metrics.maxConsecutiveLosses.details?.startTradeId, "t2")
})

test("pontos por contrato (um instrumento só): total +57,5, médio +5,75", () => {
  assert.deepEqual(["totalPoints", "averagePoints"].map((m) => val(R, m)), [57.5, 5.75])
})

test("base BRUTA: t3 e t9 viram EMPATES; vencedores 5, perdedores 3, PF 2,4375, drawdown 40 recuperado em t10", () => {
  const g = calculateMetrics(ten(), { pnlBasis: "GROSS" })
  assert.deepEqual(["winners", "losers", "breakeven"].map((m) => val(g, m)), [5, 3, 2])
  assert.deepEqual(["winnersTotal", "losersTotal", "averageTrade", "profitFactor"].map((m) => val(g, m)), [195, -80, 11.5, 2.4375])
  assert.equal(val(g, "maxDrawdown"), 40)
  const d = g.metrics.maxDrawdown.details as Record<string, unknown>
  assert.deepEqual([d.recovered, d.recoveredAtTradeId, d.tradesToRecover], [true, "t10", 4])
  assert.equal(val(g, "currentDrawdown"), 0)
  assert.equal(g.metrics.winners.basis, "GROSS")
})

test("base bruta e líquida NÃO se misturam: a base fica carimbada em cada métrica", () => {
  assert.equal(R.metrics.averageTrade.basis, "NET")
  assert.equal(R.metrics.winRate.basis, "NET")
  assert.equal(R.metrics.grossPnl.basis, "GROSS")
  assert.equal(R.metrics.netPnl.basis, "NET")
})

test("todos os valores monetários têm no máximo 2 casas e R no máximo 4 (nada de 1,5999…)", () => {
  for (const m of Object.values(R.metrics)) {
    if (m.value === null) continue
    if (m.unit === "usd") assert.ok(clean(m.value, 2), `${m.metric}=${m.value}`)
    if (m.unit === "R") assert.ok(clean(m.value, 4), `${m.metric}=${m.value}`)
    if (m.unit === "percent") assert.ok(clean(m.value, 2), `${m.metric}=${m.value}`)
    if (m.unit === "ratio") assert.ok(clean(m.value, 4), `${m.metric}=${m.value}`)
  }
})

test("qualidade dos dados e avisos do TEN: COMPLETE (líquido+hora+instrumento); R parcial e amostra baixa avisados", () => {
  assert.equal(R.dataQuality.level, "COMPLETE") // todos têm líquido, hora e instrumento (R é outro eixo)
  const codes = R.warnings.map((w) => w.code)
  assert.ok(codes.includes("W_LOW_SAMPLE")) // 10 < 30
  assert.ok(codes.includes("W_R_PARTIAL_COVERAGE"))
  assert.ok(!codes.includes("W_R_UNAVAILABLE"))
  assert.deepEqual(R.dataQuality.r.unknownByReason, { RISK_UNKNOWN: 5 })
})

test("R parcial: totalR usa só os 5; totalTrades continua 10 (nunca finge R nos 10)", () => {
  assert.equal(val(R, "totalTrades"), 10)
  assert.equal(R.metrics.totalR.sampleSize, 5)
  assert.equal(R.metrics.totalTrades.coverage.ratio, 1)
})

test("determinismo: mesmo input → resultado idêntico (e independe da ORDEM do array)", () => {
  const a = calculateMetrics(ten())
  const shuffled = [...ten()].reverse()
  const b = calculateMetrics(shuffled)
  assert.deepEqual(a.metrics, b.metrics)
  assert.equal(a.population.tradeSetHash, b.population.tradeSetHash)
})

test("o mesmo trade mexido muda o hash do conjunto (rastreabilidade de drift)", () => {
  const a = calculateMetrics(ten())
  const t = ten()
  t[0] = mk({ id: "t1", direction: "LONG", entry: 21000, exit: 21021, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00", stop: 20990 })
  assert.notEqual(a.population.tradeSetHash, calculateMetrics(t).population.tradeSetHash)
})

console.log(`\n${passed} testes ok`)
