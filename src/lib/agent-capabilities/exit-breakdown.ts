// Capacidade `exit.breakdown@1` (E6.6-7): a quebra por MOTIVO DE SAÍDA, com as unidades PERNA e TRADE lado a lado e nunca misturadas, a cobertura e a conferência perna × trade.
// Por baixo: o derivado EXIT_REASON_ANALYSIS (E6.2/E6.3). A view sai do `result` do PRÓPRIO derivado (o que o V6 reexecuta e confere), não de uma segunda chamada ao motor.
// Contexto, preferências do usuário, sal e arquivo vêm do servidor (Q12); sal só por salt.ts; sem userId. Toda violação de invariante ⇒ ENGINE_REFUSED (Q17). Nunca lança.
import { z } from "zod"
import type { CapabilityId, EvidenceHandle } from "../agent/contract.ts"
import { derivedEvidenceBundle, explainDerived } from "../evidence/explain-derived.ts"
import { MetricsInputError, normalizeFilters } from "../metrics/index.ts"
import { assessBundle } from "./assess.ts"
import { applyAccountFilter } from "./alias-input.ts"
import { errorResult, okResult } from "./envelope.ts"
import { QUERY_FILTERS_SCHEMA, QUERY_OPTIONS_SCHEMA, type MetricsQueryContext } from "./metrics-query.ts"
import { projectExitBreakdown } from "./project.ts"
import { generatorOpts, saltMissing } from "./salt.ts"

const CAPABILITY: CapabilityId = "exit.breakdown@1"
export const ExitBreakdownArgsSchema = z.strictObject({ filters: QUERY_FILTERS_SCHEMA, options: QUERY_OPTIONS_SCHEMA })

type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface ExitBreakdownOutput {
  result: Envelope
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
}
const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED"): ExitBreakdownOutput => ({ result: errorResult(CAPABILITY, code), entry: null })

export function exitBreakdown(rawArgs: unknown, ctx: MetricsQueryContext): ExitBreakdownOutput {
  try {
    const parsed = ExitBreakdownArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { options } = parsed.data
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(ctx.trades) || !Array.isArray(ctx.importRecords)) return fail("ENGINE_REFUSED")
    if (saltMissing(ctx)) return fail("ENGINE_REFUSED") // import SALGADO sem o sal: falha FECHADA (salt.ts)
    const af = applyAccountFilter(parsed.data.filters, ctx)
    if (!af.ok) return fail("ARGS_INVALID") // alias de conta que não resolve é erro do modelo (E6.6-5-A)
    const filters = af.filters
    try { normalizeFilters(filters ?? {}) } catch (e) { return fail(e instanceof MetricsInputError ? "ARGS_INVALID" : "ENGINE_REFUSED") } // erro de ENTRADA do motor (ex.: from > to) é do modelo

    const explained = explainDerived({
      spec: {
        op: "EXIT_REASON_ANALYSIS",
        args: {},
        filters: filters ?? {},
        options: { ...(ctx.analysis?.timeZone !== undefined ? { timeZone: ctx.analysis.timeZone } : {}), ...(ctx.analysis?.minSample !== undefined ? { minSample: ctx.analysis.minSample } : {}), ...(options?.pnlBasis !== undefined ? { pnlBasis: options.pnlBasis } : {}), ...(options?.rBasis !== undefined ? { rBasis: options.rBasis } : {}) },
      },
      trades: ctx.trades,
      importRecords: ctx.importRecords,
      ...generatorOpts(ctx),
    })
    if (!explained.ok) return fail("ENGINE_REFUSED")
    const projection = projectExitBreakdown(explained.derived.result)
    if (projection === null) return fail("ENGINE_REFUSED")

    const assessed = assessBundle(derivedEvidenceBundle(explained), { refEpoch: ctx.refEpoch, source: ctx.source ?? null, ...(projection.worstFlag !== null ? { population: { sampleFlag: projection.worstFlag } } : {}) })
    if (!assessed.ok) return fail("ENGINE_REFUSED")

    const view = { buckets: projection.buckets, reconciliation: projection.reconciliation }
    const envelope = okResult(CAPABILITY, view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view } } : { result: envelope, entry: null }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
