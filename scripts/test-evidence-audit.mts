// Evidence E5.3 — auditoria final de consistência do verificador.   node scripts/test-evidence-audit.mts
// Invariantes sobre um corpus amplo (todas as métricas × total/grupos/HASH_ONLY × empates de saída × mutações), não casos isolados:
//   · nenhum SKIPPED é tratado como PASS (VALID ⇒ só PASS ou S_NOT_APPLICABLE);
//   · todo SKIPPED tem motivo `S_*` e todo FAIL um código `V_*` do contrato; a lista de checks é fixa e ordenada;
//   · `S_ORDER_AMBIGUOUS` não existe mais; com a sequência registrada e reproduzível nunca há recusa por ordem;
//   · os 4 estados (VALID/TAMPERED/UNVERIFIABLE/INVALID_FORMAT) são alcançáveis e coerentes com os checks;
//   · privacidade: nenhum nome de conta em bundle nem em relatório.
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { CHECK_CATALOG, FAIL_CODES, verifyEvidence, type VerifyReport } from "../src/lib/evidence/verify.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { METRIC_IDS, aggregateTradesTraced, calculateMetricsTraced, toAnalyticsTrades, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
import { SEQUENCE_METRICS } from "../src/lib/metrics/sequence.ts"
import { synthCsv, withRisk } from "./_evidence-fixtures.mts"

const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))

// ── corpus ───────────────────────────────────────────────────────────────────
// dia = 2 + i (sem o módulo do baseline): cada linha tem entrada/saída própria e o pipeline não colapsa linhas parecidas
const dd = (i: number, h: number, m = 0) => `${String(2 + i).padStart(2, "0")}/03/2026 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const PTS = [3, -2, -2, 4, -1, 2, -3, 1, 5, -4, 2, -1]
interface Data { name: string; trades: AnalyticsTrade[]; record: ImportRecord }
function dataOf(name: string, exit: (i: number) => string, entry: (i: number) => string): Data {
  const rows = PTS.map((p, i) => ({ account: i % 2 ? "Conta Alfa Secreta" : "Conta Beta Secreta", entryPrice: 2000, exitPrice: 2000 + p, entryAt: entry(i), exitAt: exit(i) }))
  const run = runImportPipeline(synthCsv(rows), { sourceTz: BRT, fileName: `${name}.csv`, reconstructCycles: false })
  return { name, trades: toAnalyticsTrades(withRisk(run.trades, [10])), record: run.importRecord as ImportRecord }
}
const DATASETS: Data[] = [
  dataOf("saida-igual", () => "20/03/2026 12:00:00", (i) => dd(i, 9 + (i % 4))),
  dataOf("pares", (i) => dd(Math.floor(i / 2), 10, 10), (i) => dd(Math.floor(i / 2), 9)),
  dataOf("entrada-igual", (i) => dd(Math.floor(i / 2), 10, 10 + (i % 5)), (i) => dd(Math.floor(i / 2), 9)),
  dataOf("sem-empate", (i) => dd(i, 10 + (i % 5), i), (i) => dd(i, 9)),
]
const SECRETS = ["Conta Alfa Secreta", "Conta Beta Secreta"]

function explain(d: Data, metricId: string, source: Any): EvidenceBundle {
  const r = explainMetric({ metricId, source, trades: d.trades, importRecords: [d.record] })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
const corpus: Array<{ label: string; bundle: EvidenceBundle; hashOnly: boolean; grouped: boolean }> = []
for (const d of DATASETS) {
  for (const limit of [500, 3]) {
    const t = calculateMetricsTraced(d.trades, { tradeIdsLimit: limit })
    for (const id of METRIC_IDS) corpus.push({ label: `${d.name}/L${limit}/${id}`, bundle: explain(d, id, { kind: "METRICS", result: t.result, trace: t.trace }), hashOnly: limit === 3, grouped: false })
  }
  for (const by of ["account", "direction", "hour"] as const) {
    const ag = aggregateTradesTraced(d.trades, { groupBy: by })
    ag.result.groups.forEach((_, gi) => {
      for (const id of METRIC_IDS) corpus.push({ label: `${d.name}/${by}#${gi}/${id}`, bundle: explain(d, id, { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: gi } }), hashOnly: false, grouped: true })
    })
  }
}

const reseal = (b: Any): Any => {
  try {
    return { ...b, evidenceHash: computeEvidenceHash(b) }
  } catch {
    return b
  }
}
const mutate = (b: EvidenceBundle, fn: (x: Any) => void, sealed = true): Any => {
  const c = clone(b) as Any
  fn(c)
  return sealed ? reseal(c) : c
}
const check = (r: VerifyReport, id: string) => r.checks.find((c) => c.id === id) as VerifyReport["checks"][number]

