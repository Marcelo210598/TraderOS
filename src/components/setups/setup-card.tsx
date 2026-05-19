"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Trash2, Pencil, BarChart3, TrendingUp } from "lucide-react"
import type { Setup } from "@/lib/types"

interface SetupCardProps {
  setup: Setup
  onEdit: (setup: Setup) => void
  onDeleted: (id: string) => void
}

export function SetupCard({ setup, onEdit, onDeleted }: SetupCardProps) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Arquivar setup "${setup.name}"?`)) return
    setDeleting(true)
    await fetch(`/api/setups/${setup.id}`, { method: "DELETE" })
    onDeleted(setup.id)
    setDeleting(false)
  }

  const { stats } = setup

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-border/80 transition-all group">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4 text-teal" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{setup.name}</h3>
            {setup.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{setup.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(setup)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tags */}
      {setup.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {setup.tags.map((tag) => (
            <span key={tag} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Trades</p>
          <p className="text-base font-bold font-mono text-foreground mt-0.5">{stats.total}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
          <p className={cn("text-base font-bold font-mono mt-0.5", stats.winRate >= 50 ? "text-profit" : stats.total > 0 ? "text-loss" : "text-muted-foreground")}>
            {stats.total > 0 ? `${stats.winRate}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">P&L Total</p>
          <p className={cn("text-base font-bold font-mono mt-0.5", stats.totalPnl > 0 ? "text-profit" : stats.totalPnl < 0 ? "text-loss" : "text-muted-foreground")}>
            {stats.total > 0 ? `${stats.totalPnl >= 0 ? "+" : ""}$${Math.abs(stats.totalPnl).toFixed(0)}` : "—"}
          </p>
        </div>
      </div>

      {/* Regras */}
      {setup.rules && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Regras</p>
          <p className="text-xs text-foreground/70 leading-relaxed line-clamp-3 whitespace-pre-wrap">{setup.rules}</p>
        </div>
      )}
    </div>
  )
}
