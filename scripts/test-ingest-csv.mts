// Testes da camada CSV (tokenizador + números): node scripts/test-ingest-csv.mts
import assert from "node:assert/strict"
import { detectDelimiter, normalizeHeader, parseDelimited, parseNumber, type NumberLocale } from "../src/lib/ingest/csv.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const num = (s: string, l: NumberLocale = "AUTO") => {
  const r = parseNumber(s, l)
  assert.equal(r.ok, true, `"${s}" (${l}) → ${r.ok ? "" : r.code}`)
  return (r as { ok: true; value: number }).value
}
const code = (s: string, l: NumberLocale = "AUTO") => {
  const r = parseNumber(s, l)
  assert.equal(r.ok, false, `"${s}" (${l}) devia falhar`)
  return (r as { ok: false; code: string }).code
}

test("normalizeHeader: acentos, pontos, espaços (cabeçalhos reais do NT8 PT-BR e EN)", () => {
  assert.equal(normalizeHeader("Preço entrada"), "preco_entrada")
  assert.equal(normalizeHeader("Hora saída"), "hora_saida")
  assert.equal(normalizeHeader("Pos mercado."), "pos_mercado")
  assert.equal(normalizeHeader("Taxa de Compensação"), "taxa_de_compensacao")
  assert.equal(normalizeHeader("Acu lucro líquido"), "acu_lucro_liquido")
  assert.equal(normalizeHeader("Market pos."), "market_pos")
  assert.equal(normalizeHeader("Entry time"), "entry_time")
  assert.equal(normalizeHeader("Núm. Neg."), "num_neg")
})

test("detectDelimiter: ';' (NT8 BR), ',' e tab; vírgula dentro de aspas não conta", () => {
  assert.equal(detectDelimiter("Ativo;Conta;Qtd;Preço entrada"), ";")
  assert.equal(detectDelimiter("Instrument,Account,Qty"), ",")
  assert.equal(detectDelimiter("a\tb\tc"), "\t")
  assert.equal(detectDelimiter('"Ativo, longo";Conta'), ";")
})

test("parseDelimited: BOM, CRLF, linhas em branco, aspas com vírgula e aspas escapadas", () => {
  const t = parseDelimited('﻿a,b,c\r\n1,"x, y","diz ""oi"""\r\n\r\n2,z,w\r\n')
  assert.deepEqual(t.headers, ["a", "b", "c"])
  assert.equal(t.rows.length, 2)
  assert.deepEqual(t.rows[0].fields, { a: "1", b: "x, y", c: 'diz "oi"' })
  assert.equal(t.rows[0].rowNo, 2)
  assert.equal(t.rows[1].rowNo, 4) // numeração FÍSICA: a linha em branco conta
})

test("parseDelimited: quebra de linha dentro de aspas fica no mesmo campo", () => {
  const t = parseDelimited('a,b\n1,"linha1\nlinha2"\n')
  assert.equal(t.rows.length, 1)
  assert.equal(t.rows[0].fields.b, "linha1\nlinha2")
})

test("parseDelimited: cabeçalho duplicado é renomeado e avisado; coluna a menos gera aviso", () => {
  const t = parseDelimited("a,a,b\n1,2\n")
  assert.deepEqual(t.headers, ["a", "a_2", "b"])
  assert.ok(t.issues.some((i) => i.code === "W_HEADER_DUPLICATE"))
  assert.ok(t.issues.some((i) => i.code === "W_ROW_COLUMN_MISMATCH" && i.rowNo === 2))
})

test("parseDelimited: arquivo vazio → erro", () => {
  assert.equal(parseDelimited("   \n\n").issues[0].code, "E_FILE_EMPTY")
})

// ── números ──────────────────────────────────────────────────────────────────

test("BR explícito: '$ 1.234,56', '-$ 117,00' (espaço entre sinal e número, como o NT8), '0,00'", () => {
  assert.equal(num("$ 1.234,56", "BR"), 1234.56)
  assert.equal(num("-$ 117,00", "BR"), -117)
  assert.equal(num("R$ 134,20", "BR"), 134.2)
  assert.equal(num("0,00", "BR"), 0)
  assert.equal(num("1.234.567,89", "BR"), 1234567.89)
})

test("US explícito: '1,234.50', '-$12.50', '(123.45)', '12'", () => {
  assert.equal(num("1,234.50", "US"), 1234.5)
  assert.equal(num("-$12.50", "US"), -12.5)
  assert.equal(num("(123.45)", "US"), -123.45)
  assert.equal(num("12", "US"), 12)
  assert.equal(num("+7.5", "US"), 7.5)
})

test("locale explícito É validado: '134,20' em US e '134.20' em BR são erro (não viram 13420 / 13420)", () => {
  assert.equal(code("134,20", "US"), "E_NUMBER_FORMAT")
  assert.equal(code("134.20", "BR"), "E_NUMBER_FORMAT")
  assert.equal(code("1,23,456.00", "US"), "E_NUMBER_FORMAT")
})

test("AUTO: decide só quando inequívoco; milhar-ou-decimal sozinho é AMBÍGUO", () => {
  assert.equal(num("1.234,56"), 1234.56)
  assert.equal(num("1,234.56"), 1234.56)
  assert.equal(num("12,5"), 12.5)
  assert.equal(num("12.5"), 12.5)
  assert.equal(num("1,234,567"), 1234567)
  assert.equal(code("1,234"), "E_NUMBER_AMBIGUOUS")
  assert.equal(code("1.234"), "E_NUMBER_AMBIGUOUS")
})

test("números inválidos e vazios", () => {
  assert.equal(code("", "US"), "E_NUMBER_EMPTY")
  assert.equal(code("abc", "US"), "E_NUMBER_FORMAT")
  assert.equal(code("--5", "US"), "E_NUMBER_FORMAT")
  assert.equal(code("$", "US"), "E_NUMBER_FORMAT")
})

console.log(`\n${passed} testes ok`)
