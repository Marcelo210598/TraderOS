// S2b + S4b do plano do sourceLabel (decisão C): o mapa de motivos do USUÁRIO sai da Evidence como `patternRef`; o E5b exige o mapa do chamador.
//   node scripts/test-evidence-sourcelabel-s4b.mts
// Roda de VERDADE os 4 casos previstos em scripts/expectations/sourcelabel.expected.json (escritos ANTES do código) e imprime a tabela.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource, type SourceVerifyReport } from "../src/lib/evidence/verify-source.ts"
import { patternRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp = JSON.parse(readFileSync(join(ROOT, "scripts/expectations/sourcelabel.expected.json"), "utf8")) as Any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const J = JSON.stringify
const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
type Combined = "VERIFIED" | "VERIFIED_PARTIAL" | "NOT_VERIFIED" | "TAMPERED_OR_MISMATCH"
/** Mesma semântica de referência do teste-guarda (plano E6/G6 §6.1 item 4). */
const combined = (verify: string, source: string): Combined => {
  if (verify === "TAMPERED" || verify === "INVALID_FORMAT" || source === "SOURCE_MISMATCH" || source === "INVALID_FORMAT") return "TAMPERED_OR_MISMATCH"
  if (verify === "VALID" && source === "SOURCE_VERIFIED") return "VERIFIED"
  if (verify === "VALID" && source === "SOURCE_VERIFIED_PARTIAL") return "VERIFIED_PARTIAL"
  return "NOT_VERIFIED"
}
const d = (day: number, hms: string) => `${String(day).padStart(2, "0")}/03/2026 ${hms}`
// rótulos de saída em texto LIVRE do usuário (inventados): só o mapa do usuário os classifica
const ROWS: SynthRow[] = [
  { entryPrice: 2000, exitPrice: 1996, entryAt: d(2, "09:00:00"), exitAt: d(2, "09:10:00"), exitLabel: "meu stop 1" },
  { entryPrice: 2000, exitPrice: 2004, entryAt: d(3, "09:00:00"), exitAt: d(3, "09:10:00"), exitLabel: "minha saida boa" },
  { entryPrice: 2000, exitPrice: 2002, entryAt: d(4, "09:00:00"), exitAt: d(4, "09:10:00"), exitLabel: "Target1" },
]
const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }, { pattern: "^minha saida", reason: "TARGET" as const }]
const csv = synthCsv(ROWS)
function make(ctx: ImportContext, salt?: string) {
  const run = runImportPipeline(csv, { sourceTz: BRT, fileName: "mapa.csv", ...ctx })
  const record = run.importRecord as ImportRecord
  const T = toAnalyticsTrades(run.trades)
  const t = calculateMetricsTraced(T, { timeZone: BRT })
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...(salt !== undefined ? { opts: { accountRefSalt: salt } } : {}) })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return { run, record, bundle: metricEvidenceBundle(r as Any) as Any, files: { [record.importId]: new TextEncoder().encode(csv) } }
}
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const fails = (r: SourceVerifyReport) => r.checks.some((c) => c.status === "FAIL")
const ctxCode = (r: SourceVerifyReport) => r.checks.find((c) => c.id === "V5.context")!.code

const EMPTY = make({})
const MAPPED = make({ exitReasonMap: MAP })

test("PREMISSA: sem o mapa os rótulos livres são UNKNOWN; com o mapa o motivo é STOP/TARGET (USER_MAP) — o mapa é o que torna o motivo reproduzível", () => {
  const reasons = (b: typeof MAPPED) => b.run.trades.flatMap((t) => t.exitLegs ?? []).map((l) => [l.reason, l.reasonRule])
  assert.deepEqual(reasons(EMPTY), [["UNKNOWN", "NONE"], ["UNKNOWN", "NONE"], ["TARGET", "LABEL_RULE"]])
  assert.deepEqual(reasons(MAPPED), [["STOP", "USER_MAP"], ["TARGET", "USER_MAP"], ["TARGET", "LABEL_RULE"]])
})

