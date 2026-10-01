// Integração da reconstrução: pipeline → ciclos → métricas; fuso; retrocompatibilidade; caminho de fills.
//   node scripts/test-recon-integration.mts
// A fixture sintética `ninjatrader-ptbr-cycles.csv` REPLICA a estrutura do export real do NT8 (7 linhas: 2 ciclos de 4 lotes,
// saídas Target1×2 contra entradas de preços diferentes, Stop2/Stop3 no mesmo segundo, Target1/Target2/Zerar), com valores inventados.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { CanonicalTradeSchema, SCHEMA_EXECUTION, type CanonicalExecution, type CanonicalTrade, type SourceMetadata } from "../src/lib/domain/canonical.ts"
import { DEFAULT_USER_TIME_ZONE, parseLocalDateTime, type TimeValue } from "../src/lib/domain/time.ts"
import { aggregateExecutions } from "../src/lib/ingest/executions.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { reconstructCycles } from "../src/lib/ingest/reconstruct.ts"
import { aggregateTrades, calculateMetrics, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { at, lot } from "./_recon-fixtures.mts"

const CSV = readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/ninjatrader-ptbr-cycles.csv", import.meta.url)), "utf8")
const BRT = "America/Sao_Paulo"
const NY = "America/New_York"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const codes = (t: CanonicalTrade) => (t.reconstruction?.ambiguities ?? []).map((a) => a.code)
const val = (r: { metrics: Record<string, { value: number | null }> }, id: string) => r.metrics[id].value

const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "cycles.csv", fileHash: "syn" })
const [mgc, mnq] = imp.trades

// ── a fixture: 7 linhas → 2 ciclos ───────────────────────────────────────────

test("FIXTURE (estrutura do arquivo real): 7 linhas NT8 → 2 trades-ciclo; as 7 linhas continuam disponíveis (rowTrades)", () => {
  assert.deepEqual([imp.stats.rowsRead, imp.stats.accepted, imp.stats.rejected, imp.stats.trades], [7, 7, 0, 2])
  assert.equal(imp.rowTrades.length, 7)
  assert.ok(imp.rowTrades.every((t) => t.granularity === "SOURCE_ROW" && t.entryLegs === null))
  assert.ok(imp.trades.every((t) => t.granularity === "POSITION_CYCLE" && t.schemaVersion === "canonical-trade/2"))
  assert.deepEqual(imp.reconstruction, { method: "NT8_ROW_INTERVALS_V1", rowsIn: 7, cyclesOut: 2, passthroughRows: 0, integrity: "CONSISTENT", lowConfidenceCycles: 0, ambiguities: [] })
  assert.deepEqual([imp.issues.length, mgc.source.rowNo, mnq.source.rowNo], [0, 2, 6])
})

test("ciclo MGC: 4 lotes → 1 trade (qtd 4, pico 4); entradas 1@2000,0 + 3@2000,1; preço médio 2000,075", () => {
  assert.deepEqual([mgc.instrument.root, mgc.direction, mgc.quantity, mgc.peakQuantity, mgc.entry.price], ["MGC", "LONG", 4, 4, 2000.075])
  assert.deepEqual(mgc.entryLegs!.map((l) => [l.role, l.quantity, l.price, l.sourceLabel, l.granularity, l.rowRefs]), [
    ["ENTRY", 1, 2000, "Entry", "MATCHED_LOT", [2]],
    ["ENTRY", 3, 2000.1, "Entry", "MATCHED_LOT", [3, 4, 5]],
  ])
  assert.equal(mgc.entry.at.instantUtc, "2026-02-03T00:00:00.000Z") // 21:00 BRT
})

