// E6.3 — núcleo ÚNICO dos derivados: especificação (zod), execução (as funções REAIS do E6.2) e resumo. É usado pelo construtor
// (`explain-derived.ts`) E pelo verificador (V6), de propósito: não há segunda implementação de ranking, contribuição nem comparação —
// o V6 reexecuta `computeDerived` sobre os trades reconstruídos do bundle e COMPARA, do mesmo jeito que o V4 reaplica o motor de métricas.
//
// Privacidade por construção ("visão por refs"): antes de qualquer cálculo os trades passam por `refView`, que troca o nome da conta e o da
// estratégia pelos refs (`accountRef`/`strategyRef`). Assim o E6.2 roda com `keysAreRefs` e TODA chave, filtro, rótulo e eco de argumento já
// nasce como ref. O verificador roda o MESMO caminho, sobre `TradeEvidence` (que só tem `accountRef`).

import { canonicalJson, sha256Hex } from "../infra/hash.ts"
import { accountRef as makeAccountRef, strategyRef as makeStrategyRef } from "../ingest/identity.ts"
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_VERSION,
  DEFAULT_COMPARE_METRICS,
  compareExitReasons,
  compareGroups,
  comparePeriods,
  compareTradeBuckets,
  exitReasonAnalysis,
  rankGroups,
  rankGroupsByExitLegs,
} from "../metrics/analysis.ts"
import { calculateMetrics, DIMENSION_IDS } from "../metrics/calculate.ts"
import { filterTrades, normalizeFilters } from "../metrics/filter.ts"
import { exitBreakdown } from "../metrics/legs.ts"
import { resolveOptions } from "../metrics/prepare.ts"
import { ENGINE_VERSION, type AnalysisOptions, type AnalyticsTrade, type Dimension, type TradeFilters } from "../metrics/types.ts"
import { z } from "zod"
import { DERIVED_OPS, type DerivedEvidence, type DerivedOp, type TradeEvidence } from "./schema.ts"
import { analyticsTradeFromEvidence } from "./to-analytics.ts"

export { DERIVED_OPS }
export type { DerivedOp }

// ── especificação ────────────────────────────────────────────────────────────

