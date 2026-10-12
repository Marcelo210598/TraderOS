// Modelo do Evidence Lab: roda o domínio REAL sobre dados sintéticos e entrega o que a página mostra.
// NADA aqui calcula métrica, hash ou verificação: tudo vem de `runImportPipeline`, `calculateMetricsTraced`/`aggregateTradesTraced`,
// `explainTrades`/`explainMetric`, `computeEvidenceHash` e `verifyEvidence`. A página só formata o que estas funções devolvem.
// Sem banco, sem Prisma, sem fixtures reais; recusa rodar fora de NODE_ENV=development.

import type { CanonicalTrade, ImportRecord } from "../../domain/canonical.ts"
import { explainMetric, metricEvidenceBundle, type ExplainMetricOk } from "../../evidence/explain-metric.ts"
import { explainTrades } from "../../evidence/explain-trade.ts"
import { computeEvidenceHash } from "../../evidence/hash.ts"
import type { EvidenceBundle, ImportRef, TradeEvidence } from "../../evidence/schema.ts"
import { verifyEvidence, type VerifyReport, type VerifyStatus } from "../../evidence/verify.ts"
import { runImportPipeline } from "../../ingest/pipeline.ts"
import {
  METRIC_CATALOG,
  aggregateTradesTraced,
  calculateMetricsTraced,
  toAnalyticsTrades,
  type AggregateResult,
  type AggregateTrace,
  type AnalysisOptions,
  type AnalyticsTrade,
  type Dimension,
  type MetricsResult,
  type MetricsTrace,
} from "../../metrics/index.ts"
import { assertEvidenceLabEnabled } from "./guard.ts"
import { DEMO_FILE_NAME, DEMO_SOURCE_TZ, applyDemoStops, demoCsv } from "./synthetic.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// ── demo ─────────────────────────────────────────────────────────────────────

export interface Demo {
  csv: string
  importRecord: ImportRecord
  /** Trades canônicos (ciclos reconstruídos) com stops demonstrativos. */
  trades: CanonicalTrade[]
  analytics: AnalyticsTrade[]
  tradeEvidence: TradeEvidence[]
  importRef: ImportRef
  rowsRead: number
  rowsRejected: number
  cycles: number
}

export function buildDemo(overrideTrades?: (t: CanonicalTrade[]) => CanonicalTrade[]): Demo {
  assertEvidenceLabEnabled()
  const csv = demoCsv()
  const run = runImportPipeline(csv, { sourceTz: DEMO_SOURCE_TZ, fileName: DEMO_FILE_NAME })
  if (!run.importRecord) throw new Error("O pipeline não reconheceu o CSV sintético do Lab.")
  const withStops = applyDemoStops(run.trades)
  const trades = overrideTrades ? overrideTrades(withStops) : withStops
  const results = explainTrades(trades, run.importRecord)
  const tradeEvidence: TradeEvidence[] = []
  let importRef: ImportRef | null = null
  for (const r of results) {
    if (!r.ok) throw new Error(`explainTrade falhou no demo: ${r.code} — ${r.message}`)
    tradeEvidence.push(r.tradeEvidence)
    importRef = r.importRef
  }
  if (!importRef) throw new Error("Demo sem trades.")
  return {
    csv,
    importRecord: run.importRecord,
    trades,
    analytics: toAnalyticsTrades(trades),
    tradeEvidence,
    importRef,
    rowsRead: run.stats.rowsRead,
    rowsRejected: run.rejected.length,
    cycles: trades.length,
  }
}

// ── métricas ─────────────────────────────────────────────────────────────────

export interface ViewOptions {
  pnl: "NET" | "GROSS"
  r: "NET" | "POINTS"
}

export const GROUP_DIMENSIONS = ["account", "hour", "direction", "dayOfWeek", "strategy"] as const
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]

const analysisOptions = (v: ViewOptions): AnalysisOptions => ({ pnlBasis: v.pnl, rBasis: v.r })

export interface MetricsView {
  result: MetricsResult
  trace: MetricsTrace
}
export function metricsView(demo: Demo, v: ViewOptions): MetricsView {
  assertEvidenceLabEnabled()
  return calculateMetricsTraced(demo.analytics, analysisOptions(v))
}

export interface GroupsView {
  result: AggregateResult
  trace: AggregateTrace
}
export function groupsView(demo: Demo, v: ViewOptions, by: GroupDimension): GroupsView {
  assertEvidenceLabEnabled()
  return aggregateTradesTraced(demo.analytics, { ...analysisOptions(v), groupBy: by as Dimension })
}

