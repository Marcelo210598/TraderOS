// Schema `evidence/1` (E2): FORMATO da Evidence. Ainda não há geradores (E3 explainTrade · E4 explainMetric · E5 verifyEvidence).
//   Claim → MetricEvidence → population.tradeIds → TradeEvidence → SourceRowRef → ImportRef
// Evidence NÃO é segunda fonte de verdade: não copia o CSV (só referências + valores já canônicos) e todo objeto é `strict`,
// então campos não previstos — em especial `account.sourceName` — são REJEITADOS em vez de passarem em silêncio.

import { z } from "zod"
import {
  EntryLegSchema,
  ExitLegSchema,
  ExitReasonSchema,
  ExitSummarySchema,
  ImportRecordSchema,
  ReproducibilitySchema,
  IssueSchema,
  PnlSchema,
  ReconstructionSchema,
  RiskReasonSchema,
  RNetReasonSchema,
  TimeValueSchema,
} from "../domain/canonical.ts"
import { CONTRIBUTOR_ROLES } from "../metrics/trace.ts"
import { EVIDENCE_SCHEMA } from "./hash.ts"
import { isProjectedLabel } from "./label-vocab.ts"

export { EVIDENCE_SCHEMA }

/** ImportRecord (E1) + `importedAt`, que quem persiste preenche. FORA do hash. */
/**
 * Rótulo de ordem NA EVIDENCE (S2 do plano do sourceLabel): null, vazio, palavra do vocabulário v1 ou token `lbl_<24 hex>`. Texto livre é
 * INVALID_FORMAT no V0 — a garantia é do schema, não de convenção (vale mesmo com o selo refeito).
 */
export const ProjectedLabelSchema = z.string().nullable().refine((v) => isProjectedLabel(v), { message: "rótulo de ordem fora do vocabulário v1 e que não é um token lbl_<24 hex>" })
export const EntryLegEvidenceSchema = EntryLegSchema.extend({ sourceLabel: ProjectedLabelSchema })
export const ExitLegEvidenceSchema = ExitLegSchema.extend({ sourceLabel: ProjectedLabelSchema })

export const PATTERN_REF_RE = /^pat_[0-9a-f]{24}$/
/**
 * Contexto reproduzível NA EVIDENCE (S2b): igual ao do ImportRecord, EXCETO o mapa de motivos do usuário — lá o padrão (regex escrito pelo
 * usuário, pode embutir texto livre) fica em claro; aqui só `patternRef` (+ motivo). O regex fica só no ImportRecord interno; quem verifica a
 * origem (E5b) recebe o mapa do chamador e o confere pelos `patternRef`.
 */
export const ReproducibilityEvidenceSchema = ReproducibilitySchema.extend({
  exitReasonMap: z.array(z.object({ patternRef: z.string().regex(PATTERN_REF_RE), reason: ExitReasonSchema }).strict()),
})
export const ImportRefSchema = ImportRecordSchema.extend({
  reproducibility: ReproducibilityEvidenceSchema.optional(),
  importedAt: z.string().nullable().optional(),
  /** Versão do vocabulário de rótulos de ordem com que esta Evidence foi projetada (fora do importId). Ausente = 1. Versão ≠ da atual ⇒ o verificador de origem diz UNVERIFIABLE (S_VERSION_INCOMPATIBLE), não adulteração. */
  labelVocab: z.number().int().positive().optional(),
}).strict()
export type ImportRef = z.infer<typeof ImportRefSchema>

/**
 * Referência à linha da fonte: (importId, rowNo, rowHash) a identifica e prova o conteúdo; o resto são os valores que a conta usa.
 * `detail`: FULL = linha de ciclo (valores crus completos, vindos de `sourceRows`) · TRADE_VALUES = trade-linha, onde só existem
 * os valores do próprio trade (rótulos, MAE/MFE/ETD crus e acumulado ficam null — não foram guardados, não são inventados).
 * `rowHash` null = linha sem hash (proveniência INCOMPLETE).
 */
