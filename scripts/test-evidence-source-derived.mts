// E5b para DERIVADOS (E6.3 → E5b): a população declarada de cada derivado é conferida contra o CSV original.   node scripts/test-evidence-source-derived.mts
// Distinção obrigatória: conferir TODOS os trades de um derivado prova que os trades DECLARADOS vêm do arquivo — NÃO que os filtros originais
// selecionaram a população correta nem que ela é a importação inteira. Sintético versionado + (se existirem) as fixtures reais LOCAIS.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived, type ExplainDerivedInput } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { SOURCE_CHECK_CATALOG, verifyEvidenceSource, type SourceVerifyReport } from "../src/lib/evidence/verify-source.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { calculateMetricsTraced, toAnalyticsTrades, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const J = JSON.stringify
const BRT = "America/Sao_Paulo"
const chk = (r: SourceVerifyReport, id: string) => r.checks.find((c) => c.id === id)!
const OB = { timeZone: BRT, minSample: 4 } as const

interface Cy { account: string; hour: number; day: number; legs: Array<{ qty?: number; exitPrice: number; label: string; min: number }> }
const CY: Cy[] = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim101", hour: 14, day: 4, legs: [{ exitPrice: 1994, label: "Stop1", min: 10 }, { exitPrice: 1992, label: "Stop2", min: 20 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim102", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2002, label: "Saida X", min: 20 }] },
]
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const rows = (): SynthRow[] => CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: l.qty ?? 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label })))
const CSV = synthCsv(rows())
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "e5b-derivados.csv" })
const rec = imp.importRecord as ImportRecord
const T: AnalyticsTrade[] = toAnalyticsTrades(imp.trades)
const FILES = { [rec.importId]: new TextEncoder().encode(CSV) }

const build = (spec: ExplainDerivedInput["spec"], over: Partial<ExplainDerivedInput> = {}): EvidenceBundle => {
  const r = explainDerived({ spec: { options: OB, ...spec }, trades: T, importRecords: [rec], ...over })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return derivedEvidenceBundle(r as Any)
}
const src = (b: unknown, files: Record<string, Uint8Array> = FILES) => verifyEvidenceSource(b, files, {})
const mutate = (b: EvidenceBundle, fn: (x: Any) => void, seal = true): Any => {
  const c = clone(b) as Any
  fn(c)
  return seal ? { ...c, evidenceHash: computeEvidenceHash(c) } : c
}
const d0 = (b: Any) => b.evidence.derived[0]
const LEG = build({ op: "LEG_GROUP_RANKING", args: { groupBy: "hour", reason: "STOP" } })
const RANK = build({ op: "GROUP_RANKING", args: { groupBy: "account" } })
const ANALYSIS = build({ op: "EXIT_REASON_ANALYSIS", args: {} })

test("COMPATIBILIDADE: bundle de MÉTRICA (sem derivados) mantém o comportamento anterior — SOURCE_VERIFIED, 5 limitações, populations idêntico; V5.derived = S_NOT_APPLICABLE (não PASS vazio)", () => {
  const t = calculateMetricsTraced(T, OB)
  const mb = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [rec] }) as Any)
  const r = src(mb)
  assert.equal(r.status, "SOURCE_VERIFIED")
  assert.deepEqual(r.checks.map((c) => c.id), SOURCE_CHECK_CATALOG.map((c) => c.id))
  assert.deepEqual([chk(r, "V5.derived").status, chk(r, "V5.derived").code], ["SKIPPED", "S_NOT_APPLICABLE"])
  assert.deepEqual(r.checks.filter((c) => c.id !== "V5.derived").map((c) => c.status), Array(8).fill("PASS"))
  assert.deepEqual(r.coverage?.populations, { metrics: 1, full: 1, hashOnly: 0, complete: true })
  assert.deepEqual(r.coverage?.derived, { total: 0, full: 0, hashOnly: 0, partial: 0, trades: { declared: 0, inBundle: 0, verified: 0 }, legRefs: { declared: 0, verified: 0 }, scope: "DECLARED_POPULATION" })
  assert.equal(r.limitations.length, 5)
  assert.match(chk(r, "V5.coverage").detail, /^1 métrica\(s\) com a população declarada INTEIRA listada/)
})

