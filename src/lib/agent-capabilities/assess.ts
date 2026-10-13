// Pipeline COMUM das capacidades do agente (E6.6-4): bundle → verifyEvidence → (E5b só com arquivo) → buildVerdict → handle e limits. É o ÚNICO lugar (com envelope/project)
// que importa evidence/ e metrics/ (Q7); src/lib/agent/ continua puro. Toda violação de invariante falha FECHADA com ENGINE_REFUSED (Q17), sem detalhe ao modelo.
//   · NÃO altera nem recalcula o bundle (o selo é o do bundle); o ref é `ev_` + 32 hex do selo.
//   · Sem arquivo original ⇒ source = NOT_RUN e o E5b NÃO é chamado (Q11). A frase estrutural sai em `limits`.
//   · `combined` só existe via buildVerdict (única fábrica). Nunca texto cru do verificador: as frases vêm do catálogo do contrato.
// Só importa: ../agent/, ../evidence/, ./ e zod. Nada de relógio, aleatório, rede, banco, ambiente nem userId.
import { CombinedVerdictSchema, EvidenceHandleSchema, SourceStatusSchema, VerifyStatusSchema, type EvidenceHandle, type Limit, type SourceStatus, type VerifyStatus } from "../agent/contract.ts"
import { PARTIAL_PHRASES, PHRASES, SPECIFIC_PHRASES, STRUCTURAL_CODE, STRUCTURAL_TEXT } from "../agent/phrases.ts"
import { buildVerdict } from "../agent/verdict.ts"
import { EvidenceBundleSchema } from "../evidence/schema.ts"
import { verifyEvidence } from "../evidence/verify.ts"
import { verifyEvidenceSource, type SourceFiles, type VerifySourceOptions } from "../evidence/verify-source.ts"

export interface AssessOptions {
  /** saltId vigente (§7): vira o `refEpoch` do handle. */
  refEpoch: string
  /** Arquivo(s) original(is) por importId. Ausente/null ⇒ source = NOT_RUN. */
  source?: { files: SourceFiles; options?: VerifySourceOptions } | null
  /** Campos de população que o motor conhece e o bundle não guarda; mesclados POR CIMA (só chaves definidas). */
  population?: { sampleFlag?: "OK" | "LOW" | "TINY"; conclusive?: boolean; confidence?: "OK" | "LIMITED" | "UNRELIABLE" }
  /** Escopo do handle quando a capacidade sabe mais que a 1ª métrica do bundle (ex.: bundle de grupos cuja 1ª métrica é o TOTAL, E6.6-6). */
  scope?: "TOTAL" | "GROUP"
}
export type AssessResult = { readonly ok: true; readonly handle: EvidenceHandle; readonly limits: Limit[] } | { readonly ok: false; readonly code: "ENGINE_REFUSED" }
const REFUSED: AssessResult = { ok: false, code: "ENGINE_REFUSED" }
const NOT_APPLICABLE = "S_NOT_APPLICABLE"
const GROUP_OPS: readonly string[] = ["GROUP_RANKING", "GROUP_COMPARISON", "LEG_GROUP_RANKING"]

/** Regra Q11: o INVALID_FORMAT do source só vira UNVERIFIABLE se o verify do MESMO bundle também é INVALID_FORMAT; senão recusa (null). Entrada fora do contrato ⇒ null. */
export function resolveSourceStatus(source: string, verify: string): SourceStatus | null {
  if (!VerifyStatusSchema.safeParse(verify).success) return null
  if (source === "INVALID_FORMAT") return verify === "INVALID_FORMAT" ? "UNVERIFIABLE" : null
  const s = SourceStatusSchema.safeParse(source)
  return s.success && s.data !== "NOT_RUN" ? s.data : null
}

/** Códigos distintos (ordem do relatório) dos checks que não são PASS, sem o ruído S_NOT_APPLICABLE. */
export const codesOf = (checks: ReadonlyArray<{ status: string; code: string | null }>): string[] => [...new Set(checks.flatMap((c) => (c.status !== "PASS" && typeof c.code === "string" && c.code !== NOT_APPLICABLE ? [c.code] : [])))]

/** Códigos do source: checks não-PASS (sem S_NOT_APPLICABLE) ∪ as limitações que são frases PARCIAIS (L_SALT_CHECK_DIVERGENT, L_SALT_ID_NOT_RESOLVED). */
export const sourceCodesOf = (r: { checks: ReadonlyArray<{ status: string; code: string | null }>; limitations: ReadonlyArray<{ code: string }> }): string[] =>
  [...new Set([...codesOf(r.checks), ...r.limitations.map((l) => l.code).filter((c) => Object.hasOwn(PARTIAL_PHRASES, c))])]

