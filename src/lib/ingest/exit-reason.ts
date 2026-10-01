// Classificação do motivo de saída a partir do NOME da ordem de saída (coluna "Sáída"/"Exit name" do NT8).
//
// Regras padrão APROVADAS:  Target* → TARGET · Stop* → STOP · Zerar / Flat / Close → MANUAL · demais → UNKNOWN.
// O mapa é CONFIGURÁVEL (regras do usuário têm prioridade e ficam marcadas `USER_MAP`).
// O rótulo original (`sourceLabel`) e a regra usada (`reasonRule`) são SEMPRE preservados.
//
// Ressalvas de semântica (documentadas, não escondidas):
//   - o motivo vem do NOME da ordem, não do resultado: um `Stop` em break-even continua STOP;
//   - MANUAL = "comando de zerar/fechar", não necessariamente decisão discricionária.

import type { ExitReason } from "../domain/canonical.ts"

export interface ExitReasonRule {
  /** Expressão regular (texto) aplicada ao rótulo NORMALIZADO (minúsculo, sem acentos, sem espaços nas pontas). */
  pattern: string
  reason: ExitReason
}

export type ReasonRuleKind = "LABEL_RULE" | "USER_MAP" | "NONE"

export interface ExitReasonResult {
  reason: ExitReason
  rule: ReasonRuleKind
  /** Padrão que casou (para auditoria); null quando nenhuma regra casou. */
  matched: string | null
}

export const DEFAULT_EXIT_REASON_RULES: ExitReasonRule[] = [
  { pattern: "^target", reason: "TARGET" },
  { pattern: "^stop", reason: "STOP" },
  { pattern: "^(zerar|flat|close)", reason: "MANUAL" },
]

export const normalizeLabel = (label: string | null | undefined): string =>
  (label ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()

export class ExitReasonMapError extends Error {
  readonly code = "E_EXIT_MAP_INVALID"
  constructor(message: string) {
    super(message)
    this.name = "ExitReasonMapError"
  }
}

/** Valida um mapa do usuário (regex compilável, motivo válido). Lança ExitReasonMapError. */
export function validateExitReasonMap(map: ExitReasonRule[] | undefined): void {
  for (const r of map ?? []) {
    try {
      new RegExp(r.pattern)
    } catch {
      throw new ExitReasonMapError(`Padrão inválido no mapa de rótulos: "${r.pattern}".`)
    }
    if (!["TARGET", "STOP", "MANUAL", "UNKNOWN"].includes(r.reason)) {
      throw new ExitReasonMapError(`Motivo inválido no mapa de rótulos: "${r.reason}".`)
    }
  }
}

/** Regras do usuário primeiro (USER_MAP), depois as padrão (LABEL_RULE); sem casamento ⇒ UNKNOWN/NONE. */
export function classifyExitLabel(label: string | null | undefined, userMap: ExitReasonRule[] = []): ExitReasonResult {
  const n = normalizeLabel(label)
  if (n === "") return { reason: "UNKNOWN", rule: "NONE", matched: null }
  for (const r of userMap) if (new RegExp(r.pattern).test(n)) return { reason: r.reason, rule: "USER_MAP", matched: r.pattern }
  for (const r of DEFAULT_EXIT_REASON_RULES) if (new RegExp(r.pattern).test(n)) return { reason: r.reason, rule: "LABEL_RULE", matched: r.pattern }
  return { reason: "UNKNOWN", rule: "NONE", matched: null }
}
