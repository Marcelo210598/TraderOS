// E6.6-2a: validador ESTRUTURAL (src/lib/agent/validate-structure.ts; agent-capabilities.md §5.2 passos 1–4 e 6). Testes escritos ANTES do código (o arquivo ainda NÃO existe).
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_2a (rules_by_step, decisions_2a, cases V0–V21) + agent-contract.expected.json → validator_cases AV2–AV4, 7, 8, 10, 11, 15–18, 20, 22, 24.
// Decisões do Marcelo (13/10/2026): C1 STRUCTURE_INVALID no contrato; C10 = B (LABELED aceito em DERIVED; "concluir" é LEXICAL, 2b); C2–C9 como recomendado.
//   node scripts/test-agent-validate-structure.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { REJECTION_REASONS } from "../src/lib/agent/contract.ts"
import { addEvidence, newLedger, rotateEpoch } from "../src/lib/agent/ledger.ts"
import { validateStructure } from "../src/lib/agent/validate-structure.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
// letras de fixture → dígito hex (g..k e z/y não são hex; o ref tem de casar com /^ev_[0-9a-f]{32}$/)
const HEX: Record<string, string> = { a: "a", b: "b", c: "c", d: "d", e: "e", f: "f", g: "1", h: "2", i: "3", j: "4", k: "5", y: "8", z: "9" }
const REF = (c: string): string => `ev_${HEX[c].repeat(32)}`

// ── fixtures: um handle por situação de veredito ─────────────────────────────
const qview = (): Any => ({ metrics: [{ metricId: "netPnl", value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null }], period: { from: "2026-01-05", to: "2026-01-30" } })
const cview = (): Any => ({ a: { key: ["Conta A"], sampleSize: 4 }, b: { key: ["Conta B"], sampleSize: 6 }, deltas: [{ metricId: "netPnl", unit: "usd", a: 1, b: 2, delta: -1, ratio: 0.5 }], conclusive: true })
interface H { verify?: string; source?: string; vcodes?: string[]; scodes?: string[]; pop?: Any; subject?: string; cap?: string; epoch?: string }
const PATH = "metrics[0].value"
const entry = (c: string, o: H = {}): Any => ({
  capability: o.cap ?? "metrics.query@1",
  handle: {
    evidenceRef: REF(c), evidenceHash: HEX[c].repeat(64), subject: { type: o.subject ?? "METRIC", id: "netPnl" }, scope: "TOTAL", population: o.pop ?? { declared: 10, verifiability: "FULL", sampleFlag: "OK", conclusive: true },
    refEpoch: o.epoch ?? "s1", freshness: "CURRENT", verdict: buildVerdict({ status: (o.verify ?? "VALID") as never, codes: o.vcodes ?? [] }, { status: (o.source ?? "SOURCE_VERIFIED") as never, codes: o.scodes ?? [] }),
  },
  view: (o.cap ?? "metrics.query@1") === "metrics.compare@1" ? cview() : qview(),
})
// a=VERIFIED · b=PARTIAL · c=NOT_VERIFIED(VALID) · d=NOT_VERIFIED(UNVERIFIABLE) · e=TAMPERED · f=INVALID_FORMAT · g=SOURCE_MISMATCH · h=NOT_VERIFIED DERIVED · i=VERIFIED conclusive=false · j=VERIFIED sampleFlag LOW · k=PARTIAL com 2 códigos
const HANDLES: Record<string, H> = {
  a: {}, b: { source: "SOURCE_VERIFIED_PARTIAL", scodes: ["S_POPULATION_PARTIAL"] }, c: { source: "NOT_RUN" }, d: { verify: "UNVERIFIABLE", vcodes: ["S_NO_IMPORTS"], source: "NOT_RUN" },
  e: { verify: "TAMPERED", source: "NOT_RUN" }, f: { verify: "INVALID_FORMAT", source: "NOT_RUN" }, g: { source: "SOURCE_MISMATCH" },
  h: { source: "NOT_RUN", subject: "DERIVED", cap: "metrics.compare@1" },
  i: { pop: { declared: 10, verifiability: "FULL", conclusive: false } }, j: { pop: { declared: 10, verifiability: "FULL", sampleFlag: "LOW" } },
  k: { source: "SOURCE_VERIFIED_PARTIAL", scodes: ["S_POPULATION_PARTIAL", "L_SALT_CHECK_DIVERGENT"] },
}
const ledger = (letters: string, epoch = "s1"): Any => {
  let l: Any = (newLedger(epoch) as Any).ledger
  for (const c of letters) { const r: Any = addEvidence(l, entry(c, { ...HANDLES[c], epoch })); assert.equal(r.ok, true, `fixture ${c}`); l = r.ledger }
  return l
}
const txt = (text = "ok") => ({ kind: "text", text })
const slot = (c: string, path = PATH) => ({ kind: "slot", ref: REF(c), path })
const phr = (code: string, c?: string) => (c === undefined ? { kind: "phrase", code } : { kind: "phrase", code, ref: REF(c) })
const claim = (c: string, mode: "ASSERT" | "LABELED" = "ASSERT", path = PATH) => ({ ref: REF(c), path, mode })
const ans = (segments: Any[], claims: Any[] = []): Any => ({ segments, claims })
const run = (answer: unknown, l: Any, stop: null | "BUDGET_CALLS" = null): Any => validateStructure({ answer, ledger: l, stop })
const reasons = (answer: unknown, l: Any, stop: null | "BUDGET_CALLS" = null): string[] => { const r = run(answer, l, stop); assert.equal(r.ok, false, `deveria rejeitar: ${JSON.stringify(r)}`); return r.reasons }
const accepts = (answer: unknown, l: Any, stop: null | "BUDGET_CALLS" = null): Any => { const r = run(answer, l, stop); assert.equal(r.ok, true, `deveria aceitar: ${JSON.stringify(r)}`); return r }
const POP = (c: string) => phr("POPULATION_DECLARED", c)

