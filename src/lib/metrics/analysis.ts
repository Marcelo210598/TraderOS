// E6.2 — ranking, contribuição e comparação de grupos. Funções PURAS sobre o que o motor já calcula (`aggregateTradesTraced`,
// `calculateMetrics`, `exitBreakdown`, `exitReasonOf`). Nenhuma fórmula financeira nova e nenhum 2º motor: aqui só se ESCOLHE, ORDENA,
// DIVIDE e SUBTRAI números já calculados (em inteiros escalados, exact.ts), sempre com a unidade, a cobertura e a amostra à vista.
//
// Princípios (data-contract §15.3):
//   · cada resultado declara a UNIDADE (TRADE × LEG); nunca se mistura contagem de pernas com contagem de trades;
//   · valor indisponível = `null` + `reason`; nunca zero. Percentual/fração só com denominador válido (≠ 0, conhecido);
//   · ranking não elimina ninguém: grupo desconhecido, UNKNOWN e MIXED aparecem; amostra TINY ou valor ausente ficam FORA DA NUMERAÇÃO,
//     mas listados e explicados;
//   · inferência só DESCRITIVA (`inference: "DESCRIPTIVE_ONLY"`): amostra, `sampleFlag`, cobertura, delta e razão. Sem p-valor, sem
//     "significativo", sem "melhor" por causa: ordenação por um critério explícito, empate documentado;
//   · divergência perna×trade (E6.1) é carregada adiante e rebaixa a confiança — não é escondida nem corrigida;
//   · privacidade: por padrão (`redact`), chaves/rótulos das dimensões `account` e `strategy` saem como `accountRef`/`strategyRef`
//     (mesmo mecanismo e sal da Evidence); nunca nome em claro, `sourceLabel` ou trecho do CSV.

import type { ExitReason } from "../domain/canonical.ts"
import { accountRef as makeAccountRef, strategyRef as makeStrategyRef } from "../ingest/identity.ts"
import { aggregateTradesTraced, calculateMetrics, dimensionLabel, sampleFlagOf } from "./calculate.ts"
import { metricDefinition } from "./catalog.ts"
import { EXIT_REASON_BUCKETS, EXIT_REASON_LABELS, type ExitReasonBucket } from "./exit-reason.ts"
import { fromScaled, ratio, toScaled } from "./exact.ts"
import { exitBreakdown, type ExitBreakdownResult, type MoneySum, type ReasonBreakdown } from "./legs.ts"
import { resolveOptions } from "./prepare.ts"
import { MetricsInputError, type AnalysisOptions, type AnalyticsTrade, type Dimension, type MetricUnit, type MetricValue, type TradeFilters } from "./types.ts"

export const ANALYSIS_SCHEMA = "metrics-analysis/1" as const
export const ANALYSIS_VERSION = "1.0.0"

export type AnalysisUnit = "TRADE" | "LEG"
export type SampleFlag = "OK" | "LOW" | "TINY"
/** OK = nenhuma limitação conhecida · LIMITED = use com a ressalva · UNRELIABLE = não sustenta conclusão. NÃO é significância estatística. */
export type Confidence = "OK" | "LIMITED" | "UNRELIABLE"
export type LimitationCode =
  | "SAMPLE_TINY"
  | "SAMPLE_LOW"
  | "METRIC_UNAVAILABLE"
  | "COVERAGE_PARTIAL"
  | "UNKNOWN_GROUP"
  | "UNKNOWN_EXIT_REASON"
  | "TRADES_WITHOUT_LEGS"
  | "RECONCILIATION_DIVERGENT"
  | "RECONCILIATION_PARTIAL"
  | "GROUP_NOT_FOUND"
  | "PERIOD_EMPTY"
  | "PERIODS_OVERLAP"

/** Casas decimais de cada unidade na saída do motor (exact.ts): delta e razão são feitos em inteiros escalados. */
const UNIT_DECIMALS: Record<MetricUnit, number> = { count: 0, usd: 2, R: 4, percent: 2, ratio: 4, points: 6 }

export interface Cell {
  value: number | null
  unit: MetricUnit
  available: boolean
  /** Por que não há valor (ou o aviso do motor); null quando há valor. */
  reason: string | null
  /** Quantas unidades (trades ou pernas) têm o valor / quantas existem. `ratio` null se `total` = 0. */
  coverage: { used: number; total: number; ratio: number | null }
}

export interface Fraction {
  /** Fração (4 casas; 0,25 = 25%). Pode ser > 1 ou < 0 quando as partes têm sinais opostos. */
  value: number | null
  reason: string | null
}

export interface KeyOut {
  dims: Dimension[]
  /** Chave por dimensão: `account`/`strategy` viram ref quando `redact`. `null` = atributo desconhecido (grupo "desconhecido"). */
  key: Array<string | null>
  label: string
}

export interface ExitContext {
  /** Trades do grupo por bucket do E6.0 (UNIDADE: trades). */
  tradesByBucket: Record<ExitReasonBucket, number>
  unknownTradesShare: number | null
  mixedTradesShare: number | null
  tradesWithoutLegs: number
  /** UNIDADE: pernas. */
  legs: number
  unknownLegs: number
  unknownLegsShare: number | null
  reconciliation: { status: "FULL" | "PARTIAL" | "DIVERGENT" | "NO_LEGS"; netDivergent: number; netNotComparable: number; divergentTotal: number }
}

// ── utilitários ──────────────────────────────────────────────────────────────

const decimalsOf = (u: MetricUnit) => UNIT_DECIMALS[u]
const scaled = (v: number, u: MetricUnit) => toScaled(v, decimalsOf(u))
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const keyText = (k: Array<string | null>) => k.map((x) => x ?? "\u0000").join("\u0001")

function cellOf(m: MetricValue | undefined): Cell {
  if (!m) return { value: null, unit: "count", available: false, reason: "METRIC_NOT_COMPUTED", coverage: { used: 0, total: 0, ratio: null } }
  return {
    value: m.value,
    unit: m.unit,
    available: m.available && m.value !== null,
    reason: m.value === null ? (m.reason ?? "UNAVAILABLE") : null,
    coverage: { used: m.coverage.used, total: m.coverage.total, ratio: m.coverage.total === 0 ? null : m.coverage.ratio },
  }
}

