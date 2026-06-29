// ─── Guarda de limites de plano (server-side) ────────────────────────────────
// Centraliza a checagem de limites por plano e o formato do 403 que o front
// usa pra abrir o modal de upgrade. Fonte dos números: src/lib/plans.ts.

import { NextResponse } from "next/server"
import { PLAN_LIMITS, type PlanKey, type PlanLimits } from "./plans"

// Recursos contáveis (limite numérico). guardian é boolean → fora daqui.
type CountableResource = keyof Omit<PlanLimits, "guardian">

// Mensagem padrão por recurso quando o limite estoura.
const LIMIT_MESSAGES: Record<CountableResource, (limit: number) => string> = {
  tradesPerMonth: (n) => `Limite de ${n} trades/mês atingido no seu plano. Faça upgrade para registrar mais.`,
  setups: (n) =>
    n === 0
      ? "A Biblioteca de Setups está disponível a partir do plano Starter."
      : `Limite de ${n} setups atingido no seu plano. Faça upgrade para criar mais.`,
  vegaPerMonth: (n) =>
    n === 0
      ? "A análise da Vega (IA) está disponível a partir do plano Starter."
      : `Limite de ${n} análises da Vega neste mês atingido. Faça upgrade para continuar.`,
  accounts: (n) => `Limite de ${n} conta(s) atingido no seu plano. Faça upgrade para conectar mais.`,
  integrations: (n) =>
    n === 0
      ? "As integrações (API Keys) estão disponíveis a partir do plano Starter."
      : `Limite de ${n} integração(ões) atingido no seu plano. Faça upgrade para conectar mais.`,
}

// Plano mais barato que aumenta o limite do recurso em relação ao plano atual.
// Ex.: FREE batendo trades → Starter já resolve; Starter batendo → só Pro.
function suggestPlanFor(resource: CountableResource, currentPlan: PlanKey): "TRADER" | "PRO" {
  const current = PLAN_LIMITS[currentPlan][resource]
  return PLAN_LIMITS.TRADER[resource] > current ? "TRADER" : "PRO"
}

/** Resposta 403 padronizada que o front reconhece (campo `upgrade: true`). */
export function upgradeResponse(message: string, suggestedPlan: "TRADER" | "PRO") {
  return NextResponse.json({ error: message, upgrade: true, suggestedPlan }, { status: 403 })
}

/**
 * Checa um limite contável. Retorna `null` se está dentro do limite,
 * ou um NextResponse 403 pronto pra dar `return` na rota.
 *
 *   const blocked = checkPlanLimit(plan, "setups", count)
 *   if (blocked) return blocked
 */
export function checkPlanLimit(
  plan: PlanKey,
  resource: CountableResource,
  currentCount: number
): NextResponse | null {
  const limit = PLAN_LIMITS[plan][resource]
  if (currentCount < limit) return null
  return upgradeResponse(LIMIT_MESSAGES[resource](limit), suggestPlanFor(resource, plan))
}
