// Evidence E5b — verifyEvidenceSource: proveniência contra o CSV ORIGINAL (bytes).   node scripts/test-evidence-source.mts
// Sintético: oráculo = o arquivo construído pelo teste (valores inventados). Fixtures reais: locais/ignoradas, sem números embutidos.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle, type MetricSource } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { SOURCE_CHECK_CATALOG, verifyEvidenceSource, type SourceVerifyReport } from "../src/lib/evidence/verify-source.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { parseDelimited } from "../src/lib/ingest/csv.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { ninjaTraderPtBr } from "../src/lib/ingest/parsers/ninjatrader-ptbr.ts"
import { DEFAULT_PARSERS } from "../src/lib/ingest/registry.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { METRIC_IDS, aggregateTradesTraced, calculateMetrics, calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

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
const enc = (s: string) => new TextEncoder().encode(s)
const BOM = new Uint8Array([0xef, 0xbb, 0xbf])
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const x of xs) { out.set(x, o); o += x.length }
  return out
}
const check = (r: SourceVerifyReport, id: string) => {
  const c = r.checks.find((x) => x.id === id)
  assert.ok(c, `check ${id} ausente`)
  return c
}
const codes = (r: SourceVerifyReport) => r.checks.filter((c) => c.status !== "PASS").map((c) => `${c.id}:${c.code}`)
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const edit = (b: EvidenceBundle, fn: (x: Any) => void): Any => {
  const c = clone(b) as Any
  fn(c)
  return reseal(c)
}

// ── dados sintéticos ─────────────────────────────────────────────────────────

