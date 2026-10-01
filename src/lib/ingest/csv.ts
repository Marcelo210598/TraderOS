// Camada CSV/TSV do pipeline de ingestão: texto → tabela crua (sem semântica de plataforma).
// Substitui, para o domínio novo, os helpers que viviam dentro do componente de UI (importar-client.tsx):
// detectSep, splitLine, normalizeHeader, parseBRNumber. Diferenças: aspas com "" escapado, quebra de linha dentro
// de aspas, BOM, cabeçalho duplicado, e números com locale EXPLÍCITO (nada de adivinhar vírgula/ponto).

import { issue, type Issue } from "../domain/canonical.ts"

export interface CsvRow {
  /** Linha física no arquivo (cabeçalho = 1, primeira linha de dados = 2). */
  rowNo: number
  cells: string[]
  /** cabeçalho normalizado → valor (trim). */
  fields: Record<string, string>
}

export interface CsvTable {
  delimiter: string
  originalHeaders: string[]
  headers: string[]
  rows: CsvRow[]
  issues: Issue[]
}

/** "Preço entrada" → "preco_entrada"; "Market pos." → "market_pos"; "Taxa de Compensação" → "taxa_de_compensacao". */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

const CANDIDATES = ["\t", ";", ","] as const

function countOutsideQuotes(line: string, d: string): number {
  let inQ = false, n = 0
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === d && !inQ) n++
  }
  return n
}

export function detectDelimiter(headerLine: string): string {
  let best: string = ","
  let bestN = 0
  for (const d of CANDIDATES) {
    const n = countOutsideQuotes(headerLine, d)
    if (n > bestN) { best = d; bestN = n }
  }
  return best
}

interface RawRecord {
  cells: string[]
  /** Linha física (1-based) onde o registro COMEÇA — vale p/ mensagens de erro ao usuário. */
  line: number
}

/** Tokenizador RFC 4180: aspas, "" escapado, CRLF/LF, quebra de linha dentro de campo entre aspas. */
function tokenize(text: string, delimiter: string): RawRecord[] {
  const rows: RawRecord[] = []
  let row: string[] = []
  let field = ""
  let inQ = false
  let line = 1
  let startLine = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else {
        if (ch === "\n") line++
        field += ch
      }
      continue
    }
    if (ch === '"') inQ = true
    else if (ch === delimiter) { row.push(field); field = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field); field = ""
      rows.push({ cells: row, line: startLine }); row = []
      line++
      startLine = line
    } else field += ch
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push({ cells: row, line: startLine }) }
  return rows
}

