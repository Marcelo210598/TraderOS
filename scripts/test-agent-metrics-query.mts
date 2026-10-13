// E6.6-5: capacidade `metrics.query@1` (fatia vertical, src/lib/agent-capabilities/metrics-query.ts). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_5 (args, flow, casos Q1–Q13, decisões D5-1..D5-5).
// ORÁCULO (plano): o texto renderizado do slot == o formatador (E6.6-1) aplicado ao valor de `calculateMetrics` chamado DIRETO — o oráculo NÃO passa pela capacidade.
//   node scripts/test-agent-metrics-query.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { formatNumber, formatUnavailable } from "../src/lib/agent/format.ts"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { renderSlot } from "../src/lib/agent/slot-path.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { renderAnswer } from "../src/lib/agent/render.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { METRIC_IDS, calculateMetrics, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const enc = (s: string) => new TextEncoder().encode(s)

// ── dados sintéticos (com stop ⇒ métricas de R existem) ──────────────────────
const BRT = "America/Sao_Paulo"
const AN = { timeZone: BRT, minSample: 4 } as const
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const rows = (): SynthRow[] => CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any)))
const CSV = synthCsv(rows())
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "segredo-metrics.csv" })
const rec = imp.importRecord as ImportRecord
const T = toAnalyticsTrades(withRisk(imp.trades))
const FILES = { [rec.importId]: enc(CSV) }
const ctx = (o: Any = {}): Any => ({ trades: T, importRecords: [rec], refEpoch: "s1", analysis: AN, ...o })
const run = (args: unknown, c: Any = ctx()): Any => metricsQuery(args, c) // { result: envelope para o modelo, entry: o que o servidor guarda no ledger (handle COMPLETO + view) | null }
const call = (args: unknown, c: Any = ctx()): Any => run(args, c).result
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 300)}`); return r }
const ARGS = { contract: AGENT_CONTRACT_VERSION, capability: "metrics.query@1", ok: false, data: null, evidence: null, limits: [], error: { code: "ARGS_INVALID" } }
const REFUSED = { ...ARGS, error: { code: "ENGINE_REFUSED" } }

// oráculo direto
const direct = (filters: Any = {}, opts: Any = {}): Any => calculateMetrics(T, { filters, ...AN, ...opts })
const wantText = (m: Any): string => { if (m.value === null) { const r = formatUnavailable(m.reason); assert.equal(r.ok, true, `motivo sem texto no catálogo: ${m.reason}`); return (r as Any).text } const r = formatNumber(m.value, m.unit); assert.equal(r.ok, true, `${m.metric}: o formatador recusou ${m.value} (${m.unit})`); return (r as Any).text }
const count = (n: number): string => (formatNumber(n, "count") as Any).text

test("Q1 — ORÁCULO: para CADA uma das 39 métricas, em DUAS populações (completa; só trades de alvo ⇒ sem perdedores, várias métricas indisponíveis), o valor/unidade/base/amostra/cobertura/motivo da view são os de calculateMetrics DIRETO e o texto do slot == o formatador aplicado ao valor direto", () => {
  assert.equal(METRIC_IDS.length, 39)
  let nulls = 0, values = 0
  for (const filters of [{}, { exitReason: "TARGET" }]) {
    const d = direct(filters)
    for (const id of METRIC_IDS) {
      const r = okOf(call({ metricIds: [id], filters }))
      const w = d.metrics[id]
      assert.deepEqual(r.data.metrics, [{ metricId: id, value: w.value, unit: w.unit, basis: w.basis, sampleSize: w.sampleSize, coverage: { used: w.coverage.used, total: w.coverage.total, ratio: w.coverage.ratio }, reason: w.reason }], `${id} ${JSON.stringify(filters)}`)
      const text = (path: string) => renderSlot("metrics.query@1", r.data, path) as Any
      assert.deepEqual(text("metrics[0].value"), { ok: true, text: wantText(w) }, `${id}: texto do valor`)
      assert.deepEqual(text("metrics[0].sampleSize"), { ok: true, text: count(w.sampleSize) }, id)
      assert.deepEqual(text("metrics[0].coverage.used"), { ok: true, text: count(w.coverage.used) }, id)
      assert.deepEqual(text("metrics[0].coverage.total"), { ok: true, text: count(w.coverage.total) }, id)
      assert.deepEqual(text("metrics[0].coverage.ratio"), { ok: true, text: (formatNumber(w.coverage.ratio, "fraction") as Any).text }, id)
      if (w.value === null) nulls += 1; else values += 1
      assert.equal(r.data.period.from, d.period.fromLocalDate)
      assert.equal(r.data.period.to, d.period.toLocalDate)
    }
  }
  assert.ok(nulls >= 3 && values >= 40, `a amostra precisa ter valores E indisponíveis (valores ${values}, nulls ${nulls})`)
})

test("Q2 — multi-métrica (netPnl, totalTrades, winRate): ordem do pedido, UM evidenceRef, subject = a 1ª pedida, verify VALID, valores == oráculo; outra ordem ⇒ outra ordem na view e outro ref", () => {
  const r = okOf(call({ metricIds: ["netPnl", "totalTrades", "winRate"] }))
  const d = direct()
  assert.deepEqual(r.data.metrics.map((m: Any) => m.metricId), ["netPnl", "totalTrades", "winRate"])
  assert.deepEqual(r.data.metrics.map((m: Any) => m.value), ["netPnl", "totalTrades", "winRate"].map((id) => d.metrics[id].value))
  assert.deepEqual(r.evidence.subject, { type: "METRIC", id: "netPnl" })
  assert.equal(r.evidence.verdict.verify.status, "VALID")
  assert.match(r.evidence.evidenceRef, /^ev_[0-9a-f]{32}$/)
  const other = okOf(call({ metricIds: ["winRate", "totalTrades", "netPnl"] }))
  assert.deepEqual(other.data.metrics.map((m: Any) => m.metricId), ["winRate", "totalTrades", "netPnl"])
  assert.deepEqual(other.evidence.subject, { type: "METRIC", id: "winRate" })
  assert.notEqual(other.evidence.evidenceRef, r.evidence.evidenceRef)
})

test("Q3 — filtros: a view == calculateMetrics DIRETO com os mesmos filtros; handle.population.declared == afterFilters (não inputTrades); filtro em lista", () => {
  for (const filters of [{ from: "2026-03-05" }, { from: "2026-03-03", to: "2026-03-06" }, { direction: "LONG" }, { hour: 9 }, { hour: [9, 10] }, { exitReason: "STOP" }, { symbol: "MNQ" }, { dayOfWeek: [1, 2, 3] }, { session: "AM" }, { tradingDay: "2026-03-05" }]) {
    const r = call({ metricIds: ["netPnl", "totalTrades"], filters })
    if (!r.ok) { assert.fail(`filtro ${JSON.stringify(filters)} deveria ser aceito: ${JSON.stringify(r.error)}`) }
    const d = direct(filters)
    assert.deepEqual(r.data.metrics.map((m: Any) => m.value), [d.metrics.netPnl.value, d.metrics.totalTrades.value], JSON.stringify(filters))
    assert.equal(r.evidence.population.declared, d.population.afterFilters, JSON.stringify(filters))
  }
  const cut = okOf(call({ metricIds: ["totalTrades"], filters: { from: "2026-03-05" } }))
  assert.ok(cut.evidence.population.declared < direct().population.inputTrades, "o filtro precisa excluir trades")
})

test("Q4 — pnlBasis GROSS ≠ NET (valores diferentes, iguais aos do motor) e a base sai no `basis`; rBasis POINTS idem", () => {
  const net = okOf(call({ metricIds: ["netPnl", "averageWinner", "averageR"], options: { pnlBasis: "NET", rBasis: "NET" } }))
  const gross = okOf(call({ metricIds: ["netPnl", "averageWinner", "averageR"], options: { pnlBasis: "GROSS", rBasis: "POINTS" } }))
  const dn = direct({}, { pnlBasis: "NET", rBasis: "NET" }), dg = direct({}, { pnlBasis: "GROSS", rBasis: "POINTS" })
  assert.deepEqual(net.data.metrics.map((m: Any) => [m.value, m.basis]), ["netPnl", "averageWinner", "averageR"].map((id) => [dn.metrics[id].value, dn.metrics[id].basis]))
  assert.deepEqual(gross.data.metrics.map((m: Any) => [m.value, m.basis]), ["netPnl", "averageWinner", "averageR"].map((id) => [dg.metrics[id].value, dg.metrics[id].basis]))
  assert.notDeepEqual(net.data.metrics.map((m: Any) => m.value), gross.data.metrics.map((m: Any) => m.value), "as bases precisam produzir valores diferentes nesta amostra")
})

test("Q5 — ARGS_INVALID (nada executa): metricIds vazio/repetido/inexistente/>20/não-array; filtros proibidos (account, strategy*, setup, timeframe) e malformados; options proibidas; campo extra em qualquer nível; args que não são objeto; nunca lança", () => {
  const ids21 = METRIC_IDS.slice(0, 21)
  const bad: unknown[] = [
    { metricIds: [] }, { metricIds: ["netPnl", "netPnl"] }, { metricIds: ["inexistente"] }, { metricIds: ids21 }, { metricIds: "netPnl" }, { metricIds: [5] }, { metricIds: [null] }, {}, { metricIds: ["netPnl"], extra: 1 },
    { metricIds: ["netPnl"], filters: { account: "Sim101" } }, { metricIds: ["netPnl"], filters: { strategyId: "x" } }, { metricIds: ["netPnl"], filters: { strategyName: "x" } }, { metricIds: ["netPnl"], filters: { strategyVersionId: "x" } },
    { metricIds: ["netPnl"], filters: { setup: "x" } }, { metricIds: ["netPnl"], filters: { timeframe: "5m" } }, { metricIds: ["netPnl"], filters: { from: "05/03/2026" } }, { metricIds: ["netPnl"], filters: { from: "2026-3-5" } },
    { metricIds: ["netPnl"], filters: { direction: "long" } }, { metricIds: ["netPnl"], filters: { hour: 24 } }, { metricIds: ["netPnl"], filters: { hour: -1 } }, { metricIds: ["netPnl"], filters: { hour: 1.5 } }, { metricIds: ["netPnl"], filters: { dayOfWeek: 7 } },
    { metricIds: ["netPnl"], filters: { session: "NOITE" } }, { metricIds: ["netPnl"], filters: { exitReason: "REAL" } }, { metricIds: ["netPnl"], filters: { symbol: Array.from({ length: 9 }, (_, i) => `S${i}`) } }, { metricIds: ["netPnl"], filters: { symbol: [] } },
    { metricIds: ["netPnl"], filters: { extra: 1 } }, { metricIds: ["netPnl"], filters: "x" }, { metricIds: ["netPnl"], filters: null },
    { metricIds: ["netPnl"], options: { timeZone: "UTC" } }, { metricIds: ["netPnl"], options: { minSample: 1 } }, { metricIds: ["netPnl"], options: { pnlBasis: "MELHOR" } }, { metricIds: ["netPnl"], options: { rBasis: "gross" } }, { metricIds: ["netPnl"], options: { timeAnchor: "EXIT" } }, { metricIds: ["netPnl"], options: { tradeIdsLimit: 1 } },
    null, undefined, 5, "x", [], [{ metricIds: ["netPnl"] }],
  ]
  for (const b of bad) { assert.doesNotThrow(() => call(b)); assert.deepEqual(call(b), ARGS, JSON.stringify(b)?.slice(0, 80)) }
  assert.equal(call({ metricIds: METRIC_IDS.slice(0, 20) }).ok, true, "exatamente 20 passa")
})

test("Q6 — erros do motor: from > to ⇒ ARGS_INVALID; trades SEM identidade ⇒ ENGINE_REFUSED; trades vazios ⇒ resposta OK (população vazia); importRecords sem o import ⇒ ENGINE_REFUSED", () => {
  assert.deepEqual(call({ metricIds: ["netPnl"], filters: { from: "2026-03-09", to: "2026-03-02" } }), ARGS)
  const noId = T.map((t) => ({ ...t, id: t.id, trade: { ...t.trade, tradeId: null, importId: null } })) as Any
  assert.deepEqual(call({ metricIds: ["netPnl"] }, ctx({ trades: noId })), REFUSED)
  assert.equal(call({ metricIds: ["netPnl"] }, ctx({ trades: [] })).ok, true)
  assert.deepEqual(call({ metricIds: ["netPnl"] }, ctx({ importRecords: [] })), REFUSED)
})

test("Q7 — população vazia (filtro que exclui tudo): ok; valores null com `reason` do catálogo; renderSlot == 'indisponível (…)'; period null; declared 0", () => {
  const r = okOf(call({ metricIds: ["netPnl", "profitFactor", "winRate"], filters: { from: "2030-01-01" } }))
  assert.equal(r.evidence.population.declared, 0)
  assert.deepEqual(r.data.period, { from: null, to: null })
  for (let i = 0; i < 3; i++) {
    const m = r.data.metrics[i]
    assert.equal(m.value, null, m.metricId)
    assert.equal(typeof m.reason, "string")
    const t = renderSlot("metrics.query@1", r.data, `metrics[${i}].value`) as Any
    assert.equal(t.ok, true, `${m.metricId}: ${JSON.stringify(t)}`)
    assert.match(t.text, /^indisponível \(.+\)$/)
  }
  const e = okOf(call({ metricIds: ["netPnl"] }, ctx({ trades: [] })))
  assert.equal(e.evidence.population.declared, 0)
})

// ── fim a fim: capacidade → ledger → validador → render ──────────────────────
const ledgerFrom = (full: Any): Any => { assert.notEqual(full.entry, null); const a: Any = addEvidence((newLedger("s1") as Any).ledger, full.entry); assert.equal(a.ok, true, JSON.stringify(a)); return a.ledger }

test("Q8 — FIM A FIM: capacidade → ledger → validateAnswer → renderAnswer. Com arquivo: VERIFIED e o texto renderizado == oráculo; sem arquivo: ASSERT é rejeitado, LABELED passa, rodapé estrutural e banner 'Não verificado'", () => {
  const fullFile = run({ metricIds: ["netPnl"] }, ctx({ source: { files: FILES } }))
  const withFile = okOf(fullFile.result)
  assert.deepEqual(Object.keys(fullFile.entry).sort(), ["capability", "handle", "view"])
  assert.equal(fullFile.entry.handle.evidenceRef, withFile.evidence.evidenceRef)
  assert.match(fullFile.entry.handle.evidenceHash, /^[0-9a-f]{64}$/, "o servidor guarda o handle COMPLETO (com o selo); o modelo não o vê")
  assert.deepEqual(fullFile.entry.view, withFile.data)
  assert.equal(withFile.evidence.verdict.combined, "VERIFIED")
  const wantNet = wantText(direct().metrics.netPnl)
  const REF = withFile.evidence.evidenceRef
  const ledger = ledgerFrom(fullFile)
  const answer = { segments: [{ kind: "text", text: "Resultado:" }, { kind: "slot", ref: REF, path: "metrics[0].value" }, { kind: "phrase", code: "POPULATION_DECLARED", ref: REF }], claims: [{ ref: REF, path: "metrics[0].value", mode: "ASSERT" }] }
  assert.deepEqual(validateAnswer({ answer, ledger, stop: null, question: "" }).ok, true)
  const rendered: Any = renderAnswer({ answer, ledger, notices: [], stop: null, question: "" })
  assert.equal(rendered.ok, true)
  assert.equal(rendered.rendered.segments[1].text, wantNet)
  assert.deepEqual(rendered.rendered.banner, { combined: "VERIFIED", label: "Verificado" })

  const fullNo = run({ metricIds: ["netPnl"] })
  const noFile = okOf(fullNo.result)
  assert.equal(noFile.evidence.verdict.combined, "NOT_VERIFIED")
  const l2 = ledgerFrom(fullNo)
  const REF2 = noFile.evidence.evidenceRef
  const asserted = { segments: [{ kind: "slot", ref: REF2, path: "metrics[0].value" }], claims: [{ ref: REF2, path: "metrics[0].value", mode: "ASSERT" }] }
  assert.deepEqual((validateAnswer({ answer: asserted, ledger: l2, stop: null, question: "" }) as Any).reasons, ["MISSING_NOT_VERIFIED_LABEL"])
  const labeled = { segments: [{ kind: "slot", ref: REF2, path: "metrics[0].value" }], claims: [{ ref: REF2, path: "metrics[0].value", mode: "LABELED" }] }
  const r2: Any = renderAnswer({ answer: labeled, ledger: l2, notices: [], stop: null, question: "" })
  assert.equal(r2.ok, true)
  assert.equal(r2.rendered.segments[0].text, wantNet)
  assert.equal(r2.rendered.segments.at(-1).code, "VERIFICATION_INFRA_MISSING")
  assert.deepEqual(r2.rendered.banner, { combined: "NOT_VERIFIED", label: "Não verificado" })
})

test("Q9 — PRIVACIDADE: o envelope serializado NÃO contém nome de conta, tradeId, importId, nome do arquivo, hash completo nem chave T0; a view só tem as chaves da lista branca", () => {
  const r = okOf(call({ metricIds: METRIC_IDS.slice(0, 20) }))
  const dump = JSON.stringify(r)
  for (const leak of ["Sim101", "Sim102", "segredo-metrics", rec.importId, ...T.slice(0, 3).map((t) => t.id), "evidenceHash", "rowHash", "rowNo", "fileSha256", "saltId", "userId"]) assert.equal(dump.includes(leak), false, `vazou: ${leak}`)
  assert.equal(/[0-9a-f]{64}/.test(dump), false, "hash completo no envelope")
  assert.deepEqual(Object.keys(r.data).sort(), ["metrics", "period"])
  for (const m of r.data.metrics) assert.deepEqual(Object.keys(m).sort(), ["basis", "coverage", "metricId", "reason", "sampleSize", "unit", "value"])
  assert.deepEqual(Object.keys(r).sort(), ["capability", "contract", "data", "evidence", "limits", "ok"])
})

test("Q10 — puro: não altera ctx.trades nem ctx.importRecords; mesma entrada ⇒ mesma saída", () => {
  const c = ctx()
  const snapT = JSON.stringify(c.trades), snapR = JSON.stringify(c.importRecords)
  const a = call({ metricIds: ["netPnl", "winRate"], filters: { from: "2026-03-03" } }, c)
  const b = call({ metricIds: ["netPnl", "winRate"], filters: { from: "2026-03-03" } }, c)
  assert.equal(JSON.stringify(c.trades), snapT)
  assert.equal(JSON.stringify(c.importRecords), snapR)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  const args = { metricIds: ["netPnl"], filters: { hour: [9, 10] } }
  const snapA = JSON.stringify(args)
  call(args, c)
  assert.equal(JSON.stringify(args), snapA)
})

test("Q11 — contexto hostil (trades null, getter que lança, importRecords inválido, ctx nulo) ⇒ erro sem lançar (ENGINE_REFUSED; ARGS_INVALID se os args é que são ruins)", () => {
  const hostile: Any = ctx()
  Object.defineProperty(hostile, "trades", { enumerable: true, get() { throw new Error("getter hostil") } })
  for (const c of [ctx({ trades: null }), ctx({ importRecords: null }), ctx({ refEpoch: "" }), hostile, null, undefined, 5]) {
    // direto na capacidade: `call` aplicaria o contexto PADRÃO a um `undefined`
    assert.doesNotThrow(() => metricsQuery({ metricIds: ["netPnl"] }, c as never))
    assert.deepEqual(metricsQuery({ metricIds: ["netPnl"] }, c as never).result, REFUSED)
    assert.equal(metricsQuery({ metricIds: ["netPnl"] }, c as never).entry, null)
  }
  assert.deepEqual(metricsQuery({ metricIds: [] }, null as never).result, ARGS, "args ruins vencem o contexto ruim")
})

test("Q15 — preferências do USUÁRIO (ctx.analysis) chegam ao motor: timeZone muda a hora local (filtro de hora e período) e minSample entra no bundle (evidenceRef muda); ambos == calculateMetrics direto; motor lançando erro que NÃO é de entrada (trade nulo) ⇒ ENGINE_REFUSED", () => {
  const NY = "America/New_York"
  const a = okOf(call({ metricIds: ["totalTrades"], filters: { hour: 9 } }, ctx({ analysis: { timeZone: BRT, minSample: 4 } })))
  const b = okOf(call({ metricIds: ["totalTrades"], filters: { hour: 9 } }, ctx({ analysis: { timeZone: NY, minSample: 4 } })))
  assert.equal(a.data.metrics[0].value, calculateMetrics(T, { filters: { hour: 9 }, timeZone: BRT, minSample: 4 }).metrics.totalTrades.value)
  assert.equal(b.data.metrics[0].value, calculateMetrics(T, { filters: { hour: 9 }, timeZone: NY, minSample: 4 }).metrics.totalTrades.value)
  assert.notEqual(a.data.metrics[0].value, b.data.metrics[0].value, "o fuso precisa mudar a contagem nesta amostra")
  const m4 = okOf(call({ metricIds: ["netPnl"] }, ctx({ analysis: { timeZone: BRT, minSample: 4 } })))
  const m30 = okOf(call({ metricIds: ["netPnl"] }, ctx({ analysis: { timeZone: BRT, minSample: 30 } })))
  assert.notEqual(m4.evidence.evidenceRef, m30.evidence.evidenceRef, "minSample está nas opções registradas no bundle")
  assert.deepEqual(m4.data, m30.data, "e não muda o valor do TOTAL")
  assert.deepEqual(metricsQuery({ metricIds: ["netPnl"] }, ctx({ trades: [null] })).result, REFUSED)
  assert.deepEqual(metricsQuery({ metricIds: ["netPnl"] }, ctx({ trades: [{}] })).result, REFUSED)
})

test("Q12 — COM o arquivo original correto (E5b real): VERIFIED e limits []; arquivo adulterado ⇒ TAMPERED_OR_MISMATCH; ambos viram envelope válido", () => {
  const good = okOf(call({ metricIds: ["netPnl", "winRate"] }, ctx({ source: { files: FILES } })))
  assert.equal(good.evidence.verdict.combined, "VERIFIED")
  assert.deepEqual(good.limits, [])
  const bad = okOf(call({ metricIds: ["netPnl", "winRate"] }, ctx({ source: { files: { [rec.importId]: enc(CSV.replace("2004", "2005")) } } })))
  assert.equal(bad.evidence.verdict.combined, "TAMPERED_OR_MISMATCH")
  const none = okOf(call({ metricIds: ["netPnl"] }))
  assert.deepEqual(none.limits.map((l: Any) => l.code), ["VERIFICATION_INFRA_MISSING"])
})

test("Q14 — SAL: import SALGADO sem ctx.accountRefSalt ⇒ ENGINE_REFUSED; com o sal certo ⇒ ok (e VERIFIED com arquivo + options.accountRefSalt, E5b real); sal ERRADO ⇒ nunca VERIFIED; import sem sal segue sem accountRefSalt", () => {
  const SALT = "sal-de-teste-da-capacidade-0123456789abcdef"
  const salted = runImportPipeline(CSV, { sourceTz: BRT, fileName: "salgado.csv", accountRefSalt: SALT } as Any)
  const sRec = salted.importRecord as ImportRecord
  assert.equal((sRec as Any).reproducibility?.accountRefSalted, true, "premissa: o import ficou marcado como salgado")
  const sT = toAnalyticsTrades(withRisk(salted.trades))
  const base: Any = { trades: sT, importRecords: [sRec], refEpoch: "s1", analysis: AN }
  assert.deepEqual(metricsQuery({ metricIds: ["netPnl"] }, base).result, REFUSED, "sem o sal")
  assert.deepEqual(metricsQuery({ metricIds: ["netPnl"] }, { ...base, accountRefSalt: "" }).result, REFUSED, "sal vazio")
  const good = metricsQuery({ metricIds: ["netPnl"] }, { ...base, accountRefSalt: SALT, source: { files: { [sRec.importId]: enc(CSV) }, options: { accountRefSalt: SALT } } })
  assert.equal(okOf(good.result).evidence.verdict.combined, "VERIFIED")
  const noFile = metricsQuery({ metricIds: ["netPnl"] }, { ...base, accountRefSalt: SALT })
  assert.equal(okOf(noFile.result).evidence.verdict.combined, "NOT_VERIFIED")
  const wrong = metricsQuery({ metricIds: ["netPnl"] }, { ...base, accountRefSalt: "outro-sal-qualquer-0123456789abcdef-fedcba", source: { files: { [sRec.importId]: enc(CSV) }, options: { accountRefSalt: "outro-sal-qualquer-0123456789abcdef-fedcba" } } })
  assert.notEqual((wrong.result as Any).evidence?.verdict.combined, "VERIFIED", "sal errado nunca verifica")
  assert.equal(okOf(call({ metricIds: ["netPnl"] })).ok, true, "import sem sal não exige sal")
})

test("Q13 — entry: só em sucesso (handle completo + view); em erro, entry é null; o gerador de expectativa conhece os 15 casos e as 5 decisões D5", () => {
  assert.equal(run({ metricIds: [] }).entry, null)
  assert.equal(run({ metricIds: ["netPnl"] }, ctx({ trades: null })).entry, null)
  assert.equal(run({ metricIds: ["netPnl"] }).entry.capability, "metrics.query@1")
  assert.equal(exp.e66_5.cases.length, 15)
  assert.deepEqual(Object.keys(exp.e66_5.decisions_D5), ["D5-1", "D5-2", "D5-3", "D5-4", "D5-5"])
})

console.log(`\n${passed} testes ok`)