const day = (i: number, h: number, m = 0) => `${String(2 + i).padStart(2, "0")}/03/2026 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const PTS = [3, -2, -2, 4, -1, 2, -3, 1]
const baseRows = (account: (i: number) => string = (i) => (i % 2 ? "Conta Alfa Secreta" : "Conta Beta Secreta")): SynthRow[] =>
  PTS.map((p, i) => ({ account: account(i), entryPrice: 2000, exitPrice: 2000 + p, entryAt: day(i, 9), exitAt: day(i, 10) }))
/** Duas linhas sobrepostas (mesma conta/estratégia) ⇒ UM ciclo com 2 linhas de origem; mais linhas independentes. */
const cycleRows = (): SynthRow[] => [
  { account: "Sim101", entryPrice: 2000, exitPrice: 2003, entryAt: day(0, 9), exitAt: day(0, 10) },
  { account: "Sim101", entryPrice: 2001, exitPrice: 2004, entryAt: day(0, 9, 30), exitAt: day(0, 10, 30) },
  ...PTS.slice(0, 5).map((p, i) => ({ account: "Sim101", entryPrice: 2000, exitPrice: 2000 + p, entryAt: day(i + 1, 9), exitAt: day(i + 1, 10) })),
]

interface Built { csv: string; run: ReturnType<typeof runImportPipeline>; record: ImportRecord; bytes: Uint8Array; files: Record<string, Uint8Array> }
function build(rows: SynthRow[], opts: { cycles?: boolean; salt?: string; tz?: string | null; csvTransform?: (s: string) => string } = {}): Built {
  const csv = (opts.csvTransform ?? ((s) => s))(synthCsv(rows))
  const ctx: ImportContext = { ...(opts.tz === null ? {} : { sourceTz: opts.tz ?? BRT }), fileName: "arquivo.csv", ...(opts.cycles === false ? { reconstructCycles: false } : {}), ...(opts.salt !== undefined ? { accountRefSalt: opts.salt } : {}) }
  const run = runImportPipeline(csv, ctx)
  const record = run.importRecord as ImportRecord
  const bytes = enc(csv)
  return { csv, run, record, bytes, files: { [record.importId]: bytes } }
}
function bundleOf(b: Built, metricId: string, args: Parameters<typeof calculateMetricsTraced>[1] = {}, risk = true): EvidenceBundle {
  const T = toAnalyticsTrades(risk ? withRisk(b.run.trades) : b.run.trades)
  const { result, trace } = calculateMetricsTraced(T, args)
  const r = explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades: T, importRecords: [b.record] })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
const verify = (bundle: unknown, b: Built, opts: Parameters<typeof verifyEvidenceSource>[2] = {}, files: Record<string, Uint8Array> = b.files) => verifyEvidenceSource(bundle, files, opts)

const LINES = build(baseRows(), { cycles: false })
const CYCLES = build(cycleRows())
assert.ok(CYCLES.run.trades.some((t) => (t.sourceRows?.length ?? 0) === 2), "o conjunto precisa ter um ciclo de 2 linhas")
assert.equal(LINES.run.trades.length, PTS.length)

// ── 1. caminho feliz ─────────────────────────────────────────────────────────

test("1. ARQUIVO ORIGINAL CORRETO: ciclos e trades-linha ⇒ SOURCE_VERIFIED, todos os checks PASS, cobertura exata", () => {
  for (const [name, b, n] of [["ciclos", CYCLES, CYCLES.run.trades.length], ["linhas", LINES, LINES.run.trades.length]] as const) {
    for (const id of ["netPnl", "winners", "maxDrawdown", "maxDrawdownR"]) {
      const bundle = bundleOf(b, id)
      const rep = verify(bundle, b)
      assert.equal(rep.status, "SOURCE_VERIFIED", `${name}/${id}: ${JSON.stringify(rep.checks.filter((c) => c.status !== "PASS"))}`)
      assert.deepEqual(rep.checks.map((c) => c.id), SOURCE_CHECK_CATALOG.map((c) => c.id))
      // V5.derived (E6.3→E5b) não se aplica a bundle sem derivados: S_NOT_APPLICABLE, nunca PASS vazio. Cobertura EXATA (não "ou"):
      // os 8 checks que já existiam continuam TODOS PASS e o novo é exatamente NOT_APPLICABLE — nenhuma folga para outro check mudar de estado.
      assert.deepEqual(rep.checks.filter((c) => c.id !== "V5.derived").map((c) => c.status), Array(8).fill("PASS"), `${name}/${id}`)
      assert.deepEqual(rep.checks.filter((c) => c.id === "V5.derived").map((c) => [c.status, c.code]), [["SKIPPED", "S_NOT_APPLICABLE"]], `${name}/${id}`)
      assert.equal(rep.coverage?.derived.total, 0)
      assert.equal(rep.evidenceHash, bundle.evidenceHash)
      assert.deepEqual(rep.coverage?.imports, { declared: 1, sourceProvided: 1, fileVerified: 1, reingested: 1, contextRecorded: 1 })
      assert.equal(rep.coverage?.trades.referenced, rep.coverage?.trades.verified)
      assert.equal(rep.coverage?.rows.referenced, rep.coverage?.rows.verified)
      assert.equal(rep.coverage?.populations.complete, true)
      assert.equal(verifyEvidence(bundle).status, "VALID") // as duas verificações são independentes e concordam
    }
    assert.equal(verify(bundleOf(b, "netPnl"), b).coverage?.trades.referenced, n)
  }
  // o ciclo de 2 linhas: 2 linhas citadas por 1 trade
  const rep = verify(bundleOf(CYCLES, "netPnl"), CYCLES)
  assert.equal(rep.coverage?.rows.referenced, 7)
  assert.equal(rep.coverage?.trades.referenced, 6)
  assert.equal(rep.limitations.length, 5)
})

// ── 2–5. o arquivo ───────────────────────────────────────────────────────────

test("2. UM BYTE ALTERADO ⇒ SOURCE_MISMATCH em V5.file (V_FILE_MISMATCH); o resto não é executado como se o arquivo fosse o original", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const bytes = LINES.bytes.slice()
  const at = bytes.indexOf("$".charCodeAt(0)) + 3 // um dígito dentro de um valor
  bytes[at] = bytes[at] === 0x39 ? 0x38 : bytes[at] + 1
  const rep = verify(bundle, LINES, {}, { [LINES.record.importId]: bytes })
  assert.equal(rep.status, "SOURCE_MISMATCH")
  assert.equal(check(rep, "V5.file").code, "V_FILE_MISMATCH")
  assert.match(check(rep, "V5.file").detail, /SHA-256 do arquivo [0-9a-f]{12}… ≠ registrado/)
  assert.doesNotMatch(check(rep, "V5.file").detail, /tamanho|BOM|quebra/) // só o hash diverge: mesmo tamanho
  for (const id of ["V5.context", "V5.import-id", "V5.rows", "V5.trades", "V5.values"]) assert.equal(check(rep, id).code, "S_FILE_NOT_VERIFIED", id)
  assert.equal(rep.coverage?.imports.fileVerified, 0)
})

test("3. QUEBRA DE LINHA ALTERADA (LF→CRLF e CRLF→LF) ⇒ V_FILE_MISMATCH com tamanho e quebra de linha no motivo", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const crlf = enc(LINES.csv.replace(/\n/g, "\r\n"))
  const rep = verify(bundle, LINES, {}, { [LINES.record.importId]: crlf })
  assert.equal(rep.status, "SOURCE_MISMATCH")
  assert.equal(check(rep, "V5.file").code, "V_FILE_MISMATCH")
  assert.match(check(rep, "V5.file").detail, /tamanho \d+ bytes ≠ registrado \d+/)
  assert.match(check(rep, "V5.file").detail, /quebra de linha CRLF ≠ registrada LF/)
  // e o inverso: import registrado em CRLF, arquivo entregue em LF
  const winB = build(baseRows(), { cycles: false, csvTransform: (s) => s.replace(/\n/g, "\r\n") })
  assert.equal(winB.record.lineEnding, "CRLF")
  assert.equal(verify(bundleOf(winB, "netPnl"), winB).status, "SOURCE_VERIFIED")
  const lf = verify(bundleOf(winB, "netPnl"), winB, {}, { [winB.record.importId]: enc(winB.csv.replace(/\r\n/g, "\n")) })
  assert.match(check(lf, "V5.file").detail, /quebra de linha LF ≠ registrada CRLF/)
})

test("4. BOM DIFERENTE ⇒ V_FILE_MISMATCH com o BOM no motivo (arquivo com BOM × import sem BOM, e o inverso)", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const withBom = verify(bundle, LINES, {}, { [LINES.record.importId]: cat(BOM, LINES.bytes) })
  assert.equal(withBom.status, "SOURCE_MISMATCH")
  assert.match(check(withBom, "V5.file").detail, /BOM: o arquivo tem, o import registrado não tinha/)
  assert.match(check(withBom, "V5.file").detail, /tamanho/) // +3 bytes
  const bomB = build(baseRows(), { cycles: false, csvTransform: (s) => `﻿${s}` })
  assert.equal(bomB.record.hasBom, true)
  assert.equal(verify(bundleOf(bomB, "netPnl"), bomB, {}, { [bomB.record.importId]: cat(BOM, enc(bomB.csv.slice(1))) }).status, "SOURCE_VERIFIED") // bytes com BOM = texto com BOM
  const noBom = verify(bundleOf(bomB, "netPnl"), bomB, {}, { [bomB.record.importId]: enc(bomB.csv.slice(1)) })
  assert.equal(noBom.status, "SOURCE_MISMATCH")
  assert.match(check(noBom, "V5.file").detail, /BOM: o arquivo não tem, o import registrado tinha/)
})

test("5. CÉLULA MODIFICADA no arquivo ⇒ V_FILE_MISMATCH. E a FORJA COORDENADA (bundle gerado de dado alterado, selos e hashes consistentes, verifyEvidence VALID) é denunciada pelo arquivo original", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const cell = enc(LINES.csv.replace("Sim101", "Sim102").replace("Conta Alfa Secreta", "Conta Alfa Secreta "))
  const rep = verify(bundle, LINES, {}, { [LINES.record.importId]: cell })
  assert.equal(check(rep, "V5.file").code, "V_FILE_MISMATCH")
  // forja 1: altera o P&L de um trade NO CANONICAL e regenera tudo com as funções reais (como o cenário "coordenada" do Lab)
  const forgedTrades = LINES.run.trades.map((t, i) => (i === 0 ? ({ ...t, pnl: { ...t.pnl, net: (t.pnl.net ?? 0) + 100, gross: (t.pnl.gross ?? 0) + 100 } } as typeof t) : t))
  const T = toAnalyticsTrades(withRisk(forgedTrades))
  const { result, trace } = calculateMetricsTraced(T)
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result, trace }, trades: T, importRecords: [LINES.record] })
  assert.equal(r.ok, true)
  const forged = metricEvidenceBundle(r as Any)
  assert.equal(verifyEvidence(forged).status, "VALID", "a forja é internamente consistente (limite do E5)")
  const caught = verify(forged, LINES)
  assert.equal(caught.status, "SOURCE_MISMATCH")
  assert.equal(check(caught, "V5.values").code, "V_TRADE_VALUES_MISMATCH")
  assert.match(check(caught, "V5.values").detail, /\(pnl\)/) // só o NOME do campo
  assert.equal(check(caught, "V5.file").status, "PASS") // o arquivo é o original; o bundle é que mente
  assert.equal(check(caught, "V5.rows").status, "PASS") // rowHash/tradeId não mudaram — por isso a comparação de valores é necessária
  assert.equal(caught.coverage?.trades.verified, caught.coverage ? caught.coverage.trades.referenced - 1 : -1)
  // forja 2: bundle gerado DE UM ARQUIVO ALTERADO, verificado contra o original
  const alteredCsv = LINES.csv.replace("2003,0", "2009,0")
  assert.notEqual(alteredCsv, LINES.csv)
  const fake = build(baseRows().map((r, i) => (i === 0 ? { ...r, exitPrice: 2009 } : r)), { cycles: false })
  const rep2 = verifyEvidenceSource(bundleOf(fake, "netPnl"), { [fake.record.importId]: LINES.bytes })
  assert.equal(rep2.status, "SOURCE_MISMATCH")
  assert.equal(check(rep2, "V5.file").code, "V_FILE_MISMATCH")
})

// ── 6–10. identidade ─────────────────────────────────────────────────────────

test("6. importId DIVERGENTE ⇒ V_IMPORT_ID_MISMATCH", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const OLD = LINES.record.importId
  const NEW = "imp_" + "0".repeat(32)
  const forged = edit(bundle, (x) => {
    const s = JSON.stringify(x).split(OLD).join(NEW)
    Object.assign(x, JSON.parse(s))
  })
  const rep = verifyEvidenceSource(forged, { [NEW]: LINES.bytes })
  assert.equal(rep.status, "SOURCE_MISMATCH")
  assert.equal(check(rep, "V5.import-id").code, "V_IMPORT_ID_MISMATCH")
  assert.equal(check(rep, "V5.file").status, "PASS")
  // registro do import adulterado (importId igual): contagem de linhas
  const rec = verify(edit(bundle, (x) => (x.evidence.imports[0].rowsRead += 1)), LINES)
  assert.equal(check(rec, "V5.import-id").code, "V_IMPORT_RECORD_MISMATCH")
  assert.match(check(rec, "V5.import-id").detail, /rowsRead/)
})

test("7. rowHash DIVERGENTE ⇒ V_ROWHASH_MISMATCH (linha existe, conteúdo não corresponde ao hash registrado)", () => {
  for (const b of [LINES, CYCLES]) {
    const rep = verify(edit(bundleOf(b, "netPnl"), (x) => (x.evidence.trades[0].sourceRows[0].rowHash = "f".repeat(64))), b)
    assert.equal(rep.status, "SOURCE_MISMATCH")
    assert.equal(check(rep, "V5.rows").code, "V_ROWHASH_MISMATCH")
    assert.match(check(rep, "V5.rows").detail, /1 de \d+ linha\(s\) com rowHash ≠ da reingestão/)
    assert.equal(check(rep, "V5.trades").code, "V_TRADE_STRUCTURE_MISMATCH")
    assert.equal(check(rep, "V5.file").status, "PASS")
  }
})

test("8. tradeId DIVERGENTE ⇒ V_TRADE_ID_MISMATCH; id interno com sufixo #n não é identidade canônica", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const id0 = bundle.evidence.trades[0].tradeId
  const rep = verify(edit(bundle, (x) => (x.evidence.trades[0].tradeId = "trd_" + "a".repeat(32))), LINES)
  assert.equal(rep.status, "SOURCE_MISMATCH")
  assert.equal(check(rep, "V5.trades").code, "V_TRADE_ID_MISMATCH")
  assert.match(check(rep, "V5.trades").detail, /que a reingestão não produz/)
  const hash = verify(edit(bundle, (x) => (x.evidence.trades[0].tradeId = `${id0}#2`)), LINES)
  assert.equal(check(hash, "V5.trades").code, "V_TRADE_ID_MISMATCH")
  const dup = verify(edit(bundle, (x) => (x.evidence.trades[1].tradeId = id0)), LINES)
  assert.equal(check(dup, "V5.trades").code, "V_TRADE_ID_MISMATCH")
  assert.match(check(dup, "V5.trades").detail, /tradeId repetido/)
})

