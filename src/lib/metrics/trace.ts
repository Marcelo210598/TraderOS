// Trace dos contribuintes (G5): SUBPRODUTO da mesma passada que calcula as métricas — nunca uma segunda implementação.
// `computeMetricSet` já constrói os conjuntos (vencedores, perdedores, classificados, R conhecido, janela do drawdown, sequências…);
// quando recebe um `TraceBuilder`, ele apenas REGISTRA esses mesmos conjuntos. Sem o builder nada muda (custo zero no caminho normal).
// Vocabulário FECHADO de papéis; métricas sem conjunto natural (totalTrades, medianR, currentDrawdown, recoveryFactor) ficam `applicable: false`.

import { METRIC_IDS } from "./catalog.ts"
import type { Population } from "./types.ts"

export const CONTRIBUTOR_ROLES = [
  "WINNER",
  "LOSER",
  "BREAKEVEN",
  "EXCLUDED_NO_PNL",
  "INCLUDED",
  "EXCLUDED_UNKNOWN",
  "LARGEST_WINNER",
  "LARGEST_LOSER",
  "TOP_WINNER",
  "R_POSITIVE",
  "R_NEGATIVE",
  "R_ZERO",
  "EXCLUDED_R_UNKNOWN",
  "DRAWDOWN_PEAK",
  "DRAWDOWN_WINDOW",
  "DRAWDOWN_TROUGH",
  "DRAWDOWN_RECOVERY",
  "STREAK_RUN",
] as const
export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number]

/** Papéis "âncora": o que o trace mantém mesmo quando a população passa do limite (a lista completa deixa de ser retida). */
export const ANCHOR_ROLES: ReadonlySet<ContributorRole> = new Set<ContributorRole>([
  "LARGEST_WINNER",
  "LARGEST_LOSER",
  "TOP_WINNER",
  "DRAWDOWN_PEAK",
  "DRAWDOWN_TROUGH",
  "DRAWDOWN_RECOVERY",
])

export interface Contributor {
  tradeId: string
  role: ContributorRole
  /** Ordinal dentro do papel quando a ordem importa: posição no ranking (TOP_WINNER) ou na sequência de saída (drawdown/streak). */
  rank?: number
}

export interface MetricTrace {
  /** false = a métrica não tem conjunto natural de contribuintes (sem papel inventado). */
  applicable: boolean
  /** Contagem por papel — SEMPRE completa, mesmo acima do limite. */
  roleCounts: Partial<Record<ContributorRole, number>>
  /** Lista completa (população ≤ limite) ou null (acima do limite: só âncoras). */
  contributors: Contributor[] | null
  /** Âncoras (maior/menor, top 3, pico/vale/recuperação do drawdown): sempre presentes quando existem. */
  anchors: Contributor[]
}

export interface MetricsTrace {
  /** Mesmo limite de `population.tradeIds` (tradeIdsLimit). */
  limit: number
  populationSize: number
  metrics: Record<string, MetricTrace>
}

export interface AggregateTrace {
  total: MetricsTrace
  /** Na mesma ordem de `AggregateResult.groups`. */
  groups: Array<{ trace: MetricsTrace; population: Population }>
}

export interface TraceItem {
  id: string
  rank?: number
}

const ROLE_ORDER = new Map<ContributorRole, number>(CONTRIBUTOR_ROLES.map((r, i) => [r, i]))

export class TraceBuilder {
  private readonly entries = new Map<string, Contributor[]>()
  private readonly nothing = new Set<string>()
  private readonly limit: number
  private readonly populationSize: number
  constructor(limit: number, populationSize: number) {
    this.limit = limit
    this.populationSize = populationSize
  }

  /** Registra contribuintes de um papel. Chamar com lista vazia marca a métrica como aplicável sem contribuintes (ex.: nenhum perdedor). */
  add(metric: string, role: ContributorRole, items: TraceItem[]): void {
    const list = this.entries.get(metric) ?? []
    for (const it of items) list.push({ tradeId: it.id, role, ...(it.rank !== undefined ? { rank: it.rank } : {}) })
    this.entries.set(metric, list)
  }

  /** Marca explicitamente "sem conjunto natural" (documenta a decisão no próprio motor). */
  notApplicable(metric: string): void {
    this.nothing.add(metric)
  }

  build(): MetricsTrace {
    const metrics: Record<string, MetricTrace> = {}
    for (const id of METRIC_IDS) {
      const list = this.entries.get(id)
      if (!list || this.nothing.has(id)) {
        metrics[id] = { applicable: false, roleCounts: {}, contributors: null, anchors: [] }
        continue
      }
      const sorted = [...list].sort(
        (a, b) => (ROLE_ORDER.get(a.role) as number) - (ROLE_ORDER.get(b.role) as number) || (a.rank ?? 0) - (b.rank ?? 0) || (a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : 0),
      )
      const roleCounts: Partial<Record<ContributorRole, number>> = {}
      for (const c of sorted) roleCounts[c.role] = (roleCounts[c.role] ?? 0) + 1
      metrics[id] = {
        applicable: true,
        roleCounts,
        contributors: this.populationSize <= this.limit ? sorted : null,
        anchors: sorted.filter((c) => ANCHOR_ROLES.has(c.role)),
      }
    }
    return { limit: this.limit, populationSize: this.populationSize, metrics }
  }
}
