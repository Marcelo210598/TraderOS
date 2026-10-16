// Capacidade `metrics.compare@1` (E6.6-8): a comparação de DOIS grupos (GROUP) ou de DOIS períodos (PERIOD), métrica a métrica (a, b, delta, razão e o motivo de cada indisponível).
// Por baixo: os derivados GROUP_COMPARISON / PERIOD_COMPARISON (E6.2/E6.3). A view sai do `result` do PRÓPRIO derivado (o que o V6 reexecuta), por lista branca (project.ts).
// Dimensões: só as 9 verificáveis pela Evidence; conta/estratégia ficam para o E6.6-5-A (alias de ENTRADA) e sessão não é verificável (UNVERIFIABLE). Períodos que se sobrepõem e lados
// iguais são erro de ARGUMENTO (o modelo não vê a limitação do motor). Contexto, preferências do usuário, sal e arquivo vêm do servidor (Q12); sem userId. Nunca lança.
import { z } from "zod"
import { formatDate } from "../agent/format.ts"
import type { CapabilityId, EvidenceHandle } from "../agent/contract.ts"
import { derivedEvidenceBundle, explainDerived } from "../evidence/explain-derived.ts"
import { METRIC_IDS, MetricsInputError, normalizeFilters } from "../metrics/index.ts"
import { assessBundle } from "./assess.ts"
import { applyAliasFilters, resolveAccount, resolveStrategy } from "./alias-input.ts"
import { errorResult, okResult } from "./envelope.ts"
import { QUERY_FILTERS_SCHEMA, QUERY_OPTIONS_SCHEMA, type MetricsQueryContext } from "./metrics-query.ts"
import { COMPARE_DIMENSIONS, projectCompare } from "./project.ts"
import { generatorOpts, saltMissing } from "./salt.ts"

const CAPABILITY: CapabilityId = "metrics.compare@1"
export const MAX_COMPARE_METRICS = 10
type Dim = (typeof COMPARE_DIMENSIONS)[number]

const ISO_DATE = z.string().refine((s) => formatDate(s).ok)
/** Dia da semana (0 = domingo) de uma data de calendário real, em aritmética pura (Sakamoto; sem relógio). */
function weekdayOf(iso: string): number {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10))
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  const yy = m < 3 ? y - 1 : y
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7
}
/** O valor de cada dimensão COMO O MODELO ENVIA (D8-3). `week` só segunda-feira (a chave do motor é a segunda); `exitReason` sem UNKNOWN; `symbol` com a regex da chave (groupKeyPart). */
const DIM_VALUE: Readonly<Record<Dim, z.ZodType>> = {
  day: ISO_DATE,
  tradingDay: ISO_DATE,
  week: ISO_DATE.refine((s) => weekdayOf(s) === 1),
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  symbol: z.string().regex(/^[A-Z0-9]{1,12}$/),
  /** E6.6-5-A: o ALIAS que o servidor mostrou ("Conta A"); resolvido para o nome real em alias-input.ts. */
  account: z.string().regex(/^Conta [A-Z]{1,3}$/),
  /** E6.6-5-A2: o ALIAS da estratégia ("Estratégia A"); vira a CHAVE real (strategyId ?? strategyName) em alias-input.ts. */
  strategy: z.string().regex(/^Estratégia [A-Z]{1,3}$/),
  direction: z.enum(["LONG", "SHORT"]),
  exitReason: z.enum(["TARGET", "STOP", "MANUAL", "MIXED"]),
}
/** Valor de entrada → valor da chave do motor (hora 9 ⇒ "09"; dia da semana 1 ⇒ "1"). */
const coerce = (dim: Dim, v: unknown): string => (dim === "hour" ? String(v).padStart(2, "0") : String(v))

const MetricIds = z.array(z.string()).min(1).max(MAX_COMPARE_METRICS).refine((ids) => new Set(ids).size === ids.length && ids.every((id) => METRIC_IDS.includes(id)))
const Side = z.record(z.string(), z.union([z.string(), z.number()]))

const GroupArgs = z
  .strictObject({
    mode: z.literal("GROUP"),
    groupBy: z.array(z.enum(COMPARE_DIMENSIONS)).min(1).max(2).refine((d) => new Set(d).size === d.length),
    a: Side,
    b: Side,
    metricIds: MetricIds,
    filters: QUERY_FILTERS_SCHEMA,
    options: QUERY_OPTIONS_SCHEMA,
  })
  .superRefine((v, ctx) => {
    for (const side of [v.a, v.b]) {
      const keys = Object.keys(side).sort()
      if (JSON.stringify(keys) !== JSON.stringify([...v.groupBy].sort())) { ctx.addIssue({ code: "custom", message: "lado com dimensões diferentes de groupBy" }); return }
      for (const d of v.groupBy) if (!DIM_VALUE[d].safeParse(side[d]).success) { ctx.addIssue({ code: "custom", message: "valor de dimensão inválido" }); return }
    }
    const key = (side: Record<string, string | number>): string => JSON.stringify(v.groupBy.map((d) => coerce(d, side[d])))
    if (key(v.a) === key(v.b)) ctx.addIssue({ code: "custom", message: "a e b iguais" })
  })

