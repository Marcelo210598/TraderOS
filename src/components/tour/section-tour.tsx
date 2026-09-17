"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

export interface TourStep {
  target: string // seletor CSS do elemento (data-tour="...")
  title: string
  body: string
}

interface Props {
  id: string // chave única da seção (ex: "dashboard") — vira a chave do localStorage
  steps: TourStep[]
}

const HIGHLIGHT_CLASS = "meutrade-tour-highlight"

// Tour contextual por seção, uma vez por seção por navegador (mesmo padrão do
// OnboardingModal — localStorage, sem tabela nova no banco). Reaproveitável:
// cada página só declara sua lista de passos (seletor + texto).
export function SectionTour({ id, steps }: Props) {
  const storageKey = `meutrade_tour_${id}_v1`
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  // localStorage não existe no SSR — só checa depois do mount (evita hydration mismatch).
  useEffect(() => {
    const done = localStorage.getItem(storageKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!done && steps.length > 0) setVisible(true)
  }, [storageKey, steps.length])

  // Destaca o elemento do passo atual: rola até ele e aplica a classe de highlight.
  useEffect(() => {
    if (!visible) return
    const current = steps[step]
    if (!current) return
    const el = document.querySelector(current.target)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.add(HIGHLIGHT_CLASS)
    return () => el.classList.remove(HIGHLIGHT_CLASS)
  }, [visible, step, steps])

  function finish() {
    localStorage.setItem(storageKey, "done")
    setVisible(false)
  }

  function next() {
    if (step < steps.length - 1) setStep((s) => s + 1)
    else finish()
  }

  function back() {
    if (step > 0) setStep((s) => s - 1)
  }

  if (!visible || steps.length === 0) return null
  const current = steps[step]

  return (
    <>
      {/* Backdrop — o elemento em destaque "fura" por cima via z-index (ver globals.css) */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={finish} />

      {/* bottom-20 em mobile pra não colar na bottom nav fixa (h-16, some em lg+) */}
      <div className="fixed bottom-20 left-4 right-4 lg:left-auto lg:right-6 lg:bottom-6 lg:w-96 bg-card border border-teal/40 rounded-xl p-4 z-50 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            Passo {step + 1} de {steps.length}
          </span>
          <button onClick={finish} className="text-muted-foreground hover:text-foreground transition-colors" title="Pular tour">
            <X className="w-4 h-4" />
          </button>
        </div>
        <h3 className="text-sm font-semibold text-foreground mb-1">{current.title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{current.body}</p>
        <div className="flex items-center justify-between">
          <button
            onClick={back}
            disabled={step === 0}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
          >
            Voltar
          </button>
          <button
            onClick={next}
            className="text-xs font-medium bg-teal text-teal-foreground px-4 py-1.5 rounded-lg hover:bg-teal/90 transition-colors"
          >
            {step < steps.length - 1 ? "Próximo" : "Concluir"}
          </button>
        </div>
      </div>
    </>
  )
}