test("V0 — AV15: VERIFIED + slot ASSERT + frase POPULATION_DECLARED(ref) ⇒ aceita; claims[] devolve ref, path, mode e o combined do handle", () => {
  const r = accepts(ans([txt("Resultado:"), slot("a"), POP("a")], [claim("a")]), ledger("a"))
  assert.deepEqual(r, { ok: true, claims: [{ ref: REF("a"), path: PATH, mode: "ASSERT", combined: "VERIFIED" }] })
  // texto puro, sem número, sem handle citado ⇒ aceita (a barreira de texto livre é do 2b)
  accepts(ans([txt("Não há o que mostrar.")]), ledger("a"))
})

test("V1/V2 — AV2 e AV3: ref inexistente ou de OUTRO ledger/usuário ⇒ [REF_NOT_IN_LEDGER] (slot, claim e phrase.ref)", () => {
  assert.deepEqual(reasons(ans([slot("z")], [claim("z")]), ledger("a")), ["REF_NOT_IN_LEDGER"])
  const other = ledger("b") // "outro usuário": o ref `a` não existe aqui
  assert.deepEqual(reasons(ans([slot("a"), POP("a")], [claim("a")]), other), ["REF_NOT_IN_LEDGER"])
  assert.deepEqual(reasons(ans([txt(), POP("z")]), ledger("a")), ["REF_NOT_IN_LEDGER"])
  assert.deepEqual(reasons(ans([txt()], [claim("z")]), ledger("a")), ["REF_NOT_IN_LEDGER", "STRUCTURE_INVALID"]) // claim órfão (C2) + ref ausente
})

test("V3 — AV4: path inexistente, folha fora da tabela, __proto__, descer em escalar ⇒ [SLOT_PATH_INVALID]; falha de FORMATO (valor null sem motivo) NÃO é rejeição", () => {
  for (const p of ["metrics[9].value", "metrics[0].nope", "constructor", "toString", "metrics[0].metricId", "metrics[0].value.x", "metrics[0]", "metrics[01].value"]) assert.deepEqual(reasons(ans([slot("a", p), POP("a")], [claim("a", "ASSERT", p)]), ledger("a")), ["SLOT_PATH_INVALID"], p)
  // `__proto__` nem casa com a gramática do path (começa com `_`): é falha de FORMA, não de caminho
  assert.deepEqual(reasons(ans([slot("a", "__proto__"), POP("a")], [claim("a", "ASSERT", "__proto__")]), ledger("a")), ["STRUCTURE_INVALID"])
  const l0: Any = (newLedger("s1") as Any).ledger
  const v = qview(); v.metrics[0].value = null; v.metrics[0].reason = null
  const e = entry("a"); e.view = v
  const l1: Any = (addEvidence(l0, e) as Any).ledger
  accepts(ans([slot("a"), POP("a")], [claim("a")]), l1) // render falha depois (FORMAT_INVALID), o modelo não tem como consertar
})

