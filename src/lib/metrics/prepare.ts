// Preparação: AnalyticsTrade → TradeRow (campos derivados, calculados UMA vez).
// É aqui que a semântica do data-contract vira número de análise:
//   - P&L da análise = líquido OU bruto (nunca "o que tiver"); o que falta fica null e a cobertura mostra isso;
//   - R vem do trade canônico (r.net ou r.points) — NUNCA é calculado/estimado aqui;
//   - hora/dia/semana/mês/dia da semana derivam do instante âncora no fuso pedido; DATE_ONLY só tem a data (hora = null);
//   - a ORDEM da sequência (drawdown/streaks) usa o instante de SAÍDA (quando o P&L se realiza); sem hora, aproxima e avisa.

import { DEFAULT_ANALYSIS_TIME_ZONE, isValidTimeZone, addDays, legacySessionType, toLocal, tradingDay, type TimeValue } from "../domain/time.ts"
import { toCents, toRScaled } from "./exact.ts"
import {
  MetricsInputError,
  type AnalysisOptions,
  type AnalyticsTrade,
  type ResolvedOptions,
} from "./types.ts"
import type { CanonicalTrade } from "../domain/canonical.ts"
import { exitReasonOf, type ExitReasonBucket } from "./exit-reason.ts"

/** Análise do trader: America/Sao_Paulo (padrão do MeuTrade). Sessão (AM/PM/OVERNIGHT) segue em ET e dia de pregão no calendário CME, independente deste fuso. */
export const DEFAULT_TIME_ZONE = DEFAULT_ANALYSIS_TIME_ZONE

export function resolveOptions(o: AnalysisOptions = {}): ResolvedOptions {
  const timeZone = o.timeZone ?? DEFAULT_TIME_ZONE
  if (!isValidTimeZone(timeZone)) throw new MetricsInputError("E_OPTIONS_INVALID", `Fuso inválido: "${timeZone}".`)
  const minSample = o.minSample ?? 30
  if (!Number.isInteger(minSample) || minSample < 1) throw new MetricsInputError("E_OPTIONS_INVALID", "minSample deve ser inteiro ≥ 1.")
  return {
    timeZone,
    timeAnchor: o.timeAnchor ?? "ENTRY",
    pnlBasis: o.pnlBasis ?? "NET",
    rBasis: o.rBasis ?? "NET",
    tradeIdsLimit: o.tradeIdsLimit ?? 500,
    minSample,
  }
}

export interface TradeRow {
  index: number
  id: string
  src: AnalyticsTrade
  symbol: string | null
  direction: "LONG" | "SHORT"
  account: string | null
  strategyId: string | null
  strategyName: string | null
  strategyVersionId: string | null
  setup: string | null
  timeframe: string | null
  /** Instante âncora (ENTRADA ou SAÍDA, conforme a opção) em UTC; null se não há hora completa. */
  anchorInstant: string | null
  /** Data civil do âncora no fuso da análise (ou a data da fonte p/ DATE_ONLY). */
  localDate: string | null
  hour: number | null
  dayOfWeek: number | null
  /** Segunda-feira da semana (YYYY-MM-DD). */
  week: string | null
  /** YYYY-MM */
  month: string | null
  tradingDay: string | null
  session: string | null
  /** Centavos inteiros; null = não conhecido NESTA base. */
  netC: number | null
  grossC: number | null
  commissionC: number | null
  feesC: number | null
  /** P&L da base escolhida (netC ou grossC). */
  pnlC: number | null
  /** R em 1e-4 inteiros (base escolhida); null = indisponível. */
  rS: number | null
  rReason: string | null
  pointsPerContract: number
  /** Chave de ordenação da sequência (ms UTC). */
  orderKey: number
  orderApprox: boolean
  timePrecision: "DATETIME" | "DATE_ONLY" | "UNKNOWN"
  unknownBasis: boolean
  /** POSITION_CYCLE (ciclo reconstruído) ou SOURCE_ROW (linha da fonte tratada como trade). Ausente no v1 = SOURCE_ROW. */
  granularity: "POSITION_CYCLE" | "SOURCE_ROW"
  lowConfidence: boolean
  unverifiedEdges: boolean
  /** Motivo de saída agregado do trade (regra em exit-reason.ts). Sempre um bucket: sem informação = UNKNOWN. */
  exitReason: ExitReasonBucket
  /** MIXED que inclui saída de motivo desconhecido (conhecido + desconhecido na mesma operação). */
  exitReasonPartial: boolean
  exitReasonSource: "LEGS" | "SUMMARY" | "NONE"
}

function anchorOf(t: CanonicalTrade, o: ResolvedOptions): TimeValue {
  return o.timeAnchor === "ENTRY" ? t.entry.at : t.exit.at
}