const DimEnum = z.enum(DIMENSION_IDS as [Dimension, ...Dimension[]])
const GroupByS = z.union([DimEnum, z.array(DimEnum).min(1)])
const WhereS = z.partialRecord(DimEnum, z.string().nullable())
const Order = z.enum(["DESC", "ASC"])
const LegReason = z.enum(["TARGET", "STOP", "MANUAL", "UNKNOWN"])
const Bucket = z.enum(["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])
const Period = z.object({ from: z.string(), to: z.string() }).strict()
const Metrics = z.array(z.string()).min(1)

const ArgsByOp = {
  GROUP_RANKING: z.object({ groupBy: GroupByS, metric: z.string().default("netPnl"), order: Order.default("DESC"), where: WhereS.optional() }).strict(),
  GROUP_COMPARISON: z.object({ groupBy: GroupByS, a: WhereS, b: WhereS, metrics: Metrics.default([...DEFAULT_COMPARE_METRICS]) }).strict(),
  PERIOD_COMPARISON: z.object({ a: Period, b: Period, metrics: Metrics.default([...DEFAULT_COMPARE_METRICS]) }).strict(),
  EXIT_REASON_ANALYSIS: z.object({ order: Order.default("DESC") }).strict(),
  EXIT_REASON_COMPARISON_LEGS: z.object({ a: LegReason, b: LegReason }).strict(),
  EXIT_REASON_COMPARISON_TRADES: z.object({ a: Bucket, b: Bucket }).strict(),
  LEG_GROUP_RANKING: z.object({ groupBy: GroupByS, reason: LegReason, order: Order.default("ASC"), where: WhereS.optional() }).strict(),
} as const satisfies Record<DerivedOp, z.ZodType>

export const UNIT_OF_OP: Record<DerivedOp, DerivedEvidence["analysis"]["unit"]> = {
  GROUP_RANKING: "TRADE",
  GROUP_COMPARISON: "TRADE",
  PERIOD_COMPARISON: "TRADE",
  EXIT_REASON_ANALYSIS: "TRADE_AND_LEG",
  EXIT_REASON_COMPARISON_LEGS: "LEG",
  EXIT_REASON_COMPARISON_TRADES: "TRADE",
  LEG_GROUP_RANKING: "LEG",
}
/** Operações cujo resultado depende das pernas de saída: levam `refs.legs`. */
const LEG_OPS = new Set<DerivedOp>(["EXIT_REASON_ANALYSIS", "EXIT_REASON_COMPARISON_LEGS", "LEG_GROUP_RANKING"])

export interface StoredOptions {
  timeZone: string
  timeAnchor: "ENTRY" | "EXIT"
  pnlBasis: "NET" | "GROSS"
  rBasis: "NET" | "POINTS"
  minSample: number
  tradeIdsLimit: number
}
/** Forma ARMAZENADA (refs no lugar de nomes): é o que vai para o bundle e o que o verificador reexecuta. */
export interface StoredSpec {
  op: DerivedOp
  args: Record<string, unknown>
  filters: Record<string, unknown>
  options: StoredOptions
}
/** Forma de ENTRADA do construtor: argumentos com os nomes do motor (conta/estratégia) — viram refs em `normalizeSpec`. */
export interface DerivedSpecInput {
  op: DerivedOp
  args: Record<string, unknown>
  filters?: TradeFilters
  options?: AnalysisOptions
}

const sortedUnique = (xs: string[]) => [...new Set(xs)].sort()
const REF_DIMS: Dimension[] = ["account", "strategy"]
const refOfDim = (dim: Dimension, v: string | null, salt: string): string | null => (v === null ? null : dim === "account" ? (makeAccountRef(v, salt) ?? "acc_?") : dim === "strategy" ? (makeStrategyRef(v, salt) ?? "str_?") : v)
const mapWhere = (w: Record<string, string | null | undefined> | undefined, salt: string) =>
  w === undefined ? undefined : Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined).map(([d, v]) => [d, REF_DIMS.includes(d as Dimension) ? refOfDim(d as Dimension, v as string | null, salt) : v]))

/** Valida e normaliza (defaults explícitos) e troca nomes de conta/estratégia por refs. Lança `Error` com mensagem curta se inválido. */
export function normalizeSpec(input: DerivedSpecInput, salt = ""): StoredSpec {
  if (!(DERIVED_OPS as readonly string[]).includes(input.op)) throw new Error(`operação desconhecida: "${String(input.op)}"`)
  const parsed = ArgsByOp[input.op].safeParse(input.args)
  if (!parsed.success) throw new Error(`argumentos de ${input.op} inválidos — ${parsed.error.issues[0]?.path.join(".") || "(raiz)"}: ${parsed.error.issues[0]?.message}`)
  const args = { ...(parsed.data as Record<string, unknown>) }
  for (const k of ["where", "a", "b"] as const) {
    if (k in args && input.op !== "PERIOD_COMPARISON" && input.op !== "EXIT_REASON_COMPARISON_LEGS" && input.op !== "EXIT_REASON_COMPARISON_TRADES") args[k] = mapWhere(args[k] as Record<string, string | null>, salt)
  }
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k]
  const f = normalizeFilters(input.filters ?? {}) as Record<string, unknown>
  const toRefs = (v: unknown, fn: (s: string) => string | null): unknown => {
    const xs = (Array.isArray(v) ? v : [v]) as string[]
    const r = sortedUnique(xs.map((x) => fn(x) ?? "?"))
    return r.length === 1 ? r[0] : r
  }
  const filters = { ...f }
  if (filters.account !== undefined) filters.account = toRefs(filters.account, (s) => makeAccountRef(s, salt))
  if (filters.strategyId !== undefined) filters.strategyId = toRefs(filters.strategyId, (s) => makeStrategyRef(s, salt))
  if (filters.strategyName !== undefined) filters.strategyName = toRefs(filters.strategyName, (s) => makeStrategyRef(s, salt))
  const o = resolveOptions(input.options ?? {})
  return { op: input.op, args, filters, options: { timeZone: o.timeZone, timeAnchor: o.timeAnchor, pnlBasis: o.pnlBasis, rBasis: o.rBasis, minSample: o.minSample, tradeIdsLimit: o.tradeIdsLimit } }
}

