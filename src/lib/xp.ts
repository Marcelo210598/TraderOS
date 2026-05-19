// Lógica central de XP e leveling

export const XP_REWARDS = {
  TRADE_REGISTERED: 10,
  CHECK_IN: 5,
  TRADE_PLAN: 8,
  WIN_TRADE: 15,
  SETUP_CREATED: 20,
  STREAK_BONUS: 25,
} as const

export function xpForLevel(level: number): number {
  // Progressão quadrática: nível 1→2 = 500xp, 2→3 = 1000xp, etc.
  return level * 500
}

export function totalXpForLevel(level: number): number {
  let total = 0
  for (let i = 1; i < level; i++) total += xpForLevel(i)
  return total
}

export function getLevelFromXp(xp: number): { level: number; currentXp: number; xpNeeded: number; progress: number } {
  let level = 1
  let remaining = xp

  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level)
    level++
  }

  const xpNeeded = xpForLevel(level)
  const progress = Math.min(Math.round((remaining / xpNeeded) * 100), 100)

  return { level, currentXp: remaining, xpNeeded, progress }
}

export const LEVEL_TITLES: Record<number, string> = {
  1: "Aprendiz",
  2: "Iniciante",
  3: "Consistente",
  4: "Disciplinado",
  5: "Trader",
  6: "Trader Sênior",
  7: "Especialista",
  8: "Mestre",
  9: "Elite",
  10: "Lendário",
}

export function getLevelTitle(level: number): string {
  if (level >= 10) return "Lendário"
  return LEVEL_TITLES[level] ?? "Trader"
}

export const ACHIEVEMENTS_CONFIG = [
  { key: "FIRST_TRADE", name: "Primeira Operação", description: "Registrou seu primeiro trade", icon: "🎯", xpReward: 50, type: "TRADES_COUNT" as const, requirement: 1 },
  { key: "TEN_TRADES", name: "10 Trades", description: "Registrou 10 trades no journal", icon: "📊", xpReward: 100, type: "TRADES_COUNT" as const, requirement: 10 },
  { key: "FIFTY_TRADES", name: "50 Trades", description: "Meio centenário de operações", icon: "🏆", xpReward: 250, type: "TRADES_COUNT" as const, requirement: 50 },
  { key: "HUNDRED_TRADES", name: "100 Trades", description: "100 operações registradas — você é consistente!", icon: "💯", xpReward: 500, type: "TRADES_COUNT" as const, requirement: 100 },
  { key: "WIN_STREAK_3", name: "Sequência de 3", description: "3 dias lucrativos seguidos", icon: "🔥", xpReward: 75, type: "WIN_STREAK" as const, requirement: 3 },
  { key: "WIN_STREAK_5", name: "Semana Verde", description: "5 dias lucrativos seguidos", icon: "🚀", xpReward: 150, type: "WIN_STREAK" as const, requirement: 5 },
  { key: "WIN_STREAK_10", name: "Máquina de Lucro", description: "10 dias lucrativos seguidos", icon: "💎", xpReward: 400, type: "WIN_STREAK" as const, requirement: 10 },
  { key: "JOURNAL_7", name: "Uma Semana de Diário", description: "7 dias consecutivos registrando trades", icon: "📓", xpReward: 100, type: "JOURNAL_STREAK" as const, requirement: 7 },
  { key: "JOURNAL_30", name: "Mês Completo", description: "30 dias consecutivos no journal", icon: "🗓️", xpReward: 500, type: "JOURNAL_STREAK" as const, requirement: 30 },
  { key: "SETUP_LIBRARY", name: "Estrategista", description: "Criou 5 setups na biblioteca", icon: "📚", xpReward: 150, type: "SETUP_LIBRARY" as const, requirement: 5 },
  { key: "FIRST_GREEN_MONTH", name: "Mês Verde", description: "Fechou um mês no lucro", icon: "📈", xpReward: 300, type: "PNL_MILESTONE" as const, requirement: 1 },
  { key: "CONSISTENCY_90", name: "Consistência 90%", description: "Win rate acima de 50% em 30+ trades", icon: "⚖️", xpReward: 200, type: "CONSISTENCY" as const, requirement: 50 },
]
