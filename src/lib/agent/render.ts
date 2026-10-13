// Render da resposta do agente (E6.6-3; Q14): RenderedSegment[] + banner. É o SERVIDOR quem escreve números e frases (D2/D9): o texto do modelo passa intocado, os slots
// viram texto pelo formatador do E6.6-1, as frases vêm do catálogo. Regras (expectativa e66_3):
//   · cada `value` leva o veredito e o modo do PRÓPRIO claim (AV20); o banner é o PIOR veredito entre TODOS os refs citados (inclusive os só de frase) (D8);
//   · frase ESPECÍFICA (S_*): inserida pelo servidor, UMA vez por ref, antes do 1º slot desse ref (D1); a que o modelo emitiu para o mesmo ref sai do corpo;
//   · frase ESTRUTURAL: rodapé ÚNICO, último segmento, texto idêntico (D2); avisos de parada do servidor (CAPABILITY_FAILED) logo antes dele (D3);
//   · {n} da frase de população = população declarada formatada como contagem (D4).
// Só renderiza resposta que passou em validateAnswer. Falha de render = violação de invariante ⇒ RENDER_FAILED (o chamador usa CAPABILITY_FAILED, Q17), sem detalhe.
// Puro, determinístico, nunca lança, saída congelada. Só `zod` e `./` (SG1).
import { BANNER_LABELS, CAPABILITY_LABELS, REJECTION_PHRASES } from "./catalog.ts"
import { AgentAnswerSchema, CombinedVerdictSchema, type CombinedVerdict } from "./contract.ts"
import { formatNumber } from "./format.ts"
import { lookupRef, type Ledger, type LedgerEntry } from "./ledger.ts"
import { PHRASES, SPECIFIC_PHRASES, STRUCTURAL_CODE, STRUCTURAL_TEXT } from "./phrases.ts"
import { renderSlot } from "./slot-path.ts"
import type { TurnState } from "./turn.ts"
import { validateAnswer } from "./validate-answer.ts"

export type RenderedSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "value"; readonly ref: string; readonly path: string; readonly text: string; readonly combined: CombinedVerdict; readonly mode: "ASSERT" | "LABELED" }
  | { readonly kind: "phrase"; readonly code: string; readonly text: string }
  | { readonly kind: "server_text"; readonly text: string }
export interface Banner { readonly combined: CombinedVerdict | null; readonly label: string | null }
export interface RenderedAnswer { readonly segments: readonly RenderedSegment[]; readonly banner: Banner; readonly stopReason: "REGEN_EXHAUSTED" | null }
export type RenderResult = { readonly ok: true; readonly rendered: RenderedAnswer } | { readonly ok: false; readonly code: "RENDER_FAILED" }
export interface RenderInput { answer: unknown; ledger: Ledger; notices: readonly string[]; stop?: null | "BUDGET_CALLS"; question?: string }

const FAILED: RenderResult = { ok: false, code: "RENDER_FAILED" }
const NO_BANNER: Banner = { combined: null, label: null }
const SEVERITY = CombinedVerdictSchema.options // do menos para o mais grave: VERIFIED, VERIFIED_PARTIAL, NOT_VERIFIED, TAMPERED_OR_MISMATCH
const phrase = (code: string): RenderedSegment => ({ kind: "phrase", code, text: (PHRASES as Record<string, string>)[code] })
const structural: RenderedSegment = { kind: "phrase", code: STRUCTURAL_CODE, text: STRUCTURAL_TEXT }

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) }
  return x
}

/** Códigos S_* específicos do handle (os que bloqueiam a conferência), na ordem do catálogo. */
const specificCodesOf = (e: LedgerEntry): string[] => {
  const own = new Set([...e.handle.verdict.verify.codes, ...e.handle.verdict.source.codes])
  return Object.keys(SPECIFIC_PHRASES).filter((c) => own.has(c))
}

