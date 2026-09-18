"use client"

import { HelpCircle } from "lucide-react"
import { TOUR_REPLAY_EVENT } from "./section-tour"

// Botão "Tutorial" pra reabrir o guia da página sob demanda — pra quem fechou
// sem querer, ou quer rever depois. Um por página, ao lado do título.
export function TourReplayButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT, { detail: { id } }))}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-teal hover:bg-teal/10 transition-colors border border-border shrink-0"
      title="Rever o tutorial desta página"
    >
      <HelpCircle className="w-3.5 h-3.5" />
      Tutorial
    </button>
  )
}
