// filterTrades(): filtros estruturados e composáveis (AND entre campos; array = OR dentro do campo).
// Não há função por combinação: qualquer combinação de campos é só mais um objeto de filtros.
// Um trade cujo atributo é DESCONHECIDO (ex.: filtro de hora num trade só com data) é EXCLUÍDO e CONTADO no relatório —
// nunca "passa" por não saber.

import { EXIT_REASON_BUCKETS } from "./exit-reason.ts"
import { prepareTrades, resolveOptions, type TradeRow } from "./prepare.ts"
import {
  MetricsInputError,
  type AnalysisOptions,
  type AnalyticsTrade,
  type FilterField,
  type FilterReport,
  type TradeFilters,
} from "./types.ts"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const arr = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v])

/** Forma canônica dos filtros (ordenada/limpa) — estável para auditoria e hash. Valida e lança MetricsInputError. */
export function normalizeFilters(f: TradeFilters = {}): TradeFilters {
  const out: TradeFilters = {}
  for (const k of ["from", "to"] as const) {
    if (f[k] !== undefined) {
      if (!DATE_RE.test(f[k]!)) throw new MetricsInputError("E_FILTER_INVALID", `Filtro ${k} deve ser YYYY-MM-DD (recebido "${f[k]}").`)
      out[k] = f[k]
    }
  }
  if (out.from && out.to && out.from > out.to) throw new MetricsInputError("E_FILTER_INVALID", `Filtro from (${out.from}) é posterior a to (${out.to}).`)
  if (f.direction !== undefined) {
    if (f.direction !== "LONG" && f.direction !== "SHORT") throw new MetricsInputError("E_FILTER_INVALID", `direction inválida: "${f.direction}".`)
    out.direction = f.direction
  }
  const strs: Array<[FilterField, (s: string) => string]> = [
    ["symbol", (s) => s.trim().toUpperCase()],
    ["account", (s) => s.trim()],
    ["session", (s) => s.trim().toUpperCase()],
    ["tradingDay", (s) => s.trim()],
    ["strategyId", (s) => s.trim()],
    ["strategyName", (s) => s.trim()],
    ["strategyVersionId", (s) => s.trim()],
    ["setup", (s) => s.trim()],
    ["timeframe", (s) => s.trim()],
    ["exitReason", (s) => s.trim().toUpperCase()],
  ]
  for (const [k, norm] of strs) {
    const v = arr(f[k] as string | string[] | undefined)
    if (v !== undefined) {
      if (v.length === 0) throw new MetricsInputError("E_FILTER_INVALID", `Filtro ${k} vazio.`)
      const sorted = [...new Set(v.map(norm))].sort()
      ;(out as Record<string, unknown>)[k] = sorted.length === 1 ? sorted[0] : sorted
    }
  }
  if (out.exitReason !== undefined) {
    for (const v of arr(out.exitReason)!) {
      if (!(EXIT_REASON_BUCKETS as readonly string[]).includes(v)) throw new MetricsInputError("E_FILTER_INVALID", `exitReason inválido: "${v}". Válidos: ${EXIT_REASON_BUCKETS.join(", ")}.`)
    }
  }
  if (out.tradingDay !== undefined) {
    for (const d of arr(out.tradingDay)!) if (!DATE_RE.test(d)) throw new MetricsInputError("E_FILTER_INVALID", `tradingDay deve ser YYYY-MM-DD ("${d}").`)
  }
  for (const [k, lo, hi] of [["hour", 0, 23], ["dayOfWeek", 0, 6]] as const) {
    const v = arr(f[k] as number | number[] | undefined)
    if (v !== undefined) {
      if (v.length === 0 || v.some((n) => !Number.isInteger(n) || n < lo || n > hi)) {
        throw new MetricsInputError("E_FILTER_INVALID", `${k} deve ser inteiro entre ${lo} e ${hi}.`)
      }
      const sorted = [...new Set(v)].sort((a, b) => a - b)
      ;(out as Record<string, unknown>)[k] = sorted.length === 1 ? sorted[0] : sorted
    }
  }
  return out
}

