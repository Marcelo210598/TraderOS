// Tipos e avaliação de regras de desafio

export type RuleType =
  | "max_loss_per_trade"
  | "max_daily_loss"
  | "no_behavioral_tag"
  | "max_consecutive_losses"
  | "max_trades_per_day"
  | "only_am_session"
  | "min_win_rate"

export interface ChallengeRule {
  type: RuleType
  value?: number
  label: string
}

export interface ChallengeRuleResult {
  rule: ChallengeRule
  passed: boolean
  detail: string
  offenses: number
}

export interface TradeForEval {
  id: string
  date: Date
  pnl: number
  result: string
  sessionType: string
  tags: { name: string }[]
}

export function evaluateRules(rules: ChallengeRule[], trades: TradeForEval[]): ChallengeRuleResult[] {
  return rules.map(rule => evalRule(rule, trades))
}

function evalRule(rule: ChallengeRule, trades: TradeForEval[]): ChallengeRuleResult {
  switch (rule.type) {
    case "max_loss_per_trade": {
      const limit = rule.value ?? 150
      const offenders = trades.filter(t => t.pnl < -limit)
      return {
        rule,
        passed: offenders.length === 0,
        detail: offenders.length === 0
          ? `Nenhum trade perdeu mais que $${limit}`
          : `${offenders.length} trade(s) perdeu mais que $${limit}`,
        offenses: offenders.length,
      }
    }

    case "max_daily_loss": {
      const limit = rule.value ?? 300
      const byDay: Record<string, number> = {}
      for (const t of trades) {
        const day = new Date(t.date).toISOString().split("T")[0]
        byDay[day] = (byDay[day] ?? 0) + t.pnl
      }
      const badDays = Object.values(byDay).filter(pnl => pnl < -limit)
      return {
        rule,
        passed: badDays.length === 0,
        detail: badDays.length === 0
          ? `Nenhum dia perdeu mais que $${limit}`
          : `${badDays.length} dia(s) com prejuízo acima de $${limit}`,
        offenses: badDays.length,
      }
    }

    case "no_behavioral_tag": {
      const TAGS = ["revenge", "fomo", "overtrading", "impulsivo", "medo"]
      const offenders = trades.filter(t =>
        t.tags.some(tag => TAGS.some(bt => tag.name.toLowerCase().includes(bt)))
      )
      return {
        rule,
        passed: offenders.length === 0,
        detail: offenders.length === 0
          ? "Nenhuma tag comportamental registrada"
          : `${offenders.length} trade(s) com tags comportamentais (revenge, FOMO, etc.)`,
        offenses: offenders.length,
      }
    }

    case "max_consecutive_losses": {
      const limit = rule.value ?? 3
      let maxStreak = 0
      let cur = 0
      for (const t of trades) {
        if (t.result === "LOSS") { cur++; if (cur > maxStreak) maxStreak = cur }
        else cur = 0
      }
      return {
        rule,
        passed: maxStreak <= limit,
        detail: maxStreak <= limit
          ? `Máximo de ${maxStreak} loss(es) consecutivos — dentro do limite de ${limit}`
          : `Atingiu ${maxStreak} losses consecutivos (limite: ${limit})`,
        offenses: maxStreak > limit ? 1 : 0,
      }
    }

    case "max_trades_per_day": {
      const limit = rule.value ?? 5
      const byDay: Record<string, number> = {}
      for (const t of trades) {
        const day = new Date(t.date).toISOString().split("T")[0]
        byDay[day] = (byDay[day] ?? 0) + 1
      }
      const badDays = Object.values(byDay).filter(c => c > limit)
      return {
        rule,
        passed: badDays.length === 0,
        detail: badDays.length === 0
          ? `Nunca excedeu ${limit} trades/dia`
          : `${badDays.length} dia(s) com mais de ${limit} trades`,
        offenses: badDays.length,
      }
    }

    case "only_am_session": {
      const offenders = trades.filter(t => t.sessionType !== "AM")
      return {
        rule,
        passed: offenders.length === 0,
        detail: offenders.length === 0
          ? "Todos os trades na sessão AM"
          : `${offenders.length} trade(s) fora da sessão AM`,
        offenses: offenders.length,
      }
    }

    case "min_win_rate": {
      const limit = rule.value ?? 50
      const wins = trades.filter(t => t.result === "WIN").length
      const wr = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0
      return {
        rule,
        passed: wr >= limit,
        detail: `Win rate atual: ${wr}% (mínimo: ${limit}%)`,
        offenses: wr < limit ? 1 : 0,
      }
    }
  }
}

export const RULE_TEMPLATES: { type: RuleType; defaultLabel: string; defaultValue?: number; description: string }[] = [
  { type: "max_loss_per_trade", defaultLabel: "Max loss por trade", defaultValue: 150, description: "Nenhum trade pode perder mais que $X" },
  { type: "max_daily_loss", defaultLabel: "Max loss diário", defaultValue: 300, description: "Nenhum dia pode fechar com perda maior que $X" },
  { type: "max_consecutive_losses", defaultLabel: "Max losses consecutivos", defaultValue: 3, description: "Não mais que X losses seguidos" },
  { type: "max_trades_per_day", defaultLabel: "Max trades por dia", defaultValue: 5, description: "Máximo de X operações por dia" },
  { type: "no_behavioral_tag", defaultLabel: "Sem tags comportamentais", description: "Proibido usar tags: revenge, FOMO, overtrading, impulsivo" },
  { type: "only_am_session", defaultLabel: "Operar só AM", description: "Todas as operações devem ser na sessão da manhã" },
  { type: "min_win_rate", defaultLabel: "Win rate mínimo", defaultValue: 50, description: "Win rate deve ser maior que X%" },
]
