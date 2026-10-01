// Testes de Order ≠ Fill ≠ Trade (agregação flat→flat): node scripts/test-ingest-executions.mts
// Usa FATOS CANÔNICOS sintéticos — nenhum formato de arquivo (o parser real do Tradovate depende de um export real).
import assert from "node:assert/strict"
import { SCHEMA_EXECUTION, type CanonicalExecution, type CanonicalOrder, type SourceMetadata } from "../src/lib/domain/canonical.ts"
import { parseLocalDateTime, tradingDay, type TimeValue } from "../src/lib/domain/time.ts"
import { aggregateExecutions, orderToExecution } from "../src/lib/ingest/executions.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const BRT = "America/Sao_Paulo"
const CT = "America/Chicago"

const SRC: SourceMetadata = {
  platform: "OTHER",
  parserId: "synthetic",
  parserVersion: "0",
  fileName: null,
  fileHash: null,
  rowNo: null,
  externalId: null,
  settings: { sourceTz: BRT, dateOrder: null, numberLocale: "US", excursionUnit: null, declaredPnlBasis: "UNKNOWN" },
}

const T = (s: string, tz = BRT): TimeValue => {
  const r = parseLocalDateTime(s, { tz })
  assert.equal(r.ok, true)
  return (r as { ok: true; value: TimeValue }).value
}

let seq = 0
function ex(
  side: "BUY" | "SELL",
  quantity: number,
  price: number,
  at: string,
  o: { root?: string; raw?: string; account?: string | null; commission?: number | null; fees?: number | null; tz?: string; gran?: "FILL" | "ORDER_AVERAGE" } = {},
): CanonicalExecution {
  seq += 1
  const raw = o.raw ?? "MNQ 03-26"
  const root = o.root ?? raw.split(" ")[0]
  return {
    schemaVersion: SCHEMA_EXECUTION,
    granularity: o.gran ?? "FILL",
    account: o.account === undefined ? "Sim101" : o.account,
    instrument: { raw, root, contract: { monthCode: "H", month: 3, yearDigits: "26" } },
    side,
    quantity,
    price,
    at: T(at, o.tz),
    commission: o.commission === undefined ? 0 : o.commission,
    fees: o.fees === undefined ? 0 : o.fees,
    orderId: `O${seq}`,
    fillId: `F${seq}`,
    source: SRC,
  }
}

