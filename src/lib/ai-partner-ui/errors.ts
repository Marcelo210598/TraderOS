// Tela do AI Partner (E7-15e): código de erro do backend (ou do cliente) → mensagem pt-BR e AÇÃO. As mensagens são NOSSAS (revisadas): o texto que vem do servidor nunca é repassado.
// ERROR_CODES = códigos do chat + do upload + os do cliente; um teste lê o código-fonte do backend e derruba o build se surgir código sem mapa. Puro, nunca lança.
export type ErrorAction =
  | { readonly kind: "upgrade"; readonly suggestedPlan: "TRADER" | "PRO" | null }
  | { readonly kind: "retry"; readonly afterSec: number }
  | { readonly kind: "import" }
  | { readonly kind: "newConversation" }
  | { readonly kind: "none" }
export interface ErrorView { readonly code: string; readonly message: string; readonly action: ErrorAction }
export interface ErrorExtra { readonly retryAfterSec?: unknown; readonly suggestedPlan?: unknown; readonly scope?: "chat" | "imports" }

/** Mensagem + ação por código; `retry` leva o padrão de espera (s) quando o servidor não manda `Retry-After`. */
const TABLE: Readonly<Record<string, { readonly message: string; readonly kind: ErrorAction["kind"]; readonly wait?: number }>> = Object.freeze({
  INVALID_REQUEST: { message: "Não consegui enviar esse pedido. Confira o texto e tente de novo.", kind: "none" },
  INVALID_ARGS: { message: "Algum dado do pedido está inválido. Confira e tente de novo.", kind: "none" },
  INVALID_ENCODING: { message: "O arquivo precisa estar em UTF-8. Salve o CSV nesse formato e envie de novo.", kind: "none" },
  UNSUPPORTED_MEDIA_TYPE: { message: "Esse tipo de envio não é aceito. Use um arquivo CSV.", kind: "none" },
  TOO_LARGE: { message: "O pedido ficou grande demais. Envie algo menor.", kind: "none" },
  TOO_LARGE_FOR_ROUTE: { message: "O arquivo é grande demais para o envio (limite de 4 MiB, cerca de 20 mil trades). Divida em arquivos menores.", kind: "none" },
  PIPELINE_FAILED: { message: "Não consegui ler esse CSV. Confira se é uma exportação de trades no formato esperado.", kind: "none" },
  CONTEXT_CONFLICT: { message: "Este arquivo já foi enviado com outras opções de importação.", kind: "none" },
  FORBIDDEN_ORIGIN: { message: "Não foi possível confirmar a origem do pedido. Recarregue a página e tente de novo.", kind: "none" },
  NOT_CONFIGURED: { message: "O AI Partner não está disponível no momento.", kind: "none" },
  UNAUTHENTICATED: { message: "Sua sessão expirou. Entre de novo para continuar.", kind: "none" },
  BAD_RESPONSE: { message: "Recebi uma resposta que não consegui entender. Tente de novo em instantes.", kind: "none" },
  NOT_FOUND: { message: "Não encontrei esse item. Atualize a página.", kind: "none" },
  NO_IMPORTS: { message: "Envie um arquivo de trades antes de conversar.", kind: "import" },
  QUOTA_EXCEEDED: { message: "Você usou todos os turnos deste mês.", kind: "upgrade" },
  FREE_POOL_EXHAUSTED: { message: "O teste gratuito deste mês acabou. Assine para continuar.", kind: "upgrade" },
  CONVERSATION_FULL: { message: "Esta conversa chegou ao limite. Comece uma nova.", kind: "newConversation" },
  BUSY: { message: "Muitos pedidos agora. Tente de novo em instantes.", kind: "retry", wait: 5 },
  RATE_LIMITED: { message: "Muitas requisições seguidas. Aguarde um pouco e tente de novo.", kind: "retry", wait: 10 },
  TURN_IN_PROGRESS: { message: "Ainda estou respondendo à pergunta anterior. Aguarde um instante.", kind: "retry", wait: 3 },
  TURN_CONFLICT: { message: "A conversa mudou durante a resposta. Tente de novo.", kind: "retry", wait: 0 },
  MODEL_UNAVAILABLE: { message: "O assistente está indisponível agora. Tente de novo em instantes.", kind: "retry", wait: 5 },
  STORAGE_ERROR: { message: "Não foi possível processar agora. Tente de novo.", kind: "retry", wait: 5 },
  NETWORK: { message: "Sem conexão com o servidor. Confira sua internet e tente de novo.", kind: "retry", wait: 3 },
  TIMEOUT: { message: "A resposta demorou demais. Tente de novo.", kind: "retry", wait: 5 },
})
export const ERROR_CODES: readonly string[] = Object.freeze(Object.keys(TABLE))
const GENERIC = "Algo deu errado. Tente de novo."
const MAX_WAIT_SEC = 120

const waitOf = (given: unknown, fallback: number): number => {
  if (typeof given === "number" && Number.isFinite(given) && given >= 1) return Math.min(MAX_WAIT_SEC, Math.ceil(given))
  return fallback
}

export function errorView(code: unknown, extra: ErrorExtra = {}): ErrorView {
  try {
    const known = typeof code === "string" && Object.hasOwn(TABLE, code)
    const c = known ? (code as string) : "UNKNOWN"
    const row = known ? TABLE[c] : { message: GENERIC, kind: "none" as const }
    let action: ErrorAction
    switch (row.kind) {
      case "upgrade": action = { kind: "upgrade", suggestedPlan: extra.suggestedPlan === "TRADER" || extra.suggestedPlan === "PRO" ? extra.suggestedPlan : null }; break
      case "retry": action = { kind: "retry", afterSec: waitOf(extra.retryAfterSec, row.wait ?? 5) }; break
      case "newConversation": action = { kind: "newConversation" }; break
      case "import": action = { kind: "import" }; break
      default: action = c === "NOT_FOUND" && extra.scope === "chat" ? { kind: "newConversation" } : { kind: "none" }
    }
    const message = c === "NOT_FOUND" && extra.scope === "chat" ? "Não encontrei essa conversa. Comece uma nova." : row.message
    return Object.freeze({ code: c, message, action: Object.freeze(action) })
  } catch {
    return Object.freeze({ code: "UNKNOWN", message: GENERIC, action: Object.freeze({ kind: "none" as const }) })
  }
}
