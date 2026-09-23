"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Upload, Download, CheckCircle, XCircle, AlertTriangle, Loader2,
} from "lucide-react"
import { cn, signedUsd } from "@/lib/utils"
import { ACCOUNT_OPTIONS } from "@/lib/accounts"
import { pointValueFor } from "@/lib/instruments"
import { detectAccountLabel } from "@/lib/account-label"

// ── Tipos ──────────────────────────────────────────────────────────────────

type Platform = "traderos" | "ninjatrader" | "ninjatrader_ptbr" | "tradovate"

const PLATFORMS: { key: Platform; label: string; desc: string }[] = [
  { key: "traderos",         label: "Template MeuTrade", desc: "Formato nativo — baixe o template abaixo" },
  { key: "ninjatrader",      label: "NinjaTrader (EN)",  desc: "Trade Performance export (.csv)" },
  { key: "ninjatrader_ptbr", label: "NinjaTrader (PT-BR)", desc: "Grade de negociações em português" },
  { key: "tradovate",        label: "Tradovate",         desc: "Closed Positions export (.csv)" },
]

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
  mfe?: number | null
  mae?: number | null
  // Nome real da conta (ex: "Sim101", "PAAPEX-245678-01") — só vem preenchido em
  // formatos que trazem isso por linha (grade PT-BR). Usado pra criar/achar a
  // TradingAccount certa e detectar o tipo (TEST/EVAL/PA) automaticamente,
  // em vez de aplicar o mesmo rótulo escolhido manualmente pro arquivo inteiro.
  accountName?: string
  error?: string
}

// ── Template CSV (MeuTrade) ────────────────────────────────────────────────

const TEMPLATE_CSV = [
  "date,instrument,direction,entry_price,exit_price,quantity,pnl,commission,session,notes",
  "2025-01-15,NQ,LONG,19500.00,19550.00,1,250.00,4.06,AM,Bom trade seguindo o plano",
  "2025-01-16,ES,SHORT,5000.00,4990.00,2,500.00,8.12,PM,",
  "2025-01-17,NQ,LONG,19400.00,19380.00,1,-100.00,4.06,AM,Stop atingido",
].join("\n")

// ── Helpers de parsing ─────────────────────────────────────────────────────

function splitLine(line: string, sep: string): string[] {
  if (sep === "\t") return line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""))
  const result: string[] = []
  let inQuotes = false
  let current = ""
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue }
    // Era hardcoded pra "," — ignorava o "sep" recebido (ex: ";" no export BR do
    // NT8), então nunca quebrava a linha nos lugares certos quando o delimitador
    // real não era vírgula, e as vírgulas decimais dentro dos campos viravam
    // colunas fantasma.
    if (ch === sep && !inQuotes) { result.push(current); current = ""; continue }
    current += ch
  }
  result.push(current)
  return result
}

// Conta ocorrências de cada separador candidato e usa o mais frequente — cobre
// vírgula (padrão US), tab e ponto-e-vírgula (padrão de export BR do NT8, onde
// a vírgula já é usada como separador decimal e não dá pra usar de novo).
function detectSep(firstLine: string): string {
  const counts: [string, number][] = [
    ["\t", firstLine.split("\t").length],
    [";", firstLine.split(";").length],
    [",", firstLine.split(",").length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 1 ? counts[0][0] : ","
}

// NFD + remoção de marcas de acento ANTES de cortar não-[a-z] — sem isso "preço"
// virava "preo" e "saída" virava "sada" (a letra acentuada some, mas a consoante
// seguinte fica grudada errado). Com NFD, "preço" -> "preco", "saída" -> "saida".
function normalizeHeader(h: string): string {
  return h
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "")
}

// Números no formato BR: "$ 1.234,56" -> 1234.56. Remove símbolo de moeda e
// TODO espaço (inclusive o que o NT8 deixa entre "-" e o número, ex: "-$ 117,00"),
// remove pontos de milhar, troca a vírgula decimal por ponto.
function parseBRNumber(raw: string): number {
  const cleaned = raw
    .replace(/[$R]/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
  return parseFloat(cleaned)
}

// "16/09/2026 10:42:02" (dd/MM/yyyy, formato BR) -> "2026-09-16". Não reaproveita
// normalizeDate porque aquela função assume mm/dd/yyyy (padrão US/NinjaTrader EN)
// pro mesmo formato com barra — dia e mês ficariam trocados silenciosamente.
function parseBRDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return ""
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

function normalizeDate(raw: string): string {
  const t = raw.trim()
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10)
  // m/d/yyyy or mm/dd/yyyy (NinjaTrader / Tradovate)
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  return t
}

function inferSession(timeStr: string): "AM" | "PM" | "OVERNIGHT" {
  // Parse time from strings like "3/15/2025 9:30:00 AM" or "09:30"
  const upper = timeStr.toUpperCase()
  const isPM = upper.includes("PM")
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/)
  if (!timeMatch) return "AM"
  let hour = parseInt(timeMatch[1], 10)
  if (isPM && hour !== 12) hour += 12
  if (!isPM && hour === 12) hour = 0
  if (hour >= 9 && hour < 12) return "AM"
  if (hour >= 12 && hour < 17) return "PM"
  return "OVERNIGHT"
}

