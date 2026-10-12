// Dados 100% SINTÉTICOS do Evidence Lab (inventados aqui; nenhuma fixture real, conta, estratégia ou resultado real).
// Gera um CSV no formato NT8 PT-BR e o passa pelo pipeline REAL; os stops (que o NT8 não exporta) são aplicados com as funções
// do próprio domínio (`computeRisk`, `rMultipleNet`, `rMultiplePoints`) — nenhuma regra de risco nova.

import type { CanonicalTrade } from "../../domain/canonical.ts"
import { computeRisk, rMultipleNet, rMultiplePoints } from "../../domain/risk.ts"
import { assertEvidenceLabEnabled } from "./guard.ts"

/** Cabeçalho do export NT8 PT-BR (igual ao de `fixtures/_synthetic/ninjatrader-ptbr-cycles.csv`; um teste confere a igualdade). */
export const NT8_PTBR_HEADER =
  "Núm. Neg.;Ativo;Conta;Estratégia;Pos mercado.;Qtd;Preço entrada;Preço saída;Hora entrada;Hora saída;Entrada;Sáída;Profit;Acu lucro líquido;Corretagem;Taxa de Compensação;Taxa de Bolsa;Taxa de IP;Taxa NFA;MAE;MFE;ETD;Barras;"

export const DEMO_ACCOUNTS = { A: "Conta Demo A", B: "Conta Demo B" } as const
export const DEMO_STRATEGY = "Estratégia Demo"
export const DEMO_FILE_NAME = "demo-sintetico-evidence-lab.csv"
export const DEMO_SOURCE_TZ = "America/Sao_Paulo"
const POINT_VALUE = 10 // MGC
const COMMISSION_PER_CONTRACT = 2.4

interface DemoRow {
  acc: keyof typeof DEMO_ACCOUNTS
  dir: "L" | "S"
  entry: number
  exit: number
  /** dd/03/2026 */
  day: string
  from: string
  to: string
  exitLabel?: string
  mae?: number
  mfe?: number
}

/** Cada linha é inventada. Há de propósito: scale-in/out, mesmo segundo (ambiguidade), conflito de excursão, vendas, perdas, 2 contas. */
const ROWS: DemoRow[] = [
  { acc: "A", dir: "L", entry: 2000, exit: 2004, day: "02", from: "09:00:00", to: "09:30:00", exitLabel: "Target1" },
  { acc: "A", dir: "L", entry: 2001, exit: 2006, day: "02", from: "09:05:00", to: "09:40:00", exitLabel: "Target2" }, // scale-in/out do ciclo acima
  { acc: "A", dir: "S", entry: 2010, exit: 2006, day: "02", from: "11:00:00", to: "11:20:00" },
  { acc: "A", dir: "L", entry: 2000, exit: 1997, day: "03", from: "10:00:00", to: "10:12:00", exitLabel: "Stop1" },
  { acc: "A", dir: "L", entry: 1997, exit: 1999, day: "03", from: "10:12:00", to: "10:30:00" }, // entra no MESMO segundo da saída anterior ⇒ ambiguidade
  { acc: "A", dir: "S", entry: 2005, exit: 2009, day: "04", from: "13:00:00", to: "13:08:00", exitLabel: "Stop1" },
  { acc: "A", dir: "L", entry: 2000, exit: 2003, day: "05", from: "09:30:00", to: "09:50:00", mfe: 90, mae: 8 },
  { acc: "A", dir: "L", entry: 2000, exit: 2003, day: "05", from: "09:30:00", to: "09:50:00", mfe: 50, mae: 8 }, // mesma janela, MFE diferente ⇒ conflito
  { acc: "B", dir: "L", entry: 2000, exit: 2005, day: "06", from: "14:00:00", to: "14:20:00" },
  { acc: "B", dir: "S", entry: 2008, exit: 2002, day: "06", from: "15:00:00", to: "15:25:00" },
  { acc: "B", dir: "L", entry: 2000, exit: 2000, day: "09", from: "10:00:00", to: "10:05:00" },
  { acc: "B", dir: "L", entry: 2000, exit: 2007, day: "10", from: "09:15:00", to: "09:45:00" },
  { acc: "B", dir: "S", entry: 2012, exit: 2013, day: "11", from: "16:00:00", to: "16:10:00", exitLabel: "Stop1" },
  { acc: "A", dir: "L", entry: 2000, exit: 2002, day: "12", from: "10:00:00", to: "10:10:00" },
  { acc: "A", dir: "L", entry: 2000, exit: 2008, day: "13", from: "09:00:00", to: "09:50:00" },
  { acc: "A", dir: "S", entry: 2010, exit: 2004, day: "16", from: "11:30:00", to: "12:00:00" },
]

