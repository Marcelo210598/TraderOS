// Fundação de timezone universal: node scripts/test-timezone-universal.mts
// Quatro conceitos independentes: storage (UTC) · source (interpreta horário sem offset) · analysis (preferência do usuário) · market (CME).
import assert from "node:assert/strict"
import { SourceMetadataSchema } from "../src/lib/domain/canonical.ts"
import {
  DEFAULT_ANALYSIS_TIME_ZONE,
  DEFAULT_SOURCE_TIME_ZONE,
  parseLocalDateTime,
  toLocal,
  type SourceTzOrigin,
  type TimeValue,
} from "../src/lib/domain/time.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { aggregateTrades, calculateMetrics } from "../src/lib/metrics/calculate.ts"
import { toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { BRT, NY, SRC, mk } from "./_metrics-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const T = (s: string, tz?: string): TimeValue => {
  const r = parseLocalDateTime(s, { tz })
  assert.equal(r.ok, true, s)
  return (r as { ok: true; value: TimeValue }).value
}

// Mesmo instante (2026-01-15T14:30:00Z): 11:30 em SP (UTC−3) = 09:30 em NY (UTC−5).
const INSTANT = "2026-01-15T14:30:00.000Z"
const NT8 = "Num;Ativo;Conta;Estrategia;Pos mercado.;Qtd;Preco entrada;Preco saida;Hora entrada;Hora saida;Profit;Corretagem\n1;MNQ 03-26;Sim101;;Comprada;1;21000;21010;15/01/2026 11:30:00;15/01/2026 11:45:00;$ 18,80;$ 1,20\n"

// o mesmo arquivo, mas com offset explícito (-03:00) em TODOS os horários
const WITH_OFFSET = NT8.replace("11:30:00", "11:30:00-03:00").replace("11:45:00", "11:45:00-03:00")

test("A) fonte SP + análise NY: mesmo instantUtc; a hora de análise é a de NY", () => {
  const imp = runImportPipeline(NT8, { sourceTz: BRT })
  assert.equal(imp.trades[0].entry.at.instantUtc, INSTANT)
  const g = aggregateTrades(toAnalyticsTrades(imp.trades), { groupBy: "hour", timeZone: NY })
  assert.deepEqual(g.groups.map((x) => x.key[0]), ["09"])
})

test("B) fonte NY + análise SP: mesmo instante; a hora de análise é a de SP", () => {
  const nyText = NT8.replace("11:30:00", "09:30:00").replace("11:45:00", "09:45:00")
  const imp = runImportPipeline(nyText, { sourceTz: NY })
  assert.equal(imp.trades[0].entry.at.instantUtc, INSTANT) // 09:30 NY == 11:30 SP
  const g = aggregateTrades(toAnalyticsTrades(imp.trades), { groupBy: "hour", timeZone: BRT })
  assert.deepEqual(g.groups.map((x) => x.key[0]), ["11"])
})

