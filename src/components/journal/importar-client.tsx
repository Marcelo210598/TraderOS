"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Upload,
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ACCOUNT_OPTIONS } from "@/lib/accounts"

const TEMPLATE_CSV = [
  "date,instrument,direction,entry_price,exit_price,quantity,pnl,commission,session,notes",
  "2025-01-15,NQ,LONG,19500.00,19550.00,1,250.00,4.06,AM,Bom trade seguindo o plano",
  "2025-01-16,ES,SHORT,5000.00,4990.00,2,500.00,8.12,PM,",
  "2025-01-17,NQ,LONG,19400.00,19380.00,1,-100.00,4.06,AM,Stop atingido",
].join("\n")

interface ParsedRow {
  rowNum: number
  date: string
  instrument: string
  direction: string
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  commission: number
  session: string
  notes: string
  error?: string
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []
  let inQuotes = false
  let current = ""
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === "," && !inQuotes) { result.push(current); current = ""; continue }
    current += ch
  }
  result.push(current)
  return result
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.substring(0, 10)
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  return trimmed
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []

  const headers = lines[0].split(",").map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "")
  )

  return lines.slice(1).map((line, idx) => {
    const cols = splitCSVLine(line)
    const get = (name: string) => (cols[headers.indexOf(name)] ?? "").trim()

    const rowNum = idx + 2
    const errors: string[] = []

    const dateRaw = get("date")
    const instrument = get("instrument").toUpperCase()
    const direction = get("direction").toUpperCase()
    const entryPrice = parseFloat(get("entry_price"))
    const exitPrice = parseFloat(get("exit_price"))
    const quantity = parseInt(get("quantity") || "1", 10)
    const pnl = parseFloat(get("pnl") || "0")
    const commission = parseFloat(get("commission") || "0")
    const sessionRaw = get("session").toUpperCase() || "AM"
    const notes = get("notes")

    if (!dateRaw) errors.push("data ausente")
    if (!instrument) errors.push("instrumento ausente")
    if (!["LONG", "SHORT"].includes(direction)) errors.push(`direção inválida (use LONG ou SHORT)`)
    if (isNaN(entryPrice) || entryPrice <= 0) errors.push("entry_price inválido")
    if (isNaN(exitPrice) || exitPrice <= 0) errors.push("exit_price inválido")
    if (isNaN(quantity) || quantity <= 0) errors.push("quantity inválido")
    if (!["AM", "PM", "OVERNIGHT"].includes(sessionRaw)) errors.push("session inválido (use AM, PM ou OVERNIGHT)")

    return {
      rowNum,
      date: normalizeDate(dateRaw),
      instrument,
      direction,
      entryPrice: isNaN(entryPrice) ? 0 : entryPrice,
      exitPrice: isNaN(exitPrice) ? 0 : exitPrice,
      quantity: isNaN(quantity) ? 1 : quantity,
      pnl: isNaN(pnl) ? 0 : pnl,
      commission: isNaN(commission) ? 0 : commission,
      session: ["AM", "PM", "OVERNIGHT"].includes(sessionRaw) ? sessionRaw : "AM",
      notes,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    }
  })
}

