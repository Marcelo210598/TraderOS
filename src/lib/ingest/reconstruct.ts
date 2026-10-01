// Reconstrução de CICLOS DE POSIÇÃO (0 → posição aberta → saídas parciais → 0) a partir de linhas de lotes casados do NT8.
// Especificação aprovada: docs/ai-partner/nt8-position-reconstruction-spec.md.
//
//   linha do NT8 = par casado "lote de entrada ↔ lote de saída"  (NÃO é um trade analítico)
//   trade analítico = ciclo da POSIÇÃO DA ESTRATÉGIA
//   chave = conta + contrato COMPLETO (com vencimento) + estratégia + direção
//
// Regra (teste de continuidade de posição, não coincidência de campos):
//   - intervalos [entrada, saída] da mesma chave que se SOBREPÕEM estritamente  ⇒ mesmo ciclo (posição > 0 contínua);
//   - lacuna estrita                                                            ⇒ ciclos diferentes (posição = 0);
//   - saída e nova entrada NO MESMO SEGUNDO                                     ⇒ ciclos SEPARADOS + SAME_SECOND_BOUNDARY (confiança baixa).
// Nada é descartado: ambiguidades e linhas de origem ficam registradas; ciclos de baixa confiança ou com borda não verificada
// ENTRAM nas métricas, sinalizados.

import {
  SCHEMA_TRADE,
  type CanonicalTrade,
  type ExitReason,
} from "../domain/canonical.ts"
import { sumMoney } from "../domain/pnl.ts"
import { buildCanonicalTrade } from "./build-trade.ts"
import { classifyExitLabel, type ExitReasonRule } from "./exit-reason.ts"
import type { RowMeta } from "./types.ts"
import { validateTrade } from "./validator.ts"

export interface LotRow {
  rowNo: number
  /** A linha como trade canônico (granularity SOURCE_ROW), já normalizada e validada. */
  trade: CanonicalTrade
  meta: RowMeta
}

type Ambiguity = NonNullable<NonNullable<CanonicalTrade["reconstruction"]>["ambiguities"]>[number]
type Boundary = "NONE" | "REVERSAL_CANDIDATE" | "AMBIGUOUS_TOUCH"
type Integrity = "CONSISTENT" | "BROKEN" | "UNAVAILABLE"

export interface ReconstructOptions {
  exitReasonMap?: ExitReasonRule[]
  integrity?: Integrity
  /** Linhas em que o acumulado do relatório deixou de bater (evidência). */
  brokenRowNos?: number[]
  /** Linhas do arquivo que foram REJEITADAS antes da reconstrução: podem pertencer a algum ciclo ⇒ todos ficam de confiança baixa. */
  rejectedRowNos?: number[]
}

export interface ReconstructResult {
  /** Ciclos reconstruídos (granularity POSITION_CYCLE). */
  cycles: CanonicalTrade[]
  /** Linhas sem horário completo: seguem como trade-linha (SOURCE_ROW) — não somem. */
  passthrough: CanonicalTrade[]
}

// ── utilitários ──────────────────────────────────────────────────────────────

