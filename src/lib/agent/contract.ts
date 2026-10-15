// Contrato de capacidades do agente `agent-capabilities/1` (E6.5-2): SÓ constantes, schemas zod e tipos. Documento: docs/ai-partner/agent-capabilities.md.
// NÃO há capacidade implementada, nem validador, nem `combineVerdict`, nem projetor de rótulo (E6.6, aprovação própria). Nada importa este módulo
// fora de src/lib/agent/ (travado por teste). Sem LLM, sem rede, sem banco, sem Prisma, sem process.env.
import { z } from "zod"
import { PHRASE_CODES } from "./phrases.ts"
import { combineVerdict } from "./verdict.ts"

// ── constantes fixadas (agent-capabilities.md §0, §2, §8) ────────────────────
export const AGENT_CONTRACT_VERSION = "agent-capabilities/1" as const
/** N: regerações antes da resposta canônica de falha (3 tentativas no total). */
export const AGENT_MAX_REGENERATIONS = 2
/** Chamadas de capacidade por turno; a 9ª não executa (BUDGET_EXCEEDED). */
export const AGENT_MAX_CALLS_PER_TURN = 8
/** K: trades por chamada de `evidence.explain`. */
export const EXPLAIN_MAX_TRADES = 20
export const EVIDENCE_REF_RE = /^ev_[0-9a-f]{32}$/
/** Caminho de slot na PromptView (ex.: `metrics[0].value`, `groups[2].metrics[1].value`). */
export const SLOT_PATH_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\[\d{1,3}\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\d{1,3}\])?)*$/

export const EvidenceRefSchema = z.string().regex(EVIDENCE_REF_RE)
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>

// ── catálogo de capacidades (somente leitura) ────────────────────────────────
export const CAPABILITY_IDS = [
  "metrics.query@1",
  "metrics.groups@1",
  "exit.breakdown@1",
  "metrics.compare@1",
  "rank.groups@1",
  "exit.analysis@1",
  "evidence.explain@1",
  "evidence.refresh@1",
] as const
export const CapabilityIdSchema = z.enum(CAPABILITY_IDS)
export type CapabilityId = z.infer<typeof CapabilityIdSchema>
/** D5: `verify` e `verifySource` NÃO são capacidades do agente (rodam dentro de cada uma). */

export const CapabilityErrorCodeSchema = z.enum(["ARGS_INVALID", "NOT_FOUND", "BUDGET_EXCEEDED", "ENGINE_REFUSED", "FILE_NOT_AVAILABLE"])
export type CapabilityErrorCode = z.infer<typeof CapabilityErrorCodeSchema>

// ── vereditos: os DOIS componentes e o combinado (E6-G6 §6.1) ────────────────
export const VerifyStatusSchema = z.enum(["VALID", "TAMPERED", "UNVERIFIABLE", "INVALID_FORMAT"])
/** `NOT_RUN`: o E5b não executou (hoje, sempre: sem arquivo original armazenado). Conta como NOT_VERIFIED no combinado (D4). */
export const SourceStatusSchema = z.enum(["SOURCE_VERIFIED", "SOURCE_VERIFIED_PARTIAL", "SOURCE_MISMATCH", "UNVERIFIABLE", "NOT_RUN"])
export const CombinedVerdictSchema = z.enum(["VERIFIED", "VERIFIED_PARTIAL", "NOT_VERIFIED", "TAMPERED_OR_MISMATCH"])
export type VerifyStatus = z.infer<typeof VerifyStatusSchema>
export type SourceStatus = z.infer<typeof SourceStatusSchema>
export type CombinedVerdict = z.infer<typeof CombinedVerdictSchema>

