// explainMetric (Evidence E4): MetricsResult + trace do motor → MetricEvidence → TradeEvidence → SourceRowRef → ImportRef.
// NÃO é um segundo motor: nenhum P&L, drawdown, PF, win rate ou filtro é recalculado nem reclassificado. Valor, população, período,
// qualidade e avisos são COPIADOS do resultado; os contribuintes são COPIADOS do trace que o próprio motor registrou na mesma passada
// (`calculateMetricsTraced` / `aggregateTradesTraced`). O `tradeSetHash` é o do motor (SHA-256 do E2): aqui só se confere, não se recalcula.
// Evidence não fabrica identidade: população com trade sem tradeId/importId ⇒ E_POPULATION_IDENTITY_MISSING.
// Puro: sem relógio, sem random, sem banco; projeção por lista branca; contas sempre como accountRef.

import type { ImportRecord } from "../domain/canonical.ts"
import { accountRef as makeAccountRef } from "../ingest/identity.ts"
import type { AggregateResult, AnalyticsTrade, MetricsResult, MetricValue, Population } from "../metrics/types.ts"
import type { AggregateTrace, MetricsTrace } from "../metrics/trace.ts"
import { explainTrades, type ExplainNote } from "./explain-trade.ts"
import { EVIDENCE_SCHEMA, sealEvidence } from "./hash.ts"
import { findAccountNameLeak } from "./redact.ts"
import { MetricEvidenceSchema, type EvidenceBundle, type ImportRef, type MetricEvidence, type TradeEvidence } from "./schema.ts"

export type ExplainMetricErrorCode =
  | "E_METRIC_UNKNOWN"
  | "E_SCOPE_INVALID"
  | "E_RESULT_TRACE_MISMATCH"
  | "E_POPULATION_IDENTITY_MISSING"
  | "E_TRADE_UNRESOLVED"
  | "E_IMPORT_UNRESOLVED"
  | "E_TRADE_EXPLAIN_FAILED"
  | "E_ACCOUNT_NAME_LEAK"
  | "E_SCHEMA"

export type MetricSource =
  | { kind: "METRICS"; result: MetricsResult; trace: MetricsTrace }
  | { kind: "AGGREGATE"; result: AggregateResult; trace: AggregateTrace; scope: { kind: "TOTAL" } | { kind: "GROUP"; index: number } }

export interface ExplainMetricInput {
  metricId: string
  source: MetricSource
  /** Os MESMOS AnalyticsTrade que alimentaram o motor (resolvem id → trade canônico). */
  trades: AnalyticsTrade[]
  /** ImportRecord(s) dos imports de origem (do pipeline). */
  importRecords: ImportRecord[]
  opts?: { accountRefSalt?: string }
}

export type ExplainMetricOk = {
  ok: true
  metricEvidence: MetricEvidence
  tradeEvidences: TradeEvidence[]
  importRefs: ImportRef[]
  notes: ExplainNote[]
}
export type ExplainMetricResult = ExplainMetricOk | { ok: false; code: ExplainMetricErrorCode; message: string }

const fail = (code: ExplainMetricErrorCode, message: string): ExplainMetricResult => ({ ok: false, code, message })

/** Todos os campos de TradeFilters (exceto `account`, que vira accountRefs). Lista explícita: filtro novo só entra se alguém decidir. */
const FILTER_KEYS = ["from", "to", "symbol", "direction", "session", "hour", "dayOfWeek", "tradingDay", "strategyId", "strategyName", "strategyVersionId", "setup", "timeframe"] as const

interface View {
  scope: "TOTAL" | "GROUP"
  metric: MetricValue | undefined
  population: Population
  trace: MetricsTrace
  filters: MetricsResult["query"]["filters"]
  options: MetricsResult["query"]["options"]
  groupBy: string[] | null
  groupKey: Array<string | null> | null
  period: MetricsResult["period"] | null
  dataQuality: MetricsResult["dataQuality"] | null
  warnings: MetricsResult["warnings"]
  engineVersion: string
  sampleFlag: "OK" | "LOW" | "TINY" | null
}

