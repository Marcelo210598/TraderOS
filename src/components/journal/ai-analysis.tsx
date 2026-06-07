"use client"

import { useState } from "react"
import { Loader2, Sparkles, RefreshCw, Lock } from "lucide-react"
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
    try {
      const res = await fetch(`/api/trades/${tradeId}/analyze`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Erro ao analisar trade")
      } else {
        setAnalysis(data.analysis)
      }
    } catch {
      setError("Erro de conexão. Verifique sua internet e tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  if (!isPro) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Análise IA — plano Pro</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vega analisa execução, MFE/MAE e seu histórico para dar feedback acionável
          </p>
        </div>
        <a
          href="/planos"
          className="px-3 py-1.5 rounded-lg bg-secondary/10 text-secondary text-xs font-medium hover:bg-secondary/20 transition-colors shrink-0"
        >
          Ver planos
        </a>
      </div>
    )
  }

  if (analysis) {
    return (
      <div className="bg-card border border-secondary/20 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-secondary" />
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Análise Vega IA</span>
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
        {error && (
          <div className="mx-4 mt-3 text-xs text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2">{error}</div>
        )}
        <div className="px-4 py-4">
          <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{analysis}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Sparkles className="w-4 h-4 text-secondary" />
        <span className="text-sm font-semibold text-foreground">Análise Vega IA</span>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Vega analisa a execução, compara com seu histórico de trades e identifica o que melhorar no próximo trade similar.
        </p>
        {error && (
          <p className="text-xs text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2">{error}</p>
        )}
        <button
          onClick={analyze}
          disabled={loading}
          className={cn(
            "w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 border",
            loading
              ? "bg-muted border-border text-muted-foreground"
              : "bg-secondary/10 border-secondary/30 text-secondary hover:bg-secondary/20"
          )}
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Vega está analisando...</>
            : <><Sparkles className="w-4 h-4" /> Analisar com Vega IA</>
          }
        </button>
        {loading && (
          <p className="text-[10px] text-center text-muted-foreground">Isso pode levar alguns segundos...</p>
        )}
      </div>
    </div>
  )
}
