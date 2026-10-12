// verifyEvidenceSource (Evidence E5b): proveniência da Evidence contra o ARQUIVO ORIGINAL.
//
//   EvidenceBundle + bytes do CSV → V5.file (bytes ⇒ SHA-256) → V5.context → reingestão com o contexto do ImportRef → comparação de
//   importId, rowHash, tradeId e valores derivados do arquivo → relatório (o que foi verificado e o que ficou pendente).
//
// NÃO é segundo pipeline nem segundo hash: a reingestão é `runImportPipeline`; hashes e identidade são os de `ingest/identity.ts` e
// `infra/hash.ts`; a projeção de cada trade é `explainTrades` (E3). Aqui só se COMPARA. Puro: sem relógio, random, banco, rede nem
// caminho de arquivo (quem chama entrega os BYTES; o CSV nunca entra no bundle nem no relatório).
//
// ╔══ NUNCA LER ISOLADO ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║ `SOURCE_VERIFIED` (e `SOURCE_VERIFIED_PARTIAL`) NÃO significa "tudo ok". Este verificador liga os TRADES do bundle ao CSV; ele NÃO confere ║
// ║ o selo, as referências, os números das métricas nem os resultados DERIVADOS (ranking/comparação): isso é do `verifyEvidence` (V0–V6).     ║
// ║ Exemplos reais (scripts/expectations/derived-legrefs-edge.expected.json): derivado com valor adulterado e selo refeito, citação de perna ║
// ║ duplicada, lista de citações fora de ordem ou com item removido ⇒ E5b diz SOURCE_VERIFIED e o V6 diz TAMPERED. O E5b confere CADA citação ║
// ║ contra o arquivo; completude/ordem/duplicidade da lista de citações é do V6.                                                              ║
// ║ Regra para qualquer consumidor (UI, relatório, agente/E6.5): só se afirma "verificado" com o veredito COMBINADO sobre o MESMO              ║
// ║ `evidenceHash`: `verifyEvidence` = VALID (incluindo V6 quando há derivados) E `verifyEvidenceSource` ∈ {SOURCE_VERIFIED, …_PARTIAL, dito}. ║
// ╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
// Independe do `verifyEvidence` (V0–V4): aquele prova consistência interna e reprodução matemática da população declarada; este liga
// os dados à fonte. `SOURCE_VERIFIED` + `VALID` juntos é o que se pode afirmar; nenhum dos dois sozinho prova o outro.
//
// Status (nunca confunde indisponibilidade com adulteração):
//   INVALID_FORMAT           o bundle não é `evidence/1`
//   SOURCE_MISMATCH          algum FAIL: arquivo ≠ import registrado, importId/rowHash/tradeId/valores divergem
//   UNVERIFIABLE             sem FAIL, mas algo bloqueante não pôde ser conferido (arquivo/contexto/versão ausentes ou incompatíveis…)
//   SOURCE_VERIFIED_PARTIAL  tudo que está NO bundle confere, mas a população de alguma métrica é parcial (HASH_ONLY: só âncoras)
//   SOURCE_VERIFIED          tudo que está no bundle confere e toda população declarada está listada
// E6.3→E5b: a "população declarada" inclui a de cada DERIVADO (`evidence.derived[].population`): FULL = `tradeIds` listados e os TradeEvidence
// no bundle (comparados com a fonte como qualquer outro trade; as referências de pernas do derivado também); HASH_ONLY ou ids ausentes do bundle
// = população parcial. Verificar todos os trades de um derivado prova que os trades DECLARADOS vêm do arquivo — NÃO que os filtros originais
// selecionaram a população correta nem que ela é a importação inteira (L_DERIVED_POPULATION_SCOPE).
// `SOURCE_VERIFIED*` NÃO prova a seleção original, a ordem original da sequência nem o que o usuário acrescentou depois (R/stop): ver `limitations`.

import type { CanonicalTrade, ImportRecord } from "../domain/canonical.ts"
import { DEFAULT_SOURCE_TIME_ZONE } from "../domain/time.ts"
import { canonicalJson, sha256Hex } from "../infra/hash.ts"
import { describeText, IDENTITY_VERSIONS, patternRef } from "../ingest/identity.ts"
import { runImportPipeline } from "../ingest/pipeline.ts"
import { RECONSTRUCTION_VERSION } from "../ingest/reconstruct.ts"
import { DEFAULT_PARSERS } from "../ingest/registry.ts"
import type { ImportContext, ParserDescriptor, PipelineResult } from "../ingest/types.ts"
import { explainTrades, projectReproducibility } from "./explain-trade.ts"
import { LABEL_VOCAB_VERSION } from "./label-vocab.ts"
import { isStrongSalt, saltCheck, type SaltProvider } from "../ingest/salt.ts"
import { EvidenceBundleSchema, type EvidenceBundle, type ImportRef, type TradeEvidence } from "./schema.ts"

export const VERIFY_SOURCE_SCHEMA = "verify-source/1" as const

