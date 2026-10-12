// E6.1 — exitBreakdown: o resultado por PERNA de saída, separado por motivo (TARGET / STOP / MANUAL / UNKNOWN).
// Responde "quanto ganhei ou perdi nas saídas por stop, target e saída manual?" SEM atribuir o P&L de um trade de saídas mistas a um motivo só.
//
// Só usa o que a ingestão JÁ preservou: `exitLegs[]` (quantidade, motivo, regra, linhas de origem, P&L da perna = soma das linhas-lote
// que o NT8 casa com aquela saída) e os totais do trade para CONFERIR. Nada é rateado, dividido por igual, inferido do resultado nem
// recalculado por preço. Valor ausente fica ausente (null + cobertura); nunca vira zero. Dinheiro soma em CENTAVOS inteiros (exact.ts).
//
// Limites que o resultado diz em voz alta (data-contract §15.2):
//   · trade sem pernas (trade-linha) não entra na população de pernas — é contado em `population.tradesWithoutLegs`;
//   · a perna não guarda base do P&L: net/gross só valem se o TRADE tem base conhecida (senão `unavailable`, mesmo que a linha traga número);
//   · comissão/taxas vêm da linha; não são alocadas por nós. Se faltarem em alguma linha da perna, a perna não tem valor;
//   · o motivo é o NOME da ordem (+ mapa do usuário), não o tipo real; MANUAL = "zerar/fechar", não prova de decisão discricionária;
//   · `sourceLabel` NUNCA sai daqui (pode conter texto do usuário); a rastreabilidade usa tradeId + índice da perna + rowNo.
//
// Não há 2º motor: população, filtros e bucket por trade vêm de prepareTrades/applyFilters/exitReasonOf (E6.0); o hash da população é o do motor.

import { EXIT_REASONS, type CanonicalTrade, type ExitReason } from "../domain/canonical.ts"
import { hasIdentity, tradeFingerprint, tradeSetHash } from "../evidence/hash.ts"
import { canonicalJson, sha256Hex } from "../infra/hash.ts"
import { fromCents, fromScaled, meanScaled, ratio, sum, toCents, toScaled } from "./exact.ts"
import { applyFilters, normalizeFilters } from "./filter.ts"
import { prepareTrades, resolveOptions, type TradeRow } from "./prepare.ts"
import type { ExitReasonBucket } from "./exit-reason.ts"
import { ENGINE_VERSION, type AnalysisOptions, type AnalyticsTrade, type FilterReport, type TradeFilters } from "./types.ts"

export const EXIT_BREAKDOWN_SCHEMA = "metrics-exit-breakdown/1" as const
export const EXIT_BREAKDOWN_VERSION = "1.0.0"
const LEG_SET_DOMAIN = "meutrade/exitLegSet/1"
const QTY_DECIMALS = 6

type Leg = NonNullable<CanonicalTrade["exitLegs"]>[number]
export type MoneyField = "net" | "gross" | "commission" | "fees"
export const MONEY_FIELDS: readonly MoneyField[] = ["net", "gross", "commission", "fees"]

/** Soma de um campo financeiro sobre as pernas em que ele é CONHECIDO. `cents`/`value` = null quando nenhuma perna o tem (nunca 0 por falta). */
export interface MoneySum {
  cents: number | null
  value: number | null
  legsKnown: number
  /** Pernas SEM o valor (ausente na fonte, ou net/gross de trade com base desconhecida). Somam `legs − legsKnown`. */
  legsUnavailable: number
}

export interface LegRef {
  tradeId: string
  /** Posição da perna em `exitLegs` do trade (ordem cronológica da reconstrução). */
  legIndex: number
  /** Linhas do arquivo de origem que compõem a perna (o `rowHash` de cada uma está no TradeEvidence/`legSetHash`). */
  rowNos: number[]
}