export const SourceRowRefSchema = z
  .object({
    importId: z.string(),
    rowNo: z.number().int(),
    rowHash: z.string().nullable(),
    detail: z.enum(["FULL", "TRADE_VALUES"]),
    entryLeg: z.number().int().nullable(),
    exitLeg: z.number().int().nullable(),
    quantity: z.number(),
    entryLabel: ProjectedLabelSchema,
    exitLabel: ProjectedLabelSchema,
    entryPrice: z.number(),
    exitPrice: z.number(),
    reportedProfit: z.number().nullable(),
    commission: z.number().nullable(),
    fees: z.number().nullable(),
    /** MAE/MFE/ETD CRUS da linha (US$ total da linha). NÃO somar. */
    maeUsd: z.number().nullable(),
    mfeUsd: z.number().nullable(),
    etdUsd: z.number().nullable(),
    bars: z.number().nullable(),
    cumulativeNetReported: z.number().nullable(),
  })
  .strict()
export type SourceRowRef = z.infer<typeof SourceRowRefSchema>

/**
 * Reconstrução como aparece na Evidence: igual à do Canonical, EXCETO a chave do ciclo — lá `cycleKey.account` é o nome da conta
 * em claro; aqui vira `accountRef`; `cycleKey.strategy` (nome da estratégia) vira `strategyRef` (E6.0). Sem isso o nome vazaria por dentro da reconstrução.
 */
export const ReconstructionEvidenceSchema = ReconstructionSchema.extend({
  /** Versão do algoritmo que reconstruiu o ciclo (do ImportRecord). */
  version: z.string(),
  cycleKey: z.object({ accountRef: z.string().nullable(), contract: z.string(), strategyRef: z.string().nullable(), direction: z.enum(["LONG", "SHORT"]) }).strict(),
}).strict()
export type ReconstructionEvidence = z.infer<typeof ReconstructionEvidenceSchema>

const ExcursionReasonSchema = z.enum(["NOT_PROVIDED", "UNIT_UNKNOWN", "POINT_VALUE_UNKNOWN", "NOT_A_NUMBER"])

/** Excursões como estão no Canonical (nada reinterpretado, nada somado). `null` = ausente na origem. `origin` diz se é nativo ou INFERIDO. */
export const ExcursionsEvidenceSchema = z
  .object({
    mfePoints: z.number().nullable(),
    maePoints: z.number().nullable(),
    mfeReason: ExcursionReasonSchema.nullable(),
    maeReason: ExcursionReasonSchema.nullable(),
    highPrice: z.number().nullable(),
    lowPrice: z.number().nullable(),
    conflict: z.boolean().nullable(),
    origin: z.enum(["SOURCE_ROW", "RECONSTRUCTED_NT8_ROWS", "NONE"]).nullable(),
  })
  .strict()
export type ExcursionsEvidence = z.infer<typeof ExcursionsEvidenceSchema>

/** Proveniência do trade: completa (tradeId + importId + rowHash) ou não. Trade sem identidade NUNCA se passa por rastreável. */
export const ProvenanceSchema = z.enum(["COMPLETE", "INCOMPLETE"])

