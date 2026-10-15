// Formatador de slots do agente (E6.6-1): transforma o valor que o MOTOR devolveu em texto pt-BR. É o servidor quem escreve os números (D2); o modelo só aponta o slot.
// Regras (expectativa: scripts/expectations/agent-answer.expected.json → format_matrix e e66_1):
//   · EXATO e determinístico: lê o número pela sua representação decimal mais curta (String) e trabalha em TEXTO; sem toFixed, Math.round, Intl nem relógio.
//   · NUNCA arredonda: valor com mais casas que a unidade permite é ERRO (fail-closed, Q17). O valor já vem arredondado pelo motor.
//   · null nunca vira 0 nem texto em branco: só `formatUnavailable` com um código do catálogo.
// Todo erro é { ok:false, code:"FORMAT_INVALID" } — fixo, sem ecoar a entrada. Nenhuma função lança. Só `zod` e `./` (SG1); este arquivo não importa nada.

export const DISPLAY_UNITS = ["count", "usd", "R", "percent", "ratio", "points", "fraction", "price"] as const
export type DisplayUnit = (typeof DISPLAY_UNITS)[number]
export type FormatOk = { readonly ok: true; readonly text: string }
export type FormatError = { readonly ok: false; readonly code: "FORMAT_INVALID" }
export type FormatResult = FormatOk | FormatError

const fail = (): FormatError => ({ ok: false, code: "FORMAT_INVALID" })
const good = (text: string): FormatOk => ({ ok: true, text })

/** |valor| ≥ 1e12 ⇒ erro: acima disso a exatidão do double não é garantida. */
const MAX_ABS = 1e12

interface Parts { neg: boolean; int: string; frac: string }

/** Decompõe um número finito em sinal, parte inteira e fração (sem zeros à direita), SEM aritmética de ponto flutuante. */
function decimalParts(x: unknown): Parts | null {
  if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) >= MAX_ABS) return null
  let s = String(x)
  const neg = s.startsWith("-")
  if (neg) s = s.slice(1)
  let int: string
  let frac: string
  const exp = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (exp) {
    const digits = exp[1] + (exp[2] ?? "")
    const pointPos = exp[1].length + Number(exp[3])
    if (pointPos <= 0) { int = "0"; frac = "0".repeat(-pointPos) + digits }
    else if (pointPos >= digits.length) { int = digits + "0".repeat(pointPos - digits.length); frac = "" }
    else { int = digits.slice(0, pointPos); frac = digits.slice(pointPos) }
  } else {
    const dot = s.indexOf(".")
    int = dot < 0 ? s : s.slice(0, dot)
    frac = dot < 0 ? "" : s.slice(dot + 1)
  }
  frac = frac.replace(/0+$/, "")
  int = int.replace(/^0+(?=\d)/, "")
  return { neg, int, frac }
}

const groupThousands = (int: string): string => int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
const isZero = (...digits: string[]): boolean => /^0*$/.test(digits.join(""))

interface Spec { min: number; max: number; prefix?: string; suffix?: string }
const SPECS: Readonly<Record<Exclude<DisplayUnit, "fraction">, Spec>> = {
  count: { min: 0, max: 0 },
  usd: { min: 2, max: 2, prefix: "US$ " },
  R: { min: 4, max: 4, suffix: " R" },
  percent: { min: 2, max: 2, suffix: "%" },
  ratio: { min: 4, max: 4 },
  points: { min: 2, max: 6, suffix: " pts" },
  price: { min: 2, max: 6 },
}

/** Formata um número do motor na unidade de EXIBIÇÃO. Unidade desconhecida, não-número, não-finito, ≥ 1e12 ou com casa a mais ⇒ erro. */
export function formatNumber(value: number, unit: DisplayUnit): FormatResult {
  if (typeof unit !== "string" || !(DISPLAY_UNITS as readonly string[]).includes(unit)) return fail()
  const p = decimalParts(value)
  if (!p) return fail()
  if (unit === "fraction") {
    // fração do motor (4 casas) → percentual: o MESMO inteiro escalado, com a vírgula 2 casas à direita (0,2556 → 25,56%)
    if (p.frac.length > 4) return fail()
    const all = p.int + p.frac.padEnd(4, "0")
    const ip = all.slice(0, -2).replace(/^0+(?=\d)/, "") || "0"
    const fp = all.slice(-2)
    return good(`${p.neg && !isZero(ip, fp) ? "-" : ""}${groupThousands(ip)},${fp}%`)
  }
  const spec = SPECS[unit]
  if (p.frac.length > spec.max) return fail()
  const frac = p.frac.padEnd(spec.min, "0")
  const sign = p.neg && !isZero(p.int, frac) ? "-" : ""
  return good(`${sign}${spec.prefix ?? ""}${groupThousands(p.int)}${frac ? `,${frac}` : ""}${spec.suffix ?? ""}`)
}

