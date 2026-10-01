// Pipeline de ingestão (Incremento 1): texto bruto → CanonicalTrade[] (+ issues por linha e por arquivo).
//   Raw → Parser → Normalizer → Validator → Canonical Trade
// Puro: sem banco, sem rede, sem Prisma. A gravação (e a UI de preview) entram em incrementos posteriores.

import { CanonicalTradeSchema, issue, type CanonicalTrade, type Issue } from "../domain/canonical.ts"
import { inferDateOrder, type DateOrder } from "../domain/time.ts"
import { buildCanonicalTrade } from "./build-trade.ts"
import { parseDelimited } from "./csv.ts"
import { normalizeRecord, type EffectiveSettings } from "./normalizer.ts"
import { DEFAULT_PARSERS, selectParser } from "./registry.ts"
import type { ImportContext, ParserDescriptor, PipelineResult, RejectedRow, SourceRecord } from "./types.ts"
import { validateTrade } from "./validator.ts"

const EMPTY_STATS = { rowsRead: 0, accepted: 0, rejected: 0, warnings: 0 }

function resolveSettings(ctx: ImportContext, d: ParserDescriptor, records: SourceRecord[]): EffectiveSettings {
  let dateOrder: DateOrder | null = ctx.dateOrder ?? d.defaults.dateOrder
  if (!dateOrder) {
    // Sem dica do usuário nem padrão do formato: decide pelo ARQUIVO inteiro; se for ambíguo, continua null
    // e as linhas ambíguas são rejeitadas (E_DATE_ORDER_REQUIRED) em vez de trocar dia/mês.
    const samples = records.flatMap((r) => [r.entryTime, r.exitTime, r.date]).filter((x): x is string => !!x)
    dateOrder = inferDateOrder(samples)
  }
  return {
    sourceTz: ctx.sourceTz ?? null,
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
    parser: null,
    settings: null,
    trades: [],
    rejected: [],
    issues: [...fileIssues, ...extra],
    stats: { ...EMPTY_STATS },
  })

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

  // 4) Normalizer → 5) Validator
  const trades: CanonicalTrade[] = []
  const rejected: RejectedRow[] = []
  const nctx = { descriptor: parser, settings, fileName: ctx.fileName ?? null, fileHash: ctx.fileHash ?? null }

  for (const rec of parsed.records) {
    const n = normalizeRecord(rec, nctx)
    if (!n.draft) {
      rejected.push({ rowNo: rec.rowNo, issues: n.issues })
      continue
    }
    const built = buildCanonicalTrade(n.draft)
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
    trades.push(shape.data)
  }

  // Resumo de arquivo: se TODAS as linhas caíram por falta de fuso, diz isso uma vez, claramente.
  if (rejected.length > 0 && rejected.every((r) => r.issues.some((i) => i.code === "E_TZ_REQUIRED"))) {
    fileIssues.push(issue("ERROR", "E_TZ_REQUIRED", "Informe o fuso em que o arquivo foi exportado (ex.: America/Sao_Paulo). Os horários do arquivo não trazem fuso e não vamos assumir um."))
  }
  if (rejected.length > 0 && rejected.every((r) => r.issues.some((i) => i.code === "E_DATE_ORDER_REQUIRED"))) {
    fileIssues.push(issue("ERROR", "E_DATE_ORDER_REQUIRED", "Não foi possível saber se as datas são dia/mês ou mês/dia. Informe a ordem do arquivo."))
  }

  const warnings = trades.reduce((acc, t) => acc + t.issues.filter((i) => i.severity === "WARNING").length, 0)
  return {
    parser: { id: parser.id, version: parser.version, platform: parser.platform, confidence: sel.confidence },
    settings: {
      sourceTz: settings.sourceTz,
      dateOrder: settings.dateOrder,
      numberLocale: settings.numberLocale,
      excursionUnit: settings.excursionUnit,
      declaredPnlBasis: settings.declaredPnlBasis,
    },
    trades,
    rejected,
    issues: fileIssues,
    stats: { rowsRead: parsed.records.length, accepted: trades.length, rejected: rejected.length, warnings },
  }
}
