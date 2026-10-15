// E6.6-1: formatador de slots (format.ts) + catálogo de motivos. Testes escritos ANTES do código (src/lib/agent/format.ts ainda NÃO existe).
// Expectativa: scripts/expectations/agent-answer.expected.json → format_matrix, e66_1.format_cells_added, e66_1.oracle_bigint, e66_1.reason_catalog, e66_1.enum_words_add.
// O ORÁCULO é independente: monta o texto só com BigInt (divisão/módulo), sem toFixed, sem Math.round, sem Intl.
//   node scripts/test-agent-format.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { REASON_TEXTS, formatDate, formatEnum, formatNumber, formatUnavailable } from "../src/lib/agent/format.ts"
import { calculateMetrics } from "../src/lib/metrics/index.ts"
import { mk } from "./_metrics-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (f: string) => readFileSync(`${ROOT}${f}`, "utf8")
const exp: Any = JSON.parse(read("scripts/expectations/agent-answer.expected.json"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

const fmt = (v: unknown, u: unknown): Any => formatNumber(v as never, u as never)
const okText = (v: unknown, u: string): string => { const r = fmt(v, u); assert.equal(r.ok, true, `${u} ${String(v)} deveria formatar (${JSON.stringify(r)})`); return r.text }
const bad = (v: unknown, u: string, why = ""): void => { const r = fmt(v, u); assert.deepEqual(r, { ok: false, code: "FORMAT_INVALID" }, `${u} ${String(v)} deveria ser erro ${why}`) }
/** célula do JSON: "ERRO ..." = erro; senão o texto exato. A chave "-0" vira -0. */
const cell = (u: string, key: string, expected: string): void => {
  const v = Number(key)
  if (expected.startsWith("ERRO")) bad(v, u, `(${expected})`)
  else assert.equal(okText(v, u), expected, `${u} ${key}`)
}

test("F1 — format_matrix (count, usd, R, percent, ratio, points): cada célula derivada à mão", () => {
  let n = 0
  for (const u of ["count", "usd", "R", "percent", "ratio", "points"]) for (const [k, e] of Object.entries(exp.format_matrix[u] as Record<string, string>)) { cell(u, k, e); n += 1 }
  assert.equal(n, 41, "células da format_matrix (6+9+6+5+5+10, contadas à mão)")
})

test("F2 — células novas (Q16 fraction, Q18 price, limites 1e12) do e66_1.format_cells_added", () => {
  const c = exp.e66_1.format_cells_added
  for (const u of ["fraction", "price"]) for (const [k, e] of Object.entries(c[u] as Record<string, string>)) cell(u, k, e)
  for (const [k, e] of Object.entries(c.limits as Record<string, string>)) {
    const m = /^(\w+) (-?\d+(?:\.\d+)?)$/.exec(k)
    assert.ok(m, k)
    cell(m![1], m![2], e)
  }
})

test("F3 — -0 sai igual a 0 em TODAS as unidades; entrada que não é número finito ⇒ erro, sem lançar", () => {
  for (const u of ["count", "usd", "R", "percent", "ratio", "points", "fraction", "price"]) {
    assert.equal(okText(-0, u), okText(0, u), `-0 em ${u}`)
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "12", null, undefined, {}, [], true, 10n]) {
      assert.doesNotThrow(() => fmt(v, u), `não pode lançar: ${String(v)}`)
      bad(v, u)
    }
  }
  assert.equal(okText(-0, "usd"), "US$ 0,00")
  assert.equal(okText(-0, "points"), "0,00 pts")
  assert.equal(okText(-0, "fraction"), "0,00%")
  for (const u of ["", "EUR", "usd ", "USD", 5, null, undefined, "__proto__", "constructor", "toString"]) { assert.doesNotThrow(() => fmt(1, u as never)); assert.deepEqual(fmt(1, u), { ok: false, code: "FORMAT_INVALID" }, `unidade inválida ${String(u)}`) }
})

test("F4 — forma exponencial: 1e-6 em points = '0,000001 pts'; 1e-7 ⇒ erro (7 casas); 1e21 ⇒ erro; 5e-324 ⇒ erro", () => {
  assert.equal(okText(1e-6, "points"), "0,000001 pts")
  assert.equal(okText(1e-6, "price"), "0,000001")
  bad(1e-7, "points")
  bad(1e-7, "price")
  bad(1e21, "count")
  bad(5e-324, "ratio")
  bad(1.5e-7, "fraction")
})

