// E5b × bundles de LINHAS (rowTrades) com reconstrução ligada. Expectativas: scripts/expectations/e5b-rowtrades.expected.json (coluna `contract`,
// escrita ANTES das medições). Causa raiz: reTradeById só indexava run.trades (ciclos); ids de linha caíam em V_TRADE_ID_MISMATCH.
//   node scripts/test-evidence-source-rowtrades.mts
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const EXP = JSON.parse(readFileSync(join(ROOT, "scripts/expectations/e5b-rowtrades.expected.json"), "utf8")).cases as Record<string, { contract: string }>
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const fails = (r: Any) => r.checks.filter((c: Any) => c.status === "FAIL").map((c: Any) => `${c.id}:${c.code}`)
const d = (n: number) => `${String(n).padStart(2, "0")}/03/2026`
const SALT = "sal-rows"
const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }]

const csvOf = (free: boolean) => synthCsv([
  { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${d(2)} 09:00:00`, exitAt: `${d(2)} 09:10:00`, exitLabel: free ? "meu stop 1" : "Stop1" },
  { account: "Conta A", entryPrice: 2000, exitPrice: 2004, entryAt: `${d(2)} 09:20:00`, exitAt: `${d(2)} 09:30:00`, exitLabel: free ? "Meu Setup X" : "Target1" },
  { account: "Conta B", entryPrice: 2000, exitPrice: 2003, entryAt: `${d(4)} 09:00:00`, exitAt: `${d(4)} 09:10:00`, exitLabel: "Target1" },
])
function setup(o: { free?: boolean; salted?: boolean; mapped?: boolean; reconstruct?: boolean } = {}) {
  const csv = csvOf(!!o.free)
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "rows.csv", ...(o.salted ? { accountRefSalt: SALT } : {}), ...(o.mapped ? { exitReasonMap: MAP } : {}), ...(o.reconstruct === false ? { reconstructCycles: false } : {}) })
  const record = run.importRecord as ImportRecord
  const opts = o.salted ? { accountRefSalt: SALT } : undefined
  const bundleOf = (trades: Any[]): Any => {
    const T = toAnalyticsTrades(trades)
    const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
    const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...(opts ? { opts } : {}) })
    assert.equal((r as Any).ok, true, (r as Any).message)
    return metricEvidenceBundle(r as Any)
  }
  const verifyOpts = { ...(o.salted ? { accountRefSalt: SALT } : {}), ...(o.mapped ? { exitReasonMap: MAP } : {}) }
  return { run, record, files: { [record.importId]: new TextEncoder().encode(csv) }, bundleOf, verifyOpts, opts }
}
const status = (id: keyof typeof EXP) => EXP[id].contract.split(" ")[0]

test("R1/R2/R3 — íntegros: linhas (reconstrução ligada) = SOURCE_VERIFIED; linhas (reconstrução desligada) e ciclos seguem SOURCE_VERIFIED; V0–V6 VALID", () => {
  const s = setup()
  const rows = s.bundleOf(s.run.rowTrades)
  assert.equal(verifyEvidence(rows).status, "VALID")
  const r1 = verifyEvidenceSource(rows, s.files, s.verifyOpts)
  assert.equal(r1.status, status("R1_rows_reconstruction_on_intact"), JSON.stringify(r1.checks.filter((c) => c.status !== "PASS")))
  assert.ok(rows.evidence.trades.every((t: Any) => t.granularity === "SOURCE_ROW"))
  assert.equal(verifyEvidenceSource(s.bundleOf(s.run.trades), s.files, s.verifyOpts).status, status("R3_cycles_intact"))
  const off = setup({ reconstruct: false })
  assert.equal(off.run.trades.length, off.run.rowTrades.length)
  assert.equal(verifyEvidenceSource(off.bundleOf(off.run.trades), off.files, off.verifyOpts).status, status("R2_rows_reconstruction_off_intact"))
})

test("R4 (controle negativo) — ciclo declarado como linha ⇒ SOURCE_MISMATCH V_TRADE_STRUCTURE_MISMATCH", () => {
  const s = setup(); const b = clone(s.bundleOf(s.run.trades)); b.evidence.trades[0].granularity = "SOURCE_ROW"
  const r = verifyEvidenceSource(reseal(b), s.files, s.verifyOpts)
  assert.equal(r.status, status("R4_neg_cycle_declared_as_row")); assert.ok(fails(r).includes("V5.trades:V_TRADE_STRUCTURE_MISMATCH"), fails(r).join())
})

test("R5 (controle negativo, inverso) — linha declarada como ciclo ⇒ SOURCE_MISMATCH V_TRADE_STRUCTURE_MISMATCH (pelo motivo certo, não 'id desconhecido')", () => {
  const s = setup(); const b = clone(s.bundleOf(s.run.rowTrades)); b.evidence.trades[0].granularity = "POSITION_CYCLE"
  const r = verifyEvidenceSource(reseal(b), s.files, s.verifyOpts)
  assert.equal(r.status, status("R5_neg_row_declared_as_cycle")); assert.ok(fails(r).includes("V5.trades:V_TRADE_STRUCTURE_MISMATCH"), fails(r).join())
  assert.equal(fails(r).some((f) => f.endsWith("V_TRADE_ID_MISMATCH")), false)
})

test("R6 — valor da linha adulterado (pnl.net, selo refeito) ⇒ SOURCE_MISMATCH em V5.values (não mascarado por id)", () => {
  const s = setup(); const b = clone(s.bundleOf(s.run.rowTrades)); const t = b.evidence.trades[0]; const before = t.pnl.net; t.pnl.net = (before ?? 0) + 999
  assert.notEqual(t.pnl.net, before, "premissa: o forge alterou o valor")
  const r = verifyEvidenceSource(reseal(b), s.files, s.verifyOpts)
  assert.equal(r.status, "SOURCE_MISMATCH"); assert.deepEqual(fails(r), ["V5.values:V_TRADE_VALUES_MISMATCH"])
})

test("R7/R8 — rowHash trocado e tradeId inexistente ⇒ SOURCE_MISMATCH", () => {
  const s = setup(); const b = clone(s.bundleOf(s.run.rowTrades))
  const h = clone(b); const tr = h.evidence.trades[0]; const ref = tr.sourceRows?.[0] ?? tr.source; assert.ok(ref?.rowHash, "premissa"); ref.rowHash = "0".repeat(64)
  const r7 = verifyEvidenceSource(reseal(h), s.files, s.verifyOpts)
  assert.equal(r7.status, "SOURCE_MISMATCH"); assert.ok(fails(r7).includes("V5.rows:V_ROWHASH_MISMATCH"))
  const i = clone(b); i.evidence.trades[0].tradeId = `trd_${"0".repeat(32)}`
  const r8 = verifyEvidenceSource(reseal(i), s.files, s.verifyOpts)
  assert.equal(r8.status, status("R8_neg_unknown_row_id")); assert.ok(fails(r8).includes("V5.trades:V_TRADE_ID_MISMATCH"))
})

test("R9 — misto: ciclo + uma linha desse ciclo ⇒ SOURCE_MISMATCH V_ROWREF_DUPLICATE (linha citada por dois trades)", () => {
  const s = setup(); const cycle = s.run.trades[0] as Any
  const row = s.run.rowTrades.find((t: Any) => (cycle.sourceRows ?? []).some((x: Any) => x.rowNo === t.source.rowNo)) as Any
  assert.ok(row, "premissa: há uma linha do ciclo")
  const r = verifyEvidenceSource(s.bundleOf([cycle, row]), s.files, s.verifyOpts)
  assert.equal(r.status, "SOURCE_MISMATCH"); assert.ok(fails(r).includes("V5.rows:V_ROWREF_DUPLICATE"), fails(r).join())
})

test("DERIVADOS — citação de perna apontando para trade-LINHA (sem pernas) ⇒ SOURCE_MISMATCH V_DERIVED_LEG_REF_MISMATCH, nunca verificado em falso", () => {
  const s = setup()
  const T = toAnalyticsTrades(s.run.trades)
  const ex = explainDerived({ spec: { op: "EXIT_REASON_ANALYSIS", args: {}, options: {} }, trades: T, importRecords: [s.record] })
  assert.equal((ex as Any).ok, true)
  const b = clone(derivedEvidenceBundle(ex as Any) as Any)
  const rowId = (s.run.rowTrades[0] as Any).tradeId as string
  const item = b.evidence.derived?.[0]?.refs?.legs?.items?.[0]
  assert.ok(item, "premissa: o derivado cita pernas")
  item.tradeId = rowId
  b.evidence.trades.push(...(s.bundleOf([s.run.rowTrades[0]]) as Any).evidence.trades)
  const r = verifyEvidenceSource(reseal(b), s.files, s.verifyOpts)
  console.log(`    derivado→linha: ${r.status} ${JSON.stringify(r.checks.filter((c) => c.status === "FAIL" || c.status === "SKIPPED").map((c) => `${c.id}:${c.code}`))}`)
  assert.equal(r.status, "SOURCE_MISMATCH"); assert.ok(fails(r).includes("V5.derived:V_DERIVED_LEG_REF_MISMATCH"), fails(r).join())
})

test("MATRIZ (R10) — linhas × sal × rótulo (padrão/livre) × mapa: correto ⇒ SOURCE_VERIFIED; sal/mapa omitido ⇒ UNVERIFIABLE (nunca FAIL); sal/mapa a mais ⇒ ignorado (trade-linha não carrega rótulo: o token trocado é testado nos ciclos, no S4)", () => {
  const rows: string[] = []
  for (const salted of [false, true]) for (const free of [false, true]) for (const mapped of [false, true]) {
    const s = setup({ salted, free, mapped })
    const b = s.bundleOf(s.run.rowTrades)
    const tag = `sal=${salted} rótulo=${free ? "livre " : "padrão"} mapa=${mapped}`
    assert.equal(verifyEvidence(b).status, "VALID", tag)
    assert.equal(verifyEvidenceSource(b, s.files, s.verifyOpts).status, "SOURCE_VERIFIED", tag)
    if (salted) { const r = verifyEvidenceSource(b, s.files, mapped ? { exitReasonMap: MAP } : {}); assert.equal(r.status, "UNVERIFIABLE", `${tag} sem sal`); assert.deepEqual(fails(r), [], tag) }
    else assert.equal(verifyEvidenceSource(b, s.files, { ...s.verifyOpts, accountRefSalt: "a-mais" }).status, "SOURCE_VERIFIED", `${tag} sal a mais`)
    if (mapped) { const r = verifyEvidenceSource(b, s.files, salted ? { accountRefSalt: SALT } : {}); assert.equal(r.status, "UNVERIFIABLE", `${tag} sem mapa`); assert.deepEqual(fails(r), [], tag) }
    // trade-linha NÃO tem pernas: o rótulo livre/token só existe nos ciclos (coberto em test-evidence-sourcelabel-s4); aqui prova-se que o mapa/sal/rótulo do import não quebram a linha
    rows.push(`    ${tag} → V0–V6 VALID · E5b SOURCE_VERIFIED`)
  }
  console.log(rows.join("\n"))
})

const DIR = join(ROOT, "fixtures/ninjatrader/trade-performance")
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
for (const nm of names) {
  const tag = nm.replace(/\.csv$/, "")
  test(`R11 [real ${tag.slice(0, 8)}…] — bundle de LINHAS e de ciclos das fixtures reais ⇒ SOURCE_VERIFIED`, () => {
    const text = readFileSync(join(DIR, nm), "utf8"); const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8"))
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` }); const record = run.importRecord as ImportRecord
    const files = { [record.importId]: new TextEncoder().encode(text) }
    const o = { ...(ctx.accountRefSalt ? { accountRefSalt: ctx.accountRefSalt } : {}), ...(ctx.exitReasonMap ? { exitReasonMap: ctx.exitReasonMap } : {}) }
    for (const [name, set] of [["linhas", run.rowTrades], ["ciclos", run.trades]] as const) {
      const T = toAnalyticsTrades(set); const t = calculateMetricsTraced(T)
      const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...(o.accountRefSalt ? { opts: { accountRefSalt: o.accountRefSalt } } : {}) })
      assert.equal((r as Any).ok, true)
      const v = verifyEvidenceSource(metricEvidenceBundle(r as Any), files, o)
      assert.equal(v.status, status("R11_real_fixtures_rows"), `${name}: ${JSON.stringify(v.checks.filter((c) => c.status !== "PASS"))}`)
    }
    console.log(`  → real: ${run.rowTrades.length} linhas e ${run.trades.length} ciclos: SOURCE_VERIFIED`)
  })
}
console.log(`\n${passed} testes ok`)
