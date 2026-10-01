// Template CSV do próprio MeuTrade (formato NOSSO, documentado em importar-client.tsx → TEMPLATE_CSV):
//   date,instrument,direction,entry_price,exit_price,quantity,pnl,commission,session,notes
// Só traz DATA: o resultado é DATE_ONLY — sem hora fabricada. `session` é uma dica declarada pelo usuário (não derivada).
// Base do `pnl` desconhecida (o usuário digita) → inferida pelos preços quando possível.

import type { CsvTable } from "../csv.ts"
import type { ParserDescriptor, SourceRecord } from "../types.ts"

const REQUIRED = ["date", "instrument", "direction", "entry_price", "exit_price", "quantity", "pnl"] as const

function direction(raw: string): "LONG" | "SHORT" | null {
  const v = raw.trim().toUpperCase()
  return v === "LONG" ? "LONG" : v === "SHORT" ? "SHORT" : null
}

export const meutradeTemplate: ParserDescriptor = {
  id: "meutrade-template",
  version: "1.0.0",
  platform: "MEUTRADE_TEMPLATE",
  label: "Template CSV do MeuTrade",
  defaults: { numberLocale: "US", dateOrder: null, excursionUnit: null, declaredPnlBasis: "UNKNOWN" },

  detect(table: CsvTable) {
    const missing = REQUIRED.filter((h) => !table.headers.includes(h))
    if (missing.length === 0) return { confidence: 1, reasons: ["cabeçalhos do template MeuTrade presentes"] }
    return { confidence: REQUIRED.length - missing.length >= 5 ? 0.5 : 0, reasons: [`faltam: ${missing.join(", ")}`] }
  },

  parse(table: CsvTable) {
    const has = (h: string) => table.headers.includes(h)
    const records: SourceRecord[] = table.rows.map((row) => {
      const f = row.fields
      return {
        rowNo: row.rowNo,
        date: f.date,
        instrument: f.instrument ?? "",
        direction: direction(f.direction ?? ""),
        directionRaw: f.direction ?? "",
        quantity: f.quantity ?? "",
        entryPrice: f.entry_price ?? "",
        exitPrice: f.exit_price ?? "",
        profit: f.pnl,
        commission: has("commission") ? f.commission : undefined,
        notes: has("notes") ? f.notes : undefined,
        sessionHint: has("session") ? f.session : undefined,
      }
    })
    return { records, issues: [] }
  },
}
