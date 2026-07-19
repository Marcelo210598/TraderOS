"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn, signedUsd } from "@/lib/utils"
import { ACCOUNT_OPTIONS, getAccountOption } from "@/lib/accounts"
import { CheckCircle, Loader2, Tag, AlertTriangle } from "lucide-react"

interface TradeSummary {
  id: string
  date: string
  instrument: string
  pnl: number
  accountLabel: string
}

interface Props {
  trades: TradeSummary[]
  totalCount: number
}

export function BulkLabelClient({ trades, totalCount }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetLabel, setTargetLabel] = useState("TEST")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyMode, setApplyMode] = useState<"selected" | "all">("all")

  function toggleAll() {
    if (selected.size === trades.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(trades.map((t) => t.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleApply() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const body = applyMode === "all"
        ? { accountLabel: targetLabel, applyToAll: true }
        : { accountLabel: targetLabel, tradeIds: Array.from(selected) }

      const res = await fetch("/api/trades/bulk-label", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar")
      setSuccess(data.updated)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setLoading(false)
    }
  }

  const targetOpt = getAccountOption(targetLabel)
  const applyCount = applyMode === "all" ? totalCount : selected.size

  return (
    <div className="space-y-5">
      {/* Feedback */}
      {success !== null && (
        <div className="flex items-center gap-3 bg-profit/10 border border-profit/30 rounded-xl p-4">
          <CheckCircle className="w-5 h-5 text-profit shrink-0" />
          <p className="text-sm font-semibold text-profit">{success} trades atualizados para <span className={targetOpt.color}>{targetOpt.label}</span></p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 bg-loss/10 border border-loss/30 rounded-xl p-4">
          <AlertTriangle className="w-4 h-4 text-loss shrink-0" />
          <p className="text-sm text-loss">{error}</p>
        </div>
      )}

      {/* Painel de ação */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        {/* Label alvo */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Atribuir conta</p>
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTargetLabel(opt.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all",
                  targetLabel === opt.value
                    ? cn(opt.bg, opt.border, opt.color)
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Modo de aplicação */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Aplicar em</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setApplyMode("all")}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-medium border transition-all",
                applyMode === "all"
                  ? "bg-teal/10 border-teal/30 text-teal"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Todos os trades ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setApplyMode("selected")}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-medium border transition-all",
                applyMode === "selected"
                  ? "bg-teal/10 border-teal/30 text-teal"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Selecionados ({selected.size})
            </button>
          </div>
        </div>

        {/* Botão aplicar */}
        <button
          onClick={handleApply}
          disabled={loading || applyCount === 0}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all",
            applyCount > 0 && !loading
              ? cn(targetOpt.bg, targetOpt.border, "border", targetOpt.color, "hover:opacity-80")
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Tag className="w-4 h-4" />}
          {loading ? "Aplicando..." : `Marcar ${applyCount} trade${applyCount !== 1 ? "s" : ""} como ${targetOpt.label}`}
        </button>
      </div>

      {/* Lista de trades com checkboxes (para modo selecionado) */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.size === trades.length && trades.length > 0}
              onChange={toggleAll}
              className="w-3.5 h-3.5 rounded accent-teal"
            />
            <span className="text-xs text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selecionado${selected.size !== 1 ? "s" : ""}` : "Selecionar todos"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{trades.length} trades carregados</span>
        </div>

        <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
          {trades.map((t) => {
            const opt = getAccountOption(t.accountLabel)
            return (
              <label
                key={t.id}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggleOne(t.id)}
                  className="w-3.5 h-3.5 rounded accent-teal shrink-0"
                />
                <span className="text-xs font-mono text-muted-foreground w-24 shrink-0">
                  {new Date(t.date).toLocaleDateString("pt-BR")}
                </span>
                <span className="text-xs font-mono font-semibold text-foreground w-12 shrink-0">{t.instrument}</span>
                <span className={cn("text-xs font-mono font-semibold flex-1", t.pnl >= 0 ? "text-profit" : "text-loss")}>
                  {signedUsd(t.pnl)}
                </span>
                <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded border shrink-0", opt.bg, opt.border, opt.color)}>
                  {opt.label}
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
