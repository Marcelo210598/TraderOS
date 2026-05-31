"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { X, ArrowRight, ArrowLeft } from "lucide-react"

const STORAGE_KEY = "traderos_onboarding_v1"

const STEPS = [
  {
    emoji: "🎯",
    title: "Bem-vindo ao TraderOS",
    subtitle: "Seu diário de trading inteligente",
    body: "Desenvolvido para traders brasileiros que operam futuros americanos via Apex. Aqui você controla tudo — do trade à evolução mental.",
    cta: "Vamos começar",
  },
  {
    emoji: "📊",
    title: "Registre cada trade",
    subtitle: "Journal completo e inteligente",
    body: "Documente entrada, saída, screenshot e notas. O PnL é calculado automaticamente. Importe trades via CSV de qualquer plataforma.",
    cta: "Próximo",
  },
  {
    emoji: "🛡️",
    title: "Guardian — regras Apex",
    subtitle: "Nunca mais se pegar de surpresa",
    body: "O Guardian acompanha seu trailing drawdown EOD e a Consistency Rule em tempo real. Saiba exatamente onde você está no seu desafio.",
    cta: "Próximo",
  },
  {
    emoji: "🤖",
    title: "Converse com a Vega",
    subtitle: "IA especializada em seus dados",
    body: "A Vega analisa seus últimos 90 dias de trades e responde perguntas sobre sua performance. Disponível no plano Pro.",
    cta: "Próximo",
  },
  {
    emoji: "🚀",
    title: "Tudo pronto!",
    subtitle: "Comece registrando seu primeiro trade",
    body: "Você ganha XP a cada trade registrado, conquistas desbloqueadas e streaks por consistência. Quanto mais você usa, mais evolui.",
    cta: "Ir para o Journal",
  },
]

export function OnboardingModal({ isNewUser }: { isNewUser: boolean }) {
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (!isNewUser) return
    const done = localStorage.getItem(STORAGE_KEY)
    if (!done) setVisible(true)
  }, [isNewUser])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "done")
    setVisible(false)
  }

  function goTo(next: number) {
    if (animating) return
    setAnimating(true)
    setTimeout(() => {
      setStep(next)
      setAnimating(false)
    }, 180)
  }

  function handleCta() {
    if (step < STEPS.length - 1) {
      goTo(step + 1)
    } else {
      dismiss()
      router.push("/journal/novo")
    }
  }

  if (!visible) return null

  const current = STEPS[step]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Barra teal no topo */}
        <div className="h-1 bg-gradient-to-r from-teal to-teal/40" />

        {/* Fechar */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Conteúdo */}
        <div
          className={cn(
            "p-8 transition-opacity duration-150",
            animating ? "opacity-0" : "opacity-100"
          )}
        >
          {/* Emoji */}
          <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center text-3xl mb-6 mx-auto">
            {current.emoji}
          </div>

          {/* Texto */}
          <div className="text-center space-y-2 mb-6">
            <p className="text-xs font-medium text-teal uppercase tracking-widest">
              {current.subtitle}
            </p>
            <h2 className="text-xl font-bold text-foreground">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>
          </div>

          {/* Dots */}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={cn(
                  "rounded-full transition-all",
                  i === step
                    ? "w-5 h-1.5 bg-teal"
                    : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
              />
            ))}
          </div>

          {/* Botões */}
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={() => goTo(step - 1)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>
            )}
            <button
              onClick={handleCta}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal text-teal-foreground text-sm font-semibold hover:bg-teal/90 transition-colors"
            >
              {current.cta}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {step === 0 && (
            <p className="text-center text-xs text-muted-foreground mt-3">
              <button onClick={dismiss} className="hover:text-foreground transition-colors underline underline-offset-2">
                Pular introdução
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
