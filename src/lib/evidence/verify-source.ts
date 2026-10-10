// verifyEvidenceSource (Evidence E5b): proveniência da Evidence contra o ARQUIVO ORIGINAL.
//
//   EvidenceBundle + bytes do CSV → V5.file (bytes ⇒ SHA-256) → V5.context → reingestão com o contexto do ImportRef → comparação de
//   importId, rowHash, tradeId e valores derivados do arquivo → relatório (o que foi verificado e o que ficou pendente).
//
// NÃO é segundo pipeline nem segundo hash: a reingestão é `runImportPipeline`; hashes e identidade são os de `ingest/identity.ts` e
// `infra/hash.ts`; a projeção de cada trade é `explainTrades` (E3). Aqui só se COMPARA. Puro: sem relógio, random, banco, rede nem
// caminho de arquivo (quem chama entrega os BYTES; o CSV nunca entra no bundle nem no relatório).
//
// Independe do `verifyEvidence` (V0–V4): aquele prova consistência interna e reprodução matemática da população declarada; este liga
// os dados à fonte. `SOURCE_VERIFIED` + `VALID` juntos é o que se pode afirmar; nenhum dos dois sozinho prova o outro.
//
// Status (nunca confunde indisponibilidade com adulteração):
//   INVALID_FORMAT           o bundle não é `evidence/1`
//   SOURCE_MISMATCH          algum FAIL: arquivo ≠ import registrado, importId/rowHash/tradeId/valores divergem
//   UNVERIFIABLE             sem FAIL, mas algo bloqueante não pôde ser conferido (arquivo/contexto/versão ausentes ou incompatíveis…)
//   SOURCE_VERIFIED_PARTIAL  tudo que está NO bundle confere, mas a população de alguma métrica é parcial (HASH_ONLY: só âncoras)
//   SOURCE_VERIFIED          tudo que está no bundle confere e toda população declarada está listada
// `SOURCE_VERIFIED*` NÃO prova a seleção original, a ordem original da sequência nem o que o usuário acrescentou depois (R/stop): ver `limitations`.

import type { ImportRecord } from "../domain/canonical.ts"
import { DEFAULT_SOURCE_TIME_ZONE } from "../domain/time.ts"
import { canonicalJson, sha256Hex } from "../infra/hash.ts"
import { describeText } from "../ingest/identity.ts"
import { runImportPipeline } from "../ingest/pipeline.ts"
import { RECONSTRUCTION_VERSION } from "../ingest/reconstruct.ts"
import { DEFAULT_PARSERS } from "../ingest/registry.ts"
import type { ImportContext, ParserDescriptor, PipelineResult } from "../ingest/types.ts"
import { explainTrades } from "./explain-trade.ts"
import { EvidenceBundleSchema, type EvidenceBundle, type ImportRef, type TradeEvidence } from "./schema.ts"

export const VERIFY_SOURCE_SCHEMA = "verify-source/1" as const

export type SourceStatus = "SOURCE_VERIFIED" | "SOURCE_VERIFIED_PARTIAL" | "UNVERIFIABLE" | "SOURCE_MISMATCH" | "INVALID_FORMAT"
export type SourceCheckStatus = "PASS" | "FAIL" | "SKIPPED"

export interface SourceCheck {
  id: string
  status: SourceCheckStatus
  /** FAIL: `V_*` · SKIPPED: `S_*` · PASS: null. */
  code: string | null
  detail: string
}

export interface SourceCoverage {
  imports: { declared: number; sourceProvided: number; fileVerified: number; reingested: number }
  /** Linhas do arquivo citadas pelo bundle (únicas) e quantas conferem rowNo+rowHash com a reingestão. */
  rows: { referenced: number; verified: number }
  /** TradeEvidence do bundle (únicos) e quantos conferem identidade, estrutura e valores com a reingestão. */
  trades: { referenced: number; verified: number }
  /** Métricas do bundle: população listada (FULL) × só hash e âncoras (HASH_ONLY). */
  populations: { metrics: number; full: number; hashOnly: number; complete: boolean }
  /** Fixos: o que a verificação de origem NÃO cobre (ver `limitations`). */
  selection: "NOT_VERIFIED"
  originalSequenceOrder: "NOT_VERIFIED"
  userEnrichment: "NOT_VERIFIED"
}

export interface SourceLimitation {
  code: string
  text: string
}

export interface SourceVerifyReport {
  schema: typeof VERIFY_SOURCE_SCHEMA
  status: SourceStatus
  /** Eco do selo do bundle verificado (liga o relatório ao bundle); null se o formato é inválido. NÃO é recalculado aqui. */
  evidenceHash: string | null
  checks: SourceCheck[]
  coverage: SourceCoverage | null
  limitations: SourceLimitation[]
}