function stripContractExpiry(symbol: string): string {
  // NQH5 → NQ, ESM25 → ES, MNQU5 → MNQ
  return symbol.replace(/[A-Z]?\d{1,2}$/, "").trim() || symbol
}

function detectPlatform(headers: string[]): Platform {
  const h = headers.join(",")
  // "pos_mercado" só existe na grade do NT8 em português — checa antes da
  // variante EN pra não cair em "ninjatrader" por engano.
  if (h.includes("pos_mercado") || h.includes("preco_entrada") || h.includes("hora_entrada")) return "ninjatrader_ptbr"
  if (h.includes("market_pos") || h.includes("entry_time") || h.includes("exit_time")) return "ninjatrader"
  if (h.includes("bs") || h.includes("open_price") || h.includes("close_price") || h.includes("contract")) return "tradovate"
  return "traderos"
}

// ── Parser: MeuTrade template ──────────────────────────────────────────────

function parseMeuTrade(headers: string[], lines: string[], sep: string): ParsedRow[] {
  return lines.map((line, idx) => {
    const cols = splitLine(line, sep)
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
    if (!["LONG", "SHORT"].includes(direction)) errors.push("direção inválida (use LONG ou SHORT)")
    if (isNaN(entryPrice) || entryPrice <= 0) errors.push("entry_price inválido")
    if (isNaN(exitPrice) || exitPrice <= 0) errors.push("exit_price inválido")
    if (isNaN(quantity) || quantity <= 0) errors.push("quantity inválido")
    if (!["AM", "PM", "OVERNIGHT"].includes(sessionRaw)) errors.push("session inválido")

    return {
      rowNum, notes,
      date: normalizeDate(dateRaw),
      instrument,
      direction,
      entryPrice: isNaN(entryPrice) ? 0 : entryPrice,
      exitPrice: isNaN(exitPrice) ? 0 : exitPrice,
      quantity: isNaN(quantity) ? 1 : quantity,
      pnl: isNaN(pnl) ? 0 : pnl,
      commission: isNaN(commission) ? 0 : commission,
      session: ["AM", "PM", "OVERNIGHT"].includes(sessionRaw) ? sessionRaw : "AM",
      error: errors.length > 0 ? errors.join("; ") : undefined,
    }
  })
}

// ── Parser: NinjaTrader Trade Performance ─────────────────────────────────

