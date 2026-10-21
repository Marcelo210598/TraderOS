// Laço do chat do AI Partner (E7-16): pergunta → o MODELO escolhe ferramentas (1 chamada) → o servidor executa → o COMPOSITOR monta a resposta → validador/render → commit.
// O modelo nunca escreve o que o usuário vê: o texto dele é descartado. Reparo: UMA 2ª chamada, só se TODAS as ferramentas falharam com ARGS_INVALID (D-S1).
// A PORTA DO MODELO é injetada: este arquivo não conhece rede nem ambiente. Expectativa: docs/ai-partner/E7-16-expectativa.md (D-S1…D-S10); o laço antigo (E7-15a) está no git.
// Nada do que o modelo recebe contém hash, nome de arquivo ou CSV: só o envelope (PromptView) que o executor do turno já projeta e o código do erro.
import { CAPABILITY_LABELS } from "../agent/catalog.ts"
import type { CapabilityId } from "../agent/contract.ts"
import { composeAnswer, composeOffScope } from "../agent/composer.ts"
import { renderAnswer, type RenderedAnswer } from "../agent/render.ts"
import { SYSTEM_PROMPT } from "../agent/system-prompt.ts"
import { notices, validatorStop } from "../agent/turn.ts"
import { openTurn, type CommitCode, type OpenTurnCode, type TurnDeps, type TurnSession } from "./turn-session.ts"

/** Teto de tokens (soma dos `usage.totalTokens`) por turno; conferido ANTES do reparo (D-S1). */
export const MAX_TOKENS_PER_TURN = 6000
/** Teto absoluto de chamadas ao modelo por turno (D-S1): a escolha da ferramenta + no máximo 1 reparo de argumentos. */
export const MAX_MODEL_CALLS_PER_TURN = 2
/** Ferramentas executadas por resposta do modelo (D-S3); as excedentes são ignoradas. */
export const MAX_TOOL_CALLS_PER_TURN = 3

interface ToolDef { readonly name: string; readonly capability: CapabilityId; readonly description: string; readonly parameters: object }
// Ferramentas COMPACTAS (E7-15c, D-G10): cada chamada ao modelo leva o esquema de todas, e o plano base do provedor tem 8K tokens/min. Os valores válidos (metricIds, groupBy, filtros) ficam UMA vez no prompt do sistema;
// aqui só a forma. A validação estrita continua no servidor (zod, em agent-capabilities/). Um teste (G15) garante que propriedades/obrigatórias daqui existem nos esquemas do servidor.
const S = { type: "string" } as const
const OBJ = { type: "object" } as const
const LIST = { type: "array", items: S } as const
const ORDER = { type: "string", enum: ["DESC", "ASC"] } as const
const tool = (name: string, capability: CapabilityId, description: string, properties: Record<string, object>, required: string[] = []): ToolDef =>
  Object.freeze({ name, capability, description, parameters: Object.freeze({ type: "object", properties, ...(required.length > 0 ? { required } : {}) }) })
/** As 6 capacidades analíticas como ferramentas (D-S4: evidence.explain/refresh precisam de um evidenceRef que o modelo, sem histórico entre turnos, não conhece). O nome é o da API do modelo (sem "." nem "@"), mapeado 1:1 para o id da capacidade (D-L11). */
export const CHAT_TOOLS: readonly ToolDef[] = Object.freeze([
  tool("metrics_query", "metrics.query@1", "Valores de métricas sobre os trades importados.", { metricIds: LIST, filters: OBJ, options: OBJ }, ["metricIds"]),
  tool("metrics_groups", "metrics.groups@1", "Métricas agrupadas (por dia, hora, símbolo, conta…).", { groupBy: LIST, metricIds: LIST, filters: OBJ, options: OBJ }, ["groupBy", "metricIds"]),
  tool("exit_breakdown", "exit.breakdown@1", "Trades por motivo de saída (alvo, stop, manual).", { filters: OBJ, options: OBJ }),
  tool("metrics_compare", "metrics.compare@1", "Compara dois grupos ou dois períodos.", { mode: { type: "string", enum: ["GROUP", "PERIOD"] }, groupBy: LIST, a: OBJ, b: OBJ, metricIds: LIST, filters: OBJ, options: OBJ }, ["mode", "a", "b", "metricIds"]),
  tool("rank_groups", "rank.groups@1", "Ranking de grupos por uma métrica.", { groupBy: LIST, metric: S, order: ORDER, filters: OBJ, options: OBJ }, ["groupBy"]),
  tool("exit_analysis", "exit.analysis@1", "Análise por motivo de saída, com comparação opcional.", { compare: OBJ, filters: OBJ, options: OBJ }),
])
const TOOL_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(CHAT_TOOLS.map((t) => [t.name, t]))

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly content: string
  readonly toolCalls?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly arguments: unknown }>
  readonly toolCallId?: string
}
export interface ModelRequest { readonly messages: readonly ChatMessage[]; readonly tools: ReadonlyArray<{ readonly name: string; readonly description: string; readonly parameters: object }>; readonly toolChoice: "auto" | "none" }
export type ModelReply =
  | { readonly kind: "tool_calls"; readonly calls: ReadonlyArray<{ readonly id: string; readonly name: string; readonly arguments: unknown }>; readonly usage: { readonly totalTokens?: number } }
  | { readonly kind: "final"; readonly content: string; readonly usage: { readonly totalTokens?: number } }
  | { readonly kind: "error"; readonly code: string }