/** Frases canônicas do handle para `limits` (o envelope): específicas (ordem do catálogo) → parciais (só em VERIFIED_PARTIAL) → estrutural por ÚLTIMO. */
export function limitsOf(handle: Pick<EvidenceHandle, "verdict">): Limit[] {
  const own = new Set([...handle.verdict.verify.codes, ...handle.verdict.source.codes])
  const text = (code: string): string => (PHRASES as Record<string, string>)[code]
  const out: Limit[] = []
  for (const code of Object.keys(SPECIFIC_PHRASES)) if (own.has(code)) out.push({ code, text: text(code) })
  if (handle.verdict.combined === CombinedVerdictSchema.enum.VERIFIED_PARTIAL) for (const code of Object.keys(PARTIAL_PHRASES)) if (own.has(code)) out.push({ code, text: text(code) })
  if (handle.verdict.source.status === "NOT_RUN") out.push({ code: STRUCTURAL_CODE, text: STRUCTURAL_TEXT })
  return out
}

export function assessBundle(bundle: unknown, options: AssessOptions): AssessResult {
  try {
    if (typeof options !== "object" || options === null) return REFUSED
    const report = verifyEvidence(bundle)
    if (report.status === "INVALID_FORMAT") return REFUSED // bundle recém-saído do motor ilegível = violação de invariante (D4-3)
    const parsed = EvidenceBundleSchema.safeParse(bundle)
    if (!parsed.success) return REFUSED
    const b = parsed.data
    const verifyStatus: VerifyStatus = report.status

    let sourceStatus: SourceStatus = "NOT_RUN"
    let sourceCodes: string[] = []
    if (options.source !== undefined && options.source !== null) {
      const sr = verifyEvidenceSource(bundle, options.source.files, options.source.options ?? {})
      const resolved = resolveSourceStatus(sr.status, verifyStatus)
      if (resolved === null) return REFUSED
      sourceStatus = resolved
      sourceCodes = sourceCodesOf(sr)
    }

    // população e escopo por tipo de assunto (D4-1, D4-2: o PRIMEIRO item do bundle)
    let declared: number
    let verifiability: "FULL" | "HASH_ONLY"
    let scope: "TOTAL" | "GROUP"
    let sampleFlag: "OK" | "LOW" | "TINY" | undefined
    let confidence: "OK" | "LIMITED" | "UNRELIABLE" | undefined
    if (b.subject.type === "METRIC") {
      const m = b.evidence.metrics[0]
      if (m === undefined) return REFUSED
      declared = m.population.afterFilters; verifiability = m.verifiability; scope = m.scope; sampleFlag = m.sampleFlag ?? undefined
    } else if (b.subject.type === "DERIVED") {
      const d = b.evidence.derived?.[0]
      if (d === undefined) return REFUSED
      declared = d.population.afterFilters; verifiability = d.verifiability; scope = GROUP_OPS.includes(d.analysis.op) ? "GROUP" : "TOTAL"; confidence = d.summary.confidence ?? undefined
    } else {
      declared = b.evidence.trades.length; verifiability = "FULL"; scope = "TOTAL"
    }
    if (options.scope !== undefined) scope = options.scope
    const population: Record<string, unknown> = { declared, verifiability }
    const over = options.population ?? {}
    const sf = over.sampleFlag !== undefined ? over.sampleFlag : sampleFlag
    const cf = over.confidence !== undefined ? over.confidence : confidence
    if (sf !== undefined) population.sampleFlag = sf
    if (over.conclusive !== undefined) population.conclusive = over.conclusive
    if (cf !== undefined) population.confidence = cf

    const handle = EvidenceHandleSchema.safeParse({
      evidenceRef: `ev_${b.evidenceHash.slice(0, 32)}`,
      evidenceHash: b.evidenceHash,
      subject: { type: b.subject.type, id: b.subject.id },
      scope,
      population,
      refEpoch: options.refEpoch,
      verdict: buildVerdict({ status: verifyStatus, codes: codesOf(report.checks) }, { status: sourceStatus, codes: sourceCodes }),
      freshness: "CURRENT",
    })
    if (!handle.success) return REFUSED
    return { ok: true, handle: handle.data, limits: limitsOf(handle.data) }
  } catch {
    return REFUSED // exceção do verificador ou entrada hostil: falha FECHADA
  }
}