export const SOURCE_LIMITATIONS: ReadonlyArray<SourceLimitation> = [
  { code: "L_SELECTION_NOT_PROVEN", text: "Confere que as linhas e trades CITADOS vêm do arquivo. Não prova que a seleção original (filtros sobre o conjunto de entrada) foi a correta nem a completa." },
  { code: "L_SEQUENCE_ORIGINAL_ORDER_NOT_PROVEN", text: "A ordem registrada em population.sequence reproduz o resultado do motor (V4.sequence), mas a ordem do array de entrada do motor depende de quem o chamou, não do CSV: a ordem original não é provada contra o arquivo." },
  { code: "L_USER_ENRICHMENT_NOT_PROVEN", text: "R, risco, stop, issues e fieldProvenance podem ter sido acrescentados depois da importação (não derivam do arquivo) e ficam fora da comparação de valores." },
  { code: "L_CONTEXT_FROM_BUNDLE_AND_CALLER", text: "O contexto da reingestão vem do ImportRef; accountRefSalt, foldPolicy e exitReasonMap não estão registrados no bundle e são os informados pelo chamador (ou o padrão). As versões internas das funções de hash (rowHash/tradeId) também não são registradas: uma mudança nelas apareceria como divergência total." },
  { code: "L_BUNDLE_INTEGRITY_NOT_CHECKED", text: "O selo e a consistência interna do bundle (V0–V4) são do verifyEvidence; esta verificação só liga o bundle à fonte." },
]

const FAIL = {
  FILE: "V_FILE_MISMATCH",
  IMPORT_ID: "V_IMPORT_ID_MISMATCH",
  IMPORT_RECORD: "V_IMPORT_RECORD_MISMATCH",
  IMPORT_REF: "V_IMPORT_REF_MISSING",
  ROW_MISSING: "V_ROW_MISSING",
  ROW_HASH: "V_ROWHASH_MISMATCH",
  ROW_DUP: "V_ROWREF_DUPLICATE",
  TRADE_ID: "V_TRADE_ID_MISMATCH",
  TRADE_STRUCTURE: "V_TRADE_STRUCTURE_MISMATCH",
  TRADE_VALUES: "V_TRADE_VALUES_MISMATCH",
} as const

const S_NOT_PROVIDED = "S_SOURCE_NOT_PROVIDED"
const S_ENCODING = "S_ENCODING_UNSUPPORTED"
const S_VERSION = "S_VERSION_INCOMPATIBLE"
const S_CONTEXT = "S_CONTEXT_INSUFFICIENT"
const S_REINGEST = "S_REINGEST_FAILED"
const S_FILE_FIRST = "S_FILE_NOT_VERIFIED"
const S_ACCOUNT_REF = "S_ACCOUNT_REF_UNVERIFIED"
const S_ROWHASH_MISSING = "S_ROWHASH_MISSING"
const S_NOT_APPLICABLE = "S_NOT_APPLICABLE"
/** Não bloqueia: a população parcial é dita no status (`SOURCE_VERIFIED_PARTIAL`), não escondida. */
const S_PARTIAL = "S_POPULATION_PARTIAL"
const S_NOT_EXECUTED = "S_CHECK_NOT_EXECUTED"
const S_NO_IMPORTS = "S_NO_IMPORTS"

export const SOURCE_CHECK_CATALOG: ReadonlyArray<{ id: string; title: string }> = [
  { id: "V5.format", title: "bundle evidence/1 legível (schema strict)" },
  { id: "V5.file", title: "V5.1 arquivo original: SHA-256 dos bytes, tamanho, BOM, quebra de linha" },
  { id: "V5.context", title: "V5.2 contexto da importação reproduzível (parser, versões, fuso, reconstrução)" },
  { id: "V5.import-id", title: "V5.3 importId e registro do import reconstruídos pela reingestão" },
  { id: "V5.rows", title: "V5.4 linhas citadas: existem e têm o rowHash registrado" },
  { id: "V5.trades", title: "V5.5 tradeId, granularidade e composição (linhas/reconstrução) conferem com a reingestão" },
  { id: "V5.values", title: "V5.5 valores derivados do arquivo (preços, P&L, horários, pernas) conferem com a reingestão" },
  { id: "V5.coverage", title: "V5.6 cobertura: população listada × só âncoras" },
]

