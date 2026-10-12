// S2 do plano do sourceLabel: projeção na Evidence + schema que rejeita texto livre (V0) + labelVocab no ImportRef.   node scripts/test-evidence-sourcelabel-s2.mts
// Lê scripts/expectations/sourcelabel.expected.json (escrito ANTES do código: S0/S0b). Imprime a PROVA DOS 9 BUNDLES, bundle a bundle.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { buildBundle, buildDemo } from "../src/lib/dev/evidence-lab/model.ts"
import { demoCsv, DEMO_FILE_NAME, DEMO_SOURCE_TZ } from "../src/lib/dev/evidence-lab/synthetic.ts"
import { DERIVED_SCENARIOS, derivedContext, runDerivedScenario } from "../src/lib/dev/evidence-lab/derived.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { LABEL_TOKEN_RE } from "../src/lib/evidence/label-vocab.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

const env = process.env as Record<string, string | undefined>
const ORIGINAL_ENV = env.NODE_ENV
env.NODE_ENV = "development"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp = JSON.parse(readFileSync(join(ROOT, "scripts/expectations/sourcelabel.expected.json"), "utf8")) as Any
const J = JSON.stringify
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const TOKEN = /^lbl_[0-9a-f]{24}$/
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
/** Todos os valores das chaves de rótulo de um bundle (qualquer profundidade). */
function labelsOf(b: unknown): string[] {
  const out: string[] = []
  const walk = (v: Any) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if ((k === "sourceLabel" || k === "entryLabel" || k === "exitLabel") && typeof x === "string") out.push(x); else walk(x) }
  }
  walk(b)
  return out
}
const allProjected = (b: unknown) => labelsOf(b).every((l) => l === "" || TOKEN.test(l) || /^(entry|target\d{0,2}|stop\d{0,2}|zerar)$/i.test(l))

// ── 1. PROVA DOS 9 BUNDLES ───────────────────────────────────────────────────

const demo = buildDemo()
const OPTS = { timeZone: "America/Sao_Paulo", minSample: 4 } as const
const NET = { pnl: "NET", r: "NET" } as const
const mb = (req: Any): Any => { const r = buildBundle(demo, req) as Any; assert.equal(r.ok, true); return r.bundle }
const metricNet = mb({ metricId: "netPnl", view: NET })
const dRank: Any = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "account" }, options: OPTS }, trades: demo.analytics, importRecords: [demo.importRecord] })
const combinedBundle: Any = clone(metricNet)
combinedBundle.evidence.derived = [dRank.derived]
combinedBundle.evidenceHash = computeEvidenceHash(combinedBundle)
const dOnly = (op: string, args: Any, options: Any = OPTS): Any => { const r: Any = explainDerived({ spec: { op, args, options } as Any, trades: demo.analytics, importRecords: [demo.importRecord] }); assert.equal(r.ok, true); return { bundle: derivedEvidenceBundle(r), derivedId: r.derived.derivedId } }
const rowsRun = runImportPipeline(demoCsv(), { sourceTz: DEMO_SOURCE_TZ, fileName: DEMO_FILE_NAME, reconstructCycles: false })
const rowsAnalytics = toAnalyticsTrades(rowsRun.trades)
const rowsT = calculateMetricsTraced(rowsAnalytics)
const rowsBundle = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: rowsT.result, trace: rowsT.trace }, trades: rowsAnalytics, importRecords: [rowsRun.importRecord as ImportRecord] }) as Any)

const NINE: Record<string, Any> = {
  "lab-demo/netPnl": metricNet,
  "lab-demo/largestWinner@limit3(HASH_ONLY)": mb({ metricId: "largestWinner", view: NET, tradeIdsLimit: 3 }),
  "lab-demo/netPnl@account#0": mb({ metricId: "netPnl", view: NET, by: "account", group: 0 }),
  "lab-demo/maxDrawdownR": mb({ metricId: "maxDrawdownR", view: NET }),
  "lab-demo/metric+derived(GROUP_RANKING account)": combinedBundle,
  "lab-demo/derived-only(EXIT_REASON_ANALYSIS)": dOnly("EXIT_REASON_ANALYSIS", {}).bundle,
  "lab-demo/derived-only(LEG_GROUP_RANKING hour STOP)": dOnly("LEG_GROUP_RANKING", { groupBy: "hour", reason: "STOP" }).bundle,
  "lab-demo/derived-only(HASH_ONLY, limit 3)": dOnly("GROUP_RANKING", { groupBy: "account" }, { ...OPTS, tradeIdsLimit: 3 }).bundle,
  "lab-demo-rows(SOURCE_ROW)/netPnl": rowsBundle,
}

