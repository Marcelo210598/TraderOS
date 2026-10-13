// E6.6-3: render da resposta (RenderedSegment[] + banner) e resposta canônica de falha (src/lib/agent/render.ts). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_3 (render, stop_response, cases.render R1–R16, cases.stop_response F1–F5). Cobre AV15, AV19, AV20, AV22.
//   node scripts/test-agent-render.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { PHRASES, STRUCTURAL_TEXT } from "../src/lib/agent/phrases.ts"
import { renderAnswer, stopResponse } from "../src/lib/agent/render.ts"
import { newTurn, recordError, recordRejection, requestCall } from "../src/lib/agent/turn.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const REF = (c: string): string => `ev_${c.repeat(32)}`
const PATH = "metrics[0].value"

// ── fixtures (hex: a b c d e f 1 2 3 7) ─────────────────────────────────────
const view = (value: number | null, reason: string | null = null): Any => ({ metrics: [{ metricId: "netPnl", value, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason }], period: { from: null, to: null } })
interface H { verify?: string; source?: string; vcodes?: string[]; scodes?: string[]; declared?: number; v?: Any }
const entry = (c: string, o: H = {}): Any => ({
  capability: "metrics.query@1",
  handle: { evidenceRef: REF(c), evidenceHash: c.repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: o.declared ?? 10, verifiability: "FULL", sampleFlag: "OK", conclusive: true }, refEpoch: "s1", freshness: "CURRENT",
    verdict: buildVerdict({ status: (o.verify ?? "VALID") as never, codes: o.vcodes ?? [] }, { status: (o.source ?? "SOURCE_VERIFIED") as never, codes: o.scodes ?? [] }) },
  view: o.v ?? view(10),
})
const SPEC: Record<string, H> = {
  a: {}, b: { source: "SOURCE_VERIFIED_PARTIAL", scodes: ["S_POPULATION_PARTIAL"], v: view(15) }, c: { source: "NOT_RUN", v: view(20) },
  d: { source: "UNVERIFIABLE", scodes: ["S_SOURCE_NOT_PROVIDED"], v: view(30) }, e: { source: "NOT_RUN", scodes: ["S_SOURCE_NOT_PROVIDED"], v: view(40) },
  f: { verify: "TAMPERED", source: "NOT_RUN" }, "1": { v: view(null, "DENOMINATOR_ZERO") }, "2": { v: view(null, null) }, "3": { declared: 1234 }, "7": { source: "NOT_RUN", v: view(50) },
}
const LEDGER: Any = (() => { let l: Any = (newLedger("s1") as Any).ledger; for (const [c, o] of Object.entries(SPEC)) { const r: Any = addEvidence(l, entry(c, o)); assert.equal(r.ok, true, `fixture ${c}`); l = r.ledger } return l })()
const txt = (text: string) => ({ kind: "text", text })
const slot = (c: string, path = PATH) => ({ kind: "slot", ref: REF(c), path })
const phr = (code: string, c?: string) => (c === undefined ? { kind: "phrase", code } : { kind: "phrase", code, ref: REF(c) })
const claim = (c: string, mode: "ASSERT" | "LABELED" = "ASSERT", path = PATH) => ({ ref: REF(c), path, mode })
const ans = (segments: Any[], claims: Any[] = []): Any => ({ segments, claims })
const render = (answer: Any, o: { notices?: string[]; stop?: null | "BUDGET_CALLS" } = {}): Any => renderAnswer({ answer, ledger: LEDGER, notices: (o.notices ?? []) as never, stop: o.stop ?? null, question: "" })
const ok = (answer: Any, o: Parameters<typeof render>[1] = {}): Any => { const r = render(answer, o); assert.equal(r.ok, true, `deveria renderizar: ${JSON.stringify(r)}`); return r.rendered }
const POP = (c: string) => phr("POPULATION_DECLARED", c)
const popText = (n: string) => `Considerando a população declarada de ${n} trades.`
const value = (c: string, text: string, combined: string, mode = "ASSERT", path = PATH) => ({ kind: "value", ref: REF(c), path, text, combined, mode })
const phrase = (code: string, text: string) => ({ kind: "phrase", code, text })
const FOOTER = phrase("VERIFICATION_INFRA_MISSING", STRUCTURAL_TEXT)
const SPECIFIC = phrase("S_SOURCE_NOT_PROVIDED", PHRASES.S_SOURCE_NOT_PROVIDED)

