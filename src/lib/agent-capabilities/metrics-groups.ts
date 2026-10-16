// Capacidade `metrics.groups@1` (E6.6-6): as mesmas métricas do motor, particionadas por 1–2 dimensões. Um bundle por chamada: o TOTAL + (grupo × métrica), verificado de ponta a
// ponta (sondado: VALID e SOURCE_VERIFIED). A CHAVE do grupo sai só como texto seguro (group-key.ts): conta/estratégia como alias da tabela da conversa; o `group.key`/`group.label`
// do motor carregam o NOME da conta e NUNCA são lidos. Contexto, preferências do usuário, sal e arquivo vêm do servidor (Q12); `userId` não existe aqui. Nunca lança.
// Fora (declarado): agrupar por strategyVersion/setup/timeframe (texto livre, D6-1) e FILTRAR por conta/estratégia (E6.6-5-A: resolvedor de alias de ENTRADA).
import { z } from "zod"
import { newAliasTable, type AliasTable } from "../agent/label.ts"
import type { CapabilityId, EvidenceHandle } from "../agent/contract.ts"
import { explainMetric } from "../evidence/explain-metric.ts"
import { EVIDENCE_SCHEMA, sealEvidence } from "../evidence/hash.ts"
import { METRIC_IDS, MetricsInputError, aggregateTradesTraced } from "../metrics/index.ts"
import { assessBundle } from "./assess.ts"
import { applyAliasFilters } from "./alias-input.ts"
import { errorResult, okResult } from "./envelope.ts"
import { GROUP_DIMENSIONS, groupKeyPart, type GroupDimension } from "./group-key.ts"
import { QUERY_FILTERS_SCHEMA, QUERY_OPTIONS_SCHEMA, type MetricsQueryContext } from "./metrics-query.ts"
import { generatorOpts, saltMissing } from "./salt.ts"
import { projectMetricValue } from "./project.ts"

const CAPABILITY: CapabilityId = "metrics.groups@1"
export const MAX_GROUPS = 50
export const MAX_GROUP_METRICS = 10

export const MetricsGroupsArgsSchema = z.strictObject({
  groupBy: z.array(z.enum(GROUP_DIMENSIONS)).min(1).max(2).refine((d) => new Set(d).size === d.length),
  metricIds: z.array(z.string()).min(1).max(MAX_GROUP_METRICS).refine((ids) => new Set(ids).size === ids.length && ids.every((id) => METRIC_IDS.includes(id))),
  filters: QUERY_FILTERS_SCHEMA,
  options: QUERY_OPTIONS_SCHEMA,
})

export interface MetricsGroupsContext extends MetricsQueryContext {
  /** Tabela de alias da CONVERSA (imutável); ausente ⇒ tabela nova da época. O chamador guarda a que volta em `aliases`. */
  aliases?: AliasTable
}
type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface MetricsGroupsOutput {
  result: Envelope
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
  aliases: AliasTable
}

type Explained = ReturnType<typeof explainMetric>
const SEVERITY = ["OK", "LOW", "TINY"] as const

