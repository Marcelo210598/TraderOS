// Testes de P&L (bruto/líquido), risco, R e MFE/MAE: node scripts/test-domain-pnl-risk.mts
import assert from "node:assert/strict"
import { analysisPnl, buildPnl, computeGrossFromPrices, pointsPerContract } from "../src/lib/domain/pnl.ts"
import { checkExcursionConsistency, computeRisk, normalizeExcursion, rMultipleNet, rMultiplePoints } from "../src/lib/domain/risk.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

// ── pontos e bruto por preços ────────────────────────────────────────────────

test("pointsPerContract: long/short, com sinal", () => {
  assert.equal(pointsPerContract("LONG", 21450, 21470.25), 20.25)
  assert.equal(pointsPerContract("SHORT", 21450, 21470.25), -20.25)
  assert.equal(pointsPerContract("SHORT", 21450, 21430), 20)
})

test("bruto por preços: MNQ 2 contratos 20 pts = $80; sem pointValue → null (não assume NQ)", () => {
  assert.equal(computeGrossFromPrices({ direction: "LONG", entryPrice: 21450, exitPrice: 21470, quantity: 2, pointValue: 2 }), 80)
  assert.equal(computeGrossFromPrices({ direction: "LONG", entryPrice: 21450, exitPrice: 21470, quantity: 2, pointValue: null }), null)
})

// ── buildPnl: base declarada ─────────────────────────────────────────────────

test("declarado BRUTO + comissão + taxas → líquido COMPLETE", () => {
  const p = buildPnl({ reported: 100, declaredBasis: "GROSS", commission: 2.5, fees: 1.5, computedGross: 100 })
  assert.deepEqual([p.gross, p.net, p.netStatus, p.basis, p.basisSource], [100, 96, "COMPLETE", "GROSS", "SOURCE_DECLARED"])
})

test("declarado BRUTO + só comissão → líquido COMMISSION_ONLY (taxas não informadas, e isso fica explícito)", () => {
  const p = buildPnl({ reported: 100, declaredBasis: "GROSS", commission: 4, fees: null, computedGross: null })
  assert.deepEqual([p.net, p.netStatus, p.fees], [96, "COMMISSION_ONLY", null])
})

test("declarado BRUTO sem comissão → net NULL (não chama bruto de líquido)", () => {
  const p = buildPnl({ reported: 100, declaredBasis: "GROSS", commission: null, fees: null, computedGross: null })
  assert.deepEqual([p.gross, p.net, p.netStatus], [100, null, "UNAVAILABLE"])
})

test("declarado LÍQUIDO (AddOn que já desconta) → net = reportado; bruto derivado só com custos conhecidos", () => {
  const a = buildPnl({ reported: 96, declaredBasis: "NET", commission: 4, fees: 0, computedGross: null })
  assert.deepEqual([a.net, a.gross, a.netStatus], [96, 100, "COMPLETE"])
  const b = buildPnl({ reported: 96, declaredBasis: "NET", commission: null, fees: null, computedGross: null })
  assert.deepEqual([b.net, b.gross, b.netStatus], [96, null, "UNAVAILABLE"])
})

// ── buildPnl: inferência pela comparação com os preços ───────────────────────

test("base desconhecida + reportado = cálculo por preços → inferido BRUTO", () => {
  const p = buildPnl({ reported: 80, declaredBasis: "UNKNOWN", commission: 2.4, fees: 0.6, computedGross: 80 })
  assert.deepEqual([p.basis, p.basisSource, p.gross, p.net, p.netStatus], ["GROSS", "INFERRED_FROM_PRICES", 80, 77, "COMPLETE"])
})

test("base desconhecida + reportado = cálculo − custos → inferido LÍQUIDO", () => {
  const p = buildPnl({ reported: 77, declaredBasis: "UNKNOWN", commission: 2.4, fees: 0.6, computedGross: 80 })
  assert.deepEqual([p.basis, p.basisSource, p.net, p.gross], ["NET", "INFERRED_FROM_PRICES", 77, 80])
})