const CodesSchema = z.array(z.string().regex(/^[SVL]_[A-Z_]+$/))
/** Base SEM refinamento (zod 4 não permite `.omit()`/`.pick()` em schema refinado). Não use direto: `VerdictSchema` é o contrato. */
const VerdictBase = z
  .object({
    verify: z.object({ status: VerifyStatusSchema, codes: CodesSchema }).strict(),
    source: z.object({ status: SourceStatusSchema, codes: CodesSchema }).strict(),
    combined: CombinedVerdictSchema,
  })
  .strict()
/** Não existe campo `ok`/`verified` agregado: o objeto é strict e traz SEMPRE os dois componentes + o combinado (CP1/CP2).
 *  E6.6-0d: o `combined` TEM de ser `combineVerdict(verify, source)` (única fonte, D8; verdict.ts). Mensagem fixa, sem ecoar valores de entrada.
 *  Quem constrói um Verdict deve usar `buildVerdict` (verdict.ts). */
export const VerdictSchema = VerdictBase.superRefine((v, ctx) => {
  // com status fora do enum a base já falhou e o zod NÃO executa este refine (travado em test-agent-verdict-schema.mts, S6: safeParse nunca lança)
  if (v.combined !== combineVerdict(v.verify.status, v.source.status)) ctx.addIssue({ code: "custom", message: "COMBINED_INCONSISTENT", path: ["combined"] })
})
export type Verdict = z.infer<typeof VerdictSchema>

export const PopulationSchema = z
  .object({
    declared: z.number().int().nonnegative(),
    verifiability: z.enum(["FULL", "HASH_ONLY"]),
    sampleFlag: z.enum(["OK", "LOW", "TINY"]).optional(),
    conclusive: z.boolean().optional(),
    confidence: z.enum(["OK", "LIMITED", "UNRELIABLE"]).optional(),
  })
  .strict()

/** Handle COMPLETO (servidor/ledger). Contém o `evidenceHash`, que o modelo NUNCA vê. */
export const EvidenceHandleSchema = z
  .object({
    evidenceRef: EvidenceRefSchema,
    evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
    subject: z.object({ type: z.enum(["METRIC", "TRADE", "DERIVED"]), id: z.string() }).strict(),
    scope: z.enum(["TOTAL", "GROUP"]),
    population: PopulationSchema,
    /** saltId vigente na geração dos refs (rotação ⇒ STALE). */
    refEpoch: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
    verdict: VerdictSchema,
    freshness: z.enum(["CURRENT", "STALE"]),
  })
  .strict()
export type EvidenceHandle = z.infer<typeof EvidenceHandleSchema>
/** Visão do handle que vai ao modelo: SEM `evidenceHash`. O `evidenceRef` (prefixo do hash) é o que ele cita. */
export const EvidenceHandleViewSchema = EvidenceHandleSchema.omit({ evidenceHash: true })
export type EvidenceHandleView = z.infer<typeof EvidenceHandleViewSchema>

export const LimitSchema = z.object({ code: z.string().regex(/^[SVL]_[A-Z_]+$|^VERIFICATION_INFRA_MISSING$/), text: z.string().min(1) }).strict()
export type Limit = z.infer<typeof LimitSchema>

/**
 * Envelope de toda capacidade. `data` é a PromptView da capacidade (lista branca; views.ts), nunca o bundle.
 * ok=true ⇒ data e evidence presentes; ok=false ⇒ error presente, data e evidence nulos. `ok` aqui é "a CAPACIDADE executou", não veredito de evidência.
 */