/** ATENÇÃO: nenhum destes estados, sozinho, é 'tudo ok' — leia SEMPRE junto do `VerifyReport` do mesmo `evidenceHash` (ver o bloco "NUNCA LER ISOLADO" no topo do arquivo). */
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
  imports: { declared: number; sourceProvided: number; fileVerified: number; reingested: number; contextRecorded: number }
  /** Linhas do arquivo citadas pelo bundle (únicas) e quantas conferem rowNo+rowHash com a reingestão. */
  rows: { referenced: number; verified: number }
  /** TradeEvidence do bundle (únicos) e quantos conferem identidade, estrutura e valores com a reingestão. */
  trades: { referenced: number; verified: number }
  /**
   * Métricas do bundle: população listada (FULL) × só hash e âncoras (HASH_ONLY). `complete` considera TAMBÉM os derivados (E6.3): verdadeiro só se há
   * ao menos uma população declarada e nenhuma é HASH_ONLY nem parcial. `metrics/full/hashOnly` continuam sendo só das métricas (bundles antigos: iguais).
   */
  populations: { metrics: number; full: number; hashOnly: number; complete: boolean }
  /**
   * Derivados (E6.3). `scope` é FIXO: a verificação cobre a população DECLARADA de cada derivado — não prova que os filtros originais a
   * selecionaram corretamente nem que ela é a população completa da importação.
   */
  derived: {
    total: number
    full: number
    hashOnly: number
    /** FULL, mas com ids da população ausentes do bundle (não dá para conferir esses trades com a fonte). */
    partial: number
    trades: { declared: number; inBundle: number; verified: number }
    legRefs: { declared: number; verified: number }
    scope: "DECLARED_POPULATION"
  }
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
  { code: "L_CONTEXT_FROM_BUNDLE_AND_CALLER", text: "O contexto da reingestão vem do ImportRef. Imports com `reproducibility` registram as versões das funções de identidade, foldPolicy, exitReasonMap e se houve sal; imports ANTERIORES não têm esse bloco (nunca é inferido) e dependem de foldPolicy/exitReasonMap/versões informados ou padrão — uma diferença aparece como divergência. O VALOR do accountRefSalt nunca é gravado: quem verifica precisa tê-lo." },
  { code: "L_BUNDLE_INTEGRITY_NOT_CHECKED", text: "O selo e a consistência interna do bundle (V0–V4, e V6 para derivados) são do verifyEvidence; esta verificação só liga o bundle à fonte. SOURCE_VERIFIED ISOLADO NÃO significa \"tudo ok\": só vale junto de VALID do verifyEvidence sobre o MESMO evidenceHash." },
]

/** Só entra no relatório quando o bundle tem derivados (os bundles anteriores mantêm exatamente as 5 limitações). */
const DERIVED_SCOPE_LIMITATION: SourceLimitation = {
  code: "L_DERIVED_POPULATION_SCOPE",
  text: "Para derivados, confere os trades DECLARADOS na população de cada análise (e as pernas que ela cita) contra o arquivo. Não prova que os filtros originais selecionaram essa população corretamente, nem que ela é a população completa da importação.",
}

