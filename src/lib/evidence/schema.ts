// Schema `evidence/1` (E2): FORMATO da Evidence. Ainda não há geradores (E3 explainTrade · E4 explainMetric · E5 verifyEvidence).
//   Claim → MetricEvidence → population.tradeIds → TradeEvidence → SourceRowRef → ImportRef
// Evidence NÃO é segunda fonte de verdade: não copia o CSV (só referências + valores já canônicos) e todo objeto é `strict`,
// então campos não previstos — em especial `account.sourceName` — são REJEITADOS em vez de passarem em silêncio.

import { z } from "zod"
import {
  AmbiguitySchema,
  EntryLegSchema,
  ExitLegSchema,
  ExitSummarySchema,
  ImportRecordSchema,
  IssueSchema,
  PnlSchema,
  ReconstructionSchema,
  SourceRowSchema,
  TimeValueSchema,
} from "../domain/canonical.ts"
import { EVIDENCE_SCHEMA } from "./hash.ts"

export { EVIDENCE_SCHEMA }

/** ImportRecord (E1) + `importedAt`, que quem persiste preenche. FORA do hash. */
export const ImportRefSchema = ImportRecordSchema.extend({ importedAt: z.string().nullable().optional() }).strict()
export type ImportRef = z.infer<typeof ImportRefSchema>

/** Referência à linha da fonte: identifica (importId + rowNo + rowHash) e traz os valores crus que a conta usa. Nada além. */
export const SourceRowRefSchema = SourceRowSchema.extend({ importId: z.string(), rowHash: z.string() }).strict()
export type SourceRowRef = z.infer<typeof SourceRowRefSchema>

/**
 * Reconstrução como aparece na Evidence: igual à do Canonical, EXCETO a chave do ciclo — lá `cycleKey.account` é o nome da conta
 * em claro; aqui vira `accountRef`. Sem isso o nome vazaria por dentro da reconstrução.
 */
export const ReconstructionEvidenceSchema = ReconstructionSchema.extend({
  cycleKey: z.object({ accountRef: z.string().nullable(), contract: z.string(), strategy: z.string().nullable(), direction: z.enum(["LONG", "SHORT"]) }).strict(),
}).strict()
export type ReconstructionEvidence = z.infer<typeof ReconstructionEvidenceSchema>

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
    entryLegs: z.array(EntryLegSchema).nullable(),
    exitLegs: z.array(ExitLegSchema).nullable(),
    exitSummary: ExitSummarySchema.nullable(),
    reconstruction: ReconstructionEvidenceSchema.nullable(),
    ambiguities: z.array(AmbiguitySchema),
    excursions: z.record(z.string(), z.unknown()),
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
  })
  .strict()

export const MetricEvidenceSchema = z
  .object({
    metricId: z.string(),
    definitionVersion: z.string(),
    engineVersion: z.string(),
    value: z.number().nullable(),
    unit: z.string(),
    basis: z.string().nullable(),
    sampleSize: z.number().int(),
    coverage: z.object({ used: z.number().int(), total: z.number().int(), ratio: z.number() }).strict(),
    reason: z.string().nullable(),
    query: z.object({ filters: z.record(z.string(), z.unknown()), options: z.record(z.string(), z.unknown()), timeZone: z.string(), groupKey: z.array(z.string().nullable()).nullable() }).strict(),
    period: z.object({ fromLocalDate: z.string().nullable(), toLocalDate: z.string().nullable(), fromInstantUtc: z.string().nullable(), toInstantUtc: z.string().nullable() }).strict(),
    population: MetricPopulationSchema,
    /** Quem contribuiu (G5). O formato existe; QUEM preenche é o E4. Ausente = ainda não calculado. */
    contributors: z.array(z.object({ tradeId: z.string(), role: z.string() }).strict()).optional(),
    dataQuality: z.record(z.string(), z.unknown()),
    warnings: z.array(z.object({ code: z.string(), severity: z.enum(["WARNING", "INFO"]), message: z.string(), metric: z.string().optional() }).strict()),
    /** Relógio de quem calculou. FORA do hash. */
    computedAt: z.string().nullable().optional(),
  })
  .strict()
export type MetricEvidence = z.infer<typeof MetricEvidenceSchema>

export const ClaimSchema = z.object({ kind: z.enum(["METRIC", "TRADE"]), statement: z.string().nullable() }).strict()
export const SubjectSchema = z.object({ type: z.enum(["METRIC", "TRADE"]), id: z.string() }).strict()

export const EvidenceBundleSchema = z
  .object({
    schema: z.literal(EVIDENCE_SCHEMA),
    claim: ClaimSchema,
    subject: SubjectSchema,
    evidence: z.object({ imports: z.array(ImportRefSchema), trades: z.array(TradeEvidenceSchema), metrics: z.array(MetricEvidenceSchema) }).strict(),
    /** SHA-256 de tudo acima, sem `importedAt`/`computedAt`. */
    evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>
