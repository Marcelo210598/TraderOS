// Guarda de MAE/MFE vindos do CSV/relatório do NinjaTrader 8.
//
// Trade MANUAL (sem estratégia) sai do NT8 com MAE = MFE = lucro bruto (e ETD = corretagem):
// não é excursão real. Medido em 03/11/2026 na conta Lucid. Só trades de estratégia trazem
// excursão real. Quando o par é idêntico e igual ao bruto, o dado é descartado (null) em vez
// de gravar um número falso no Journal.
//
// Só o caso de lucro foi observado em dado real; o de perda segue a mesma regra por simetria
// (MAE = MFE = bruto), mas não foi medido.

export type Nt8ExcursionInput = {
  maeUsd: number | null
  mfeUsd: number | null
  profitUsd: number // coluna Profit do NT8 (líquida de corretagem no export observado)
  feesUsd: number // Corretagem + taxas da linha
}

export type Nt8ExcursionResult = {
  maeUsd: number | null
  mfeUsd: number | null
  discarded: boolean
}

const CENT_TOLERANCE = 0.015

const finite = (v: number | null): number | null => (v !== null && Number.isFinite(v) ? v : null)
const close = (a: number, b: number) => Math.abs(a - b) <= CENT_TOLERANCE

export function guardNt8Excursion(input: Nt8ExcursionInput): Nt8ExcursionResult {
  const mae = finite(input.maeUsd)
  const mfe = finite(input.mfeUsd)
  if (mae === null || mfe === null) return { maeUsd: mae, mfeUsd: mfe, discarded: false }

  const gross = input.profitUsd + input.feesUsd
  const looksFake = close(mae, mfe) && close(mae, gross) && !close(gross, 0)
  if (looksFake) return { maeUsd: null, mfeUsd: null, discarded: true }
  return { maeUsd: mae, mfeUsd: mfe, discarded: false }
}