test("R1 — AV15: VERIFIED + slot + frase de população ⇒ [text, value 'US$ 10,00' (VERIFIED/ASSERT), phrase com {n}=10]; banner Verificado; SEM rodapé", () => {
  const r = ok(ans([txt("Resultado:"), slot("a"), POP("a")], [claim("a")]))
  assert.deepEqual(r.segments, [{ kind: "text", text: "Resultado:" }, value("a", "US$ 10,00", "VERIFIED"), phrase("POPULATION_DECLARED", popText("10"))])
  assert.deepEqual(r.banner, { combined: "VERIFIED", label: "Verificado" })
  assert.equal(r.stopReason, null)
})

test("R2 — AV20: um claim VERIFIED e um NOT_VERIFIED(LABELED): cada value com o PRÓPRIO combined e modo; banner = o PIOR (Não verificado); rodapé estrutural no fim", () => {
  const r = ok(ans([slot("a"), POP("a"), slot("c")], [claim("a"), claim("c", "LABELED")]))
  assert.deepEqual(r.segments, [value("a", "US$ 10,00", "VERIFIED"), phrase("POPULATION_DECLARED", popText("10")), value("c", "US$ 20,00", "NOT_VERIFIED", "LABELED"), FOOTER])
  assert.deepEqual(r.banner, { combined: "NOT_VERIFIED", label: "Não verificado" })
})

test("R3 — D2: o rodapé estrutural é UMA vez, é o último segmento e o texto é IDÊNTICO a STRUCTURAL_TEXT, mesmo com 2 refs NOT_RUN; a frase estrutural emitida pelo modelo sai do corpo", () => {
  const r = ok(ans([slot("c"), phr("VERIFICATION_INFRA_MISSING", "c"), slot("7"), txt("fim")], [claim("c", "LABELED"), claim("7", "LABELED")]))
  assert.deepEqual(r.segments, [value("c", "US$ 20,00", "NOT_VERIFIED", "LABELED"), value("7", "US$ 50,00", "NOT_VERIFIED", "LABELED"), { kind: "text", text: "fim" }, FOOTER])
  assert.equal(r.segments.filter((s: Any) => s.code === "VERIFICATION_INFRA_MISSING").length, 1)
  assert.equal(r.segments.at(-1).text, STRUCTURAL_TEXT)
})

test("R4 — D1: frase ESPECÍFICA inserida UMA vez antes do 1º slot do ref (com 2 slots do mesmo ref); source UNVERIFIABLE ⇒ sem rodapé", () => {
  const r = ok(ans([txt("Valores:"), slot("d"), txt("e"), slot("d", "metrics[0].sampleSize")], [claim("d", "LABELED"), claim("d", "LABELED", "metrics[0].sampleSize")]))
  assert.deepEqual(r.segments, [{ kind: "text", text: "Valores:" }, SPECIFIC, value("d", "US$ 30,00", "NOT_VERIFIED", "LABELED"), { kind: "text", text: "e" }, value("d", "3", "NOT_VERIFIED", "LABELED", "metrics[0].sampleSize")])
})

