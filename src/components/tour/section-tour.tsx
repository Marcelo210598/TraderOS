"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

export interface TourStep {
  target: string // seletor CSS do elemento (data-tour="...")
  title: string
  body: string
}

interface Props {
  id: string // chave única da seção (ex: "dashboard") — vira o item em User.seenTours
  steps: TourStep[]
  // Vem do server component da página (User.seenTours.includes(id)) — evita repetir
  // o tour ao logar num navegador/dispositivo novo (localStorage sozinho não
  // acompanha a conta, só o browser, e foi exatamente isso que causou o tour
  // voltando toda vez que o Marcelo logava em outro lugar).
  initialSeen: boolean
}

const HIGHLIGHT_CLASS = "meutrade-tour-highlight"

// Evento global que o botão de replay (TourReplayButton) dispara pra reabrir
// o tour sob demanda, sem mexer no "visto" persistido — replay não deve fazer
// o tour aparecer sozinho de novo no próximo login.
export const TOUR_REPLAY_EVENT = "meutrade:tour-replay"

// Tour contextual por seção, uma vez por seção por conta (server-side via
// User.seenTours). Reaproveitável: cada página só declara sua lista de passos
// (seletor + texto) e se já foi visto.
export function SectionTour({ id, steps, initialSeen }: Props) {
  // `initialSeen` vem do server — decide direto no useState, sem efeito nem
  // risco de hydration mismatch (servidor e cliente recebem a mesma prop).
  const [visible, setVisible] = useState(!initialSeen && steps.length > 0)
  const [step, setStep] = useState(0)

  // Replay manual (botão "Tutorial" na página) — reabre do zero, mas nunca
  // marca como visto de novo sozinho; só o `finish()` faz isso.
  useEffect(() => {
    function onReplay(e: Event) {
      const detail = (e as CustomEvent<{ id: string }>).detail
      if (detail?.id !== id) return
      setStep(0)
      setVisible(true)
    }
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay)
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay)
  }, [id])

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
    setVisible(false)
    // Fire-and-forget — não bloqueia a UI nem trata falha: pior caso, o tour
    // aparece de novo na próxima visita, não é destrutivo.
    fetch("/api/tours/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {})
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