const mondayOf = (date: string, weekday: number): string => addDays(date, -((weekday + 6) % 7))
const weekdayOf = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function prepareTrades(trades: AnalyticsTrade[], o: ResolvedOptions): TradeRow[] {
  const seen = new Set<string>()
  return trades.map((a, index) => {
    if (seen.has(a.id)) throw new MetricsInputError("E_DUPLICATE_ID", `Id de trade repetido: "${a.id}".`)
    seen.add(a.id)
    const t = a.trade
    const at = anchorOf(t, o)

    let anchorInstant: string | null = null
    let localDate: string | null = null
    let hour: number | null = null
    let dayOfWeek: number | null = null
    let td: string | null = null
    let session: string | null = null
    if (at.precision === "DATETIME" && at.instantUtc) {
      anchorInstant = at.instantUtc
      const l = toLocal(at.instantUtc, o.timeZone)
      localDate = l.date
      hour = l.hour
      dayOfWeek = l.weekday
      td = tradingDay(at.instantUtc)
      session = legacySessionType(at.instantUtc)
    } else if (at.precision === "DATE_ONLY" && at.localDate) {
      // Só a data da fonte: dia/semana/mês/dia da semana são válidos; hora/sessão/dia de pregão NÃO existem.
      localDate = at.localDate
      dayOfWeek = weekdayOf(at.localDate)
      session = t.sessionHint // declarada pelo usuário no template (não derivada)
    }
    const week = localDate !== null && dayOfWeek !== null ? mondayOf(localDate, dayOfWeek) : null

    // sequência: saída → entrada → data (aproximações sinalizadas)
    const exitMs = t.exit.at.instantUtc ? Date.parse(t.exit.at.instantUtc) : null
    const entryMs = t.entry.at.instantUtc ? Date.parse(t.entry.at.instantUtc) : null
    let orderKey: number
    let orderApprox = false
    if (exitMs !== null) orderKey = exitMs
    else if (entryMs !== null) { orderKey = entryMs; orderApprox = true }
    else {
      const d = t.entry.at.localDate
      orderKey = d ? Date.parse(`${d}T00:00:00.000Z`) : 0
      orderApprox = true
    }

    const p = t.pnl
    const netC = p.net === null ? null : toCents(p.net)
    const grossC = p.gross === null ? null : toCents(p.gross)
    const pnlC = o.pnlBasis === "NET" ? netC : grossC

    const exit = exitReasonOf(t)

    const rValue = o.rBasis === "NET" ? t.r.net : t.r.points
    const rReason = rValue !== null ? null : o.rBasis === "NET" ? t.r.netReason ?? "RISK_UNKNOWN" : t.risk.reason ?? "STOP_MISSING"

    return {
      index,
      id: a.id,
      src: a,
      symbol: t.instrument.root,
      direction: t.direction,
      account: t.account.sourceName,
      strategyId: a.strategyId ?? null,
      strategyName: t.labels.strategyName,
      strategyVersionId: a.strategyVersionId ?? null,
      setup: a.setup ?? null,
      timeframe: a.timeframe ?? null,
      anchorInstant,
      localDate,
      hour,
      dayOfWeek,
      week,
      month: localDate ? localDate.slice(0, 7) : null,
      tradingDay: td,
      session,
      netC,
      grossC,
      commissionC: p.commission === null ? null : toCents(p.commission),
      feesC: p.fees === null ? null : toCents(p.fees),
      pnlC,
      rS: rValue === null ? null : toRScaled(rValue),
      rReason,
      pointsPerContract: t.pointsPerContract,
      orderKey,
      orderApprox,
      timePrecision: at.precision,
      unknownBasis: p.basis === "UNKNOWN",
      granularity: t.granularity ?? "SOURCE_ROW",
      lowConfidence: t.reconstruction?.confidence === "LOW",
      unverifiedEdges: t.reconstruction != null && t.reconstruction.completeness !== "VERIFIED",
      exitReason: exit.bucket,
      exitReasonPartial: exit.partial,
      exitReasonSource: exit.source,
    }
  })
}

/** Ordena a sequência (estável: empate de instante mantém a ordem de entrada dos dados). */
export function sequenceOrder<T extends TradeRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.orderKey - b.orderKey || a.index - b.index)
}

/**
 * Atribui ids aos CanonicalTrade quando eles ainda não vêm de um banco: `<fileHash|file>:<linha>`; repetido ganha sufixo.
 * Quando houver banco, o id real do trade substitui isto (o motor só exige unicidade).
 */
export function toAnalyticsTrades(trades: CanonicalTrade[], extras: Array<Partial<Omit<AnalyticsTrade, "id" | "trade">>> = []): AnalyticsTrade[] {
  const used = new Map<string, number>()
  return trades.map((trade, i) => {
    // tradeId determinístico (Evidence E1) tem prioridade; o id posicional é só o fallback para trades sem identidade.
    const base = trade.tradeId ?? `${trade.source.fileHash ?? "file"}:${trade.source.rowNo ?? i}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return { id: n === 1 ? base : `${base}#${n}`, trade, ...(extras[i] ?? {}) }
  })
}
