// Política de sal — P2: `saltId`/`saltCheck` OPCIONAIS no schema (ImportRecord.reproducibility e ImportRef.reproducibility) + V0 de formato.
// Expectativas: scripts/expectations/salt-policy.expected.json (hash_and_schema_cases H1–H4, S1, S2). Nenhum produtor ainda (P3): os campos
// aqui são injetados à mão. Bundles existentes têm que continuar IDÊNTICOS (a suíte inteira + os pins já existentes provam H1/H2).
//   node scripts/test-salt-policy-p2.mts
import assert from "node:assert/strict"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { ImportRecordSchema, SALT_CHECK_RE, SALT_ID_RE } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { buildImportRecord } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { generateSalt, saltCheck } from "../src/lib/ingest/salt.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const d = (n: number) => `${String(n).padStart(2, "0")}/03/2026`
const SALT = generateSalt()
const CHECK = saltCheck(SALT)
const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }]
const csvOf = (free: boolean) => synthCsv([
  { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${d(2)} 09:00:00`, exitAt: `${d(2)} 09:10:00`, exitLabel: free ? "meu stop 1" : "Stop1" },
  { account: "Conta B", entryPrice: 2000, exitPrice: 2004, entryAt: `${d(3)} 09:00:00`, exitAt: `${d(3)} 09:10:00`, exitLabel: free ? "Meu Setup X" : "Target1" },
])
interface Combo { salted: boolean; free: boolean; mapped: boolean; kind: "metric" | "derived" | "rows" }
const COMBOS: Combo[] = []
for (const kind of ["metric", "derived", "rows"] as const) for (const salted of [false, true]) for (const free of [false, true]) for (const mapped of [false, true]) COMBOS.push({ salted, free, mapped, kind })
function build(c: Combo) {
  const csv = csvOf(c.free)
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p2.csv", ...(c.salted ? { accountRefSalt: SALT } : {}), ...(c.mapped ? { exitReasonMap: MAP } : {}) })
  const record = run.importRecord as ImportRecord
  const opts = c.salted ? { accountRefSalt: SALT } : undefined
  const T = toAnalyticsTrades(c.kind === "rows" ? run.rowTrades : run.trades)
  let bundle: Any
  if (c.kind === "derived") {
    const r = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "account" }, options: { timeZone: "America/Sao_Paulo", minSample: 1 } }, trades: T, importRecords: [record], ...(opts ? { opts } : {}) })
    assert.equal(r.ok, true); bundle = derivedEvidenceBundle(r as Any)
  } else {
    const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
    const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...(opts ? { opts } : {}) })
    assert.equal(r.ok, true); bundle = metricEvidenceBundle(r as Any)
  }
  return { bundle, record, files: { [record.importId]: new TextEncoder().encode(csv) }, opts }
}
const declare = (b: Any, saltId = "s1", check: string | null = CHECK): Any => { // check === null ⇒ omite o saltCheck (undefined acionaria o padrão)
  const x = clone(b)
  for (const imp of x.evidence.imports) { imp.reproducibility.saltId = saltId; if (check !== null) imp.reproducibility.saltCheck = check }
  return reseal(x)
}
const strip = (b: Any): Any => {
  const x = clone(b)
  for (const imp of x.evidence.imports) { delete imp.reproducibility.saltId; delete imp.reproducibility.saltCheck }
  return reseal(x)
}

test("H3 (prova dos 9, generalizada) — 24 bundles (métrica/derivado/linhas × sal × rótulo × mapa): declarar saltId+saltCheck muda o selo e passa no V0–V6; REMOVER e recalcular reproduz o baseline exato", () => {
  const rows: string[] = []
  for (const c of COMBOS) {
    const { bundle } = build(c)
    const base = bundle.evidenceHash as string
    assert.equal(computeEvidenceHash(bundle), base, "premissa: o selo do bundle gerado é reproduzível")
    const decl = declare(bundle)
    assert.notEqual(decl.evidenceHash, base, "declarar muda o selo")
    assert.equal(verifyEvidence(decl).status, "VALID", `V0–V6 ${JSON.stringify(c)}`)
    assert.equal(strip(decl).evidenceHash, base, `remoção ⇒ baseline ${JSON.stringify(c)}`)
    assert.deepEqual(strip(decl).evidence, bundle.evidence, "conteúdo idêntico depois da remoção")
    rows.push(`    ${c.kind.padEnd(7)} sal=${String(c.salted).padEnd(5)} livre=${String(c.free).padEnd(5)} mapa=${String(c.mapped).padEnd(5)} → selo muda, V0–V6 VALID, remoção = baseline`)
  }
  console.log(rows.join("\n"))
})

test("H1/H2 — sem a declaração nada muda: o ImportRef gerado hoje NÃO tem as chaves saltId/saltCheck (nem como undefined) ⇒ evidenceHash dos bundles existentes inalterado", () => {
  for (const c of COMBOS) {
    const { bundle } = build(c)
    for (const imp of bundle.evidence.imports) {
      assert.equal("saltId" in imp.reproducibility, false); assert.equal("saltCheck" in imp.reproducibility, false)
    }
    assert.equal(JSON.stringify(bundle).includes("saltId"), false)
  }
})

test("H4 — importId/rowHash/tradeId NÃO mudam com saltId/saltCheck no ImportRecord (reproducibility está fora do importId): confirmado por construção direta e pelo pipeline", () => {
  const csv = csvOf(true)
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p2.csv", accountRefSalt: SALT })
  const rec = run.importRecord as ImportRecord
  const repro = rec.reproducibility!
  const mk = (r: Any) => buildImportRecord({ text: csv, fileName: "p2.csv", parser: { id: rec.parserId, version: rec.parserVersion }, settings: rec.settings, reconstruction: null, reconstructionEnabled: rec.reconstructionMethod !== null, stats: { rowsRead: rec.rowsRead, accepted: rec.rowsAccepted, rejected: rec.rowsRejected }, accountCount: rec.accountCount, reproducibility: r })
  const without = mk(repro), withSalt = mk({ ...repro, saltId: "s1", saltCheck: CHECK })
  assert.equal(without.importId, rec.importId, "premissa: reconstruí o mesmo registro")
  assert.equal(withSalt.importId, without.importId, "saltId/saltCheck não entram no importId")
  assert.equal(withSalt.fileSha256, without.fileSha256)
  // linhas e trades vêm do pipeline (não recebem a declaração): ids estáveis
  const again = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p2.csv", accountRefSalt: SALT })
  assert.deepEqual(again.trades.map((t) => t.tradeId), run.trades.map((t) => t.tradeId))
  assert.deepEqual(again.rowTrades.map((t) => t.tradeId), run.rowTrades.map((t) => t.tradeId))
  // o schema do domínio aceita o registro com a declaração e rejeita desemparelhada
  assert.equal(ImportRecordSchema.safeParse(withSalt).success, true)
  assert.equal(ImportRecordSchema.safeParse(mk({ ...repro, saltId: "s1" })).success, false)
})

test("P2/explain — um ImportRecord com saltId/saltCheck leva as duas chaves para o ImportRef (e só elas); sem elas, nada", () => {
  const { record, bundle } = build({ salted: true, free: false, mapped: false, kind: "metric" })
  const withDecl: ImportRecord = { ...record, reproducibility: { ...record.reproducibility!, saltId: "s1", saltCheck: CHECK } }
  const csv = csvOf(false)
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p2.csv", accountRefSalt: SALT })
  const T = toAnalyticsTrades(run.trades); const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [withDecl], opts: { accountRefSalt: SALT } })
  assert.equal((r as Any).ok, true, (r as Any).message)
  const b = metricEvidenceBundle(r as Any) as Any
  assert.equal(b.evidence.imports[0].reproducibility.saltId, "s1"); assert.equal(b.evidence.imports[0].reproducibility.saltCheck, CHECK)
  assert.equal(verifyEvidence(b).status, "VALID")
  assert.equal(strip(b).evidenceHash, bundle.evidenceHash, "a mesma Evidence sem a declaração = bundle de antes")
})

test("S1 — V0 de formato (selo refeito): saltId/saltCheck malformados, só um dos dois, ou texto livre ⇒ INVALID_FORMAT; formatos válidos passam", () => {
  const { bundle } = build({ salted: true, free: false, mapped: false, kind: "metric" })
  const bad: Array<[string, Any]> = [
    ["saltId maiúsculo", declare(bundle, "S1")], ["saltId com espaço", declare(bundle, "s 1")], ["saltId com 33 chars", declare(bundle, "s".repeat(33))], ["saltId vazio", declare(bundle, "")],
    ["saltId texto livre", declare(bundle, "meu sal secreto 123")],
    ["saltCheck sem prefixo", declare(bundle, "s1", "a".repeat(24))], ["saltCheck 23 hex", declare(bundle, "s1", `slt_${"a".repeat(23)}`)], ["saltCheck maiúsculo", declare(bundle, "s1", `slt_${"A".repeat(24)}`)],
    ["saltCheck é o próprio sal", declare(bundle, "s1", SALT)],
    ["só saltId", declare(bundle, "s1", null)],
  ]
  const onlyCheck = clone(bundle); onlyCheck.evidence.imports[0].reproducibility.saltCheck = CHECK
  bad.push(["só saltCheck", reseal(onlyCheck)])
  for (const [n, b] of bad) assert.equal(verifyEvidence(b).status, "INVALID_FORMAT", n)
  for (const ok of ["s1", "s2", "usr-2026_a", "a", "s".repeat(32)]) assert.equal(verifyEvidence(declare(bundle, ok)).status, "VALID", ok)
  for (const id of ["s1", "usr-2026_a"]) assert.match(id, SALT_ID_RE)
  assert.match(CHECK, SALT_CHECK_RE)
})

test("S2 — sigilo: o valor do sal não aparece em nenhum bundle com a declaração, nem no relatório V0–V6 nem no E5b", () => {
  for (const c of COMBOS.filter((x) => x.salted)) {
    const { bundle, files } = build(c)
    const decl = declare(bundle)
    const text = JSON.stringify(decl)
    assert.equal(text.includes(SALT), false, "sal em claro no bundle"); assert.equal(text.includes(SALT.slice(0, 16)), false)
    assert.equal(JSON.stringify(verifyEvidence(decl)).includes(SALT.slice(0, 16)), false)
    assert.equal(JSON.stringify(verifyEvidenceSource(decl, files, { accountRefSalt: SALT })).includes(SALT.slice(0, 16)), false)
  }
})

test("TRANSITÓRIO (documentado) — sem produtor e sem leitor: um bundle com saltId/saltCheck NÃO é verificável pelo E5b até o P4 (SOURCE_MISMATCH em reproducibility, fail-closed); bundles sem a declaração seguem SOURCE_VERIFIED. Este teste será SUBSTITUÍDO no P4", () => {
  for (const c of COMBOS.filter((x) => x.kind === "metric")) {
    const { bundle, files, opts } = build(c)
    const vopts = { ...(opts ?? {}), ...(c.mapped ? { exitReasonMap: MAP } : {}) }
    assert.equal(verifyEvidenceSource(bundle, files, vopts).status, "SOURCE_VERIFIED", "sem declaração: inalterado")
    const r = verifyEvidenceSource(declare(bundle), files, vopts)
    assert.equal(r.status, "SOURCE_MISMATCH", "transitório")
    assert.ok(r.checks.some((x) => x.id === "V5.import-id" && x.code === "V_IMPORT_RECORD_MISMATCH" && /reproducibility/.test(x.detail)))
  }
})

console.log(`\n${passed} testes ok`)