function parseNinjaTrader(headers: string[], lines: string[], sep: string): ParsedRow[] {
  return lines.map((line, idx) => {
    const cols = splitLine(line, sep)
    const get = (name: string) => (cols[headers.indexOf(name)] ?? "").trim()
    const rowNum = idx + 2
    const errors: string[] = []

    const entryTime = get("entry_time")
    const instrument = stripContractExpiry(get("instrument").toUpperCase())
    const dirRaw = get("market_pos").toLowerCase()
    const direction = dirRaw === "long" ? "LONG" : dirRaw === "short" ? "SHORT" : ""
    const quantity = parseInt(get("quantity") || "1", 10)
    const entryPrice = parseFloat(get("entry_price"))
    const exitPrice = parseFloat(get("exit_price"))
    const pnl = parseFloat(get("profit") || "0")
    const commission = parseFloat(get("commission") || "0")
    const maeRaw = parseFloat(get("mae"))
    const mfeRaw = parseFloat(get("mfe"))

    if (!entryTime) errors.push("entry_time ausente")
    if (!instrument) errors.push("instrumento ausente")
    if (!["LONG", "SHORT"].includes(direction)) errors.push(`market_pos inválido: "${get("market_pos")}"`)
    if (isNaN(entryPrice) || entryPrice <= 0) errors.push("entry_price inválido")
    if (isNaN(exitPrice) || exitPrice <= 0) errors.push("exit_price inválido")
    if (isNaN(quantity) || quantity <= 0) errors.push("quantity inválido")

    return {
      rowNum,
      date: normalizeDate(entryTime),
      instrument,
      direction,
      entryPrice: isNaN(entryPrice) ? 0 : entryPrice,
      exitPrice: isNaN(exitPrice) ? 0 : exitPrice,
      quantity: isNaN(quantity) ? 1 : quantity,
      pnl: isNaN(pnl) ? 0 : pnl,
      commission: isNaN(commission) ? 0 : commission,
      session: inferSession(entryTime),
      notes: "",
      mfe: isNaN(mfeRaw) ? null : mfeRaw,
      mae: isNaN(maeRaw) ? null : maeRaw,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    }
  })
}

// ── Parser: NinjaTrader Grade de Negociações (PT-BR) ───────────────────────
// Colunas: Núm. Neg.;Ativo;Conta;Estratégia;Pos mercado.;Qtd;Preço entrada;
// Preço saída;Hora entrada;Hora saída;Entrada;Saída;Profit;Acu lucro líquido;
// Corretagem;Taxa de Compensação;Taxa de Bolsa;Taxa de IP;Taxa NFA;MAE;MFE;ETD;Barras
// Separador ";", decimal "," , valores em dólar tipo "$ 134,20", direção
// "Comprada"/"Venda", datas dd/MM/yyyy, MAE/MFE em DÓLAR (não em pontos —
// precisa dividir pelo valor do ponto do instrumento × quantidade).
function parseNinjaTraderGridPtBr(headers: string[], lines: string[], sep: string): ParsedRow[] {
  return lines.map((line, idx) => {
    const cols = splitLine(line, sep)
    const get = (name: string) => (cols[headers.indexOf(name)] ?? "").trim()
    const rowNum = idx + 2
    const errors: string[] = []

    const entryTimeRaw = get("hora_entrada")
    const ativo = get("ativo")
    const instrument = ativo.split(" ")[0].toUpperCase()
    const posRaw = get("pos_mercado").toLowerCase()
    const direction = posRaw.includes("compra") ? "LONG" : posRaw.includes("venda") ? "SHORT" : ""
    const quantity = parseInt(get("qtd") || "1", 10)
    const entryPrice = parseBRNumber(get("preco_entrada"))
    const exitPrice = parseBRNumber(get("preco_saida"))
    const pnl = parseBRNumber(get("profit") || "0")
    // Soma todas as taxas — corretagem sozinha subestimaria o custo real.
    const commission = ["corretagem", "taxa_de_compensacao", "taxa_de_bolsa", "taxa_de_ip", "taxa_nfa"]
      .reduce((sum, col) => {
        const v = parseBRNumber(get(col) || "0")
        return sum + (isNaN(v) ? 0 : v)
      }, 0)
    const accountName = get("conta")
    const estrategia = get("estrategia")

    // MAE/MFE vêm em dólar no export BR — converte pra pontos (mesma unidade
    // que o resto do app usa) dividindo pelo valor do ponto × quantidade.
    const pv = pointValueFor(instrument) * (quantity || 1)
    const maeDollar = parseBRNumber(get("mae") || "0")
    const mfeDollar = parseBRNumber(get("mfe") || "0")
    const mae = isNaN(maeDollar) || pv === 0 ? null : maeDollar / pv
    const mfe = isNaN(mfeDollar) || pv === 0 ? null : mfeDollar / pv

    if (!entryTimeRaw) errors.push("hora de entrada ausente")
    if (!instrument) errors.push("ativo ausente")
    if (!["LONG", "SHORT"].includes(direction)) errors.push(`pos. mercado inválida: "${get("pos_mercado")}"`)
    if (isNaN(entryPrice) || entryPrice <= 0) errors.push("preço de entrada inválido")
    if (isNaN(exitPrice) || exitPrice <= 0) errors.push("preço de saída inválido")
    if (isNaN(quantity) || quantity <= 0) errors.push("quantidade inválida")

    return {
      rowNum,
      date: parseBRDate(entryTimeRaw),
      instrument,
      direction,
      entryPrice: isNaN(entryPrice) ? 0 : entryPrice,
      exitPrice: isNaN(exitPrice) ? 0 : exitPrice,
      quantity: isNaN(quantity) ? 1 : quantity,
      pnl: isNaN(pnl) ? 0 : pnl,
      commission,
      session: inferSession(entryTimeRaw),
      notes: estrategia || "",
      mfe, mae,
      accountName: accountName || undefined,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    }
  })
}