const r6 = (x: number) => Math.round(x * 1e6) / 1e6
const sumQty = (xs: number[]) => r6(xs.reduce((a, b) => a + b, 0))
const uniqSorted = <T extends string | number>(xs: T[]): T[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

interface Item {
  row: LotRow
  entryMs: number
  exitMs: number
}

interface Key {
  account: string | null
  contract: string
  strategy: string | null
  direction: "LONG" | "SHORT"
}

const contractOf = (t: CanonicalTrade): string => {
  const root = t.instrument.root ?? t.instrument.raw.trim().toUpperCase()
  const c = t.instrument.contract
  return c ? `${root} ${c.monthCode}${c.yearDigits}` : root
}
const keyOf = (t: CanonicalTrade): Key => ({
  account: t.account.sourceName,
  contract: contractOf(t),
  strategy: t.labels.strategyName,
  direction: t.direction,
})
const keyStr = (k: Key) => [k.account ?? "", k.contract, k.strategy ?? "", k.direction].join("\u0001")
const acctContract = (k: Key) => `${k.account ?? ""}\u0001${k.contract}`

interface Cycle {
  key: Key
  items: Item[]
  firstEntryMs: number
  lastExitMs: number
  ambiguities: Ambiguity[]
  boundaryPrev: Boundary
  boundaryNext: Boundary
  completeness: "VERIFIED" | "UNVERIFIED_HEAD" | "UNVERIFIED_TAIL" | "UNVERIFIED_BOTH"
}

/** Sobreposições entre chaves: UMA ambiguidade por código no ciclo, com a evidência (linhas) de TODAS as outras posições envolvidas. */
function addMerged(c: { ambiguities: Ambiguity[] }, amb: Ambiguity) {
  const same = c.ambiguities.find((a) => a.code === amb.code)
  if (same) same.rowNos = uniqSorted([...same.rowNos, ...amb.rowNos])
  else c.ambiguities.push(amb)
}

const rowNosOf = (items: Item[], pred: (i: Item) => boolean) => uniqSorted(items.filter(pred).map((i) => i.row.rowNo))

// ── integridade do relatório (NUNCA fonte de P&L) ────────────────────────────

/**
 * O NT8 traz "Acu lucro líquido" (acumulado do relatório). Se `Acu_i − Acu_{i−1} = Profit_i` em toda linha consecutiva, o relatório
 * está íntegro; falha indica linha faltando/filtrada. É só um SINAL de completude.
 */
export function checkAccumulatedIntegrity(rows: LotRow[]): { status: Integrity; brokenRowNos: number[] } {
  const ordered = [...rows].sort((a, b) => a.rowNo - b.rowNo)
  if (ordered.length < 2 || ordered.some((r) => r.meta.cumulativeNetReported === null || r.meta.reportedProfit === null)) {
    return { status: "UNAVAILABLE", brokenRowNos: [] }
  }
  const cents = (x: number) => Math.round(x * 100)
  const broken: number[] = []
  for (let i = 1; i < ordered.length; i++) {
    const diff = cents(ordered[i].meta.cumulativeNetReported as number) - cents(ordered[i - 1].meta.cumulativeNetReported as number)
    if (diff !== cents(ordered[i].meta.reportedProfit as number)) broken.push(ordered[i].rowNo)
  }
  return { status: broken.length ? "BROKEN" : "CONSISTENT", brokenRowNos: broken }
}

// ── reconstrução ─────────────────────────────────────────────────────────────

export function reconstructCycles(rows: LotRow[], opts: ReconstructOptions = {}): ReconstructResult {
  const passthrough: CanonicalTrade[] = []
  const usable: Item[] = []
  for (const row of rows) {
    const t = row.trade
    const e = t.entry.at.instantUtc
    const x = t.exit.at.instantUtc
    if (t.entry.at.precision !== "DATETIME" || t.exit.at.precision !== "DATETIME" || !e || !x) {
      passthrough.push(t)
      continue
    }
    usable.push({ row, entryMs: Date.parse(e), exitMs: Date.parse(x) })
  }

  // 1) particiona por chave e varre os intervalos
  const byKey = new Map<string, Item[]>()
  for (const it of usable) {
    const k = keyStr(keyOf(it.row.trade))
    const g = byKey.get(k)
    if (g) g.push(it)
    else byKey.set(k, [it])
  }

  const cycles: Cycle[] = []
  for (const items of byKey.values()) {
    items.sort((a, b) => a.entryMs - b.entryMs || a.exitMs - b.exitMs || a.row.rowNo - b.row.rowNo)
    const perKey: Cycle[] = []
    let cur: Cycle | null = null
    let end = -Infinity
    for (const it of items) {
      if (cur && it.entryMs < end) {
        // sobreposição ESTRITA: a posição esteve aberta de forma contínua
        cur.items.push(it)
        cur.lastExitMs = Math.max(cur.lastExitMs, it.exitMs)
        end = Math.max(end, it.exitMs)
        continue
      }
      const next: Cycle = {
        key: keyOf(it.row.trade),
        items: [it],
        firstEntryMs: it.entryMs,
        lastExitMs: it.exitMs,
        ambiguities: [],
        boundaryPrev: "NONE",
        boundaryNext: "NONE",
        completeness: "VERIFIED",
      }
      if (cur && it.entryMs === end) {
        // mesmo segundo: NÃO agrupar automaticamente; separar e preservar a evidência
        cur.boundaryNext = "AMBIGUOUS_TOUCH"
        next.boundaryPrev = "AMBIGUOUS_TOUCH"
        const t = end
        const prevRows = rowNosOf(cur.items, (i) => i.exitMs === t)
        // rowNos do lado novo são calculados quando o ciclo estiver completo (ver abaixo)
        cur.ambiguities.push({
          code: "SAME_SECOND_BOUNDARY",
          severity: "LOW_CONFIDENCE",
          rowNos: prevRows,
          message: "A saída deste ciclo e a entrada do ciclo seguinte ocorrem no MESMO segundo: não dá para saber a ordem (sair e reentrar × entrar e sair). Ciclos separados por segurança.",
        })
        next.ambiguities.push({
          code: "SAME_SECOND_BOUNDARY",
          severity: "LOW_CONFIDENCE",
          rowNos: [it.row.rowNo],
          message: "A entrada deste ciclo ocorre no MESMO segundo da saída do ciclo anterior: não dá para saber a ordem. Ciclos separados por segurança.",
        })
        ;(next as Cycle & { _touchMs?: number })._touchMs = t
      }
      if (cur) perKey.push(cur)
      cur = next
      end = it.exitMs
    }
    if (cur) perKey.push(cur)

    // completude: o 1º/último ciclo da chave podem começar antes / continuar depois do período exportado
    perKey.forEach((c, i) => {
      const head = i === 0
      const tail = i === perKey.length - 1
      c.completeness = head && tail ? "UNVERIFIED_BOTH" : head ? "UNVERIFIED_HEAD" : tail ? "UNVERIFIED_TAIL" : "VERIFIED"
      // completa a evidência do lado "novo" do toque: todas as linhas do ciclo que entram naquele segundo
      const touch = (c as Cycle & { _touchMs?: number })._touchMs
      if (touch !== undefined) {
        const amb = c.ambiguities.find((a) => a.code === "SAME_SECOND_BOUNDARY")
        if (amb) amb.rowNos = rowNosOf(c.items, (i) => i.entryMs === touch)
      }
    })
    cycles.push(...perKey)
  }

  // 2) relações entre chaves da mesma conta+contrato: reversão candidata e sobreposição entre estratégias
  const byAcct = new Map<string, Cycle[]>()
  for (const c of cycles) {
    const k = acctContract(c.key)
    const g = byAcct.get(k)
    if (g) g.push(c)
    else byAcct.set(k, [c])
  }
  for (const group of byAcct.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (keyStr(a.key) === keyStr(b.key)) continue
        const [first, second] = a.firstEntryMs <= b.firstEntryMs ? [a, b] : [b, a]
        if (a.key.direction !== b.key.direction && first.lastExitMs === second.firstEntryMs) {
          const t = second.firstEntryMs
          const rn = [...rowNosOf(first.items, (it) => it.exitMs === t), ...rowNosOf(second.items, (it) => it.entryMs === t)]
          const diffStrategy = first.key.strategy !== second.key.strategy
          const msg = `Direção oposta com saída e entrada no mesmo segundo: pode ser uma REVERSÃO (execução única) ou fechar e abrir. Sempre dois ciclos${diffStrategy ? " (estratégias diferentes)" : ""}.`
          first.ambiguities.push({ code: "REVERSAL_CANDIDATE", severity: "INFO", rowNos: rn, message: msg })
          second.ambiguities.push({ code: "REVERSAL_CANDIDATE", severity: "INFO", rowNos: rn, message: msg })
          if (first.boundaryNext === "NONE") first.boundaryNext = "REVERSAL_CANDIDATE"
          if (second.boundaryPrev === "NONE") second.boundaryPrev = "REVERSAL_CANDIDATE"
          continue
        }
        if (a.firstEntryMs < b.lastExitMs && b.firstEntryMs < a.lastExitMs) {
          const sameStrategy = a.key.strategy === b.key.strategy
          const code = sameStrategy ? "OVERLAP_OPPOSITE_DIRECTION" : "CROSS_KEY_OVERLAP"
          const msg = sameStrategy
            ? "Posições de direções opostas sobrepostas na mesma estratégia, conta e contrato: impossível numa posição líquida (anomalia do relatório)."
            : "Posições de outra estratégia (ou manual) sobrepostas na mesma conta e contrato: a posição LÍQUIDA da conta não é reconstruível só com este relatório; o ciclo é da posição da estratégia."
          addMerged(a, { code, severity: "LOW_CONFIDENCE", rowNos: uniqSorted(b.items.map((x) => x.row.rowNo)), message: msg })
          addMerged(b, { code, severity: "LOW_CONFIDENCE", rowNos: uniqSorted(a.items.map((x) => x.row.rowNo)), message: msg })
        }
      }
    }
  }

  // 3) integridade do relatório: se o acumulado do NT8 não fecha, linhas podem estar faltando
  if (opts.integrity === "BROKEN") {
    for (const c of cycles) {
      c.ambiguities.push({
        code: "ACCUMULATED_MISMATCH",
        severity: "LOW_CONFIDENCE",
        rowNos: opts.brokenRowNos ?? [],
        message: "O acumulado ('Acu lucro líquido') do relatório não bate linha a linha: pode haver linhas faltando, e então os ciclos podem estar incompletos.",
      })
    }
  }

  if (opts.rejectedRowNos && opts.rejectedRowNos.length > 0) {
    for (const c of cycles) {
      c.ambiguities.push({
        code: "ROWS_REJECTED_IN_FILE",
        severity: "LOW_CONFIDENCE",
        rowNos: opts.rejectedRowNos,
        message: "Há linhas do arquivo que foram rejeitadas (erro de leitura): se pertenciam a este ciclo, ele está incompleto.",
      })
    }
  }

  cycles.sort((a, b) => a.firstEntryMs - b.firstEntryMs || (keyStr(a.key) < keyStr(b.key) ? -1 : 1))
  return { cycles: cycles.map((c) => buildCycleTrade(c, opts)), passthrough }
}

