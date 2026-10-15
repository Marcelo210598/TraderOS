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
import { ExitBucketViewSchema, ExitReasonSchema, ExplainViewSchema } from "../agent/views.ts"

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
import { CompareViewSchema, RankViewSchema, UnitSchema } from "../agent/views.ts"
import { REASON_TEXTS, formatDate, formatEnum } from "../agent/format.ts"
import { allocateAlias, newAliasTable, projectLabelView, type AliasTable } from "../agent/label.ts"
import { EXPLAIN_MAX_TRADES } from "../agent/contract.ts"
import { exitReasonOf } from "../metrics/index.ts"
import { groupKeyPart, type GroupDimension } from "./group-key.ts"

/** As 10 dimensões que a comparação aceita (as verificáveis pela Evidence; `account` por alias de ENTRADA, E6.6-5-A; estratégia espera o 5-A2 e sessão não é verificável). */
export const COMPARE_DIMENSIONS = ["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "symbol", "direction", "exitReason", "account"] as const
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

export function projectCompare(result: unknown, refEpoch: string, aliases?: AliasTable): CompareProjection | null {
  try {
    if (typeof refEpoch !== "string" || !EPOCH_OK.test(refEpoch)) return null
    const parsed = CmpIn.safeParse(result)
    if (!parsed.success) return null
    const r = parsed.data
    const keyOf = (side: z.infer<typeof CmpSideIn>): string[] | null => {
      if (r.kind === "GROUP_COMPARISON") {
        const k = side.key
        if (k === null || k.dims.length < 1 || k.dims.length !== k.key.length) return null
        let table = aliases !== undefined && aliases !== null && aliases.epoch === refEpoch ? aliases : newAliasTable(refEpoch) // a tabela da CONVERSA (E6.6-5-A): o alias de uma conta é o dela
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


// ── rank.groups (E6.6-9) ─────────────────────────────────────────────────────
// Projeção do `result` do derivado GROUP_RANKING (o que o V6 verifica) para a RankView. Lista branca: o `result` é lido por um schema local (exit, shareOfTrades, limitations, confidence,
// tradeSetHash, label da chave… nunca são lidos); a chave sai SÓ por groupKeyPart (conta ⇒ alias da tabela da conversa, alocando se faltar). A ORDEM das linhas é a do motor (nunca reordena).
// `rank` null = grupo sem posição, no fim; ranks não-nulos têm de ser 1..n em sequência. Qualquer coisa fora do contrato ⇒ null (a capacidade recusa com ENGINE_REFUSED).
const RankValueIn = z.object({ value: Finite.nullable(), reason: z.string().nullable(), unit: z.string(), coverage: CoverageIn })
const RankRowIn = z.object({
  rank: z.number().int().positive().nullable(),
  key: z.object({ dims: z.array(z.string()).min(1), key: z.array(z.string().nullable()) }),
  sampleSize: z.number().int().nonnegative(),
  sampleFlag: FlagIn,
  tiedWithPrevious: z.boolean(),
  value: RankValueIn,
  contributionToTotal: FractionIn,
})
const RankIn = z.object({ kind: z.literal("GROUP_RANKING"), metric: z.object({ id: z.string().min(1) }), order: z.enum(["DESC", "ASC"]), rows: z.array(RankRowIn) })

export interface RankProjection {
  view: ReturnType<typeof RankViewSchema.parse>
  /** O PIOR sampleFlag entre TODAS as linhas (inclui as sem posição); "OK" se não há linhas. */
  worstFlag: Flag
  /** A tabela da conversa depois de alocar as contas/estratégias novas (a mesma, se nada foi alocado). */
  aliases: AliasTable
}

export function projectRank(result: unknown, refEpoch: string, aliases?: AliasTable): RankProjection | null {
  try {
    if (typeof refEpoch !== "string" || !EPOCH_OK.test(refEpoch)) return null
    const parsed = RankIn.safeParse(result)
    if (!parsed.success) return null
    const r = parsed.data
    let table = aliases !== undefined && aliases !== null && aliases.epoch === refEpoch ? aliases : newAliasTable(refEpoch)
    const dims = JSON.stringify(r.rows.length > 0 ? r.rows[0].key.dims : [])
    const rows: Array<Record<string, unknown>> = []
    let seenNull = false
    for (let i = 0; i < r.rows.length; i++) {
      const row = r.rows[i]
      if (JSON.stringify(row.key.dims) !== dims || row.key.dims.length !== row.key.key.length) return null
      if (row.rank === null) seenNull = true
      else if (seenNull || row.rank !== i + 1) return null // ranqueados primeiro e em sequência 1..n
      const key: string[] = []
      for (let d = 0; d < row.key.dims.length; d++) {
        const dim = row.key.dims[d]
        if (!(COMPARE_DIMENSIONS as readonly string[]).includes(dim)) return null
        const part = groupKeyPart(dim as GroupDimension, row.key.key[d], table, refEpoch)
        if (!part.ok) return null
        table = part.aliases
        key.push(part.text)
      }
      const v = row.value
      const c = row.contributionToTotal
      if (!UnitSchema.safeParse(v.unit).success) return null
      if (!knownReason(v.reason) || !knownReason(c.reason)) return null
      if ((v.value === null && v.reason === null) || (c.value === null && c.reason === null)) return null // indisponível sem motivo: nunca zero, nunca em branco
      let ratio = v.coverage.ratio
      if (ratio === null) { if (v.coverage.total !== 0) return null; ratio = 0 }
      rows.push({
        rank: row.rank,
        key,
        value: { metricId: r.metric.id, value: v.value, unit: v.unit, basis: null, sampleSize: row.sampleSize, coverage: { used: v.coverage.used, total: v.coverage.total, ratio }, reason: v.reason },
        sampleFlag: row.sampleFlag,
        tiedWithPrevious: row.tiedWithPrevious,
        contribution: c.value,
        contributionReason: c.reason,
      })
    }
    const view = RankViewSchema.safeParse({ rows, orderedBy: `${r.metric.id} ${r.order}` })
    if (!view.success) return null
    const order: Flag[] = ["OK", "LOW", "TINY"]
    const worst = r.rows.reduce<number>((w, row) => Math.max(w, order.indexOf(row.sampleFlag)), 0)
    return { view: view.data, worstFlag: order[worst], aliases: table }
  } catch {
    return null
  }
}

// ── exit.analysis: a COMPARAÇÃO (E6.6-10) ────────────────────────────────────
// Projeção do `result` do derivado EXIT_REASON_COMPARISON_LEGS / _TRADES (o que o V6 verifica) para a CompareView. Lista branca (o resto — label, key.label, tradeSetHash, period,
// limitations, confidence por lado — nunca é lido). A chave de cada lado é [palavra do motivo, palavra da UNIDADE] (D10-4), SÓ por formatEnum: a unidade diz o que `sampleSize` conta.
const ExitSideIn = z.object({ key: z.object({ key: z.array(z.string()).length(1) }), sampleSize: z.number().int().nonnegative(), sampleFlag: FlagIn })
const ExitCmpIn = z.object({ kind: z.literal("EXIT_REASON_COMPARISON"), unit: z.enum(["LEG", "TRADE"]), a: ExitSideIn, b: ExitSideIn, metrics: z.array(CmpMetricIn).min(1), confidence: z.enum(["OK", "LIMITED", "UNRELIABLE"]) })
const LEG_REASONS: readonly string[] = ["TARGET", "STOP", "MANUAL", "UNKNOWN"]
const TRADE_REASONS: readonly string[] = ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"]

export function projectExitComparison(result: unknown, unit: "LEG" | "TRADE"): CompareProjection | null {
  try {
    if (unit !== "LEG" && unit !== "TRADE") return null
    const parsed = ExitCmpIn.safeParse(result)
    if (!parsed.success || parsed.data.unit !== unit) return null
    const r = parsed.data
    const allowed = unit === "LEG" ? LEG_REASONS : TRADE_REASONS
    const keyOf = (side: z.infer<typeof ExitSideIn>): string[] | null => {
      const reason = side.key.key[0]
      if (!allowed.includes(reason)) return null
      const word = formatEnum("exitReason", reason)
      const unitWord = formatEnum("bucketUnit", unit)
      return word.ok && unitWord.ok ? [word.text, unitWord.text] : null
    }
    const ka = keyOf(r.a)
    const kb = keyOf(r.b)
    if (ka === null || kb === null) return null
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

// ── evidence.explain (E6.6-11) ───────────────────────────────────────────────
// Projeção dos trades do BUNDLE (T2) para a ExplainView. Lista branca: cada trade é lido por um schema local que só conhece os campos usados (tradeId, importId, rowRefs, sourceRows,
// issues, fieldProvenance, accountRef, at.raw/instantUtc… NUNCA saem) e a view é montada campo a campo. Rótulo SÓ por projectLabelView (A2: vocabulário v1 ou alias; aloca "rótulo
// personalizado X" na tabela e a devolve); conta SÓ por leitura da tabela (nunca aloca); motivo de saída pela MESMA função do motor (exitReasonOf). Nada de Date: a hora local sai da `raw`.
const ExTime = z.object({ raw: z.string(), localDate: z.string() })
const ExLeg = z.object({ price: z.number().finite(), quantity: z.number().finite(), sourceLabel: z.string().nullable() })
const ExExitLeg = ExLeg.extend({ reason: z.string(), pnl: z.object({ net: Finite.nullable() }) })
const ExTrade = z.object({
  accountRef: z.string().nullable(),
  instrument: z.object({ root: z.string().nullable() }),
  direction: z.enum(["LONG", "SHORT"]),
  quantity: z.number().finite(),
  entry: z.object({ at: ExTime, price: z.number().finite() }),
  exit: z.object({ at: ExTime, price: z.number().finite() }),
  pnl: z.object({ net: Finite.nullable(), gross: Finite.nullable() }),
  entryLegs: z.array(ExLeg).nullable(),
  exitLegs: z.array(ExExitLeg).nullable(),
  exitSummary: z.object({ byReason: z.record(z.string(), z.number()) }).nullable().optional(),
})
const RAW_TIME = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
/** `AAAA-MM-DD HH:MM:SS` a partir de `localDate` + a hora da `raw` (só se a data da `raw` for a mesma); senão null. */
function localOf(at: z.infer<typeof ExTime>): string | null {
  const r = RAW_TIME.exec(at.raw)
  const d = LOCAL_DATE.exec(at.localDate)
  return r !== null && d !== null && r[3] === d[1] && r[2] === d[2] && r[1] === d[3] ? `${at.localDate} ${r[4]}` : null
}

export interface ExplainProjection {
  view: ReturnType<typeof ExplainViewSchema.parse>
  /** A tabela depois de alocar os rótulos personalizados novos (contas NUNCA são alocadas aqui). */
  aliases: AliasTable
}

export function projectExplainPage(allTrades: unknown, page: number, refEpoch: string, aliases?: AliasTable): ExplainProjection | null {
  try {
    if (typeof refEpoch !== "string" || !EPOCH_OK.test(refEpoch) || !Array.isArray(allTrades) || !Number.isInteger(page) || page < 1) return null
    const total = allTrades.length
    const pageCount = Math.max(1, Math.ceil(total / EXPLAIN_MAX_TRADES))
    if (page > pageCount) return null
    let table = aliases !== undefined && aliases !== null && aliases.epoch === refEpoch ? aliases : newAliasTable(refEpoch)
    const slice = allTrades.slice((page - 1) * EXPLAIN_MAX_TRADES, page * EXPLAIN_MAX_TRADES)
    const trades: Array<Record<string, unknown>> = []
    for (let i = 0; i < slice.length; i++) {
      const parsed = ExTrade.safeParse(slice[i])
      if (!parsed.success) return null
      const t = parsed.data
      const bucket = exitReasonOf({ exitLegs: t.exitLegs === null ? null : t.exitLegs.map((l) => ({ reason: l.reason })), exitSummary: t.exitSummary ?? null } as never).bucket
      const legs: Array<Record<string, unknown>> = []
      const add = (role: "ENTRY" | "EXIT", l: z.infer<typeof ExLeg>, pnlNet: number | null): boolean => {
        const lab = projectLabelView(l.sourceLabel, table, refEpoch)
        if (!lab.ok) return false
        table = lab.table
        legs.push({ role, price: l.price, quantity: l.quantity, label: lab.label, pnlNet })
        return true
      }
      for (const l of t.entryLegs ?? []) if (!add("ENTRY", l, null)) return null
      for (const l of t.exitLegs ?? []) if (!add("EXIT", l, l.pnl.net)) return null
      let accountAlias: string | null = null
      if (t.accountRef !== null && table.conta.includes(t.accountRef)) { const a = allocateAlias(table, "conta", t.accountRef, refEpoch); accountAlias = a.ok ? a.alias : null } // só LEITURA: ref já na tabela
      trades.push({
        ordinal: i + 1,
        instrument: t.instrument.root,
        direction: t.direction,
        quantity: t.quantity,
        entryLocal: localOf(t.entry.at),
        exitLocal: localOf(t.exit.at),
        entryPrice: t.entry.price,
        exitPrice: t.exit.price,
        pnlNet: t.pnl.net,
        pnlGross: t.pnl.gross,
        exitReason: bucket,
        accountAlias,
        legs,
      })
    }
    const view = ExplainViewSchema.safeParse({ page, pageCount, total, trades })
    return view.success ? { view: view.data, aliases: table } : null
  } catch {
    return null
  }
}
