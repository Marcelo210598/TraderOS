// Tipos públicos do motor de métricas determinísticas.
//
//   AnalyticsTrade[]  ──filterTrades──►  AnalyticsTrade[]  ──calculateMetrics──►  MetricsResult
//                                        └──────aggregateTrades(groupBy)──────►  AggregateResult
//
// Puro: não conhece Prisma, banco, UI, LLM nem dado de mercado. Cada número sai com seu tamanho de amostra,
// cobertura, base (líquido/bruto, R líquido/pontos), filtros e período — o suficiente para o Evidence (Incremento 5)
// apontar de volta para a origem sem retrabalho.

import type { CanonicalTrade } from "../domain/canonical.ts"

export const ENGINE_VERSION = "metrics/1.0.0"
export const RESULT_SCHEMA = "metrics-result/1" as const
export const AGGREGATE_SCHEMA = "metrics-aggregate/1" as const

/** Mesmos limiares que o app já usa em analytics-insights.ts (MIN_SAMPLE = 30; MIN_BUCKET = 3). */
export const MIN_SAMPLE = 30
export const MIN_BUCKET = 3

/** Um trade canônico + os vínculos que (ainda) não vivem no CanonicalTrade. */
export interface AnalyticsTrade {
  /** Identificador ESTÁVEL do trade (futuramente o id do banco). Único no conjunto. */
  id: string
  trade: CanonicalTrade
  strategyId?: string | null
  strategyVersionId?: string | null
  setup?: string | null
  timeframe?: string | null
}

export type PnlBasisOption = "NET" | "GROSS"
export type RBasisOption = "NET" | "POINTS"
export type TimeAnchor = "ENTRY" | "EXIT"

export interface AnalysisOptions {
  /** Fuso IANA para hora/dia/semana/mês/dia da semana. Preferência do usuário; sem ela, `DEFAULT_ANALYSIS_TIME_ZONE`. Sessão/calendário CME usam New_York por definição. Sempre ecoado. */
  timeZone?: string
  /** Qual instante do trade define "quando" (padrão: a ENTRADA). */
  timeAnchor?: TimeAnchor
  /** P&L usado em vencedores/perdedores/médias/drawdown. Padrão NET. NÃO existe "melhor disponível": misturar bruto e líquido é proibido. */
  pnlBasis?: PnlBasisOption
  /** R usado nas métricas de R. NET = r.net (P&L líquido / risco $); POINTS = r.points (sem custos). */
  rBasis?: RBasisOption
  /** Quantos ids de trades incluir no resultado (população). Acima disso só o hash. Padrão 500. */
  tradeIdsLimit?: number
  /** Limiar de amostra baixa. Padrão MIN_SAMPLE (30). */
  minSample?: number
}

export interface ResolvedOptions {
  timeZone: string
  timeAnchor: TimeAnchor
  pnlBasis: PnlBasisOption
  rBasis: RBasisOption
  tradeIdsLimit: number
  minSample: number
}

/** Filtros estruturados, composáveis. Campos ausentes não filtram; campos presentes combinam com AND; arrays = OR dentro do campo. */
export interface TradeFilters {
  /** "YYYY-MM-DD" inclusivo, pela data local (no fuso da análise) do instante âncora. */
  from?: string
  to?: string
  symbol?: string | string[]
  direction?: "LONG" | "SHORT"
  account?: string | string[]
  /** "AM" | "PM" | "OVERNIGHT" (sessão derivada em ET) */
  session?: string | string[]
  /** 0–23, hora local do instante âncora no fuso da análise */
  hour?: number | number[]
  /** 0 = domingo … 6 = sábado */
  dayOfWeek?: number | number[]
  /** "YYYY-MM-DD" — dia de PREGÃO CME do instante âncora */
  tradingDay?: string | string[]
  strategyId?: string | string[]
  strategyName?: string | string[]
  strategyVersionId?: string | string[]
  setup?: string | string[]
  timeframe?: string | string[]
}

export type FilterField = keyof TradeFilters

export interface FilterReport {
  input: number
  kept: number
  /** Por campo: quantos foram excluídos por NÃO casar / por o atributo ser DESCONHECIDO no trade (ex.: filtro de hora em DATE_ONLY). */
  excluded: Partial<Record<FilterField, { mismatch: number; unknown: number }>>
}

