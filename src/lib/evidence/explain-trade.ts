// explainTrade (Evidence E3): CanonicalTrade → TradeEvidence rastreável.
//   TradeEvidence → SourceRowRef{importId,rowNo,rowHash} → ImportRef
// PROJEÇÃO POR LISTA BRANCA: cada campo é copiado explicitamente (nunca `...trade`, `...source` etc.), então um campo novo
// no Canonical não vira Evidence — nem vaza — sem alguém decidir. Cópia fiel: NADA é recalculado (P&L, R, MAE/MFE, reconstrução).
// Puro: sem relógio, sem random, sem banco, sem rede, não relê o CSV. Não gera hash por trade (o `evidenceHash` é do bundle).

import type { CanonicalTrade, ImportRecord } from "../domain/canonical.ts"
import { accountRef as makeAccountRef, strategyRef as makeStrategyRef } from "../ingest/identity.ts"
import { findAccountNameLeak, redactFileName, redactReconstruction, type KnownAccount } from "./redact.ts"
import { ImportRefSchema, TradeEvidenceSchema, type ImportRef, type SourceRowRef, type TradeEvidence } from "./schema.ts"

export type ExplainErrorCode =
  | "E_IDENTITY_MISSING"
  | "E_IMPORT_MISMATCH"
  | "E_ACCOUNT_KEY_MISMATCH"
  | "E_ROWREF_DANGLING"
  | "E_ACCOUNT_NAME_LEAK"
  | "E_STRATEGY_NAME_LEAK"
  | "E_SCHEMA"

export interface ExplainNote {
  code: "N_ROWHASH_MISSING" | "N_SOURCE_ROWS_MISSING" | "N_FILENAME_REDACTED" | "N_FILENAME_OMITTED"
  message: string
}

export type ExplainTradeResult =
  | { ok: true; tradeEvidence: TradeEvidence; importRef: ImportRef; notes: ExplainNote[] }
  | { ok: false; code: ExplainErrorCode; message: string }

export interface ExplainOptions {
  /** Só usado se o trade não trouxer `account.ref` (precisa ser o MESMO sal do import). Também é o sal do `strategyRef`. */
  accountRefSalt?: string
  /**
   * TODAS as contas do import (nomes). Só com a lista COMPLETA o `fileName` é exposto (redigido); sem ela — ou incompleta — o
   * `ImportRef.fileName` é null. "Completa" = os nomes distintos somam `importRecord.accountCount` e incluem a conta do trade.
   * Nunca se tenta adivinhar contas pelo nome do arquivo. `explainTrades` monta a lista a partir dos trades do import.
   */
  knownAccountNames?: string[]
}

const fail = (code: ExplainErrorCode, message: string): ExplainTradeResult => ({ ok: false, code, message })

const timeOf = (t: CanonicalTrade["entry"]["at"]) => ({
  raw: t.raw,
  precision: t.precision,
  instantUtc: t.instantUtc,
  localDate: t.localDate,
  sourceTz: t.sourceTz,
  explicitOffset: t.explicitOffset,
  ambiguity: t.ambiguity,
})

const pnlOf = (p: CanonicalTrade["pnl"]) => ({
  reported: p.reported,
  basis: p.basis,
  basisSource: p.basisSource,
  gross: p.gross,
  commission: p.commission,
  fees: p.fees,
  net: p.net,
  netStatus: p.netStatus,
  computedGross: p.computedGross,
})

type EntryLeg = NonNullable<CanonicalTrade["entryLegs"]>[number]
type ExitLeg = NonNullable<CanonicalTrade["exitLegs"]>[number]

const entryLegOf = (l: EntryLeg) => ({
  at: timeOf(l.at),
  price: l.price,
  quantity: l.quantity,
  sourceLabel: l.sourceLabel,
  rowRefs: [...l.rowRefs],
  granularity: l.granularity,
  role: l.role,
})

