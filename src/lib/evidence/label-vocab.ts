// Vocabulário FECHADO de rótulos de ordem na Evidence (plano: docs/ai-partner/sourceLabel-plano.md; decisões A–E de 12/10/2026).
// O nome da ordem pode ser texto livre do usuário. Na Evidence só sai (a) uma palavra deste vocabulário, em claro, ou (b) um token `lbl_…`
// (`labelRef`). O Canonical interno NÃO muda (motivo de saída, rowHash, tradeId e métricas seguem usando o texto original): esta é só a
// projeção para a Evidence. Pura: sem relógio, random, banco nem I/O. S1: ainda NÃO está ligada ao `explain-trade` (isso é o S2).
//
// v1 (decisão A: estrito às 2 fixtures reais; decisão B: sufixo de 0 a 2 dígitos):
//   "" · Entry · Target<0–99> · Stop<0–99> · Zerar            (Flat/Close e nomes padrão do NT8 FICAM DE FORA: viram token; v2 só com export real)
// Casamento da STRING INTEIRA após normalizar (sem acento, aparado, minúsculo); `\d` é só ASCII 0-9; qualquer caractere a mais (espaço no meio,
// invisível, sufixo) ⇒ token. A saída em claro é o texto original APARADO (preserva a caixa).

import { labelRef } from "../ingest/identity.ts"
import { normalizeLabel } from "../ingest/exit-reason.ts"

export const LABEL_VOCAB_VERSION = 1 as const

/** Em claro na Evidence. Aplicado ao rótulo NORMALIZADO. */
export const LABEL_VOCAB_RE = /^(entry|target\d{0,2}|stop\d{0,2}|zerar)$/
/** Forma de um token (e o que o schema da Evidence aceitará no S2). */
export const LABEL_TOKEN_RE = /^lbl_[0-9a-f]{24}$/

/** O rótulo pertence ao vocabulário v1 (vazio ou palavra permitida)? */
export function isVocabLabel(raw: string | null | undefined): boolean {
  const n = normalizeLabel(raw)
  return n === "" || LABEL_VOCAB_RE.test(n)
}

/** O valor já é uma saída válida da projeção (null, vazio, palavra do vocabulário ou token)? É a regra que o V0 aplicará (S2). */
export function isProjectedLabel(v: string | null): boolean {
  return v === null || v === "" || LABEL_TOKEN_RE.test(v) || (v === v.trim() && LABEL_VOCAB_RE.test(normalizeLabel(v)))
}

/**
 * Projeção de um rótulo de origem para a Evidence.
 *   null ⇒ null · vazio/só espaços ⇒ "" · palavra do vocabulário ⇒ o texto original aparado · qualquer outra coisa ⇒ `lbl_<24 hex>`.
 * `salt` = o mesmo `accountRefSalt` do import (opcional; sem ele o token é adivinhável por dicionário).
 */
export function projectLabel(raw: string | null, salt = ""): string | null {
  if (raw === null) return null
  const n = normalizeLabel(raw)
  if (n === "") return ""
  if (LABEL_VOCAB_RE.test(n)) return raw.trim()
  return labelRef(raw, salt) as string // n ≠ "" ⇒ nunca null
}
