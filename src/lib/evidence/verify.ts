// verifyEvidence (Evidence E5.1 + E5.2): V0 formato · V1 selo · V2 referências · V3 população · V4 métricas.
//
// Puro: sem relógio, sem random, sem banco, sem CSV, sem rede; nunca lança para dado malformado (devolve relatório).
// NÃO é segundo motor: V4 reaplica o MESMO motor (`calculateMetricsTraced` / `aggregateTradesTraced`) sobre os trades reconstruídos
// mecanicamente dos `TradeEvidence` (`analyticsTradeFromEvidence`) e COMPARA; nenhuma fórmula (P&L, R, pontos, drawdown, profit factor,
// médias, medianas, sequências…) é reimplementada aqui. O hash da população é `tradeFingerprintFromEvidence` + `tradeSetHash` (E2/E5.0)
// e o selo é `computeEvidenceHash` — nada de hashing próprio.
//
// Status geral:
//   V0 falhou                                              → INVALID_FORMAT
//   algum FAIL em V1–V4 (selo, referências, população, cálculos) → TAMPERED
//   sem FAIL, mas algo obrigatório ficou SKIPPED (HASH_ONLY, versão incompatível, proveniência incompleta, ordem da sequência não registrada,
//   associação impossível…)                                → UNVERIFIABLE
//   tudo o que é aplicável passou e nada bloqueante foi pulado → VALID
// SKIPPED nunca vira PASS. `S_NOT_APPLICABLE` (o check não se aplica àquele bundle) é o único SKIPPED que não impede VALID.
//
// O QUE `VALID` SIGNIFICA (ver `limitations`, sempre no relatório): os números do bundle são REPRODUZÍVEIS pelo motor a partir dos trades
// declarados e todos os hashes/referências fecham. NÃO prova a origem dos dados (CSV original = E5b), NÃO prova que a seleção original de
// trades foi correta ou completa e o selo NÃO é assinatura digital: alteração coordenada e consistente de tudo só se prova contra o CSV.

import { ANCHOR_ROLES, CONTRIBUTOR_ROLES } from "../metrics/trace.ts"
import { aggregateTradesTraced, calculateMetricsTraced, sampleFlagOf } from "../metrics/calculate.ts"
import { metricDefinition } from "../metrics/catalog.ts"
import { prepareTrades, resolveOptions } from "../metrics/prepare.ts"
import { ENGINE_VERSION, type AnalysisOptions, type AnalyticsTrade, type Dimension } from "../metrics/types.ts"
import { canonicalJson } from "../infra/hash.ts"
import { computeEvidenceHash, tradeFingerprintFromEvidence, tradeSetHash } from "./hash.ts"
import { EVIDENCE_SCHEMA, EvidenceBundleSchema, type EvidenceBundle, type MetricEvidence, type TradeEvidence } from "./schema.ts"
import { analyticsTradeFromEvidence } from "./to-analytics.ts"

export const VERIFY_SCHEMA = "verify/1" as const

export type VerifyStatus = "VALID" | "TAMPERED" | "UNVERIFIABLE" | "INVALID_FORMAT"
export type CheckStatus = "PASS" | "FAIL" | "SKIPPED"
export type CheckLevel = "V0" | "V1" | "V2" | "V3" | "V4"

export interface VerifyCheck {
  /** Estável e único (`V2.import-refs`…). A ordem da lista de checks também é fixa. */
  id: string
  level: CheckLevel
  status: CheckStatus
  /** FAIL: código da falha (`V_*`). SKIPPED: motivo (`S_*`). PASS: null. */
  code: string | null
  detail: string
}

export interface VerifyLimitation {
  code: string
  text: string
}

export interface VerifyReport {
  schema: typeof VERIFY_SCHEMA
  status: VerifyStatus
  checks: VerifyCheck[]
  /** O que NENHUM status (nem `VALID`) afirma. Sempre presente, na mesma ordem. */
  limitations: VerifyLimitation[]
}

export const LIMITATIONS: ReadonlyArray<VerifyLimitation> = [
  { code: "L_SEAL_NOT_SIGNATURE", text: "O evidenceHash é um selo de integridade interna, não uma assinatura digital: quem altera o conteúdo e recalcula o selo obtém um selo válido. V3/V4 pegam alteração inconsistente; alteração coordenada de tudo é consistente." },
  { code: "L_SELECTION_NOT_PROVEN", text: "A verificação é sobre a POPULAÇÃO DECLARADA no bundle. Não prova que a seleção original de trades (filtros sobre o conjunto de entrada) foi correta nem completa: o conjunto de entrada não está no bundle." },
  { code: "L_ORIGIN_NOT_PROVEN", text: "A origem dos dados não é provada: nenhum CSV é relido. Comparar fileSha256, importId, rowHash e tradeId contra o arquivo original é o E5b." },
]

/** Códigos de falha por check (contrato do verificador). */
export const FAIL_CODES = {
  "V0.structure": "V_FORMAT_INVALID",
  "V0.schema-id": "V_SCHEMA_UNKNOWN",
  "V0.seal-format": "V_SEAL_MALFORMED",
  "V0.canonical-json": "V_FORMAT_NOT_CANONICAL",
  "V0.unknown-fields": "V_FORMAT_UNKNOWN_FIELD",
  "V1.seal": "V_SEAL_MISMATCH",
  "V2.trade-ids-unique": "V_DUP_TRADE_ID",
  "V2.import-ids-unique": "V_DUP_IMPORT_ID",
  "V2.import-refs": "V_REF_IMPORT_MISSING",
  "V2.import-unreferenced": "V_IMPORT_UNREFERENCED",
  "V2.row-import": "V_ROWREF_IMPORT_MISMATCH",
  "V2.row-dangling": "V_ROWREF_DANGLING",
  "V2.row-unique": "V_ROWREF_DUPLICATE",
  "V2.population-shape": "V_POPULATION_MISMATCH",
  "V2.population-refs": "V_REF_TRADE_MISSING",
  "V2.contributor-refs": "V_REF_TRADE_MISSING",
  "V2.contributor-counts": "V_CONTRIBUTORS_MISMATCH",
  "V2.unreferenced-trades": "V_TRADE_UNREFERENCED",
  "V2.subject": "V_SUBJECT_UNRESOLVED",
  "V3.population": "V_TRADESET_HASH_MISMATCH",
  "V3.provenance": "V_PROVENANCE_MISMATCH",
  "V4.versions": "V_METRIC_UNKNOWN",
  "V4.query": "V_QUERY_INVALID",
  "V4.population": "V_TRADESET_HASH_MISMATCH",
  "V4.sequence": "V_SEQUENCE_MISMATCH",
  "V4.metric-value": "V_METRIC_VALUE_MISMATCH",
  "V4.metric-fields": "V_METRIC_FIELD_MISMATCH",
  "V4.contributors": "V_CONTRIBUTORS_MISMATCH",
  "V4.quality": "V_QUALITY_MISMATCH",
  "V4.association": "V_ASSOCIATION_MISMATCH",
  "V4.anchors": "V_ANCHOR_MISMATCH",
} as const

