// Motivo de saída AGREGADO POR TRADE (E6.0). Função pura: lê o que o Canonical já registra por perna (`exitLegs[].reason`, decidido
// na ingestão pelo RÓTULO da ordem + mapa do usuário) e o resume num bucket por trade. NUNCA olha P&L, resultado, estratégia nem preço:
// motivo não se infere do desfecho. Sem pernas (trade-linha) o motivo é desconhecido — e é dito, não adivinhado.
//
// Regra (determinística; data-contract §15.1):
//   D = conjunto de motivos DISTINTOS de TODAS as pernas de saída (parciais e final), com UNKNOWN contando como um valor.
//   |D| = 1  → esse motivo (TARGET / STOP / MANUAL, ou UNKNOWN se nenhuma perna tem motivo conhecido)
//   |D| ≥ 2  → MIXED. Se UNKNOWN ∈ D (conhecido + desconhecido na mesma operação) o trade também é marcado `partial`:
//              nada é descartado em silêncio e o trade não é atribuído a um único motivo que só vale para parte das saídas.
//   sem pernas → UNKNOWN (source NONE). Pernas ausentes mas `exitSummary.byReason` presente → mesma regra sobre as chaves com qtd > 0.

import { EXIT_REASONS, type CanonicalTrade, type ExitReason } from "../domain/canonical.ts"

export const EXIT_REASON_BUCKETS = ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"] as const
export type ExitReasonBucket = (typeof EXIT_REASON_BUCKETS)[number]

export interface TradeExitReason {
  bucket: ExitReasonBucket
  /** Há saída de motivo desconhecido junto de saída(s) de motivo conhecido (bucket = MIXED). */
  partial: boolean
  /** De onde veio: pernas, resumo (só `byReason`) ou nada (trade-linha / sem informação). */
  source: "LEGS" | "SUMMARY" | "NONE"
}

const isReason = (x: unknown): x is ExitReason => typeof x === "string" && (EXIT_REASONS as readonly string[]).includes(x)

function bucketOf(distinct: Set<ExitReason>): { bucket: ExitReasonBucket; partial: boolean } {
  if (distinct.size === 0) return { bucket: "UNKNOWN", partial: false }
  if (distinct.size === 1) return { bucket: [...distinct][0], partial: false }
  return { bucket: "MIXED", partial: distinct.has("UNKNOWN") }
}

export function exitReasonOf(t: Pick<CanonicalTrade, "exitLegs" | "exitSummary">): TradeExitReason {
  const legs = t.exitLegs
  if (legs && legs.length > 0) {
    // um valor fora do enum nunca vira motivo conhecido
    const distinct = new Set<ExitReason>(legs.map((l) => (isReason(l.reason) ? l.reason : "UNKNOWN")))
    return { ...bucketOf(distinct), source: "LEGS" }
  }
  const by = t.exitSummary?.byReason
  if (by) {
    const distinct = new Set<ExitReason>()
    for (const [k, qty] of Object.entries(by)) if (qty > 0) distinct.add(isReason(k) ? k : "UNKNOWN")
    if (distinct.size > 0) return { ...bucketOf(distinct), source: "SUMMARY" }
  }
  return { bucket: "UNKNOWN", partial: false, source: "NONE" }
}

export const EXIT_REASON_LABELS: Record<ExitReasonBucket, string> = {
  TARGET: "Alvo (target)",
  STOP: "Stop",
  MANUAL: "Saída manual",
  MIXED: "Misto (motivos diferentes)",
  UNKNOWN: "Desconhecido",
}
