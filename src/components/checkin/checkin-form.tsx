"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Loader2, ArrowRight, Sparkles } from "lucide-react"

const FALLBACK_INSIGHTS: Record<"PRE" | "POST", Record<"low" | "medium" | "high", string[]>> = {
  PRE: {
    low: [
      "Estado abaixo do ideal hoje. Se for operar, use metade do tamanho normal e defina o max loss antes de abrir a plataforma.",
      "Scores baixos são um sinal real — o risco de decisões emocionais é alto agora. Prefira qualidade a quantidade: só setups A+.",
      "Quando o estado está assim, o mercado te cobra caro por qualquer hesitação. Considere observar hoje ou operar muito menos.",
    ],
    medium: [
      "Estado razoável. Você pode operar, mas fique atento: defina o stop antes de entrar e não mude no meio do trade.",
      "Scores medianos. Fique nos setups que você mais domina e evite overtrading — menos trades, melhor qualidade.",
      "Dia mediano emocionalmente. Siga o plano à risca: respeite stops, sem revenge trade se der errado.",
    ],
    high: [
      "Ótimo estado hoje. Você está preparado — confie nos seus setups e mantenha o gerenciamento de risco no ponto.",
      "Estado sólido para operar. Aproveite o foco e a confiança, mas sem excesso: disciplina é o que separa os dias bons dos grandes.",
      "Excelente pré-sessão. Foco alto e stress baixo — as condições ideais. Execute seu plano sem improvisar.",
    ],
  },
  POST: {
    low: [
      "Sessão pesada emocionalmente. Antes de fechar, anote o que pesou mais — identificar o padrão é o primeiro passo.",
      "Estado baixo pós-sessão. Descanse antes da próxima. Operar cansado emocional é um dos maiores custos ocultos do trading.",
      "Dia difícil. Não leve para o próximo — escreva o que aconteceu enquanto está fresco e deixe aqui.",
    ],
    medium: [
      "Sessão razoável. O que você faria diferente em um trade hoje? Um ajuste pequeno por sessão acumula muito no longo prazo.",
      "Estado mediano. Revise um momento em que hesitou — essa é sempre a melhoria mais valiosa.",
      "Consistência se constrói em dias medianos também. Amanhã é uma nova sessão.",
    ],
    high: [
      "Boa sessão! Terminar assim é sinal de execução alinhada com o plano. Mantenha esse padrão.",
      "Estado emocional elevado pós-trade. Anote o que funcionou hoje — esses são os dias para replicar.",
      "Excelente encerramento. Trader que sai assim está no caminho certo. Descanse e repita amanhã.",
    ],
  },
}

function getFallbackInsight(type: "PRE" | "POST", avg: number): string {
  const range = avg >= 7 ? "high" : avg >= 5 ? "medium" : "low"
  const options = FALLBACK_INSIGHTS[type][range]
  return options[Math.floor(Math.random() * options.length)]
}

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
  userPlan: "FREE" | "TRADER" | "PRO"
}

export function CheckInForm({ type, userPlan }: CheckInFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [insight, setInsight] = useState<string | null>(null)
  const [loadingInsight, setLoadingInsight] = useState(false)
  const [scores, setScores] = useState<Record<string, number>>({
    emotional: 5, energy: 5, focus: 5, confidence: 5, stress: 5,
  })
  const [notes, setNotes] = useState("")

  function setScore(key: string, value: number) {
    setScores((prev) => ({ ...prev, [key]: value }))
  }

  const average = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5)

  async function fetchInsight(submittedScores: Record<string, number>, submittedNotes: string) {
    setLoadingInsight(true)
    const avg = Object.values(submittedScores).reduce((a, b) => a + b, 0) / Object.values(submittedScores).length
    try {
      const res = await fetch("/api/checkin/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, notes: submittedNotes || null, ...submittedScores }),
      })
      if (res.ok) {
        const data = await res.json()
        setInsight(data.insight ?? getFallbackInsight(type, avg))
      } else {
        setInsight(getFallbackInsight(type, avg))
      }
    } catch {
      setInsight(getFallbackInsight(type, avg))
    } finally {
      setLoadingInsight(false)
    }
  }

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

    setLoading(false)
    setSubmitted(true)
    if (userPlan !== "FREE") {
      fetchInsight(scores, notes)
    }
  }

  const readinessColor =
    average >= 7 ? "text-profit" : average >= 5 ? "text-yellow-400" : "text-loss"
  const readinessLabel =
    average >= 7 ? "✅ Pronto para operar" : average >= 5 ? "⚠️ Atenção — opere com cautela" : "🚫 Considere não operar hoje"

  if (submitted) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-profit text-lg">✅</span>
          <p className="text-sm font-medium text-foreground">
            Check-in {type === "PRE" ? "pré-sessão" : "pós-sessão"} salvo!
          </p>
        </div>

        {userPlan === "FREE" ? (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground">Análise da Vega</span>
              <span className="ml-auto text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">Planos pagos</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Com o plano Trader ou Pro, a Vega cruza seu estado emocional de hoje com seu histórico real de performance e dá um conselho personalizado antes de cada sessão.
            </p>
            <a
              href="/planos"
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ver planos
            </a>
          </div>
        ) : (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold text-foreground">Vega</span>
              {loadingInsight && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
            </div>
            {loadingInsight ? (
              <p className="text-sm text-muted-foreground italic">Analisando seu estado emocional...</p>
            ) : (
              <p className="text-sm text-foreground leading-relaxed">{insight}</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="w-full py-3 rounded-xl bg-muted text-foreground font-medium hover:bg-muted/80 transition-colors flex items-center justify-center gap-2 text-sm"
        >
          Ir ao Dashboard
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    )
  }

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
