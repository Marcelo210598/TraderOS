"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback } from "react"
import { cn } from "@/lib/utils"
import type { Setup } from "@/lib/types"

const RESULTS = [
  { value: "", label: "Todos" },
  { value: "WIN", label: "✅ Win" },
  { value: "LOSS", label: "❌ Loss" },
  { value: "BREAKEVEN", label: "➖ BE" },
]

const INSTRUMENTS = ["", "NQ", "ES", "MNQ", "MES", "YM", "RTY", "CL", "GC"]

interface TradeFiltersProps {
  setups: Setup[]
  tags?: string[]
}

export function TradeFilters({ setups, tags = [] }: TradeFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete("page")
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const current = {
    result: searchParams.get("result") ?? "",
    instrument: searchParams.get("instrument") ?? "",
    setupId: searchParams.get("setupId") ?? "",
    tag: searchParams.get("tag") ?? "",
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  }

  const hasFilters = Object.values(current).some(Boolean)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Resultado */}
      <div className="flex rounded-lg border border-border overflow-hidden bg-card">
        {RESULTS.map((r) => (
          <button
            key={r.value}
            onClick={() => updateFilter("result", r.value)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              current.result === r.value
                ? "bg-accent text-teal"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Ativo */}
      <select
        value={current.instrument}
        onChange={(e) => updateFilter("instrument", e.target.value)}
        className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Todos os ativos</option>
        {INSTRUMENTS.filter(Boolean).map((i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>

      {/* Setup */}
      {setups.length > 0 && (
        <select
          value={current.setupId}
          onChange={(e) => updateFilter("setupId", e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Todos os setups</option>
          {setups.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Tag */}
      {tags.length > 0 && (
        <select
          value={current.tag}
          onChange={(e) => updateFilter("tag", e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Todas as tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}

      {/* Data de/até */}
      <input
        type="date"
        value={current.from}
        onChange={(e) => updateFilter("from", e.target.value)}
        className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        title="De"
      />
      <input
        type="date"
        value={current.to}
        onChange={(e) => updateFilter("to", e.target.value)}
        className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        title="Até"
      />

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Limpar filtros ×
        </button>
      )}
    </div>
  )
}
