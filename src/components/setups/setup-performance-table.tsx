"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash2 } from "lucide-react"
import type { Setup } from "@/lib/types"

type SortKey = "name" | "total" | "winRate" | "avgPnl" | "profitFactor" | "totalPnl"
type SortDir = "asc" | "desc"

interface Props {
  setups: Setup[]
  onEdit: (setup: Setup) => void
  onDeleted: (id: string) => void
}

const COLS: { key: SortKey; label: string; align: string }[] = [
  { key: "name",         label: "Setup",          align: "text-left" },
  { key: "total",        label: "Trades",          align: "text-right" },
  { key: "winRate",      label: "Win %",           align: "text-right" },
  { key: "avgPnl",       label: "Avg P&L",         align: "text-right" },
  { key: "profitFactor", label: "Profit Factor",   align: "text-right" },
  { key: "totalPnl",     label: "P&L Total",       align: "text-right" },
]

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/50" />
  return dir === "asc"
    ? <ChevronUp className="w-3 h-3 text-teal" />
    : <ChevronDown className="w-3 h-3 text-teal" />
}

function pf(n: number) {
  if (n >= 999) return "∞"
  if (n === 0) return "—"
  return n.toFixed(2)
}

function money(n: number, showSign = true) {
  const sign = showSign && n > 0 ? "+" : ""
  return `${sign}$${Math.abs(n).toFixed(0)}`
}

export function SetupPerformanceTable({ setups, onEdit, onDeleted }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalPnl")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [deleting, setDeleting] = useState<string | null>(null)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  const sorted = useMemo(() => {
    return [...setups].sort((a, b) => {
      let va: number | string, vb: number | string
      if (sortKey === "name") { va = a.name.toLowerCase(); vb = b.name.toLowerCase() }
      else {
        const map: Record<Exclude<SortKey, "name">, keyof Setup["stats"]> = {
          total: "total", winRate: "winRate", avgPnl: "avgPnl",
          profitFactor: "profitFactor", totalPnl: "totalPnl",
        }
        va = a.stats[map[sortKey as Exclude<SortKey, "name">]] as number
        vb = b.stats[map[sortKey as Exclude<SortKey, "name">]] as number
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [setups, sortKey, sortDir])

  async function handleDelete(setup: Setup) {
    if (!confirm(`Arquivar setup "${setup.name}"?`)) return
    setDeleting(setup.id)
    await fetch(`/api/setups/${setup.id}`, { method: "DELETE" })
    onDeleted(setup.id)
    setDeleting(null)
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {COLS.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className={cn(
                  "px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap",
                  col.align
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  <SortIcon col={col.key} sortKey={sortKey} dir={sortDir} />
                </span>
              </th>
            ))}
            <th className="px-4 py-3 w-16" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((setup, i) => {
            const { stats } = setup
            const noData = stats.total === 0
            return (
              <tr
                key={setup.id}
                className={cn(
                  "border-b border-border/50 hover:bg-muted/20 transition-colors group",
                  i === sorted.length - 1 && "border-b-0"
                )}
              >
                {/* Setup name */}
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{setup.name}</div>
                  {setup.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{setup.description}</div>
                  )}
                  {setup.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {setup.tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">{t}</span>
                      ))}
                    </div>
                  )}
                </td>

                {/* Trades */}
                <td className="px-4 py-3 text-right font-mono text-foreground">
                  {noData ? <span className="text-muted-foreground">—</span> : (
                    <div>
                      <span className="text-foreground font-semibold">{stats.total}</span>
                      <div className="text-[10px] text-muted-foreground">
                        {stats.wins}W · {stats.losses}L
                      </div>
                    </div>
                  )}
                </td>

                {/* Win % */}
                <td className="px-4 py-3 text-right">
                  {noData ? <span className="text-muted-foreground font-mono">—</span> : (
                    <span className={cn("font-mono font-semibold", stats.winRate >= 50 ? "text-profit" : "text-loss")}>
                      {stats.winRate}%
                    </span>
                  )}
                </td>

                {/* Avg P&L */}
                <td className="px-4 py-3 text-right">
                  {noData ? <span className="text-muted-foreground font-mono">—</span> : (
                    <div>
                      <span className={cn("font-mono font-semibold", stats.avgPnl >= 0 ? "text-profit" : "text-loss")}>
                        {money(stats.avgPnl)}
                      </span>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {stats.avgWin > 0 && <span className="text-profit/70">+${stats.avgWin.toFixed(0)}</span>}
                        {stats.avgWin > 0 && stats.avgLoss > 0 && " / "}
                        {stats.avgLoss > 0 && <span className="text-loss/70">-${stats.avgLoss.toFixed(0)}</span>}
                      </div>
                    </div>
                  )}
                </td>

                {/* Profit Factor */}
                <td className="px-4 py-3 text-right">
                  {noData ? <span className="text-muted-foreground font-mono">—</span> : (
                    <span className={cn(
                      "font-mono font-semibold",
                      stats.profitFactor >= 1.5 ? "text-profit" : stats.profitFactor >= 1 ? "text-yellow-400" : "text-loss"
                    )}>
                      {pf(stats.profitFactor)}
                    </span>
                  )}
                </td>

                {/* P&L Total */}
                <td className="px-4 py-3 text-right">
                  {noData ? <span className="text-muted-foreground font-mono">—</span> : (
                    <span className={cn("font-mono font-semibold", stats.totalPnl >= 0 ? "text-profit" : "text-loss")}>
                      {money(stats.totalPnl)}
                    </span>
                  )}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onEdit(setup)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(setup)}
                      disabled={deleting === setup.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Totals footer */}
      {setups.length > 1 && (
        <div className="border-t border-border bg-muted/20 px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{setups.length} setups</span>
          <div className="flex items-center gap-6 text-xs font-mono">
            <span className="text-muted-foreground">
              {setups.reduce((a, s) => a + s.stats.total, 0)} trades totais
            </span>
            <span className={cn(
              "font-semibold",
              setups.reduce((a, s) => a + s.stats.totalPnl, 0) >= 0 ? "text-profit" : "text-loss"
            )}>
              {money(setups.reduce((a, s) => a + s.stats.totalPnl, 0))} acumulado
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
