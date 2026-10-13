// E6.6-3: máquina de estados do TURNO (src/lib/agent/turn.ts) + catálogos de prosa (src/lib/agent/catalog.ts). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_3 (turn_machine, catalog_prose, cases.state) + error_code_to_stop_reason.
// Cobre AV19 (N=2) e AV22 (orçamento de 8 chamadas) e o mapeamento TOTAL erro→parada (Q10/§2.1 do plano).
//   node scripts/test-agent-turn.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AGENT_MAX_CALLS_PER_TURN, AGENT_MAX_REGENERATIONS, CAPABILITY_IDS, CapabilityErrorCodeSchema, CombinedVerdictSchema, REJECTION_REASONS, STOP_REASONS } from "../src/lib/agent/contract.ts"
import { BANNER_LABELS, CAPABILITY_LABELS, REJECTION_PHRASES } from "../src/lib/agent/catalog.ts"
import { PHRASES } from "../src/lib/agent/phrases.ts"
import { newTurn, notices, recordError, recordRejection, requestCall, stopReasonForError, validatorStop } from "../src/lib/agent/turn.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
const E3: Any = exp.e66_3
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const Q = "metrics.query@1", G = "metrics.groups@1", R = "rank.groups@1"
const call = (s: Any, cap: string): Any => requestCall(s, cap as never)

test("T1 — orçamento: 8 chamadas executam; a 9ª NÃO executa (BUDGET_EXCEEDED, calls fica 8, budgetExceeded=true, `tried` não ganha a 9ª); depois do estouro continua negado", () => {
  assert.equal(AGENT_MAX_CALLS_PER_TURN, 8)
  let s: Any = newTurn()
  assert.deepEqual([s.calls, s.rejections, s.tried, s.failed, s.budgetExceeded, s.lastReasons], [0, 0, [], [], false, []])
  const caps = [Q, G, Q, R, Q, G, Q, Q]
  caps.forEach((c, i) => { const r = call(s, c); assert.equal(r.ok, true, `chamada ${i + 1}`); assert.equal(r.state.calls, i + 1); s = r.state })
  assert.deepEqual(s.tried, [Q, G, R], "tried: distintas, na ordem da 1ª chamada")
  assert.equal(s.budgetExceeded, false)
  const nine = call(s, "exit.analysis@1")
  assert.deepEqual(nine.error, { code: "BUDGET_EXCEEDED" })
  assert.equal(nine.ok, false)
  assert.equal(nine.state.calls, 8)
  assert.equal(nine.state.budgetExceeded, true)
  assert.deepEqual(nine.state.tried, [Q, G, R], "a 9ª capacidade não entra em tried")
  assert.equal(call(nine.state, Q).ok, false, "depois do estouro segue negado")
  assert.equal(validatorStop(s), null)
  assert.equal(validatorStop(nine.state), "BUDGET_CALLS")
})

test("T2 — emenda D7: capacidade fora de CAPABILITY_IDS ⇒ ARGS_INVALID e CONSOME 1 chamada (tried/failed não mudam); 8 ids inventados esgotam o orçamento e o 9º já é BUDGET_EXCEEDED", () => {
  const s: Any = newTurn()
  for (const c of ["x@1", "", "__proto__", "constructor", null, undefined, 5, "metrics.query"]) {
    const r = call(s, c as never)
    assert.deepEqual([r.ok, r.error], [false, { code: "ARGS_INVALID" }], String(c))
    assert.equal(r.state.calls, 1, `${String(c)}: a tentativa inválida custa uma chamada`)
    assert.deepEqual(r.state.tried, [])
    assert.deepEqual(r.state.failed, [])
    assert.equal(r.state.budgetExceeded, false)
    assert.equal(s.calls, 0, "o estado de entrada não muda")
  }
  let t: Any = newTurn()
  for (let i = 0; i < 8; i++) { const r = call(t, `inventada${i}`); assert.deepEqual(r.error, { code: "ARGS_INVALID" }, `tentativa ${i + 1}`); t = r.state }
  assert.equal(t.calls, 8)
  const ninth = call(t, "mais-uma")
  assert.deepEqual(ninth.error, { code: "BUDGET_EXCEEDED" })
  assert.equal(ninth.state.budgetExceeded, true)
  assert.equal(call(t, Q).ok, false, "com o orçamento gasto em ids inventados, nem a capacidade real executa")
})

