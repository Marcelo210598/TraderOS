// E6.6-2b: validador de TEXTO LIVRE (src/lib/agent/validate-text.ts + lexicon.ts) e validateAnswer (validate-answer.ts). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_2b (corpus de 231 casos, pipeline T0–T8, contextos, extensão do léxico) + lexicon/lexicon_must_reject/lexicon_must_accept.
// B1–B9 aprovados pelo Marcelo (13/10/2026). O corpus de COMPARISON_CONCLUSION é DEFESA PRIMÁRIA (C10 = B).
//   node scripts/test-agent-validate-text.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { REJECTION_REASONS } from "../src/lib/agent/contract.ts"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { LEXICON } from "../src/lib/agent/lexicon.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { validateText } from "../src/lib/agent/validate-text.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
const E2B: Any = exp.e66_2b
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const REF = (c: string): string => `ev_${c.repeat(32)}`

// ── fixtures: um handle por contexto ─────────────────────────────────────────
const qview = (): Any => ({ metrics: [{ metricId: "netPnl", value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null }], period: { from: null, to: null } })
const mv = (): Any => qview().metrics[0]
const rview = (): Any => ({ rows: [{ rank: 1, key: ["Conta A"], value: mv(), sampleFlag: "OK", tiedWithPrevious: false, contribution: 0.5, contributionReason: null }, { rank: 2, key: ["Conta B"], value: mv(), sampleFlag: "OK", tiedWithPrevious: true, contribution: 0.5, contributionReason: null }], orderedBy: "netPnl" })
const entry = (c: string, o: { source?: string; pop?: Any; cap?: string; view?: Any } = {}): Any => ({
  capability: o.cap ?? "metrics.query@1",
  handle: { evidenceRef: REF(c), evidenceHash: c.repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: o.pop ?? { declared: 10, verifiability: "FULL", sampleFlag: "OK", conclusive: true }, refEpoch: "s1", freshness: "CURRENT",
    verdict: buildVerdict({ status: "VALID", codes: [] }, { status: (o.source ?? "SOURCE_VERIFIED") as never, codes: [] }) },
  view: o.view ?? qview(),
})
const LEDGER: Any = (() => {
  let l: Any = (newLedger("s1") as Any).ledger
  for (const e of [entry("a"), entry("c", { source: "NOT_RUN" }), entry("d", { pop: { declared: 10, verifiability: "FULL", sampleFlag: "LOW" } }), entry("b", { pop: { declared: 10, verifiability: "FULL", sampleFlag: "OK", conclusive: false } }), entry("e", { cap: "rank.groups@1", view: rview() })]) { const r: Any = addEvidence(l, e); assert.equal(r.ok, true); l = r.ledger }
  return l
})()
const PATH = "metrics[0].value"
const CTX: Record<string, { claims: Any[]; question?: string }> = {
  V: { claims: [{ ref: REF("a"), path: PATH, mode: "ASSERT" }] },
  L: { claims: [{ ref: REF("c"), path: PATH, mode: "LABELED" }] },
  LOW: { claims: [{ ref: REF("d"), path: PATH, mode: "ASSERT" }] },
  TIE: { claims: [{ ref: REF("e"), path: "rows[1].contribution", mode: "ASSERT" }] },
  CONC0: { claims: [{ ref: REF("b"), path: PATH, mode: "ASSERT" }] },
  N: { claims: [] },
  Q: { claims: [{ ref: REF("a"), path: PATH, mode: "ASSERT" }], question: "Perdi 100 e ganhei 1.500,50 hoje" },
}
/** texto do corpus → segmentos: [[S]] slot · [[P]] frase · [[T]] fronteira entre DOIS segmentos de texto (sem espaço) */
function toSegments(text: string, ctx: string): Any[] {
  const primary = CTX[ctx].claims[0] ?? { ref: REF("a"), path: PATH }
  const out: Any[] = []
  for (const part of text.split(/(\[\[S\]\]|\[\[P\]\]|\[\[T\]\])/)) {
    if (part === "[[S]]") out.push({ kind: "slot", ref: primary.ref, path: primary.path })
    else if (part === "[[P]]") out.push({ kind: "phrase", code: "POPULATION_DECLARED", ref: primary.ref })
    else if (part === "[[T]]" || part === "") continue
    else out.push({ kind: "text", text: part })
  }
  return out
}
const answerOf = (text: string, ctx: string): Any => ({ segments: toSegments(text, ctx), claims: CTX[ctx].claims })
const textOf = (c: Any): string => (c.id === "z01" ? "a".repeat(4001) : c.id === "z02" ? "a".repeat(4000) : c.text)
const run = (answer: unknown, question = ""): Any => validateText({ answer, ledger: LEDGER, question })

