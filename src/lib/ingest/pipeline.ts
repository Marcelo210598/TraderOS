// Pipeline de ingestão: texto bruto → CanonicalTrade[] (+ issues por linha e por arquivo).
//   Raw → Parser → Normalizer → Validator → [Reconstrução de ciclos] → Canonical Trade
// Puro: sem banco, sem rede, sem Prisma.
//
// Reconstrução (parsers que declaram `reconstruction`, hoje o NT8 PT-BR validado com export real): as linhas viram
// CICLOS DE POSIÇÃO 0→0 (ver reconstruct.ts). `rowTrades` guarda as linhas ANTES da reconstrução (auditoria e comparação).

import { CanonicalTradeSchema, issue, type CanonicalTrade, type Issue } from "../domain/canonical.ts"
import { DEFAULT_SOURCE_TIME_ZONE, inferDateOrder, type DateOrder, type SourceTzOrigin } from "../domain/time.ts"
import { buildCanonicalTrade } from "./build-trade.ts"
import { parseDelimited } from "./csv.ts"
import { ExitReasonMapError, validateExitReasonMap } from "./exit-reason.ts"
import { normalizeRecord, type EffectiveSettings } from "./normalizer.ts"
import { assignIdentity, buildImportRecord, rowHashOf } from "./identity.ts"
import { checkAccumulatedIntegrity, reconstructCycles, type LotRow } from "./reconstruct.ts"
import { DEFAULT_PARSERS, selectParser } from "./registry.ts"
import type { ImportContext, ParserDescriptor, PipelineResult, ReconstructionSummary, RejectedRow, SourceRecord } from "./types.ts"
import { validateTrade } from "./validator.ts"

const EMPTY_STATS = { rowsRead: 0, accepted: 0, rejected: 0, trades: 0, warnings: 0 }

interface Resolved extends EffectiveSettings {
  sourceTzOrigin: SourceTzOrigin
}

/**
 * Origem do fuso de UMA linha. Offset explícito no texto é a autoridade do instante (o `sourceTz` não participa),
 * então nunca pode parecer que foi interpretado pelo padrão: sem fuso usado e com offset ⇒ FILE_OFFSET.
 */
function rowSourceTzOrigin(resolved: SourceTzOrigin, t: CanonicalTrade): SourceTzOrigin {
  if (resolved === "USER") return "USER"
  const usedTz = t.entry.at.sourceTz !== null || t.exit.at.sourceTz !== null
  if (usedTz) return resolved
  const usedOffset = t.entry.at.explicitOffset || t.exit.at.explicitOffset
  return usedOffset ? "FILE_OFFSET" : resolved
}

/** Origem do ARQUIVO: DEFAULT se alguma linha dependeu do padrão; FILE_OFFSET só se TODAS as linhas se bastaram com o offset. */
function fileSourceTzOrigin(resolved: SourceTzOrigin, rows: CanonicalTrade[]): SourceTzOrigin {
  const origins = rows.map((t) => t.source.settings.sourceTzOrigin ?? resolved)
  if (origins.length > 0 && origins.every((o) => o === "FILE_OFFSET")) return "FILE_OFFSET"
  return resolved
}

function resolveSettings(ctx: ImportContext, d: ParserDescriptor, records: SourceRecord[]): Resolved {
  let dateOrder: DateOrder | null = ctx.dateOrder ?? d.defaults.dateOrder
  if (!dateOrder) {
    // Sem dica do usuário nem padrão do formato: decide pelo ARQUIVO inteiro; se for ambíguo, continua null
    // e as linhas ambíguas são rejeitadas (E_DATE_ORDER_REQUIRED) em vez de trocar dia/mês.
    const samples = records.flatMap((r) => [r.entryTime, r.exitTime, r.date]).filter((x): x is string => !!x)
    dateOrder = inferDateOrder(samples)
  }
  const userTz = ctx.sourceTz ?? null
  return {
    sourceTz: userTz ?? DEFAULT_SOURCE_TIME_ZONE,
    sourceTzOrigin: userTz ? "USER" : "DEFAULT",
    dateOrder,
    numberLocale: ctx.numberLocale ?? d.defaults.numberLocale,
    excursionUnit: ctx.excursionUnit !== undefined ? ctx.excursionUnit : d.defaults.excursionUnit,
    declaredPnlBasis: ctx.declaredPnlBasis ?? d.defaults.declaredPnlBasis,
    foldPolicy: ctx.foldPolicy ?? "EARLIER",
  }
}

