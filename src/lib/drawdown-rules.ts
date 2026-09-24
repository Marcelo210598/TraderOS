// Regras de conta da seção "Drawdown": tipo de drawdown + parâmetros, presets como DADO
// (sem código por mesa), gates de plano (Free / Starter / Pro) e helpers de formatação.

import { DEFAULT_RULES, type DrawdownRules, type DrawdownType } from "@/lib/drawdown-engine"
import { dayKeyBR } from "@/lib/date"
import { PLAN_LABEL, planAtLeast, type PlanKey } from "@/lib/plans"

export interface AccountRules extends DrawdownRules {
  /** Regra "oficial" desta conta (as outras 3 aparecem só como comparação). */
  type: DrawdownType
  /** Hora BR em que o dia da mesa vira (0 = dia do calendário; 18 = trading day das 18h). */
  dayRolloverHour: number
  preset: string | null
}

export const DEFAULT_ACCOUNT_RULES: AccountRules = {
  ...DEFAULT_RULES,
  type: "INTRADAY", // a mais rígida: na dúvida, o usuário vê o cenário mais apertado
  dayRolloverHour: 0,
  preset: null,
}

// ─── Gates de plano ──────────────────────────────────────────────────────────

export type DrawdownFeature =
  | "typeEndOfDay"
  | "typeEndOfPosition"
  | "trailingLock"
  | "dailyLossLimit"
  | "consistency"
  | "dayRollover"
  | "minTradingDays"
  | "scenarios"
  | "presets"
  | "multiAccount"

export const FEATURE_MIN_PLAN: Record<DrawdownFeature, "TRADER" | "PRO"> = {
  typeEndOfDay: "TRADER",
  dailyLossLimit: "TRADER",
  typeEndOfPosition: "PRO",
  trailingLock: "PRO",
  consistency: "PRO",
  dayRollover: "PRO",
  minTradingDays: "PRO",
  scenarios: "PRO",
  presets: "PRO",
  multiAccount: "PRO",
}

export const FEATURE_LABEL: Record<DrawdownFeature, string> = {
  typeEndOfDay: "O End of Day Trailing",
  typeEndOfPosition: "O End of Position Trailing",
  trailingLock: "A trava do trailing",
  dailyLossLimit: "O limite de perda diário",
  consistency: "A regra de consistência",
  dayRollover: "A hora de virada do dia",
  minTradingDays: "Os dias mínimos de operação",
  scenarios: "Os cenários prontos e o replay",
  presets: "Os presets de mesa",
  multiAccount: "Configurar mais de uma conta",
}

export const TYPE_FEATURE: Partial<Record<DrawdownType, DrawdownFeature>> = {
  END_OF_DAY: "typeEndOfDay",
  END_OF_POSITION: "typeEndOfPosition",
}

export const canUse = (plan: PlanKey, feature: DrawdownFeature) => planAtLeast(plan, FEATURE_MIN_PLAN[feature])

export const typeAllowed = (plan: PlanKey, type: DrawdownType) => {
  const f = TYPE_FEATURE[type]
  return f ? canUse(plan, f) : true
}

export const upsellReason = (feature: DrawdownFeature) =>
  `${FEATURE_LABEL[feature]} é liberado no plano ${PLAN_LABEL[FEATURE_MIN_PLAN[feature]]}.`

/** Zera o que o plano não libera (evita regra Pro "vazando" de valor salvo antes de um downgrade). */
export function enforcePlan(plan: PlanKey, rules: AccountRules): AccountRules {
  const r = { ...rules }
  if (!canUse(plan, "trailingLock")) r.trailingLock = r.startBalance // padrão: trava no saldo inicial
  if (!canUse(plan, "dailyLossLimit")) r.dailyLossLimit = null
  if (!canUse(plan, "consistency")) r.consistencyMaxPct = null
  if (!canUse(plan, "dayRollover")) r.dayRolloverHour = 0
  if (!canUse(plan, "minTradingDays")) r.minTradingDays = null
  if (!typeAllowed(plan, r.type)) r.type = "INTRADAY"
  return r
}

// ─── Presets (dado, não código) ──────────────────────────────────────────────
// Só entra o que foi VERIFICADO pelo Marcelo (painel da Lucid; tabela EOD 2026 do PDF da Apex).
// A trava do trailing fica em branco de propósito — confirmar na mesa antes de preencher.

export interface Preset {
  id: string
  name: string
  note: string
  rules: Partial<AccountRules>
}

const apex = (size: number, target: number, dd: number): Preset => ({
  id: `apex-eod-${size / 1000}k`,
  name: `Apex EOD ${size / 1000}K`,
  note: "Meta e drawdown da tabela EOD 2026 (PDF). Trava do trailing, consistência e virada do dia: confirme com a Apex.",
  rules: {
    startBalance: size,
    profitTarget: target,
    maxDrawdown: dd,
    type: "END_OF_DAY",
    trailingLock: null,
    preset: `Apex EOD ${size / 1000}K`,
  },
})

export const PRESETS: Preset[] = [
  {
    id: "lucid-flex-50k",
    name: "Lucid Flex 50K",
    note: "Do seu painel: meta $3.000, drawdown $2.000 EOD, limite diário $1.200, consistência 50%, dia vira às 18h. Trava do trailing: confirme na mesa.",
    rules: {
      startBalance: 50000,
      profitTarget: 3000,
      maxDrawdown: 2000,
      type: "END_OF_DAY",
      trailingLock: null,
      dailyLossLimit: 1200,
      consistencyMaxPct: 50,
      consistencyBase: "NET_PROFIT",
      dayRolloverHour: 18,
      preset: "Lucid Flex 50K",
    },
  },
  apex(25000, 1500, 1000),
  apex(50000, 3000, 2000),
  apex(100000, 6000, 3000),
  apex(150000, 9000, 4000),
]

// ─── Dia da mesa ─────────────────────────────────────────────────────────────

/** Chave do dia respeitando a virada da mesa: com virada às 18h, 21h30 já é o dia seguinte. */
export function tradingDayKeyBR(ms: number, rolloverHour: number) {
  const shift = rolloverHour > 0 ? (24 - rolloverHour) * 3600_000 : 0
  return dayKeyBR(ms + shift)
}

// ─── Formatação ──────────────────────────────────────────────────────────────

export function usd(n: number, opts: { sign?: boolean } = {}) {
  const abs = Math.abs(n)
  const txt = abs.toLocaleString("pt-BR", {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  const sign = n < 0 ? "-" : opts.sign && n > 0 ? "+" : ""
  return `${sign}$${txt}`
}

// ─── Persistência local (v1) ─────────────────────────────────────────────────
// Regras da conta ficam no navegador até a coluna no banco ser aprovada.

const storageKey = (accountId: string) => `drawdown-rules:v1:${accountId}`

export function loadStoredRules(accountId: string): AccountRules | null {
  try {
    const raw = window.localStorage.getItem(storageKey(accountId))
    if (!raw) return null
    return { ...DEFAULT_ACCOUNT_RULES, ...(JSON.parse(raw) as Partial<AccountRules>) }
  } catch {
    return null
  }
}

export function saveStoredRules(accountId: string, rules: AccountRules): boolean {
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(rules))
    return true
  } catch {
    return false
  }
}