test("SÓ DERIVADOS, FULL: SOURCE_VERIFIED; todos os trades da população declarada e as pernas citadas conferem; população 'completa' (declarada); escopo registrado — e verifyEvidence concorda (independentes)", () => {
  for (const b of [RANK, ANALYSIS, LEG]) {
    const r = src(b)
    assert.equal(r.status, "SOURCE_VERIFIED", J(r.checks.filter((c) => c.status !== "PASS")))
    assert.equal(chk(r, "V5.derived").status, "PASS")
    assert.equal(chk(r, "V5.coverage").status, "PASS")
    assert.equal(r.coverage?.populations.metrics, 0)
    assert.equal(r.coverage?.populations.complete, true, "antes: false (só olhava metrics[])")
    const c = r.coverage!.derived
    assert.deepEqual([c.total, c.full, c.hashOnly, c.partial, c.scope], [1, 1, 0, 0, "DECLARED_POPULATION"])
    assert.deepEqual([c.trades.declared, c.trades.inBundle, c.trades.verified], [T.length, T.length, T.length])
    assert.equal(r.coverage?.selection, "NOT_VERIFIED")
    const lim = r.limitations.map((l) => l.code)
    assert.ok(lim.includes("L_DERIVED_POPULATION_SCOPE") && lim.includes("L_SELECTION_NOT_PROVEN"))
    assert.match(r.limitations.find((l) => l.code === "L_DERIVED_POPULATION_SCOPE")!.text, /Não prova que os filtros originais/)
    assert.match(chk(r, "V5.coverage").detail, /não a importação inteira|seleção original continua não provada/)
    assert.equal(verifyEvidence(b).status, "VALID")
  }
  const l = src(LEG).coverage!.derived.legRefs
  assert.ok(l.declared > 0 && l.declared === l.verified)
  assert.equal(src(RANK).coverage!.derived.legRefs.declared, 0)
})

test("SÓ DERIVADOS, HASH_ONLY: sem trades no bundle não há o que ligar à fonte — UNVERIFIABLE (S_NO_IMPORTS), V5.derived explícito (HASH_ONLY), população NÃO completa; nunca SOURCE_VERIFIED", () => {
  const b = build({ op: "GROUP_RANKING", args: { groupBy: "account" }, options: { ...OB, tradeIdsLimit: 3 } })
  assert.equal(d0(b).verifiability, "HASH_ONLY")
  const r = src(b)
  assert.equal(r.status, "UNVERIFIABLE")
  assert.equal(chk(r, "V5.file").code, "S_NO_IMPORTS")
  assert.equal(chk(r, "V5.derived").status, "SKIPPED")
  assert.equal(chk(r, "V5.derived").code, "S_POPULATION_PARTIAL")
  assert.match(chk(r, "V5.derived").detail, /HASH_ONLY .* NÃO pode ser conferida contra a fonte/)
  assert.deepEqual([r.coverage?.populations.complete, r.coverage?.derived.hashOnly], [false, 1])
  assert.equal(r.checks.some((c) => c.status === "FAIL"), false, "ausência não é adulteração")
})

