// Regressão com exports REAIS do NT8 PT-BR (fixtures LOCAIS, não versionadas — repositório público): node scripts/test-real-nt8-metrics.mts
// Varre TODOS os `fixtures/ninjatrader/trade-performance/*.csv` que tenham `.context.json`; nenhum arquivo específico é citado.
// Sem números embutidos: o próprio CSV é o ORÁCULO (colunas Profit, Corretagem, taxas e "Acu lucro líquido" do NT8), então o
// teste cruza o motor com valores INDEPENDENTES do nosso código e não expõe nenhum resultado no repositório.
// A lógica independente de AGRUPAMENTO em ciclos fica em scripts/oracle-nt8-cycles.py (rodar à parte).
// Sem fixtures → pula (passa).
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseDelimited, parseNumber } from "../src/lib/ingest/csv.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { aggregateTrades, calculateMetrics, toAnalyticsTrades } from "../src/lib/metrics/index.ts"

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) {
  console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando")
  process.exit(0)
}

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const cents = (xs: number[]) => Math.round(xs.reduce((a, b) => a + Math.round(b * 100), 0)) / 100
const br = (s: string) => {
  const r = parseNumber(s, "BR")
  assert.equal(r.ok, true, s)
  return (r as { ok: true; value: number }).value
}

