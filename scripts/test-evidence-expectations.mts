// Expectativas ESCRITAS À PARTE (scripts/expectations/*.expected.json) × resultado real das verificações.   node scripts/test-evidence-expectations.mts
// Ver scripts/expectations/README.md: a expectativa é um arquivo separado do resultado e vai para o git ANTES do código que a faz passar.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DERIVED_SCENARIOS, derivedContext, runAllDerivedScenarios, runDerivedScenario } from "../src/lib/dev/evidence-lab/derived.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"

const env = process.env as Record<string, string | undefined>
const ORIGINAL_ENV = env.NODE_ENV
env.NODE_ENV = "development"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const load = (n: string): Any => JSON.parse(readFileSync(fileURLToPath(new URL(`./expectations/${n}`, import.meta.url)), "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const ctx = derivedContext()

test("LAB DERIVADOS: o arquivo de expectativa cobre exatamente os cenários do Lab; veredito do V6, checks do V6 (8, em ordem) e status do E5b = os do arquivo; e = ao campo `expected` do código", () => {
  const exp = load("lab-derived.expected.json")
  assert.deepEqual(Object.keys(exp.scenarios), DERIVED_SCENARIOS.map((s) => s.id))
  for (const r of runAllDerivedScenarios(ctx)) {
    const e = exp.scenarios[r.scenario.id]
    assert.equal(r.report.status, e.verdict, `${r.scenario.id}: veredito`)
    assert.equal(r.scenario.expected, e.verdict, `${r.scenario.id}: expected do código ≠ arquivo`)
    assert.equal(r.report.checks.filter((c) => c.level === "V6").map((c) => c.status[0]).join(""), e.v6, `${r.scenario.id}: V6`)
    assert.equal(r.source.status, e.e5b, `${r.scenario.id}: E5b`)
  }
})

test("BORDA DE refs.legs: cada adulteração (selo refeito) tem o resultado do arquivo ESCRITO ANTES — V6 e E5b (V5.derived)", () => {
  const exp = load("derived-legrefs-edge.expected.json")
  assert.equal(exp._meta.before_implementation, true)
  const base = runDerivedScenario(ctx, DERIVED_SCENARIOS.find((s) => s.id === "leg-rank")!).bundle as Any
  const items: Any[] = base.evidence.derived[0].refs.legs.items
  const byTrade = new Map<string, Any[]>()
  for (const i of items) byTrade.set(i.tradeId, [...(byTrade.get(i.tradeId) ?? []), i])
  const multi = [...byTrade.values()].find((x) => x.length >= 2) as Any[]
  const idx = (o: Any) => items.findIndex((x) => x.tradeId === o.tradeId && x.legIndex === o.legIndex)
  const mutations: Record<string, (d: Any) => void> = {
    legIndex_fora_do_intervalo: (d) => { d.refs.legs.items[0].legIndex = 99 },
    legIndex_trocado_no_mesmo_trade: (d) => { const a = idx(multi[0]); const b = idx(multi[1]); const t = d.refs.legs.items[a].legIndex; d.refs.legs.items[a].legIndex = d.refs.legs.items[b].legIndex; d.refs.legs.items[b].legIndex = t },
    item_duplicado: (d) => { d.refs.legs.items.push({ ...d.refs.legs.items[0] }) },
    itens_fora_de_ordem: (d) => { d.refs.legs.items.reverse() },
    rowNos_com_linha_a_mais: (d) => { d.refs.legs.items[0].rowNos = [...d.refs.legs.items[0].rowNos, 999] },
    rowNos_vazio: (d) => { d.refs.legs.items[0].rowNos = [] },
    item_removido: (d) => { d.refs.legs.items.pop() },
    tradeId_inexistente: (d) => { d.refs.legs.items[0].tradeId = "trd_inexistente" },
  }
  assert.deepEqual(Object.keys(exp.cases).sort(), Object.keys(mutations).sort())
  for (const [name, mutate] of Object.entries(mutations)) {
    const b = JSON.parse(JSON.stringify(base)) as Any
    mutate(b.evidence.derived[0])
    b.evidenceHash = computeEvidenceHash(b)
    const e = exp.cases[name]
    const v = verifyEvidence(b)
    const s = verifyEvidenceSource(b, { [ctx.importRecord.importId]: ctx.bytes })
    assert.equal(v.status, e.v6Status, `${name}: veredito V6`)
    for (const [id, st] of Object.entries(e.v6)) assert.equal(v.checks.find((c) => c.id === id)!.status, st, `${name}: ${id}`)
    const sd = s.checks.find((c) => c.id === "V5.derived")!
    assert.equal(sd.status, e.e5b["V5.derived"], `${name}: E5b V5.derived`)
    assert.equal(sd.code, e.e5b.code, `${name}: E5b código`)
    assert.equal(s.status, e.e5bStatus, `${name}: status do E5b`)
  }
})

env.NODE_ENV = ORIGINAL_ENV
if (ORIGINAL_ENV === undefined) delete env.NODE_ENV
console.log(`\n${passed} testes ok`)