function legCell(s: MoneySum, legs: number, unit: MetricUnit = "usd"): Cell {
  return {
    value: s.value,
    unit,
    available: s.value !== null,
    reason: s.value === null ? (legs === 0 ? "NO_LEGS" : "VALUE_NOT_AVAILABLE_ON_LEGS") : null,
    coverage: { used: s.legsKnown, total: legs, ratio: legs === 0 ? null : ratio(s.legsKnown, legs) },
  }
}

/** a ÷ b com denominador válido (≠ 0, ambos conhecidos). Mesma unidade escalada. */
function fraction(part: Cell, whole: Cell, why = "DENOMINATOR_UNAVAILABLE"): Fraction {
  if (part.value === null) return { value: null, reason: "NUMERATOR_UNAVAILABLE" }
  if (whole.value === null) return { value: null, reason: why }
  const w = scaled(whole.value, whole.unit)
  if (w === 0) return { value: null, reason: "DENOMINATOR_ZERO" }
  if (whole.coverage.ratio !== null && whole.coverage.ratio < 1) return { value: ratio(scaled(part.value, part.unit), w), reason: "DENOMINATOR_PARTIAL_COVERAGE" }
  return { value: ratio(scaled(part.value, part.unit), w), reason: null }
}

interface Redaction { redact: boolean; salt: string; asIs: boolean }
function outKey(dims: Dimension[], key: Array<string | null>, r: Redaction, fallbackLabel?: string): KeyOut {
  const hasRef = dims.some((d) => d === "account" || d === "strategy")
  const ref = (d: Dimension, k: string | null): string | null => (k === null || r.asIs ? k : d === "account" ? (makeAccountRef(k, r.salt) ?? "acc_?") : d === "strategy" ? (makeStrategyRef(k, r.salt) ?? "str_?") : k)
  const out = r.redact && hasRef ? key.map((k, i) => ref(dims[i], k)) : [...key]
  const label = r.redact && hasRef ? dims.map((d, i) => dimensionLabel(d, out[i])).join(" · ") : (fallbackLabel ?? dims.map((d, i) => dimensionLabel(d, key[i])).join(" · "))
  return { dims, key: out, label }
}

const asDims = (g: Dimension | Dimension[]): Dimension[] => (Array.isArray(g) ? g : [g])

interface Common extends AnalysisOptions {
  filters?: TradeFilters
  /** Padrão true: conta/estratégia saem como ref. false = nomes (só uso local; nunca para Evidence/agente). */
  redact?: boolean
  /** Mesmo sal do `accountRefSalt` da importação/Evidence. */
  refSalt?: string
  /**
   * As chaves de `account`/`strategy` JÁ são refs (os trades vêm de uma "visão por refs": é o caminho da Evidence dos derivados, E6.3, e do verificador):
   * não re-hashear. Valores de `where`/`a`/`b` também já são refs.
   */
  keysAreRefs?: boolean
}
const redaction = (a: Common): Redaction => ({ redact: a.redact ?? true, salt: a.refSalt ?? "", asIs: a.keysAreRefs ?? false })
const engineOpts = (a: Common): AnalysisOptions => {
  const { filters: _f, redact: _r, refSalt: _s, keysAreRefs: _k, ...rest } = a
  void _f; void _r; void _s; void _k
  return rest
}

/** Seleção por chave (`where`): dimensões presentes em `groupBy`; valor = a chave do MOTOR (nome da conta etc.), `null` = grupo desconhecido. */
type Where = Partial<Record<Dimension, string | null>>
function checkWhere(dims: Dimension[], where: Where | undefined): Array<[number, string | null]> {
  const sel: Array<[number, string | null]> = []
  for (const [d, v] of Object.entries(where ?? {}) as Array<[Dimension, string | null]>) {
    const i = dims.indexOf(d)
    if (i < 0) throw new MetricsInputError("E_ANALYSIS_INVALID", `where.${d} exige a dimensão em groupBy (${dims.join(", ")}).`)
    sel.push([i, v])
  }
  return sel
}
const matches = (key: Array<string | null>, sel: Array<[number, string | null]>) => sel.every(([i, v]) => key[i] === v)

// ── contexto de saída por grupo (reaproveita E6.0/E6.1) ──────────────────────

function exitContextOf(bd: ExitBreakdownResult): ExitContext {
  const n = bd.population.afterFilters
  const net = bd.reconciliation.fields.net
  const nc = net.notComparable.LEG_VALUE_MISSING + net.notComparable.TRADE_VALUE_MISSING + net.notComparable.BASIS_UNKNOWN
  const status: ExitContext["reconciliation"]["status"] =
    bd.population.tradesWithLegs === 0 ? "NO_LEGS" : bd.reconciliation.divergentTotal > 0 ? "DIVERGENT" : nc > 0 || bd.population.tradesWithoutLegs > 0 ? "PARTIAL" : "FULL"
  const tb = bd.population.tradesByBucket
  return {
    tradesByBucket: { ...tb },
    unknownTradesShare: percentFraction(tb.UNKNOWN, n),
    mixedTradesShare: percentFraction(tb.MIXED, n),
    tradesWithoutLegs: bd.population.tradesWithoutLegs,
    legs: bd.total.legs,
    unknownLegs: bd.byReason.UNKNOWN.legs,
    unknownLegsShare: percentFraction(bd.byReason.UNKNOWN.legs, bd.total.legs),
    reconciliation: { status, netDivergent: net.divergent, netNotComparable: nc, divergentTotal: bd.reconciliation.divergentTotal },
  }
}
/** part/whole em fração de 4 casas; whole = 0 ⇒ null (nunca 0). */
const percentFraction = (part: number, whole: number): number | null => ratio(part, whole)

interface Loaded {
  dims: Dimension[]
  ag: ReturnType<typeof aggregateTradesTraced>
  subsets: AnalyticsTrade[][]
}
function load(trades: AnalyticsTrade[], args: Common & { groupBy: Dimension | Dimension[]; metrics?: string[] }): Loaded {
  const dims = asDims(args.groupBy)
  const ag = aggregateTradesTraced(trades, { groupBy: dims, filters: args.filters, metrics: args.metrics, ...engineOpts(args), tradeIdsLimit: Math.max(trades.length, 1) })
  const byId = new Map(trades.map((t) => [t.id, t]))
  const subsets = ag.trace.groups.map((g) => (g.population.tradeIds ?? []).map((id) => byId.get(id) as AnalyticsTrade))
  return { dims, ag, subsets }
}
const subsetBreakdown = (subset: AnalyticsTrade[], args: Common): ExitBreakdownResult => exitBreakdown(subset, { ...engineOpts(args), tradeIdsLimit: 0 })