test("round-turn simples: bruto pelos preços (DERIVED_FROM_FILLS), custos somados, líquido COMPLETE, horas preservadas", () => {
  const r = aggregateExecutions([
    ex("BUY", 2, 21450, "2026-01-15 09:42:10", { commission: 1.2, fees: 0.2 }),
    ex("SELL", 2, 21470, "2026-01-15 09:55:30", { commission: 1.2, fees: 0.2 }),
  ])
  assert.equal(r.trades.length, 1)
  assert.equal(r.open.length, 0)
  const t = r.trades[0].trade
  assert.deepEqual([t.direction, t.quantity, t.entry.price, t.exit.price], ["LONG", 2, 21450, 21470])
  assert.equal(t.entry.at.instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(t.exit.at.instantUtc, "2026-01-15T12:55:30.000Z")
  assert.deepEqual(
    [t.pnl.reported, t.pnl.basis, t.pnl.basisSource, t.pnl.gross, t.pnl.commission, t.pnl.fees, t.pnl.net, t.pnl.netStatus],
    [null, "GROSS", "DERIVED_FROM_FILLS", 80, 2.4, 0.4, 77.2, "COMPLETE"],
  )
  assert.equal(t.dataQuality, "COMPLETE")
  assert.deepEqual(r.trades[0].legs.map((l) => l.role), ["ENTRY", "EXIT"])
})

test("scale-in: 1@100 + 1@102, sai 2@105 → entrada média 101, qty 2, pico 2; um único trade com 3 fills", () => {
  const r = aggregateExecutions([
    ex("BUY", 1, 100, "2026-01-15 10:00:00", { raw: "NQ 03-26" }),
    ex("BUY", 1, 102, "2026-01-15 10:01:00", { raw: "NQ 03-26" }),
    ex("SELL", 2, 105, "2026-01-15 10:10:00", { raw: "NQ 03-26" }),
  ])
  assert.equal(r.trades.length, 1)
  const a = r.trades[0]
  assert.deepEqual([a.trade.entry.price, a.trade.exit.price, a.trade.quantity, a.peakQuantity], [101, 105, 2, 2])
  assert.equal(a.trade.pnl.gross, 160) // (105−101) × $20 × 2
  assert.deepEqual(a.legs.map((l) => l.role), ["ENTRY", "SCALE_IN", "EXIT"])
})

test("saídas parciais: 3@100, sai 1@102 e 2@101 → saída média ponderada, qty 3, papéis SCALE_OUT/EXIT", () => {
  const r = aggregateExecutions([
    ex("BUY", 3, 100, "2026-01-15 10:00:00", { raw: "NQ 03-26" }),
    ex("SELL", 1, 102, "2026-01-15 10:05:00", { raw: "NQ 03-26" }),
    ex("SELL", 2, 101, "2026-01-15 10:08:00", { raw: "NQ 03-26" }),
  ])
  const a = r.trades[0]
  assert.equal(r.trades.length, 1)
  assert.equal(a.trade.quantity, 3)
  assert.ok(Math.abs(a.trade.exit.price - (102 + 202) / 3) < 1e-9)
  assert.equal(a.trade.pnl.gross, 80)
  assert.deepEqual(a.legs.map((l) => l.role), ["ENTRY", "SCALE_OUT", "EXIT"])
  assert.equal(a.trade.exit.at.instantUtc, "2026-01-15T13:08:00.000Z") // saída = ÚLTIMO fill de saída
})

test("flip: comprado 1, vende 3 → fecha o long (1) e ABRE short (2); comissão do fill dividida proporcionalmente", () => {
  const r = aggregateExecutions([
    ex("BUY", 1, 100, "2026-01-15 10:00:00", { raw: "NQ 03-26", commission: 1 }),
    ex("SELL", 3, 105, "2026-01-15 10:10:00", { raw: "NQ 03-26", commission: 3 }),
    ex("BUY", 2, 103, "2026-01-15 10:20:00", { raw: "NQ 03-26", commission: 1 }),
  ])
  assert.equal(r.trades.length, 2)
  const [t1, t2] = r.trades.map((x) => x.trade)
  assert.deepEqual([t1.direction, t1.quantity, t1.pointsPerContract, t1.pnl.commission], ["LONG", 1, 5, 2]) // 1 + (3×1/3)
  assert.deepEqual([t2.direction, t2.quantity, t2.pointsPerContract, t2.pnl.commission], ["SHORT", 2, 2, 3]) // (3×2/3) + 1
  assert.equal(t2.entry.at.instantUtc, t1.exit.at.instantUtc) // o mesmo fill encerra um e abre o outro
  assert.equal(t2.entry.price, 105)
})

test("entrada fora de ordem: os fills são ordenados por horário antes de agregar", () => {
  const r = aggregateExecutions([
    ex("SELL", 1, 21510, "2026-01-15 10:30:00", { raw: "NQ 03-26" }),
    ex("BUY", 1, 21500, "2026-01-15 10:00:00", { raw: "NQ 03-26" }),
  ])
  assert.equal(r.trades.length, 1)
  assert.equal(r.trades[0].trade.direction, "LONG")
})

test("contas e contratos diferentes NÃO se compensam entre si", () => {
  const r = aggregateExecutions([
    ex("BUY", 1, 100, "2026-01-15 10:00:00", { raw: "NQ 03-26", account: "A" }),
    ex("SELL", 1, 100, "2026-01-15 10:05:00", { raw: "NQ 03-26", account: "B" }),
    ex("BUY", 1, 50, "2026-01-15 10:06:00", { raw: "MNQ 03-26", account: "A" }),
  ])
  assert.equal(r.trades.length, 0)
  assert.equal(r.open.length, 3)
})

test("posição ainda aberta no fim → NÃO vira trade; volta em `open` com INFO", () => {
  const r = aggregateExecutions([ex("BUY", 2, 21450, "2026-01-15 10:00:00")])
  assert.equal(r.trades.length, 0)
  assert.deepEqual(r.open.map((o) => o.netQuantity), [2])
  assert.ok(r.issues.some((i) => i.code === "I_POSITION_OPEN"))
})

test("um fill sem comissão → comissão e líquido do trade NULL (não chama bruto de líquido)", () => {
  const r = aggregateExecutions([
    ex("BUY", 1, 21450, "2026-01-15 10:00:00", { commission: null, fees: null }),
    ex("SELL", 1, 21460, "2026-01-15 10:05:00", { commission: 0.6, fees: 0.1 }),
  ])
  const t = r.trades[0].trade
  assert.deepEqual([t.pnl.gross, t.pnl.commission, t.pnl.fees, t.pnl.net, t.pnl.netStatus], [20, null, null, null, "UNAVAILABLE"])
})

test("instrumento desconhecido → sem bruto/líquido (basis UNKNOWN), mas o trade existe", () => {
  const r = aggregateExecutions([
    ex("BUY", 1, 10, "2026-01-15 10:00:00", { raw: "XYZ 03-26", root: "XYZ" }),
    ex("SELL", 1, 11, "2026-01-15 10:05:00", { raw: "XYZ 03-26", root: "XYZ" }),
  ])
  const t = r.trades[0].trade
  assert.deepEqual([t.pnl.basis, t.pnl.gross, t.pnl.net, t.instrument.pointValue, t.dataQuality], ["UNKNOWN", null, null, null, "PARTIAL"])
})

test("sessão overnight: compra dom 18:30 CT, vende seg 09:00 CT → um trade, mesmo dia de pregão", () => {
  const r = aggregateExecutions([
    ex("BUY", 1, 21400, "2026-01-18 18:30:00", { tz: CT }),
    ex("SELL", 1, 21420, "2026-01-19 09:00:00", { tz: CT }),
  ])
  const t = r.trades[0].trade
  assert.equal(tradingDay(t.entry.at.instantUtc!), tradingDay(t.exit.at.instantUtc!))
  assert.equal(tradingDay(t.entry.at.instantUtc!), "2026-01-19")
})

test("entrada antes da meia-noite e saída depois (BRT): trade único, instantes corretos", () => {
  const r = aggregateExecutions([
    ex("SELL", 1, 21450, "2026-01-15 23:50:00"),
    ex("BUY", 1, 21440, "2026-01-16 00:10:00"),
  ])
  const t = r.trades[0].trade
  assert.equal(t.direction, "SHORT")
  assert.equal(t.entry.at.instantUtc, "2026-01-16T02:50:00.000Z")
  assert.equal(t.exit.at.instantUtc, "2026-01-16T03:10:00.000Z")
  assert.equal(t.pointsPerContract, 10)
})

test("fill sem horário completo é recusado (erro) — a ordem dos fills depende do horário", () => {
  const dateOnly: CanonicalExecution = { ...ex("BUY", 1, 100, "2026-01-15 10:00:00"), at: { ...T("2026-01-15 10:00:00"), precision: "DATE_ONLY", instantUtc: null } }
  const r = aggregateExecutions([dateOnly])
  assert.ok(r.issues.some((i) => i.code === "E_EXECUTION_TIME_REQUIRED"))
  assert.equal(r.trades.length + r.open.length, 0)
})

// ── Order → Execution ────────────────────────────────────────────────────────

const order = (o: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  schemaVersion: "canonical-order/1",
  orderId: "100",
  account: "Sim101",
  instrument: { raw: "MNQ 03-26", root: "MNQ", contract: { monthCode: "H", month: 3, yearDigits: "26" } },
  side: "BUY",
  orderType: "Market",
  status: "Filled",
  quantity: 2,
  filledQuantity: 2,
  avgFillPrice: 21450.25,
  stopPrice: null,
  limitPrice: null,
  submittedAt: null,
  filledAt: T("2026-01-15 09:42:10"),
  source: SRC,
  ...o,
})

