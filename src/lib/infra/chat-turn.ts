// Laço do chat do AI Partner (E7-15a): pergunta → ferramentas → resposta → validador → regeração → commit. A PORTA DO MODELO é injetada: este arquivo não conhece rede
// nem ambiente (o provedor real entra no E7-15c). Expectativa: docs/ai-partner/E7-15a-expectativa.md (D-L1…D-L13). Nada do que o modelo recebe contém hash, nome de arquivo ou CSV:
// só o envelope (PromptView) que o executor do turno já projeta, e códigos de rejeição (nunca o texto rejeitado).
import { CAPABILITY_LABELS } from "../agent/catalog.ts"
import type { CapabilityId } from "../agent/contract.ts"
import { renderAnswer, type RenderedAnswer } from "../agent/render.ts"
import { SYSTEM_PROMPT } from "../agent/system-prompt.ts"
import { notices, validatorStop } from "../agent/turn.ts"
import { openTurn, type CommitCode, type OpenTurnCode, type TurnDeps, type TurnSession } from "./turn-session.ts"

/** Teto de tokens (soma dos `usage.totalTokens`) por turno; conferido ANTES de cada nova chamada ao modelo (D-L3b). Ponto de partida: o E7-15d mede e ajusta. */
export const MAX_TOKENS_PER_TURN = 16000
/** Teto absoluto de chamadas ao modelo por turno (D-L10): 8 capacidades + 3 respostas finais cabem com folga. */
export const MAX_MODEL_CALLS_PER_TURN = 12
const MAX_CONSECUTIVE_ARGS_INVALID = 2

interface ToolDef { readonly name: string; readonly capability: CapabilityId; readonly description: string; readonly parameters: object }
// Ferramentas COMPACTAS (E7-15c, D-G10): cada chamada ao modelo leva o esquema de todas, e o plano base do provedor tem 8K tokens/min. Os valores válidos (metricIds, groupBy, filtros) ficam UMA vez no prompt do sistema;
// aqui só a forma. A validação estrita continua no servidor (zod, em agent-capabilities/). Um teste (G15) garante que propriedades/obrigatórias daqui existem nos esquemas do servidor.
const S = { type: "string" } as const
const OBJ = { type: "object" } as const
const LIST = { type: "array", items: S } as const
const ORDER = { type: "string", enum: ["DESC", "ASC"] } as const
const tool = (name: string, capability: CapabilityId, description: string, properties: Record<string, object>, required: string[] = []): ToolDef =>
  Object.freeze({ name, capability, description, parameters: Object.freeze({ type: "object", properties, ...(required.length > 0 ? { required } : {}) }) })
/** As 8 capacidades como ferramentas. O nome é o da API do modelo (sem "." nem "@"), mapeado 1:1 para o id da capacidade (D-L11). */
export const CHAT_TOOLS: readonly ToolDef[] = Object.freeze([
  tool("metrics_query", "metrics.query@1", "Valores de métricas sobre os trades importados.", { metricIds: LIST, filters: OBJ, options: OBJ }, ["metricIds"]),
  tool("metrics_groups", "metrics.groups@1", "Métricas agrupadas (por dia, hora, símbolo, conta…).", { groupBy: LIST, metricIds: LIST, filters: OBJ, options: OBJ }, ["groupBy", "metricIds"]),
  tool("exit_breakdown", "exit.breakdown@1", "Trades por motivo de saída (alvo, stop, manual).", { filters: OBJ, options: OBJ }),
  tool("metrics_compare", "metrics.compare@1", "Compara dois grupos ou dois períodos.", { mode: { type: "string", enum: ["GROUP", "PERIOD"] }, groupBy: LIST, a: OBJ, b: OBJ, metricIds: LIST, filters: OBJ, options: OBJ }, ["mode", "a", "b", "metricIds"]),
  tool("rank_groups", "rank.groups@1", "Ranking de grupos por uma métrica.", { groupBy: LIST, metric: S, order: ORDER, filters: OBJ, options: OBJ }, ["groupBy"]),
  tool("exit_analysis", "exit.analysis@1", "Análise por motivo de saída, com comparação opcional.", { compare: OBJ, filters: OBJ, options: OBJ }),
  tool("evidence_explain", "evidence.explain@1", "Detalha os trades (até 20 por página) de uma evidência.", { evidenceRef: S, page: { type: "integer" } }, ["evidenceRef"]),
  tool("evidence_refresh", "evidence.refresh@1", "Refaz uma evidência desatualizada.", { evidenceRef: S }, ["evidenceRef"]),
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
}
export type ChatTurnCode = OpenTurnCode | CommitCode | "MODEL_ERROR"
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
    const question = req.question
    if (typeof question !== "string") return fail("INVALID_ARGS")
    const opened = await openTurn(req.deps, { userId: req.userId, conversationId: req.conversationId, pin: req.pin, userMessage: question })
    if (!opened.ok) return fail(opened.code)
    return await drive(opened.session, req.model, question, req.onStep)
  } catch {
    return fail("STORAGE_ERROR")
  }
}

