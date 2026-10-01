// Testes de filtros, agrupamentos (groupBy), fuso, overnight e virada de dia: node scripts/test-metrics-groups.mts
// Valores esperados do dataset TEN calculados à mão (docs/ai-partner/metrics-audit-dataset.md).
import assert from "node:assert/strict"
import { aggregateTrades, calculateMetrics, filterTrades, MetricsInputError, type AggregateResult } from "../src/lib/metrics/index.ts"
import { BRT, mk, ten, val } from "./_metrics-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const net = (g: { metrics: Record<string, { value: number | null }> }) => g.metrics.netPnl.value
const table = (a: AggregateResult) => a.groups.map((g) => [g.key.join("|"), g.sampleSize, net(g)] as const)
const ids = (r: { trades: Array<{ id: string }> }) => r.trades.map((t) => t.id)

// ── filtros ──────────────────────────────────────────────────────────────────

test("filtros vazios = todos; filterTrades devolve o relatório de exclusão", () => {
  const r = filterTrades(ten(), {})
  assert.equal(r.trades.length, 10)
  assert.deepEqual(r.report, { input: 10, kept: 10, excluded: {} })
  assert.equal(calculateMetrics(ten(), { filters: {} }).population.afterFilters, 10)
})

test("filtro por símbolo, direção, período (from/to inclusivo)", () => {
  assert.equal(filterTrades(ten(), { symbol: "mnq" }).trades.length, 10) // normaliza caixa
  assert.equal(filterTrades(ten(), { symbol: "NQ" }).trades.length, 0)
  assert.deepEqual(ids(filterTrades(ten(), { direction: "SHORT" })), ["t2", "t5", "t8", "t10"])
  assert.deepEqual(ids(filterTrades(ten(), { from: "2026-01-13", to: "2026-01-13" })), ["t4", "t5", "t6"])
  assert.deepEqual(ids(filterTrades(ten(), { from: "2026-01-14" })), ["t7", "t8", "t9", "t10"])
})

test("filtro por hora e por dia da semana (escalar OU lista = OR dentro do campo)", () => {
  assert.deepEqual(ids(filterTrades(ten(), { hour: 9 })), ["t1", "t4", "t7"])
  assert.deepEqual(ids(filterTrades(ten(), { hour: [9, 10] })), ["t1", "t2", "t4", "t5", "t7", "t8"])
  assert.deepEqual(ids(filterTrades(ten(), { dayOfWeek: 1 })), ["t1", "t2", "t3"]) // segunda 12/01
  assert.equal(filterTrades(ten(), { dayOfWeek: [2, 3] }).trades.length, 7)
})

test("filtro por sessão (AM/PM/OVERNIGHT em ET) e por dia de pregão CME", () => {
  assert.deepEqual(ids(filterTrades(ten(), { session: "OVERNIGHT" })), ["t10"])
  assert.equal(filterTrades(ten(), { session: "am" }).trades.length, 7)
  assert.deepEqual(ids(filterTrades(ten(), { session: "PM" })), ["t6", "t9"])
  // t10 entra 19:00 ET = 18:00 CT de quarta ⇒ já é o pregão de QUINTA 15/01
  assert.deepEqual(ids(filterTrades(ten(), { tradingDay: "2026-01-15" })), ["t10"])
})

test("filtro por estratégia, versão, setup e timeframe", () => {
  assert.deepEqual(ids(filterTrades(ten(), { strategyId: "orb" })), ["t1", "t2", "t3", "t4", "t5"])
  assert.deepEqual(ids(filterTrades(ten(), { strategyVersionId: "orb-v1" })), ["t1", "t2", "t3"])
  assert.deepEqual(ids(filterTrades(ten(), { setup: "breakout" })), ["t1", "t4", "t7"])
  assert.deepEqual(ids(filterTrades(ten(), { timeframe: "1m" })), ["t6", "t7", "t8"])
})

