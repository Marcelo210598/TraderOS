// Helpers e fixtures SINTÉTICAS dos testes de métricas (não é um teste; os test-metrics-*.mts importam daqui).
// Os trades são montados com o MESMO builder do pipeline (domínio real), a partir de valores pequenos e auditáveis à mão.
// O dataset TEN está tabelado em docs/ai-partner/metrics-audit-dataset.md com TODAS as contas.
import assert from "node:assert/strict"
import { SCHEMA_TRADE, type CanonicalTrade, type SourceMetadata } from "../src/lib/domain/canonical.ts"
import { UNKNOWN_TIME, parseLocalDateTime, type TimeValue } from "../src/lib/domain/time.ts"
import { buildCanonicalTrade } from "../src/lib/ingest/build-trade.ts"
import { validateTrade } from "../src/lib/ingest/validator.ts"
import type { AnalyticsTrade } from "../src/lib/metrics/types.ts"

export const NY = "America/New_York"
export const BRT = "America/Sao_Paulo"

export const SRC: SourceMetadata = {
  platform: "OTHER",
  parserId: "synthetic",
  parserVersion: "0",
  fileName: null,
  fileHash: null,
  rowNo: null,
  externalId: null,
  settings: { sourceTz: NY, dateOrder: null, numberLocale: "US", excursionUnit: null, declaredPnlBasis: "UNKNOWN" },
}

const T = (s: string, tz: string): TimeValue => {
  const r = parseLocalDateTime(s, { tz })
  assert.equal(r.ok, true, `${s}: ${r.ok ? "" : (r as { message: string }).message}`)
  return (r as { ok: true; value: TimeValue }).value
}

export interface MkOpts {
  id: string
  root?: string // "MNQ" | "NQ" | "ES" | "MES" | "XYZ" (desconhecido)
  direction: "LONG" | "SHORT"
  entry: number
  exit: number
  qty?: number
  /** "YYYY-MM-DD HH:mm:ss" no fuso `tz` */
  entryAt?: string
  exitAt?: string
  tz?: string
  /** só data (DATE_ONLY) — sem hora */
  dateOnly?: string
  stop?: number | null
  commission?: number | null
  fees?: number | null
  strategyName?: string | null
  strategyId?: string | null
  strategyVersionId?: string | null
  setup?: string | null
  timeframe?: string | null
  account?: string | null
}

/** Trade canônico real: bruto pelos preços (DERIVED_FROM_FILLS), custos informados, R líquido só se houver stop. */
export function mk(o: MkOpts): AnalyticsTrade {
  const root = o.root ?? "MNQ"
  const tz = o.tz ?? NY
  const entryAt = o.dateOnly ? T(o.dateOnly, tz) : T(o.entryAt!, tz)
  const exitAt = o.dateOnly ? UNKNOWN_TIME : T(o.exitAt!, tz)
  const built = buildCanonicalTrade({
    source: { ...SRC, settings: { ...SRC.settings, sourceTz: tz } },
    accountName: o.account ?? null,
    instrumentRaw: `${root} 03-26`,
    direction: o.direction,
    quantity: o.qty ?? 1,
    entry: { at: entryAt, price: o.entry },
    exit: { at: exitAt, price: o.exit },
    reportedPnl: null,
    declaredPnlBasis: "UNKNOWN",
    grossFromFills: true,
    commission: o.commission === undefined ? 1 : o.commission,
    fees: o.fees === undefined ? 0.2 : o.fees,
    stopPrice: o.stop ?? null,
    mfeRaw: null,
    maeRaw: null,
    excursionUnit: null,
    strategyName: o.strategyName ?? null,
    notes: null,
    sessionHint: null,
  })
  const v = validateTrade(built)
  const trade: CanonicalTrade = { ...built, schemaVersion: SCHEMA_TRADE, dataQuality: v.dataQuality, issues: v.issues }
  return {
    id: o.id,
    trade,
    strategyId: o.strategyId ?? null,
    strategyVersionId: o.strategyVersionId ?? null,
    setup: o.setup ?? null,
    timeframe: o.timeframe ?? null,
  }
}

