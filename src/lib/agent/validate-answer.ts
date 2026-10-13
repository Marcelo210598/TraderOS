// Validador COMPLETO da resposta do agente (E6.6-2b): junta o estrutural (E6.6-2a, passos 1–4 e 6) e o de texto livre (passo 5) com os motivos acumulados
// (C6), sem duplicata, na ordem fixa `COMBINED_ORDER` (== a ordem das expectativas e66_2b.api.combined_order; permutação dos 18 motivos). Forma inválida do
// AgentAnswerSchema ⇒ só STRUCTURE_INVALID (o texto nem é lido). Puro, nunca lança, sem eco.
import { AgentAnswerSchema, type REJECTION_REASONS } from "./contract.ts"
import { validateStructure, type StructureResult } from "./validate-structure.ts"
import { validateText } from "./validate-text.ts"
import type { Ledger } from "./ledger.ts"

type Reason = (typeof REJECTION_REASONS)[number]
export type AnswerResult =
  | { readonly ok: true; readonly claims: Extract<StructureResult, { ok: true }>["claims"] }
  | { readonly ok: false; readonly reasons: Reason[] }
export interface AnswerInput { answer: unknown; ledger: Ledger; stop?: null | "BUDGET_CALLS"; question?: string }

export const COMBINED_ORDER: readonly Reason[] = [
  "REF_NOT_IN_LEDGER", "STALE_REF", "REF_EPOCH_MIX", "SLOT_PATH_INVALID", "STRUCTURE_INVALID", "NUMBER_FROM_UNVERIFIED_EVIDENCE", "MISSING_NOT_VERIFIED_LABEL", "NUMBER_OUTSIDE_SLOT",
  "MODEL_ARITHMETIC", "CAUSAL_CLAIM", "SCOPE_OVERCLAIM", "MISSING_PARTIAL_PHRASE", "INCONCLUSIVE_AS_CONCLUSIVE", "EXIT_REASON_OVERCLAIM", "TIE_OVERCLAIM", "UNVERIFIED_USED_FOR_CONCLUSION",
  "OPERATIONAL_ADVICE", "INCOMPLETE_PRESENTED_AS_COMPLETE",
]
const MALFORMED: AnswerResult = { ok: false, reasons: ["STRUCTURE_INVALID"] }

export function validateAnswer(input: AnswerInput): AnswerResult {
  try {
    if (typeof input !== "object" || input === null || !AgentAnswerSchema.safeParse(input.answer).success) return MALFORMED
    const structure = validateStructure({ answer: input.answer, ledger: input.ledger, stop: input.stop ?? null })
    const text = validateText({ answer: input.answer, ledger: input.ledger, question: input.question })
    const found = new Set<Reason>([...(structure.ok ? [] : structure.reasons), ...(text.ok ? [] : text.reasons)])
    if (found.size === 0) return structure.ok ? { ok: true, claims: structure.claims } : MALFORMED
    return { ok: false, reasons: COMBINED_ORDER.filter((r) => found.has(r)) }
  } catch {
    return MALFORMED
  }
}