test("filtros COMBINADOS (AND entre campos): lado × hora, versão × setup", () => {
  assert.deepEqual(ids(filterTrades(ten(), { direction: "SHORT", hour: 10 })), ["t2", "t5", "t8"])
  assert.deepEqual(ids(filterTrades(ten(), { direction: "LONG", hour: 9 })), ["t1", "t4", "t7"])
  assert.deepEqual(ids(filterTrades(ten(), { strategyVersionId: "orb-v2", setup: "pullback" })), ["t5"])
  assert.equal(filterTrades(ten(), { direction: "SHORT", hour: 9 }).trades.length, 0)
})

test("filtro combinado reflete nas métricas: SHORT = 4 trades, líquido 25,20", () => {
  const r = calculateMetrics(ten(), { filters: { direction: "SHORT" } })
  assert.equal(r.population.afterFilters, 4)
  assert.equal(val(r, "netPnl"), 25.2)
  assert.deepEqual(r.population.tradeIds, ["t10", "t2", "t5", "t8"]) // ordenados
})

test("atributo DESCONHECIDO exclui e é CONTADO (não 'passa por não saber')", () => {
  const r = filterTrades(ten(), { strategyId: "orb" })
  // t6,t7,t8 = fade (não casam); t9,t10 = sem estratégia (desconhecido)
  assert.deepEqual(r.report.excluded.strategyId, { mismatch: 3, unknown: 2 })
  assert.equal(r.report.input - r.report.kept, 5)
  const m = calculateMetrics(ten(), { filters: { strategyId: "orb" } })
  assert.ok(m.warnings.some((w) => w.code === "W_FILTER_EXCLUDED_UNKNOWN"))
})

test("composável: filterTrades + calculateMetrics = calculateMetrics({filters}) (mesmas métricas)", () => {
  const f = { direction: "LONG" as const, hour: [9, 10] }
  const a = calculateMetrics(filterTrades(ten(), f).trades)
  const b = calculateMetrics(ten(), { filters: f })
  assert.deepEqual(a.metrics, b.metrics)
})

test("filtros inválidos lançam MetricsInputError com código (não são ignorados)", () => {
  const bad = (f: object) => assert.throws(() => filterTrades(ten(), f), (e: unknown) => e instanceof MetricsInputError && e.code === "E_FILTER_INVALID")
  bad({ from: "12/01/2026" })
  bad({ from: "2026-02-01", to: "2026-01-01" })
  bad({ hour: 24 })
  bad({ hour: -1 })
  bad({ dayOfWeek: 7 })
  bad({ direction: "SIDEWAYS" })
  bad({ symbol: [] })
  bad({ hour: 9.5 })
})

test("filtros ecoados NORMALIZADOS no resultado (auditoria): caixa, lista ordenada e sem repetição", () => {
  const r = calculateMetrics(ten(), { filters: { symbol: ["mnq", "MNQ", "es"], hour: [10, 9, 9], session: "am" } })
  assert.deepEqual(r.query.filters, { symbol: ["ES", "MNQ"], session: "AM", hour: [9, 10] })
})

// ── agrupamentos ─────────────────────────────────────────────────────────────

test("groupBy hour: 09h 3 trades +121,40 · 10h 3 trades −13,60 · 11h −1,20 · 14h −41,20 · 15h −1,20 · 19h +38,80", () => {
  const a = aggregateTrades(ten(), { groupBy: "hour" })
  assert.deepEqual(table(a), [["09", 3, 121.4], ["10", 3, -13.6], ["11", 1, -1.2], ["14", 1, -41.2], ["15", 1, -1.2], ["19", 1, 38.8]])
  assert.deepEqual(a.groups.map((g) => g.label), ["09:00", "10:00", "11:00", "14:00", "15:00", "19:00"])
})