export function metricsGroups(rawArgs: unknown, ctx: MetricsGroupsContext): MetricsGroupsOutput {
  let aliases: AliasTable | undefined
  try { aliases = typeof ctx === "object" && ctx !== null ? ctx.aliases : undefined } catch { aliases = undefined }
  const fallbackAliases = (): AliasTable => aliases ?? newAliasTable("s1")
  const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED"): MetricsGroupsOutput => ({ result: errorResult(CAPABILITY, code), entry: null, aliases: fallbackAliases() })
  try {
    const parsed = MetricsGroupsArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { groupBy, metricIds, options } = parsed.data
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(ctx.trades) || !Array.isArray(ctx.importRecords)) return fail("ENGINE_REFUSED")
    if (saltMissing(ctx)) return fail("ENGINE_REFUSED") // import SALGADO sem o sal: falha FECHADA (salt.ts)
    const af = applyAliasFilters(parsed.data.filters, ctx)
    if (!af.ok) return fail("ARGS_INVALID") // alias de conta que não resolve é erro do modelo (E6.6-5-A)
    const filters = af.filters

    let calc: ReturnType<typeof aggregateTradesTraced>
    try {
      calc = aggregateTradesTraced(ctx.trades, { groupBy, metrics: metricIds, filters: filters ?? {}, ...(ctx.analysis?.timeZone !== undefined ? { timeZone: ctx.analysis.timeZone } : {}), ...(ctx.analysis?.minSample !== undefined ? { minSample: ctx.analysis.minSample } : {}), ...(options?.pnlBasis !== undefined ? { pnlBasis: options.pnlBasis } : {}), ...(options?.rBasis !== undefined ? { rBasis: options.rBasis } : {}) })
    } catch (e) {
      return fail(e instanceof MetricsInputError ? "ARGS_INVALID" : "ENGINE_REFUSED")
    }
    const { result, trace } = calc
    if (result.groups.length > MAX_GROUPS) return fail("ARGS_INVALID") // nunca trunca e responde como completo (D6-2)
    if (result.groups.reduce((n, g) => n + g.sampleSize, 0) !== result.total.population.afterFilters) return fail("ENGINE_REFUSED") // os grupos particionam a população

    const total = explainMetric({ metricId: metricIds[0], source: { kind: "AGGREGATE", result, trace, scope: { kind: "TOTAL" } }, trades: ctx.trades, importRecords: ctx.importRecords, ...generatorOpts(ctx) })
    if (!total.ok) return fail("ENGINE_REFUSED")
    const evidences: Explained[] = [total]
    const groupEvidence: Explained[][] = []
    for (let i = 0; i < result.groups.length; i++) {
      const row = metricIds.map((metricId) => explainMetric({ metricId, source: { kind: "AGGREGATE", result, trace, scope: { kind: "GROUP", index: i } }, trades: ctx.trades, importRecords: ctx.importRecords, ...generatorOpts(ctx) }))
      if (row.some((x) => !x.ok)) return fail("ENGINE_REFUSED")
      groupEvidence.push(row)
      evidences.push(...row)
    }

    // união das evidências (grupos particionam a população; o mesmo tradeId tem de ter o MESMO conteúdo)
    const trades = new Map<string, unknown>()
    const imports = new Map<string, unknown>()
    for (const e of evidences) {
      if (!e.ok) return fail("ENGINE_REFUSED")
      for (const t of e.tradeEvidences) { const prev = trades.get(t.tradeId); if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(t)) return fail("ENGINE_REFUSED"); trades.set(t.tradeId, t) }
      for (const im of e.importRefs) { const prev = imports.get(im.importId); if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(im)) return fail("ENGINE_REFUSED"); imports.set(im.importId, im) }
    }
    const bundle = sealEvidence({
      schema: EVIDENCE_SCHEMA,
      claim: { kind: "METRIC", statement: null },
      subject: { type: "METRIC", id: metricIds[0] },
      evidence: { imports: [...imports.values()] as never, trades: [...trades.values()] as never, metrics: evidences.flatMap((e) => (e.ok ? [e.metricEvidence] : [])) },
    })

    const worst = result.groups.reduce<number>((w, g) => Math.max(w, SEVERITY.indexOf(g.sampleFlag)), -1)
    const assessed = assessBundle(bundle, { refEpoch: ctx.refEpoch, source: ctx.source ?? null, scope: "GROUP", ...(worst >= 0 ? { population: { sampleFlag: SEVERITY[worst] } } : {}) })
    if (!assessed.ok) return fail("ENGINE_REFUSED")

    // chave e valores de cada grupo (a chave vem do groupKey da EVIDÊNCIA: refs, nunca o nome)
    let table = aliases ?? newAliasTable(ctx.refEpoch)
    const viewGroups = []
    for (let i = 0; i < result.groups.length; i++) {
      const first = groupEvidence[i][0]
      const raw = first.ok ? first.metricEvidence.query.groupKey : null
      if (raw === null || raw.length !== groupBy.length) return fail("ENGINE_REFUSED")
      const key: string[] = []
      for (let d = 0; d < groupBy.length; d++) {
        const k = groupKeyPart(groupBy[d] as GroupDimension, raw[d], table, ctx.refEpoch)
        if (!k.ok) return fail("ENGINE_REFUSED")
        table = k.aliases
        key.push(k.text)
      }
      const g = result.groups[i]
      const metrics = metricIds.map((id) => projectMetricValue(g.metrics[id]))
      if (metrics.some((m) => m === null)) return fail("ENGINE_REFUSED")
      viewGroups.push({ key, sampleFlag: g.sampleFlag, sampleSize: g.sampleSize, metrics })
    }
    const view = { groupBy: [...groupBy], groups: viewGroups }
    const envelope = okResult(CAPABILITY, view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view }, aliases: table } : { result: envelope, entry: null, aliases: fallbackAliases() }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