const exitLegOf = (l: ExitLeg) => ({
  at: timeOf(l.at),
  price: l.price,
  quantity: l.quantity,
  sourceLabel: l.sourceLabel,
  rowRefs: [...l.rowRefs],
  granularity: l.granularity,
  role: l.role,
  sizeAfter: l.sizeAfter,
  simultaneous: l.simultaneous,
  reason: l.reason,
  reasonRule: l.reasonRule,
  pnl: { net: l.pnl.net, gross: l.pnl.gross, commission: l.pnl.commission, fees: l.pnl.fees },
})

/** Linhas de um ciclo: valores crus completos da fonte (FULL). */
function cycleRowRefs(trade: CanonicalTrade, importId: string): SourceRowRef[] {
  return (trade.sourceRows ?? []).map((r) => ({
    importId,
    rowNo: r.rowNo,
    rowHash: r.rowHash ?? null,
    detail: "FULL" as const,
    entryLeg: r.entryLeg,
    exitLeg: r.exitLeg,
    quantity: r.quantity,
    entryLabel: r.entryLabel,
    exitLabel: r.exitLabel,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    reportedProfit: r.reportedProfit,
    commission: r.commission,
    fees: r.fees,
    maeUsd: r.maeUsd,
    mfeUsd: r.mfeUsd,
    etdUsd: r.etdUsd,
    bars: r.bars,
    cumulativeNetReported: r.cumulativeNetReported,
  }))
}

/** Trade-linha: o próprio trade É a linha; só existem os valores dele (o resto fica null, declarado em `detail`). */
function rowTradeRef(trade: CanonicalTrade, importId: string): SourceRowRef[] {
  if (trade.source.rowNo === null) return []
  return [
    {
      importId,
      rowNo: trade.source.rowNo,
      rowHash: trade.source.rowHash ?? null,
      detail: "TRADE_VALUES",
      entryLeg: null,
      exitLeg: null,
      quantity: trade.quantity,
      entryLabel: null,
      exitLabel: null,
      entryPrice: trade.entry.price,
      exitPrice: trade.exit.price,
      reportedProfit: trade.pnl.reported,
      commission: trade.pnl.commission,
      fees: trade.pnl.fees,
      maeUsd: null,
      mfeUsd: null,
      etdUsd: null,
      bars: null,
      cumulativeNetReported: null,
    },
  ]
}

