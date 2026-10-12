// Aba "Derivados (E6)" do Evidence Lab: Evidence dos derivados do E6.2 (ranking, contribuição, comparação) sobre dados SINTÉTICOS.
// NADA aqui calcula ranking, delta, contribuição, hash ou veredito: cada cenário chama `explainDerived` (que roda as funções reais do E6.2),
// `derivedEvidenceBundle`/`computeEvidenceHash` (selo), `verifyEvidence` (V0–V6) e `verifyEvidenceSource` (E5b) de VERDADE. Os cenários de
// adulteração alteram o JSON e REFAZEM o selo com `computeEvidenceHash`, exatamente como um atacante faria. Sem JSON estático, sem banco/Prisma,
// sem fixtures reais, sem endpoint, sem persistir bytes; recusa fora de NODE_ENV=development. Rótulos de origem (sourceLabel) NUNCA são
// mostrados: a página usa `redactLabels`.

import type { CanonicalTrade, ImportRecord } from "../../domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived, type ExplainDerivedInput } from "../../evidence/explain-derived.ts"
import { computeEvidenceHash } from "../../evidence/hash.ts"
import { EvidenceBundleSchema, type EvidenceBundle } from "../../evidence/schema.ts"
import { verifyEvidence, type VerifyReport, type VerifyStatus } from "../../evidence/verify.ts"
import { verifyEvidenceSource, type SourceVerifyReport } from "../../evidence/verify-source.ts"
import { runImportPipeline } from "../../ingest/pipeline.ts"
import { toAnalyticsTrades, type AnalyticsTrade } from "../../metrics/index.ts"
import { assertEvidenceLabEnabled } from "./guard.ts"
import { DEMO_SOURCE_TZ, derivedDemoCsv } from "./synthetic.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export const DERIVED_LAB_OPTIONS = { timeZone: "America/Sao_Paulo", minSample: 4 } as const
export const DERIVED_FILE_NAME = "demo-derivados-sintetico.csv"

export interface DerivedLabContext {
  csv: string
  bytes: Uint8Array
  importRecord: ImportRecord
  trades: AnalyticsTrade[]
  /** Trades canônicos crus (para o cenário de divergência perna×trade). */
  canonical: CanonicalTrade[]
  rowsRead: number
  cycles: number
}