test("C0 — o corpus tem 231 casos em 13 classes, os marcados FN/FP batem com as listas da expectativa, e cada caso tem contexto conhecido", () => {
  const cases: Any[] = E2B.corpus.cases
  assert.equal(E2B.corpus.count, 231)
  assert.equal(cases.length, 231)
  assert.equal(new Set(cases.map((c) => c.id)).size, 231, "ids repetidos")
  assert.equal(new Set(cases.map((c) => c.classe)).size, 13)
  for (const c of cases) assert.ok(Object.hasOwn(CTX, c.ctx), `${c.id}: contexto ${c.ctx}`)
  assert.equal(cases.filter((c) => c.mark === "FN").length, E2B.known_false_negatives.length)
  assert.equal(cases.filter((c) => c.mark === "FP").length, E2B.accepted_false_positives.length)
  for (const c of cases.filter((x) => x.mark === "FN")) assert.deepEqual(c.expect, [], `${c.id}: FN conhecido tem esperado []`)
})

test("C1 — O CORPUS INTEIRO: cada caso, no seu contexto, devolve EXATAMENTE os motivos esperados (231 casos; ordem do texto)", () => {
  const wrong: string[] = []
  for (const c of E2B.corpus.cases as Any[]) {
    const r = run(answerOf(textOf(c), c.ctx), CTX[c.ctx].question ?? "")
    const got = r.ok ? [] : r.reasons
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) wrong.push(`${c.id} [${c.ctx}] esperado ${JSON.stringify(c.expect)} obtido ${JSON.stringify(got)} — ${c.note}`)
  }
  assert.deepEqual(wrong, [], `\n${wrong.join("\n")}`)
})

test("C2 — por classe: cada classe do corpus tem casos de REJEIÇÃO e (exceto empate de contexto TIE) de ACEITE; a classe comparacao (defesa primária) tem 56 rejeições e 14 aceites", () => {
  const by = new Map<string, { rej: number; acc: number }>()
  for (const c of E2B.corpus.cases as Any[]) { const e = by.get(c.classe) ?? { rej: 0, acc: 0 }; if (c.expect.length) e.rej += 1; else e.acc += 1; by.set(c.classe, e) }
  for (const [k, v] of by) { assert.ok(v.rej >= 1, `${k} sem rejeição`); assert.ok(v.acc >= 1, `${k} sem aceite`) }
  // comparação/conclusão sobre NOT_VERIFIED: 70 casos, 56 rejeições (6 delas por alfabeto/formato) e 14 aceites — o "67 casos" dito antes contava os 67 primeiros, incluindo textos bons
  assert.deepEqual(by.get("comparacao"), { rej: 56, acc: 14 })
  assert.ok((E2B.corpus.cases as Any[]).filter((c) => c.classe === "comparacao" && c.expect.includes("UNVERIFIED_USED_FOR_CONCLUSION")).length >= 45)
})

test("C3 — o corpus APROVADO antes (lexicon_must_reject, nos contextos certos) continua 100% rejeitado; as 18 frases boas continuam aceitas em V; em L, exatamente as 5 previstas passam a ser rejeitadas", () => {
  const ctxFor: Record<string, string> = { inconclusive_when_conclusive_false: "LOW", comparison_when_labeled_claim: "L" }
  for (const [k, v] of Object.entries(exp.lexicon_must_reject as Record<string, Any>)) {
    if (k === "note") continue
    for (const t of (Array.isArray(v) ? v : [v]) as string[]) {
      const ctx = ctxFor[k] ?? "V"
      const r = run(answerOf(t, ctx))
      assert.equal(r.ok, false, `${k}: "${t}" deveria continuar rejeitada`)
    }
  }
  const good: string[] = exp.lexicon_must_accept.sentences
  assert.equal(good.length, 18)
  for (const t of good) assert.equal(run(answerOf(t, "V")).ok, true, `V: "${t}" deveria passar`)
  const nowRejectedInL = good.filter((t) => !run(answerOf(t, "L")).ok)
  assert.equal(nowRejectedInL.length, 5, `em L devem cair exatamente 5: ${nowRejectedInL.join(" | ")}`)
  for (const frag of ["maior parte das perdas", "melhor desempenho que", "primeiro grupo lidera", "ficou atrás", "Às vezes mais perdas"]) assert.ok(nowRejectedInL.some((t) => t.includes(frag)), frag)
})