test("9. LINHA REFERENCIADA INEXISTENTE ⇒ V_ROW_MISSING", () => {
  const rep = verify(edit(bundleOf(LINES, "netPnl"), (x) => (x.evidence.trades[0].sourceRows[0].rowNo = 999)), LINES)
  assert.equal(rep.status, "SOURCE_MISMATCH")
  assert.equal(check(rep, "V5.rows").code, "V_ROW_MISSING")
  assert.match(check(rep, "V5.rows").detail, /linha\(s\) 999/)
})

test("10. REFERÊNCIA DUPLICADA (a mesma linha citada por dois trades) ⇒ V_ROWREF_DUPLICATE", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const rep = verify(edit(bundle, (x) => (x.evidence.trades[1].sourceRows[0] = clone(x.evidence.trades[0].sourceRows[0]))), LINES)
  assert.equal(rep.status, "SOURCE_MISMATCH")
  assert.equal(check(rep, "V5.rows").code, "V_ROWREF_DUPLICATE")
})

// ── 11–13. contexto e versões ────────────────────────────────────────────────

test("11. CONTEXTO DE FUSO DIFERENTE ⇒ divergência de importId (fuso USER alterado) ou não verificável (fuso padrão que mudou); nunca VALID", () => {
  const bundle = bundleOf(LINES, "netPnl")
  assert.equal(LINES.record.settings.sourceTzOrigin, "USER")
  const tz = verify(edit(bundle, (x) => (x.evidence.imports[0].settings.sourceTz = "Asia/Tokyo")), LINES)
  assert.equal(tz.status, "SOURCE_MISMATCH")
  assert.equal(check(tz, "V5.import-id").code, "V_IMPORT_ID_MISMATCH")
  assert.match(check(tz, "V5.import-id").detail, /importId reconstruído/)
  // fuso assumido (DEFAULT) que não é o padrão atual: a leitura não é reproduzível ⇒ UNVERIFIABLE, não adulteração
  const dflt = build(baseRows(), { cycles: false, tz: null })
  assert.equal(dflt.record.settings.sourceTzOrigin, "DEFAULT")
  assert.equal(verify(bundleOf(dflt, "netPnl"), dflt).status, "SOURCE_VERIFIED")
  const changed = verify(edit(bundleOf(dflt, "netPnl"), (x) => (x.evidence.imports[0].settings.sourceTz = "Asia/Tokyo")), dflt)
  assert.equal(changed.status, "UNVERIFIABLE")
  assert.equal(check(changed, "V5.context").code, "S_CONTEXT_INSUFFICIENT")
  assert.match(check(changed, "V5.context").detail, /padrão atual/)
  // origem desconhecida / declarada pelo formato: sem contexto
  assert.equal(check(verify(edit(bundle, (x) => (x.evidence.imports[0].settings.sourceTzOrigin = "FILE_DECLARED")), LINES), "V5.context").code, "S_CONTEXT_INSUFFICIENT")
  assert.equal(check(verify(edit(bundle, (x) => delete x.evidence.imports[0].settings.sourceTzOrigin), LINES), "V5.context").code, "S_CONTEXT_INSUFFICIENT")
})

