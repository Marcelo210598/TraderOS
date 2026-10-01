// Risco, R-multiple e excursões (MFE/MAE) do domínio canônico (docs/ai-partner/data-contract.md §Risco/§MFE-MAE).
//
//   riskPoints = |entrada − stop| (pontos por contrato), com o stop do LADO CERTO (long: abaixo; short: acima)
//   riskUsd    = riskPoints × pointValue × quantidade        (pointValue null → null)
//   R (líquido)= netPnl / riskUsd                           (só se netPnl E riskUsd existem)
//   R (pontos) = pointsPerContract / riskPoints             (independe de custos, qty e pointValue — rótulo próprio)
//   MFE/MAE    = pontos POR CONTRATO, positivos; fonte em dólar/pontos é convertida e, sem unidade ou sem pointValue, vira null.
// Nada é estimado em silêncio: cada função devolve o MOTIVO quando não consegue.

export type RiskReason = "STOP_MISSING" | "STOP_WRONG_SIDE" | "STOP_EQUALS_ENTRY"
export type RReason = "NET_PNL_UNAVAILABLE" | "RISK_UNKNOWN" | "RISK_USD_UNAVAILABLE"
export type ExcursionUnit = "POINTS_PER_CONTRACT" | "USD_TOTAL" | "USD_PER_CONTRACT"
export type ExcursionReason = "NOT_PROVIDED" | "UNIT_UNKNOWN" | "POINT_VALUE_UNKNOWN" | "NOT_A_NUMBER"

export interface RiskResult {
  riskPoints: number | null
  riskUsd: number | null
  reason: RiskReason | null
}

export function computeRisk(args: {
  direction: "LONG" | "SHORT"
  entryPrice: number
  stopPrice: number | null
  quantity: number
  pointValue: number | null
}): RiskResult {
  const { direction, entryPrice, stopPrice, quantity, pointValue } = args
  if (stopPrice === null) return { riskPoints: null, riskUsd: null, reason: "STOP_MISSING" }
  const adverse = direction === "LONG" ? entryPrice - stopPrice : stopPrice - entryPrice
  if (adverse === 0) return { riskPoints: null, riskUsd: null, reason: "STOP_EQUALS_ENTRY" }
  if (adverse < 0) return { riskPoints: null, riskUsd: null, reason: "STOP_WRONG_SIDE" }
  const riskPoints = Math.round(adverse * 1e6) / 1e6
  const riskUsd = pointValue === null ? null : Math.round(riskPoints * pointValue * quantity * 100) / 100
  return { riskPoints, riskUsd, reason: null }
}

export interface RResult {
  value: number | null
  reason: RReason | null
}

/** R canônico = P&L LÍQUIDO / risco em dólar. Sem líquido ou sem risco → null com motivo (nunca estimado). */
export function rMultipleNet(args: { netPnl: number | null; riskUsd: number | null; riskKnown: boolean }): RResult {
  if (!args.riskKnown) return { value: null, reason: "RISK_UNKNOWN" }
  if (args.riskUsd === null || args.riskUsd <= 0) return { value: null, reason: "RISK_USD_UNAVAILABLE" }
  if (args.netPnl === null) return { value: null, reason: "NET_PNL_UNAVAILABLE" }
  return { value: Math.round((args.netPnl / args.riskUsd) * 1e4) / 1e4, reason: null }
}

/** R em pontos (sem custos) — complementar ao R líquido; nunca misturar os dois na mesma métrica sem rotular. */
export function rMultiplePoints(args: { pointsPerContract: number; riskPoints: number | null }): number | null {
  if (args.riskPoints === null || args.riskPoints <= 0) return null
  return Math.round((args.pointsPerContract / args.riskPoints) * 1e4) / 1e4
}

export interface ExcursionResult {
  /** Pontos por contrato, valor absoluto. */
  points: number | null
  reason: ExcursionReason | null
}

export function normalizeExcursion(args: {
  value: number | null
  unit: ExcursionUnit | null
  quantity: number
  pointValue: number | null
}): ExcursionResult {
  const { value, unit, quantity, pointValue } = args
  if (value === null) return { points: null, reason: "NOT_PROVIDED" }
  if (!Number.isFinite(value)) return { points: null, reason: "NOT_A_NUMBER" }
  if (unit === null) return { points: null, reason: "UNIT_UNKNOWN" } // número sem unidade NÃO é gravado como pontos
  const abs = Math.abs(value)
  if (unit === "POINTS_PER_CONTRACT") return { points: abs, reason: null }
  if (pointValue === null || pointValue <= 0) return { points: null, reason: "POINT_VALUE_UNKNOWN" }
  if (unit === "USD_PER_CONTRACT") return { points: Math.round((abs / pointValue) * 1e6) / 1e6, reason: null }
  return { points: Math.round((abs / (pointValue * quantity)) * 1e6) / 1e6, reason: null }
}

export interface ExcursionIssue {
  code: "W_MFE_LT_REALIZED" | "W_MAE_LT_REALIZED"
  message: string
}

/**
 * Coerência: o melhor ponto do trade (MFE) não pode ser pior que o resultado realizado a favor; o pior (MAE) não pode
 * ser menor que o realizado contra. Tolerância pequena p/ arredondamento de conversão $→pontos.
 */
export function checkExcursionConsistency(args: {
  pointsPerContract: number
  mfePoints: number | null
  maePoints: number | null
  tolerance?: number
}): ExcursionIssue[] {
  const tol = args.tolerance ?? 0.05
  const out: ExcursionIssue[] = []
  const favorable = Math.max(0, args.pointsPerContract)
  const adverse = Math.max(0, -args.pointsPerContract)
  if (args.mfePoints !== null && args.mfePoints + tol < favorable) {
    out.push({ code: "W_MFE_LT_REALIZED", message: `MFE (${args.mfePoints}) menor que o ganho realizado (${favorable}) — unidade/fonte suspeita.` })
  }
  if (args.maePoints !== null && args.maePoints + tol < adverse) {
    out.push({ code: "W_MAE_LT_REALIZED", message: `MAE (${args.maePoints}) menor que a perda realizada (${adverse}) — unidade/fonte suspeita.` })
  }
  return out
}