test("L0 — o léxico do CÓDIGO == o léxico das expectativas (aprovado + extensão), categoria por categoria (nenhuma lista pode derivar sem o teste cair)", () => {
  const L = exp.lexicon
  const X = E2B.lexicon_extension
  const same = (name: string, code: readonly string[], json: string[]) => { assert.deepEqual([...new Set(code)].sort(), [...new Set(json)].sort(), name); assert.equal(code.length, new Set(code).size, `${name}: termo repetido no código`) }
  same("NUM_WORDS", LEXICON.NUM_WORDS, [...L.NUM_WORDS.terms, ...X.NUM_WORDS_add])
  same("APPROX", LEXICON.APPROX, [...L.APPROX.terms, ...X.APPROX_add])
  same("ARITH", LEXICON.ARITH, [...L.ARITH.terms, ...X.ARITH_add])
  same("CAUSAL", LEXICON.CAUSAL, [...L.CAUSAL.terms, ...X.CAUSAL_add])
  same("SCOPE", LEXICON.SCOPE, [...L.SCOPE.terms, ...X.SCOPE_add])
  same("INCONCLUSIVE", LEXICON.INCONCLUSIVE, [...L.INCONCLUSIVE.terms, ...X.INCONCLUSIVE_add])
  same("NEGATION", LEXICON.NEGATION_WORDS, X.INCONCLUSIVE_negation_words_add)
  same("EXIT_OVERCLAIM", LEXICON.EXIT_OVERCLAIM, [...L.EXIT_OVERCLAIM.terms, ...X.EXIT_OVERCLAIM_add])
  same("ADVICE", LEXICON.ADVICE, [...L.ADVICE.terms, ...X.ADVICE_add])
  same("TIE", LEXICON.TIE, [...L.TIE.terms, ...X.TIE_add])
  same("COMPARISON", LEXICON.COMPARISON, [...L.COMPARISON_CONCLUSION.terms, ...X.COMPARISON_CONCLUSION_widened["words (palavra inteira)"], ...X.COMPARISON_CONCLUSION_widened.phrases])
  same("BASIS", LEXICON.BASIS, X.BASIS_words)
  same("SQUEEZE", LEXICON.SQUEEZE, X.SQUEEZE_terms)
  same("ARITH_EXCEPTION_TERMS", LEXICON.ARITH_EXCEPTION_TERMS, [...L.ARITH.prev_word_exceptions.terms, "vez e meia"])
  same("ARITH_EXCEPTION_PREV", LEXICON.ARITH_EXCEPTION_PREV, L.ARITH.prev_word_exceptions.not_rejected_if_previous_word_is)
  for (const [k, list] of Object.entries(LEXICON)) for (const t of list as string[]) assert.match(t, /^[a-z]+(?: [a-z]+)*$/, `${k}: termo fora da forma FLAT: ${t}`)
})