test("R5 — D1+D2: NOT_RUN com código específico no source ⇒ específica ANTES do slot e estrutural no FIM (os dois, específico primeiro, nunca fundidos)", () => {
  const r = ok(ans([slot("e")], [claim("e", "LABELED")]))
  assert.deepEqual(r.segments, [SPECIFIC, value("e", "US$ 40,00", "NOT_VERIFIED", "LABELED"), FOOTER])
  assert.notEqual(PHRASES.S_SOURCE_NOT_PROVIDED, STRUCTURAL_TEXT)
  assert.equal(PHRASES.S_SOURCE_NOT_PROVIDED.includes(STRUCTURAL_TEXT), false)
})

test("R6 — D1: a frase específica que o MODELO emitiu para o ref é removida do corpo e reaparece na posição canônica (exatamente 1)", () => {
  const r = ok(ans([slot("d"), phr("S_SOURCE_NOT_PROVIDED", "d"), txt("depois")], [claim("d", "LABELED")]))
  assert.deepEqual(r.segments, [SPECIFIC, value("d", "US$ 30,00", "NOT_VERIFIED", "LABELED"), { kind: "text", text: "depois" }])
})

test("R7 — VERIFIED_PARTIAL: a frase parcial do modelo fica onde o modelo pôs, com o texto do catálogo; banner Verificado parcialmente; sem rodapé", () => {
  const r = ok(ans([txt("Parcial:"), slot("b"), phr("S_POPULATION_PARTIAL", "b")], [claim("b")]))
  assert.deepEqual(r.segments, [{ kind: "text", text: "Parcial:" }, value("b", "US$ 15,00", "VERIFIED_PARTIAL"), phrase("S_POPULATION_PARTIAL", PHRASES.S_POPULATION_PARTIAL)])
  assert.deepEqual(r.banner, { combined: "VERIFIED_PARTIAL", label: "Verificado parcialmente" })
})

test("R8 — só frase de integridade (TAMPERED, nenhum slot): [phrase]; banner Não confere (refs só de frase também contam); sem rodapé", () => {
  const r = ok(ans([phr("INTEGRITY_SEAL", "f")]))
  assert.deepEqual(r.segments, [phrase("INTEGRITY_SEAL", PHRASES.INTEGRITY_SEAL)])
  assert.deepEqual(r.banner, { combined: "TAMPERED_OR_MISMATCH", label: "Não confere" })
})

test("R9 — nenhum ref citado ⇒ banner { null, null } e o texto passa intocado", () => {
  const r = ok(ans([txt("Não há o que mostrar.")]))
  assert.deepEqual(r.segments, [{ kind: "text", text: "Não há o que mostrar." }])
  assert.deepEqual(r.banner, { combined: null, label: null })
})

test("R10 — valor null com motivo ⇒ 'indisponível (…)'; slot de enum (basis) também renderiza; D8: o banner usa o pior entre TODOS os refs citados", () => {
  const r = ok(ans([slot("1"), POP("1"), slot("a", "metrics[0].basis"), POP("a")], [claim("1"), claim("a", "ASSERT", "metrics[0].basis")]))
  assert.deepEqual(r.segments.filter((s: Any) => s.kind === "value").map((s: Any) => s.text), ["indisponível (o denominador é zero)", "líquido"])
  assert.deepEqual(r.banner, { combined: "VERIFIED", label: "Verificado" })
})

test("R11 — slot que não renderiza (null sem motivo), resposta fora do schema e resposta que não passa no validador ⇒ { ok:false, code:'RENDER_FAILED' } sem detalhe; nunca lança", () => {
  for (const bad of [ans([slot("2"), POP("2")], [claim("2")]), {}, null, undefined, 5, ans([txt("Foi 150 no dia.")]), ans([slot("z")], [claim("z")]), ans([slot("c")], [claim("c", "ASSERT")])]) {
    assert.doesNotThrow(() => render(bad))
    assert.deepEqual(render(bad), { ok: false, code: "RENDER_FAILED" })
  }
  assert.deepEqual(Object.keys(render({})).sort(), ["code", "ok"])
  // entrada hostil que lança DENTRO do render (lista de avisos com Proxy): a exceção não pode vazar
  const hostileNotices: Any = new Proxy([], { get() { throw new Error("proxy hostil") } })
  assert.doesNotThrow(() => render(ans([txt("ok")]), { notices: hostileNotices }))
  assert.deepEqual(render(ans([txt("ok")]), { notices: hostileNotices }), { ok: false, code: "RENDER_FAILED" })
  for (const l of [null, undefined, 5]) assert.doesNotThrow(() => renderAnswer({ answer: ans([txt("ok")]), ledger: l as never, notices: [], stop: null, question: "" }))
})