function limitationsOfSample(flag: SampleFlag): LimitationCode[] {
  return flag === "TINY" ? ["SAMPLE_TINY"] : flag === "LOW" ? ["SAMPLE_LOW"] : []
}
function confidenceOf(l: LimitationCode[]): Confidence {
  if (l.some((x) => x === "SAMPLE_TINY" || x === "METRIC_UNAVAILABLE" || x === "RECONCILIATION_DIVERGENT" || x === "GROUP_NOT_FOUND" || x === "PERIOD_EMPTY")) return "UNRELIABLE"
  return l.length > 0 ? "LIMITED" : "OK"
}

// ── 1. ranking de grupos (UNIDADE: trades) ───────────────────────────────────

export interface RankArgs extends Common {
  groupBy: Dimension | Dimension[]
  /** Métrica do catálogo (padrão `netPnl`). */
  metric?: string
  /** DESC = maior valor primeiro (padrão); ASC = menor primeiro (ex.: maiores perdas). Não há "melhor": só ordem. */
  order?: "DESC" | "ASC"
  where?: Where
}

export interface RankedGroup {
  /** 1.. só para grupos elegíveis (valor disponível e amostra não-TINY); null = listado mas fora da numeração. */
  rank: number | null
  tiedWithPrevious: boolean
  key: KeyOut
  /** Atributo desconhecido em alguma dimensão (grupo "desconhecido"/"sem horário"…): listado, nunca descartado. */
  unknownGroup: boolean
  /** UNIDADE: trades. */
  sampleSize: number
  sampleFlag: SampleFlag
  value: Cell
  net: Cell
  gross: Cell
  averageNet: Cell
  winners: number | null
  losers: number | null
  breakeven: number | null
  /** trades do grupo ÷ trades do recorte selecionado. */
  shareOfTrades: Fraction
  /** líquido do grupo ÷ líquido do recorte selecionado (`where`); sem `where` = do total. */
  contributionToSubset: Fraction
  /** líquido do grupo ÷ líquido do TOTAL da população. */
  contributionToTotal: Fraction
  exit: ExitContext
  limitations: LimitationCode[]
  confidence: Confidence
  tradeSetHash: string
}

export interface GroupRanking {
  schema: typeof ANALYSIS_SCHEMA
  version: typeof ANALYSIS_VERSION
  kind: "GROUP_RANKING"
  unit: "TRADE"
  inference: "DESCRIPTIVE_ONLY"
  metric: { id: string; unit: MetricUnit; label: string }
  order: "DESC" | "ASC"
  /** Critério e desempate, ditos: valor (conforme `order`) → maior amostra → chave. */
  ordering: "value, then larger sample, then key"
  groupBy: Dimension[]
  where: KeyOut | null
  population: { inputTrades: number; afterFilters: number; tradeSetHash: string }
  total: { net: Cell; gross: Cell; trades: number }
  subset: { trades: number; groups: number; net: Cell }
  rows: RankedGroup[]
  summary: { groups: number; ranked: number; unranked: number; unknownGroups: number; unknownGroupTrades: number; unknownGroupShare: number | null; lowOrTinyGroups: number }
  warnings: Array<{ code: string; severity: "WARNING" | "INFO"; message: string }>
}

