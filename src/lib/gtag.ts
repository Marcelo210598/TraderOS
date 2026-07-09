// Helpers client-side pro GA4/Google Ads. `gtag` é injetado por TrackingScripts (root layout).
// Se GA_ID/GOOGLE_ADS_ID não estiverem configurados (sem ID) ou o script ainda não carregou,
// as chamadas viram no-op.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gtag = (...args: any[]) => void

const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
// Labels de conversão gerados ao criar cada "ação de conversão" no Google Ads.
// Sem o label correspondente, aquele evento específico vira no-op (não quebra nada).
const ADS_LABEL_LEAD = process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_LEAD
const ADS_LABEL_CHECKOUT = process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_CHECKOUT

function getGtag(): Gtag | null {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gtag = (window as any).gtag as Gtag | undefined
  return typeof gtag === "function" ? gtag : null
}

/** Evento GA4 (view_content, begin_checkout...). */
export function trackGtagEvent(event: string, params?: Record<string, unknown>): void {
  const gtag = getGtag()
  if (!gtag) return
  try {
    gtag("event", event, params)
  } catch {
    // nunca deixa o tracking quebrar a UI
  }
}

/** Conversão do Google Ads (precisa do label criado na conta de Ads). */
function trackGoogleAdsConversion(label: string | undefined, params?: Record<string, unknown>): void {
  const gtag = getGtag()
  if (!gtag || !GOOGLE_ADS_ID || !label) return
  try {
    gtag("event", "conversion", { send_to: `${GOOGLE_ADS_ID}/${label}`, ...params })
  } catch {
    // nunca deixa o tracking quebrar a UI
  }
}

export function trackGoogleAdsLead(): void {
  trackGoogleAdsConversion(ADS_LABEL_LEAD)
}

export function trackGoogleAdsCheckout(value?: number): void {
  trackGoogleAdsConversion(ADS_LABEL_CHECKOUT, value != null ? { value, currency: "BRL" } : undefined)
}