test("base desconhecida e NÃO inferível → UNKNOWN: nem bruto nem líquido, só 'reported'", () => {
  const p = buildPnl({ reported: 55, declaredBasis: "UNKNOWN", commission: 2, fees: null, computedGross: 80 })
  assert.deepEqual([p.basis, p.basisSource, p.gross, p.net, p.reported], ["UNKNOWN", "UNDETERMINED", null, null, 55])
})

test("base desconhecida SEM pointValue (computedGross null) → UNKNOWN; não inventa", () => {
  const p = buildPnl({ reported: 80, declaredBasis: "UNKNOWN", commission: 2, fees: 0, computedGross: null })
  assert.deepEqual([p.basis, p.gross, p.net], ["UNKNOWN", null, null])
})

test("tolerância: preço médio arredondado ainda infere (diferença de centavos)", () => {
  const p = buildPnl({ reported: 80.03, declaredBasis: "UNKNOWN", commission: 0, fees: 0, computedGross: 80 })
  assert.equal(p.basis, "GROSS")
})

test("analysisPnl: prefere líquido, rotula o que é; base desconhecida é rotulada como tal", () => {
  const net = buildPnl({ reported: 100, declaredBasis: "GROSS", commission: 4, fees: 0, computedGross: null })
  assert.deepEqual(analysisPnl(net), { value: 96, kind: "NET" })
  const gross = buildPnl({ reported: 100, declaredBasis: "GROSS", commission: null, fees: null, computedGross: null })
  assert.deepEqual(analysisPnl(gross), { value: 100, kind: "GROSS" })
  const unk = buildPnl({ reported: 55, declaredBasis: "UNKNOWN", commission: null, fees: null, computedGross: null })
  assert.deepEqual(analysisPnl(unk), { value: 55, kind: "REPORTED_UNKNOWN_BASIS" })
  assert.equal(analysisPnl(buildPnl({ reported: null, declaredBasis: "UNKNOWN", commission: null, fees: null, computedGross: null })), null)
})

// ── risco / R ────────────────────────────────────────────────────────────────

test("risco: long com stop abaixo, MNQ × 2 contratos", () => {
  const r = computeRisk({ direction: "LONG", entryPrice: 21450, stopPrice: 21430, quantity: 2, pointValue: 2 })
  assert.deepEqual(r, { riskPoints: 20, riskUsd: 80, reason: null })
})

test("risco: short com stop acima", () => {
  const r = computeRisk({ direction: "SHORT", entryPrice: 21450, stopPrice: 21462.5, quantity: 1, pointValue: 20 })
  assert.deepEqual(r, { riskPoints: 12.5, riskUsd: 250, reason: null })
})

test("risco: stop do lado errado / igual à entrada / ausente → sem risco, com motivo", () => {
  assert.equal(computeRisk({ direction: "LONG", entryPrice: 100, stopPrice: 105, quantity: 1, pointValue: 20 }).reason, "STOP_WRONG_SIDE")
  assert.equal(computeRisk({ direction: "SHORT", entryPrice: 100, stopPrice: 95, quantity: 1, pointValue: 20 }).reason, "STOP_WRONG_SIDE")
  assert.equal(computeRisk({ direction: "LONG", entryPrice: 100, stopPrice: 100, quantity: 1, pointValue: 20 }).reason, "STOP_EQUALS_ENTRY")
  assert.equal(computeRisk({ direction: "LONG", entryPrice: 100, stopPrice: null, quantity: 1, pointValue: 20 }).reason, "STOP_MISSING")
})

test("risco: pointValue desconhecido → riskPoints existe, riskUsd NULL", () => {
  const r = computeRisk({ direction: "LONG", entryPrice: 100, stopPrice: 90, quantity: 3, pointValue: null })
  assert.deepEqual(r, { riskPoints: 10, riskUsd: null, reason: null })
})

