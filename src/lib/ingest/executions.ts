// Order ≠ Fill ≠ Trade  (versão 0, deliberadamente simples).
//
//   Orders ┐
//          ├─► Execution Facts (CanonicalExecution) ─► agregação flat→flat ─► CanonicalTrade (+ legs = os fills)
//   Fills  ┘
//
// Trabalha SÓ com fatos canônicos — não conhece nenhum formato de arquivo. O parser real do Tradovate (Orders/Fills)
// será escrito a partir de um export real e vai ALIMENTAR este agregador; até lá ele é testado com fatos sintéticos.
//
// Regras desta versão:
//   - agrupa por conta + contrato; ordena por instante UTC (empate = ordem de chegada);
//   - "trade" = ciclo posição 0 → posição 0 (scale-in/out e saídas parciais ficam DENTRO do mesmo trade);
//   - fill que atravessa o zero (flip) é DIVIDIDO: a parte que fecha termina o trade, o resto abre o próximo;
//   - preço de entrada/saída = média ponderada por quantidade; quantidade do trade = total fechado (igual ao NT8);
//   - comissão/taxas somadas; qualquer fill sem comissão → comissão do trade NULL (não afirmamos o que não sabemos);
//   - bruto = pelos preços dos fills (origem DERIVED_FROM_FILLS); sem pointValue → sem bruto;
//   - o que sobra aberto no fim NÃO vira trade: volta em `open`.

import { SCHEMA_EXECUTION, SCHEMA_TRADE, issue, type CanonicalExecution, type CanonicalOrder, type CanonicalTrade, type Issue, type SourceMetadata } from "../domain/canonical.ts"
import { round2 } from "../domain/pnl.ts"
import type { TimeValue } from "../domain/time.ts"
import { buildCanonicalTrade } from "./build-trade.ts"
import { validateTrade } from "./validator.ts"

// ── Order → Execution ────────────────────────────────────────────────────────

/**
 * Uma ORDEM preenchida vira um fato de execução com granularity ORDER_AVERAGE (preço médio da ordem; não é um fill
 * individual — fica explícito). Ordem cancelada/sem preenchimento ou sem preço/horário → null.
 */
export function orderToExecution(o: CanonicalOrder): CanonicalExecution | null {
  if (o.filledQuantity <= 0 || o.avgFillPrice === null || !o.filledAt || o.filledAt.precision !== "DATETIME") return null
  return {
    schemaVersion: SCHEMA_EXECUTION,
    granularity: "ORDER_AVERAGE",
    account: o.account,
    instrument: o.instrument,
    side: o.side,
    quantity: o.filledQuantity,
    price: o.avgFillPrice,
    at: o.filledAt,
    commission: null, // relatório de ordens não traz comissão por ordem: desconhecido, não zero
    fees: null,
    orderId: o.orderId,
    fillId: null,
    source: o.source,
  }
}

// ── Agregação ────────────────────────────────────────────────────────────────

export type LegRole = "ENTRY" | "SCALE_IN" | "SCALE_OUT" | "EXIT"

export interface TradeLeg {
  role: LegRole
  quantity: number
  price: number
  at: TimeValue
  orderId: string | null
  fillId: string | null
  /** Parte da comissão/taxas deste fill atribuída a este trade (proporcional se o fill foi dividido num flip). */
  commission: number | null
  fees: number | null
  granularity: CanonicalExecution["granularity"]
  rowNo: number | null
}

export interface AggregatedTrade {
  trade: CanonicalTrade
  legs: TradeLeg[]
  /** Maior posição aberta durante o trade (informativo; `trade.quantity` = total fechado). */
  peakQuantity: number
}

export interface OpenPosition {
  account: string | null
  instrumentRaw: string
  netQuantity: number
}

export interface AggregationResult {
  trades: AggregatedTrade[]
  open: OpenPosition[]
  issues: Issue[]
}

interface Cycle {
  sign: 1 | -1
  net: number
  peak: number
  legs: TradeLeg[]
  firstExecution: CanonicalExecution
}

const keyOf = (e: CanonicalExecution) => {
  const c = e.instrument.contract
  const contract = c ? `${c.monthCode}${c.yearDigits}` : ""
  return `${e.account ?? ""}|${e.instrument.root ?? e.instrument.raw.toUpperCase()}|${contract}`
}