export function rankGroups(trades: AnalyticsTrade[], args: RankArgs): GroupRanking {
  const metricId = args.metric ?? "netPnl"
  const def = metricDefinition(metricId)
  if (!def) throw new MetricsInputError("E_ANALYSIS_INVALID", `Métrica desconhecida: "${metricId}".`)
  const order = args.order ?? "DESC"
  const red = redaction(args)
  const { dims, ag, subsets } = load(trades, args)
  const sel = checkWhere(dims, args.where)
  const totalNet = cellOf(ag.result.total.metrics.netPnl)
  const totalGross = cellOf(ag.result.total.metrics.grossPnl)

  const picked = ag.result.groups.map((g, i) => ({ g, i })).filter(({ g }) => matches(g.key, sel))
  const subsetTrades = picked.reduce((a, { g }) => a + g.sampleSize, 0)
  // líquido do recorte = soma dos líquidos CONHECIDOS dos grupos (centavos); disponível se algum grupo o tem
  const nets = picked.map(({ g }) => g.metrics.netPnl)
  const knownNets = nets.filter((m) => m.value !== null)
  const subsetNet: Cell = {
    value: knownNets.length === 0 ? null : fromScaled(knownNets.reduce((a, m) => a + toScaled(m.value as number, 2), 0), 2),
    unit: "usd",
    available: knownNets.length > 0,
    reason: knownNets.length === 0 ? "NO_GROUP_WITH_NET" : null,
    coverage: { used: knownNets.reduce((a, m) => a + m.coverage.used, 0), total: subsetTrades, ratio: subsetTrades === 0 ? null : ratio(knownNets.reduce((a, m) => a + m.coverage.used, 0), subsetTrades) },
  }

  const rows: RankedGroup[] = picked.map(({ g, i }) => {
    const bd = subsetBreakdown(subsets[i], args)
    const exit = exitContextOf(bd)
    const m = g.metrics
    const value = cellOf(m[metricId])
    const net = cellOf(m.netPnl)
    const unknownGroup = g.key.some((k) => k === null)
    const limitations: LimitationCode[] = [...limitationsOfSample(g.sampleFlag)]
    if (!value.available) limitations.push("METRIC_UNAVAILABLE")
    else if (value.coverage.ratio !== null && value.coverage.ratio < 1) limitations.push("COVERAGE_PARTIAL")
    if (unknownGroup) limitations.push("UNKNOWN_GROUP")
    return {
      rank: null,
      tiedWithPrevious: false,
      key: outKey(dims, g.key, red, g.label),
      unknownGroup,
      sampleSize: g.sampleSize,
      sampleFlag: g.sampleFlag,
      value,
      net,
      gross: cellOf(m.grossPnl),
      averageNet: cellOf(m.averageTrade),
      winners: m.winners?.value ?? null,
      losers: m.losers?.value ?? null,
      breakeven: m.breakeven?.value ?? null,
      shareOfTrades: subsetTrades === 0 ? { value: null, reason: "DENOMINATOR_ZERO" } : { value: ratio(g.sampleSize, subsetTrades), reason: null },
      contributionToSubset: fraction(net, subsetNet),
      contributionToTotal: fraction(net, totalNet),
      exit,
      limitations,
      confidence: confidenceOf(limitations),
      tradeSetHash: g.tradeSetHash,
    }
  })

  // ordenação determinística: elegíveis por valor; depois os demais por amostra/chave
  const eligible = (r: RankedGroup) => r.value.available && r.sampleFlag !== "TINY"
  const dir = order === "DESC" ? -1 : 1
  const cmpKey = (a: RankedGroup, b: RankedGroup) => cmpStr(keyText(a.key.key), keyText(b.key.key))
  const ranked = rows.filter(eligible).sort((a, b) => dir * ((a.value.value as number) - (b.value.value as number)) || b.sampleSize - a.sampleSize || cmpKey(a, b))
  const rest = rows.filter((r) => !eligible(r)).sort((a, b) => b.sampleSize - a.sampleSize || cmpKey(a, b))
  ranked.forEach((r, i) => {
    r.rank = i + 1
    r.tiedWithPrevious = i > 0 && scaled(ranked[i - 1].value.value as number, r.value.unit) === scaled(r.value.value as number, r.value.unit)
  })
  const ordered = [...ranked, ...rest]
  const unknownRows = ordered.filter((r) => r.unknownGroup)
  const unknownTrades = unknownRows.reduce((a, r) => a + r.sampleSize, 0)

  const warnings: GroupRanking["warnings"] = []
  if (rest.length > 0) warnings.push({ code: "W_UNRANKED_GROUPS", severity: "INFO", message: `${rest.length} grupo(s) listados sem posição (valor indisponível ou amostra minúscula): não foram descartados.` })
  if (ordered.some((r) => r.sampleFlag === "LOW")) warnings.push({ code: "W_LOW_SAMPLE", severity: "INFO", message: "Há grupos com amostra baixa (< minSample): a ordem é descritiva, não conclusiva." })
  if (picked.length === 0) warnings.push({ code: "W_NO_GROUPS", severity: "WARNING", message: "Nenhum grupo no recorte pedido." })

  return {
    schema: ANALYSIS_SCHEMA,
    version: ANALYSIS_VERSION,
    kind: "GROUP_RANKING",
    unit: "TRADE",
    inference: "DESCRIPTIVE_ONLY",
    metric: { id: metricId, unit: def.unit, label: def.label },
    order,
    ordering: "value, then larger sample, then key",
    groupBy: dims,
    where: sel.length === 0 ? null : outKey(dims.filter((_, i) => sel.some(([j]) => j === i)), sel.map(([, v]) => v), red),
    population: { inputTrades: ag.result.total.population.inputTrades, afterFilters: ag.result.total.population.afterFilters, tradeSetHash: ag.result.total.population.tradeSetHash },
    total: { net: totalNet, gross: totalGross, trades: ag.result.total.population.afterFilters },
    subset: { trades: subsetTrades, groups: picked.length, net: subsetNet },
    rows: ordered,
    summary: {
      groups: picked.length,
      ranked: ranked.length,
      unranked: rest.length,
      unknownGroups: unknownRows.length,
      unknownGroupTrades: unknownTrades,
      unknownGroupShare: subsetTrades === 0 ? null : ratio(unknownTrades, subsetTrades),
      lowOrTinyGroups: ordered.filter((r) => r.sampleFlag !== "OK").length,
    },
    warnings,
  }
}

// ── 2. comparação (UNIDADE: trades) ──────────────────────────────────────────

export const DEFAULT_COMPARE_METRICS = ["totalTrades", "netPnl", "grossPnl", "averageTrade", "winRate", "profitFactor", "totalR", "averageR"] as const

export interface Side {
  label: string
  key: KeyOut | null
  period: { from: string | null; to: string | null } | null
  /** UNIDADE: trades (ou pernas, no breakdown por motivo). */
  sampleSize: number
  sampleFlag: SampleFlag
  tradeSetHash: string | null
}

export interface MetricComparison {
  metric: string
  unit: MetricUnit
  a: Cell
  b: Cell
  /** B − A, exato em inteiros escalados da unidade. null se qualquer lado é indisponível. */
  delta: number | null
  /** B ÷ A só com A ≠ 0 e mesmo sinal nos dois lados (razão entre sinais opostos não tem leitura honesta). */
  ratio: number | null
  comparable: boolean
  reason: string | null
  /** Amostra adequada nos dois lados E cobertura completa nos dois. Descritivo: NÃO é significância estatística. */
  conclusive: boolean
}

export interface Comparison {
  schema: typeof ANALYSIS_SCHEMA
  version: typeof ANALYSIS_VERSION
  kind: "GROUP_COMPARISON" | "PERIOD_COMPARISON" | "EXIT_REASON_COMPARISON"
  unit: AnalysisUnit
  inference: "DESCRIPTIVE_ONLY"
  groupBy: Dimension[] | null
  a: Side
  b: Side
  metrics: MetricComparison[]
  /** Os dois lados têm amostra OK. */
  sampleAdequate: boolean
  limitations: LimitationCode[]
  confidence: Confidence
}

function compareCells(metric: string, a: Cell, b: Cell, sa: Side, sb: Side): MetricComparison {
  const unit = a.available ? a.unit : b.unit
  let reason: string | null = null
  let delta: number | null = null
  let rat: number | null = null
  if (!a.available || !b.available) reason = !a.available && !b.available ? "UNAVAILABLE_BOTH" : !a.available ? "UNAVAILABLE_A" : "UNAVAILABLE_B"
  else {
    const x = scaled(a.value as number, unit)
    const y = scaled(b.value as number, unit)
    delta = fromScaled(y - x, decimalsOf(unit))
    if (x === 0) reason = "RATIO_A_ZERO"
    else if (Math.sign(x) !== Math.sign(y) && y !== 0) reason = "RATIO_SIGN_DIFFERS"
    else rat = ratio(y, x)
  }
  const complete = [a, b].every((c) => c.available && (c.coverage.ratio === null || c.coverage.ratio === 1))
  return { metric, unit, a, b, delta, ratio: rat, comparable: delta !== null, reason, conclusive: delta !== null && complete && sa.sampleFlag === "OK" && sb.sampleFlag === "OK" }
}

