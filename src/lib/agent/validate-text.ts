// Validador de TEXTO LIVRE do agente (E6.6-2b; agent-capabilities.md §5.2 passo 5). Só lê o que o MODELO escreveu em segmentos `text`: slots e frases (renderizados pelo
// servidor) são FRONTEIRAS, nunca texto. É LEXICAL (rede secundária) — EXCETO para "concluir/comparar/recomendar sobre dado NOT_VERIFIED" (C10 = B do Marcelo), onde é a
// ÚNICA defesa (sem barreira estrutural possível): por isso as regras dessa categoria são as mais estritas e o corpus é adversarial (225 casos nas expectativas).
// Pipeline (expectativa e66_2b): T0 limites → T2 alfabeto fechado → T3 refs no texto → T4 dígitos/símbolos (+ citação AV21) → T5 variantes de palavras (V1 junção com
// espaço, V2 junção sem espaço, V3 letras soltas, V5 sem separador intrapalavra) + casamento "espremido" → T6/T7 regras por categoria e contexto.
// Puro, sem relógio/aleatório/ambiente/rede; o texto do modelo NUNCA vira RegExp; nunca lança; o erro só tem `ok` e `reasons`, sem eco da entrada.
import { AgentAnswerSchema, type REJECTION_REASONS } from "./contract.ts"
import { LEXICON } from "./lexicon.ts"
import { lookupRef, type Ledger } from "./ledger.ts"

export type TextReason = Extract<
  (typeof REJECTION_REASONS)[number],
  "STRUCTURE_INVALID" | "NUMBER_OUTSIDE_SLOT" | "MODEL_ARITHMETIC" | "CAUSAL_CLAIM" | "SCOPE_OVERCLAIM" | "INCONCLUSIVE_AS_CONCLUSIVE" | "EXIT_REASON_OVERCLAIM" | "TIE_OVERCLAIM" | "UNVERIFIED_USED_FOR_CONCLUSION" | "OPERATIONAL_ADVICE"
>
export type TextResult = { readonly ok: true } | { readonly ok: false; readonly reasons: TextReason[] }
export interface TextInput { answer: unknown; ledger: Ledger; question?: string }

/** Ordem dos motivos de texto na saída. */
const TEXT_ORDER: readonly TextReason[] = [
  "STRUCTURE_INVALID", "NUMBER_OUTSIDE_SLOT", "MODEL_ARITHMETIC", "CAUSAL_CLAIM", "SCOPE_OVERCLAIM", "INCONCLUSIVE_AS_CONCLUSIVE", "EXIT_REASON_OVERCLAIM", "TIE_OVERCLAIM",
  "UNVERIFIED_USED_FOR_CONCLUSION", "OPERATIONAL_ADVICE",
]
const MALFORMED: TextResult = { ok: false, reasons: ["STRUCTURE_INVALID"] }
const MAX_CHARS = 4000
const MAX_SEGMENTS = 200
const SYM_NUM = new Set("%+=×÷−≈~$±")
const SYM_ARITH = new Set("<>≥≤≠")
const P_ALLOW = new Set("¡¿«»“”‘’„‚–—…•·‐‑°")
const FOLD: Readonly<Record<string, string>> = { "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "ł": "l", "đ": "d", "ħ": "h", "ı": "i" }

const RE = {
  mn: /\p{Mn}/u, letter: /\p{L}/u, latin: /\p{Script=Latin}/u, nd: /\p{Nd}/u, sc: /\p{Sc}/u, zs: /\p{Zs}/u,
  bad: /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Me}\p{Mc}]/u,
  azWord: /^[a-z]+$/,
}
const marksIn = (ch: string): number => [...ch.normalize("NFD")].filter((c) => RE.mn.test(c)).length