export function explainTrade(trade: CanonicalTrade, importRecord: ImportRecord, opts: ExplainOptions = {}): ExplainTradeResult {
  // 1) identidade: nunca fabricada
  if (!trade.tradeId || !trade.importId) return fail("E_IDENTITY_MISSING", "Trade sem tradeId/importId: a Evidence não fabrica identidade (rode o trade pelo pipeline de ingestão).")
  const { tradeId, importId } = trade
  if (importId !== importRecord.importId) return fail("E_IMPORT_MISMATCH", `trade.importId (${importId}) ≠ importRecord.importId (${importRecord.importId}).`)

  // 2) conta → accountRef
  const accountName = trade.account.sourceName
  const accountRef = trade.account.ref ?? makeAccountRef(accountName, opts.accountRefSalt ?? "")
  const rec = trade.reconstruction ?? null
  const strategyRef = makeStrategyRef(rec?.cycleKey.strategy ?? null, opts.accountRefSalt ?? "")
  if (rec && rec.cycleKey.account !== accountName) return fail("E_ACCOUNT_KEY_MISMATCH", "reconstruction.cycleKey.account ≠ account.sourceName: a conta do ciclo e a do trade divergem.")
  if (rec && (importRecord.reconstructionMethod !== rec.method || importRecord.reconstructionVersion === null)) {
    return fail("E_IMPORT_MISMATCH", `reconstrução do trade (${rec.method}) não bate com a do import (${importRecord.reconstructionMethod ?? "nenhuma"}).`)
  }

  // 3) linhas de origem
  const granularity = trade.granularity === "POSITION_CYCLE" ? ("POSITION_CYCLE" as const) : ("SOURCE_ROW" as const)
  const sourceRows = (granularity === "POSITION_CYCLE" ? cycleRowRefs(trade, importId) : rowTradeRef(trade, importId)).sort((a, b) => a.rowNo - b.rowNo)
  const rowNos = new Set(sourceRows.map((r) => r.rowNo))
  for (const [side, legs] of [["entryLegs", trade.entryLegs], ["exitLegs", trade.exitLegs]] as const) {
    for (const [i, leg] of (legs ?? []).entries()) {
      const missing = leg.rowRefs.filter((n) => !rowNos.has(n))
      if (missing.length) return fail("E_ROWREF_DANGLING", `${side}[${i}] aponta para a(s) linha(s) ${missing.join(", ")}, que não estão em sourceRows.`)
    }
  }
  const notes: ExplainNote[] = []
  if (sourceRows.length === 0) notes.push({ code: "N_SOURCE_ROWS_MISSING", message: "O trade não tem linhas de origem registradas: o elo até o arquivo está incompleto." })
  if (sourceRows.some((r) => r.rowHash === null)) notes.push({ code: "N_ROWHASH_MISSING", message: "Há linha(s) de origem sem rowHash: não dá para provar o conteúdo da linha." })
  const provenance = notes.length === 0 ? ("COMPLETE" as const) : ("INCOMPLETE" as const)

  // 4) projeção por lista branca
  const projected = {
    tradeId,
    importId,
    provenance,
    granularity,
    accountRef,
    instrument: { raw: trade.instrument.raw, root: trade.instrument.root },
    direction: trade.direction,
    quantity: trade.quantity,
    peakQuantity: trade.peakQuantity ?? null,
    entry: { at: timeOf(trade.entry.at), price: trade.entry.price },
    exit: { at: timeOf(trade.exit.at), price: trade.exit.price },
    pnl: pnlOf(trade.pnl),
    // cópia fiel (E5.0): o que a verificação precisa para refazer o fingerprint e as métricas de R e de pontos
    r: { net: trade.r.net, netReason: trade.r.netReason, points: trade.r.points },
    risk: { reason: trade.risk.reason },
    pointsPerContract: trade.pointsPerContract,
    entryLegs: trade.entryLegs ? trade.entryLegs.map(entryLegOf) : null,
    exitLegs: trade.exitLegs ? trade.exitLegs.map(exitLegOf) : null,
    exitSummary: trade.exitSummary
      ? { finalReason: trade.exitSummary.finalReason, finalReasons: [...trade.exitSummary.finalReasons], byReason: { ...trade.exitSummary.byReason }, mixed: trade.exitSummary.mixed }
      : null,
    reconstruction: rec ? redactReconstruction(rec, accountRef, strategyRef, importRecord.reconstructionVersion as string) : null,
    excursions: {
      mfePoints: trade.excursions.mfePoints,
      maePoints: trade.excursions.maePoints,
      mfeReason: trade.excursions.mfeReason,
      maeReason: trade.excursions.maeReason,
      highPrice: trade.excursions.highPrice ?? null,
      lowPrice: trade.excursions.lowPrice ?? null,
      conflict: trade.excursions.conflict ?? null,
      origin: trade.excursions.origin ?? null,
    },
    issues: trade.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message, field: i.field, rowNo: i.rowNo })),
    fieldProvenance: { ...trade.fieldProvenance },
    sourceRows,
  }
  const parsed = TradeEvidenceSchema.safeParse(projected)
  if (!parsed.success) return fail("E_SCHEMA", `TradeEvidence fora do schema evidence/1: ${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}`)

  // 5) ImportRef (o ImportRecord do E1, sem CSV). fileName: só sai com a lista COMPLETA de contas; senão null (sem heurística).
  const salt = opts.accountRefSalt ?? ""
  const known = [...new Set([...(accountName ? [accountName.trim()] : []), ...(opts.knownAccountNames ?? []).map((n) => n.trim())].filter((n) => n !== ""))]
  const accounts: KnownAccount[] = known.map((name) => ({ name, ref: (name === accountName?.trim() ? accountRef : null) ?? makeAccountRef(name, salt) ?? "acc_?" }))
  const listIsComplete = opts.knownAccountNames !== undefined && known.length === importRecord.accountCount && (accountName === null || known.includes(accountName.trim()))
  let fileName: string | null = null
  if (importRecord.fileName !== null) {
    if (listIsComplete) {
      fileName = redactFileName(importRecord.fileName, accounts)
      if (fileName !== importRecord.fileName) notes.push({ code: "N_FILENAME_REDACTED", message: "O nome do arquivo continha nome de conta e foi redigido para accountRef." })
    } else {
      notes.push({ code: "N_FILENAME_OMITTED", message: "Lista completa de contas do import não informada: o nome do arquivo foi omitido para não expor outra conta (use explainTrades ou knownAccountNames)." })
    }
  }
  const importRefParsed = ImportRefSchema.safeParse({
    importId: importRecord.importId,
    fileSha256: importRecord.fileSha256,
    hashBasis: importRecord.hashBasis,
    fileBytes: importRecord.fileBytes,
    hasBom: importRecord.hasBom,
    lineEnding: importRecord.lineEnding,
    fileName,
    parserId: importRecord.parserId,
    parserVersion: importRecord.parserVersion,
    reconstructionMethod: importRecord.reconstructionMethod,
    reconstructionVersion: importRecord.reconstructionVersion,
    rowsRead: importRecord.rowsRead,
    rowsAccepted: importRecord.rowsAccepted,
    rowsRejected: importRecord.rowsRejected,
    accountCount: importRecord.accountCount,
    settings: {
      sourceTz: importRecord.settings.sourceTz,
      sourceTzOrigin: importRecord.settings.sourceTzOrigin,
      dateOrder: importRecord.settings.dateOrder,
      numberLocale: importRecord.settings.numberLocale,
      excursionUnit: importRecord.settings.excursionUnit,
      declaredPnlBasis: importRecord.settings.declaredPnlBasis,
    },
    // contexto reproduzível: cópia profunda e explícita (sem segredo: o sal nunca está no registro)
    ...(importRecord.reproducibility
      ? {
          reproducibility: {
            version: importRecord.reproducibility.version,
            identity: { ...importRecord.reproducibility.identity },
            foldPolicy: importRecord.reproducibility.foldPolicy,
            exitReasonMap: importRecord.reproducibility.exitReasonMap.map((r) => ({ pattern: r.pattern, reason: r.reason })),
            accountRefSalted: importRecord.reproducibility.accountRefSalted,
          },
        }
      : {}),
    importedAt: null,
  })
  if (!importRefParsed.success) return fail("E_SCHEMA", `ImportRef fora do schema evidence/1: ${importRefParsed.error.issues[0]?.path.join(".")} — ${importRefParsed.error.issues[0]?.message}`)

  // 6) trava final (fail-closed): nenhum nome de conta conhecido em NENHUM valor da saída
  const leak = findAccountNameLeak({ tradeEvidence: parsed.data, importRef: importRefParsed.data }, accounts.map((a) => a.name))
  if (leak) return fail("E_ACCOUNT_NAME_LEAK", `Nome de conta encontrado na Evidence (${leak}); resultado descartado.`)

  // 6b) o mesmo para o nome da estratégia (cycleKey e rótulo do trade): só o `strategyRef` pode sair
  const strategyNames = [rec?.cycleKey.strategy, trade.labels.strategyName].filter((n): n is string => typeof n === "string" && n.trim() !== "")
  const strategyLeak = findAccountNameLeak({ tradeEvidence: parsed.data, importRef: importRefParsed.data }, strategyNames)
  if (strategyLeak) return fail("E_STRATEGY_NAME_LEAK", `Nome de estratégia encontrado na Evidence (${strategyLeak}); resultado descartado.`)

  return { ok: true, tradeEvidence: parsed.data, importRef: importRefParsed.data, notes }
}

/** Explica vários trades de UM import com o mesmo conjunto de contas conhecidas (ImportRef consistente em todos). */
export function explainTrades(trades: CanonicalTrade[], importRecord: ImportRecord, opts: ExplainOptions = {}): ExplainTradeResult[] {
  const knownAccountNames = [...new Set([...(opts.knownAccountNames ?? []), ...trades.map((t) => t.account.sourceName).filter((n): n is string => !!n)])].sort()
  return trades.map((t) => explainTrade(t, importRecord, { ...opts, knownAccountNames }))
}
