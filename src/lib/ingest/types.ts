// Contratos do pipeline de ingestão:
//
//   texto bruto ──► CsvTable ──► [Parser: colunas da plataforma → SourceRecord (strings)]
//                           ──► [Normalizer: strings → valores tipados, tempo/UTC, números, P&L]
//                           ──► [Validator: regras de coerência → issues + dataQuality]
//                           ──► CanonicalTrade
//
// Adicionar um formato = escrever um ParserDescriptor (só o mapeamento de colunas/vocabulário) + registrar + fixtures.
// O Normalizer, o Validator e o domínio NÃO mudam.

import type { SaltProvider } from "./salt.ts"
import type { CanonicalTrade, ImportRecord, Issue, Platform } from "../domain/canonical.ts"
import type { PnlBasis } from "../domain/pnl.ts"
import type { ExcursionUnit } from "../domain/risk.ts"
import type { DateOrder, FoldPolicy } from "../domain/time.ts"
import type { CsvTable, NumberLocale } from "./csv.ts"
import type { ExitReasonRule } from "./exit-reason.ts"

/** O que o USUÁRIO/JOB sabe sobre o arquivo e a máquina da qual ele veio. Nada aqui é adivinhado pelo sistema. */
export interface ImportContext {
  /**
   * Fuso IANA em que os horários SEM offset do arquivo foram gerados (o do computador/plataforma que exportou).
   * Se omitido, vale `DEFAULT_SOURCE_TIME_ZONE` — registrado em `settings.sourceTzOrigin = "DEFAULT"` e avisado
   * (W_SOURCE_TZ_DEFAULTED): é metadado auditável, não uma suposição silenciosa. Timestamps com offset explícito ignoram este valor.
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
  /**
   * Reconstruir ciclos de posição 0→0 a partir de linhas de lotes casados (NT8). Padrão: ligado nos parsers que declaram
   * `reconstruction` (NT8 PT-BR, validado com export real), desligado nos demais. `false` força linha = trade.
   */
  reconstructCycles?: boolean
  /** Mapa de rótulo de saída → motivo (prioridade sobre as regras padrão). */
  exitReasonMap?: ExitReasonRule[]
  /** Sal do `account.ref` (ex.: id do usuário). Sem sal, o ref é igual para o mesmo nome de conta em qualquer import. */
  accountRefSalt?: string
  /**
   * Política de sal (P3): sal GERENCIADO por usuário. O import usa o sal ATUAL do provider e grava `saltId`/`saltCheck` (nunca o valor) em
   * `reproducibility`. Sem sal atual ⇒ o import FALHA (E_SALT_REQUIRED). Não combina com `accountRefSalt` (E_SALT_CONFLICT).
   */
  salt?: { provider: SaltProvider; userId: string }
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
  /** Nome da ordem de entrada/saída ("Entry", "Target1", "Zerar") — preservado, nunca descartado. */
  entryLabel?: string
  exitLabel?: string
  etd?: string
  bars?: string
  /** "Acu lucro líquido" cru — só p/ checar integridade do relatório, NUNCA como P&L. */
  cumulativeNet?: string
}

/** Valores crus de uma linha que não cabem no trade-linha, mas alimentam a reconstrução e a auditoria. */
export interface RowMeta {
  entryLabel: string | null
  exitLabel: string | null
  reportedProfit: number | null
  maeUsd: number | null
  mfeUsd: number | null
  etdUsd: number | null
  bars: number | null
  cumulativeNetReported: number | null
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
  /** O formato é "um lote casado por linha" e permite reconstruir ciclos de posição (validado com export real). */
  reconstruction?: "NT8_ROW_INTERVALS_V1"
  detect(table: CsvTable): { confidence: number; reasons: string[] }
  parse(table: CsvTable): { records: SourceRecord[]; issues: Issue[] }
}

export interface PipelineStats {
  rowsRead: number
  /** Linhas da fonte aceitas (passaram em normalizar+validar). */
  accepted: number
  rejected: number
  /** Trades FINAIS (ciclos reconstruídos + linhas sem reconstrução). Sem reconstrução = igual a `accepted`. */
  trades: number
  warnings: number
}

export interface RejectedRow {
  rowNo: number
  issues: Issue[]
}

export interface ReconstructionSummary {
  method: "NT8_ROW_INTERVALS_V1"
  rowsIn: number
  cyclesOut: number
  /** Linhas que não puderam entrar (sem horário completo) e seguiram como trade-linha. */
  passthroughRows: number
  integrity: "CONSISTENT" | "BROKEN" | "UNAVAILABLE"
  lowConfidenceCycles: number
  /** Contagem por código de ambiguidade (todas as ambiguidades detectadas, nenhuma descartada). */
  ambiguities: Array<{ code: string; count: number }>
}

export interface PipelineResult {
  /** Proveniência do arquivo (E1). null quando nem o formato foi reconhecido. */
  importRecord: ImportRecord | null
  parser: { id: string; version: string; platform: Platform; confidence: number } | null
  settings: CanonicalTrade["source"]["settings"] | null
  /** Trades analíticos finais: ciclos de posição (quando reconstruídos) ou linhas. */
  trades: CanonicalTrade[]
  /** As linhas aceitas como trade-linha (granularity SOURCE_ROW), ANTES da reconstrução. Auditoria e comparação antes/depois. */
  rowTrades: CanonicalTrade[]
  /** Resumo da reconstrução (null se não houve). */
  reconstruction: ReconstructionSummary | null
  rejected: RejectedRow[]
  /** Problemas do ARQUIVO (formato desconhecido, fuso ausente, cabeçalho duplicado…). Os de linha ficam em trades[].issues / rejected[].issues. */
  issues: Issue[]
  stats: PipelineStats
}