/** Reabre a forma ARMAZENADA (declarada por quem não é de confiança): valida `args` com o schema da operação. */
export function parseStoredArgs(op: DerivedOp, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; why: string } {
  const p = ArgsByOp[op].safeParse(args)
  if (!p.success) return { ok: false, why: `argumentos de ${op} fora do contrato — ${p.error.issues[0]?.path.join(".") || "(raiz)"}: ${p.error.issues[0]?.message}` }
  return { ok: true, args: p.data as Record<string, unknown> }
}

// ── visão por refs / probes ──────────────────────────────────────────────────

/** Troca nome de conta e de estratégia pelos refs, para o cálculo inteiro. Não toca em nenhum valor financeiro, tempo, id nem linha de origem. */
export function refView(trades: AnalyticsTrade[], salt = ""): AnalyticsTrade[] {
  return trades.map((a) => {
    const t = a.trade
    const accRef = t.account.ref ?? makeAccountRef(t.account.sourceName, salt)
    return {
      ...a,
      strategyId: a.strategyId ? (makeStrategyRef(a.strategyId, salt) ?? null) : (a.strategyId ?? null),
      trade: { ...t, account: { ...t.account, sourceName: accRef, ref: accRef }, labels: { ...t.labels, strategyName: makeStrategyRef(t.labels.strategyName, salt) } },
    }
  })
}

/** TradeEvidence → AnalyticsTrade com a conta = `accountRef` (única forma que a Evidence conhece). Estratégia/sessão/setup: ausentes de propósito. */
export function probeOf(e: TradeEvidence): AnalyticsTrade {
  const a = analyticsTradeFromEvidence(e)
  return { ...a, trade: { ...a.trade, account: { ...a.trade.account, sourceName: e.accountRef, ref: e.accountRef } } }
}

// ── dimensões/filtros verificáveis (mesmo critério do V4) ────────────────────

