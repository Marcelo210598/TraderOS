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