/** Dobra de letras latinas, minúsculas, NFD sem acento (normalização N). */
function fold(s: string): string {
  let out = s.toLowerCase()
  for (const [k, v] of Object.entries(FOLD)) out = out.split(k).join(v)
  return [...out.normalize("NFD")].filter((c) => !RE.mn.test(c)).join("")
}

/** Alfabeto fechado (B4) sobre texto já em NFKC. */
function charsetOk(t: string): boolean {
  let prev: string | null = null
  let marks = 0
  for (const ch of t) {
    if (RE.mn.test(ch)) {
      if (prev === null || !RE.letter.test(prev)) return false
      marks += 1
      if (marks > 2) return false
      continue
    }
    prev = ch
    marks = 0
    if (RE.letter.test(ch)) {
      marks = marksIn(ch)
      if (marks > 2) return false
    }
    if (ch === "\n" || ch === "\t") continue
    if (RE.bad.test(ch)) return false
    if (RE.zs.test(ch) || RE.nd.test(ch)) continue
    if (RE.letter.test(ch)) {
      if (!RE.latin.test(ch) || !RE.azWord.test(fold(ch))) return false
      continue
    }
    if (ch.charCodeAt(0) < 128) continue
    if (SYM_NUM.has(ch) || SYM_ARITH.has(ch) || RE.sc.test(ch) || P_ALLOW.has(ch)) continue
    return false
  }
  return true
}

const wordsOf = (s: string): string[] => s.match(/[a-z0-9]+/g) ?? []

/** Corridas de ≥ 3 letras soltas viram uma palavra só (m e l h o r → melhor); devolve também as corridas coladas. */
function collapse(ws: string[]): { words: string[]; runs: string[] } {
  const out: string[] = []
  const runs: string[] = []
  let i = 0
  const single = (w: string): boolean => w.length === 1 && /[a-z]/.test(w)
  while (i < ws.length) {
    let j = i
    while (j < ws.length && single(ws[j])) j += 1
    if (j - i >= 3) { const joined = ws.slice(i, j).join(""); out.push(joined); runs.push(joined); i = j } else { out.push(ws[i]); i += 1 }
  }
  return { words: out, runs }
}