export const VERIFIABLE_DIMS = new Set<string>(["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "symbol", "direction", "account", "exitReason"])
export const VERIFIABLE_FILTERS = ["from", "to", "symbol", "direction", "hour", "dayOfWeek", "tradingDay", "exitReason", "account"] as const

export function dimsOfSpec(op: DerivedOp, args: Record<string, unknown>): string[] {
  const gb = args.groupBy === undefined ? [] : Array.isArray(args.groupBy) ? (args.groupBy as string[]) : [args.groupBy as string]
  const w = ["where", "a", "b"].flatMap((k) => (op === "GROUP_COMPARISON" || op === "GROUP_RANKING" || op === "LEG_GROUP_RANKING") && args[k] && typeof args[k] === "object" ? Object.keys(args[k] as object) : [])
  return [...new Set([...gb, ...w])].sort()
}
export const unverifiableDims = (op: DerivedOp, args: Record<string, unknown>) => dimsOfSpec(op, args).filter((d) => !VERIFIABLE_DIMS.has(d))
export const unverifiableFilters = (filters: Record<string, unknown>) => Object.keys(filters).filter((k) => !(VERIFIABLE_FILTERS as readonly string[]).includes(k)).sort()
export const verifiableFilters = (filters: Record<string, unknown>): TradeFilters => Object.fromEntries(Object.entries(filters).filter(([k]) => (VERIFIABLE_FILTERS as readonly string[]).includes(k))) as TradeFilters

// ── execução (as funções REAIS do E6.2) ──────────────────────────────────────

type Obj = Record<string, unknown>
export interface DerivedSummary {
  inference: "DESCRIPTIVE_ONLY"
  confidence: "OK" | "LIMITED" | "UNRELIABLE" | null
  limitations: string[]
  reconciliation: "FULL" | "PARTIAL" | "DIVERGENT" | "NO_LEGS" | null
}
export interface DerivedComputation {
  population: { afterFilters: number; tradeSetHash: string; tradeIds: string[] | null }
  result: Obj
  summary: DerivedSummary
  refs: DerivedEvidence["refs"]
}

const CONF_RANK = { OK: 0, LIMITED: 1, UNRELIABLE: 2 } as const
const REC_RANK = { FULL: 0, NO_LEGS: 1, PARTIAL: 2, DIVERGENT: 3 } as const

/** Resumo puro do `result` (a mesma função serve ao construtor e ao V6). */
export function summarize(op: DerivedOp, result: Obj): DerivedSummary {
  const confs: Array<keyof typeof CONF_RANK> = []
  const lims: string[] = []
  const recs: Array<keyof typeof REC_RANK> = []
  const rowsOf = (x: unknown): Obj[] => (Array.isArray(x) ? (x as Obj[]) : [])
  const take = (r: Obj) => {
    if (typeof r.confidence === "string") confs.push(r.confidence as keyof typeof CONF_RANK)
    for (const l of (r.limitations as string[] | undefined) ?? []) lims.push(l)
  }
  if (op === "GROUP_RANKING") for (const r of rowsOf(result.rows)) { take(r); const s = ((r.exit as Obj | undefined)?.reconciliation as Obj | undefined)?.status; if (typeof s === "string") recs.push(s as keyof typeof REC_RANK) }
  else if (op === "LEG_GROUP_RANKING") for (const r of rowsOf(result.rows)) { take(r); const s = (r.reconciliation as Obj | undefined)?.status; if (typeof s === "string") recs.push(s as keyof typeof REC_RANK) }
  else if (op === "EXIT_REASON_ANALYSIS") {
    for (const r of rowsOf((result.legs as Obj | undefined)?.rows)) take(r)
    for (const r of rowsOf((result.trades as Obj | undefined)?.rows)) take(r)
    const s = (result.reconciliation as Obj | undefined)?.status
    if (typeof s === "string") recs.push(s as keyof typeof REC_RANK)
  } else take(result)
  const worst = confs.length === 0 ? null : confs.reduce((a, b) => (CONF_RANK[b] > CONF_RANK[a] ? b : a))
  const rec = recs.length === 0 ? null : recs.reduce((a, b) => (REC_RANK[b] > REC_RANK[a] ? b : a))
  return { inference: "DESCRIPTIVE_ONLY", confidence: worst, limitations: sortedUnique(lims), reconciliation: rec }
}

/**
 * Executa a operação com a função REAL do E6.2.
 * `trades` já estão na "visão por refs" (builder) ou são probes da Evidence (verificador); `select` = aplicar os filtros para obter a população
 * (builder). No verificador a população é a declarada (já filtrada), então só se aplicam os filtros verificáveis (idempotentes).
 */
export function computeDerived(spec: StoredSpec, trades: AnalyticsTrade[], mode: { select: boolean }): DerivedComputation {
  const o = spec.options
  const engineOptions: AnalysisOptions = { timeZone: o.timeZone, timeAnchor: o.timeAnchor, pnlBasis: o.pnlBasis, rBasis: o.rBasis, minSample: o.minSample }
  const filters: TradeFilters = mode.select ? (spec.filters as TradeFilters) : verifiableFilters(spec.filters)
  const subset = mode.select ? filterTrades(trades, filters, engineOptions).trades : trades
  const pop = calculateMetrics(subset, { ...engineOptions, tradeIdsLimit: o.tradeIdsLimit }).population
  const common = { ...engineOptions, filters, keysAreRefs: true } as const
  const a = spec.args as Obj
  let result: Obj
  switch (spec.op) {
    case "GROUP_RANKING": result = rankGroups(subset, { ...common, groupBy: a.groupBy as Dimension[], metric: a.metric as string, order: a.order as "DESC" | "ASC", where: a.where as never }) as unknown as Obj; break
    case "GROUP_COMPARISON": result = compareGroups(subset, { ...common, groupBy: a.groupBy as Dimension[], a: a.a as never, b: a.b as never, metrics: a.metrics as string[] }) as unknown as Obj; break
    case "PERIOD_COMPARISON": result = comparePeriods(subset, { ...common, a: a.a as never, b: a.b as never, metrics: a.metrics as string[] }) as unknown as Obj; break
    case "EXIT_REASON_ANALYSIS": result = exitReasonAnalysis(subset, { ...common, order: a.order as "DESC" | "ASC" }) as unknown as Obj; break
    case "EXIT_REASON_COMPARISON_LEGS": result = compareExitReasons(exitReasonAnalysis(subset, common), a.a as never, a.b as never) as unknown as Obj; break
    case "EXIT_REASON_COMPARISON_TRADES": result = compareTradeBuckets(exitReasonAnalysis(subset, common), a.a as never, a.b as never) as unknown as Obj; break
    case "LEG_GROUP_RANKING": result = rankGroupsByExitLegs(subset, { ...common, groupBy: a.groupBy as Dimension[], reason: a.reason as never, order: a.order as "DESC" | "ASC", where: a.where as never }) as unknown as Obj; break
  }
  const legs = LEG_OPS.has(spec.op) ? { applicable: true, items: legRefsOf(subset, engineOptions, o.tradeIdsLimit) } : { applicable: false, items: null }
  // o resultado é JSON puro (mesmo para hash/comparação): passa por canonicalJson para garantir que não há undefined/classe
  const pure = JSON.parse(canonicalJson(result)) as Obj
  return { population: { afterFilters: pop.afterFilters, tradeSetHash: pop.tradeSetHash, tradeIds: pop.tradeIds }, result: pure, summary: summarize(spec.op, pure), refs: { legs } }
}

function legRefsOf(subset: AnalyticsTrade[], options: AnalysisOptions, limit: number): DerivedEvidence["refs"]["legs"]["items"] {
  const bd = exitBreakdown(subset, { ...options, tradeIdsLimit: limit })
  return bd.total.legRefs === null ? null : bd.total.legRefs.map((r) => ({ tradeId: r.tradeId, legIndex: r.legIndex, rowNos: [...r.rowNos] }))
}

export function derivedIdOf(spec: StoredSpec, tradeSetHash: string): string {
  return `drv_${sha256Hex(`meutrade/derived/1\0${canonicalJson({ op: spec.op, args: spec.args, filters: spec.filters, options: spec.options, tradeSetHash, schema: ANALYSIS_SCHEMA, definitionVersion: ANALYSIS_VERSION, engineVersion: ENGINE_VERSION })}`).slice(0, 32)}`
}

// ── comparação de resultados (V6) ────────────────────────────────────────────

export type DiffClass = "values" | "derived" | "quality"
/** Por onde o caminho passa: delta/razão/contribuição/posição são "derivados"; amostra/cobertura/confiança/limitações/reconciliação, "qualidade"; o resto, "valores". */
export function classOfPath(path: string): DiffClass {
  if (/(^|\.)(delta|ratio|rank|tiedWithPrevious|shareOfTrades|contribution\w*)(\.|\[|$)/.test(path)) return "derived"
  if (/(^|\.)(sampleSize|sampleFlag|sampleAdequate|coverage|confidence|limitations|reconciliation|exit|warnings|summary|refs|conclusive|comparable|unknownGroup|unknown\w*Share\w*)(\.|\[|$)/.test(path)) return "quality"
  return "values"
}

/** Caminhos em que `a` e `b` (JSON puro) diferem. Lista limitada (determinística). */
export function diffPaths(a: unknown, b: unknown, path = "", out: string[] = [], max = 200): string[] {
  if (out.length >= max) return out
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length`)
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diffPaths(a[i], b[i], `${path}[${i}]`, out, max)
    return out
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a as Obj), ...Object.keys(b as Obj)])].sort()
    for (const k of keys) {
      const p = path === "" ? k : `${path}.${k}`
      if (!(k in (a as Obj)) || !(k in (b as Obj))) out.push(p)
      else diffPaths((a as Obj)[k], (b as Obj)[k], p, out, max)
    }
    return out
  }
  if (!Object.is(a, b)) out.push(path === "" ? "(raiz)" : path)
  return out
}
