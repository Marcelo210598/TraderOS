// Gerador de CSV sintético NT8 PT-BR para os testes de Evidence (valores inventados; só MGC, point value 10).
// O acumulado ("Acu lucro líquido") é calculado aqui para o relatório fechar linha a linha (a menos que o teste queira quebrá-lo).
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const HEADER = readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/ninjatrader-ptbr-cycles.csv", import.meta.url)), "utf8").split(/\r?\n/)[0]

export interface SynthRow {
  qty?: number
  account?: string
  entryPrice: number
  exitPrice: number
  entryAt: string // "dd/mm/yyyy hh:mm:ss"
  exitAt: string
  entryLabel?: string
  exitLabel?: string
  mae?: number
  mfe?: number
  etd?: number
}

const money = (n: number) => `$ ${n.toFixed(2).replace(".", ",")}`
const price = (n: number) => n.toFixed(1).replace(".", ",")

/** `breakCumulative` desloca o acumulado da última linha (testa ACCUMULATED_MISMATCH). */
export function synthCsv(rows: SynthRow[], opts: { breakCumulative?: boolean } = {}): string {
  let cum = 0
  const lines = rows.map((r, i) => {
    const qty = r.qty ?? 1
    const commission = 2.4 * qty
    const profit = Math.round(((r.exitPrice - r.entryPrice) * 10 * qty - commission) * 100) / 100
    cum = Math.round((cum + profit) * 100) / 100
    const shown = opts.breakCumulative && i === rows.length - 1 ? cum + 1 : cum
    return [
      i + 1, "MGC 12-26", r.account ?? "Sim101", "Estrategia Teste", "Comprada", qty, price(r.entryPrice), price(r.exitPrice), r.entryAt, r.exitAt,
      r.entryLabel ?? "Entry", r.exitLabel ?? "Target1", money(profit), money(shown), money(commission), money(0), money(0), money(0), money(0),
      money(r.mae ?? 8), money(r.mfe ?? 90), money(r.etd ?? 40), 0, "",
    ].join(";")
  })
  return [HEADER, ...lines].join("\n") + "\n"
}