test("V4 — AV7 e C9: TAMPERED/INVALID_FORMAT/SOURCE_MISMATCH e NOT_VERIFIED com verify ≠ VALID + slot ⇒ [NUMBER_FROM_UNVERIFIED_EVIDENCE]; também para slot de TEXTO; só frase de integridade (sem slot) ⇒ aceita", () => {
  for (const c of ["e", "f", "g", "d"]) {
    assert.deepEqual(reasons(ans([slot(c)], [claim(c, "LABELED")]), ledger(c)), ["NUMBER_FROM_UNVERIFIED_EVIDENCE"], c)
    assert.deepEqual(reasons(ans([slot(c)], [claim(c, "ASSERT")]), ledger(c)), ["NUMBER_FROM_UNVERIFIED_EVIDENCE"], `${c} ASSERT`)
  }
  assert.deepEqual(reasons(ans([slot("e", "period.from")], [claim("e", "ASSERT", "period.from")]), ledger("e")), ["NUMBER_FROM_UNVERIFIED_EVIDENCE"], "slot de texto/data também")
  accepts(ans([txt("Não vou citar números."), phr("INTEGRITY_SEAL", "e")]), ledger("e"))
  accepts(ans([phr("INTEGRITY_FORMAT", "f")]), ledger("f"))
  accepts(ans([phr("INTEGRITY_SOURCE", "g")]), ledger("g"))
  accepts(ans([phr("S_NO_IMPORTS", "d")]), ledger("d"))
})

test("V5 — AV8: NOT_VERIFIED (verify VALID) com claim ASSERT ⇒ [MISSING_NOT_VERIFIED_LABEL]; com claim LABELED ⇒ aceita", () => {
  assert.deepEqual(reasons(ans([slot("c")], [claim("c", "ASSERT")]), ledger("c")), ["MISSING_NOT_VERIFIED_LABEL"])
  const r = accepts(ans([slot("c")], [claim("c", "LABELED")]), ledger("c"))
  assert.deepEqual(r.claims, [{ ref: REF("c"), path: PATH, mode: "LABELED", combined: "NOT_VERIFIED" }])
  accepts(ans([slot("c"), phr("VERIFICATION_INFRA_MISSING", "c")], [claim("c", "LABELED")]), ledger("c"))
})

test("V6 — AV9 estrutural REMOVIDO (C10 = B): NOT_VERIFIED DERIVED com claim LABELED ⇒ ACEITA; o validador estrutural NUNCA emite UNVERIFIED_USED_FOR_CONCLUSION", () => {
  accepts(ans([slot("h", "deltas[0].delta")], [claim("h", "LABELED", "deltas[0].delta")]), ledger("h"))
  assert.deepEqual(reasons(ans([slot("h", "deltas[0].delta")], [claim("h", "ASSERT", "deltas[0].delta")]), ledger("h")), ["MISSING_NOT_VERIFIED_LABEL"])
  // varredura: nenhuma entrada estrutural produz o motivo lexical
  const some = [ans([slot("c")], [claim("c", "LABELED")]), ans([slot("h", "deltas[0].delta")], [claim("h", "ASSERT", "deltas[0].delta")]), ans([slot("e")], [claim("e")])]
  for (const a of some) { const r = run(a, ledger("ceh")); if (!r.ok) assert.equal(r.reasons.includes("UNVERIFIED_USED_FOR_CONCLUSION"), false) }
})