function resolveView(metricId: string, source: MetricSource): View | ExplainMetricResult {
  if (source.kind === "METRICS") {
    const { result, trace } = source
    return {
      scope: "TOTAL",
      metric: result.metrics[metricId],
      population: result.population,
      trace,
      filters: result.query.filters,
      options: result.query.options,
      groupBy: null,
      groupKey: null,
      period: result.period,
      dataQuality: result.dataQuality,
      warnings: result.warnings,
      engineVersion: result.engineVersion,
      sampleFlag: null,
    }
  }
  const { result, trace, scope } = source
  if (scope.kind === "TOTAL") {
    return {
      scope: "TOTAL",
      metric: result.total.metrics[metricId],
      population: result.total.population,
      trace: trace.total,
      filters: result.query.filters,
      options: result.query.options,
      groupBy: null,
      groupKey: null,
      period: result.total.period,
      dataQuality: result.total.dataQuality,
      warnings: result.total.warnings,
      engineVersion: result.engineVersion,
      sampleFlag: null,
    }
  }
  const group = result.groups[scope.index]
  const gt = trace.groups[scope.index]
  if (!group || !gt) return fail("E_SCOPE_INVALID", `Grupo ${scope.index} inexistente (resultado tem ${result.groups.length}; trace ${trace.groups.length}).`)
  if (group.tradeSetHash !== gt.population.tradeSetHash) return fail("E_RESULT_TRACE_MISMATCH", "tradeSetHash do grupo ≠ o do trace: resultado e trace não vêm da mesma chamada.")
  return {
    scope: "GROUP",
    metric: group.metrics[metricId],
    population: gt.population,
    trace: gt.trace,
    filters: result.query.filters,
    options: result.query.options,
    groupBy: [...result.query.groupBy],
    groupKey: [...group.key],
    period: null,
    dataQuality: null,
    warnings: [],
    engineVersion: result.engineVersion,
    sampleFlag: group.sampleFlag,
  }
}

const sortedUnique = (xs: string[]) => [...new Set(xs)].sort()