test("ciclo MGC: saídas Target1 (2 contratos, casada contra 2 entradas) + Stop2 + Stop3 no MESMO segundo (simultâneas, não fundidas)", () => {
  assert.deepEqual(mgc.exitLegs!.map((l) => [l.sourceLabel, l.reason, l.reasonRule, l.role, l.quantity, l.price, l.sizeAfter, l.simultaneous, l.pnl.net]), [
    ["Target1", "TARGET", "LABEL_RULE", "SCALE_OUT", 2, 2005, 2, false, 94.2],
    ["Stop2", "STOP", "LABEL_RULE", "EXIT", 1, 2000.4, 0, true, 0.6],
    ["Stop3", "STOP", "LABEL_RULE", "EXIT", 1, 2000.4, 0, true, 0.6],
  ])
  assert.deepEqual(mgc.exitLegs![0].rowRefs, [2, 3]) // 1 saída ↔ 2 linhas (entradas distintas)
  assert.deepEqual(mgc.exitSummary, { finalReason: "STOP", finalReasons: ["STOP"], byReason: { TARGET: 2, STOP: 2 }, mixed: true })
  assert.equal(mgc.exit.price, 2002.7) // média ponderada (2×2005 + 2×2000,4)/4
})

test("ciclo MNQ: entrada única de 4 → saídas Target1(2) + Target2(1) + Zerar(1): TARGET, TARGET, MANUAL; sizeAfter 2 → 1 → 0", () => {
  assert.deepEqual([mnq.instrument.root, mnq.quantity, mnq.peakQuantity, mnq.entry.price, mnq.exit.price], ["MNQ", 4, 4, 20000, 20022.5])
  assert.equal(mnq.entryLegs!.length, 1)
  assert.deepEqual(mnq.exitLegs!.map((l) => [l.sourceLabel, l.reason, l.role, l.quantity, l.sizeAfter, l.pnl.net]), [
    ["Target1", "TARGET", "SCALE_OUT", 2, 2, 76.2],
    ["Target2", "TARGET", "SCALE_OUT", 1, 1, 78.1],
    ["Zerar", "MANUAL", "EXIT", 1, 0, 18.1],
  ])
  assert.deepEqual(mnq.exitSummary, { finalReason: "MANUAL", finalReasons: ["MANUAL"], byReason: { TARGET: 3, MANUAL: 1 }, mixed: true })
})

test("P&L = SOMA das pernas = SOMA das linhas = acumulado final do NT8 (oráculo, não fonte): MGC 95,40 · MNQ 172,40 · total 267,80", () => {
  assert.deepEqual([mgc.pnl.net, mgc.pnl.gross, mgc.pnl.commission, mgc.pnl.fees], [95.4, 105, 9.6, 0])
  assert.deepEqual([mnq.pnl.net, mnq.pnl.gross, mnq.pnl.commission, mnq.pnl.fees], [172.4, 180, 7.6, 0])
  assert.equal(Math.round((mgc.pnl.net! + mnq.pnl.net!) * 100) / 100, 267.8) // = última "Acu lucro líquido"
  const rowSum = Math.round(imp.rowTrades.reduce((a, t) => a + t.pnl.net! * 100, 0)) / 100
  assert.equal(rowSum, 267.8)
  assert.deepEqual([mgc.pnl.basis, mgc.pnl.netStatus, mnq.pnl.basis, mnq.pnl.netStatus], ["NET", "COMPLETE", "NET", "COMPLETE"])
})

test("MAE/MFE do ciclo: extremos absolutos idênticos nas linhas (MGC 2009,0/1999,2; MNQ 20060/19990) → NÃO somados; origem reconstruída", () => {
  assert.deepEqual([mgc.excursions.highPrice, mgc.excursions.lowPrice, mgc.excursions.mfePoints, mgc.excursions.maePoints], [2009, 1999.2, 8.925, 0.875])
  assert.deepEqual([mnq.excursions.highPrice, mnq.excursions.lowPrice, mnq.excursions.mfePoints, mnq.excursions.maePoints], [20060, 19990, 60, 10])
  for (const t of [mgc, mnq]) assert.deepEqual([t.excursions.conflict, t.excursions.origin, t.fieldProvenance["excursions.mfe"]], [false, "RECONSTRUCTED_NT8_ROWS", "INFERRED"])
  // valores crus por linha preservados em US$ totais, com a duplicação visível (MNQ: 240 = 2 contratos × 120)
  assert.deepEqual(mnq.sourceRows!.map((s) => [s.rowNo, s.quantity, s.mfeUsd, s.maeUsd, s.etdUsd]), [[6, 2, 240, 40, 163.8], [7, 1, 120, 20, 41.9], [8, 1, 120, 20, 101.9]])
})