test("V7 — AV10 e C8: refs de épocas diferentes citados juntos ⇒ inclui REF_EPOCH_MIX (e STALE_REF para o antigo); só o antigo ⇒ só STALE_REF", () => {
  let l: Any = ledger("a", "s1")
  l = (rotateEpoch(l, "s2") as Any).ledger
  l = (addEvidence(l, entry("b", { epoch: "s2" })) as Any).ledger
  assert.deepEqual(reasons(ans([slot("a"), slot("b"), POP("a"), POP("b")], [claim("a"), claim("b")]), l), ["STALE_REF", "REF_EPOCH_MIX"])
  assert.deepEqual(reasons(ans([txt(), POP("a")]), l), ["STALE_REF"], "AV11: só o ref antigo")
  accepts(ans([slot("b"), POP("b")], [claim("b")]), l)
})

test("V8 — AV11: ref STALE depois de rotateEpoch (slot, claim ou frase) ⇒ [STALE_REF]", () => {
  const l: Any = (rotateEpoch(ledger("a"), "s2") as Any).ledger
  assert.deepEqual(reasons(ans([slot("a"), POP("a")], [claim("a")]), l), ["STALE_REF"])
  assert.deepEqual(reasons(ans([txt(), phr("INDICATIVE_ONLY", "a")]), l), ["STALE_REF"])
})

test("V9 — AV16 estrutural: VERIFIED + slot sem POPULATION_DECLARED(ref) ⇒ [SCOPE_OVERCLAIM]; frase do ref ERRADO ou sem ref (⇒ + STRUCTURE_INVALID) não vale", () => {
  assert.deepEqual(reasons(ans([slot("a")], [claim("a")]), ledger("a")), ["SCOPE_OVERCLAIM"])
  assert.deepEqual(reasons(ans([slot("a"), POP("b")], [claim("a")]), ledger("ab")), ["SCOPE_OVERCLAIM"])
  assert.deepEqual(reasons(ans([slot("a"), phr("POPULATION_DECLARED")], [claim("a")]), ledger("a")), ["STRUCTURE_INVALID", "SCOPE_OVERCLAIM"])
  accepts(ans([slot("a"), POP("a")], [claim("a")]), ledger("a"))
  // citar só a frase, sem número ⇒ não há escopo a exigir
  accepts(ans([txt("x"), POP("a")]), ledger("a"))
})

test("V10 — AV17 e C7: VERIFIED_PARTIAL sem a frase do(s) código(s) parcial(is) do handle ⇒ [MISSING_PARTIAL_PHRASE]; com TODOS ⇒ aceita; a frase de população NÃO é exigida em PARTIAL", () => {
  assert.deepEqual(reasons(ans([slot("b")], [claim("b")]), ledger("b")), ["MISSING_PARTIAL_PHRASE"])
  accepts(ans([slot("b"), phr("S_POPULATION_PARTIAL", "b")], [claim("b")]), ledger("b"))
  // handle com 2 códigos parciais: precisa dos dois
  assert.deepEqual(reasons(ans([slot("k"), phr("S_POPULATION_PARTIAL", "k")], [claim("k")]), ledger("k")), ["MISSING_PARTIAL_PHRASE"])
  accepts(ans([slot("k"), phr("S_POPULATION_PARTIAL", "k"), phr("L_SALT_CHECK_DIVERGENT", "k")], [claim("k")]), ledger("k"))
  // frase parcial do ref errado não vale
  assert.deepEqual(reasons(ans([slot("b"), phr("S_POPULATION_PARTIAL", "k")], [claim("b")]), ledger("bk")), ["MISSING_PARTIAL_PHRASE"])
})

test("V11 — AV18 estrutural: slot em handle com conclusive=false ou sampleFlag LOW/TINY sem INDICATIVE_ONLY(ref) ⇒ [INCONCLUSIVE_AS_CONCLUSIVE]; com ela ⇒ aceita", () => {
  for (const c of ["i", "j"]) {
    assert.deepEqual(reasons(ans([slot(c), POP(c)], [claim(c)]), ledger(c)), ["INCONCLUSIVE_AS_CONCLUSIVE"], c)
    accepts(ans([slot(c), POP(c), phr("INDICATIVE_ONLY", c)], [claim(c)]), ledger(c))
  }
  // NOT_VERIFIED rotulado com amostra pequena também exige
  const l: Any = (addEvidence((newLedger("s1") as Any).ledger, entry("c", { source: "NOT_RUN", pop: { declared: 3, verifiability: "FULL", sampleFlag: "TINY" } })) as Any).ledger
  assert.deepEqual(reasons(ans([slot("c")], [claim("c", "LABELED")]), l), ["INCONCLUSIVE_AS_CONCLUSIVE"])
  // sem slot, não há conclusão numérica a marcar
  accepts(ans([txt(), POP("i")]), ledger("i"))
})