const money = (n: number) => `$ ${n.toFixed(2).replace(".", ",")}`
const price = (n: number) => n.toFixed(1).replace(".", ",")

/** CSV NT8 PT-BR sintético; o acumulado fecha linha a linha (relatório consistente). */
export function demoCsv(): string {
  assertEvidenceLabEnabled()
  let cum = 0
  const lines = ROWS.map((r, i) => {
    const sign = r.dir === "L" ? 1 : -1
    const profit = Math.round(((r.exit - r.entry) * sign * POINT_VALUE - COMMISSION_PER_CONTRACT) * 100) / 100
    cum = Math.round((cum + profit) * 100) / 100
    return [
      i + 1, "MGC 12-26", DEMO_ACCOUNTS[r.acc], DEMO_STRATEGY, r.dir === "L" ? "Comprada" : "Venda", 1, price(r.entry), price(r.exit),
      `${r.day}/03/2026 ${r.from}`, `${r.day}/03/2026 ${r.to}`, "Entry", r.exitLabel ?? "Target1", money(profit), money(cum), money(COMMISSION_PER_CONTRACT),
      money(0), money(0), money(0), money(0), money(r.mae ?? 8), money(r.mfe ?? 90), money(40), 0, "",
    ].join(";")
  })
  return [NT8_PTBR_HEADER, ...lines].join("\n") + "\n"
}

/** Distância do stop atrás da entrada, por posição do trade. `undefined` = sem stop; negativo = lado errado; 0 = na entrada. */
export const DEMO_STOP_PATTERN: Array<number | undefined> = [8, 10, 6, 12, undefined, 5, 7, 0, -3, 9, 6, 8, undefined, 4]

/** O NT8 não exporta stop: aplica stops DEMONSTRATIVOS pelas funções do domínio (R válido e os 3 motivos de R ausente). */
export function applyDemoStops(trades: CanonicalTrade[]): CanonicalTrade[] {
  assertEvidenceLabEnabled()
  return trades.map((t, i) => {
    const d = DEMO_STOP_PATTERN[i % DEMO_STOP_PATTERN.length]
    const stopPrice = d === undefined ? null : t.direction === "LONG" ? t.entry.price - d : t.entry.price + d
    const rk = computeRisk({ direction: t.direction, entryPrice: t.entry.price, stopPrice, quantity: t.quantity, pointValue: t.instrument.pointValue })
    const rn = rMultipleNet({ netPnl: t.pnl.net, riskUsd: rk.riskUsd, riskKnown: rk.reason === null })
    return {
      ...t,
      risk: { stopPrice, targetPrice: null, riskPoints: rk.riskPoints, riskUsd: rk.riskUsd, riskSource: stopPrice === null ? "NONE" : "USER", reason: rk.reason },
      r: { net: rn.value, netReason: rn.reason, points: rMultiplePoints({ pointsPerContract: t.pointsPerContract, riskPoints: rk.riskPoints }) },
    } as CanonicalTrade
  })
}

// ── dataset dos DERIVADOS (aba "Derivados (E6)") ─────────────────────────────
// Também 100% inventado. Diferente do demo principal, aqui há de propósito: motivos de saída variados (alvo, stop, manual), ciclos de saídas
// MISTAS, rótulos que as regras NÃO reconhecem (⇒ UNKNOWN), um ciclo com quantidades diferentes por perna, 2 contas, 2 horários, 2 semanas.
// Sem stops demonstrativos (R indisponível de propósito: mostra "métrica indisponível" sem inventar valor).

