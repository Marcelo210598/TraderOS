// Redação de VISÃO do Evidence Lab: rótulos de origem (texto das ordens: `sourceLabel`, `entryLabel`, `exitLabel`) nunca são mostrados em
// nenhuma aba. Vale para TODA a interface (o componente `Json` aplica `redactLabels` sempre; as tabelas usam `maskLabel`).
// Isto é só a camada de visão: o bundle real continua carregando o rótulo nos TradeEvidence (o E5b depende dele) até a revisão do sourceLabel
// (docs/ai-partner/sourceLabel-plano.md). Rótulo vazio é informação não sensível e útil (explica motivo UNKNOWN), por isso aparece como vazio.

import { accountRef, strategyRef } from "../../ingest/identity.ts"

export const OMITTED = "«omitido»"
export const LABEL_KEYS: ReadonlySet<string> = new Set(["sourceLabel", "entryLabel", "exitLabel"])

/** Para células de tabela: null → "—"; vazio → "(vazio)"; qualquer texto → «omitido». */
export function maskLabel(v: string | null | undefined): string {
  if (v === null || v === undefined) return "—"
  return v === "" ? "(vazio)" : OMITTED
}

/** JSON sem rótulos de origem: troca o valor das chaves de rótulo por «omitido» (null e "" são preservados). */
export function redactLabels(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (k, v) => (LABEL_KEYS.has(k) && typeof v === "string" && v !== "" ? OMITTED : v)))
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
