"use client"

import { useState } from "react"
import { Share2, Check, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  tradeId: string
  initialToken: string | null
}

export function ShareButton({ tradeId, initialToken }: Props) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  async function handleShare() {
    if (token) {
      await copyUrl(`${window.location.origin}/share/${token}`)
      return
    }
    setLoading(true)
    const res = await fetch(`/api/trades/${tradeId}/share`, { method: "POST" })
    const data = await res.json()
    if (res.ok && data.token) {
      setToken(data.token)
      setTimeout(() => copyUrl(`${window.location.origin}/share/${data.token}`), 50)
    }
    setLoading(false)
  }

  async function handleRevoke(e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    await fetch(`/api/trades/${tradeId}/share`, { method: "DELETE" })
    setToken(null)
    setCopied(false)
    setLoading(false)
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleShare}
        disabled={loading}
        title={token ? "Copiar link de compartilhamento" : "Compartilhar trade"}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50",
          copied
            ? "bg-profit/10 text-profit"
            : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
        )}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> :
         copied ? <Check className="w-3 h-3" /> :
         <Share2 className="w-3 h-3" />}
        {copied ? "Copiado!" : token ? "Copiar link" : "Compartilhar"}
      </button>

      {token && !loading && !copied && (
        <button
          onClick={handleRevoke}
          title="Revogar link público"
          className="text-muted-foreground/40 hover:text-loss transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
