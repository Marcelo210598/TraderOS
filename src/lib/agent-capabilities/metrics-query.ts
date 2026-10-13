// Capacidade `metrics.query@1` (E6.6-5, fatia vertical): valores de métricas do motor, com a Evidence verificada por baixo. O modelo manda `metricIds` (+ filtros e base
// permitidos) e recebe a PromptView; os números NUNCA passam por ele (ele cita slots). Contexto (trades, importações, preferências do USUÁRIO, época do sal, arquivo
// original quando existir) vem do SERVIDOR (Q12); `userId` não existe aqui. Toda violação de invariante ⇒ ENGINE_REFUSED (Q17); args ruins ⇒ ARGS_INVALID. Nunca lança.
// Um bundle por chamada, com as N métricas pedidas (subject = a primeira): sondado que o bundle multi-métrica passa em verifyEvidence e verifyEvidenceSource.
import { z } from "zod"
import type { CapabilityId, EvidenceHandle } from "../agent/contract.ts"
import { explainMetric, type ExplainMetricInput } from "../evidence/explain-metric.ts"
import { EVIDENCE_SCHEMA, sealEvidence } from "../evidence/hash.ts"
import { METRIC_IDS, MetricsInputError, calculateMetricsTraced, type AnalyticsTrade } from "../metrics/index.ts"
import { assessBundle } from "./assess.ts"
import { errorResult, okResult } from "./envelope.ts"
import { projectMetricValue } from "./project.ts"
import type { SourceFiles, VerifySourceOptions } from "../evidence/verify-source.ts"

/** O tipo da importação vem do Evidence (agent-capabilities/ não importa domain/, Q7). */
type ImportRecord = ExplainMetricInput["importRecords"][number]
const CAPABILITY: CapabilityId = "metrics.query@1"
export const MAX_METRIC_IDS = 20
const MAX_LIST = 8
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const list = <T extends z.ZodType>(t: T) => z.union([t, z.array(t).min(1).max(MAX_LIST)])

/** Filtros e opções que o MODELO pode pedir (compartilhados com metrics.groups). Sem conta/estratégia/setup/timeframe: pendência E6.6-5-A (resolvedor de alias de ENTRADA). */
export const QUERY_FILTERS_SCHEMA = z
  .strictObject({
    from: DATE, to: DATE,
    symbol: list(z.string().regex(/^[A-Za-z0-9 ._-]{1,32}$/)),
    direction: z.enum(["LONG", "SHORT"]),
    session: list(z.enum(["AM", "PM", "OVERNIGHT"])),
    hour: list(z.number().int().min(0).max(23)),
    dayOfWeek: list(z.number().int().min(0).max(6)),
    tradingDay: list(DATE),
    exitReason: list(z.enum(["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])),
  })
  .partial()
  .optional()
export const QUERY_OPTIONS_SCHEMA = z.strictObject({ pnlBasis: z.enum(["NET", "GROSS"]), rBasis: z.enum(["NET", "POINTS"]) }).partial().optional()

export const MetricsQueryArgsSchema = z.strictObject({
  metricIds: z.array(z.string()).min(1).max(MAX_METRIC_IDS).refine((ids) => new Set(ids).size === ids.length && ids.every((id) => METRIC_IDS.includes(id))),
  filters: QUERY_FILTERS_SCHEMA,
  options: QUERY_OPTIONS_SCHEMA,
})

export interface MetricsQueryContext {
  trades: AnalyticsTrade[]
  importRecords: ImportRecord[]
  /** saltId vigente. */
  refEpoch: string
  /** Preferências do USUÁRIO (nunca do modelo). */
  analysis?: { timeZone?: string; minSample?: number }
  accountRefSalt?: string
  /** Arquivo original (quando existir); ausente ⇒ source = NOT_RUN. */
  source?: { files: SourceFiles; options?: VerifySourceOptions } | null
}
type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface MetricsQueryOutput {
  /** O que o MODELO recebe (handle sem o selo). */
  result: Envelope
  /** O que o SERVIDOR guarda no ledger (handle COMPLETO + view); null quando houve erro. */
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
}

const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED"): MetricsQueryOutput => ({ result: errorResult(CAPABILITY, code), entry: null })

export function metricsQuery(rawArgs: unknown, ctx: MetricsQueryContext): MetricsQueryOutput {
  try {
    const parsed = MetricsQueryArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { metricIds, filters, options } = parsed.data
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(ctx.trades) || !Array.isArray(ctx.importRecords)) return fail("ENGINE_REFUSED")
    // import SALGADO sem o sal: a Evidence sairia com refs sem sal e o E5b acusaria um falso SOURCE_MISMATCH (lacuna conhecida do guarda de sal): falha FECHADA
    if (ctx.importRecords.some((r) => r.reproducibility?.accountRefSalted === true) && (typeof ctx.accountRefSalt !== "string" || ctx.accountRefSalt === "")) return fail("ENGINE_REFUSED")

    let calc: ReturnType<typeof calculateMetricsTraced>
    try {
      calc = calculateMetricsTraced(ctx.trades, { filters: filters ?? {}, ...(ctx.analysis?.timeZone !== undefined ? { timeZone: ctx.analysis.timeZone } : {}), ...(ctx.analysis?.minSample !== undefined ? { minSample: ctx.analysis.minSample } : {}), ...(options?.pnlBasis !== undefined ? { pnlBasis: options.pnlBasis } : {}), ...(options?.rBasis !== undefined ? { rBasis: options.rBasis } : {}) })
    } catch (e) {
      return fail(e instanceof MetricsInputError ? "ARGS_INVALID" : "ENGINE_REFUSED")
    }
    const { result, trace } = calc

    const explained = metricIds.map((metricId) => explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades: ctx.trades, importRecords: ctx.importRecords, ...(ctx.accountRefSalt !== undefined ? { opts: { accountRefSalt: ctx.accountRefSalt } } : {}) }))
    const oks = explained.flatMap((x) => (x.ok ? [x] : []))
    if (oks.length !== explained.length) return fail("ENGINE_REFUSED")
    const first = oks[0]
    const sameTrades = JSON.stringify(first.tradeEvidences)
    const sameImports = JSON.stringify(first.importRefs)
    if (oks.some((x) => JSON.stringify(x.tradeEvidences) !== sameTrades || JSON.stringify(x.importRefs) !== sameImports)) return fail("ENGINE_REFUSED") // mesma população ⇒ mesmas evidências

    const bundle = sealEvidence({
      schema: EVIDENCE_SCHEMA,
      claim: { kind: "METRIC", statement: null },
      subject: { type: "METRIC", id: metricIds[0] },
      evidence: { imports: first.importRefs, trades: first.tradeEvidences, metrics: oks.map((x) => x.metricEvidence) },
    })
    const assessed = assessBundle(bundle, { refEpoch: ctx.refEpoch, source: ctx.source ?? null })
    if (!assessed.ok) return fail("ENGINE_REFUSED")

    const projected = metricIds.map((id) => projectMetricValue(result.metrics[id]))
    if (projected.some((m) => m === null)) return fail("ENGINE_REFUSED")
    const view = { metrics: projected, period: { from: result.period.fromLocalDate, to: result.period.toLocalDate } }

    const envelope = okResult(CAPABILITY, view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view } } : { result: envelope, entry: null }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