test("MÉTRICA FULL + DERIVADO HASH_ONLY no mesmo bundle ⇒ SOURCE_VERIFIED_PARTIAL (o que está presente confere; a população do derivado não); sem o derivado, SOURCE_VERIFIED", () => {
  const t = calculateMetricsTraced(T, OB)
  const mb = metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [rec] }) as Any)
  const hashOnly = build({ op: "GROUP_RANKING", args: { groupBy: "account" }, options: { ...OB, tradeIdsLimit: 3 } })
  const mixed = mutate(mb, (x) => { x.evidence.derived = [d0(hashOnly)] })
  const r = src(mixed)
  assert.equal(r.status, "SOURCE_VERIFIED_PARTIAL")
  assert.equal(chk(r, "V5.derived").code, "S_POPULATION_PARTIAL")
  assert.equal(r.coverage?.populations.complete, false)
  const full = mutate(mb, (x) => { x.evidence.derived = [d0(RANK)] })
  assert.equal(src(full).status, "SOURCE_VERIFIED")
  assert.equal(src(full).coverage?.populations.complete, true)
})

test("POPULAÇÃO PARCIAL: ids declarados fora do bundle ⇒ SOURCE_VERIFIED_PARTIAL (os presentes conferem; os ausentes NÃO foram conferidos); não é adulteração do E5b", () => {
  const b = mutate(RANK, (x) => {
    const drop = x.evidence.trades[x.evidence.trades.length - 1].tradeId
    x.evidence.trades = x.evidence.trades.filter((t: Any) => t.tradeId !== drop)
  })
  const r = src(b)
  assert.equal(r.status, "SOURCE_VERIFIED_PARTIAL")
  assert.equal(chk(r, "V5.derived").code, "S_POPULATION_PARTIAL")
  assert.match(chk(r, "V5.derived").detail, /PARCIAL — 1 de \d+ trade\(s\) declarados não estão no bundle/)
  const c = r.coverage!.derived
  assert.deepEqual([c.partial, c.trades.declared - c.trades.inBundle, c.trades.verified], [1, 1, T.length - 1])
  assert.equal(r.coverage?.populations.complete, false)
  assert.equal(r.checks.some((c2) => c2.status === "FAIL"), false)
  // o verifyEvidence (V6) acusa a referência quebrada: as duas verificações são independentes e dizem coisas diferentes
  assert.equal(verifyEvidence(b).status, "TAMPERED")
})

test("REFERÊNCIAS DIVERGENTES: pernas citadas ≠ reingestão ⇒ SOURCE_MISMATCH (V_DERIVED_LEG_REF_MISMATCH); trade adulterado dentro do derivado ⇒ SOURCE_MISMATCH em V5.values; id trocado ⇒ não é o tradeId da fonte", () => {
  const legs = mutate(LEG, (x) => { d0(x).refs.legs.items[0].rowNos = [9999] })
  const r1 = src(legs)
  assert.equal(r1.status, "SOURCE_MISMATCH")
  assert.equal(chk(r1, "V5.derived").code, "V_DERIVED_LEG_REF_MISMATCH")
  assert.equal(chk(r1, "V5.values").status, "PASS", "só a referência do derivado diverge")
  const legIdx = mutate(LEG, (x) => { d0(x).refs.legs.items[0].legIndex = 99 })
  assert.equal(chk(src(legIdx), "V5.derived").code, "V_DERIVED_LEG_REF_MISMATCH")
  const val = mutate(RANK, (x) => { x.evidence.trades[0].pnl.net += 1 })
  const r2 = src(val)
  assert.equal(r2.status, "SOURCE_MISMATCH")
  assert.equal(chk(r2, "V5.values").code, "V_TRADE_VALUES_MISMATCH")
  const id = mutate(RANK, (x) => { x.evidence.trades[0].tradeId = "trd_" + "0".repeat(32); d0(x).population.tradeIds[0] = "trd_" + "0".repeat(32) })
  assert.equal(src(id).status, "SOURCE_MISMATCH")
  assert.equal(chk(src(id), "V5.trades").code, "V_TRADE_ID_MISMATCH")
  const row = mutate(RANK, (x) => { x.evidence.trades[0].sourceRows[0].rowHash = "f".repeat(64) })
  assert.equal(chk(src(row), "V5.rows").status, "FAIL")
})