test("reconstrução: confiança ALTA, bordas NÃO verificadas (cada ciclo é o único da sua chave) — sinalizado, não descartado", () => {
  for (const t of [mgc, mnq]) {
    assert.deepEqual([t.reconstruction!.confidence, t.reconstruction!.completeness, t.reconstruction!.integrity, t.reconstruction!.scope], ["HIGH", "UNVERIFIED_BOTH", "CONSISTENT", "STRATEGY_POSITION"])
    assert.deepEqual(t.reconstruction!.boundary, { prev: "NONE", next: "NONE" })
  }
  assert.deepEqual(mgc.reconstruction!.cycleKey, { account: "Sim101", contract: "MGC Z26", strategy: "Estrategia Teste", direction: "LONG" })
})

test("cada linha ORIGINAL fica ligada à perna de entrada e de saída (sourceRows) — nada se perde", () => {
  assert.deepEqual(mgc.sourceRows!.map((s) => [s.rowNo, s.entryLeg, s.exitLeg, s.entryLabel, s.exitLabel]), [
    [2, 0, 0, "Entry", "Target1"],
    [3, 1, 0, "Entry", "Target1"],
    [4, 1, 1, "Entry", "Stop2"],
    [5, 1, 2, "Entry", "Stop3"],
  ])
  assert.equal(mgc.sourceRows![3].cumulativeNetReported, 95.4) // guardado cru, só p/ integridade
})

test("reconstructCycles:false → 1 linha = 1 trade (SOURCE_ROW), sem reconstrução", () => {
  const r = runImportPipeline(CSV, { sourceTz: BRT, reconstructCycles: false })
  assert.deepEqual([r.stats.trades, r.stats.accepted, r.reconstruction], [7, 7, null])
  assert.ok(r.trades.every((t) => t.granularity === "SOURCE_ROW" && t.reconstruction === null))
})

// ── métricas: ciclos, não linhas ─────────────────────────────────────────────

test("MÉTRICAS contam CICLOS e não linhas: totalTrades 7 → 2, mesmo líquido total, trade médio e maior vencedor mudam de significado", () => {
  const before = calculateMetrics(toAnalyticsTrades(imp.rowTrades))
  const after = calculateMetrics(toAnalyticsTrades(imp.trades))
  assert.deepEqual([val(before, "totalTrades"), val(after, "totalTrades")], [7, 2])
  assert.deepEqual([val(before, "netPnl"), val(after, "netPnl")], [267.8, 267.8]) // o dinheiro é o mesmo
  assert.deepEqual([val(before, "winners"), val(after, "winners")], [7, 2])
  assert.deepEqual([val(before, "averageTrade"), val(after, "averageTrade")], [38.26, 133.9])
  assert.deepEqual([val(before, "largestWinner"), val(after, "largestWinner")], [78.1, 172.4])
  assert.deepEqual([before.dataQuality.granularity, after.dataQuality.granularity], [{ positionCycles: 0, sourceRows: 7 }, { positionCycles: 2, sourceRows: 0 }])
})

test("SINALIZAÇÃO: linhas viram aviso 'não são ciclos'; ciclos com borda não verificada entram COM aviso (nunca descartados)", () => {
  const before = calculateMetrics(toAnalyticsTrades(imp.rowTrades))
  const after = calculateMetrics(toAnalyticsTrades(imp.trades))
  assert.ok(before.warnings.some((w) => w.code === "W_SOURCE_ROW_TRADES"))
  assert.ok(!after.warnings.some((w) => w.code === "W_SOURCE_ROW_TRADES"))
  assert.ok(after.warnings.some((w) => w.code === "W_RECONSTRUCTION_UNVERIFIED_EDGES"))
  assert.deepEqual(after.dataQuality.reconstruction, { cycles: 2, lowConfidence: 0, unverifiedEdges: 2 })
  assert.equal(val(after, "totalTrades"), 2) // as bordas não verificadas NÃO tiram ciclos da contagem
})

