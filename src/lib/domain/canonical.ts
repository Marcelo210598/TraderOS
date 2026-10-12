// Contratos canônicos do MeuTrade (docs/ai-partner/data-contract.md). É a "moeda única" do pipeline de ingestão:
//   qualquer fonte (CSV, Excel, PDF, print, conector) → CanonicalTrade | CanonicalExecution → (futuro) tabelas.
// Validação de FORMA com Zod; regras de NEGÓCIO (coerência de preço/horário/P&L) ficam em ingest/validator.ts.
// Constrained strings (z.enum) em vez de enums do Postgres — decisão aprovada.

import { z } from "zod"

/** v1: um trade = uma entrada + uma saída. v2: + pernas, reconstrução, excursão com origem. v1 CONTINUA válido (campos novos são opcionais). */
export const SCHEMA_TRADE_V1 = "canonical-trade/1" as const
export const SCHEMA_TRADE = "canonical-trade/2" as const
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
  /**
   * Quem definiu o fuso de origem: USER (chamador informou) · FILE_OFFSET (os timestamps traziam offset; `sourceTz` fica null)
   * · FILE_DECLARED (o formato declara o fuso — reservado, nenhum parser real emite ainda) · DEFAULT (assumido; avisado).
   */
  sourceTzOrigin: z.enum(["USER", "FILE_OFFSET", "FILE_DECLARED", "DEFAULT"]).optional(),
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
  /** SHA-256 do conteúdo da linha (E1/E3). Só nos trades SOURCE_ROW — num ciclo cada linha tem o seu em `sourceRows[].rowHash`. */
  rowHash: z.string().optional(),
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

// ── Pernas, motivo de saída e reconstrução (canonical-trade/2) ───────────────

export const EXIT_REASONS = ["TARGET", "STOP", "MANUAL", "UNKNOWN"] as const
export type ExitReason = (typeof EXIT_REASONS)[number]
export const ExitReasonSchema = z.enum(EXIT_REASONS)

/** Unidade factual de uma perna: FILL (execução), ORDER_AVERAGE (preço médio de ordem), MATCHED_LOT (par casado de lote do NT8). */
export const LegGranularitySchema = z.enum(["FILL", "ORDER_AVERAGE", "MATCHED_LOT"])

const LegPriceQty = {
  at: TimeValueSchema,
  price: z.number().finite().positive(),
  quantity: z.number().finite().positive(),
  /** Nome da ordem como veio da fonte ("Entry", "Target1", "Zerar") — SEMPRE preservado. */
  sourceLabel: z.string().nullable(),
  /** Linhas/execuções da fonte que compõem esta perna. */
  rowRefs: z.array(z.number().int()),
  granularity: LegGranularitySchema,
}

export const EntryLegSchema = z.object({ ...LegPriceQty, role: z.enum(["ENTRY", "SCALE_IN"]) })

export const LegPnlSchema = z.object({
  net: z.number().nullable(),
  gross: z.number().nullable(),
  commission: z.number().nullable(),
  fees: z.number().nullable(),
})

export const ExitLegSchema = z.object({
  ...LegPriceQty,
  /** SCALE_OUT = saída parcial (sobra posição); EXIT = leva a posição a zero. */
  role: z.enum(["SCALE_OUT", "EXIT"]),
  /** Posição restante depois desta saída (por timestamp distinto). */
  sizeAfter: z.number().nonnegative(),
  /** Há outra perna de saída no mesmo segundo (ordem entre elas desconhecida). */
  simultaneous: z.boolean(),
  reason: ExitReasonSchema,
  /** Como o motivo foi decidido: regra padrão por rótulo, mapa do usuário, ou nenhuma (UNKNOWN). */
  reasonRule: z.enum(["LABEL_RULE", "USER_MAP", "NONE"]),
  pnl: LegPnlSchema,
})

export const ExitSummarySchema = z.object({
  /** Motivo da perna que levou a posição a zero; null se houver várias pernas finais com motivos diferentes. */
  finalReason: ExitReasonSchema.nullable(),
  finalReasons: z.array(ExitReasonSchema),
  /** Quantidade (contratos) saída por motivo. */
  byReason: z.record(z.string(), z.number()),
  mixed: z.boolean(),
})

export const AmbiguitySchema = z.object({
  code: z.string(),
  /** LOW_CONFIDENCE derruba a confiança do ciclo; INFO só registra. */
  severity: z.enum(["LOW_CONFIDENCE", "INFO"]),
  rowNos: z.array(z.number().int()),
  message: z.string(),
})

