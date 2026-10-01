// NinjaTrader 8 — grade de negociações (Trade Performance) exportada em PORTUGUÊS.
// Colunas (conforme documentado/usado no importador atual): Núm. Neg.; Ativo; Conta; Estratégia; Pos mercado.; Qtd;
// Preço entrada; Preço saída; Hora entrada; Hora saída; Entrada; Saída; Profit; Acu lucro líquido; Corretagem;
// Taxa de Compensação; Taxa de Bolsa; Taxa de IP; Taxa NFA; MAE; MFE; ETD; Barras.
// Separador ";", decimal ",", valores "$ 134,20", direção "Comprada"/"Venda", datas dd/MM/aaaa.
//
// Diferença p/ o importador atual: ele SOMA todas as taxas em `commission`. Aqui:
//   commission = Corretagem · fees = Taxa de Compensação + Taxa de Bolsa + Taxa de IP + Taxa NFA
// (o P&L líquido fica correto e auditável). "Acu lucro líquido" é acumulado — ignorado.
// MAE/MFE: o importador atual documenta que vêm em DÓLAR (total da posição) → excursionUnit padrão USD_TOTAL.
// NÃO validado contra um export real nesta etapa — ver fixtures/ninjatrader/trade-performance/README.md.

import type { CsvTable } from "../csv.ts"
import type { ParserDescriptor, SourceRecord } from "../types.ts"

const REQUIRED = ["ativo", "pos_mercado", "qtd", "preco_entrada", "preco_saida", "hora_entrada"] as const
const FEE_COLUMNS = ["taxa_de_compensacao", "taxa_de_bolsa", "taxa_de_ip", "taxa_nfa"] as const

function direction(raw: string): "LONG" | "SHORT" | null {
  const v = raw.trim().toLowerCase()
  if (v.includes("compra")) return "LONG"
  if (v.includes("venda")) return "SHORT"
  return null
}

export const ninjaTraderPtBr: ParserDescriptor = {
  id: "ninjatrader-trades-ptbr",
  version: "1.0.0",
  platform: "NINJATRADER",
  label: "NinjaTrader 8 — Trade Performance (grade em português)",
  defaults: {
    numberLocale: "BR",
    dateOrder: "DMY",
    excursionUnit: "USD_TOTAL",
    declaredPnlBasis: "UNKNOWN", // inferida pelos preços; "Profit" pode ou não incluir custos
  },

  detect(table: CsvTable) {
    const missing = REQUIRED.filter((h) => !table.headers.includes(h))
    if (missing.length === 0) return { confidence: 1, reasons: ["cabeçalhos do NT8 em português presentes"] }
    return { confidence: REQUIRED.length - missing.length >= 4 ? 0.5 : 0, reasons: [`faltam: ${missing.join(", ")}`] }
  },

  parse(table: CsvTable) {
    const has = (h: string) => table.headers.includes(h)
    const feeCols = FEE_COLUMNS.filter(has)
    const records: SourceRecord[] = table.rows.map((row) => {
      const f = row.fields
      return {
        rowNo: row.rowNo,
        entryTime: f.hora_entrada,
        exitTime: has("hora_saida") ? f.hora_saida : undefined,
        instrument: f.ativo ?? "", // mantém "NQ 06-25" inteiro p/ o parser de contrato
        direction: direction(f.pos_mercado ?? ""),
        directionRaw: f.pos_mercado ?? "",
        quantity: f.qtd ?? "",
        entryPrice: f.preco_entrada ?? "",
        exitPrice: f.preco_saida ?? "",
        profit: has("profit") ? f.profit : undefined,
        commission: has("corretagem") ? f.corretagem : undefined,
        fees: feeCols.length ? feeCols.map((c) => f[c] ?? "") : undefined,
        mae: has("mae") ? f.mae : undefined,
        mfe: has("mfe") ? f.mfe : undefined,
        account: has("conta") ? f.conta : undefined,
        strategy: has("estrategia") ? f.estrategia : undefined,
      }
    })
    return { records, issues: [] }
  },
}