test("PROVA DOS 9 BUNDLES: remover labelVocab + recalcular o selo = evidenceHash de baseline; o bundle novo ≠ baseline (campo novo); mesmo veredito do verifyEvidence — resultado bundle a bundle", () => {
  const base = exp.noChange_invariants.removal_proof.bundles as Record<string, Any>
  assert.deepEqual(Object.keys(NINE).sort(), Object.keys(base).sort())
  assert.ok(Object.keys(base).length >= exp.noChange_invariants.removal_proof.min_bundles)
  const rows: string[] = []
  for (const [name, b] of Object.entries(NINE)) {
    const want = base[name].baseline
    // 1) o campo novo existe e vale 1 em TODO ImportRef
    for (const imp of b.evidence.imports) assert.equal(imp.labelVocab, 1, `${name}: labelVocab`)
    // 2) o selo novo é diferente do baseline (o campo entrou no hash) …
    // (corrigido no S2, ver _meta.history do arquivo de expectativas) bundle SEM ImportRef (derivado HASH_ONLY: nenhum trade no bundle) não carrega o campo ⇒ selo IDÊNTICO
    if (b.evidence.imports.length === 0) assert.equal(b.evidenceHash, want.evidenceHash, `${name}: sem ImportRef o selo não pode mudar`)
    else assert.notEqual(b.evidenceHash, want.evidenceHash, `${name}: o selo deveria mudar pelo labelVocab`)
    // 3) … e SÓ por isso: sem labelVocab, com selo recalculado, é exatamente o baseline
    const stripped = clone(b)
    for (const imp of stripped.evidence.imports) delete imp.labelVocab
    const recomputed = computeEvidenceHash(stripped)
    assert.equal(recomputed, want.evidenceHash, `${name}: remover labelVocab NÃO reproduz o baseline ⇒ algo mais mudou`)
    // 4) identidade e veredito
    assert.equal(b.evidence.imports[0]?.importId ?? null, want.importId, `${name}: importId`)
    assert.equal(b.evidence.trades[0]?.tradeId ?? null, want.firstTradeId, `${name}: tradeId`)
    assert.equal(b.evidence.trades[0]?.sourceRows[0]?.rowHash ?? null, want.firstRowHash, `${name}: rowHash`)
    assert.equal(b.evidence.trades.length, want.trades, `${name}: nº de trades`)
    assert.equal(verifyEvidence(b).status, want.verify, `${name}: veredito`)
    assert.deepEqual([...new Set(labelsOf(b))].sort(), want.labels, `${name}: rótulos (todos padrão ⇒ saem idênticos)`)
    rows.push(`    ${name.padEnd(54)} baseline ${want.evidenceHash.slice(0, 12)} · novo ${b.evidenceHash.slice(0, 12)} · sem labelVocab ${recomputed.slice(0, 12)} ${recomputed === want.evidenceHash ? "= baseline ✔" : "≠ BASELINE ✘"} · ${b.evidence.imports.length === 0 ? "sem ImportRef (selo inalterado)" : "selo mudou só pelo labelVocab"} · ${verifyEvidence(b).status}`)
  }
  console.log(rows.join("\n"))
})