/** Invariantes que valem para QUALQUER relatório. */
function assertReportInvariants(rep: VerifyReport, label: string) {
  assert.deepEqual(rep.checks.map((c) => c.id), CHECK_CATALOG.map((c) => c.id), `${label}: lista/ordem de checks fixa`)
  assert.equal(rep.checks.length, 39)
  assert.deepEqual(rep.limitations.map((l) => l.code), ["L_SEAL_NOT_SIGNATURE", "L_SELECTION_NOT_PROVEN", "L_ORIGIN_NOT_PROVEN"], `${label}: limitations sempre presentes`)
  for (const c of rep.checks) {
    if (c.status === "PASS") assert.equal(c.code, null, `${label} ${c.id}`)
    if (c.status === "SKIPPED") {
      assert.match(c.code ?? "", /^S_[A-Z_]+$/, `${label} ${c.id}: SKIPPED sem motivo S_*`)
      assert.notEqual(c.detail.trim(), "", `${label} ${c.id}: SKIPPED sem explicação`)
      assert.notEqual(c.code, "S_ORDER_AMBIGUOUS")
      assert.notEqual(c.code, "S_CHECK_NOT_EXECUTED", `${label} ${c.id}: caminho do verificador não preencheu o check`)
    }
    if (c.status === "FAIL") assert.equal(c.code, (FAIL_CODES as Record<string, string>)[c.id] ?? "V_FORMAT_INVALID", `${label} ${c.id}`)
  }
  const blocking = rep.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE")
  const anyFail = rep.checks.some((c) => c.status === "FAIL")
  const v0fail = rep.checks.some((c) => c.level === "V0" && c.status === "FAIL")
  if (v0fail) assert.equal(rep.status, "INVALID_FORMAT", label)
  else if (anyFail) assert.equal(rep.status, "TAMPERED", label)
  else if (blocking.length > 0) assert.equal(rep.status, "UNVERIFIABLE", `${label}: SKIPPED bloqueante nunca pode ser VALID`)
  else {
    assert.equal(rep.status, "VALID", label)
    assert.ok(rep.checks.every((c) => c.status === "PASS" || c.code === "S_NOT_APPLICABLE"), `${label}: VALID só com PASS/NOT_APPLICABLE`)
  }
}

// ── 1. SKIPPED nunca é PASS ──────────────────────────────────────────────────

test("AUDITORIA: em todo o corpus íntegro (todas as métricas × total/grupos/HASH_ONLY × 4 conjuntos) as invariantes do relatório valem; 0 FAIL; só HASH_ONLY/âncora/associação impedem VALID", () => {
  const status: Record<string, number> = {}
  for (const { label, bundle } of corpus) {
    const rep = verifyEvidence(bundle)
    assertReportInvariants(rep, label)
    status[rep.status] = (status[rep.status] ?? 0) + 1
    assert.deepEqual(rep.checks.filter((c) => c.status === "FAIL").map((c) => c.id), [], label)
    for (const c of rep.checks.filter((x) => x.status === "SKIPPED" && x.code !== "S_NOT_APPLICABLE")) assert.match(c.code as string, /^(S_HASH_ONLY|S_NO_ANCHOR_CHECK|S_ASSOCIATION_UNVERIFIABLE)$/, `${label} ${c.id}`)
  }
  assert.deepEqual(DATASETS.map((d) => d.trades.length), DATASETS.map(() => PTS.length), "todo conjunto do corpus tem os 12 trades")
  assert.ok(status.VALID > 0 && status.UNVERIFIABLE > 0)
  console.log(`  → corpus íntegro: ${corpus.length} bundles · ${JSON.stringify(status)}`)
})

