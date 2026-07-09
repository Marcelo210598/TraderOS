"use client"

import { useEffect, useState } from "react"
import { Check, Zap, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PlanKey } from "@/lib/plans"
import { trackPixel } from "@/lib/fbpixel"
import { trackGtagEvent, trackGoogleAdsCheckout } from "@/lib/gtag"

type Cycle = "MONTHLY" | "YEARLY"

interface PlanCard {
  key: PlanKey
  name: string
  monthly: number | null
  yearly?: number | null
  description: string
  color: string
  highlight: boolean
  badge?: string
  ctaStyle: string
  features: string[]
  locked: string[]
}

const CARDS: PlanCard[] = [
  {
    key: "FREE",
    name: "Free",
    monthly: 0,
    description: "Pra quem está começando",
    color: "border-border",
    highlight: false,
    ctaStyle: "border-border text-muted-foreground",
    features: [
      "Até 10 trades/mês no journal",
      "Check-in emocional",
      "Progresso e conquistas básicas",
      "Dashboard com métricas",
    ],
    locked: ["Guardian (calculadora Apex)", "Biblioteca de setups", "Vega IA"],
  },
  {
    key: "TRADER",
    name: "Starter",
    monthly: 19.9,
    description: "Pra quem leva a sério",
    color: "border-teal/40",
    highlight: true,
    badge: "Mais popular",
    ctaStyle: "bg-teal text-teal-foreground hover:bg-teal/90",
    features: [
      "25 trades/mês no journal",
      "Guardian — calculadora Apex completa",
      "Até 5 setups na biblioteca",
      "Vega IA — 5 análises/mês",
      "1 conta + 1 integração (NT8/MT5)",
      "Streaks e conquistas completas",
    ],
    locked: ["Trades ilimitados", "Vega IA — 40/mês"],
  },
  {
    key: "PRO",
    name: "Pro",
    monthly: 97,
    yearly: 1000,
    description: "Pra quem quer borda competitiva",
    color: "border-secondary/40",
    highlight: false,
    ctaStyle: "bg-secondary text-white hover:bg-secondary/90",
    features: [
      "Trades ilimitados no journal",
      "Setups ilimitados",
      "Vega IA — 40 análises/mês",
      "Contas e integrações ilimitadas",
      "Relatórios com insights de IA",
      "Suporte prioritário",
    ],
    locked: [],
  },
]

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function PlanosGrid({ currentPlan }: { currentPlan: PlanKey }) {
  const [cycle, setCycle] = useState<Cycle>("MONTHLY")
  const [loading, setLoading] = useState<PlanKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Retargeting: público "viu os planos" (interessado em assinar).
  useEffect(() => {
    trackPixel("ViewContent", { content_name: "planos" })
    trackGtagEvent("view_content", { content_name: "planos" })
  }, [])

  async function checkout(plan: PlanKey) {
    if (plan === "FREE") return
    setError(null)
    setLoading(plan)
    // Retargeting: público "quis assinar" (quente) — mesmo que não conclua o pagamento.
    trackPixel("InitiateCheckout", { content_name: plan, currency: "BRL" })
    trackGtagEvent("begin_checkout", { content_name: plan, currency: "BRL" })
    const card = CARDS.find((c) => c.key === plan)
    trackGoogleAdsCheckout(card?.monthly ?? undefined)
    try {
      const planCycle: Cycle = plan === "PRO" ? cycle : "MONTHLY"
      const res = await fetch("/api/asaas/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, cycle: planCycle }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Falha ao iniciar o checkout")
      }
      window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado")
      setLoading(null)
    }
  }

  return (
    <>
      {/* Toggle mensal/anual */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <button
          onClick={() => setCycle("MONTHLY")}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-lg border transition-all",
            cycle === "MONTHLY"
              ? "bg-card border-teal/40 text-foreground"
              : "border-transparent text-muted-foreground"
          )}
        >
          Mensal
        </button>
        <button
          onClick={() => setCycle("YEARLY")}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5",
            cycle === "YEARLY"
              ? "bg-card border-teal/40 text-foreground"
              : "border-transparent text-muted-foreground"
          )}
        >
          Anual
          <span className="text-[10px] font-bold text-profit bg-profit/10 px-1.5 py-0.5 rounded-full">
            -14%
          </span>
        </button>
      </div>

      {error && (
        <p className="text-center text-xs text-loss mb-4">{error}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CARDS.map((plan) => {
          const isCurrent = currentPlan === plan.key
          const isPro = plan.key === "PRO"
          const showYearly = isPro && cycle === "YEARLY"
          const price =
            plan.key === "FREE"
              ? "R$0"
              : showYearly && plan.yearly != null
              ? brl(plan.yearly)
              : brl(plan.monthly ?? 0)
          const period =
            plan.key === "FREE" ? "sempre" : showYearly ? "por ano" : "por mês"

          return (
            <div
              key={plan.key}
              className={cn(
                "bg-card border rounded-xl p-5 flex flex-col relative",
                plan.color,
                plan.highlight && "glow-teal-sm"
              )}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-teal text-teal-foreground text-[10px] font-bold px-3 py-1 rounded-full font-mono uppercase tracking-wider">
                    {plan.badge}
                  </span>
                </div>
              )}

              {isCurrent && (
                <div className="absolute -top-3 right-4">
                  <span className="bg-muted text-muted-foreground text-[10px] font-bold px-3 py-1 rounded-full font-mono border border-border">
                    Seu plano
                  </span>
                </div>
              )}

              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">
                  {plan.name}
                </p>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold text-foreground font-mono">
                    {price}
                  </span>
                  <span className="text-xs text-muted-foreground mb-1">/{period}</span>
                </div>
                {showYearly && plan.monthly != null && (
                  <p className="text-[11px] text-profit mt-1">
                    equivale a {brl(plan.yearly! / 12)}/mês
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
              </div>

              <div className="flex-1 space-y-2 mb-5">
                {plan.features.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-profit shrink-0 mt-0.5" />
                    <span className="text-xs text-foreground leading-snug">{f}</span>
                  </div>
                ))}
                {plan.locked.map((f) => (
                  <div key={f} className="flex items-start gap-2 opacity-40">
                    <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-xs text-muted-foreground leading-snug line-through">
                      {f}
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => checkout(plan.key)}
                className={cn(
                  "w-full py-2.5 rounded-xl text-sm font-medium border transition-all flex items-center justify-center gap-2",
                  isCurrent || plan.key === "FREE"
                    ? "border-border text-muted-foreground cursor-default"
                    : plan.ctaStyle,
                  loading === plan.key && "opacity-70 cursor-wait"
                )}
                disabled={isCurrent || plan.key === "FREE" || loading !== null}
              >
                {loading === plan.key && <Loader2 className="w-4 h-4 animate-spin" />}
                {isCurrent
                  ? "Plano atual"
                  : plan.key === "FREE"
                  ? "Grátis"
                  : `Assinar ${plan.name}`}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