function buildComparison(kind: Comparison["kind"], unit: AnalysisUnit, groupBy: Dimension[] | null, a: Side, b: Side, cells: Array<[string, Cell, Cell]>, extra: LimitationCode[]): Comparison {
  const metrics = cells.map(([id, ca, cb]) => compareCells(id, ca, cb, a, b))
  const limitations = [...new Set<LimitationCode>([...limitationsOfSample(a.sampleFlag), ...limitationsOfSample(b.sampleFlag), ...extra])]
  if (metrics.some((m) => !m.comparable)) limitations.push("METRIC_UNAVAILABLE")
  else if (metrics.some((m) => !(m.a.coverage.ratio === null || m.a.coverage.ratio === 1) || !(m.b.coverage.ratio === null || m.b.coverage.ratio === 1))) limitations.push("COVERAGE_PARTIAL")
  const uniq = [...new Set(limitations)]
  return { schema: ANALYSIS_SCHEMA, version: ANALYSIS_VERSION, kind, unit, inference: "DESCRIPTIVE_ONLY", groupBy, a, b, metrics, sampleAdequate: a.sampleFlag === "OK" && b.sampleFlag === "OK", limitations: uniq, confidence: confidenceOf(uniq) }
}

const missingMetric = (reason: string): MetricValue => ({ metric: "", value: null, unit: "count", sampleSize: 0, coverage: { used: 0, total: 0, ratio: 0 }, available: false, reason, basis: null, definitionVersion: "1" })

export interface CompareGroupsArgs extends Common {
  groupBy: Dimension | Dimension[]
  /** Chave de cada lado, por dimensão de `groupBy` (valores do MOTOR: nome da conta etc.; `null` = grupo desconhecido). */
  a: Where
  b: Where
  metrics?: string[]
}

export function compareGroups(trades: AnalyticsTrade[], args: CompareGroupsArgs): Comparison {
  const metricIds = args.metrics ?? [...DEFAULT_COMPARE_METRICS]
  for (const id of metricIds) if (!metricDefinition(id)) throw new MetricsInputError("E_ANALYSIS_INVALID", `Métrica desconhecida: "${id}".`)
  const o = resolveOptions(engineOpts(args))
  const red = redaction(args)
  const { dims, ag } = load(trades, args)
  const pick = (w: Where) => {
    const sel = checkWhere(dims, w)
    if (sel.length !== dims.length) throw new MetricsInputError("E_ANALYSIS_INVALID", `Cada lado precisa informar TODAS as dimensões de groupBy (${dims.join(", ")}).`)
    return ag.result.groups.find((g) => matches(g.key, sel)) ?? null
  }
  const extra: LimitationCode[] = []
  const sideOf = (w: Where, label: string): { side: Side; metrics: Record<string, MetricValue> | null } => {
    const g = pick(w)
    const keyRaw = dims.map((d) => w[d] ?? null)
    if (!g) {
      extra.push("GROUP_NOT_FOUND")
      return { side: { label, key: outKey(dims, keyRaw, red), period: null, sampleSize: 0, sampleFlag: sampleFlagOf(0, o.minSample), tradeSetHash: null }, metrics: null }
    }
    return { side: { label, key: outKey(dims, g.key, red, g.label), period: null, sampleSize: g.sampleSize, sampleFlag: g.sampleFlag, tradeSetHash: g.tradeSetHash }, metrics: g.metrics }
  }
  const A = sideOf(args.a, "A")
  const B = sideOf(args.b, "B")
  const cells = metricIds.map((id): [string, Cell, Cell] => [id, cellOf(A.metrics?.[id] ?? missingMetric("GROUP_NOT_FOUND")), cellOf(B.metrics?.[id] ?? missingMetric("GROUP_NOT_FOUND"))])
  // unidade: quando um lado não existe, a célula herda a unidade do catálogo
  for (const c of cells) { const u = metricDefinition(c[0])!.unit; c[1].unit = u; c[2].unit = u }
  return buildComparison("GROUP_COMPARISON", "TRADE", dims, A.side, B.side, cells, extra)
}

export interface ComparePeriodsArgs extends Common {
  a: { from: string; to: string }
  b: { from: string; to: string }
  metrics?: string[]
}

/** Dois intervalos de datas locais (do instante âncora), cada um calculado pelo MESMO motor com os filtros from/to. */
export function comparePeriods(trades: AnalyticsTrade[], args: ComparePeriodsArgs): Comparison {
  const metricIds = args.metrics ?? [...DEFAULT_COMPARE_METRICS]
  for (const id of metricIds) if (!metricDefinition(id)) throw new MetricsInputError("E_ANALYSIS_INVALID", `Métrica desconhecida: "${id}".`)
  const o = resolveOptions(engineOpts(args))
  const run = (p: { from: string; to: string }) => calculateMetrics(trades, { ...engineOpts(args), filters: { ...(args.filters ?? {}), from: p.from, to: p.to } })
  const ra = run(args.a)
  const rb = run(args.b)
  const extra: LimitationCode[] = []
  const sideOf = (r: typeof ra, p: { from: string; to: string }, label: string): Side => {
    if (r.population.afterFilters === 0) extra.push("PERIOD_EMPTY")
    return { label, key: null, period: { from: p.from, to: p.to }, sampleSize: r.population.afterFilters, sampleFlag: sampleFlagOf(r.population.afterFilters, o.minSample), tradeSetHash: r.population.tradeSetHash }
  }
  const sa = sideOf(ra, args.a, "A")
  const sb = sideOf(rb, args.b, "B")
  if (args.a.from <= args.b.to && args.b.from <= args.a.to) extra.push("PERIODS_OVERLAP")
  const cells = metricIds.map((id): [string, Cell, Cell] => [id, cellOf(ra.metrics[id]), cellOf(rb.metrics[id])])
  return buildComparison("PERIOD_COMPARISON", "TRADE", null, sa, sb, cells, extra)
}

// ── 3. motivo de saída: pernas (UNIDADE: LEG) e trades (UNIDADE: TRADE) lado a lado ──

export interface LegReasonRow {
  reason: ExitReason
  label: string
  /** UNIDADE: pernas. */
  legs: number
  quantity: number
  sampleFlag: SampleFlag
  net: Cell
  gross: Cell
  commission: Cell
  fees: Cell
  averageNet: Cell
  winners: number
  losers: number
  breakeven: number
  /** net do motivo ÷ net de todas as pernas (denominador válido); pode ser >1/<0. */
  contributionToLegNet: Fraction
  /** Pernas deste motivo em trades MIXED / MIXED+partial (E6.0). UNIDADE: pernas. */
  legsInMixedTrades: number
  legsInPartialTrades: number
  rank: number | null
  tiedWithPrevious: boolean
  limitations: LimitationCode[]
  confidence: Confidence
  legSetHash: string
}