test("12. VERSÃO/CONFIGURAÇÃO DO PARSER INCOMPATÍVEL ⇒ UNVERIFIABLE (S_VERSION_INCOMPATIBLE / S_CONTEXT_INSUFFICIENT), nunca sucesso nem adulteração", () => {
  const bundle = bundleOf(CYCLES, "netPnl")
  const newer = DEFAULT_PARSERS.map((p) => (p.id === ninjaTraderPtBr.id ? { ...p, version: "99.0.0" } : p))
  const v = verify(bundle, CYCLES, { parsers: newer })
  assert.equal(v.status, "UNVERIFIABLE")
  assert.equal(check(v, "V5.context").code, "S_VERSION_INCOMPATIBLE")
  assert.match(check(v, "V5.context").detail, /não é adulteração/)
  assert.equal(check(v, "V5.file").status, "PASS") // o arquivo continua conferido
  for (const id of ["V5.import-id", "V5.rows", "V5.trades", "V5.values"]) assert.equal(check(v, id).status, "SKIPPED", id)
  assert.equal(v.coverage?.trades.verified, 0)
  const rv = verify(edit(bundle, (x) => (x.evidence.imports[0].reconstructionVersion = "0")), CYCLES)
  assert.equal(check(rv, "V5.context").code, "S_VERSION_INCOMPATIBLE")
  assert.equal(check(verify(edit(bundle, (x) => (x.evidence.imports[0].reconstructionMethod = "OUTRO_METODO")), CYCLES), "V5.context").code, "S_CONTEXT_INSUFFICIENT")
  assert.equal(check(verify(edit(bundle, (x) => (x.evidence.imports[0].parserId = "parser-que-nao-existe")), CYCLES), "V5.context").code, "S_CONTEXT_INSUFFICIENT")
  // configuração do parser diferente da usada (numberLocale): a leitura muda ⇒ divergência do registro/importId, nunca VALID
  const loc = verify(edit(bundle, (x) => (x.evidence.imports[0].settings.numberLocale = "US")), CYCLES)
  assert.equal(loc.status, "SOURCE_MISMATCH")
  assert.equal(check(loc, "V5.import-id").status, "FAIL")
  // reconstrução ligada/desligada divergente do registro
  const off = verify(edit(bundle, (x) => { x.evidence.imports[0].reconstructionMethod = null; x.evidence.imports[0].reconstructionVersion = null }), CYCLES)
  assert.equal(off.status, "SOURCE_MISMATCH")
})

test("13. CICLO RECONSTRUÍDO COM IDENTIDADE DIVERGENTE ⇒ V_TRADE_STRUCTURE_MISMATCH (linhas do ciclo, granularidade, reconstrução)", () => {
  const bundle = bundleOf(CYCLES, "netPnl")
  const ci = bundle.evidence.trades.findIndex((t) => t.sourceRows.length === 2)
  assert.ok(ci >= 0)
  const cases: Array<[string, (x: Any) => void]> = [
    ["linha do ciclo removida", (x) => x.evidence.trades[ci].sourceRows.pop()],
    ["linha de OUTRO trade no ciclo", (x) => (x.evidence.trades[ci].sourceRows[1] = clone(x.evidence.trades[(ci + 1) % x.evidence.trades.length].sourceRows[0]))],
    ["granularidade trocada", (x) => (x.evidence.trades[ci].granularity = "SOURCE_ROW")],
    ["confiança da reconstrução", (x) => (x.evidence.trades[ci].reconstruction.confidence = x.evidence.trades[ci].reconstruction.confidence === "HIGH" ? "LOW" : "HIGH")],
    ["versão da reconstrução", (x) => (x.evidence.trades[ci].reconstruction.version = "0")],
  ]
  for (const [what, fn] of cases) {
    const rep = verify(edit(bundle, fn), CYCLES)
    assert.equal(rep.status, "SOURCE_MISMATCH", what)
    assert.ok(["V_TRADE_STRUCTURE_MISMATCH", "V_ROWHASH_MISMATCH", "V_ROWREF_DUPLICATE", "V_ROW_MISSING"].includes(check(rep, "V5.trades").code ?? check(rep, "V5.rows").code ?? ""), `${what}: ${JSON.stringify(codes(rep))}`)
    assert.ok(rep.checks.some((c) => c.status === "FAIL" && /^V5\.(trades|rows)$/.test(c.id)), what)
    assert.ok((rep.coverage?.trades.verified ?? 99) < (rep.coverage?.trades.referenced ?? 0), what)
  }
})

