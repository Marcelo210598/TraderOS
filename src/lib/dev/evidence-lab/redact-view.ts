// Redação de VISÃO do Evidence Lab: rótulos de origem (texto das ordens: `sourceLabel`, `entryLabel`, `exitLabel`) nunca são mostrados em
// nenhuma aba. Vale para TODA a interface (o componente `Json` aplica `redactLabels` sempre; as tabelas usam `maskLabel`).
// Isto é só a camada de visão: o bundle real continua carregando o rótulo nos TradeEvidence (o E5b depende dele) até a revisão do sourceLabel
// (docs/ai-partner/sourceLabel-plano.md). Rótulo vazio é informação não sensível e útil (explica motivo UNKNOWN), por isso aparece como vazio.

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