export const ReconstructionSchema = z.object({
  method: z.enum(["NT8_ROW_INTERVALS_V1", "FILLS_FLAT_TO_FLAT"]),
  /** O ciclo é da POSIÇÃO DA ESTRATÉGIA (o relatório não permite a posição líquida da conta). */
  scope: z.enum(["STRATEGY_POSITION", "ACCOUNT_POSITION"]),
  cycleKey: z.object({
    account: z.string().nullable(),
    contract: z.string(),
    strategy: z.string().nullable(),
    direction: z.enum(["LONG", "SHORT"]),
  }),
  confidence: z.enum(["HIGH", "LOW"]),
  ambiguities: z.array(AmbiguitySchema),
  /** VERIFIED = delimitado por lacunas observadas dos dois lados (ainda sujeito a lote aberto invisível); HEAD/TAIL/BOTH = borda não verificável. */
  completeness: z.enum(["VERIFIED", "UNVERIFIED_HEAD", "UNVERIFIED_TAIL", "UNVERIFIED_BOTH"]),
  boundary: z.object({
    prev: z.enum(["NONE", "REVERSAL_CANDIDATE", "AMBIGUOUS_TOUCH"]),
    next: z.enum(["NONE", "REVERSAL_CANDIDATE", "AMBIGUOUS_TOUCH"]),
  }),
  /** Integridade do relatório (acumulado do NT8 bate linha a linha?). Nunca é fonte de P&L. */
  integrity: z.enum(["CONSISTENT", "BROKEN", "UNAVAILABLE"]),
})