// ── montagem do trade-ciclo ──────────────────────────────────────────────────

type Pnl = CanonicalTrade["pnl"]
const BASIS_ORDER: Pnl["basisSource"][] = ["UNDETERMINED", "INFERRED_FROM_PRICES", "DERIVED_FROM_FILLS", "SOURCE_DECLARED"]

/** P&L do ciclo = SOMA dos P&L das linhas. Só afirma uma base quando TODAS as linhas concordam e todos os componentes existem. */
function aggregatePnl(rows: LotRow[]): Pnl {
  const ps = rows.map((r) => r.trade.pnl)
  const sameBasis = ps.every((p) => p.basis === ps[0].basis)
  const basis = sameBasis ? ps[0].basis : "UNKNOWN"
  const weakest = ps.reduce((w, p) => (BASIS_ORDER.indexOf(p.basisSource) < BASIS_ORDER.indexOf(w) ? p.basisSource : w), ps[0].basisSource)
  const commission = sumMoney(ps.map((p) => p.commission))
  const fees = sumMoney(ps.map((p) => p.fees))
  const known = basis !== "UNKNOWN"
  const gross = known ? sumMoney(ps.map((p) => p.gross)) : null
  const net = known ? sumMoney(ps.map((p) => p.net)) : null
  const statuses = ps.map((p) => p.netStatus)
  const netStatus: Pnl["netStatus"] =
    net === null ? "UNAVAILABLE" : statuses.every((s) => s === "COMPLETE") ? "COMPLETE" : "COMMISSION_ONLY"
  return {
    reported: known ? sumMoney(ps.map((p) => p.reported)) : null,
    basis,
    basisSource: sameBasis ? weakest : "UNDETERMINED",
    gross,
    commission,
    fees,
    net,
    netStatus,
    computedGross: sumMoney(ps.map((p) => p.computedGross)),
  }
}