export interface ReasonBreakdown {
  legs: number
  /** Contratos saídos (soma exata em 1e-6). */
  quantity: number
  trades: number
  /** Pernas deste motivo que estão em trades classificados MIXED / MIXED+partial (E6.0): mostra quanto do motivo vive em trades de saídas mistas. */
  legsInMixedTrades: number
  legsInPartialTrades: number
  /** Como o motivo foi decidido (nenhum rótulo é exposto, só a regra). */
  byRule: { LABEL_RULE: number; USER_MAP: number; NONE: number }
  net: MoneySum
  gross: MoneySum
  commission: MoneySum
  fees: MoneySum
  /** Sobre as pernas com `net` conhecido. */
  winners: number
  losers: number
  breakeven: number
  averageNet: number | null
  /** net do motivo ÷ net de todas as pernas (4 casas; pode ser > 1 ou < 0 com motivos de sinais opostos). null se o total é 0, desconhecido ou incompleto. */
  contributionToNet: number | null
  /** SHA-256 do conjunto de pernas (identidade, motivo, regra, linhas+rowHash, quantidade, valores): muda se QUALQUER perna ou valor mudar. */
  legSetHash: string
  /** Até `tradeIdsLimit` pernas; acima disso null e vale o hash. Ordenado por (tradeId, legIndex). */
  legRefs: LegRef[] | null
}

export type ReasonKey = ExitReason
export type ReconStatus = "RECONCILED" | "DIVERGENT" | "NOT_COMPARABLE"
export type NotComparableWhy = "LEG_VALUE_MISSING" | "TRADE_VALUE_MISSING" | "BASIS_UNKNOWN"

export interface Divergence {
  tradeId: string
  field: MoneyField | "quantity"
  /** Soma das pernas e valor do trade, em centavos (quantidade: em 1e-6 contratos). */
  legsScaled: number
  tradeScaled: number
  diffScaled: number
}

export interface FieldReconciliation {
  reconciled: number
  divergent: number
  notComparable: Record<NotComparableWhy, number>
  /** Só dos trades COMPARÁVEIS (soma das pernas × valor do trade), em centavos. Iguais ⇔ nenhuma divergência. */
  legsCents: number
  tradeCents: number
}

export interface ExitBreakdownWarning {
  code: "W_TRADES_WITHOUT_LEGS" | "W_VALUE_UNAVAILABLE" | "W_RECONCILIATION_DIVERGENT" | "W_ROW_REFS_INCONSISTENT" | "W_UNKNOWN_REASON_SHARE"
  severity: "WARNING" | "INFO"
  message: string
}

export interface ExitBreakdownResult {
  schema: typeof EXIT_BREAKDOWN_SCHEMA
  version: typeof EXIT_BREAKDOWN_VERSION
  engineVersion: string
  query: { filters: TradeFilters; options: { tradeIdsLimit: number; timeZone: string } }
  population: {
    inputTrades: number
    afterFilters: number
    /** Mesmo hash que `calculateMetrics` dá à mesma população (o breakdown não redefine o conjunto). */
    tradeSetHash: string
    tradeIds: string[] | null
    provenance: { withIdentity: number; withoutIdentity: number }
    filterReport: FilterReport
    tradesWithLegs: number
    /** Trades sem `exitLegs` (trade-linha etc.): motivo desconhecido, fora do breakdown, contados aqui. */
    tradesWithoutLegs: number
    /** Bucket por trade (E6.0) de TODA a população, para o breakdown não esconder o que ficou de fora. */
    tradesByBucket: Record<ExitReasonBucket, number>
  }
  /** Sempre as 4 chaves (pernas com 0 ⇒ valores null). MIXED NÃO existe por perna: uma perna tem um motivo só. */
  byReason: Record<ReasonKey, ReasonBreakdown>
  /** Todas as pernas, qualquer motivo. Σ de `byReason` = `total` (contagens e centavos). */
  total: ReasonBreakdown
  reconciliation: {
    tradesChecked: number
    fields: Record<MoneyField, FieldReconciliation>
    quantity: { reconciled: number; divergent: number }
    rows: { duplicatedRowRefs: number; uncoveredSourceRows: number; tradesChecked: number }
    /** Limitado a `tradeIdsLimit`; `divergentTotal` é a contagem completa. */
    divergences: Divergence[]
    divergentTotal: number
  }
  warnings: ExitBreakdownWarning[]
}

// ── internos ─────────────────────────────────────────────────────────────────

interface LegRow {
  tradeId: string
  legIndex: number
  leg: Leg
  bucket: ExitReasonBucket
  partial: boolean
  /** Valores em centavos; null = indisponível para a perna. */
  money: Record<MoneyField, number | null>
  rowNos: number[]
  rowHashes: Array<string | null>
  qtyScaled: number
}

const REASON_ORDER: readonly ReasonKey[] = EXIT_REASONS