export interface TradeBucketRow {
  bucket: ExitReasonBucket
  label: string
  /** UNIDADE: trades (o P&L é o do TRADE inteiro, não da perna). */
  trades: number
  sampleFlag: SampleFlag
  net: Cell
  gross: Cell
  averageNet: Cell
  winners: number | null
  losers: number | null
  breakeven: number | null
  /** R só dos trades com risco/stop informado (cobertura mostra quantos). */
  totalR: Cell
  averageR: Cell
  contributionToTotalNet: Fraction
  limitations: LimitationCode[]
  confidence: Confidence
}

export interface ExitReasonAnalysis {
  schema: typeof ANALYSIS_SCHEMA
  version: typeof ANALYSIS_VERSION
  kind: "EXIT_REASON_ANALYSIS"
  inference: "DESCRIPTIVE_ONLY"
  population: { inputTrades: number; afterFilters: number; tradeSetHash: string; tradesWithLegs: number; tradesWithoutLegs: number }
  order: "DESC" | "ASC"
  /** Valores OBSERVADOS nas pernas (a própria perna; nada rateado). 4 motivos; MIXED não existe por perna. */
  legs: { unit: "LEG"; total: { legs: number; net: Cell; gross: Cell }; rows: LegReasonRow[] }
  /** Valores CALCULADOS sobre os trades completos, por bucket do E6.0 (5 buckets, MIXED e UNKNOWN explícitos). */
  trades: { unit: "TRADE"; total: { trades: number; net: Cell }; rows: TradeBucketRow[] }
  reconciliation: {
    status: ExitContext["reconciliation"]["status"]
    net: { reconciled: number; divergent: number; notComparable: number }
    divergentTotal: number
    unknownLegs: number
    unknownLegsShare: number | null
    tradesWithoutLegs: number
  }
  warnings: ExitBreakdownResult["warnings"]
}

const BUCKETS: readonly ExitReasonBucket[] = EXIT_REASON_BUCKETS
const LEG_REASONS: readonly ExitReason[] = ["TARGET", "STOP", "MANUAL", "UNKNOWN"]

function legRow(reason: ExitReason, r: ReasonBreakdown, total: ReasonBreakdown, ctx: ExitContext, minSample: number): LegReasonRow {
  const net = legCell(r.net, r.legs)
  const totalNet = legCell(total.net, total.legs)
  const sampleFlag = sampleFlagOf(r.legs, minSample)
  const limitations: LimitationCode[] = [...limitationsOfSample(sampleFlag)]
  if (r.legs > 0 && !net.available) limitations.push("METRIC_UNAVAILABLE")
  else if (r.legs > 0 && r.net.legsUnavailable > 0) limitations.push("COVERAGE_PARTIAL")
  if (ctx.unknownLegs > 0) limitations.push("UNKNOWN_EXIT_REASON")
  if (ctx.tradesWithoutLegs > 0) limitations.push("TRADES_WITHOUT_LEGS")
  if (ctx.reconciliation.status === "DIVERGENT") limitations.push("RECONCILIATION_DIVERGENT")
  else if (ctx.reconciliation.status === "PARTIAL") limitations.push("RECONCILIATION_PARTIAL")
  return {
    reason,
    label: EXIT_REASON_LABELS[reason],
    legs: r.legs,
    quantity: r.quantity,
    sampleFlag,
    net,
    gross: legCell(r.gross, r.legs),
    commission: legCell(r.commission, r.legs),
    fees: legCell(r.fees, r.legs),
    averageNet: { value: r.averageNet, unit: "usd", available: r.averageNet !== null, reason: r.averageNet === null ? (r.legs === 0 ? "NO_LEGS" : "VALUE_NOT_AVAILABLE_ON_LEGS") : null, coverage: net.coverage },
    winners: r.winners,
    losers: r.losers,
    breakeven: r.breakeven,
    contributionToLegNet: r.legs === 0 ? { value: null, reason: "NO_LEGS" } : fraction(net, totalNet),
    legsInMixedTrades: r.legsInMixedTrades,
    legsInPartialTrades: r.legsInPartialTrades,
    rank: null,
    tiedWithPrevious: false,
    limitations,
    confidence: confidenceOf(limitations),
    legSetHash: r.legSetHash,
  }
}