// ── ORÁCULO BigInt ───────────────────────────────────────────────────────────
const P10 = (d: number): bigint => 10n ** BigInt(d)
const groupInt = (i: bigint): string => i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
interface Spec { d: number; prefix?: string; suffix?: string; trim?: boolean }
const oracle = (n: bigint, s: Spec): string => {
  const neg = n < 0n
  const a = neg ? -n : n
  const ip = a / P10(s.d)
  let fs = s.d > 0 ? (a % P10(s.d)).toString().padStart(s.d, "0") : ""
  if (s.trim) while (fs.length > 2 && fs.endsWith("0")) fs = fs.slice(0, -1)
  const sign = neg && a !== 0n ? "-" : ""
  const body = groupInt(ip) + (fs ? `,${fs}` : "")
  return `${sign}${s.prefix ?? ""}${body}${s.suffix ?? ""}`
}
const N_VALUES: bigint[] = [0n, 1n, 9n, 10n, 11n, 99n, 100n, 101n, 999n, 1000n, 1001n, 12345n, 100000n, 123456n, 1234567n, 99999999n, 123456789012n, 99999999999999n]
// entrada (casas do VALOR do motor) e especificação da saída
const UNITS: Array<{ u: string; din: number; spec: Spec }> = [
  { u: "count", din: 0, spec: { d: 0 } },
  { u: "usd", din: 2, spec: { d: 2, prefix: "US$ " } },
  { u: "R", din: 4, spec: { d: 4, suffix: " R" } },
  { u: "percent", din: 2, spec: { d: 2, suffix: "%" } },
  { u: "ratio", din: 4, spec: { d: 4 } },
  { u: "points", din: 6, spec: { d: 6, suffix: " pts", trim: true } },
  { u: "fraction", din: 4, spec: { d: 2, suffix: "%" } }, // o MESMO inteiro n, a vírgula 2 casas à direita
  { u: "price", din: 6, spec: { d: 6, trim: true } },
]
// o oráculo do usd põe o sinal ANTES de 'US$' (sign + prefix) — igual ao contrato; o das demais põe na frente do número.

test("F5 — ORÁCULO BigInt: 8 unidades × 18 inteiros escalados × 2 sinais (≈290 comparações), valor = n / 10^d como o motor produz (fromScaled)", () => {
  let compared = 0
  for (const { u, din, spec } of UNITS) {
    for (const n0 of N_VALUES) for (const sg of [1n, -1n]) {
      const n = n0 * sg
      const value = Number(n) / 10 ** din
      const limitHit = n0 / P10(din) >= 1_000_000_000_000n // |valor| ≥ 1e12 (divisão inteira basta: o limite é um inteiro)
      const r = fmt(value, u)
      if (limitHit) assert.deepEqual(r, { ok: false, code: "FORMAT_INVALID" }, `${u} n=${n} (≥ 1e12)`)
      else { assert.equal(r.ok, true, `${u} n=${n} value=${value} → ${JSON.stringify(r)}`); assert.equal(r.text, oracle(n, spec), `${u} n=${n}`) }
      compared += 1
    }
  }
  assert.equal(compared, 8 * 18 * 2)
})

test("F6 — casa a MAIS (último dígito ≠ 0) é ERRO em toda unidade, nunca arredondamento (usd 12.345, R 1.00005, percent 5.555, ratio 0.12345, count 2.5, points/price 7 casas, fraction 5 casas)", () => {
  const extra: Array<[string, number]> = [["usd", 12.345], ["usd", -0.001], ["usd", 0.005], ["R", 1.00005], ["percent", 5.555], ["ratio", 0.12345], ["count", 2.5], ["count", 0.1], ["points", 1.1234567], ["price", 1.0876543], ["fraction", 0.12345], ["fraction", 0.00005]]
  for (const [u, v] of extra) bad(v, u)
  // varredura: para cada unidade de casas fixas, d+1 casas com último dígito ≠ 0
  for (const { u, din } of UNITS.filter((x) => x.u !== "points" && x.u !== "price")) for (const base of [1, 5, 15, 12345, 99999]) bad(Number(`${base}e-${din + 1}`), u, `(${base}e-${din + 1})`)
  for (const base of [1, 5, 15, 12345, 99999]) { bad(Number(`${base}e-7`), "points"); bad(Number(`${base}e-7`), "price") }
})