test("IDENTIDADE (3 bundles do Lab de derivados, com 'Saida X'): importId, tradeSetHash, primeiro tradeId e rowHash IDÊNTICOS ao baseline; só o evidenceHash muda (labelVocab + token)", () => {
  const ctx = derivedContext()
  const pins = exp.noChange_invariants.pins as Record<string, Any>
  for (const id of ["rank-hour", "exit-analysis", "leg-rank"]) {
    const b = runDerivedScenario(ctx, DERIVED_SCENARIOS.find((s) => s.id === id)!).bundle as Any
    const p = pins[`lab-derived/${id}`]
    assert.equal(b.evidence.imports[0].importId, p.importId, id)
    assert.equal(b.evidence.trades[0].tradeId, p.firstTradeId, id)
    assert.equal(b.evidence.trades[0].sourceRows[0].rowHash, p.firstRowHash, id)
    assert.equal(b.evidence.derived[0].population.tradeSetHash, p.tradeSetHash, id)
    assert.notEqual(b.evidenceHash, p.evidenceHash, id)
    assert.ok(labelsOf(b).some((l) => TOKEN.test(l)), `${id}: 'Saida X' deveria aparecer como token`)
    assert.equal(J(b).includes("Saida X"), false, `${id}: texto livre vazou`)
    assert.equal(verifyEvidence(b).status, "VALID", id)
  }
})

// ── 2. CSV com rótulos LIVRES (inventados) ───────────────────────────────────

const FREE = ["Meu Setup X", "StopLossCustom", "João do setup"]
const d = (day: number, hms: string) => `${String(day).padStart(2, "0")}/03/2026 ${hms}`
const FREE_ROWS: SynthRow[] = [
  { entryPrice: 2000, exitPrice: 2004, entryAt: d(2, "09:00:00"), exitAt: d(2, "09:10:00"), exitLabel: FREE[0] },
  { entryPrice: 2000, exitPrice: 1996, entryAt: d(3, "09:00:00"), exitAt: d(3, "09:10:00"), exitLabel: FREE[1] },
  { entryPrice: 2000, exitPrice: 2002, entryAt: d(4, "09:00:00"), exitAt: d(4, "09:10:00"), exitLabel: FREE[2], entryLabel: "Meu Setup X" },
  { entryPrice: 2000, exitPrice: 2003, entryAt: d(5, "09:00:00"), exitAt: d(5, "09:10:00"), exitLabel: "Target1" },
]
const freeCsv = synthCsv(FREE_ROWS)
function freeBundle(salt?: string): { bundle: Any; record: ImportRecord; csv: string; trades: Any } {
  const run = runImportPipeline(freeCsv, { sourceTz: DEMO_SOURCE_TZ, fileName: "livre.csv", ...(salt !== undefined ? { accountRefSalt: salt } : {}) })
  const trades = toAnalyticsTrades(run.trades)
  const t = calculateMetricsTraced(trades, { timeZone: "America/Sao_Paulo" })
  const r: Any = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades, importRecords: [run.importRecord as ImportRecord], opts: salt !== undefined ? { accountRefSalt: salt } : undefined })
  assert.equal(r.ok, true, r.message)
  return { bundle: metricEvidenceBundle(r), record: run.importRecord as ImportRecord, csv: freeCsv, trades: run.trades }
}
const FREE_B = freeBundle()
const files = (x: { record: ImportRecord; csv: string }) => ({ [x.record.importId]: new TextEncoder().encode(x.csv) })

test("CSV COM RÓTULOS LIVRES: nenhum texto livre em NENHUM campo do bundle (inclui issues, filtros, relatório); só tokens; o mesmo texto = o mesmo token; motivo continua visível", () => {
  const b = FREE_B.bundle
  for (const t of FREE) assert.equal(J(b).includes(t), false, `vazou: ${t}`)
  assert.equal(J(verifyEvidence(b)).includes("Meu Setup"), false)
  assert.ok(allProjected(b))
  const legs = b.evidence.trades.flatMap((t: Any) => t.exitLegs ?? [])
  const tok = legs.filter((l: Any) => TOKEN.test(l.sourceLabel ?? ""))
  assert.equal(tok.length, 3, "3 rótulos livres ⇒ 3 tokens")
  assert.equal(new Set(tok.map((l: Any) => l.sourceLabel)).size, 3)
  assert.equal(legs.filter((l: Any) => l.sourceLabel === "Target1").length, 1, "padrão sai em claro")
  // o MESMO texto na entrada e na saída ('Meu Setup X') dá o MESMO token
  const entryTok = b.evidence.trades.flatMap((t: Any) => t.entryLegs ?? []).map((l: Any) => l.sourceLabel).filter((x: string) => TOKEN.test(x))
  assert.equal(entryTok.length, 1)
  assert.ok(tok.some((l: Any) => l.sourceLabel === entryTok[0]))
  // linhas de origem também
  const rowLabels = b.evidence.trades.flatMap((t: Any) => t.sourceRows).flatMap((r: Any) => [r.entryLabel, r.exitLabel]).filter((x: string | null) => x && TOKEN.test(x))
  assert.equal(rowLabels.length, 4)
  // motivo: o texto some, a classificação fica
  const reason = (tkn: string) => legs.find((l: Any) => l.sourceLabel === tkn)
  assert.deepEqual(legs.map((l: Any) => [l.reason, l.reasonRule]).sort(), [["STOP", "LABEL_RULE"], ["TARGET", "LABEL_RULE"], ["UNKNOWN", "NONE"], ["UNKNOWN", "NONE"]].sort())
  void reason
})