// ── 14–15. dados ausentes: não verificável, nunca adulteração ────────────────

test("14. ARQUIVO ORIGINAL AUSENTE ⇒ UNVERIFIABLE (S_SOURCE_NOT_PROVIDED), não SOURCE_MISMATCH; aceita Map e Record; fonte sobrando é ignorada", () => {
  const bundle = bundleOf(LINES, "netPnl")
  for (const files of [{}, { [LINES.record.importId]: undefined as unknown as Uint8Array }, new Map<string, Uint8Array>()]) {
    const rep = verifyEvidenceSource(bundle, files)
    assert.equal(rep.status, "UNVERIFIABLE")
    assert.equal(check(rep, "V5.file").code, "S_SOURCE_NOT_PROVIDED")
    assert.equal(rep.checks.filter((c) => c.status === "FAIL").length, 0)
    assert.equal(rep.coverage?.imports.sourceProvided, 0)
    assert.equal(rep.coverage?.trades.verified, 0)
  }
  assert.equal(verifyEvidenceSource(bundle, new Map([[LINES.record.importId, LINES.bytes]])).status, "SOURCE_VERIFIED")
  assert.equal(verifyEvidenceSource(bundle, { ...LINES.files, imp_outro: enc("lixo") }).status, "SOURCE_VERIFIED")
  // arquivo que não é UTF-8 válido: não reproduzível (hashBasis UTF8_TEXT) ⇒ UNVERIFIABLE
  const latin1 = verifyEvidenceSource(bundle, { [LINES.record.importId]: new Uint8Array([0x43, 0xe9, 0x0a, 0xff]) })
  assert.equal(latin1.status, "UNVERIFIABLE")
  assert.equal(check(latin1, "V5.file").code, "S_ENCODING_UNSUPPORTED")
  // bundle sem imports: nada a que ligar
  const none = verifyEvidenceSource(edit(bundle, (x) => (x.evidence.imports = [])), LINES.files)
  assert.notEqual(none.status, "SOURCE_VERIFIED")
  assert.equal(check(none, "V5.file").code, "S_NO_IMPORTS")
})

test("15. CONTEXTO INSUFICIENTE (sal do accountRef) ⇒ UNVERIFIABLE, não adulteração; com o sal certo ⇒ SOURCE_VERIFIED; sal errado ⇒ UNVERIFIABLE", () => {
  const salted = build(baseRows(), { cycles: false, salt: "usuario-123" })
  const bundle = bundleOf(salted, "netPnl")
  assert.equal(verify(bundle, salted, { accountRefSalt: "usuario-123" }).status, "SOURCE_VERIFIED")
  for (const opts of [{}, { accountRefSalt: "outro-usuario" }]) {
    const rep = verify(bundle, salted, opts)
    assert.equal(rep.status, "UNVERIFIABLE")
    assert.equal(check(rep, "V5.rows").code, "S_ACCOUNT_REF_UNVERIFIED")
    assert.equal(check(rep, "V5.trades").code, "S_ACCOUNT_REF_UNVERIFIED")
    assert.equal(check(rep, "V5.file").status, "PASS") // arquivo e importId não dependem do sal
    assert.equal(check(rep, "V5.import-id").status, "PASS")
    assert.doesNotMatch(JSON.stringify(rep), /usuario-123|outro-usuario/) // o sal nunca é impresso
  }
  // accountRef adulterado em UM trade (sal certo): divergência real, não insuficiência
  const one = verify(edit(bundle, (x) => (x.evidence.trades[0].accountRef = "acc_" + "0".repeat(24))), salted, { accountRefSalt: "usuario-123" })
  assert.equal(one.status, "SOURCE_MISMATCH")
  assert.equal(check(one, "V5.trades").code, "V_TRADE_STRUCTURE_MISMATCH")
})

// ── 16–17. cobertura ─────────────────────────────────────────────────────────

test("16. POPULAÇÃO PARCIAL: métrica sobre um subconjunto (filtro) lista só os trades da população ⇒ SOURCE_VERIFIED, e a cobertura mostra que são menos linhas que as do arquivo; seleção NÃO provada", () => {
  const sub = bundleOf(LINES, "netPnl", { filters: { direction: "LONG" } as Any })
  const all = bundleOf(LINES, "netPnl")
  const part = verify(sub, LINES)
  assert.equal(part.status, "SOURCE_VERIFIED")
  assert.ok((part.coverage?.rows.referenced ?? 99) <= (all.evidence.trades.length))
  const viaHour = bundleOf(LINES, "netPnl", { filters: { hour: [9] } as Any })
  const r = verify(viaHour, LINES)
  assert.equal(r.status, "SOURCE_VERIFIED")
  assert.equal(r.coverage?.selection, "NOT_VERIFIED")
  assert.ok(r.limitations.some((l) => l.code === "L_SELECTION_NOT_PROVEN"))
  // grupo (população parcial por construção)
  const ag = aggregateTradesTraced(toAnalyticsTrades(withRisk(LINES.run.trades)), { groupBy: "account" as Any })
  const T = toAnalyticsTrades(withRisk(LINES.run.trades))
  const ex = explainMetric({ metricId: "netPnl", source: { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: 0 } } as MetricSource, trades: T, importRecords: [LINES.record] })
  assert.equal(ex.ok, true)
  const g = verify(metricEvidenceBundle(ex as Any), LINES)
  assert.equal(g.status, "SOURCE_VERIFIED")
  assert.equal(g.coverage?.trades.referenced, PTS.length / 2)
  assert.ok((g.coverage?.rows.referenced ?? 99) < LINES.record.rowsAccepted, "população parcial: menos linhas citadas que as aceitas do arquivo")
})