test("F7 — decimal exato SEM aritmética de ponto flutuante: 0.1+0.2 (0.30000000000000004) é erro, 1.005 em usd é erro, 0.07 em usd é 'US$ 0,07' e 1.15 em ratio é '1,1500'", () => {
  bad(0.1 + 0.2, "usd")
  bad(1.005, "usd")
  assert.equal(okText(0.07, "usd"), "US$ 0,07")
  assert.equal(okText(1.15, "ratio"), "1,1500")
  assert.equal(okText(4.35, "usd"), "US$ 4,35") // 4.35 * 100 = 434.99999999999994 em float: aqui não pode virar erro nem 4,34
  assert.equal(okText(8.2, "R"), "8,2000 R")
  assert.equal(okText(0.29, "fraction"), "29,00%") // 0.29 * 100 = 28.999999999999996 em float
  assert.equal(okText(0.57, "fraction"), "57,00%") // 0.57 * 100 = 56.99999999999999
})

test("F8 — separadores: '.' de milhar e ',' decimal; nunca troca (nem ',' de milhar), e o resultado só tem os caracteres esperados", () => {
  for (const [v, u] of [[1234567.89, "usd"], [-98765.4321, "R"], [1234567, "count"], [1234.5, "points"], [21034.5, "price"]] as Array<[number, string]>) {
    const t = okText(v, u)
    assert.match(t, /^-?(?:US\$ )?\d{1,3}(?:\.\d{3})*(?:,\d+)?(?: R| pts|%)?$/, `${u}: ${t}`)
    assert.equal((t.match(/,/g) ?? []).length <= 1, true)
  }
  assert.equal(okText(1234567.89, "usd"), "US$ 1.234.567,89")
})

// ── catálogo de motivos ──────────────────────────────────────────────────────
const CAT: Record<string, string> = exp.e66_1.reason_catalog.texts

test("D1 — o catálogo tem EXATAMENTE os 30 códigos da expectativa, com os textos da expectativa; nenhum texto vazio nem com dígito", () => {
  assert.equal(exp.e66_1.reason_catalog.expected_count, 30)
  assert.deepEqual(Object.keys(REASON_TEXTS).sort(), Object.keys(CAT).sort())
  assert.equal(Object.keys(CAT).length, 30)
  for (const [k, t] of Object.entries(CAT)) {
    assert.equal(Object.getOwnPropertyDescriptor(REASON_TEXTS, k)?.value, t, k)
    assert.ok(t.length > 0 && !/\d/.test(t), `texto inválido em ${k}`)
  }
})

test("D1b — formatUnavailable: 'indisponível (' + texto + ')' para cada código; null, vazio, caixa/espaço trocados, protótipo, tipo errado ⇒ erro (nunca em branco, nunca fallback)", () => {
  for (const [k, t] of Object.entries(CAT)) assert.deepEqual(formatUnavailable(k), { ok: true, text: `indisponível (${t})` }, k)
  assert.equal((formatUnavailable("DENOMINATOR_ZERO") as Any).text, exp.e66_1.reason_catalog.rendered_examples.DENOMINATOR_ZERO)
  assert.equal((formatUnavailable("NO_TRADES") as Any).text, exp.e66_1.reason_catalog.rendered_examples.NO_TRADES)
  for (const x of [null, undefined, "", "denominator_zero", "DENOMINATOR_ZERO ", " DENOMINATOR_ZERO", "__proto__", "constructor", "toString", "hasOwnProperty", "NOT_A_CODE", 5, {}, []]) {
    assert.doesNotThrow(() => formatUnavailable(x as never))
    assert.deepEqual(formatUnavailable(x as never), { ok: false, code: "FORMAT_INVALID" }, String(x))
  }
})

test("D2 — varredura ESTÁTICA no motor: todo literal que parece código de indisponibilidade em calculate.ts/analysis.ts está no catálogo (LIMITAÇÃO: prova texto; o prefixo é heurística)", () => {
  const PREFIX = /^(?:NO_|DENOMINATOR_|NUMERATOR_|UNAVAILABLE|RATIO_|MIXED_|R_UNAVAILABLE$|METRIC_NOT_COMPUTED$|VALUE_NOT_AVAILABLE|UNKNOWN_INSTRUMENT$)/
  const found = new Set<string>()
  for (const f of ["src/lib/metrics/calculate.ts", "src/lib/metrics/analysis.ts"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    for (const m of code.matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)) if (PREFIX.test(m[1])) found.add(m[1])
  }
  assert.ok(found.size >= 20, `a varredura achou só ${found.size} literais (regex quebrada?)`)
  const missing = [...found].filter((c) => !Object.hasOwn(CAT, c))
  assert.deepEqual(missing, [], "código do motor sem texto no catálogo")
})

