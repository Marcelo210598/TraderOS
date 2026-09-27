// Consentimento de cookies não-essenciais (Meta Pixel, Google Analytics/Ads).
// Cookie de sessão (NextAuth) não é coberto por isso — é estritamente necessário
// pro login funcionar, não depende de consentimento.

export type ConsentValue = "accepted" | "rejected"

const STORAGE_KEY = "cookie-consent:v1"
export const REOPEN_EVENT = "cookie-consent:reopen"

export function getStoredConsent(): ConsentValue | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === "accepted" || raw === "rejected" ? raw : null
  } catch {
    return null
  }
}

export function setStoredConsent(value: ConsentValue) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // localStorage bloqueado — sem persistência, banner volta a aparecer na próxima visita
  }
}

/** Reabre o banner (ex.: link "Gerenciar cookies" em Configurações). */
export function reopenConsentBanner() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ok, o evento abaixo já reabre o banner mesmo sem limpar o storage
  }
  window.dispatchEvent(new Event(REOPEN_EVENT))
}