/** Remove - _ . * · ' ` ~ ^ • entre duas letras (mel-hor → melhor). */
function intraword(s: string): string {
  let prev = ""
  let cur = s
  while (prev !== cur) { prev = cur; cur = cur.replace(/(?<=[a-z])[-_.*·'`~^•](?=[a-z])/g, "") }
  return cur
}

function occurrences(ws: readonly string[], term: string): number[] {
  const tw = term.split(" ")
  const hits: number[] = []
  for (let i = 0; i + tw.length <= ws.length; i++) {
    let ok = true
    for (let k = 0; k < tw.length; k++) if (ws[i + k] !== tw[k]) { ok = false; break }
    if (ok) hits.push(i)
  }
  return hits
}

const digitValue = (ch: string): string => {
  if (ch >= "0" && ch <= "9") return ch
  let steps = 0
  let cp = ch.codePointAt(0) as number
  while (RE.nd.test(String.fromCodePoint(cp - 1))) { cp -= 1; steps += 1 }
  return String(steps % 10)
}
const asciiDigits = (s: string): string => [...s].map((c) => (RE.nd.test(c) ? digitValue(c) : c)).join("")
const QUOTED_NUMBER = /^\p{Nd}+(?:[.,]\p{Nd}+)*$/u

export function validateText(input: TextInput): TextResult {
  try {
    const parsed = AgentAnswerSchema.safeParse(input.answer)
    if (!parsed.success) return MALFORMED
    const { segments, claims } = parsed.data
    const found = new Set<TextReason>()

    // T0 limites
    const textLen = segments.reduce((n, s) => n + (s.kind === "text" ? s.text.length : 0), 0)
    if (segments.length > MAX_SEGMENTS || textLen > MAX_CHARS) return MALFORMED

    // T1 junção: texto seguido é UM texto; slot e frase são fronteiras (JA: 1 espaço, JB: nada)
    const join = (sep: string): string => segments.map((s) => (s.kind === "text" ? s.text : sep)).join("")
    const ja = join(" ").normalize("NFKC")
    const jb = join("").normalize("NFKC")

    // contexto derivado dos claims e do ledger (nível da resposta)
    const entries = claims.map((c) => ({ claim: c, entry: lookupRef(input.ledger, c.ref) }))
    const hasClaims = claims.length > 0
    const labeled = claims.some((c) => c.mode === "LABELED")
    const inconclusive = entries.some(({ entry }) => entry !== null && (entry.handle.population.conclusive === false || entry.handle.population.sampleFlag === "LOW" || entry.handle.population.sampleFlag === "TINY"))
    const tieAllowed = entries.some(({ claim, entry }) => {
      const m = entry !== null ? /^rows\[(\d{1,3})\]\./.exec(claim.path) : null
      const rows = entry !== null && typeof entry.view === "object" && entry.view !== null ? (entry.view as { rows?: unknown }).rows : undefined
      return m !== null && Array.isArray(rows) && (rows[Number(m[1])] as { tiedWithPrevious?: unknown } | undefined)?.tiedWithPrevious === true
    })
    const userNumbers = new Set((typeof input.question === "string" ? asciiDigits(input.question.normalize("NFKC")).match(/\d+(?:[.,]\d+)*/g) : null) ?? [])

    // T2 alfabeto (B4): falha ⇒ STRUCTURE_INVALID e o léxico de PALAVRAS não roda; dígitos e símbolos ainda são avaliados
    const charsetFail = !(charsetOk(ja) && charsetOk(jb))
    if (charsetFail) found.add("STRUCTURE_INVALID")
    // T3 ref no texto
    if (/\b(?:ev|acc|str|lbl|pat)_[0-9a-f]{8,}/.test(ja.toLowerCase())) found.add("STRUCTURE_INVALID")
    // T4 dígitos (com a citação AV21) e símbolos
    const withoutQuotes = ja.replace(/"([^"“”«»]*)"|“([^"“”«»]*)”|«([^"“”«»]*)»/g, (whole: string, a?: string, b?: string, c?: string) => {
      const content = a ?? b ?? c ?? ""
      const trimmed = content.trim()
      if (content.length <= 24 && QUOTED_NUMBER.test(trimmed) && userNumbers.has(asciiDigits(trimmed))) return " "
      return whole
    })
    if (RE.nd.test(withoutQuotes)) found.add("NUMBER_OUTSIDE_SLOT")
    for (const ch of ja) {
      if (SYM_NUM.has(ch) || RE.sc.test(ch)) found.add("NUMBER_OUTSIDE_SLOT")
      if (SYM_ARITH.has(ch)) found.add("MODEL_ARITHMETIC")
    }
    if (charsetFail) return fail(found)

    // T5 variantes de palavras
    const na = fold(ja)
    const nb = fold(jb)
    const v1 = wordsOf(na)
    const col = collapse(v1)
    const variants: Array<readonly string[]> = [v1, wordsOf(nb), col.words, wordsOf(intraword(na))]
    const squeezed = na.replace(/[^a-z]/g, "")

    const hit = (terms: readonly string[], frequencyException = false): boolean => {
      for (const ws of variants) for (const t of terms) for (const i of occurrences(ws, t)) {
        if (frequencyException && LEXICON.ARITH_EXCEPTION_TERMS.includes(t as never) && i > 0 && LEXICON.ARITH_EXCEPTION_PREV.includes(ws[i - 1] as never)) continue
        return true
      }
      return false
    }
    const runHit = (terms: readonly string[]): boolean => col.runs.some((r) => terms.some((t) => { const q = t.replace(/ /g, ""); return q.length >= 5 && r.includes(q) }))
    const squeezeHit = (terms: readonly string[]): boolean => LEXICON.SQUEEZE.some((t) => terms.includes(t as never) && squeezed.includes(t))
    const any = (terms: readonly string[], frequencyException = false): boolean => hit(terms, frequencyException) || runHit(terms) || squeezeHit(terms)

    // T6/T7 regras
    if (any(LEXICON.NUM_WORDS) || any(LEXICON.APPROX)) found.add("NUMBER_OUTSIDE_SLOT")
    if (hit(LEXICON.ARITH, true) || runHit(LEXICON.ARITH)) found.add("MODEL_ARITHMETIC")
    if (any(LEXICON.CAUSAL) || /\blogo\s*,/.test(na) || /\blogo\s*,/.test(nb)) found.add("CAUSAL_CLAIM")
    if (any(LEXICON.SCOPE)) found.add("SCOPE_OVERCLAIM")
    if (any(LEXICON.EXIT_OVERCLAIM)) found.add("EXIT_REASON_OVERCLAIM")
    if (any(LEXICON.ADVICE)) found.add("OPERATIONAL_ADVICE")
    if (inconclusive && inconclusiveHit(na, variants, col.runs, squeezed)) found.add("INCONCLUSIVE_AS_CONCLUSIVE")
    if (!tieAllowed && any(LEXICON.TIE)) found.add("TIE_OVERCLAIM")
    if (labeled && any(LEXICON.COMPARISON)) found.add("UNVERIFIED_USED_FOR_CONCLUSION")
    if (hasClaims && any(LEXICON.BASIS)) found.add("NUMBER_OUTSIDE_SLOT")
    return fail(found)
  } catch {
    return MALFORMED // entrada hostil (getter que lança etc.): falha FECHADA, sem detalhe
  }
}

