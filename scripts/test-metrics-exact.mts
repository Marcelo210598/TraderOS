// Testes da aritmética determinística (exact.ts) e da sequência (drawdown/streaks): node scripts/test-metrics-exact.mts
import assert from "node:assert/strict"
import {
  fromCents,
  fromRScaled,
  hash53,
  meanScaled,
  medianScaled,
  percent,
  ratio,
  roundTo,
  sum,
  toCents,
  toRScaled,
  toScaled,
} from "../src/lib/metrics/exact.ts"
import { drawdown, streaks } from "../src/lib/metrics/sequence.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

// ── precisão monetária ───────────────────────────────────────────────────────

test("o clássico: 0,1 + 0,2 em float ≠ 0,3, mas em centavos inteiros = 0,30 exato", () => {
  assert.notEqual(0.1 + 0.2, 0.3)
  assert.equal(fromCents(toCents(0.1) + toCents(0.2)), 0.3)
})

test("taxas 0,7 + 0,6 + 0,3 = 1,6 (e não 1,5999999999999999)", () => {
  assert.notEqual(0.7 + 0.6 + 0.3, 1.6)
  assert.equal(fromCents(sum([0.7, 0.6, 0.3].map(toCents))), 1.6)
})

test("1.000 comissões de 0,10 somam exatamente 100,00", () => {
  const xs = Array.from({ length: 1000 }, () => 0.1)
  assert.notEqual(xs.reduce((a, b) => a + b, 0), 100) // float acumula erro
  assert.equal(fromCents(sum(xs.map(toCents))), 100)
})

test("R: 0,1 + 0,2 em 1e-4 inteiros = 0,3; soma de 3 × 0,2 = 0,6", () => {
  assert.equal(fromRScaled(toRScaled(0.1) + toRScaled(0.2)), 0.3)
  assert.equal(fromRScaled(sum([0.2, 0.2, 0.2].map(toRScaled))), 0.6)
})

test("toScaled/toCents: sinal, zero negativo e casos de binário (1,005; 0,285)", () => {
  assert.equal(toCents(1.005), 101)
  assert.equal(toCents(0.285), 29)
  assert.equal(toCents(-1.005), -101)
  assert.equal(toCents(-0.004), 0)
  assert.ok(Object.is(fromCents(toCents(-0.004)), 0)) // sem "-0"
  assert.equal(toScaled(21450.25, 2), 2145025)
})

test("roundTo: meia-casa AFASTA do zero; sem erro de binário; tolera notação científica", () => {
  assert.equal(roundTo(1.005, 2), 1.01)
  assert.equal(roundTo(0.125, 2), 0.13)
  assert.equal(roundTo(-0.125, 2), -0.13)
  assert.equal(roundTo(2.5, 0), 3)
  assert.equal(roundTo(-2.5, 0), -3)
  assert.equal(roundTo(1e-9, 2), 0)
  assert.equal(roundTo(1.23456789, 4), 1.2346)
})

test("meanScaled/medianScaled sobre inteiros: arredondam ao inteiro escalado, determinísticos", () => {
  assert.equal(meanScaled([100, 200, 400]), 233) // 233,33 → 233
  assert.equal(meanScaled([1, 2]), 2) // 1,5 → 2 (afasta do zero)
  assert.equal(meanScaled([-1, -2]), -2)
  assert.equal(meanScaled([]), null)
  assert.equal(medianScaled([5, 1, 3]), 3)
  assert.equal(medianScaled([1, 2, 3, 4]), 3) // (2+3)/2 = 2,5 → 3
  assert.equal(medianScaled([]), null)
})

test("percent e ratio: por inteiros (57,4% de 143 trades…), null sem denominador", () => {
  assert.equal(percent(82, 143), 57.34)
  assert.equal(percent(1, 3), 33.33)
  assert.equal(percent(2, 3), 66.67)
  assert.equal(percent(0, 0), null)
  assert.equal(ratio(18900, 8600), 2.1977)
  assert.equal(ratio(1, 0), null)
})