test("E5b (expectativa 'free_text_label_csv'): VALID + SOURCE_VERIFIED; token adulterado ⇒ SOURCE_MISMATCH (V5.values) com VALID no V0–V4; texto livre injetado com selo refeito ⇒ INVALID_FORMAT", () => {
  const e = exp.e5b.free_text_label_csv
  const b = FREE_B.bundle
  assert.equal(verifyEvidence(b).status, e.verifyEvidence)
  const s = verifyEvidenceSource(b, files(FREE_B))
  assert.equal(s.status, e.verifyEvidenceSource, J(s.checks.filter((c) => c.status !== "PASS")))
  // token trocado por outro token BEM FORMADO, selo refeito
  const forged = clone(b)
  const leg = forged.evidence.trades.flatMap((t: Any) => t.exitLegs ?? []).find((l: Any) => TOKEN.test(l.sourceLabel ?? ""))
  leg.sourceLabel = `lbl_${"0".repeat(24)}`
  const f = reseal(forged)
  assert.equal(verifyEvidence(f).status, "VALID", "o V0–V4 não enxerga a troca (token bem formado): é o limite documentado")
  const sf = verifyEvidenceSource(f, files(FREE_B))
  assert.equal(sf.status, e.token_adulterado.verifyEvidenceSource)
  const c = sf.checks.find((x) => x.id === e.token_adulterado.check)!
  assert.deepEqual([c.status, c.code], ["FAIL", e.token_adulterado.code])
  // texto livre injetado, em CADA um dos 4 campos, com selo refeito
  const inject: Array<[string, (x: Any) => void]> = [
    ["entryLegs[].sourceLabel", (x) => { x.evidence.trades.find((t: Any) => t.entryLegs).entryLegs[0].sourceLabel = "Meu Setup X" }],
    ["exitLegs[].sourceLabel", (x) => { x.evidence.trades.find((t: Any) => t.exitLegs).exitLegs[0].sourceLabel = "Meu Setup X" }],
    ["sourceRows[].entryLabel", (x) => { x.evidence.trades[0].sourceRows[0].entryLabel = "Meu Setup X" }],
    ["sourceRows[].exitLabel", (x) => { x.evidence.trades[0].sourceRows[0].exitLabel = "Meu Setup X" }],
  ]
  assert.deepEqual(inject.map(([n]) => n), exp.schema_V0.fields)
  for (const [name, fn] of inject) {
    const x = clone(b)
    fn(x)
    const r = verifyEvidence(reseal(x))
    assert.equal(r.status, e.texto_livre_injetado_com_selo_refeito.verifyEvidence, name)
    assert.equal(r.checks.find((c2) => c2.id === "V0.structure")!.status, "FAIL", name)
  }
})