test("T1 — CADA TERMO funciona: para cada um dos 627 termos de lista (todas as categorias), a frase neutra 'Veja <termo> agora.' no contexto da categoria é rejeitada com o motivo da categoria (prova que nenhum termo está digitado/normalizado errado; o corpus escrito à mão prende só parte dos termos, medido por remoção: ver history)", () => {
  const plan: Array<[keyof typeof LEXICON, string, string]> = [
    ["NUM_WORDS", "V", "NUMBER_OUTSIDE_SLOT"], ["APPROX", "V", "NUMBER_OUTSIDE_SLOT"], ["ARITH", "V", "MODEL_ARITHMETIC"], ["CAUSAL", "V", "CAUSAL_CLAIM"], ["SCOPE", "V", "SCOPE_OVERCLAIM"],
    ["INCONCLUSIVE", "LOW", "INCONCLUSIVE_AS_CONCLUSIVE"], ["EXIT_OVERCLAIM", "V", "EXIT_REASON_OVERCLAIM"], ["ADVICE", "V", "OPERATIONAL_ADVICE"], ["TIE", "V", "TIE_OVERCLAIM"],
    ["COMPARISON", "L", "UNVERIFIED_USED_FOR_CONCLUSION"], ["BASIS", "V", "NUMBER_OUTSIDE_SLOT"],
  ]
  let n = 0
  const wrong: string[] = []
  for (const [cat, ctx, reason] of plan) for (const term of LEXICON[cat] as readonly string[]) {
    n += 1
    const r = run(answerOf(`Veja ${term} agora.`, ctx))
    if (r.ok || !r.reasons.includes(reason)) wrong.push(`${cat}: "${term}" → ${JSON.stringify(r)}`)
  }
  assert.equal(n, 627)
  assert.deepEqual(wrong, [])
  // e o mesmo termo NÃO é rejeitado fora do contexto que o liga (COMPARISON só em L; INCONCLUSIVE só em LOW; TIE some em TIE)
  for (const term of LEXICON.COMPARISON) assert.equal(run(answerOf(`Veja ${term} agora.`, "V")).ok === false && (run(answerOf(`Veja ${term} agora.`, "V")) as Any).reasons.includes("UNVERIFIED_USED_FOR_CONCLUSION"), false, `COMPARISON "${term}" não deve ligar em V`)
  for (const term of LEXICON.INCONCLUSIVE) assert.equal((run(answerOf(`Veja ${term} agora.`, "V")) as Any).reasons?.includes("INCONCLUSIVE_AS_CONCLUSIVE") ?? false, false, `INCONCLUSIVE "${term}" não deve ligar em V`)
  for (const term of LEXICON.TIE) assert.equal((run(answerOf(`Veja ${term} agora.`, "TIE")) as Any).reasons?.includes("TIE_OVERCLAIM") ?? false, false, `TIE "${term}" liberado quando a linha está empatada`)
  for (const term of LEXICON.BASIS) assert.equal(run(answerOf(`Veja ${term} agora.`, "N")).ok, true, `BASIS "${term}" sem claim é livre`)
})

test("A1 — API: nunca lança (entrada qualquer); erro só tem `ok` e `reasons`; sem eco; puro (entrada intacta, mesma saída); motivos ⊂ REJECTION_REASONS", () => {
  const MARK = "zzmarcadorzz"
  const a = answerOf(`Recomendo ${MARK} porque sim.`, "V")
  const snap = JSON.stringify(a)
  const r1 = run(a)
  assert.equal(r1.ok, false)
  assert.deepEqual(Object.keys(r1).sort(), ["ok", "reasons"])
  assert.equal(JSON.stringify(r1).includes(MARK), false)
  assert.equal(JSON.stringify(a), snap)
  assert.equal(JSON.stringify(run(a)), JSON.stringify(r1))
  for (const x of r1.reasons) assert.ok((REJECTION_REASONS as readonly string[]).includes(x))
  for (const bad of [null, undefined, 5, "x", [], {}, { segments: [], claims: [] }, { segments: [{ kind: "text" }], claims: [] }]) { assert.doesNotThrow(() => run(bad)); assert.deepEqual(run(bad), { ok: false, reasons: ["STRUCTURE_INVALID"] }) }
  for (const l of [null, undefined, 5, {}]) assert.doesNotThrow(() => validateText({ answer: answerOf("ok", "V"), ledger: l as never, question: "" }))
  for (const q of [null, undefined, 5, {}]) assert.doesNotThrow(() => validateText({ answer: answerOf("ok", "V"), ledger: LEDGER, question: q as never }))
  const hostile: Any = { claims: [] }
  Object.defineProperty(hostile, "segments", { enumerable: true, get() { throw new Error("getter hostil") } })
  assert.doesNotThrow(() => run(hostile))
  assert.deepEqual(run(hostile), { ok: false, reasons: ["STRUCTURE_INVALID"] })
  assert.doesNotThrow(() => validateText(null as never))
})

test("A2 — AV21 e B7: os números citáveis vêm SÓ da pergunta do turno (NFKC, ASCII, mesma grafia); pergunta sem número ⇒ nenhuma citação vale; citação de outro formato (1500,50 ≠ 1.500,50) não vale", () => {
  const q = (text: string, question: string) => run({ segments: [{ kind: "text", text }], claims: [] }, question)
  assert.equal(q('Você citou "100".', "Perdi 100 hoje").ok, true)
  assert.equal(q('Você citou "100".', "Perdi 200 hoje").ok, false)
  assert.equal(q('Você citou "100".', "").ok, false)
  assert.equal(q('Você citou "1500,50".', "ganhei 1.500,50").ok, false)
  assert.equal(q('Você citou "1.500,50".', "ganhei 1.500,50").ok, true)
  assert.equal(q('Você citou "100".', "Perdi １００ hoje").ok, true, "pergunta em largura total vira ASCII (NFKC)")
  assert.equal(q('Você citou "١٠٠".', "Perdi 100 hoje").ok, true, "citação em algarismos árabe-índico = 100")
  assert.equal(q('Você citou "100" e disse "tres".', "Perdi 100").ok, false)
  // limite de 24 caracteres do conteúdo citado (AV21): 24 dígitos passam, 25 não — mesmo que o número esteja na pergunta
  const n24 = "1".repeat(24), n25 = "1".repeat(25)
  assert.equal(q(`Você citou "${n24}".`, `Perdi ${n24}`).ok, true)
  assert.equal(q(`Você citou "${n25}".`, `Perdi ${n25}`).ok, false)
})

