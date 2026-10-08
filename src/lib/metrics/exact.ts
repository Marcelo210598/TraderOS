// Aritmética determinística do motor de métricas.
//
// Dinheiro é somado em CENTAVOS INTEIROS e R em décimos-de-milésimo (1e-4) inteiros: a soma de inteiros é exata
// (nada de 0,1 + 0,2 = 0,30000000000000004 nem 0,7 + 0,6 + 0,3 = 1,5999999999999999). Só no FIM convertemos de volta,
// com arredondamento "meio afasta do zero" feito por deslocamento decimal em texto (evita 1,005 → 1,00 do binário).
//
// Regras de arredondamento de saída (documentadas em docs/ai-partner/data-contract.md §Métricas):
//   dinheiro → 2 casas · R → 4 casas · percentual (0–100) → 2 casas · razões (PF, payoff, recovery) → 4 casas.

export const MONEY_DECIMALS = 2
export const R_DECIMALS = 4
export const PERCENT_DECIMALS = 2
export const RATIO_DECIMALS = 4

/** Desloca a vírgula decimal de `x` em `d` casas sem passar por multiplicação em ponto flutuante. */
function shift(x: number, d: number): number {
  const s = String(x)
  if (s.includes("e") || s.includes("E")) return x * 10 ** d // notação científica (valores minúsculos/enormes): fallback
  return Number(`${s}e${d}`)
}

/** Arredonda `x` a `decimals` casas, metade AFASTA do zero (−0,125 → −0,13; 1,005 → 1,01). */
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x
  const sign = x < 0 ? -1 : 1
  const r = Math.round(shift(Math.abs(x), decimals))
  const out = shift(r, -decimals)
  return out === 0 ? 0 : sign * out // sem "-0"
}

/** Valor decimal → inteiro escalado (ex.: 12.34, 2 → 1234). */
export function toScaled(x: number, decimals: number): number {
  const r = Math.round(shift(Math.abs(x), decimals))
  return x < 0 && r !== 0 ? -r : r
}

/** Inteiro escalado → decimal mais próximo (1234, 2 → 12.34). Inteiro ÷ potência de 10 é correto em IEEE-754. */
export function fromScaled(n: number, decimals: number): number {
  return n === 0 ? 0 : n / 10 ** decimals
}

export const toCents = (x: number): number => toScaled(x, MONEY_DECIMALS)
export const fromCents = (c: number): number => fromScaled(c, MONEY_DECIMALS)
export const toRScaled = (x: number): number => toScaled(x, R_DECIMALS)
export const fromRScaled = (s: number): number => fromScaled(s, R_DECIMALS)

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/** Mediana de inteiros escalados (par: média dos dois centrais, arredondada ao inteiro escalado). */
export function medianScaled(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : roundTo((s[mid - 1] + s[mid]) / 2, 0)
}

/** Média de inteiros escalados, arredondada ao inteiro escalado (meio afasta do zero). */
export function meanScaled(xs: number[]): number | null {
  return xs.length === 0 ? null : roundTo(sum(xs) / xs.length, 0)
}

/** Percentual 0–100 com 2 casas a partir de contagens inteiras (sem passar por 0,574…×100). */
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : fromScaled(roundTo((part * 10000) / whole, 0), PERCENT_DECIMALS)
}

/** Razão a/b com 4 casas (a, b inteiros escalados na MESMA escala). */
export function ratio(a: number, b: number): number | null {
  return b === 0 ? null : roundTo(a / b, RATIO_DECIMALS)
}
