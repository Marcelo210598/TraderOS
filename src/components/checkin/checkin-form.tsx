"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

const METRICS = [
  { key: "emotional", label: "Estado emocional", desc: "Como você está se sentindo agora?" },
  { key: "energy", label: "Energia", desc: "Nível de energia e disposição" },
  { key: "focus", label: "Foco", desc: "Capacidade de concentração" },
  { key: "confidence", label: "Confiança", desc: "Confiança no seu plano e setup" },
  { key: "stress", label: "Ausência de stress", desc: "10 = totalmente calmo, 1 = muito estressado" },
] as const

const SCALE_LABELS: Record<number, string> = {
  1: "Péssimo", 2: "Ruim", 3: "Abaixo da média", 4: "Razoável", 5: "Médio",
  6: "Bom", 7: "Acima da média", 8: "Ótimo", 9: "Excelente", 10: "Perfeito"
}

interface CheckInFormProps {
  type: "PRE" | "POST"
}

export function CheckInForm({ type }: CheckInFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [scores, setScores] = useState<Record<string, number>>({
    emotional: 5, energy: 5, focus: 5, confidence: 5, stress: 5,
  })
  const [notes, setNotes] = useState("")

  function setScore(key: string, value: number) {
    setScores((prev) => ({ ...prev, [key]: value }))
  }

  const average = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        sessionDate: new Date().toISOString(),
        ...scores,
        notes: notes || null,
      }),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? "Erro ao salvar check-in")
      setLoading(false)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  const readinessColor =
    average >= 7 ? "text-profit" : average >= 5 ? "text-yellow-400" : "text-loss"
  const readinessLabel =
    average >= 7 ? "✅ Pronto para operar" : average >= 5 ? "⚠️ Atenção — opere com cautela" : "🚫 Considere não operar hoje"

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Resultado geral */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3">
        <span className="text-sm text-muted-foreground">Avaliação geral</span>
        <div className="text-right">
          <p className={cn("text-2xl font-bold font-mono", readinessColor)}>{average}/10</p>
          <p className={cn("text-xs font-medium", readinessColor)}>{readinessLabel}</p>
        </div>
      </div>

      {/* Métricas */}
      <div className="space-y-5">
        {METRICS.map((m) => (
          <div key={m.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <span className={cn(
                  "text-lg font-bold font-mono",
                  scores[m.key] >= 7 ? "text-profit" : scores[m.key] >= 5 ? "text-yellow-400" : "text-loss"
                )}>
                  {scores[m.key]}
                </span>
                <p className="text-[10px] text-muted-foreground">{SCALE_LABELS[scores[m.key]]}</p>
              </div>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScore(m.key, v)}
                  className={cn(
                    "flex-1 h-7 rounded-md text-xs font-mono font-medium transition-all",
                    scores[m.key] === v
                      ? v >= 7 ? "bg-profit text-white scale-105" : v >= 5 ? "bg-yellow-400 text-black scale-105" : "bg-loss text-white scale-105"
                      : v <= scores[m.key]
                      ? v >= 7 ? "bg-profit/20 text-profit" : v >= 5 ? "bg-yellow-400/20 text-yellow-400" : "bg-loss/20 text-loss"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Notas */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Observações {type === "PRE" ? "(o que vai focar hoje?)" : "(como foi a sessão?)"}
        </label>
        <textarea
          rows={3}
          placeholder={type === "PRE" ? "Vou focar no setup X, meu max loss é $200..." : "Segui o plano, saí cedo no trade 2 por medo..."}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors resize-none"
        />
      </div>

      {error && <p className="text-sm text-loss bg-loss/10 border border-loss/20 rounded-lg px-4 py-3">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {type === "PRE" ? "Confirmar check-in pré-sessão" : "Confirmar check-in pós-sessão"}
      </button>
    </form>
  )
}