type Check = (r: TradeRow) => "ok" | "mismatch" | "unknown"

function buildChecks(f: TradeFilters): Array<[FilterField, Check]> {
  const checks: Array<[FilterField, Check]> = []
  const inSet = <T,>(values: T[] | undefined, get: (r: TradeRow) => T | null): Check => (r) => {
    const v = get(r)
    return v === null ? "unknown" : values!.includes(v) ? "ok" : "mismatch"
  }
  if (f.from !== undefined) checks.push(["from", (r) => (r.localDate === null ? "unknown" : r.localDate >= f.from! ? "ok" : "mismatch")])
  if (f.to !== undefined) checks.push(["to", (r) => (r.localDate === null ? "unknown" : r.localDate <= f.to! ? "ok" : "mismatch")])
  if (f.symbol !== undefined) checks.push(["symbol", inSet(arr(f.symbol), (r) => r.symbol)])
  if (f.direction !== undefined) checks.push(["direction", (r) => (r.direction === f.direction ? "ok" : "mismatch")])
  if (f.account !== undefined) checks.push(["account", inSet(arr(f.account), (r) => r.account)])
  if (f.session !== undefined) checks.push(["session", inSet(arr(f.session), (r) => r.session)])
  if (f.hour !== undefined) checks.push(["hour", inSet(arr(f.hour), (r) => r.hour)])
  if (f.dayOfWeek !== undefined) checks.push(["dayOfWeek", inSet(arr(f.dayOfWeek), (r) => r.dayOfWeek)])
  if (f.tradingDay !== undefined) checks.push(["tradingDay", inSet(arr(f.tradingDay), (r) => r.tradingDay)])
  if (f.strategyId !== undefined) checks.push(["strategyId", inSet(arr(f.strategyId), (r) => r.strategyId)])
  if (f.strategyName !== undefined) checks.push(["strategyName", inSet(arr(f.strategyName), (r) => r.strategyName)])
  if (f.strategyVersionId !== undefined) checks.push(["strategyVersionId", inSet(arr(f.strategyVersionId), (r) => r.strategyVersionId)])
  if (f.setup !== undefined) checks.push(["setup", inSet(arr(f.setup), (r) => r.setup)])
  if (f.timeframe !== undefined) checks.push(["timeframe", inSet(arr(f.timeframe), (r) => r.timeframe)])
  if (f.exitReason !== undefined) checks.push(["exitReason", inSet(arr(f.exitReason), (r) => r.exitReason)])
  return checks
}

/** Aplica filtros a LINHAS já preparadas (uso interno do motor; sem recalcular derivados). */
export function applyFilters(rows: TradeRow[], filters: TradeFilters): { rows: TradeRow[]; report: FilterReport } {
  const checks = buildChecks(filters)
  const excluded: FilterReport["excluded"] = {}
  const kept: TradeRow[] = []
  for (const r of rows) {
    let pass = true
    for (const [field, check] of checks) {
      const res = check(r)
      if (res === "ok") continue
      const e = (excluded[field] ??= { mismatch: 0, unknown: 0 })
      e[res]++
      pass = false
      break // atribui a exclusão ao 1º campo que reprova (ordem fixa) — soma do relatório = excluídos
    }
    if (pass) kept.push(r)
  }
  return { rows: kept, report: { input: rows.length, kept: kept.length, excluded } }
}

/** API pública: devolve os trades que passam + o relatório do que foi excluído e por quê. */
export function filterTrades(
  trades: AnalyticsTrade[],
  filters: TradeFilters = {},
  options: AnalysisOptions = {},
): { trades: AnalyticsTrade[]; report: FilterReport; filters: TradeFilters } {
  const f = normalizeFilters(filters)
  const rows = prepareTrades(trades, resolveOptions(options))
  const { rows: kept, report } = applyFilters(rows, f)
  return { trades: kept.map((r) => r.src), report, filters: f }
}