export const METRIC_DEFINITIONS = METRIC_CATALOG

// ── bundles ──────────────────────────────────────────────────────────────────

export interface BundleRequest {
  metricId: string
  view: ViewOptions
  /** Acima disso a população vira HASH_ONLY (padrão do motor: 500). */
  tradeIdsLimit?: number
  by?: GroupDimension | null
  group?: number
}

export type BundleBuild = { ok: true; bundle: EvidenceBundle; explain: ExplainMetricOk } | { ok: false; code: string; message: string }

export function buildBundle(demo: Demo, req: BundleRequest): BundleBuild {
  assertEvidenceLabEnabled()
  const opts: AnalysisOptions = { ...analysisOptions(req.view), ...(req.tradeIdsLimit !== undefined ? { tradeIdsLimit: req.tradeIdsLimit } : {}) }
  let source
  if (req.by) {
    const ag = aggregateTradesTraced(demo.analytics, { ...opts, groupBy: req.by as Dimension })
    source = { kind: "AGGREGATE" as const, result: ag.result, trace: ag.trace, scope: { kind: "GROUP" as const, index: req.group ?? 0 } }
  } else {
    const t = calculateMetricsTraced(demo.analytics, opts)
    source = { kind: "METRICS" as const, result: t.result, trace: t.trace }
  }
  const r = explainMetric({ metricId: req.metricId, source, trades: demo.analytics, importRecords: [demo.importRecord] })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, bundle: metricEvidenceBundle(r), explain: r }
}

// ── cenários de adulteração ──────────────────────────────────────────────────

export interface ScenarioContext {
  demo: Demo
  /** Bundle íntegro de `winners` (população completa, com contribuintes). */
  base: EvidenceBundle
  /** Bundle íntegro de `largestWinner` com limite 3 (HASH_ONLY, só âncoras). */
  hashOnly: EvidenceBundle
  /** Bundle íntegro de `netPnl` agrupado por estratégia (associação sem referência na Evidence). */
  strategyGroup: EvidenceBundle
}

