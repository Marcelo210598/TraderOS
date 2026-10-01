// Regressão com um export REAL do NT8 (fixture LOCAL, não versionada — repositório público): node scripts/test-real-nt8-metrics.mts
// Sem números embutidos: o próprio CSV é o ORÁCULO (colunas Profit, Corretagem e "Acu lucro líquido" do NT8), então o
// teste cruza o motor com valores INDEPENDENTES do nosso código e não expõe nenhum resultado no repositório.
// Sem a fixture → pula (passa).
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseDelimited, parseNumber } from "../src/lib/ingest/csv.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { aggregateTrades, calculateMetrics, toAnalyticsTrades } from "../src/lib/metrics/index.ts"

const path = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance/nt8-grid-ptbr-2026-09-21.csv", import.meta.url))
if (!existsSync(path)) {
  console.log("• fixture real do NT8 ausente (local, não versionada) — pulando")
  process.exit(0)
}
const text = readFileSync(path, "utf8")
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

const table = parseDelimited(text)
const br = (s: string) => {
  const r = parseNumber(s, "BR")
  assert.equal(r.ok, true, s)
  return (r as { ok: true; value: number }).value
}
const cents = (xs: number[]) => Math.round(xs.reduce((a, b) => a + Math.round(b * 100), 0)) / 100

// oráculo = colunas do PRÓPRIO arquivo
const oracle = table.rows.map((r) => ({
  rowNo: r.rowNo,
  symbol: r.fields.ativo.split(" ")[0],
  profit: br(r.fields.profit),
  commission: br(r.fields.corretagem),
  fees: cents(["taxa_de_compensacao", "taxa_de_bolsa", "taxa_de_ip", "taxa_nfa"].map((c) => br(r.fields[c]))),
  cumulative: br(r.fields.acu_lucro_liquido),
}))

const imp = runImportPipeline(text, { sourceTz: "America/Sao_Paulo", fileName: "nt8-grid-ptbr-2026-09-21.csv", fileHash: "local" })
const trades = toAnalyticsTrades(imp.trades)
const m = calculateMetrics(trades)
const v = (id: string) => m.metrics[id].value

test("todas as linhas do arquivo real entram, sem problema de arquivo, todas COMPLETE e com instrumento conhecido", () => {
  assert.deepEqual([imp.stats.rowsRead, imp.stats.accepted, imp.stats.rejected, imp.issues.length], [oracle.length, oracle.length, 0, 0])
  assert.equal(imp.parser?.id, "ninjatrader-trades-ptbr")
  assert.equal(m.dataQuality.level, "COMPLETE")
  assert.equal(m.dataQuality.instruments.unknown, 0)
})

test("CRUZAMENTO: líquido do motor = Σ Profit do NT8 = última 'Acu lucro líquido'; o acumulado bate LINHA A LINHA", () => {
  const sumProfit = cents(oracle.map((o) => o.profit))
  assert.equal(v("netPnl"), sumProfit)
  assert.equal(sumProfit, oracle[oracle.length - 1].cumulative)
  let acc = 0
  imp.trades.forEach((t, i) => {
    acc = cents([acc, t.pnl.net as number])
    assert.equal(acc, oracle[i].cumulative, `linha ${oracle[i].rowNo}`)
  })
})

test("o 'Profit' do NT8 é LÍQUIDO: a base é inferida pelos preços em TODAS as linhas; custos separados batem com as colunas", () => {
  assert.ok(imp.trades.every((t) => t.pnl.basis === "NET" && t.pnl.basisSource === "INFERRED_FROM_PRICES"))
  assert.equal(v("commission"), cents(oracle.map((o) => o.commission)))
  assert.equal(v("fees"), cents(oracle.map((o) => o.fees)))
  // identidade: bruto − comissão − taxas = líquido
  assert.equal(cents([v("grossPnl") as number, -(v("commission") as number), -(v("fees") as number)]), v("netPnl"))
})

test("contagens e sequências batem com o sinal do Profit do próprio arquivo", () => {
  const w = oracle.filter((o) => o.profit > 0).length
  const l = oracle.filter((o) => o.profit < 0).length
  assert.deepEqual([v("winners"), v("losers"), v("totalTrades")], [w, l, oracle.length])
  if (l === 0) assert.equal(m.metrics.profitFactor.reason, "NO_LOSERS")
  assert.equal(v("totalR"), null) // o NT8 não exporta stop ⇒ R indisponível, nunca inferido
  assert.ok(m.warnings.some((x) => x.code === "W_R_UNAVAILABLE"))
})

test("por símbolo: líquido de cada grupo = Σ Profit das linhas daquele ativo no arquivo", () => {
  const g = aggregateTrades(trades, { groupBy: "symbol" })
  const bySym = new Map<string, number[]>()
  for (const o of oracle) bySym.set(o.symbol, [...(bySym.get(o.symbol) ?? []), o.profit])
  const expected = [...bySym.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([s, ps]) => [s, ps.length, cents(ps)])
  assert.deepEqual(g.groups.map((x) => [x.key[0], x.sampleSize, x.metrics.netPnl.value]), expected)
})

test("MFE/MAE em pontos por contrato são coerentes com o resultado realizado (nenhum aviso de unidade suspeita)", () => {
  for (const t of imp.trades) assert.ok(!t.issues.some((i) => i.code === "W_MFE_LT_REALIZED" || i.code === "W_MAE_LT_REALIZED"))
})

console.log(`\n${passed} testes ok`)
