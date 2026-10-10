// Métricas que dependem da ORDEM dos trades: curva de capital, drawdown e sequências.
// Trabalham sobre inteiros escalados (centavos ou R×1e4) — somas exatas.
//
// Definições (data-contract.md §Métricas):
//   equity_0 = 0;  equity_i = equity_{i-1} + v_i
//   peak_i   = max(0, max_{j≤i} equity_j)              (o capital inicial 0 conta como pico)
//   dd_i     = peak_i − equity_i  ≥ 0
//   maxDrawdown = max_i dd_i      (valor ABSOLUTO; sem % porque não conhecemos o saldo da conta)
//   currentDrawdown = dd_n
//   recuperado = 1º índice depois do fundo cuja equity ≥ pico do maxDrawdown (senão: ainda não recuperado)
// Pico novo exige equity ESTRITAMENTE maior (empate não zera o drawdown).

/** Métricas cujo resultado depende da ORDEM dos trades (todas usam `sequenceOrder`). Única lista: o trace e a Evidence leem daqui. */
export const SEQUENCE_METRICS = ["maxDrawdown", "currentDrawdown", "recoveryFactor", "maxDrawdownR", "maxConsecutiveWins", "maxConsecutiveLosses", "currentStreak"] as const

export interface SeqItem {
  id: string
  v: number
}

export interface DrawdownResult {
  maxDrawdown: number
  /** Índice do trade após o qual o pico foi atingido; -1 = capital inicial (antes do 1º trade). */
  peakIndex: number
  troughIndex: number
  recoveredIndex: number | null
  currentDrawdown: number
  finalEquity: number
  peakEquity: number
}

export function drawdown(seq: SeqItem[]): DrawdownResult {
  let eq = 0
  let peak = 0
  let peakIdx = -1
  let maxDD = 0
  let ddPeakIdx = -1
  let ddTroughIdx = -1
  let ddPeakVal = 0
  const eqs: number[] = []
  seq.forEach((s, i) => {
    eq += s.v
    eqs.push(eq)
    if (eq > peak) {
      peak = eq
      peakIdx = i
    }
    const dd = peak - eq
    if (dd > maxDD) {
      maxDD = dd
      ddPeakIdx = peakIdx
      ddTroughIdx = i
      ddPeakVal = peak
    }
  })
  let recovered: number | null = null
  if (maxDD > 0) {
    for (let j = ddTroughIdx + 1; j < eqs.length; j++) {
      if (eqs[j] >= ddPeakVal) {
        recovered = j
        break
      }
    }
  }
  return {
    maxDrawdown: maxDD,
    peakIndex: ddPeakIdx,
    troughIndex: ddTroughIdx,
    recoveredIndex: recovered,
    currentDrawdown: peak - eq,
    finalEquity: eq,
    peakEquity: peak,
  }
}

export interface StreakResult {
  maxWins: number
  maxWinsStart: number
  maxLosses: number
  maxLossesStart: number
  /** "WIN" | "LOSS" | null (último trade é empate ou não há trades) */
  currentType: "WIN" | "LOSS" | null
  currentLength: number
}

/**
 * Sequências consecutivas por sinal do P&L. Empate (0) QUEBRA ambas as sequências.
 * Em caso de sequências máximas iguais, vale a PRIMEIRA ocorrência (determinístico).
 */
export function streaks(seq: SeqItem[]): StreakResult {
  let maxW = 0, maxWStart = -1, maxL = 0, maxLStart = -1
  let w = 0, l = 0, wStart = -1, lStart = -1
  seq.forEach((s, i) => {
    if (s.v > 0) {
      if (w === 0) wStart = i
      w += 1
      l = 0
      if (w > maxW) { maxW = w; maxWStart = wStart }
    } else if (s.v < 0) {
      if (l === 0) lStart = i
      l += 1
      w = 0
      if (l > maxL) { maxL = l; maxLStart = lStart }
    } else {
      w = 0
      l = 0
    }
  })
  return {
    maxWins: maxW,
    maxWinsStart: maxWStart,
    maxLosses: maxL,
    maxLossesStart: maxLStart,
    currentType: w > 0 ? "WIN" : l > 0 ? "LOSS" : null,
    currentLength: Math.max(w, l),
  }
}