// ── Parser: Tradovate Closed Positions ────────────────────────────────────
// Colunas: Account, Contract, Open date, Open price, Qty, Close date, Close price, PL Points, PL $, Commission

function parseTradovate(headers: string[], lines: string[], sep: string): ParsedRow[] {
  return lines.map((line, idx) => {
    const cols = splitLine(line, sep)
    const get = (name: string) => (cols[headers.indexOf(name)] ?? "").trim()
    const rowNum = idx + 2
    const errors: string[] = []

    // Tradovate uses "open_date" and "close_date", or "buy_date"/"sell_date"
    const openDate = get("open_date") || get("buy_date") || get("date")
    const contractRaw = get("contract") || get("symbol") || get("instrument")
    const instrument = stripContractExpiry(contractRaw.toUpperCase())

    // Direction: Tradovate indicates if it was a buy-open or sell-open via Qty sign or B/S column
    const bsRaw = get("bs") || get("buy_sell") || get("side")
    const direction = bsRaw.toUpperCase().startsWith("B") ? "LONG" : bsRaw.toUpperCase().startsWith("S") ? "SHORT" : ""

    const qtyRaw = parseInt(get("qty") || get("quantity") || "1", 10)
    const entryPrice = parseFloat(get("open_price") || get("avg_buy_price") || get("entry_price") || "0")
    const exitPrice = parseFloat(get("close_price") || get("avg_sell_price") || get("exit_price") || "0")
    const pnl = parseFloat(get("pl_") || get("realized_pl") || get("pnl") || get("profit") || "0")
    const commission = parseFloat(get("commission") || "0")

    if (!openDate) errors.push("data ausente (open_date)")
    if (!instrument) errors.push("instrumento ausente (contract)")
    if (!["LONG", "SHORT"].includes(direction)) errors.push(`B/S inválido: "${bsRaw}" (use B ou S)`)
    if (isNaN(entryPrice) || entryPrice <= 0) errors.push("open_price inválido")
    if (isNaN(exitPrice) || exitPrice <= 0) errors.push("close_price inválido")
    if (isNaN(qtyRaw) || qtyRaw <= 0) errors.push("qty inválido")

    return {
      rowNum,
      date: normalizeDate(openDate),
      instrument,
      direction,
      entryPrice: isNaN(entryPrice) ? 0 : entryPrice,
      exitPrice: isNaN(exitPrice) ? 0 : exitPrice,
      quantity: isNaN(qtyRaw) ? 1 : Math.abs(qtyRaw),
      pnl: isNaN(pnl) ? 0 : pnl,
      commission: isNaN(commission) ? 0 : commission,
      session: inferSession(openDate),
      notes: "",
      error: errors.length > 0 ? errors.join("; ") : undefined,
    }
  })
}

// ── Parser principal ──────────────────────────────────────────────────────