test("Order ≠ Fill: ordem preenchida vira execução ORDER_AVERAGE (comissão desconhecida = null, não 0)", () => {
  const e = orderToExecution(order())!
  assert.deepEqual([e.granularity, e.quantity, e.price, e.commission, e.fees, e.orderId, e.fillId], ["ORDER_AVERAGE", 2, 21450.25, null, null, "100", null])
})

test("Order: cancelada/sem preenchimento/sem preço/sem hora → nenhuma execução; parcial usa a qtd preenchida", () => {
  assert.equal(orderToExecution(order({ status: "Canceled", filledQuantity: 0, avgFillPrice: null })), null)
  assert.equal(orderToExecution(order({ avgFillPrice: null })), null)
  assert.equal(orderToExecution(order({ filledAt: null })), null)
  assert.equal(orderToExecution(order({ quantity: 5, filledQuantity: 3 }))!.quantity, 3)
})

test("trade montado de ordens (preço médio) avisa a granularidade e não afirma comissão", () => {
  const buy = orderToExecution(order())!
  const sell = orderToExecution(order({ orderId: "101", side: "SELL", avgFillPrice: 21470.25, filledAt: T("2026-01-15 09:55:30") }))!
  const r = aggregateExecutions([buy, sell])
  const t = r.trades[0].trade
  assert.equal(t.pnl.gross, 80)
  assert.equal(t.pnl.net, null)
  assert.ok(t.issues.some((i) => i.code === "I_ORDER_AVERAGE_FILLS"))
  assert.ok(t.issues.some((i) => i.code === "W_COMMISSION_MISSING"))
})

console.log(`\n${passed} testes ok`)
