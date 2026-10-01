// Semântica de P&L do domínio canônico (docs/ai-partner/data-contract.md §P&L).
//
//   grossPnl   = resultado ANTES de custos
//   commission = corretagem (null = a fonte não informou)
//   fees       = taxas de bolsa/clearing/NFA etc. (null = a fonte não informou)
//   netPnl     = grossPnl − commission − fees          → só existe se a comissão é conhecida; senão NULL
//
// Regras duras:
//   - um P&L bruto NUNCA é chamado de líquido; um número de base desconhecida NÃO é nem bruto nem líquido
//     (fica em `reported`, com basis = UNKNOWN);
//   - a base pode ser DECLARADA pela fonte ou INFERIDA comparando com o cálculo por preços — e a origem fica registrada;
//   - sem pointValue não dá pra calcular por preços (null): nada de assumir NQ.
// Aritmética em number (centavos): arredondamos a 2 casas ao final; comparações usam tolerância.

export type PnlBasis = "GROSS" | "NET" | "UNKNOWN"
export type BasisSource = "SOURCE_DECLARED" | "INFERRED_FROM_PRICES" | "DERIVED_FROM_FILLS" | "UNDETERMINED"
/** COMPLETE = líquido de comissão E taxas informadas; COMMISSION_ONLY = a fonte não informou taxas; UNAVAILABLE = sem líquido. */
export type NetStatus = "COMPLETE" | "COMMISSION_ONLY" | "UNAVAILABLE"

export interface Pnl {
  /** Valor exatamente como a fonte reportou. */
  reported: number | null
  basis: PnlBasis
  basisSource: BasisSource
  gross: number | null
  commission: number | null
  fees: number | null
  net: number | null
  netStatus: NetStatus
  /** Bruto recalculado pelos preços (só se o pointValue é conhecido). Serve de prova/validação. */
  computedGross: number | null
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Soma monetária EXATA (em centavos inteiros): 0,7 + 0,6 + 0,3 = 1,6. `null` se QUALQUER parcela for null (não afirmamos o que não sabemos). */
export function sumMoney(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null
  const cents = values.reduce<number>((a, v) => a + Math.round((v as number) * 100), 0)
  return cents === 0 ? 0 : cents / 100
}

/** Variação de preço em pontos, POR CONTRATO, com sinal (positivo = a favor do trade). */
export function pointsPerContract(direction: "LONG" | "SHORT", entryPrice: number, exitPrice: number): number {
  const pts = direction === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice
  return Math.round(pts * 1e6) / 1e6
}

/** Bruto pelos preços. Sem pointValue → null (não dá pra saber o valor do ponto). */
export function computeGrossFromPrices(args: {
  direction: "LONG" | "SHORT"
  entryPrice: number
  exitPrice: number
  quantity: number
  pointValue: number | null
}): number | null {
  if (args.pointValue === null) return null
  return round2(pointsPerContract(args.direction, args.entryPrice, args.exitPrice) * args.pointValue * args.quantity)
}

/** Tolerância p/ comparar P&L reportado × calculado (arredondamento de preço médio, centavos). */
export function pnlTolerance(reference: number): number {
  return Math.max(0.05, Math.abs(reference) * 0.001)
}

const near = (a: number, b: number) => Math.abs(a - b) <= pnlTolerance(b)

export interface BuildPnlInput {
  reported: number | null
  /** Base declarada pela fonte (ex.: AddOn que já desconta comissão = NET). UNKNOWN → tentamos inferir. */
  declaredBasis: PnlBasis
  commission: number | null
  fees: number | null
  computedGross: number | null
  /**
   * O trade foi MONTADO a partir de fills (não existe um P&L reportado pela fonte): o bruto é o cálculo pelos preços
   * dos fills (fato, não palpite) e a origem fica registrada como DERIVED_FROM_FILLS.
   */
  grossFromFills?: boolean
}

export function buildPnl(input: BuildPnlInput): Pnl {
  const { reported, commission, fees, computedGross } = input
  const costs = commission === null ? null : commission + (fees ?? 0)

  if (input.grossFromFills) {
    const gross = computedGross
    const net = gross !== null && costs !== null ? round2(gross - costs) : null
    return {
      reported: null,
      basis: gross === null ? "UNKNOWN" : "GROSS",
      basisSource: gross === null ? "UNDETERMINED" : "DERIVED_FROM_FILLS",
      gross,
      commission,
      fees,
      net,
      netStatus: net === null ? "UNAVAILABLE" : fees === null ? "COMMISSION_ONLY" : "COMPLETE",
      computedGross,
    }
  }

  let basis: PnlBasis = input.declaredBasis
  let basisSource: BasisSource = input.declaredBasis === "UNKNOWN" ? "UNDETERMINED" : "SOURCE_DECLARED"

  if (basis === "UNKNOWN" && reported !== null && computedGross !== null) {
    if (near(reported, computedGross)) {
      basis = "GROSS"
      basisSource = "INFERRED_FROM_PRICES"
    } else if (costs !== null && near(reported, computedGross - costs)) {
      basis = "NET"
      basisSource = "INFERRED_FROM_PRICES"
    }
  }

  let gross: number | null = null
  let net: number | null = null
  let netStatus: NetStatus = "UNAVAILABLE"

  if (reported !== null) {
    if (basis === "GROSS") {
      gross = round2(reported)
      if (costs !== null) {
        net = round2(gross - costs)
        netStatus = fees === null ? "COMMISSION_ONLY" : "COMPLETE"
      }
    } else if (basis === "NET") {
      net = round2(reported)
      netStatus = costs === null ? "UNAVAILABLE" : fees === null ? "COMMISSION_ONLY" : "COMPLETE"
      if (costs !== null) gross = round2(net + costs) // só deriva o bruto se sabemos os custos que foram descontados
    }
    // basis UNKNOWN: não afirmamos bruto nem líquido.
  }

  return {
    reported,
    basis,
    basisSource,
    gross,
    commission,
    fees,
    net,
    netStatus,
    computedGross,
  }
}

export type PnlKind = "NET" | "GROSS" | "REPORTED_UNKNOWN_BASIS"

/**
 * O número que uma ANÁLISE deve usar, com o rótulo do que ele é. Prefere líquido; cai p/ bruto; por último o
 * reportado de base desconhecida. Quem agrega TEM que carregar o `kind` (nunca misturar sem avisar).
 */
export function analysisPnl(p: Pnl): { value: number; kind: PnlKind } | null {
  if (p.net !== null) return { value: p.net, kind: "NET" }
  if (p.gross !== null) return { value: p.gross, kind: "GROSS" }
  if (p.reported !== null) return { value: p.reported, kind: "REPORTED_UNKNOWN_BASIS" }
  return null
}