export function explainMetric(input: ExplainMetricInput): ExplainMetricResult {
  const { metricId, source, trades, importRecords } = input
  const salt = input.opts?.accountRefSalt ?? ""

  // 1) o que o motor produziu (cópia, sem recalcular)
  const v = resolveView(metricId, source)
  if ("ok" in v) return v
  if (!v.metric) return fail("E_METRIC_UNKNOWN", `Métrica "${metricId}" não está neste resultado.`)
  const metricTrace = v.trace.metrics[metricId]
  if (!metricTrace) return fail("E_METRIC_UNKNOWN", `Métrica "${metricId}" não está no trace.`)
  if (v.trace.populationSize !== v.population.afterFilters || v.trace.limit !== v.options.tradeIdsLimit) {
    return fail("E_RESULT_TRACE_MISMATCH", "O trace não corresponde ao resultado (tamanho da população ou limite diferentes): não vieram da mesma chamada.")
  }

  // 2) Evidence não fabrica identidade
  if (v.population.provenance.withoutIdentity > 0) {
    return fail("E_POPULATION_IDENTITY_MISSING", `${v.population.provenance.withoutIdentity} de ${v.population.afterFilters} trades da população não têm tradeId/importId: não há como apontar para a origem.`)
  }

  // 3) trades referenciados: população (≤ limite) ∪ contribuintes/âncoras do trace
  const contributorItems = metricTrace.applicable ? (metricTrace.contributors ?? metricTrace.anchors) : []
  const wantedIds = sortedUnique([...(v.population.tradeIds ?? []), ...contributorItems.map((c) => c.tradeId)])
  const byId = new Map(trades.map((t) => [t.id, t]))
  const referenced = []
  for (const id of wantedIds) {
    const at = byId.get(id)
    if (!at) return fail("E_TRADE_UNRESOLVED", `Trade "${id}" citado pelo resultado/trace não está em \`trades\`.`)
    if (!at.trade.tradeId || !at.trade.importId) return fail("E_POPULATION_IDENTITY_MISSING", `Trade "${id}" não tem tradeId/importId.`)
    if (at.trade.tradeId !== at.id) return fail("E_TRADE_UNRESOLVED", `O id do motor ("${at.id}") ≠ tradeId do trade ("${at.trade.tradeId}").`)
    referenced.push(at.trade)
  }

  // 4) TradeEvidence + ImportRef (E3), por import, com a lista COMPLETA de contas conhecidas
  const recordById = new Map(importRecords.map((r) => [r.importId, r]))
  const importIds = sortedUnique(referenced.map((t) => t.importId as string))
  const tradeEvidences: TradeEvidence[] = []
  const importRefs: ImportRef[] = []
  const notes: ExplainNote[] = []
  for (const importId of importIds) {
    const record = recordById.get(importId)
    if (!record) return fail("E_IMPORT_UNRESOLVED", `ImportRecord "${importId}" não informado.`)
    const names = trades.filter((t) => t.trade.importId === importId).map((t) => t.trade.account.sourceName).filter((n): n is string => !!n)
    const results = explainTrades(referenced.filter((t) => t.importId === importId), record, { accountRefSalt: salt, knownAccountNames: sortedUnique(names) })
    for (const r of results) {
      if (!r.ok) return fail("E_TRADE_EXPLAIN_FAILED", `${r.code}: ${r.message}`)
      tradeEvidences.push(r.tradeEvidence)
      for (const n of r.notes) if (!notes.some((x) => x.code === n.code && x.message === n.message)) notes.push(n)
    }
    const first = results[0]
    if (first && first.ok) importRefs.push(first.importRef)
  }
  tradeEvidences.sort((a, b) => (a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : 0))

  // 5) contas → accountRef (filtros e chave de grupo)
  const refByName = new Map<string, string>()
  for (const t of trades) {
    const name = t.trade.account.sourceName?.trim()
    if (name && t.trade.account.ref) refByName.set(name, t.trade.account.ref)
  }
  const refOf = (name: string): string => refByName.get(name.trim()) ?? makeAccountRef(name, salt) ?? "acc_?"
  const filters: Record<string, unknown> = {}
  for (const key of FILTER_KEYS) {
    const val = v.filters[key]
    if (val !== undefined) filters[key] = Array.isArray(val) ? [...val] : val
  }
  if (v.filters.account !== undefined) {
    const names = Array.isArray(v.filters.account) ? v.filters.account : [v.filters.account]
    filters.accountRefs = sortedUnique(names.map(refOf))
  }
  const groupKey = v.groupKey && v.groupBy ? v.groupKey.map((k, i) => (k !== null && v.groupBy?.[i] === "account" ? refOf(k) : k)) : null

  // 6) projeção por lista branca
  const pop = v.population
  const metricEvidence = {
    metricId,
    definitionVersion: v.metric.definitionVersion,
    engineVersion: v.engineVersion,
    scope: v.scope,
    value: v.metric.value,
    unit: v.metric.unit,
    basis: v.metric.basis,
    sampleSize: v.metric.sampleSize,
    coverage: { used: v.metric.coverage.used, total: v.metric.coverage.total, ratio: v.metric.coverage.ratio },
    reason: v.metric.reason,
    sampleFlag: v.sampleFlag,
    query: {
      filters,
      options: {
        timeZone: v.options.timeZone,
        timeAnchor: v.options.timeAnchor,
        pnlBasis: v.options.pnlBasis,
        rBasis: v.options.rBasis,
        tradeIdsLimit: v.options.tradeIdsLimit,
        minSample: v.options.minSample,
      },
      timeZone: v.options.timeZone,
      groupBy: v.groupBy,
      groupKey,
    },
    period: v.period
      ? { fromLocalDate: v.period.fromLocalDate, toLocalDate: v.period.toLocalDate, fromInstantUtc: v.period.fromInstantUtc, toInstantUtc: v.period.toInstantUtc }
      : null,
    population: {
      inputTrades: pop.inputTrades,
      afterFilters: pop.afterFilters,
      tradeSetHash: pop.tradeSetHash,
      tradeIds: pop.tradeIds ? [...pop.tradeIds] : null,
      filterReport: JSON.parse(JSON.stringify(pop.filterReport)) as Record<string, unknown>,
      provenance: { withIdentity: pop.provenance.withIdentity, withoutIdentity: pop.provenance.withoutIdentity },
    },
    verifiability: pop.tradeIds === null ? ("HASH_ONLY" as const) : ("FULL" as const),
    contributors: {
      applicable: metricTrace.applicable,
      complete: metricTrace.applicable ? metricTrace.contributors !== null : true,
      roleCounts: { ...metricTrace.roleCounts },
      items: contributorItems.map((c) => ({ tradeId: c.tradeId, role: c.role, ...(c.rank !== undefined ? { rank: c.rank } : {}) })),
    },
    dataQuality: v.dataQuality ? (JSON.parse(JSON.stringify(v.dataQuality)) as Record<string, unknown>) : null,
    warnings: v.warnings.map((w) => ({ code: w.code, severity: w.severity, message: w.message, ...(w.metric !== undefined ? { metric: w.metric } : {}) })),
    computedAt: null,
  }
  const parsed = MetricEvidenceSchema.safeParse(metricEvidence)
  if (!parsed.success) return fail("E_SCHEMA", `MetricEvidence fora do schema evidence/1: ${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}`)

  // 7) o hash da população é o do motor — só se confere
  if (parsed.data.population.tradeSetHash !== pop.tradeSetHash) return fail("E_RESULT_TRACE_MISMATCH", "tradeSetHash da Evidence ≠ o do motor.")

  // 8) trava final (fail-closed): nenhum nome de conta do conjunto de entrada em NENHUM valor/chave da saída
  const allNames = sortedUnique(trades.map((t) => t.trade.account.sourceName?.trim() ?? "").filter((n) => n !== ""))
  const leak = findAccountNameLeak({ metricEvidence: parsed.data, tradeEvidences, importRefs }, allNames)
  if (leak) return fail("E_ACCOUNT_NAME_LEAK", `Nome de conta encontrado na Evidence (${leak}); resultado descartado.`)

  return { ok: true, metricEvidence: parsed.data, tradeEvidences, importRefs, notes }
}

/** Monta e sela o bundle (evidenceHash) de UMA métrica: claim → MetricEvidence → TradeEvidence → ImportRef. */
export function metricEvidenceBundle(r: ExplainMetricOk): EvidenceBundle {
  return sealEvidence({
    schema: EVIDENCE_SCHEMA,
    claim: { kind: "METRIC", statement: null },
    subject: { type: "METRIC", id: r.metricEvidence.metricId },
    evidence: { imports: r.importRefs, trades: r.tradeEvidences, metrics: [r.metricEvidence] },
  })
}