/** Ordem FIXA dos checks do relatório (determinismo). Exportada só para a documentação/inspeção (Evidence Lab) listar títulos. */
export const CHECK_CATALOG: ReadonlyArray<{ id: string; level: CheckLevel; title: string }> = [
  { id: "V0.structure", level: "V0", title: "estrutura evidence/1 (schema strict)" },
  { id: "V0.schema-id", level: "V0", title: "identificador de schema" },
  { id: "V0.seal-format", level: "V0", title: "formato do evidenceHash" },
  { id: "V0.canonical-json", level: "V0", title: "JSON canônico possível" },
  { id: "V0.unknown-fields", level: "V0", title: "nenhum campo desconhecido em nenhum nível" },
  { id: "V1.seal", level: "V1", title: "selo evidenceHash" },
  { id: "V2.trade-ids-unique", level: "V2", title: "tradeId único em trades[]" },
  { id: "V2.import-ids-unique", level: "V2", title: "importId único em imports[]" },
  { id: "V2.import-refs", level: "V2", title: "todo trade tem seu ImportRef" },
  { id: "V2.import-unreferenced", level: "V2", title: "nenhum ImportRef sem trade" },
  { id: "V2.row-import", level: "V2", title: "sourceRows[].importId = importId do trade" },
  { id: "V2.row-dangling", level: "V2", title: "rowRefs das pernas apontam para sourceRows do trade" },
  { id: "V2.row-unique", level: "V2", title: "rowNo único dentro do trade" },
  { id: "V2.population-shape", level: "V2", title: "forma da população (tradeIds × verifiability × afterFilters)" },
  { id: "V2.population-refs", level: "V2", title: "population.tradeIds resolvem para trades[]" },
  { id: "V2.contributor-refs", level: "V2", title: "contributors referenciam trades[]" },
  { id: "V2.contributor-counts", level: "V2", title: "roleCounts × contributors" },
  { id: "V2.unreferenced-trades", level: "V2", title: "nenhum trade sem referência" },
  { id: "V2.subject", level: "V2", title: "subject resolve" },
  { id: "V3.population", level: "V3", title: "tradeSetHash refeito dos TradeEvidence (fingerprint)" },
  { id: "V3.provenance", level: "V3", title: "proveniência completa (identidade, rowHash)" },
  { id: "V4.versions", level: "V4", title: "engineVersion/definitionVersion compatíveis com o motor atual" },
  { id: "V4.query", level: "V4", title: "opções da consulta válidas" },
  { id: "V4.population", level: "V4", title: "tradeSetHash segundo o próprio motor" },
  { id: "V4.sequence", level: "V4", title: "ordem da sequência (drawdown, sequências) registrada e reproduzida pelo motor" },
  { id: "V4.metric-value", level: "V4", title: "value recalculado pelo motor" },
  { id: "V4.metric-fields", level: "V4", title: "unit, basis, sampleSize, coverage e reason recalculados" },
  { id: "V4.contributors", level: "V4", title: "contribuintes, papéis e roleCounts segundo o trace do motor" },
  { id: "V4.quality", level: "V4", title: "qualidade dos dados, período e avisos" },
  { id: "V4.association", level: "V4", title: "associação da população à consulta (conta, dimensões do grupo, filtros verificáveis, sampleFlag)" },
  { id: "V4.anchors", level: "V4", title: "âncoras (população acima do limite)" },
]

const SKIP_FORMAT = "S_FORMAT_INVALID"
const SKIP_NO_METRICS = "S_NO_METRICS"
/** O único SKIPPED que NÃO impede `VALID`: o check simplesmente não se aplica a este bundle. */
const SKIP_NOT_APPLICABLE = "S_NOT_APPLICABLE"
const SKIP_HASH_ONLY = "S_HASH_ONLY"
const SKIP_REFS = "S_REFS_BROKEN"
const SKIP_VERSION = "S_VERSION_INCOMPATIBLE"
const SKIP_PROVENANCE = "S_PROVENANCE_INCOMPLETE"
const SKIP_ASSOCIATION = "S_ASSOCIATION_UNVERIFIABLE"
const SKIP_ORDER = "S_ORDER_NOT_RECORDED"
const SKIP_NO_ANCHOR = "S_NO_ANCHOR_CHECK"
const SKIP_QUERY = "S_QUERY_INVALID"

const SEAL_RE = /^[0-9a-f]{64}$/
const MAX_LISTED = 5

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort()
/** Lista curta e determinística (ordenada, sem repetição, com contagem do que ficou de fora). */
function list(xs: string[]): string {
  const u = sortedUnique(xs)
  return u.length <= MAX_LISTED ? u.join(", ") : `${u.slice(0, MAX_LISTED).join(", ")} (+${u.length - MAX_LISTED})`
}
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

type Outcome = { status: "PASS" | "FAIL" | "SKIPPED"; code?: string; detail: string }
const pass = (detail: string): Outcome => ({ status: "PASS", detail })
const skip = (code: string, detail: string): Outcome => ({ status: "SKIPPED", code, detail })
const failWith = (id: keyof typeof FAIL_CODES, detail: string): Outcome => ({ status: "FAIL", code: FAIL_CODES[id], detail })

/** Primeiro caminho (ordem alfabética) em que `input` tem uma chave que `parsed` (saída do schema) não tem: o schema a DESCARTOU em silêncio. */
function strippedPath(input: unknown, parsed: unknown, path: string): string | null {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    for (let i = 0; i < input.length; i += 1) {
      const p = strippedPath(input[i], parsed[i], `${path}[${i}]`)
      if (p) return p
    }
    return null
  }
  if (isRecord(input) && isRecord(parsed)) {
    for (const key of Object.keys(input).sort()) {
      if (input[key] === undefined) continue
      if (!(key in parsed)) return path === "" ? key : `${path}.${key}`
      const p = strippedPath(input[key], parsed[key], path === "" ? key : `${path}.${key}`)
      if (p) return p
    }
  }
  return null
}

const issuePath = (path: ReadonlyArray<PropertyKey>): string => (path.length === 0 ? "(raiz)" : path.map(String).join("."))

// ── V2: referências ──────────────────────────────────────────────────────────