export function derivedContext(): DerivedLabContext {
  assertEvidenceLabEnabled()
  const csv = derivedDemoCsv()
  const run = runImportPipeline(csv, { sourceTz: DEMO_SOURCE_TZ, fileName: DERIVED_FILE_NAME })
  if (!run.importRecord) throw new Error("O pipeline não reconheceu o CSV sintético dos derivados.")
  return { csv, bytes: new TextEncoder().encode(csv), importRecord: run.importRecord, trades: toAnalyticsTrades(run.trades), canonical: run.trades, rowsRead: run.stats.rowsRead, cycles: run.trades.length }
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
/** Altera o JSON e REFAZ o selo (a adulteração mais forte que o selo sozinho não pega). */
const edit = (b: EvidenceBundle, fn: (x: Any) => void): Any => {
  const c = clone(b) as Any
  fn(c)
  try {
    return { ...c, evidenceHash: computeEvidenceHash(c) }
  } catch {
    return c
  }
}
const d0 = (x: Any) => x.evidence.derived[0]

function build(c: DerivedLabContext, spec: ExplainDerivedInput["spec"], over: Partial<ExplainDerivedInput> = {}): EvidenceBundle {
  const r = explainDerived({ spec: { options: DERIVED_LAB_OPTIONS, ...spec }, trades: c.trades, importRecords: [c.importRecord], ...over })
  if (!r.ok) throw new Error(`Lab (derivados): ${r.code} — ${r.message}`)
  return derivedEvidenceBundle(r)
}

export type DerivedGroup = "integro" | "adulteracao" | "limite"
export const DERIVED_GROUP_LABEL: Record<DerivedGroup, string> = {
  integro: "Derivados íntegros (reproduzíveis)",
  adulteracao: "Adulteração (selo refeito)",
  limite: "Limites de verificação",
}

export interface DerivedScenario {
  id: string
  group: DerivedGroup
  title: string
  what: string
  /** Veredito que o contrato prevê (metadado para o Lab acusar divergência; o estado mostrado é SEMPRE o devolvido por verifyEvidence). */
  expected: VerifyStatus
  expectedNote: string
  make: (c: DerivedLabContext) => unknown
}

export const DERIVED_SCENARIOS: DerivedScenario[] = [
  {
    id: "rank-hour",
    group: "integro",
    title: "Ranking por hora (válido)",
    what: "GROUP_RANKING por hora, líquido (unidade TRADE). Calculado por rankGroups (E6.2) e conferido pelo V6.",
    expected: "VALID",
    expectedNote: "V6 reexecuta rankGroups sobre os TradeEvidence e obtém exatamente o mesmo resultado.",
    make: (c) => build(c, { op: "GROUP_RANKING", args: { groupBy: "hour" } }),
  },
  {
    id: "compare-acc",
    group: "integro",
    title: "Comparação entre contas A × B (válida)",
    what: "GROUP_COMPARISON por conta. A chave sai como accountRef (nunca o nome). Deltas e razões vêm de compareGroups.",
    expected: "VALID",
    expectedNote: "V6.derived recalcula deltas, razões e conclusive; as contas aparecem só como accountRef.",
    make: (c) => build(c, { op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: "Conta Demo A" }, b: { account: "Conta Demo B" } } }),
  },
  {
    id: "compare-period",
    group: "integro",
    title: "Semana 02/03 × semana 09/03 (válida)",
    what: "PERIOD_COMPARISON com dois intervalos de datas pelo MESMO motor. Sobreposição e período vazio seriam ditos nas limitações.",
    expected: "VALID",
    expectedNote: "Cada lado é o resultado do motor com os filtros from/to; o V6 refaz os dois.",
    make: (c) => build(c, { op: "PERIOD_COMPARISON", args: { a: { from: "2026-03-02", to: "2026-03-08" }, b: { from: "2026-03-09", to: "2026-03-15" } } }),
  },
  {
    id: "exit-analysis",
    group: "integro",
    title: "Motivo de saída: pernas × trades, com UNKNOWN e MIXED",
    what: "EXIT_REASON_ANALYSIS: o lado PERNA (valor de cada saída) e o lado TRADE (trade completo, 5 buckets) lado a lado. Há saídas com rótulo desconhecido e trades de saídas mistas.",
    expected: "VALID",
    expectedNote: "Reproduzível. A parcela UNKNOWN e os trades MIXED ficam à vista e rebaixam a confiança (UNKNOWN_EXIT_REASON); nada é descartado.",
    make: (c) => build(c, { op: "EXIT_REASON_ANALYSIS", args: {} }),
  },
  {
    id: "compare-legs",
    group: "integro",
    title: "STOP × TARGET nas pernas",
    what: "EXIT_REASON_COMPARISON_LEGS (unidade LEG): quanto cada motivo de saída rendeu, perna a perna. Não é o P&L do trade.",
    expected: "VALID",
    expectedNote: "Valores atribuídos às próprias pernas (o que o relatório traz por linha); a parcela UNKNOWN entra como limitação.",
    make: (c) => build(c, { op: "EXIT_REASON_COMPARISON_LEGS", args: { a: "STOP", b: "TARGET" } }),
  },
  {
    id: "leg-rank",
    group: "integro",
    title: "Onde as saídas por STOP rendem menos (por hora, pernas)",
    what: "LEG_GROUP_RANKING (unidade LEG): pernas de motivo STOP por hora de entrada, da maior perda para a menor.",
    expected: "VALID",
    expectedNote: "As pernas citadas (tradeId, índice, linhas) são conferidas contra os TradeEvidence no V6.refs.",
    make: (c) => build(c, { op: "LEG_GROUP_RANKING", args: { groupBy: "hour", reason: "STOP" } }),
  },
  {
    id: "small-sample",
    group: "integro",
    title: "Amostra pequena (ranking por motivo de saída do trade)",
    what: "GROUP_RANKING por exitReason com minSample 10: quase todo grupo é LOW/TINY.",
    expected: "VALID",
    expectedNote: "Reproduzível, mas a confiança é UNRELIABLE/LIMITED: grupos TINY ficam listados SEM posição; amostra pequena não vira conclusão.",
    make: (c) => build(c, { op: "GROUP_RANKING", args: { groupBy: "exitReason" }, options: { ...DERIVED_LAB_OPTIONS, minSample: 10 } }),
  },
  {
    id: "unavailable",
    group: "integro",
    title: "Métrica indisponível (R sem stop informado)",
    what: "Ranking por hora de totalR. O CSV não traz stop e o R nunca é inferido: o valor é null com motivo, sem posição.",
    expected: "VALID",
    expectedNote: "Ausência é preservada (value null + reason); o V6 confirma que o recálculo também não tem valor. Nada vira zero.",
    make: (c) => build(c, { op: "GROUP_RANKING", args: { groupBy: "hour", metric: "totalR" } }),
  },
  {
    id: "divergence",
    group: "integro",
    title: "Divergência perna × trade (declarada)",
    what: "Uma perna tem o líquido alterado em +1,00 ANTES de gerar a Evidence (o trade não muda). A análise por motivo é calculada assim mesmo.",
    expected: "VALID",
    expectedNote: "VALID = reproduzível pelo V6. A divergência é DECLARADA no resumo (reconciliation DIVERGENT, confiança UNRELIABLE) e não é corrigida nem escondida. Já o E5b (origem) acusa SOURCE_MISMATCH: o valor da perna alterado não é o que o CSV produz — as duas verificações dizem coisas diferentes.",
    make: (c) => {
      const ts = c.trades.map((x, i) => (i === 3 ? { ...x, trade: (() => { const t = clone(x.trade); t.exitLegs![0].pnl.net = (t.exitLegs![0].pnl.net as number) + 1; return t })() } : x))
      return build(c, { op: "EXIT_REASON_ANALYSIS", args: {} }, { trades: ts })
    },
  },
  {
    id: "forged-value",
    group: "adulteracao",
    title: "Valor do resultado alterado, selo refeito",
    what: "O líquido da primeira linha do ranking sobe 1,00 e o evidenceHash é recalculado. O bundle fica internamente 'selado'.",
    expected: "TAMPERED",
    expectedNote: "V1 passa (selo refeito), mas V6.result recalcula o ranking com a função real e acusa a divergência.",
    make: (c) => edit(build(c, { op: "GROUP_RANKING", args: { groupBy: "hour" } }), (x) => { d0(x).result.rows[0].net.value += 1 }),
  },
  {
    id: "forged-delta",
    group: "adulteracao",
    title: "Delta da comparação alterado, selo refeito",
    what: "O delta do líquido entre as contas é alterado em 0,01 e o selo é refeito.",
    expected: "TAMPERED",
    expectedNote: "V6.derived recalcula delta, razão e contribuições e acusa; V6.result (valores das células) continua PASS — só o derivado foi mexido.",
    make: (c) => edit(build(c, { op: "GROUP_COMPARISON", args: { groupBy: "account", a: { account: "Conta Demo A" }, b: { account: "Conta Demo B" } } }), (x) => { d0(x).result.metrics.find((m: Any) => m.metric === "netPnl").delta += 0.01 }),
  },
  {
    id: "forged-quality",
    group: "adulteracao",
    title: "Divergência escondida (reconciliação declarada como FULL)",
    what: "Mesma análise do cenário de divergência, mas o resumo e o resultado passam a dizer FULL e confiança OK. Selo refeito.",
    expected: "TAMPERED",
    expectedNote: "V6.quality recalcula reconciliação, confiança e limitações: declarar FULL quando o recálculo diz DIVERGENT é adulteração.",
    make: (c) => {
      const ts = c.trades.map((x, i) => (i === 3 ? { ...x, trade: (() => { const t = clone(x.trade); t.exitLegs![0].pnl.net = (t.exitLegs![0].pnl.net as number) + 1; return t })() } : x))
      return edit(build(c, { op: "EXIT_REASON_ANALYSIS", args: {} }, { trades: ts }), (x) => { d0(x).summary.reconciliation = "FULL"; d0(x).summary.confidence = "OK"; d0(x).result.reconciliation.status = "FULL" })
    },
  },
  {
    id: "invalid-ref",
    group: "adulteracao",
    title: "Referência inválida (trade da população inexistente)",
    what: "Um tradeId da população é trocado por um id que não existe no bundle. Selo refeito.",
    expected: "TAMPERED",
    expectedNote: "V6.refs acusa a referência quebrada e o recálculo não é feito sobre uma população quebrada (V6.population/result… ficam SKIPPED).",
    make: (c) => edit(build(c, { op: "GROUP_RANKING", args: { groupBy: "hour" } }), (x) => { d0(x).population.tradeIds[0] = "trd_inexistente" }),
  },
  {
    id: "swapped-dim",
    group: "adulteracao",
    title: "Dimensão trocada (hora → conta), resultado mantido",
    what: "O argumento groupBy do derivado é trocado de hora para conta, mantendo o resultado original. Selo refeito.",
    expected: "TAMPERED",
    expectedNote: "O V6 recalcula a pergunta DECLARADA (por conta) e o resultado guardado (por hora) não bate: V6.result/derived/quality.",
    make: (c) => edit(build(c, { op: "GROUP_RANKING", args: { groupBy: "hour" } }), (x) => { d0(x).query.args.groupBy = "account" }),
  },
  {
    id: "hash-only",
    group: "limite",
    title: "População acima do limite (HASH_ONLY)",
    what: "LEG_GROUP_RANKING com tradeIdsLimit = 3: só o tradeSetHash prova a população; trades e pernas não vão no bundle.",
    expected: "UNVERIFIABLE",
    expectedNote: "V6 fica SKIPPED (S_HASH_ONLY): não dá para recalcular, e isso NÃO é aprovação nem acusação. O E5b diz que não há trades para ligar à fonte.",
    make: (c) => build(c, { op: "LEG_GROUP_RANKING", args: { groupBy: "hour", reason: "STOP" }, options: { ...DERIVED_LAB_OPTIONS, tradeIdsLimit: 3 } }),
  },
  {
    id: "version",
    group: "limite",
    title: "Versão do contrato incompatível",
    what: "A versão da definição do E6.2 declarada no derivado é diferente da atual. Selo refeito.",
    expected: "UNVERIFIABLE",
    expectedNote: "V6.versions: S_VERSION_INCOMPATIBLE. Não é adulteração (a definição pode ter mudado): não dá para reproduzir com este código.",
    make: (c) => edit(build(c, { op: "GROUP_RANKING", args: { groupBy: "hour" } }), (x) => { d0(x).analysis.definitionVersion = "0.0.1" }),
  },
  {
    id: "strategy-dim",
    group: "limite",
    title: "Ranking por estratégia (dimensão sem referência na Evidence)",
    what: "GROUP_RANKING por strategy. A chave sai como strategyRef; a Evidence não carrega a estratégia para recalcular a associação.",
    expected: "UNVERIFIABLE",
    expectedNote: "V6.query: S_ASSOCIATION_UNVERIFIABLE. O resultado existe e é declarado, mas NÃO é confirmado — nunca vira PASS.",
    make: (c) => build(c, { op: "GROUP_RANKING", args: { groupBy: "strategy" } }),
  },
]

