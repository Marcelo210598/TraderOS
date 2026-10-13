// E6.6-2b / PD-1(b): `basis` vira folha de slot de ENUM com 4 palavras (líquido, bruto, R líquido, R em pontos). Teste escrito ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_2b.decisions_recorded["PD-1"], e66_2b.rules["BASIS (PD-1 b)"].
//   node scripts/test-agent-basis-slot.mts
import assert from "node:assert/strict"
import { formatEnum } from "../src/lib/agent/format.ts"
import { renderSlot, resolveSlot } from "../src/lib/agent/slot-path.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const mv = (basis: string | null): Any => ({ metricId: "netPnl", value: 10, unit: "usd", basis, sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null })
const WORDS: Record<string, string> = { NET: "líquido", GROSS: "bruto", R_NET: "R líquido", R_POINTS: "R em pontos" }

test("B1 — formatEnum('basis', código): as 4 palavras; fora da tabela (inclusive 'net', protótipo, null) ⇒ FORMAT_INVALID", () => {
  for (const [k, w] of Object.entries(WORDS)) assert.deepEqual(formatEnum("basis" as never, k), { ok: true, text: w }, k)
  for (const x of ["net", "Net", "", "__proto__", "constructor", "toString", "R_UNKNOWN", null, undefined, 5]) assert.deepEqual(formatEnum("basis" as never, x as never), { ok: false, code: "FORMAT_INVALID" }, String(x))
})

test("B2 — a folha `basis` existe em metrics.query, metrics.groups e rank.groups (todo MetricValue): renderiza a palavra; basis null ⇒ FORMAT_INVALID (nunca vazio)", () => {
  for (const [k, w] of Object.entries(WORDS)) {
    assert.deepEqual(renderSlot("metrics.query@1", { metrics: [mv(k)], period: { from: null, to: null } }, "metrics[0].basis"), { ok: true, text: w }, k)
    assert.deepEqual(renderSlot("metrics.groups@1", { groupBy: ["account"], groups: [{ key: ["Conta A"], sampleFlag: "OK", sampleSize: 3, metrics: [mv(k)] }] }, "groups[0].metrics[0].basis"), { ok: true, text: w }, `groups ${k}`)
    assert.deepEqual(renderSlot("rank.groups@1", { rows: [{ rank: 1, key: ["Conta A"], value: mv(k), sampleFlag: "OK", tiedWithPrevious: false, contribution: null, contributionReason: "NO_DATA" }], orderedBy: "netPnl" }, "rows[0].value.basis"), { ok: true, text: w }, `rank ${k}`)
  }
  assert.deepEqual(renderSlot("metrics.query@1", { metrics: [mv(null)], period: { from: null, to: null } }, "metrics[0].basis"), { ok: false, code: "FORMAT_INVALID" })
  assert.equal(resolveSlot("metrics.query@1", { metrics: [mv(null)], period: { from: null, to: null } }, "metrics[0].basis").ok, true)
})

test("B3 — o resolvedor trata `basis` como folha de enum: valor fora da tabela ⇒ FORMAT_INVALID; não-string (objeto/número) ⇒ SLOT_PATH_INVALID", () => {
  assert.deepEqual(renderSlot("metrics.query@1", { metrics: [mv("OUTRA")], period: { from: null, to: null } }, "metrics[0].basis"), { ok: false, code: "FORMAT_INVALID" })
  const bad: Any = { metrics: [mv("NET")], period: { from: null, to: null } }
  bad.metrics[0].basis = { x: 1 }
  assert.deepEqual(resolveSlot("metrics.query@1", bad, "metrics[0].basis"), { ok: false, code: "SLOT_PATH_INVALID" })
  bad.metrics[0].basis = 5
  assert.deepEqual(resolveSlot("metrics.query@1", bad, "metrics[0].basis"), { ok: false, code: "SLOT_PATH_INVALID" })
})

console.log(`\n${passed} testes ok`)