test("A3 — limites (B5): 4000 caracteres e 200 segmentos; 201 segmentos ⇒ STRUCTURE_INVALID e nada mais é lido; 4000 'a' passa; texto adversarial de 4000 letras soltas termina", () => {
  const seg = (n: number) => ({ segments: Array.from({ length: n }, () => ({ kind: "text", text: "a" })), claims: [] })
  assert.equal(run(seg(200)).ok, true)
  assert.deepEqual(run(seg(201)), { ok: false, reasons: ["STRUCTURE_INVALID"] })
  assert.deepEqual(run({ segments: [{ kind: "text", text: "a".repeat(2000) }, { kind: "text", text: "b".repeat(2001) }], claims: [] }), { ok: false, reasons: ["STRUCTURE_INVALID"] })
  const t0 = Date.now()
  assert.equal(run({ segments: [{ kind: "text", text: "a ".repeat(2000) }], claims: [] }).ok, true)
  assert.equal(run({ segments: [{ kind: "text", text: "x.".repeat(2000) }], claims: [] }).ok, true)
  assert.ok(Date.now() - t0 < 5000, "texto adversarial de 4000 caracteres demorou demais")
})

test("A4 — B8: só o texto do MODELO passa pelo léxico; slots e frases (renderizados pelo servidor) não; frase e slot no meio do texto são fronteiras", () => {
  const withPhrase = { segments: [{ kind: "phrase", code: "POPULATION_DECLARED", ref: REF("a") }, { kind: "slot", ref: REF("a"), path: PATH }], claims: CTX.V.claims }
  assert.equal(run(withPhrase).ok, true)
  assert.equal(run({ segments: [{ kind: "text", text: "Veja" }, { kind: "slot", ref: REF("a"), path: PATH }, { kind: "text", text: "tambem" }], claims: CTX.V.claims }).ok, true)
})

test("A5 — contextos derivados do LEDGER e dos claims: LABELED liga a comparação (nível da resposta); sampleFlag LOW liga o inconclusivo; linha empatada liga o TIE; sem claim não há contexto", () => {
  const withClaims = (text: string, claims: Any[]) => run({ segments: [{ kind: "text", text }], claims })
  const L = CTX.L.claims, V = CTX.V.claims
  assert.equal(withClaims("A é melhor que B.", V).ok, true)
  assert.equal(withClaims("A é melhor que B.", L).ok, false)
  assert.equal(withClaims("A é melhor que B.", [...V, ...L]).ok, false, "um LABELED em qualquer ref liga a regra para a resposta toda")
  assert.equal(withClaims("É conclusivo.", V).ok, true)
  assert.equal(withClaims("É conclusivo.", CTX.LOW.claims).ok, false)
  assert.equal(withClaims("É conclusivo.", CTX.CONC0.claims).ok, false, "conclusive=false SEM sampleFlag pequeno também liga o inconclusivo")
  assert.equal(withClaims("Houve empate.", V).ok, false)
  assert.equal(withClaims("Houve empate.", CTX.TIE.claims).ok, true)
  assert.equal(withClaims("Houve empate.", [{ ref: REF("e"), path: "rows[0].contribution", mode: "ASSERT" }]).ok, false, "linha 0 não está empatada")
  assert.equal(withClaims("Resultado líquido.", []).ok, true, "sem claim: explicação livre")
  assert.equal(withClaims("Resultado líquido.", V).ok, false)
  // contexto só APERTA, nunca afrouxa: claim LABELED com ref que o ledger não tem (a estrutura o rejeita) continua ligando a regra de comparação; já TIE e a ausência de
  // inconclusivo exigem handle do ledger (um ref desconhecido não "libera" empate nem esconde amostra pequena)
  assert.equal(withClaims("A é melhor que B.", [{ ref: REF("f"), path: PATH, mode: "LABELED" }]).ok, false)
  assert.equal(withClaims("Houve empate.", [{ ref: REF("f"), path: "rows[1].contribution", mode: "ASSERT" }]).ok, false)
  assert.equal(withClaims("É conclusivo.", [{ ref: REF("f"), path: PATH, mode: "ASSERT" }]).ok, true, "ref desconhecido não liga INCONCLUSIVE (não há handle com amostra pequena)")
})