function v2(bundle: EvidenceBundle): Map<string, Outcome> {
  const out = new Map<string, Outcome>()
  const { imports, trades, metrics } = bundle.evidence
  const tradeIds = trades.map((t) => t.tradeId)
  const tradeIdSet = new Set(tradeIds)
  const importIdSet = new Set(imports.map((i) => i.importId))

  const dupTrades = tradeIds.filter((id, i) => tradeIds.indexOf(id) !== i)
  out.set("V2.trade-ids-unique", dupTrades.length === 0 ? pass(`${trades.length} trade(s), todos com tradeId distinto`) : failWith("V2.trade-ids-unique", `tradeId repetido em trades[]: ${list(dupTrades)}. Identidade duplicada não é aceita como duas identidades.`))

  const importIds = imports.map((i) => i.importId)
  const dupImports = importIds.filter((id, i) => importIds.indexOf(id) !== i)
  out.set("V2.import-ids-unique", dupImports.length === 0 ? pass(`${imports.length} import(s), todos com importId distinto`) : failWith("V2.import-ids-unique", `importId repetido em imports[]: ${list(dupImports)}.`))

  const noImport = trades.filter((t) => !importIdSet.has(t.importId))
  out.set("V2.import-refs", noImport.length === 0 ? pass("todo trade aponta para um ImportRef existente") : failWith("V2.import-refs", `${noImport.length} trade(s) sem ImportRef (importId ${list(noImport.map((t) => t.importId))}): ${list(noImport.map((t) => t.tradeId))}.`))

  const usedImports = new Set(trades.map((t) => t.importId))
  const orphanImports = imports.filter((i) => !usedImports.has(i.importId))
  out.set("V2.import-unreferenced", orphanImports.length === 0 ? pass("todo ImportRef é usado por algum trade") : failWith("V2.import-unreferenced", `ImportRef sem nenhum trade: ${list(orphanImports.map((i) => i.importId))}.`))

  const rowMismatch = trades.filter((t) => t.sourceRows.some((r) => r.importId !== t.importId))
  out.set("V2.row-import", rowMismatch.length === 0 ? pass("todo sourceRows[].importId bate com o importId do trade") : failWith("V2.row-import", `sourceRows[].importId ≠ importId do trade em: ${list(rowMismatch.map((t) => t.tradeId))}.`))

  const dangling: string[] = []
  const dupRows: string[] = []
  for (const t of trades) {
    const rowNos = t.sourceRows.map((r) => r.rowNo)
    if (rowNos.some((n, i) => rowNos.indexOf(n) !== i)) dupRows.push(t.tradeId)
    const known = new Set(rowNos)
    const legs = [...(t.entryLegs ?? []), ...(t.exitLegs ?? [])]
    if (legs.some((l) => l.rowRefs.some((n) => !known.has(n)))) dangling.push(t.tradeId)
  }
  out.set("V2.row-dangling", dangling.length === 0 ? pass("rowRefs de todas as pernas apontam para linhas existentes em sourceRows") : failWith("V2.row-dangling", `perna(s) apontando para linha inexistente em sourceRows: ${list(dangling)}.`))
  out.set("V2.row-unique", dupRows.length === 0 ? pass("rowNo único dentro de cada trade") : failWith("V2.row-unique", `rowNo repetido em sourceRows de: ${list(dupRows)}.`))

  // checks que dependem de métricas
  const noMetrics = (what: string): Outcome => skip(SKIP_NO_METRICS, `bundle sem métricas: ${what} não se aplica`)
  if (metrics.length === 0) {
    for (const id of ["V2.population-shape", "V2.population-refs", "V2.contributor-refs", "V2.contributor-counts", "V2.unreferenced-trades"]) out.set(id, noMetrics(CHECK_CATALOG.find((c) => c.id === id)?.title ?? id))
  } else {
    const label = (i: number) => `${metrics[i].metricId}#${i}`
    // forma da população
    const shape: string[] = []
    metrics.forEach((m, i) => {
      const ids = m.population.tradeIds
      const c = m.contributors
      if (m.population.sequence.order !== null && (ids === null || !m.population.sequence.dependent)) shape.push(`${label(i)}: ordem de sequência registrada ${ids === null ? "sem a população listada (HASH_ONLY)" : "numa métrica que não depende da ordem"}`)
      if (ids === null) {
        if (m.verifiability !== "HASH_ONLY") shape.push(`${label(i)}: tradeIds null mas verifiability ${m.verifiability}`)
        if (c.applicable && c.complete) shape.push(`${label(i)}: contributors completos sem lista da população`)
      } else {
        if (m.verifiability !== "FULL") shape.push(`${label(i)}: tradeIds presente mas verifiability ${m.verifiability}`)
        if (new Set(ids).size !== ids.length) shape.push(`${label(i)}: tradeIds com id repetido`)
        if (ids.length !== m.population.afterFilters) shape.push(`${label(i)}: ${ids.length} tradeIds ≠ afterFilters ${m.population.afterFilters}`)
        if (c.applicable && !c.complete) shape.push(`${label(i)}: população listada mas contributors incompletos`)
      }
      if (!c.applicable && !c.complete) shape.push(`${label(i)}: métrica sem contribuintes marcada como incompleta`)
    })
    out.set("V2.population-shape", shape.length === 0 ? pass(`${metrics.length} métrica(s): tradeIds, verifiability, afterFilters e contributors coerentes entre si`) : failWith("V2.population-shape", shape.slice(0, MAX_LISTED).join("; ") + (shape.length > MAX_LISTED ? ` (+${shape.length - MAX_LISTED})` : "")))

    // referências da população e dos contributors
    const missPop: string[] = []
    const missContrib: string[] = []
    metrics.forEach((m) => {
      for (const id of m.population.tradeIds ?? []) if (!tradeIdSet.has(id)) missPop.push(id)
      for (const it of m.contributors.items) if (!tradeIdSet.has(it.tradeId)) missContrib.push(it.tradeId)
    })
    out.set("V2.population-refs", missPop.length === 0 ? pass("todo population.tradeIds resolve para um TradeEvidence") : failWith("V2.population-refs", `${sortedUnique(missPop).length} id(s) da população sem TradeEvidence: ${list(missPop)}.`))
    out.set("V2.contributor-refs", missContrib.length === 0 ? pass("todo contributor aponta para um TradeEvidence") : failWith("V2.contributor-refs", `${sortedUnique(missContrib).length} contributor(s) apontam para trade inexistente: ${list(missContrib)}.`))

    // roleCounts × items
    const counts: string[] = []
    metrics.forEach((m, i) => {
      const c = m.contributors
      const byRole = new Map<string, number>()
      const seen = new Set<string>()
      for (const it of c.items) {
        byRole.set(it.role, (byRole.get(it.role) ?? 0) + 1)
        const key = `${it.role}|${it.tradeId}|${it.rank ?? ""}`
        if (seen.has(key)) counts.push(`${label(i)}: contributor repetido (${it.role} ${it.tradeId}${it.rank !== undefined ? ` rank ${it.rank}` : ""})`)
        seen.add(key)
      }
      const declared = (role: string) => (c.roleCounts as Record<string, number | undefined>)[role] ?? 0
      if (!c.applicable) {
        if (Object.keys(c.roleCounts).length > 0 || c.items.length > 0) counts.push(`${label(i)}: métrica sem contribuintes (applicable=false) com roleCounts/items`)
        return
      }
      if (c.complete) {
        for (const role of CONTRIBUTOR_ROLES) if ((byRole.get(role) ?? 0) !== declared(role)) counts.push(`${label(i)}: roleCounts.${role}=${declared(role)} ≠ ${byRole.get(role) ?? 0} item(ns)`)
      } else {
        // lista incompleta (acima do limite): o motor retém TODAS as âncoras e só elas; roleCounts continua completo
        for (const [role] of byRole) if (!ANCHOR_ROLES.has(role as never)) counts.push(`${label(i)}: papel ${role} não é âncora e não pode estar numa lista incompleta`)
        for (const role of CONTRIBUTOR_ROLES) {
          if (!ANCHOR_ROLES.has(role)) continue
          if ((byRole.get(role) ?? 0) !== declared(role)) counts.push(`${label(i)}: âncora ${role}: ${byRole.get(role) ?? 0} item(ns) ≠ roleCounts.${role}=${declared(role)} (todas as âncoras são retidas)`)
        }
      }
    })
    out.set("V2.contributor-counts", counts.length === 0 ? pass("roleCounts coerente com os contributors presentes (completos: igualdade; incompletos: só âncoras, dentro da contagem)") : failWith("V2.contributor-counts", counts.slice(0, MAX_LISTED).join("; ") + (counts.length > MAX_LISTED ? ` (+${counts.length - MAX_LISTED})` : "")))

    // trades sem referência (extras)
    const referenced = new Set<string>()
    for (const m of metrics) {
      for (const id of m.population.tradeIds ?? []) referenced.add(id)
      for (const it of m.contributors.items) referenced.add(it.tradeId)
    }
    if (bundle.subject.type === "TRADE") referenced.add(bundle.subject.id)
    const extra = tradeIds.filter((id) => !referenced.has(id))
    out.set("V2.unreferenced-trades", extra.length === 0 ? pass("todo TradeEvidence é citado pela população, pelos contributors ou pelo subject") : failWith("V2.unreferenced-trades", `${sortedUnique(extra).length} TradeEvidence sem referência (população/contributors/subject): ${list(extra)}.`))
  }

  const subjectOk = bundle.subject.type === "METRIC" ? metrics.some((m) => m.metricId === bundle.subject.id) : tradeIdSet.has(bundle.subject.id)
  out.set("V2.subject", subjectOk ? pass(`subject ${bundle.subject.type} "${bundle.subject.id}" resolve`) : failWith("V2.subject", `subject ${bundle.subject.type} "${bundle.subject.id}" não existe no bundle.`))
  return out
}