test("V12 — AV20 (aceite): dois claims, um VERIFIED e um NOT_VERIFIED(LABELED) ⇒ aceita, claims[] com o combined de cada um", () => {
  const r = accepts(ans([slot("a"), POP("a"), slot("c")], [claim("a"), claim("c", "LABELED")]), ledger("ac"))
  assert.deepEqual(r.claims.map((c: Any) => [c.ref, c.mode, c.combined]), [[REF("a"), "ASSERT", "VERIFIED"], [REF("c"), "LABELED", "NOT_VERIFIED"]])
})

test("V13 — AV22: stop=BUDGET_CALLS sem BUDGET_LIMIT_REACHED ⇒ [INCOMPLETE_PRESENTED_AS_COMPLETE]; com a frase (sem ref) ⇒ aceita; a frase SEM stop ⇒ [STRUCTURE_INVALID]", () => {
  assert.deepEqual(reasons(ans([txt("Resposta.")]), ledger("a"), "BUDGET_CALLS"), ["INCOMPLETE_PRESENTED_AS_COMPLETE"])
  accepts(ans([txt("Parcial."), phr("BUDGET_LIMIT_REACHED")]), ledger("a"), "BUDGET_CALLS")
  assert.deepEqual(reasons(ans([phr("BUDGET_LIMIT_REACHED")]), ledger("a"), null), ["STRUCTURE_INVALID"])
  // a frase de limite COM ref é inválida e NÃO cumpre a exigência (só a sem ref cumpre)
  assert.deepEqual(reasons(ans([phr("BUDGET_LIMIT_REACHED", "a")]), ledger("a"), "BUDGET_CALLS"), ["STRUCTURE_INVALID", "INCOMPLETE_PRESENTED_AS_COMPLETE"])
})

test("V14 — AV24/passo 1: resposta fora do AgentAnswerSchema ⇒ [STRUCTURE_INVALID] e SÓ ele (nada mais é avaliado); nunca lança", () => {
  const bad: unknown[] = [null, undefined, 5, "x", [], {}, { segments: [], claims: [] }, { segments: [txt()] }, { claims: [] }, { segments: [txt()], claims: [], extra: 1 }, { segments: [{ kind: "nope" }], claims: [] },
    { segments: [{ kind: "slot", ref: "x", path: "a" }], claims: [] }, { segments: [txt()], claims: [{ ref: REF("a"), path: PATH }] }, { segments: [{ kind: "phrase", code: "NOPE" }], claims: [] }, { segments: [{ kind: "text", text: 5 }], claims: [] }]
  for (const b of bad) { assert.doesNotThrow(() => run(b, ledger("a"))); assert.deepEqual(reasons(b, ledger("a")), ["STRUCTURE_INVALID"]) }
  // mesmo com stop=BUDGET_CALLS, a forma inválida devolve só STRUCTURE_INVALID
  assert.deepEqual(reasons({}, ledger("a"), "BUDGET_CALLS"), ["STRUCTURE_INVALID"])
  const hostile: Any = { segments: [txt()], claims: [] }
  Object.defineProperty(hostile, "boom", { enumerable: true, get() { throw new Error("getter hostil") } })
  assert.doesNotThrow(() => run(hostile, ledger("a")))
  assert.deepEqual(reasons(hostile, ledger("a")), ["STRUCTURE_INVALID"])
  // getter que lança num campo QUE O SCHEMA LÊ (o `boom` acima o zod nem lê): a exceção não pode vazar
  const hostile2: Any = { claims: [] }
  Object.defineProperty(hostile2, "segments", { enumerable: true, get() { throw new Error("getter hostil em segments") } })
  assert.doesNotThrow(() => run(hostile2, ledger("a")))
  assert.deepEqual(reasons(hostile2, ledger("a")), ["STRUCTURE_INVALID"])
  const hostileLedger: Any = { epoch: "s1", entries: new Proxy({}, { has() { throw new Error("proxy hostil") }, getOwnPropertyDescriptor() { throw new Error("proxy hostil") }, get() { throw new Error("proxy hostil") } }) }
  assert.doesNotThrow(() => validateStructure({ answer: ans([slot("a"), POP("a")], [claim("a")]), ledger: hostileLedger, stop: null }))
  assert.deepEqual(validateStructure({ answer: ans([slot("a"), POP("a")], [claim("a")]), ledger: hostileLedger, stop: null }), { ok: false, reasons: ["STRUCTURE_INVALID"] })
  const cyc: Any = { segments: [txt()], claims: [] }; cyc.self = cyc
  assert.deepEqual(reasons(cyc, ledger("a")), ["STRUCTURE_INVALID"])
  assert.doesNotThrow(() => validateStructure(null as never))
  assert.doesNotThrow(() => validateStructure({ answer: ans([txt()]), ledger: null, stop: null } as never))
  assert.deepEqual(validateStructure({ answer: ans([txt()]), ledger: null, stop: null } as never), { ok: false, reasons: ["STRUCTURE_INVALID"] })
})