export function ImportarClient() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: number } | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [importAccount, setImportAccount] = useState("PA")

  const validRows = rows?.filter((r) => !r.error) ?? []
  const errorRows = rows?.filter((r) => r.error) ?? []

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setRows(parseCSV(text))
      setResult(null)
      setApiError(null)
    }
    reader.readAsText(file)
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "traderos-import-template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport() {
    if (validRows.length === 0 || loading) return
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch("/api/trades/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trades: validRows.map((r) => ({ ...r, accountLabel: importAccount })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro ao importar")
      setResult({ imported: data.imported, errors: data.errors ?? 0 })
      setRows(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Erro desconhecido")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Sucesso */}
      {result && (
        <div className="flex items-center gap-3 bg-profit/10 border border-profit/30 rounded-xl p-4">
          <CheckCircle className="w-5 h-5 text-profit shrink-0" />
          <div>
            <p className="text-sm font-semibold text-profit">
              {result.imported} trade{result.imported !== 1 ? "s" : ""} importado{result.imported !== 1 ? "s" : ""} com sucesso!
            </p>
            {result.errors > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {result.errors} linha{result.errors !== 1 ? "s" : ""} ignorada{result.errors !== 1 ? "s" : ""} por erro
              </p>
            )}
          </div>
          <button
            onClick={() => router.push("/journal")}
            className="ml-auto text-xs text-profit hover:underline shrink-0"
          >
            Ver Journal →
          </button>
        </div>
      )}

      {/* Erro de API */}
      {apiError && (
        <div className="flex items-center gap-3 bg-loss/10 border border-loss/30 rounded-xl p-4">
          <XCircle className="w-5 h-5 text-loss shrink-0" />
          <p className="text-sm text-loss">{apiError}</p>
        </div>
      )}

      {/* Instruções + template */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Como importar</h2>
        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-teal/20 text-teal text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
            Baixe o template CSV abaixo
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-teal/20 text-teal text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
            Preencha com seus trades (não altere os cabeçalhos)
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-teal/20 text-teal text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
            Faça upload do arquivo preenchido
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-teal/20 text-teal text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">4</span>
            Confira o preview e clique em Importar
          </li>
        </ol>

        <div className="bg-muted/40 rounded-lg p-3 space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Colunas obrigatórias</p>
          <p className="text-xs font-mono text-foreground/80">
            date · instrument · direction · entry_price · exit_price · quantity · pnl
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-2">Opcionais (padrão)</p>
          <p className="text-xs font-mono text-foreground/80">
            commission (0) · session (AM) · notes (vazio)
          </p>
        </div>

        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-teal/40 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar template CSV
        </button>
      </div>

      {/* Conta do import */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-1">Conta dos trades</h2>
        <p className="text-xs text-muted-foreground mb-3">Todos os trades do arquivo serão marcados com esta conta</p>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setImportAccount(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all",
                importAccount === opt.value
                  ? cn(opt.bg, opt.border, opt.color)
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Upload */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Upload do arquivo</h2>
        <label className="flex flex-col items-center gap-3 border-2 border-dashed border-border hover:border-teal/40 rounded-xl p-8 cursor-pointer transition-colors group">
          <Upload className="w-7 h-7 text-muted-foreground group-hover:text-teal transition-colors" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Clique para selecionar o arquivo</p>
            <p className="text-xs text-muted-foreground mt-0.5">Apenas arquivos .csv</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
          />
        </label>
      </div>

      {/* Preview */}
      {rows && rows.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma linha encontrada. Verifique se o CSV está no formato correto.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Preview — {rows.length} linha{rows.length !== 1 ? "s" : ""}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="text-profit">{validRows.length} válida{validRows.length !== 1 ? "s" : ""}</span>
                {errorRows.length > 0 && (
                  <span className="text-loss"> · {errorRows.length} com erro (serão ignoradas)</span>
                )}
              </p>
            </div>
            <button
              onClick={handleImport}
              disabled={loading || validRows.length === 0}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all shrink-0",
                validRows.length > 0 && !loading
                  ? "bg-teal text-background hover:bg-teal/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Upload className="w-3.5 h-3.5" />}
              {loading ? "Importando..." : `Importar ${validRows.length} trades`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["#", "Data", "Instrumento", "Dir.", "Entrada", "Saída", "Qtd", "P&L", "Sessão", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr
                    key={row.rowNum}
                    className={cn("transition-colors", row.error ? "bg-loss/5" : "hover:bg-muted/20")}
                  >
                    <td className="px-3 py-2 font-mono text-muted-foreground">{row.rowNum}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{row.date || "—"}</td>
                    <td className="px-3 py-2 font-mono font-medium">{row.instrument || "—"}</td>
                    <td className={cn("px-3 py-2 font-mono font-semibold", row.direction === "LONG" ? "text-profit" : row.direction === "SHORT" ? "text-loss" : "text-muted-foreground")}>
                      {row.direction || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{row.entryPrice || "—"}</td>
                    <td className="px-3 py-2 font-mono">{row.exitPrice || "—"}</td>
                    <td className="px-3 py-2 font-mono">{row.quantity || "—"}</td>
                    <td className={cn("px-3 py-2 font-mono font-semibold", row.pnl >= 0 ? "text-profit" : "text-loss")}>
                      {row.pnl >= 0 ? "+" : ""}${row.pnl.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.session}</td>
                    <td className="px-3 py-2">
                      {row.error ? (
                        <div className="flex items-start gap-1 text-loss">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                          <span className="text-[10px] leading-tight">{row.error}</span>
                        </div>
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 text-profit" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
