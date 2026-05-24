"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2, AlertTriangle, Loader2 } from "lucide-react"

interface DeleteTradeButtonProps {
  tradeId: string
}

export function DeleteTradeButton({ tradeId }: DeleteTradeButtonProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    try {
      await fetch(`/api/trades/${tradeId}`, { method: "DELETE" })
      router.push("/journal")
      router.refresh()
    } catch {
      setLoading(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-loss hover:border-loss/40 hover:bg-loss/5 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-loss">
        <AlertTriangle className="w-3.5 h-3.5" />
        Tem certeza?
      </div>
      <button
        onClick={() => setConfirming(false)}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
      >
        Cancelar
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-loss/10 border border-loss/30 text-xs text-loss hover:bg-loss/20 transition-colors disabled:opacity-40"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
        Confirmar exclusão
      </button>
    </div>
  )
}