export interface ModelPort { complete(req: ModelRequest): Promise<ModelReply> }
export type ChatStep = { readonly kind: "capability"; readonly label: string } | { readonly kind: "validating" }

export interface ChatTurnRequest {
  readonly deps: TurnDeps
  readonly model: ModelPort
  readonly userId: string
  readonly pin: unknown
  readonly question: unknown
  readonly conversationId?: string | null
  readonly onStep?: (step: ChatStep) => void | Promise<void>
  /** Compositor injetável (testes simulam falha); padrão: o do servidor. */
  readonly compose?: typeof composeAnswer
}
export type ChatTurnCode = OpenTurnCode | CommitCode | "MODEL_ERROR" | "COMPOSE_FAILED"
export type ChatTurnResult =
  | { readonly ok: true; readonly conversationId: string; readonly version: number; readonly outcome: "ANSWERED" | "STOPPED"; readonly response: RenderedAnswer; readonly tokens: number; readonly modelCalls: number }
  | { readonly ok: false; readonly code: ChatTurnCode }

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const jstr = (x: unknown): string => JSON.stringify(x)
const API_TOOLS = CHAT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
const fail = (code: ChatTurnCode): { readonly ok: false; readonly code: ChatTurnCode } => ({ ok: false, code })
/** Uso inválido/ausente conta como o teto inteiro (fail-closed: custo desconhecido não é custo zero). */
const tokensOf = (reply: { usage?: unknown }): number => {
  const t = isRecord(reply.usage) ? reply.usage.totalTokens : undefined
  return typeof t === "number" && Number.isFinite(t) && t >= 0 ? t : MAX_TOKENS_PER_TURN
}

export async function runChatTurn(req: ChatTurnRequest): Promise<ChatTurnResult> {
  try {
    if (!isRecord(req) || !isRecord(req.model) || typeof req.model.complete !== "function") return fail("INVALID_ARGS")
    if (req.onStep !== undefined && typeof req.onStep !== "function") return fail("INVALID_ARGS")
    if (req.compose !== undefined && typeof req.compose !== "function") return fail("INVALID_ARGS")
    const question = req.question
    if (typeof question !== "string") return fail("INVALID_ARGS")
    const opened = await openTurn(req.deps, { userId: req.userId, conversationId: req.conversationId, pin: req.pin, userMessage: question })
    if (!opened.ok) return fail(opened.code)
    return await drive(opened.session, req.model, question, req.onStep, req.compose ?? composeAnswer)
  } catch {
    return fail("STORAGE_ERROR")
  }
}

type CallResult = { ok: boolean; code?: string; result?: Record<string, unknown> }
/** O envelope devolvido ao modelo no reparo e o que o servidor precisa saber de cada chamada. */
function describe(out: unknown): { content: string; argsInvalid: boolean; ref: string | null } {
  const o = (isRecord(out) ? out : {}) as CallResult
  if (o.ok !== true) return { content: jstr({ ok: false, error: { code: o.code } }), argsInvalid: o.code === "ARGS_INVALID", ref: null }
  const r = isRecord(o.result) ? o.result : {}
  const err = isRecord(r.error) ? r.error.code : undefined
  const ev = isRecord(r.evidence) ? r.evidence.evidenceRef : undefined
  return { content: jstr(r), argsInvalid: r.ok !== true && err === "ARGS_INVALID", ref: r.ok === true && typeof ev === "string" ? ev : null }
}