test("17. HASH_ONLY ⇒ SOURCE_VERIFIED_PARTIAL: as âncoras presentes conferem, a população completa NÃO é alegada; âncora adulterada ⇒ SOURCE_MISMATCH", () => {
  const h = bundleOf(LINES, "largestWinner", { tradeIdsLimit: 3 })
  assert.equal(h.evidence.metrics[0].verifiability, "HASH_ONLY")
  const rep = verify(h, LINES)
  assert.equal(rep.status, "SOURCE_VERIFIED_PARTIAL")
  assert.equal(check(rep, "V5.coverage").code, "S_POPULATION_PARTIAL")
  assert.match(check(rep, "V5.coverage").detail, /NÃO pode ser conferida/)
  assert.deepEqual(rep.coverage?.populations, { metrics: 1, full: 0, hashOnly: 1, complete: false })
  assert.ok((rep.coverage?.trades.referenced ?? 99) < PTS.length)
  assert.equal(rep.coverage?.trades.referenced, rep.coverage?.trades.verified)
  assert.notEqual(rep.status, "SOURCE_VERIFIED")
  // âncora adulterada
  const anchor = h.evidence.metrics[0].contributors.items[0].tradeId
  const bad = verify(edit(h, (x) => { const t = x.evidence.trades.find((q: Any) => q.tradeId === anchor); t.pnl.net += 100 }), LINES)
  assert.equal(bad.status, "SOURCE_MISMATCH")
  assert.equal(check(bad, "V5.values").code, "V_TRADE_VALUES_MISMATCH")
  // uma métrica HASH_ONLY junto de uma FULL no mesmo bundle também é parcial: nunca SOURCE_VERIFIED
  const mixed = edit(bundleOf(LINES, "netPnl"), (x) => { const m = clone(x.evidence.metrics[0]); m.verifiability = "HASH_ONLY"; x.evidence.metrics.push(m) })
  assert.equal(verify(mixed, LINES).status, "SOURCE_VERIFIED_PARTIAL")
})

// ── 18. arquivo íntegro, referências inconsistentes ──────────────────────────

test("18. ARQUIVO ÍNTEGRO com referências inconsistentes (linhas trocadas entre trades, trade apontando para import desconhecido, valores trocados) ⇒ SOURCE_MISMATCH, e o arquivo continua PASS", () => {
  const bundle = bundleOf(LINES, "netPnl")
  const swap = verify(edit(bundle, (x) => { const a = x.evidence.trades[0].sourceRows[0]; x.evidence.trades[0].sourceRows[0] = x.evidence.trades[1].sourceRows[0]; x.evidence.trades[1].sourceRows[0] = a }), LINES)
  assert.equal(swap.status, "SOURCE_MISMATCH")
  assert.equal(check(swap, "V5.file").status, "PASS")
  assert.equal(check(swap, "V5.trades").status, "FAIL")
  const unknownImport = verify(edit(bundle, (x) => (x.evidence.trades[0].importId = "imp_desconhecido")), LINES)
  assert.equal(unknownImport.status, "SOURCE_MISMATCH")
  assert.ok(unknownImport.checks.some((c) => c.status === "FAIL" && c.id === "V5.trades"))
  const swapVals = verify(edit(bundle, (x) => { const a = x.evidence.trades[0].pnl; x.evidence.trades[0].pnl = x.evidence.trades[1].pnl; x.evidence.trades[1].pnl = a }), LINES)
  assert.equal(check(swapVals, "V5.values").code, "V_TRADE_VALUES_MISMATCH")
  // preço de saída e horário alterados no bundle (selos refeitos)
  for (const fn of [(x: Any) => (x.evidence.trades[2].exit.price += 1), (x: Any) => (x.evidence.trades[2].entry.at.instantUtc = "2026-03-04T10:00:00.000Z"), (x: Any) => (x.evidence.trades[2].quantity += 1)]) {
    const rep = verify(edit(bundle, fn), LINES)
    assert.equal(rep.status, "SOURCE_MISMATCH")
    assert.equal(check(rep, "V5.values").code, "V_TRADE_VALUES_MISMATCH")
  }
})

// ── formato, determinismo, privacidade, não regressão ─────────────────────────

test("FORMATO: entrada que não é evidence/1 ⇒ INVALID_FORMAT (sem lançar, sem ler arquivo)", () => {
  for (const bad of [null, undefined, 42, "x", {}, { schema: "evidence/1" }, clone(bundleOf(LINES, "netPnl")) && { ...bundleOf(LINES, "netPnl"), extra: 1 }]) {
    const rep = verifyEvidenceSource(bad, LINES.files)
    assert.equal(rep.status, "INVALID_FORMAT")
    assert.equal(check(rep, "V5.format").code, "V_SOURCE_FORMAT_INVALID")
    assert.equal(rep.evidenceHash, null)
    assert.equal(rep.coverage, null)
    assert.equal(rep.limitations.length, 5)
  }
})

test("DETERMINISMO e PUREZA: mesma entrada ⇒ mesmo relatório; o bundle e o evidenceHash não mudam; as entradas não são mutadas", () => {
  const bundle = bundleOf(CYCLES, "maxDrawdown")
  const before = canonicalJson(bundle)
  const bytes = CYCLES.bytes.slice()
  const a = verify(bundle, CYCLES)
  const b = verify(bundle, CYCLES)
  assert.equal(canonicalJson(a), canonicalJson(b))
  assert.equal(canonicalJson(bundle), before)
  assert.equal(computeEvidenceHash(bundle), bundle.evidenceHash)
  assert.deepEqual(bytes, CYCLES.bytes)
  assert.equal(verifyEvidence(bundle).status, "VALID") // e o verificador V0–V4 segue igual
})

