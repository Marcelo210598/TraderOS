// Contratos canônicos do MeuTrade (docs/ai-partner/data-contract.md). É a "moeda única" do pipeline de ingestão:
//   qualquer fonte (CSV, Excel, PDF, print, conector) → CanonicalTrade | CanonicalExecution → (futuro) tabelas.
// Validação de FORMA com Zod; regras de NEGÓCIO (coerência de preço/horário/P&L) ficam em ingest/validator.ts.
// Constrained strings (z.enum) em vez de enums do Postgres — decisão aprovada.

import { z } from "zod"

export const SCHEMA_TRADE = "canonical-trade/1" as const
export const SCHEMA_EXECUTION = "canonical-execution/1" as const

export const PLATFORMS = ["NINJATRADER", "TRADOVATE", "RITHMIC", "MEUTRADE_TEMPLATE", "MANUAL", "OTHER"] as const
export type Platform = (typeof PLATFORMS)[number]

// ── Issues ───────────────────────────────────────────────────────────────────

export const IssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["ERROR", "WARNING", "INFO"]),
  message: z.string(),
  field: z.string().nullable().default(null),
  rowNo: z.number().int().nullable().default(null),
})
export type Issue = z.infer<typeof IssueSchema>

export const issue = (
  severity: Issue["severity"],
  code: string,
  message: string,
  extra: { field?: string; rowNo?: number } = {},
): Issue => ({ code, severity, message, field: extra.field ?? null, rowNo: extra.rowNo ?? null })

// ── Tempo ────────────────────────────────────────────────────────────────────

export const TimeValueSchema = z.object({
  raw: z.string(),
  precision: z.enum(["DATETIME", "DATE_ONLY", "UNKNOWN"]),
  instantUtc: z.string().nullable(),
  localDate: z.string().nullable(),
  sourceTz: z.string().nullable(),
  explicitOffset: z.boolean(),
  ambiguity: z.enum(["NONE", "FOLD_EARLIER_ASSUMED", "FOLD_LATER_ASSUMED"]),
})

// ── Fonte / proveniência ─────────────────────────────────────────────────────

export const ImportSettingsSchema = z.object({
  sourceTz: z.string().nullable(),
  dateOrder: z.enum(["MDY", "DMY", "YMD"]).nullable(),
  numberLocale: z.enum(["US", "BR", "AUTO"]),
  excursionUnit: z.enum(["POINTS_PER_CONTRACT", "USD_TOTAL", "USD_PER_CONTRACT"]).nullable(),
  declaredPnlBasis: z.enum(["GROSS", "NET", "UNKNOWN"]),
})

export const SourceMetadataSchema = z.object({
  platform: z.enum(PLATFORMS),
  parserId: z.string(),
  parserVersion: z.string(),
  fileName: z.string().nullable(),
  fileHash: z.string().nullable(),
  /** Linha física no arquivo (cabeçalho = 1). */
  rowNo: z.number().int().nullable(),
  externalId: z.string().nullable(),
  /** Cópia das configurações EFETIVAS usadas na leitura (auditoria: "por que esse horário?"). */
  settings: ImportSettingsSchema,
})
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>

// ── P&L ──────────────────────────────────────────────────────────────────────

export const PnlSchema = z.object({
  reported: z.number().nullable(),
  basis: z.enum(["GROSS", "NET", "UNKNOWN"]),
  basisSource: z.enum(["SOURCE_DECLARED", "INFERRED_FROM_PRICES", "DERIVED_FROM_FILLS", "UNDETERMINED"]),
  gross: z.number().nullable(),
  commission: z.number().nullable(),
  fees: z.number().nullable(),
  net: z.number().nullable(),
  netStatus: z.enum(["COMPLETE", "COMMISSION_ONLY", "UNAVAILABLE"]),
  computedGross: z.number().nullable(),
})

// ── Trade canônico ───────────────────────────────────────────────────────────

const Price = z.number().finite().positive()

