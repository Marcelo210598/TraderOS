// E6.6-7b (#6 do review do Gemini): `buckets[].unit` (TRADE | LEG) vira folha de slot de ENUM, tabela `bucketUnit` (TRADE = "trades", LEG = "pernas"). Teste escrito ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_7b.parte_6_unit.
//   node scripts/test-agent-bucket-unit-slot.mts
import assert from "node:assert/strict"
import { formatEnum } from "../src/lib/agent/format.ts"
import { renderSlot, resolveSlot } from "../src/lib/agent/slot-path.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const cov = { used: 3, total: 3, ratio: 1 }
const bucket = (reason: string, unit: string): Any => ({ reason, unit, count: 3, pnlNet: 150, pnlNetReason: null, share: 0.25, shareReason: null, coverage: cov })
const V_EXIT: Any = { buckets: [bucket("TARGET", "LEG"), bucket("TARGET", "TRADE")], reconciliation: "RECONCILED" }
const V_ANALYSIS: Any = { buckets: [bucket("STOP", "LEG"), bucket("STOP", "TRADE")], comparison: null }
const bad = (r: Any, code: string) => assert.deepEqual(r, { ok: false, code })

test("U1 — formatEnum('bucketUnit'): TRADE = 'trades', LEG = 'pernas'; fora da tabela (singular, minúsculas, protótipo, null) ⇒ FORMAT_INVALID; palavras sem dígito e distintas", () => {
  assert.deepEqual(formatEnum("bucketUnit" as never, "TRADE"), { ok: true, text: "trades" })
  assert.deepEqual(formatEnum("bucketUnit" as never, "LEG"), { ok: true, text: "pernas" })
  for (const x of ["trade", "leg", "Trade", "Leg", "", "__proto__", "constructor", "toString", "hasOwnProperty", "NOPE", null, undefined, 5]) bad(formatEnum("bucketUnit" as never, x as never), "FORMAT_INVALID")
  assert.notEqual("trades", "pernas")
  for (const w of ["trades", "pernas"]) assert.equal(/\d/.test(w), false, w)
})

test("U2 — exit.breakdown@1: `buckets[i].unit` renderiza 'pernas' na linha LEG e 'trades' na linha TRADE; o resolvedor devolve folha de enum da tabela bucketUnit", () => {
  assert.deepEqual(renderSlot("exit.breakdown@1", V_EXIT, "buckets[0].unit"), { ok: true, text: "pernas" })
  assert.deepEqual(renderSlot("exit.breakdown@1", V_EXIT, "buckets[1].unit"), { ok: true, text: "trades" })
  const r: Any = resolveSlot("exit.breakdown@1", V_EXIT, "buckets[0].unit")
  assert.equal(r.ok, true)
  assert.deepEqual(r.leaf, { kind: "enum", table: "bucketUnit", code: "LEG" })
})

test("U3 — exit.analysis@1 (comparison null): a folha chega pelos buckets (spread); o que está sob `comparison.` segue SLOT_PATH_INVALID", () => {
  assert.deepEqual(renderSlot("exit.analysis@1", V_ANALYSIS, "buckets[0].unit"), { ok: true, text: "pernas" })
  assert.deepEqual(renderSlot("exit.analysis@1", V_ANALYSIS, "buckets[1].unit"), { ok: true, text: "trades" })
  bad(renderSlot("exit.analysis@1", V_ANALYSIS, "comparison.deltas[0].unit"), "SLOT_PATH_INVALID")
})

test("U4 — só onde há buckets: nas outras views `buckets[0].unit` ⇒ SLOT_PATH_INVALID; `unit` de MÉTRICA/delta continua fora dos slots; unit fora de TRADE|LEG na view ⇒ VIEW_INVALID", () => {
  const mv = { metricId: "netPnl", value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: cov, reason: null }
  bad(renderSlot("metrics.query@1", { metrics: [mv], period: { from: null, to: null } }, "buckets[0].unit"), "SLOT_PATH_INVALID")
  bad(renderSlot("metrics.query@1", { metrics: [mv], period: { from: null, to: null } }, "metrics[0].unit"), "SLOT_PATH_INVALID")
  bad(renderSlot("rank.groups@1", { rows: [], orderedBy: "netPnl" }, "buckets[0].unit"), "SLOT_PATH_INVALID")
  bad(renderSlot("exit.breakdown@1", { buckets: [bucket("TARGET", "OUTRO")], reconciliation: "RECONCILED" }, "buckets[0].unit"), "VIEW_INVALID")
  bad(renderSlot("exit.breakdown@1", V_EXIT, "buckets[5].unit"), "SLOT_PATH_INVALID")
})

console.log(`\n${passed} testes ok`)
