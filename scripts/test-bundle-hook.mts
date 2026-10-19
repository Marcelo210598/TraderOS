// E7-5 (D-R1): gancho `onBundle` — as 6 capacidades analíticas entregam ao servidor o bundle SELADO que acabaram de avaliar, sem mudar nada do que devolvem.
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_5 (H1–H6; mutações RM3, RM4, RM15).
//   node scripts/test-bundle-hook.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { assessBundle } from "../src/lib/agent-capabilities/assess.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = (name: string, fn: () => void): void => {
  if (process.env.COLLECT) { try { fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  fn(); passed += 1; console.log(`✓ ${name}`)
}
const p2 = (x: number): string => String(x).padStart(2, "0")
const SALT = "9f".repeat(32)
const text = synthCsv(Array.from({ length: 60 }, (_, i) => ({ entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00` })))
const imp: Any = runImportPipeline(text, { sourceTz: "America/Sao_Paulo", accountRefSalt: SALT })
const baseCtx = (extra: Any = {}): Any => ({ trades: toAnalyticsTrades(imp.trades), importRecords: [imp.importRecord], refEpoch: "s1", accountRefSalt: SALT, analysis: {}, source: null, ...extra })

const CAPS: Array<[string, (args: unknown, ctx: Any) => Any, Any]> = [
  ["metrics.query@1", metricsQuery, { metricIds: ["netPnl", "winRate"], filters: {}, options: {} }],
  ["metrics.groups@1", metricsGroups, { groupBy: ["account"], metricIds: ["netPnl"], filters: {}, options: {} }],
  ["metrics.compare@1", metricsCompare, { mode: "PERIOD", a: { from: "2026-03-01", to: "2026-03-10" }, b: { from: "2026-03-15", to: "2026-03-25" }, metricIds: ["netPnl"], filters: {}, options: {} }],
  ["exit.breakdown@1", exitBreakdown, { filters: {}, options: {} }],
  ["exit.analysis@1", exitAnalysis, { filters: {}, options: {} }],
  ["rank.groups@1", rankGroupsCapability, { groupBy: ["account"], metric: "netPnl", order: "DESC", filters: {}, options: {} }],
]
const refOf = (bundle: Any): string => `ev_${bundle.evidenceHash.slice(0, 32)}`

test("H1 — onBundle é chamado EXATAMENTE 1 vez por sucesso, com 1 argumento, nas 6 capacidades; e 0 vez em qualquer falha (args inválidos, ctx inválido, época que o handle recusa)", () => {
  for (const [id, fn, args] of CAPS) {
    const calls: unknown[][] = []
    const out = fn(args, baseCtx({ onBundle: (...a: unknown[]) => { calls.push(a) } }))
    assert.equal(out.result.ok, true, id)
    assert.equal(calls.length, 1, `${id}: chamadas`)
    assert.equal(calls[0].length, 1, `${id}: argumentos`)

    const falhas: Array<[string, unknown, Any]> = [
      ["args inválidos", { extra: 1 }, baseCtx()],
      ["ctx sem trades", args, baseCtx({ trades: null })],
      ["época que o handle recusa", args, baseCtx({ refEpoch: "ÉPOCA INVÁLIDA!" })],
    ]
    for (const [why, a, c] of falhas) {
      let n = 0
      const o = fn(a, { ...c, onBundle: () => { n += 1 } })
      assert.equal(o.result.ok, false, `${id}: ${why} devia falhar`)
      assert.equal(n, 0, `${id}: ${why} não chama o gancho`)
    }
  }
})

test("H2 — o bundle entregue é o selado: ev_+32 hex do evidenceHash === evidenceRef do handle e do resultado; o verificador não o declara ilegível", () => {
  for (const [id, fn, args] of CAPS) {
    const seen: Any[] = []
    const out = fn(args, baseCtx({ onBundle: (b: unknown) => seen.push(b) }))
    assert.equal(seen.length, 1, id)
    assert.equal(refOf(seen[0]), out.entry.handle.evidenceRef, `${id}: ref do bundle`)
    assert.equal(refOf(seen[0]), out.result.evidence.evidenceRef, `${id}: ref do envelope`)
    assert.notEqual(verifyEvidence(seen[0]).status, "INVALID_FORMAT", id)
  }
  const refs = new Set(CAPS.map(([, fn, args]) => { let r = ""; fn(args, baseCtx({ onBundle: (b: Any) => { r = refOf(b) } })); return r }))
  assert.equal(refs.size, 5, "5 refs distintos nas 6 capacidades (exit.breakdown e exit.analysis sem compare colidem, como medido no E7-4/E7-5)")
})

test("H3 — gancho que lança (Error, string, null, objeto) NÃO muda nada do que a capacidade devolve (resultado e entry idênticos ao sem gancho)", () => {
  for (const [id, fn, args] of CAPS) {
    const sem = JSON.stringify(fn(args, baseCtx()))
    for (const boom of [() => { throw new Error("boom") }, () => { throw "texto" }, () => { throw null }, () => { throw { a: 1 } }]) {
      assert.equal(JSON.stringify(fn(args, baseCtx({ onBundle: boom }))), sem, id)
    }
  }
  const b: Any[] = []
  metricsQuery(CAPS[0][2], baseCtx({ onBundle: (x: unknown) => b.push(x) }))
  const direct = assessBundle(b[0], { refEpoch: "s1", onBundle: () => { throw new Error("boom") } } as Any)
  assert.equal(direct.ok, true, "assessBundle com gancho que lança continua ok")
})

test("H4 — com gancho a saída é IDÊNTICA à sem gancho (JSON do result + entry), nas 6 capacidades; o gancho não vê nem altera o handle", () => {
  for (const [id, fn, args] of CAPS) {
    const sem = JSON.stringify(fn(args, baseCtx()))
    const com = JSON.stringify(fn(args, baseCtx({ onBundle: () => {} })))
    assert.equal(com, sem, id)
  }
})

test("H5 — exit.analysis COM compare entrega o bundle composto FINAL (o que foi avaliado), com ref ≠ do mesmo pedido sem compare", () => {
  const seen: Any[] = []
  const withCmp = exitAnalysis({ compare: { unit: "TRADE", a: "TARGET", b: "STOP" }, filters: {}, options: {} }, baseCtx({ onBundle: (b: unknown) => seen.push(b) }))
  assert.equal(withCmp.result.ok, true)
  assert.equal(seen.length, 1, "uma chamada, não uma por derivado")
  assert.equal(refOf(seen[0]), withCmp.entry.handle.evidenceRef)
  let plain = ""
  exitAnalysis({ filters: {}, options: {} }, baseCtx({ onBundle: (b: Any) => { plain = refOf(b) } }))
  assert.notEqual(refOf(seen[0]), plain, "o bundle composto não é o do breakdown")
  assert.equal(withCmp.entry.view.comparison !== null, true)
})

test("H6 — onBundle que não é função (string, objeto, número, null, undefined) é ignorado: mesma saída, nenhuma exceção", () => {
  for (const [id, fn, args] of CAPS) {
    const sem = JSON.stringify(fn(args, baseCtx()))
    for (const junk of ["x", {}, 5, null, undefined, [], true]) assert.equal(JSON.stringify(fn(args, baseCtx({ onBundle: junk }))), sem, `${id}: ${String(junk)}`)
  }
})

if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do gancho onBundle passaram.`)