for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  const table = parseDelimited(text)

  // oráculo = colunas do PRÓPRIO arquivo
  const oracle = table.rows.map((r) => ({
    rowNo: r.rowNo,
    symbol: r.fields.ativo.split(" ")[0],
    profit: br(r.fields.profit),
    quantity: br(r.fields.qtd),
    commission: br(r.fields.corretagem),
    fees: cents(["taxa_de_compensacao", "taxa_de_bolsa", "taxa_de_ip", "taxa_nfa"].map((c) => br(r.fields[c]))),
    cumulative: br(r.fields.acu_lucro_liquido),
  }))
  const byRow = new Map(oracle.map((o) => [o.rowNo, o]))

  const imp = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
  const trades = toAnalyticsTrades(imp.trades)
  const m = calculateMetrics(trades)
  const rowsM = calculateMetrics(toAnalyticsTrades(imp.rowTrades))
  const v = (id: string) => m.metrics[id].value

  test(`[${tag}] todas as linhas entram, sem problema de arquivo, 1 linha = 1 rowTrade, ciclos ≤ linhas, instrumentos conhecidos`, () => {
    assert.deepEqual([imp.stats.rowsRead, imp.stats.accepted, imp.stats.rejected], [oracle.length, oracle.length, 0])
    assert.equal(imp.issues.filter((i) => i.severity === "ERROR").length, 0)
    assert.equal(imp.parser?.id, "ninjatrader-trades-ptbr")
    assert.equal(imp.rowTrades.length, oracle.length)
    assert.equal(imp.trades.length, imp.stats.trades)
    assert.ok(imp.trades.length >= 1 && imp.trades.length <= oracle.length)
    assert.equal(m.dataQuality.instruments.unknown, 0)
  })

  test(`[${tag}] CRUZAMENTO: líquido = Σ Profit do NT8 = última 'Acu lucro líquido'; o acumulado bate LINHA A LINHA`, () => {
    const sumProfit = cents(oracle.map((o) => o.profit))
    assert.equal(v("netPnl"), sumProfit)
    assert.equal(sumProfit, oracle[oracle.length - 1].cumulative)
    let acc = 0
    imp.rowTrades.forEach((t, i) => {
      acc = cents([acc, t.pnl.net as number])
      assert.equal(acc, oracle[i].cumulative, `linha ${oracle[i].rowNo}`)
    })
  })

  test(`[${tag}] INVARIANTES FINANCEIROS: reconstruir não muda líquido, bruto, comissão, taxas nem quantidade`, () => {
    for (const id of ["netPnl", "grossPnl", "commission", "fees"]) assert.equal(v(id), rowsM.metrics[id].value, id)
    assert.equal(v("commission"), cents(oracle.map((o) => o.commission)))
    assert.equal(v("fees"), cents(oracle.map((o) => o.fees)))
    assert.equal(cents([v("grossPnl") as number, -(v("commission") as number), -(v("fees") as number)]), v("netPnl"))
    const qtyOf = (ts: typeof imp.trades) => ts.reduce((a, t) => a + t.quantity, 0)
    assert.equal(qtyOf(imp.trades), qtyOf(imp.rowTrades))
    assert.equal(qtyOf(imp.trades), oracle.reduce((a, o) => a + o.quantity, 0))
    // o que PODE mudar é a unidade analítica: linhas contam como trades antes, ciclos depois
    assert.equal(rowsM.metrics.totalTrades.value, oracle.length)
    assert.equal(v("totalTrades"), imp.trades.length)
  })

  test(`[${tag}] o 'Profit' do NT8 é LÍQUIDO: base inferida pelos preços; ciclo herda a base quando todas as linhas concordam`, () => {
    assert.ok(imp.rowTrades.every((t) => t.pnl.basis === "NET" && t.pnl.basisSource === "INFERRED_FROM_PRICES"))
    assert.ok(imp.trades.every((t) => t.pnl.basis === "NET"))
  })

  test(`[${tag}] ciclo a ciclo: P&L, comissão e quantidade = soma das linhas de origem lidas do CSV (sourceRows); toda linha em exatamente 1 ciclo`, () => {
    const seen = new Set<number>()
    for (const t of imp.trades) {
      const rows = (t.sourceRows ?? []).map((s) => s.rowNo)
      assert.ok(rows.length >= 1)
      for (const r of rows) {
        assert.ok(byRow.has(r), `linha ${r} desconhecida`)
        assert.ok(!seen.has(r), `linha ${r} em 2 ciclos`)
        seen.add(r)
      }
      assert.equal(t.pnl.net, cents(rows.map((r) => byRow.get(r)!.profit)), `ciclo da linha ${rows[0]}`)
      assert.equal(t.pnl.commission, cents(rows.map((r) => byRow.get(r)!.commission)))
      assert.equal(t.quantity, rows.reduce((a, r) => a + byRow.get(r)!.quantity, 0))
    }
    assert.equal(seen.size, oracle.length)
  })

  test(`[${tag}] contagens por CICLO batem com a soma do Profit de cada ciclo lida do CSV (e as linhas inflam a contagem)`, () => {
    const cycleProfits = imp.trades.map((t) => cents((t.sourceRows ?? []).map((s) => byRow.get(s.rowNo)!.profit)))
    const w = cycleProfits.filter((p) => p > 0).length
    const l = cycleProfits.filter((p) => p < 0).length
    assert.deepEqual([v("winners"), v("losers"), v("totalTrades")], [w, l, imp.trades.length])
    if (l === 0) assert.equal(m.metrics.profitFactor.reason, "NO_LOSERS")
    assert.equal(v("totalR"), null) // o NT8 não exporta stop ⇒ R indisponível, nunca inferido
    assert.ok(m.warnings.some((x) => x.code === "W_R_UNAVAILABLE"))
  })

  test(`[${tag}] por símbolo: ciclos e líquido de cada grupo = Σ Profit das linhas daquele ativo no arquivo`, () => {
    const g = aggregateTrades(trades, { groupBy: "symbol" })
    const bySym = new Map<string, number[]>()
    for (const o of oracle) bySym.set(o.symbol, [...(bySym.get(o.symbol) ?? []), o.profit])
    const cyclesBySym = new Map<string, number>()
    for (const t of imp.trades) cyclesBySym.set(t.instrument.root ?? "?", (cyclesBySym.get(t.instrument.root ?? "?") ?? 0) + 1)
    const expected = [...bySym.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([s, ps]) => [s, cyclesBySym.get(s), cents(ps)])
    assert.deepEqual(g.groups.map((x) => [x.key[0], x.sampleSize, x.metrics.netPnl.value]), expected)
  })

  test(`[${tag}] MFE/MAE em pontos por contrato são coerentes com o resultado realizado (nenhum aviso de unidade suspeita)`, () => {
    for (const t of imp.trades) assert.ok(!t.issues.some((i) => i.code === "W_MFE_LT_REALIZED" || i.code === "W_MAE_LT_REALIZED"))
  })

  test(`[${tag}] fuso: sem sourceTz no contexto ⇒ origem DEFAULT + aviso; com sourceTz ⇒ USER sem aviso`, () => {
    const warned = imp.issues.some((i) => i.code === "W_SOURCE_TZ_DEFAULTED")
    assert.equal(imp.settings?.sourceTzOrigin, ctx.sourceTz ? "USER" : "DEFAULT")
    assert.equal(warned, !ctx.sourceTz)
  })
}

console.log(`\n${passed} testes ok em ${names.length} fixture(s) real(is)`)