test("T3 — AV19: rejeições 1 e 2 ⇒ REGENERATE (feedback = códigos sem duplicata); a 3ª ⇒ STOP REGEN_EXHAUSTED; depois da parada outra rejeição também é STOP; N vem da constante do contrato", () => {
  assert.equal(AGENT_MAX_REGENERATIONS, 2)
  let s: Any = newTurn()
  const r1 = recordRejection(s, ["CAUSAL_CLAIM", "NUMBER_OUTSIDE_SLOT", "CAUSAL_CLAIM"] as never) as Any
  assert.deepEqual([r1.action, r1.feedback, r1.state.rejections], ["REGENERATE", ["CAUSAL_CLAIM", "NUMBER_OUTSIDE_SLOT"], 1])
  const r2 = recordRejection(r1.state, ["SCOPE_OVERCLAIM"] as never) as Any
  assert.deepEqual([r2.action, r2.feedback, r2.state.rejections], ["REGENERATE", ["SCOPE_OVERCLAIM"], 2])
  const r3 = recordRejection(r2.state, ["STALE_REF"] as never) as Any
  assert.deepEqual([r3.action, r3.stopReason, r3.state.rejections, r3.state.lastReasons], ["STOP", "REGEN_EXHAUSTED", 3, ["STALE_REF"]])
  assert.equal("feedback" in r3, false, "ao parar não há nova regeração")
  const r4 = recordRejection(r3.state, ["STALE_REF"] as never) as Any
  assert.deepEqual([r4.action, r4.stopReason], ["STOP", "REGEN_EXHAUSTED"])
  assert.equal(r1.state.rejections, 1, "estados anteriores intactos")
  assert.equal(s.rejections, 0)
  s = null
})

test("T4 — o feedback só carrega CÓDIGOS de REJECTION_REASONS: lixo (ref, path, valor, texto, tipo errado) é descartado; se nada sobra, o feedback é ['STRUCTURE_INVALID']", () => {
  const junk = ["CAUSAL_CLAIM", `ev_${"a".repeat(32)}`, "metrics[0].value", "US$ 10,00", 5, null, undefined, {}, "__proto__", "causal_claim", "SCOPE_OVERCLAIM"]
  const r = recordRejection(newTurn(), junk as never) as Any
  assert.deepEqual(r.feedback, ["CAUSAL_CLAIM", "SCOPE_OVERCLAIM"])
  for (const empty of [[], [`ev_${"a".repeat(32)}`], null, undefined, "CAUSAL_CLAIM", 5, {}]) {
    const e = recordRejection(newTurn(), empty as never) as Any
    assert.deepEqual(e.feedback, ["STRUCTURE_INVALID"], JSON.stringify(empty))
  }
  for (const reason of r.feedback) assert.ok((REJECTION_REASONS as readonly string[]).includes(reason))
  assert.equal(JSON.stringify(r).includes("ev_"), false)
})

test("T5 — mapeamento TOTAL erro→parada: 5 códigos, imagem = {CAPABILITY_FAILED, BUDGET_CALLS, FILE_NOT_AVAILABLE}; REGEN_EXHAUSTED fora da imagem; cada motivo de parada (exceto REGEN_EXHAUSTED) tem ≥ 1 código; igual à expectativa", () => {
  const codes: string[] = [...CapabilityErrorCodeSchema.options]
  assert.equal(codes.length, 5)
  const image = new Set<string>()
  for (const c of codes) { const r = stopReasonForError(c as never); assert.ok((STOP_REASONS as readonly string[]).includes(r), c); image.add(r); assert.equal(r, exp.error_code_to_stop_reason[c], `${c} difere da expectativa`) }
  assert.deepEqual([...image].sort(), ["BUDGET_CALLS", "CAPABILITY_FAILED", "FILE_NOT_AVAILABLE"])
  for (const stop of STOP_REASONS) assert.equal(image.has(stop), stop !== "REGEN_EXHAUSTED", stop)
  for (const bad of ["", "OTHER", null, undefined, 5, "__proto__", "constructor", "toString"]) assert.throws(() => stopReasonForError(bad as never), RangeError, "código fora do contrato é erro de programação, nunca um motivo")
})

test("T6 — recordError não encerra o turno; BUDGET_EXCEEDED/capacidade não executada/código inválido são recusados; notices: ordem fixa, sem duplicata", () => {
  let s: Any = (call(call(newTurn(), Q).state, G) as Any).state
  const e1: Any = recordError(s, Q as never, "ARGS_INVALID")
  assert.equal(e1.ok, true)
  assert.deepEqual(e1.state.failed, [{ capability: Q, code: "ARGS_INVALID" }])
  assert.equal(e1.state.calls, 2, "a falha não consome nem devolve orçamento")
  assert.equal(validatorStop(e1.state), null, "a falha NÃO encerra o turno")
  assert.deepEqual(notices(e1.state), ["CAPABILITY_FAILED"])
  const e2: Any = recordError(e1.state, G as never, "FILE_NOT_AVAILABLE")
  const e3: Any = recordError(e2.state, G as never, "ENGINE_REFUSED")
  assert.deepEqual(notices(e3.state), ["CAPABILITY_FAILED", "FILE_NOT_AVAILABLE"], "ordem fixa e sem duplicata (3 falhas, 2 avisos)")
  const only: Any = recordError((call(newTurn(), G) as Any).state, G as never, "FILE_NOT_AVAILABLE")
  assert.deepEqual(notices(only.state), ["FILE_NOT_AVAILABLE"])
  assert.deepEqual(notices(newTurn()), [])
  const bad = (st: Any, cap: unknown, code: unknown) => assert.deepEqual(recordError(st, cap as never, code as never), { ok: false, code: "ERROR_NOT_RECORDABLE" }, `${String(cap)}/${String(code)}`)
  bad(s, Q, "BUDGET_EXCEEDED")
  bad(s, R, "NOT_FOUND") // R não foi executada neste turno
  bad(s, Q, "OUTRO")
  bad(s, "x@1", "NOT_FOUND")
  bad(s, Q, null)
  s = null
})