export interface DerivedRun {
  scenario: DerivedScenario
  bundle: unknown
  /** O mesmo bundle, tipado (null se não passa no schema). */
  parsed: EvidenceBundle | null
  report: VerifyReport
  /** E5b sobre o MESMO bundle e o CSV sintético (independente do V6). */
  source: SourceVerifyReport
  matchesContract: boolean
}

export function runDerivedScenario(c: DerivedLabContext, scenario: DerivedScenario): DerivedRun {
  assertEvidenceLabEnabled()
  const bundle = scenario.make(c)
  const report = verifyEvidence(bundle)
  const source = verifyEvidenceSource(bundle, { [c.importRecord.importId]: c.bytes })
  const p = EvidenceBundleSchema.safeParse(bundle)
  return { scenario, bundle, parsed: p.success ? p.data : null, report, source, matchesContract: report.status === scenario.expected }
}

export function runAllDerivedScenarios(c: DerivedLabContext): DerivedRun[] {
  assertEvidenceLabEnabled()
  return DERIVED_SCENARIOS.map((s) => runDerivedScenario(c, s))
}

export { redactLabels } from "./redact-view.ts"

// ── textos legíveis (PT) ─────────────────────────────────────────────────────

export const V6_HELP: Record<string, string> = {
  "V6.versions": "O contrato do E6.2 (versão da definição, schema) e o motor declarados são os deste código? Se não, não dá para reproduzir (não é adulteração).",
  "V6.query": "A operação, a unidade, os argumentos, as opções e os filtros são válidos? As dimensões pedidas existem na Evidence para serem recalculadas?",
  "V6.refs": "Os trades da população e as pernas citadas existem no bundle e são coerentes (índice, linhas de origem, FULL × HASH_ONLY)?",
  "V6.population": "O tradeSetHash refeito dos TradeEvidence é o declarado? Os filtros verificáveis foram respeitados?",
  "V6.result": "Grupos, chaves e VALORES: a função real do E6.2, rodada de novo sobre os trades do bundle, dá o mesmo resultado?",
  "V6.derived": "Deltas, razões, contribuições, posições (ranking) e participações recalculados batem?",
  "V6.quality": "Amostra, cobertura, sampleFlag, confiança, limitações, reconciliação perna×trade, resumo e referências de pernas batem com o recálculo?",
  "V6.determinism": "Rodar o recálculo duas vezes dá o mesmo resultado (sem relógio nem acaso)?",
}

