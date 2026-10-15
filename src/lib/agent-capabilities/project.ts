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

// ── metrics.compare (E6.6-8) ─────────────────────────────────────────────────
// Projeção do `result` do derivado GROUP_COMPARISON / PERIOD_COMPARISON (o que o V6 verifica) para a CompareView. Lista branca: o `result` é lido por um schema local que só
// conhece os campos usados (label, tradeSetHash, period cru, limitations, coverage, comparable… nunca são lidos); a chave sai SÓ por groupKeyPart (nunca `key.label` do motor)
// ou pelas datas formatadas. Qualquer coisa fora do contrato ⇒ null (a capacidade recusa com ENGINE_REFUSED).
import { CompareViewSchema, UnitSchema } from "../agent/views.ts"
import { REASON_TEXTS, formatDate } from "../agent/format.ts"
import { newAliasTable } from "../agent/label.ts"
import { groupKeyPart, type GroupDimension } from "./group-key.ts"

/** As 9 dimensões que a comparação aceita (as verificáveis pela Evidence; conta/estratégia esperam o E6.6-5-A, sessão não é verificável). */
export const COMPARE_DIMENSIONS = ["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "symbol", "direction", "exitReason"] as const
const EPOCH_OK = /^[a-z0-9][a-z0-9_-]{0,31}$/
const Finite = z.number().refine((x) => Number.isFinite(x))
const CmpCellIn = z.object({ value: Finite.nullable(), reason: z.string().nullable() })
const CmpSideIn = z.object({
  key: z.object({ dims: z.array(z.string()), key: z.array(z.string().nullable()) }).nullable(),
  period: z.object({ from: z.string(), to: z.string() }).nullable(),
  sampleSize: z.number().int().nonnegative(),
  sampleFlag: FlagIn,
})
const CmpMetricIn = z.object({ metric: z.string(), unit: z.string(), a: CmpCellIn, b: CmpCellIn, delta: Finite.nullable(), ratio: Finite.nullable(), reason: z.string().nullable(), conclusive: z.boolean() })
const CmpIn = z.object({ kind: z.enum(["GROUP_COMPARISON", "PERIOD_COMPARISON"]), a: CmpSideIn, b: CmpSideIn, metrics: z.array(CmpMetricIn).min(1), confidence: z.enum(["OK", "LIMITED", "UNRELIABLE"]) })

export interface CompareProjection {
  view: ReturnType<typeof CompareViewSchema.parse>
  /** O PIOR sampleFlag entre A e B. */
  worstFlag: Flag
  confidence: "OK" | "LIMITED" | "UNRELIABLE"
}

const knownReason = (r: string | null): boolean => r === null || Object.hasOwn(REASON_TEXTS, r)

export function projectCompare(result: unknown, refEpoch: string): CompareProjection | null {
  try {
    if (typeof refEpoch !== "string" || !EPOCH_OK.test(refEpoch)) return null
    const parsed = CmpIn.safeParse(result)
    if (!parsed.success) return null
    const r = parsed.data
    const keyOf = (side: z.infer<typeof CmpSideIn>): string[] | null => {
      if (r.kind === "GROUP_COMPARISON") {
        const k = side.key
        if (k === null || k.dims.length < 1 || k.dims.length !== k.key.length) return null
        let table = newAliasTable(refEpoch)
        const out: string[] = []
        for (let i = 0; i < k.dims.length; i++) {
          const dim = k.dims[i]
          const raw = k.key[i]
          if (!(COMPARE_DIMENSIONS as readonly string[]).includes(dim) || raw === null) return null
          const part = groupKeyPart(dim as GroupDimension, raw, table, refEpoch)
          if (!part.ok) return null
          table = part.aliases
          out.push(part.text)
        }
        return out
      }
      const p = side.period
      if (p === null) return null
      const from = formatDate(p.from)
      const to = formatDate(p.to)
      return from.ok && to.ok ? [`${from.text} a ${to.text}`] : null
    }
    const ka = keyOf(r.a)
    const kb = keyOf(r.b)
    if (ka === null || kb === null) return null
    if (r.kind === "GROUP_COMPARISON" && JSON.stringify(r.a.key?.dims) !== JSON.stringify(r.b.key?.dims)) return null
    const deltas: Array<Record<string, unknown>> = []
    for (const m of r.metrics) {
      if (!UnitSchema.safeParse(m.unit).success) return null
      if (!knownReason(m.a.reason) || !knownReason(m.b.reason) || !knownReason(m.reason)) return null
      if ((m.a.value === null && m.a.reason === null) || (m.b.value === null && m.b.reason === null)) return null // indisponível sem motivo: nunca zero, nunca em branco
      if ((m.delta === null || m.ratio === null) && m.reason === null) return null
      deltas.push({ metricId: m.metric, unit: m.unit, a: m.a.value, aReason: m.a.reason, b: m.b.value, bReason: m.b.reason, delta: m.delta, ratio: m.ratio, reason: m.reason })
    }
    const conclusive = r.metrics.every((m) => m.conclusive) && r.confidence === "OK"
    const view = CompareViewSchema.safeParse({ a: { key: ka, sampleSize: r.a.sampleSize }, b: { key: kb, sampleSize: r.b.sampleSize }, deltas, conclusive })
    if (!view.success) return null
    const order: Flag[] = ["OK", "LOW", "TINY"]
    const worst = Math.max(order.indexOf(r.a.sampleFlag), order.indexOf(r.b.sampleFlag))
    return { view: view.data, worstFlag: order[worst], confidence: r.confidence }
  } catch {
    return null
  }
}