export function capabilityResultSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      contract: z.literal(AGENT_CONTRACT_VERSION),
      capability: CapabilityIdSchema,
      ok: z.boolean(),
      data: data.nullable(),
      evidence: EvidenceHandleViewSchema.nullable(),
      limits: z.array(LimitSchema),
      error: z.object({ code: CapabilityErrorCodeSchema }).strict().optional(),
    })
    .strict()
    .superRefine((raw, ctx) => {
      const v = raw as unknown as { capability: string; ok: boolean; data: unknown; evidence: unknown; error?: unknown } // `data` é genérico (T): o zod não o expõe neste ponto
      // E6.6-12: o refresh não tem PromptView: ok=true ⇒ data NULL e evidence presente; todas as outras capacidades exigem data.
      if (v.ok && v.capability === "evidence.refresh@1") { if (v.data !== null || v.evidence === null) ctx.addIssue({ code: "custom", message: "refresh ok exige data nulo e evidence" }) }
      else if (v.ok && (v.data === null || v.evidence === null)) ctx.addIssue({ code: "custom", message: "ok=true exige data e evidence" })
      if (v.ok && v.error !== undefined) ctx.addIssue({ code: "custom", message: "ok=true não tem error" })
      if (!v.ok && (v.error === undefined || v.data !== null || v.evidence !== null)) ctx.addIssue({ code: "custom", message: "ok=false exige error e data/evidence nulos" })
    })
}

// ── resposta do agente (agent-capabilities.md §4.1) ──────────────────────────
export const PhraseCodeSchema = z.enum(PHRASE_CODES)
export const SlotSegmentSchema = z.object({ kind: z.literal("slot"), ref: EvidenceRefSchema, path: z.string().regex(SLOT_PATH_RE) }).strict()
export const TextSegmentSchema = z.object({ kind: z.literal("text"), text: z.string() }).strict()
export const PhraseSegmentSchema = z.object({ kind: z.literal("phrase"), code: PhraseCodeSchema, ref: EvidenceRefSchema.optional() }).strict()
export const AnswerSegmentSchema = z.discriminatedUnion("kind", [TextSegmentSchema, SlotSegmentSchema, PhraseSegmentSchema])
/** ASSERT = afirmação (VERIFIED/VERIFIED_PARTIAL) · LABELED = valor NOT_VERIFIED rotulado, sem uso em conclusão (D3). */
export const ClaimSchema = z.object({ ref: EvidenceRefSchema, path: z.string().regex(SLOT_PATH_RE), mode: z.enum(["ASSERT", "LABELED"]) }).strict()
export const AgentAnswerSchema = z.object({ segments: z.array(AnswerSegmentSchema).min(1), claims: z.array(ClaimSchema) }).strict()
export type AgentAnswer = z.infer<typeof AgentAnswerSchema>

/** Motivos de rejeição do validador (E6.6) e de parada (§5.5). Só os NOMES são contrato aqui. */
export const REJECTION_REASONS = [
  "NUMBER_OUTSIDE_SLOT", "REF_NOT_IN_LEDGER", "SLOT_PATH_INVALID", "MODEL_ARITHMETIC", "NUMBER_FROM_UNVERIFIED_EVIDENCE", "MISSING_NOT_VERIFIED_LABEL",
  "UNVERIFIED_USED_FOR_CONCLUSION", "REF_EPOCH_MIX", "STALE_REF", "CAUSAL_CLAIM", "EXIT_REASON_OVERCLAIM", "SCOPE_OVERCLAIM", "MISSING_PARTIAL_PHRASE",
  "INCONCLUSIVE_AS_CONCLUSIVE", "INCOMPLETE_PRESENTED_AS_COMPLETE", "TIE_OVERCLAIM",
  /** E6.6-2a: a resposta não passa no AgentAnswerSchema ou viola uma regra de FORMA do validador estrutural (slot×claim, modo×veredito, higiene de frases). */
  "STRUCTURE_INVALID",
  /** E6.6-2b (Q15): o texto livre recomenda/aconselha uma ação operacional (§4.4 proíbe). */
  "OPERATIONAL_ADVICE",
] as const
export const RejectionReasonSchema = z.enum(REJECTION_REASONS)
export const STOP_REASONS = ["BUDGET_CALLS", "REGEN_EXHAUSTED", "CAPABILITY_FAILED", "FILE_NOT_AVAILABLE"] as const
export const StopReasonSchema = z.enum(STOP_REASONS)
