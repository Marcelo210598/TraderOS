"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Cookie } from "lucide-react"
import { TrackingScripts } from "@/components/analytics/tracking-scripts"
import { getStoredConsent, setStoredConsent, REOPEN_EVENT, type ConsentValue } from "@/lib/cookie-consent"

export function CookieConsentBanner() {
  // null = ainda não decidido (mostra banner). Começa "rejected" no SSR/primeira pintura
  // pra nunca disparar pixel antes do usuário decidir; useEffect corrige com o valor real.
  const [consent, setConsent] = useState<ConsentValue | null>("rejected")
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    const stored = getStoredConsent()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsent(stored)
    setShowBanner(stored === null)

    function onReopen() {
      setConsent(null)
      setShowBanner(true)
    }
    window.addEventListener(REOPEN_EVENT, onReopen)
    return () => window.removeEventListener(REOPEN_EVENT, onReopen)
  }, [])

  function decide(value: ConsentValue) {
    setStoredConsent(value)
    setConsent(value)
    setShowBanner(false)
  }

  return (
    <>
      {consent === "accepted" && <TrackingScripts />}

      {showBanner && (
        <div className="fixed bottom-0 inset-x-0 z-[90] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-4 shadow-lg flex flex-col sm:flex-row sm:items-center gap-3">
            <Cookie className="w-5 h-5 text-teal shrink-0 hidden sm:block" />
            <p className="text-xs text-muted-foreground flex-1">
              Usamos cookies essenciais (login) sempre, e cookies de analytics/anúncios só com sua permissão.
              Veja mais na{" "}
              <Link href="/privacidade" target="_blank" className="underline underline-offset-2 hover:text-foreground">
                Política de Privacidade
              </Link>
              .
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => decide("rejected")}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Recusar
              </button>
              <button
                type="button"
                onClick={() => decide("accepted")}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal text-teal-foreground hover:opacity-90 transition-opacity"
              >
                Aceitar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
