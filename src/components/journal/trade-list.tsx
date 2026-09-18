"use client"

import { useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { TradeCard } from "./trade-card"
import { ChevronLeft, ChevronRight, ListChecks, Trash2, X, Loader2 } from "lucide-react"
import type { PaginatedTrades } from "@/lib/types"
import { cn, signedUsd } from "@/lib/utils"

interface TradeListProps {
  initial: PaginatedTrades
}

export function TradeList({ initial }: TradeListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // O componente pai passa `key={JSON.stringify(searchParams)}`, então ao trocar
  // de página/filtro o React remonta este componente do zero — `initial` chega
  // sempre atualizado, sem precisar resincronizar via efeito.
  const [data, setData] = useState(initial)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  function handleDeleted(id: string) {
    setData((prev) => ({
      ...prev,
      trades: prev.trades.filter((t) => t.id !== id),
      pagination: { ...prev.pagination, total: prev.pagination.total - 1 },
    }))
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggleSelectMode() {
    setSelectMode((prev) => !prev)
    setSelected(new Set())
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllOnPage() {
    setSelected((prev) =>
      prev.size === data.trades.length ? new Set() : new Set(data.trades.map((t) => t.id))
    )
  }

  async function handleBulkDelete() {
    if (selected.size === 0 || bulkDeleting) return
    if (!confirm(`Apagar ${selected.size} trade${selected.size !== 1 ? "s" : ""} selecionado${selected.size !== 1 ? "s" : ""}? Essa ação não pode ser desfeita.`)) return
    setBulkDeleting(true)
    try {
      const res = await fetch("/api/trades/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeIds: Array.from(selected) }),
      })
      if (res.ok) {
        setData((prev) => ({
          ...prev,
          trades: prev.trades.filter((t) => !selected.has(t.id)),
          pagination: { ...prev.pagination, total: prev.pagination.total - selected.size },
        }))
        setSelected(new Set())
        setSelectMode(false)
      }
    } finally {
      setBulkDeleting(false)
    }
  }

  const { trades, pagination } = data

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="text-muted-foreground/35">
          <svg viewBox="0 0 100 80" fill="none" className="w-24 h-20" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="12" width="38" height="56" rx="3" fill="currentColor" opacity="0.1"/>
            <rect x="8" y="12" width="38" height="56" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.2"/>
            <rect x="54" y="12" width="38" height="56" rx="3" fill="currentColor" opacity="0.1"/>
            <rect x="54" y="12" width="38" height="56" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.2"/>
            <line x1="46" y1="12" x2="46" y2="68" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.25"/>
            <line x1="16" y1="30" x2="38" y2="30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
            <line x1="16" y1="40" x2="38" y2="40" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
            <line x1="16" y1="50" x2="28" y2="50" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
            <line x1="62" y1="30" x2="84" y2="30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
            <line x1="62" y1="40" x2="84" y2="40" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
            <line x1="62" y1="50" x2="74" y2="50" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Nenhum trade encontrado</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Ainda não tem trades com esses filtros, ou registre seu primeiro trade clicando em &ldquo;Novo Trade&rdquo;.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground gap-3 flex-wrap">
        <span>
          {pagination.total} trade{pagination.total !== 1 ? "s" : ""}
          {pagination.pages > 1 && ` — página ${pagination.page} de ${pagination.pages}`}
        </span>
        <div className="flex items-center gap-3">
          {!selectMode && (
            <>
              <span className="text-profit">
                {trades.filter((t) => t.result === "WIN").length} wins
              </span>
              <span className="text-loss">
                {trades.filter((t) => t.result === "LOSS").length} losses
              </span>
              <span className="font-mono font-medium">
                {(() => {
                  const total = trades.reduce((acc, t) => acc + Number(t.pnl), 0)
                  return (
                    <span className={total >= 0 ? "text-profit" : "text-loss"}>
                      {signedUsd(total)}
                    </span>
                  )
                })()}
              </span>
            </>
          )}
          <button
            onClick={toggleSelectMode}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {selectMode ? <X className="w-3.5 h-3.5" /> : <ListChecks className="w-3.5 h-3.5" />}
            {selectMode ? "Cancelar" : "Selecionar"}
          </button>
        </div>
      </div>

      {/* Barra de acao em lote */}
      {selectMode && (
        <div className="flex items-center justify-between gap-3 bg-card border border-border rounded-xl px-4 py-2.5 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === trades.length && trades.length > 0}
              onChange={toggleSelectAllOnPage}
              className="w-3.5 h-3.5 rounded accent-teal"
            />
            {selected.size > 0
              ? `${selected.size} selecionado${selected.size !== 1 ? "s" : ""}`
              : `Selecionar todos nesta página (${trades.length})`}
          </label>
          <button
            onClick={handleBulkDelete}
            disabled={selected.size === 0 || bulkDeleting}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
              selected.size > 0 && !bulkDeleting
                ? "bg-loss/10 text-loss hover:bg-loss/20"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Apagar selecionados
          </button>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {trades.map((trade) => (
          <TradeCard
            key={trade.id}
            trade={trade}
            onDeleted={handleDeleted}
            selectMode={selectMode}
            selected={selected.has(trade.id)}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      {/* Paginação */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => goToPage(pagination.page - 1)}
            disabled={pagination.page === 1}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {Array.from({ length: Math.min(pagination.pages, 7) }, (_, i) => {
            const page = i + 1
            return (
              <button
                key={page}
                onClick={() => goToPage(page)}
                className={`w-8 h-8 rounded-lg text-xs font-mono transition-colors ${
                  page === pagination.page
                    ? "bg-teal text-teal-foreground font-bold"
                    : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {page}
              </button>
            )
          })}

          <button
            onClick={() => goToPage(pagination.page + 1)}
            disabled={pagination.page === pagination.pages}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
