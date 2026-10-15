// Capacidade `exit.analysis@1` (E6.6-10): a quebra por MOTIVO DE SAÍDA (a mesma do exit.breakdown: pernas e trades lado a lado, nunca misturadas, + reconciliação) MAIS, se pedida, a
// COMPARAÇÃO de dois motivos numa unidade (LEG ou TRADE). Por baixo: derivados EXIT_REASON_ANALYSIS e, com `compare`, EXIT_REASON_COMPARISON_LEGS/_TRADES (E6.2/E6.3), NO MESMO bundle
// (analysis primeiro; união de imports/trades sem duplicata, como o metrics.groups). A chave dos lados da comparação é [motivo, unidade] (a unidade diz o que `sampleSize` conta).
// Contexto, preferências do usuário, sal e arquivo vêm do servidor (Q12); sal só por salt.ts; sem userId; sem alocação de alias. Toda violação de invariante ⇒ ENGINE_REFUSED. Nunca lança.
import { z } from "zod"
import type { CapabilityId, EvidenceHandle } from "../agent/contract.ts"
import { derivedEvidenceBundle, explainDerived } from "../evidence/explain-derived.ts"
import { EVIDENCE_SCHEMA, sealEvidence } from "../evidence/hash.ts"
import { MetricsInputError, normalizeFilters } from "../metrics/index.ts"
import { assessBundle } from "./assess.ts"
import { applyAccountFilter } from "./alias-input.ts"
import { errorResult, okResult } from "./envelope.ts"
import { QUERY_FILTERS_SCHEMA, QUERY_OPTIONS_SCHEMA, type MetricsQueryContext } from "./metrics-query.ts"
import { projectExitBreakdown, projectExitComparison } from "./project.ts"
import { generatorOpts, saltMissing } from "./salt.ts"

const CAPABILITY: CapabilityId = "exit.analysis@1"
const LEG_REASONS = ["TARGET", "STOP", "MANUAL", "UNKNOWN"] as const
const TRADE_REASONS = ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"] as const

const CompareArgs = z
  .strictObject({ unit: z.enum(["LEG", "TRADE"]), a: z.enum(TRADE_REASONS), b: z.enum(TRADE_REASONS) })
  .superRefine((v, ctx) => {
    if (v.a === v.b) ctx.addIssue({ code: "custom", message: "a e b iguais" })
    if (v.unit === "LEG" && (!(LEG_REASONS as readonly string[]).includes(v.a) || !(LEG_REASONS as readonly string[]).includes(v.b))) ctx.addIssue({ code: "custom", message: "MIXED não existe em pernas" })
  })
export const ExitAnalysisArgsSchema = z.strictObject({ compare: CompareArgs.optional(), filters: QUERY_FILTERS_SCHEMA, options: QUERY_OPTIONS_SCHEMA })

type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface ExitAnalysisOutput {
  result: Envelope
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
}
const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED"): ExitAnalysisOutput => ({ result: errorResult(CAPABILITY, code), entry: null })
const FLAGS = ["OK", "LOW", "TINY"] as const
const CONFS = ["OK", "LIMITED", "UNRELIABLE"] as const

