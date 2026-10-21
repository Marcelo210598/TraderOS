// Tela do AI Partner (E7-15e, D-U4/D-U5): RenderedAnswer (o que o servidor já validou e renderizou) → blocos de exibição. Só dados de TEXTO: nada vira HTML, link nem atributo; o bloco de valor
// NÃO carrega `ref` nem `path` (identificadores internos nunca chegam à tela). Entrada malformada ⇒ null (a tela mostra erro genérico, nunca meia resposta). Puro, determinístico, saída congelada, nunca lança.
export type Verdict = "verified" | "partial" | "unverified" | "mismatch"
export type DisplayBlock =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "value"; readonly text: string; readonly verdict: Verdict; readonly verdictLabel: string; readonly mode: "ASSERT" | "LABELED" }
  | { readonly kind: "note"; readonly code: string; readonly text: string }
export interface AnswerView {
  readonly blocks: readonly DisplayBlock[]
  readonly banner: { readonly verdict: Verdict; readonly label: string } | null
  readonly stopped: boolean
}

/** Veredito combinado do contrato → palavra da tela (a cor nunca é a única informação). */
const VERDICTS: Readonly<Record<string, { readonly verdict: Verdict; readonly label: string }>> = Object.freeze({
  VERIFIED: { verdict: "verified", label: "verificado" },
  VERIFIED_PARTIAL: { verdict: "partial", label: "verificado parcialmente" },
  NOT_VERIFIED: { verdict: "unverified", label: "não verificado" },
  TAMPERED_OR_MISMATCH: { verdict: "mismatch", label: "não confere" },
})
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const verdictOf = (combined: unknown): { readonly verdict: Verdict; readonly label: string } | null => (typeof combined === "string" && Object.hasOwn(VERDICTS, combined) ? VERDICTS[combined] : null)

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) }
  return x
}

export function toBlocks(input: unknown): AnswerView | null {
  try {
    if (!isRecord(input) || !Array.isArray(input.segments) || input.segments.length === 0) return null
    const blocks: DisplayBlock[] = []
    for (const s of input.segments) {
      if (!isRecord(s) || typeof s.text !== "string") return null
      if (s.kind === "text" || s.kind === "server_text") blocks.push({ kind: "text", text: s.text })
      else if (s.kind === "phrase") { if (typeof s.code !== "string") return null; blocks.push({ kind: "note", code: s.code, text: s.text }) }
      else if (s.kind === "value") {
        const v = verdictOf(s.combined)
        if (v === null || (s.mode !== "ASSERT" && s.mode !== "LABELED")) return null
        blocks.push({ kind: "value", text: s.text, verdict: v.verdict, verdictLabel: v.label, mode: s.mode })
      } else return null
    }
    let banner: AnswerView["banner"] = null
    if (!isRecord(input.banner)) return null
    if (input.banner.combined !== null) {
      const v = verdictOf(input.banner.combined)
      if (v === null) return null
      banner = { verdict: v.verdict, label: typeof input.banner.label === "string" && input.banner.label !== "" ? input.banner.label : v.label }
    }
    if (input.stopReason !== null && input.stopReason !== "REGEN_EXHAUSTED") return null
    return deepFreeze({ blocks, banner, stopped: input.stopReason !== null })
  } catch {
    return null
  }
}
