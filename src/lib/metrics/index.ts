// Motor de métricas determinísticas — API pública.
//   filterTrades()    → trades que passam + relatório do que foi excluído e por quê
//   calculateMetrics()→ MetricsResult (métricas + população + período + qualidade + avisos)
//   aggregateTrades() → o mesmo, particionado por dimensões (hora, dia da semana, símbolo, estratégia…)
export { aggregateTrades, aggregateTradesTraced, calculateMetrics, calculateMetricsTraced, computeMetricSet, DIMENSION_IDS, perTradeR } from "./calculate.ts"
export { METRIC_CATALOG, METRIC_IDS, metricDefinition, DEFINITION_VERSION } from "./catalog.ts"
export { applyFilters, filterTrades, normalizeFilters } from "./filter.ts"
export { prepareTrades, resolveOptions, toAnalyticsTrades, DEFAULT_TIME_ZONE } from "./prepare.ts"
export { drawdown, streaks } from "./sequence.ts"
export * from "./types.ts"
export { ANCHOR_ROLES, CONTRIBUTOR_ROLES, TraceBuilder } from "./trace.ts"
export type { AggregateTrace, Contributor, ContributorRole, MetricTrace, MetricsTrace } from "./trace.ts"