test("T7 — imutabilidade: estados congelados em qualquer nível; cada operação devolve OUTRO estado; o de entrada não muda", () => {
  const s0: Any = newTurn()
  const snap = JSON.stringify(s0)
  const a: Any = call(s0, Q)
  assert.notEqual(a.state, s0)
  assert.equal(JSON.stringify(s0), snap)
  const walk = (o: Any, path = "state"): void => { if (o && typeof o === "object") { assert.equal(Object.isFrozen(o), true, `${path} não está congelado`); for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`) } }
  walk(s0)
  const b: Any = recordError(a.state, Q as never, "NOT_FOUND")
  const c: Any = recordRejection(b.state, ["CAUSAL_CLAIM"] as never)
  const d: Any = call(c.state, "exit.analysis@1")
  for (const x of [a.state, b.state, c.state, d.state]) walk(x)
  assert.throws(() => { (a.state.tried as string[]).push("x") }, TypeError)
  assert.throws(() => { (a.state as Any).calls = 99 }, TypeError)
})

test("T8 — catálogos de prosa: chaves == o conjunto do contrato (REJECTION_REASONS, CAPABILITY_IDS, as 4 do veredito); textos == a expectativa; sem dígito, ref nem chave; distintos entre si e das frases de phrases.ts", () => {
  const same = (name: string, got: Record<string, string>, want: readonly string[]) => assert.deepEqual(Object.keys(got).sort(), [...want].sort(), name)
  same("REJECTION_PHRASES", REJECTION_PHRASES, REJECTION_REASONS)
  same("CAPABILITY_LABELS", CAPABILITY_LABELS, CAPABILITY_IDS)
  same("BANNER_LABELS", BANNER_LABELS, CombinedVerdictSchema.options)
  const P = E3["catalog_prose (proposta minha, revisão de redação como o O-G)"]
  assert.deepEqual({ ...REJECTION_PHRASES }, P.rejection_phrases)
  assert.deepEqual({ ...CAPABILITY_LABELS }, P.capability_labels)
  assert.deepEqual({ ...BANNER_LABELS }, P.banner_labels)
  const all = [...Object.values(REJECTION_PHRASES), ...Object.values(CAPABILITY_LABELS), ...Object.values(BANNER_LABELS)]
  for (const t of all) assert.equal(/\d|ev_|acc_|str_|lbl_|pat_|[{}]/.test(t), false, `texto proibido: ${t}`)
  assert.equal(new Set(all).size, all.length, "textos repetidos")
  const canon = new Set<string>(Object.values(PHRASES))
  for (const t of all) assert.equal(canon.has(t), false, `igual a uma frase canônica: ${t}`)
  assert.equal(Object.isFrozen(REJECTION_PHRASES) && Object.isFrozen(CAPABILITY_LABELS) && Object.isFrozen(BANNER_LABELS), true)
})

test("T9 — pureza e estática: turn.ts e catalog.ts importam só de './'; sem Date/aleatório/ambiente/rede; sem literal de CombinedVerdict (usa o enum do contrato); sem laço que chama o modelo (nenhum fetch/await)", () => {
  const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  for (const f of ["turn.ts", "catalog.ts"]) {
    const code = strip(readFileSync(`${ROOT}src/lib/agent/${f}`, "utf8"))
    for (const m of code.matchAll(/^import\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)) assert.ok(m[1].startsWith("./") || m[1] === "zod", `${f}: import ${m[1]}`)
    assert.equal(/\bDate\b|Math\.random|\bprocess\b|\bfetch\b|globalThis|setTimeout|\bawait\b|\basync\b|node:|prisma/i.test(code), false, `${f}: dependência proibida`)
    assert.equal(/["'`](?:VERIFIED_PARTIAL|VERIFIED|NOT_VERIFIED|TAMPERED_OR_MISMATCH)["'`]/.test(code), false, `${f}: literal de CombinedVerdict`)
    assert.equal(/^(?:let|var)\s/m.test(code), false, `${f}: estado mutável de módulo`)
  }
})

console.log(`\n${passed} testes ok`)
