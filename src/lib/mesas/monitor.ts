// Monitor semanal das mesas (Lucid: Help Center; FFF: páginas do site): detecta quando uma regra mudou pra o Marcelo revisar os dados.
// Funções PURAS (sem rede, sem banco) pra testar em scripts/test-mesas-monitor.mts. A rota que usa isto: /api/cron/mesas-check.
// Lucid: só o Help Center (Intercom); o site principal dá 403 Cloudflare e NÃO entra aqui (não burlamos anti-robô). FFF: site WordPress abre normal.

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

const SITE_FFF = "https://www.fundedfuturesfamily.com"

/**
 * Páginas da Funded Futures Family que definem regra (35 lidas em 28/09/2026): 5 páginas de plano, regras de saque,
 * velocidade de saque, Termos e 27 FAQs de regra. O blog fica de fora (marketing comparativo). A página de saques ao vivo
 * também (muda a cada pagamento). Cada item é o caminho sem barras nas pontas.
 */
export const PAGINAS_FFF: readonly string[] = [
  "prime-plan",
  "velocity-plan",
  "premier-plan",
  "straight-to-funded",
  "s2f-accelerate",
  "payout-rules",
  "payout-speed",
  "terms-and-conditions",
  "faq/does-funded-futures-family-charge-an-activation-fee",
  "faq/are-there-monthly-or-recurring-fees",
  "faq/what-is-straight-to-funded-and-what-does-it-cost",
  "faq/how-much-does-a-funded-futures-account-cost",
  "faq/how-much-does-it-cost-to-get-a-funded-futures-account",
  "faq/how-long-does-it-take-to-pass-an-evaluation",
  "faq/how-fast-does-my-funded-account-activate-after-passing",
  "faq/how-many-funded-accounts-can-i-have",
  "faq/what-account-sizes-are-available",
  "faq/is-news-trading-allowed",
  "faq/is-there-a-daily-loss-limit",
  "faq/can-i-hold-positions-overnight",
  "faq/can-i-scalp-or-trade-micros",
  "faq/what-is-fff-advanced-monitoring-system",
  "faq/what-happens-if-i-break-a-rule",
  "faq/what-happens-if-i-fail-or-blow-the-evaluation",
  "faq/does-funded-futures-family-deny-payouts",
  "faq/how-fast-does-funded-futures-family-pay-out",
  "faq/how-much-of-my-profit-do-i-keep",
  "faq/can-i-trade-commodity-futures",
  "faq/what-trading-platforms-does-fff-support",
  "faq/what-happens-if-i-blow-my-funded-account",
  "faq/where-is-fff-based-and-who-can-trade",
  "faq/how-do-i-get-to-the-live-account",
  "faq/does-funded-futures-family-have-a-consistency-rule",
  "faq/what-plans-does-fff-offer",
  "faq/what-is-the-consistency-rule-in-prop-firms-and-does-fff-have-one",
]

export const urlPaginaFff = (caminho: string) => `${SITE_FFF}/${caminho}/`

/**
 * Help Center oficial da FFF (Intercom, 60 artigos lidos em 28/09/2026): a fonte mais detalhada e a que manda quando
 * as páginas de venda divergem. Inclui Base plan e Prestige (não aparecem nas páginas de venda), pra avisar se virarem públicos.
 */
export const ARTIGOS_FFF_HELP: readonly string[] = [
  "10697823-refund-policy-and-cancellation",
  "11157829-understanding-your-billing-cycle",
  "11157832-refund-policy-explained",
  "13289636-professional-stage-account-performance-check-account-pca",
  "15650632-what-is-funded-futures-family",
  "15650686-can-i-trade-under-my-business",
  "15650704-creating-your-funded-futures-family-account",
  "15650785-account-fees",
  "15656536-connecting-your-trading-platform",
  "15657092-prime-evaluation-account",
  "15695739-how-many-accounts-per-household",
  "15696806-accepted-payments-methods",
  "15697017-payout-methods",
  "15705476-prime-funded-account",
  "15715050-prime-payout-requirements",
  "15808673-prime-consistency",
  "15808767-prime-drawdown",
  "15809232-premier-evaluation",
  "15811095-premier-funded-account",
  "15811464-premier-payout-requirements",
  "15850031-premier-drawdown",
  "15850710-velocity-evaluation",
  "15851015-velocity-funded-account",
  "15878902-velocity-payout-requirements",
  "15879043-velocity-consistency",
  "15879485-velocity-drawdown",
  "15879855-straight-to-funded-s2f-funded-account",
  "15879981-straight-to-funded-s2f-payout-requirements",
  "15880555-straight-to-funded-s2f-consistency-percentage",
  "15880602-straight-to-funded-s2f-drawdown",
  "15880840-professional-stage-structure",
  "15890961-professional-stage-payouts",
  "15891902-professional-stage-operational-policies",
  "15892228-live-stage-structure",
  "15892316-rules-restricted-countries-regions",
  "15892350-permitted-times-to-trade",
  "15892353-news-trading-policy",
  "15892376-fair-play-and-integrity-policy",
  "15892413-bots-algorithmic-trading-policy",
  "15892419-micro-scalping-policy",
  "15892427-maximum-account-idle-time",
  "16302640-prime-scaling-plan",
  "16302826-premier-scaling-plan",
  "16310772-velocity-scaling-plan",
  "16310780-straight-to-funded-s2f-scaling-plan",
  "16311789-do-first-time-users-get-any-special-offers",
  "16418181-professional-stage-account-performance-check-account-pca",
  "16544461-third-party-name-purchases",
  "16911595-prestige-evaluation",
  "16949878-accelerate-plan-funded-account",
  "16950249-accelerate-plan-payout-requirements",
  "16964667-premier-consistency",
  "16964735-s2f-accelerate-plan-consistency-percentage",
  "16964753-s2f-accelerate-plan-drawdown",
  "17075322-base-plan-evaluation",
  "17076299-base-plan-funded-account",
  "17079566-base-plan-payout-requirements",
  "17082450-base-plan-drawdown",
  "17083162-base-plan-scaling-plan",
  "17155892-device-sharing",
]

