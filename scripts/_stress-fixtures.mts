// Fixtures do estresse 50×10 do metrics.groups (E6.6, expectativa e66_stress). Sintéticas e determinísticas; 1 conta, 1 perna por trade.
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { METRIC_IDS, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any
export const BRT = "America/Sao_Paulo"
export const AN = { timeZone: BRT, minSample: 4 } as const
/** As 10 primeiras métricas do catálogo (as MESMAS do estresse medido em 16/10). */
export const IDS10: string[] = (METRIC_IDS as readonly string[]).slice(0, 10)
const pad = (n: number): string => String(n).padStart(2, "0")
const dateOf = (d: number): string => { const dt = new Date(Date.UTC(2026, 0, 5) + d * 86400000); return `${pad(dt.getUTCDate())}/${pad(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}` }
const row = (date: string, minuteOfDay: number, win: boolean, dur = 5): SynthRow =>
  ({ account: "Sim101", qty: 1, entryPrice: 2000, exitPrice: win ? 2004 : 1997, entryAt: `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:00`, exitAt: `${date} ${pad(Math.floor((minuteOfDay + dur) / 60))}:${pad((minuteOfDay + dur) % 60)}:00`, exitLabel: win ? "Target1" : "Stop1" }) as Any

export interface Fixture { trades: Any[]; rec: ImportRecord; files: Record<string, Uint8Array>; ctx: (o?: Any) => Any }
const finish = (rows: SynthRow[]): Fixture => {
  const csv = synthCsv(rows)
  const imp = runImportPipeline(csv, { sourceTz: BRT, fileName: "segredo-estresse.csv" })
  const rec = imp.importRecord as ImportRecord
  const trades = toAnalyticsTrades(withRisk(imp.trades))
  return { trades, rec, files: { [rec.importId]: new TextEncoder().encode(csv) }, ctx: (o: Any = {}) => ({ trades, importRecords: [rec], refEpoch: "s1", analysis: AN, ...o }) }
}
/** `days` dias × `perDay` trades por dia (cada trade 14 min depois do anterior; groupBy day ⇒ `days` grupos de `perDay`). */
export const symmetric = (days: number, perDay: number): Fixture => finish(Array.from({ length: days * perDay }, (_, k) => { const d = Math.floor(k / perDay), m = k % perDay; return row(dateOf(d), m * 14, (d + m) % 3 !== 0) }))
/** Assimétrica: `days - 1` dias de 1 trade + 1 dia com o RESTO (total = `total`). */
export const skewed = (days: number, total: number): Fixture => {
  const rows: SynthRow[] = []
  for (let d = 0; d < days - 1; d++) rows.push(row(dateOf(d), 0, d % 3 !== 0))
  for (let m = 0; m < total - (days - 1); m++) rows.push(row(dateOf(days - 1), m * 3, m % 3 !== 0, 2)) // 2 min de duração e 3 de espaçamento: sem sobreposição (senão a reconstrução funde os trades)
  return finish(rows)
}
/** `days` dias × `hours` horas (a partir das 09h) × `perCell` trades por (dia, hora) ⇒ groupBy [day, hour] tem days×hours grupos. */
export const grid = (days: number, hours: number, perCell: number): Fixture =>
  finish(Array.from({ length: days * hours * perCell }, (_, k) => { const cell = Math.floor(k / perCell), i = k % perCell, d = Math.floor(cell / hours), h = cell % hours; return row(dateOf(d), (9 + h) * 60 + i * 5, (d + h + i) % 3 !== 0) }))
