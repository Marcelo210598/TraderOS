// Helpers client-side pro Meta Pixel. `fbq` é injetado por TrackingScripts (root layout).
// Se o pixel não estiver configurado (sem ID) ou ainda não carregou, as chamadas viram no-op.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fbq = (...args: any[]) => void

function getFbq(): Fbq | null {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fbq = (window as any).fbq as Fbq | undefined
  return typeof fbq === "function" ? fbq : null
}

/** Evento padrão do Pixel (ViewContent, InitiateCheckout, Lead, Purchase...). */
export function trackPixel(event: string, params?: Record<string, unknown>): void {
  const fbq = getFbq()
  if (!fbq) return
  try {
    if (params) fbq("track", event, params)
    else fbq("track", event)
  } catch {
    // nunca deixa o tracking quebrar a UI
  }
}
