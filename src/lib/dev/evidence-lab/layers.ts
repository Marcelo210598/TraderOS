// Visão geral do Evidence Lab: as camadas da fundação com ESTADO e uma SONDA AO VIVO por camada.
// O estado de cada camada é declarado aqui, com a base (arquivos/testes) que o sustenta; a sonda roda o código real agora e mostra
// o fato observado. Se uma sonda falha, a camada aparece como "sonda falhou" — nunca com selo de concluído. Nada fica verde por texto.

import { CanonicalTradeSchema } from "../../domain/canonical.ts"
import { DEFAULT_ANALYSIS_TIME_ZONE } from "../../domain/time.ts"
import { EVIDENCE_SCHEMA, computeEvidenceHash } from "../../evidence/hash.ts"
import { EvidenceBundleSchema } from "../../evidence/schema.ts"
import { RECONSTRUCTION_VERSION } from "../../ingest/reconstruct.ts"
import { DEFINITION_VERSION, ENGINE_VERSION, METRIC_IDS, calculateMetrics } from "../../metrics/index.ts"
import { verifyEvidence } from "../../evidence/verify.ts"
import { runAllScenarios, type Demo, type ScenarioContext } from "./model.ts"

export type LayerStatus = "concluido" | "parcial" | "pendente" | "fora"

export const STATUS_LABEL: Record<LayerStatus, string> = {
  concluido: "Concluído",
  parcial: "Parcialmente verificável",
  pendente: "Pendente",
  fora: "Fora de escopo",
}

export const STATUS_MEANING: Record<LayerStatus, string> = {
  concluido: "Implementado e coberto por testes (incluindo as fixtures reais quando existem). Pode ter limitação documentada.",
  parcial: "Existe e funciona, mas parte do que ele deveria provar NÃO é verificável hoje. A limitação está dita no texto.",
  pendente: "Planejado ou decidido, ainda não implementado (ou não validado).",
  fora: "Fora do escopo desta fundação (decisão explícita).",
}

export interface Layer {
  id: string
  title: string
  status: LayerStatus
  summary: string
  /** O que sustenta o estado (arquivos e testes). */
  basis: string[]
  /** O que NÃO está coberto. */
  limits: string[]
}

interface Probe {
  ok: boolean
  text: string
}

export interface LayerView extends Layer {
  probe: Probe | null
}

