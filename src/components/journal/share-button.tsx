"use client"

import { useState } from "react"
import { Share2, Check, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  tradeId: string
  initialToken: string | null
  initialIncludeAnalysis?: boolean
}

export function ShareButton({ tradeId, initialToken, initialIncludeAnalysis = false }: Props) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [includeAnalysis, setIncludeAnalysis] = useState(initialIncludeAnalysis)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)

  async function copyToClipboard(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback: cria input temporário
      const el = document.createElement("input")
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  async function handleShare() {
    // Se já tem token, só copia
    if (token) {
      await copyToClipboard(`${window.location.origin}/share/${token}`)
      return
    }

    setLoading(true)
    setError(false)

    try {
      const res = await fetch(`/api/trades/${tradeId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeAnalysis }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.token) throw new Error("Sem token")
      setToken(data.token)
      await copyToClipboard(`${window.location.origin}/share/${data.token}`)
    } catch (err) {
      console.error("[share]", err)
      setError(true)
      setTimeout(() => setError(false), 3000)
    } finally {
      setLoading(false)
    }
  }

  // Muda o toggle a qualquer momento — se o link já existe, persiste na hora
  // (mesmo token, só troca o que fica visível pra quem já tem o link).
  async function handleToggleIncludeAnalysis() {
    const next = !includeAnalysis
    setIncludeAnalysis(next)
    if (!token) return
    try {
      await fetch(`/api/trades/${tradeId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeAnalysis: next }),
      })
    } catch (err) {
      console.error("[share toggle]", err)
    }
  }

  async function handleRevoke(e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    try {
      await fetch(`/api/trades/${tradeId}/share`, { method: "DELETE" })
      setToken(null)
      setCopied(false)
    } catch (err) {
      console.error("[share revoke]", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          onClick={handleShare}
          disabled={loading}
          title={token ? "Copiar link público do trade" : "Gerar e copiar link de compartilhamento"}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50",
            error
              ? "bg-loss/10 text-loss"
              : copied
              ? "bg-profit/10 text-profit"
              : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
          )}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> :
           copied  ? <Check className="w-3 h-3" /> :
                     <Share2 className="w-3 h-3" />}
          {error   ? "Erro" :
           copied  ? "Copiado!" :
           token   ? "Copiar link" :
                     "Compartilhar"}
        </button>

        {token && !loading && (
          <button
            onClick={handleRevoke}
            title="Revogar link público"
            className="text-muted-foreground/40 hover:text-loss transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeAnalysis}
          onChange={handleToggleIncludeAnalysis}
          className="w-3 h-3 accent-teal"
        />
        Incluir notas e análise da Vega no link
      </label>
    </div>
  )
}