export const CODE_HELP: Record<string, string> = {
  S_NOT_APPLICABLE: "Não se aplica a este bundle (não impede VALID).",
  S_HASH_ONLY: "População acima do limite: os trades não estão no bundle; só o tradeSetHash. Não dá para recalcular — e isso não é aprovação.",
  S_VERSION_INCOMPATIBLE: "Versão do contrato/motor diferente da atual: não é adulteração, não dá para reproduzir com este código.",
  S_ASSOCIATION_UNVERIFIABLE: "Dimensão ou filtro sem referência na Evidence (estratégia, setup, timeframe, sessão): o resultado não pode ser recalculado.",
  S_REFS_BROKEN: "Referências quebradas: o recálculo não é feito sobre uma população inconsistente.",
  S_QUERY_INVALID: "Consulta declarada inválida: nada a recalcular.",
  S_FORMAT_INVALID: "Formato inválido (V0): nada além do formato foi executado.",
  V_DERIVED_VERSION_UNKNOWN: "Versão desconhecida.",
  V_DERIVED_QUERY_INVALID: "Operação/argumentos/opções/filtros inválidos ou incoerentes (inclui unidade ≠ operação).",
  V_DERIVED_REF_MISSING: "Referência a trade ou perna que não existe, ou população incoerente.",
  V_TRADESET_HASH_MISMATCH: "O tradeSetHash declarado não é o dos TradeEvidence do bundle.",
  V_DERIVED_RESULT_MISMATCH: "Valores/grupos/chaves do resultado diferem do recálculo: resultado ADULTERADO.",
  V_DERIVED_DERIVATION_MISMATCH: "Delta, razão, contribuição ou posição diferem do recálculo: resultado ADULTERADO.",
  V_DERIVED_QUALITY_MISMATCH: "Amostra, cobertura, confiança, limitações ou reconciliação diferem do recálculo: resultado ADULTERADO.",
  V_DERIVED_NONDETERMINISTIC: "O recálculo não é determinístico.",
  V_SEAL_MISMATCH: "O evidenceHash não bate com o conteúdo.",
}