export function exitReasonAnalysis(trades: AnalyticsTrade[], args: Common & { order?: "DESC" | "ASC" } = {}): ExitReasonAnalysis {
  const o = resolveOptions(engineOpts(args))
  const order = args.order ?? "DESC"
  const bd = exitBreakdown(trades, { ...engineOpts(args), filters: args.filters, tradeIdsLimit: 0 })
  const ctx = exitContextOf(bd)
  const rows = LEG_REASONS.map((k) => legRow(k, bd.byReason[k], bd.total, ctx, o.minSample))
  // ranking por líquido das pernas: só quem tem valor e amostra não-TINY
  const dir = order === "DESC" ? -1 : 1
  const eligible = rows.filter((r) => r.net.available && r.sampleFlag !== "TINY").sort((a, b) => dir * ((a.net.value as number) - (b.net.value as number)) || b.legs - a.legs || cmpStr(a.reason, b.reason))
  eligible.forEach((r, i) => {
    r.rank = i + 1
    r.tiedWithPrevious = i > 0 && scaled(eligible[i - 1].net.value as number, "usd") === scaled(r.net.value as number, "usd")
  })

  // trades completos por bucket (E6.0): o MESMO motor, agrupado por exitReason
  const ag = aggregateTradesTraced(trades, { groupBy: "exitReason", filters: args.filters, ...engineOpts(args), tradeIdsLimit: 0 })
  const totalTradeNet = cellOf(ag.result.total.metrics.netPnl)
  const tradeRows: TradeBucketRow[] = BUCKETS.map((b) => {
    const g = ag.result.groups.find((x) => x.key[0] === b)
    const n = g?.sampleSize ?? 0
    const flag = sampleFlagOf(n, o.minSample)
    const m = g?.metrics
    const net = g ? cellOf(m!.netPnl) : { ...cellOf(undefined), unit: "usd" as MetricUnit, reason: "NO_TRADES" }
    const limitations: LimitationCode[] = n === 0 ? [] : [...limitationsOfSample(flag)]
    if (n > 0 && !net.available) limitations.push("METRIC_UNAVAILABLE")
    else if (n > 0 && net.coverage.ratio !== null && net.coverage.ratio < 1) limitations.push("COVERAGE_PARTIAL")
    if (b === "UNKNOWN" && n > 0) limitations.push("UNKNOWN_EXIT_REASON")
    const noCell = (u: MetricUnit): Cell => ({ value: null, unit: u, available: false, reason: "NO_TRADES", coverage: { used: 0, total: 0, ratio: null } })
    return {
      bucket: b,
      label: EXIT_REASON_LABELS[b],
      trades: n,
      sampleFlag: flag,
      net,
      gross: g ? cellOf(m!.grossPnl) : noCell("usd"),
      averageNet: g ? cellOf(m!.averageTrade) : noCell("usd"),
      winners: m?.winners?.value ?? null,
      losers: m?.losers?.value ?? null,
      breakeven: m?.breakeven?.value ?? null,
      totalR: g ? cellOf(m!.totalR) : noCell("R"),
      averageR: g ? cellOf(m!.averageR) : noCell("R"),
      contributionToTotalNet: n === 0 ? { value: null, reason: "NO_TRADES" } : fraction(net, totalTradeNet),
      limitations,
      confidence: n === 0 ? "OK" : confidenceOf(limitations),
    }
  })

  const nf = bd.reconciliation.fields.net
  return {
    schema: ANALYSIS_SCHEMA,
    version: ANALYSIS_VERSION,
    kind: "EXIT_REASON_ANALYSIS",
    inference: "DESCRIPTIVE_ONLY",
    population: { inputTrades: bd.population.inputTrades, afterFilters: bd.population.afterFilters, tradeSetHash: bd.population.tradeSetHash, tradesWithLegs: bd.population.tradesWithLegs, tradesWithoutLegs: bd.population.tradesWithoutLegs },
    order,
    legs: { unit: "LEG", total: { legs: bd.total.legs, net: legCell(bd.total.net, bd.total.legs), gross: legCell(bd.total.gross, bd.total.legs) }, rows: [...eligible, ...rows.filter((r) => !eligible.includes(r))] },
    trades: { unit: "TRADE", total: { trades: ag.result.total.population.afterFilters, net: totalTradeNet }, rows: tradeRows },
    reconciliation: {
      status: ctx.reconciliation.status,
      net: { reconciled: nf.reconciled, divergent: nf.divergent, notComparable: nf.notComparable.LEG_VALUE_MISSING + nf.notComparable.TRADE_VALUE_MISSING + nf.notComparable.BASIS_UNKNOWN },
      divergentTotal: bd.reconciliation.divergentTotal,
      unknownLegs: ctx.unknownLegs,
      unknownLegsShare: ctx.unknownLegsShare,
      tradesWithoutLegs: bd.population.tradesWithoutLegs,
    },
    warnings: bd.warnings,
  }
}

/** Compara dois motivos de saída NAS PERNAS (ex.: STOP × TARGET): líquido, média, contagem, quantidade — UNIDADE: pernas. Herda a reconciliação e a parcela UNKNOWN. */
export function compareExitReasons(analysis: ExitReasonAnalysis, a: ExitReason, b: ExitReason): Comparison {
  const ra = analysis.legs.rows.find((r) => r.reason === a)
  const rb = analysis.legs.rows.find((r) => r.reason === b)
  if (!ra || !rb) throw new MetricsInputError("E_ANALYSIS_INVALID", "Motivo inválido (TARGET | STOP | MANUAL | UNKNOWN).")
  const count = (n: number, total: number): Cell => ({ value: n, unit: "count", available: true, reason: null, coverage: { used: n, total, ratio: total === 0 ? null : ratio(n, total) } })
  const side = (r: LegReasonRow, label: string): Side => ({ label, key: { dims: [], key: [r.reason], label: r.label }, period: null, sampleSize: r.legs, sampleFlag: r.sampleFlag, tradeSetHash: null })
  const extra: LimitationCode[] = [...new Set<LimitationCode>([...ra.limitations, ...rb.limitations].filter((l) => !l.startsWith("SAMPLE_") && l !== "METRIC_UNAVAILABLE" && l !== "COVERAGE_PARTIAL"))]
  const cells: Array<[string, Cell, Cell]> = [
    ["legs", count(ra.legs, analysis.legs.total.legs), count(rb.legs, analysis.legs.total.legs)],
    ["netPnl", ra.net, rb.net],
    ["averageNet", ra.averageNet, rb.averageNet],
    ["grossPnl", ra.gross, rb.gross],
  ]
  return buildComparison("EXIT_REASON_COMPARISON", "LEG", null, side(ra, "A"), side(rb, "B"), cells, extra)
}

/** Compara dois buckets de TRADE (ex.: STOP × TARGET) em R e P&L — UNIDADE: trades. R só dos trades com risco informado (a cobertura diz quantos). */
export function compareTradeBuckets(analysis: ExitReasonAnalysis, a: ExitReasonBucket, b: ExitReasonBucket): Comparison {
  const ra = analysis.trades.rows.find((r) => r.bucket === a)
  const rb = analysis.trades.rows.find((r) => r.bucket === b)
  if (!ra || !rb) throw new MetricsInputError("E_ANALYSIS_INVALID", "Bucket inválido.")
  const side = (r: TradeBucketRow, label: string): Side => ({ label, key: { dims: ["exitReason"], key: [r.bucket], label: r.label }, period: null, sampleSize: r.trades, sampleFlag: r.sampleFlag, tradeSetHash: null })
  const cells: Array<[string, Cell, Cell]> = [
    ["netPnl", ra.net, rb.net],
    ["averageTrade", ra.averageNet, rb.averageNet],
    ["totalR", ra.totalR, rb.totalR],
    ["averageR", ra.averageR, rb.averageR],
  ]
  return buildComparison("EXIT_REASON_COMPARISON", "TRADE", ["exitReason"], side(ra, "A"), side(rb, "B"), cells, [])
}

// ── 4. onde as saídas de um motivo rendem mais/menos (UNIDADE: pernas do motivo, por grupo) ──

export interface LegGroupRankArgs extends Common {
  groupBy: Dimension | Dimension[]
  reason: ExitReason
  order?: "DESC" | "ASC"
  where?: Where
}