test("D3 — varredura em EXECUÇÃO: todo `reason` não-null de calculateMetrics (vazio, sem pnl, sem perdedores, vários instrumentos, instrumento desconhecido, sem R) está no catálogo (LIMITAÇÃO: só estes cenários)", () => {
  const seen = new Set<string>()
  const collect = (trades: Parameters<typeof calculateMetrics>[0]): void => { for (const m of Object.values(calculateMetrics(trades).metrics) as Any[]) if (m.reason) seen.add(m.reason) }
  const win = (id: string, root = "MNQ") => mk({ id, root, direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-05 09:30:00", exitAt: "2026-01-05 09:40:00" })
  collect([])
  collect([win("w1")])
  collect([win("w1"), win("w2", "ES")])
  collect([win("w1", "XYZ")])
  collect([mk({ id: "l1", direction: "LONG", entry: 110, exit: 100, entryAt: "2026-01-05 09:30:00", exitAt: "2026-01-05 09:40:00", stop: 105 })])
  assert.ok(seen.size >= 6, `cenários coletaram só ${[...seen].join(",")}`)
  const missing = [...seen].filter((c) => !Object.hasOwn(CAT, c))
  assert.deepEqual(missing, [])
  for (const must of ["NO_TRADES", "NO_LOSERS", "MIXED_INSTRUMENTS"]) assert.ok(seen.has(must), `o cenário deveria produzir ${must} (achei ${[...seen].join(",")})`)
})

// ── datas e palavras de enum ─────────────────────────────────────────────────
test("T1 — data AAAA-MM-DD ⇒ DD/MM/AAAA só para data de calendário real; qualquer outra forma ⇒ erro", () => {
  assert.deepEqual(formatDate("2026-01-05"), { ok: true, text: "05/01/2026" })
  assert.deepEqual(formatDate("2024-02-29"), { ok: true, text: "29/02/2024" })
  assert.deepEqual(formatDate("2000-02-29"), { ok: true, text: "29/02/2000" })
  assert.deepEqual(formatDate("2026-12-31"), { ok: true, text: "31/12/2026" })
  for (const x of ["2026-02-30", "2026-02-29", "2100-02-29", "2026-13-01", "2026-00-10", "2026-01-00", "2026-04-31", "2026-1-5", " 2026-01-05", "2026-01-05 ", "2026-01-05T10:00", "0000-01-01", "05/01/2026", "", "abc", null, undefined, 20260105, {}]) {
    assert.doesNotThrow(() => formatDate(x as never))
    assert.deepEqual(formatDate(x as never), { ok: false, code: "FORMAT_INVALID" }, String(x))
  }
})

test("T2 — palavras de enum (exitReason, sampleFlag, reconciliation, direction) = tabela da expectativa; código fora da tabela (inclusive protótipo e caixa diferente) ⇒ erro", () => {
  const W = exp.format_matrix.enum_words as Record<string, Record<string, string>>
  let n = 0
  for (const table of ["exitReason", "sampleFlag", "reconciliation", "direction"]) {
    for (const [code, word] of Object.entries(W[table])) { assert.deepEqual(formatEnum(table as never, code), { ok: true, text: word }, `${table}.${code}`); n += 1 }
    for (const x of ["target", "Target", "", "__proto__", "constructor", "toString", "hasOwnProperty", "NOPE", null, undefined, 5]) assert.deepEqual(formatEnum(table as never, x as never), { ok: false, code: "FORMAT_INVALID" }, `${table}:${String(x)}`)
  }
  assert.equal(n, 5 + 3 + 3 + 2)
  // E6.6-2b (PD-1 b): `basis` passou a ser tabela VÁLIDA (test-agent-basis-slot.mts); a lista de tabelas inválidas troca "basis" por "net"
  for (const t of ["net", "unknown", "", "__proto__", "constructor", null, undefined]) assert.deepEqual(formatEnum(t as never, "NET"), { ok: false, code: "FORMAT_INVALID" }, `tabela ${String(t)}`)
  for (const w of Object.values(W.exitReason).concat(Object.values(W.sampleFlag), Object.values(W.reconciliation), Object.values(W.direction))) assert.equal(/\d/.test(w), false, w)
})

test("N1 — nenhum erro devolve o valor de entrada (resultado de erro é SEMPRE exatamente { ok:false, code:'FORMAT_INVALID' })", () => {
  const MARK = "ZZ_MARCADOR_ZZ"
  const results = [fmt(MARK, "usd"), fmt(12.345, "usd"), formatUnavailable(MARK), formatDate(MARK), formatEnum("exitReason", MARK), formatEnum(MARK as never, "TARGET")]
  for (const r of results) { assert.deepEqual(r, { ok: false, code: "FORMAT_INVALID" }); assert.equal(JSON.stringify(r).includes(MARK), false) }
})

console.log(`\n${passed} testes ok`)