async function drive(session: TurnSession, model: ModelPort, question: string, onStep: ChatTurnRequest["onStep"], compose: typeof composeAnswer): Promise<ChatTurnResult> {
  const step = async (s: ChatStep): Promise<void> => { try { await onStep?.(s) } catch { /* o progresso é cortesia: nunca derruba o turno */ } }
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: question }]
  let tokens = 0, modelCalls = 0

  const finish = async (outcome: "ANSWERED" | "STOPPED", response: RenderedAnswer): Promise<ChatTurnResult> => {
    const c = await session.commit()
    return c.ok ? { ok: true, conversationId: session.conversationId, version: c.version, outcome, response, tokens, modelCalls } : fail(c.code)
  }
  /** Valida (auto-checagem) e comita uma resposta feita pelo servidor; qualquer recusa é bug nosso: COMPOSE_FAILED, sem regerar. */
  const answer = async (made: unknown): Promise<ChatTurnResult> => {
    await step({ kind: "validating" })
    const verdict = await session.validate(made, question)
    if (!verdict.ok) return fail("action" in verdict ? "COMPOSE_FAILED" : "TURN_CLOSED")
    const state = session.state()
    const rendered = renderAnswer({ answer: made, ledger: session.ledger(), notices: notices(state), stop: validatorStop(state), question })
    return rendered.ok ? finish("ANSWERED", rendered.rendered) : fail("COMPOSE_FAILED")
  }
  const failureStop = async (): Promise<ChatTurnResult> => {
    const stopped = await session.stopWithFailure()
    return stopped.ok ? finish("STOPPED", stopped.response) : fail("TURN_CLOSED")
  }

  for (;;) {
    const reply = await model.complete({ messages: messages.map((m) => ({ ...m })), tools: API_TOOLS, toolChoice: "auto" })
    modelCalls += 1
    if (!isRecord(reply) || reply.kind === "error") return fail("MODEL_ERROR")
    tokens += tokensOf(reply)

    // sem ferramenta (texto, lista vazia): o texto do modelo é DESCARTADO; resposta fixa do servidor (D-S2)
    if (reply.kind !== "tool_calls" || !Array.isArray(reply.calls) || reply.calls.length === 0) return messages.length > 2 ? failureStop() : answer(composeOffScope()) // depois do reparo, "sem ferramenta" = a consulta nunca foi corrigida

    const chosen = reply.calls.slice(0, MAX_TOOL_CALLS_PER_TURN)
    const results: Array<{ id: string; content: string; argsInvalid: boolean; ref: string | null }> = []
    for (const call of chosen) {
      const def = TOOL_BY_NAME.get(String(call.name))
      const out = await session.call(def !== undefined ? def.capability : String(call.name), call.arguments)
      if (isRecord(out) && out.ok === true && def !== undefined) await step({ kind: "capability", label: CAPABILITY_LABELS[def.capability] })
      results.push({ id: String(call.id), ...describe(out) })
    }
    const refs = results.flatMap((r) => (r.ref === null ? [] : [r.ref]))
    if (refs.length > 0) {
      let composed: ReturnType<typeof composeAnswer>
      try { composed = compose({ ledger: session.ledger(), refs }) } catch { return fail("COMPOSE_FAILED") }
      return composed.ok ? answer(composed.answer) : fail("COMPOSE_FAILED")
    }
    // nada deu certo: reparo SÓ se todas falharam por ARGS_INVALID e ainda há chamada e orçamento (D-S1)
    if (results.every((r) => r.argsInvalid) && modelCalls < MAX_MODEL_CALLS_PER_TURN && tokens < MAX_TOKENS_PER_TURN) {
      messages.push({ role: "assistant", content: "", toolCalls: chosen.map((c) => ({ id: String(c.id), name: String(c.name), arguments: c.arguments })) })
      for (const r of results) messages.push({ role: "tool", toolCallId: r.id, content: r.content })
      continue
    }
    return failureStop()
  }
}