test("hash53: determinístico e sensível a qualquer mudança", () => {
  assert.equal(hash53("abc"), hash53("abc"))
  assert.notEqual(hash53("abc"), hash53("abd"))
  assert.equal(hash53("").length, 14)
})

// ── drawdown ─────────────────────────────────────────────────────────────────

const S = (vs: number[]) => vs.map((v, i) => ({ id: `s${i}`, v }))

test("drawdown: sequência vazia e só ganhos → 0", () => {
  assert.equal(drawdown([]).maxDrawdown, 0)
  const r = drawdown(S([10, 20, 5]))
  assert.deepEqual([r.maxDrawdown, r.currentDrawdown, r.finalEquity, r.peakEquity], [0, 0, 35, 35])
})

test("drawdown: o capital inicial 0 é o primeiro pico (começar perdendo já é drawdown)", () => {
  const r = drawdown(S([-10, -5, 20]))
  assert.deepEqual([r.maxDrawdown, r.peakIndex, r.troughIndex], [15, -1, 1])
  assert.equal(r.recoveredIndex, 2) // 5 ≥ 0 (pico inicial)
})

test("drawdown: pico, fundo, recuperação (+10 −4 −3 +5 +8)", () => {
  const r = drawdown(S([10, -4, -3, 5, 8]))
  // equity: 10, 6, 3, 8, 16  → pico 10 (idx 0), fundo 3 (idx 2): dd 7; recupera em idx 4 (16 ≥ 10)
  assert.deepEqual([r.maxDrawdown, r.peakIndex, r.troughIndex, r.recoveredIndex, r.currentDrawdown], [7, 0, 2, 4, 0])
})

test("drawdown: não recuperado + drawdown atual; empate NÃO zera o drawdown (pico exige > estrito)", () => {
  const r = drawdown(S([10, -6, 6, -1]))
  // equity 10, 4, 10, 9 → pico 10 (idx 0), dd 6 no idx 1; idx 2 volta a 10 (≥ pico) = recuperado
  assert.deepEqual([r.maxDrawdown, r.recoveredIndex, r.currentDrawdown], [6, 2, 1])
  const r2 = drawdown(S([10, -6, 5]))
  assert.deepEqual([r2.maxDrawdown, r2.recoveredIndex, r2.currentDrawdown], [6, null, 1])
})

test("drawdown: 2 drawdowns iguais → vale o PRIMEIRO (determinístico)", () => {
  const r = drawdown(S([5, -5, 5, -5]))
  assert.deepEqual([r.maxDrawdown, r.peakIndex, r.troughIndex], [5, 0, 1])
})

// ── streaks ──────────────────────────────────────────────────────────────────

test("streaks: W L L W W W L → vitórias 3 (idx 3), derrotas 2 (idx 1), atual = derrota 1", () => {
  const r = streaks(S([5, -1, -1, 2, 2, 2, -3]))
  assert.deepEqual([r.maxWins, r.maxWinsStart, r.maxLosses, r.maxLossesStart, r.currentType, r.currentLength], [3, 3, 2, 1, "LOSS", 1])
})

test("streaks: empate (0) QUEBRA as duas sequências", () => {
  const r = streaks(S([1, 1, 0, 1, 1]))
  assert.deepEqual([r.maxWins, r.currentType, r.currentLength], [2, "WIN", 2])
  assert.equal(streaks(S([1, 1, 0])).currentType, null) // último foi empate
})

test("streaks: vazio, só ganhos, só perdas, empate de sequências = primeira ocorrência", () => {
  assert.deepEqual(streaks([]), { maxWins: 0, maxWinsStart: -1, maxLosses: 0, maxLossesStart: -1, currentType: null, currentLength: 0 })
  assert.equal(streaks(S([1, 2, 3])).maxWins, 3)
  assert.equal(streaks(S([-1, -2])).maxLosses, 2)
  const r = streaks(S([1, 1, -1, 1, 1]))
  assert.deepEqual([r.maxWins, r.maxWinsStart], [2, 0])
})

console.log(`\n${passed} testes ok`)