test("groupBy hour: R por grupo respeita a cobertura DO GRUPO (09h: 1 de 3 com R)", () => {
  const a = aggregateTrades(ten(), { groupBy: "hour" })
  const g9 = a.groups[0]
  assert.deepEqual([g9.metrics.totalR.value, g9.metrics.totalR.sampleSize, g9.metrics.totalR.coverage.ratio], [1.94, 1, 0.3333])
  const g10 = a.groups[1]
  assert.deepEqual([g10.metrics.totalR.value, g10.metrics.totalR.sampleSize], [0.38, 2]) // t2 −1,06 + t5 +1,44
  const g14 = a.groups[3]
  assert.equal(g14.metrics.totalR.value, -2.06)
})

test("groupBy dayOfWeek: seg +16,40 · ter +46,40 · qua +40,20", () => {
  const a = aggregateTrades(ten(), { groupBy: "dayOfWeek" })
  assert.deepEqual(table(a), [["1", 3, 16.4], ["2", 3, 46.4], ["3", 4, 40.2]])
  assert.deepEqual(a.groups.map((g) => g.label), ["Seg", "Ter", "Qua"])
})

test("groupBy sessão: AM +106,60 (7 trades), OVERNIGHT +38,80, PM −42,40", () => {
  const a = aggregateTrades(ten(), { groupBy: "session" })
  assert.deepEqual(table(a), [["AM", 7, 106.6], ["OVERNIGHT", 1, 38.8], ["PM", 2, -42.4]])
})

test("groupBy direção e símbolo", () => {
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "direction" })), [["LONG", 6, 77.8], ["SHORT", 4, 25.2]])
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "symbol" })), [["MNQ", 10, 103]])
})

test("groupBy dia, dia de pregão, semana e mês", () => {
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "day" })), [["2026-01-12", 3, 16.4], ["2026-01-13", 3, 46.4], ["2026-01-14", 4, 40.2]])
  // dia de PREGÃO: o t10 (overnight de quarta) já pertence a quinta
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "tradingDay" })), [["2026-01-12", 3, 16.4], ["2026-01-13", 3, 46.4], ["2026-01-14", 3, 1.4], ["2026-01-15", 1, 38.8]])
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "week" })), [["2026-01-12", 10, 103]]) // semana começa na segunda
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "month" })), [["2026-01", 10, 103]])
})

test("groupBy estratégia / versão / setup / timeframe: grupo 'sem …' (null) vai por ÚLTIMO e nada some", () => {
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "strategy" })), [["fade", 3, -38.6], ["orb", 5, 104], ["", 2, 37.6]])
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "strategyVersion" })), [["fade-v1", 3, -38.6], ["orb-v1", 3, 16.4], ["orb-v2", 2, 87.6], ["", 2, 37.6]])
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "setup" })), [["breakout", 3, 121.4], ["pullback", 3, -13.6], ["", 4, -4.8]])
  assert.deepEqual(table(aggregateTrades(ten(), { groupBy: "timeframe" })), [["1m", 3, -38.6], ["5m", 5, 104], ["", 2, 37.6]])
  const a = aggregateTrades(ten(), { groupBy: "setup" })
  assert.equal(a.groups[2].label, "(sem setup)")
  assert.ok(a.warnings.some((w) => w.code === "W_GROUP_UNKNOWN_BUCKET"))
})

