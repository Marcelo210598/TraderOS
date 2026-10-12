// Política de sal — P4: o E5b LÊ saltId/saltCheck (via SaltProvider). Regras: docs/ai-partner/salt-policy-plano.md §3 + O1/O2/O3 (aprovados).
// Expectativas: scripts/expectations/salt-policy.expected.json (verification_cases V1–V14). Bundles com declaração são montados À MÃO (o gerador é o P3).
//   node scripts/test-salt-policy-p4.mts
import assert from "node:assert/strict"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource, type VerifySourceOptions } from "../src/lib/evidence/verify-source.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { InMemorySaltKeyring, generateSalt, saltCheck } from "../src/lib/ingest/salt.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const d = (n: number) => `${String(n).padStart(2, "0")}/03/2026`
const SALT1 = generateSalt(), SALT2 = generateSalt(), SALT_X = generateSalt()
const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }]
const csvOf = (free: boolean) => synthCsv([
  { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${d(2)} 09:00:00`, exitAt: `${d(2)} 09:10:00`, exitLabel: free ? "meu stop 1" : "Stop1" },
  { account: "Conta B", entryPrice: 2000, exitPrice: 2004, entryAt: `${d(3)} 09:00:00`, exitAt: `${d(3)} 09:10:00`, exitLabel: free ? "Meu Setup X" : "Target1" },
])
type Kind = "metric" | "derived" | "rows"
interface Combo { free: boolean; mapped: boolean; kind: Kind }
const COMBOS: Combo[] = []
for (const kind of ["metric", "derived", "rows"] as const) for (const free of [false, true]) for (const mapped of [false, true]) COMBOS.push({ free, mapped, kind })
const nm = (c: Combo) => `${c.kind.padEnd(7)} rótulo=${c.free ? "livre " : "padrão"} mapa=${String(c.mapped).padEnd(5)}`

function build(c: Combo, salt: string | undefined) {
  const csv = csvOf(c.free)
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p4.csv", ...(salt ? { accountRefSalt: salt } : {}), ...(c.mapped ? { exitReasonMap: MAP } : {}) })
  const record = run.importRecord as ImportRecord
  const opts = salt ? { accountRefSalt: salt } : undefined
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
  return { bundle, files: { [record.importId]: new TextEncoder().encode(csv) } }
}
/** Declaração à mão (o produtor é o P3). `check === null` omite o saltCheck. */
const declare = (b: Any, saltId: string, check: string | null): Any => {
  const x = clone(b)
  for (const imp of x.evidence.imports) { imp.reproducibility.saltId = saltId; if (check !== null) imp.reproducibility.saltCheck = check }
  return reseal(x)
}
const tamperRef = (b: Any): Any => { const x = clone(b); x.evidence.trades[0].accountRef = `acc_${"0".repeat(24)}`; return reseal(x) }
const ring = (entries: Array<{ saltId: string; salt: string | null }>, userId = "u1") => InMemorySaltKeyring.from(entries.map((e) => ({ userId, ...e })))
const KR = ring([{ saltId: "s1", salt: SALT1 }, { saltId: "s2", salt: SALT2 }])
const vopts = (c: Combo, extra: Partial<VerifySourceOptions> = {}): VerifySourceOptions => ({ ...(c.mapped ? { exitReasonMap: MAP } : {}), ...extra })
const withProv = (c: Combo, provider = KR, userId = "u1"): VerifySourceOptions => vopts(c, { salt: { provider, userId } })
const fails = (r: Any) => r.checks.filter((x: Any) => x.status === "FAIL").map((x: Any) => `${x.id}:${x.code}`)
const codes = (r: Any) => r.checks.filter((x: Any) => x.status !== "PASS").map((x: Any) => x.code)
const lim = (r: Any) => r.limitations.map((l: Any) => l.code)
const COMBINED = ["SOURCE_VERIFIED"]

test("V3 — saltId resolvível, refs e saltCheck corretos ⇒ V0–V6 VALID e SOURCE_VERIFIED em TODAS as combinações (métrica/derivado/linhas × rótulo × mapa × sal s1 e s2); sem limitação de sal", () => {
  const rows: string[] = []
  for (const c of COMBOS) for (const [id, salt] of [["s1", SALT1], ["s2", SALT2]] as const) {
    const { bundle, files } = build(c, salt)
    const b = declare(bundle, id, saltCheck(salt))
    assert.equal(verifyEvidence(b).status, "VALID", nm(c))
    const r = verifyEvidenceSource(b, files, withProv(c))
    assert.equal(r.status, "SOURCE_VERIFIED", `${nm(c)} ${id}: ${JSON.stringify(r.checks.filter((x) => x.status !== "PASS"))}`)
    assert.equal(lim(r).some((l: string) => l.startsWith("L_SALT")), false)
    rows.push(`    ${nm(c)} ${id} → V0–V6 VALID · E5b SOURCE_VERIFIED`)
  }
  console.log(rows.join("\n"))
})

test("V4/O2 — saltId resolvível, refs batem, saltCheck diverge ⇒ SOURCE_VERIFIED_PARTIAL + L_SALT_CHECK_DIVERGENT (NÃO MISMATCH, NÃO UNVERIFIABLE, NÃO SOURCE_VERIFIED limpo)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT1)
    const r = verifyEvidenceSource(declare(bundle, "s1", saltCheck(SALT2)), files, withProv(c))
    assert.equal(r.status, "SOURCE_VERIFIED_PARTIAL", nm(c)); assert.deepEqual(fails(r), [])
    assert.ok(lim(r).includes("L_SALT_CHECK_DIVERGENT"), nm(c))
    assert.ok(r.checks.find((x) => x.id === "V5.context")!.detail.includes("saltCheck"), "o aviso aparece no check de contexto")
  }
})

test("V5 — saltId resolvível, ref adulterado, saltCheck correto ⇒ SOURCE_MISMATCH (sem V_SALT_CHECK_MISMATCH)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT1)
    const r = verifyEvidenceSource(tamperRef(declare(bundle, "s1", saltCheck(SALT1))), files, withProv(c))
    assert.equal(r.status, "SOURCE_MISMATCH", nm(c)); assert.ok(fails(r).length > 0)
    assert.equal(fails(r).some((f: string) => f.includes("V_SALT_CHECK_MISMATCH")), false, nm(c))
  }
})

test("V6 (CONTROLE NEGATIVO OBRIGATÓRIO) — saltId resolvível + saltCheck ADULTERADO + ref ADULTERADO ⇒ SOURCE_MISMATCH reforçado (V_SALT_CHECK_MISMATCH), NUNCA UNVERIFIABLE — o atacante não escolhe a severidade", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT1)
    for (const badCheck of [saltCheck(SALT2), `slt_${"f".repeat(24)}`, `slt_${"0".repeat(24)}`]) {
      const r = verifyEvidenceSource(tamperRef(declare(bundle, "s1", badCheck)), files, withProv(c))
      assert.equal(r.status, "SOURCE_MISMATCH", `${nm(c)} ${badCheck.slice(0, 8)}`)
      assert.notEqual(r.status, "UNVERIFIABLE")
      assert.ok(fails(r).includes("V5.context:V_SALT_CHECK_MISMATCH"), fails(r).join())
      assert.ok(fails(r).some((f: string) => f.startsWith("V5.trades") || f.startsWith("V5.values") || f.startsWith("V5.import-id") || f.startsWith("V5.rows") || f.startsWith("V5.derived")), "a divergência dos refs continua acusada por si")
    }
  }
})

test("V7/V7b — provider sem NENHUM sal para o saltId (e nenhum sal conhecido reproduz os refs) ⇒ UNVERIFIABLE S_SALT_UNKNOWN / S_SALT_RETIRED, sem FAIL; texto diz que NÃO é prova de integridade", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT_X) // gerado com um sal que o provider não conhece
    const unk = verifyEvidenceSource(declare(bundle, "s99", saltCheck(SALT_X)), files, withProv(c))
    assert.equal(unk.status, "UNVERIFIABLE", nm(c)); assert.deepEqual(fails(unk), []); assert.ok(codes(unk).includes("S_SALT_UNKNOWN"))
    assert.match(unk.checks.find((x) => x.id === "V5.context")!.detail, /NÃO é prova de integridade/)
    const ret = verifyEvidenceSource(declare(bundle, "s1", saltCheck(SALT_X)), files, withProv(c, ring([{ saltId: "s1", salt: null }, { saltId: "s2", salt: SALT2 }])))
    assert.equal(ret.status, "UNVERIFIABLE"); assert.deepEqual(fails(ret), []); assert.ok(codes(ret).includes("S_SALT_RETIRED")); assert.equal(codes(ret).includes("S_SALT_UNKNOWN"), false)
  }
})

test("V8/O1 — saltId declarado não resolve MAS outro sal conhecido reproduz os refs ⇒ SOURCE_VERIFIED_PARTIAL + L_SALT_ID_NOT_RESOLVED (declaração errada, dados íntegros)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT2)
    const r = verifyEvidenceSource(declare(bundle, "s99", saltCheck(SALT2)), files, withProv(c))
    assert.equal(r.status, "SOURCE_VERIFIED_PARTIAL", `${nm(c)}: ${JSON.stringify(r.checks.filter((x) => x.status !== "PASS"))}`); assert.deepEqual(fails(r), [])
    assert.ok(lim(r).includes("L_SALT_ID_NOT_RESOLVED"))
    // sal aposentado declarado, outro sal conhecido reproduz
    const r2 = verifyEvidenceSource(declare(bundle, "s1", saltCheck(SALT2)), files, withProv(c, ring([{ saltId: "s1", salt: null }, { saltId: "s2", salt: SALT2 }])))
    assert.equal(r2.status, "SOURCE_VERIFIED_PARTIAL", nm(c)); assert.ok(lim(r2).includes("L_SALT_ID_NOT_RESOLVED"))
  }
})

test("V9/O1 (resíduo documentado) — ref adulterado E saltId trocado para valor desconhecido ⇒ UNVERIFIABLE S_SALT_UNKNOWN, nunca SOURCE_VERIFIED*; é o limite que não dá para eliminar (indistinguível de sal aposentado)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT2)
    const r = verifyEvidenceSource(tamperRef(declare(bundle, "s99", saltCheck(SALT2))), files, withProv(c))
    assert.equal(r.status, "UNVERIFIABLE", nm(c)); assert.ok(codes(r).includes("S_SALT_UNKNOWN"))
    assert.equal(r.status === "SOURCE_VERIFIED" || r.status === "SOURCE_VERIFIED_PARTIAL", false)
    assert.equal(COMBINED.includes(r.status), false)
  }
})

test("V10/D6 — rotação: bundle antigo (s1) e novo (s2) verificam com o chaveiro que tem os dois; ao aposentar o s1 o antigo vira UNVERIFIABLE S_SALT_RETIRED e o novo segue verificado", () => {
  const c: Combo = { free: true, mapped: true, kind: "metric" }
  const old = build(c, SALT1), cur = build(c, SALT2)
  const bOld = declare(old.bundle, "s1", saltCheck(SALT1)), bNew = declare(cur.bundle, "s2", saltCheck(SALT2))
  assert.equal(verifyEvidenceSource(bOld, old.files, withProv(c)).status, "SOURCE_VERIFIED")
  assert.equal(verifyEvidenceSource(bNew, cur.files, withProv(c)).status, "SOURCE_VERIFIED")
  const k = ring([{ saltId: "s1", salt: SALT1 }, { saltId: "s2", salt: SALT2 }]); k.retire("u1", "s1")
  const r = verifyEvidenceSource(bOld, old.files, withProv(c, k))
  assert.equal(r.status, "UNVERIFIABLE"); assert.ok(codes(r).includes("S_SALT_RETIRED")); assert.deepEqual(fails(r), [])
  assert.equal(verifyEvidenceSource(bNew, cur.files, withProv(c, k)).status, "SOURCE_VERIFIED")
})

test("V11/O3 — provider vence a string: saltId resolvível + accountRefSalt diferente ⇒ SOURCE_VERIFIED (a string é ignorada, nunca FAIL por causa dela)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT1)
    const b = declare(bundle, "s1", saltCheck(SALT1))
    assert.equal(verifyEvidenceSource(b, files, { ...withProv(c), accountRefSalt: SALT_X }).status, "SOURCE_VERIFIED", nm(c))
    assert.equal(verifyEvidenceSource(b, files, { ...withProv(c), accountRefSalt: "string-fraca" }).status, "SOURCE_VERIFIED", nm(c))
  }
})

test("V12 — bundle novo salgado SEM provider e SEM string ⇒ UNVERIFIABLE S_ACCOUNT_REF_UNVERIFIED (nunca FAIL); só a string forte correta (sem provider) verifica; string errada ⇒ não verifica", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT1)
    const b = declare(bundle, "s1", saltCheck(SALT1))
    const none = verifyEvidenceSource(b, files, vopts(c))
    assert.equal(none.status, "UNVERIFIABLE", nm(c)); assert.deepEqual(fails(none), []); assert.ok(codes(none).includes("S_ACCOUNT_REF_UNVERIFIED"))
    assert.equal(verifyEvidenceSource(b, files, vopts(c, { accountRefSalt: SALT1 })).status, "SOURCE_VERIFIED", nm(c))
    assert.equal(verifyEvidenceSource(declare(bundle, "s1", saltCheck(SALT2)), files, vopts(c, { accountRefSalt: SALT1 })).status, "SOURCE_VERIFIED_PARTIAL", "string correta + saltCheck divergente")
    assert.notEqual(verifyEvidenceSource(b, files, vopts(c, { accountRefSalt: SALT2 })).status, "SOURCE_VERIFIED", "string errada")
  }
})

test("V14 (caso novo, proposto) — declarar saltId num import que NÃO usou sal ⇒ SOURCE_MISMATCH V_SALT_DECLARATION_INCONSISTENT (contradição estrutural)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, undefined)
    const r = verifyEvidenceSource(declare(bundle, "s1", saltCheck(SALT1)), files, withProv(c))
    assert.equal(r.status, "SOURCE_MISMATCH", nm(c)); assert.ok(fails(r).includes("V5.context:V_SALT_DECLARATION_INCONSISTENT"))
  }
})

test("D7 (legado intacto) — bundle salgado SEM saltId: o provider é ignorado (precisa da string, como sempre); não-salgado inalterado; sem limitação de sal (a lacuna do sal esquecido e a pista seguem cobertas por test-evidence-salt-propagation 3d)", () => {
  for (const c of COMBOS) {
    const { bundle, files } = build(c, SALT1)
    assert.equal(verifyEvidenceSource(bundle, files, vopts(c, { accountRefSalt: SALT1 })).status, "SOURCE_VERIFIED", nm(c))
    const onlyProv = verifyEvidenceSource(bundle, files, withProv(c))
    assert.equal(onlyProv.status, "UNVERIFIABLE", "legado + provider sem string"); assert.deepEqual(fails(onlyProv), [])
    const plain = build(c, undefined)
    assert.equal(verifyEvidenceSource(plain.bundle, plain.files, withProv(c)).status, "SOURCE_VERIFIED", "não-salgado: provider irrelevante")
    assert.equal(lim(verifyEvidenceSource(bundle, files, vopts(c, { accountRefSalt: SALT1 }))).some((l: string) => l.startsWith("L_SALT")), false)
  }
})

test("Isolamento — o provider de OUTRO usuário não resolve o saltId (UNKNOWN) e o sal dele não vira candidato do O1 por engano; sigilo: nenhum relatório contém o valor de qualquer sal", () => {
  const c: Combo = { free: false, mapped: false, kind: "metric" }
  const { bundle, files } = build(c, SALT1)
  const b = declare(bundle, "s1", saltCheck(SALT1))
  const other = ring([{ saltId: "s1", salt: SALT_X }], "u2")
  const r = verifyEvidenceSource(b, files, { salt: { provider: other, userId: "u1" } }) // u1 não existe nesse chaveiro
  assert.equal(r.status, "UNVERIFIABLE"); assert.ok(codes(r).includes("S_SALT_UNKNOWN"))
  const rs = [r, verifyEvidenceSource(b, files, withProv(c)), verifyEvidenceSource(declare(bundle, "s1", saltCheck(SALT2)), files, withProv(c)), verifyEvidenceSource(tamperRef(declare(bundle, "s1", saltCheck(SALT2))), files, withProv(c))]
  for (const rep of rs) for (const s of [SALT1, SALT2, SALT_X]) { const t = JSON.stringify(rep); assert.equal(t.includes(s), false); assert.equal(t.includes(s.slice(0, 16)), false) }
})

console.log(`\n${passed} testes ok`)