/**
 * TEN — 10 trades de MNQ (1 contrato, US$ 2/ponto), comissão 1,00 + taxas 0,20 por trade (líquido = bruto − 1,20).
 * Horários em America/New_York. Tudo tabelado em docs/ai-partner/metrics-audit-dataset.md.
 *
 *  id  entrada → saída (ET)            lado   entrada→saída    bruto   líquido   stop     R líq
 *  t1  12/01 09:35 → 09:50              LONG   21000 → 21020    +40,00  +38,80    20990    +1,94
 *  t2  12/01 10:10 → 10:25              SHORT  21050 → 21060    −20,00  −21,20    21060    −1,06
 *  t3  12/01 11:05 → 11:20              LONG   21070 → 21070      0,00   −1,20    21060    −0,06
 *  t4  13/01 09:40 → 09:48              LONG   21100 → 21130    +60,00  +58,80    —         —
 *  t5  13/01 10:30 → 10:45              SHORT  21140 → 21125    +30,00  +28,80    21150    +1,44
 *  t6  13/01 14:00 → 14:30              LONG   21120 → 21100    −40,00  −41,20    21110    −2,06
 *  t7  14/01 09:32 → 09:40              LONG   21200 → 21212,5  +25,00  +23,80    —         —
 *  t8  14/01 10:00 → 10:50              SHORT  21230 → 21240    −20,00  −21,20    —         —
 *  t9  14/01 15:00 → 15:10              LONG   21210 → 21210      0,00   −1,20    —         —
 *  t10 14/01 19:00 → 19:30 (overnight)  SHORT  21190 → 21170    +40,00  +38,80    —         —
 */
export function ten(): AnalyticsTrade[] {
  const base = { root: "MNQ" as const, commission: 1, fees: 0.2 }
  return [
    mk({ ...base, id: "t1", direction: "LONG", entry: 21000, exit: 21020, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00", stop: 20990, strategyId: "orb", strategyVersionId: "orb-v1", setup: "breakout", timeframe: "5m" }),
    mk({ ...base, id: "t2", direction: "SHORT", entry: 21050, exit: 21060, entryAt: "2026-01-12 10:10:00", exitAt: "2026-01-12 10:25:00", stop: 21060, strategyId: "orb", strategyVersionId: "orb-v1", setup: "pullback", timeframe: "5m" }),
    mk({ ...base, id: "t3", direction: "LONG", entry: 21070, exit: 21070, entryAt: "2026-01-12 11:05:00", exitAt: "2026-01-12 11:20:00", stop: 21060, strategyId: "orb", strategyVersionId: "orb-v1", timeframe: "5m" }),
    mk({ ...base, id: "t4", direction: "LONG", entry: 21100, exit: 21130, entryAt: "2026-01-13 09:40:00", exitAt: "2026-01-13 09:48:00", strategyId: "orb", strategyVersionId: "orb-v2", setup: "breakout", timeframe: "5m" }),
    mk({ ...base, id: "t5", direction: "SHORT", entry: 21140, exit: 21125, entryAt: "2026-01-13 10:30:00", exitAt: "2026-01-13 10:45:00", stop: 21150, strategyId: "orb", strategyVersionId: "orb-v2", setup: "pullback", timeframe: "5m" }),
    mk({ ...base, id: "t6", direction: "LONG", entry: 21120, exit: 21100, entryAt: "2026-01-13 14:00:00", exitAt: "2026-01-13 14:30:00", stop: 21110, strategyId: "fade", strategyVersionId: "fade-v1", timeframe: "1m" }),
    mk({ ...base, id: "t7", direction: "LONG", entry: 21200, exit: 21212.5, entryAt: "2026-01-14 09:32:00", exitAt: "2026-01-14 09:40:00", strategyId: "fade", strategyVersionId: "fade-v1", setup: "breakout", timeframe: "1m" }),
    mk({ ...base, id: "t8", direction: "SHORT", entry: 21230, exit: 21240, entryAt: "2026-01-14 10:00:00", exitAt: "2026-01-14 10:50:00", strategyId: "fade", strategyVersionId: "fade-v1", setup: "pullback", timeframe: "1m" }),
    mk({ ...base, id: "t9", direction: "LONG", entry: 21210, exit: 21210, entryAt: "2026-01-14 15:00:00", exitAt: "2026-01-14 15:10:00" }),
    mk({ ...base, id: "t10", direction: "SHORT", entry: 21190, exit: 21170, entryAt: "2026-01-14 19:00:00", exitAt: "2026-01-14 19:30:00" }),
  ]
}

/** Valor de uma métrica (falha o teste se a métrica não existe). */
export function val(result: { metrics: Record<string, { value: number | null }> }, id: string): number | null {
  const m = result.metrics[id]
  assert.ok(m, `métrica ausente: ${id}`)
  return m.value
}

/** true se o número tem no máximo `d` casas decimais "limpas" (sem 1.5999999999999999). */
export const clean = (x: number, d: number): boolean => Math.abs(Math.round(x * 10 ** d) / 10 ** d - x) < 1e-12
