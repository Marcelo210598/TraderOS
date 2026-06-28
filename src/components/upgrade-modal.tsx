"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Zap, X, Check, Loader2 } from "lucide-react"
import { UPGRADE_EVENT, type UpgradeDetail } from "@/lib/upgrade"

const PERKS = [
  "Trades ilimitados no journal",
  "Guardian + Vega IA",
  "Setups e integrações sem limite",
]

export function UpgradeModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<UpgradeDetail>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    function handler(e: Event) {
      setDetail((e as CustomEvent<UpgradeDetail>).detail ?? {})
      setOpen(true)
    }
    window.addEventListener(UPGRADE_EVENT, handler)
    return () => window.removeEventListener(UPGRADE_EVENT, handler)
  }, [])

  // ESC fecha
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (!open) return null

  const plan = detail.suggestedPlan ?? "PRO"
  const planLabel = plan === "TRADER" ? "Starter" : "Pro"

  function goToPlans() {
    setLoading(true)
    router.push("/planos")
    setOpen(false)
    setLoading(false)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-sm bg-card border border-teal/30 rounded-2xl p-6 glow-teal-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-12 h-12 rounded-xl bg-teal/10 flex items-center justify-center mb-4">
          <Zap className="w-6 h-6 text-teal" />
        </div>

        <h3 className="text-lg font-bold text-foreground">
          Libere o plano {planLabel}
        </h3>
        <p className="text-sm text-muted-foreground mt-1.5">
          {detail.reason ??
            "Você chegou no limite do seu plano atual. Faça upgrade pra continuar sem travas."}
        </p>

        <div className="space-y-2 my-5">
          {PERKS.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <Check className="w-4 h-4 text-profit shrink-0" />
              <span className="text-xs text-foreground">{p}</span>
            </div>
          ))}
        </div>

        <button
          onClick={goToPlans}
          disabled={loading}
          className="w-full py-2.5 rounded-xl text-sm font-semibold bg-teal text-teal-foreground hover:bg-teal/90 transition-all flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Ver planos
        </button>
        <button
          onClick={() => setOpen(false)}
          className="w-full py-2 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Agora não
        </button>
      </div>
    </div>
  )
}
