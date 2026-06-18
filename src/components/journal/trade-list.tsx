"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { TradeCard } from "./trade-card"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { PaginatedTrades } from "@/lib/types"

interface TradeListProps {
  initial: PaginatedTrades
}

export function TradeList({ initial }: TradeListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [data, setData] = useState(initial)

  // Resincroniza quando o servidor manda novos trades (troca de pagina/filtro).
  // Sem isso, o useState fica preso no `initial` da 1a render -> paginacao travava na pagina 1.
  useEffect(() => { setData(initial) }, [initial])

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
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {pagination.total} trade{pagination.total !== 1 ? "s" : ""}
          {pagination.pages > 1 && ` — página ${pagination.page} de ${pagination.pages}`}
        </span>
        <div className="flex gap-3">
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
                  {total >= 0 ? "+" : ""}${total.toFixed(0)}
                </span>
              )
            })()}
          </span>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {trades.map((trade) => (
          <TradeCard key={trade.id} trade={trade} onDeleted={handleDeleted} />
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
