// ─── Cliente da API Asaas ─────────────────────────────────────────────────────
// Docs: https://docs.asaas.com/reference
// Ambiente controlado por ASAAS_ENV ("sandbox" | "production").
//
// Estratégia de checkout: LINK DE PAGAMENTO recorrente (chargeType=RECURRENT).
// Criamos 1 link por usuário/checkout com externalReference=userId. A página
// hospedada do Asaas coleta CPF/nome/forma de pagamento (Pix/cartão/boleto) —
// não guardamos PII. O webhook mapeia o pagamento de volta via externalReference.

import type { BillingCycle } from "@/lib/plans"

const ENV = process.env.ASAAS_ENV ?? "sandbox"
const API_KEY = process.env.ASAAS_API_KEY ?? ""

const BASE_URL =
  ENV === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3"

export function isAsaasConfigured(): boolean {
  return API_KEY.length > 0
}

interface AsaasError {
  errors?: { code: string; description: string }[]
}

async function asaasFetch<T>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown }
): Promise<T> {
  if (!API_KEY) throw new Error("ASAAS_API_KEY não configurada")

  const { body, ...rest } = init ?? {}
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      access_token: API_KEY,
      "User-Agent": "TraderOS",
      ...(rest.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  })

  const text = await res.text()
  const json = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const err = json as AsaasError
    const msg =
      err.errors?.map((e) => e.description).join("; ") || `Asaas ${res.status}`
    throw new Error(`Asaas API: ${msg}`)
  }

  return json as T
}

// ─── Payment Links ────────────────────────────────────────────────────────────

export interface AsaasPaymentLink {
  id: string
  url: string
  active: boolean
  externalReference?: string
}

export async function createRecurrentPaymentLink(params: {
  name: string
  value: number
  cycle: BillingCycle
  description: string
  externalReference: string
}): Promise<AsaasPaymentLink> {
  return asaasFetch<AsaasPaymentLink>("/paymentLinks", {
    method: "POST",
    body: {
      name: params.name,
      billingType: "UNDEFINED", // cliente escolhe Pix/cartão/boleto
      chargeType: "RECURRENT",
      subscriptionCycle: params.cycle,
      value: params.value,
      dueDateLimitDays: 7,
      description: params.description,
      externalReference: params.externalReference,
      notificationEnabled: true,
    },
  })
}

// Desativa um link (não cancela assinaturas já criadas a partir dele).
export async function deletePaymentLink(id: string): Promise<void> {
  await asaasFetch(`/paymentLinks/${id}`, { method: "DELETE" })
}

// ─── Subscriptions (cancelamento via webhook/painel) ──────────────────────────

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await asaasFetch(`/subscriptions/${subscriptionId}`, { method: "DELETE" })
}