type Outcome = { status: SourceCheckStatus; code?: string; detail: string }
const pass = (detail: string): Outcome => ({ status: "PASS", detail })
const skip = (code: string, detail: string): Outcome => ({ status: "SKIPPED", code, detail })
const fail = (code: string, detail: string): Outcome => ({ status: "FAIL", code, detail })

const short = (h: string | null | undefined) => (h ? `${h.slice(0, 12)}…` : "null")
const MAX_LISTED = 5
const listed = (xs: string[]) => (xs.length <= MAX_LISTED ? xs.join(", ") : `${xs.slice(0, MAX_LISTED).join(", ")} (+${xs.length - MAX_LISTED})`)

/** Junta resultados de vários imports/trades num check: FAIL > SKIPPED bloqueante > SKIPPED parcial > PASS (nunca PASS parcial). */
function combine(parts: Outcome[]): Outcome {
  if (parts.length === 0) return skip(S_NOT_APPLICABLE, "nada a conferir")
  const applicable = parts.filter((p) => !(p.status === "SKIPPED" && p.code === S_NOT_APPLICABLE))
  if (applicable.length === 0) return skip(S_NOT_APPLICABLE, parts[0].detail)
  const join = (xs: Outcome[]) => xs.map((p) => p.detail).join(" | ")
  const fails = applicable.filter((p) => p.status === "FAIL")
  if (fails.length > 0) return fail(fails[0].code as string, join(fails))
  const skips = applicable.filter((p) => p.status === "SKIPPED")
  if (skips.length > 0) return skip(skips[0].code as string, join(skips))
  return pass(join(applicable))
}

interface PerImport {
  file: Outcome
  context: Outcome
  importId: Outcome
  rows: Outcome[]
  trades: Outcome[]
  values: Outcome[]
  verifiedRows: Set<number>
  verifiedTrades: Set<string>
  referencedRows: Set<number>
  reingested: boolean
}

export interface VerifySourceOptions {
  /** Sal do `account.ref` usado na importação original (não está no bundle). Sem ele, bundles com contas só verificam arquivo e importId. */
  accountRefSalt?: string
  foldPolicy?: ImportContext["foldPolicy"]
  exitReasonMap?: ImportContext["exitReasonMap"]
  /** Parsers disponíveis (padrão: o registro atual). Existe para testar incompatibilidade de versão. */
  parsers?: ParserDescriptor[]
}

export type SourceFiles = Record<string, Uint8Array> | ReadonlyMap<string, Uint8Array>

const filesGet = (files: SourceFiles, importId: string): Uint8Array | undefined => (files instanceof Map ? files.get(importId) : (files as Record<string, Uint8Array>)[importId])

const rowsOf = (t: TradeEvidence): Array<{ rowNo: number; rowHash: string | null }> => t.sourceRows.map((r) => ({ rowNo: r.rowNo, rowHash: r.rowHash }))

/** Campos do TradeEvidence comparados por check. Fora: r, risk, issues, fieldProvenance (não derivam só do arquivo: L_USER_ENRICHMENT_NOT_PROVEN). */
const STRUCTURE_FIELDS = ["importId", "provenance", "granularity", "accountRef", "reconstruction"] as const
const VALUE_FIELDS = ["instrument", "direction", "quantity", "peakQuantity", "entry", "exit", "pnl", "pointsPerContract", "entryLegs", "exitLegs", "exitSummary", "excursions", "sourceRows"] as const

function differing(a: TradeEvidence, b: TradeEvidence, fields: readonly (keyof TradeEvidence)[]): string[] {
  return fields.filter((f) => canonicalJson(a[f] ?? null) !== canonicalJson(b[f] ?? null)).map(String)
}

/** O contexto da reingestão sai do ImportRef; o que ele não registra vem do chamador (ver limitations). */
function contextOf(imp: ImportRef, opts: VerifySourceOptions): ImportContext {
  const s = imp.settings
  return {
    forceParserId: imp.parserId,
    ...(s.sourceTzOrigin === "USER" && s.sourceTz ? { sourceTz: s.sourceTz } : {}),
    ...(s.dateOrder ? { dateOrder: s.dateOrder } : {}),
    numberLocale: s.numberLocale,
    excursionUnit: s.excursionUnit,
    declaredPnlBasis: s.declaredPnlBasis,
    reconstructCycles: imp.reconstructionMethod !== null,
    ...(opts.accountRefSalt !== undefined ? { accountRefSalt: opts.accountRefSalt } : {}),
    ...(opts.foldPolicy !== undefined ? { foldPolicy: opts.foldPolicy } : {}),
    ...(opts.exitReasonMap !== undefined ? { exitReasonMap: opts.exitReasonMap } : {}),
  }
}