function parseCSV(text: string, forcePlatform?: Platform): { rows: ParsedRow[]; detected: Platform } {
  const rawLines = text.trim().split(/\r?\n/).filter(Boolean)
  if (rawLines.length < 2) return { rows: [], detected: "traderos" }

  const sep = detectSep(rawLines[0])
  const headers = rawLines[0].split(sep).map((h) => normalizeHeader(h))
  const dataLines = rawLines.slice(1).filter((l) => l.trim())

  const detected = forcePlatform ?? detectPlatform(headers)

  let rows: ParsedRow[]
  if (detected === "ninjatrader") {
    rows = parseNinjaTrader(headers, dataLines, sep)
  } else if (detected === "ninjatrader_ptbr") {
    rows = parseNinjaTraderGridPtBr(headers, dataLines, sep)
  } else if (detected === "tradovate") {
    rows = parseTradovate(headers, dataLines, sep)
  } else {
    rows = parseMeuTrade(headers, dataLines, sep)
  }

  return { rows, detected }
}

// O Journal filtra por padrao "Contas reais" (exclui TEST) — sem isso, importar
// pra uma conta tipo Sim101/TEST faz o "Ver Journal" abrir uma lista vazia e
// parecer que a importacao sumiu, quando na verdade so esta filtrada.
function journalContaParaLinhas(labels: Set<string>): string {
  if (labels.size !== 1) return "all"
  const [only] = labels
  if (only === "TEST" || only === "EVAL") return only
  if (only.startsWith("PA")) return "PA"
  return "reais"
}

// ── Componente principal ──────────────────────────────────────────────────

