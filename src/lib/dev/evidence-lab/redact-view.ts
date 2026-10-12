// Redação de VISÃO do Evidence Lab: o texto livre das ordens (`sourceLabel`, `entryLabel`, `exitLabel`) nunca aparece em nenhuma aba.
// Vale para TODA a interface (o componente `Json` aplica `redactLabels` sempre; as tabelas usam `maskLabel`).
// Desde o S2 do sourceLabel a Evidence já carrega só a PROJEÇÃO (palavra do vocabulário v1 ou token `lbl_…`): isso é mostrado como está
// (é o que o agente verá). FALHA FECHADA: qualquer outro texto (não projetado) continua «omitido». Vazio aparece como vazio (explica UNKNOWN).

import { isProjectedLabel } from "../../evidence/label-vocab.ts"
import { accountRef, strategyRef } from "../../ingest/identity.ts"

export const OMITTED = "«omitido»"
export const LABEL_KEYS: ReadonlySet<string> = new Set(["sourceLabel", "entryLabel", "exitLabel"])

/** Para células de tabela: null → "—"; vazio → "(vazio)"; palavra do vocabulário ou token → como está; qualquer outro texto → «omitido». */
export function maskLabel(v: string | null | undefined): string {
  if (v === null || v === undefined) return "—"
  if (v === "") return "(vazio)"
  return isProjectedLabel(v) ? v : OMITTED
}

/** JSON sem texto livre de rótulo: chaves de rótulo com valor NÃO projetado viram «omitido» (null, "", palavra do vocabulário e token são preservados). */
export function redactLabels(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (k, v) => (LABEL_KEYS.has(k) && typeof v === "string" && !isProjectedLabel(v) ? OMITTED : v)))
}

/**
 * Rótulo de um GRUPO do motor para a interface. O motor agrupa por nome (conta, estratégia), mas a ferramenta que endurecemos contra
 * vazamento de nome NÃO mostra nome em claro nem aqui: dimensões `account`/`strategy` saem como `accountRef`/`strategyRef` (mesma função e
 * mesmo sal "" do demo). Outras dimensões mantêm o rótulo do motor. Chave `null` (atributo desconhecido) mantém o rótulo do motor.
 */
export function groupLabelView(by: string | null, g: { key: Array<string | null>; label: string }, salt = ""): string {
  const k = g.key.length === 1 ? g.key[0] : null
  if (k === null) return g.label
  if (by === "account") return accountRef(k, salt) ?? g.label
  if (by === "strategy") return strategyRef(k, salt) ?? g.label
  return g.label
}