export interface LabScenario {
  id: string
  title: string
  /** O que se faz com o bundle (texto). O RESULTADO não vem daqui: é calculado por verifyEvidence. */
  what: string
  /** Se o selo é recalculado pela função REAL `computeEvidenceHash` depois da alteração. */
  resealed: boolean
  /** O que o contrato prevê (metadado para o Lab acusar divergência; o status mostrado é sempre o real). */
  expected: VerifyStatus
  expectedNote: string
  make: (c: ScenarioContext) => unknown
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
/** Recalcula o selo com a função real do contrato (como um atacante faria). Bundle malformado demais para o selo: mantém o hash antigo. */
function reseal(b: Any): Any {
  try {
    return { ...b, evidenceHash: computeEvidenceHash(b) }
  } catch {
    return b
  }
}
const edit = (b: EvidenceBundle, fn: (x: Any) => void, sealed: boolean): Any => {
  const c = clone(b) as Any
  fn(c)
  return sealed ? reseal(c) : c
}

export const SCENARIOS: LabScenario[] = [
  { id: "intact", title: "Bundle íntegro", what: "Nenhuma alteração.", resealed: false, expected: "VALID", expectedNote: "Todos os checks aplicáveis passam.", make: (c) => c.base },
  { id: "value-noseal", title: "Valor alterado, selo NÃO recalculado", what: "metrics[0].value + 1, sem refazer o evidenceHash.", resealed: false, expected: "TAMPERED", expectedNote: "V1 acusa o selo.", make: (c) => edit(c.base, (x) => (x.evidence.metrics[0].value += 1), false) },
  { id: "value-reseal", title: "Valor alterado COM novo selo", what: "metrics[0].value + 1 e evidenceHash recalculado (selo válido).", resealed: true, expected: "TAMPERED", expectedNote: "O selo passa; V4 recalcula pelo motor e acusa o valor.", make: (c) => edit(c.base, (x) => (x.evidence.metrics[0].value += 1), true) },
  { id: "remove-trade", title: "Trade removido", what: "Remove um TradeEvidence da lista (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V2 acusa referência sem trade; V3/V4 ficam SKIPPED (não dá para refazer).", make: (c) => edit(c.base, (x) => x.evidence.trades.shift(), true) },
  { id: "remove-import", title: "ImportRef removido", what: "Esvazia imports[] (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V2 acusa trade sem ImportRef.", make: (c) => edit(c.base, (x) => (x.evidence.imports = []), true) },
  { id: "rowhash", title: "rowHash alterado", what: "Troca o rowHash de uma linha de origem; o tradeSetHash declarado fica igual; selo recalculado.", resealed: true, expected: "TAMPERED", expectedNote: "V1 passa; V3 refaz o tradeSetHash dos TradeEvidence e ele diverge do declarado.", make: (c) => edit(c.base, (x) => (x.evidence.trades[2].sourceRows[0].rowHash = "f".repeat(64)), true) },
  { id: "contributor", title: "Contributor trocado", what: "Aponta um contribuinte (vencedor) para outro trade existente (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "As referências ainda fecham (V2 passa); V4 compara com o trace do motor e acusa.", make: (c) => edit(c.base, (x) => { const items = x.evidence.metrics[0].contributors.items; const other = x.evidence.trades.find((t: Any) => !items.some((i: Any) => i.tradeId === t.tradeId)); items[0].tradeId = other.tradeId }, true) },
  { id: "rolecounts", title: "roleCounts alterado", what: "roleCounts.WINNER + 1 (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V2 (contagem × itens) e V4 (trace) acusam.", make: (c) => edit(c.base, (x) => (x.evidence.metrics[0].contributors.roleCounts.WINNER += 1), true) },
  { id: "pnl", title: "P&L de um trade alterado", what: "pnl.net + 100 num TradeEvidence (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V3: o P&L faz parte do fingerprint do tradeSetHash.", make: (c) => edit(c.base, (x) => (x.evidence.trades[0].pnl.net += 100), true) },
  { id: "r", title: "R de um trade alterado", what: "r.net = 9 num TradeEvidence (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V3: r.net faz parte do fingerprint.", make: (c) => edit(c.base, (x) => { const t = x.evidence.trades.find((q: Any) => q.r.net !== null); t.r.net = 9 }, true) },
  { id: "tradesethash", title: "tradeSetHash declarado trocado", what: "population.tradeSetHash = 'b'×64 (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V3 e V4.population refazem o hash e divergem.", make: (c) => edit(c.base, (x) => (x.evidence.metrics[0].population.tradeSetHash = "b".repeat(64)), true) },
  { id: "extra-field", title: "Campo extra (sourceName escondido)", what: "Insere sourceName dentro de entryLegs[0] (selo recalculado).", resealed: true, expected: "INVALID_FORMAT", expectedNote: "O schema descartaria o campo em silêncio; V0.unknown-fields não aceita.", make: (c) => edit(c.base, (x) => (x.evidence.trades[0].entryLegs[0].sourceName = "<nome-de-conta-injetado>"), true) },
  { id: "seal-truncated", title: "Selo truncado", what: "evidenceHash com 40 caracteres.", resealed: false, expected: "INVALID_FORMAT", expectedNote: "V0: formato do selo inválido (nunca TAMPERED).", make: (c) => ({ ...clone(c.base), evidenceHash: c.base.evidenceHash.slice(0, 40) }) },
  { id: "engine-version", title: "Versão do motor incompatível", what: "engineVersion = 'metrics/0.9.0' (selo recalculado).", resealed: true, expected: "UNVERIFIABLE", expectedNote: "Não é adulteração: não dá para reproduzir com este motor (V4 SKIPPED).", make: (c) => edit(c.base, (x) => (x.evidence.metrics[0].engineVersion = "metrics/0.9.0"), true) },
  { id: "hash-only", title: "HASH_ONLY íntegro (população acima do limite)", what: "largestWinner com tradeIdsLimit = 3: só o tradeSetHash e as âncoras.", resealed: false, expected: "UNVERIFIABLE", expectedNote: "V3/V4 SKIPPED (S_HASH_ONLY); nunca VALID sem a população completa.", make: (c) => c.hashOnly },
  { id: "hash-only-anchor", title: "HASH_ONLY: âncora adulterada", what: "pnl da âncora do maior vencedor + 100 (selo recalculado).", resealed: true, expected: "TAMPERED", expectedNote: "V4.anchors: o motor sobre a âncora não reproduz o valor.", make: (c) => edit(c.hashOnly, (x) => { const a = x.evidence.metrics[0].contributors.items[0]; const t = x.evidence.trades.find((q: Any) => q.tradeId === a.tradeId); t.pnl.net += 100; t.pnl.gross += 100 }, true) },
  { id: "strategy-group", title: "Grupo por estratégia (associação sem referência)", what: "netPnl agrupado por estratégia, íntegro.", resealed: false, expected: "UNVERIFIABLE", expectedNote: "A conta sobre a população declarada confere, mas a Evidence não tem referência de estratégia: V4.association SKIPPED.", make: (c) => c.strategyGroup },
  {
    id: "coordinated",
    title: "Alteração COORDENADA (o limite)",
    what: "Altera o P&L de um trade no dado de origem e REGENERA tudo com as funções reais (trade, tradeSetHash, valor, contribuintes, selo).",
    resealed: true,
    expected: "VALID",
    expectedNote: "É o limite documentado: o bundle forjado é internamente consistente. Só comparar com o CSV original (E5b) denuncia — o selo não é assinatura.",
    make: (c) => {
      const forged = buildDemo((ts) => ts.map((t, i) => (i === 0 ? ({ ...t, pnl: { ...t.pnl, net: (t.pnl.net ?? 0) + 100, gross: (t.pnl.gross ?? 0) + 100 } } as CanonicalTrade) : t)))
      const b = buildBundle(forged, { metricId: "winners", view: { pnl: "NET", r: "NET" } })
      return b.ok ? b.bundle : c.base
    },
  },
]

export interface ScenarioRun {
  scenario: LabScenario
  bundle: unknown
  report: VerifyReport
  sealBefore: string
  sealAfter: string | null
  /** O status REAL bate com o que o contrato prevê? */
  matchesContract: boolean
  changes: string[]
}

/** Caminhos JSON que diferem entre dois valores (ordem alfabética, no máximo `max`): mostra O QUE a adulteração mudou. */
export function diffPaths(a: unknown, b: unknown, max = 12): string[] {
  const out: string[] = []
  const walk = (x: unknown, y: unknown, path: string) => {
    if (out.length >= max) return
    if (JSON.stringify(x) === JSON.stringify(y)) return
    const xo = typeof x === "object" && x !== null
    const yo = typeof y === "object" && y !== null
    if (!xo || !yo || Array.isArray(x) !== Array.isArray(y)) {
      out.push(path || "(raiz)")
      return
    }
    const keys = [...new Set([...Object.keys(x as object), ...Object.keys(y as object)])].sort()
    for (const k of keys) walk((x as Any)[k], (y as Any)[k], path ? (Array.isArray(x) ? `${path}[${k}]` : `${path}.${k}`) : k)
  }
  walk(a, b, "")
  return out
}

export function scenarioContext(demo: Demo): ScenarioContext {
  const view: ViewOptions = { pnl: "NET", r: "NET" }
  const must = (b: BundleBuild): EvidenceBundle => {
    if (!b.ok) throw new Error(`Bundle base do Lab falhou: ${b.code} — ${b.message}`)
    return b.bundle
  }
  return {
    demo,
    base: must(buildBundle(demo, { metricId: "winners", view })),
    hashOnly: must(buildBundle(demo, { metricId: "largestWinner", view, tradeIdsLimit: 3 })),
    strategyGroup: must(buildBundle(demo, { metricId: "netPnl", view, by: "strategy", group: 0 })),
  }
}

export function runScenario(ctx: ScenarioContext, scenario: LabScenario): ScenarioRun {
  assertEvidenceLabEnabled()
  const bundle = scenario.make(ctx)
  const report = verifyEvidence(bundle)
  const reference = scenario.id === "hash-only" || scenario.id === "hash-only-anchor" ? ctx.hashOnly : scenario.id === "strategy-group" ? ctx.strategyGroup : ctx.base
  const sealAfter = (bundle as Any)?.evidenceHash
  return {
    scenario,
    bundle,
    report,
    sealBefore: reference.evidenceHash,
    sealAfter: typeof sealAfter === "string" ? sealAfter : null,
    matchesContract: report.status === scenario.expected,
    changes: scenario.id === "coordinated" ? ["(bundle regenerado do zero a partir de dado de origem alterado — ver as diferenças contra o íntegro abaixo)", ...diffPaths(reference, bundle, 8)] : diffPaths(reference, bundle),
  }
}

export function runAllScenarios(ctx: ScenarioContext): ScenarioRun[] {
  return SCENARIOS.map((s) => runScenario(ctx, s))
}
