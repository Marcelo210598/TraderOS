// verifyEvidence (Evidence E5.1): V0 formato · V1 selo · V2 referências. V3 (população) e V4 (métricas) NÃO existem ainda (E5.2).
//
// Puro: sem relógio, sem random, sem banco, sem CSV, sem rede; nunca lança para dado malformado (devolve relatório).
// NÃO é segundo motor: não importa cálculo/filtro/preparo de métricas, não faz conta com P&L/R/pontos e não implementa hash —
// o selo usa `computeEvidenceHash` (JSON canônico + SHA-256 de `hash.ts`/`infra/hash.ts`).
//
// Status geral (nesta etapa NUNCA `VALID`: sem V3/V4 não há como afirmar que população e métricas conferem):
//   V0 falhou                        → INVALID_FORMAT
//   V1 ou V2 falhou                  → TAMPERED
//   V0, V1 e V2 passaram             → UNVERIFIABLE   (V3/V4 aparecem como SKIPPED, `S_NOT_IMPLEMENTED`: ausência de implementação ≠ adulteração)
// O selo (`evidenceHash`) NÃO é assinatura digital: quem altera o conteúdo e recalcula o selo passa em V0/V1. Isso só é pego por
// V3/V4 (E5.2) quando a inconsistência afeta o que elas conferem, e a prova de origem só vem do CSV original (E5b).

import { ANCHOR_ROLES, CONTRIBUTOR_ROLES } from "../metrics/trace.ts"
import { canonicalJson } from "../infra/hash.ts"
import { computeEvidenceHash } from "./hash.ts"
import { EVIDENCE_SCHEMA, EvidenceBundleSchema, type EvidenceBundle } from "./schema.ts"

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

export interface VerifyReport {
  schema: typeof VERIFY_SCHEMA
  status: VerifyStatus
  checks: VerifyCheck[]
}

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
} as const

/** Ordem FIXA dos checks do relatório (determinismo). */
const CHECKS: ReadonlyArray<{ id: string; level: CheckLevel; title: string }> = [
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
  { id: "V3.population", level: "V3", title: "tradeSetHash refeito dos TradeEvidence" },
  { id: "V4.metrics", level: "V4", title: "métricas recalculadas pelo motor sobre a população" },
]

const SKIP_NOT_IMPLEMENTED = "S_NOT_IMPLEMENTED"
const SKIP_FORMAT = "S_FORMAT_INVALID"
const SKIP_NO_METRICS = "S_NO_METRICS"

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
    for (const id of ["V2.population-shape", "V2.population-refs", "V2.contributor-refs", "V2.contributor-counts", "V2.unreferenced-trades"]) out.set(id, noMetrics(CHECKS.find((c) => c.id === id)?.title ?? id))
  } else {
    const label = (i: number) => `${metrics[i].metricId}#${i}`
    // forma da população
    const shape: string[] = []
    metrics.forEach((m, i) => {
      const ids = m.population.tradeIds
      const c = m.contributors
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
        for (const [role, n] of byRole) {
          if (!ANCHOR_ROLES.has(role as never)) counts.push(`${label(i)}: papel ${role} não é âncora e não pode estar numa lista incompleta`)
          else if (n > declared(role)) counts.push(`${label(i)}: ${n} item(ns) ${role} > roleCounts.${role}=${declared(role)}`)
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

  const v0Failed = CHECKS.filter((c) => c.level === "V0").some((c) => outcomes.get(c.id)?.status === "FAIL")

  if (v0Failed || bundle === null) {
    for (const c of CHECKS) if (c.level === "V1" || c.level === "V2") outcomes.set(c.id, skip(SKIP_FORMAT, "não executado: o formato (V0) é inválido, então selo e referências não são confiáveis de ler"))
  } else {
    // V1 — selo (a MESMA implementação do contrato: JSON canônico + SHA-256, sem `evidenceHash`/`importedAt`/`computedAt`)
    const recomputed = computeEvidenceHash(bundle)
    outcomes.set("V1.seal", recomputed === bundle.evidenceHash ? pass("evidenceHash recalculado = declarado") : failWith("V1.seal", `evidenceHash declarado ${bundle.evidenceHash.slice(0, 12)}… ≠ recalculado ${recomputed.slice(0, 12)}…: o conteúdo foi alterado depois do selo (ou o selo foi trocado).`))
    // V2 — referências
    for (const [id, o] of v2(bundle)) outcomes.set(id, o)
  }

  // V3/V4 — não implementados (E5.2): SKIPPED, nunca PASS
  outcomes.set("V3.population", skip(SKIP_NOT_IMPLEMENTED, "V3 ainda não implementado (E5.2): o tradeSetHash NÃO foi refeito dos TradeEvidence. Isto não é aprovação nem adulteração."))
  outcomes.set("V4.metrics", skip(SKIP_NOT_IMPLEMENTED, "V4 ainda não implementado (E5.2): as métricas NÃO foram recalculadas. Isto não é aprovação nem adulteração."))

  const checks: VerifyCheck[] = CHECKS.map((c) => {
    const o = outcomes.get(c.id) as Outcome
    return { id: c.id, level: c.level, status: o.status, code: o.status === "PASS" ? null : (o.code ?? null), detail: o.detail }
  })

  let status: VerifyStatus
  if (checks.some((c) => c.level === "V0" && c.status === "FAIL")) status = "INVALID_FORMAT"
  else if (checks.some((c) => (c.level === "V1" || c.level === "V2") && c.status === "FAIL")) status = "TAMPERED"
  else status = "UNVERIFIABLE" // E5.1: nunca VALID — V3/V4 não existem
  return { schema: VERIFY_SCHEMA, status, checks }
}
