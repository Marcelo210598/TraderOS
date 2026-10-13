// Validador ESTRUTURAL da resposta do agente (E6.6-2a; agent-capabilities.md §5.2 passos 1–4 e 6). Só olha a FORMA: refs no ledger, frescor, época, caminho do slot,
// relação slot×claim, modo×veredito e frases obrigatórias. NÃO lê o sentido do texto livre (dígitos, aritmética, causa, escopo verbal, conclusão): isso é o E6.6-2b, e é
// a ÚNICA defesa dessa parte (decisão C10 = B do Marcelo: claim LABELED é aceito em handle DERIVED; "concluir/comparar/recomendar" sobre NOT_VERIFIED é lexical).
// Devolve TODOS os motivos (sem duplicata, em ordem fixa de passo), nunca valores. Puro, nunca lança, não altera a resposta nem o ledger.
import { AgentAnswerSchema, CombinedVerdictSchema, REJECTION_REASONS } from "./contract.ts"
import { isStale, lookupRef, type Ledger, type LedgerEntry } from "./ledger.ts"
import { PARTIAL_PHRASES, SPECIFIC_PHRASES, STOP_PHRASES } from "./phrases.ts"
import { resolveSlot } from "./slot-path.ts"

export type RejectionReasonCode = (typeof REJECTION_REASONS)[number]
export type StructureResult =
  | { readonly ok: true; readonly claims: ReadonlyArray<{ ref: string; path: string; mode: "ASSERT" | "LABELED"; combined: string }> }
  | { readonly ok: false; readonly reasons: RejectionReasonCode[] }
export interface StructureInput { answer: unknown; ledger: Ledger; stop?: null | "BUDGET_CALLS" }

/** Ordem em que os motivos saem (== ordem dos passos; STRUCTURE_INVALID de forma entra depois dos caminhos). */
const ORDER: readonly RejectionReasonCode[] = [
  "REF_NOT_IN_LEDGER", "STALE_REF", "REF_EPOCH_MIX", "SLOT_PATH_INVALID", "STRUCTURE_INVALID", "NUMBER_FROM_UNVERIFIED_EVIDENCE", "MISSING_NOT_VERIFIED_LABEL",
  "SCOPE_OVERCLAIM", "MISSING_PARTIAL_PHRASE", "INCONCLUSIVE_AS_CONCLUSIVE", "INCOMPLETE_PRESENTED_AS_COMPLETE",
]
const fail = (found: ReadonlySet<RejectionReasonCode>): StructureResult => ({ ok: false, reasons: ORDER.filter((r) => found.has(r)) })
/** Os valores do veredito combinado vêm do enum do contrato (nunca como literal aqui: o guarda G2 proíbe uma 2ª derivação por texto). Aqui só se LÊ o `combined`. */
const C = CombinedVerdictSchema.enum
const MALFORMED: StructureResult = { ok: false, reasons: ["STRUCTURE_INVALID"] }

const SERVER_ONLY = new Set<string>(["REGEN_EXHAUSTED", "CAPABILITY_FAILED"])
const isStopPhrase = (code: string): boolean => Object.hasOwn(STOP_PHRASES, code)
const PARTIAL_CODES = Object.keys(PARTIAL_PHRASES)

/** O código de frase cabe a ESTE handle? (frase que o handle não justifica seria uma limitação falsa dita pelo modelo) */
function phraseFitsHandle(code: string, h: LedgerEntry["handle"]): boolean {
  if (code === "POPULATION_DECLARED" || code === "INDICATIVE_ONLY") return true
  if (code === "VERIFICATION_INFRA_MISSING") return h.verdict.source.status === "NOT_RUN"
  if (code === "INTEGRITY_SEAL") return h.verdict.verify.status === "TAMPERED"
  if (code === "INTEGRITY_SOURCE") return h.verdict.source.status === "SOURCE_MISMATCH"
  if (code === "INTEGRITY_FORMAT") return h.verdict.verify.status === "INVALID_FORMAT"
  if (Object.hasOwn(SPECIFIC_PHRASES, code) || Object.hasOwn(PARTIAL_PHRASES, code)) return h.verdict.verify.codes.includes(code) || h.verdict.source.codes.includes(code)
  return false
}