test("C) trocar SÓ o analysisTimezone: P&L, quantidade e sequência idênticos; hora/dia reagrupam", () => {
  const trades = [
    mk({ id: "a", direction: "LONG", entry: 21000, exit: 21020, entryAt: "2026-01-12 18:30:00", exitAt: "2026-01-12 18:50:00", tz: "UTC", qty: 2 }), // 18:30Z
    mk({ id: "b", direction: "SHORT", entry: 21050, exit: 21060, entryAt: "2026-01-12 23:30:00", exitAt: "2026-01-12 23:45:00", tz: "UTC" }), // 23:30Z
    mk({ id: "c", direction: "LONG", entry: 21070, exit: 21090, entryAt: "2026-01-13 01:00:00", exitAt: "2026-01-13 01:10:00", tz: "UTC" }),
  ]
  const tzs = [BRT, NY, "Europe/Berlin", "Asia/Tokyo"]
  const ids = ["netPnl", "grossPnl", "commission", "totalTrades", "maxDrawdown", "maxConsecutiveLosses", "maxConsecutiveWins"]
  const rs = tzs.map((timeZone) => calculateMetrics(trades, { timeZone }))
  for (const r of rs) for (const id of ids) assert.deepEqual(r.metrics[id].value, rs[0].metrics[id].value, id)
  const qty = (tz: string) => trades.map((t) => t.trade.quantity)
  assert.deepEqual(qty(BRT), qty("Asia/Tokyo"))
  assert.deepEqual(trades.map((t) => t.trade.entry.at.instantUtc), ["2026-01-12T18:30:00.000Z", "2026-01-12T23:30:00.000Z", "2026-01-13T01:00:00.000Z"]) // UTC imutável
  // agrupamento por dia muda: o trade de 23:30Z é 12/01 em SP/NY e 13/01 em Berlim e Tóquio
  const keys = (tz: string, by: "hour" | "day") => aggregateTrades(trades, { groupBy: by, timeZone: tz }).groups.map((x) => x.key[0])
  assert.deepEqual(keys(NY, "hour"), ["13", "18", "20"])
  assert.deepEqual(keys("Asia/Tokyo", "hour"), ["03", "08", "10"])
  assert.deepEqual(keys(NY, "day"), ["2026-01-12"]) // 13:30, 18:30 e 20:00 locais, todos em 12/01
  assert.deepEqual(keys("Asia/Tokyo", "day"), ["2026-01-13"]) // 03:30, 08:30 e 10:00 locais, todos em 13/01
  assert.deepEqual(keys("Europe/Berlin", "day"), ["2026-01-12", "2026-01-13"]) // 19:30 e 00:30 de 13
  // mercado NÃO muda com o fuso do usuário
  const mk2 = (tz: string, by: "session" | "tradingDay") => aggregateTrades(trades, { groupBy: by, timeZone: tz }).groups.map((x) => [x.key[0], x.sampleSize])
  for (const by of ["session", "tradingDay"] as const) assert.deepEqual(mk2(BRT, by), mk2("Asia/Tokyo", by), by)
})

test("D) offset explícito (-03:00): instante independe do DEFAULT_SOURCE_TIME_ZONE e do sourceTz; sem sourceTz no TimeValue", () => {
  const withOffset = T("2026-01-15 11:30:00-03:00") // sem tz de origem algum: não exige
  assert.equal(withOffset.instantUtc, INSTANT)
  assert.deepEqual([withOffset.explicitOffset, withOffset.sourceTz], [true, null])
  for (const tz of [NY, "Asia/Tokyo", DEFAULT_SOURCE_TIME_ZONE]) {
    const v = parseLocalDateTime("2026-01-15 11:30:00-03:00", { tz })
    assert.equal((v as { ok: true; value: TimeValue }).value.instantUtc, INSTANT, tz)
  }
  // e sem offset NÃO converte sem fuso explícito
  assert.equal(parseLocalDateTime("2026-01-15 11:30:00", {}).ok, false)
})

test("E) sourceTzOrigin: USER, DEFAULT, FILE_OFFSET (arquivo, linha e metadado) e FILE_DECLARED (só estrutura)", () => {
  const user = runImportPipeline(NT8, { sourceTz: NY })
  assert.deepEqual([user.settings!.sourceTzOrigin, user.trades[0].source.settings.sourceTzOrigin, user.settings!.sourceTz], ["USER", "USER", NY])
  assert.ok(!user.issues.some((i) => i.code === "W_SOURCE_TZ_DEFAULTED"))

  const def = runImportPipeline(NT8, {})
  assert.deepEqual([def.settings!.sourceTzOrigin, def.settings!.sourceTz], ["DEFAULT", DEFAULT_SOURCE_TIME_ZONE])
  const w = def.issues.find((i) => i.code === "W_SOURCE_TZ_DEFAULTED")!
  assert.ok(w)
  assert.ok(!/trader|Brasil|MeuTrade/i.test(w.message), w.message) // neutra: não trata um fuso como "o do trader"
  assert.match(w.message, /padrão configurado/)

  // arquivo com offset em TODOS os horários, sem fuso informado: instante pelo offset; a origem NÃO é o padrão
  const off = runImportPipeline(WITH_OFFSET, {})
  assert.equal(off.stats.accepted, 1)
  assert.equal(off.trades[0].entry.at.instantUtc, INSTANT)
  assert.equal(off.trades[0].entry.at.sourceTz, null)
  assert.deepEqual([off.settings!.sourceTzOrigin, off.settings!.sourceTz, off.trades[0].source.settings.sourceTzOrigin, off.trades[0].source.settings.sourceTz], ["FILE_OFFSET", null, "FILE_OFFSET", null])
  assert.ok(!off.issues.some((i) => i.code === "W_SOURCE_TZ_DEFAULTED")) // não houve suposição

  // com offset + sourceTz informado: continua USER (o instante segue o offset, o TimeValue mostra explicitOffset)
  const both = runImportPipeline(WITH_OFFSET, { sourceTz: NY })
  assert.equal(both.settings!.sourceTzOrigin, "USER")
  assert.equal(both.trades[0].entry.at.instantUtc, INSTANT)
  assert.equal(both.trades[0].entry.at.explicitOffset, true)

  // FILE_DECLARED: sem parser real ⇒ só o contrato aceita o valor
  const declared: SourceTzOrigin = "FILE_DECLARED"
  const parsed = SourceMetadataSchema.safeParse({ ...SRC, settings: { ...SRC.settings, sourceTzOrigin: declared } })
  assert.equal(parsed.success, true)
  assert.equal(SourceMetadataSchema.safeParse({ ...SRC, settings: { ...SRC.settings, sourceTzOrigin: "OUTRO" } }).success, false)
  for (const t of [user, def, off, both]) assert.notEqual(t.settings!.sourceTzOrigin, "FILE_DECLARED") // nenhum parser real emite FILE_DECLARED
})

