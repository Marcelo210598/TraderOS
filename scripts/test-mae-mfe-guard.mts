// Guarda de MAE/MFE do CSV do NT8: node scripts/test-mae-mfe-guard.mts
// Trade MANUAL (sem estratégia) sai do NT8 com MAE = MFE = lucro bruto (e ETD = corretagem):
// não é excursão real, é lixo. Medido em 03/11/2026 na conta Lucid (linhas 6 e 7 do relatório).
import assert from "node:assert/strict"
import { guardNt8Excursion } from "../src/lib/journal/mae-mfe-guard.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

test("Lucid linha 6 (manual): MAE=MFE=76,50 = lucro 75,50 + corretagem 1,00 → descarta", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: 76.5, mfeUsd: 76.5, profitUsd: 75.5, feesUsd: 1 }), { maeUsd: null, mfeUsd: null, discarded: true })
})

test("Lucid linha 7 (manual): MAE=MFE=143,00 = 142,00 + 1,00 → descarta", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: 143, mfeUsd: 143, profitUsd: 142, feesUsd: 1 }), { maeUsd: null, mfeUsd: null, discarded: true })
})

test("Sim101 linha 1 (estratégia): MAE 9,50 / MFE 13,00 são reais → mantém", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: 9.5, mfeUsd: 13, profitUsd: 4.6, feesUsd: 1.9 }), { maeUsd: 9.5, mfeUsd: 13, discarded: false })
})

test("Sim101 linha 5 (perda): MAE 10,00 / MFE 12,50 → mantém", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: 10, mfeUsd: 12.5, profitUsd: -7.4, feesUsd: 1.9 }), { maeUsd: 10, mfeUsd: 12.5, discarded: false })
})

test("trade manual de PERDA: MAE=MFE=|bruto| também é lixo? só descarta quando MFE=MAE=bruto exato; perda não bate → mantém (sem chute)", () => {
  // bruto = -10,00 (profit -11 + fees 1). MAE=MFE=10 ≠ bruto → regra não dispara.
  assert.deepEqual(guardNt8Excursion({ maeUsd: 10, mfeUsd: 10, profitUsd: -11, feesUsd: 1 }), { maeUsd: 10, mfeUsd: 10, discarded: false })
})

test("trade manual de perda com MAE=MFE=bruto (negativo): descarta", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: -10, mfeUsd: -10, profitUsd: -11, feesUsd: 1 }), { maeUsd: null, mfeUsd: null, discarded: true })
})

test("tolerância de centavos (arredondamento do CSV)", () => {
  assert.equal(guardNt8Excursion({ maeUsd: 76.5, mfeUsd: 76.5, profitUsd: 75.51, feesUsd: 1 }).discarded, true)
})

test("MAE ≠ MFE mas um deles = bruto: mantém (só descarta o par idêntico)", () => {
  assert.equal(guardNt8Excursion({ maeUsd: 20, mfeUsd: 76.5, profitUsd: 75.5, feesUsd: 1 }).discarded, false)
})

test("zeros (sem dado) ou lucro zero: não é descarte, só repassa", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: 0, mfeUsd: 0, profitUsd: -1, feesUsd: 1 }), { maeUsd: 0, mfeUsd: 0, discarded: false })
})

test("entradas nulas/NaN: repassa nulas sem descartar", () => {
  assert.deepEqual(guardNt8Excursion({ maeUsd: null, mfeUsd: null, profitUsd: 5, feesUsd: 1 }), { maeUsd: null, mfeUsd: null, discarded: false })
  assert.deepEqual(guardNt8Excursion({ maeUsd: NaN, mfeUsd: 5, profitUsd: 5, feesUsd: 1 }), { maeUsd: null, mfeUsd: 5, discarded: false })
})

console.log(`\n${passed} testes ok`)