test("CITAÇÃO DE PERNA NÃO CONFERIDA nunca vira PASS (conserto do E6.4): trade citado ausente do bundle ⇒ PARTIAL e dito; população parcial + citação não conferida contam o derivado UMA vez", () => {
  const ghost = mutate(LEG, (x) => { d0(x).refs.legs.items[0].tradeId = "trd_inexistente" })
  const r = src(ghost)
  assert.equal(r.status, "SOURCE_VERIFIED_PARTIAL")
  assert.equal(chk(r, "V5.derived").code, "S_POPULATION_PARTIAL")
  assert.match(chk(r, "V5.derived").detail, /apontam para trade ausente do bundle .* NÃO foram conferidas/)
  assert.equal(r.coverage?.derived.partial, 1)
  assert.equal(r.coverage?.populations.complete, false)
  assert.ok(r.coverage!.derived.legRefs.verified < r.coverage!.derived.legRefs.declared)
  const both = mutate(LEG, (x) => { d0(x).refs.legs.items[0].tradeId = "trd_inexistente"; x.evidence.trades.pop() })
  assert.equal(src(both).coverage?.derived.partial, 1, "o mesmo derivado não é contado duas vezes")
  assert.equal(verifyEvidence(ghost).status, "TAMPERED", "o V6 acusa a referência (independente)")
})

test("DERIVADO SEM REFERÊNCIAS SUFICIENTES: população declarada vazia ou sem nenhum trade no bundle ⇒ nunca SOURCE_VERIFIED; sem FAIL", () => {
  const empty = mutate(RANK, (x) => { d0(x).population.tradeIds = []; d0(x).population.afterFilters = 0; x.evidence.trades = []; x.evidence.imports = [] })
  const r = src(empty)
  assert.notEqual(r.status, "SOURCE_VERIFIED")
  assert.equal(r.checks.some((c) => c.status === "FAIL"), false)
  assert.equal(r.coverage?.populations.complete, false)
  const noTrades = mutate(RANK, (x) => { x.evidence.trades = [] })
  const r2 = src(noTrades)
  assert.notEqual(r2.status, "SOURCE_VERIFIED")
  assert.equal(chk(r2, "V5.derived").code, "S_POPULATION_PARTIAL")
  assert.equal(r2.checks.some((c) => c.status === "FAIL"), false)
})

test("ARQUIVO AUSENTE / ALTERADO: sem CSV ⇒ UNVERIFIABLE (V5.derived bloqueante, não parcial); CSV alterado ⇒ SOURCE_MISMATCH em V5.file e V5.derived não afirma nada", () => {
  const none = src(RANK, {})
  assert.equal(none.status, "UNVERIFIABLE")
  assert.equal(chk(none, "V5.derived").status, "SKIPPED")
  assert.equal(chk(none, "V5.derived").code, "S_DERIVED_TRADES_NOT_VERIFIED")
  assert.equal(none.coverage?.populations.complete, true, "população listada (declarada) ≠ população conferida")
  assert.equal(none.coverage?.derived.trades.verified, 0)
  const bad = src(RANK, { [rec.importId]: new TextEncoder().encode(CSV.replace("2008", "2009")) })
  assert.equal(bad.status, "SOURCE_MISMATCH")
  assert.equal(chk(bad, "V5.file").code, "V_FILE_MISMATCH")
  assert.notEqual(chk(bad, "V5.derived").status, "PASS")
  assert.equal(bad.coverage?.derived.trades.verified, 0)
})

test("O QUE NÃO SE ALEGA: selection/ordem/enriquecimento NOT_VERIFIED; derivado adulterado (valor) com selo refeito continua SOURCE_VERIFIED no E5b (o E5b liga trades à fonte; quem acusa o derivado é o V6)", () => {
  const forged = mutate(RANK, (x) => { d0(x).result.rows[0].net.value += 1 })
  const r = src(forged)
  assert.equal(r.status, "SOURCE_VERIFIED")
  assert.equal(r.coverage?.selection, "NOT_VERIFIED")
  assert.equal(r.coverage?.originalSequenceOrder, "NOT_VERIFIED")
  assert.equal(verifyEvidence(forged).status, "TAMPERED")
  // privacidade do relatório
  for (const s of ["Sim101", "Sim102", "Estrategia Teste", "Target1", "Stop1", "Zerar", "e5b-derivados.csv"]) assert.equal(J(r).includes(s), false, `relatório vazou ${s}`)
  assert.equal(J(r).includes("2000,0"), false, "nenhum trecho do CSV")
})