function contextProblem(imp: ImportRef, parsers: ParserDescriptor[]): Outcome | null {
  const parser = parsers.find((p) => p.id === imp.parserId)
  if (!parser) return skip(S_CONTEXT, `parser "${imp.parserId}" não existe neste registro: não dá para reexecutar a leitura`)
  if (parser.version !== imp.parserVersion) return skip(S_VERSION, `parser ${imp.parserId}: o import usou a versão "${imp.parserVersion}", o registro atual tem "${parser.version}" — a identidade não pode ser reproduzida com outra versão (não é adulteração)`)
  if (imp.reconstructionMethod !== null) {
    if (imp.reconstructionMethod !== "NT8_ROW_INTERVALS_V1") return skip(S_CONTEXT, `método de reconstrução "${imp.reconstructionMethod}" desconhecido`)
    if (imp.reconstructionVersion !== RECONSTRUCTION_VERSION) return skip(S_VERSION, `reconstrução: o import usou a versão "${imp.reconstructionVersion}", a atual é "${RECONSTRUCTION_VERSION}" (não é adulteração)`)
  }
  const s = imp.settings
  if (s.sourceTzOrigin === undefined) return skip(S_CONTEXT, "settings.sourceTzOrigin ausente: não se sabe se o fuso foi informado ou assumido")
  if (s.sourceTzOrigin === "FILE_DECLARED") return skip(S_CONTEXT, "sourceTzOrigin FILE_DECLARED: nenhum parser atual reproduz fuso declarado pelo formato")
  if (s.sourceTzOrigin === "USER" && !s.sourceTz) return skip(S_CONTEXT, "sourceTzOrigin USER sem sourceTz registrado")
  if (s.sourceTzOrigin === "DEFAULT" && s.sourceTz !== DEFAULT_SOURCE_TIME_ZONE) return skip(S_CONTEXT, `o import assumiu o fuso padrão "${s.sourceTz}", e o padrão atual é "${DEFAULT_SOURCE_TIME_ZONE}": a leitura não pode ser reproduzida sem o mesmo padrão`)
  return null
}

function recordDiffs(re: ImportRecord, imp: ImportRef): string[] {
  const d: string[] = []
  const cmp = (name: string, a: unknown, b: unknown) => { if (canonicalJson(a ?? null) !== canonicalJson(b ?? null)) d.push(name) }
  cmp("parserId", re.parserId, imp.parserId)
  cmp("parserVersion", re.parserVersion, imp.parserVersion)
  cmp("reconstructionMethod", re.reconstructionMethod, imp.reconstructionMethod)
  cmp("reconstructionVersion", re.reconstructionVersion, imp.reconstructionVersion)
  cmp("rowsRead", re.rowsRead, imp.rowsRead)
  cmp("rowsAccepted", re.rowsAccepted, imp.rowsAccepted)
  cmp("rowsRejected", re.rowsRejected, imp.rowsRejected)
  cmp("accountCount", re.accountCount, imp.accountCount)
  for (const k of ["sourceTz", "sourceTzOrigin", "dateOrder", "numberLocale", "excursionUnit", "declaredPnlBasis"] as const) cmp(`settings.${k}`, re.settings[k], imp.settings[k])
  return d
}