test("SKIPPED ≠ PASS: cada motivo de SKIPPED bloqueante produz UNVERIFIABLE (nunca VALID), um por um", () => {
  const seen = new Set<string>()
  const d = DATASETS[0]
  const full = corpus.find((c) => c.label === "saida-igual/L500/maxDrawdown") as { bundle: EvidenceBundle }
  const cases: Array<[string, Any]> = [
    ["S_ORDER_NOT_RECORDED", mutate(full.bundle, (x) => (x.evidence.metrics[0].population.sequence.order = null))],
    ["S_VERSION_INCOMPATIBLE", mutate(full.bundle, (x) => (x.evidence.metrics[0].engineVersion = "metrics/0.0.1"))],
    ["S_HASH_ONLY", (corpus.find((c) => c.label === "saida-igual/L3/maxDrawdown") as { bundle: EvidenceBundle }).bundle],
    ["S_NO_ANCHOR_CHECK", (corpus.find((c) => c.label === "saida-igual/L3/netPnl") as { bundle: EvidenceBundle }).bundle],
    ["S_ASSOCIATION_UNVERIFIABLE", (() => { const ag = aggregateTradesTraced(d.trades, { groupBy: "strategy" }); return explain(d, "netPnl", { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: 0 } }) })()],
    ["S_QUERY_INVALID", mutate(full.bundle, (x) => (x.evidence.metrics[0].query.options.pnlBasis = "XXX"))],
  ]
  for (const [code, b] of cases) {
    const rep = verifyEvidence(b)
    assertReportInvariants(rep, code)
    const codes = rep.checks.filter((c) => c.status === "SKIPPED").map((c) => c.code)
    assert.ok(codes.includes(code) || (code === "S_QUERY_INVALID" && rep.status === "TAMPERED"), `${code}: esperado entre ${JSON.stringify(codes)} (${rep.status})`)
    assert.notEqual(rep.status, "VALID", code)
    seen.add(code)
  }
  assert.ok(seen.size >= 5)
})