function legMoney(leg: Leg, basisKnown: boolean): Record<MoneyField, number | null> {
  const c = (x: number | null | undefined): number | null => (x === null || x === undefined ? null : toCents(x))
  return {
    // net/gross dependem da base do P&L, que só existe no TRADE; sem base, o número da linha não é afirmado
    net: basisKnown ? c(leg.pnl.net) : null,
    gross: basisKnown ? c(leg.pnl.gross) : null,
    commission: c(leg.pnl.commission),
    fees: c(leg.pnl.fees),
  }
}

function legRowsOf(row: TradeRow): LegRow[] {
  const t = row.src.trade
  const legs = t.exitLegs
  if (!legs || legs.length === 0) return []
  const basisKnown = t.pnl.basis !== "UNKNOWN"
  const hashByRow = new Map<number, string | null>((t.sourceRows ?? []).map((r) => [r.rowNo, r.rowHash ?? null]))
  return legs.map((leg, legIndex) => {
    const rowNos = [...leg.rowRefs].sort((a, b) => a - b)
    return {
      tradeId: row.id,
      legIndex,
      leg,
      bucket: row.exitReason,
      partial: row.exitReasonPartial,
      money: legMoney(leg, basisKnown),
      rowNos,
      rowHashes: rowNos.map((n) => hashByRow.get(n) ?? null),
      qtyScaled: toScaled(leg.quantity, QTY_DECIMALS),
    }
  })
}

function moneySum(rows: LegRow[], f: MoneyField): MoneySum {
  const known = rows.map((r) => r.money[f]).filter((x): x is number => x !== null)
  const cents = known.length === 0 ? null : sum(known)
  return { cents, value: cents === null ? null : fromCents(cents), legsKnown: known.length, legsUnavailable: rows.length - known.length }
}

const cmpRef = (a: { tradeId: string; legIndex: number }, b: { tradeId: string; legIndex: number }) =>
  a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : a.legIndex - b.legIndex

function legSetHash(rows: LegRow[]): string {
  const items = rows
    .map((r) =>
      canonicalJson({
        tradeId: r.tradeId,
        legIndex: r.legIndex,
        reason: r.leg.reason,
        rule: r.leg.reasonRule,
        qty: r.qtyScaled,
        rowNos: r.rowNos,
        rowHashes: r.rowHashes,
        money: r.money,
      }),
    )
    .sort()
  return sha256Hex(`${LEG_SET_DOMAIN}\0${items.length}\0${items.join("\n")}`)
}

function breakdownOf(rows: LegRow[], limit: number): Omit<ReasonBreakdown, "contributionToNet"> {
  const byRule = { LABEL_RULE: 0, USER_MAP: 0, NONE: 0 }
  for (const r of rows) byRule[r.leg.reasonRule] += 1
  const net = moneySum(rows, "net")
  const knownNets = rows.map((r) => r.money.net).filter((x): x is number => x !== null)
  const avg = meanScaled(knownNets)
  const ordered = [...rows].sort(cmpRef)
  return {
    legs: rows.length,
    quantity: fromScaled(sum(rows.map((r) => r.qtyScaled)), QTY_DECIMALS),
    trades: new Set(rows.map((r) => r.tradeId)).size,
    legsInMixedTrades: rows.filter((r) => r.bucket === "MIXED").length,
    legsInPartialTrades: rows.filter((r) => r.partial).length,
    byRule,
    net,
    gross: moneySum(rows, "gross"),
    commission: moneySum(rows, "commission"),
    fees: moneySum(rows, "fees"),
    winners: knownNets.filter((x) => x > 0).length,
    losers: knownNets.filter((x) => x < 0).length,
    breakeven: knownNets.filter((x) => x === 0).length,
    averageNet: avg === null ? null : fromCents(avg),
    legSetHash: legSetHash(rows),
    legRefs: rows.length <= limit ? ordered.map((r) => ({ tradeId: r.tradeId, legIndex: r.legIndex, rowNos: [...r.rowNos] })) : null,
  }
}

// ── conferência perna × trade ────────────────────────────────────────────────

function emptyField(): FieldReconciliation {
  return { reconciled: 0, divergent: 0, notComparable: { LEG_VALUE_MISSING: 0, TRADE_VALUE_MISSING: 0, BASIS_UNKNOWN: 0 }, legsCents: 0, tradeCents: 0 }
}

