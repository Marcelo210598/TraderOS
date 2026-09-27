"use client"

import { reopenConsentBanner } from "@/lib/cookie-consent"

export function ManageCookiesButton() {
  return (
    <button
      type="button"
      onClick={reopenConsentBanner}
      className="px-4 py-2 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors"
    >
      Gerenciar cookies
    </button>
  )
}