export const LIMITATION_HELP: Record<string, string> = {
  SAMPLE_TINY: "Amostra minúscula (menos de 3): não entra na numeração do ranking.",
  SAMPLE_LOW: "Amostra baixa (abaixo de minSample): ordem descritiva, não conclusiva.",
  METRIC_UNAVAILABLE: "A métrica não tem valor neste grupo (por exemplo, R sem stop informado).",
  COVERAGE_PARTIAL: "Só parte dos trades/pernas tem o valor (veja a cobertura).",
  UNKNOWN_GROUP: "Grupo 'desconhecido' (atributo ausente): listado, não descartado.",
  UNKNOWN_EXIT_REASON: "Há saídas de motivo desconhecido (rótulo fora das regras): leitura dos motivos conhecidos é parcial. Desconhecido ≠ sem stop.",
  TRADES_WITHOUT_LEGS: "Há trades sem pernas (trade-linha): fora do lado das pernas.",
  RECONCILIATION_DIVERGENT: "A soma das pernas diverge do total do trade: divergência declarada, não corrigida.",
  RECONCILIATION_PARTIAL: "Parte dos trades não pôde ser comparada perna × trade.",
  GROUP_NOT_FOUND: "O grupo pedido não existe: nenhuma observação foi inventada.",
  PERIOD_EMPTY: "Período sem trades.",
  PERIODS_OVERLAP: "Os dois períodos se sobrepõem.",
}

export const UNIT_HELP: Record<string, string> = {
  TRADE: "Valores calculados sobre o TRADE completo (o P&L inteiro do trade, no grupo a que ele pertence).",
  LEG: "Valores atribuídos às PERNAS de saída (o que cada saída trouxe, como o relatório traz por linha). Não é o P&L do trade.",
  TRADE_AND_LEG: "Duas seções separadas e rotuladas: PERNAS (valor de cada saída) e TRADES (trade completo). Não se somam entre si.",
}