async function drive(session: TurnSession, model: ModelPort, question: string, onStep: ChatTurnRequest["onStep"]): Promise<ChatTurnResult> {
  const step = async (s: ChatStep): Promise<void> => { try { await onStep?.(s) } catch { /* o progresso é cortesia: nunca derruba o turno */ } }
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: question }]
  let tokens = 0, modelCalls = 0, invalidInARow = 0
  let toolChoice: "auto" | "none" = "auto"

  const finish = async (outcome: "ANSWERED" | "STOPPED", response: RenderedAnswer): Promise<ChatTurnResult> => {
    const c = await session.commit()
    return c.ok ? { ok: true, conversationId: session.conversationId, version: c.version, outcome, response, tokens, modelCalls } : fail(c.code)
  }

  for (;;) {
    if (tokens >= MAX_TOKENS_PER_TURN || modelCalls >= MAX_MODEL_CALLS_PER_TURN) {
      const stopped = await session.stopForBudget()
      return stopped.ok ? finish("STOPPED", stopped.response) : fail("TURN_CLOSED")
    }
    const reply = await model.complete({ messages: messages.map((m) => ({ ...m })), tools: API_TOOLS, toolChoice })
    modelCalls += 1
    if (!isRecord(reply) || reply.kind === "error") return fail("MODEL_ERROR")
    tokens += tokensOf(reply)

    if (reply.kind === "tool_calls" && toolChoice === "auto" && Array.isArray(reply.calls)) {
      messages.push({ role: "assistant", content: "", toolCalls: reply.calls.map((c) => ({ id: String(c.id), name: String(c.name), arguments: c.arguments })) })
      for (const call of reply.calls) {
        const def = TOOL_BY_NAME.get(String(call.name))
        const out = await session.call(def !== undefined ? def.capability : String(call.name), call.arguments)
        let content: string
        if (!out.ok) {
          content = jstr({ ok: false, error: { code: out.code } })
          if (out.code === "BUDGET_EXCEEDED") toolChoice = "none"
          if (out.code === "ARGS_INVALID") invalidInARow += 1
        } else {
          content = jstr(out.result)
          if (def !== undefined) await step({ kind: "capability", label: CAPABILITY_LABELS[def.capability] })
          if (out.result.ok) invalidInARow = 0
          else if (out.result.error?.code === "ARGS_INVALID") invalidInARow += 1
        }
        if (invalidInARow >= MAX_CONSECUTIVE_ARGS_INVALID) toolChoice = "none"
        messages.push({ role: "tool", toolCallId: String(call.id), content })
      }
      continue
    }

    // resposta final — ou `tool_calls` fora de hora (toolChoice none), que conta como resposta final inválida (D-L6b)
    await step({ kind: "validating" })
    let parsed: unknown = undefined
    if (reply.kind === "final" && typeof reply.content === "string") { try { parsed = JSON.parse(reply.content) } catch { parsed = undefined } }
    const verdict = await session.validate(parsed, question)
    if (verdict.ok) {
      const state = session.state()
      const rendered = renderAnswer({ answer: parsed, ledger: session.ledger(), notices: notices(state), stop: validatorStop(state), question })
      if (!rendered.ok) return fail("STORAGE_ERROR") // inalcançável: validate só aceita o que renderiza
      return finish("ANSWERED", rendered.rendered)
    }
    if ("action" in verdict && verdict.action === "REGENERATE") {
      // só CÓDIGOS voltam ao modelo; o texto rejeitado não entra no histórico
      messages.push({ role: "user", content: `A resposta anterior foi rejeitada pelo validador. Códigos: ${verdict.feedback.join(", ")}. Reenvie o objeto JSON completo corrigido.` })
      continue
    }
    if ("action" in verdict && verdict.action === "STOP") return finish("STOPPED", verdict.response)
    return fail("TURN_CLOSED")
  }
}