test("V0 (schema_V0): aceita null, vazio, palavra do vocabulário e token; rejeita Flat, Close, Target100, token malformado ou em maiúsculas — com selo refeito", () => {
  const set = (v: string | null) => { const x = clone(NINE["lab-demo/netPnl"]); x.evidence.trades[0].exitLegs[0].sourceLabel = v; return reseal(x) }
  for (const ok of [null, "", "Entry", "Target12", "Stop", "Zerar", `lbl_${"a".repeat(24)}`]) assert.equal(verifyEvidence(set(ok)).checks.find((c) => c.id === "V0.structure")!.status, "PASS", String(ok))
  for (const bad of ["Flat", "Close", "Target100", `lbl_${"a".repeat(23)}`, `lbl_${"A".repeat(24)}`, "Meu Setup X", " Entry", "Stop loss"]) {
    const r = verifyEvidence(set(bad))
    assert.equal(r.status, "INVALID_FORMAT", J(bad))
  }
})

test("SAL: import com sal ⇒ tokens salgados (≠ sem sal), verificação exige o sal (S_ACCOUNT_REF_UNVERIFIED sem ele); sal informado a um import SEM sal é ignorado (nada de falso SOURCE_MISMATCH); o sal nunca é gravado", () => {
  const salted = freeBundle("sal-x")
  const tokensOf = (b: Any) => labelsOf(b).filter((l) => TOKEN.test(l)).sort()
  assert.notDeepEqual(tokensOf(salted.bundle), tokensOf(FREE_B.bundle))
  assert.equal(J(salted.bundle).includes("sal-x"), false)
  assert.equal(verifyEvidence(salted.bundle).status, "VALID")
  assert.equal(verifyEvidenceSource(salted.bundle, files(salted), { accountRefSalt: "sal-x" }).status, "SOURCE_VERIFIED")
  const noSalt = verifyEvidenceSource(salted.bundle, files(salted))
  assert.equal(noSalt.status, "UNVERIFIABLE")
  assert.ok(noSalt.checks.some((c) => c.code === "S_ACCOUNT_REF_UNVERIFIED"))
  assert.equal(noSalt.checks.some((c) => c.status === "FAIL"), false)
  // sal "a mais" num import que NÃO usou sal: o `reproducibility` manda ⇒ ignorado ⇒ continua SOURCE_VERIFIED
  assert.equal(verifyEvidenceSource(FREE_B.bundle, files(FREE_B), { accountRefSalt: "sal-que-nao-existe" }).status, "SOURCE_VERIFIED")
  // sal ERRADO num import que usou sal ⇒ não é adulteração
  const wrong = verifyEvidenceSource(salted.bundle, files(salted), { accountRefSalt: "outro" })
  assert.equal(wrong.checks.some((c) => c.status === "FAIL"), false)
  assert.notEqual(wrong.status, "SOURCE_VERIFIED")
})

test("labelVocab (decisão D): ausente = v1 (E5b segue VERIFIED); versão diferente ⇒ UNVERIFIABLE (S_VERSION_INCOMPATIBLE), V0–V4 ainda VALID ⇒ combinado NOT_VERIFIED, nunca adulteração", () => {
  const e = exp.labelVocab_D
  const absent = clone(FREE_B.bundle)
  for (const imp of absent.evidence.imports) delete imp.labelVocab
  assert.equal(verifyEvidenceSource(reseal(absent), files(FREE_B)).status, "SOURCE_VERIFIED", "ausente ≡ v1")
  const v2 = clone(FREE_B.bundle)
  for (const imp of v2.evidence.imports) imp.labelVocab = 2
  const r2 = reseal(v2)
  const s = verifyEvidenceSource(r2, files(FREE_B))
  assert.equal(s.status, e.unknown_future_version.verifyEvidenceSource)
  assert.ok(s.checks.some((c) => c.code === e.unknown_future_version.code))
  assert.equal(s.checks.some((c) => c.status === "FAIL"), false)
  assert.equal(verifyEvidence(r2).status, "VALID")
})

test("VARREDURA: todo rótulo de todo bundle do teste (9 + free-text + sal) é palavra do vocabulário, vazio ou token; labelVocab ∈ ImportRef em todos", () => {
  for (const [n, b] of Object.entries({ ...NINE, free: FREE_B.bundle })) assert.ok(allProjected(b), n)
})

env.NODE_ENV = ORIGINAL_ENV
if (ORIGINAL_ENV === undefined) delete env.NODE_ENV
console.log(`\n${passed} testes ok`)