test("R líquido = net / riskUsd (convenção aprovada); sem net ou sem risco → null com motivo", () => {
  assert.deepEqual(rMultipleNet({ netPnl: 96, riskUsd: 80, riskKnown: true }), { value: 1.2, reason: null })
  assert.deepEqual(rMultipleNet({ netPnl: -80, riskUsd: 80, riskKnown: true }), { value: -1, reason: null })
  assert.deepEqual(rMultipleNet({ netPnl: null, riskUsd: 80, riskKnown: true }), { value: null, reason: "NET_PNL_UNAVAILABLE" })
  assert.deepEqual(rMultipleNet({ netPnl: 96, riskUsd: null, riskKnown: false }), { value: null, reason: "RISK_UNKNOWN" })
  assert.deepEqual(rMultipleNet({ netPnl: 96, riskUsd: null, riskKnown: true }), { value: null, reason: "RISK_USD_UNAVAILABLE" })
})

test("R em pontos independe de custos/quantidade/pointValue", () => {
  assert.equal(rMultiplePoints({ pointsPerContract: 30, riskPoints: 20 }), 1.5)
  assert.equal(rMultiplePoints({ pointsPerContract: -20, riskPoints: 20 }), -1)
  assert.equal(rMultiplePoints({ pointsPerContract: 30, riskPoints: null }), null)
})

// ── MFE / MAE ────────────────────────────────────────────────────────────────

test("excursão: dólar TOTAL → pontos por contrato ($160 / (2 × 2 contratos) = 40 pts)", () => {
  assert.deepEqual(normalizeExcursion({ value: 160, unit: "USD_TOTAL", quantity: 2, pointValue: 2 }), { points: 40, reason: null })
  assert.deepEqual(normalizeExcursion({ value: -160, unit: "USD_TOTAL", quantity: 2, pointValue: 2 }), { points: 40, reason: null }) // sinal descartado
})

test("excursão: dólar por contrato e pontos por contrato", () => {
  assert.deepEqual(normalizeExcursion({ value: 80, unit: "USD_PER_CONTRACT", quantity: 5, pointValue: 2 }), { points: 40, reason: null })
  assert.deepEqual(normalizeExcursion({ value: 12.5, unit: "POINTS_PER_CONTRACT", quantity: 5, pointValue: null }), { points: 12.5, reason: null })
})

test("excursão: sem unidade → null (número de unidade desconhecida NÃO vira pontos)", () => {
  assert.deepEqual(normalizeExcursion({ value: 160, unit: null, quantity: 2, pointValue: 2 }), { points: null, reason: "UNIT_UNKNOWN" })
})

test("excursão em dólar sem pointValue → null (não usa 20 do NQ)", () => {
  assert.deepEqual(normalizeExcursion({ value: 160, unit: "USD_TOTAL", quantity: 2, pointValue: null }), { points: null, reason: "POINT_VALUE_UNKNOWN" })
})

test("excursão ausente / NaN", () => {
  assert.equal(normalizeExcursion({ value: null, unit: "USD_TOTAL", quantity: 1, pointValue: 2 }).reason, "NOT_PROVIDED")
  assert.equal(normalizeExcursion({ value: NaN, unit: "USD_TOTAL", quantity: 1, pointValue: 2 }).reason, "NOT_A_NUMBER")
})

test("coerência MFE/MAE × resultado realizado", () => {
  assert.deepEqual(checkExcursionConsistency({ pointsPerContract: 20, mfePoints: 25, maePoints: 5 }), [])
  assert.equal(checkExcursionConsistency({ pointsPerContract: 20, mfePoints: 10, maePoints: 5 })[0].code, "W_MFE_LT_REALIZED")
  assert.equal(checkExcursionConsistency({ pointsPerContract: -20, mfePoints: 3, maePoints: 8 })[0].code, "W_MAE_LT_REALIZED")
  assert.deepEqual(checkExcursionConsistency({ pointsPerContract: 20, mfePoints: null, maePoints: null }), [])
})

console.log(`\n${passed} testes ok`)