const HELP_FFF = "https://intercom.help/funded-futures-family/en/articles"

/** Itens da FFF: caminho do site (`prime-plan`) ou `hc/<slug>` (artigo do Help Center). */
export const urlItemFff = (id: string) => (id.startsWith("hc/") ? `${HELP_FFF}/${id.slice(3)}` : urlPaginaFff(id))

/** O que o cron vigia de cada mesa. `id` é estável (vira parte da chave no Redis). */
export interface AlvoMonitor {
  /** Slug da mesa (prefixo das chaves `mesas:<mesa>:*`). */
  mesa: string
  /** Nome curto que aparece na notificação. */
  nome: string
  /** "artigos" (Help Center) ou "páginas" (site). */
  rotulo: string
  itens: readonly string[]
  urlDe: (id: string) => string
}

export const ALVOS_MONITOR: readonly AlvoMonitor[] = [
  { mesa: "lucid", nome: "Lucid", rotulo: "artigos", itens: ARTIGOS_LUCID, urlDe: urlArtigo },
  { mesa: "fff", nome: "Funded Futures Family", rotulo: "páginas", itens: [...PAGINAS_FFF, ...ARTIGOS_FFF_HELP.map((a) => `hc/${a}`)], urlDe: urlItemFff },
]

const URLS_PERMITIDAS = new Set(ALVOS_MONITOR.flatMap((a) => a.itens.map((id) => a.urlDe(id))))

/**
 * Mesas que o servidor NÃO consegue ler (Cloudflare devolve 403 e não burlamos anti-robô). O cron só LEMBRA o admin
 * de conferir à mão pelo Chrome (docs/mesas-proprietarias/<doc>).
 */
export interface AlvoManual {
  mesa: string
  nome: string
  motivo: string
  /** Roteiro da conferência manual (caminho em docs/mesas-proprietarias/). */
  doc: string
}

export const ALVOS_MANUAIS: readonly AlvoManual[] = [
  { mesa: "apex", nome: "Apex Trader Funding", motivo: "o site fica atrás de Cloudflare", doc: "apex-conferencia.md" },
  { mesa: "tradeify", nome: "Tradeify", motivo: "o Help Center fica atrás de Cloudflare", doc: "tradeify-conferencia.md" },
]

/** Lembrete mensal: só na primeira segunda-feira do mês (UTC), que é quando o cron semanal cai entre os dias 1 e 7. */
export const lembreteManualDevido = (d: Date) => d.getUTCDay() === 1 && d.getUTCDate() <= 7

/** Anti-SSRF: só as URLs EXATAS que estão nas listas acima (https, host e caminho certos). Qualquer outra é recusada. */
export function urlPermitida(url: string): boolean {
  return URLS_PERMITIDAS.has(url)
}

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " }

function decodificar(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** Texto limpo (uma linha por bloco) de dentro do <article> (ou do <main>, quando não há article: FAQs da FFF). null = nenhum dos dois (bloqueio/mudança de layout). */
export function extrairTexto(html: string): string | null {
  const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ?? html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
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

/** "12945796-lucidflex-payouts" → "lucidflex payouts"; "faq/is-news-trading-allowed" → "is news trading allowed" */
export const tituloDoSlug = (slug: string) => slug.replace(/^(faq|hc)\//, "").replace(/^\d+-/, "").replace(/-/g, " ")
