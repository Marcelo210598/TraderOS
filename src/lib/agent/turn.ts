// Máquina de estados PURA do turno do agente (E6.6-3; agent-capabilities.md §5.3–§5.5; Q10): orçamento de 8 chamadas, regeração N = 2 e o mapeamento TOTAL
// código de erro da capacidade → motivo de parada. SEM laço que chama o modelo: quem orquestra chama estas funções. Estados congelados; cada operação devolve OUTRO estado.
// Só `zod` e `./` (SG1). Não lê o texto do modelo; o feedback de regeração carrega SÓ códigos de REJECTION_REASONS.
import { AGENT_MAX_CALLS_PER_TURN, AGENT_MAX_REGENERATIONS, CAPABILITY_IDS, CapabilityErrorCodeSchema, REJECTION_REASONS, type CapabilityErrorCode, type CapabilityId, type STOP_REASONS } from "./contract.ts"

type RejectionReason = (typeof REJECTION_REASONS)[number]
export type StopReason = (typeof STOP_REASONS)[number]
export interface TurnState {
  readonly calls: number
  readonly rejections: number
  /** capacidades EXECUTADAS, distintas, na ordem da 1ª chamada (a 9ª, negada, não entra). */
  readonly tried: readonly CapabilityId[]
  readonly failed: ReadonlyArray<{ readonly capability: CapabilityId; readonly code: CapabilityErrorCode }>
  readonly budgetExceeded: boolean
  /** motivos da ÚLTIMA rejeição do validador (códigos). */
  readonly lastReasons: readonly RejectionReason[]
}

const freeze = (s: TurnState): TurnState => Object.freeze({ ...s, tried: Object.freeze([...s.tried]), failed: Object.freeze(s.failed.map((f) => Object.freeze({ ...f }))), lastReasons: Object.freeze([...s.lastReasons]) })
const isCapability = (x: unknown): x is CapabilityId => typeof x === "string" && (CAPABILITY_IDS as readonly string[]).includes(x)

export function newTurn(): TurnState {
  return freeze({ calls: 0, rejections: 0, tried: [], failed: [], budgetExceeded: false, lastReasons: [] })
}

/** Pede para executar uma capacidade: a 9ª NÃO executa (BUDGET_EXCEEDED); capacidade desconhecida ⇒ ARGS_INVALID e CONSOME uma chamada (emenda D7). */
export function requestCall(state: TurnState, capability: CapabilityId): { ok: true; state: TurnState } | { ok: false; error: { code: "BUDGET_EXCEEDED" | "ARGS_INVALID" }; state: TurnState } {
  if (state.budgetExceeded || state.calls >= AGENT_MAX_CALLS_PER_TURN) return { ok: false, error: { code: "BUDGET_EXCEEDED" }, state: state.budgetExceeded ? state : freeze({ ...state, budgetExceeded: true }) }
  // emenda D7: a tentativa de capacidade INEXISTENTE também consome uma chamada (senão um laço de ids inventados seria "de graça")
  if (!isCapability(capability)) return { ok: false, error: { code: "ARGS_INVALID" }, state: freeze({ ...state, calls: state.calls + 1 }) }
  return { ok: true, state: freeze({ ...state, calls: state.calls + 1, tried: state.tried.includes(capability) ? state.tried : [...state.tried, capability] }) }
}

/** Registra a falha de uma capacidade EXECUTADA. A falha NÃO encerra o turno. BUDGET_EXCEEDED não vem por aqui (vem de requestCall). */
export function recordError(state: TurnState, capability: CapabilityId, code: CapabilityErrorCode): { ok: true; state: TurnState } | { ok: false; code: "ERROR_NOT_RECORDABLE" } {
  const valid = CapabilityErrorCodeSchema.safeParse(code).success && code !== "BUDGET_EXCEEDED" && isCapability(capability) && state.tried.includes(capability)
  return valid ? { ok: true, state: freeze({ ...state, failed: [...state.failed, { capability, code }] }) } : { ok: false, code: "ERROR_NOT_RECORDABLE" }
}

/** Uma rejeição do validador. Até N = 2 regerações; a 3ª rejeição ⇒ REGEN_EXHAUSTED. O feedback tem só CÓDIGOS (lixo é descartado; vazio ⇒ STRUCTURE_INVALID). */
export function recordRejection(state: TurnState, reasons: readonly RejectionReason[]): { action: "REGENERATE"; feedback: RejectionReason[]; state: TurnState } | { action: "STOP"; stopReason: "REGEN_EXHAUSTED"; state: TurnState } {
  const clean = [...new Set((Array.isArray(reasons) ? reasons : []).filter((r): r is RejectionReason => typeof r === "string" && (REJECTION_REASONS as readonly string[]).includes(r)))]
  const feedback: RejectionReason[] = clean.length > 0 ? clean : ["STRUCTURE_INVALID"]
  const next = freeze({ ...state, rejections: state.rejections + 1, lastReasons: feedback })
  return next.rejections > AGENT_MAX_REGENERATIONS ? { action: "STOP", stopReason: "REGEN_EXHAUSTED", state: next } : { action: "REGENERATE", feedback, state: next }
}

/** E7-15a (D-L9): o orçamento de TOKENS do turno acabou; marca o mesmo estado do orçamento de chamadas, para a resposta canônica de parada citar o limite. Idempotente. */
export function markBudgetExceeded(state: TurnState): TurnState {
  return state.budgetExceeded ? state : freeze({ ...state, budgetExceeded: true })
}

/** O `stop` que o validador recebe. */
export const validatorStop = (state: TurnState): null | "BUDGET_CALLS" => (state.budgetExceeded ? "BUDGET_CALLS" : null)

/** Mapeamento TOTAL (§2.1 do plano): código de erro da capacidade → motivo de parada (§5.5). Código fora do contrato é erro de programação. */
export function stopReasonForError(code: CapabilityErrorCode): StopReason {
  switch (code) {
    case "ARGS_INVALID":
    case "NOT_FOUND":
    case "ENGINE_REFUSED": return "CAPABILITY_FAILED"
    case "BUDGET_EXCEEDED": return "BUDGET_CALLS"
    case "FILE_NOT_AVAILABLE": return "FILE_NOT_AVAILABLE"
    default: throw new RangeError("código de erro de capacidade fora do contrato")
  }
}

/** Avisos de parada que o SERVIDOR acrescenta à resposta (o modelo não os escreve): ordem fixa, sem duplicata. */
export function notices(state: TurnState): Array<"CAPABILITY_FAILED" | "FILE_NOT_AVAILABLE"> {
  const reasons = new Set(state.failed.map((f) => stopReasonForError(f.code)))
  return [...(reasons.has("CAPABILITY_FAILED") ? (["CAPABILITY_FAILED"] as const) : []), ...(reasons.has("FILE_NOT_AVAILABLE") ? (["FILE_NOT_AVAILABLE"] as const) : [])]
}