function verifyImport(imp: ImportRef, tradesOf: TradeEvidence[], bytes: Uint8Array | undefined, opts: VerifySourceOptions, parsers: ParserDescriptor[]): PerImport {
  const blocked = (why: string): Outcome => skip(S_FILE_FIRST, why)
  const out: PerImport = {
    file: skip(S_NOT_EXECUTED, "check não executado"),
    context: blocked("o arquivo não foi verificado"),
    importId: blocked("o arquivo não foi verificado"),
    rows: [],
    trades: [],
    values: [],
    verifiedRows: new Set(),
    verifiedTrades: new Set(),
    referencedRows: new Set(tradesOf.flatMap((t) => t.sourceRows.map((r) => r.rowNo))),
    reingested: false,
  }
  const downstream = (o: Outcome) => { out.rows = [o]; out.trades = [o]; out.values = [o] }
  const label = `import ${short(imp.importId)}`

  // V5.1 — arquivo (bytes exatos; BOM e quebra de linha ficam preservados na decodificação)
  if (!bytes) {
    out.file = skip(S_NOT_PROVIDED, `${label}: arquivo original não fornecido`)
    out.context = skip(S_NOT_PROVIDED, `${label}: sem o arquivo não há o que reexecutar`)
    out.importId = out.context
    downstream(out.context)
    return out
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    out.file = skip(S_ENCODING, `${label}: o arquivo não é UTF-8 válido; o import foi registrado sobre texto UTF-8 (hashBasis ${imp.hashBasis}) e não pode ser reproduzido a partir destes bytes`)
    downstream(out.file)
    out.context = out.file
    out.importId = out.file
    return out
  }
  const d = describeText(text)
  if (sha256Hex(bytes) !== d.fileSha256) {
    // não deveria ocorrer com UTF-8 estrito + BOM preservado; se ocorrer, não se afirma nada sobre o arquivo
    out.file = skip(S_ENCODING, `${label}: a decodificação não reproduz os bytes (SHA-256 dos bytes ≠ do texto UTF-8)`)
    downstream(out.file)
    out.context = out.file
    out.importId = out.file
    return out
  }
  const diffs: string[] = []
  if (d.fileSha256 !== imp.fileSha256) diffs.push(`SHA-256 do arquivo ${short(d.fileSha256)} ≠ registrado ${short(imp.fileSha256)}`)
  if (d.fileBytes !== imp.fileBytes) diffs.push(`tamanho ${d.fileBytes} bytes ≠ registrado ${imp.fileBytes}`)
  if (d.hasBom !== imp.hasBom) diffs.push(`BOM: o arquivo ${d.hasBom ? "tem" : "não tem"}, o import registrado ${imp.hasBom ? "tinha" : "não tinha"}`)
  if (d.lineEnding !== imp.lineEnding) diffs.push(`quebra de linha ${d.lineEnding} ≠ registrada ${imp.lineEnding}`)
  if (d.hashBasis !== imp.hashBasis) diffs.push(`base do hash ${d.hashBasis} ≠ ${imp.hashBasis}`)
  if (diffs.length > 0) {
    out.file = fail(FAIL.FILE, `${label}: o arquivo fornecido não é o do import registrado — ${diffs.join("; ")}`)
    const why = blocked("o arquivo fornecido não é o do import")
    out.context = why
    out.importId = why
    downstream(why)
    return out
  }
  out.file = pass(`${label}: ${d.fileBytes} bytes, SHA-256 ${short(d.fileSha256)}, ${d.hasBom ? "com" : "sem"} BOM, ${d.lineEnding} = registrados`)

  // V5.2 — contexto
  const problem = contextProblem(imp, parsers)
  if (problem) {
    out.context = { ...problem, detail: `${label}: ${problem.detail}` }
    out.importId = skip(problem.code as string, `${label}: sem contexto reproduzível`)
    downstream(out.importId)
    return out
  }
  const run: PipelineResult = runImportPipeline(text, contextOf(imp, opts), parsers)
  if (!run.importRecord) {
    out.context = skip(S_REINGEST, `${label}: a reingestão não produziu um import (${[...new Set(run.issues.map((i) => i.code))].join(", ") || "sem detalhe"})`)
    out.importId = out.context
    downstream(out.context)
    return out
  }
  out.reingested = true
  out.context = pass(`${label}: parser ${imp.parserId}@${imp.parserVersion}${imp.reconstructionMethod ? `, reconstrução ${imp.reconstructionMethod}@${imp.reconstructionVersion}` : ", sem reconstrução"}, fuso ${imp.settings.sourceTzOrigin}; foldPolicy/exitReasonMap/accountRefSalt: ${opts.foldPolicy !== undefined || opts.exitReasonMap !== undefined || opts.accountRefSalt !== undefined ? "informados pelo chamador" : "padrão"}`)

  // V5.3 — importId e registro
  const re = run.importRecord
  const recDiffs = recordDiffs(re, imp)
  if (re.importId !== imp.importId) out.importId = fail(FAIL.IMPORT_ID, `${label}: o importId reconstruído (${short(re.importId)}) ≠ o registrado${recDiffs.length ? ` (campos do registro que também divergem: ${recDiffs.join(", ")})` : ""}`)
  else if (recDiffs.length > 0) out.importId = fail(FAIL.IMPORT_RECORD, `${label}: importId igual, mas o registro do import diverge da reingestão em: ${recDiffs.join(", ")}`)
  else out.importId = pass(`${label}: importId ${short(re.importId)} e registro (parser, linhas lidas/aceitas/rejeitadas, contas, configurações) = reingestão`)

  // referências da reingestão
  const reRowHash = new Map<number, string>()
  const reRowAccount = new Map<number, string | null>()
  for (const r of run.rowTrades) {
    if (r.source.rowNo !== null && r.source.rowHash) reRowHash.set(r.source.rowNo, r.source.rowHash)
    if (r.source.rowNo !== null) reRowAccount.set(r.source.rowNo, r.account.ref ?? null)
  }
  const reTradeById = new Map(run.trades.map((t) => [t.tradeId as string, t]))
  const accountNames = [...new Set(run.rowTrades.map((t) => t.account.sourceName?.trim()).filter((n): n is string => !!n))].sort()
  const mine = tradesOf.filter((t) => t.importId === imp.importId)

  // sal do accountRef: se TODAS as contas citadas divergem, o problema é o contexto (sal), não adulteração seletiva
  const withRows = mine.filter((t) => t.sourceRows.length > 0)
  if (withRows.length > 0 && withRows.every((t) => reRowAccount.has(t.sourceRows[0].rowNo) && reRowAccount.get(t.sourceRows[0].rowNo) !== t.accountRef)) {
    const why = skip(S_ACCOUNT_REF, `${label}: o accountRef de TODOS os trades citados difere do da reingestão — o accountRefSalt informado (${opts.accountRefSalt === undefined ? "nenhum" : "outro"}) não é o da importação original, ou o accountRef foi alterado; sem o sal correto linhas e trades não são comparáveis (não é tratado como adulteração)`)
    out.rows = [why]
    out.trades = [why]
    out.values = [why]
    return out
  }

  if (mine.length === 0) {
    const na = skip(S_NOT_APPLICABLE, `${label}: nenhum trade do bundle cita este import`)
    out.rows = [na]
    out.trades = [na]
    out.values = [na]
    return out
  }

  // V5.4 — linhas citadas
  const refs = new Map<number, string[]>() // rowNo → tradeIds que a citam
  for (const t of mine) for (const r of t.sourceRows) refs.set(r.rowNo, [...(refs.get(r.rowNo) ?? []), t.tradeId])
  const dup = [...refs].filter(([, ids]) => ids.length > 1).map(([n]) => n).sort((a, b) => a - b)
  if (dup.length > 0) out.rows.push(fail(FAIL.ROW_DUP, `${label}: linha(s) citada(s) mais de uma vez: ${listed(dup.map(String))} (cada linha pertence a um só trade)`))
  const missing: number[] = []
  const wrong: number[] = []
  const noHash: number[] = []
  for (const t of mine) {
    for (const r of t.sourceRows) {
      if (r.rowHash === null) { noHash.push(r.rowNo); continue }
      const have = reRowHash.get(r.rowNo)
      if (have === undefined) missing.push(r.rowNo)
      else if (have !== r.rowHash) wrong.push(r.rowNo)
      else out.verifiedRows.add(r.rowNo)
    }
  }
  const u = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b).map(String)
  if (missing.length > 0) out.rows.push(fail(FAIL.ROW_MISSING, `${label}: ${u(missing).length} linha(s) citada(s) não existe(m) (ou foi rejeitada) na reingestão: linha(s) ${listed(u(missing))}`))
  if (wrong.length > 0) out.rows.push(fail(FAIL.ROW_HASH, `${label}: ${u(wrong).length} de ${u([...wrong, ...out.verifiedRows]).length} linha(s) com rowHash ≠ da reingestão: linha(s) ${listed(u(wrong))}`))
  if (noHash.length > 0) out.rows.push(skip(S_ROWHASH_MISSING, `${label}: ${u(noHash).length} linha(s) sem rowHash no bundle (proveniência incompleta): ${listed(u(noHash))}`))
  if (out.rows.length === 0) out.rows.push(pass(`${label}: ${out.verifiedRows.size} linha(s) citada(s) existem com o rowHash registrado`))

  // V5.5 — trades: identidade e composição; valores via a MESMA projeção do E3 sobre a reingestão
  const pending: Array<{ t: TradeEvidence; re: ReturnType<typeof reTradeById.get> & object }> = []
  const noId: string[] = []
  const badStruct: string[] = []
  const seen = new Set<string>()
  const dupIds: string[] = []
  for (const t of mine) {
    if (seen.has(t.tradeId)) dupIds.push(t.tradeId)
    seen.add(t.tradeId)
    if (t.tradeId.includes("#")) { noId.push(t.tradeId); continue } // sufixo "#n" é id interno do motor, não identidade canônica
    const re1 = reTradeById.get(t.tradeId)
    if (!re1) { noId.push(t.tradeId); continue }
    const reRows = re1.granularity === "POSITION_CYCLE" ? (re1.sourceRows ?? []).map((r) => ({ rowNo: r.rowNo, rowHash: r.rowHash ?? null })) : [{ rowNo: re1.source.rowNo as number, rowHash: re1.source.rowHash ?? null }]
    const a = canonicalJson(rowsOf(t).sort((x, y) => x.rowNo - y.rowNo))
    const b = canonicalJson(reRows.sort((x, y) => x.rowNo - y.rowNo))
    if (a !== b) { badStruct.push(`${short(t.tradeId)} (linhas/hashes)`); continue }
    pending.push({ t, re: re1 })
  }
  if (dupIds.length > 0) out.trades.push(fail(FAIL.TRADE_ID, `${label}: tradeId repetido no bundle: ${listed(dupIds.map(short))}`))
  if (noId.length > 0) out.trades.push(fail(FAIL.TRADE_ID, `${label}: ${noId.length} tradeId(s) que a reingestão não produz (id alterado, composição diferente ou id interno "#n"): ${listed(noId.map(short))}`))
  if (badStruct.length > 0) out.trades.push(fail(FAIL.TRADE_STRUCTURE, `${label}: ${badStruct.length} trade(s) com as linhas de origem diferentes das da reingestão: ${listed(badStruct)}`))

  const explained = pending.length > 0
    ? explainTrades(pending.map((p) => p.re), re, { ...(opts.accountRefSalt !== undefined ? { accountRefSalt: opts.accountRefSalt } : {}), knownAccountNames: accountNames })
    : []
  const structBad: string[] = []
  const valuesBad: string[] = []
  let explainFailed = 0
  pending.forEach((p, i) => {
    const ex = explained[i]
    if (!ex.ok) { explainFailed += 1; return }
    const s = differing(p.t, ex.tradeEvidence, STRUCTURE_FIELDS)
    const v = differing(p.t, ex.tradeEvidence, VALUE_FIELDS)
    if (s.length > 0) structBad.push(`${short(p.t.tradeId)} (${s.join(", ")})`)
    if (v.length > 0) valuesBad.push(`${short(p.t.tradeId)} (${v.join(", ")})`)
    if (s.length === 0 && v.length === 0 && wrong.length === 0) out.verifiedTrades.add(p.t.tradeId)
  })
  if (structBad.length > 0) out.trades.push(fail(FAIL.TRADE_STRUCTURE, `${label}: ${structBad.length} trade(s) com granularidade/conta/reconstrução ≠ reingestão: ${listed(structBad)}`))
  if (explainFailed > 0) out.trades.push(skip(S_REINGEST, `${label}: ${explainFailed} trade(s) da reingestão não puderam ser projetados (E3)`))
  if (out.trades.length === 0) out.trades.push(pass(`${label}: ${pending.length} trade(s): tradeId, granularidade, conta, reconstrução e composição de linhas = reingestão (SOURCE_ROW e ciclos)`))
  out.values = valuesBad.length > 0
    ? [fail(FAIL.TRADE_VALUES, `${label}: ${valuesBad.length} trade(s) com valores derivados do arquivo diferentes da reingestão (só os campos, nunca os valores): ${listed(valuesBad)}`)]
    : pending.length === 0
      ? [skip(S_NOT_APPLICABLE, `${label}: nenhum trade comparável para conferir valores`)]
      : [pass(`${label}: ${pending.length} trade(s): instrumento, direção, quantidade, preços, horários, P&L, pernas, excursões e linhas de origem = reingestão (R, risco, issues e fieldProvenance ficam fora: L_USER_ENRICHMENT_NOT_PROVEN)`)]
  return out
}