test("V15 — C2: slot sem claim, claim sem slot e claim duplicado ⇒ [STRUCTURE_INVALID]; o mesmo slot citado 2 vezes com UM claim é aceito", () => {
  assert.deepEqual(reasons(ans([slot("a"), POP("a")], []), ledger("a")), ["STRUCTURE_INVALID"])
  assert.deepEqual(reasons(ans([txt(), POP("a")], [claim("a")]), ledger("a")), ["STRUCTURE_INVALID"])
  assert.deepEqual(reasons(ans([slot("a"), POP("a")], [claim("a"), claim("a")]), ledger("a")), ["STRUCTURE_INVALID"])
  accepts(ans([slot("a"), txt("e de novo"), slot("a"), POP("a")], [claim("a")]), ledger("a"))
  // path diferente do mesmo ref = outro par: precisa de claim próprio
  assert.deepEqual(reasons(ans([slot("a"), slot("a", "metrics[0].sampleSize"), POP("a")], [claim("a")]), ledger("a")), ["STRUCTURE_INVALID"])
  accepts(ans([slot("a"), slot("a", "metrics[0].sampleSize"), POP("a")], [claim("a"), claim("a", "ASSERT", "metrics[0].sampleSize")]), ledger("a"))
})

test("V16 — C3: claim LABELED sobre handle VERIFIED ou VERIFIED_PARTIAL ⇒ [STRUCTURE_INVALID] (+ as frases obrigatórias seguem exigidas)", () => {
  assert.deepEqual(reasons(ans([slot("a"), POP("a")], [claim("a", "LABELED")]), ledger("a")), ["STRUCTURE_INVALID"])
  assert.deepEqual(reasons(ans([slot("b"), phr("S_POPULATION_PARTIAL", "b")], [claim("b", "LABELED")]), ledger("b")), ["STRUCTURE_INVALID"])
})

test("V17 — C4 e C5 (higiene de frases): por-ref sem ref; parada com ref; REGEN_EXHAUSTED/CAPABILITY_FAILED do modelo; INTEGRITY_SEAL num handle VERIFIED; S_SALT_RETIRED que o handle não tem; VERIFICATION_INFRA_MISSING com source ≠ NOT_RUN ⇒ [STRUCTURE_INVALID]", () => {
  const L = ledger("ac")
  const only = (segs: Any[], stop: null | "BUDGET_CALLS" = null): string[] => reasons(ans(segs), L, stop)
  assert.deepEqual(only([phr("INDICATIVE_ONLY")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("S_NO_IMPORTS")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("REGEN_EXHAUSTED")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("CAPABILITY_FAILED")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("REGEN_EXHAUSTED"), phr("BUDGET_LIMIT_REACHED")], "BUDGET_CALLS"), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("CAPABILITY_FAILED", "a")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("INTEGRITY_SEAL", "a")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("INTEGRITY_SOURCE", "a")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("INTEGRITY_FORMAT", "a")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("S_SALT_RETIRED", "a")]), ["STRUCTURE_INVALID"])
  assert.deepEqual(only([phr("VERIFICATION_INFRA_MISSING", "a")]), ["STRUCTURE_INVALID"], "a=VERIFIED: source ≠ NOT_RUN")
  assert.deepEqual(only([phr("S_POPULATION_PARTIAL", "a")]), ["STRUCTURE_INVALID"], "a não tem esse código")
  accepts(ans([phr("VERIFICATION_INFRA_MISSING", "c")]), L)
  accepts(ans([phr("INDICATIVE_ONLY", "a"), POP("c")]), L) // escopo e indicativo valem para qualquer handle citado
})

