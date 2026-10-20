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
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  FREE: {
    tradesPerMonth: 10,
    setups: 0,
    vegaPerMonth: 0,
    accounts: 1,
    integrations: 0,
  },
  TRADER: {
    tradesPerMonth: 25,
    setups: 5,
    vegaPerMonth: 5,
    accounts: 1,
    integrations: 1,
  },
  PRO: {
    tradesPerMonth: Infinity,
    setups: Infinity,
    vegaPerMonth: 40,
    accounts: Infinity,
    integrations: Infinity,
  },
}

// Cota de ARQUIVOS importados para o AI Partner (E7-12), por usuário: nº de arquivos distintos e soma dos bytes ORIGINAIS dos CSVs (cada um ≤ 25 MiB).
// Fica fora de `PlanLimits` de propósito: PLAN_LIMITS é lido pelo plan-guard e pela página inicial. Custo no R2 (US$0,015/GB-mês acima de 10 GB grátis, CSV comprime ≈4×): mesmo no teto
// 10.000 usuários Free ≈ 12 GB (≈US$0,03/mês) e 1.000 Pro ≈ 61 GB (≈US$0,77/mês) — a cota é sobretudo proteção contra abuso/bug; pode subir depois.
export interface ImportQuota {
  readonly files: number
  readonly bytes: number
}
const MIB = 1024 * 1024
export const PLAN_IMPORT_QUOTAS: Readonly<Record<PlanKey, Readonly<ImportQuota>>> = Object.freeze({
  FREE: Object.freeze({ files: 2, bytes: 5 * MIB }),
  TRADER: Object.freeze({ files: 20, bytes: 50 * MIB }),
  PRO: Object.freeze({ files: 100, bytes: 250 * MIB }),
})

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