function reconcile(rows: TradeRow[], legsByTrade: Map<string, LegRow[]>, limit: number): ExitBreakdownResult["reconciliation"] {
  const fields: Record<MoneyField, FieldReconciliation> = { net: emptyField(), gross: emptyField(), commission: emptyField(), fees: emptyField() }
  const quantity = { reconciled: 0, divergent: 0 }
  const rowsInfo = { duplicatedRowRefs: 0, uncoveredSourceRows: 0, tradesChecked: 0 }
  const divergences: Divergence[] = []
  let divergentTotal = 0
  let tradesChecked = 0

  for (const row of rows) {
    const legs = legsByTrade.get(row.id)
    if (!legs || legs.length === 0) continue
    tradesChecked += 1
    const t = row.src.trade
    const basisKnown = t.pnl.basis !== "UNKNOWN"
    for (const f of MONEY_FIELDS) {
      const agg = fields[f]
      const costField = f === "commission" || f === "fees"
      if (!costField && !basisKnown) {
        agg.notComparable.BASIS_UNKNOWN += 1
        continue
      }
      const tradeRaw = t.pnl[f]
      if (tradeRaw === null || tradeRaw === undefined) {
        agg.notComparable.TRADE_VALUE_MISSING += 1
        continue
      }
      const legVals = legs.map((l) => l.money[f])
      if (legVals.some((v) => v === null)) {
        agg.notComparable.LEG_VALUE_MISSING += 1
        continue
      }
      const legsCents = sum(legVals as number[])
      const tradeCents = toCents(tradeRaw)
      agg.legsCents += legsCents
      agg.tradeCents += tradeCents
      if (legsCents === tradeCents) agg.reconciled += 1
      else {
        agg.divergent += 1
        divergentTotal += 1
        if (divergences.length < limit) divergences.push({ tradeId: row.id, field: f, legsScaled: legsCents, tradeScaled: tradeCents, diffScaled: legsCents - tradeCents })
      }
    }
    const legsQty = sum(legs.map((l) => l.qtyScaled))
    const tradeQty = toScaled(t.quantity, QTY_DECIMALS)
    if (legsQty === tradeQty) quantity.reconciled += 1
    else {
      quantity.divergent += 1
      divergentTotal += 1
      if (divergences.length < limit) divergences.push({ tradeId: row.id, field: "quantity", legsScaled: legsQty, tradeScaled: tradeQty, diffScaled: legsQty - tradeQty })
    }
    // dupla contagem / cobertura de linhas: cada linha de origem do trade entra em UMA perna de saída
    const seen = new Map<number, number>()
    for (const l of legs) for (const n of l.rowNos) seen.set(n, (seen.get(n) ?? 0) + 1)
    rowsInfo.tradesChecked += 1
    if ([...seen.values()].some((c) => c > 1)) rowsInfo.duplicatedRowRefs += 1
    const sourceNos = (t.sourceRows ?? []).map((r) => r.rowNo)
    if (sourceNos.length > 0 && sourceNos.some((n) => !seen.has(n))) rowsInfo.uncoveredSourceRows += 1
  }
  divergences.sort((a, b) => cmpRef({ tradeId: a.tradeId, legIndex: 0 }, { tradeId: b.tradeId, legIndex: 0 }) || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
  return { tradesChecked, fields, quantity, rows: rowsInfo, divergences, divergentTotal }
}

// ── API ──────────────────────────────────────────────────────────────────────

export function exitBreakdown(trades: AnalyticsTrade[], args: { filters?: TradeFilters } & AnalysisOptions = {}): ExitBreakdownResult {
  const { filters: rawFilters, ...options } = args
  const o = resolveOptions(options)
  const filters = normalizeFilters(rawFilters)
  const prepared = prepareTrades(trades, o)
  const { rows, report } = applyFilters(prepared, filters)

  const legsByTrade = new Map<string, LegRow[]>()
  const allLegs: LegRow[] = []
  for (const r of rows) {
    const ls = legRowsOf(r)
    if (ls.length > 0) {
      legsByTrade.set(r.id, ls)
      allLegs.push(...ls)
    }
  }

  const fingerprints = rows.map((r) => tradeFingerprint(r.id, r.src.trade))
  const withIdentity = fingerprints.filter(hasIdentity).length
  const ids = rows.map((r) => r.id).sort()
  const tradesByBucket: Record<ExitReasonBucket, number> = { TARGET: 0, STOP: 0, MANUAL: 0, MIXED: 0, UNKNOWN: 0 }
  for (const r of rows) tradesByBucket[r.exitReason] += 1

  const parts = {} as Record<ReasonKey, Omit<ReasonBreakdown, "contributionToNet">>
  for (const k of REASON_ORDER) parts[k] = breakdownOf(allLegs.filter((l) => l.leg.reason === k), o.tradeIdsLimit)
  const totalPart = breakdownOf(allLegs, o.tradeIdsLimit)
  // contribuição só com o total completo e ≠ 0 (senão não há "parte de um todo" honesta)
  const totalNet = totalPart.net
  const contribution = (p: Omit<ReasonBreakdown, "contributionToNet">): number | null =>
    totalNet.cents !== null && totalNet.legsUnavailable === 0 && totalNet.cents !== 0 && p.net.cents !== null ? ratio(p.net.cents, totalNet.cents) : null
  const byReason = {} as Record<ReasonKey, ReasonBreakdown>
  for (const k of REASON_ORDER) byReason[k] = { ...parts[k], contributionToNet: parts[k].legs === 0 ? null : contribution(parts[k]) }
  const total: ReasonBreakdown = { ...totalPart, contributionToNet: totalPart.legs === 0 ? null : totalNet.cents !== null && totalNet.legsUnavailable === 0 && totalNet.cents !== 0 ? 1 : null }

  const reconciliation = reconcile(rows, legsByTrade, o.tradeIdsLimit)

  const warnings: ExitBreakdownWarning[] = []
  const without = rows.length - legsByTrade.size
  if (without > 0) warnings.push({ code: "W_TRADES_WITHOUT_LEGS", severity: "WARNING", message: `${without} de ${rows.length} trade(s) não têm pernas de saída (ex.: trade-linha): o motivo é desconhecido e eles ficam FORA deste breakdown (não são "sem stop").` })
  const gaps = MONEY_FIELDS.filter((f) => total[f].legsUnavailable > 0)
  if (gaps.length > 0) warnings.push({ code: "W_VALUE_UNAVAILABLE", severity: "WARNING", message: `Há pernas sem valor atribuível em: ${gaps.map((f) => `${f} (${total[f].legsUnavailable} de ${total.legs})`).join(", ")}. As somas cobrem só as pernas com o valor; veja legsKnown.` })
  if (reconciliation.divergentTotal > 0) warnings.push({ code: "W_RECONCILIATION_DIVERGENT", severity: "WARNING", message: `${reconciliation.divergentTotal} divergência(s) entre a soma das pernas e o total do trade (valores ou quantidade). A divergência é mostrada, não corrigida.` })
  if (reconciliation.rows.duplicatedRowRefs > 0 || reconciliation.rows.uncoveredSourceRows > 0) {
    warnings.push({ code: "W_ROW_REFS_INCONSISTENT", severity: "WARNING", message: `Referências de linhas inconsistentes: ${reconciliation.rows.duplicatedRowRefs} trade(s) com linha em mais de uma perna; ${reconciliation.rows.uncoveredSourceRows} com linha de origem fora das pernas.` })
  }
  if (total.legs > 0 && byReason.UNKNOWN.legs > 0) {
    warnings.push({ code: "W_UNKNOWN_REASON_SHARE", severity: "INFO", message: `${byReason.UNKNOWN.legs} de ${total.legs} perna(s) têm motivo desconhecido (rótulo fora das regras): o valor delas fica em UNKNOWN, não em target/stop/manual. O mapa de rótulos do usuário pode resolver.` })
  }

  return {
    schema: EXIT_BREAKDOWN_SCHEMA,
    version: EXIT_BREAKDOWN_VERSION,
    engineVersion: ENGINE_VERSION,
    query: { filters, options: { tradeIdsLimit: o.tradeIdsLimit, timeZone: o.timeZone } },
    population: {
      inputTrades: prepared.length,
      afterFilters: rows.length,
      tradeSetHash: tradeSetHash(fingerprints),
      tradeIds: rows.length <= o.tradeIdsLimit ? ids : null,
      provenance: { withIdentity, withoutIdentity: rows.length - withIdentity },
      filterReport: report,
      tradesWithLegs: legsByTrade.size,
      tradesWithoutLegs: without,
      tradesByBucket,
    },
    byReason,
    total,
    reconciliation,
    warnings,
  }
}