export const TradeEvidenceSchema = z
  .object({
    tradeId: z.string(),
    importId: z.string(),
    provenance: ProvenanceSchema,
    granularity: z.enum(["POSITION_CYCLE", "SOURCE_ROW"]),
    /** Fingerprint não reversível da conta. NÃO existe `sourceName` aqui. */
    accountRef: z.string().nullable(),
    instrument: z.object({ raw: z.string(), root: z.string().nullable() }).strict(),
    direction: z.enum(["LONG", "SHORT"]),
    quantity: z.number(),
    peakQuantity: z.number().nullable(),
    entry: z.object({ at: TimeValueSchema, price: z.number() }).strict(),
    exit: z.object({ at: TimeValueSchema, price: z.number() }).strict(),
    pnl: PnlSchema.strict(),
    /**
     * R do Canonical, COPIADO (nunca recalculado): `net` = P&L líquido ÷ risco em US$; `points` = R em pontos, sem custos.
     * `netReason` = por que `net` é null. Existe para a verificação (E5) poder reconstruir o fingerprint e as métricas de R.
     */
    r: z.object({ net: z.number().nullable(), netReason: RNetReasonSchema.nullable(), points: z.number().nullable() }).strict(),
    /** Só o motivo pelo qual o risco não existe (STOP_MISSING…), copiado do Canonical. Stop/alvo/risco em si NÃO entram na Evidence. */
    risk: z.object({ reason: RiskReasonSchema.nullable() }).strict(),
    /** Pontos POR CONTRATO, com sinal (+ = a favor), copiado do Canonical. Base de totalPoints/averagePoints. */
    pointsPerContract: z.number().finite(),
    entryLegs: z.array(EntryLegEvidenceSchema).nullable(),
    exitLegs: z.array(ExitLegEvidenceSchema).nullable(),
    exitSummary: ExitSummarySchema.nullable(),
    reconstruction: ReconstructionEvidenceSchema.nullable(),
    excursions: ExcursionsEvidenceSchema,
    issues: z.array(IssueSchema),
    fieldProvenance: z.record(z.string(), z.enum(["FILE", "INFERRED", "DERIVED", "ABSENT"])),
    sourceRows: z.array(SourceRowRefSchema),
  })
  .strict()
export type TradeEvidence = z.infer<typeof TradeEvidenceSchema>

const MetricPopulationSchema = z
  .object({
    inputTrades: z.number().int(),
    afterFilters: z.number().int(),
    /** SHA-256 da população COMPLETA (não depende do limite de `tradeIds`). */
    tradeSetHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** Até `tradeIdsLimit`; acima disso null e vale o hash. */
    tradeIds: z.array(z.string()).nullable(),
    filterReport: z.record(z.string(), z.unknown()),
    provenance: z.object({ withIdentity: z.number().int(), withoutIdentity: z.number().int() }).strict(),
    /**
     * Ordem em que o motor percorreu a população nas métricas sequenciais (drawdown, sequências), COPIADA do trace — nunca recalculada.
     * `dependent` = a métrica depende da ordem · `order` = tradeIds da população INTEIRA nessa ordem (instante de saída; empate → ordem
     * de entrada dos dados, que só esta lista registra). `order` é null quando a métrica não é sequencial OU a população é HASH_ONLY
     * (a ordem completa não está no bundle e não se alega tê-la verificado). O `tradeSetHash` continua independente da ordem.
     */
    sequence: z.object({ dependent: z.boolean(), order: z.array(z.string()).nullable() }).strict(),
  })
  .strict()

export const ContributorRoleSchema = z.enum(CONTRIBUTOR_ROLES)

export const ContributorSchema = z.object({ tradeId: z.string(), role: ContributorRoleSchema, rank: z.number().int().optional() }).strict()

/**
 * Quem contribuiu para o número, EXATAMENTE como o trace do motor registrou (nada reinterpretado).
 * `applicable: false` = a métrica não tem conjunto natural de contribuintes (totalTrades, medianR…); `complete: false` = população acima
 * do limite: `items` traz só as âncoras e `roleCounts` continua completo.
 */
export const ContributorsEvidenceSchema = z
  .object({
    applicable: z.boolean(),
    complete: z.boolean(),
    roleCounts: z.partialRecord(ContributorRoleSchema, z.number().int()),
    items: z.array(ContributorSchema),
  })
  .strict()
export type ContributorsEvidence = z.infer<typeof ContributorsEvidenceSchema>