/** Só entram no relatório quando se aplicam (bundles sem declaração de sal mantêm exatamente as limitações de antes). */
const SALT_LIMITATIONS: ReadonlyArray<SourceLimitation> = [
  { code: "L_SALT_CHECK_DIVERGENT", text: "O saltCheck declarado no ImportRef não bate com o do sal resolvido pelo provider. Os refs foram conferidos de verdade com esse sal e batem: o bundle carrega uma autodeclaração incorreta. Não é prova de adulteração dos dados, mas deve ser investigada." },
  { code: "L_SALT_ID_NOT_RESOLVED", text: "O saltId declarado no ImportRef não resolve no provider (inexistente ou aposentado). Os refs foram reproduzidos por outro sal conhecido do usuário: a declaração do bundle está errada. Não é prova de adulteração dos dados." },
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
  DERIVED_LEG_REF: "V_DERIVED_LEG_REF_MISMATCH",
  /** Política de sal (P4): saltCheck declarado ≠ do sal resolvido E os refs também divergem (reforça; nunca vira UNVERIFIABLE). */
  SALT_CHECK: "V_SALT_CHECK_MISMATCH",
  /** Declara saltId num import que NÃO usou sal (contradição estrutural; o gerador nunca emite isso). */
  SALT_DECLARATION: "V_SALT_DECLARATION_INCONSISTENT",
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
const S_DERIVED_UNVERIFIED = "S_DERIVED_TRADES_NOT_VERIFIED"
/** Bloqueantes (UNVERIFIABLE): o provider não tem NENHUM sal para o saltId declarado (nunca cadastrado / aposentado sem valor) e nenhum sal conhecido do usuário reproduz os refs. NÃO é prova de integridade. */
const S_SALT_UNKNOWN = "S_SALT_UNKNOWN"
const S_SALT_RETIRED = "S_SALT_RETIRED"

export const SOURCE_CHECK_CATALOG: ReadonlyArray<{ id: string; title: string }> = [
  { id: "V5.format", title: "bundle evidence/1 legível (schema strict)" },
  { id: "V5.file", title: "V5.1 arquivo original: SHA-256 dos bytes, tamanho, BOM, quebra de linha" },
  { id: "V5.context", title: "V5.2 contexto da importação reproduzível (parser, versões, fuso, reconstrução)" },
  { id: "V5.import-id", title: "V5.3 importId e registro do import reconstruídos pela reingestão" },
  { id: "V5.rows", title: "V5.4 linhas citadas: existem e têm o rowHash registrado" },
  { id: "V5.trades", title: "V5.5 tradeId, granularidade e composição (linhas/reconstrução) conferem com a reingestão" },
  { id: "V5.values", title: "V5.5 valores derivados do arquivo (preços, P&L, horários, pernas) conferem com a reingestão" },
  { id: "V5.derived", title: "V5.7 derivados: trades e pernas da população declarada conferem com a fonte (E6.3)" },
  { id: "V5.coverage", title: "V5.6 cobertura: população listada × só âncoras (métricas e derivados)" },
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
  // SKIPPED bloqueante vence o parcial (doc acima): um S_POPULATION_PARTIAL na frente não pode esconder um bloqueio atrás dele
  if (skips.length > 0) return skip((skips.find((p) => p.code !== S_PARTIAL) ?? skips[0]).code as string, join(skips))
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
  /** Trades da REINGESTÃO por tradeId (para conferir as pernas citadas pelos derivados). Vazio se a reingestão não ocorreu. */
  reTrades: Map<string, CanonicalTrade>
  referencedRows: Set<number>
  reingested: boolean
  /** Códigos de limitação da política de sal (L_SALT_*) que passam ao relatório. */
  saltNotes: string[]
}

export interface VerifySourceOptions {
  /** Sal do `account.ref` usado na importação original (não está no bundle). Sem ele, bundles com contas só verificam arquivo e importId. */
  accountRefSalt?: string
  foldPolicy?: ImportContext["foldPolicy"]
  exitReasonMap?: ImportContext["exitReasonMap"]
  /** Parsers disponíveis (padrão: o registro atual). Existe para testar incompatibilidade de versão. */
  parsers?: ParserDescriptor[]
  /**
   * Política de sal (P4): provider + dono dos bundles. Resolve `reproducibility.saltId` (o valor do sal nunca vem do bundle). Para bundles COM saltId o
   * provider vence a string `accountRefSalt` (O3). Sem provider, a string vale como sal candidato (compatibilidade). Bundles SEM saltId: comportamento de sempre.
   */
  salt?: { provider: SaltProvider; userId: string }
}

export type SourceFiles = Record<string, Uint8Array> | ReadonlyMap<string, Uint8Array>

const filesGet = (files: SourceFiles, importId: string): Uint8Array | undefined => (files instanceof Map ? files.get(importId) : (files as Record<string, Uint8Array>)[importId])

const rowsOf = (t: TradeEvidence): Array<{ rowNo: number; rowHash: string | null }> => t.sourceRows.map((r) => ({ rowNo: r.rowNo, rowHash: r.rowHash }))

/** Campos do TradeEvidence comparados por check. Fora: r, risk, issues, fieldProvenance (não derivam só do arquivo: L_USER_ENRICHMENT_NOT_PROVEN). */
/** Pista (só texto; NÃO muda o veredito): import salgado + sal informado + divergência em accountRef/strategyRef/labelRef ⇒ causa provável = sal não propagado na GERAÇÃO. */
function saltHint(imp: { reproducibility?: { accountRefSalted?: boolean } }, struct: string[], values: string[], salt: string | undefined): string {
  if (!imp.reproducibility?.accountRefSalted || !salt) return ""
  const refs = [...struct, ...values].some((x) => /accountRef|strategyRef|labelRef|sourceLabel|reconstruction/.test(x))
  return refs ? " [possível causa: o sal do import não foi propagado na geração da Evidence — não é prova de adulteração]" : ""
}
const STRUCTURE_FIELDS = ["importId", "provenance", "granularity", "accountRef", "reconstruction"] as const
const VALUE_FIELDS = ["instrument", "direction", "quantity", "peakQuantity", "entry", "exit", "pnl", "pointsPerContract", "entryLegs", "exitLegs", "exitSummary", "excursions", "sourceRows"] as const

function differing(a: TradeEvidence, b: TradeEvidence, fields: readonly (keyof TradeEvidence)[]): string[] {
  return fields.filter((f) => canonicalJson(a[f] ?? null) !== canonicalJson(b[f] ?? null)).map(String)
}

/**
 * O contexto da reingestão sai do ImportRef. Quando o registro tem `reproducibility`, ele MANDA (foldPolicy, exitReasonMap, sal sim/não);
 * a opção do chamador só vale para o que o registro não cobre (registros anteriores) e para o VALOR do sal, que nunca é gravado.
 */
export function sourceContextOf(imp: ImportRef, opts: VerifySourceOptions): ImportContext {
  const s = imp.settings
  const rep = imp.reproducibility
  const salt = rep ? (rep.accountRefSalted ? opts.accountRefSalt : undefined) : opts.accountRefSalt
  return {
    forceParserId: imp.parserId,
    ...(s.sourceTzOrigin === "USER" && s.sourceTz ? { sourceTz: s.sourceTz } : {}),
    ...(s.dateOrder ? { dateOrder: s.dateOrder } : {}),
    numberLocale: s.numberLocale,
    excursionUnit: s.excursionUnit,
    declaredPnlBasis: s.declaredPnlBasis,
    reconstructCycles: imp.reconstructionMethod !== null,
    ...(salt !== undefined ? { accountRefSalt: salt } : {}),
    // S2b: o ImportRef guarda só `patternRef`; o regex vem do CHAMADOR e já foi conferido contra os patternRef em `contextProblem` (mapa vazio ⇒ nada a informar)
    ...(rep ? { foldPolicy: rep.foldPolicy, exitReasonMap: rep.exitReasonMap.length === 0 ? [] : (opts.exitReasonMap ?? []).map((r) => ({ pattern: r.pattern, reason: r.reason })) } : {
      ...(opts.foldPolicy !== undefined ? { foldPolicy: opts.foldPolicy } : {}),
      ...(opts.exitReasonMap !== undefined ? { exitReasonMap: opts.exitReasonMap } : {}),
    }),
  }
}

function contextProblem(imp: ImportRef, parsers: ParserDescriptor[], opts: VerifySourceOptions): Outcome | null {
  // mapa de motivos do USUÁRIO (decisão C do sourceLabel): o bundle só tem `patternRef`; sem o regex não há como reingerir. Ausente/divergente ⇒ UNVERIFIABLE, nunca adulteração
  const map = imp.reproducibility?.exitReasonMap ?? []
  if (imp.reproducibility && map.length > 0) {
    if (imp.reproducibility.accountRefSalted && !opts.accountRefSalt) return skip(S_ACCOUNT_REF, "o import usou accountRefSalt e tem mapa de motivos do usuário: sem o sal não dá para conferir os patternRef (o valor do sal não é gravado)")
    const supplied = opts.exitReasonMap ?? []
    if (supplied.length === 0) return skip(S_CONTEXT, `o import tinha mapa de motivos do usuário (${map.length} regra(s)); o ImportRef guarda só patternRef (o texto do regex não vai no bundle): informe o mapa em \`exitReasonMap\` — sem ele a leitura não é reproduzível (não é adulteração)`)
    const salt = imp.reproducibility.accountRefSalted ? (opts.accountRefSalt as string) : ""
    const bad = supplied.length !== map.length || supplied.some((m, i) => patternRef(m.pattern, salt) !== map[i].patternRef || m.reason !== map[i].reason)
    if (bad) return skip(S_CONTEXT, `o mapa de motivos informado (${supplied.length} regra(s)) não bate com os ${map.length} patternRef registrados (ordem, padrão ou motivo diferentes): o regex informado não é o do import (não é adulteração do bundle)`)
  }
  // vocabulário de rótulos (sourceLabel, decisão D): outra versão não é adulteração — os rótulos projetados não são reproduzíveis com este código
  if (imp.labelVocab !== undefined && imp.labelVocab !== LABEL_VOCAB_VERSION) return skip(S_VERSION, `vocabulário de rótulos v${imp.labelVocab} ≠ v${LABEL_VOCAB_VERSION} deste código: os rótulos projetados (palavras e tokens) não podem ser reproduzidos (não é adulteração)`)
  const parser = parsers.find((p) => p.id === imp.parserId)
  if (!parser) return skip(S_CONTEXT, `parser "${imp.parserId}" não existe neste registro: não dá para reexecutar a leitura`)
  if (parser.version !== imp.parserVersion) return skip(S_VERSION, `parser ${imp.parserId}: o import usou a versão "${imp.parserVersion}", o registro atual tem "${parser.version}" — a identidade não pode ser reproduzida com outra versão (não é adulteração)`)
  if (imp.reconstructionMethod !== null) {
    if (imp.reconstructionMethod !== "NT8_ROW_INTERVALS_V1") return skip(S_CONTEXT, `método de reconstrução "${imp.reconstructionMethod}" desconhecido`)
    if (imp.reconstructionVersion !== RECONSTRUCTION_VERSION) return skip(S_VERSION, `reconstrução: o import usou a versão "${imp.reconstructionVersion}", a atual é "${RECONSTRUCTION_VERSION}" (não é adulteração)`)
  }
  if (imp.reproducibility && canonicalJson(imp.reproducibility.identity) !== canonicalJson(IDENTITY_VERSIONS)) {
    return skip(S_VERSION, `funções de identidade: o import usou ${canonicalJson(imp.reproducibility.identity)}, o código atual tem ${canonicalJson(IDENTITY_VERSIONS)} — rowHash/tradeId não podem ser reproduzidos com outras versões (não é adulteração)`)
  }
  const s = imp.settings
  if (s.sourceTzOrigin === undefined) return skip(S_CONTEXT, "settings.sourceTzOrigin ausente: não se sabe se o fuso foi informado ou assumido")
  if (s.sourceTzOrigin === "FILE_DECLARED") return skip(S_CONTEXT, "sourceTzOrigin FILE_DECLARED: nenhum parser atual reproduz fuso declarado pelo formato")
  if (s.sourceTzOrigin === "USER" && !s.sourceTz) return skip(S_CONTEXT, "sourceTzOrigin USER sem sourceTz registrado")
  if (s.sourceTzOrigin === "DEFAULT" && s.sourceTz !== DEFAULT_SOURCE_TIME_ZONE) return skip(S_CONTEXT, `o import assumiu o fuso padrão "${s.sourceTz}", e o padrão atual é "${DEFAULT_SOURCE_TIME_ZONE}": a leitura não pode ser reproduzida sem o mesmo padrão`)
  return null
}

function recordDiffs(re: ImportRecord, imp: ImportRef, saltSupplied: boolean, effSalt: string): string[] {
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
  // registros anteriores não têm `reproducibility` (não é divergência); se o registro tem, a reingestão precisa reproduzi-lo
  // `accountRefSalted` da reingestão só é verdadeiro se o chamador informou o sal: sem ele a bandeira não é reproduzível (é UNVERIFIABLE em V5.4+, não divergência)
  // saltId/saltCheck são DECLARAÇÕES do gerador (a reingestão não as produz): conferidas à parte em verifyImportWithSalt, nunca como divergência do registro
  if (imp.reproducibility) {
    const declared: Record<string, unknown> = { ...imp.reproducibility, accountRefSalted: imp.reproducibility.accountRefSalted && saltSupplied }
    delete declared.saltId
    delete declared.saltCheck
    cmp("reproducibility", re.reproducibility ? projectReproducibility(re.reproducibility, effSalt) : null, declared)
  }
  return d
}

/** UTF-8 ESTRITO preservando o BOM (U+FEFF fica no texto): para UTF-8 válido o round-trip é exato. Inválido ⇒ null. */
export function decodeSourceBytes(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
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
    reTrades: new Map(),
    referencedRows: new Set(tradesOf.flatMap((t) => t.sourceRows.map((r) => r.rowNo))),
    reingested: false,
    saltNotes: [],
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
  const decoded = decodeSourceBytes(bytes)
  const text = decoded as string
  if (decoded === null) {
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
  const problem = contextProblem(imp, parsers, opts)
  if (problem) {
    out.context = { ...problem, detail: `${label}: ${problem.detail}` }
    out.importId = skip(problem.code as string, `${label}: sem contexto reproduzível`)
    downstream(out.importId)
    return out
  }
  const run: PipelineResult = runImportPipeline(text, sourceContextOf(imp, opts), parsers)
  if (!run.importRecord) {
    out.context = skip(S_REINGEST, `${label}: a reingestão não produziu um import (${[...new Set(run.issues.map((i) => i.code))].join(", ") || "sem detalhe"})`)
    out.importId = out.context
    downstream(out.context)
    return out
  }
  out.reingested = true
  const rep = imp.reproducibility
  const ctxNote = rep
    ? `contexto REGISTRADO no import (identidade v${rep.identity.importId}/${rep.identity.rowHash}/${rep.identity.tradeId}, foldPolicy ${rep.foldPolicy}, ${rep.exitReasonMap.length} regra(s) de saída${rep.accountRefSalted ? ", sal exigido" : ", sem sal"})${!rep.accountRefSalted && opts.accountRefSalt ? "; o sal informado foi ignorado: o import não usou sal" : ""}`
    : `import ANTERIOR ao contexto reproduzível: foldPolicy/exitReasonMap/sal ${opts.foldPolicy !== undefined || opts.exitReasonMap !== undefined || opts.accountRefSalt !== undefined ? "informados pelo chamador" : "padrão"} (não registrados no import)`
  out.context = pass(`${label}: parser ${imp.parserId}@${imp.parserVersion}${imp.reconstructionMethod ? `, reconstrução ${imp.reconstructionMethod}@${imp.reconstructionVersion}` : ", sem reconstrução"}, fuso ${imp.settings.sourceTzOrigin}; ${ctxNote}`)

  // V5.3 — importId e registro
  const re = run.importRecord
  // o MESMO sal que a reingestão usou (sourceContextOf): com `reproducibility`, só vale o sal se o import o usou; senão o accountRef, os tokens e os patternRef não batem por culpa do chamador
  const effectiveSalt = rep ? (rep.accountRefSalted ? opts.accountRefSalt : undefined) : opts.accountRefSalt
  const recDiffs = recordDiffs(re, imp, !!opts.accountRefSalt, effectiveSalt ?? "")
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
  // Espaço de ids da reingestão = ciclos (run.trades) + LINHAS (run.rowTrades). Com reconstrução ligada os ids de linha NÃO estão em run.trades
  // (são disjuntos dos de ciclo); sem indexá-los, todo bundle de linhas dava V_TRADE_ID_MISMATCH. A granularidade declarada é conferida contra a
  // do índice (V5.trades) e uma linha citada por dois trades é V_ROWREF_DUPLICATE, então ciclo e linha não se cobrem.
  const reTradeById = new Map([...run.rowTrades, ...run.trades].map((t) => [t.tradeId as string, t]))
  out.reTrades = reTradeById
  const accountNames = [...new Set(run.rowTrades.map((t) => t.account.sourceName?.trim()).filter((n): n is string => !!n))].sort()
  const mine = tradesOf.filter((t) => t.importId === imp.importId)

  // sal exigido pelo registro e não informado: sem ele rowHash/tradeId não são comparáveis (o arquivo e o importId já foram conferidos)
  if (rep?.accountRefSalted && !opts.accountRefSalt) {
    const why = skip(S_ACCOUNT_REF, `${label}: o import usou accountRefSalt (registrado em reproducibility.accountRefSalted) e nenhum foi informado; o valor do sal não é gravado no bundle`)
    out.rows = [why]
    out.trades = [why]
    out.values = [why]
    return out
  }
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
    ? explainTrades(pending.map((p) => p.re), re, { ...(effectiveSalt !== undefined ? { accountRefSalt: effectiveSalt } : {}), knownAccountNames: accountNames })
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
  if (structBad.length > 0) out.trades.push(fail(FAIL.TRADE_STRUCTURE, `${label}: ${structBad.length} trade(s) com granularidade/conta/reconstrução ≠ reingestão: ${listed(structBad)}${saltHint(imp, structBad, valuesBad, effectiveSalt)}`))
  if (explainFailed > 0) out.trades.push(skip(S_REINGEST, `${label}: ${explainFailed} trade(s) da reingestão não puderam ser projetados (E3)`))
  if (out.trades.length === 0) out.trades.push(pass(`${label}: ${pending.length} trade(s): tradeId, granularidade, conta, reconstrução e composição de linhas = reingestão (SOURCE_ROW e ciclos)`))
  out.values = valuesBad.length > 0
    ? [fail(FAIL.TRADE_VALUES, `${label}: ${valuesBad.length} trade(s) com valores derivados do arquivo diferentes da reingestão (só os campos, nunca os valores): ${listed(valuesBad)}${saltHint(imp, structBad, valuesBad, effectiveSalt)}`)]
    : pending.length === 0
      ? [skip(S_NOT_APPLICABLE, `${label}: nenhum trade comparável para conferir valores`)]
      : [pass(`${label}: ${pending.length} trade(s): instrumento, direção, quantidade, preços, horários, P&L, pernas, excursões e linhas de origem = reingestão (R, risco, issues e fieldProvenance ficam fora: L_USER_ENRICHMENT_NOT_PROVEN)`)]
  return out
}

interface DerivedSourceResult {
  outcomes: Outcome[]
  summary: SourceCoverage["derived"]
}

/** V5.7 — cada derivado FULL: os trades da população estão no bundle e foram conferidos com a fonte; as pernas citadas batem com as da reingestão. */
function verifyDerivedSource(bundle: EvidenceBundle, per: Map<string, PerImport>): DerivedSourceResult {
  const derived = bundle.evidence.derived ?? []
  const summary: SourceCoverage["derived"] = { total: derived.length, full: 0, hashOnly: 0, partial: 0, trades: { declared: 0, inBundle: 0, verified: 0 }, legRefs: { declared: 0, verified: 0 }, scope: "DECLARED_POPULATION" }
  const inBundle = new Map(bundle.evidence.trades.map((t) => [t.tradeId, t]))
  const verified = new Set<string>()
  const reTrades = new Map<string, CanonicalTrade>()
  for (const p of per.values()) {
    for (const id of p.verifiedTrades) verified.add(id)
    for (const [id, t] of p.reTrades) reTrades.set(id, t)
  }
  const parts: Outcome[] = []
  derived.forEach((d, i) => {
    const label = `${d.analysis.op}#${i}`
    if (d.verifiability === "HASH_ONLY" || d.population.tradeIds === null) {
      summary.hashOnly += 1
      parts.push(skip(S_PARTIAL, `${label}: HASH_ONLY — só o tradeSetHash da população está no bundle (${d.population.afterFilters} trade(s)); como os trades não estão referenciados, a população NÃO pode ser conferida contra a fonte`))
      return
    }
    summary.full += 1
    const ids = d.population.tradeIds
    const present = ids.filter((id) => inBundle.has(id))
    summary.trades.declared += ids.length
    summary.trades.inBundle += present.length
    const ok = present.filter((id) => verified.has(id))
    summary.trades.verified += ok.length
    // pernas citadas × reingestão (só onde o trade foi reingerido; ausência é tratada pelos outros checks, nunca como adulteração aqui)
    const legMismatch: string[] = []
    let unconfirmed = 0
    let partialCounted = false
    for (const r of d.refs.legs.items ?? []) {
      summary.legRefs.declared += 1
      const re = reTrades.get(r.tradeId)
      const leg = re?.exitLegs?.[r.legIndex]
      // citação cujo trade não está no bundle (ou não foi conferido): NÃO foi comparada com a fonte — nunca passa como PASS
      if (!re || !verified.has(r.tradeId)) { unconfirmed += 1; continue }
      if (!leg || JSON.stringify([...leg.rowRefs].sort((a, b) => a - b)) !== JSON.stringify(r.rowNos)) legMismatch.push(`${short(r.tradeId)}#${r.legIndex}`)
      else summary.legRefs.verified += 1
    }
    if (legMismatch.length > 0) parts.push(fail(FAIL.DERIVED_LEG_REF, `${label}: ${legMismatch.length} perna(s) citada(s) não existem ou têm linhas de origem diferentes das da reingestão: ${listed(legMismatch)}`))
    if (unconfirmed > 0) {
      if (!partialCounted) { summary.partial += 1; partialCounted = true }
      parts.push(skip(S_PARTIAL, `${label}: ${unconfirmed} de ${d.refs.legs.items?.length ?? 0} perna(s) citada(s) apontam para trade ausente do bundle ou não conferido com a fonte: NÃO foram conferidas`))
    }
    if (present.length < ids.length) {
      if (!partialCounted) summary.partial += 1
      partialCounted = true
      parts.push(skip(S_PARTIAL, `${label}: população PARCIAL — ${ids.length - present.length} de ${ids.length} trade(s) declarados não estão no bundle e não foram conferidos com a fonte`))
    } else if (ids.length === 0) {
      if (!partialCounted) summary.partial += 1
      partialCounted = true
      parts.push(skip(S_PARTIAL, `${label}: população declarada vazia — nada a conferir contra a fonte`))
    } else if (ok.length < present.length) {
      parts.push(skip(S_DERIVED_UNVERIFIED, `${label}: ${present.length - ok.length} de ${present.length} trade(s) da população não puderam ser conferidos com a fonte (veja V5.file–V5.values)`))
    } else if (legMismatch.length === 0 && unconfirmed === 0) {
      parts.push(pass(`${label}: ${ok.length} trade(s) da população DECLARADA conferem com a fonte${d.refs.legs.items ? ` e ${d.refs.legs.items.length} perna(s) citada(s) batem com a reingestão` : ""} (a seleção original e a completude da importação não são provadas)`))
    }
  })
  // bloqueantes primeiro: `combine` usa o código do primeiro SKIPPED, e um bloqueio não pode ser escondido por "parcial"
  const rank = (o: Outcome) => (o.status === "FAIL" ? 0 : o.status === "SKIPPED" && o.code !== S_PARTIAL ? 1 : o.status === "SKIPPED" ? 2 : 3)
  return { outcomes: parts.sort((a, b) => rank(a) - rank(b)), summary }
}

// ── Política de sal (P4) ─────────────────────────────────────────────────────
// Regras (salt-policy-plano.md §3, D4 corrigida + O1/O2/O3): `saltCheck` é autodeclaração REDUNDANTE, nunca portão.
//  · saltId resolve no provider ⇒ usa esse sal e compara os refs DE VERDADE; saltCheck divergente + refs batem ⇒ SOURCE_VERIFIED_PARTIAL (L_SALT_CHECK_DIVERGENT);
//    refs divergem ⇒ SOURCE_MISMATCH, reforçado por V_SALT_CHECK_MISMATCH se o saltCheck também diverge. NUNCA UNVERIFIABLE quando o saltId resolve.
//  · saltId não resolve (UNKNOWN/RETIRED) ⇒ tenta TODOS os sais conhecidos do usuário (O1): algum reproduz ⇒ PARTIAL (L_SALT_ID_NOT_RESOLVED); nenhum ⇒ UNVERIFIABLE
//    (S_SALT_UNKNOWN / S_SALT_RETIRED), resíduo documentado: indistinguível de bundle de sal aposentado.
//  · sem saltId ⇒ legado, caminho de sempre (inclusive a lacuna conhecida com pista).
const isOk = (o: Outcome) => o.status === "PASS" || (o.status === "SKIPPED" && o.code === S_NOT_APPLICABLE)
const importOutcomes = (p: PerImport): Outcome[] => [p.file, p.context, p.importId, ...p.rows, ...p.trades, ...p.values]
/** A reingestão reproduziu tudo (arquivo, contexto, registro, linhas, trades e valores) com o sal testado. */
const reproducesClean = (p: PerImport): boolean => p.reingested && importOutcomes(p).every(isOk)

function verifyImportWithSalt(imp: ImportRef, tradesOf: TradeEvidence[], bytes: Uint8Array | undefined, opts: VerifySourceOptions, parsers: ParserDescriptor[]): PerImport {
  const rep = imp.reproducibility
  if (!rep || rep.saltId === undefined || rep.saltCheck === undefined) return verifyImport(imp, tradesOf, bytes, opts, parsers)
  const label = `import ${short(imp.importId)}`
  const saltId = rep.saltId
  const declared = rep.saltCheck
  const withSalt = (salt: string | undefined): VerifySourceOptions => {
    const rest: VerifySourceOptions = { ...opts }
    delete rest.accountRefSalt
    return salt !== undefined ? { ...rest, accountRefSalt: salt } : rest
  }

  if (!rep.accountRefSalted) {
    const p = verifyImport(imp, tradesOf, bytes, opts, parsers)
    p.context = fail(FAIL.SALT_DECLARATION, `${label}: o ImportRef declara saltId ${saltId}, mas registra que o import NÃO usou sal: declaração contraditória (o gerador nunca emite isso)`)
    return p
  }

  /** Compara o saltCheck declarado com o do sal que foi USADO na conferência. Nunca impede a conferência dos refs (já feita). */
  const checkDeclared = (p: PerImport, salt: string): PerImport => {
    if (saltCheck(salt) === declared) return p
    if (importOutcomes(p).some((o) => o.status === "FAIL")) {
      const msg = `${label}: o saltCheck declarado ≠ o do sal ${saltId}, E os refs/valores também divergem do arquivo (a divergência do saltCheck reforça o alerta; não é um rebaixamento)`
      p.context = p.context.status === "FAIL" ? fail(p.context.code as string, `${p.context.detail} | ${msg}`) : fail(FAIL.SALT_CHECK, msg)
      return p
    }
    if (p.context.status === "PASS") {
      p.context = skip(S_PARTIAL, `${p.context.detail} | ATENÇÃO: o saltCheck declarado ≠ o do sal ${saltId} resolvido; os refs batem com esse sal (autodeclaração incorreta no bundle; não prova de adulteração dos dados)`)
      p.saltNotes.push("L_SALT_CHECK_DIVERGENT")
    }
    return p
  }

  if (!opts.salt) {
    // sem provider: a string `accountRefSalt` (se houver) é o sal candidato; sem string, o caminho de sempre dá UNVERIFIABLE (S_ACCOUNT_REF_UNVERIFIED)
    const p = verifyImport(imp, tradesOf, bytes, opts, parsers)
    return opts.accountRefSalt !== undefined && isStrongSalt(opts.accountRefSalt) ? checkDeclared(p, opts.accountRefSalt) : p
  }

  const { provider, userId } = opts.salt
  const look = provider.get(userId, saltId)
  if (look.status === "ACTIVE") return checkDeclared(verifyImport(imp, tradesOf, bytes, withSalt(look.salt), parsers), look.salt)

  // O1: o saltId declarado não resolve ⇒ tenta os sais conhecidos do usuário antes de desistir
  for (const cand of provider.known(userId)) {
    const p = verifyImport(imp, tradesOf, bytes, withSalt(cand.salt), parsers)
    if (reproducesClean(p)) {
      p.context = skip(S_PARTIAL, `${p.context.detail} | ATENÇÃO: o saltId declarado (${saltId}) ${look.status === "RETIRED" ? "está aposentado" : "não existe no provider"}; os refs foram reproduzidos pelo sal conhecido ${cand.saltId} (a declaração do bundle está errada)`)
      p.saltNotes.push("L_SALT_ID_NOT_RESOLVED")
      return p
    }
  }
  const p = verifyImport(imp, tradesOf, bytes, withSalt(undefined), parsers)
  if (p.file.status !== "PASS") return p // problema no arquivo domina (não se esconde atrás do sal)
  const code = look.status === "RETIRED" ? S_SALT_RETIRED : S_SALT_UNKNOWN
  const why = look.status === "RETIRED"
    ? `o sal ${saltId} foi aposentado (registro sem valor) e nenhum outro sal conhecido do usuário reproduz os refs`
    : `o provider não tem nenhum sal para o saltId ${saltId} e nenhum sal conhecido do usuário reproduz os refs`
  const o = skip(code, `${label}: ${why}. NÃO é prova de integridade: nada que dependa do sal (contas, estratégias, rótulos, ids de linha e de trade) foi conferido; bundle de sal aposentado e bundle adulterado são indistinguíveis aqui`)
  p.context = o
  p.importId = o
  p.rows = [o]
  p.trades = [o]
  p.values = [o]
  return p
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
  for (const imp of imports) per.set(imp.importId, verifyImportWithSalt(imp, trades, filesGet(files, imp.importId), options, parsers))
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

  // derivados (E6.3): população declarada de cada um
  const dsrc = verifyDerivedSource(bundle, per)
  outcomes.set("V5.derived", dsrc.outcomes.length === 0 ? skip(S_NOT_APPLICABLE, "bundle sem derivados") : combine(dsrc.outcomes))

  const metrics = bundle.evidence.metrics
  const hashOnly = metrics.filter((m) => m.verifiability === "HASH_ONLY").length
  const full = metrics.length - hashOnly
  const dHashOnly = dsrc.summary.hashOnly
  const dPartial = dsrc.summary.partial
  const dFull = dsrc.summary.full
  const unlisted = hashOnly + dHashOnly + dPartial
  if (dsrc.summary.total === 0) {
    // bundles sem derivados: texto e comportamento exatamente os de antes
    outcomes.set(
      "V5.coverage",
      metrics.length === 0
        ? skip(S_NOT_APPLICABLE, "bundle sem métricas: não há população declarada")
        : hashOnly === 0
          ? pass(`${full} métrica(s) com a população declarada INTEIRA listada: todos os trades da população foram comparados com a fonte (a seleção original continua não provada)`)
          : skip(S_PARTIAL, `${hashOnly} de ${metrics.length} métrica(s) em HASH_ONLY: só o tradeSetHash e as âncoras estão no bundle; as referências presentes foram conferidas, a população completa NÃO pode ser conferida contra a fonte`),
    )
  } else {
    const what = [metrics.length > 0 ? `${metrics.length} métrica(s)` : null, `${dsrc.summary.total} derivado(s)`].filter(Boolean).join(" e ")
    outcomes.set(
      "V5.coverage",
      unlisted === 0
        ? pass(`${what} com a população declarada INTEIRA listada (${full} métrica(s), ${dFull} derivado(s) FULL): todos os trades DECLARADOS foram comparados com a fonte. É a população declarada de cada análise, não a importação inteira: a seleção original continua não provada`)
        : skip(S_PARTIAL, `população declarada PARCIAL em ${what}: ${hashOnly} métrica(s) e ${dHashOnly} derivado(s) em HASH_ONLY, ${dPartial} derivado(s) FULL com trades fora do bundle — só o tradeSetHash/âncoras ou parte dos trades estão presentes; o que está presente foi conferido, o resto NÃO pode ser conferido contra a fonte`),
    )
  }

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
      /** Imports cujo ImportRef traz o contexto reproduzível (foldPolicy, exitReasonMap, versões de identidade); os demais usam o do chamador/padrão. */
      contextRecorded: imports.filter((i) => i.reproducibility !== undefined).length,
    },
    rows: { referenced: refRows, verified: all.reduce((n, p) => n + p.verifiedRows.size, 0) },
    trades: { referenced: new Set(trades.map((t) => t.tradeId)).size, verified: all.reduce((n, p) => n + p.verifiedTrades.size, 0) },
    populations: { metrics: metrics.length, full, hashOnly, complete: metrics.length + dsrc.summary.total > 0 && unlisted === 0 },
    derived: dsrc.summary,
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
  const saltNotes = new Set(all.flatMap((p) => p.saltNotes))
  const limitations = [...SOURCE_LIMITATIONS, ...(dsrc.summary.total > 0 ? [DERIVED_SCOPE_LIMITATION] : []), ...SALT_LIMITATIONS.filter((l) => saltNotes.has(l.code))].map((l) => ({ ...l }))
  return { schema: VERIFY_SOURCE_SCHEMA, status, evidenceHash: bundle.evidenceHash, checks, coverage, limitations }
}