test("PRIVACIDADE: o relatório nunca contém nomes de conta, trecho do CSV, sal nem valores (só nomes de campo e hashes truncados) — nem nas falhas", () => {
  const secrets = ["Conta Alfa Secreta", "Conta Beta Secreta", "Estrategia Teste", "usuario-123"]
  const salted = build(baseRows(), { cycles: false, salt: "usuario-123" })
  const reports: SourceVerifyReport[] = []
  const bundle = bundleOf(salted, "netPnl")
  reports.push(verify(bundle, salted, { accountRefSalt: "usuario-123" }), verify(bundle, salted))
  reports.push(verify(edit(bundle, (x) => (x.evidence.trades[0].pnl.net += 123456.78)), salted, { accountRefSalt: "usuario-123" }))
  reports.push(verify(edit(bundle, (x) => (x.evidence.trades[0].sourceRows[0].rowNo = 999)), salted, { accountRefSalt: "usuario-123" }))
  reports.push(verify(bundle, salted, { accountRefSalt: "usuario-123" }, { [salted.record.importId]: cat(BOM, salted.bytes) }))
  for (const rep of reports) {
    const text = JSON.stringify(rep)
    for (const s of secrets) assert.equal(text.includes(s), false, `vazou "${s}"`)
    assert.equal(text.includes("123456"), false, "vazou um valor")
    assert.doesNotMatch(JSON.stringify({ ...rep, evidenceHash: null }), /[0-9a-f]{64}/, "hash completo nos detalhes (só o eco do selo do bundle é permitido)")
  }
  // o bundle nunca recebe o CSV
  assert.equal(JSON.stringify(bundle).includes("Estrategia Teste"), false)
})

