// Motor de métricas determinísticas: filterTrades → calculateMetrics / aggregateTrades.
// Nenhuma métrica "inventa": sem dado ⇒ value = null + reason, com cobertura explícita (used/total).
// Fórmulas e unidades: catalog.ts e docs/ai-partner/data-contract.md §Métricas.

import { hasIdentity, tradeFingerprint, tradeSetHash } from "../evidence/hash.ts"
import { TraceBuilder, type AggregateTrace, type MetricsTrace, type TraceItem } from "./trace.ts"
import { DEFINITION_VERSION, METRIC_IDS } from "./catalog.ts"
import {
  fromCents,
  fromRScaled,
  fromScaled,
  meanScaled,
  medianScaled,
  percent,
  ratio,
  sum,
  toScaled,
} from "./exact.ts"
import { applyFilters, normalizeFilters } from "./filter.ts"
import { prepareTrades, resolveOptions, sequenceOrder, type TradeRow } from "./prepare.ts"
import { drawdown, streaks } from "./sequence.ts"
import {
  AGGREGATE_SCHEMA,
  ENGINE_VERSION,
  MIN_BUCKET,
  MetricsInputError,
  RESULT_SCHEMA,
  type AggregateResult,
  type AnalysisOptions,
  type AnalyticsTrade,
  type DataQuality,
  type Dimension,
  type FilterReport,
  type GroupResult,
  type MetricUnit,
  type MetricValue,
  type MetricWarning,
  type MetricsResult,
  type Period,
  type Population,
  type ResolvedOptions,
  type TradeFilters,
} from "./types.ts"

type Basis = MetricValue["basis"]

// ── conjunto de métricas sobre linhas já filtradas ───────────────────────────