test("V18 — C6: acúmulo de motivos, SEM duplicata, na ORDEM dos passos (ref ausente ⇒ path inválido ⇒ NOT_VERIFIED sem rótulo ⇒ …)", () => {
  const a = ans([slot("z"), slot("a", "metrics[0].nope"), slot("c")], [claim("z"), claim("a", "ASSERT", "metrics[0].nope"), claim("c", "ASSERT")])
  assert.deepEqual(reasons(a, ledger("ac")), ["REF_NOT_IN_LEDGER", "SLOT_PATH_INVALID", "MISSING_NOT_VERIFIED_LABEL", "SCOPE_OVERCLAIM"])
  // dois refs ausentes ⇒ um motivo só
  assert.deepEqual(reasons(ans([slot("y"), slot("z")], [claim("y"), claim("z")]), ledger("a")), ["REF_NOT_IN_LEDGER"])
  // ordem dos motivos == ordem dos passos, para QUALQUER combinação (propriedade): a lista é sempre uma subsequência da ordem fixa
  const ORDER = ["REF_NOT_IN_LEDGER", "STALE_REF", "REF_EPOCH_MIX", "SLOT_PATH_INVALID", "STRUCTURE_INVALID", "NUMBER_FROM_UNVERIFIED_EVIDENCE", "MISSING_NOT_VERIFIED_LABEL", "SCOPE_OVERCLAIM", "MISSING_PARTIAL_PHRASE", "INCONCLUSIVE_AS_CONCLUSIVE", "INCOMPLETE_PRESENTED_AS_COMPLETE"]
  for (const r of reasons(a, ledger("ac"), "BUDGET_CALLS")) assert.ok(ORDER.includes(r))
  const idx = reasons(a, ledger("ac"), "BUDGET_CALLS").map((r) => ORDER.indexOf(r))
  assert.deepEqual(idx, [...idx].sort((x, y) => x - y))
  assert.equal(reasons(a, ledger("ac"), "BUDGET_CALLS").at(-1), "INCOMPLETE_PRESENTED_AS_COMPLETE")
  for (const r of ORDER) assert.ok((REJECTION_REASONS as readonly string[]).includes(r), `${r} não é motivo do contrato`)
})

test("V19 — sem eco: o erro só tem `ok` e `reasons`; nenhum ref, path ou texto da entrada aparece no resultado; os motivos são todos de REJECTION_REASONS", () => {
  const MARK = "ZZ_MARCADOR_ZZ"
  const r: Any = run(ans([txt(MARK), slot("z", `metrics[0].${MARK.replace(/_/g, "x")}`)], [claim("z", "ASSERT", `metrics[0].${MARK.replace(/_/g, "x")}`)]), ledger("a"))
  assert.equal(r.ok, false)
  assert.deepEqual(Object.keys(r).sort(), ["ok", "reasons"])
  assert.equal(JSON.stringify(r).includes(MARK.replace(/_/g, "x")), false)
  assert.equal(JSON.stringify(r).includes(MARK), false)
  assert.equal(JSON.stringify(r).includes(REF("z")), false)
  for (const x of r.reasons) assert.ok((REJECTION_REASONS as readonly string[]).includes(x), x)
})

