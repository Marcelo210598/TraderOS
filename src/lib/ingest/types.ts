// Contratos do pipeline de ingestão:
//
//   texto bruto ──► CsvTable ──► [Parser: colunas da plataforma → SourceRecord (strings)]
//                           ──► [Normalizer: strings → valores tipados, tempo/UTC, números, P&L]
//                           ──► [Validator: regras de coerência → issues + dataQuality]
//                           ──► CanonicalTrade
//
// Adicionar um formato = escrever um ParserDescriptor (só o mapeamento de colunas/vocabulário) + registrar + fixtures.
// O Normalizer, o Validator e o domínio NÃO mudam.

import type { CanonicalTrade, Issue, Platform } from "../domain/canonical.ts"
import type { PnlBasis } from "../domain/pnl.ts"
import type { ExcursionUnit } from "../domain/risk.ts"
import type { DateOrder, FoldPolicy } from "../domain/time.ts"
import type { CsvTable, NumberLocale } from "./csv.ts"

/** O que o USUÁRIO/JOB sabe sobre o arquivo e a máquina da qual ele veio. Nada aqui é adivinhado pelo sistema. */
export interface ImportContext {
  /**
   * Fuso IANA em que os horários do arquivo foram gerados (ex.: "America/Sao_Paulo" = fuso do PC que exportou).
   * Obrigatório para horários sem offset — sem ele a linha é rejeitada (E_TZ_REQUIRED), nunca assumido.
   */
  sourceTz?: string | null
  dateOrder?: DateOrder
  numberLocale?: NumberLocale
  /** Unidade do MFE/MAE do arquivo. `null` = desconhecida (então MFE/MAE não são gravados). */
  excursionUnit?: ExcursionUnit | null
  declaredPnlBasis?: PnlBasis
  foldPolicy?: FoldPolicy
  fileName?: string
  fileHash?: string
  /** Força um parser (pula a detecção). */
  forceParserId?: string
}

/** Uma linha de plataforma já traduzida para nomes neutros, mas ainda em TEXTO. */
export interface SourceRecord {
  rowNo: number
  externalId?: string | null
  entryTime?: string
  exitTime?: string
  /** Só data (formatos sem hora). */
  date?: string
  instrument: string
  direction: "LONG" | "SHORT" | null
  directionRaw: string
  quantity: string
  entryPrice: string
  exitPrice: string
  profit?: string
  commission?: string
  /** Colunas de taxas (bolsa, compensação, NFA…), cada uma em texto; somadas pelo Normalizer. */
  fees?: string[]
  mae?: string
  mfe?: string
  account?: string
  strategy?: string
  notes?: string
  sessionHint?: string
}

export interface ParserDefaults {
  numberLocale: NumberLocale
  /** null = inferir pelo arquivo inteiro (ou exigir do usuário). */
  dateOrder: DateOrder | null
  excursionUnit: ExcursionUnit | null
  declaredPnlBasis: PnlBasis
}

export interface ParserDescriptor {
  id: string
  version: string
  platform: Platform
  label: string
  defaults: ParserDefaults
  /** Colunas que o parser aceita sem terem sido validadas contra um export REAL (pendentes de fixture). */
  unverifiedAliases?: string[]
  detect(table: CsvTable): { confidence: number; reasons: string[] }
  parse(table: CsvTable): { records: SourceRecord[]; issues: Issue[] }
}

export interface PipelineStats {
  rowsRead: number
  accepted: number
  rejected: number
  warnings: number
}

export interface RejectedRow {
  rowNo: number
  issues: Issue[]
}

export interface PipelineResult {
  parser: { id: string; version: string; platform: Platform; confidence: number } | null
  settings: CanonicalTrade["source"]["settings"] | null
  trades: CanonicalTrade[]
  rejected: RejectedRow[]
  /** Problemas do ARQUIVO (formato desconhecido, fuso ausente, cabeçalho duplicado…). Os de linha ficam em trades[].issues / rejected[].issues. */
  issues: Issue[]
  stats: PipelineStats
}
