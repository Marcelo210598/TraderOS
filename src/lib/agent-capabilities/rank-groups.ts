// Capacidade `rank.groups@1` (E6.6-9): o RANKING de grupos por uma métrica (1–2 dimensões verificáveis). Por baixo: o derivado GROUP_RANKING (E6.2). A view sai do `result` do PRÓPRIO
// derivado (o que o V6 reexecuta), por lista branca (project.ts), na ORDEM do motor: ranqueados primeiro, depois os SEM POSIÇÃO (rank null: amostra minúscula ou valor indisponível), nunca descartados.
// Sem `where` (os filtros já recortam) e sem `limit`: devolve TODAS as partições, e mais de MAX_GROUPS ⇒ ARGS_INVALID (D6-2, nunca trunca). Como o metrics.groups, ALOCA alias de conta/estratégia
// na tabela da conversa e a DEVOLVE (D9-8). Contexto, preferências do usuário, sal e arquivo vêm do servidor (Q12); sem userId. Nunca lança.
import { z } from "zod"
import { newAliasTable, type AliasTable } from "../agent/label.ts"
import type { CapabilityId, EvidenceHandle } from "../agent/contract.ts"
import { derivedEvidenceBundle, explainDerived } from "../evidence/explain-derived.ts"
import { METRIC_IDS, MetricsInputError, normalizeFilters } from "../metrics/index.ts"
import { assessBundle } from "./assess.ts"
import { applyAliasFilters } from "./alias-input.ts"
import { errorResult, okResult } from "./envelope.ts"
import { MAX_GROUPS, type MetricsGroupsContext } from "./metrics-groups.ts"
import { QUERY_FILTERS_SCHEMA, QUERY_OPTIONS_SCHEMA } from "./metrics-query.ts"
import { RANK_DIMENSIONS, projectRank } from "./project.ts"
import { generatorOpts, saltMissing } from "./salt.ts"

const CAPABILITY: CapabilityId = "rank.groups@1"

export const RankGroupsArgsSchema = z.strictObject({
  groupBy: z.array(z.enum(RANK_DIMENSIONS)).min(1).max(2).refine((d) => new Set(d).size === d.length),
  metric: z.string().refine((id) => METRIC_IDS.includes(id)).default("netPnl"),
  order: z.enum(["DESC", "ASC"]).default("DESC"),
  filters: QUERY_FILTERS_SCHEMA,
  options: QUERY_OPTIONS_SCHEMA,
})

type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface RankGroupsOutput {
  result: Envelope
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
  aliases: AliasTable
}

export function rankGroupsCapability(rawArgs: unknown, ctx: MetricsGroupsContext): RankGroupsOutput {
  let aliases: AliasTable | undefined
  try { aliases = typeof ctx === "object" && ctx !== null ? ctx.aliases : undefined } catch { aliases = undefined }
  const fallbackAliases = (): AliasTable => aliases ?? newAliasTable("s1")
  const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED"): RankGroupsOutput => ({ result: errorResult(CAPABILITY, code), entry: null, aliases: fallbackAliases() })
  try {
    const parsed = RankGroupsArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { groupBy, metric, order, options } = parsed.data
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(ctx.trades) || !Array.isArray(ctx.importRecords)) return fail("ENGINE_REFUSED")
    if (saltMissing(ctx)) return fail("ENGINE_REFUSED") // import SALGADO sem o sal: falha FECHADA (salt.ts)
    const af = applyAliasFilters(parsed.data.filters, ctx)
    if (!af.ok) return fail("ARGS_INVALID") // alias de conta que não resolve é erro do modelo (E6.6-5-A)
    const filters = af.filters ?? {}
    try { normalizeFilters(filters) } catch (e) { return fail(e instanceof MetricsInputError ? "ARGS_INVALID" : "ENGINE_REFUSED") } // erro de ENTRADA do motor (ex.: from > to) é do modelo

    const specOptions = { ...(ctx.analysis?.timeZone !== undefined ? { timeZone: ctx.analysis.timeZone } : {}), ...(ctx.analysis?.minSample !== undefined ? { minSample: ctx.analysis.minSample } : {}), ...(options?.pnlBasis !== undefined ? { pnlBasis: options.pnlBasis } : {}), ...(options?.rBasis !== undefined ? { rBasis: options.rBasis } : {}) }
    const spec = { op: "GROUP_RANKING" as const, args: { groupBy: [...groupBy], metric, order }, filters, options: specOptions }
    const explained = explainDerived({ spec, trades: ctx.trades, importRecords: ctx.importRecords, ...generatorOpts(ctx) })
    if (!explained.ok) return fail("ENGINE_REFUSED")
    const rows = (explained.derived.result as { rows?: unknown }).rows
    if (Array.isArray(rows) && rows.length > MAX_GROUPS) return fail("ARGS_INVALID") // nunca trunca e responde como completo (D6-2)

    const projection = projectRank(explained.derived.result, ctx.refEpoch, aliases)
    if (projection === null) return fail("ENGINE_REFUSED")
    const assessed = assessBundle(derivedEvidenceBundle(explained), { refEpoch: ctx.refEpoch, source: ctx.source ?? null, onBundle: ctx.onBundle, population: { sampleFlag: projection.worstFlag } })
    if (!assessed.ok) return fail("ENGINE_REFUSED")

    const envelope = okResult(CAPABILITY, projection.view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view: projection.view }, aliases: projection.aliases } : { result: envelope, entry: null, aliases: fallbackAliases() }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
