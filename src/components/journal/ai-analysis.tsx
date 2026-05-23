"use client"

import { useState } from "react"
import { Loader2, Sparkles, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface AiAnalysisProps {
  tradeId: string
  initial: string | null
  isPro: boolean
}

export function AiAnalysis({ tradeId, initial, isPro }: AiAnalysisProps) {
  const [analysis, setAnalysis] = useState<string | null>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function analyze() {
    setLoading(true)
    setError("")
    const res = await fetch(`/api/trades/${tradeId}/analyze`, { method: "POST" })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Erro ao analisar trade")
    } else {
      setAnalysis(data.analysis)
    }
    setLoading(false)
  }

  if (!isPro) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Análise IA disponível no plano Pro</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            O Claude analisa seus trades e identifica padrões de comportamento
          </p>
        </div>
        <a
          href="/planos"
          className="px-3 py-1.5 rounded-lg bg-indigo/10 text-indigo text-xs font-medium hover:bg-indigo/20 transition-colors shrink-0 ml-3"
        >
          Ver planos
        </a>
      </div>
    )
  }

  if (analysis) {
    return (
      <div className="bg-indigo/5 border border-indigo/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo" />
            <span className="text-xs font-semibold text-indigo uppercase tracking-wider">Análise Claude AI</span>
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Reanalisar
          </button>
        </div>
        <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{analysis}</p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo" />
        <span className="text-sm font-medium text-foreground">Análise IA com Claude</span>
      </div>
      <p className="text-xs text-muted-foreground">
        O Claude analisa a execução, identifica pontos fortes/fracos e dá uma recomendação concreta.
      </p>
      {error && (
        <p className="text-xs text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2">{error}</p>
      )}
      <button
        onClick={analyze}
        disabled={loading}
        className={cn(
          "w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2",
          "bg-indigo/10 text-indigo hover:bg-indigo/20 disabled:opacity-50"
        )}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {loading ? "Analisando..." : "Analisar este trade"}
      </button>
    </div>
  )
}