export function runImportPipeline(text: string, ctx: ImportContext = {}, parsers: ParserDescriptor[] = DEFAULT_PARSERS): PipelineResult {
  const fileIssues: Issue[] = []
  const fail = (extra: Issue[]): PipelineResult => ({
    importRecord: null,
    parser: null,
    settings: null,
    trades: [],
    rowTrades: [],
    reconstruction: null,
    rejected: [],
    issues: [...fileIssues, ...extra],
    stats: { ...EMPTY_STATS },
  })

  try {
    validateExitReasonMap(ctx.exitReasonMap)
  } catch (e) {
    if (e instanceof ExitReasonMapError) return fail([issue("ERROR", e.code, e.message)])
    throw e
  }

  // 1) Raw → tabela
  const table = parseDelimited(text)
  fileIssues.push(...table.issues)
  if (table.headers.length === 0) return fail([])

  // 2) detecção do formato
  const sel = selectParser(table, parsers, ctx.forceParserId)
  if (!sel.ok) return fail([sel.issue])
  const { parser } = sel

  // 3) Parser (colunas → SourceRecord)
  const parsed = parser.parse(table)
  fileIssues.push(...parsed.issues)
  const settings = resolveSettings(ctx, parser, parsed.records)

  // 4) Normalizer → 5) Validator (uma linha da fonte = um trade-linha, SOURCE_ROW)
  const rowTrades: CanonicalTrade[] = []
  const lots: LotRow[] = []
  const rejected: RejectedRow[] = []
  const nctx = { descriptor: parser, settings: { ...settings }, fileName: ctx.fileName ?? null, fileHash: ctx.fileHash ?? null }

  for (const rec of parsed.records) {
    const n = normalizeRecord(rec, nctx)
    if (!n.draft || !n.meta) {
      rejected.push({ rowNo: rec.rowNo, issues: n.issues })
      continue
    }
    const built = buildCanonicalTrade(n.draft)
    // registra a ORIGEM do fuso no metadado da própria linha (auditável)
    const rowOrigin = rowSourceTzOrigin(settings.sourceTzOrigin, built)
    built.source = {
      ...built.source,
      settings: { ...built.source.settings, sourceTz: rowOrigin === "FILE_OFFSET" ? null : built.source.settings.sourceTz, sourceTzOrigin: rowOrigin },
    }
    const v = validateTrade(built)
    const all = [...n.issues, ...v.issues]
    const candidate: CanonicalTrade = { ...built, dataQuality: v.dataQuality, issues: all }
    if (all.some((i) => i.severity === "ERROR")) {
      rejected.push({ rowNo: rec.rowNo, issues: all })
      continue
    }
    const shape = CanonicalTradeSchema.safeParse(candidate)
    if (!shape.success) {
      rejected.push({
        rowNo: rec.rowNo,
        issues: [...all, issue("ERROR", "E_SCHEMA_INTERNAL", `Trade fora do contrato canônico: ${shape.error.issues[0]?.path.join(".")} — ${shape.error.issues[0]?.message}`, { rowNo: rec.rowNo })],
      })
      continue
    }
    rowTrades.push(shape.data)
    lots.push({ rowNo: rec.rowNo, trade: shape.data, meta: n.meta })
  }

  // 6) Reconstrução de ciclos de posição (opt-out; só nos formatos validados)
  let trades: CanonicalTrade[] = rowTrades
  let summary: ReconstructionSummary | null = null
  const reconstruct = parser.reconstruction !== undefined && ctx.reconstructCycles !== false
  if (reconstruct && lots.length > 0) {
    const rejectedRowNos = rejected.map((r) => r.rowNo)
    // com linhas rejeitadas o acumulado não fecha por construção: integridade indisponível (e os ciclos ficam de confiança baixa)
    const integ = rejectedRowNos.length > 0 ? { status: "UNAVAILABLE" as const, brokenRowNos: [] as number[] } : checkAccumulatedIntegrity(lots)
    if (integ.status === "BROKEN") {
      fileIssues.push(issue("WARNING", "W_ACCUMULATED_MISMATCH", `O acumulado ("Acu lucro líquido") não bate linha a linha (linhas ${integ.brokenRowNos.join(", ")}): pode haver linhas faltando; ciclos marcados de confiança baixa.`))
    }
    if (rejectedRowNos.length > 0) {
      fileIssues.push(issue("WARNING", "W_ROWS_REJECTED_BEFORE_RECONSTRUCTION", `${rejectedRowNos.length} linha(s) rejeitada(s) antes da reconstrução: ciclos podem estar incompletos (confiança baixa).`))
    }
    const rec = reconstructCycles(lots, { exitReasonMap: ctx.exitReasonMap, integrity: integ.status, brokenRowNos: integ.brokenRowNos, rejectedRowNos })
    const final: CanonicalTrade[] = []
    for (const t of [...rec.cycles, ...rec.passthrough]) {
      const shape = CanonicalTradeSchema.safeParse(t)
      if (shape.success) final.push(shape.data)
      else fileIssues.push(issue("ERROR", "E_SCHEMA_INTERNAL", `Ciclo fora do contrato canônico: ${shape.error.issues[0]?.path.join(".")} — ${shape.error.issues[0]?.message}`))
    }
    const instant = (t: CanonicalTrade) => (t.entry.at.instantUtc ? Date.parse(t.entry.at.instantUtc) : Date.parse(`${t.entry.at.localDate}T00:00:00.000Z`))
    final.sort((a, b) => instant(a) - instant(b) || (a.source.rowNo ?? 0) - (b.source.rowNo ?? 0))
    trades = final

    const counts = new Map<string, number>()
    for (const c of rec.cycles) for (const code of new Set((c.reconstruction?.ambiguities ?? []).map((a) => a.code))) counts.set(code, (counts.get(code) ?? 0) + 1)
    summary = {
      method: "NT8_ROW_INTERVALS_V1",
      rowsIn: lots.length,
      cyclesOut: rec.cycles.length,
      passthroughRows: rec.passthrough.length,
      integrity: integ.status,
      lowConfidenceCycles: rec.cycles.filter((c) => c.reconstruction?.confidence === "LOW").length,
      ambiguities: [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, count]) => ({ code, count })),
    }
  }

  // Fuso de origem: se foi o PADRÃO (não informado), isso é DITO — metadado auditável, nunca silencioso.
  const fileOrigin = fileSourceTzOrigin(settings.sourceTzOrigin, rowTrades)
  if (settings.sourceTzOrigin === "DEFAULT" && rowTrades.some((t) => t.entry.at.sourceTz !== null || t.exit.at.sourceTz !== null)) {
    fileIssues.push(issue("WARNING", "W_SOURCE_TZ_DEFAULTED", `Fuso de origem não informado: usado o fuso padrão configurado (${DEFAULT_SOURCE_TIME_ZONE}). Se o arquivo foi gerado em outro fuso, informe-o — os horários mudam.`))
  }
  if (rejected.length > 0 && rejected.every((r) => r.issues.some((i) => i.code === "E_DATE_ORDER_REQUIRED"))) {
    fileIssues.push(issue("ERROR", "E_DATE_ORDER_REQUIRED", "Não foi possível saber se as datas são dia/mês ou mês/dia. Informe a ordem do arquivo."))
  }

  // 7) Identidade determinística (Evidence E1): importId, rowHash, tradeId, account.ref. Só ADICIONA campos; valores intactos.
  const publicSettings = {
    sourceTz: fileOrigin === "FILE_OFFSET" ? null : settings.sourceTz,
    sourceTzOrigin: fileOrigin,
    dateOrder: settings.dateOrder,
    numberLocale: settings.numberLocale,
    excursionUnit: settings.excursionUnit,
    declaredPnlBasis: settings.declaredPnlBasis,
  }
  const importRecord = buildImportRecord({
    text,
    fileName: ctx.fileName ?? null,
    parser: { id: parser.id, version: parser.version },
    settings: publicSettings,
    reconstruction: summary,
    reconstructionEnabled: summary !== null,
    stats: { rowsRead: parsed.records.length, accepted: rowTrades.length, rejected: rejected.length },
    accountCount: new Set(parsed.records.map((r) => r.account?.trim()).filter((a): a is string => !!a)).size,
  })
  const salt = ctx.accountRefSalt ?? ""
  const rowHashByRowNo = new Map(lots.map((l) => [l.rowNo, rowHashOf(l, salt)]))
  const identity = { importId: importRecord.importId, rowHashByRowNo, salt }
  trades = assignIdentity(trades, identity)
  const identifiedRows = assignIdentity(rowTrades, identity)

  const warnings = trades.reduce((acc, t) => acc + t.issues.filter((i) => i.severity === "WARNING").length, 0)
  return {
    importRecord,
    parser: { id: parser.id, version: parser.version, platform: parser.platform, confidence: sel.confidence },
    settings: publicSettings,
    trades,
    rowTrades: identifiedRows,
    reconstruction: summary,
    rejected,
    issues: fileIssues,
    stats: { rowsRead: parsed.records.length, accepted: rowTrades.length, rejected: rejected.length, trades: trades.length, warnings },
  }
}