test("S2b: o ImportRef carrega `patternRef` (pat_<24 hex>) + motivo, NA ORDEM, e nunca o texto do regex; mapa vazio continua []; schema recusa a chave `pattern`", () => {
  const e = exp.exitReasonMap_C
  assert.deepEqual(EMPTY.bundle.evidence.imports[0].reproducibility.exitReasonMap, [])
  const m = MAPPED.bundle.evidence.imports[0].reproducibility.exitReasonMap
  assert.deepEqual(m, MAP.map((x) => ({ patternRef: patternRef(x.pattern), reason: x.reason })))
  for (const x of m) { assert.match(x.patternRef, new RegExp(e.patternRef.format)); assert.equal("pattern" in x, false) }
  for (const s of ["^meu stop", "^minha saida", "meu stop", "minha saida boa"]) assert.equal(J(MAPPED.bundle).includes(s), false, `regex/rótulo vazou: ${s}`)
  assert.equal(e.import_with_user_map.regex_text_anywhere_in_bundle, false)
  // a chave `pattern` (regex em claro) injetada, ou patternRef malformado, com selo refeito ⇒ INVALID_FORMAT
  const withPattern = clone(MAPPED.bundle); withPattern.evidence.imports[0].reproducibility.exitReasonMap[0].pattern = "^meu stop"
  assert.equal(verifyEvidence(reseal(withPattern)).status, "INVALID_FORMAT")
  const asText = clone(MAPPED.bundle); asText.evidence.imports[0].reproducibility.exitReasonMap[0].patternRef = "^meu stop"
  assert.equal(verifyEvidence(reseal(asText)).status, "INVALID_FORMAT")
  assert.equal(verifyEvidence(MAPPED.bundle).status, "VALID")
  // domínio próprio e sal: o mesmo texto não gera o mesmo hex de outro ref; o sal muda o patternRef
  assert.notEqual(patternRef("^meu stop"), patternRef("^meu stop", "sal"))
  assert.equal(patternRef("^meu stop"), patternRef("^meu stop"))
  assert.notEqual(patternRef("^MEU STOP"), patternRef("^meu stop"), "o regex é sensível à caixa: não se normaliza")
})

test("TABELA DOS 4 CASOS (S4b) RODADA CONTRA CÓDIGO REAL — resultado esperado (escrito antes) × obtido", () => {
  const g = exp.guard_no_solo_verdict.S4b_cases
  const run = (name: string, b: typeof EMPTY, opts: Any) => {
    const v = verifyEvidence(b.bundle)
    const s = verifyEvidenceSource(b.bundle, b.files, opts)
    return { name, verify: v.status, source: s.status, code: ctxCode(s), fail: fails(s), combined: combined(v.status, s.status) }
  }
  const rows = [
    { key: "empty_map", ...run("mapa vazio (import sem mapa)", EMPTY, {}) },
    { key: "user_map_not_supplied", ...run("mapa do usuário AUSENTE", MAPPED, {}) },
    { key: "user_map_wrong", ...run("mapa do usuário DIVERGENTE (outro regex)", MAPPED, { exitReasonMap: [{ pattern: "^errado", reason: "STOP" }, { pattern: "^minha saida", reason: "TARGET" }] }) },
    { key: "user_map_correct", ...run("mapa do usuário CORRETO", MAPPED, { exitReasonMap: MAP }) },
  ]
  const line = (r: Any, w: Any) => `    ${r.name.padEnd(42)} verify=${r.verify.padEnd(6)} source=${r.source.padEnd(15)} V5.context=${String(r.code ?? "PASS").padEnd(22)} FAIL=${String(r.fail).padEnd(5)} combinado=${r.combined.padEnd(12)} | esperado: source=${w.source} ${w.code ?? ""} combinado=${w.combined}`
  console.log(rows.map((r) => line(r, g[r.key])).join("\n"))
  for (const r of rows) {
    const w = g[r.key]
    assert.equal(r.verify, w.verify, `${r.key}: verify`)
    assert.equal(r.source, w.source, `${r.key}: source`)
    assert.equal(r.combined, w.combined, `${r.key}: combinado`)
    if (w.code) assert.equal(r.code, w.code, `${r.key}: código`)
    if (w.has_FAIL !== undefined) assert.equal(r.fail, w.has_FAIL, `${r.key}: FAIL`)
    assert.equal(r.fail, false, `${r.key}: indisponibilidade/mapa nunca é adulteração`)
  }
})

test("VARIAÇÕES DO MAPA: ordem trocada, regra a mais/a menos, motivo diferente, caixa diferente ⇒ UNVERIFIABLE (S_CONTEXT_INSUFFICIENT), nunca FAIL; mapa informado a import SEM mapa é ignorado", () => {
  const bad: Array<[string, Any]> = [
    ["ordem trocada", [MAP[1], MAP[0]]],
    ["uma regra a menos", [MAP[0]]],
    ["uma regra a mais", [...MAP, { pattern: "^x", reason: "MANUAL" }]],
    ["motivo diferente", [{ pattern: MAP[0].pattern, reason: "MANUAL" }, MAP[1]]],
    ["caixa diferente", [{ pattern: "^MEU STOP", reason: "STOP" }, MAP[1]]],
    ["vazio", []],
  ]
  for (const [n, m] of bad) {
    const r = verifyEvidenceSource(MAPPED.bundle, MAPPED.files, { exitReasonMap: m })
    assert.equal(r.status, "UNVERIFIABLE", n)
    assert.equal(ctxCode(r), "S_CONTEXT_INSUFFICIENT", n)
    assert.equal(fails(r), false, n)
  }
  // o registro de um import SEM mapa manda: mapa informado é ignorado (comportamento do E5b com `reproducibility`, inalterado)
  assert.equal(verifyEvidenceSource(EMPTY.bundle, EMPTY.files, { exitReasonMap: MAP }).status, "SOURCE_VERIFIED")
})