export const LAYERS: Layer[] = [
  {
    id: "ingestao",
    title: "1. Ingestão e normalização",
    status: "parcial",
    summary: "CSV da plataforma → linhas aceitas/rejeitadas → trades normalizados (parser NT8 PT-BR com fuso, formato numérico e ordem de data explícitos).",
    basis: ["src/lib/ingest/ (csv, parsers, normalizer, validator, pipeline)", "scripts/test-ingest-*.mts", "2 exports NT8 PT-BR reais validados localmente"],
    limits: ["Parser em inglês existe, mas NÃO foi validado com export real.", "Só NinjaTrader: outras plataformas não têm parser."],
  },
  {
    id: "canonical",
    title: "2. Canonical Trade",
    status: "concluido",
    summary: "Modelo único do trade (canonical-trade/2): tempo com fuso, P&L bruto/líquido/comissão, risco e R, MFE/MAE, proveniência por campo.",
    basis: ["src/lib/domain/canonical.ts", "docs/ai-partner/data-contract.md §1–§10", "scripts/test-domain-*.mts"],
    limits: ["Order/Fill/Trade são entidades separadas no contrato; só Trade é consumido pelas métricas."],
  },
  {
    id: "reconstrucao",
    title: "3. Reconstrução de ciclos NT8",
    status: "concluido",
    summary: "Linhas de execução → ciclos de posição (scale-in/out), com confiança, completude de borda e ambiguidades registradas — nunca descartadas.",
    basis: ["src/lib/ingest/reconstruct.ts", "scripts/test-recon-core.mts, test-recon-integration.mts"],
    limits: ["Ciclo de borda (início/fim do período) é sinalizado como não verificável.", "A posição é da ESTRATÉGIA, não da conta (o relatório não permite mais)."],
  },
  {
    id: "timezones",
    title: "4. Timezones",
    status: "concluido",
    summary: "Fuso de origem, de análise e de mercado separados; sessão e dia de pregão pelo calendário CME; fuso da análise explícito e ecoado.",
    basis: ["src/lib/domain/time.ts", "scripts/test-domain-time.mts, test-timezone-universal.mts"],
    limits: ["O app legado (UI) ainda usa America/Sao_Paulo fixo em src/lib/date.ts e analytics-insights.ts — migração pendente (abaixo)."],
  },
  {
    id: "metricas",
    title: "5. Métricas determinísticas",
    status: "concluido",
    summary: "Motor puro, sem banco: aritmética em inteiros escalados, população/cobertura/qualidade em cada número, filtros, grupos e trace dos contribuintes.",
    basis: ["src/lib/metrics/", "scripts/test-metrics-*.mts (oráculo à mão)", "scripts/test-real-nt8-metrics.mts"],
    limits: ["Com saídas empatadas no mesmo instante, maxDrawdown e as sequências dependem da ORDEM de entrada dos dados (achado do E5.2; correção exigiria mudar resultados)."],
  },
  {
    id: "identidade",
    title: "6. Identidade e provenance",
    status: "concluido",
    summary: "importId, rowHash, tradeId determinísticos (sem UUID) e accountRef não reversível; do trade até a linha do arquivo.",
    basis: ["src/lib/ingest/identity.ts", "src/lib/infra/hash.ts", "scripts/test-evidence-identity.mts"],
    limits: ["O id é por import: mesmo arquivo importado 2× gera ids repetidos (Evidence recusa: E_DUPLICATE_TRADE_ID). Dedupe entre exports NÃO decidido."],
  },
  {
    id: "evidence",
    title: "7. Evidence (evidence/1)",
    status: "concluido",
    summary: "TradeEvidence → SourceRowRef → ImportRef e MetricEvidence com contribuintes; bundle selado com evidenceHash; privacidade de conta fail-closed.",
    basis: ["src/lib/evidence/ (schema, explain-trade, explain-metric, hash, redact)", "scripts/test-evidence-schema|explain-*.mts", "docs/ai-partner/data-contract.md §14"],
    limits: ["Estratégia e sessão não têm referência na Evidence.", "Alguns sub-schemas reaproveitados do Canonical não são strict (o verificador V0 compensa)."],
  },
  {
    id: "verificacao",
    title: "8. Verificação V0–V4",
    status: "parcial",
    summary: "verifyEvidence: formato, selo, referências, população (tradeSetHash) e métricas recalculadas pelo MESMO motor. VALID só quando tudo que se aplica passa.",
    basis: ["src/lib/evidence/verify.ts", "scripts/test-evidence-verify.mts, test-evidence-verify-math.mts", "5.274 bundles reais locais sem falso positivo"],
    limits: [
      "VALID NÃO prova a origem dos dados (CSV original = E5b), nem que a seleção de trades foi correta, e o selo NÃO é assinatura: alteração coordenada de tudo é consistente (cenário \"coordenada\").",
      "População acima do limite (HASH_ONLY), estratégia/sessão e métricas dependentes de ordem em empates ficam UNVERIFIABLE.",
    ],
  },
]

export interface Pending {
  id: string
  title: string
  status: Extract<LayerStatus, "pendente" | "fora">
  why: string
}

export const PENDING: Pending[] = [
  { id: "e5b", title: "E5b — verificação contra o CSV original", status: "pendente", why: "Reexecutar a ingestão e comparar fileSha256, importId, rowHash e tradeId: única prova de origem. Aprovado para depois." },
  { id: "e53", title: "E5.3 — validação final e documentação do verificador", status: "pendente", why: "Aguarda a revisão do E5.2 e do Lab." },
  { id: "e6", title: "E6 — grupos/comparações e motivo de saída (G6)", status: "pendente", why: "Depois do E5." },
  { id: "persistencia", title: "Persistência (Prisma/banco)", status: "pendente", why: "Só com o contrato de dados validado. O Lab não usa banco." },
  { id: "parser-en", title: "Parser NT8 em inglês validado", status: "pendente", why: "Falta um export real em inglês." },
  { id: "dedupe", title: "Dedupe entre exports sobrepostos", status: "pendente", why: "Decisão adiada (usaria rowHash)." },
  { id: "ordem", title: "Desempate determinístico de saídas empatadas", status: "pendente", why: "Mudaria resultados de maxDrawdown/sequências em trades-linha; exige decisão (ou registrar a ordem na Evidence)." },
  { id: "ref-estrategia", title: "Referência não reversível de estratégia/sessão na Evidence", status: "pendente", why: "Permitiria verificar a associação a grupos por estratégia/sessão. Evolução futura, fora desta etapa." },
  { id: "legado", title: "Migrar o app legado (UI) para o domínio novo", status: "pendente", why: "UI/legado ainda com America/Sao_Paulo fixo e cálculos próprios." },
  { id: "ui-produto", title: "Interface de produto do MeuTrade para Evidence", status: "fora", why: "O Evidence Lab é ferramenta de desenvolvimento, não a interface pública." },
  { id: "agente", title: "Agente de IA sobre a Evidence", status: "fora", why: "Só depois de a base de verificação estar fechada." },
  { id: "assinatura", title: "Assinatura digital do bundle", status: "fora", why: "O evidenceHash é selo de integridade interna, não assinatura (decisão registrada)." },
]