export function ImportarClient() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [platform, setPlatform] = useState<Platform>("traderos")
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: number; conta: string } | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [importAccount, setImportAccount] = useState("PA")
  // Guarda o texto bruto do arquivo pra poder reprocessar sem novo upload
  // quando o usuário clica manualmente numa plataforma diferente da detectada.
  const [rawText, setRawText] = useState<string | null>(null)

  const validRows = rows?.filter((r) => !r.error) ?? []
  const errorRows = rows?.filter((r) => r.error) ?? []

  // Contas detectadas por linha (só formatos que trazem "Conta" por trade, ex:
  // grade PT-BR do NT8) — agrupa nome real -> rótulo TEST/EVAL/PA inferido.
  const detectedAccounts = Array.from(
    new Set(validRows.map((r) => r.accountName).filter((n): n is string => !!n))
  ).map((name) => ({ name, label: detectAccountLabel(name) }))

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setRawText(text)
      // Sem forcePlatform aqui — deixa a auto-detecção real rodar, e sincroniza
      // o botão de plataforma ativo com o que foi detectado (antes o forcePlatform
      // sempre usava a aba já selecionada, tornando a detecção morta na prática).
      const { rows: parsed, detected } = parseCSV(text)
      setRows(parsed)
      setPlatform(detected)
      setResult(null)
      setApiError(null)
    }
    reader.readAsText(file)
  }

  function handlePlatformChange(key: Platform) {
    setPlatform(key)
    if (rawText) {
      const { rows: parsed } = parseCSV(rawText, key)
      setRows(parsed)
    } else {
      setRows(null)
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "meutrade-import-template.csv"
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
          trades: validRows.map((r) => ({
            ...r,
            // Linha com conta real detectada (grade PT-BR do NT8) usa ela pra
            // resolver a TradingAccount no servidor; senão cai no seletor manual.
            accountLabel: r.accountName ? undefined : importAccount,
            accountName: r.accountName,
            source: r.accountName ? "NINJATRADER" : undefined,
            mfe: r.mfe ?? null,
            mae: r.mae ?? null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro ao importar")
      const labelsUsed = new Set(
        validRows.map((r) => (r.accountName ? detectAccountLabel(r.accountName) : importAccount))
      )
      setResult({
        imported: data.imported,
        errors: data.errors ?? 0,
        conta: journalContaParaLinhas(labelsUsed),
      })
      setRows(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Erro desconhecido")
    } finally {
      setLoading(false)
    }
  }

  const currentPlatformInfo = PLATFORMS.find((p) => p.key === platform)!

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
            onClick={() => router.push(`/journal?conta=${result.conta}`)}
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

      {/* Seletor de plataforma */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Plataforma de origem</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePlatformChange(p.key)}
              className={cn(
                "flex flex-col gap-0.5 px-4 py-3 rounded-xl border text-left transition-all",
                platform === p.key
                  ? "bg-teal/10 border-teal/40 text-teal"
                  : "border-border text-muted-foreground hover:border-teal/30 hover:text-foreground"
              )}
            >
              <span className="text-xs font-semibold">{p.label}</span>
              <span className="text-[10px] opacity-70">{p.desc}</span>
            </button>
          ))}
        </div>

        {/* Colunas esperadas */}
        {platform === "traderos" && (
          <div className="bg-muted/40 rounded-lg p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Colunas obrigatórias</p>
            <p className="text-xs font-mono text-foreground/80">date · instrument · direction · entry_price · exit_price · quantity · pnl</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-2">Opcionais</p>
            <p className="text-xs font-mono text-foreground/80">commission · session (AM/PM/OVERNIGHT) · notes</p>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 mt-2 text-xs text-teal hover:underline"
            >
              <Download className="w-3 h-3" />
              Baixar template
            </button>
          </div>
        )}

        {platform === "ninjatrader" && (
          <div className="bg-muted/40 rounded-lg p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Colunas detectadas automaticamente</p>
            <p className="text-xs font-mono text-foreground/80">Instrument · Market pos. · Quantity · Entry price · Exit price · Entry time · Profit · Commission · MAE · MFE</p>
            <p className="text-[10px] text-yellow-400/80 mt-2">
              ⚠ No NinjaTrader: abra a janela Trade Performance → clique em Export → Save as CSV
            </p>
          </div>
        )}

        {platform === "tradovate" && (
          <div className="bg-muted/40 rounded-lg p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Colunas detectadas automaticamente</p>
            <p className="text-xs font-mono text-foreground/80">Contract · Open date · Open price · Close price · Qty · B/S · PL $ · Commission</p>
            <p className="text-[10px] text-yellow-400/80 mt-2">
              ⚠ No Tradovate: vá em Closed Positions → Export → Download CSV
            </p>
          </div>
        )}

        {platform === "ninjatrader_ptbr" && (
          <div className="bg-muted/40 rounded-lg p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Colunas detectadas automaticamente</p>
            <p className="text-xs font-mono text-foreground/80">Ativo · Conta · Pos mercado · Qtd · Preço entrada/saída · Hora entrada/saída · Profit · Corretagem/Taxas · MAE · MFE</p>
            <p className="text-[10px] text-yellow-400/80 mt-2">
              ⚠ No NinjaTrader: aba Contas/Ordens → clique com botão direito na grade → Exportar
            </p>
          </div>
        )}
      </div>

      {/* Conta dos trades */}
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
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Upload — <span className="text-teal">{currentPlatformInfo.label}</span>
        </h2>
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

      {/* Contas detectadas — só aparece em formatos com "Conta" por linha (grade PT-BR do NT8).
          Cada trade dessas contas vai automaticamente pra sua própria TradingAccount,
          ignorando o seletor manual "Conta dos trades" acima (que é o fallback pros
          formatos sem essa coluna). */}
      {detectedAccounts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Contas detectadas no arquivo</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Cada conta abaixo vai ser criada/atualizada separadamente — ideal pra separar Sim/teste da avaliação e da conta aprovada (PA)
          </p>
          <div className="flex flex-wrap gap-2">
            {detectedAccounts.map((acc) => (
              <span
                key={acc.name}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border bg-muted/30"
              >
                <span className="font-mono text-foreground">{acc.name}</span>
                <span className="font-mono font-semibold text-teal">→ {acc.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Preview vazio */}
      {rows && rows.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma linha encontrada. Verifique se o CSV está no formato <strong>{currentPlatformInfo.label}</strong>.
          </p>
        </div>
      )}

      {/* Preview */}
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
                {validRows.some((r) => r.mfe != null) && (
                  <span className="text-teal"> · MFE/MAE detectados</span>
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
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.rowNum} className={cn("transition-colors", row.error ? "bg-loss/5" : "hover:bg-muted/20")}>
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
                      {signedUsd(row.pnl, 2)}
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
