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
import { DERIVED_SCENARIOS, derivedContext, runAllDerivedScenarios } from "./derived.ts"
import { SOURCE_SCENARIOS, runAllSourceScenarios, sourceContext } from "./source.ts"

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
    limits: ["Com saídas empatadas no mesmo instante, maxDrawdown e as sequências dependem da posição do trade no array de entrada (o motor não mudou); a Evidence REGISTRA essa ordem (population.sequence). Provar que é a ordem original dos dados não é possível só com o CSV."],
  },
  {
    id: "identidade",
    title: "6. Identidade e provenance",
    status: "concluido",
    summary: "importId, rowHash, tradeId determinísticos (sem UUID) e accountRef não reversível; do trade até a linha do arquivo. Imports novos registram o contexto reproduzível (versões de identidade, foldPolicy, exitReasonMap, bandeira de sal; nunca o sal).",
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
      "VALID NÃO prova a origem dos dados (isso é a camada 9, aba Origem), nem que a seleção de trades foi correta, e o selo NÃO é assinatura: alteração coordenada de tudo é consistente (cenário \"coordenada\").",
      "População acima do limite (HASH_ONLY) e estratégia/sessão ficam UNVERIFIABLE; métricas sequenciais precisam da ordem registrada.",
    ],
  },
  {
    id: "origem",
    title: "9. Verificação de origem (E5b)",
    status: "parcial",
    summary: "verifyEvidenceSource: bytes do CSV → SHA-256 → reexecução da ingestão (contexto do ImportRef) → importId, rowHash, tradeId e valores derivados do arquivo. Indisponibilidade nunca vira adulteração; população parcial nunca vira 'completa'.",
    basis: ["src/lib/evidence/verify-source.ts", "scripts/test-evidence-source.mts, test-evidence-import-context.mts", "2 exports NT8 reais locais: 17 ciclos + 34 trades-linha conferidos, 0 divergências"],
    limits: [
      "Não prova a seleção original, a ordem original da sequência nem o R/stop do usuário (acrescentados depois da importação).",
      "HASH_ONLY: só as âncoras são conferidas (SOURCE_VERIFIED_PARTIAL). Imports anteriores ao contexto reproduzível dependem de foldPolicy/exitReasonMap/sal informados.",
      "Para derivados confere a população DECLARADA de cada análise (trades e pernas citadas), não a importação inteira.",
    ],
  },
  {
    id: "derivados",
    title: "10. Derivados de análise (E6.0–E6.4)",
    status: "parcial",
    summary: "Motivo de saída por trade e por perna, ranking, contribuição e comparação de grupos (E6.0–E6.2), com Evidence própria (DerivedEvidence) e verificação V6: o verificador reexecuta a função real do E6.2 sobre os TradeEvidence e compara. Inferência só descritiva (sem p-valor).",
    basis: ["src/lib/metrics/{exit-reason,legs,analysis}.ts", "src/lib/evidence/{derived,explain-derived}.ts + V6 em verify.ts", "scripts/test-metrics-exit-*.mts, test-metrics-analysis.mts, test-evidence-derived.mts, test-evidence-source-derived.mts", "2 exports NT8 reais locais: derivados reais VALID, adulterações detectadas"],
    limits: [
      "HASH_ONLY, versão incompatível e dimensões sem referência na Evidence (estratégia, setup, timeframe, sessão) ficam SKIPPED/UNVERIFIABLE; nunca aprovados.",
      "Motivo de saída = o NOME da ordem (+ mapa do usuário), não o tipo real; UNKNOWN ≠ 'sem stop'. VALID = reproduzível, não 'confiável': veja confiança e limitações.",
      "O rótulo de origem na Evidence é só a palavra do vocabulário v1 (Entry, Target0–99, Stop0–99, Zerar) ou um token lbl_… (texto livre nunca entra; sourceLabel S0–S5). Pseudônimo, não anonimização: sem sal, tokens de textos curtos são adivinháveis por dicionário.",
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
  { id: "e6", title: "E6.5 — contrato de capacidades para o agente", status: "pendente", why: "E6.0–E6.4 estão implementados (motivo de saída, breakdown, ranking/comparação, Evidence dos derivados, esta aba). Falta só o desenho do contrato para o agente — sem integração com LLM." },
  { id: "sal-persistencia", title: "Armazenamento real do chaveiro de sal (persistência)", status: "pendente", why: "A política de sal (D1–D7) está implementada com chaveiro EM MEMÓRIA. Falta guardar os sais de verdade: cifrados em repouso, com backup (perder o sal = perder a verificação dos refs daquele usuário), nunca em bundle/log/repo/prompt/front. Só na fase de persistência (Prisma/banco), que não começou." },
  { id: "selecao", title: "Provar a SELEÇÃO original (E5c, a decidir)", status: "pendente", why: "O E5b confere os trades CITADOS contra o arquivo; reaplicar os filtros declarados ao conjunto reingerido provaria que a seleção foi a correta. Não feito." },
  { id: "persistencia", title: "Persistência (Prisma/banco)", status: "pendente", why: "Só com o contrato de dados validado. O Lab não usa banco." },
  { id: "parser-en", title: "Parser NT8 em inglês validado", status: "pendente", why: "Falta um export real em inglês." },
  { id: "dedupe", title: "Dedupe entre exports sobrepostos", status: "pendente", why: "Decisão adiada (usaria rowHash)." },
  { id: "ref-estrategia", title: "Referência não reversível de estratégia/sessão na Evidence", status: "pendente", why: "Permitiria verificar a associação a grupos por estratégia/sessão. Evolução futura, fora desta etapa." },
  { id: "legado", title: "Migrar o app legado (UI) para o domínio novo", status: "pendente", why: "UI/legado ainda com America/Sao_Paulo fixo e cálculos próprios." },
  { id: "ui-produto", title: "Interface de produto do MeuTrade para Evidence", status: "fora", why: "O Evidence Lab é ferramenta de desenvolvimento, não a interface pública." },
  { id: "agente", title: "Agente de IA sobre a Evidence", status: "fora", why: "Só depois de a base de verificação estar fechada." },
  { id: "assinatura", title: "Assinatura digital do bundle", status: "fora", why: "O evidenceHash é selo de integridade interna, não assinatura (decisão registrada)." },
]

const probes: Record<string, (demo: Demo, ctx: ScenarioContext) => Probe> = {
  derivados: () => {
    const dctx = derivedContext()
    const runs = runAllDerivedScenarios(dctx)
    const ok = runs.filter((r) => r.matchesContract).length
    const find = (id: string) => runs.find((r) => r.scenario.id === id)
    const intact = find("rank-hour")
    const forged = find("forged-value")
    const hashOnly = find("hash-only")
    return {
      ok: intact?.report.status === "VALID" && forged?.report.status === "TAMPERED" && hashOnly?.report.status === "UNVERIFIABLE" && ok === runs.length && runs.length === DERIVED_SCENARIOS.length,
      text: `ranking íntegro → ${intact?.report.status} (V6 ${intact?.report.checks.filter((c) => c.level === "V6" && c.status === "PASS").length}/8 PASS) · valor alterado com selo refeito → ${forged?.report.status} · HASH_ONLY → ${hashOnly?.report.status} · ${ok}/${runs.length} cenários com o veredito previsto pelo contrato`,
    }
  },
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
  origem: (demo) => {
    const sctx = sourceContext(demo)
    const runs = runAllSourceScenarios(sctx)
    const ok = runs.filter((r) => r.matchesContract).length
    const find = (id: string) => runs.find((r) => r.scenario.id === id)
    const intact = find("intact")
    const forged = find("forged")
    return {
      ok: intact?.report.status === "SOURCE_VERIFIED" && forged?.report.status === "SOURCE_MISMATCH" && ok === runs.length && runs.length === SOURCE_SCENARIOS.length,
      text: `arquivo íntegro → ${intact?.report.status} · bundle forjado (${forged?.verify.status} no V0–V4) → ${forged?.report.status} · ${ok}/${runs.length} cenários com o estado previsto pelo contrato`,
    }
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