export interface LegGroupRow {
  rank: number | null
  tiedWithPrevious: boolean
  key: KeyOut
  unknownGroup: boolean
  /** UNIDADE: pernas DO MOTIVO no grupo (e pernas totais do grupo, para o denominador). */
  legs: number
  groupLegs: number
  sampleFlag: SampleFlag
  net: Cell
  averageNet: Cell
  winners: number
  losers: number
  breakeven: number
  /** líquido das pernas do motivo neste grupo ÷ o de todos os grupos selecionados. */
  contributionToReasonNet: Fraction
  unknownLegsShareInGroup: number | null
  reconciliation: ExitContext["reconciliation"]
  limitations: LimitationCode[]
  confidence: Confidence
  legSetHash: string
}

export interface LegGroupRanking {
  schema: typeof ANALYSIS_SCHEMA
  version: typeof ANALYSIS_VERSION
  kind: "LEG_GROUP_RANKING"
  unit: "LEG"
  inference: "DESCRIPTIVE_ONLY"
  reason: ExitReason
  order: "DESC" | "ASC"
  groupBy: Dimension[]
  population: { inputTrades: number; afterFilters: number; tradeSetHash: string }
  reasonTotal: { legs: number; net: Cell }
  rows: LegGroupRow[]
  summary: { groups: number; ranked: number; unranked: number }
}

export function rankGroupsByExitLegs(trades: AnalyticsTrade[], args: LegGroupRankArgs): LegGroupRanking {
  if (!(LEG_REASONS as readonly string[]).includes(args.reason)) throw new MetricsInputError("E_ANALYSIS_INVALID", `Motivo de perna inválido: "${args.reason}".`)
  const o = resolveOptions(engineOpts(args))
  const order = args.order ?? "ASC"
  const red = redaction(args)
  const { dims, ag, subsets } = load(trades, args)
  const sel = checkWhere(dims, args.where)
  const picked = ag.result.groups.map((g, i) => ({ g, i })).filter(({ g }) => matches(g.key, sel))
  const parts = picked.map(({ g, i }) => ({ g, bd: subsetBreakdown(subsets[i], args) }))
  const reasonNets = parts.map(({ bd }) => bd.byReason[args.reason].net)
  const known = reasonNets.filter((s) => s.cents !== null)
  const totalLegs = parts.reduce((a, { bd }) => a + bd.byReason[args.reason].legs, 0)
  const totalNetCell: Cell = {
    value: known.length === 0 ? null : fromScaled(known.reduce((a, s) => a + (s.cents as number), 0), 2),
    unit: "usd",
    available: known.length > 0,
    reason: known.length === 0 ? (totalLegs === 0 ? "NO_LEGS" : "VALUE_NOT_AVAILABLE_ON_LEGS") : null,
    coverage: { used: known.reduce((a, s) => a + s.legsKnown, 0), total: totalLegs, ratio: totalLegs === 0 ? null : ratio(known.reduce((a, s) => a + s.legsKnown, 0), totalLegs) },
  }
  const rows: LegGroupRow[] = parts.map(({ g, bd }) => {
    const r = bd.byReason[args.reason]
    const ctx = exitContextOf(bd)
    const net = legCell(r.net, r.legs)
    const flag = sampleFlagOf(r.legs, o.minSample)
    const unknownGroup = g.key.some((k) => k === null)
    const limitations: LimitationCode[] = [...limitationsOfSample(flag)]
    if (r.legs > 0 && !net.available) limitations.push("METRIC_UNAVAILABLE")
    else if (r.legs > 0 && r.net.legsUnavailable > 0) limitations.push("COVERAGE_PARTIAL")
    if (unknownGroup) limitations.push("UNKNOWN_GROUP")
    if (ctx.unknownLegs > 0 && args.reason !== "UNKNOWN") limitations.push("UNKNOWN_EXIT_REASON")
    if (ctx.tradesWithoutLegs > 0) limitations.push("TRADES_WITHOUT_LEGS")
    if (ctx.reconciliation.status === "DIVERGENT") limitations.push("RECONCILIATION_DIVERGENT")
    else if (ctx.reconciliation.status === "PARTIAL") limitations.push("RECONCILIATION_PARTIAL")
    return {
      rank: null,
      tiedWithPrevious: false,
      key: outKey(dims, g.key, red, g.label),
      unknownGroup,
      legs: r.legs,
      groupLegs: bd.total.legs,
      sampleFlag: flag,
      net,
      averageNet: { value: r.averageNet, unit: "usd", available: r.averageNet !== null, reason: r.averageNet === null ? (r.legs === 0 ? "NO_LEGS" : "VALUE_NOT_AVAILABLE_ON_LEGS") : null, coverage: net.coverage },
      winners: r.winners,
      losers: r.losers,
      breakeven: r.breakeven,
      contributionToReasonNet: r.legs === 0 ? { value: null, reason: "NO_LEGS" } : fraction(net, totalNetCell),
      unknownLegsShareInGroup: ctx.unknownLegsShare,
      reconciliation: ctx.reconciliation,
      limitations,
      confidence: confidenceOf(limitations),
      legSetHash: r.legSetHash,
    }
  })
  const dir = order === "DESC" ? -1 : 1
  const cmpKey = (a: LegGroupRow, b: LegGroupRow) => cmpStr(keyText(a.key.key), keyText(b.key.key))
  const eligible = rows.filter((r) => r.legs > 0 && r.net.available && r.sampleFlag !== "TINY").sort((a, b) => dir * ((a.net.value as number) - (b.net.value as number)) || b.legs - a.legs || cmpKey(a, b))
  eligible.forEach((r, i) => {
    r.rank = i + 1
    r.tiedWithPrevious = i > 0 && scaled(eligible[i - 1].net.value as number, "usd") === scaled(r.net.value as number, "usd")
  })
  const rest = rows.filter((r) => !eligible.includes(r)).sort((a, b) => b.legs - a.legs || cmpKey(a, b))
  return {
    schema: ANALYSIS_SCHEMA,
    version: ANALYSIS_VERSION,
    kind: "LEG_GROUP_RANKING",
    unit: "LEG",
    inference: "DESCRIPTIVE_ONLY",
    reason: args.reason,
    order,
    groupBy: dims,
    population: { inputTrades: ag.result.total.population.inputTrades, afterFilters: ag.result.total.population.afterFilters, tradeSetHash: ag.result.total.population.tradeSetHash },
    reasonTotal: { legs: totalLegs, net: totalNetCell },
    rows: [...eligible, ...rest],
    summary: { groups: rows.length, ranked: eligible.length, unranked: rest.length },
  }
}
