// Normalizer: SourceRecord (texto) → TradeDraft (valores tipados) usando as configurações EFETIVAS da importação.
// Tempo → UTC com o fuso de origem; números com o locale do formato; custos separados em commission/fees.
// Qualquer coisa que não dá para ler com segurança vira ERROR (a linha é rejeitada), não um palpite.

import { issue, type Issue, type SourceMetadata } from "../domain/canonical.ts"
import { round2 } from "../domain/pnl.ts"
import { UNKNOWN_TIME, parseLocalDateTime, type DateOrder, type FoldPolicy, type TimeValue } from "../domain/time.ts"
import { parseNumber, type NumberLocale } from "./csv.ts"
import type { TradeDraft } from "./build-trade.ts"
import type { ParserDescriptor, SourceRecord } from "./types.ts"

export interface EffectiveSettings {
  sourceTz: string | null
  dateOrder: DateOrder | null
  numberLocale: NumberLocale
  excursionUnit: SourceMetadata["settings"]["excursionUnit"]
  declaredPnlBasis: SourceMetadata["settings"]["declaredPnlBasis"]
  foldPolicy: FoldPolicy
}

export interface NormalizeContext {
  descriptor: ParserDescriptor
  settings: EffectiveSettings
  fileName: string | null
  fileHash: string | null
}

export interface NormalizeResult {
  draft: TradeDraft | null
  issues: Issue[]
}

export function normalizeRecord(rec: SourceRecord, ctx: NormalizeContext): NormalizeResult {
  const { descriptor, settings } = ctx
  const issues: Issue[] = []
  const err = (code: string, message: string, field: string) => issues.push(issue("ERROR", code, message, { field, rowNo: rec.rowNo }))

  const num = (text: string | undefined, field: string, required: boolean): number | null => {
    if (text === undefined || text.trim() === "") {
      if (required) err("E_NUMBER_EMPTY", `Campo obrigatório vazio: ${field}.`, field)
      return null
    }
    const r = parseNumber(text, settings.numberLocale)
    if (!r.ok) {
      err(r.code, `${field}: ${r.message}`, field)
      return null
    }
    return r.value
  }

  // direção / instrumento
  if (rec.direction === null) err("E_DIRECTION_INVALID", `Direção inválida: "${rec.directionRaw}".`, "direction")
  if (!rec.instrument.trim()) err("E_INSTRUMENT_EMPTY", "Instrumento ausente.", "instrument")

  // números
  const quantity = num(rec.quantity, "quantity", true)
  const entryPrice = num(rec.entryPrice, "entryPrice", true)
  const exitPrice = num(rec.exitPrice, "exitPrice", true)
  if (quantity !== null && quantity <= 0) err("E_QUANTITY_INVALID", `Quantidade inválida: ${quantity}.`, "quantity")
  if (entryPrice !== null && entryPrice <= 0) err("E_PRICE_INVALID", `Preço de entrada inválido: ${entryPrice}.`, "entryPrice")
  if (exitPrice !== null && exitPrice <= 0) err("E_PRICE_INVALID", `Preço de saída inválido: ${exitPrice}.`, "exitPrice")

  const reportedPnl = num(rec.profit, "profit", false)
  const commission = num(rec.commission, "commission", false)
  let fees: number | null = null
  for (const f of rec.fees ?? []) {
    const v = num(f, "fees", false)
    if (v !== null) fees = round2((fees ?? 0) + v) // soma em centavos: 0,7+0,6+0,3 não pode virar 1,5999…
  }
  const mfeRaw = num(rec.mfe, "mfe", false)
  const maeRaw = num(rec.mae, "mae", false)

  // tempo
  const timeOpts = { dateOrder: settings.dateOrder ?? undefined, tz: settings.sourceTz, foldPolicy: settings.foldPolicy }
  const time = (text: string | undefined, field: string): TimeValue => {
    if (text === undefined || text.trim() === "") return UNKNOWN_TIME
    const r = parseLocalDateTime(text, timeOpts)
    if (!r.ok) {
      err(r.code, `${field}: ${r.message}`, field)
      return UNKNOWN_TIME
    }
    return r.value
  }
  const entryAt = time(rec.entryTime ?? rec.date, "entryTime")
  const exitAt = time(rec.exitTime, "exitTime")
  if (entryAt.precision === "UNKNOWN" && !issues.some((i) => i.field === "entryTime")) {
    err("E_TIME_EMPTY", "Data/hora de entrada ausente.", "entryTime")
  }

  const sessionHintRaw = (rec.sessionHint ?? "").trim().toUpperCase()
  const sessionHint = sessionHintRaw === "AM" || sessionHintRaw === "PM" || sessionHintRaw === "OVERNIGHT" ? sessionHintRaw : null

  if (
    issues.some((i) => i.severity === "ERROR") ||
    rec.direction === null ||
    quantity === null ||
    entryPrice === null ||
    exitPrice === null
  ) {
    return { draft: null, issues }
  }

  const source: SourceMetadata = {
    platform: descriptor.platform,
    parserId: descriptor.id,
    parserVersion: descriptor.version,
    fileName: ctx.fileName,
    fileHash: ctx.fileHash,
    rowNo: rec.rowNo,
    externalId: rec.externalId ?? null,
    settings: {
      sourceTz: settings.sourceTz,
      dateOrder: settings.dateOrder,
      numberLocale: settings.numberLocale,
      excursionUnit: settings.excursionUnit,
      declaredPnlBasis: settings.declaredPnlBasis,
    },
  }

  return {
    issues,
    draft: {
      source,
      accountName: rec.account?.trim() ? rec.account.trim() : null,
      instrumentRaw: rec.instrument.trim(),
      direction: rec.direction,
      quantity,
      entry: { at: entryAt, price: entryPrice },
      exit: { at: exitAt, price: exitPrice },
      reportedPnl,
      declaredPnlBasis: settings.declaredPnlBasis,
      commission,
      fees,
      mfeRaw,
      maeRaw,
      excursionUnit: settings.excursionUnit,
      strategyName: rec.strategy?.trim() ? rec.strategy.trim() : null,
      notes: rec.notes?.trim() ? rec.notes.trim() : null,
      sessionHint,
    },
  }
}