// ── fixtures reais LOCAIS ────────────────────────────────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] derivados × CSV real: sem SOURCE_MISMATCH nem falso positivo; FULL conferido, HASH_ONLY dito; CSV alterado detectado; sem nomes`, () => {
    const text = readFileSync(join(DIR, name), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    const ts = toAnalyticsTrades(run.trades)
    const salt = (ctx as Any).accountRefSalt as string | undefined
    const files = { [(run.importRecord as ImportRecord).importId]: new TextEncoder().encode(text) }
    const specs: Array<ExplainDerivedInput["spec"]> = [
      { op: "GROUP_RANKING", args: { groupBy: "account" } },
      { op: "GROUP_RANKING", args: { groupBy: "exitReason" } },
      { op: "EXIT_REASON_ANALYSIS", args: {} },
      { op: "LEG_GROUP_RANKING", args: { groupBy: "hour", reason: "STOP" } },
      { op: "EXIT_REASON_COMPARISON_LEGS", args: { a: "STOP", b: "TARGET" } },
    ]
    const tally: Record<string, number> = {}
    let attacks = 0
    let detected = 0
    for (const sp of specs) {
      for (const limit of [500, 3]) {
        const r = explainDerived({ spec: { ...sp, options: { tradeIdsLimit: limit } }, trades: ts, importRecords: [run.importRecord as ImportRecord], opts: { accountRefSalt: salt } })
        assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
        const b = derivedEvidenceBundle(r as Any)
        const rep = verifyEvidenceSource(b, files, { accountRefSalt: salt })
        assert.equal(rep.checks.some((c) => c.status === "FAIL"), false, `${sp.op}/L${limit}: ${J(rep.checks.filter((c) => c.status === "FAIL"))}`)
        assert.notEqual(rep.status, "SOURCE_MISMATCH")
        tally[rep.status] = (tally[rep.status] ?? 0) + 1
        if (d0(b).verifiability === "FULL") {
          assert.equal(rep.status, "SOURCE_VERIFIED", `${sp.op}: ${J(rep.checks.filter((c) => c.status !== "PASS"))}`)
          assert.equal(rep.coverage?.derived.trades.verified, rep.coverage?.derived.trades.declared)
          attacks += 1
          const bad = verifyEvidenceSource(b, { [(run.importRecord as ImportRecord).importId]: new TextEncoder().encode(text.replace(/\d/, (m) => (m === "9" ? "8" : String(Number(m) + 1)))) }, { accountRefSalt: salt })
          if (bad.status === "SOURCE_MISMATCH") detected += 1
        } else {
          assert.equal(rep.status, "UNVERIFIABLE", `${sp.op}/HASH_ONLY`)
          assert.equal(chk(rep, "V5.derived").code, "S_POPULATION_PARTIAL")
        }
        const secrets = new Set<string>()
        for (const t of run.trades) { if (t.account.sourceName) secrets.add(t.account.sourceName.trim()); if (t.labels.strategyName) secrets.add(t.labels.strategyName.trim()) }
        for (const s of secrets) assert.equal(J(rep).includes(s), false, "relatório com nome da origem")
      }
    }
    assert.equal(detected, attacks, `CSV alterado detectado ${detected}/${attacks}`)
    console.log(`  → real: ${specs.length * 2} bundles de derivados · ${J(tally)} · CSV alterado detectado ${detected}/${attacks}`)
  })
}

console.log(`\n${passed} testes ok`)