test("ciclos de BAIXA CONFIANÇA entram nas métricas, sinalizados (SAME_SECOND_BOUNDARY) — população mista também avisa", () => {
  const cyc = reconstructCycles([
    lot({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    lot({ rowNo: 3, entryAt: at("10:30:00"), exitAt: at("10:40:00"), entry: 110, exit: 115 }),
  ]).cycles
  const m = calculateMetrics(toAnalyticsTrades(cyc))
  assert.equal(val(m, "totalTrades"), 2) // nenhum descartado
  assert.deepEqual(m.dataQuality.reconstruction, { cycles: 2, lowConfidence: 2, unverifiedEdges: 2 })
  assert.ok(m.warnings.some((w) => w.code === "W_RECONSTRUCTION_LOW_CONFIDENCE"))
  const mixed = calculateMetrics(toAnalyticsTrades([...cyc, ...imp.rowTrades]))
  assert.ok(mixed.warnings.some((w) => w.code === "W_MIXED_GRANULARITY"))
})

// ── integridade do relatório ─────────────────────────────────────────────────

const lines = CSV.split("\n")
const editCell = (lineIdx: number, col: number, value: string) => {
  const copy = [...lines]
  const cells = copy[lineIdx].split(";")
  cells[col] = value
  copy[lineIdx] = cells.join(";")
  return copy.join("\n")
}

test("INTEGRIDADE: acumulado do NT8 que não fecha → aviso de arquivo + ciclos de baixa confiança; o P&L NÃO muda (não usa o acumulado)", () => {
  const broken = runImportPipeline(editCell(2, 13, "$ 94,25"), { sourceTz: BRT }) // linha 3 do arquivo (rowNo 3): acumulado adulterado
  assert.equal(broken.reconstruction!.integrity, "BROKEN")
  assert.ok(broken.issues.some((i) => i.code === "W_ACCUMULATED_MISMATCH"))
  for (const t of broken.trades) {
    assert.equal(t.reconstruction!.confidence, "LOW")
    assert.ok(codes(t).includes("ACCUMULATED_MISMATCH"))
  }
  assert.deepEqual(broken.trades.map((t) => t.pnl.net), [95.4, 172.4]) // idêntico ao íntegro
  assert.equal(broken.stats.trades, 2)
})

test("LINHA REJEITADA (quantidade ilegível): ciclos marcados de baixa confiança, aviso de arquivo, integridade indisponível — nada some em silêncio", () => {
  const r = runImportPipeline(editCell(7, 5, "x"), { sourceTz: BRT }) // última linha
  assert.deepEqual([r.stats.accepted, r.stats.rejected], [6, 1])
  assert.ok(r.issues.some((i) => i.code === "W_ROWS_REJECTED_BEFORE_RECONSTRUCTION"))
  assert.equal(r.reconstruction!.integrity, "UNAVAILABLE")
  for (const t of r.trades) assert.ok(codes(t).includes("ROWS_REJECTED_IN_FILE"))
})

test("mapa de rótulos do usuário via contexto (Zerar → UNKNOWN); mapa inválido é erro de arquivo e nenhum trade sai", () => {
  const r = runImportPipeline(CSV, { sourceTz: BRT, exitReasonMap: [{ pattern: "^zerar", reason: "UNKNOWN" }] })
  const last = r.trades[1].exitLegs![2]
  assert.deepEqual([last.sourceLabel, last.reason, last.reasonRule], ["Zerar", "UNKNOWN", "USER_MAP"])
  const bad = runImportPipeline(CSV, { sourceTz: BRT, exitReasonMap: [{ pattern: "(", reason: "STOP" }] })
  assert.deepEqual([bad.trades.length, bad.issues[0].code], [0, "E_EXIT_MAP_INVALID"])
})

// ── timezone ─────────────────────────────────────────────────────────────────

test("TIMEZONE: padrão de ANÁLISE = America/Sao_Paulo (ecoado); armazenamento UTC; hora dos ciclos no fuso do trader", () => {
  const m = calculateMetrics(toAnalyticsTrades(imp.trades))
  assert.equal(m.query.options.timeZone, "America/Sao_Paulo")
  assert.equal(DEFAULT_USER_TIME_ZONE, "America/Sao_Paulo")
  assert.deepEqual(aggregateTrades(toAnalyticsTrades(imp.trades), { groupBy: "hour" }).groups.map((g) => g.key[0]), ["10", "21"]) // = horário do arquivo (BRT)
  assert.deepEqual(aggregateTrades(toAnalyticsTrades(imp.trades), { groupBy: "hour", timeZone: NY }).groups.map((g) => g.key[0]), ["08", "19"]) // EST = BRT − 2 h
  assert.match(mgc.entry.at.instantUtc!, /Z$/) // armazenamento em UTC
})

test("TIMEZONE: sessão (ET) e dia de pregão (CME) NÃO dependem do fuso de análise", () => {
  for (const tz of [BRT, NY, "UTC"]) {
    const s = aggregateTrades(toAnalyticsTrades(imp.trades), { groupBy: "session", timeZone: tz })
    assert.deepEqual(s.groups.map((g) => [g.key[0], g.sampleSize]), [["OVERNIGHT", 2]], tz) // 19:00 ET e 08:00 ET
    const d = aggregateTrades(toAnalyticsTrades(imp.trades), { groupBy: "tradingDay", timeZone: tz })
    assert.deepEqual(d.groups.map((g) => [g.key[0], g.sampleSize]), [["2026-02-03", 2]], tz)
  }
})

test("TIMEZONE DE ORIGEM é METADADO: informado ⇒ USER; omitido ⇒ padrão do MeuTrade registrado como DEFAULT + aviso (nunca silencioso)", () => {
  const dflt = runImportPipeline(CSV, {})
  assert.equal(dflt.settings!.sourceTz, "America/Sao_Paulo")
  assert.equal(dflt.settings!.sourceTzOrigin, "DEFAULT")
  assert.ok(dflt.issues.some((i) => i.code === "W_SOURCE_TZ_DEFAULTED"))
  assert.equal(dflt.trades[0].source.settings.sourceTzOrigin, "DEFAULT")
  assert.equal(dflt.trades[0].entry.at.instantUtc, mgc.entry.at.instantUtc) // mesmo resultado que informar BRT
  const ny = runImportPipeline(CSV, { sourceTz: NY })
  assert.equal(ny.settings!.sourceTzOrigin, "USER")
  assert.notEqual(ny.trades[0].entry.at.instantUtc, mgc.entry.at.instantUtc) // o fuso de origem muda o instante
  assert.equal(Date.parse(ny.trades[0].entry.at.instantUtc!) - Date.parse(mgc.entry.at.instantUtc!), 2 * 3600 * 1000) // 21:00 em NY (UTC−5) acontece 2 h DEPOIS de 21:00 em SP (UTC−3)
})

// ── retrocompatibilidade ─────────────────────────────────────────────────────

test("RETROCOMPAT: trade canonical-trade/1 (sem campos novos) continua válido e entra nas métricas como linha da fonte", () => {
  const row = imp.rowTrades[0]
  const v1: Record<string, unknown> = { ...row, schemaVersion: "canonical-trade/1" }
  for (const k of ["granularity", "peakQuantity", "entryLegs", "exitLegs", "exitSummary", "reconstruction", "sourceRows"]) delete v1[k]
  const ex = { ...row.excursions } as Record<string, unknown>
  for (const k of ["highPrice", "lowPrice", "conflict", "origin"]) delete ex[k]
  v1.excursions = ex
  const parsed = CanonicalTradeSchema.safeParse(v1)
  assert.equal(parsed.success, true)
  const m = calculateMetrics([{ id: "v1", trade: parsed.data as CanonicalTrade }])
  assert.equal(val(m, "totalTrades"), 1)
  assert.deepEqual(m.dataQuality.granularity, { positionCycles: 0, sourceRows: 1 })
})

test("RETROCOMPAT: formatos sem reconstrução validada (NT8 EN, template) seguem 1 linha = 1 trade, marcados SOURCE_ROW; v2 aceita v1", () => {
  const en = runImportPipeline(readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/ninjatrader-en-trades.csv", import.meta.url)), "utf8"), { sourceTz: BRT })
  assert.deepEqual([en.stats.accepted, en.stats.trades, en.reconstruction], [5, 5, null])
  assert.ok(en.trades.every((t) => t.granularity === "SOURCE_ROW" && t.schemaVersion === "canonical-trade/2" && t.exitLegs === null))
  const tpl = runImportPipeline(readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/meutrade-template.csv", import.meta.url)), "utf8"), {})
  assert.ok(tpl.trades.every((t) => t.granularity === "SOURCE_ROW"))
})

// ── caminho de fills usa o MESMO formato (canonical-trade/2) ─────────────────

const SRC: SourceMetadata = {
  platform: "OTHER", parserId: "synthetic", parserVersion: "0", fileName: null, fileHash: null, rowNo: null, externalId: null,
  settings: { sourceTz: BRT, dateOrder: null, numberLocale: "US", excursionUnit: null, declaredPnlBasis: "UNKNOWN" },
}
const T = (s: string): TimeValue => (parseLocalDateTime(s, { tz: BRT }) as { ok: true; value: TimeValue }).value
let seq = 0
const fill = (side: "BUY" | "SELL", quantity: number, price: number, time: string): CanonicalExecution => ({
  schemaVersion: SCHEMA_EXECUTION, granularity: "FILL", account: "Sim101",
  instrument: { raw: "MNQ 12-26", root: "MNQ", contract: { monthCode: "Z", month: 12, yearDigits: "26" } },
  side, quantity, price, at: T(time), commission: 1, fees: 0, orderId: `O${++seq}`, fillId: `F${seq}`, source: SRC,
})

test("FILLS → o mesmo canonical-trade/2: pernas, tamanho após saída, pico, POSITION_CYCLE e método FILLS_FLAT_TO_FLAT", () => {
  const r = aggregateExecutions([
    fill("BUY", 2, 20000, "2026-02-03 10:00:00"),
    fill("SELL", 1, 20010, "2026-02-03 10:10:00"),
    fill("SELL", 1, 20020, "2026-02-03 10:20:00"),
  ])
  assert.equal(r.trades.length, 1)
  const t = r.trades[0].trade
  assert.equal(CanonicalTradeSchema.safeParse(t).success, true)
  assert.deepEqual([t.granularity, t.schemaVersion, t.peakQuantity, t.reconstruction!.method], ["POSITION_CYCLE", "canonical-trade/2", 2, "FILLS_FLAT_TO_FLAT"])
  assert.deepEqual(t.entryLegs!.map((l) => [l.role, l.quantity, l.granularity]), [["ENTRY", 2, "FILL"]])
  assert.deepEqual(t.exitLegs!.map((l) => [l.role, l.quantity, l.sizeAfter, l.reason, l.reasonRule]), [["SCALE_OUT", 1, 1, "UNKNOWN", "NONE"], ["EXIT", 1, 0, "UNKNOWN", "NONE"]])
  assert.equal(t.reconstruction!.completeness, "UNVERIFIED_HEAD") // 1º ciclo: pode ter começado antes dos dados
  assert.deepEqual(r.trades[0].legs.map((l) => l.role), ["ENTRY", "SCALE_OUT", "EXIT"]) // formato antigo de legs preservado
})

console.log(`\n${passed} testes ok`)
