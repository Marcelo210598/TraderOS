// Tela do AI Partner (E7-15e, D-U3): estado e reducer PUROS do chat. A conversa vive na memória da página (não há listagem de conversas no backend). Regras:
//   · envio só com texto (≤ 4000 caracteres como digitado) e sem turno pendente; evento fora de hora é IGNORADO (estado idêntico);
//   · a pergunta mostrada é a que o usuário digitou (o servidor nunca a devolve); a resposta entra só se `toBlocks` a aceitar (senão BAD_RESPONSE);
//   · `retry` reenvia a MESMA pergunta (sem duplicar a mensagem) e só quando o erro tem ação "retry"; cota/pool (upgrade) não é "tentar de novo".
// Estados congelados; o reducer não muta a entrada e nunca lança.
import { errorView, type ErrorView } from "./errors.ts"
import { toBlocks, type AnswerView } from "./view.ts"

export const MAX_QUESTION_CHARS = 4000
export type ChatMessage =
  | { readonly id: number; readonly role: "user"; readonly text: string }
  | { readonly id: number; readonly role: "assistant"; readonly view: AnswerView }
export interface Usage { readonly used: number; readonly limit: number; readonly remaining: number }
export interface ChatState {
  readonly conversationId: string | null
  readonly messages: readonly ChatMessage[]
  readonly pending: boolean
  readonly error: ErrorView | null
  readonly usage: Usage | null
  readonly nextId: number
}
export type ChatEvent =
  | { readonly type: "send"; readonly question: string }
  | { readonly type: "reply"; readonly reply: unknown }
  | { readonly type: "fail"; readonly code: string; readonly retryAfterSec?: unknown; readonly suggestedPlan?: unknown }
  | { readonly type: "retry" }
  | { readonly type: "newConversation" }

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) }
  return x
}
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

export const initialChatState: ChatState = deepFreeze({ conversationId: null, messages: [], pending: false, error: null, usage: null, nextId: 1 })

export const canSend = (state: ChatState, draft: unknown): boolean => !state.pending && typeof draft === "string" && draft.trim() !== "" && draft.length <= MAX_QUESTION_CHARS
const lastUserText = (s: ChatState): string | null => { for (let i = s.messages.length - 1; i >= 0; i--) { const m = s.messages[i]; if (m.role === "user") return m.text } return null }
/** A pergunta do turno em andamento (para o transporte), ou null. */
export const pendingQuestion = (s: ChatState): string | null => (s.pending ? lastUserText(s) : null)
export const pendingConversationId = (s: ChatState): string | null => s.conversationId

const usageOf = (x: unknown): Usage | null => (isRecord(x) && [x.used, x.limit, x.remaining].every((n) => typeof n === "number" && Number.isFinite(n)) ? { used: x.used as number, limit: x.limit as number, remaining: x.remaining as number } : null)

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  try {
    switch (event.type) {
      case "send": {
        if (!canSend(state, event.question)) return state
        return deepFreeze({ ...state, messages: [...state.messages, { id: state.nextId, role: "user" as const, text: event.question }], pending: true, error: null, nextId: state.nextId + 1 })
      }
      case "reply": {
        if (!state.pending) return state
        const r = event.reply
        const view = isRecord(r) && r.ok === true && typeof r.conversationId === "string" ? toBlocks(r.response) : null
        if (view === null || !isRecord(r)) return deepFreeze({ ...state, pending: false, error: errorView("BAD_RESPONSE", { scope: "chat" }) })
        return deepFreeze({ ...state, conversationId: r.conversationId as string, messages: [...state.messages, { id: state.nextId, role: "assistant" as const, view }], pending: false, error: null, usage: usageOf(r.usage) ?? state.usage, nextId: state.nextId + 1 })
      }
      case "fail": {
        if (!state.pending) return state
        return deepFreeze({ ...state, pending: false, error: errorView(event.code, { retryAfterSec: event.retryAfterSec, suggestedPlan: event.suggestedPlan, scope: "chat" }) })
      }
      case "retry": {
        if (state.pending || state.error === null || state.error.action.kind !== "retry" || lastUserText(state) === null) return state
        return deepFreeze({ ...state, pending: true, error: null })
      }
      case "newConversation":
        return deepFreeze({ ...state, conversationId: null, messages: [], pending: false, error: null })
      default:
        return state
    }
  } catch {
    return state
  }
}
