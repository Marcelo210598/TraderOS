"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus, Trash2, Pencil, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Trade } from "@/lib/types"
import { getAccountOption } from "@/lib/accounts"

interface TradeCardProps {
  trade: Trade
  onDeleted?: (id: string) => void
}

export function TradeCard({ trade, onDeleted }: TradeCardProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  const isWin = trade.result === "WIN"
  const isLoss = trade.result === "LOSS"
  const accountOpt = getAccountOption(trade.accountLabel ?? "PA")

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm("Deletar este trade?")) return
    setDeleting(true)
    await fetch(`/api/trades/${trade.id}`, { method: "DELETE" })
    onDeleted?.(trade.id)
    setDeleting(false)
  }

  return (
    <div
      onClick={() => router.push(`/journal/${trade.id}`)}
      className={cn(
        "group bg-card border rounded-xl p-4 cursor-pointer transition-all hover:border-border/80 hover:shadow-lg",
        isWin ? "border-profit/20 hover:border-profit/40" : isLoss ? "border-loss/20 hover:border-loss/40" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Ícone resultado */}
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
          isWin ? "bg-profit/10" : isLoss ? "bg-loss/10" : "bg-muted"
        )}>
          {isWin ? <TrendingUp className="w-4 h-4 text-profit" /> :
           isLoss ? <TrendingDown className="w-4 h-4 text-loss" /> :
           <Minus className="w-4 h-4 text-muted-foreground" />}
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground font-mono">{trade.instrument}</span>
            <Badge className={cn(
              "text-[10px] px-1.5 py-0 h-4 border-0 font-mono",
              trade.direction === "LONG" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
            )}>
              {trade.direction}
            </Badge>
            <Badge className={cn(
              "text-[10px] px-1.5 py-0 h-4 font-mono border",
              accountOpt.bg, accountOpt.border, accountOpt.color
            )}>
              {accountOpt.label}
            </Badge>
            {trade.setup && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 border-0 bg-accent text-teal">
                {trade.setup.name}
              </Badge>
            )}
            {trade.tags.slice(0, 2).map((tag) => (
              <span key={tag.id} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {tag.name}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground font-mono">
            <span>{format(new Date(trade.date), "dd/MM HH:mm", { locale: ptBR })}</span>
            <span>•</span>
            <span>E: {Number(trade.entryPrice).toFixed(2)}</span>
            <span>→</span>
            <span>S: {Number(trade.exitPrice).toFixed(2)}</span>
            <span>•</span>
            <span>{trade.quantity}x</span>
          </div>

          {trade.notes && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-1">{trade.notes}</p>
          )}
        </div>

        {/* PnL + Ações */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className={cn(
              "text-lg font-bold font-mono",
              isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground"
            )}>
              {Number(trade.pnl) >= 0 ? "+" : ""}${Math.abs(Number(trade.pnl)).toFixed(0)}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              {Number(trade.pnlPoints) >= 0 ? "+" : ""}{Number(trade.pnlPoints).toFixed(2)} pts
            </p>
          </div>

          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); router.push(`/journal/${trade.id}/editar`) }}
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

          <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>
      </div>
    </div>
  )
}