test("FONTE: verify-source.ts não importa fs/crypto/Prisma/UI, não lê caminhos, não usa relógio/random e reaproveita pipeline, identidade, hash e explainTrades", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/lib/evidence/verify-source.ts", import.meta.url)), "utf8")
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  for (const bad of [/node:fs/, /node:crypto/, /createHash/, /readFile/, /Prisma|prisma/, /from "react|next\//, /Date\.now|new Date|Math\.random|performance\.now/, /process\.env/, /console\./]) assert.equal(bad.test(code), false, String(bad))
  for (const need of [/runImportPipeline/, /describeText/, /sha256Hex/, /explainTrades/, /canonicalJson/]) assert.ok(need.test(code), String(need))
  // nenhum SHA-256 próprio: a única chamada de hash é a do adaptador
  assert.equal(/sha256Hex\(/.test(code), true)
  assert.equal(/subtle\.digest/.test(code), false)
})

test("NÃO REGRESSÃO: calculateMetrics ≡ traced, tradeSetHash e evidenceHash intactos após verificar a origem", () => {
  for (const b of [LINES, CYCLES]) {
    const T = toAnalyticsTrades(withRisk(b.run.trades))
    const normal = calculateMetrics(T)
    const traced = calculateMetricsTraced(T)
    assert.equal(canonicalJson(normal), canonicalJson(traced.result))
    const bundle = bundleOf(b, "maxDrawdown")
    const hash = bundle.evidenceHash
    const tsh = bundle.evidence.metrics[0].population.tradeSetHash
    verify(bundle, b)
    assert.equal(bundle.evidenceHash, hash)
    assert.equal(bundle.evidence.metrics[0].population.tradeSetHash, tsh)
    assert.equal(tsh, normal.population.tradeSetHash)
  }
})

// ── fixtures reais (locais; sem números embutidos) ───────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
const R = { fixtures: 0, bundles: 0, status: {} as Record<string, number>, ciclos: new Set<string>(), linhas: new Set<string>(), rows: new Set<string>(), importIdDiv: 0, rowHashDiv: 0, tradeIdDiv: 0, valuesDiv: 0, noRefs: 0, attacks: 0, detected: 0, files: 0 }
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const bytes = new Uint8Array(readFileSync(join(DIR, name)))
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  test(`REAL ${tag}: ciclos e trades-linha × métricas × total/grupos/HASH_ONLY — arquivo, importId, rowHash, tradeId e valores conferem; determinismo; privacidade; ataques detectados`, () => {
    R.fixtures += 1
    R.files += 1
    const accounts = [...new Set(parseDelimited(text).rows.map((r) => (r.fields["conta"] ?? "").trim()).filter(Boolean))]
    assert.ok(accounts.length > 0)
    for (const label of ["ciclos", "linhas"] as const) {
      // a reingestão do teste NÃO usa o context.json: o contexto sai só do ImportRef do bundle
      const run = runImportPipeline(text, { ...ctx, fileName: `${accounts[0]}-${tag}.csv`, ...(label === "linhas" ? { reconstructCycles: false } : {}) })
      const record = run.importRecord as ImportRecord
      const files = { [record.importId]: bytes }
      // determinismo da reexecução: o mesmo arquivo e o mesmo contexto dão a MESMA identidade, duas vezes
      const again = runImportPipeline(text, { ...ctx, fileName: `${accounts[0]}-${tag}.csv`, ...(label === "linhas" ? { reconstructCycles: false } : {}) })
      assert.equal(canonicalJson({ i: again.importRecord?.importId, t: again.trades.map((t) => [t.tradeId, t.source.rowHash, (t.sourceRows ?? []).map((r) => r.rowHash)]) }), canonicalJson({ i: record.importId, t: run.trades.map((t) => [t.tradeId, t.source.rowHash, (t.sourceRows ?? []).map((r) => r.rowHash)]) }))
      const T = toAnalyticsTrades(run.trades)
      const mk = (id: string, source: MetricSource) => {
        const r = explainMetric({ metricId: id, source, trades: T, importRecords: [record] })
        assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
        return metricEvidenceBundle(r as Any)
      }
      const bundles: EvidenceBundle[] = []
      const tm = calculateMetricsTraced(T)
      for (const id of METRIC_IDS) bundles.push(mk(id, { kind: "METRICS", result: tm.result, trace: tm.trace }))
      for (const by of ["account", "hour", "direction"] as const) {
        const ag = aggregateTradesTraced(T, { groupBy: by as Any })
        ag.result.groups.forEach((_, gi) => { for (const id of ["netPnl", "winners", "maxDrawdown", "profitFactor"]) bundles.push(mk(id, { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index: gi } })) })
      }
      const low = calculateMetricsTraced(T, { tradeIdsLimit: 3 })
      for (const id of ["netPnl", "winners", "largestWinner", "largestLoser", "maxDrawdown"]) bundles.push(mk(id, { kind: "METRICS", result: low.result, trace: low.trace }))
      bundles.forEach((b, n) => {
        R.bundles += 1
        const rep = verifyEvidenceSource(b, files)
        const bad = rep.checks.filter((c) => c.status === "FAIL")
        for (const c of bad) {
          if (c.code === "V_IMPORT_ID_MISMATCH" || c.code === "V_IMPORT_RECORD_MISMATCH") R.importIdDiv += 1
          else if (c.code === "V_ROWHASH_MISMATCH" || c.code === "V_ROW_MISSING") R.rowHashDiv += 1
          else if (c.code === "V_TRADE_ID_MISMATCH" || c.code === "V_TRADE_STRUCTURE_MISMATCH") R.tradeIdDiv += 1
          else R.valuesDiv += 1
        }
        assert.deepEqual(bad.map((c) => [c.id, c.code, c.detail.slice(0, 200)]), [], `${tag}/${label} #${n} ${b.subject.id}`)
        R.status[rep.status] = (R.status[rep.status] ?? 0) + 1
        if (b.evidence.trades.length === 0) {
          // HASH_ONLY sem nenhuma âncora (ex.: drawdown zero): não há referência alguma a ligar ao arquivo — não é verificável, e o relatório diz por quê
          R.noRefs += 1
          assert.equal(rep.status, "UNVERIFIABLE", `${tag}/${label} #${n}`)
          assert.equal(check(rep, "V5.file").code, "S_NO_IMPORTS")
          assert.equal(b.evidence.metrics[0].verifiability, "HASH_ONLY")
          return
        }
        assert.ok(rep.status === "SOURCE_VERIFIED" || rep.status === "SOURCE_VERIFIED_PARTIAL", `${tag}/${label} #${n}: ${rep.status} ${JSON.stringify(codes(rep))}`)
        assert.equal(rep.status === "SOURCE_VERIFIED_PARTIAL", b.evidence.metrics.some((m) => m.verifiability === "HASH_ONLY"))
        assert.equal(rep.coverage?.trades.referenced, rep.coverage?.trades.verified)
        assert.equal(rep.coverage?.rows.referenced, rep.coverage?.rows.verified)
        for (const t of b.evidence.trades) { (t.granularity === "POSITION_CYCLE" ? R.ciclos : R.linhas).add(`${tag}:${t.tradeId}`); for (const r of t.sourceRows) R.rows.add(`${tag}:${r.importId}:${r.rowNo}:${r.rowHash}`) }
        for (const s of accounts) assert.equal(JSON.stringify(rep).includes(s), false, `${label} #${n}: conta vazou`)
        if (n === 0) assert.equal(canonicalJson(rep), canonicalJson(verifyEvidenceSource(b, files)), "determinismo")
        if (n % 4 !== 0 || b.evidence.trades.length === 0) return
        // ataques em amostra
        const attacks: Array<[string, (x: Any) => void, (r: SourceVerifyReport) => boolean]> = [
          ["rowHash", (x) => (x.evidence.trades[0].sourceRows[0].rowHash = "e".repeat(64)), (r) => check(r, "V5.rows").code === "V_ROWHASH_MISMATCH"],
          ["tradeId", (x) => (x.evidence.trades[0].tradeId = "trd_" + "b".repeat(32)), (r) => check(r, "V5.trades").code === "V_TRADE_ID_MISMATCH"],
          ["linha inexistente", (x) => (x.evidence.trades[0].sourceRows[0].rowNo = 99999), (r) => check(r, "V5.rows").code === "V_ROW_MISSING"],
          ["P&L", (x) => (x.evidence.trades[0].pnl.net = (x.evidence.trades[0].pnl.net ?? 0) + 100), (r) => check(r, "V5.values").code === "V_TRADE_VALUES_MISMATCH"],
          ["preço de saída", (x) => (x.evidence.trades[0].exit.price += 1), (r) => check(r, "V5.values").code === "V_TRADE_VALUES_MISMATCH"],
          ["importId", (x) => { const s = JSON.stringify(x).split(record.importId).join("imp_" + "0".repeat(32)); Object.assign(x, JSON.parse(s)) }, (r) => r.status === "UNVERIFIABLE" && check(r, "V5.file").code === "S_SOURCE_NOT_PROVIDED"],
        ]
        for (const [what, fn, ok] of attacks) {
          R.attacks += 1
          const r = verifyEvidenceSource(edit(b, fn), files)
          if (what === "importId") assert.notEqual(r.status, "SOURCE_VERIFIED")
          if (ok(r) && r.status !== "SOURCE_VERIFIED" && r.status !== "SOURCE_VERIFIED_PARTIAL") R.detected += 1
          else assert.fail(`${tag}/${label} #${n} ${b.subject.id}: ataque "${what}" não detectado (${r.status}: ${JSON.stringify(codes(r))})`)
        }
        // arquivo adulterado (1 byte) e BOM
        const flipped = bytes.slice()
        flipped[Math.floor(flipped.length / 2)] ^= 0x01
        for (const f of [flipped, cat(BOM, bytes)]) {
          R.attacks += 1
          const r = verifyEvidenceSource(b, { [record.importId]: f })
          if (r.status === "SOURCE_MISMATCH" && check(r, "V5.file").code === "V_FILE_MISMATCH") R.detected += 1
          else if (r.status === "UNVERIFIABLE" && check(r, "V5.file").code === "S_ENCODING_UNSUPPORTED") R.detected += 1 // byte virou UTF-8 inválido: não reproduzível, nunca VERIFIED
          else assert.fail(`${tag}/${label} #${n}: arquivo adulterado não detectado (${r.status})`)
        }
      })
    }
  })
}
if (names.length) {
  const t = (s: Set<string>) => s.size
  console.log(`  → fixtures reais: ${R.fixtures} arquivo(s) · ${R.bundles} bundles → ${JSON.stringify(R.status)} · ${t(R.ciclos)} ciclos + ${t(R.linhas)} trades-linha distintos verificados · ${t(R.rows)} linhas (importId+rowNo+rowHash) · bundles sem nenhuma referência (HASH_ONLY sem âncora): ${R.noRefs} · divergências importId/rowHash/tradeId/valores em bundles limpos: ${R.importIdDiv}/${R.rowHashDiv}/${R.tradeIdDiv}/${R.valuesDiv} · ${R.attacks} ataques, ${R.detected} detectados`)
}

console.log(`\n${passed} testes ok`)
