// E6.6-2a: ledger puro (src/lib/agent/ledger.ts). Testes escritos ANTES do código (o arquivo ainda NÃO existe).
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_2a.ledger_api e e66_2a.cases["L (ledger)"] (L1–L6).
//   node scripts/test-agent-ledger.mts
import assert from "node:assert/strict"
import { addEvidence, isStale, lookupRef, newLedger, rotateEpoch } from "../src/lib/agent/ledger.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const REF = (c: string): string => `ev_${c.repeat(32)}`

const view = (): Any => ({ metrics: [{ metricId: "netPnl", value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null }], period: { from: null, to: null } })
const handle = (c = "a", epoch = "s1"): Any => ({
  evidenceRef: REF(c), evidenceHash: c.repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: 3, verifiability: "FULL" }, refEpoch: epoch, freshness: "CURRENT",
  verdict: buildVerdict({ status: "VALID", codes: [] }, { status: "SOURCE_VERIFIED", codes: [] }),
})
const entry = (c = "a", epoch = "s1"): Any => ({ capability: "metrics.query@1", handle: handle(c, epoch), view: view() })
const mk = (epoch = "s1"): Any => { const r: Any = newLedger(epoch); assert.equal(r.ok, true); return r.ledger }
const add = (l: Any, e: Any): Any => addEvidence(l, e)
const INVALID = { ok: false, code: "LEDGER_ENTRY_INVALID" }

test("L0 — newLedger: época válida ⇒ ledger vazio e CONGELADO; época inválida ⇒ erro fixo, sem lançar", () => {
  const l = mk("s1")
  assert.equal(l.epoch, "s1")
  assert.equal(Object.isFrozen(l), true)
  assert.equal(Object.isFrozen(l.entries), true)
  assert.deepEqual(Object.keys(l.entries), [])
  for (const e of ["", "S1", "-a", "a b", "x".repeat(33), null, undefined, 5, {}]) { assert.doesNotThrow(() => newLedger(e as never)); assert.deepEqual(newLedger(e as never), { ok: false, code: "LEDGER_EPOCH_INVALID" }, String(e)) }
})

test("L1 — addEvidence de handle+view válidos ⇒ ok; lookupRef acha; o ledger ANTERIOR não mudou; o resultado é OUTRO ledger", () => {
  const l0 = mk()
  const snap = JSON.stringify(l0)
  const r = add(l0, entry("a"))
  assert.equal(r.ok, true)
  assert.notEqual(r.ledger, l0)
  assert.equal(JSON.stringify(l0), snap)
  const found = lookupRef(r.ledger, REF("a"))
  assert.ok(found)
  assert.equal(found!.capability, "metrics.query@1")
  assert.equal(found!.handle.evidenceRef, REF("a"))
  assert.equal(lookupRef(r.ledger, REF("b")), null)
  const r2 = add(r.ledger, entry("b"))
  assert.equal(Object.keys(r2.ledger.entries).length, 2)
  assert.equal(Object.keys(r.ledger.entries).length, 1)
})

test("L2 — entrada inválida ⇒ { ok:false, code:'LEDGER_ENTRY_INVALID' } sem eco: handle com campo extra, handle com combined inconsistente, view inválida/campo T0, capability sem view, capability desconhecida, refEpoch ≠ época do ledger, freshness STALE, entrada que não é objeto", () => {
  const l = mk()
  const cases: Array<[string, Any]> = [
    ["handle com campo extra", { ...entry(), handle: { ...handle(), extra: 1 } }],
    ["combined inconsistente", { ...entry(), handle: { ...handle(), verdict: { ...handle().verdict, combined: "TAMPERED_OR_MISMATCH" } } }],
    ["view com campo T0", { ...entry(), view: { ...view(), metrics: [{ ...view().metrics[0], rowHash: "x" }] } }],
    ["view de outra capacidade", { ...entry(), view: { buckets: [], reconciliation: "RECONCILED" } }],
    ["capability sem view", { ...entry(), capability: "evidence.refresh@1" }],
    ["capability desconhecida", { ...entry(), capability: "x@1" }],
    ["capability protótipo", { ...entry(), capability: "__proto__" }],
    ["refEpoch diferente", entry("a", "s2")],
    ["freshness STALE", { ...entry(), handle: { ...handle(), freshness: "STALE" } }],
    ["null", null], ["número", 5], ["array", []], ["sem handle", { capability: "metrics.query@1", view: view() }], ["sem view", { capability: "metrics.query@1", handle: handle() }],
  ]
  for (const [why, e] of cases) { assert.doesNotThrow(() => add(l, e), why); assert.deepEqual(add(l, e), INVALID, why) }
})

