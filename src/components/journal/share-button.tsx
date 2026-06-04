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

  const shareUrl = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${token}` : null

  async function handleShare() {
    if (token) {
      // Copiar link já existente
      await copy()
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

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function copy() {
    if (shareUrl) await copyUrl(shareUrl)
  }

  async function handleRevoke() {
    setLoading(true)
    await fetch(`/api/trades/${tradeId}/share`, { method: "DELETE" })
    setToken(null)
    setLoading(false)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleShare}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors disabled:opacity-50",
          copied
            ? "bg-profit/10 border-profit/30 text-profit"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
         copied ? <Check className="w-3.5 h-3.5" /> :
         <Share2 className="w-3.5 h-3.5" />}
        {copied ? "Link copiado!" : token ? "Copiar link" : "Compartilhar"}
      </button>

      {token && !loading && (
        <button
          onClick={handleRevoke}
          className="text-muted-foreground/50 hover:text-loss transition-colors"
          title="Revogar link"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