test("R12 — notices do servidor: CAPABILITY_FAILED como frase ANTES do rodapé; FILE_NOT_AVAILABLE usa o texto estrutural e NÃO duplica o rodapé; ordem [corpo, CAPABILITY_FAILED, estrutural]", () => {
  const a = ok(ans([slot("a"), POP("a")], [claim("a")]), { notices: ["CAPABILITY_FAILED"] })
  assert.deepEqual(a.segments.slice(-1), [phrase("CAPABILITY_FAILED", PHRASES.CAPABILITY_FAILED)])
  const b = ok(ans([slot("a"), POP("a")], [claim("a")]), { notices: ["FILE_NOT_AVAILABLE"] })
  assert.deepEqual(b.segments.slice(-1), [FOOTER])
  const c = ok(ans([slot("c")], [claim("c", "LABELED")]), { notices: ["CAPABILITY_FAILED", "FILE_NOT_AVAILABLE"] })
  assert.deepEqual(c.segments.slice(-2), [phrase("CAPABILITY_FAILED", PHRASES.CAPABILITY_FAILED), FOOTER])
  assert.equal(c.segments.filter((s: Any) => s.code === "VERIFICATION_INFRA_MISSING").length, 1)
  for (const bad of [["OUTRO"], [5], "CAPABILITY_FAILED", ["BUDGET_CALLS"], ["REGEN_EXHAUSTED"]]) assert.deepEqual(render(ans([txt("ok")]), { notices: bad as never }), { ok: false, code: "RENDER_FAILED" }, `aviso inválido ${JSON.stringify(bad)}`)
})

test("R13 — AV22: a frase BUDGET_LIMIT_REACHED do modelo fica onde ele pôs, com o texto do catálogo; sem ela com stop=BUDGET_CALLS ⇒ RENDER_FAILED (o validador rejeita)", () => {
  const r = ok(ans([txt("Apurei isto:"), phr("BUDGET_LIMIT_REACHED")]), { stop: "BUDGET_CALLS" })
  assert.deepEqual(r.segments, [{ kind: "text", text: "Apurei isto:" }, phrase("BUDGET_LIMIT_REACHED", PHRASES.BUDGET_LIMIT_REACHED)])
  assert.deepEqual(render(ans([txt("Resposta completa.")]), { stop: "BUDGET_CALLS" }), { ok: false, code: "RENDER_FAILED" })
})

test("R14 — puro: preserva o texto e a ordem relativa do modelo; não altera a resposta nem o ledger; mesma entrada ⇒ mesma saída; saída congelada", () => {
  const a = ans([txt("alfa"), slot("a"), txt("beta"), POP("a"), txt("gama")], [claim("a")])
  const sa = JSON.stringify(a), sl = JSON.stringify(LEDGER)
  const r1 = ok(a), r2 = ok(a)
  assert.equal(JSON.stringify(r1), JSON.stringify(r2))
  assert.deepEqual(r1.segments.filter((s: Any) => s.kind === "text").map((s: Any) => s.text), ["alfa", "beta", "gama"])
  assert.equal(JSON.stringify(a), sa)
  assert.equal(JSON.stringify(LEDGER), sl)
  const walk = (o: Any): void => { if (o && typeof o === "object") { assert.equal(Object.isFrozen(o), true); for (const v of Object.values(o)) walk(v) } }
  walk(r1)
})

