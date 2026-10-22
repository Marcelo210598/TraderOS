// Tela do AI Partner (E7-20): LAYOUT estruturado da resposta (cartões e tabelas) no formato do SERVIDOR (src/lib/agent/layout.ts). Só dados de TEXTO já conferidos; a tela só desenha.
// `response.layout` ausente ou malformado ⇒ null ⇒ a tela cai no texto corrido (nunca mostra meia resposta). Chaves EXATAS (campo extra = recusa). Puro, congelado, nunca lança.
import type { Verdict } from "./view.ts"

export interface LayoutCell { readonly text: string; readonly verdict: Verdict; /** motivo curto quando o valor não existe ("—") */ readonly note: string | null }
export interface LayoutColumn { readonly label: string; readonly help: string | null }
export type LayoutPart = { readonly text: string } | { readonly cell: LayoutCell }
export type LayoutBlock =
  | { readonly kind: "title"; readonly text: string }
  | { readonly kind: "line"; readonly parts: readonly LayoutPart[] }
  | { readonly kind: "stats"; readonly items: readonly { readonly label: string; readonly help: string | null; readonly cell: LayoutCell }[] }
  | { readonly kind: "table"; readonly caption: string | null; readonly columns: readonly LayoutColumn[]; readonly rows: readonly { readonly label: string; readonly tag: string | null; readonly cells: readonly LayoutCell[] }[] }
  | { readonly kind: "note"; readonly text: string; readonly tone: "info" | "caveat" }
export interface AnswerLayout { readonly blocks: readonly LayoutBlock[] }

/** Veredito do contrato → palavra da tela (a mesma de view.ts). */
const VERDICTS: Readonly<Record<string, Verdict>> = Object.freeze({ VERIFIED: "verified", VERIFIED_PARTIAL: "partial", NOT_VERIFIED: "unverified", TAMPERED_OR_MISMATCH: "mismatch" })
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const exact = (o: Record<string, unknown>, keys: readonly string[]): boolean => { const k = Object.keys(o); return k.length === keys.length && keys.every((x) => Object.hasOwn(o, x)) }
const str = (x: unknown, max = 400): x is string => typeof x === "string" && x.length > 0 && x.length <= max
const optStr = (x: unknown): string | null | undefined => (x === null ? null : str(x) ? x : undefined)
function deepFreeze<T>(x: T): T { if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) } return x }

function cellOf(x: unknown): LayoutCell | null {
  if (!isRecord(x) || !exact(x, ["text", "combined", "note"]) || !str(x.text, 120) || typeof x.combined !== "string" || !Object.hasOwn(VERDICTS, x.combined)) return null
  const note = optStr(x.note); if (note === undefined) return null
  return { text: x.text, verdict: VERDICTS[x.combined], note }
}

export function toLayout(input: unknown): AnswerLayout | null {
  try {
    if (!isRecord(input) || !exact(input, ["blocks"]) || !Array.isArray(input.blocks) || input.blocks.length === 0 || input.blocks.length > 30) return null
    const blocks: LayoutBlock[] = []
    for (const b of input.blocks) {
      if (!isRecord(b)) return null
      if (b.kind === "title") { if (!exact(b, ["kind", "text"]) || !str(b.text)) return null; blocks.push({ kind: "title", text: b.text })
      } else if (b.kind === "note") { if (!exact(b, ["kind", "text", "tone"]) || !str(b.text, 600) || (b.tone !== "info" && b.tone !== "caveat")) return null; blocks.push({ kind: "note", text: b.text, tone: b.tone })
      } else if (b.kind === "line") {
        if (!exact(b, ["kind", "parts"]) || !Array.isArray(b.parts) || b.parts.length === 0 || b.parts.length > 20) return null
        const parts: LayoutPart[] = []
        for (const p of b.parts) {
          if (!isRecord(p)) return null
          if (exact(p, ["text"])) { if (!str(p.text, 120)) return null; parts.push({ text: p.text }) }
          else if (exact(p, ["cell"])) { const cell = cellOf(p.cell); if (cell === null) return null; parts.push({ cell }) }
          else return null
        }
        blocks.push({ kind: "line", parts })
      } else if (b.kind === "stats") {
        if (!exact(b, ["kind", "items"]) || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > 24) return null
        const items: { label: string; help: string | null; cell: LayoutCell }[] = []
        for (const it of b.items) { if (!isRecord(it) || !exact(it, ["label", "help", "cell"]) || !str(it.label, 120)) return null; const help = optStr(it.help), cell = cellOf(it.cell); if (help === undefined || cell === null) return null; items.push({ label: it.label, help, cell }) }
        blocks.push({ kind: "stats", items })
      } else if (b.kind === "table") {
        if (!exact(b, ["kind", "caption", "columns", "rows"]) || !Array.isArray(b.columns) || b.columns.length === 0 || b.columns.length > 12 || !Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > 60) return null
        const cap = optStr(b.caption); if (cap === undefined) return null
        const columns: LayoutColumn[] = []
        for (const c of b.columns) { if (!isRecord(c) || !exact(c, ["label", "help"]) || !str(c.label, 120)) return null; const help = optStr(c.help); if (help === undefined) return null; columns.push({ label: c.label, help }) }
        const rows: { label: string; tag: string | null; cells: LayoutCell[] }[] = []
        for (const r of b.rows) {
          if (!isRecord(r) || !exact(r, ["label", "tag", "cells"]) || !str(r.label, 120) || !Array.isArray(r.cells) || r.cells.length !== columns.length) return null
          const tag = optStr(r.tag); if (tag === undefined) return null
          const cells: LayoutCell[] = []; for (const c of r.cells) { const cell = cellOf(c); if (cell === null) return null; cells.push(cell) }
          rows.push({ label: r.label, tag, cells })
        }
        blocks.push({ kind: "table", caption: cap, columns, rows })
      } else return null
    }
    return deepFreeze({ blocks })
  } catch {
    return null
  }
}