test("F) DST via IANA (nada de offset fixo): NY inverno −5 / verão −4; Londres e Berlim mudam; SP sem DST", () => {
  const instants = (tz: string, a: string, b: string) => [T(a, tz).instantUtc, T(b, tz).instantUtc]
  assert.deepEqual(instants(NY, "2026-01-15 09:30:00", "2026-07-15 09:30:00"), ["2026-01-15T14:30:00.000Z", "2026-07-15T13:30:00.000Z"])
  assert.deepEqual(instants("Europe/London", "2026-01-15 09:30:00", "2026-07-15 09:30:00"), ["2026-01-15T09:30:00.000Z", "2026-07-15T08:30:00.000Z"])
  assert.deepEqual(instants("Europe/Berlin", "2026-01-15 09:30:00", "2026-07-15 09:30:00"), ["2026-01-15T08:30:00.000Z", "2026-07-15T07:30:00.000Z"])
  assert.deepEqual(instants("Asia/Tokyo", "2026-01-15 09:30:00", "2026-07-15 09:30:00"), ["2026-01-15T00:30:00.000Z", "2026-07-15T00:30:00.000Z"])
  assert.deepEqual(instants(BRT, "2026-01-15 09:30:00", "2026-07-15 09:30:00"), ["2026-01-15T12:30:00.000Z", "2026-07-15T12:30:00.000Z"])
  // a diferença SP↔NY varia ao longo do ano (2 h no inverno americano, 1 h no verão): por isso offset fixo é proibido
  const gap = (utc: string) => toLocal(utc, BRT).hour - toLocal(utc, NY).hour
  assert.deepEqual([gap("2026-01-15T14:30:00Z"), gap("2026-07-15T14:30:00Z")], [2, 1])
  // transições: hora inexistente é rejeitada; hora repetida é registrada
  assert.equal(parseLocalDateTime("2026-03-08 02:30:00", { tz: NY }).ok, false)
  assert.equal(T("2026-11-01 01:30:00", NY).ambiguity, "FOLD_EARLIER_ASSUMED")
  assert.equal(parseLocalDateTime("2026-01-15 09:30:00", { tz: "UTC-5" }).ok, false) // offset fixo não é IANA
})

test("defaults: constantes independentes, mesmo valor inicial; análise ecoada", () => {
  assert.equal(DEFAULT_SOURCE_TIME_ZONE, "America/Sao_Paulo")
  assert.equal(DEFAULT_ANALYSIS_TIME_ZONE, "America/Sao_Paulo")
  const m = calculateMetrics([mk({ id: "x", direction: "LONG", entry: 1, exit: 2, entryAt: "2026-01-12 10:00:00", exitAt: "2026-01-12 10:05:00" })])
  assert.equal(m.query.options.timeZone, DEFAULT_ANALYSIS_TIME_ZONE)
})

console.log(`\n${passed} testes ok`)