const Period = z.strictObject({ from: ISO_DATE, to: ISO_DATE }).refine((p) => p.from <= p.to)
const PeriodArgs = z
  .strictObject({ mode: z.literal("PERIOD"), a: Period, b: Period, metricIds: MetricIds, filters: QUERY_FILTERS_SCHEMA, options: QUERY_OPTIONS_SCHEMA })
  .superRefine((v, ctx) => {
    if (v.filters !== undefined && (Object.hasOwn(v.filters, "from") || Object.hasOwn(v.filters, "to"))) ctx.addIssue({ code: "custom", message: "filters.from/to no PERIOD" })
    if (v.a.from <= v.b.to && v.b.from <= v.a.to) ctx.addIssue({ code: "custom", message: "períodos se sobrepõem (ou são iguais)" })
  })

export const MetricsCompareArgsSchema = z.discriminatedUnion("mode", [GroupArgs, PeriodArgs])

type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface MetricsCompareOutput {
  result: Envelope
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
}
const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED"): MetricsCompareOutput => ({ result: errorResult(CAPABILITY, code), entry: null })

export function metricsCompare(rawArgs: unknown, ctx: MetricsQueryContext): MetricsCompareOutput {
  try {
    const parsed = MetricsCompareArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const args = parsed.data
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(ctx.trades) || !Array.isArray(ctx.importRecords)) return fail("ENGINE_REFUSED")
    if (saltMissing(ctx)) return fail("ENGINE_REFUSED") // import SALGADO sem o sal: falha FECHADA (salt.ts)
    const af = applyAliasFilters(args.filters, ctx)
    if (!af.ok) return fail("ARGS_INVALID") // alias de conta que não resolve é erro do modelo (E6.6-5-A)
    const filters = af.filters ?? {}
    try { normalizeFilters(filters) } catch (e) { return fail(e instanceof MetricsInputError ? "ARGS_INVALID" : "ENGINE_REFUSED") } // erro de ENTRADA do motor (ex.: from > to) é do modelo

    const options = args.options
    const specOptions = { ...(ctx.analysis?.timeZone !== undefined ? { timeZone: ctx.analysis.timeZone } : {}), ...(ctx.analysis?.minSample !== undefined ? { minSample: ctx.analysis.minSample } : {}), ...(options?.pnlBasis !== undefined ? { pnlBasis: options.pnlBasis } : {}), ...(options?.rBasis !== undefined ? { rBasis: options.rBasis } : {}) }
    // dimensão `account`: o valor é o ALIAS; vira o NOME real (o derivado faz o hash) e a == b é decidido pelo REF (E6.6-5-A)
    const accountOf = (v: unknown): { name: string; ref: string } | null => { const r = resolveAccount(String(v), ctx); return r.ok ? { name: r.name, ref: r.ref } : null }
    if (args.mode === "GROUP" && args.groupBy.includes("account")) {
      const a = accountOf(args.a.account)
      const b = accountOf(args.b.account)
      if (a === null || b === null) return fail("ARGS_INVALID")
      if (args.groupBy.length === 1 && a.ref === b.ref) return fail("ARGS_INVALID")
    }
    // dimensão `strategy`: o valor é o ALIAS; vira a CHAVE real (strategyId ?? strategyName) — o motor usa a MESMA função de chave — e a == b é decidido pelo REF (E6.6-5-A2)
    const strategyOf = (v: unknown): { key: string; ref: string } | null => { const r = resolveStrategy(String(v), ctx); return r.ok ? { key: r.key, ref: r.ref } : null }
    if (args.mode === "GROUP" && args.groupBy.includes("strategy")) {
      const a = strategyOf(args.a.strategy)
      const b = strategyOf(args.b.strategy)
      if (a === null || b === null) return fail("ARGS_INVALID")
      if (args.groupBy.length === 1 && a.ref === b.ref) return fail("ARGS_INVALID")
    }
    const sideOf = (side: Record<string, string | number>, dims: readonly Dim[]): Record<string, string> => Object.fromEntries(dims.map((d) => [d, d === "account" ? (accountOf(side[d])?.name ?? "") : d === "strategy" ? (strategyOf(side[d])?.key ?? "") : coerce(d, side[d])]))
    const spec = args.mode === "GROUP"
      ? { op: "GROUP_COMPARISON" as const, args: { groupBy: [...args.groupBy], a: sideOf(args.a, args.groupBy), b: sideOf(args.b, args.groupBy), metrics: args.metricIds }, filters, options: specOptions }
      : { op: "PERIOD_COMPARISON" as const, args: { a: { from: args.a.from, to: args.a.to }, b: { from: args.b.from, to: args.b.to }, metrics: args.metricIds }, filters, options: specOptions }

    const explained = explainDerived({ spec, trades: ctx.trades, importRecords: ctx.importRecords, ...generatorOpts(ctx) })
    if (!explained.ok) return fail("ENGINE_REFUSED")
    const projection = projectCompare(explained.derived.result, ctx.refEpoch, ctx.aliases)
    if (projection === null || projection.view.deltas.length !== args.metricIds.length) return fail("ENGINE_REFUSED")

    const assessed = assessBundle(derivedEvidenceBundle(explained), { refEpoch: ctx.refEpoch, source: ctx.source ?? null, population: { sampleFlag: projection.worstFlag, conclusive: projection.view.conclusive } })
    if (!assessed.ok) return fail("ENGINE_REFUSED")

    const envelope = okResult(CAPABILITY, projection.view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view: projection.view } } : { result: envelope, entry: null }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
