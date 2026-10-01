// Catálogo de métricas: id, unidade, fórmula e requisitos. É a FONTE da definição que o Evidence (Incremento 5) vai citar
// e a lista de ferramentas que o agente poderá oferecer. Teste de consistência garante: toda métrica produzida está aqui.
// Se uma fórmula mudar, `version` sobe.

import type { MetricUnit } from "./types.ts"

export const DEFINITION_VERSION = "1"

export interface MetricDefinition {
  id: string
  label: string
  unit: MetricUnit
  /** Definição matemática (também em docs/ai-partner/data-contract.md §Métricas). */
  formula: string
  /** O que o trade precisa ter para contar. */
  requires: string
  version: string
}

const d = (id: string, label: string, unit: MetricUnit, formula: string, requires: string): MetricDefinition => ({
  id, label, unit, formula, requires, version: DEFINITION_VERSION,
})

export const METRIC_CATALOG: MetricDefinition[] = [
  d("totalTrades", "Total de trades", "count", "N = |população após filtros|", "—"),
  d("classifiedTrades", "Trades classificáveis", "count", "n = |{ i : pnl_i conhecido na base }|", "P&L da base escolhida (NET/GROSS)"),
  d("winners", "Vencedores", "count", "|{ i : pnl_i > 0 }|", "P&L da base"),
  d("losers", "Perdedores", "count", "|{ i : pnl_i < 0 }|", "P&L da base"),
  d("breakeven", "Empates", "count", "|{ i : pnl_i = 0 }|", "P&L da base"),
  d("winRate", "Win rate", "percent", "100 · winners / n", "P&L da base"),
  d("lossRate", "Loss rate", "percent", "100 · losers / n", "P&L da base"),
  d("breakevenRate", "Taxa de empates", "percent", "100 · breakeven / n", "P&L da base"),
  d("grossPnl", "P&L bruto", "usd", "Σ gross_i (só trades com bruto conhecido)", "pnl.gross"),
  d("netPnl", "P&L líquido", "usd", "Σ net_i (só trades com líquido conhecido)", "pnl.net (comissão conhecida)"),
  d("commission", "Comissão", "usd", "Σ commission_i (só trades com comissão informada)", "pnl.commission"),
  d("fees", "Taxas", "usd", "Σ fees_i (só trades com taxas informadas)", "pnl.fees"),
  d("winnersTotal", "Soma dos vencedores", "usd", "Σ pnl_i para pnl_i > 0", "P&L da base"),
  d("losersTotal", "Soma dos perdedores", "usd", "Σ pnl_i para pnl_i < 0 (valor negativo)", "P&L da base"),
  d("averageTrade", "Trade médio", "usd", "Σ pnl_i / n  (= expectancy em $)", "P&L da base"),
  d("averageWinner", "Vencedor médio", "usd", "winnersTotal / winners", "P&L da base"),
  d("averageLoser", "Perdedor médio", "usd", "losersTotal / losers (negativo)", "P&L da base"),
  d("largestWinner", "Maior vencedor", "usd", "max_i pnl_i, se > 0", "P&L da base"),
  d("largestLoser", "Maior perdedor", "usd", "min_i pnl_i, se < 0", "P&L da base"),
  d("payoffRatio", "Payoff", "ratio", "averageWinner / |averageLoser|", "≥ 1 vencedor e ≥ 1 perdedor"),
  d("profitFactor", "Profit factor", "ratio", "winnersTotal / |losersTotal|", "≥ 1 perdedor (sem perdedor = indisponível)"),
  d("largestWinnerSharePct", "Dependência do maior vencedor", "percent", "100 · largestWinner / winnersTotal", "≥ 1 vencedor"),
  d("top3WinnersSharePct", "Dependência dos 3 maiores vencedores", "percent", "100 · (soma dos 3 maiores pnl>0) / winnersTotal", "≥ 1 vencedor"),
  d("totalR", "R total", "R", "Σ R_i (só trades com R conhecido)", "R conhecido (stop/risco conhecido; nunca inferido)"),
  d("averageR", "R médio", "R", "Σ R_i / m", "R conhecido"),
  d("medianR", "R mediano", "R", "mediana({R_i})", "R conhecido"),
  d("winRateR", "Win rate em R", "percent", "100 · |{R_i > 0}| / m", "R conhecido"),
  d("expectancyR", "Expectancy em R", "R", "pW·avgWinnerR + pL·avgLoserR = Σ R_i / m", "R conhecido"),
  d("averageWinnerR", "R médio dos vencedores", "R", "média({R_i : R_i > 0})", "R conhecido"),
  d("averageLoserR", "R médio dos perdedores", "R", "média({R_i : R_i < 0}) (negativo)", "R conhecido"),
  d("maxDrawdown", "Drawdown máximo ($)", "usd", "max_i (peak_i − equity_i), equity = Σ pnl em ordem de saída, pico inicial 0", "P&L da base + ordem"),
  d("maxDrawdownR", "Drawdown máximo (R)", "R", "idem sobre a curva de R (só trades com R conhecido)", "R conhecido + ordem"),
  d("currentDrawdown", "Drawdown atual ($)", "usd", "peak_n − equity_n", "P&L da base + ordem"),
  d("recoveryFactor", "Recovery factor", "ratio", "Σ pnl / maxDrawdown", "maxDrawdown > 0"),
  d("maxConsecutiveWins", "Maior sequência de vitórias", "count", "maior run de pnl_i > 0 consecutivos (empate quebra)", "P&L da base + ordem"),
  d("maxConsecutiveLosses", "Maior sequência de derrotas", "count", "maior run de pnl_i < 0 consecutivos (empate quebra)", "P&L da base + ordem"),
  d("currentStreak", "Sequência atual", "count", "+n = n vitórias seguidas até o último trade; −n = n derrotas; 0 = último foi empate", "P&L da base + ordem"),
  d("totalPoints", "Pontos totais", "points", "Σ pointsPerContract_i (por contrato; não pondera quantidade)", "um único instrumento conhecido"),
  d("averagePoints", "Pontos médios", "points", "Σ pointsPerContract_i / N", "um único instrumento conhecido"),
]

export const METRIC_IDS: string[] = METRIC_CATALOG.map((m) => m.id)
const BY_ID = new Map(METRIC_CATALOG.map((m) => [m.id, m]))
export const metricDefinition = (id: string): MetricDefinition | undefined => BY_ID.get(id)