// ── V3 / V4: população e métricas ───────────────────────────────────────────

type Per = { label: string; o: Outcome }
const NA = (detail: string): Outcome => skip(SKIP_NOT_APPLICABLE, detail)
const isNA = (o: Outcome) => o.status === "SKIPPED" && o.code === SKIP_NOT_APPLICABLE

/** Junta o resultado de UMA métrica por check: qualquer FAIL ⇒ FAIL; sem FAIL e algo pulado ⇒ SKIPPED (nunca PASS parcial); só então PASS. */
function combine(id: keyof typeof FAIL_CODES, per: Per[]): Outcome {
  const applicable = per.filter((p) => !isNA(p.o))
  if (applicable.length === 0) return NA(per[0]?.o.detail ?? "não se aplica a este bundle")
  const lines = (xs: Per[]) => xs.slice(0, MAX_LISTED).map((p) => (per.length > 1 ? `${p.label}: ${p.o.detail}` : p.o.detail)).join("; ") + (xs.length > MAX_LISTED ? ` (+${xs.length - MAX_LISTED})` : "")
  const fails = applicable.filter((p) => p.o.status === "FAIL")
  if (fails.length > 0) return failWith(id, lines(fails))
  const skips = applicable.filter((p) => p.o.status === "SKIPPED")
  if (skips.length > 0) {
    const verified = applicable.length - skips.length
    return skip(skips[0].o.code as string, `${verified > 0 ? `${verified} de ${applicable.length} métrica(s) verificada(s); as demais NÃO: ` : ""}${lines(skips)}`)
  }
  return pass(lines(applicable))
}

const OPTION_ENUMS = { timeAnchor: ["ENTRY", "EXIT"], pnlBasis: ["NET", "GROSS"], rBasis: ["NET", "POINTS"] } as const
/** Opções declaradas → AnalysisOptions do motor (validação de forma; o motor valida o resto — fuso, minSample). */
function optionsOf(m: MetricEvidence): { ok: true; options: AnalysisOptions } | { ok: false; why: string } {
  const o = m.query.options
  for (const [k, allowed] of Object.entries(OPTION_ENUMS)) if (!(allowed as readonly unknown[]).includes(o[k])) return { ok: false, why: `options.${k}=${JSON.stringify(o[k])} fora de ${allowed.join("/")}` }
  if (typeof o.timeZone !== "string" || o.timeZone !== m.query.timeZone) return { ok: false, why: "options.timeZone ausente ou ≠ query.timeZone" }
  if (!Number.isInteger(o.tradeIdsLimit) || (o.tradeIdsLimit as number) < 0) return { ok: false, why: "options.tradeIdsLimit precisa ser inteiro ≥ 0" }
  if (!Number.isInteger(o.minSample) || (o.minSample as number) < 1) return { ok: false, why: "options.minSample precisa ser inteiro ≥ 1" }
  return { ok: true, options: { timeZone: o.timeZone, timeAnchor: o.timeAnchor as "ENTRY" | "EXIT", pnlBasis: o.pnlBasis as "NET" | "GROSS", rBasis: o.rBasis as "NET" | "POINTS", tradeIdsLimit: o.tradeIdsLimit as number, minSample: o.minSample as number } }
}

