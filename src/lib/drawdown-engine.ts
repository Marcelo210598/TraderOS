// Motor de drawdown de conta de mesa proprietária — puro (sem React/Prisma), sem nome de mesa.
// As mesas viram só PARÂMETROS (DrawdownRules). Os 4 tipos de drawdown são a mesma regra
// (limite = pico − drawdown) mudando apenas QUANDO o pico atualiza:
//   INTRADAY        → a cada movimento do patrimônio (conta o lucro em aberto)
//   END_OF_POSITION → quando uma posição fecha (saldo realizado)
//   END_OF_DAY      → quando o dia encerra (saldo realizado)
//   STATIC          → nunca (limite fixo em saldo inicial − drawdown)
// O motor roda os 4 ao mesmo tempo pra comparar a margem de cada regra.

export type DrawdownType = "INTRADAY" | "END_OF_DAY" | "END_OF_POSITION" | "STATIC"

export const DRAWDOWN_TYPES: DrawdownType[] = ["INTRADAY", "END_OF_DAY", "END_OF_POSITION", "STATIC"]

export const DRAWDOWN_LABEL: Record<DrawdownType, string> = {
  INTRADAY: "Intraday Trailing",
  END_OF_DAY: "End of Day Trailing",
  END_OF_POSITION: "End of Position Trailing",
  STATIC: "Static",
}

export interface DrawdownRules {
  startBalance: number
  profitTarget: number | null
  maxDrawdown: number
  /** O limite do trailing nunca passa desse nível (ex.: o saldo inicial). null = sem trava. */
  trailingLock: number | null
  dailyLossLimit: number | null
  consistencyMaxPct: number | null
  /** NET_PROFIT: maior dia ÷ lucro líquido. ABS_SUM: maior dia ÷ soma dos dias em valor absoluto. */
  consistencyBase: "NET_PROFIT" | "ABS_SUM"
  minTradingDays: number | null
}

export const DEFAULT_RULES: DrawdownRules = {
  startBalance: 50000,
  profitTarget: 3000,
  maxDrawdown: 2000,
  trailingLock: 50000,
  dailyLossLimit: null,
  consistencyMaxPct: null,
  consistencyBase: "NET_PROFIT",
  minTradingDays: null,
}

/** Passos da simulação: mexer no resultado em aberto, fechar a posição, encerrar o dia. */
export type Step =
  | { type: "MOVE"; delta: number }
  | { type: "CLOSE" }
  | { type: "END_DAY" }

export interface RuleSnapshot {
  limit: number
  /** patrimônio − limite (quanto ainda pode perder) */
  margin: number
  status: "OK" | "BREACHED"
  /** índice do passo em que quebrou (1-based, 0 = estado inicial), ou null */
  breachedAtStep: number | null
  /** posição do patrimônio entre o limite (0) e a meta (1); null sem meta */
  progress: number | null
}

export interface ConsistencyResult {
  bestDay: number
  /** denominador usado (lucro líquido ou soma dos absolutos) */
  base: number
  /** em %, ou null se não há lucro/maior dia positivo */
  pct: number | null
  ok: boolean
  /** lucro a mais (mantendo o maior dia) pra chegar no limite; 0 se já está ok */
  extraNeeded: number
}