test("L3 — mesmo ref: conteúdo DIFERENTE ⇒ LEDGER_CONFLICT (nada muda); idêntico ⇒ ok idempotente (mesmo conteúdo)", () => {
  const l1 = add(mk(), entry("a")).ledger
  const same = add(l1, entry("a"))
  assert.equal(same.ok, true)
  assert.equal(JSON.stringify(same.ledger), JSON.stringify(l1))
  const otherView = view()
  otherView.metrics[0].value = 11
  const diff = add(l1, { ...entry("a"), view: otherView })
  assert.deepEqual(diff, { ok: false, code: "LEDGER_CONFLICT" })
  const diffHandle = add(l1, { ...entry("a"), handle: { ...handle("a"), population: { declared: 4, verifiability: "FULL" } } })
  assert.deepEqual(diffHandle, { ok: false, code: "LEDGER_CONFLICT" })
  assert.equal(lookupRef(l1, REF("a"))!.view.metrics[0].value, 10)
})

test("L4 — rotateEpoch: entradas antigas FICAM e viram STALE; entradas novas da época nova são CURRENT; época igual/inválida ⇒ erro; o ledger anterior fica intacto", () => {
  const l1 = add(mk("s1"), entry("a", "s1")).ledger
  const snap = JSON.stringify(l1)
  const r: Any = rotateEpoch(l1, "s2")
  assert.equal(r.ok, true)
  assert.equal(r.ledger.epoch, "s2")
  assert.equal(JSON.stringify(l1), snap, "ledger anterior intacto")
  const old = lookupRef(r.ledger, REF("a"))!
  assert.ok(old, "a entrada antiga continua (auditoria)")
  assert.equal(isStale(r.ledger, old), true)
  assert.equal(isStale(l1, lookupRef(l1, REF("a"))!), false)
  // época nova: entrada da época 's2' entra; a de 's1' não
  assert.equal(add(r.ledger, entry("b", "s2")).ok, true)
  assert.deepEqual(add(r.ledger, entry("c", "s1")), INVALID)
  const fresh = lookupRef(add(r.ledger, entry("b", "s2")).ledger, REF("b"))!
  assert.equal(isStale(add(r.ledger, entry("b", "s2")).ledger, fresh), false)
  for (const e of ["s2", "S3", "", null, 5]) assert.deepEqual(rotateEpoch(r.ledger, e as never), { ok: false, code: "LEDGER_EPOCH_INVALID" }, String(e))
})

test("L5 — CÓPIA PROFUNDA e CONGELAMENTO: mutar os objetos passados a addEvidence (ou o que lookupRef devolveu) NÃO altera o ledger; tudo no ledger é congelado em qualquer nível", () => {
  const e = entry("a")
  const l = add(mk(), e).ledger
  e.handle.population.declared = 999
  e.view.metrics[0].value = 999
  e.handle.verdict.verify.codes.push("V_X")
  const got = lookupRef(l, REF("a"))!
  assert.equal(got.handle.population.declared, 3)
  assert.equal(got.view.metrics[0].value, 10)
  assert.deepEqual(got.handle.verdict.verify.codes, [])
  const walk = (o: Any, path = "ledger"): void => { if (o && typeof o === "object") { assert.equal(Object.isFrozen(o), true, `${path} não está congelado`); for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`) } }
  walk(l)
  assert.throws(() => { (got.view.metrics[0] as Any).value = 5 }, TypeError)
  assert.throws(() => { (l.entries as Any)[REF("z")] = 1 }, TypeError)
})

test("L6 — lookupRef só enxerga propriedade PRÓPRIA e ref bem formado: __proto__, constructor, toString, ref malformado, tipo errado ⇒ null (sem lançar)", () => {
  const l = add(mk(), entry("a")).ledger
  for (const x of ["__proto__", "constructor", "toString", "hasOwnProperty", "ev_", `ev_${"A".repeat(32)}`, `ev_${"a".repeat(31)}`, `ev_${"a".repeat(33)}`, ` ${REF("a")}`, "", null, undefined, 5, {}, []]) {
    assert.doesNotThrow(() => lookupRef(l, x as never))
    assert.equal(lookupRef(l, x as never), null, String(x))
  }
  assert.ok(lookupRef(l, REF("a")))
})

test("L7 — isolamento entre ledgers (AV3): dois ledgers independentes; o ref de um NÃO existe no outro", () => {
  const a = add(mk(), entry("a")).ledger
  const b = add(mk(), entry("b")).ledger
  assert.ok(lookupRef(a, REF("a")))
  assert.equal(lookupRef(b, REF("a")), null)
  assert.equal(lookupRef(a, REF("b")), null)
  assert.equal("userId" in a, false)
})

test("L8 — entradas com ref diferente mas conteúdo igual coexistem; a ordem de inserção não muda o conteúdo de cada ref", () => {
  const ab = add(add(mk(), entry("a")).ledger, entry("b")).ledger
  const ba = add(add(mk(), entry("b")).ledger, entry("a")).ledger
  for (const c of ["a", "b"]) assert.equal(JSON.stringify(lookupRef(ab, REF(c))), JSON.stringify(lookupRef(ba, REF(c))))
  assert.equal(clone(Object.keys(ab.entries).sort()).join(), clone(Object.keys(ba.entries).sort()).join())
})

console.log(`\n${passed} testes ok`)