export function exitAnalysis(rawArgs: unknown, ctx: MetricsQueryContext): ExitAnalysisOutput {
  try {
    const parsed = ExitAnalysisArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { compare, options } = parsed.data
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(ctx.trades) || !Array.isArray(ctx.importRecords)) return fail("ENGINE_REFUSED")
    if (saltMissing(ctx)) return fail("ENGINE_REFUSED") // import SALGADO sem o sal: falha FECHADA (salt.ts)
    const af = applyAccountFilter(parsed.data.filters, ctx)
    if (!af.ok) return fail("ARGS_INVALID") // alias de conta que não resolve é erro do modelo (E6.6-5-A)
    const filters = af.filters ?? {}
    try { normalizeFilters(filters) } catch (e) { return fail(e instanceof MetricsInputError ? "ARGS_INVALID" : "ENGINE_REFUSED") } // erro de ENTRADA do motor (ex.: from > to) é do modelo

    const specOptions = { ...(ctx.analysis?.timeZone !== undefined ? { timeZone: ctx.analysis.timeZone } : {}), ...(ctx.analysis?.minSample !== undefined ? { minSample: ctx.analysis.minSample } : {}), ...(options?.pnlBasis !== undefined ? { pnlBasis: options.pnlBasis } : {}), ...(options?.rBasis !== undefined ? { rBasis: options.rBasis } : {}) }
    const analysis = explainDerived({ spec: { op: "EXIT_REASON_ANALYSIS", args: {}, filters, options: specOptions }, trades: ctx.trades, importRecords: ctx.importRecords, ...generatorOpts(ctx) })
    if (!analysis.ok) return fail("ENGINE_REFUSED")
    const breakdown = projectExitBreakdown(analysis.derived.result)
    if (breakdown === null) return fail("ENGINE_REFUSED")

    let comparison: ReturnType<typeof projectExitComparison> = null
    let bundle = derivedEvidenceBundle(analysis)
    if (compare !== undefined) {
      const cmp = explainDerived({ spec: { op: compare.unit === "LEG" ? "EXIT_REASON_COMPARISON_LEGS" : "EXIT_REASON_COMPARISON_TRADES", args: { a: compare.a, b: compare.b }, filters, options: specOptions }, trades: ctx.trades, importRecords: ctx.importRecords, ...generatorOpts(ctx) })
      if (!cmp.ok) return fail("ENGINE_REFUSED")
      if (cmp.derived.population.afterFilters !== analysis.derived.population.afterFilters) return fail("ENGINE_REFUSED") // mesma população nos dois derivados
      comparison = projectExitComparison(cmp.derived.result, compare.unit)
      if (comparison === null) return fail("ENGINE_REFUSED")
      // união dos 2 derivados (a mesma trade/import tem de ter o MESMO conteúdo nos dois)
      const trades = new Map<string, unknown>()
      const imports = new Map<string, unknown>()
      for (const e of [analysis, cmp]) {
        for (const t of e.tradeEvidences) { const prev = trades.get(t.tradeId); if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(t)) return fail("ENGINE_REFUSED"); trades.set(t.tradeId, t) }
        for (const im of e.importRefs) { const prev = imports.get(im.importId); if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(im)) return fail("ENGINE_REFUSED"); imports.set(im.importId, im) }
      }
      bundle = sealEvidence({
        schema: EVIDENCE_SCHEMA,
        claim: { kind: "DERIVED", statement: null },
        subject: { type: "DERIVED", id: analysis.derived.derivedId },
        evidence: { imports: [...imports.values()] as never, trades: [...trades.values()] as never, metrics: [], derived: [analysis.derived, cmp.derived] },
      })
    }

    const flags = [breakdown.worstFlag, comparison === null ? null : comparison.worstFlag].filter((f): f is (typeof FLAGS)[number] => f !== null)
    const worstFlag = flags.length === 0 ? null : FLAGS[flags.reduce((w, f) => Math.max(w, FLAGS.indexOf(f)), 0)]
    const confs = [analysis.derived.summary.confidence, comparison === null ? null : comparison.confidence].filter((c): c is (typeof CONFS)[number] => c !== null)
    const population = {
      ...(worstFlag !== null ? { sampleFlag: worstFlag } : {}),
      ...(comparison !== null ? { conclusive: comparison.view.conclusive } : {}),
      ...(comparison !== null && confs.length > 0 ? { confidence: CONFS[confs.reduce((w, c) => Math.max(w, CONFS.indexOf(c)), 0)] } : {}),
    }
    const assessed = assessBundle(bundle, { refEpoch: ctx.refEpoch, source: ctx.source ?? null, ...(Object.keys(population).length > 0 ? { population } : {}) })
    if (!assessed.ok) return fail("ENGINE_REFUSED")

    const view = { buckets: breakdown.buckets, comparison: comparison === null ? null : comparison.view, reconciliation: breakdown.reconciliation }
    const envelope = okResult(CAPABILITY, view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view } } : { result: envelope, entry: null }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
