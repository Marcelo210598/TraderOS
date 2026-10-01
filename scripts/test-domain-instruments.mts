// Testes do catálogo de instrumentos / símbolos (sem framework): node scripts/test-domain-instruments.mts
import assert from "node:assert/strict"
import {
  getInstrumentSpec,
  parseContractSymbol,
  pointValueOrNull,
  requirePointValue,
  UnknownInstrumentError,
} from "../src/lib/domain/instruments.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

test("pointValue dos instrumentos conhecidos bate com a tabela já usada no app", () => {
  const esperado: Record<string, number> = { NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, RTY: 50, CL: 1000, GC: 100, SI: 5000, ZB: 1000, "6E": 125000 }
  for (const [root, pv] of Object.entries(esperado)) assert.equal(pointValueOrNull(root), pv, root)
})

test("instrumento DESCONHECIDO → pointValue null (nunca 20 do NQ)", () => {
  for (const s of ["XYZ", "ABC", "NQ1!", "", "  ", "M2K", "mnq1"]) {
    assert.equal(pointValueOrNull(s), null, `"${s}"`)
  }
  assert.equal(pointValueOrNull(null), null)
  assert.equal(pointValueOrNull(undefined), null)
})

test("requirePointValue lança erro explícito para desconhecido", () => {
  assert.throws(() => requirePointValue("XYZ"), UnknownInstrumentError)
  assert.throws(() => requirePointValue(null), (e: unknown) => (e as UnknownInstrumentError).code === "E_INSTRUMENT_UNKNOWN")
  assert.equal(requirePointValue("mnq"), 2) // normaliza caixa
})

test("MNQ e MES são micros dos contratos cheios", () => {
  assert.equal(getInstrumentSpec("MNQ")?.microOf, "NQ")
  assert.equal(getInstrumentSpec("MES")?.microOf, "ES")
  assert.equal(getInstrumentSpec("NQ")?.microOf, undefined)
})

test("parseContractSymbol: raiz pura", () => {
  const p = parseContractSymbol("MNQ")
  assert.equal(p.root, "MNQ")
  assert.equal(p.contract, null)
  assert.equal(p.status, "KNOWN_ROOT")
})

test("parseContractSymbol: código de mês + ano (1, 2 dígitos)", () => {
  const a = parseContractSymbol("NQZ6")
  assert.deepEqual([a.root, a.contract?.monthCode, a.contract?.month, a.contract?.yearDigits], ["NQ", "Z", 12, "6"])
  const b = parseContractSymbol("MNQH26")
  assert.deepEqual([b.root, b.contract?.monthCode, b.contract?.month, b.contract?.yearDigits], ["MNQ", "H", 3, "26"])
  const c = parseContractSymbol("6EH6")
  assert.deepEqual([c.root, c.contract?.month], ["6E", 3])
})

test("parseContractSymbol: formato NinjaTrader 'NQ 06-25' / 'MNQ 12-26'", () => {
  const a = parseContractSymbol("NQ 06-25")
  assert.deepEqual([a.root, a.contract?.monthCode, a.contract?.month, a.contract?.yearDigits], ["NQ", "M", 6, "25"])
  const b = parseContractSymbol("MNQ 12-26")
  assert.deepEqual([b.root, b.contract?.monthCode, b.contract?.yearDigits], ["MNQ", "Z", "26"])
})

test("parseContractSymbol: MNQZ6 casa MNQ (prefixo mais longo), não NQ", () => {
  assert.equal(parseContractSymbol("MNQZ6").root, "MNQ")
  assert.equal(parseContractSymbol("MESZ6").root, "MES")
})

test("parseContractSymbol: raiz desconhecida ou lixo → root null, nunca um palpite", () => {
  for (const s of ["XYZH6", "NQ1!", "NQX", "FOO 06-25", "NQ 13-25"]) {
    const p = parseContractSymbol(s)
    assert.equal(p.root, null, s)
    assert.equal(p.status, "UNKNOWN_ROOT", s)
  }
  assert.equal(parseContractSymbol("").status, "EMPTY")
})

console.log(`\n${passed} testes ok`)
