// Identidade determinística do import e dos trades (Evidence, incremento E1). Puro: sem relógio, sem random, sem banco.
// Hash vem do adaptador `infra/hash.ts` (SHA-256). Nada aqui altera valores financeiros: só ADICIONA campos opcionais.
//
//   importId  = H(arquivo + parser + configurações efetivas)          — mesmo arquivo lido do mesmo jeito ⇒ mesmo id
//   rowHash   = H(conteúdo da linha, sem nº da linha e sem acumulado) — reordenar linhas não muda
//   tradeId   = H(importId + granularidade + identidade da reconstrução + rowHashes ordenados + ordinal de duplicata)
// Fora de qualquer hash: nome do arquivo, `importedAt`/`computedAt`, nº da linha, `account.sourceName` em claro.

import type { CanonicalTrade, ImportRecord } from "../domain/canonical.ts"
import { hashCanonical, sha256Hex } from "../infra/hash.ts"
import type { LotRow } from "./reconstruct.ts"
import { RECONSTRUCTION_VERSION } from "./reconstruct.ts"
import type { ReconstructionSummary } from "./types.ts"

const ACCOUNT_REF_DOMAIN = "meutrade/accountRef/1"
const ROW_HASH_VERSION = 1
const TRADE_ID_VERSION = 1
const IMPORT_ID_VERSION = 1

/** Fingerprint não reversível da conta. É um pseudônimo, não um segredo: sem `salt` é igual entre imports. */
export function accountRef(sourceName: string | null, salt = ""): string | null {
  const name = sourceName?.trim()
  if (!name) return null
  return `acc_${sha256Hex(`${ACCOUNT_REF_DOMAIN}\0${salt}\0${name}`).slice(0, 24)}`
}

export function describeText(text: string): Pick<ImportRecord, "fileSha256" | "hashBasis" | "fileBytes" | "hasBom" | "lineEnding"> {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  const lineEnding = kinds === 0 ? "NONE" : kinds > 1 ? "MIXED" : crlf > 0 ? "CRLF" : lf > 0 ? "LF" : "CR"
  return {
    fileSha256: sha256Hex(text),
    hashBasis: "UTF8_TEXT",
    fileBytes: Buffer.byteLength(text, "utf8"),
    hasBom: text.charCodeAt(0) === 0xfeff,
    lineEnding,
  }
}

export function buildImportRecord(args: {
  text: string
  fileName: string | null
  parser: { id: string; version: string }
  settings: ImportRecord["settings"]
  reconstruction: ReconstructionSummary | null
  reconstructionEnabled: boolean
  stats: { rowsRead: number; accepted: number; rejected: number }
}): ImportRecord {
  const file = describeText(args.text)
  const importId = `imp_${hashCanonical({
    v: IMPORT_ID_VERSION,
    fileSha256: file.fileSha256,
    parserId: args.parser.id,
    parserVersion: args.parser.version,
    settings: args.settings,
  }).slice(0, 32)}`
  return {
    importId,
    ...file,
    fileName: args.fileName,
    parserId: args.parser.id,
    parserVersion: args.parser.version,
    reconstructionMethod: args.reconstructionEnabled ? "NT8_ROW_INTERVALS_V1" : null,
    reconstructionVersion: args.reconstructionEnabled ? RECONSTRUCTION_VERSION : null,
    rowsRead: args.stats.rowsRead,
    rowsAccepted: args.stats.accepted,
    rowsRejected: args.stats.rejected,
    settings: args.settings,
  }
}

/** Hash do CONTEÚDO de uma linha da fonte. Inclui os horários crus (a linha NT8 não tem outra identidade) e não inclui rowNo. */
export function rowHashOf(lot: LotRow, salt = ""): string {
  const t = lot.trade
  const m = lot.meta
  return hashCanonical({
    v: ROW_HASH_VERSION,
    account: accountRef(t.account.sourceName, salt),
    strategy: t.labels.strategyName,
    instrument: t.instrument.raw,
    direction: t.direction,
    quantity: t.quantity,
    entry: { raw: t.entry.at.raw, utc: t.entry.at.instantUtc, price: t.entry.price, label: m.entryLabel },
    exit: { raw: t.exit.at.raw, utc: t.exit.at.instantUtc, price: t.exit.price, label: m.exitLabel },
    reportedProfit: m.reportedProfit,
    commission: t.pnl.commission,
    fees: t.pnl.fees,
    maeUsd: m.maeUsd,
    mfeUsd: m.mfeUsd,
    etdUsd: m.etdUsd,
    bars: m.bars,
  })
}

/**
 * Anexa `importId`, `account.ref`, `rowHash` (em sourceRows) e `tradeId`. Não toca em nenhum valor financeiro.
 * Duplicatas de conteúdo idêntico (mesmo import, mesmas linhas) ganham ordinal para não colidirem; o ordinal segue o nº da linha.
 */
export function assignIdentity(trades: CanonicalTrade[], ctx: { importId: string; rowHashByRowNo: Map<number, string>; salt?: string }): CanonicalTrade[] {
  const salt = ctx.salt ?? ""
  const prepared = trades.map((t) => {
    const cycle = t.granularity === "POSITION_CYCLE"
    const sourceRows = t.sourceRows?.map((r) => ({ ...r, rowHash: ctx.rowHashByRowNo.get(r.rowNo) ?? r.rowHash }))
    const rowNos = cycle ? (sourceRows ?? []).map((r) => r.rowNo) : t.source.rowNo !== null ? [t.source.rowNo] : []
    const hashes = rowNos.map((n) => ctx.rowHashByRowNo.get(n)).filter((h): h is string => !!h).sort()
    const base = hashCanonical({
      v: TRADE_ID_VERSION,
      importId: ctx.importId,
      granularity: cycle ? "POSITION_CYCLE" : "SOURCE_ROW",
      reconstruction: cycle && t.reconstruction ? { method: t.reconstruction.method, version: RECONSTRUCTION_VERSION } : null,
      rows: hashes,
    })
    return { t, sourceRows, base, minRow: rowNos.length ? Math.min(...rowNos) : Number.MAX_SAFE_INTEGER }
  })
  const groups = new Map<string, number[]>()
  prepared.forEach((p, i) => groups.set(p.base, [...(groups.get(p.base) ?? []), i]))
  const ordinal = new Map<number, number>()
  for (const idxs of groups.values()) [...idxs].sort((a, b) => prepared[a].minRow - prepared[b].minRow || a - b).forEach((i, k) => ordinal.set(i, k))

  return prepared.map((p, i) => ({
    ...p.t,
    ...(p.sourceRows ? { sourceRows: p.sourceRows } : {}),
    // trade-linha: o rowHash viaja no próprio trade (sem `sourceRows`, senão a Evidence perderia o elo até a linha)
    ...(p.t.granularity !== "POSITION_CYCLE" && p.t.source.rowNo !== null && ctx.rowHashByRowNo.has(p.t.source.rowNo)
      ? { source: { ...p.t.source, rowHash: ctx.rowHashByRowNo.get(p.t.source.rowNo) } }
      : {}),
    account: { ...p.t.account, ref: accountRef(p.t.account.sourceName, salt) },
    importId: ctx.importId,
    tradeId: `trd_${hashCanonical({ base: p.base, ordinal: ordinal.get(i) }).slice(0, 32)}`,
  }))
}