export function parseDelimited(input: string): CsvTable {
  const issues: Issue[] = []
  const text = input.replace(/^﻿/, "")
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? ""
  const delimiter = detectDelimiter(firstLine)
  const all = tokenize(text, delimiter).filter((r) => r.cells.some((c) => c.trim() !== ""))
  if (all.length === 0) {
    return { delimiter, originalHeaders: [], headers: [], rows: [], issues: [issue("ERROR", "E_FILE_EMPTY", "Arquivo vazio.")] }
  }

  const originalHeaders = all[0].cells.map((h) => h.trim())
  const seen = new Map<string, number>()
  const headers = originalHeaders.map((h) => {
    const base = normalizeHeader(h) || "coluna"
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
  for (const [base, n] of seen) {
    if (n > 1) issues.push(issue("WARNING", "W_HEADER_DUPLICATE", `Cabeçalho repetido "${base}" (${n}×): usando o primeiro e renomeando os demais.`))
  }

  const rows: CsvRow[] = []
  all.slice(1).forEach(({ cells, line }) => {
    const rowNo = line
    if (cells.length !== headers.length) {
      issues.push(issue("WARNING", "W_ROW_COLUMN_MISMATCH", `Linha com ${cells.length} colunas (cabeçalho tem ${headers.length}).`, { rowNo }))
    }
    const fields: Record<string, string> = {}
    headers.forEach((h, idx) => { fields[h] = (cells[idx] ?? "").trim() })
    rows.push({ rowNo, cells, fields })
  })
  return { delimiter, originalHeaders, headers, rows, issues }
}

// ── Números ──────────────────────────────────────────────────────────────────

export type NumberLocale = "US" | "BR" | "AUTO"
export type NumberParse =
  | { ok: true; value: number }
  | { ok: false; code: "E_NUMBER_EMPTY" | "E_NUMBER_FORMAT" | "E_NUMBER_AMBIGUOUS"; message: string }

const bad = (code: "E_NUMBER_EMPTY" | "E_NUMBER_FORMAT" | "E_NUMBER_AMBIGUOUS", message: string): NumberParse => ({ ok: false, code, message })

/**
 * Número de planilha de corretora: "$ 1.234,56" (BR), "-$12.50" / "(123.45)" / "1,234.50" (US).
 * Locale EXPLÍCITO é validado de verdade: "134,20" em US é erro (não vira 13420 em silêncio).
 * AUTO só decide quando é inequívoco; "1,234" / "1.234" sozinhos são AMBÍGUOS.
 */
export function parseNumber(text: string | null | undefined, locale: NumberLocale = "AUTO"): NumberParse {
  const raw = (text ?? "").trim()
  if (!raw) return bad("E_NUMBER_EMPTY", "Número vazio.")
  let s = raw
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  s = s.replace(/US\$|R\$|USD|BRL|\$/gi, "").replace(/[\s ]+/g, "")
  if (/^[-−]/.test(s)) { negative = true; s = s.slice(1) }
  else if (s.startsWith("+")) s = s.slice(1)
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1) }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return bad("E_NUMBER_FORMAT", `Número inválido: "${raw}".`)

  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length
  let thousands: "," | "." | null = null
  let decimal: "," | "." | null = null

  if (locale === "US") { thousands = ","; decimal = "." }
  else if (locale === "BR") { thousands = "."; decimal = "," }
  else if (dots > 0 && commas > 0) {
    decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ","
    thousands = decimal === "." ? "," : "."
  } else if (commas > 0) {
    if (commas > 1) { thousands = "," }
    else if (/,\d{3}$/.test(s)) return bad("E_NUMBER_AMBIGUOUS", `"${raw}" é ambíguo (milhar US ou decimal BR). Informe o locale do arquivo.`)
    else decimal = ","
  } else if (dots > 0) {
    if (dots > 1) { thousands = "." }
    else if (/\.\d{3}$/.test(s)) return bad("E_NUMBER_AMBIGUOUS", `"${raw}" é ambíguo (milhar BR ou decimal US). Informe o locale do arquivo.`)
    else decimal = "."
  }

  // Validação estrutural: separador de milhar só em grupos de 3; no máximo um decimal.
  let intPart = s
  let fracPart = ""
  if (decimal) {
    const idx = s.lastIndexOf(decimal)
    if (idx !== -1) { intPart = s.slice(0, idx); fracPart = s.slice(idx + 1) }
  }
  if (decimal && s.split(decimal).length > 2) return bad("E_NUMBER_FORMAT", `Número inválido para o locale: "${raw}".`)
  if (fracPart && /[.,]/.test(fracPart)) return bad("E_NUMBER_FORMAT", `Número inválido para o locale: "${raw}".`)
  if (thousands && intPart.includes(thousands)) {
    if (!new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(intPart)) return bad("E_NUMBER_FORMAT", `Separador de milhar inválido para o locale: "${raw}".`)
    intPart = intPart.split(thousands).join("")
  } else if (/[.,]/.test(intPart)) {
    return bad("E_NUMBER_FORMAT", `Número inválido para o locale: "${raw}".`)
  }
  if (intPart === "" && fracPart === "") return bad("E_NUMBER_FORMAT", `Número inválido: "${raw}".`)
  const value = Number(`${intPart || "0"}${fracPart ? "." + fracPart : ""}`)
  if (!Number.isFinite(value)) return bad("E_NUMBER_FORMAT", `Número inválido: "${raw}".`)
  return { ok: true, value: negative ? -value : value }
}
