import crypto from "crypto"

// Conversions API da Meta (server-side). Manda eventos direto do servidor pro pixel —
// mais confiável que o client-side (não depende de o navegador carregar o fbq).
// Usado para eventos que nascem no backend: cadastro (Lead) e pagamento (Purchase).
//
// Config (Vercel):
//   NEXT_PUBLIC_META_PIXEL_ID  — id do pixel (já usado no client)
//   META_CAPI_TOKEN            — token de acesso da Conversions API (gerado no pixel)
// Sem o token, tudo vira no-op (não quebra nada).

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID
const CAPI_TOKEN = process.env.META_CAPI_TOKEN
const API_VERSION = "v21.0"

// A Meta exige PII com hash SHA-256 (email, telefone...) em lowercase/trim.
function hash(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

interface CapiEventInput {
  eventName: "Lead" | "Purchase" | "CompleteRegistration"
  email?: string | null
  value?: number
  currency?: string
  eventId?: string // dedup com o pixel do browser, se houver
}

/** Envia um evento pela Conversions API. Nunca lança — feito para fluxos críticos. */
export async function sendCapiEvent(input: CapiEventInput): Promise<void> {
  if (!PIXEL_ID || !CAPI_TOKEN) return // pixel/token não configurados

  const userData: Record<string, string[]> = {}
  if (input.email) userData.em = [hash(input.email)]

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    user_data: userData,
  }
  if (input.eventId) event.event_id = input.eventId
  if (input.value != null) {
    event.custom_data = { value: input.value, currency: input.currency ?? "BRL" }
  }

  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
    })
    if (!res.ok) {
      console.error("[fbcapi]", res.status, await res.text().catch(() => ""))
    }
  } catch (e) {
    console.error("[fbcapi] falha ao enviar evento:", e instanceof Error ? e.message : e)
  }
}
