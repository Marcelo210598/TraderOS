// ─── Fonte única de verdade de planos, preços e limites ──────────────────────
// IMPORTANTE: o enum do banco ainda é FREE | TRADER | PRO.
// "TRADER" é exibido como "Starter" na UI (decisão 26/06 — evita migration de enum
// num banco gerenciado por `db push`). Use PLAN_LABEL pra mostrar ao usuário.

export type PlanKey = "FREE" | "TRADER" | "PRO"
export type BillingCycle = "MONTHLY" | "YEARLY"

export const PLAN_LABEL: Record<PlanKey, string> = {
  FREE: "Free",
  TRADER: "Starter",
  PRO: "Pro",
}

// Preços em reais. Pro tem ciclo anual com desconto.
export const PLAN_PRICES = {
  TRADER: { MONTHLY: 19.9 },
  PRO: { MONTHLY: 97, YEARLY: 1000 },
} as const

// Limites por plano. Infinity = ilimitado.
export interface PlanLimits {
  tradesPerMonth: number
  setups: number
  vegaPerMonth: number
  accounts: number
  integrations: number
  guardian: boolean
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  FREE: {
    tradesPerMonth: 10,
    setups: 0,
    vegaPerMonth: 0,
    accounts: 1,
    integrations: 0,
    guardian: false,
  },
  TRADER: {
    tradesPerMonth: 25,
    setups: 5,
    vegaPerMonth: 5,
    accounts: 1,
    integrations: 1,
    guardian: true,
  },
  PRO: {
    tradesPerMonth: Infinity,
    setups: Infinity,
    vegaPerMonth: 40,
    accounts: Infinity,
    integrations: Infinity,
    guardian: true,
  },
}

// Ordem de "força" do plano — útil pra comparar (ex.: TRADER já é o suficiente?)
export const PLAN_RANK: Record<PlanKey, number> = { FREE: 0, TRADER: 1, PRO: 2 }

export function planAtLeast(plan: PlanKey, min: PlanKey): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[min]
}

export function getLimits(plan: PlanKey): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE
}

// Valor da cobrança pra um plano+ciclo (em reais). null se combinação inválida.
export function priceFor(plan: PlanKey, cycle: BillingCycle): number | null {
  if (plan === "TRADER" && cycle === "MONTHLY") return PLAN_PRICES.TRADER.MONTHLY
  if (plan === "PRO" && cycle === "MONTHLY") return PLAN_PRICES.PRO.MONTHLY
  if (plan === "PRO" && cycle === "YEARLY") return PLAN_PRICES.PRO.YEARLY
  return null
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
