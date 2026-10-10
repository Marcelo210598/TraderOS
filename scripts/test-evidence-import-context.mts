// Evidence — contexto reproduzível da importação (ImportRecord.reproducibility) e seu uso pelo E5b.   node scripts/test-evidence-import-context.mts
// Princípio: o contexto efetivo é REGISTRADO fora do importId; identidades (importId, rowHash, tradeId, tradeSetHash) não mudam; nada de segredo.
import assert from "node:assert/strict"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { explainTrades } from "../src/lib/evidence/explain-trade.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { ImportRefSchema } from "../src/lib/evidence/schema.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { IDENTITY_VERSIONS } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { calculateMetrics, calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const enc = (s: string) => new TextEncoder().encode(s)
const check = (r: ReturnType<typeof verifyEvidenceSource>, id: string) => r.checks.find((c) => c.id === id) as ReturnType<typeof verifyEvidenceSource>["checks"][number]
const edit = (b: EvidenceBundle, fn: (x: Any) => void): Any => {
  const c = clone(b) as Any
  fn(c)
  return { ...c, evidenceHash: computeEvidenceHash(c) }
}

const day = (i: number, h: number, m = 0) => `${String(2 + i).padStart(2, "0")}/03/2026 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const PTS = [3, -2, -2, 4, -1, 2, -3, 1]
const ROWS: SynthRow[] = PTS.map((p, i) => ({ account: i % 2 ? "Conta Alfa Secreta" : "Conta Beta Secreta", entryPrice: 2000, exitPrice: 2000 + p, entryAt: day(i, 9), exitAt: day(i, 10) }))
const BRT = "America/Sao_Paulo"

function build(rows: SynthRow[], ctx: ImportContext = {}) {
  const csv = synthCsv(rows)
  const run = runImportPipeline(csv, { sourceTz: BRT, fileName: "a.csv", ...ctx })
  const record = run.importRecord as ImportRecord
  return { csv, run, record, files: { [record.importId]: enc(csv) } }
}
type B = ReturnType<typeof build>
function bundleOf(b: B, metricId = "netPnl"): EvidenceBundle {
  const T = toAnalyticsTrades(withRisk(b.run.trades))
  const { result, trace } = calculateMetricsTraced(T)
  const r = explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades: T, importRecords: [b.record] })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
/** Simula um import ANTERIOR ao contexto reproduzível: o mesmo registro sem o bloco (não se retro-preenche nada). */
const legacy = (b: B): B => {
  const rec = clone(b.record) as Any
  delete rec.reproducibility
  return { ...b, record: rec }
}

// ── identidades: iguais às do commit anterior (valores literais calculados nele) ───────────────────────────

const PINNED = {
  "linhas": {
    "importId": "imp_d7be866e25c2e691ee989abd8dd42682",
    "tradeIds": [
      "trd_3fe43542d74d58b367e84ddaca09c30a",
      "trd_b9d3a1b0546f8cce4d61696b2ca3e92d",
      "trd_74898abde5035960f29f5abb3d81b277",
      "trd_09fd47ee2359e9afc9ce039c802757bc",
      "trd_d1492bc718cacde8c29e948b732a1cae",
      "trd_1bbdd761360ef87bbbf23f65f3ac8ad2",
      "trd_1f74dd6f7c4174f129589b06097d4d01",
      "trd_f05c85a9930f6dbd77f4bda5f3eb0416"
    ],
    "tradeSetHash": "980529a4d29bef49127cce286997f81127c9f73cf215d1bdaf1f8bec95bc68f9"
  },
  "ciclos": {
    "importId": "imp_d7be866e25c2e691ee989abd8dd42682",
    "tradeIds": [
      "trd_a375e4189324a22b78cf102f40ca107b",
      "trd_36932ca4e0f38c92d53dc6ebf71a7cf3",
      "trd_03d79f3cbe72d04884c0051df468746d",
      "trd_99f7a502d13000161da41cee92d9af1f",
      "trd_70cdcede1af21b6f86bc4c305dbb27b6",
      "trd_e218c51b3efecddd2c3861803537753d",
      "trd_eba6d88c315a159dc416530da44c0e94",
      "trd_606bae2c13fde6c3043fb1332ca9a7ec"
    ],
    "tradeSetHash": "fa92a64c54ad8ac847d65262f0e47a6ad060055366800acf902e3208cda07a5d"
  },
  "salgado": {
    "importId": "imp_d7be866e25c2e691ee989abd8dd42682",
    "tradeIds": [
      "trd_220aba38c00931f72906ce53ec769448",
      "trd_1327302fe133c3cd17ad8f83c98212aa",
      "trd_2c5512e2e4e17865ffc73520dd285a75",
      "trd_30f14b2a5488f52dee8a452287d34ba3",
      "trd_34b0877d1dc4b43336abab1b99ec9fcf",
      "trd_7e79c00c9298f2a7c222d5863c580b16",
      "trd_46b689d2fcc0a0214ef3ee10e5ce023d",
      "trd_1f8478c08b19857d902d26e92c677f02"
    ],
    "tradeSetHash": "dfcf236e3063e175f743954132904035d2d25e4ddafcf4fb452229f96ab3961d"
  }
} as Record<string, { importId: string; tradeIds: string[]; tradeSetHash: string }>

test("NÃO REGRESSÃO: importId, tradeId e tradeSetHash são IDÊNTICOS aos calculados no commit anterior (linhas, ciclos e import com sal); o contexto fica fora do importId", () => {
  for (const [k, ctx] of [["linhas", { reconstructCycles: false }], ["ciclos", {}], ["salgado", { reconstructCycles: false, accountRefSalt: "u1" }]] as const) {
    const b = build(ROWS, ctx as ImportContext)
    assert.equal(b.record.importId, PINNED[k].importId, k)
    assert.deepEqual(b.run.trades.map((t) => t.tradeId), PINNED[k].tradeIds, k)
    assert.equal(calculateMetrics(toAnalyticsTrades(b.run.trades)).population.tradeSetHash, PINNED[k].tradeSetHash, k)
  }
})

// ── registro ─────────────────────────────────────────────────────────────────

test("REGISTRO: o import novo grava versões de identidade, foldPolicy efetivo, exitReasonMap normalizado (na ORDEM) e se houve sal — nunca o sal", () => {
  const plain = build(ROWS, { reconstructCycles: false })
  assert.deepEqual(plain.record.reproducibility, { version: 1, identity: { ...IDENTITY_VERSIONS }, foldPolicy: "EARLIER", exitReasonMap: [], accountRefSalted: false })
  assert.deepEqual(IDENTITY_VERSIONS, { importId: 1, rowHash: 1, tradeId: 1, accountRef: "meutrade/accountRef/1" })
  const map = [{ pattern: "^zz", reason: "MANUAL" as const }, { pattern: "^aa", reason: "STOP" as const }]
  const full = build(ROWS, { foldPolicy: "LATER", exitReasonMap: map, accountRefSalt: "segredo-do-usuario-42" })
  assert.deepEqual(full.record.reproducibility, { version: 1, identity: { ...IDENTITY_VERSIONS }, foldPolicy: "LATER", exitReasonMap: map, accountRefSalted: true })
  assert.deepEqual(full.record.reproducibility?.exitReasonMap.map((r) => r.pattern), ["^zz", "^aa"], "ordem preservada (a primeira que casa vence)")
  for (const b of [plain, full]) {
    const bundle = bundleOf(b)
    for (const text of [JSON.stringify(b.record), JSON.stringify(bundle), JSON.stringify(b.run)]) assert.equal(text.includes("segredo-do-usuario-42"), false, "o sal não pode aparecer em lugar nenhum")
    assert.deepEqual(bundle.evidence.imports[0].reproducibility, b.record.reproducibility)
  }
  // o sal muda rowHash/tradeId (comportamento existente), mas NÃO o importId; foldPolicy/exitReasonMap sozinhos não mudam nenhum id
  const other = build(ROWS, { foldPolicy: "LATER", exitReasonMap: map })
  assert.equal(other.record.importId, plain.record.importId)
  assert.deepEqual(other.run.trades.map((t) => t.tradeId), build(ROWS, {}).run.trades.map((t) => t.tradeId))
})

test("COMPATIBILIDADE: import ANTERIOR (sem o bloco) continua válido no schema, no explainTrade e no verifyEvidence; nada é retro-preenchido; E5b o verifica como antes e diz que o contexto não foi registrado", () => {
  const b = legacy(build(ROWS, { reconstructCycles: false }))
  assert.equal("reproducibility" in b.record, false)
  const bundle = bundleOf(b)
  assert.equal("reproducibility" in bundle.evidence.imports[0], false)
  assert.equal(ImportRefSchema.safeParse(bundle.evidence.imports[0]).success, true)
  assert.equal(verifyEvidence(bundle).status, "VALID")
  const rep = verifyEvidenceSource(bundle, b.files)
  assert.equal(rep.status, "SOURCE_VERIFIED")
  assert.match(check(rep, "V5.context").detail, /ANTERIOR ao contexto reproduzível/)
  assert.equal(rep.coverage?.imports.contextRecorded, 0)
  // sem o bloco, foldPolicy/sal vêm do chamador (comportamento do E5b original)
  const salted = legacy(build(ROWS, { reconstructCycles: false, accountRefSalt: "u1" }))
  assert.equal(verifyEvidenceSource(bundleOf(salted), salted.files, { accountRefSalt: "u1" }).status, "SOURCE_VERIFIED")
  assert.equal(verifyEvidenceSource(bundleOf(salted), salted.files).status, "UNVERIFIABLE")
})

// ── E5b com contexto registrado ──────────────────────────────────────────────

test("E5b REPRODUZ SOZINHO o que foi registrado: foldPolicy LATER + exitReasonMap + sal-sim ⇒ SOURCE_VERIFIED só com o sal; opções do chamador conflitantes são ignoradas", () => {
  // 01/11/2026 01:30 em America/New_York é horário AMBÍGUO (fim do horário de verão): EARLIER ≠ LATER no instante UTC (e no rowHash)
  const fold: SynthRow[] = [
    { account: "Sim101", entryPrice: 2000, exitPrice: 2004, entryAt: "01/11/2026 01:30:00", exitAt: "01/11/2026 03:00:00" },
    { account: "Sim101", entryPrice: 2000, exitPrice: 1998, entryAt: "02/11/2026 09:00:00", exitAt: "02/11/2026 10:00:00" },
  ]
  const mk = (policy: "EARLIER" | "LATER") => build(fold, { sourceTz: "America/New_York", foldPolicy: policy, reconstructCycles: false, accountRefSalt: "u1", exitReasonMap: [{ pattern: "^target", reason: "MANUAL" }] })
  const early = mk("EARLIER")
  const late = mk("LATER")
  assert.notEqual(early.run.trades[0].tradeId, late.run.trades[0].tradeId, "o foldPolicy muda o instante, o rowHash e o tradeId")
  assert.equal(early.record.importId, late.record.importId, "…mas não o importId (por isso precisa ser REGISTRADO)")
  for (const b of [early, late]) {
    const bundle = bundleOf(b)
    const rep = verifyEvidenceSource(bundle, b.files, { accountRefSalt: "u1" }) // sem foldPolicy/exitReasonMap: vêm do registro
    assert.equal(rep.status, "SOURCE_VERIFIED", JSON.stringify(rep.checks.filter((c) => c.status !== "PASS")))
    assert.match(check(rep, "V5.context").detail, /contexto REGISTRADO/)
    assert.equal(rep.coverage?.imports.contextRecorded, 1)
    // o chamador tenta impor o outro foldPolicy e outro mapa: o registro manda
    const conflicting = verifyEvidenceSource(bundle, b.files, { accountRefSalt: "u1", foldPolicy: b === early ? "LATER" : "EARLIER", exitReasonMap: [{ pattern: ".*", reason: "STOP" }] })
    assert.equal(conflicting.status, "SOURCE_VERIFIED")
  }
  // import ANTERIOR ao registro com fold ambíguo e foldPolicy não-padrão: sem o dado, o padrão EARLIER diverge — e dizer o foldPolicy certo resolve
  const old = legacy(late)
  const mismatch = verifyEvidenceSource(bundleOf(old), old.files, { accountRefSalt: "u1" })
  assert.equal(mismatch.status, "SOURCE_MISMATCH")
  assert.equal(verifyEvidenceSource(bundleOf(old), old.files, { accountRefSalt: "u1", foldPolicy: "LATER", exitReasonMap: [{ pattern: "^target", reason: "MANUAL" }] }).status, "SOURCE_VERIFIED")
})

test("SAL: registro diz 'com sal' e nenhum foi informado ⇒ UNVERIFIABLE (arquivo e importId conferidos); sal errado ⇒ UNVERIFIABLE; registro 'sem sal' ignora sal informado; o valor nunca vai ao relatório", () => {
  const salted = build(ROWS, { reconstructCycles: false, accountRefSalt: "u1" })
  const bundle = bundleOf(salted)
  const none = verifyEvidenceSource(bundle, salted.files)
  assert.equal(none.status, "UNVERIFIABLE")
  assert.equal(check(none, "V5.rows").code, "S_ACCOUNT_REF_UNVERIFIED")
  assert.match(check(none, "V5.rows").detail, /accountRefSalted/)
  assert.equal(check(none, "V5.file").status, "PASS")
  assert.equal(check(none, "V5.import-id").status, "PASS")
  assert.equal(verifyEvidenceSource(bundle, salted.files, { accountRefSalt: "errado" }).status, "UNVERIFIABLE")
  assert.equal(verifyEvidenceSource(bundle, salted.files, { accountRefSalt: "u1" }).status, "SOURCE_VERIFIED")
  const plain = build(ROWS, { reconstructCycles: false })
  const ok = verifyEvidenceSource(bundleOf(plain), plain.files, { accountRefSalt: "qualquer-coisa" })
  assert.equal(ok.status, "SOURCE_VERIFIED")
  assert.match(check(ok, "V5.context").detail, /sal informado foi ignorado/)
  assert.equal(JSON.stringify([none, ok]).includes("qualquer-coisa"), false)
  assert.equal(JSON.stringify(none).includes("errado"), false)
})

test("VERSÃO DE IDENTIDADE diferente da atual ⇒ UNVERIFIABLE (S_VERSION_INCOMPATIBLE, não adulteração); reproducibility adulterada é detectada ou recusada", () => {
  const b = build(ROWS, { reconstructCycles: false })
  const bundle = bundleOf(b)
  for (const k of ["importId", "rowHash", "tradeId"] as const) {
    const rep = verifyEvidenceSource(edit(bundle, (x) => (x.evidence.imports[0].reproducibility.identity[k] = 2)), b.files)
    assert.equal(rep.status, "UNVERIFIABLE", k)
    assert.equal(check(rep, "V5.context").code, "S_VERSION_INCOMPATIBLE")
    assert.match(check(rep, "V5.context").detail, /não é adulteração/)
    assert.equal(check(rep, "V5.file").status, "PASS")
  }
  assert.equal(check(verifyEvidenceSource(edit(bundle, (x) => (x.evidence.imports[0].reproducibility.identity.accountRef = "meutrade/accountRef/2")), b.files), "V5.context").code, "S_VERSION_INCOMPATIBLE")
  // 'sem sal' trocado para 'com sal' num import sem sal: sem o valor não dá para verificar ⇒ UNVERIFIABLE
  assert.equal(verifyEvidenceSource(edit(bundle, (x) => (x.evidence.imports[0].reproducibility.accountRefSalted = true)), b.files).status, "UNVERIFIABLE")
  // 'com sal' trocado para 'sem sal' num import salgado: o sal informado é ignorado, as contas divergem em todos os trades ⇒ UNVERIFIABLE (nunca SOURCE_VERIFIED)
  const salted = build(ROWS, { reconstructCycles: false, accountRefSalt: "u1" })
  const flipped = verifyEvidenceSource(edit(bundleOf(salted), (x) => (x.evidence.imports[0].reproducibility.accountRefSalted = false)), salted.files, { accountRefSalt: "u1" })
  assert.notEqual(flipped.status, "SOURCE_VERIFIED")
  // exitReasonMap adulterado: a reingestão usa o registrado, mas os motivos de saída do TradeEvidence deixam de bater
  // (em CICLOS o motivo de saída está nas pernas da Evidence; em trades-linha o mapa não aparece em nenhum valor afirmado, então adulterá-lo é imaterial)
  const mapped = build(ROWS, { exitReasonMap: [{ pattern: "^target", reason: "MANUAL" }] })
  assert.ok(mapped.run.trades.some((t) => t.exitLegs?.some((l) => l.reason === "MANUAL")))
  const forged = verifyEvidenceSource(edit(bundleOf(mapped), (x) => (x.evidence.imports[0].reproducibility.exitReasonMap = [])), mapped.files)
  assert.equal(forged.status, "SOURCE_MISMATCH")
  assert.equal(check(forged, "V5.values").code, "V_TRADE_VALUES_MISMATCH")
  assert.equal(verifyEvidenceSource(bundleOf(mapped), mapped.files).status, "SOURCE_VERIFIED") // íntegro: o registro reproduz as pernas
  // campo desconhecido / valor inválido ⇒ formato
  assert.equal(verifyEvidenceSource(edit(bundle, (x) => (x.evidence.imports[0].reproducibility.accountRefSalt = "x")), b.files).status, "INVALID_FORMAT")
  assert.equal(verifyEvidenceSource(edit(bundle, (x) => (x.evidence.imports[0].reproducibility.foldPolicy = "NUNCA")), b.files).status, "INVALID_FORMAT")
  assert.equal(verifyEvidence(edit(bundle, (x) => (x.evidence.imports[0].reproducibility.accountRefSalt = "x"))).status, "INVALID_FORMAT")
})

test("PRIVACIDADE: o mapa de saída com nome de conta é recusado pela trava fail-closed da Evidence; o registro nunca carrega conta nem sal", () => {
  const leaky = build(ROWS, { reconstructCycles: false, exitReasonMap: [{ pattern: "^conta alfa secreta", reason: "MANUAL" }] })
  const r = explainTrades(leaky.run.trades, leaky.record)
  assert.ok(r.some((x) => !x.ok && x.code === "E_ACCOUNT_NAME_LEAK"), "a trava deve recusar")
  const clean = build(ROWS, { reconstructCycles: false, accountRefSalt: "u1" })
  const text = JSON.stringify(bundleOf(clean))
  for (const s of ["Conta Alfa Secreta", "Conta Beta Secreta", "u1\""]) assert.equal(text.includes(s), false, s)
  // determinismo do registro
  assert.equal(canonicalJson(build(ROWS, {}).record.reproducibility), canonicalJson(build(ROWS, {}).record.reproducibility))
})

console.log(`\n${passed} testes ok`)