// ── catálogo de motivos de indisponibilidade ─────────────────────────────────
// Códigos que o motor deixa em `reason` de um valor null (calculate.ts, analysis.ts). Texto pt-BR PROPOSTO (revisão de redação = O-G); os CÓDIGOS são o contrato.
// Um teste confere este catálogo contra o código-fonte do motor e contra a execução (código emitido sem texto ⇒ build falha). Sem texto de reserva.
export const REASON_TEXTS: Readonly<Record<string, string>> = Object.freeze({
  NO_DATA: "não há dado para calcular",
  NO_PNL_DATA: "não há resultado financeiro nos trades",
  NO_GROSS_PNL: "não há resultado bruto nos trades",
  NO_NET_PNL: "não há resultado líquido nos trades",
  NO_COMMISSION_DATA: "não há comissão registrada",
  NO_FEES_DATA: "não há taxas registradas",
  NO_WINNERS: "não há trade vencedor",
  NO_LOSERS: "não há trade perdedor",
  R_UNAVAILABLE: "o risco (R) não está disponível nos trades",
  NO_WINNING_R: "não há trade vencedor com R conhecido",
  NO_LOSING_R: "não há trade perdedor com R conhecido",
  NO_DRAWDOWN: "não houve rebaixamento no período",
  NO_TRADES: "não há trades",
  MIXED_INSTRUMENTS: "há mais de um instrumento e pontos de instrumentos diferentes não se somam",
  UNKNOWN_INSTRUMENT: "o instrumento é desconhecido",
  METRIC_NOT_COMPUTED: "a métrica não foi calculada",
  UNAVAILABLE: "valor indisponível",
  NO_LEGS: "não há ordens registradas",
  VALUE_NOT_AVAILABLE_ON_LEGS: "o valor não está disponível nas ordens",
  NUMERATOR_UNAVAILABLE: "o numerador não está disponível",
  DENOMINATOR_ZERO: "o denominador é zero",
  DENOMINATOR_UNAVAILABLE: "o denominador não está disponível",
  DENOMINATOR_PARTIAL_COVERAGE: "o denominador tem cobertura parcial",
  NO_GROUP_WITH_NET: "nenhum grupo tem resultado líquido",
  UNAVAILABLE_BOTH: "o valor não está disponível em nenhum dos dois lados da comparação",
  UNAVAILABLE_A: "o valor não está disponível no lado A da comparação",
  UNAVAILABLE_B: "o valor não está disponível no lado B da comparação",
  RATIO_A_ZERO: "o valor de A é zero e a razão não se aplica",
  RATIO_SIGN_DIFFERS: "os valores têm sinais opostos e a razão não se aplica",
})

/** Texto cru do motivo (sem moldura). Código ausente do catálogo, null, vazio ou de outro tipo ⇒ erro. */
export function reasonText(reason: unknown): FormatResult {
  return typeof reason === "string" && Object.hasOwn(REASON_TEXTS, reason) ? good(REASON_TEXTS[reason]) : fail()
}

/** Valor null com motivo: `indisponível (<texto>)`. Nunca em branco, nunca zero. */
export function formatUnavailable(reason: string | null): FormatResult {
  const r = reasonText(reason)
  return r.ok ? good(`indisponível (${r.text})`) : r
}

// ── datas e palavras de enum ─────────────────────────────────────────────────
/** AAAA-MM-DD ⇒ DD/MM/AAAA. Só data de calendário real (ano ≥ 1); qualquer outra forma ⇒ erro. */
export function formatDate(iso: string): FormatResult {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  if (!m) return fail()
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > dim[mo - 1]) return fail()
  return good(`${m[3]}/${m[2]}/${m[1]}`)
}

export const ENUM_WORDS = Object.freeze({
  exitReason: Object.freeze({ TARGET: "alvo", STOP: "stop", MANUAL: "manual", MIXED: "misto", UNKNOWN: "desconhecido" }),
  sampleFlag: Object.freeze({ OK: "amostra adequada", LOW: "amostra pequena", TINY: "amostra mínima" }),
  reconciliation: Object.freeze({ RECONCILED: "conciliado", DIVERGENT: "divergente", NOT_COMPARABLE: "não comparável" }),
  direction: Object.freeze({ LONG: "compra", SHORT: "venda" }),
  /** E6.6-7b (#6 do review do Gemini): a UNIDADE de contagem de uma linha da quebra de saída; TRADE e LEG nunca se somam, então a palavra viaja no slot ao lado do número. */
  bucketUnit: Object.freeze({ TRADE: "trades", LEG: "pernas" }),
  /** E6.6-2b (PD-1 b): a BASE do valor (muda o significado do número); `metrics[].basis` é folha de slot e o validador exige o slot para estas palavras. */
  basis: Object.freeze({ NET: "líquido", GROSS: "bruto", R_NET: "R líquido", R_POINTS: "R em pontos" }),
})
export type EnumTable = keyof typeof ENUM_WORDS

/** Palavra pt-BR de um código de enum. Tabela ou código fora do conjunto (inclusive protótipo e caixa diferente) ⇒ erro. */
export function formatEnum(table: EnumTable, code: string): FormatResult {
  if (typeof table !== "string" || !Object.hasOwn(ENUM_WORDS, table)) return fail()
  const words: Readonly<Record<string, string>> = ENUM_WORDS[table]
  return typeof code === "string" && Object.hasOwn(words, code) ? good(words[code]) : fail()
}