export function computeMetricSet(rows: TradeRow[], o: ResolvedOptions, trace?: TraceBuilder): Record<string, MetricValue> {
  const total = rows.length
  const out: Record<string, MetricValue> = {}
  // Trace (G5): REGISTRA os mesmos conjuntos que as fórmulas abaixo já usam; não calcula nada. Sem `trace` é no-op.
  const ids = (xs: Array<{ id: string }>): TraceItem[] => xs.map((x) => ({ id: x.id }))
  const ranked = (xs: Array<{ id: string }>, first = 1): TraceItem[] => xs.map((x, i) => ({ id: x.id, rank: first + i }))
  const mk = (
    metric: string,
    unit: MetricUnit,
    value: number | null,
    used: number,
    basis: Basis,
    reason?: string,
    details?: Record<string, unknown>,
  ): void => {
    out[metric] = {
      metric,
      value,
      unit,
      sampleSize: used,
      coverage: { used, total, ratio: total === 0 ? 0 : (ratio(used, total) ?? 0) },
      available: value !== null,
      reason: value === null ? (reason ?? "NO_DATA") : null,
      basis,
      definitionVersion: DEFINITION_VERSION,
      ...(details ? { details } : {}),
    }
  }

  const pb: Basis = o.pnlBasis === "NET" ? "NET" : "GROSS"
  const rb: Basis = o.rBasis === "NET" ? "R_NET" : "R_POINTS"

  // ── contagens e classificação (base escolhida) ─────────────────────────────
  const cls = rows.filter((r): r is TradeRow & { pnlC: number } => r.pnlC !== null)
  const n = cls.length
  const wins = cls.filter((r) => r.pnlC > 0)
  const losses = cls.filter((r) => r.pnlC < 0)
  const bes = cls.filter((r) => r.pnlC === 0)
  const noPnl = "NO_PNL_DATA"

  mk("totalTrades", "count", total, total, null)
  trace?.notApplicable("totalTrades")
  mk("classifiedTrades", "count", n, n, pb)
  mk("winners", "count", n === 0 ? null : wins.length, n, pb, noPnl)
  mk("losers", "count", n === 0 ? null : losses.length, n, pb, noPnl)
  mk("breakeven", "count", n === 0 ? null : bes.length, n, pb, noPnl)
  mk("winRate", "percent", percent(wins.length, n), n, pb, noPnl)
  mk("lossRate", "percent", percent(losses.length, n), n, pb, noPnl)
  mk("breakevenRate", "percent", percent(bes.length, n), n, pb, noPnl)
  if (trace) {
    const inCls = new Set<TradeRow>(cls)
    const noPnlRows = rows.filter((r) => !inCls.has(r))
    for (const metric of ["classifiedTrades", "winRate", "lossRate", "breakevenRate"]) {
      trace.add(metric, "WINNER", ids(wins))
      trace.add(metric, "LOSER", ids(losses))
      trace.add(metric, "BREAKEVEN", ids(bes))
      trace.add(metric, "EXCLUDED_NO_PNL", ids(noPnlRows))
    }
    trace.add("winners", "WINNER", ids(wins))
    trace.add("losers", "LOSER", ids(losses))
    trace.add("breakeven", "BREAKEVEN", ids(bes))
  }

  // ── totais por componente (cada um só sobre quem tem aquele dado) ──────────
  const known = (get: (r: TradeRow) => number | null) => {
    const xs: number[] = []
    const inc: TradeRow[] = []
    const exc: TradeRow[] = []
    for (const r of rows) {
      const v = get(r)
      if (v === null) exc.push(r)
      else {
        xs.push(v)
        inc.push(r)
      }
    }
    return { n: xs.length, sum: sum(xs), inc, exc }
  }
  const g = known((r) => r.grossC)
  const nt = known((r) => r.netC)
  const cm = known((r) => r.commissionC)
  const fe = known((r) => r.feesC)
  mk("grossPnl", "usd", g.n ? fromCents(g.sum) : null, g.n, "GROSS", "NO_GROSS_PNL")
  mk("netPnl", "usd", nt.n ? fromCents(nt.sum) : null, nt.n, "NET", "NO_NET_PNL")
  mk("commission", "usd", cm.n ? fromCents(cm.sum) : null, cm.n, null, "NO_COMMISSION_DATA")
  mk("fees", "usd", fe.n ? fromCents(fe.sum) : null, fe.n, null, "NO_FEES_DATA")
  if (trace) {
    for (const [metric, k] of [["grossPnl", g], ["netPnl", nt], ["commission", cm], ["fees", fe]] as const) {
      trace.add(metric, "INCLUDED", ids(k.inc))
      trace.add(metric, "EXCLUDED_UNKNOWN", ids(k.exc))
    }
  }

  // ── P&L da base escolhida ──────────────────────────────────────────────────
  const sumW = sum(wins.map((r) => r.pnlC))
  const sumL = sum(losses.map((r) => r.pnlC))
  mk("winnersTotal", "usd", n ? fromCents(sumW) : null, n, pb, noPnl)
  mk("losersTotal", "usd", n ? fromCents(sumL) : null, n, pb, noPnl)
  const avgTrade = meanScaled(cls.map((r) => r.pnlC))
  mk("averageTrade", "usd", avgTrade === null ? null : fromCents(avgTrade), n, pb, noPnl)
  const avgW = meanScaled(wins.map((r) => r.pnlC))
  const avgL = meanScaled(losses.map((r) => r.pnlC))
  mk("averageWinner", "usd", avgW === null ? null : fromCents(avgW), wins.length, pb, "NO_WINNERS")
  mk("averageLoser", "usd", avgL === null ? null : fromCents(avgL), losses.length, pb, "NO_LOSERS")
  if (trace) {
    trace.add("winnersTotal", "WINNER", ids(wins))
    trace.add("averageWinner", "WINNER", ids(wins))
    trace.add("losersTotal", "LOSER", ids(losses))
    trace.add("averageLoser", "LOSER", ids(losses))
    trace.add("averageTrade", "INCLUDED", ids(cls))
  }

  // Empates entre extremos desempatam por id (independe da ordem de entrada dos dados).
  const byIdAsc = (a: TradeRow, b: TradeRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const rankedWins = [...wins].sort((a, b) => b.pnlC - a.pnlC || byIdAsc(a, b))
  const rankedLosses = [...losses].sort((a, b) => a.pnlC - b.pnlC || byIdAsc(a, b))
  const best = rankedWins[0] ?? null
  const worst = rankedLosses[0] ?? null
  mk("largestWinner", "usd", best ? fromCents(best.pnlC) : null, wins.length, pb, "NO_WINNERS", best ? { tradeId: best.id } : undefined)
  mk("largestLoser", "usd", worst ? fromCents(worst.pnlC) : null, losses.length, pb, "NO_LOSERS", worst ? { tradeId: worst.id } : undefined)

  mk("payoffRatio", "ratio", wins.length && losses.length ? ratio(sumW * losses.length, Math.abs(sumL) * wins.length) : null, n, pb, wins.length ? "NO_LOSERS" : "NO_WINNERS")
  mk("profitFactor", "ratio", n === 0 ? null : losses.length ? ratio(sumW, Math.abs(sumL)) : null, n, pb, n === 0 ? noPnl : "NO_LOSERS")
  const top3 = rankedWins.slice(0, 3)
  mk("largestWinnerSharePct", "percent", best ? percent(best.pnlC, sumW) : null, wins.length, pb, "NO_WINNERS")
  mk("top3WinnersSharePct", "percent", best ? percent(sum(top3.map((r) => r.pnlC)), sumW) : null, wins.length, pb, "NO_WINNERS", best ? { tradeIds: top3.map((r) => r.id) } : undefined)
  if (trace) {
    trace.add("largestWinner", "LARGEST_WINNER", best ? ranked([best]) : [])
    trace.add("largestLoser", "LARGEST_LOSER", worst ? ranked([worst]) : [])
    for (const metric of ["payoffRatio", "profitFactor"]) {
      trace.add(metric, "WINNER", ids(wins))
      trace.add(metric, "LOSER", ids(losses))
    }
    trace.add("largestWinnerSharePct", "LARGEST_WINNER", best ? ranked([best]) : [])
    trace.add("largestWinnerSharePct", "WINNER", ids(wins))
    trace.add("top3WinnersSharePct", "TOP_WINNER", ranked(top3))
    trace.add("top3WinnersSharePct", "WINNER", ids(wins))
  }

  // ── R (somente trades com R conhecido — nunca inferido) ────────────────────
  const rRows = rows.filter((r): r is TradeRow & { rS: number } => r.rS !== null)
  const m = rRows.length
  const rReasons: Record<string, number> = {}
  for (const r of rows) if (r.rS === null) rReasons[r.rReason ?? "RISK_UNKNOWN"] = (rReasons[r.rReason ?? "RISK_UNKNOWN"] ?? 0) + 1
  const noR = "R_UNAVAILABLE"
  const rDetails = m === 0 && total > 0 ? { unknownByReason: rReasons } : undefined
  const rVals = rRows.map((r) => r.rS)
  const rPos = rVals.filter((v) => v > 0)
  const rNeg = rVals.filter((v) => v < 0)
  const sumR = sum(rVals)
  const avgR = meanScaled(rVals)
  const medR = medianScaled(rVals)
  mk("totalR", "R", m ? fromRScaled(sumR) : null, m, rb, noR, rDetails)
  mk("averageR", "R", avgR === null ? null : fromRScaled(avgR), m, rb, noR, rDetails)
  mk("medianR", "R", medR === null ? null : fromRScaled(medR), m, rb, noR, rDetails)
  mk("winRateR", "percent", percent(rPos.length, m), m, rb, noR, rDetails)
  const avgWR = meanScaled(rPos)
  const avgLR = meanScaled(rNeg)
  mk("averageWinnerR", "R", avgWR === null ? null : fromRScaled(avgWR), rPos.length, rb, m ? "NO_WINNING_R" : noR)
  mk("averageLoserR", "R", avgLR === null ? null : fromRScaled(avgLR), rNeg.length, rb, m ? "NO_LOSING_R" : noR)
  if (trace) {
    const rZero = rRows.filter((r) => r.rS === 0)
    const rPosRows = rRows.filter((r) => r.rS > 0)
    const rNegRows = rRows.filter((r) => r.rS < 0)
    const rUnknown = rows.filter((r) => r.rS === null)
    for (const metric of ["totalR", "averageR", "winRateR", "expectancyR"]) {
      trace.add(metric, "R_POSITIVE", ids(rPosRows))
      trace.add(metric, "R_NEGATIVE", ids(rNegRows))
      trace.add(metric, "R_ZERO", ids(rZero))
      trace.add(metric, "EXCLUDED_R_UNKNOWN", ids(rUnknown))
    }
    trace.add("averageWinnerR", "R_POSITIVE", ids(rPosRows))
    trace.add("averageLoserR", "R_NEGATIVE", ids(rNegRows))
    trace.notApplicable("medianR")
  }
  // expectancy = pW·avgWinnerR + pL·avgLoserR ≡ Σ R / m (identidade; calculada pela soma exata p/ não acumular erro)
  mk(
    "expectancyR",
    "R",
    avgR === null ? null : fromRScaled(avgR),
    m,
    rb,
    noR,
    m ? { pWinPct: percent(rPos.length, m), pLossPct: percent(rNeg.length, m), averageWinnerR: avgWR === null ? null : fromRScaled(avgWR), averageLoserR: avgLR === null ? null : fromRScaled(avgLR) } : rDetails,
  )

  // ── sequência: drawdown, recovery, streaks (ordem por saída) ───────────────
  const seq = sequenceOrder(cls).map((r) => ({ id: r.id, v: r.pnlC }))
  const dd = drawdown(seq)
  const ddDetails = dd.maxDrawdown > 0
    ? {
        peakTradeId: dd.peakIndex >= 0 ? seq[dd.peakIndex].id : null,
        troughTradeId: seq[dd.troughIndex].id,
        recovered: dd.recoveredIndex !== null,
        recoveredAtTradeId: dd.recoveredIndex !== null ? seq[dd.recoveredIndex].id : null,
        tradesPeakToTrough: dd.troughIndex - dd.peakIndex,
        tradesToRecover: dd.recoveredIndex !== null ? dd.recoveredIndex - dd.troughIndex : null,
        windowTradeIds: seq.slice(dd.peakIndex + 1, dd.troughIndex + 1).map((s) => s.id).slice(0, 200),
      }
    : undefined
  mk("maxDrawdown", "usd", n ? fromCents(dd.maxDrawdown) : null, n, pb, noPnl, ddDetails)
  mk("currentDrawdown", "usd", n ? fromCents(dd.currentDrawdown) : null, n, pb, noPnl)
  mk("recoveryFactor", "ratio", n && dd.maxDrawdown > 0 ? ratio(dd.finalEquity, dd.maxDrawdown) : null, n, pb, n ? "NO_DRAWDOWN" : noPnl)
  /** Pico / janela (exclusiva) / vale / recuperação do MAIOR drawdown, pelos mesmos índices que `drawdown()` devolveu. Rank = posição na sequência de saída. */
  const traceDrawdown = (metric: string, seqItems: Array<{ id: string }>, d: ReturnType<typeof drawdown>): void => {
    if (!trace) return
    trace.add(metric, "DRAWDOWN_PEAK", d.maxDrawdown > 0 && d.peakIndex >= 0 ? ranked([seqItems[d.peakIndex]], d.peakIndex + 1) : [])
    trace.add(metric, "DRAWDOWN_WINDOW", d.maxDrawdown > 0 ? ranked(seqItems.slice(d.peakIndex + 1, d.troughIndex), d.peakIndex + 2) : [])
    trace.add(metric, "DRAWDOWN_TROUGH", d.maxDrawdown > 0 ? ranked([seqItems[d.troughIndex]], d.troughIndex + 1) : [])
    trace.add(metric, "DRAWDOWN_RECOVERY", d.maxDrawdown > 0 && d.recoveredIndex !== null ? ranked([seqItems[d.recoveredIndex]], d.recoveredIndex + 1) : [])
  }
  traceDrawdown("maxDrawdown", seq, dd)
  trace?.notApplicable("currentDrawdown")
  trace?.notApplicable("recoveryFactor")

  const rSeq = sequenceOrder(rRows).map((r) => ({ id: r.id, v: r.rS }))
  const ddR = drawdown(rSeq)
  mk(
    "maxDrawdownR",
    "R",
    m ? fromRScaled(ddR.maxDrawdown) : null,
    m,
    rb,
    noR,
    m && ddR.maxDrawdown > 0
      ? { peakTradeId: ddR.peakIndex >= 0 ? rSeq[ddR.peakIndex].id : null, troughTradeId: rSeq[ddR.troughIndex].id, recovered: ddR.recoveredIndex !== null }
      : rDetails,
  )

  traceDrawdown("maxDrawdownR", rSeq, ddR)

  const st = streaks(seq)
  if (trace) {
    trace.add("maxConsecutiveWins", "STREAK_RUN", st.maxWins ? ranked(seq.slice(st.maxWinsStart, st.maxWinsStart + st.maxWins), st.maxWinsStart + 1) : [])
    trace.add("maxConsecutiveLosses", "STREAK_RUN", st.maxLosses ? ranked(seq.slice(st.maxLossesStart, st.maxLossesStart + st.maxLosses), st.maxLossesStart + 1) : [])
    const curFrom = seq.length - st.currentLength
    trace.add("currentStreak", "STREAK_RUN", st.currentType !== null && st.currentLength > 0 ? ranked(seq.slice(curFrom), curFrom + 1) : [])
  }
  mk("maxConsecutiveWins", "count", n ? st.maxWins : null, n, pb, noPnl, st.maxWins ? { startTradeId: seq[st.maxWinsStart].id } : undefined)
  mk("maxConsecutiveLosses", "count", n ? st.maxLosses : null, n, pb, noPnl, st.maxLosses ? { startTradeId: seq[st.maxLossesStart].id } : undefined)
  mk(
    "currentStreak",
    "count",
    n ? (st.currentType === "WIN" ? st.currentLength : st.currentType === "LOSS" ? -st.currentLength : 0) : null,
    n,
    pb,
    noPnl,
    n ? { type: st.currentType ?? "NONE", length: st.currentLength } : undefined,
  )

  // ── pontos por contrato (só com UM instrumento conhecido: pontos de ES ≠ pontos de NQ) ──
  const UNKNOWN_SYMBOL = "(desconhecido)"
  const syms = [...new Set(rows.map((r) => r.symbol ?? UNKNOWN_SYMBOL))].sort()
  let pointsReason: string | null = null
  if (total === 0) pointsReason = "NO_TRADES"
  else if (syms.length > 1) pointsReason = "MIXED_INSTRUMENTS"
  else if (syms[0] === UNKNOWN_SYMBOL) pointsReason = "UNKNOWN_INSTRUMENT"
  const pts = rows.map((r) => toScaled(r.pointsPerContract, 6))
  const ptsDetails = pointsReason === "MIXED_INSTRUMENTS" ? { symbols: syms } : undefined
  mk("totalPoints", "points", pointsReason ? null : fromScaled(sum(pts), 6), pointsReason ? 0 : total, null, pointsReason ?? undefined, ptsDetails)
  const avgPts = pointsReason ? null : meanScaled(pts)
  mk("averagePoints", "points", avgPts === null ? null : fromScaled(avgPts, 6), pointsReason ? 0 : total, null, pointsReason ?? undefined, ptsDetails)
  if (trace) {
    for (const metric of ["totalPoints", "averagePoints"]) trace.add(metric, pointsReason ? "EXCLUDED_UNKNOWN" : "INCLUDED", ids(rows))
  }

  return out
}

// ── qualidade dos dados e avisos ─────────────────────────────────────────────

function dataQualityOf(rows: TradeRow[]): DataQuality {
  const total = rows.length
  const unknownByReason: Record<string, number> = {}
  for (const r of rows) if (r.rS === null) unknownByReason[r.rReason ?? "RISK_UNKNOWN"] = (unknownByReason[r.rReason ?? "RISK_UNKNOWN"] ?? 0) + 1
  const approx = rows.filter((r) => r.orderApprox).length
  const complete = total > 0 && rows.every((r) => r.netC !== null && r.timePrecision === "DATETIME" && r.symbol !== null)
  return {
    level: total === 0 ? "EMPTY" : complete ? "COMPLETE" : "PARTIAL",
    pnl: {
      total,
      netKnown: rows.filter((r) => r.netC !== null).length,
      grossKnown: rows.filter((r) => r.grossC !== null).length,
      commissionKnown: rows.filter((r) => r.commissionC !== null).length,
      feesKnown: rows.filter((r) => r.feesC !== null).length,
      unknownBasis: rows.filter((r) => r.unknownBasis).length,
    },
    r: { total, known: rows.filter((r) => r.rS !== null).length, unknownByReason },
    time: {
      datetime: rows.filter((r) => r.timePrecision === "DATETIME").length,
      dateOnly: rows.filter((r) => r.timePrecision === "DATE_ONLY").length,
      unknown: rows.filter((r) => r.timePrecision === "UNKNOWN").length,
    },
    instruments: { unknown: rows.filter((r) => r.symbol === null).length },
    order: { approximate: approx > 0, approximateCount: approx },
    granularity: {
      positionCycles: rows.filter((r) => r.granularity === "POSITION_CYCLE").length,
      sourceRows: rows.filter((r) => r.granularity === "SOURCE_ROW").length,
    },
    reconstruction: {
      cycles: rows.filter((r) => r.granularity === "POSITION_CYCLE").length,
      lowConfidence: rows.filter((r) => r.lowConfidence).length,
      unverifiedEdges: rows.filter((r) => r.unverifiedEdges).length,
    },
  }
}

function warningsOf(q: DataQuality, o: ResolvedOptions, report: FilterReport, afterFilters: number, classified: number, withoutIdentity = 0): MetricWarning[] {
  const w: MetricWarning[] = []
  const total = q.pnl.total
  const w_ = (code: string, message: string, metric?: string, severity: MetricWarning["severity"] = "WARNING") => w.push({ code, severity, message, ...(metric ? { metric } : {}) })
  if (afterFilters === 0) {
    w_("W_NO_TRADES", "Nenhum trade na população após os filtros.")
    return w
  }
  if (afterFilters < o.minSample) w_("W_LOW_SAMPLE", `Amostra pequena (${afterFilters} < ${o.minSample}): números são indicativos, não conclusivos.`)
  if (q.r.known === 0) w_("W_R_UNAVAILABLE", "R indisponível: nenhum trade tem stop/risco conhecido (R nunca é inferido).", "totalR")
  else if (q.r.known < total) w_("W_R_PARTIAL_COVERAGE", `R calculado em ${q.r.known} de ${total} trades (${percent(q.r.known, total)}%): as métricas de R valem só para esse subconjunto.`, "totalR")
  if (classified < total) w_("W_PNL_PARTIAL_COVERAGE", `${total - classified} de ${total} trades não têm P&L na base ${o.pnlBasis === "NET" ? "líquida" : "bruta"} e ficam fora de vencedores/perdedores/médias/drawdown.`, "winRate")
  if (q.pnl.unknownBasis > 0) w_("W_UNKNOWN_BASIS_EXCLUDED", `${q.pnl.unknownBasis} trades têm P&L de base desconhecida (nem bruto nem líquido): excluídos das métricas de P&L.`, "netPnl")
  if (q.pnl.commissionKnown < total) w_("W_COMMISSION_PARTIAL", `Comissão informada em ${q.pnl.commissionKnown} de ${total} trades: o líquido só existe para quem tem comissão.`, "netPnl")
  if (q.time.dateOnly + q.time.unknown > 0) w_("W_DATE_ONLY_TRADES", `${q.time.dateOnly + q.time.unknown} trades sem hora: ficam fora de análises por hora/sessão/dia de pregão.`, "hour")
  if (q.order.approximate) w_("W_ORDER_APPROXIMATE", `${q.order.approximateCount} trades sem horário de saída: a ordem (drawdown/sequências) é aproximada.`, "maxDrawdown")
  if (q.instruments.unknown > 0) w_("W_UNKNOWN_INSTRUMENT", `${q.instruments.unknown} trades de instrumento desconhecido (sem pointValue): P&L em dólar indisponível quando depende dele.`)
  const g = q.granularity
  if (g.positionCycles > 0 && g.sourceRows > 0) {
    w_("W_MIXED_GRANULARITY", `População mista: ${g.positionCycles} ciclos de posição + ${g.sourceRows} linhas da fonte tratadas como trade. Contagens e taxas misturam unidades diferentes.`, "totalTrades")
  } else if (g.sourceRows > 0) {
    w_("W_SOURCE_ROW_TRADES", `${g.sourceRows} "trades" são LINHAS da fonte (ciclo de posição não verificado): se a fonte divide um ciclo em várias linhas, a contagem e o win rate ficam inflados.`, "totalTrades", "INFO")
  }
  if (q.reconstruction.lowConfidence > 0) w_("W_RECONSTRUCTION_LOW_CONFIDENCE", `${q.reconstruction.lowConfidence} de ${g.positionCycles} ciclos têm reconstrução de baixa confiança (ambiguidade registrada no próprio ciclo); entram nas métricas, sinalizados.`, "totalTrades")
  if (q.reconstruction.unverifiedEdges > 0) w_("W_RECONSTRUCTION_UNVERIFIED_EDGES", `${q.reconstruction.unverifiedEdges} de ${g.positionCycles} ciclos têm borda não verificável (podem ter começado antes do período ou continuar abertos); entram nas métricas, sinalizados.`, "totalTrades", "INFO")
  if (withoutIdentity > 0) w_("W_TRADE_IDENTITY_MISSING", `${withoutIdentity} de ${afterFilters} trades não têm identidade determinística (tradeId/importId): a proveniência até a linha do arquivo está incompleta e o id usado é posicional.`, undefined, "INFO")
  const unknownExcluded = Object.values(report.excluded).reduce((a, e) => a + (e?.unknown ?? 0), 0)
  if (unknownExcluded > 0) w_("W_FILTER_EXCLUDED_UNKNOWN", `${unknownExcluded} trades foram excluídos pelos filtros por terem o atributo filtrado desconhecido.`, undefined, "INFO")
  return w
}

// ── resultado completo de uma população ──────────────────────────────────────

function populationOf(kept: TradeRow[], inputCount: number, report: FilterReport, o: ResolvedOptions): Population {
  const ids = kept.map((r) => r.id).sort()
  // O hash cobre a população COMPLETA (nunca é truncado pelo limite de `tradeIds`) e é SHA-256 (evidence/hash.ts):
  // identidade (tradeId/importId), linhas de origem (rowHash), reconstrução e os valores que alimentam as métricas.
  const fingerprints = kept.map((r) => tradeFingerprint(r.id, r.src.trade))
  const withIdentity = fingerprints.filter(hasIdentity).length
  return {
    inputTrades: inputCount,
    afterFilters: kept.length,
    tradeSetHash: tradeSetHash(fingerprints),
    tradeIds: kept.length <= o.tradeIdsLimit ? ids : null,
    provenance: { withIdentity, withoutIdentity: kept.length - withIdentity },
    filterReport: report,
  }
}

function periodOf(rows: TradeRow[]): Period {
  const dates = rows.map((r) => r.localDate).filter((x): x is string => x !== null).sort()
  const insts = rows.map((r) => r.anchorInstant).filter((x): x is string => x !== null).sort()
  return {
    fromLocalDate: dates[0] ?? null,
    toLocalDate: dates[dates.length - 1] ?? null,
    fromInstantUtc: insts[0] ?? null,
    toInstantUtc: insts[insts.length - 1] ?? null,
  }
}

function buildResult(kept: TradeRow[], inputCount: number, report: FilterReport, f: TradeFilters, o: ResolvedOptions, trace?: TraceBuilder): MetricsResult {
  const metrics = computeMetricSet(kept, o, trace)
  const quality = dataQualityOf(kept)
  const population = populationOf(kept, inputCount, report, o)
  return {
    schema: RESULT_SCHEMA,
    engineVersion: ENGINE_VERSION,
    query: { filters: f, options: o },
    population,
    period: periodOf(kept),
    metrics,
    dataQuality: quality,
    warnings: warningsOf(quality, o, report, kept.length, metrics.classifiedTrades.value ?? 0, population.provenance.withoutIdentity),
  }
}

/** calculateMetrics(trades, { filters?, ...opções }) → MetricsResult (auditável: filtros, período, amostra, cobertura, qualidade). */
export function calculateMetrics(trades: AnalyticsTrade[], args: { filters?: TradeFilters } & AnalysisOptions = {}): MetricsResult {
  return runMetrics(trades, args, false).result
}

/**
 * Mesmo cálculo de `calculateMetrics` (MESMO caminho de código) + o trace dos contribuintes registrado na mesma passada.
 * `result` é idêntico ao de `calculateMetrics`; o trace só ALIMENTA a Evidence (explainMetric), não participa de nenhuma conta.
 */
export function calculateMetricsTraced(trades: AnalyticsTrade[], args: { filters?: TradeFilters } & AnalysisOptions = {}): { result: MetricsResult; trace: MetricsTrace } {
  const r = runMetrics(trades, args, true)
  return { result: r.result, trace: r.trace as MetricsTrace }
}

function runMetrics(trades: AnalyticsTrade[], args: { filters?: TradeFilters } & AnalysisOptions, traced: boolean): { result: MetricsResult; trace: MetricsTrace | null } {
  const { filters, ...opts } = args
  const o = resolveOptions(opts)
  const f = normalizeFilters(filters)
  const rows = prepareTrades(trades, o)
  const { rows: kept, report } = applyFilters(rows, f)
  const builder = traced ? new TraceBuilder(o.tradeIdsLimit, kept.length) : undefined
  const result = buildResult(kept, rows.length, report, f, o, builder)
  return { result, trace: builder ? builder.build() : null }
}

// ── agrupamento ──────────────────────────────────────────────────────────────

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

interface DimDef {
  key: (r: TradeRow) => string | null
  label: (key: string | null) => string
}
const same = (k: string | null) => k ?? "(desconhecido)"

const DIMENSIONS: Record<Dimension, DimDef> = {
  day: { key: (r) => r.localDate, label: same },
  tradingDay: { key: (r) => r.tradingDay, label: same },
  week: { key: (r) => r.week, label: (k) => (k === null ? "(desconhecido)" : `semana de ${k}`) },
  month: { key: (r) => r.month, label: same },
  dayOfWeek: { key: (r) => (r.dayOfWeek === null ? null : String(r.dayOfWeek)), label: (k) => (k === null ? "(desconhecido)" : DOW_LABELS[Number(k)]) },
  hour: { key: (r) => (r.hour === null ? null : String(r.hour).padStart(2, "0")), label: (k) => (k === null ? "(sem horário)" : `${k}:00`) },
  session: { key: (r) => r.session, label: same },
  symbol: { key: (r) => r.symbol, label: (k) => k ?? "(instrumento desconhecido)" },
  direction: { key: (r) => r.direction, label: same },
  account: { key: (r) => r.account, label: same },
  strategy: { key: (r) => r.strategyId ?? r.strategyName, label: (k) => k ?? "(sem estratégia)" },
  strategyVersion: { key: (r) => r.strategyVersionId, label: (k) => k ?? "(sem versão)" },
  setup: { key: (r) => r.setup, label: (k) => k ?? "(sem setup)" },
  timeframe: { key: (r) => r.timeframe, label: (k) => k ?? "(sem timeframe)" },
}

export const DIMENSION_IDS = Object.keys(DIMENSIONS) as Dimension[]

/** Classificação de amostra de um grupo (OK ≥ minSample · LOW < minSample · TINY < MIN_BUCKET). Exportada para o verificador reutilizar a MESMA regra. */
export const sampleFlagOf = (size: number, minSample: number): GroupResult["sampleFlag"] => (size < MIN_BUCKET ? "TINY" : size < minSample ? "LOW" : "OK")

const SEP = "\u0001"
const NULL_TOKEN = "\u0000"

function compareKeys(a: Array<string | null>, b: Array<string | null>): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    if (a[i] === null) return 1 // desconhecido por último
    if (b[i] === null) return -1
    return (a[i] as string) < (b[i] as string) ? -1 : 1
  }
  return 0
}

