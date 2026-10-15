// PromptViews do agente (E6.5-2): LISTAS BRANCAS `.strict()` do que cada capacidade pode devolver ao modelo (tiers T1/T2 de agent-capabilities.md §8).
// Qualquer campo T0 (rowNo, rowHash, sourceRows, sourceLabel/entryLabel/exitLabel, fileName, fileSha256, userId, saltId, saltCheck, accountRef,
// strategyRef, importedAt, evidenceHash, issues, fieldProvenance) em QUALQUER nível é rejeitado pelo schema. Rascunho v1: o E6.6 pode refinar com bump.
import { z } from "zod"
import { EXPLAIN_MAX_TRADES } from "./contract.ts"

/** Rótulo de ordem como o MODELO vê: vocabulário v1, "(sem rótulo)" ou alias de token. Nunca texto livre, nunca `lbl_…`. */
export const LabelViewSchema = z.string().regex(/^(?:\(sem rótulo\)|Entry|Target\d{0,2}|Stop\d{0,2}|Zerar|rótulo personalizado [A-Z]{1,3})$/)
/** Parte de chave de grupo: alias ou valor de dimensão; refs (acc_/str_/lbl_/pat_/ev_ + hex) NUNCA aparecem. */
export const GroupKeyPartSchema = z.string().min(1).refine((v) => !/(?:^|[^a-z])(?:acc|str|lbl|pat|ev)_[0-9a-f]{24,32}(?![0-9a-f])/.test(v), { message: "ref na chave de grupo" })
export const UnitSchema = z.enum(["count", "usd", "R", "percent", "ratio", "points"])
const Coverage = z.object({ used: z.number().int().nonnegative(), total: z.number().int().nonnegative(), ratio: z.number() }).strict()
const SampleFlag = z.enum(["OK", "LOW", "TINY"])

/** Valor de métrica como o motor o devolveu (já arredondado na saída); a exibição é do servidor (slots). */
export const MetricValueViewSchema = z
  .object({ metricId: z.string(), value: z.number().nullable(), unit: UnitSchema, basis: z.string().nullable(), sampleSize: z.number().int().nonnegative(), coverage: Coverage, reason: z.string().nullable() })
  .strict()
export const MetricsQueryViewSchema = z.object({ metrics: z.array(MetricValueViewSchema), period: z.object({ from: z.string().nullable(), to: z.string().nullable() }).strict() }).strict()

export const GroupViewSchema = z.object({ key: z.array(GroupKeyPartSchema), sampleFlag: SampleFlag, sampleSize: z.number().int().nonnegative(), metrics: z.array(MetricValueViewSchema) }).strict()
export const MetricsGroupsViewSchema = z.object({ groupBy: z.array(z.string()), groups: z.array(GroupViewSchema) }).strict()