function emptyReport(status: SourceStatus, detail: string): SourceVerifyReport {
  const checks: SourceCheck[] = SOURCE_CHECK_CATALOG.map((c) =>
    c.id === "V5.format"
      ? { id: c.id, status: "FAIL", code: "V_SOURCE_FORMAT_INVALID", detail }
      : { id: c.id, status: "SKIPPED", code: "S_FORMAT_INVALID", detail: "não executado: o bundle não é evidence/1 legível" },
  )
  return { schema: VERIFY_SOURCE_SCHEMA, status, evidenceHash: null, checks, coverage: null, limitations: SOURCE_LIMITATIONS.map((l) => ({ ...l })) }
}

/**
 * Verifica a proveniência do bundle contra os bytes do CSV original de cada import.
 * `files`: importId do bundle → bytes do arquivo (Record ou Map). Nunca lança para entrada malformada.
 */
export function verifyEvidenceSource(input: unknown, files: SourceFiles, options: VerifySourceOptions = {}): SourceVerifyReport {
  const parsed = EvidenceBundleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return emptyReport("INVALID_FORMAT", `bundle fora do schema evidence/1: ${first?.path.join(".") || "(raiz)"} — ${first?.message ?? "inválido"}`)
  }
  const bundle: EvidenceBundle = parsed.data
  const parsers = options.parsers ?? DEFAULT_PARSERS
  const imports = bundle.evidence.imports
  const trades = bundle.evidence.trades

  const per = new Map<string, PerImport>()
  const unknownImports: string[] = []
  for (const imp of imports) per.set(imp.importId, verifyImport(imp, trades, filesGet(files, imp.importId), options, parsers))
  const importIds = new Set(imports.map((i) => i.importId))
  for (const t of trades) if (!importIds.has(t.importId)) unknownImports.push(t.tradeId)

  const all = [...per.values()]
  const rowsOutcomes = all.flatMap((p) => p.rows)
  const outcomes = new Map<string, Outcome>([
    ["V5.format", pass("evidence/1 legível")],
    ["V5.file", imports.length === 0 ? skip(S_NO_IMPORTS, "o bundle não tem nenhum ImportRef: não há arquivo a que ligar os dados") : combine(all.map((p) => p.file))],
    ["V5.context", combine(all.map((p) => p.context))],
    ["V5.import-id", combine(all.map((p) => p.importId))],
    ["V5.rows", combine(rowsOutcomes)],
    ["V5.trades", combine([...all.flatMap((p) => p.trades), ...(unknownImports.length > 0 ? [fail(FAIL.IMPORT_REF, `${unknownImports.length} trade(s) apontam para um import sem ImportRef no bundle: ${listed(unknownImports.map(short))}`)] : [])])],
    ["V5.values", combine(all.flatMap((p) => p.values))],
  ])

  const metrics = bundle.evidence.metrics
  const hashOnly = metrics.filter((m) => m.verifiability === "HASH_ONLY").length
  const full = metrics.length - hashOnly
  outcomes.set(
    "V5.coverage",
    metrics.length === 0
      ? skip(S_NOT_APPLICABLE, "bundle sem métricas: não há população declarada")
      : hashOnly === 0
        ? pass(`${full} métrica(s) com a população declarada INTEIRA listada: todos os trades da população foram comparados com a fonte (a seleção original continua não provada)`)
        : skip(S_PARTIAL, `${hashOnly} de ${metrics.length} métrica(s) em HASH_ONLY: só o tradeSetHash e as âncoras estão no bundle; as referências presentes foram conferidas, a população completa NÃO pode ser conferida contra a fonte`),
  )

  const checks: SourceCheck[] = SOURCE_CHECK_CATALOG.map((c) => {
    const o = outcomes.get(c.id) ?? skip(S_NOT_EXECUTED, "check não executado")
    return { id: c.id, status: o.status, code: o.status === "PASS" ? null : (o.code ?? null), detail: o.detail }
  })

  const refRows = all.reduce((n, p) => n + p.referencedRows.size, 0)
  const coverage: SourceCoverage = {
    imports: {
      declared: imports.length,
      sourceProvided: imports.filter((i) => filesGet(files, i.importId) !== undefined).length,
      fileVerified: all.filter((p) => p.file.status === "PASS").length,
      reingested: all.filter((p) => p.reingested).length,
    },
    rows: { referenced: refRows, verified: all.reduce((n, p) => n + p.verifiedRows.size, 0) },
    trades: { referenced: new Set(trades.map((t) => t.tradeId)).size, verified: all.reduce((n, p) => n + p.verifiedTrades.size, 0) },
    populations: { metrics: metrics.length, full, hashOnly, complete: metrics.length > 0 && hashOnly === 0 },
    selection: "NOT_VERIFIED",
    originalSequenceOrder: "NOT_VERIFIED",
    userEnrichment: "NOT_VERIFIED",
  }

  const blocking = checks.some((c) => c.status === "SKIPPED" && c.code !== S_NOT_APPLICABLE && c.code !== S_PARTIAL)
  let status: SourceStatus
  if (checks.some((c) => c.status === "FAIL")) status = "SOURCE_MISMATCH"
  else if (blocking) status = "UNVERIFIABLE"
  else if (checks.some((c) => c.code === S_PARTIAL)) status = "SOURCE_VERIFIED_PARTIAL"
  else status = "SOURCE_VERIFIED"
  return { schema: VERIFY_SOURCE_SCHEMA, status, evidenceHash: bundle.evidenceHash, checks, coverage, limitations: SOURCE_LIMITATIONS.map((l) => ({ ...l })) }
}