export interface Frame {
  step: number // 0 = inicial
  day: number
  balance: number // saldo realizado
  open: number // resultado em aberto
  equity: number
  trades: number // posições fechadas
  daysTraded: number // dias com ao menos 1 posição fechada
  dayPnl: number // resultado do dia atual (realizado + aberto)
  dailyLossHit: boolean
  toTarget: number | null // meta − patrimônio (mín. 0)
  targetTouchedOpen: boolean // patrimônio já encostou na meta (mesmo em aberto)
  targetReachedClosed: boolean // saldo realizado já atingiu a meta
  consistency: ConsistencyResult | null
  rules: Record<DrawdownType, RuleSnapshot>
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round2 = (n: number) => Math.round(n * 100) / 100

/** Consistência: maior dia ÷ base. Funciona igual pra dias simulados ou de trades reais. */
export function consistency(
  dayPnls: number[],
  maxPct: number,
  base: DrawdownRules["consistencyBase"] = "NET_PROFIT"
): ConsistencyResult | null {
  if (!dayPnls.length) return null
  const bestDay = Math.max(...dayPnls)
  const denom = base === "ABS_SUM" ? sum(dayPnls.map(Math.abs)) : sum(dayPnls)
  if (bestDay <= 0 || denom <= 0) return { bestDay, base: denom, pct: null, ok: false, extraNeeded: 0 }
  const pct = (bestDay / denom) * 100
  const ok = pct <= maxPct
  // o total precisa ser ≥ maior dia ÷ limite; manter o maior dia e ganhar mais em outros dias
  const extraNeeded = ok ? 0 : bestDay / (maxPct / 100) - denom
  return { bestDay, base: round2(denom), pct: round2(pct), ok, extraNeeded: round2(extraNeeded) }
}

/** Limite do trailing dado o pico: pico − drawdown, nunca abaixo do piso estático nem acima da trava. */
function trailingLimit(rules: DrawdownRules, peak: number) {
  const floor = rules.startBalance - rules.maxDrawdown
  const cap = rules.trailingLock ?? Infinity
  return Math.max(floor, Math.min(peak - rules.maxDrawdown, cap))
}

/**
 * Roda os passos e devolve um frame por passo (frame 0 = estado inicial).
 * Puro: `desfazer` = simular de novo com os passos sem o último.
 * Quebra é "pegajosa": depois de quebrar, a regra continua quebrada.
 */
export function simulate(rules: DrawdownRules, steps: Step[]): Frame[] {
  let balance = rules.startBalance
  let open = 0
  let peakEquity = balance // INTRADAY
  let peakClosed = balance // END_OF_POSITION
  let peakEod = balance // END_OF_DAY
  let day = 1
  let dayStartBalance = balance
  let dayTrades = 0
  let trades = 0
  let daysTraded = 0
  let dailyLossHit = false
  let touchedOpen = false
  let reachedClosed = false
  const dayPnls: number[] = []
  const breachedAt: Record<DrawdownType, number | null> = {
    INTRADAY: null,
    END_OF_DAY: null,
    END_OF_POSITION: null,
    STATIC: null,
  }

  const frames: Frame[] = []

  const snapshot = (step: number): Frame => {
    const equity = balance + open
    const limits: Record<DrawdownType, number> = {
      INTRADAY: trailingLimit(rules, peakEquity),
      END_OF_POSITION: trailingLimit(rules, peakClosed),
      END_OF_DAY: trailingLimit(rules, peakEod),
      STATIC: rules.startBalance - rules.maxDrawdown,
    }
    // meta é LUCRO: o nível no gráfico é saldo inicial + meta
    const target = rules.profitTarget === null ? null : rules.startBalance + rules.profitTarget
    const snaps = {} as Record<DrawdownType, RuleSnapshot>
    for (const t of DRAWDOWN_TYPES) {
      if (breachedAt[t] === null && equity <= limits[t]) breachedAt[t] = step
      const limit = limits[t]
      snaps[t] = {
        limit: round2(limit),
        margin: round2(equity - limit),
        status: breachedAt[t] === null ? "OK" : "BREACHED",
        breachedAtStep: breachedAt[t],
        progress:
          target === null || target <= limit
            ? null
            : Math.max(0, Math.min(1, (equity - limit) / (target - limit))),
      }
    }
    if (target !== null) {
      if (equity >= target) touchedOpen = true
      if (balance >= target) reachedClosed = true
    }
    const dayPnl = balance + open - dayStartBalance
    if (rules.dailyLossLimit !== null && dayPnl <= -rules.dailyLossLimit) dailyLossHit = true

    const pnlsWithToday = dayTrades > 0 ? [...dayPnls, balance - dayStartBalance] : dayPnls
    return {
      step,
      day,
      balance: round2(balance),
      open: round2(open),
      equity: round2(equity),
      trades,
      daysTraded: daysTraded + (dayTrades > 0 ? 1 : 0),
      dayPnl: round2(dayPnl),
      dailyLossHit,
      toTarget: target === null ? null : Math.max(0, round2(target - equity)),
      targetTouchedOpen: touchedOpen,
      targetReachedClosed: reachedClosed,
      consistency:
        rules.consistencyMaxPct === null
          ? null
          : consistency(pnlsWithToday, rules.consistencyMaxPct, rules.consistencyBase),
      rules: snaps,
    }
  }

  frames.push(snapshot(0))

  steps.forEach((s, i) => {
    if (s.type === "MOVE") {
      open += s.delta
      peakEquity = Math.max(peakEquity, balance + open)
    } else if (s.type === "CLOSE") {
      balance += open
      open = 0
      trades += 1
      dayTrades += 1
      peakClosed = Math.max(peakClosed, balance)
      peakEquity = Math.max(peakEquity, balance)
    } else {
      // END_DAY: realiza o dia; o EOD usa o saldo realizado
      peakEod = Math.max(peakEod, balance)
      if (dayTrades > 0) daysTraded += 1
      dayPnls.push(balance - dayStartBalance)
      day += 1
      dayStartBalance = balance
      dayTrades = 0
      dailyLossHit = false
    }
    frames.push(snapshot(i + 1))
  })

  return frames
}

export interface Scenario {
  id: string
  name: string
  description: string
  steps: Step[]
}

const up = (n: number): Step => ({ type: "MOVE", delta: n })
const CLOSE: Step = { type: "CLOSE" }
const END_DAY: Step = { type: "END_DAY" }

export const SCENARIOS: Scenario[] = [
  {
    id: "lucro-devolvido",
    name: "Lucro aberto devolvido",
    description: "O trade vai a +$1.500, volta e fecha em +$500. Compare quanto sobra de margem em cada regra.",
    steps: [up(500), up(500), up(500), up(-500), up(-500), CLOSE, END_DAY],
  },
  {
    id: "sobe-e-quebra",
    name: "Sobe, devolve tudo e quebra",
    description: "O trade vai a +$2.000 em aberto e devolve tudo. Só a regra que conta o lucro em aberto quebra.",
    steps: [up(500), up(500), up(500), up(500), up(-500), up(-500), up(-500), up(-500), CLOSE, END_DAY],
  },
  {
    id: "escada",
    name: "Escada de lucro",
    description: "Fecha +$500 em 4 dias seguidos. Veja o limite subindo (ou não) em cada regra.",
    steps: [up(500), CLOSE, END_DAY, up(500), CLOSE, END_DAY, up(500), CLOSE, END_DAY, up(500), CLOSE, END_DAY],
  },
]