test("V20 — nunca lança: ledger inválido, stop inválido, entrada hostil", () => {
  for (const stop of ["OUTRO", 5, {}, undefined]) assert.doesNotThrow(() => validateStructure({ answer: ans([txt()]), ledger: ledger("a"), stop } as never))
  assert.deepEqual(validateStructure({ answer: ans([txt()]), ledger: ledger("a"), stop: "OUTRO" } as never), { ok: false, reasons: ["STRUCTURE_INVALID"] }, "stop fora do contrato ⇒ falha fechada")
  assert.equal((validateStructure({ answer: ans([txt()]), ledger: ledger("a") } as never) as Any).ok, true, "stop ausente = null")
  for (const bad of [undefined, 5, "x", [], { ledger: {}, answer: {} }]) assert.doesNotThrow(() => validateStructure(bad as never))
})

test("V21 — puro: mesma entrada ⇒ mesmo resultado; a resposta e o ledger de entrada NÃO são alterados", () => {
  const a = ans([slot("a"), POP("a"), slot("c")], [claim("a"), claim("c", "LABELED")])
  const l = ledger("ac")
  const sa = JSON.stringify(a)
  const sl = JSON.stringify(l)
  const r1 = JSON.stringify(run(a, l))
  const r2 = JSON.stringify(run(a, l))
  assert.equal(r1, r2)
  assert.equal(JSON.stringify(a), sa)
  assert.equal(JSON.stringify(l), sl)
  const bad = ans([slot("z")], [])
  const sb = JSON.stringify(bad)
  run(bad, l)
  assert.equal(JSON.stringify(bad), sb)
})

test("V22 — a lista exata de motivos que o validador estrutural PODE emitir é um subconjunto de REJECTION_REASONS e NÃO contém os motivos léxicos (2b)", () => {
  const LEXICAL = ["NUMBER_OUTSIDE_SLOT", "MODEL_ARITHMETIC", "UNVERIFIED_USED_FOR_CONCLUSION", "CAUSAL_CLAIM", "EXIT_REASON_OVERCLAIM", "TIE_OVERCLAIM"]
  const seen = new Set<string>()
  const L = ledger("abcdefghijk")
  const probes: Any[] = [{}, ans([slot("z")], [claim("z")]), ans([slot("a", "x")], [claim("a", "ASSERT", "x")]), ans([slot("e")], [claim("e")]), ans([slot("c")], [claim("c")]), ans([slot("a")], [claim("a")]), ans([slot("b")], [claim("b")]), ans([slot("i"), POP("i")], [claim("i")]), ans([txt()])]
  for (const p of probes) for (const stop of [null, "BUDGET_CALLS"] as const) { const r = run(p, L, stop); if (!r.ok) for (const x of r.reasons) seen.add(x) }
  for (const x of seen) assert.equal(LEXICAL.includes(x), false, `motivo léxico emitido pela estrutura: ${x}`)
  assert.ok(seen.size >= 8, `sondas cobriram só ${[...seen].join(",")}`)
})

test("V23 — guardas estáticos do validador estrutural: só importa de './'; sem relógio/aleatório/ambiente; NUNCA escreve o motivo léxico UNVERIFIED_USED_FOR_CONCLUSION (C10 = B: ele é do 2b); não faz cast de veredito (LIMITAÇÃO: provam texto, não fluxo)", () => {
  const code = readFileSync(`${ROOT}src/lib/agent/validate-structure.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  const imports = [...code.matchAll(/^import\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  assert.deepEqual(imports.sort(), ["./contract.ts", "./ledger.ts", "./phrases.ts", "./slot-path.ts"])
  assert.equal(/\bDate\b|Math\.random|\bprocess\b|\bfetch\b|globalThis|setTimeout/.test(code), false)
  assert.equal(/UNVERIFIED_USED_FOR_CONCLUSION|NUMBER_OUTSIDE_SLOT|MODEL_ARITHMETIC|CAUSAL_CLAIM/.test(code), false, "motivo léxico dentro do validador estrutural")
  assert.equal(/\bas\s+(?:Verdict|EvidenceHandle)\b/.test(code), false)
  const led = readFileSync(`${ROOT}src/lib/agent/ledger.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  assert.equal(/\bDate\b|Math\.random|\bprocess\b|\bfetch\b|globalThis|setTimeout|^(?:let|var)\s/m.test(led), false)
  assert.deepEqual([...led.matchAll(/^import\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]).sort(), ["./contract.ts", "./views.ts"])
})

console.log(`\n${passed} testes ok`)