const probes: Record<string, (demo: Demo, ctx: ScenarioContext) => Probe> = {
  ingestao: (demo) => ({ ok: demo.rowsRejected === 0 && demo.rowsRead > 0, text: `CSV sintético: ${demo.rowsRead} linhas lidas, ${demo.rowsRejected} rejeitadas · parser ${demo.importRecord.parserId}@${demo.importRecord.parserVersion}` }),
  canonical: (demo) => {
    const passed = demo.trades.filter((t) => CanonicalTradeSchema.safeParse(t).success).length
    return { ok: passed === demo.trades.length, text: `${passed}/${demo.trades.length} trades passam no schema ${demo.trades[0]?.schemaVersion}` }
  },
  reconstrucao: (demo) => {
    const amb = demo.trades.filter((t) => (t.reconstruction?.ambiguities.length ?? 0) > 0).length
    const edges = demo.trades.filter((t) => t.reconstruction && t.reconstruction.completeness !== "VERIFIED").length
    return { ok: demo.cycles > 0, text: `${demo.rowsRead} linhas → ${demo.cycles} ciclos · ${amb} com ambiguidade registrada · ${edges} com borda não verificável · ${demo.importRecord.reconstructionMethod}@${RECONSTRUCTION_VERSION}` }
  },
  timezones: (demo) => ({ ok: true, text: `fuso da análise ${DEFAULT_ANALYSIS_TIME_ZONE} · fuso de origem do demo ${demo.importRecord.settings.sourceTz} (${demo.importRecord.settings.sourceTzOrigin})` }),
  metricas: (demo) => {
    const normal = calculateMetrics(demo.analytics)
    return { ok: normal.population.afterFilters === demo.cycles, text: `${METRIC_IDS.length} métricas · ${ENGINE_VERSION} · definição v${DEFINITION_VERSION} · população ${normal.population.afterFilters} · tradeSetHash ${normal.population.tradeSetHash.slice(0, 12)}…` }
  },
  identidade: (demo) => {
    const withId = demo.trades.filter((t) => t.tradeId && t.importId).length
    const rows = demo.tradeEvidence.every((t) => t.sourceRows.every((r) => r.rowHash?.length === 64))
    return { ok: withId === demo.trades.length && rows, text: `${withId}/${demo.trades.length} trades com tradeId+importId · rowHash em todas as linhas: ${rows ? "sim" : "não"} · importId ${demo.importRecord.importId.slice(0, 16)}…` }
  },
  evidence: (_demo, ctx) => {
    const parsed = EvidenceBundleSchema.safeParse(ctx.base)
    const sealOk = computeEvidenceHash(ctx.base) === ctx.base.evidenceHash
    return { ok: parsed.success && sealOk, text: `${EVIDENCE_SCHEMA}: bundle de "${ctx.base.subject.id}" ${parsed.success ? "passa no schema estrito" : "FORA do schema"} · selo recalculado ${sealOk ? "confere" : "NÃO confere"} · ${ctx.base.evidence.trades.length} TradeEvidence` }
  },
  verificacao: (_demo, ctx) => {
    const intact = verifyEvidence(ctx.base)
    const runs = runAllScenarios(ctx)
    const ok = runs.filter((r) => r.matchesContract).length
    const levels = ["V0", "V1", "V2", "V3", "V4"].map((l) => `${l}:${intact.checks.filter((c) => c.level === l && c.status === "PASS").length}/${intact.checks.filter((c) => c.level === l).length}`).join(" ")
    return { ok: intact.status === "VALID" && ok === runs.length, text: `bundle íntegro → ${intact.status} (PASS por nível ${levels}) · ${ok}/${runs.length} cenários de adulteração com o resultado previsto pelo contrato` }
  },
}

export function layerViews(demo: Demo, ctx: ScenarioContext): LayerView[] {
  return LAYERS.map((l) => {
    let probe: Probe | null = null
    try {
      probe = probes[l.id](demo, ctx)
    } catch (e) {
      probe = { ok: false, text: `sonda falhou: ${e instanceof Error ? e.message : "erro"}` }
    }
    return { ...l, probe }
  })
}