export function renderAnswer(input: RenderInput): RenderResult {
  try {
    const notices = input.notices
    if (!Array.isArray(notices) || notices.some((n) => n !== "CAPABILITY_FAILED" && n !== "FILE_NOT_AVAILABLE")) return FAILED
    const checked = validateAnswer({ answer: input.answer, ledger: input.ledger, stop: input.stop ?? null, question: input.question })
    if (!checked.ok) return FAILED
    const parsed = AgentAnswerSchema.safeParse(input.answer)
    if (!parsed.success) return FAILED
    const { segments, claims } = parsed.data
    const entry = (ref: string): LedgerEntry => lookupRef(input.ledger, ref) as LedgerEntry // validateAnswer garantiu que existe
    const slotRefs = [...new Set(segments.flatMap((s) => (s.kind === "slot" ? [s.ref] : [])))]
    const needFooter = slotRefs.some((r) => entry(r).handle.verdict.source.status === "NOT_RUN") || notices.includes("FILE_NOT_AVAILABLE")
    const autoSpecific = new Map(slotRefs.map((r) => [r, specificCodesOf(entry(r))] as const))
    const placed = new Set<string>()
    const out: RenderedSegment[] = []
    for (const s of segments) {
      if (s.kind === "text") { out.push({ kind: "text", text: s.text }); continue }
      if (s.kind === "slot") {
        const e = entry(s.ref)
        if (!placed.has(s.ref)) { placed.add(s.ref); for (const code of autoSpecific.get(s.ref) ?? []) out.push(phrase(code)) }
        const r = renderSlot(e.capability, e.view, s.path)
        const mode = claims.find((c) => c.ref === s.ref && c.path === s.path)?.mode
        if (!r.ok || mode === undefined) return FAILED
        out.push({ kind: "value", ref: s.ref, path: s.path, text: r.text, combined: e.handle.verdict.combined, mode })
        continue
      }
      // frase emitida pelo modelo
      if (s.code === STRUCTURAL_CODE && needFooter) continue
      if (s.ref !== undefined && (autoSpecific.get(s.ref) ?? []).includes(s.code)) continue // reaparece na posição canônica
      if (s.code === "POPULATION_DECLARED") {
        const n = formatNumber(entry(s.ref as string).handle.population.declared, "count")
        if (!n.ok) return FAILED
        out.push({ kind: "phrase", code: s.code, text: PHRASES.POPULATION_DECLARED.replace("{n}", n.text) })
        continue
      }
      out.push(phrase(s.code))
    }
    if (notices.includes("CAPABILITY_FAILED")) out.push(phrase("CAPABILITY_FAILED"))
    if (needFooter) out.push(structural)
    const cited = new Set([...slotRefs, ...claims.map((c) => c.ref), ...segments.flatMap((s) => (s.kind === "phrase" && s.ref !== undefined ? [s.ref] : []))])
    const worst = [...cited].map((r) => entry(r).handle.verdict.combined).reduce<CombinedVerdict | null>((w, c) => (w === null || SEVERITY.indexOf(c) > SEVERITY.indexOf(w) ? c : w), null)
    const banner: Banner = worst === null ? NO_BANNER : { combined: worst, label: BANNER_LABELS[worst] }
    return { ok: true, rendered: deepFreeze({ segments: out, banner, stopReason: null }) }
  } catch {
    return FAILED
  }
}

/**
 * Resposta canônica de falha (REGEN_EXHAUSTED; AV19/AV22): função SÓ do estado do turno — nenhum texto do modelo entra, nenhum número, nenhum ref.
 * Ordem: frase de falha · consultas tentadas · motivo da última rejeição · (orçamento estourado) frase de limite · (falha de capacidade) aviso · (arquivo ausente) texto estrutural.
 */
export function stopResponse(state: TurnState): RenderedAnswer {
  const tried = state.tried.map((c) => CAPABILITY_LABELS[c])
  const out: RenderedSegment[] = [phrase("REGEN_EXHAUSTED"), { kind: "server_text", text: tried.length > 0 ? `Consultas tentadas: ${tried.join(", ")}.` : "Nenhuma consulta foi concluída." }]
  if (state.lastReasons.length > 0) out.push({ kind: "server_text", text: `Motivo da última rejeição: ${REJECTION_PHRASES[state.lastReasons[0]]}.` })
  if (state.budgetExceeded) out.push(phrase("BUDGET_LIMIT_REACHED"))
  const kinds = new Set(state.failed.map((f) => f.code))
  if (["ARGS_INVALID", "NOT_FOUND", "ENGINE_REFUSED"].some((c) => kinds.has(c as never))) out.push(phrase("CAPABILITY_FAILED"))
  if (kinds.has("FILE_NOT_AVAILABLE")) out.push(structural)
  return deepFreeze({ segments: out, banner: NO_BANNER, stopReason: "REGEN_EXHAUSTED" as const })
}