/** Dimensões/filtros que o motor consegue derivar SÓ do que a Evidence carrega (instantes, direção, instrumento). O resto não tem referência na Evidence. */
const ENGINE_DIMS = new Set<string>(["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "symbol", "direction"])
const ENGINE_FILTERS = ["from", "to", "symbol", "direction", "hour", "dayOfWeek", "tradingDay"] as const
const REF_DIMS = new Set<string>(["account"])
/** Esta lista é a ÚNICA fonte do que o verificador NÃO afirma: estratégia/sessão/etc. não têm referência na Evidence. */
const WARNINGS_NOT_REVERIFIABLE = new Set(["W_FILTER_EXCLUDED_UNKNOWN"]) // depende dos filtros sobre o conjunto de ENTRADA, que o bundle não traz

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)
const cmpId = (a: AnalyticsTrade, b: AnalyticsTrade) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Há empate de instante de ordenação na população? Então a ordem da sequência depende do desempate do motor (ordem de entrada dos dados),
 * que só `population.sequence.order` registra. Conservador: qualquer empate conta (em erro, assume empate).
 */
function hasOrderTie(probes: AnalyticsTrade[], options: AnalysisOptions): boolean {
  try {
    const keys = new Set<number>()
    for (const r of prepareTrades(probes, resolveOptions(options))) {
      if (keys.has(r.orderKey)) return true
      keys.add(r.orderKey)
    }
    return false
  } catch {
    return true
  }
}

interface Ctx {
  byId: Map<string, TradeEvidence>
  duplicated: boolean
}

function perMetric(m: MetricEvidence, label: string, ctx: Ctx): Record<string, Outcome> {
  const out: Record<string, Outcome> = {}
  const ids = m.population.tradeIds
  const full = ids !== null
  const set = (id: string, o: Outcome) => (out[id] = o)
  const skipAll = (ids_: string[], code: string, detail: string) => ids_.forEach((id) => set(id, skip(code, detail)))
  const V4 = ["V4.population", "V4.sequence", "V4.metric-value", "V4.metric-fields", "V4.contributors", "V4.quality", "V4.association"]

  // referências quebradas (V2 já acusa): sem os trades não há como refazer nada
  const trades: TradeEvidence[] = []
  let refsOk = !ctx.duplicated
  if (full) for (const id of ids) { const t = ctx.byId.get(id); if (t) trades.push(t); else refsOk = false }
  if (full && !refsOk) {
    skipAll(["V3.population", "V3.provenance", "V4.versions", "V4.query", ...V4, "V4.anchors"], SKIP_REFS, "referências quebradas ou ids duplicados (veja V2): os TradeEvidence da população não puderam ser resolvidos")
    return out
  }

  // proveniência (V3)
  const pop = m.population
  const inScope = full ? trades : m.contributors.items.map((c) => ctx.byId.get(c.tradeId)).filter((t): t is TradeEvidence => !!t)
  if (pop.provenance.withIdentity + pop.provenance.withoutIdentity !== pop.afterFilters) {
    set("V3.provenance", failWith("V3.provenance", `provenance ${pop.provenance.withIdentity}+${pop.provenance.withoutIdentity} ≠ afterFilters ${pop.afterFilters}`))
  } else {
    const incomplete = inScope.filter((t) => t.provenance !== "COMPLETE" || t.sourceRows.length === 0 || t.sourceRows.some((r) => r.rowHash === null))
    set("V3.provenance", pop.provenance.withoutIdentity > 0 || incomplete.length > 0
      ? skip(SKIP_PROVENANCE, `${pop.provenance.withoutIdentity} trade(s) sem identidade determinística e ${incomplete.length} com linha de origem sem rowHash${full ? "" : " (entre as âncoras)"}: a proveniência até a linha do arquivo está incompleta, não dá para alegar verificação completa`)
      : pass(full ? `${trades.length} trade(s) com identidade e rowHash em todas as linhas de origem` : `${inScope.length} âncora(s) com identidade e rowHash; o resto da população não está no bundle`))
  }

  // V3.population: fingerprint → tradeSetHash (independe das opções da consulta)
  if (full) {
    const rebuilt = tradeSetHash(trades.map(tradeFingerprintFromEvidence))
    set("V3.population", rebuilt === pop.tradeSetHash ? pass(`tradeSetHash refeito de ${trades.length} TradeEvidence = declarado (${rebuilt.slice(0, 12)}…)`) : failWith("V3.population", `declarado ${pop.tradeSetHash.slice(0, 12)}… ≠ refeito dos TradeEvidence ${rebuilt.slice(0, 12)}…: a população declarada não é a que o tradeSetHash cobre`))
  }

  // versões (V4): incompatível ⇒ nem confirma nem acusa
  const def = metricDefinition(m.metricId)
  if (m.engineVersion !== ENGINE_VERSION) {
    set("V4.versions", skip(SKIP_VERSION, `engineVersion do bundle "${m.engineVersion}" ≠ motor atual "${ENGINE_VERSION}": não é adulteração, não dá para reproduzir com este motor`))
  } else if (!def) {
    set("V4.versions", failWith("V4.versions", `métrica "${m.metricId}" não existe no catálogo do motor ${ENGINE_VERSION}`))
  } else if (def.version !== m.definitionVersion) {
    set("V4.versions", skip(SKIP_VERSION, `definitionVersion "${m.definitionVersion}" ≠ do catálogo atual "${def.version}" para ${m.metricId}: não é adulteração, a definição mudou`))
  } else set("V4.versions", pass(`motor ${ENGINE_VERSION}, definição ${def.version}`))
  const versionOk = out["V4.versions"].status === "PASS"

  // opções (V4.query)
  const opt = optionsOf(m)
  set("V4.query", opt.ok ? pass(`opções válidas (${m.query.timeZone}, âncora ${m.query.options.timeAnchor}, P&L ${m.query.options.pnlBasis}, R ${m.query.options.rBasis}). Os filtros declarados NÃO são reaplicados à seleção original`) : failWith("V4.query", opt.why))
  if (!opt.ok) {
    skipAll([...V4, "V4.anchors"].filter((id) => !(id in out)), SKIP_QUERY, "opções inválidas (V4.query)")
    return out
  }
  const options = opt.options

  // HASH_ONLY: só âncoras
  if (!full) {
    skipAll(["V3.population", ...V4], SKIP_HASH_ONLY, `população acima do limite (${options.tradeIdsLimit}): os trades não estão no bundle, só o tradeSetHash e as âncoras — a população completa não pode ser refeita nem as métricas recalculadas, e a sequência completa (a ordem dos trades) não está no bundle: não se alega tê-la verificado`)
    const anchorMetric = m.metricId === "largestWinner" || m.metricId === "largestLoser"
    if (!anchorMetric) {
      set("V4.anchors", skip(SKIP_NO_ANCHOR, `${m.metricId} não é igual ao P&L de um único trade: as âncoras (${[...new Set(m.contributors.items.map((c) => c.role))].join(", ") || "nenhuma"}) não bastam para conferir o valor`))
    } else if (!versionOk) {
      set("V4.anchors", skip(SKIP_VERSION, "versão incompatível (V4.versions)"))
    } else {
      const role = m.metricId === "largestWinner" ? "LARGEST_WINNER" : "LARGEST_LOSER"
      const anchors = m.contributors.items.filter((c) => c.role === role)
      const declared = m.value
      if (anchors.length === 0) {
        set("V4.anchors", declared === null ? pass(`sem âncora ${role} e value null: coerente`) : failWith("V4.anchors", `value ${declared} sem nenhuma âncora ${role}`))
      } else {
        const t = ctx.byId.get(anchors[0].tradeId)
        if (!t) set("V4.anchors", skip(SKIP_REFS, "âncora não resolvida (veja V2)"))
        else {
          const r = calculateMetricsTraced([analyticsTradeFromEvidence(t)], options).result.metrics[m.metricId]
          set("V4.anchors", same(r.value, declared) ? pass(`o motor sobre a âncora ${role} reproduz o value (${declared})`) : failWith("V4.anchors", `o motor sobre a âncora ${role} dá ${r.value}, o bundle declara ${declared}`))
        }
      }
    }
    return out
  }
  set("V4.anchors", NA("população completa no bundle: não há âncoras a conferir"))

  if (!versionOk) {
    skipAll(V4, SKIP_VERSION, "versão incompatível (V4.versions)")
    return out
  }

  // V4: o MESMO motor sobre os trades reconstruídos. Ordem de alimentação = a REGISTRADA (population.sequence.order) quando é uma permutação
  // válida da população; senão a canônica por tradeId. O motor ordena como sempre (instante de saída; empate → ordem em que recebe os trades):
  // nada é reordenado aqui, a ordem registrada só diz ao motor como desempatar, e V4.sequence confere que ele a reproduz.
  const canonical = trades.map(analyticsTradeFromEvidence).sort(cmpId)
  const declaredSeq = pop.sequence
  let probes = canonical
  let seqProblem: string | null = null
  if (declaredSeq.order !== null) {
    const probeById = new Map(canonical.map((p) => [p.id, p]))
    const seen = new Set<string>()
    const unknown = declaredSeq.order.filter((id) => !probeById.has(id))
    const repeated = declaredSeq.order.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
    if (declaredSeq.order.length !== canonical.length || unknown.length > 0 || repeated.length > 0) {
      seqProblem = `a ordem registrada não é uma permutação da população (${declaredSeq.order.length} id(s) para ${canonical.length} trade(s); ${unknown.length} desconhecido(s), ${repeated.length} repetido(s))`
    } else probes = declaredSeq.order.map((id) => probeById.get(id) as AnalyticsTrade)
  }
  let run: ReturnType<typeof calculateMetricsTraced>
  try {
    run = calculateMetricsTraced(probes, options)
  } catch (e) {
    set("V4.query", failWith("V4.query", `o motor recusou a consulta declarada: ${e instanceof Error ? e.message : "erro"}`))
    skipAll(V4, SKIP_QUERY, "o motor recusou a consulta (V4.query)")
    return out
  }
  const { result, trace } = run
  const rm = result.metrics[m.metricId]
  const mt = trace.metrics[m.metricId]
  if (!rm || !mt) {
    set("V4.versions", failWith("V4.versions", `o motor não produz "${m.metricId}"`))
    skipAll(V4, SKIP_VERSION, "métrica desconhecida do motor")
    return out
  }

  set("V4.population", result.population.tradeSetHash === pop.tradeSetHash ? pass("tradeSetHash segundo o próprio motor (sobre os trades reconstruídos) = declarado") : failWith("V4.population", `declarado ${pop.tradeSetHash.slice(0, 12)}… ≠ do motor ${result.population.tradeSetHash.slice(0, 12)}…`))

  // V4.sequence: a dependência da ordem é do MOTOR (o bundle só a declara); a ordem registrada tem de ser a que o motor reproduz
  let sequenceUnproven = false
  if (declaredSeq.dependent !== mt.sequenceDependent) {
    set("V4.sequence", failWith("V4.sequence", `${m.metricId}: o bundle declara dependent=${declaredSeq.dependent}, o motor diz ${mt.sequenceDependent}`))
  } else if (seqProblem) {
    set("V4.sequence", failWith("V4.sequence", seqProblem))
  } else if (!mt.sequenceDependent) {
    set("V4.sequence", declaredSeq.order === null ? NA(`${m.metricId} não depende da ordem dos trades`) : failWith("V4.sequence", `${m.metricId} não depende da ordem, mas o bundle registra uma`))
  } else if (declaredSeq.order === null) {
    if (hasOrderTie(canonical, options)) {
      sequenceUnproven = true
      set("V4.sequence", skip(SKIP_ORDER, `${m.metricId} depende da ordem, há trades com o mesmo instante de ordenação e o bundle não registra a ordem usada pelo motor: não dá para reproduzir a sequência, então o resultado não é confirmado nem acusado`))
    } else set("V4.sequence", pass("sem empate de instante: a ordem é determinada só pelos instantes de saída (o bundle não precisa registrá-la)"))
  } else if (same(trace.sequence, declaredSeq.order)) {
    set("V4.sequence", pass(`ordem registrada (${declaredSeq.order.length} trade(s)) reproduzida pelo motor${hasOrderTie(canonical, options) ? ", incluindo o desempate dos instantes iguais" : ""}`))
  } else {
    set("V4.sequence", failWith("V4.sequence", "a ordem registrada contradiz o motor: alimentado com ela, o motor produz outra sequência (instantes de saída fora de ordem)"))
  }

  if (sequenceUnproven) {
    for (const id of ["V4.metric-value", "V4.metric-fields", "V4.contributors"]) set(id, skip(SKIP_ORDER, `${m.metricId} depende de uma ordem que o bundle não registra (ver V4.sequence)`))
  } else {
    set("V4.metric-value", same(rm.value, m.value) ? pass(`value ${m.value} reproduzido pelo motor`) : failWith("V4.metric-value", `value declarado ${JSON.stringify(m.value)} ≠ motor ${JSON.stringify(rm.value)}`))
    const diffs: string[] = []
    const chk = (name: string, a: unknown, b: unknown) => { if (!same(a, b)) diffs.push(`${name}: declarado ${JSON.stringify(a)} ≠ motor ${JSON.stringify(b)}`) }
    chk("unit", m.unit, rm.unit)
    chk("basis", m.basis, rm.basis)
    chk("sampleSize", m.sampleSize, rm.sampleSize)
    chk("coverage", m.coverage, { used: rm.coverage.used, total: rm.coverage.total, ratio: rm.coverage.ratio })
    chk("reason", m.reason, rm.reason)
    set("V4.metric-fields", diffs.length === 0 ? pass("unit, basis, sampleSize, coverage e reason reproduzidos pelo motor") : failWith("V4.metric-fields", diffs.join("; ")))
    const items = (mt.applicable ? (mt.contributors ?? mt.anchors) : []).map((c) => ({ tradeId: c.tradeId, role: c.role, ...(c.rank !== undefined ? { rank: c.rank } : {}) }))
    const expected = { applicable: mt.applicable, complete: mt.applicable ? mt.contributors !== null : true, roleCounts: mt.roleCounts, items }
    set("V4.contributors", same(m.contributors, expected) ? pass(`${items.length} contribuinte(s) e roleCounts = trace do motor`) : failWith("V4.contributors", `contributors declarados ≠ trace do motor (applicable ${m.contributors.applicable}/${expected.applicable}, complete ${m.contributors.complete}/${expected.complete}, ${m.contributors.items.length}/${items.length} item(ns))`))
  }

  // qualidade, período e avisos
  if (m.scope === "TOTAL") {
    const drop = (ws: Array<{ code: string }>) => ws.filter((w) => !WARNINGS_NOT_REVERIFIABLE.has(w.code))
    const diffs: string[] = []
    if (!same(m.dataQuality, result.dataQuality)) diffs.push("dataQuality")
    if (!same(m.period, { fromLocalDate: result.period.fromLocalDate, toLocalDate: result.period.toLocalDate, fromInstantUtc: result.period.fromInstantUtc, toInstantUtc: result.period.toInstantUtc })) diffs.push("period")
    if (!same(drop(m.warnings), drop(result.warnings))) diffs.push("warnings")
    set("V4.quality", diffs.length === 0 ? pass("dataQuality, período e avisos reproduzidos pelo motor (aviso que depende dos filtros sobre o conjunto de entrada fica de fora)") : failWith("V4.quality", `${diffs.join(", ")} declarado(s) ≠ motor`))
  } else {
    const ok = m.dataQuality === null && m.period === null && m.warnings.length === 0
    set("V4.quality", ok ? pass("grupo: o motor só calcula qualidade/período/avisos para a população total; o bundle declara null/[] (nada a conferir)") : failWith("V4.quality", "grupo com dataQuality/period/warnings preenchidos: o motor não os calcula por grupo"))
  }

  // associação à consulta
  set("V4.association", association(m, trades, probes, options))
  return out
}

function association(m: MetricEvidence, trades: TradeEvidence[], probes: AnalyticsTrade[], options: AnalysisOptions): Outcome {
  const problems: string[] = []
  const unverifiable: string[] = []
  let verified = 0
  const N = trades.length

  if (m.scope === "TOTAL") {
    if (m.query.groupBy !== null || m.query.groupKey !== null || m.sampleFlag !== null) problems.push("escopo TOTAL com groupBy/groupKey/sampleFlag")
  } else {
    const by = m.query.groupBy
    const key = m.query.groupKey
    if (!by || !key || by.length === 0 || by.length !== key.length) problems.push("grupo sem groupBy/groupKey coerentes")
    else {
      const engineIdx: number[] = []
      by.forEach((dim, i) => {
        if (REF_DIMS.has(dim)) {
          const bad = trades.filter((t) => t.accountRef !== key[i])
          if (bad.length > 0) problems.push(`${bad.length} trade(s) com accountRef ≠ da chave do grupo (${key[i] ?? "null"})`)
          verified += 1
        } else if (ENGINE_DIMS.has(dim)) engineIdx.push(i)
        else unverifiable.push(dim)
      })
      if (engineIdx.length > 0) {
        try {
          const agg = aggregateTradesTraced(probes, { groupBy: engineIdx.map((i) => by[i]) as Dimension[], ...options })
          const want = engineIdx.map((i) => key[i])
          if (agg.result.groups.length !== 1 || !same(agg.result.groups[0].key, want)) problems.push(`os trades não pertencem todos ao grupo ${JSON.stringify(want)} nas dimensões ${engineIdx.map((i) => by[i]).join("/")} (o motor os separa em ${agg.result.groups.length} grupo(s))`)
          verified += 1
        } catch (e) {
          problems.push(`dimensões inválidas: ${e instanceof Error ? e.message : "erro"}`)
        }
      }
      if (m.sampleFlag !== sampleFlagOf(N, options.minSample ?? 30)) problems.push(`sampleFlag ${m.sampleFlag} ≠ ${sampleFlagOf(N, options.minSample ?? 30)} para ${N} trade(s) e minSample ${options.minSample}`)
      else verified += 1
    }
  }

  // filtros declarados: conta por accountRef; os derivados do que a Evidence carrega, pelo próprio motor; o resto, sem referência
  const f = m.query.filters
  const refs = f.accountRefs
  if (refs !== undefined) {
    if (!Array.isArray(refs) || !refs.every((r) => typeof r === "string")) problems.push("filters.accountRefs inválido")
    else {
      const bad = trades.filter((t) => t.accountRef === null || !refs.includes(t.accountRef))
      if (bad.length > 0) problems.push(`${bad.length} trade(s) fora de filters.accountRefs`)
      verified += 1
    }
  }
  const engineFilters: Record<string, unknown> = {}
  for (const k of ENGINE_FILTERS) if (f[k] !== undefined) engineFilters[k] = f[k]
  if (Object.keys(engineFilters).length > 0) {
    try {
      const r = calculateMetricsTraced(probes, { ...options, filters: engineFilters }).result
      if (r.population.afterFilters !== N) problems.push(`${N - r.population.afterFilters} trade(s) da população violam os filtros declarados (${Object.keys(engineFilters).join(", ")})`)
      verified += 1
    } catch (e) {
      problems.push(`filtros inválidos: ${e instanceof Error ? e.message : "erro"}`)
    }
  }
  for (const k of Object.keys(f)) if (k !== "accountRefs" && !(ENGINE_FILTERS as readonly string[]).includes(k)) unverifiable.push(`filtro ${k}`)

  if (problems.length > 0) return failWith("V4.association", problems.join("; "))
  if (unverifiable.length > 0) return skip(SKIP_ASSOCIATION, `${[...new Set(unverifiable)].join(", ")}: a Evidence não tem referência (estratégia, sessão, setup, timeframe… não entram, de propósito) — a associação NÃO foi verificada${verified > 0 ? `; o que tem referência foi conferido (${verified} verificação(ões))` : ""}`)
  if (verified === 0) return NA("população total sem filtros nem agrupamento: não há associação a conferir")
  return pass(`${verified} verificação(ões) de associação (conta por accountRef, dimensões do grupo pelo motor, filtros derivados, sampleFlag)`)
}

function v34(bundle: EvidenceBundle): Map<string, Outcome> {
  const out = new Map<string, Outcome>()
  const ids = ["V3.population", "V3.provenance", "V4.versions", "V4.query", "V4.population", "V4.sequence", "V4.metric-value", "V4.metric-fields", "V4.contributors", "V4.quality", "V4.association", "V4.anchors"]
  const { metrics, trades } = bundle.evidence
  if (metrics.length === 0) {
    for (const id of ids) out.set(id, skip(SKIP_NO_METRICS, "bundle sem métricas: não há população nem valor a conferir"))
    return out
  }
  const byId = new Map<string, TradeEvidence>()
  let duplicated = false
  for (const t of trades) { if (byId.has(t.tradeId)) duplicated = true; byId.set(t.tradeId, t) }
  const per = metrics.map((m, i) => ({ label: `${m.metricId}#${i}`, r: perMetric(m, `${m.metricId}#${i}`, { byId, duplicated }) }))
  for (const id of ids) out.set(id, combine(id as keyof typeof FAIL_CODES, per.map((p) => ({ label: p.label, o: p.r[id] ?? NA("não se aplica") }))))
  return out
}

// ── verifyEvidence ───────────────────────────────────────────────────────────

/** `input` é `unknown` de propósito: o verificador recebe JSON de fora e nunca lança por dado malformado. */
export function verifyEvidence(input: unknown): VerifyReport {
  const outcomes = new Map<string, Outcome>()

  // V0 — formato
  let bundle: EvidenceBundle | null = null
  if (!isRecord(input)) {
    outcomes.set("V0.structure", failWith("V0.structure", `o bundle precisa ser um objeto JSON (veio ${input === null ? "null" : Array.isArray(input) ? "array" : typeof input}).`))
    outcomes.set("V0.schema-id", skip(SKIP_FORMAT, "entrada não é objeto"))
    outcomes.set("V0.seal-format", skip(SKIP_FORMAT, "entrada não é objeto"))
  } else {
    const schemaId = input.schema
    outcomes.set(
      "V0.schema-id",
      schemaId === EVIDENCE_SCHEMA
        ? pass(`schema "${EVIDENCE_SCHEMA}"`)
        : failWith("V0.schema-id", `schema desconhecido: ${typeof schemaId === "string" ? JSON.stringify(schemaId.slice(0, 40)) : schemaId === undefined ? "ausente" : `tipo ${typeof schemaId}`} (esperado "${EVIDENCE_SCHEMA}").`),
    )
    const seal = input.evidenceHash
    outcomes.set(
      "V0.seal-format",
      typeof seal === "string" && SEAL_RE.test(seal)
        ? pass("evidenceHash com 64 caracteres hexadecimais minúsculos")
        : failWith("V0.seal-format", seal === undefined ? "evidenceHash ausente." : typeof seal !== "string" ? `evidenceHash com tipo inválido (${typeof seal}).` : `evidenceHash malformado (${seal.length} caractere(s); esperado 64 hexadecimais minúsculos): truncado, com caracteres inválidos ou em maiúsculas.`),
    )
    try {
      const parsed = EvidenceBundleSchema.safeParse(input)
      if (parsed.success) {
        bundle = parsed.data
        outcomes.set("V0.structure", pass("passa no schema evidence/1 estrito"))
      } else {
        const issues = parsed.error.issues.slice(0, 3).map((i) => `${issuePath(i.path)}: ${i.message}`)
        outcomes.set("V0.structure", failWith("V0.structure", `${parsed.error.issues.length} problema(s) de formato — ${issues.join("; ")}${parsed.error.issues.length > 3 ? " …" : ""}`))
      }
    } catch {
      outcomes.set("V0.structure", failWith("V0.structure", "a entrada não pôde ser processada pelo schema (estrutura inválida)."))
    }
  }

  // V0 — JSON canônico e campos desconhecidos (só faz sentido com a estrutura válida)
  if (bundle !== null) {
    let canonicalOk = true
    try {
      canonicalJson(input)
      outcomes.set("V0.canonical-json", pass("o bundle é JSON puro e canonicalizável"))
    } catch (e) {
      canonicalOk = false
      outcomes.set("V0.canonical-json", failWith("V0.canonical-json", `o bundle contém valor que não é JSON puro (${e instanceof Error ? e.message : "erro"}); o selo não pode ser calculado.`))
    }
    if (canonicalOk) {
      // o schema reaproveita sub-schemas do Canonical que NÃO são strict (entry.at, pernas, exitSummary, issues…): campo extra ali é
      // descartado em silêncio no parse. O V0 não aceita isso: compara a entrada com a saída do schema e acusa a chave descartada.
      const stripped = strippedPath(input, bundle, "")
      outcomes.set("V0.unknown-fields", stripped === null ? pass("nenhum campo fora do contrato, em nenhum nível") : failWith("V0.unknown-fields", `campo desconhecido "${stripped}" (o schema o descartaria em silêncio; o verificador não aceita).`))
    } else {
      outcomes.set("V0.unknown-fields", skip(SKIP_FORMAT, "JSON não canonicalizável"))
    }
  } else {
    outcomes.set("V0.canonical-json", skip(SKIP_FORMAT, "estrutura inválida"))
    outcomes.set("V0.unknown-fields", skip(SKIP_FORMAT, "estrutura inválida"))
  }

  const v0Failed = CHECK_CATALOG.filter((c) => c.level === "V0").some((c) => outcomes.get(c.id)?.status === "FAIL")

  if (v0Failed || bundle === null) {
    for (const c of CHECK_CATALOG) if (c.level !== "V0") outcomes.set(c.id, skip(SKIP_FORMAT, "não executado: o formato (V0) é inválido, então selo, referências, população e métricas não são confiáveis de ler"))
  } else {
    // V1 — selo (a MESMA implementação do contrato: JSON canônico + SHA-256, sem `evidenceHash`/`importedAt`/`computedAt`)
    const recomputed = computeEvidenceHash(bundle)
    outcomes.set("V1.seal", recomputed === bundle.evidenceHash ? pass("evidenceHash recalculado = declarado") : failWith("V1.seal", `evidenceHash declarado ${bundle.evidenceHash.slice(0, 12)}… ≠ recalculado ${recomputed.slice(0, 12)}…: o conteúdo foi alterado depois do selo (ou o selo foi trocado).`))
    // V2 — referências
    for (const [id, o] of v2(bundle)) outcomes.set(id, o)
    // V3/V4 — população e métricas (o motor existente sobre os trades declarados)
    for (const [id, o] of v34(bundle)) outcomes.set(id, o)
  }

  const checks: VerifyCheck[] = CHECK_CATALOG.map((c) => {
    const o = outcomes.get(c.id) as Outcome
    return { id: c.id, level: c.level, status: o.status, code: o.status === "PASS" ? null : (o.code ?? null), detail: o.detail }
  })

  let status: VerifyStatus
  if (checks.some((c) => c.level === "V0" && c.status === "FAIL")) status = "INVALID_FORMAT"
  else if (checks.some((c) => c.status === "FAIL")) status = "TAMPERED"
  else if (checks.some((c) => c.status === "SKIPPED" && c.code !== SKIP_NOT_APPLICABLE)) status = "UNVERIFIABLE"
  else status = "VALID"
  return { schema: VERIFY_SCHEMA, status, checks, limitations: LIMITATIONS.map((l) => ({ ...l })) }
}