test("R15 — {n} da população: 1 ⇒ '1'; 1234 ⇒ '1.234' (formatador de contagem); frase sem {n} (INDICATIVE_ONLY) não muda", () => {
  assert.equal(ok(ans([slot("3"), POP("3")], [claim("3")])).segments[1].text, popText("1.234"))
  const one: Any = (() => { let l: Any = (newLedger("s1") as Any).ledger; l = (addEvidence(l, entry("a", { declared: 1 })) as Any).ledger; return l })()
  const r: Any = renderAnswer({ answer: ans([slot("a"), POP("a")], [claim("a")]), ledger: one, notices: [], stop: null, question: "" })
  assert.equal(r.rendered.segments[1].text, popText("1"))
  assert.equal(ok(ans([phr("INDICATIVE_ONLY", "a")])).segments[0].text, PHRASES.INDICATIVE_ONLY)
})

test("R16 — nenhum segmento de saída traz o hash completo nem o campo evidenceHash; ref e path só aparecem em segmentos `value`", () => {
  const r = ok(ans([txt("x"), slot("a"), POP("a"), slot("c")], [claim("a"), claim("c", "LABELED")]))
  const dump = JSON.stringify(r)
  assert.equal(/evidenceHash|[0-9a-f]{64}/.test(dump), false)
  for (const s of r.segments) { if (s.kind !== "value") { assert.equal("ref" in s, false); assert.equal("path" in s, false) } }
})

// ── resposta canônica de falha ──────────────────────────────────────────────
const stateWith = (opts: { caps?: string[]; rejections?: string[][]; errors?: Array<[string, string]>; budget?: boolean } = {}): Any => {
  let s: Any = newTurn()
  for (const c of opts.caps ?? []) s = (requestCall(s, c as never) as Any).state
  for (const [c, code] of opts.errors ?? []) s = (recordError(s, c as never, code as never) as Any).state
  for (const r of opts.rejections ?? []) s = (recordRejection(s, r as never) as Any).state
  if (opts.budget) { for (let i = 0; i < 9; i++) s = (requestCall(s, "metrics.query@1") as Any).state }
  return s
}
const REGEN = phrase("REGEN_EXHAUSTED", PHRASES.REGEN_EXHAUSTED)

test("F1 — AV19: 3 rejeições, tried [metrics.query, rank.groups], última CAUSAL_CLAIM ⇒ frase + 'Consultas tentadas: …' + 'Motivo da última rejeição: …'; banner nulo; stopReason REGEN_EXHAUSTED", () => {
  const s = stateWith({ caps: ["metrics.query@1", "rank.groups@1"], rejections: [["NUMBER_OUTSIDE_SLOT"], ["SCOPE_OVERCLAIM"], ["CAUSAL_CLAIM"]] })
  assert.deepEqual(stopResponse(s), {
    segments: [REGEN, { kind: "server_text", text: "Consultas tentadas: consulta de métricas, ranking de grupos." }, { kind: "server_text", text: "Motivo da última rejeição: a resposta afirmava uma causa que os dados não sustentam." }],
    banner: { combined: null, label: null }, stopReason: "REGEN_EXHAUSTED",
  })
})

test("F1b — última rejeição com VÁRIOS motivos: a linha cita o PRIMEIRO da lista (ordem do validador), sem repetir nem listar todos", () => {
  const s = stateWith({ rejections: [["STALE_REF"], ["SCOPE_OVERCLAIM"], ["CAUSAL_CLAIM", "SCOPE_OVERCLAIM", "NUMBER_OUTSIDE_SLOT"]] })
  assert.equal(stopResponse(s).segments[2].text, "Motivo da última rejeição: a resposta afirmava uma causa que os dados não sustentam.")
})