test("INVARIANTE: a soma das amostras e do líquido dos grupos = população total (em toda dimensão)", () => {
  const dims = ["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "session", "symbol", "direction", "strategy", "strategyVersion", "setup", "timeframe"] as const
  for (const d of dims) {
    const a = aggregateTrades(ten(), { groupBy: d })
    assert.equal(a.groups.reduce((s, g) => s + g.sampleSize, 0), 10, d)
    const totalCents = Math.round(a.groups.reduce((s, g) => s + (net(g) ?? 0) * 100, 0))
    assert.equal(totalCents, 10300, d)
  }
})

test("groupBy com 2 dimensões (lado × sessão) e com filtro", () => {
  const a = aggregateTrades(ten(), { groupBy: ["direction", "session"] })
  assert.deepEqual(a.groups.map((g) => g.key.join("|")), ["LONG|AM", "LONG|PM", "SHORT|AM", "SHORT|OVERNIGHT"])
  assert.equal(a.groups.reduce((s, g) => s + g.sampleSize, 0), 10)
  const f = aggregateTrades(ten(), { groupBy: "hour", filters: { direction: "SHORT" } })
  assert.deepEqual(table(f), [["10", 3, -13.6], ["19", 1, 38.8]])
  assert.equal(f.total.population.afterFilters, 4)
})

test("groupBy com subconjunto de métricas; métrica/dimensão inexistente = erro", () => {
  const a = aggregateTrades(ten(), { groupBy: "hour", metrics: ["netPnl", "winRate"] })
  assert.deepEqual(Object.keys(a.groups[0].metrics).sort(), ["netPnl", "winRate"])
  assert.throws(() => aggregateTrades(ten(), { groupBy: "hour", metrics: ["inventada"] }), (e: unknown) => e instanceof MetricsInputError && e.code === "E_METRIC_UNKNOWN")
  assert.throws(() => aggregateTrades(ten(), { groupBy: "cor" as never }), (e: unknown) => e instanceof MetricsInputError && e.code === "E_GROUPBY_INVALID")
  assert.throws(() => aggregateTrades(ten(), { groupBy: [] }), (e: unknown) => e instanceof MetricsInputError)
})

test("flag de amostra por grupo: TINY (<3), LOW (<30); `minSample` configurável", () => {
  const a = aggregateTrades(ten(), { groupBy: "hour" })
  assert.deepEqual(a.groups.map((g) => g.sampleFlag), ["LOW", "LOW", "TINY", "TINY", "TINY", "TINY"])
  const b = aggregateTrades(ten(), { groupBy: "hour", minSample: 3 })
  assert.deepEqual(b.groups.map((g) => g.sampleFlag), ["OK", "OK", "TINY", "TINY", "TINY", "TINY"])
})

// ── fuso, overnight, virada de dia ───────────────────────────────────────────

const tzSet = () => [
  mk({ id: "a", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-14 23:30:00", exitAt: "2026-01-14 23:50:00" }), // ET → 01:30 BRT do dia 15
  mk({ id: "b", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-14 20:00:00", exitAt: "2026-01-14 20:10:00" }), // 22:00 BRT do dia 14
  mk({ id: "c", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-15 09:30:00", exitAt: "2026-01-15 09:40:00" }), // 11:30 BRT
]

test("fuso muda dia, hora e dia da semana — o fuso fica ecoado no resultado", () => {
  const ny = aggregateTrades(tzSet(), { groupBy: "day" }) // padrão America/New_York
  const br = aggregateTrades(tzSet(), { groupBy: "day", timeZone: BRT })
  assert.deepEqual(ny.groups.map((g) => [g.key[0], g.sampleSize]), [["2026-01-14", 2], ["2026-01-15", 1]])
  assert.deepEqual(br.groups.map((g) => [g.key[0], g.sampleSize]), [["2026-01-14", 1], ["2026-01-15", 2]]) // 'a' virou o dia 15 em BRT
  assert.equal(ny.query.options.timeZone, "America/New_York")
  assert.equal(br.query.options.timeZone, BRT)
  assert.deepEqual(aggregateTrades(tzSet(), { groupBy: "hour" }).groups.map((g) => g.key[0]), ["09", "20", "23"])
  assert.deepEqual(aggregateTrades(tzSet(), { groupBy: "hour", timeZone: BRT }).groups.map((g) => g.key[0]), ["01", "11", "22"])
  assert.deepEqual(aggregateTrades(tzSet(), { groupBy: "dayOfWeek" }).groups.map((g) => [g.label, g.sampleSize]), [["Qua", 2], ["Qui", 1]])
  assert.deepEqual(aggregateTrades(tzSet(), { groupBy: "dayOfWeek", timeZone: BRT }).groups.map((g) => [g.label, g.sampleSize]), [["Qua", 1], ["Qui", 2]])
})

test("overnight: sessão e dia de PREGÃO não dependem do fuso de exibição", () => {
  for (const tz of ["America/New_York", BRT, "UTC"]) {
    const s = aggregateTrades(tzSet(), { groupBy: "session", timeZone: tz })
    assert.deepEqual(s.groups.map((g) => [g.key[0], g.sampleSize]), [["AM", 1], ["OVERNIGHT", 2]], tz)
    const d = aggregateTrades(tzSet(), { groupBy: "tradingDay", timeZone: tz })
    assert.deepEqual(d.groups.map((g) => [g.key[0], g.sampleSize]), [["2026-01-15", 3]], tz) // os 3 caem no pregão de 15/01
  }
})

test("trade que atravessa a meia-noite: âncora ENTRADA × SAÍDA muda o dia", () => {
  const cross = [mk({ id: "x", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-14 23:50:00", exitAt: "2026-01-15 00:10:00" })]
  assert.equal(aggregateTrades(cross, { groupBy: "day" }).groups[0].key[0], "2026-01-14")
  assert.equal(aggregateTrades(cross, { groupBy: "day", timeAnchor: "EXIT" }).groups[0].key[0], "2026-01-15")
  assert.equal(aggregateTrades(cross, { groupBy: "hour", timeAnchor: "EXIT" }).groups[0].key[0], "00")
  // dia de pregão é o mesmo para entrada e saída
  assert.equal(aggregateTrades(cross, { groupBy: "tradingDay" }).groups[0].key[0], aggregateTrades(cross, { groupBy: "tradingDay", timeAnchor: "EXIT" }).groups[0].key[0])
})

test("horário de verão: 09:35 ET é hora 9 em NY o ano todo, mas muda de hora em BRT entre inverno e verão dos EUA", () => {
  const dst = [
    mk({ id: "inv", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-03-06 09:35:00", exitAt: "2026-03-06 09:50:00" }), // EST
    mk({ id: "ver", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-03-09 09:35:00", exitAt: "2026-03-09 09:50:00" }), // EDT
  ]
  assert.deepEqual(aggregateTrades(dst, { groupBy: "hour" }).groups.map((g) => [g.key[0], g.sampleSize]), [["09", 2]])
  assert.deepEqual(aggregateTrades(dst, { groupBy: "hour", timeZone: BRT }).groups.map((g) => [g.key[0], g.sampleSize]), [["10", 1], ["11", 1]])
})

test("DATE_ONLY: agrupa por dia/dia da semana (têm data); hora/sessão/dia de pregão caem em 'sem horário'", () => {
  const d = [
    mk({ id: "d1", direction: "LONG", entry: 100, exit: 110, dateOnly: "2026-01-12" }),
    mk({ id: "d2", direction: "LONG", entry: 100, exit: 105, dateOnly: "2026-01-13" }),
    mk({ id: "t", direction: "LONG", entry: 100, exit: 110, entryAt: "2026-01-12 09:35:00", exitAt: "2026-01-12 09:50:00" }),
  ]
  assert.deepEqual(aggregateTrades(d, { groupBy: "day" }).groups.map((g) => [g.key[0], g.sampleSize]), [["2026-01-12", 2], ["2026-01-13", 1]])
  assert.deepEqual(aggregateTrades(d, { groupBy: "dayOfWeek" }).groups.map((g) => [g.label, g.sampleSize]), [["Seg", 2], ["Ter", 1]])
  const h = aggregateTrades(d, { groupBy: "hour" })
  assert.deepEqual(h.groups.map((g) => [g.key[0], g.label, g.sampleSize]), [["09", "09:00", 1], [null, "(sem horário)", 2]])
  assert.ok(h.warnings.some((w) => w.code === "W_GROUP_UNKNOWN_BUCKET"))
  assert.ok(h.total.warnings.some((w) => w.code === "W_DATE_ONLY_TRADES"))
  // filtro de hora EXCLUI os sem hora e conta como desconhecido
  const f = filterTrades(d, { hour: 9 })
  assert.deepEqual([f.trades.length, f.report.excluded.hour], [1, { mismatch: 0, unknown: 2 }])
})

console.log(`\n${passed} testes ok`)
