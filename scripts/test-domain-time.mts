// Testes de tempo/fuso do domínio (sem framework): node scripts/test-domain-time.mts
// Cobre o BUG CRÍTICO do horário: hora descartada → 12:00Z → 09:00 BRT.
import assert from "node:assert/strict"
import {
  addDays,
  durationSeconds,
  inferDateOrder,
  legacySessionType,
  parseLocalDateTime,
  toLocal,
  tradingDay,
  zoneOffsetMinutes,
  type TimeParseResult,
  type TimeValue,
} from "../src/lib/domain/time.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

function ok(r: TimeParseResult): TimeValue {
  assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.message}`)
  return (r as { ok: true; value: TimeValue }).value
}
function err(r: TimeParseResult): string {
  assert.equal(r.ok, false, "era pra falhar")
  return (r as { ok: false; code: string }).code
}

const BRT = "America/Sao_Paulo"
const NY = "America/New_York"
const CT = "America/Chicago"

// ── offsets ──────────────────────────────────────────────────────────────────

test("offsets: BRT -180 (sem verão desde 2019), NY -300/-240, Chicago -360", () => {
  assert.equal(zoneOffsetMinutes(BRT, Date.parse("2026-01-15T12:00:00Z")), -180)
  assert.equal(zoneOffsetMinutes(NY, Date.parse("2026-01-15T12:00:00Z")), -300)
  assert.equal(zoneOffsetMinutes(NY, Date.parse("2026-07-15T12:00:00Z")), -240)
  assert.equal(zoneOffsetMinutes(CT, Date.parse("2026-01-15T12:00:00Z")), -360)
  assert.equal(zoneOffsetMinutes("UTC", Date.parse("2026-01-15T12:00:00Z")), 0)
})

// ── horário BRT / UTC / NY ───────────────────────────────────────────────────

test("BRT: '15/01/2026 09:42:10' (DMY) → 12:42:10Z (a HORA É PRESERVADA, não vira 12:00Z)", () => {
  const v = ok(parseLocalDateTime("15/01/2026 09:42:10", { dateOrder: "DMY", tz: BRT }))
  assert.equal(v.instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(v.precision, "DATETIME")
  assert.equal(v.sourceTz, BRT)
  assert.equal(v.localDate, "2026-01-15")
})

test("UTC: mesma hora de parede, mesmo instante", () => {
  const v = ok(parseLocalDateTime("2026-01-15 09:42:10", { tz: "UTC" }))
  assert.equal(v.instantUtc, "2026-01-15T09:42:10.000Z")
})

test("NY inverno (EST) e verão (EDT) em AM/PM no formato do NT8 EN", () => {
  assert.equal(ok(parseLocalDateTime("1/15/2026 9:42:10 AM", { dateOrder: "MDY", tz: NY })).instantUtc, "2026-01-15T14:42:10.000Z")
  assert.equal(ok(parseLocalDateTime("7/15/2026 9:42:10 AM", { dateOrder: "MDY", tz: NY })).instantUtc, "2026-07-15T13:42:10.000Z")
})

test("AM/PM: 12 AM = 00h, 12 PM = 12h, 11:59:59 PM = 23:59:59", () => {
  const f = (s: string) => ok(parseLocalDateTime(s, { dateOrder: "MDY", tz: "UTC" })).instantUtc
  assert.equal(f("1/15/2026 12:00:00 AM"), "2026-01-15T00:00:00.000Z")
  assert.equal(f("1/15/2026 12:30:00 PM"), "2026-01-15T12:30:00.000Z")
  assert.equal(f("1/15/2026 11:59:59 PM"), "2026-01-15T23:59:59.000Z")
  assert.equal(f("1/15/2026 1:05:00 PM"), "2026-01-15T13:05:00.000Z")
})

test("mesmo texto, fusos de origem diferentes → instantes diferentes (o fuso importa)", () => {
  const a = ok(parseLocalDateTime("2026-01-15 09:42:10", { tz: BRT })).instantUtc
  const b = ok(parseLocalDateTime("2026-01-15 09:42:10", { tz: NY })).instantUtc
  assert.notEqual(a, b)
  assert.equal(Date.parse(b!) - Date.parse(a!), 2 * 3600 * 1000) // BRT(-3) vs EST(-5)
})

// ── horário de verão histórico ───────────────────────────────────────────────

test("verão histórico do Brasil: dez/2018 = UTC-2; fev/2019 (ainda verão) = UTC-2; mar/2019 = UTC-3", () => {
  assert.equal(ok(parseLocalDateTime("2018-12-15 12:00:00", { tz: BRT })).instantUtc, "2018-12-15T14:00:00.000Z")
  assert.equal(ok(parseLocalDateTime("2019-02-16 12:00:00", { tz: BRT })).instantUtc, "2019-02-16T14:00:00.000Z")
  assert.equal(ok(parseLocalDateTime("2019-03-01 12:00:00", { tz: BRT })).instantUtc, "2019-03-01T15:00:00.000Z")
  assert.equal(ok(parseLocalDateTime("2020-01-15 12:00:00", { tz: BRT })).instantUtc, "2020-01-15T15:00:00.000Z") // sem verão
})

test("verão histórico do Brasil: fim do verão repete 23:30 de 16/02/2019 (ambíguo, sinalizado)", () => {
  const early = ok(parseLocalDateTime("2019-02-16 23:30:00", { tz: BRT })) // padrão EARLIER = ainda UTC-2
  assert.equal(early.instantUtc, "2019-02-17T01:30:00.000Z")
  assert.equal(early.ambiguity, "FOLD_EARLIER_ASSUMED")
  const late = ok(parseLocalDateTime("2019-02-16 23:30:00", { tz: BRT, foldPolicy: "LATER" }))
  assert.equal(late.instantUtc, "2019-02-17T02:30:00.000Z")
  assert.equal(late.ambiguity, "FOLD_LATER_ASSUMED")
})

test("verão histórico do Brasil: início do verão 04/11/2018 pula 00:00→01:00 (00:30 não existe)", () => {
  assert.equal(err(parseLocalDateTime("2018-11-04 00:30:00", { tz: BRT })), "E_TIME_GAP")
})

test("EUA: spring forward (02:30 de 08/03/2026 não existe) e fall back (01:30 de 01/11/2026 é ambíguo)", () => {
  assert.equal(err(parseLocalDateTime("2026-03-08 02:30:00", { tz: NY })), "E_TIME_GAP")
  const f = ok(parseLocalDateTime("2026-11-01 01:30:00", { tz: NY }))
  assert.equal(f.instantUtc, "2026-11-01T05:30:00.000Z") // EDT, 1ª ocorrência
  assert.equal(f.ambiguity, "FOLD_EARLIER_ASSUMED")
  assert.equal(ok(parseLocalDateTime("2026-11-01 01:30:00", { tz: NY, foldPolicy: "LATER" })).instantUtc, "2026-11-01T06:30:00.000Z")
  // hora normal na mesma data não é ambígua
  assert.equal(ok(parseLocalDateTime("2026-11-01 10:00:00", { tz: NY })).ambiguity, "NONE")
})

// ── offset explícito (AddOn/ISO) ─────────────────────────────────────────────

test("offset explícito: -03:00, Z e +0530 viram o mesmo instante absoluto, sem precisar de tz", () => {
  assert.equal(ok(parseLocalDateTime("2026-01-15T09:42:10-03:00")).instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(ok(parseLocalDateTime("2026-01-15T12:42:10Z")).instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(ok(parseLocalDateTime("2026-01-15T18:12:10+0530")).instantUtc, "2026-01-15T12:42:10.000Z")
  assert.equal(ok(parseLocalDateTime("2026-01-15T09:42:10-03:00")).explicitOffset, true)
})

test("ISO do AddOn NT8 ('o' com 7 casas, SEM offset) exige fuso — não é tratado como UTC em silêncio", () => {
  assert.equal(err(parseLocalDateTime("2026-01-15T09:42:10.0000000")), "E_TZ_REQUIRED")
  const v = ok(parseLocalDateTime("2026-01-15T09:42:10.1234567", { tz: BRT }))
  assert.equal(v.instantUtc, "2026-01-15T12:42:10.123Z")
})

// ── DATE_ONLY: nunca inventar hora ───────────────────────────────────────────

test("só data → DATE_ONLY, instante NULO (nunca 12:00Z)", () => {
  for (const [txt, order] of [["2026-01-15", undefined], ["01/15/2026", "MDY"], ["15/01/2026", "DMY"]] as const) {
    const v = ok(parseLocalDateTime(txt, { dateOrder: order, tz: BRT }))
    assert.equal(v.precision, "DATE_ONLY", txt)
    assert.equal(v.instantUtc, null, txt)
    assert.equal(v.localDate, "2026-01-15", txt)
  }
})

test("REGRESSÃO do bug: o legado (data + 'T12:00:00.000Z') produz 09:00 BRT; o domínio novo não fabrica instante", () => {
  const legado = "2026-01-15" + "T12:00:00.000Z" // o que o importador atual grava
  assert.equal(toLocal(legado, BRT).time, "09:00:00") // por isso TODO trade de CSV caía em 09:00 BRT
  const novo = ok(parseLocalDateTime("2026-01-15", { tz: BRT }))
  assert.equal(novo.instantUtc, null)
})

// ── ordem de data ────────────────────────────────────────────────────────────

test("data ambígua sem ordem → erro (não adivinha); com ordem → resultados diferentes", () => {
  assert.equal(err(parseLocalDateTime("03/04/2026 10:00:00", { tz: "UTC" })), "E_DATE_ORDER_REQUIRED")
  assert.equal(ok(parseLocalDateTime("03/04/2026 10:00:00", { dateOrder: "DMY", tz: "UTC" })).localDate, "2026-04-03")
  assert.equal(ok(parseLocalDateTime("03/04/2026 10:00:00", { dateOrder: "MDY", tz: "UTC" })).localDate, "2026-03-04")
})

test("data inequívoca é aceita sem dica (15/01 só pode ser DMY; 01/15 só pode ser MDY); dia=mês também", () => {
  assert.equal(ok(parseLocalDateTime("15/01/2026 10:00:00", { tz: "UTC" })).localDate, "2026-01-15")
  assert.equal(ok(parseLocalDateTime("01/15/2026 10:00:00", { tz: "UTC" })).localDate, "2026-01-15")
  assert.equal(ok(parseLocalDateTime("05/05/2026 10:00:00", { tz: "UTC" })).localDate, "2026-05-05")
})

test("dica errada produz erro de data inválida (15 não é mês)", () => {
  assert.equal(err(parseLocalDateTime("15/01/2026 10:00:00", { dateOrder: "MDY", tz: "UTC" })), "E_DATE_INVALID")
})

test("inferDateOrder: decide pelo ARQUIVO, nunca por uma linha ambígua", () => {
  assert.equal(inferDateOrder(["15/01/2026 10:00", "03/04/2026 11:00"]), "DMY")
  assert.equal(inferDateOrder(["01/15/2026 10:00", "03/04/2026 11:00"]), "MDY")
  assert.equal(inferDateOrder(["03/04/2026 11:00", "05/06/2026 12:00"]), null)
  assert.equal(inferDateOrder(["15/01/2026", "01/15/2026"]), null) // inconsistente
  assert.equal(inferDateOrder(["2026-01-15 10:00"]), "YMD")
})

// ── erros ────────────────────────────────────────────────────────────────────

test("erros: vazio, lixo, data/hora inválidas, sem fuso, fuso inválido", () => {
  assert.equal(err(parseLocalDateTime("")), "E_TIME_EMPTY")
  assert.equal(err(parseLocalDateTime(null)), "E_TIME_EMPTY")
  assert.equal(err(parseLocalDateTime("ontem de manhã")), "E_TIME_FORMAT")
  assert.equal(err(parseLocalDateTime("31/02/2026 10:00:00", { dateOrder: "DMY", tz: "UTC" })), "E_DATE_INVALID")
  assert.equal(err(parseLocalDateTime("2026-01-15 25:00:00", { tz: "UTC" })), "E_DATE_INVALID")
  assert.equal(err(parseLocalDateTime("2026-01-15 10:61:00", { tz: "UTC" })), "E_DATE_INVALID")
  assert.equal(err(parseLocalDateTime("1/15/2026 13:00:00 PM", { dateOrder: "MDY", tz: "UTC" })), "E_DATE_INVALID")
  assert.equal(err(parseLocalDateTime("2026-01-15 10:00:00")), "E_TZ_REQUIRED")
  assert.equal(err(parseLocalDateTime("2026-01-15 10:00:00", { tz: "Mars/Olympus" })), "E_TZ_INVALID")
})

// ── derivados: horário local só p/ exibição/análise ──────────────────────────

test("toLocal: mesmo instante em BRT, NY e Chicago (+ dia da semana)", () => {
  const t = "2026-01-15T12:42:10.000Z" // quinta
  assert.equal(toLocal(t, BRT).iso, "2026-01-15T09:42:10-03:00")
  assert.equal(toLocal(t, NY).iso, "2026-01-15T07:42:10-05:00")
  assert.equal(toLocal(t, CT).iso, "2026-01-15T06:42:10-06:00")
  assert.equal(toLocal(t, BRT).weekday, 4)
})

test("toLocal: o dia civil muda conforme o fuso (virada de dia)", () => {
  const t = "2026-01-15T02:30:00.000Z"
  assert.equal(toLocal(t, BRT).date, "2026-01-14")
  assert.equal(toLocal(t, "UTC").date, "2026-01-15")
  assert.equal(toLocal(t, BRT).time, "23:30:00")
})

test("addDays atravessa mês e ano", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01")
  assert.equal(addDays("2026-12-31", 1), "2027-01-01")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
})

test("durationSeconds", () => {
  assert.equal(durationSeconds("2026-01-15T12:00:00.000Z", "2026-01-15T12:20:00.000Z"), 1200)
  assert.equal(durationSeconds(null, "2026-01-15T12:20:00.000Z"), null)
})

// ── dia de pregão / overnight / virada de dia ────────────────────────────────

const ct = (s: string) => ok(parseLocalDateTime(s, { tz: CT })).instantUtc!

test("tradingDay (CME): depois das 17:00 CT já é o pregão do dia seguinte", () => {
  assert.equal(tradingDay(ct("2026-01-14 09:00:00")), "2026-01-14") // quarta
  assert.equal(tradingDay(ct("2026-01-14 16:59:00")), "2026-01-14")
  assert.equal(tradingDay(ct("2026-01-14 17:00:00")), "2026-01-15")
  assert.equal(tradingDay(ct("2026-01-14 23:30:00")), "2026-01-15")
  assert.equal(tradingDay(ct("2026-01-15 00:30:00")), "2026-01-15") // madrugada pertence ao mesmo pregão
})

test("tradingDay: domingo 17:00 CT abre o pregão de segunda; sex 17:00+ / sáb / dom<17h = fechado (null)", () => {
  assert.equal(tradingDay(ct("2026-01-18 18:30:00")), "2026-01-19") // domingo à noite → segunda
  assert.equal(tradingDay(ct("2026-01-16 17:30:00")), null) // sexta após o fechamento
  assert.equal(tradingDay(ct("2026-01-17 12:00:00")), null) // sábado
  assert.equal(tradingDay(ct("2026-01-18 10:00:00")), null) // domingo antes da abertura
})

test("sessão overnight: entrada dom 18:30 CT e saída seg 09:00 CT → MESMO dia de pregão", () => {
  assert.equal(tradingDay(ct("2026-01-18 18:30:00")), tradingDay(ct("2026-01-19 09:00:00")))
})

test("entrada antes da meia-noite e saída depois: dia civil BRT muda, dia de pregão não", () => {
  const entry = ok(parseLocalDateTime("14/01/2026 23:50:00", { dateOrder: "DMY", tz: BRT })).instantUtc!
  const exit = ok(parseLocalDateTime("15/01/2026 00:10:00", { dateOrder: "DMY", tz: BRT })).instantUtc!
  assert.equal(durationSeconds(entry, exit), 1200)
  assert.notEqual(toLocal(entry, BRT).date, toLocal(exit, BRT).date) // cruzou a meia-noite em BRT
  assert.equal(tradingDay(entry), tradingDay(exit)) // 20:50 CT e 21:10 CT: mesmo pregão (15/01)
  assert.equal(tradingDay(entry), "2026-01-15")
})

test("trade que atravessa a abertura RTH: dia de pregão distinto entre entrada (noite) e saída (após 17:00 do dia seguinte)", () => {
  const entry = ct("2026-01-14 16:30:00") // pregão 14
  const exit = ct("2026-01-14 17:05:00") // pregão 15
  assert.equal(tradingDay(entry), "2026-01-14")
  assert.equal(tradingDay(exit), "2026-01-15")
})

test("sessão legada AM/PM/OVERNIGHT (regra ET do sync) sobre UTC correto", () => {
  assert.equal(legacySessionType("2026-01-15T14:42:10.000Z"), "AM") // 09:42 ET
  assert.equal(legacySessionType("2026-01-15T17:00:00.000Z"), "PM") // 12:00 ET
  assert.equal(legacySessionType("2026-01-15T22:30:00.000Z"), "OVERNIGHT") // 17:30 ET
  assert.equal(legacySessionType("2026-01-15T13:59:00.000Z"), "OVERNIGHT") // 08:59 ET
  assert.equal(legacySessionType("2026-07-15T13:42:10.000Z"), "AM") // 09:42 EDT (verão)
})

console.log(`\n${passed} testes ok`)
