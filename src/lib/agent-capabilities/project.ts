// Projeção por LISTA BRANCA do valor de uma métrica do motor para a PromptView (E6.6-4). Cópia UM A UM dos campos permitidos; o resto do objeto do motor (available,
// definitionVersion, details, e qualquer campo T0 que um dia apareça) nunca é lido. Sem spread. Devolve null (recusa) se o valor não é representável com honestidade.
import { MetricValueViewSchema } from "../agent/views.ts"

type MetricValueView = ReturnType<typeof MetricValueViewSchema.parse>

export function projectMetricValue(m: unknown): MetricValueView | null {
  try {
    if (typeof m !== "object" || m === null || Array.isArray(m)) return null
    const src = m as Record<string, unknown>
    const cov = src.coverage
    if (typeof cov !== "object" || cov === null) return null
    const c = cov as Record<string, unknown>
    const value = src.value
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return null
    const reason = src.reason === undefined ? null : src.reason
    if (value === null && reason === null) return null // indisponível sem motivo: nunca zero, nunca em branco
    let ratio = c.ratio
    if (ratio === null) { if (c.total !== 0) return null; ratio = 0 }
    const out = MetricValueViewSchema.safeParse({
      metricId: src.metric,
      value,
      unit: src.unit,
      basis: src.basis === undefined ? null : src.basis,
      sampleSize: src.sampleSize,
      coverage: { used: c.used, total: c.total, ratio },
      reason,
    })
    return out.success ? out.data : null
  } catch {
    return null
  }
}

// ── exit.breakdown (E6.6-7) ──────────────────────────────────────────────────
// Projeção do `result` do derivado EXIT_REASON_ANALYSIS (o que o V6 verifica) para as linhas da PromptView. Lista branca: o `result` é lido por um schema local que
// só conhece os campos usados (o resto — label, rank, legSetHash, limitations, confidence por linha — nunca é lido) e cada linha da view é montada campo a campo.
import { z } from "zod"
import { ExitBucketViewSchema, ExitReasonSchema } from "../agent/views.ts"

const CoverageIn = z.object({ used: z.number().int().nonnegative(), total: z.number().int().nonnegative(), ratio: z.number().nullable() })
const CellIn = z.object({ value: z.number().nullable(), reason: z.string().nullable(), coverage: CoverageIn })
const FractionIn = z.object({ value: z.number().nullable(), reason: z.string().nullable() })
const FlagIn = z.enum(["OK", "LOW", "TINY"])
const LegRowIn = z.object({ reason: z.enum(["TARGET", "STOP", "MANUAL", "UNKNOWN"]), legs: z.number().int().nonnegative(), net: CellIn, contributionToLegNet: FractionIn, sampleFlag: FlagIn })
const TradeRowIn = z.object({ bucket: ExitReasonSchema, trades: z.number().int().nonnegative(), net: CellIn, contributionToTotalNet: FractionIn, sampleFlag: FlagIn })
const ExitResultIn = z.object({ legs: z.object({ rows: z.array(LegRowIn) }), trades: z.object({ rows: z.array(TradeRowIn) }), reconciliation: z.object({ status: z.string() }) })

/** Status de conferência perna × trade do motor → palavra da view (D7-1): PARTIAL e NO_LEGS ⇒ NOT_COMPARABLE. Outra entrada ⇒ null. */
export function mapReconciliation(status: unknown): "RECONCILED" | "DIVERGENT" | "NOT_COMPARABLE" | null {
  return status === "FULL" ? "RECONCILED" : status === "DIVERGENT" ? "DIVERGENT" : status === "PARTIAL" || status === "NO_LEGS" ? "NOT_COMPARABLE" : null
}

type Flag = "OK" | "LOW" | "TINY"
export interface ExitBreakdownProjection {
  buckets: Array<ReturnType<typeof ExitBucketViewSchema.parse>>
  reconciliation: "RECONCILED" | "DIVERGENT" | "NOT_COMPARABLE"
  /** O PIOR sampleFlag entre as linhas com contagem > 0 (null se não há nenhuma). */
  worstFlag: Flag | null
}

export function projectExitBreakdown(result: unknown): ExitBreakdownProjection | null {
  try {
    const parsed = ExitResultIn.safeParse(result)
    if (!parsed.success) return null
    const reconciliation = mapReconciliation(parsed.data.reconciliation.status)
    if (reconciliation === null) return null
    // concat (não spread: o guarda Q4 proíbe `...` neste arquivo; a projeção é cópia explícita)
    type Row = { reason: z.infer<typeof ExitReasonSchema>; unit: "LEG" | "TRADE"; count: number; net: z.infer<typeof CellIn>; share: z.infer<typeof FractionIn>; flag: Flag }
    const legRows: Row[] = parsed.data.legs.rows.map((r) => ({ reason: r.reason, unit: "LEG", count: r.legs, net: r.net, share: r.contributionToLegNet, flag: r.sampleFlag }))
    const tradeRows: Row[] = parsed.data.trades.rows.map((r) => ({ reason: r.bucket, unit: "TRADE", count: r.trades, net: r.net, share: r.contributionToTotalNet, flag: r.sampleFlag }))
    const rows = legRows.concat(tradeRows)
    const buckets: ExitBreakdownProjection["buckets"] = []
    for (const r of rows) {
      if ((r.net.value === null && r.net.reason === null) || (r.share.value === null && r.share.reason === null)) return null // indisponível sem motivo: nunca zero nem em branco
      let ratio = r.net.coverage.ratio
      if (ratio === null) { if (r.net.coverage.total !== 0) return null; ratio = 0 }
      const b = ExitBucketViewSchema.safeParse({
        reason: r.reason,
        unit: r.unit,
        count: r.count,
        pnlNet: r.net.value,
        pnlNetReason: r.net.reason,
        share: r.share.value,
        shareReason: r.share.reason,
        coverage: { used: r.net.coverage.used, total: r.net.coverage.total, ratio },
      })
      if (!b.success) return null
      buckets.push(b.data)
    }
    const order: Flag[] = ["OK", "LOW", "TINY"]
    const worst = rows.filter((r) => r.count > 0).reduce<number>((w, r) => Math.max(w, order.indexOf(r.flag)), -1)
    return { buckets, reconciliation, worstFlag: worst >= 0 ? order[worst] : null }
  } catch {
    return null
  }
}