test("V1 — validateAnswer: junta os motivos ESTRUTURAIS e de TEXTO sem duplicata, na ordem de combined_order (que é uma permutação dos 18 motivos); forma inválida devolve só STRUCTURE_INVALID", () => {
  const order: string[] = E2B.api.combined_order
  assert.deepEqual([...order].sort(), [...REJECTION_REASONS].sort())
  assert.equal(order.length, 18)
  const answer = { segments: [{ kind: "text", text: "Perdeu porque sim, sempre." }, { kind: "slot", ref: REF("a"), path: PATH }], claims: CTX.V.claims }
  const r: Any = validateAnswer({ answer, ledger: LEDGER, stop: null, question: "" })
  assert.equal(r.ok, false)
  assert.deepEqual(r.reasons, ["CAUSAL_CLAIM", "SCOPE_OVERCLAIM"], "SCOPE_OVERCLAIM vem do texto E da falta da frase de população: uma vez só")
  const mixed: Any = validateAnswer({ answer: { segments: [{ kind: "text", text: "Recomendo A." }, { kind: "slot", ref: REF("f"), path: PATH }], claims: [{ ref: REF("f"), path: PATH, mode: "ASSERT" }] }, ledger: LEDGER, stop: "BUDGET_CALLS", question: "" })
  assert.deepEqual(mixed.reasons, ["REF_NOT_IN_LEDGER", "OPERATIONAL_ADVICE", "INCOMPLETE_PRESENTED_AS_COMPLETE"])
  assert.deepEqual(validateAnswer({ answer: {}, ledger: LEDGER, stop: null, question: "" }), { ok: false, reasons: ["STRUCTURE_INVALID"] })
  const good: Any = validateAnswer({ answer: { segments: [{ kind: "text", text: "Resultado:" }, { kind: "slot", ref: REF("a"), path: PATH }, { kind: "phrase", code: "POPULATION_DECLARED", ref: REF("a") }], claims: CTX.V.claims }, ledger: LEDGER, stop: null, question: "" })
  assert.equal(good.ok, true)
  assert.deepEqual(good.claims, [{ ref: REF("a"), path: PATH, mode: "ASSERT", combined: "VERIFIED" }])
  for (const bad of [null, undefined, 5]) assert.doesNotThrow(() => validateAnswer(bad as never))
})

test("S1 — guardas estáticos: validate-text.ts, validate-answer.ts e lexicon.ts importam só de './'; sem Date/aleatório/ambiente/rede; o texto do modelo NUNCA vira RegExp (sem `new RegExp`); o léxico é dado puro (sem lógica)", () => {
  const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  for (const f of ["validate-text.ts", "validate-answer.ts", "lexicon.ts"]) {
    const code = strip(readFileSync(`${ROOT}src/lib/agent/${f}`, "utf8"))
    for (const m of code.matchAll(/^import\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)) assert.ok(m[1].startsWith("./") || m[1] === "zod", `${f}: import ${m[1]}`)
    assert.equal(/\bDate\b|Math\.random|\bprocess\b|\bfetch\b|globalThis|setTimeout|node:|prisma/i.test(code), false, `${f}: dependência proibida`)
    assert.equal(/new\s+RegExp|\beval\s*\(|new\s+Function/.test(code), false, `${f}: regex/código dinâmico`)
    assert.equal(/["'`](?:VERIFIED_PARTIAL|VERIFIED|NOT_VERIFIED|TAMPERED_OR_MISMATCH)["'`]/.test(code), false, `${f}: literal de CombinedVerdict`)
  }
  const lex = strip(readFileSync(`${ROOT}src/lib/agent/lexicon.ts`, "utf8"))
  assert.equal(/\bfunction\b|=>|\bif\s*\(/.test(lex), false, "lexicon.ts deve ser só dado")
})

console.log(`\n${passed} testes ok`)
