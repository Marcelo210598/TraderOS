import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { Check, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Planos" }

const PLANS = [
  {
    key: "FREE",
    name: "Free",
    price: "R$0",
    period: "sempre",
    description: "Para quem está começando",
    color: "border-border",
    highlight: false,
    features: [
      "Até 10 trades/mês no journal",
      "Check-in emocional",
      "Progresso e conquistas básicas",
      "Dashboard com métricas",
    ],
    locked: [
      "Guardian (calculadora Apex)",
      "Biblioteca de setups",
      "Relatórios avançados",
      "Vega IA",
    ],
    cta: "Plano atual",
    ctaStyle: "border-border text-muted-foreground",
  },
  {
    key: "TRADER",
    name: "Trader",
    price: "R$47",
    period: "por mês",
    description: "Para traders sérios",
    color: "border-teal/40",
    highlight: true,
    badge: "Mais popular",
    features: [
      "Trades ilimitados no journal",
      "Guardian — calculadora Apex completa",
      "Biblioteca de setups ilimitada",
      "Relatórios avançados",
      "Streaks e conquistas completas",
      "Check-in emocional avançado",
    ],
    locked: ["Vega IA", "Análise de trades com IA"],
    cta: "Assinar Trader",
    ctaStyle: "bg-teal text-teal-foreground hover:bg-teal/90",
  },
  {
    key: "PRO",
    name: "Pro",
    price: "R$97",
    period: "por mês",
    description: "Para quem quer borda competitiva",
    color: "border-secondary/40",
    highlight: false,
    features: [
      "Tudo do plano Trader",
      "Vega — IA para análise de trades",
      "Análise automática de padrões",
      "Relatórios com insights de IA",
      "Suporte prioritário",
    ],
    locked: [],
    cta: "Assinar Pro",
    ctaStyle: "bg-secondary text-white hover:bg-secondary/90",
  },
]

export default async function PlanosPage() {
  const session = await auth()
  const user = session!.user
  const currentPlan = user.plan ?? "FREE"

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Planos"
        subtitle="Escolha o plano certo para sua jornada"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={currentPlan}
      />

      <div className="flex-1 p-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground">Evolua sua operação</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Cancele a qualquer momento. Sem fidelidade.
            </p>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map((plan) => {
              const isCurrentPlan = currentPlan === plan.key

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

                  {isCurrentPlan && (
                    <div className="absolute -top-3 right-4">
                      <span className="bg-muted text-muted-foreground text-[10px] font-bold px-3 py-1 rounded-full font-mono border border-border">
                        Seu plano
                      </span>
                    </div>
                  )}

                  <div className="mb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">{plan.name}</p>
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-bold text-foreground font-mono">{plan.price}</span>
                      <span className="text-xs text-muted-foreground mb-1">/{plan.period}</span>
                    </div>
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
                        <span className="text-xs text-muted-foreground leading-snug line-through">{f}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    className={cn(
                      "w-full py-2.5 rounded-xl text-sm font-medium border transition-all",
                      isCurrentPlan
                        ? "border-border text-muted-foreground cursor-default"
                        : plan.ctaStyle
                    )}
                    disabled={isCurrentPlan}
                  >
                    {isCurrentPlan ? "Plano atual" : plan.cta}
                  </button>
                </div>
              )
            })}
          </div>

          {/* FAQ simples */}
          <div className="mt-10 text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              Dúvidas? Fale com a gente:{" "}
              <a href="mailto:suporte@traderos.app" className="text-teal hover:underline">
                suporte@traderos.app
              </a>
            </p>
            <p className="text-[10px] text-muted-foreground">
              Pagamentos processados com segurança. Cancele a qualquer momento sem burocracia.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