/** Linha ORIGINAL da fonte, com os valores crus (nada se perde na reconstrução). */
export const SourceRowSchema = z.object({
  rowNo: z.number().int(),
  entryLeg: z.number().int(),
  exitLeg: z.number().int(),
  quantity: z.number().positive(),
  entryLabel: z.string().nullable(),
  exitLabel: z.string().nullable(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  reportedProfit: z.number().nullable(),
  commission: z.number().nullable(),
  fees: z.number().nullable(),
  /** MAE/MFE/ETD CRUS da linha (US$ total da linha, no NT8). NÃO somar. */
  maeUsd: z.number().nullable(),
  mfeUsd: z.number().nullable(),
  etdUsd: z.number().nullable(),
  bars: z.number().nullable(),
  /** "Acu lucro líquido" cru — só para checagem de integridade, nunca como P&L. */
  cumulativeNetReported: z.number().nullable(),
  /** SHA-256 do CONTEÚDO da linha (sem número de linha nem acumulado, que dependem da ordem). Opcional: E1. */
  rowHash: z.string().optional(),
})

// ── Import (proveniência do arquivo; E1) ─────────────────────────────────────

/** O que se sabe do arquivo importado. Sem relógio: `importedAt` é responsabilidade de quem persiste e fica FORA do hash. */
/**
 * Contexto efetivo da importação que NÃO entra no `importId` e é necessário para reproduzi-la (E5b). Opcional: registros anteriores não o têm
 * e nunca são retro-preenchidos. Nenhum segredo: o sal do `accountRef` NÃO é gravado, só se houve sal (`accountRefSalted`).
 */
/** Formatos da política de sal (P2, salt-policy-plano.md). `saltId`: rótulo NÃO secreto do sal do chaveiro; `saltCheck`: autodeclaração `slt_<24 hex>` (domínio meutrade/saltCheck/1). */
export const SALT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
export const SALT_CHECK_RE = /^slt_[0-9a-f]{24}$/
/** saltId e saltCheck andam JUNTOS: um sem o outro é formato inválido. */
export const saltDeclarationIsPaired = (v: { saltId?: string; saltCheck?: string }): boolean => (v.saltId === undefined) === (v.saltCheck === undefined)

export const ReproducibilityBase = z
  .object({
    version: z.literal(1),
    /** Versões das funções de identidade usadas (`ingest/identity.ts`). Mudou ⇒ a identidade não é reproduzível com o código atual. */
    identity: z.object({ importId: z.number().int(), rowHash: z.number().int(), tradeId: z.number().int(), accountRef: z.string() }).strict(),
    /** Política de horário ambíguo (virada de horário de verão) EFETIVA. Afeta o instante UTC e, por isso, o `rowHash`. */
    foldPolicy: z.enum(["EARLIER", "LATER"]),
    /** Mapa de motivos de saída do usuário, na ORDEM aplicada (a primeira regra que casa vence); [] = só as regras padrão. */
    exitReasonMap: z.array(z.object({ pattern: z.string(), reason: ExitReasonSchema }).strict()),
    /** Houve `accountRefSalt`? (o valor nunca é gravado: quem verifica precisa tê-lo). */
    accountRefSalted: z.boolean(),
    /** Política de sal (P2): qual sal do chaveiro foi usado (rótulo, nunca o valor) e a autodeclaração dele. Ausentes em imports anteriores à política (legado) e em imports sem sal. */
    saltId: z.string().regex(SALT_ID_RE).optional(),
    saltCheck: z.string().regex(SALT_CHECK_RE).optional(),
  })
  .strict()
export const ReproducibilitySchema = ReproducibilityBase.refine(saltDeclarationIsPaired, { message: "saltId e saltCheck devem vir juntos (ou nenhum)" })
export type Reproducibility = z.infer<typeof ReproducibilitySchema>

export const ImportRecordSchema = z.object({
  /** Determinístico: arquivo + parser + configurações efetivas. Mesmo arquivo e mesma leitura ⇒ mesmo id. */
  importId: z.string(),
  /** SHA-256 do texto recebido, em UTF-8 (`hashBasis`). Não é hash dos bytes originais se o chamador já decodificou. */
  fileSha256: z.string(),
  hashBasis: z.literal("UTF8_TEXT"),
  fileBytes: z.number().int().nonnegative(),
  hasBom: z.boolean(),
  lineEnding: z.enum(["LF", "CRLF", "CR", "MIXED", "NONE"]),
  fileName: z.string().nullable(),
  parserId: z.string(),
  parserVersion: z.string(),
  reconstructionMethod: z.string().nullable(),
  reconstructionVersion: z.string().nullable(),
  rowsRead: z.number().int(),
  rowsAccepted: z.number().int(),
  rowsRejected: z.number().int(),
  /**
   * Quantas contas DISTINTAS o arquivo tem (todas as linhas lidas, inclusive rejeitadas). Só a contagem, nunca os nomes:
   * serve para a Evidence saber se uma lista de contas conhecidas está COMPLETA antes de expor o `fileName`.
   */
  accountCount: z.number().int().nonnegative(),
  settings: ImportSettingsSchema,
  /** Contexto efetivo para reproduzir a importação (fora do `importId`). Ausente em registros anteriores: não é inventado. */
  reproducibility: ReproducibilitySchema.optional(),
})
export type ImportRecord = z.infer<typeof ImportRecordSchema>

// ── Trade canônico ───────────────────────────────────────────────────────────

const Price = z.number().finite().positive()

/** Motivos (fechados) pelos quais risco/R não existem. Fonte única: o Canonical e a Evidence (`TradeEvidence.risk.reason`, `.r.netReason`) usam estes mesmos enums. */
export const RiskReasonSchema = z.enum(["STOP_MISSING", "STOP_WRONG_SIDE", "STOP_EQUALS_ENTRY"])
export const RNetReasonSchema = z.enum(["NET_PNL_UNAVAILABLE", "RISK_UNKNOWN", "RISK_USD_UNAVAILABLE"])

export const CanonicalTradeSchema = z.object({
  schemaVersion: z.union([z.literal(SCHEMA_TRADE_V1), z.literal(SCHEMA_TRADE)]),
  account: z.object({
    sourceName: z.string().nullable(),
    /** Fingerprint não reversível do nome da conta (E1). É o que a Evidence exposta usa; `sourceName` fica só interno. */
    ref: z.string().nullable().optional(),
  }),
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
    reason: RiskReasonSchema.nullable(),
  }),
  r: z.object({
    /** R canônico = P&L líquido / risco em dólar. */
    net: z.number().nullable(),
    netReason: RNetReasonSchema.nullable(),
    /** R em pontos (sem custos) — rótulo próprio, nunca misturado com `net`. */
    points: z.number().nullable(),
  }),
  excursions: z.object({
    /** Pontos por contrato, positivos. */
    mfePoints: z.number().nullable(),
    maePoints: z.number().nullable(),
    mfeReason: z.enum(["NOT_PROVIDED", "UNIT_UNKNOWN", "POINT_VALUE_UNKNOWN", "NOT_A_NUMBER"]).nullable(),
    maeReason: z.enum(["NOT_PROVIDED", "UNIT_UNKNOWN", "POINT_VALUE_UNKNOWN", "NOT_A_NUMBER"]).nullable(),
    /** Extremos do preço durante o trade (absolutos): a base da reconstrução. Opcionais p/ compatibilidade com v1. */
    highPrice: z.number().nullable().optional(),
    lowPrice: z.number().nullable().optional(),
    /** Extremos divergentes entre as linhas que formam o ciclo (janelas de medição diferentes). */
    conflict: z.boolean().optional(),
    /** SOURCE_ROW = veio da linha da fonte · RECONSTRUCTED_NT8_ROWS = INFERIDO dos extremos das linhas (NÃO é valor nativo de trade) · NONE. */
    origin: z.enum(["SOURCE_ROW", "RECONSTRUCTED_NT8_ROWS", "NONE"]).optional(),
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

  // ── canonical-trade/2 (todos opcionais ⇒ objetos v1 continuam válidos) ──
  /** Identidade determinística (E1): import + linhas de origem + identidade da reconstrução. Sem UUID/random. */
  tradeId: z.string().optional(),
  /** Id do import que originou este trade (ver ImportRecord). */
  importId: z.string().optional(),
  /** Unidade factual deste "trade": POSITION_CYCLE (ciclo 0→0 reconstruído) · SOURCE_ROW (a linha da fonte tratada como trade, sem ciclo verificado). Ausente = SOURCE_ROW. */
  granularity: z.enum(["POSITION_CYCLE", "SOURCE_ROW"]).optional(),
  /** Maior posição aberta durante o ciclo (empate no mesmo segundo: entradas antes das saídas). */
  peakQuantity: z.number().positive().nullable().optional(),
  entryLegs: z.array(EntryLegSchema).nullable().optional(),
  exitLegs: z.array(ExitLegSchema).nullable().optional(),
  /** Derivado das pernas. NÃO existe um `exitReason` único no trade. */
  exitSummary: ExitSummarySchema.nullable().optional(),
  reconstruction: ReconstructionSchema.nullable().optional(),
  sourceRows: z.array(SourceRowSchema).nullable().optional(),
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