test("ADULTERAÇÃO NO PATTERNREF: patternRef trocado por outro bem formado (selo refeito) ⇒ o mapa correto deixa de bater ⇒ UNVERIFIABLE (não FAIL); motivo do mapa trocado no registro ⇒ idem; remover o mapa do registro ⇒ SOURCE_MISMATCH nos motivos (o V5.values denuncia)", () => {
  const swap = clone(MAPPED.bundle); swap.evidence.imports[0].reproducibility.exitReasonMap[0].patternRef = `pat_${"0".repeat(24)}`
  const r1 = verifyEvidenceSource(reseal(swap), MAPPED.files, { exitReasonMap: MAP })
  assert.equal(r1.status, "UNVERIFIABLE"); assert.equal(ctxCode(r1), "S_CONTEXT_INSUFFICIENT"); assert.equal(fails(r1), false)
  const reason = clone(MAPPED.bundle); reason.evidence.imports[0].reproducibility.exitReasonMap[0].reason = "MANUAL"
  const r2 = verifyEvidenceSource(reseal(reason), MAPPED.files, { exitReasonMap: MAP })
  assert.equal(r2.status, "UNVERIFIABLE")
  const dropped = clone(MAPPED.bundle); dropped.evidence.imports[0].reproducibility.exitReasonMap = []
  const r3 = verifyEvidenceSource(reseal(dropped), MAPPED.files, {})
  assert.equal(r3.status, "SOURCE_MISMATCH", "sem o mapa a reingestão classifica UNKNOWN e os motivos do bundle não batem")
  assert.equal(r3.checks.find((c) => c.id === "V5.values")!.code, "V_TRADE_VALUES_MISMATCH")
})

test("SAL + MAPA: import com sal e mapa ⇒ sem sal informado UNVERIFIABLE (S_ACCOUNT_REF_UNVERIFIED); com sal e mapa corretos SOURCE_VERIFIED; sal certo + mapa errado UNVERIFIABLE; o sal e o regex nunca vão ao bundle", () => {
  const SALT = "sal-do-usuario-9"
  const S = make({ exitReasonMap: MAP, accountRefSalt: SALT }, SALT)
  assert.equal(J(S.bundle).includes(SALT), false)
  assert.equal(J(S.bundle).includes("^meu stop"), false)
  assert.notDeepEqual(S.bundle.evidence.imports[0].reproducibility.exitReasonMap, MAPPED.bundle.evidence.imports[0].reproducibility.exitReasonMap, "o sal muda o patternRef")
  const none = verifyEvidenceSource(S.bundle, S.files, { exitReasonMap: MAP })
  assert.equal(none.status, "UNVERIFIABLE"); assert.equal(ctxCode(none), "S_ACCOUNT_REF_UNVERIFIED"); assert.equal(fails(none), false)
  assert.equal(verifyEvidenceSource(S.bundle, S.files, { accountRefSalt: SALT, exitReasonMap: MAP }).status, "SOURCE_VERIFIED")
  const wrongMap = verifyEvidenceSource(S.bundle, S.files, { accountRefSalt: SALT, exitReasonMap: [MAP[1], MAP[0]] })
  assert.equal(wrongMap.status, "UNVERIFIABLE"); assert.equal(fails(wrongMap), false)
  const wrongSalt = verifyEvidenceSource(S.bundle, S.files, { accountRefSalt: "outro", exitReasonMap: MAP })
  assert.equal(fails(wrongSalt), false); assert.notEqual(wrongSalt.status, "SOURCE_VERIFIED")
  assert.equal(verifyEvidence(S.bundle).status, "VALID")
})

test("IMPORT ANTERIOR (sem `reproducibility`): o mapa do chamador continua valendo como antes (compatibilidade); mapa vazio inalterado", () => {
  const legacy = clone(MAPPED.bundle); delete legacy.evidence.imports[0].reproducibility
  const files = MAPPED.files
  assert.equal(verifyEvidenceSource(reseal(legacy), files, { exitReasonMap: MAP }).status, "SOURCE_VERIFIED")
  assert.notEqual(verifyEvidenceSource(reseal(legacy), files, {}).status, "SOURCE_VERIFIED", "sem o mapa os motivos não batem")
})

test("GUARDA DO VEREDITO COMBINADO: os casos do mapa foram executados aqui e o arquivo de expectativa do guarda os cobre (mapa ausente/divergente = NOT_VERIFIED sem FAIL)", () => {
  const guard = readFileSync(join(ROOT, "scripts/test-evidence-no-solo-verdict.mts"), "utf8")
  assert.match(guard, /test-evidence-sourcelabel-s4b\.mts/, "o guarda aponta para a execução real")
  const g = exp.guard_no_solo_verdict.S4b_cases
  assert.equal(g.user_map_not_supplied.combined, "NOT_VERIFIED")
  assert.equal(g.user_map_wrong.combined, "NOT_VERIFIED")
  assert.equal(combined("VALID", "UNVERIFIABLE"), "NOT_VERIFIED")
})

console.log(`\n${passed} testes ok`)
