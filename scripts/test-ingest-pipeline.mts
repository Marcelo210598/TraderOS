// Testes do pipeline de ingestão (Raw → Parser → Normalizer → Validator → CanonicalTrade):
//   node scripts/test-ingest-pipeline.mts
// Usa fixtures SINTÉTICAS (fixtures/_synthetic) — montadas a partir dos cabeçalhos que o importador atual já suporta.
// Elas exercitam o código; NÃO provam o formato real do export (ver fixtures/README.md).
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { toLocal, tradingDay } from "../src/lib/domain/time.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { CanonicalTrade } from "../src/lib/domain/canonical.ts"

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/_synthetic/${name}`, import.meta.url)), "utf8")
const EN = fx("ninjatrader-en-trades.csv")
const PTBR = fx("ninjatrader-ptbr-grid.csv")
const TPL = fx("meutrade-template.csv")

const BRT = "America/Sao_Paulo"
const NY = "America/New_York"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const codes = (t: CanonicalTrade) => t.issues.map((i) => i.code)

// ── NinjaTrader EN ───────────────────────────────────────────────────────────

const en = runImportPipeline(EN, { sourceTz: BRT, fileName: "en.csv", fileHash: "abc123" })

test("EN: formato detectado, 5 linhas lidas, todas aceitas (aviso não rejeita)", () => {
  assert.equal(en.parser?.id, "ninjatrader-trades-en")
  assert.equal(en.stats.rowsRead, 5)
  assert.equal(en.stats.accepted, 5)
  assert.equal(en.stats.rejected, 0)
})

test("EN: A HORA É PRESERVADA — 9:42:10 AM BRT → 12:42:10Z (e não 12:00Z do bug legado)", () => {
  const t = en.trades[0]
  assert.equal(t.entry.at.instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(t.exit.at.instantUtc, "2026-01-15T12:55:30.000Z")
  assert.equal(t.entry.at.precision, "DATETIME")
  assert.notEqual(t.entry.at.instantUtc?.slice(11), "12:00:00.000Z")
  assert.equal(toLocal(t.entry.at.instantUtc!, BRT).time, "09:42:10") // horário local DERIVADO bate com o do arquivo
  assert.equal(toLocal(t.entry.at.instantUtc!, "America/New_York").time, "07:42:10")
})

test("EN: P&L — base inferida pelos preços (GROSS), comissão separada, líquido só de comissão", () => {
  const p = en.trades[0].pnl
  assert.deepEqual(
    [p.reported, p.basis, p.basisSource, p.gross, p.commission, p.fees, p.net, p.netStatus, p.computedGross],
    [80, "GROSS", "INFERRED_FROM_PRICES", 80, 2.4, null, 77.6, "COMMISSION_ONLY", 80],
  )
})

test("EN: short — pontos negativos, bruto negativo, líquido = bruto − comissão", () => {
  const t = en.trades[1]
  assert.equal(t.direction, "SHORT")
  assert.equal(t.pointsPerContract, -10)
  assert.deepEqual([t.pnl.gross, t.pnl.net, t.instrument.root, t.instrument.pointValue], [-200, -204.1, "NQ", 20])
})

test("EN: contrato 'MNQ 03-26' → raiz MNQ, março, ano 26; pointValue do catálogo", () => {
  const i = en.trades[0].instrument
  assert.deepEqual([i.root, i.contract?.month, i.contract?.yearDigits, i.pointValue, i.status], ["MNQ", 3, "26", 2, "KNOWN_ROOT"])
})

test("EN: trade que atravessa a meia-noite (BRT) — duração correta e MESMO dia de pregão", () => {
  const t = en.trades[2]
  assert.equal(t.entry.at.instantUtc, "2026-01-16T02:50:00.000Z")
  assert.equal(t.exit.at.instantUtc, "2026-01-16T03:10:00.000Z")
  assert.notEqual(toLocal(t.entry.at.instantUtc!, BRT).date, toLocal(t.exit.at.instantUtc!, BRT).date)
  assert.equal(tradingDay(t.entry.at.instantUtc!), "2026-01-16")
  assert.equal(tradingDay(t.exit.at.instantUtc!), "2026-01-16")
})

test("EN: instrumento DESCONHECIDO → sem pointValue, sem P&L bruto/líquido, sem R; NADA assumido do NQ", () => {
  const t = en.trades[3]
  assert.deepEqual([t.instrument.root, t.instrument.pointValue, t.instrument.status], [null, null, "UNKNOWN_ROOT"])
  assert.deepEqual([t.pnl.basis, t.pnl.gross, t.pnl.net, t.pnl.computedGross, t.pnl.reported], ["UNKNOWN", null, null, null, 5])
  assert.equal(t.r.net, null)
  assert.equal(t.dataQuality, "PARTIAL")
  assert.ok(codes(t).includes("W_INSTRUMENT_UNKNOWN"))
  assert.ok(codes(t).includes("W_PNL_BASIS_UNKNOWN"))
})

test("EN: base LÍQUIDA inferida linha a linha (profit = bruto − comissão)", () => {
  const p = en.trades[4].pnl
  assert.deepEqual([p.basis, p.basisSource, p.net, p.gross, p.netStatus], ["NET", "INFERRED_FROM_PRICES", 18.8, 20, "COMMISSION_ONLY"])
})

test("EN: MFE/MAE sem unidade conhecida NÃO são gravados como pontos (aviso explícito)", () => {
  const t = en.trades[0]
  assert.deepEqual([t.excursions.mfePoints, t.excursions.maePoints, t.excursions.mfeReason], [null, null, "UNIT_UNKNOWN"])
  assert.ok(codes(t).includes("W_EXCURSION_UNIT_UNKNOWN"))
})

test("EN: com a unidade informada pelo usuário (USD_TOTAL) o MFE/MAE vira pontos por contrato", () => {
  const r = runImportPipeline(EN, { sourceTz: BRT, excursionUnit: "USD_TOTAL" })
  const [a, b, , unknown] = r.trades
  assert.deepEqual([a.excursions.mfePoints, a.excursions.maePoints], [30, 4]) // $120/(2×2), $16/(2×2)
  assert.deepEqual([b.excursions.mfePoints, b.excursions.maePoints], [2, 11.5]) // NQ: $40/20, $230/20
  assert.equal(unknown.excursions.mfeReason, "POINT_VALUE_UNKNOWN") // instrumento desconhecido: não converte
  assert.ok(codes(unknown).includes("W_EXCURSION_UNCONVERTIBLE"))
})

test("EN: dataQuality COMPLETE só quando há horário, pointValue e base de P&L", () => {
  assert.equal(en.trades[0].dataQuality, "COMPLETE")
  assert.equal(en.trades[3].dataQuality, "PARTIAL")
})

test("EN: o fuso de origem muda o instante (mesmo arquivo, NY ≠ BRT) e fica registrado em source.settings", () => {
  const ny = runImportPipeline(EN, { sourceTz: NY })
  assert.equal(ny.trades[0].entry.at.instantUtc, "2026-01-15T14:42:10.000Z")
  assert.equal(ny.trades[0].source.settings.sourceTz, NY)
  assert.equal(en.trades[0].source.settings.sourceTz, BRT)
})

test("EN: SEM fuso informado → vale o PADRÃO do MeuTrade (America/Sao_Paulo), REGISTRADO como metadado e AVISADO (nada silencioso)", () => {
  const r = runImportPipeline(EN, {})
  assert.equal(r.stats.accepted, 5)
  assert.equal(r.settings?.sourceTz, "America/Sao_Paulo")
  assert.equal(r.settings?.sourceTzOrigin, "DEFAULT")
  assert.ok(r.issues.some((i) => i.code === "W_SOURCE_TZ_DEFAULTED"))
  // o metadado vai em CADA trade (auditável) e o resultado é idêntico ao de informar o mesmo fuso explicitamente
  assert.equal(r.trades[0].source.settings.sourceTzOrigin, "DEFAULT")
  assert.equal(r.trades[0].entry.at.instantUtc, en.trades[0].entry.at.instantUtc)
  // informado pelo usuário ⇒ origem USER e sem aviso
  assert.equal(en.settings?.sourceTzOrigin, "USER")
  assert.ok(!en.issues.some((i) => i.code === "W_SOURCE_TZ_DEFAULTED"))
  assert.equal(en.trades[0].source.settings.sourceTzOrigin, "USER")
})

test("EN: proveniência — fileName/fileHash/rowNo/parserVersion gravados em cada trade", () => {
  const s = en.trades[0].source
  assert.deepEqual([s.fileName, s.fileHash, s.rowNo, s.parserId, s.parserVersion, s.platform], ["en.csv", "abc123", 2, "ninjatrader-trades-en", "1.0.0", "NINJATRADER"])
})

// ── NinjaTrader PT-BR ────────────────────────────────────────────────────────

const pt = runImportPipeline(PTBR, { sourceTz: BRT })

test("PT-BR: formato detectado; números BR, datas DMY, hora preservada", () => {
  assert.equal(pt.parser?.id, "ninjatrader-trades-ptbr")
  assert.equal(pt.stats.accepted, 3)
  const t = pt.trades[0]
  assert.deepEqual([t.entry.price, t.exit.price, t.quantity, t.direction], [21450, 21470, 2, "LONG"])
  assert.equal(t.entry.at.instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(t.exit.at.instantUtc, "2026-01-15T12:55:30.000Z")
})

test("PT-BR: Corretagem = commission; taxas (compensação+bolsa+IP+NFA) = fees; líquido COMPLETE", () => {
  const p = pt.trades[0].pnl
  assert.deepEqual([p.commission, p.fees, p.basis, p.gross, p.net, p.netStatus], [1.4, 1, "GROSS", 80, 77.6, "COMPLETE"])
})

test("PT-BR: 'Profit' negativo já LÍQUIDO é reconhecido pelos preços (−204,10 = −200 − custos 4,10)", () => {
  const t = pt.trades[1]
  assert.deepEqual([t.direction, t.pnl.basis, t.pnl.basisSource, t.pnl.net, t.pnl.gross, t.pnl.commission, t.pnl.fees], ["SHORT", "NET", "INFERRED_FROM_PRICES", -204.1, -200, 2.5, 1.6])
})

test("PT-BR: MAE/MFE em dólar (padrão do formato) → pontos por contrato usando o pointValue CORRETO de cada ativo", () => {
  assert.deepEqual([pt.trades[0].excursions.mfePoints, pt.trades[0].excursions.maePoints], [30, 4]) // MNQ ×2: $/(2×2)
  assert.deepEqual([pt.trades[1].excursions.mfePoints, pt.trades[1].excursions.maePoints], [2, 11.5]) // NQ ×1: $/20
  assert.equal(pt.trades[0].issues.some((i) => i.code.startsWith("W_M")), false) // coerentes com o resultado
})

test("PT-BR: overnight atravessando a meia-noite", () => {
  const t = pt.trades[2]
  assert.equal(t.entry.at.instantUtc, "2026-01-16T02:50:00.000Z")
  assert.equal(t.exit.at.instantUtc, "2026-01-16T03:10:00.000Z")
})

test("PT-BR: conta e estratégia preservadas", () => {
  assert.deepEqual([pt.trades[0].account.sourceName, pt.trades[0].labels.strategyName], ["Sim101", "ORB"])
})

// ── Template MeuTrade (só data) ──────────────────────────────────────────────

const tpl = runImportPipeline(TPL, {})

test("Template (só data): DATE_ONLY, instante NULO — nenhuma hora fabricada, nenhum 12:00Z", () => {
  assert.equal(tpl.stats.accepted, 3)
  for (const t of tpl.trades) {
    assert.equal(t.entry.at.precision, "DATE_ONLY")
    assert.equal(t.entry.at.instantUtc, null)
    assert.equal(t.exit.at.instantUtc, null)
    assert.ok(codes(t).includes("W_TIME_DATE_ONLY"))
  }
  assert.equal(tpl.trades[0].entry.at.localDate, "2025-01-15")
  assert.equal(tpl.trades[0].sessionHint, "AM")
  assert.equal(tpl.trades[1].sessionHint, "PM")
})

test("Template: o validador acusa que os números de exemplo do PRÓPRIO template não reconciliam com os preços", () => {
  // 19500→19550 NQ ×1 = 50 pts × $20 = $1.000, mas o exemplo diz pnl 250 → base desconhecida, bruto/líquido NULL.
  const t = tpl.trades[0]
  assert.deepEqual([t.pnl.computedGross, t.pnl.reported, t.pnl.basis, t.pnl.net], [1000, 250, "UNKNOWN", null])
  assert.ok(codes(t).includes("W_PNL_NOT_RECONCILABLE"))
})

// ── Detecção de formato e erros de arquivo ───────────────────────────────────

test("formato desconhecido → erro explícito listando os cabeçalhos (não escolhe 'o mais parecido')", () => {
  const r = runImportPipeline("coluna_a,coluna_b\n1,2\n", {})
  assert.equal(r.parser, null)
  assert.equal(r.issues[0].code, "E_FORMAT_UNKNOWN")
  assert.ok(r.issues[0].message.includes("coluna_a"))
})

test("parser forçado inexistente / arquivo vazio", () => {
  assert.equal(runImportPipeline(EN, { sourceTz: BRT, forceParserId: "nao-existe" }).issues[0].code, "E_PARSER_NOT_FOUND")
  assert.equal(runImportPipeline("  \n", {}).issues[0].code, "E_FILE_EMPTY")
})

// ── linhas inválidas: rejeitadas sem derrubar as boas ────────────────────────

test("linhas ruins são rejeitadas com código e número da linha; as boas passam", () => {
  const csv = [
    "Instrument,Market pos.,Quantity,Entry price,Exit price,Entry time,Exit time,Profit,Commission",
    "MNQ 03-26,Long,1,21450.00,21460.00,1/15/2026 9:42:10 AM,1/15/2026 9:50:00 AM,20.00,1.20", // ok
    "MNQ 03-26,Sideways,1,21450.00,21460.00,1/15/2026 9:42:10 AM,1/15/2026 9:50:00 AM,20.00,1.20", // direção
    "MNQ 03-26,Long,0,21450.00,21460.00,1/15/2026 9:42:10 AM,1/15/2026 9:50:00 AM,20.00,1.20", // qty
    "MNQ 03-26,Long,1,21450.00,21460.00,1/15/2026 9:50:00 AM,1/15/2026 9:42:10 AM,20.00,1.20", // saída antes da entrada
    "MNQ 03-26,Long,1,abc,21460.00,1/15/2026 9:42:10 AM,1/15/2026 9:50:00 AM,20.00,1.20", // preço
    "MNQ 03-26,Long,1,21450.00,21460.00,not-a-date,1/15/2026 9:50:00 AM,20.00,1.20", // data
  ].join("\n")
  const r = runImportPipeline(csv, { sourceTz: NY })
  assert.equal(r.stats.accepted, 1)
  assert.equal(r.stats.rejected, 5)
  const by = (row: number) => r.rejected.find((x) => x.rowNo === row)!.issues.map((i) => i.code)
  assert.ok(by(3).includes("E_DIRECTION_INVALID"))
  assert.ok(by(4).includes("E_QUANTITY_INVALID"))
  assert.ok(by(5).includes("E_TIME_ORDER"))
  assert.ok(by(6).some((c) => c.startsWith("E_NUMBER")))
  assert.ok(by(7).includes("E_TIME_FORMAT"))
})

test("ordem de data ambígua no template NÃO é chutada (rejeita e pede a ordem)", () => {
  const amb = ["date,instrument,direction,entry_price,exit_price,quantity,pnl", "03/04/2026,NQ,LONG,100,101,1,20", "05/06/2026,NQ,LONG,100,101,1,20"].join("\n")
  const r = runImportPipeline(amb, {})
  assert.equal(r.stats.accepted, 0)
  assert.ok(r.issues.some((i) => i.code === "E_DATE_ORDER_REQUIRED"))
  const ok = runImportPipeline(amb, { dateOrder: "DMY" })
  assert.equal(ok.stats.accepted, 2)
  assert.equal(ok.trades[0].entry.at.localDate, "2026-04-03")
})

test("data com dia > 12 num arquivo inteiro permite inferir a ordem (DMY) sem dica", () => {
  const csv = ["date,instrument,direction,entry_price,exit_price,quantity,pnl", "03/04/2026,NQ,LONG,100,101,1,20", "15/04/2026,NQ,LONG,100,101,1,20"].join("\n")
  const r = runImportPipeline(csv, {})
  assert.equal(r.stats.accepted, 2)
  assert.equal(r.settings?.dateOrder, "DMY")
  assert.equal(r.trades[0].entry.at.localDate, "2026-04-03")
})

test("todo trade aceito já cumpre o schema canônico (Zod) e tem schemaVersion v2", () => {
  for (const t of [...en.trades, ...pt.trades, ...tpl.trades]) assert.equal(t.schemaVersion, "canonical-trade/2")
})

console.log(`\n${passed} testes ok`)
