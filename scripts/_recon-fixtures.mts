// Helper dos testes de reconstrução de ciclos: monta LINHAS DE LOTE (par casado entrada↔saída do NT8) como o pipeline as produz
// (trade-linha canônico + valores crus), a partir de valores pequenos e auditáveis à mão. Não é um teste.
import assert from "node:assert/strict"
import type { SourceMetadata } from "../src/lib/domain/canonical.ts"
import { pointValueOrNull } from "../src/lib/domain/instruments.ts"
import { parseLocalDateTime, type TimeValue } from "../src/lib/domain/time.ts"
import { buildCanonicalTrade } from "../src/lib/ingest/build-trade.ts"
import { validateTrade } from "../src/lib/ingest/validator.ts"
import type { LotRow } from "../src/lib/ingest/reconstruct.ts"

export const BRT = "America/Sao_Paulo"

const SRC: SourceMetadata = {
  platform: "NINJATRADER",
  parserId: "ninjatrader-trades-ptbr",
  parserVersion: "1.0.0",
  fileName: "synthetic.csv",
  fileHash: null,
  rowNo: null,
  externalId: null,
  settings: { sourceTz: BRT, sourceTzOrigin: "USER", dateOrder: "DMY", numberLocale: "BR", excursionUnit: "USD_TOTAL", declaredPnlBasis: "UNKNOWN" },
}

const T = (s: string, tz: string): TimeValue => {
  const r = parseLocalDateTime(s, { tz })
  assert.equal(r.ok, true, s)
  return (r as { ok: true; value: TimeValue }).value
}

export interface LotOpts {
  rowNo: number
  entryAt: string // "YYYY-MM-DD HH:mm:ss" no fuso tz
  exitAt: string
  entry: number
  exit: number
  qty?: number
  dir?: "LONG" | "SHORT"
  contract?: string // "MNQ 12-26"
  account?: string | null
  strategy?: string | null
  entryLabel?: string | null
  exitLabel?: string | null
  commission?: number
  /** extremos ABSOLUTOS do preço (a excursão é gravada em US$ totais da linha, como o NT8) */
  high?: number | null
  low?: number | null
  tz?: string
  profit?: number | null
  cumulative?: number | null
}

/** Linha de lote: P&L declarado NET (como o NT8): líquido = pontos × pointValue × qtd − comissão. */
export function lot(o: LotOpts): LotRow {
  const tz = o.tz ?? BRT
  const contract = o.contract ?? "MNQ 12-26"
  const root = contract.split(" ")[0]
  const pv = pointValueOrNull(root) as number
  const qty = o.qty ?? 1
  const dir = o.dir ?? "LONG"
  const commission = o.commission ?? 1
  const pts = dir === "LONG" ? o.exit - o.entry : o.entry - o.exit
  const net = Math.round((pts * pv * qty - commission) * 100) / 100
  const long = dir === "LONG"
  // US$ totais da linha: favorável/adverso medidos A PARTIR da entrada desta linha
  const mfePts = long ? (o.high == null ? null : o.high - o.entry) : o.low == null ? null : o.entry - o.low
  const maePts = long ? (o.low == null ? null : o.entry - o.low) : o.high == null ? null : o.high - o.entry
  const usd = (p: number | null) => (p === null ? null : Math.round(p * pv * qty * 100) / 100)
  const built = buildCanonicalTrade({
    source: { ...SRC, rowNo: o.rowNo, settings: { ...SRC.settings, sourceTz: tz } },
    accountName: o.account === undefined ? "Sim101" : o.account,
    instrumentRaw: contract,
    direction: dir,
    quantity: qty,
    entry: { at: T(o.entryAt, tz), price: o.entry },
    exit: { at: T(o.exitAt, tz), price: o.exit },
    reportedPnl: o.profit === undefined ? net : o.profit,
    declaredPnlBasis: "UNKNOWN", // inferida pelos preços (como no pipeline real)
    commission,
    fees: 0,
    mfeRaw: usd(mfePts),
    maeRaw: usd(maePts),
    excursionUnit: "USD_TOTAL",
    strategyName: o.strategy === undefined ? "S" : o.strategy,
    notes: null,
    sessionHint: null,
  })
  const v = validateTrade(built)
  return {
    rowNo: o.rowNo,
    trade: { ...built, dataQuality: v.dataQuality, issues: v.issues },
    meta: {
      entryLabel: o.entryLabel === undefined ? "Entry" : o.entryLabel,
      exitLabel: o.exitLabel === undefined ? "Target1" : o.exitLabel,
      reportedProfit: o.profit === undefined ? net : o.profit,
      maeUsd: usd(maePts),
      mfeUsd: usd(mfePts),
      etdUsd: null,
      bars: 0,
      cumulativeNetReported: o.cumulative === undefined ? null : o.cumulative,
    },
  }
}

export const D = "2026-02-02" // dia base dos cenários
export const at = (hms: string, day = D) => `${day} ${hms}`
