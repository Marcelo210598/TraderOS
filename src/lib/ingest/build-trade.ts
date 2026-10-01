// Monta o CanonicalTrade a partir de valores JÁ TIPADOS (saída do Normalizer ou do agregador de execuções).
// Aqui só se aplica a semântica do domínio (pointValue do catálogo, P&L bruto/líquido, risco, R, excursões).
// Nenhum valor é inventado: o que não dá para saber vira null com motivo (e fica registrado em fieldProvenance).

import { SCHEMA_TRADE, type CanonicalTrade, type SourceMetadata } from "../domain/canonical.ts"
import { parseContractSymbol, pointValueOrNull } from "../domain/instruments.ts"
import { buildPnl, computeGrossFromPrices, pointsPerContract, type PnlBasis } from "../domain/pnl.ts"
import { computeRisk, normalizeExcursion, rMultipleNet, rMultiplePoints, type ExcursionUnit } from "../domain/risk.ts"
import type { TimeValue } from "../domain/time.ts"

export interface TradeDraft {
  source: SourceMetadata
  accountName: string | null
  instrumentRaw: string
  direction: "LONG" | "SHORT"
  quantity: number
  entry: { at: TimeValue; price: number }
  exit: { at: TimeValue; price: number }
  reportedPnl: number | null
  declaredPnlBasis: PnlBasis
  commission: number | null
  fees: number | null
  /** true = trade montado a partir de fills (bruto vem dos preços dos fills; não há P&L reportado). */
  grossFromFills?: boolean
  stopPrice?: number | null
  targetPrice?: number | null
  riskSource?: "SOURCE" | "USER" | "NONE"
  mfeRaw: number | null
  maeRaw: number | null
  excursionUnit: ExcursionUnit | null
  strategyName: string | null
  tags?: string[]
  notes: string | null
  sessionHint: "AM" | "PM" | "OVERNIGHT" | null
}

type Origin = "FILE" | "INFERRED" | "DERIVED" | "ABSENT"

export function buildCanonicalTrade(d: TradeDraft): CanonicalTrade {
  const sym = parseContractSymbol(d.instrumentRaw)
  const pointValue = pointValueOrNull(sym.root) // null se desconhecido — NUNCA o valor do NQ
  const ppc = pointsPerContract(d.direction, d.entry.price, d.exit.price)

  const computedGross = computeGrossFromPrices({
    direction: d.direction,
    entryPrice: d.entry.price,
    exitPrice: d.exit.price,
    quantity: d.quantity,
    pointValue,
  })
  const pnl = buildPnl({
    reported: d.reportedPnl,
    declaredBasis: d.declaredPnlBasis,
    commission: d.commission,
    fees: d.fees,
    computedGross,
    grossFromFills: d.grossFromFills,
  })

  const stopPrice = d.stopPrice ?? null
  const risk = computeRisk({ direction: d.direction, entryPrice: d.entry.price, stopPrice, quantity: d.quantity, pointValue })
  const rNet = rMultipleNet({ netPnl: pnl.net, riskUsd: risk.riskUsd, riskKnown: risk.riskPoints !== null })
  const rPts = rMultiplePoints({ pointsPerContract: ppc, riskPoints: risk.riskPoints })

  const mfe = normalizeExcursion({ value: d.mfeRaw, unit: d.excursionUnit, quantity: d.quantity, pointValue })
  const mae = normalizeExcursion({ value: d.maeRaw, unit: d.excursionUnit, quantity: d.quantity, pointValue })

  const prov: Record<string, Origin> = {
    "instrument.pointValue": pointValue === null ? "ABSENT" : "DERIVED", // do catálogo, não do arquivo
    "entry.at": d.entry.at.precision === "DATETIME" ? "FILE" : "ABSENT",
    "exit.at": d.exit.at.precision === "DATETIME" ? "FILE" : "ABSENT",
    "pnl.reported": d.reportedPnl === null ? "ABSENT" : "FILE",
    "pnl.basis": pnl.basisSource === "SOURCE_DECLARED" ? "FILE" : pnl.basisSource === "INFERRED_FROM_PRICES" ? "INFERRED" : pnl.basisSource === "DERIVED_FROM_FILLS" ? "DERIVED" : "ABSENT",
    "pnl.commission": d.commission === null ? "ABSENT" : "FILE",
    "pnl.fees": d.fees === null ? "ABSENT" : "FILE",
    "pnl.net": pnl.net === null ? "ABSENT" : pnl.basis === "NET" && pnl.basisSource === "SOURCE_DECLARED" ? "FILE" : "DERIVED",
    "risk.stop": stopPrice === null ? "ABSENT" : "FILE",
    "r.net": rNet.value === null ? "ABSENT" : "DERIVED",
    "excursions.mfe": mfe.points === null ? "ABSENT" : "FILE",
    "excursions.mae": mae.points === null ? "ABSENT" : "FILE",
  }

  return {
    schemaVersion: SCHEMA_TRADE,
    account: { sourceName: d.accountName },
    instrument: {
      raw: d.instrumentRaw,
      root: sym.root,
      contract: sym.contract,
      pointValue,
      status: sym.status,
    },
    direction: d.direction,
    quantity: d.quantity,
    entry: d.entry,
    exit: d.exit,
    pointsPerContract: ppc,
    pnl,
    risk: {
      stopPrice,
      targetPrice: d.targetPrice ?? null,
      riskPoints: risk.riskPoints,
      riskUsd: risk.riskUsd,
      riskSource: stopPrice === null ? "NONE" : d.riskSource ?? "SOURCE",
      reason: risk.reason,
    },
    r: { net: rNet.value, netReason: rNet.reason, points: rPts },
    excursions: { mfePoints: mfe.points, maePoints: mae.points, mfeReason: mfe.reason, maeReason: mae.reason },
    labels: { strategyName: d.strategyName, tags: d.tags ?? [], notes: d.notes },
    sessionHint: d.sessionHint,
    source: d.source,
    dataQuality: "PARTIAL", // definido de verdade pelo validador
    fieldProvenance: prov,
    issues: [],
  }
}