const share = (v: number | null, part: number, whole: number): number | null => (v === null ? null : round2((v * part) / whole))
const sumOrNull = (xs: Array<number | null>): number | null => (xs.length === 0 || xs.some((x) => x === null) ? null : round2(xs.reduce<number>((a, b) => a + (b as number), 0)))
const wavg = (legs: TradeLeg[]): number => legs.reduce((a, l) => a + l.price * l.quantity, 0) / legs.reduce((a, l) => a + l.quantity, 0)

export function aggregateExecutions(facts: CanonicalExecution[]): AggregationResult {
  const issues: Issue[] = []
  const usable: Array<{ e: CanonicalExecution; idx: number; ms: number }> = []
  facts.forEach((e, idx) => {
    if (e.at.precision !== "DATETIME" || !e.at.instantUtc) {
      issues.push(issue("ERROR", "E_EXECUTION_TIME_REQUIRED", "Execução sem data/hora completa não entra na agregação (a ordem dos fills depende do horário).", { rowNo: e.source.rowNo ?? undefined }))
      return
    }
    usable.push({ e, idx, ms: Date.parse(e.at.instantUtc) })
  })
  usable.sort((a, b) => a.ms - b.ms || a.idx - b.idx)

  const groups = new Map<string, typeof usable>()
  for (const u of usable) {
    const k = keyOf(u.e)
    const g = groups.get(k)
    if (g) g.push(u)
    else groups.set(k, [u])
  }

  const trades: AggregatedTrade[] = []
  const open: OpenPosition[] = []

  const headSeen = new Set<string>()
  const emit = (cycle: Cycle, groupKey: string) => {
    const entries = cycle.legs.filter((l) => l.role === "ENTRY" || l.role === "SCALE_IN")
    const exits = cycle.legs.filter((l) => l.role === "EXIT" || l.role === "SCALE_OUT")
    const first = cycle.firstExecution
    const lastExit = exits[exits.length - 1]
    const qty = exits.reduce((a, l) => a + l.quantity, 0)
    const source: SourceMetadata = { ...first.source, rowNo: null, externalId: null }
    const built = buildCanonicalTrade({
      source,
      accountName: first.account,
      instrumentRaw: first.instrument.raw,
      direction: cycle.sign === 1 ? "LONG" : "SHORT",
      quantity: qty,
      entry: { at: entries[0].at, price: wavg(entries) },
      exit: { at: lastExit.at, price: wavg(exits) },
      reportedPnl: null,
      declaredPnlBasis: "UNKNOWN",
      grossFromFills: true,
      commission: sumOrNull(cycle.legs.map((l) => l.commission)),
      fees: sumOrNull(cycle.legs.map((l) => l.fees)),
      mfeRaw: null,
      maeRaw: null,
      excursionUnit: null,
      strategyName: null,
      notes: null,
      sessionHint: null,
    })
    const v = validateTrade(built)
    const extra: Issue[] = []
    if (cycle.legs.some((l) => l.granularity === "ORDER_AVERAGE")) {
      extra.push(issue("INFO", "I_ORDER_AVERAGE_FILLS", "Trade montado com preços MÉDIOS por ordem (não fills individuais)."))
    }

    // canonical-trade/2: o MESMO formato de pernas do reconstrutor NT8 (aqui a unidade factual é FILL ou ORDER_AVERAGE)
    const entryLegs = entries.map((l) => ({
      at: l.at, price: l.price, quantity: l.quantity, sourceLabel: null as string | null,
      rowRefs: l.rowNo === null ? [] : [l.rowNo], granularity: l.granularity, role: l.role === "ENTRY" ? ("ENTRY" as const) : ("SCALE_IN" as const),
    }))
    const exitMs = exits.map((l) => Date.parse(l.at.instantUtc as string))
    let running = 0
    const sizeAfterOf = new Map<TradeLeg, number>()
    for (const l of cycle.legs) {
      running += l.role === "ENTRY" || l.role === "SCALE_IN" ? l.quantity : -l.quantity
      sizeAfterOf.set(l, Math.max(0, Math.round(running * 1e6) / 1e6))
    }
    const exitLegs = exits.map((l, i) => ({
      at: l.at, price: l.price, quantity: l.quantity, sourceLabel: null as string | null,
      rowRefs: l.rowNo === null ? [] : [l.rowNo], granularity: l.granularity,
      role: (sizeAfterOf.get(l) as number) > 0 ? ("SCALE_OUT" as const) : ("EXIT" as const),
      sizeAfter: sizeAfterOf.get(l) as number,
      simultaneous: exitMs.filter((x) => x === exitMs[i]).length > 1,
      reason: "UNKNOWN" as const, reasonRule: "NONE" as const,
      pnl: { net: null, gross: null, commission: l.commission, fees: l.fees },
    }))
    const c = first.instrument.contract
    const contractStr = `${first.instrument.root ?? first.instrument.raw.toUpperCase()}${c ? ` ${c.monthCode}${c.yearDigits}` : ""}`
    const isHead = !headSeen.has(groupKey)
    headSeen.add(groupKey)
    const v2: CanonicalTrade = {
      ...built,
      schemaVersion: SCHEMA_TRADE,
      dataQuality: v.dataQuality,
      issues: [...v.issues, ...extra],
      granularity: "POSITION_CYCLE",
      peakQuantity: cycle.peak,
      entryLegs,
      exitLegs,
      exitSummary: { finalReason: "UNKNOWN", finalReasons: ["UNKNOWN"], byReason: { UNKNOWN: qty }, mixed: false },
      sourceRows: [],
      reconstruction: {
        method: "FILLS_FLAT_TO_FLAT",
        scope: "ACCOUNT_POSITION", // fills são da conta+contrato (sem estratégia)
        cycleKey: { account: first.account, contract: contractStr, strategy: null, direction: cycle.sign === 1 ? "LONG" : "SHORT" },
        confidence: "HIGH",
        ambiguities: [],
        // com fills, o zero é OBSERVADO dos dois lados — exceto a cabeça do primeiro ciclo (pode ter começado antes dos dados)
        completeness: isHead ? "UNVERIFIED_HEAD" : "VERIFIED",
        boundary: { prev: "NONE", next: "NONE" },
        integrity: "UNAVAILABLE",
      },
    }
    trades.push({ trade: v2, legs: cycle.legs, peakQuantity: cycle.peak })
  }

  for (const g of groups.values()) {
    let cur: Cycle | null = null

    for (const { e } of g) {
      const sign: 1 | -1 = e.side === "BUY" ? 1 : -1
      const mkLeg = (role: LegRole, quantity: number): TradeLeg => ({
        role,
        quantity,
        price: e.price,
        at: e.at,
        orderId: e.orderId,
        fillId: e.fillId,
        commission: share(e.commission, quantity, e.quantity),
        fees: share(e.fees, quantity, e.quantity),
        granularity: e.granularity,
        rowNo: e.source.rowNo,
      })

      if (!cur) {
        cur = { sign, net: sign * e.quantity, peak: e.quantity, legs: [mkLeg("ENTRY", e.quantity)], firstExecution: e }
        continue
      }
      if (sign === cur.sign) {
        cur.legs.push(mkLeg("SCALE_IN", e.quantity))
        cur.net += sign * e.quantity
        cur.peak = Math.max(cur.peak, Math.abs(cur.net))
        continue
      }
      // lado oposto: fecha (parte d)o ciclo
      const closing = Math.min(e.quantity, Math.abs(cur.net))
      const remainder = e.quantity - closing
      cur.net += sign * closing
      const flat = cur.net === 0
      cur.legs.push(mkLeg(flat ? "EXIT" : "SCALE_OUT", closing))
      if (flat) {
        emit(cur, g.length ? keyOf(g[0].e) : "")
        cur = null
        if (remainder > 0) {
          // flip: o resto do fill abre o trade seguinte (comissão proporcional)
          const leg: TradeLeg = { ...mkLeg("ENTRY", remainder), commission: share(e.commission, remainder, e.quantity), fees: share(e.fees, remainder, e.quantity) }
          cur = { sign, net: sign * remainder, peak: remainder, legs: [leg], firstExecution: e }
        }
      }
    }

    if (cur) {
      const f = cur.firstExecution
      open.push({ account: f.account, instrumentRaw: f.instrument.raw, netQuantity: cur.net })
      issues.push(issue("INFO", "I_POSITION_OPEN", `Posição ainda aberta (${cur.net}) em ${f.instrument.raw}${f.account ? ` / ${f.account}` : ""}: não vira trade até ser fechada.`))
    }
  }

  trades.sort((a, b) => Date.parse(a.trade.entry.at.instantUtc!) - Date.parse(b.trade.entry.at.instantUtc!))
  return { trades, open, issues }
}
