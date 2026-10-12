// Motor de métricas determinísticas — API pública.
//   filterTrades()    → trades que passam + relatório do que foi excluído e por quê
//   calculateMetrics()→ MetricsResult (métricas + população + período + qualidade + avisos)
//   aggregateTrades() → o mesmo, particionado por dimensões (hora, dia da semana, símbolo, estratégia…)
export { aggregateTrades, aggregateTradesTraced, calculateMetrics, calculateMetricsTraced, computeMetricSet, DIMENSION_IDS, perTradeR, sampleFlagOf } from "./calculate.ts"
export { METRIC_CATALOG, METRIC_IDS, metricDefinition, DEFINITION_VERSION } from "./catalog.ts"
export { applyFilters, filterTrades, normalizeFilters } from "./filter.ts"
export { prepareTrades, resolveOptions, toAnalyticsTrades, DEFAULT_TIME_ZONE } from "./prepare.ts"
export { EXIT_REASON_BUCKETS, EXIT_REASON_LABELS, exitReasonOf } from "./exit-reason.ts"
export type { ExitReasonBucket, TradeExitReason } from "./exit-reason.ts"
export { EXIT_BREAKDOWN_SCHEMA, EXIT_BREAKDOWN_VERSION, MONEY_FIELDS, exitBreakdown } from "./legs.ts"
export type { Divergence, ExitBreakdownResult, ExitBreakdownWarning, FieldReconciliation, LegRef, MoneyField, MoneySum, ReasonBreakdown, ReasonKey } from "./legs.ts"
export { ANALYSIS_SCHEMA, ANALYSIS_VERSION, DEFAULT_COMPARE_METRICS, compareExitReasons, compareGroups, comparePeriods, compareTradeBuckets, exitReasonAnalysis, rankGroups, rankGroupsByExitLegs } from "./analysis.ts"
export type { AnalysisUnit, Cell, Comparison, Confidence, ExitContext, ExitReasonAnalysis, Fraction, GroupRanking, KeyOut, LegGroupRanking, LegGroupRow, LegReasonRow, LimitationCode, MetricComparison, RankedGroup, SampleFlag, Side, TradeBucketRow } from "./analysis.ts"
export { drawdown, streaks } from "./sequence.ts"
export * from "./types.ts"
export { ANCHOR_ROLES, CONTRIBUTOR_ROLES, TraceBuilder } from "./trace.ts"
export type { AggregateTrace, Contributor, ContributorRole, MetricTrace, MetricsTrace } from "./trace.ts"
