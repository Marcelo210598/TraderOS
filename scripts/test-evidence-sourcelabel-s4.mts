// S4 do plano do sourceLabel: E5b com tokens + fixtures reais no nível do BUNDLE + MATRIZ de combinações (sal × rótulo × mapa × tipo de bundle).
//   node scripts/test-evidence-sourcelabel-s4.mts
// A matriz existe porque o bug de sal do E5b ficou 3 etapas sem ser visto por falta da combinação "sal + estratégia/rótulo/mapa": cada eixo novo
// interage com os outros. Imprime a matriz inteira.
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
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const TOKEN = /^lbl_[0-9a-f]{24}$/
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const labelsOf = (b: unknown): string[] => {
  const out: string[] = []
  const walk = (v: Any) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if ((k === "sourceLabel" || k === "entryLabel" || k === "exitLabel") && typeof x === "string") out.push(x); else walk(x) } }
  walk(b)
  return out
}
const fails = (r: Any) => r.checks.some((c: Any) => c.status === "FAIL")

// ── MATRIZ ───────────────────────────────────────────────────────────────────

const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }]
const SALT = "sal-matriz-3"
const d = (n: number) => `${String(n).padStart(2, "0")}/03/2026`
const csvOf = (free: boolean) =>
  synthCsv([
    { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${d(2)} 09:00:00`, exitAt: `${d(2)} 09:10:00`, exitLabel: free ? "meu stop 1" : "Stop1" },
    { account: "Conta B", entryPrice: 2000, exitPrice: 2004, entryAt: `${d(3)} 09:00:00`, exitAt: `${d(3)} 09:10:00`, exitLabel: free ? "Meu Setup X" : "Target1" },
    { account: "Conta A", entryPrice: 2000, exitPrice: 2003, entryAt: `${d(4)} 09:00:00`, exitAt: `${d(4)} 09:10:00`, exitLabel: "Target1" },
  ])
interface Combo { salted: boolean; free: boolean; mapped: boolean; kind: "metric" | "derived" }
const COMBOS: Combo[] = []
for (const kind of ["metric", "derived"] as const) for (const salted of [false, true]) for (const free of [false, true]) for (const mapped of [false, true]) COMBOS.push({ salted, free, mapped, kind })

function build(c: Combo, forgetSalt = false) {
  const csv = csvOf(c.free)
  const salt = c.salted ? SALT : undefined
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "matriz.csv", ...(salt ? { accountRefSalt: salt } : {}), ...(c.mapped ? { exitReasonMap: MAP } : {}) })
  const record = run.importRecord as ImportRecord
  const T = toAnalyticsTrades(run.trades)
  const opts = salt && !forgetSalt ? { accountRefSalt: salt } : undefined
  let bundle: Any
  if (c.kind === "metric") {
    const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
    const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...(opts ? { opts } : {}) })
    assert.equal(r.ok, true); bundle = metricEvidenceBundle(r as Any)
  } else {
    const r = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "account" }, options: { timeZone: "America/Sao_Paulo", minSample: 1 } }, trades: T, importRecords: [record], ...(opts ? { opts } : {}) })
    assert.equal(r.ok, true, (r as Any).message); bundle = derivedEvidenceBundle(r as Any)
  }
  return { bundle, files: { [record.importId]: new TextEncoder().encode(csv) }, csv }
}
const okOpts = (c: Combo) => ({ ...(c.salted ? { accountRefSalt: SALT } : {}), ...(c.mapped ? { exitReasonMap: MAP } : {}) })
const name = (c: Combo) => `${c.kind.padEnd(7)} sal=${String(c.salted).padEnd(5)} rótulo=${c.free ? "livre " : "padrão"} mapa=${String(c.mapped).padEnd(5)}`

test("MATRIZ — caminho CORRETO (16 combinações): gerado com o sal do import ⇒ VALID no V0–V6 e SOURCE_VERIFIED com sal/mapa informados; rótulo livre ⇒ só tokens; nenhum texto livre, regex ou sal no bundle", () => {
  const rows: string[] = []
  for (const c of COMBOS) {
    const g = build(c)
    assert.equal(verifyEvidence(g.bundle).status, "VALID", name(c))
    const s = verifyEvidenceSource(g.bundle, g.files, okOpts(c))
    assert.equal(s.status, "SOURCE_VERIFIED", `${name(c)}: ${JSON.stringify(s.checks.filter((x) => x.status !== "PASS"))}`)
    const text = JSON.stringify(g.bundle)
    for (const secret of ["meu stop", "Meu Setup", "^meu stop", SALT, "Conta A", "Conta B"]) assert.equal(text.includes(secret), false, `${name(c)}: vazou ${secret}`)
    const labels = labelsOf(g.bundle)
    assert.equal(labels.some((l) => TOKEN.test(l)), c.free, `${name(c)}: tokens ⇔ rótulo livre`)
    assert.equal(/pat_[0-9a-f]{24}/.test(text), c.mapped, `${name(c)}: patternRef ⇔ mapa não vazio`)
    rows.push(`    ${name(c)} → V0–V6 VALID · E5b ${s.status}`)
  }
  console.log(rows.join("\n"))
})

test("MATRIZ — o VERIFICADOR recebe entrada errada (16 combinações × variantes): sal omitido, sal a mais, mapa omitido, mapa a mais ⇒ nunca FAIL; só os casos previstos viram UNVERIFIABLE; entrada sobrando é ignorada", () => {
  const rows: string[] = []
  for (const c of COMBOS) {
    const g = build(c)
    const v = (o: Any) => verifyEvidenceSource(g.bundle, g.files, o)
    const cell: string[] = []
    if (c.salted) {
      const r = v({ ...(c.mapped ? { exitReasonMap: MAP } : {}) }) // sal omitido
      assert.equal(r.status, "UNVERIFIABLE", `${name(c)} sal omitido`); assert.equal(fails(r), false)
      assert.ok(r.checks.some((x: Any) => x.code === "S_ACCOUNT_REF_UNVERIFIED"), `${name(c)} sal omitido: código`)
      cell.push("sal omitido→UNVERIFIABLE")
      const w = v({ accountRefSalt: "outro", ...(c.mapped ? { exitReasonMap: MAP } : {}) }) // sal errado
      assert.equal(fails(w), false, `${name(c)} sal errado nunca é FAIL`); assert.notEqual(w.status, "SOURCE_VERIFIED")
      cell.push("sal errado→não verifica")
    } else {
      const r = v({ accountRefSalt: "sal-a-mais", ...(c.mapped ? { exitReasonMap: MAP } : {}) }) // sal a mais: o registro diz 'sem sal' ⇒ ignorado
      assert.equal(r.status, "SOURCE_VERIFIED", `${name(c)} sal a mais`)
      cell.push("sal a mais→ignorado")
    }
    if (c.mapped) {
      const r = v({ ...(c.salted ? { accountRefSalt: SALT } : {}) }) // mapa omitido
      assert.equal(r.status, "UNVERIFIABLE", `${name(c)} mapa omitido`); assert.equal(fails(r), false)
      assert.ok(r.checks.some((x: Any) => x.code === "S_CONTEXT_INSUFFICIENT"))
      cell.push("mapa omitido→UNVERIFIABLE")
    } else {
      const r = v({ ...okOpts(c), exitReasonMap: MAP }) // mapa a mais: import sem mapa ⇒ ignorado
      assert.equal(r.status, "SOURCE_VERIFIED", `${name(c)} mapa a mais`)
      cell.push("mapa a mais→ignorado")
    }
    rows.push(`    ${name(c)} → ${cell.join(" · ")}`)
  }
  console.log(rows.join("\n"))
})

test("MATRIZ — ADULTERAÇÃO (combinações com rótulo livre): token trocado por outro bem formado ⇒ SOURCE_MISMATCH em V5.values com V0–V4 VALID; texto livre injetado ⇒ INVALID_FORMAT; nos derivados o V6 segue VALID (o derivado não carrega rótulo)", () => {
  for (const c of COMBOS.filter((x) => x.free)) {
    const g = build(c)
    const forged = clone(g.bundle)
    const leg = forged.evidence.trades.flatMap((t: Any) => t.exitLegs ?? []).find((l: Any) => TOKEN.test(l.sourceLabel ?? ""))
    assert.ok(leg, `${name(c)}: deveria haver um token`)
    leg.sourceLabel = `lbl_${"0".repeat(24)}`
    const f = reseal(forged)
    assert.equal(verifyEvidence(f).status, "VALID", `${name(c)}: o V0–V6 não enxerga um token bem formado trocado`)
    const s = verifyEvidenceSource(f, g.files, okOpts(c))
    assert.equal(s.status, "SOURCE_MISMATCH", name(c))
    assert.equal(s.checks.find((x) => x.id === "V5.values")!.code, "V_TRADE_VALUES_MISMATCH", name(c))
    const inj = clone(g.bundle)
    inj.evidence.trades.flatMap((t: Any) => t.exitLegs ?? []).find((l: Any) => TOKEN.test(l.sourceLabel ?? "")).sourceLabel = "Meu Setup X"
    assert.equal(verifyEvidence(reseal(inj)).status, "INVALID_FORMAT", name(c))
  }
})

test("MATRIZ — GEROU SEM SAL (import salgado): com mapa ⇒ UNVERIFIABLE; SEM mapa ⇒ SOURCE_MISMATCH (LACUNA CONHECIDA, ver test-evidence-salt-propagation 3d); nunca SOURCE_VERIFIED em nenhuma das 8 combinações", () => {
  const rows: string[] = []
  for (const c of COMBOS.filter((x) => x.salted)) {
    const g = build(c, true)
    const s = verifyEvidenceSource(g.bundle, g.files, okOpts(c))
    assert.notEqual(s.status, "SOURCE_VERIFIED", name(c))
    assert.equal(s.status, c.mapped ? "UNVERIFIABLE" : "SOURCE_MISMATCH", `${name(c)} (comportamento atual documentado)`)
    rows.push(`    ${name(c)} → ${s.status}${fails(s) ? " (FAIL: " + s.checks.filter((x) => x.status === "FAIL").map((x) => x.code).join(",") + ")" : ""}`)
  }
  console.log(rows.join("\n"))
})

// ── fixtures reais LOCAIS, no nível do bundle ────────────────────────────────

const DIR = join(ROOT, "fixtures/ninjatrader/trade-performance")
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const nm of names) {
  const tag = nm.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] bundles REAIS (ciclos e linhas): rótulos na Evidence = rótulos canônicos aparados (0 tokens, 0 texto livre); VALID + SOURCE_VERIFIED; derivados idem`, () => {
    const text = readFileSync(join(DIR, nm), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    const record = run.importRecord as ImportRecord
    const salt = (ctx as Any).accountRefSalt as string | undefined
    const files = { [record.importId]: new TextEncoder().encode(text) }
    const opts = salt ? { accountRefSalt: salt } : undefined
    let n = 0
    for (const set of [run.trades, run.rowTrades]) {
      const T = toAnalyticsTrades(set)
      const t = calculateMetricsTraced(T)
      const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...(opts ? { opts } : {}) })
      assert.equal(r.ok, true, (r as Any).message)
      const b = metricEvidenceBundle(r as Any) as Any
      assert.equal(verifyEvidence(b).status === "VALID" || verifyEvidence(b).status === "UNVERIFIABLE", true)
      const ev = labelsOf(b)
      assert.equal(ev.some((l) => TOKEN.test(l)), false, "fixtures reais: nenhum token (0 rótulos fora do vocabulário)")
      const canon = set.flatMap((x) => [...(x.entryLegs ?? []), ...(x.exitLegs ?? [])].map((l) => (l.sourceLabel ?? "").trim())).filter((l) => l !== "")
      if (set === run.trades) for (const l of new Set(canon)) assert.ok(ev.some((e) => e === l) || canon.length === 0, `rótulo canônico "${l.length} car." ausente da Evidence`)
      // E5b reingere em CICLOS: o bundle de LINHAS (rowTrades) tem outros tradeIds ⇒ fora do escopo do E5b (limite anterior ao sourceLabel; só V0–V6 + tokens aqui)
      if (set === run.trades) {
        const s = verifyEvidenceSource(b, files, { ...(opts ?? {}), ...(((ctx as Any).exitReasonMap ? { exitReasonMap: (ctx as Any).exitReasonMap } : {})) })
        assert.equal(s.status, "SOURCE_VERIFIED", JSON.stringify(s.checks.filter((c) => c.status !== "PASS")))
      }
      assert.equal(b.evidence.imports[0].labelVocab, 1)
      n += ev.length
    }
    const dr = explainDerived({ spec: { op: "EXIT_REASON_ANALYSIS", args: {}, options: {} }, trades: toAnalyticsTrades(run.trades), importRecords: [record], ...(opts ? { opts } : {}) })
    assert.equal(dr.ok, true)
    const db = derivedEvidenceBundle(dr as Any)
    assert.equal(labelsOf(db).some((l) => TOKEN.test(l)), false)
    assert.equal(verifyEvidence(db).status, "VALID")
    assert.equal(verifyEvidenceSource(db, files, { ...(opts ?? {}), ...(((ctx as Any).exitReasonMap ? { exitReasonMap: (ctx as Any).exitReasonMap } : {})) }).status, "SOURCE_VERIFIED")
    console.log(`  → real: ${n} rótulos em 2 bundles de métrica (ciclos: E5b; linhas: só V0–V6) + 1 derivado · 0 tokens · VALID/SOURCE_VERIFIED`)
  })
}

console.log(`\n${passed} testes ok`)