test("FONTE: sem `?? NA(` (check esquecido nunca vira 'não se aplica'), sem S_ORDER_AMBIGUOUS em src/, `SKIPPED` só vira PASS dentro de combine() quando TODOS passam", () => {
  const verifySrc = readFileSync(join(ROOT, "src/lib/evidence/verify.ts"), "utf8")
  assert.equal(/\?\?\s*NA\(/.test(verifySrc), false)
  assert.ok(verifySrc.includes("S_CHECK_NOT_EXECUTED"))
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
  for (const f of walk(join(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p))) assert.equal(readFileSync(f, "utf8").includes("S_ORDER_AMBIGUOUS"), false, f)
  // status final: a única linha que produz VALID é a última do encadeamento (nenhum FAIL e nenhum SKIPPED bloqueante)
  assert.equal((verifySrc.match(/status = "VALID"/g) ?? []).length, 1)
})

// ── 2. sequência registrada nunca é recusada por ordem ───────────────────────

test("SEQUÊNCIA: com a ordem registrada e reproduzível, NENHUM check é SKIPPED por ordem — total e grupos, todas as métricas sequenciais, todos os conjuntos (inclusive empates)", () => {
  let n = 0
  for (const { label, bundle, hashOnly } of corpus) {
    const m = bundle.evidence.metrics[0]
    if (!(SEQUENCE_METRICS as readonly string[]).includes(m.metricId) || hashOnly) continue
    n += 1
    assert.equal(m.population.sequence.dependent, true, label)
    assert.notEqual(m.population.sequence.order, null, label)
    const rep = verifyEvidence(bundle)
    assert.equal(check(rep, "V4.sequence").status, "PASS", label)
    assert.equal(rep.checks.some((c) => c.code === "S_ORDER_NOT_RECORDED" || c.code === "S_ORDER_AMBIGUOUS"), false, label)
    assert.equal(rep.status, rep.checks.some((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE") ? "UNVERIFIABLE" : "VALID", label)
  }
  assert.ok(n > 100, `corpus sequencial pequeno demais (${n})`)
  // HASH_ONLY: não alega a sequência
  for (const { label, bundle, hashOnly } of corpus) {
    if (!hashOnly || !(SEQUENCE_METRICS as readonly string[]).includes(bundle.evidence.metrics[0].metricId)) continue
    assert.deepEqual(bundle.evidence.metrics[0].population.sequence.order, null, label)
    assert.equal(check(verifyEvidence(bundle), "V4.sequence").code, "S_HASH_ONLY", label)
  }
})

// ── 3. mutações: os 4 estados e as invariantes ───────────────────────────────

test("MUTAÇÕES: em cada bundle íntegro de amostra, as invariantes valem após cada adulteração (selo refeito ou não) e os 4 estados são alcançados", () => {
  const status: Record<string, number> = {}
  let swapsValid = 0
  const muts: Array<[string, (x: Any) => void, boolean]> = [
    ["value", (x) => (x.evidence.metrics[0].value = (x.evidence.metrics[0].value ?? 0) + 1), true],
    ["value sem selo", (x) => (x.evidence.metrics[0].value = (x.evidence.metrics[0].value ?? 0) + 1), false],
    ["pnl", (x) => x.evidence.trades[0] && (x.evidence.trades[0].pnl.net += 100), true],
    ["rowHash", (x) => x.evidence.trades[0] && (x.evidence.trades[0].sourceRows[0].rowHash = "f".repeat(64)), true],
    ["tradeSetHash", (x) => (x.evidence.metrics[0].population.tradeSetHash = "c".repeat(64)), true],
    ["trade removido", (x) => x.evidence.trades.shift(), true],
    ["import removido", (x) => (x.evidence.imports = []), true],
    ["engineVersion", (x) => (x.evidence.metrics[0].engineVersion = "metrics/0.0.1"), true],
    ["ordem: pontas trocadas", (x) => { const o = x.evidence.metrics[0].population.sequence.order; if (o && o.length > 1) [o[0], o[o.length - 1]] = [o[o.length - 1], o[0]] }, true],
    ["ordem: removida", (x) => (x.evidence.metrics[0].population.sequence.order = null), true],
    ["ordem: repetida", (x) => { const o = x.evidence.metrics[0].population.sequence.order; if (o && o.length > 1) o[1] = o[0] }, true],
    ["dependent invertido", (x) => (x.evidence.metrics[0].population.sequence.dependent = !x.evidence.metrics[0].population.sequence.dependent), true],
    ["campo extra", (x) => (x.evidence.metrics[0].population.sequence.account = "x"), true],
    ["campo extra no trade", (x) => x.evidence.trades[0] && (x.evidence.trades[0].entry.at.sourceName = "x"), true],
    ["selo truncado", (x) => (x.evidenceHash = x.evidenceHash.slice(0, 40)), false],
  ]
  corpus.forEach(({ label, bundle }, i) => {
    if (i % 7 !== 0) return
    for (const [what, fn, sealed] of muts) {
      const rep = verifyEvidence(mutate(bundle, fn, sealed))
      assertReportInvariants(rep, `${label} · ${what}`)
      status[rep.status] = (status[rep.status] ?? 0) + 1
      if (rep.status === "VALID") {
        // mutação que NÃO é pega só pode ser: (a) sem efeito (o campo/trade não existia neste bundle) ou (b) troca de empatados imaterial
        const strip = (b: Any) => JSON.stringify({ ...b, evidenceHash: null })
        const noop = strip(mutate(bundle, fn, sealed)) === strip(bundle)
        const immaterialSwap = what === "ordem: pontas trocadas" && check(rep, "V4.sequence").status === "PASS"
        // (c) ordem removida onde NÃO há empate de instante: a ordem é determinada só pelos instantes e o próprio check diz isso
        const redundantOrder = what === "ordem: removida" && /sem empate de instante/.test(check(rep, "V4.sequence").detail)
        assert.ok(noop || immaterialSwap || redundantOrder, `${label} · ${what}: adulteração REAL passou como VALID`)
        if (immaterialSwap && !noop) swapsValid += 1
      }
    }
  })
  for (const s of ["VALID", "TAMPERED", "UNVERIFIABLE", "INVALID_FORMAT"]) assert.ok((status[s] ?? 0) > 0, `estado ${s} nunca alcançado`)
  console.log(`  → mutações (amostra): ${JSON.stringify(status)} · trocas de empatados imateriais aceitas como VALID: ${swapsValid}`)
})

test("PRIVACIDADE: nenhum nome de conta em nenhum bundle do corpus nem em nenhum relatório (detalhes dos checks incluídos)", () => {
  for (const { label, bundle } of corpus.filter((_, i) => i % 5 === 0)) {
    const text = JSON.stringify(bundle) + JSON.stringify(verifyEvidence(bundle))
    for (const s of SECRETS) assert.equal(text.includes(s), false, `${label}: vazou "${s}"`)
  }
})

test("ORDEM × HASHES (E7-17): trocar a ordem do array não muda NADA — nem tradeSetHash, nem a ordem registrada, nem o evidenceHash (o desempate é o id)", () => {
  const d = DATASETS[0]
  const rev: Data = { ...d, trades: [...d.trades].reverse() }
  const a = explain(d, "maxDrawdown", { kind: "METRICS", ...calculateMetricsTraced(d.trades) })
  const b = explain(rev, "maxDrawdown", { kind: "METRICS", ...calculateMetricsTraced(rev.trades) })
  assert.equal(a.evidence.metrics[0].population.tradeSetHash, b.evidence.metrics[0].population.tradeSetHash)
  assert.deepEqual(a.evidence.metrics[0].population.sequence.order, b.evidence.metrics[0].population.sequence.order)
  assert.equal(a.evidenceHash, b.evidenceHash)
})

console.log(`\n${passed} testes ok`)