interface DerivedCycle {
  acc: keyof typeof DEMO_ACCOUNTS
  dir: "L" | "S"
  /** dd/03/2026 */
  day: string
  hour: number
  legs: Array<{ qty?: number; exit: number; label: string; minute: number }>
}
const ENTRY_PRICE = 2000
const DERIVED_CYCLES: DerivedCycle[] = [
  { acc: "A", dir: "L", day: "02", hour: 9, legs: [{ exit: 2004, label: "Target1", minute: 10 }, { exit: 2008, label: "Target2", minute: 20 }] },
  { acc: "A", dir: "L", day: "03", hour: 9, legs: [{ exit: 1996, label: "Stop1", minute: 10 }] },
  { acc: "A", dir: "L", day: "04", hour: 14, legs: [{ exit: 1994, label: "Stop1", minute: 10 }, { exit: 1992, label: "Stop2", minute: 20 }] },
  { acc: "B", dir: "L", day: "05", hour: 14, legs: [{ exit: 2006, label: "Target1", minute: 10 }, { exit: 1995, label: "Stop1", minute: 20 }] },
  { acc: "B", dir: "L", day: "06", hour: 9, legs: [{ exit: 2001, label: "Zerar", minute: 10 }] },
  { acc: "B", dir: "L", day: "09", hour: 14, legs: [{ exit: 2004, label: "Target1", minute: 10 }, { exit: 2002, label: "Saida X", minute: 20 }] },
  { acc: "B", dir: "L", day: "10", hour: 9, legs: [{ exit: 2002, label: "Saida X", minute: 10 }, { exit: 1999, label: "", minute: 20 }] },
  { acc: "A", dir: "L", day: "11", hour: 14, legs: [{ qty: 3, exit: 2005, label: "Target1", minute: 10 }, { qty: 2, exit: 1997, label: "Stop1", minute: 20 }, { qty: 1, exit: 2001, label: "Zerar", minute: 30 }] },
  { acc: "A", dir: "L", day: "12", hour: 9, legs: [{ exit: 2003, label: "Target1", minute: 10 }] },
  { acc: "B", dir: "L", day: "13", hour: 9, legs: [{ exit: 1996, label: "Stop1", minute: 10 }] },
  { acc: "A", dir: "L", day: "16", hour: 9, legs: [{ exit: 2001, label: "Saida X", minute: 10 }] },
  { acc: "B", dir: "L", day: "17", hour: 14, legs: [{ exit: 1993, label: "Stop1", minute: 10 }, { exit: 2002, label: "Target1", minute: 20 }] },
  { acc: "B", dir: "S", day: "18", hour: 14, legs: [{ exit: 2005, label: "Stop1", minute: 10 }] },
]
const hms = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`

/** CSV NT8 PT-BR sintético dos derivados (uma linha por perna de saída); o acumulado fecha linha a linha. */
export function derivedDemoCsv(): string {
  assertEvidenceLabEnabled()
  let cum = 0
  let n = 0
  const lines = DERIVED_CYCLES.flatMap((c) =>
    c.legs.map((l) => {
      const qty = l.qty ?? 1
      const sign = c.dir === "L" ? 1 : -1
      const commission = Math.round(COMMISSION_PER_CONTRACT * qty * 100) / 100
      const profit = Math.round(((l.exit - ENTRY_PRICE) * sign * POINT_VALUE * qty - commission) * 100) / 100
      cum = Math.round((cum + profit) * 100) / 100
      n += 1
      return [
        n, "MGC 12-26", DEMO_ACCOUNTS[c.acc], DEMO_STRATEGY, c.dir === "L" ? "Comprada" : "Venda", qty, price(ENTRY_PRICE), price(l.exit),
        `${c.day}/03/2026 ${hms(c.hour)}`, `${c.day}/03/2026 ${hms(c.hour, l.minute)}`, "Entry", l.label, money(profit), money(cum), money(commission),
        money(0), money(0), money(0), money(0), money(8), money(90), money(40), 0, "",
      ].join(";")
    }),
  )
  return [NT8_PTBR_HEADER, ...lines].join("\n") + "\n"
}