export type Dimension =
  | "day"
  | "tradingDay"
  | "week"
  | "month"
  | "dayOfWeek"
  | "hour"
  | "session"
  | "symbol"
  | "direction"
  | "account"
  | "strategy"
  | "strategyVersion"
  | "setup"
  | "timeframe"

export type MetricUnit = "count" | "usd" | "R" | "percent" | "ratio" | "points"

export interface Coverage {
  /** Trades que contribuíram para este número. */
  used: number
  /** Trades na população (após filtros). */
  total: number
  /** used / total (0–1, 4 casas). 1 quando total = 0 não se aplica (sem população). */
  ratio: number
}

/** Um número auditável. `value = null` ⇒ INDISPONÍVEL (com `reason`), nunca zero disfarçado. */
export interface MetricValue {
  metric: string
  value: number | null
  unit: MetricUnit
  /** Amostra efetiva deste número (trades que o calcularam). */
  sampleSize: number
  coverage: Coverage
  available: boolean
  reason: string | null
  /** Base de P&L/R usada, quando se aplica. */
  basis: "NET" | "GROSS" | "R_NET" | "R_POINTS" | null
  /** Versão da definição (catalog.ts) — se a fórmula mudar, a versão muda. */
  definitionVersion: string
  details?: Record<string, unknown>
}

export interface MetricWarning {
  code: string
  severity: "WARNING" | "INFO"
  message: string
  metric?: string
}

export interface DataQuality {
  level: "COMPLETE" | "PARTIAL" | "EMPTY"
  pnl: { total: number; netKnown: number; grossKnown: number; commissionKnown: number; feesKnown: number; unknownBasis: number }
  r: { total: number; known: number; unknownByReason: Record<string, number> }
  time: { datetime: number; dateOnly: number; unknown: number }
  instruments: { unknown: number }
  order: { approximate: boolean; approximateCount: number }
  /** Unidade factual dos "trades": ciclos de posição reconstruídos × linhas da fonte tratadas como trade. */
  granularity: { positionCycles: number; sourceRows: number }
  /** Sinalização da reconstrução: ciclos de baixa confiança / borda não verificada ENTRAM nas métricas, nunca são descartados. */
  reconstruction: { cycles: number; lowConfidence: number; unverifiedEdges: number }
}

export interface Population {
  inputTrades: number
  afterFilters: number
  /** Hash determinístico do conjunto (ids + valores relevantes), independente da ordem de entrada. */
  tradeSetHash: string
  /** Ids (ordenados) quando afterFilters ≤ tradeIdsLimit; senão null (use o hash). */
  tradeIds: string[] | null
  filterReport: FilterReport
}

export interface Period {
  /** Data local mínima/máxima do instante âncora entre os trades da população. */
  fromLocalDate: string | null
  toLocalDate: string | null
  /** Instantes UTC mínimo/máximo (null se nenhum trade tem hora). */
  fromInstantUtc: string | null
  toInstantUtc: string | null
}

export interface MetricsQuery {
  filters: TradeFilters
  options: ResolvedOptions
}

export interface MetricsResult {
  schema: typeof RESULT_SCHEMA
  engineVersion: string
  query: MetricsQuery
  population: Population
  period: Period
  metrics: Record<string, MetricValue>
  dataQuality: DataQuality
  warnings: MetricWarning[]
}

export interface GroupResult {
  /** Uma chave por dimensão (null = atributo desconhecido p/ esses trades, ex.: "(sem horário)"). */
  key: Array<string | null>
  label: string
  sampleSize: number
  /** OK ≥ minSample · LOW < minSample · TINY < MIN_BUCKET */
  sampleFlag: "OK" | "LOW" | "TINY"
  tradeSetHash: string
  metrics: Record<string, MetricValue>
}

export interface AggregateResult {
  schema: typeof AGGREGATE_SCHEMA
  engineVersion: string
  query: MetricsQuery & { groupBy: Dimension[]; metricIds: string[] | null }
  /** Totais da população INTEIRA (mesma que a soma dos grupos). */
  total: MetricsResult
  groups: GroupResult[]
  warnings: MetricWarning[]
}

export class MetricsInputError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "MetricsInputError"
    this.code = code
  }
}