export function validateStructure(input: StructureInput): StructureResult {
  try {
    if (typeof input !== "object" || input === null || typeof input.ledger !== "object" || input.ledger === null || typeof input.ledger.entries !== "object" || input.ledger.entries === null) return MALFORMED
    const stop = input.stop ?? null
    if (stop !== null && stop !== "BUDGET_CALLS") return MALFORMED
    const parsed = AgentAnswerSchema.safeParse(input.answer) // passo 1
    if (!parsed.success) return MALFORMED
    const { segments, claims } = parsed.data
    const ledger = input.ledger
    const found = new Set<RejectionReasonCode>()

    const slots = segments.flatMap((s) => (s.kind === "slot" ? [s] : []))
    const phrases = segments.flatMap((s) => (s.kind === "phrase" ? [s] : []))
    const cited = [...new Set([...slots.map((s) => s.ref), ...claims.map((c) => c.ref), ...phrases.flatMap((p) => (p.ref === undefined ? [] : [p.ref]))])]

    // passo 2: refs no ledger, frescor e época
    const entries = new Map<string, LedgerEntry>()
    for (const ref of cited) {
      const e = lookupRef(ledger, ref)
      if (!e) found.add("REF_NOT_IN_LEDGER")
      else {
        entries.set(ref, e)
        if (isStale(ledger, e)) found.add("STALE_REF")
      }
    }
    if (new Set([...entries.values()].map((e) => e.handle.refEpoch)).size > 1) found.add("REF_EPOCH_MIX")

    // passo 3: caminho do slot (só caminho: falha de FORMATO não é motivo, o modelo não consegue consertá-la)
    const pair = (ref: string, path: string): string => `${ref}|${path}`
    for (const x of [...slots, ...claims]) {
      const e = entries.get(x.ref)
      if (e && !resolveSlot(e.capability, e.view, x.path).ok) found.add("SLOT_PATH_INVALID")
    }
    // passo 3b: slot × claim 1:1 (C2)
    const slotKeys = new Set(slots.map((s) => pair(s.ref, s.path)))
    const claimKeys = claims.map((c) => pair(c.ref, c.path))
    if (new Set(claimKeys).size !== claimKeys.length || claimKeys.some((k) => !slotKeys.has(k)) || [...slotKeys].some((k) => !claimKeys.includes(k))) found.add("STRUCTURE_INVALID")

    // passo 4: veredito × modo
    const slotRefs = new Set(slots.map((s) => s.ref))
    for (const ref of new Set([...slotRefs, ...claims.map((c) => c.ref)])) {
      const e = entries.get(ref)
      if (!e) continue
      const v = e.handle.verdict
      if (v.combined === C.TAMPERED_OR_MISMATCH || (v.combined === C.NOT_VERIFIED && v.verify.status !== "VALID")) { found.add("NUMBER_FROM_UNVERIFIED_EVIDENCE"); continue }
      for (const c of claims.filter((x) => x.ref === ref)) {
        if (v.combined === C.NOT_VERIFIED && c.mode === "ASSERT") found.add("MISSING_NOT_VERIFIED_LABEL")
        if ((v.combined === C.VERIFIED || v.combined === C.VERIFIED_PARTIAL) && c.mode === "LABELED") found.add("STRUCTURE_INVALID") // C3
      }
    }

    // passo 6: frases obrigatórias (por ref) + higiene das frases emitidas
    const has = (code: string, ref: string | undefined): boolean => phrases.some((p) => p.code === code && p.ref === ref)
    for (const p of phrases) {
      if (isStopPhrase(p.code)) {
        if (p.ref !== undefined || SERVER_ONLY.has(p.code) || (p.code === "BUDGET_LIMIT_REACHED" && stop !== "BUDGET_CALLS")) found.add("STRUCTURE_INVALID") // C5
      } else if (p.ref === undefined) found.add("STRUCTURE_INVALID")
      else {
        const e = entries.get(p.ref)
        if (e && !phraseFitsHandle(p.code, e.handle)) found.add("STRUCTURE_INVALID") // C4
      }
    }
    for (const ref of slotRefs) {
      const e = entries.get(ref)
      if (!e) continue
      const v = e.handle.verdict
      if (v.combined === C.TAMPERED_OR_MISMATCH || (v.combined === C.NOT_VERIFIED && v.verify.status !== "VALID")) continue // número já rejeitado acima
      if (v.combined === C.VERIFIED && !has("POPULATION_DECLARED", ref)) found.add("SCOPE_OVERCLAIM")
      if (v.combined === C.VERIFIED_PARTIAL) {
        const own = PARTIAL_CODES.filter((c) => v.verify.codes.includes(c) || v.source.codes.includes(c))
        if ((own.length > 0 ? own : ["S_POPULATION_PARTIAL"]).some((c) => !has(c, ref))) found.add("MISSING_PARTIAL_PHRASE")
      }
      const pop = e.handle.population
      if ((pop.conclusive === false || pop.sampleFlag === "LOW" || pop.sampleFlag === "TINY") && !has("INDICATIVE_ONLY", ref)) found.add("INCONCLUSIVE_AS_CONCLUSIVE")
    }
    if (stop === "BUDGET_CALLS" && !has("BUDGET_LIMIT_REACHED", undefined)) found.add("INCOMPLETE_PRESENTED_AS_COMPLETE")

    if (found.size > 0) return fail(found)
    return { ok: true, claims: claims.map((c) => ({ ref: c.ref, path: c.path, mode: c.mode, combined: (entries.get(c.ref) as LedgerEntry).handle.verdict.combined })) }
  } catch {
    return MALFORMED // entrada hostil (getter que lança etc.): falha FECHADA, sem detalhe
  }
}
