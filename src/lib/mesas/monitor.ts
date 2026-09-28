// Monitor semanal do Help Center da Lucid: detecta quando um artigo de regra mudou pra o Marcelo revisar `lucid.ts`.
// Funções PURAS (sem rede, sem banco) pra testar em scripts/test-mesas-monitor.mts. A rota que usa isto: /api/cron/mesas-check.
// Só o Help Center (Intercom, abre por HTTP normal). O site principal dá 403 Cloudflare e NÃO entra aqui: não burlamos anti-robô.

import { createHash } from "node:crypto"

export const HELP_CENTER_HOST = "support.lucidtrading.com"
const BASE_ARTIGOS = `https://${HELP_CENTER_HOST}/en/articles/`

/**
 * Artigos das regras dos 4 planos públicos + regras gerais + Live novo (44 dos 59 lidos em 28/09/2026).
 * Ficam de fora: missão, LucidBlack (legado), LucidMaxx (só convite) e Live legado (contas até 27/02/2026).
 * Ao criar plano novo ou artigo novo relevante: acrescentar o slug aqui (o teste confere contra lucid.ts).
 */
export const ARTIGOS_LUCID: readonly string[] = [
  "11404614-lucid-trading-supported-platforms",
  "11404617-maximum-number-of-accounts",
  "11404620-simulated-account-fees",
  "11404628-accepted-payments-methods",
  "11404632-inactivity-policy",
  "11404634-registering-as-a-business",
  "11404636-restricted-countries",
  "11404728-other-trading-activities",
  "11404729-allowed-trading-times",
  "11404732-trade-with-integrity",
  "11404734-prohibited-hedging",
  "11404736-prohibited-high-frequency-trading",
  "11404742-prohibited-microscalping",
  "11508978-approved-products-and-commissions",
  "12890029-lucidpro-evaluation-account",
  "12890069-lucidpro-funded-account",
  "12890092-lucidpro-payouts",
  "12890109-lucidpro-consistency-percentage",
  "12890122-lucidpro-daily-loss-limit",
  "12890136-lucidpro-drawdown",
  "12890148-luciddirect-funded-account",
  "12890164-luciddirect-payout-objectives",
  "12890178-luciddirect-consistency-percentage",
  "12890185-luciddirect-daily-loss-limit",
  "12890192-luciddirect-drawdown",
  "12890325-payout-methods",
  "12945790-lucidflex-evaluation-account",
  "12945795-lucidflex-funded-account",
  "12945796-lucidflex-payouts",
  "12945805-lucidflex-consistency-percentage",
  "12945808-lucidflex-scaling-plan",
  "12945815-lucidflex-drawdown",
  "13425130-new-live-structure",
  "15245873-new-live-scaling-plan",
  "15996664-luciddaily-evaluation",
  "15997244-luciddaily-funded-account",
  "15997266-luciddaily-payouts",
  "15998336-luciddaily-consistency",
  "15998425-luciddaily-drawdown",
  "16010520-luciddaily-live",
  "16033858-luciddaily-customization",
  "16085900-luciddaily-daily-loss-limit",
  "16226050-lucidflex-customization",
  "16226068-lucidpro-customization",
]

export const urlArtigo = (slug: string) => `${BASE_ARTIGOS}${slug}`

/** Anti-SSRF: só https, host EXATO do Help Center e caminho de artigo. */
export function urlPermitida(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === "https:" &&
      u.hostname === HELP_CENTER_HOST &&
      u.port === "" &&
      u.username === "" &&
      u.password === "" &&
      u.pathname.startsWith("/en/articles/")
    )
  } catch {
    return false
  }
}

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " }

function decodificar(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** Texto limpo (uma linha por bloco) de dentro do <article>. null = página sem article (bloqueio/mudança de layout). */
export function extrairTexto(html: string): string | null {
  const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (!m) return null
  const texto = decodificar(
    m[1]
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
  // Artigo real tem bem mais que isso; abaixo disso é erro de leitura, não "artigo esvaziado".
  return texto.length >= 50 ? texto : null
}

export const hashTexto = (texto: string) => createHash("sha256").update(texto).digest("hex")

export interface Diferenca {
  removidas: string[]
  adicionadas: string[]
}

/** Diferença por linha (conjunto): o que saiu e o que entrou, na ordem do texto. Suficiente pra revisar regra. */
export function diffLinhas(antigo: string, novo: string): Diferenca {
  const linhasAntigas = antigo.split("\n")
  const linhasNovas = novo.split("\n")
  const antigas = new Set(linhasAntigas)
  const novas = new Set(linhasNovas)
  return {
    removidas: linhasAntigas.filter((l) => !novas.has(l)),
    adicionadas: linhasNovas.filter((l) => !antigas.has(l)),
  }
}

/** "12945796-lucidflex-payouts" → "lucidflex payouts" */
export const tituloDoSlug = (slug: string) => slug.replace(/^\d+-/, "").replace(/-/g, " ")