test("F2 — sem capacidade executada ⇒ 'Nenhuma consulta foi concluída.'; sem rejeição registrada o motivo da última rejeição não aparece", () => {
  const r = stopResponse(stateWith({ rejections: [["STRUCTURE_INVALID"], ["STRUCTURE_INVALID"], ["STRUCTURE_INVALID"]] }))
  assert.equal(r.segments[1].text, "Nenhuma consulta foi concluída.")
  const none = stopResponse(newTurn())
  assert.deepEqual(none.segments.map((s: Any) => s.kind), ["phrase", "server_text"])
})

test("F3 — AV22: a falha com orçamento estourado TAMBÉM carrega BUDGET_LIMIT_REACHED (depois das linhas de tentativa e motivo)", () => {
  const s = stateWith({ caps: ["metrics.query@1"], budget: true, rejections: [["TIE_OVERCLAIM"], ["TIE_OVERCLAIM"], ["TIE_OVERCLAIM"]] })
  const r = stopResponse(s)
  assert.deepEqual(r.segments.map((x: Any) => x.kind === "phrase" ? x.code : x.kind), ["REGEN_EXHAUSTED", "server_text", "server_text", "BUDGET_LIMIT_REACHED"])
  assert.equal(r.segments.at(-1).text, PHRASES.BUDGET_LIMIT_REACHED)
})

test("F4 — falha de capacidade ⇒ + CAPABILITY_FAILED; FILE_NOT_AVAILABLE ⇒ + texto estrutural (último); ordem [REGEN, tentativas, motivo, BUDGET, CAPABILITY_FAILED, estrutural]", () => {
  const s = stateWith({ caps: ["metrics.query@1", "evidence.refresh@1"], errors: [["metrics.query@1", "ENGINE_REFUSED"], ["evidence.refresh@1", "FILE_NOT_AVAILABLE"]], budget: true, rejections: [["STALE_REF"], ["STALE_REF"], ["STALE_REF"]] })
  const r = stopResponse(s)
  assert.deepEqual(r.segments.map((x: Any) => x.kind === "phrase" ? x.code : x.kind), ["REGEN_EXHAUSTED", "server_text", "server_text", "BUDGET_LIMIT_REACHED", "CAPABILITY_FAILED", "VERIFICATION_INFRA_MISSING"])
  assert.equal(r.segments.at(-1).text, STRUCTURAL_TEXT)
  assert.equal(r.segments[1].text, "Consultas tentadas: consulta de métricas, regeração da evidência.")
})

test("F5 — invariantes: nenhum dígito, ref ou texto do modelo na resposta; só depende do estado; a função não tem parâmetro de resposta do modelo", () => {
  const s = stateWith({ caps: ["metrics.query@1", "metrics.groups@1", "rank.groups@1"], rejections: [["NUMBER_OUTSIDE_SLOT", "CAUSAL_CLAIM"], ["OPERATIONAL_ADVICE"], ["UNVERIFIED_USED_FOR_CONCLUSION"]] })
  const r = stopResponse(s)
  const dump = r.segments.map((x: Any) => x.text).join(" ")
  assert.equal(/\d|ev_|acc_|str_|lbl_|pat_/.test(dump), false, dump)
  assert.equal(JSON.stringify(stopResponse(s)), JSON.stringify(r))
  assert.equal(stopResponse.length, 1, "stopResponse(state) aceita SÓ o estado")
  const walk = (o: Any): void => { if (o && typeof o === "object") { assert.equal(Object.isFrozen(o), true); for (const v of Object.values(o)) walk(v) } }
  walk(r)
  for (const code of Object.keys(exp.e66_3["catalog_prose (proposta minha, revisão de redação como o O-G)"].rejection_phrases)) {
    const st = stateWith({ rejections: [[code], [code], [code]] })
    assert.ok(stopResponse(st).segments[2].text.startsWith("Motivo da última rejeição: "), code)
  }
})

console.log(`\n${passed} testes ok`)