export const MetricEvidenceSchema = z
  .object({
    metricId: z.string(),
    definitionVersion: z.string(),
    engineVersion: z.string(),
    /** TOTAL = a população inteira do resultado · GROUP = um grupo do AggregateResult (ver query.groupBy / groupKey). */
    scope: z.enum(["TOTAL", "GROUP"]),
    value: z.number().nullable(),
    unit: z.string(),
    basis: z.string().nullable(),
    sampleSize: z.number().int(),
    coverage: z.object({ used: z.number().int(), total: z.number().int(), ratio: z.number() }).strict(),
    reason: z.string().nullable(),
    /** Só em GROUP (OK ≥ minSample · LOW · TINY). */
    sampleFlag: z.enum(["OK", "LOW", "TINY"]).nullable(),
    query: z
      .object({
        /** Filtros normalizados do motor; `account` (nome) NUNCA aparece: vira `accountRefs`. */
        filters: z.record(z.string(), z.unknown()),
        options: z.record(z.string(), z.unknown()),
        timeZone: z.string(),
        groupBy: z.array(z.string()).nullable(),
        /** Valores da chave do grupo na ordem de `groupBy`; dimensão `account` ⇒ accountRef. */
        groupKey: z.array(z.string().nullable()).nullable(),
      })
      .strict(),
    /** O motor só calcula período/qualidade/avisos para a população TOTAL; em GROUP ficam null (não se inventa). */
    period: z.object({ fromLocalDate: z.string().nullable(), toLocalDate: z.string().nullable(), fromInstantUtc: z.string().nullable(), toInstantUtc: z.string().nullable() }).strict().nullable(),
    population: MetricPopulationSchema,
    /** FULL = a população está listada (≤ limite) e o bundle traz os TradeEvidence · HASH_ONLY = acima do limite: só o tradeSetHash prova a população. */
    verifiability: z.enum(["FULL", "HASH_ONLY"]),
    contributors: ContributorsEvidenceSchema,
    dataQuality: z.record(z.string(), z.unknown()).nullable(),
    warnings: z.array(z.object({ code: z.string(), severity: z.enum(["WARNING", "INFO"]), message: z.string(), metric: z.string().optional() }).strict()),
    /** Relógio de quem calculou. FORA do hash. */
    computedAt: z.string().nullable().optional(),
  })
  .strict()
export type MetricEvidence = z.infer<typeof MetricEvidenceSchema>

// ── E6.3: derivados (ranking, contribuição, comparação) — extensão ADITIVA de evidence/1 (sem evidence/2) ──────────────────────────────

/** Operações do E6.2 que podem virar Evidence. Uma por função pública; o verificador (V6) reexecuta a MESMA função. */
export const DERIVED_OPS = ["GROUP_RANKING", "GROUP_COMPARISON", "PERIOD_COMPARISON", "EXIT_REASON_ANALYSIS", "EXIT_REASON_COMPARISON_LEGS", "EXIT_REASON_COMPARISON_TRADES", "LEG_GROUP_RANKING"] as const
export type DerivedOp = (typeof DERIVED_OPS)[number]

export const LegRefSchema = z.object({ tradeId: z.string(), legIndex: z.number().int().nonnegative(), rowNos: z.array(z.number().int()) }).strict()

/**
 * Resultado derivado do E6.2, com tudo que é preciso para REPRODUZI-LO: a operação e os argumentos (conta/estratégia SÓ como accountRef/strategyRef),
 * a população (tradeSetHash do E2; os TradeEvidence vão em `evidence.trades`) e o resultado completo. `result` é o JSON do E6.2 (estrutura própria de
 * cada operação, tipada em `metrics/analysis.ts`); o contrato dele é verificado pelo V6, que o refaz com a função real e exige igualdade — por isso
 * o schema só fixa o envelope (estrito) e não replica a forma de cada operação.
 */
