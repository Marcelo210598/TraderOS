// NinjaTrader 8 — Trade Performance → display "Trades" exportado em CSV (inglês).
// Mapeamento limitado às colunas que o importador atual JÁ lê (importar-client.tsx → parseNinjaTrader):
//   entry_time, market_pos, instrument, quantity, entry_price, exit_price, profit, commission, mae, mfe
// + exit_time (já usado na detecção) e account/strategy (opcionais).
// NÃO foi validado contra um export real nesta etapa — ver fixtures/ninjatrader/trade-performance/README.md.
// Semântica deliberadamente NÃO assumida: base do "profit" (bruto/líquido) → inferida pelos preços; unidade de MAE/MFE
// (a UI do NT8 deixa escolher moeda/pontos/ticks…) → desconhecida a menos que o usuário informe.

import { issue, type Issue } from "../../domain/canonical.ts"
import type { CsvTable } from "../csv.ts"
import type { ParserDescriptor, SourceRecord } from "../types.ts"

const REQUIRED = ["instrument", "market_pos", "entry_price", "exit_price", "entry_time"] as const
const QTY_ALIASES = ["quantity", "qty"] as const // "qty": alias NÃO verificado contra export real

function direction(raw: string): "LONG" | "SHORT" | null {
  const v = raw.trim().toLowerCase()
  return v === "long" ? "LONG" : v === "short" ? "SHORT" : null
}

export const ninjaTraderEn: ParserDescriptor = {
  id: "ninjatrader-trades-en",
  version: "1.0.0",
  platform: "NINJATRADER",
  label: "NinjaTrader 8 — Trade Performance (Trades, inglês)",
  defaults: {
    numberLocale: "US",
    dateOrder: "MDY", // mesma suposição do importador atual (m/d/aaaa); linha com dia > 12 falha alto em vez de trocar dia/mês
    excursionUnit: null,
    declaredPnlBasis: "UNKNOWN",
  },
  unverifiedAliases: ["qty"],

  detect(table: CsvTable) {
    const has = (h: string) => table.headers.includes(h)
    const hasQty = QTY_ALIASES.some(has)
    const missing = REQUIRED.filter((h) => !has(h))
    if (!hasQty) missing.push("quantity" as never)
    if (missing.length === 0) return { confidence: 1, reasons: ["cabeçalhos do NT8 (Trades) presentes"] }
    const found = REQUIRED.length + 1 - missing.length
    return { confidence: found >= 4 ? 0.5 : 0, reasons: [`faltam: ${missing.join(", ")}`] }
  },

  parse(table: CsvTable) {
    const issues: Issue[] = []
    const qtyKey = QTY_ALIASES.find((h) => table.headers.includes(h)) ?? "quantity"
    const records: SourceRecord[] = table.rows.map((row) => {
      const f = row.fields
      const dir = direction(f.market_pos ?? "")
      return {
        rowNo: row.rowNo,
        entryTime: f.entry_time,
        exitTime: table.headers.includes("exit_time") ? f.exit_time : undefined,
        instrument: f.instrument ?? "",
        direction: dir,
        directionRaw: f.market_pos ?? "",
        quantity: f[qtyKey] ?? "",
        entryPrice: f.entry_price ?? "",
        exitPrice: f.exit_price ?? "",
        profit: table.headers.includes("profit") ? f.profit : undefined,
        commission: table.headers.includes("commission") ? f.commission : undefined,
        mae: table.headers.includes("mae") ? f.mae : undefined,
        mfe: table.headers.includes("mfe") ? f.mfe : undefined,
        account: table.headers.includes("account") ? f.account : undefined,
        strategy: table.headers.includes("strategy") ? f.strategy : undefined,
      }
    })
    if (!table.headers.includes("exit_time")) {
      issues.push(issue("WARNING", "W_COLUMN_MISSING", "Coluna exit_time ausente: sem horário de saída/duração."))
    }
    return { records, issues }
  },
}