const fail = (found: ReadonlySet<TextReason>): TextResult => (found.size === 0 ? { ok: true } : { ok: false, reasons: TEXT_ORDER.filter((r) => found.has(r)) })

/**
 * INCONCLUSIVE com exceção de negação: na V1 (com pontuação) vale se uma das 2 palavras anteriores é de negação e NÃO há pontuação entre ela e o termo;
 * nas demais variantes a janela é de 2 palavras sem olhar pontuação; o que só casa por corrida ou "espremido" NUNCA tem exceção.
 */
function inconclusiveHit(na: string, variants: ReadonlyArray<readonly string[]>, runs: readonly string[], squeezed: string): boolean {
  const neg = (w: string | undefined): boolean => w !== undefined && (LEXICON.NEGATION_WORDS as readonly string[]).includes(w)
  const toks = na.match(/[a-z0-9]+|[^a-z0-9\s]/g) ?? []
  const isWord = (t: string | undefined): boolean => t !== undefined && /^[a-z0-9]+$/.test(t)
  for (const t of LEXICON.INCONCLUSIVE) {
    const tw = t.split(" ")
    for (let i = 0; i + tw.length <= toks.length; i++) {
      if (!tw.every((w, k) => toks[i + k] === w)) continue
      const p1 = i >= 1 ? toks[i - 1] : undefined
      const p2 = i >= 2 ? toks[i - 2] : undefined
      if (!(neg(p1) || (isWord(p1) && neg(p2)))) return true
    }
  }
  for (const ws of variants.slice(1)) for (const t of LEXICON.INCONCLUSIVE) for (const i of occurrences(ws, t)) {
    if (!((i >= 1 && neg(ws[i - 1])) || (i >= 2 && neg(ws[i - 2])))) return true
  }
  const plain = variants[0].join(" ")
  if (LEXICON.SQUEEZE.some((t) => (LEXICON.INCONCLUSIVE as readonly string[]).includes(t) && squeezed.includes(t)) && !LEXICON.INCONCLUSIVE.some((t) => plain.includes(t))) return true
  return runs.some((r) => LEXICON.INCONCLUSIVE.some((t) => { const q = t.replace(/ /g, ""); return q.length >= 5 && r.includes(q) }))
}