export const DerivedEvidenceSchema = z
  .object({
    /** Determinístico: SHA-256 (domínio próprio) de operação + argumentos + população + versões. Sem relógio/random. */
    derivedId: z.string().regex(/^drv_[0-9a-f]{32}$/),
    analysis: z
      .object({
        op: z.enum(DERIVED_OPS),
        /** TRADE = valores calculados sobre o trade completo · LEG = valores atribuídos às pernas de saída · TRADE_AND_LEG = os dois lado a lado, rotulados. */
        unit: z.enum(["TRADE", "LEG", "TRADE_AND_LEG"]),
        /** Contrato do E6.2 (`metrics-analysis/1`) e sua versão. */
        schema: z.string(),
        definitionVersion: z.string(),
        engineVersion: z.string(),
      })
      .strict(),
    query: z
      .object({
        /** Argumentos da operação (groupBy, metric, order, where, a, b, metrics, reason, períodos). Chaves de grupo de conta/estratégia = refs. */
        args: z.record(z.string(), z.unknown()),
        /** Filtros normalizados; `account`/`strategyId`/`strategyName` guardam REFS, nunca nomes. */
        filters: z.record(z.string(), z.unknown()),
        options: z
          .object({
            timeZone: z.string(),
            timeAnchor: z.enum(["ENTRY", "EXIT"]),
            pnlBasis: z.enum(["NET", "GROSS"]),
            rBasis: z.enum(["NET", "POINTS"]),
            minSample: z.number().int(),
            tradeIdsLimit: z.number().int(),
          })
          .strict(),
      })
      .strict(),
    population: z
      .object({
        afterFilters: z.number().int(),
        tradeSetHash: z.string().regex(/^[0-9a-f]{64}$/),
        /** Até `tradeIdsLimit`; acima disso null e vale o hash (HASH_ONLY). */
        tradeIds: z.array(z.string()).nullable(),
      })
      .strict(),
    /** FULL = população listada e TradeEvidence no bundle (reproduzível) · HASH_ONLY = só o tradeSetHash (não reproduzível). */
    verifiability: z.enum(["FULL", "HASH_ONLY"]),
    result: z.record(z.string(), z.unknown()),
    /** Resumo derivado do `result` (pior confiança, limitações, reconciliação): conferido pelo V6. */
    summary: z
      .object({
        inference: z.literal("DESCRIPTIVE_ONLY"),
        confidence: z.enum(["OK", "LIMITED", "UNRELIABLE"]).nullable(),
        limitations: z.array(z.string()),
        reconciliation: z.enum(["FULL", "PARTIAL", "DIVERGENT", "NO_LEGS"]).nullable(),
      })
      .strict(),
    /** Pernas que sustentam o resultado (só operações com unidade LEG): applicable=false ⇒ não se aplica; items=null ⇒ acima do limite (vale o legSetHash do resultado). */
    refs: z.object({ legs: z.object({ applicable: z.boolean(), items: z.array(LegRefSchema).nullable() }).strict() }).strict(),
    /** Relógio de quem calculou. FORA do hash. */
    computedAt: z.string().nullable().optional(),
  })
  .strict()
export type DerivedEvidence = z.infer<typeof DerivedEvidenceSchema>

export const ClaimSchema = z.object({ kind: z.enum(["METRIC", "TRADE", "DERIVED"]), statement: z.string().nullable() }).strict()
export const SubjectSchema = z.object({ type: z.enum(["METRIC", "TRADE", "DERIVED"]), id: z.string() }).strict()

export const EvidenceBundleSchema = z
  .object({
    schema: z.literal(EVIDENCE_SCHEMA),
    claim: ClaimSchema,
    subject: SubjectSchema,
    evidence: z
      .object({
        imports: z.array(ImportRefSchema),
        trades: z.array(TradeEvidenceSchema),
        metrics: z.array(MetricEvidenceSchema),
        /** E6.3 (aditivo): ausente nos bundles anteriores — o `evidenceHash` deles NÃO muda. */
        derived: z.array(DerivedEvidenceSchema).optional(),
      })
      .strict(),
    /** SHA-256 de tudo acima, sem `importedAt`/`computedAt`. */
    evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>