/**
 * aggregateTrades(trades, { groupBy, filters?, metrics?, ...opções }): mesma população, particionada por uma ou mais
 * dimensões. A soma das amostras dos grupos = população total (grupo "desconhecido" incluído — nada some).
 */
export function aggregateTrades(
  trades: AnalyticsTrade[],
  args: { groupBy: Dimension | Dimension[]; filters?: TradeFilters; metrics?: string[] } & AnalysisOptions,
): AggregateResult {
  return runAggregate(trades, args, false).result
}

/** Mesmo cálculo de `aggregateTrades` (mesmo caminho) + trace do total e de cada grupo. `result` é idêntico ao de `aggregateTrades`. */
export function aggregateTradesTraced(
  trades: AnalyticsTrade[],
  args: { groupBy: Dimension | Dimension[]; filters?: TradeFilters; metrics?: string[] } & AnalysisOptions,
): { result: AggregateResult; trace: AggregateTrace } {
  const r = runAggregate(trades, args, true)
  return { result: r.result, trace: r.trace as AggregateTrace }
}

function runAggregate(
  trades: AnalyticsTrade[],
  args: { groupBy: Dimension | Dimension[]; filters?: TradeFilters; metrics?: string[] } & AnalysisOptions,
  traced: boolean,
): { result: AggregateResult; trace: AggregateTrace | null } {
  const { groupBy, filters, metrics: metricIds, ...opts } = args
  const dims = Array.isArray(groupBy) ? groupBy : [groupBy]
  if (dims.length === 0) throw new MetricsInputError("E_GROUPBY_INVALID", "groupBy vazio.")
  for (const d of dims) if (!DIMENSIONS[d]) throw new MetricsInputError("E_GROUPBY_INVALID", `Dimensão desconhecida: "${d}". Válidas: ${DIMENSION_IDS.join(", ")}.`)
  if (metricIds) for (const id of metricIds) if (!METRIC_IDS.includes(id)) throw new MetricsInputError("E_METRIC_UNKNOWN", `Métrica desconhecida: "${id}".`)

  const o = resolveOptions(opts)
  const f = normalizeFilters(filters)
  const rows = prepareTrades(trades, o)
  const { rows: kept, report } = applyFilters(rows, f)
  const totalBuilder = traced ? new TraceBuilder(o.tradeIdsLimit, kept.length) : undefined
  const total = buildResult(kept, rows.length, report, f, o, totalBuilder)
  const groupTraces: AggregateTrace["groups"] = []

  const buckets = new Map<string, { key: Array<string | null>; rows: TradeRow[] }>()
  for (const r of kept) {
    const key = dims.map((d) => DIMENSIONS[d].key(r))
    const id = key.map((k) => k ?? NULL_TOKEN).join(SEP)
    const b = buckets.get(id)
    if (b) b.rows.push(r)
    else buckets.set(id, { key, rows: [r] })
  }

  const groups: GroupResult[] = [...buckets.values()]
    .sort((a, b) => compareKeys(a.key, b.key))
    .map((b) => {
      const groupBuilder = traced ? new TraceBuilder(o.tradeIdsLimit, b.rows.length) : undefined
      const all = computeMetricSet(b.rows, o, groupBuilder)
      const picked = metricIds ? Object.fromEntries(metricIds.map((id) => [id, all[id]])) : all
      const size = b.rows.length
      const groupPopulation = populationOf(b.rows, size, { input: size, kept: size, excluded: {} }, o)
      if (groupBuilder) groupTraces.push({ trace: groupBuilder.build(), population: groupPopulation })
      return {
        key: b.key,
        label: b.key.map((k, i) => DIMENSIONS[dims[i]].label(k)).join(" · "),
        sampleSize: size,
        sampleFlag: sampleFlagOf(size, o.minSample),
        tradeSetHash: groupPopulation.tradeSetHash,
        metrics: picked,
      }
    })

  const warnings: MetricWarning[] = []
  const unknownGroup = groups.filter((g) => g.key.some((k) => k === null))
  if (unknownGroup.length) {
    warnings.push({
      code: "W_GROUP_UNKNOWN_BUCKET",
      severity: "WARNING",
      message: `${unknownGroup.reduce((a, g) => a + g.sampleSize, 0)} trades caíram em grupo "desconhecido" (atributo ausente para ${dims.join(" × ")}).`,
    })
  }
  const lowGroups = groups.filter((g) => g.sampleFlag !== "OK").length
  if (lowGroups) {
    warnings.push({ code: "W_LOW_SAMPLE_GROUPS", severity: "INFO", message: `${lowGroups} de ${groups.length} grupos têm amostra pequena (< ${o.minSample}); grupos com < ${MIN_BUCKET} trades são só ilustrativos.` })
  }

  const result: AggregateResult = {
    schema: AGGREGATE_SCHEMA,
    engineVersion: ENGINE_VERSION,
    query: { filters: f, options: o, groupBy: dims, metricIds: metricIds ?? null },
    total,
    groups,
    warnings,
  }
  return { result, trace: totalBuilder ? { total: totalBuilder.build(), groups: groupTraces } : null }
}

/** R por trade (auditável): quais trades têm R, qual valor e, se não têm, POR QUÊ. Nunca estima. */
export function perTradeR(
  trades: AnalyticsTrade[],
  args: { filters?: TradeFilters } & AnalysisOptions = {},
): Array<{ id: string; r: number | null; reason: string | null }> {
  const { filters, ...opts } = args
  const o = resolveOptions(opts)
  const f = normalizeFilters(filters)
  const { rows } = applyFilters(prepareTrades(trades, o), f)
  return rows.map((r) => ({ id: r.id, r: r.rS === null ? null : fromRScaled(r.rS), reason: r.rS === null ? (r.rReason ?? "RISK_UNKNOWN") : null }))
}