export const CanonicalTradeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_TRADE),
  account: z.object({ sourceName: z.string().nullable() }),
  instrument: z.object({
    raw: z.string(),
    /** Raiz reconhecida ou null. Nunca um palpite. */
    root: z.string().nullable(),
    contract: z.object({ monthCode: z.string(), month: z.number().int(), yearDigits: z.string() }).nullable(),
    pointValue: z.number().positive().nullable(),
    status: z.enum(["KNOWN_ROOT", "UNKNOWN_ROOT", "EMPTY"]),
  }),
  direction: z.enum(["LONG", "SHORT"]),
  quantity: z.number().finite().positive(),
  entry: z.object({ at: TimeValueSchema, price: Price }),
  exit: z.object({ at: TimeValueSchema, price: Price }),
  /** Pontos POR CONTRATO, com sinal (+ = a favor). */
  pointsPerContract: z.number().finite(),
  pnl: PnlSchema,
  risk: z.object({
    stopPrice: z.number().finite().nullable(),
    targetPrice: z.number().finite().nullable(),
    riskPoints: z.number().nullable(),
    riskUsd: z.number().nullable(),
    riskSource: z.enum(["SOURCE", "USER", "NONE"]),
    reason: z.enum(["STOP_MISSING", "STOP_WRONG_SIDE", "STOP_EQUALS_ENTRY"]).nullable(),
  }),
  r: z.object({
    /** R canônico = P&L líquido / risco em dólar. */
    net: z.number().nullable(),
    netReason: z.enum(["NET_PNL_UNAVAILABLE", "RISK_UNKNOWN", "RISK_USD_UNAVAILABLE"]).nullable(),
    /** R em pontos (sem custos) — rótulo próprio, nunca misturado com `net`. */
    points: z.number().nullable(),
  }),
  excursions: z.object({
    /** Pontos por contrato, positivos. */
    mfePoints: z.number().nullable(),
    maePoints: z.number().nullable(),
    mfeReason: z.enum(["NOT_PROVIDED", "UNIT_UNKNOWN", "POINT_VALUE_UNKNOWN", "NOT_A_NUMBER"]).nullable(),
    maeReason: z.enum(["NOT_PROVIDED", "UNIT_UNKNOWN", "POINT_VALUE_UNKNOWN", "NOT_A_NUMBER"]).nullable(),
  }),
  labels: z.object({
    strategyName: z.string().nullable(),
    tags: z.array(z.string()),
    notes: z.string().nullable(),
  }),
  /** Sessão declarada pela fonte (template). Sessão DERIVADA vem de domain/time.ts, nunca é gravada aqui. */
  sessionHint: z.enum(["AM", "PM", "OVERNIGHT"]).nullable(),
  source: SourceMetadataSchema,
  dataQuality: z.enum(["COMPLETE", "PARTIAL"]),
  fieldProvenance: z.record(z.string(), z.enum(["FILE", "INFERRED", "DERIVED", "ABSENT"])),
  issues: z.array(IssueSchema),
})
export type CanonicalTrade = z.infer<typeof CanonicalTradeSchema>

// ── Order ≠ Fill ≠ Trade ─────────────────────────────────────────────────────
// Order: intenção enviada à corretora (pode ter 0..N fills, ser cancelada, parcial).
// Fill: execução real (preço/qtd/hora). Trade: round-turn derivado de fills (flat → flat).
// Alguns exports (ex.: relatório de Orders) trazem só o preço MÉDIO da ordem: vira um fill com
// granularity = ORDER_AVERAGE — explícito, para ninguém confundir com execução individual.

const InstrumentRef = z.object({
  raw: z.string(),
  root: z.string().nullable(),
  contract: z.object({ monthCode: z.string(), month: z.number().int(), yearDigits: z.string() }).nullable(),
})

export const CanonicalOrderSchema = z.object({
  schemaVersion: z.literal("canonical-order/1"),
  orderId: z.string(),
  account: z.string().nullable(),
  instrument: InstrumentRef,
  side: z.enum(["BUY", "SELL"]),
  orderType: z.string().nullable(),
  status: z.string(),
  quantity: z.number().positive(),
  filledQuantity: z.number().nonnegative(),
  avgFillPrice: z.number().positive().nullable(),
  stopPrice: z.number().nullable(),
  limitPrice: z.number().nullable(),
  submittedAt: TimeValueSchema.nullable(),
  filledAt: TimeValueSchema.nullable(),
  source: SourceMetadataSchema,
})
export type CanonicalOrder = z.infer<typeof CanonicalOrderSchema>

export const CanonicalExecutionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_EXECUTION),
  granularity: z.enum(["FILL", "ORDER_AVERAGE"]),
  account: z.string().nullable(),
  instrument: InstrumentRef,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().finite().positive(),
  price: Price,
  at: TimeValueSchema,
  commission: z.number().nullable(),
  fees: z.number().nullable(),
  orderId: z.string().nullable(),
  fillId: z.string().nullable(),
  source: SourceMetadataSchema,
})
export type CanonicalExecution = z.infer<typeof CanonicalExecutionSchema>