function buildCycleTrade(c: Cycle, opts: ReconstructOptions): CanonicalTrade {
  const items = [...c.items].sort((a, b) => a.entryMs - b.entryMs || a.exitMs - b.exitMs || a.row.rowNo - b.row.rowNo)
  const rows = items.map((i) => i.row)
  const first = rows[0].trade
  const qty = (i: Item) => i.row.trade.quantity

  // pernas de ENTRADA (mesmo horário + preço + rótulo) e de SAÍDA (idem; rótulos diferentes NÃO se fundem)
  const entryKey = (i: Item) => `${i.entryMs}|${i.row.trade.entry.price}|${i.row.meta.entryLabel ?? ""}`
  const exitKey = (i: Item) => `${i.exitMs}|${i.row.trade.exit.price}|${i.row.meta.exitLabel ?? ""}`
  const group = (keyFn: (i: Item) => string, sortFn: (a: Item, b: Item) => number) => {
    const m = new Map<string, Item[]>()
    for (const it of [...items].sort(sortFn)) {
      const k = keyFn(it)
      const g = m.get(k)
      if (g) g.push(it)
      else m.set(k, [it])
    }
    return [...m.entries()]
  }
  const entryGroups = group(entryKey, (a, b) => a.entryMs - b.entryMs || a.row.trade.entry.price - b.row.trade.entry.price)
  const exitGroups = group(exitKey, (a, b) => a.exitMs - b.exitMs || a.row.trade.exit.price - b.row.trade.exit.price)
  const entryIdx = new Map(entryGroups.map(([k], i) => [k, i]))
  const exitIdx = new Map(exitGroups.map(([k], i) => [k, i]))

  const minEntry = Math.min(...items.map((i) => i.entryMs))
  const sizeAt = (t: number) => sumQty(items.filter((i) => i.entryMs <= t).map(qty)) - sumQty(items.filter((i) => i.exitMs <= t).map(qty))

  const entryLegs = entryGroups.map(([, g]) => ({
    at: g[0].row.trade.entry.at,
    price: g[0].row.trade.entry.price,
    quantity: sumQty(g.map(qty)),
    sourceLabel: g[0].row.meta.entryLabel,
    rowRefs: uniqSorted(g.map((i) => i.row.rowNo)),
    granularity: "MATCHED_LOT" as const,
    role: g[0].entryMs === minEntry ? ("ENTRY" as const) : ("SCALE_IN" as const),
  }))

  const exitMsList = exitGroups.map(([, g]) => g[0].exitMs)
  const exitLegs = exitGroups.map(([, g]) => {
    const t = g[0].exitMs
    const cls = classifyExitLabel(g[0].row.meta.exitLabel, opts.exitReasonMap)
    const sizeAfter = Math.max(0, r6(sizeAt(t)))
    const ps = g.map((i) => i.row.trade.pnl)
    return {
      at: g[0].row.trade.exit.at,
      price: g[0].row.trade.exit.price,
      quantity: sumQty(g.map(qty)),
      sourceLabel: g[0].row.meta.exitLabel,
      rowRefs: uniqSorted(g.map((i) => i.row.rowNo)),
      granularity: "MATCHED_LOT" as const,
      role: sizeAfter > 0 ? ("SCALE_OUT" as const) : ("EXIT" as const),
      sizeAfter,
      simultaneous: exitMsList.filter((x) => x === t).length > 1,
      reason: cls.reason,
      reasonRule: cls.rule,
      pnl: {
        net: sumMoney(ps.map((p) => p.net)),
        gross: sumMoney(ps.map((p) => p.gross)),
        commission: sumMoney(ps.map((p) => p.commission)),
        fees: sumMoney(ps.map((p) => p.fees)),
      },
    }
  })

  // pico de posição: entradas contam antes das saídas do mesmo segundo (limite superior, documentado)
  const peak = Math.max(
    ...uniqSorted(items.map((i) => i.entryMs)).map((t) => sumQty(items.filter((i) => i.entryMs <= t).map(qty)) - sumQty(items.filter((i) => i.exitMs < t).map(qty))),
  )

  // resumo de saída (DERIVADO das pernas; não existe exitReason único no trade)
  const finalLegs = exitLegs.filter((l) => l.role === "EXIT")
  const finalReasons = uniqSorted(finalLegs.map((l) => l.reason)) as ExitReason[]
  const byReason: Record<string, number> = {}
  for (const l of exitLegs) byReason[l.reason] = r6((byReason[l.reason] ?? 0) + l.quantity)
  const exitSummary = {
    finalReason: finalReasons.length === 1 ? finalReasons[0] : null,
    finalReasons,
    byReason,
    mixed: Object.keys(byReason).length > 1,
  }

  // preços médios ponderados e P&L = soma das linhas
  const totalQty = sumQty(items.map(qty))
  const avg = (f: (i: Item) => number) => r6(items.reduce((a, i) => a + f(i) * qty(i), 0) / totalQty)
  const avgEntry = avg((i) => i.row.trade.entry.price)
  const avgExit = avg((i) => i.row.trade.exit.price)
  const pnl = aggregatePnl(rows)
  const lastExitLeg = exitLegs[exitLegs.length - 1]

  // MAE/MFE: NUNCA somar. Extremos ABSOLUTOS das linhas (máx. high / mín. low), relativos à entrada média ponderada.
  const highs = rows.map((r) => r.trade.excursions.highPrice).filter((x): x is number => typeof x === "number")
  const lows = rows.map((r) => r.trade.excursions.lowPrice).filter((x): x is number => typeof x === "number")
  const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0)
  const conflict = spread(highs) > 1e-6 || spread(lows) > 1e-6
  const high = highs.length ? Math.max(...highs) : null
  const low = lows.length ? Math.min(...lows) : null
  const long = c.key.direction === "LONG"
  const pos = (x: number) => r6(Math.max(0, x))
  const mfePoints = long ? (high === null ? null : pos(high - avgEntry)) : low === null ? null : pos(avgEntry - low)
  const maePoints = long ? (low === null ? null : pos(avgEntry - low)) : high === null ? null : pos(high - avgEntry)
  const excursions: CanonicalTrade["excursions"] = {
    mfePoints,
    maePoints,
    mfeReason: mfePoints === null ? "NOT_PROVIDED" : null,
    maeReason: maePoints === null ? "NOT_PROVIDED" : null,
    highPrice: high,
    lowPrice: low,
    conflict,
    origin: mfePoints !== null || maePoints !== null ? "RECONSTRUCTED_NT8_ROWS" : "NONE",
  }

  const built = buildCanonicalTrade({
    source: { ...first.source, rowNo: rows[0].rowNo, externalId: null },
    accountName: c.key.account,
    instrumentRaw: first.instrument.raw,
    direction: c.key.direction,
    quantity: totalQty,
    entry: { at: entryLegs[0].at, price: avgEntry },
    exit: { at: lastExitLeg.at, price: avgExit },
    reportedPnl: null,
    declaredPnlBasis: "UNKNOWN",
    commission: pnl.commission,
    fees: pnl.fees,
    mfeRaw: null,
    maeRaw: null,
    excursionUnit: null,
    strategyName: c.key.strategy,
    notes: null,
    sessionHint: null,
  })

  const sourceRows = items.map((i) => ({
    rowNo: i.row.rowNo,
    entryLeg: entryIdx.get(entryKey(i)) as number,
    exitLeg: exitIdx.get(exitKey(i)) as number,
    quantity: qty(i),
    entryLabel: i.row.meta.entryLabel,
    exitLabel: i.row.meta.exitLabel,
    entryPrice: i.row.trade.entry.price,
    exitPrice: i.row.trade.exit.price,
    reportedProfit: i.row.meta.reportedProfit,
    commission: i.row.trade.pnl.commission,
    fees: i.row.trade.pnl.fees,
    maeUsd: i.row.meta.maeUsd,
    mfeUsd: i.row.meta.mfeUsd,
    etdUsd: i.row.meta.etdUsd,
    bars: i.row.meta.bars,
    cumulativeNetReported: i.row.meta.cumulativeNetReported,
  }))

  const ambiguities = c.ambiguities
  if (conflict) {
    ambiguities.push({
      code: "EXCURSION_CONFLICT",
      severity: "INFO",
      rowNos: uniqSorted(rows.map((r) => r.rowNo)),
      message: "Os extremos de MAE/MFE divergem entre as linhas do ciclo (janelas de medição diferentes): usado o extremo mais amplo (limite inferior da excursão real).",
    })
  }
  const confidence = ambiguities.some((a) => a.severity === "LOW_CONFIDENCE") ? ("LOW" as const) : ("HIGH" as const)

  const cycle: CanonicalTrade = {
    ...built,
    schemaVersion: SCHEMA_TRADE,
    pnl,
    excursions,
    granularity: "POSITION_CYCLE",
    peakQuantity: peak,
    entryLegs,
    exitLegs,
    exitSummary,
    sourceRows,
    reconstruction: {
      method: "NT8_ROW_INTERVALS_V1",
      scope: "STRATEGY_POSITION",
      cycleKey: { ...c.key },
      confidence,
      ambiguities,
      completeness: c.completeness,
      boundary: { prev: c.boundaryPrev, next: c.boundaryNext },
      integrity: opts.integrity ?? "UNAVAILABLE",
    },
    fieldProvenance: {
      ...built.fieldProvenance,
      "pnl.reported": pnl.reported === null ? "ABSENT" : "DERIVED",
      "pnl.net": pnl.net === null ? "ABSENT" : "DERIVED", // soma das pernas (nunca o acumulado)
      "pnl.commission": pnl.commission === null ? "ABSENT" : "DERIVED",
      "pnl.fees": pnl.fees === null ? "ABSENT" : "DERIVED",
      "excursions.mfe": mfePoints === null ? "ABSENT" : "INFERRED",
      "excursions.mae": maePoints === null ? "ABSENT" : "INFERRED",
    },
  }

  // issues: as das linhas (1 por código+campo) + as do ciclo
  const v = validateTrade(cycle)
  const seen = new Set<string>()
  const issues = [...rows.flatMap((r) => r.trade.issues), ...v.issues].filter((i) => {
    const k = `${i.code}|${i.field ?? ""}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (conflict && !seen.has("W_EXCURSION_CONFLICT|excursions")) {
    issues.push({ code: "W_EXCURSION_CONFLICT", severity: "WARNING", message: "Extremos de MAE/MFE divergentes entre as linhas do ciclo (usado o mais amplo).", field: "excursions", rowNo: rows[0].rowNo })
  }
  return { ...cycle, dataQuality: v.dataQuality, issues }
}