export const ExitReasonSchema = z.enum(["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])
/** Quebra por motivo de saída. `unit` TRADE e LEG NUNCA se misturam numa mesma linha. */
export const ExitBucketViewSchema = z
  .object({
    reason: ExitReasonSchema, unit: z.enum(["TRADE", "LEG"]), count: z.number().int().nonnegative(),
    pnlNet: z.number().nullable(), /** E6.6-V: motivo do `pnlNet` null (Cell.reason do motor); nome próprio porque `reason` acima é o motivo de SAÍDA. */ pnlNetReason: z.string().nullable(),
    share: z.number().nullable(), /** E6.6-V: motivo do `share` null OU aviso (ex.: DENOMINATOR_PARTIAL_COVERAGE com valor). */ shareReason: z.string().nullable(),
    coverage: Coverage,
  })
  .strict()
const ReconciliationWord = z.enum(["RECONCILED", "DIVERGENT", "NOT_COMPARABLE"])
export const ExitBreakdownViewSchema = z.object({ buckets: z.array(ExitBucketViewSchema), reconciliation: ReconciliationWord }).strict()

export const CompareViewSchema = z
  .object({
    a: z.object({ key: z.array(GroupKeyPartSchema), sampleSize: z.number().int().nonnegative() }).strict(),
    b: z.object({ key: z.array(GroupKeyPartSchema), sampleSize: z.number().int().nonnegative() }).strict(),
    deltas: z.array(
      z
        .object({
          metricId: z.string(), unit: UnitSchema,
          a: z.number().nullable(), /** E6.6-V: motivo do lado A/B null (Cell.reason). */ aReason: z.string().nullable(),
          b: z.number().nullable(), bReason: z.string().nullable(),
          delta: z.number().nullable(), ratio: z.number().nullable(),
          /** E6.6-V: motivo de `delta` e `ratio` null (MetricComparison.reason: UNAVAILABLE_* ou RATIO_*): UM motivo para os dois. */ reason: z.string().nullable(),
        })
        .strict(),
    ),
    conclusive: z.boolean(),
  })
  .strict()

/** `tiedWithPrevious` vem do motor: só ele autoriza o agente a dizer "empate" (TIE_OVERCLAIM). */
export const RankRowViewSchema = z
  .object({ /** E6.6-9 (D9-3): null = grupo SEM posição (amostra minúscula ou valor indisponível); listado no fim, nunca descartado. O slot `rows[].rank` com null ⇒ FORMAT_INVALID. */ rank: z.number().int().positive().nullable(), key: z.array(GroupKeyPartSchema), value: MetricValueViewSchema, sampleFlag: SampleFlag, tiedWithPrevious: z.boolean(), contribution: z.number().nullable(), /** E6.6-V: motivo do `contribution` null (Fraction.reason). */ contributionReason: z.string().nullable() })
  .strict()
export const RankViewSchema = z.object({ rows: z.array(RankRowViewSchema), orderedBy: z.string() }).strict()

/** E6.6-10 (D10-3): `reconciliation` (a da ANÁLISE, igual à do exit.breakdown) entra na view: pernas e trades lado a lado exigem dizer se conferem. */
export const ExitAnalysisViewSchema = z.object({ buckets: z.array(ExitBucketViewSchema), comparison: CompareViewSchema.nullable(), reconciliation: ReconciliationWord }).strict()

// ── evidence.explain (T2): MESMA projeção de rótulo; sem rowNo/rowHash/tradeId; ≤ K trades ──
export const LegViewSchema = z
  .object({ role: z.enum(["ENTRY", "EXIT"]), price: z.number().nullable(), quantity: z.number().nullable(), label: LabelViewSchema, pnlNet: z.number().nullable() })
  .strict()
export const ExplainTradeViewSchema = z
  .object({
    /** posição dentro da página (1..K): NÃO é o tradeId (que deriva de hashes de linha). */
    ordinal: z.number().int().positive(),
    instrument: z.string().nullable(),
    direction: z.enum(["LONG", "SHORT"]).nullable(),
    quantity: z.number().nullable(),
    entryLocal: z.string().nullable(),
    exitLocal: z.string().nullable(),
    entryPrice: z.number().nullable(),
    exitPrice: z.number().nullable(),
    pnlNet: z.number().nullable(),
    pnlGross: z.number().nullable(),
    exitReason: ExitReasonSchema,
    accountAlias: z.string().regex(/^Conta [A-Z]{1,3}$/).nullable(),
    legs: z.array(LegViewSchema),
  })
  .strict()
export const ExplainViewSchema = z
  .object({ page: z.number().int().nonnegative(), pageCount: z.number().int().nonnegative(), total: z.number().int().nonnegative(), trades: z.array(ExplainTradeViewSchema).max(EXPLAIN_MAX_TRADES) })
  .strict()

/** Catálogo capacidade → PromptView (E6.5-2). `evidence.refresh` devolve só o handle (sem data). */
export const PROMPT_VIEWS = {
  "metrics.query@1": MetricsQueryViewSchema,
  "metrics.groups@1": MetricsGroupsViewSchema,
  "exit.breakdown@1": ExitBreakdownViewSchema,
  "metrics.compare@1": CompareViewSchema,
  "rank.groups@1": RankViewSchema,
  "exit.analysis@1": ExitAnalysisViewSchema,
  "evidence.explain@1": ExplainViewSchema,
} as const
