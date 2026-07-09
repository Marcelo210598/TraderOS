import crypto from "crypto"

// Measurement Protocol do GA4 (server-side). Manda eventos direto do servidor pro GA4 —
// mesma lógica do fbcapi.ts, pra eventos que nascem no backend: cadastro (generate_lead)
// e pagamento (purchase).
//
// Config (Vercel):
//   NEXT_PUBLIC_GA_ID  — id da propriedade (já usado no client)
//   GA4_API_SECRET     — secret gerado em GA4 → Admin → Fluxo de dados → Measurement Protocol
// Sem o secret, tudo vira no-op (não quebra nada).

const GA_ID = process.env.NEXT_PUBLIC_GA_ID
const API_SECRET = process.env.GA4_API_SECRET

interface Ga4EventInput {
  eventName: "generate_lead" | "purchase"
  // GA4 exige um client_id. Sem sessão de browser (evento nasce no servidor), usamos
  // um pseudo-id estável derivado do identificador do usuário — não casa com a sessão
  // real do GA, mas mantém os eventos de um mesmo usuário agrupados entre si.
  userKey: string
  value?: number
  currency?: string
  transactionId?: string // dedup, ex: payment.id
}

function pseudoClientId(userKey: string): string {
  return crypto.createHash("sha256").update(userKey).digest("hex").slice(0, 32)
}

/** Envia um evento pelo Measurement Protocol do GA4. Nunca lança. */
export async function sendGa4Event(input: Ga4EventInput): Promise<void> {
  if (!GA_ID || !API_SECRET) return // GA4/secret não configurados

  const params: Record<string, unknown> = {}
  if (input.value != null) {
    params.value = input.value
    params.currency = input.currency ?? "BRL"
  }
  if (input.transactionId) params.transaction_id = input.transactionId

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${API_SECRET}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: pseudoClientId(input.userKey),
        events: [{ name: input.eventName, params }],
      }),
    })
    if (!res.ok) {
      console.error("[ga4]", res.status, await res.text().catch(() => ""))
    }
  } catch (e) {
    console.error("[ga4] falha ao enviar evento:", e instanceof Error ? e.message : e)
  }
}
