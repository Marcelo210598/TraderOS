// Cliente da Groq como `ModelPort` do laço do chat (E7-15c, D-G1…D-G4): fala com a API compatível com a da OpenAI. `fetch`, relógio e chave são INJETADOS (este módulo nunca lê o ambiente); é o ÚNICO arquivo que
// conhece o endereço da API. Nunca lança em `complete` (tudo vira `{kind:"error", code}` SEM texto do provedor, corpo, URL nem chave); a chave só vai no cabeçalho Authorization.
//   · pedido com EXATAMENTE: model, messages, tools, tool_choice, reasoning_effort "none" (modo instruct), reasoning_format "hidden", max_tokens, temperature;
//   · saída saneada: remove <think>…</think> e cercas de código; `arguments` (string JSON) vira objeto (inválido ⇒ null, e o executor responde ARGS_INVALID); `usage.total_tokens` inválido ⇒ ausente (o laço trata como o teto);
//   · erros: 429/413 ⇒ RATE_LIMITED, 5xx/rede/corpo inválido ⇒ UPSTREAM, 408/abort ⇒ TIMEOUT, demais 4xx/pedido inválido ⇒ CONFIG; prazo por chamada e prazo do turno (`deadlineAt`) via AbortController.
import type { ChatMessage, ModelPort, ModelReply, ModelRequest } from "./chat-turn.ts"

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b"
export const MAX_TOKENS_PER_CALL = 1500
export const CALL_TIMEOUT_MS = 25_000
const TEMPERATURE = 0.2

export interface GroqResponseLike { readonly status: number; readonly headers: { get(name: string): string | null }; text(): Promise<string> }
export type GroqFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<GroqResponseLike>
export interface GroqClientConfig {
  readonly apiKey: string
  readonly model?: string
  readonly fetch: GroqFetch
  /** Relógio em ms (época). */
  readonly now: () => number
  /** Prazo ABSOLUTO do turno (ms, época): nenhuma chamada passa dele. */
  readonly deadlineAt: number
  readonly callTimeoutMs?: number
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/
const MODEL_RE = /^[A-Za-z0-9._/-]{1,80}$/
const err = (code: "RATE_LIMITED" | "UPSTREAM" | "TIMEOUT" | "CONFIG"): ModelReply => ({ kind: "error", code })

/** Tira <think>…</think> (e um <think> sem fechar até o fim), cercas ``` que envolvem tudo, e apara. */
export function sanitizeModelContent(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "")
  const open = t.indexOf("<think>")
  if (open !== -1) t = t.slice(0, open)
  t = t.trim()
  const fenced = /^```[A-Za-z]*\s*\n([\s\S]*?)\n?```$/.exec(t)
  return (fenced !== null ? fenced[1] : t).trim()
}

const parseArguments = (raw: unknown): Record<string, unknown> | null => {
  if (isRecord(raw)) return raw
  if (typeof raw !== "string" || raw.trim() === "") return null
  try { const v: unknown = JSON.parse(raw); return isRecord(v) ? v : null } catch { return null }
}

const toWire = (m: ChatMessage): Record<string, unknown> => {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content }
  if (m.role === "assistant" && m.toolCalls !== undefined && m.toolCalls.length > 0) {
    return { role: "assistant", content: null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) }
  }
  return { role: m.role, content: m.content }
}

const validRequest = (r: unknown): r is ModelRequest =>
  isRecord(r) && Array.isArray(r.messages) && r.messages.length > 0 && r.messages.every((m) => isRecord(m) && typeof m.role === "string" && typeof m.content === "string") && Array.isArray(r.tools) && (r.toolChoice === "auto" || r.toolChoice === "none")

export function createGroqModelPort(config: GroqClientConfig): ModelPort {
  if (!isRecord(config) || typeof config.apiKey !== "string" || !KEY_RE.test(config.apiKey) || typeof config.fetch !== "function" || typeof config.now !== "function" || typeof config.deadlineAt !== "number" || !Number.isFinite(config.deadlineAt)
    || (config.model !== undefined && (typeof config.model !== "string" || !MODEL_RE.test(config.model))) || (config.callTimeoutMs !== undefined && !(typeof config.callTimeoutMs === "number" && config.callTimeoutMs > 0))) {
    throw new TypeError("configuração do cliente inválida")
  }
  const { apiKey, fetch: doFetch, now, deadlineAt } = config
  const model = config.model ?? DEFAULT_GROQ_MODEL
  const callTimeout = config.callTimeoutMs ?? CALL_TIMEOUT_MS
  return {
    async complete(req: ModelRequest): Promise<ModelReply> {
      try {
        if (!validRequest(req)) return err("CONFIG")
        const remaining = deadlineAt - now()
        if (!(remaining > 0)) return err("TIMEOUT")
        const body = JSON.stringify({
          model, messages: req.messages.map(toWire),
          tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
          tool_choice: req.toolChoice, reasoning_effort: "none", reasoning_format: "hidden", max_tokens: MAX_TOKENS_PER_CALL, temperature: TEMPERATURE,
        })
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.min(callTimeout, remaining))
        let res: GroqResponseLike
        try {
          res = await doFetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body, signal: controller.signal })
        } catch (e) {
          return controller.signal.aborted || (isRecord(e) && e.name === "AbortError") ? err("TIMEOUT") : err("UPSTREAM")
        } finally { clearTimeout(timer) }
        if (res.status === 429 || res.status === 413) return err("RATE_LIMITED")
        if (res.status === 408) return err("TIMEOUT")
        if (res.status >= 500) return err("UPSTREAM")
        if (res.status !== 200) return err("CONFIG")
        let payload: unknown
        try { payload = JSON.parse(await res.text()) } catch { return err("UPSTREAM") }
        const choices = isRecord(payload) ? payload.choices : undefined
        const message = Array.isArray(choices) && isRecord(choices[0]) ? choices[0].message : undefined
        if (!isRecord(message)) return err("UPSTREAM")
        const total = isRecord(payload) && isRecord(payload.usage) ? payload.usage.total_tokens : undefined
        const usage = typeof total === "number" && Number.isFinite(total) && total >= 0 ? { totalTokens: total } : {}
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          const calls = message.tool_calls.filter(isRecord).map((c) => ({ id: String(c.id ?? ""), name: isRecord(c.function) ? String(c.function.name ?? "") : "", arguments: parseArguments(isRecord(c.function) ? c.function.arguments : undefined) }))
          return calls.length > 0 ? { kind: "tool_calls", calls, usage } : err("UPSTREAM")
        }
        return { kind: "final", content: typeof message.content === "string" ? sanitizeModelContent(message.content) : "", usage }
      } catch {
        return err("UPSTREAM")
      }
    },
  }
}
