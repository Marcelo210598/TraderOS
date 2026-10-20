// Executor DETERMINÍSTICO do turno do agente (E7-6, D-T0…D-T9) — SEM LLM: o laço com o modelo (prompt, roteador, custo, UI) é outra camada. Aqui só o elo de dados do turno:
//   abre a conversa e CARREGA o sal 1x (D-T3) → despacha as capacidades sobre o dataset fixado pelo SERVIDOR (pin; nunca do modelo, nunca o userId) → mantém o estado de TRABALHO
//   (ledger, specs, aliases) → traduz falhas SEM inventar código novo (D-T7) → grava UM commit atômico no fim (D-T2; CAS, sem retry ⇒ TURN_CONFLICT).
//   · ctx memoizado por pin (o pipeline é caro, ≈225 ms por 5.000 linhas); os aliases devolvidos por uma chamada alimentam a seguinte.
//   · época desatualizada ao abrir ⇒ ledger de trabalho rotacionado (entradas STALE) e `rotateTo` no commit; nada é refeito sozinho (D-T5).
//   · evidence.explain: a entrada vai ao ledger por ref DERIVADO da página (E7-8; antes a D-T4 a deixava de fora porque colidia com a analítica).
//   · evidence.refresh: o ref novo HERDA spec+pin do antigo (D-T6). `onBundle` aquece o cache (D-T8). `validate` = validateAnswer + recordRejection (D-T9).
// Chamadas são serializadas (fila); sessão FECHADA após o commit (com sucesso ou não). Erros são resultados tipados com código fixo — nada lança, nada ecoa sal, caminho, nome de arquivo ou mensagem.
import { evidenceExplain } from "../agent-capabilities/evidence-explain.ts"
import { evidenceRefresh } from "../agent-capabilities/evidence-refresh.ts"
import { errorResult, type okResult } from "../agent-capabilities/envelope.ts"
import { exitAnalysis } from "../agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../agent-capabilities/metrics-compare.ts"
import { metricsGroups, type MetricsGroupsContext } from "../agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../agent-capabilities/rank-groups.ts"
import type { CapabilityErrorCode, CapabilityId } from "../agent/contract.ts"
import { newAliasTable, type AliasTable } from "../agent/label.ts"
import { addEvidence, refreshEvidence, rotateEpoch, type Ledger } from "../agent/ledger.ts"
import { notices, recordError, recordRejection, requestCall, newTurn, validatorStop, type TurnState } from "../agent/turn.ts"
import { validateAnswer } from "../agent/validate-answer.ts"
import { renderAnswer, stopResponse, type RenderedAnswer } from "../agent/render.ts"
import type { BundleCache } from "./bundle-cache.ts"
import { MAX_USER_TEXT_CHARS, type Conversations, type OpenConversation, type TurnChange } from "./conversation-store.ts"
import { parseDatasetPin, type DatasetPin } from "./dataset-pin.ts"
import { makeContext, type DatasetCode, type DatasetDeps, type DatasetSaltProvider } from "./dataset.ts"
import { isValidUserId, type RawFileStorage } from "./raw-file-storage.ts"
import type { ImportSourceStore } from "./import-source-store.ts"
import { prepareBundle, regeneratedFor } from "./regenerate.ts"

/** Só o que o executor precisa do `PersistentSalts` (o instantâneo síncrono por usuário). */
export interface TurnSalts { load(userId: string): Promise<{ readonly provider: DatasetSaltProvider }> }
export interface TurnDeps {
  readonly rawStorage: RawFileStorage
  readonly importStore: ImportSourceStore
  readonly conversations: Conversations
  readonly salts: TurnSalts
  readonly cache?: BundleCache
}
export interface OpenTurnRequest {
  readonly userId: string
  /** Ausente/null ⇒ conversa NOVA. */
  readonly conversationId?: string | null
  /** O dataset do turno, escolhido pelo SERVIDOR. */
  readonly pin: unknown
  /** E7-9: a pergunta do usuário, LITERAL (string não vazia após trim, ≤ 4.000 caracteres). Ausente ⇒ o turno não grava mensagem do usuário. */
  readonly userMessage?: string
}
export type OpenTurnCode = "INVALID_ARGS" | "SALT_REQUIRED" | "NOT_FOUND" | "STORAGE_ERROR"
export type CommitCode = "TURN_CLOSED" | "TURN_CONFLICT" | "LIMIT_EXCEEDED" | "COMMIT_REJECTED" | "STORAGE_ERROR"
type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export type CallOutcome =
  | { readonly ok: true; readonly result: Envelope }
  | { readonly ok: false; readonly code: "TURN_CLOSED" | "ARGS_INVALID" | "BUDGET_EXCEEDED" }
export type CommitOutcome = { readonly ok: true; readonly committed: boolean; readonly version: number } | { readonly ok: false; readonly code: CommitCode }
export type ValidateOutcome =
  | { readonly ok: true; readonly claims: unknown }
  | { readonly ok: false; readonly action: "REGENERATE"; readonly feedback: readonly string[] }
  | { readonly ok: false; readonly action: "STOP"; readonly stopReason: "REGEN_EXHAUSTED"; readonly response: RenderedAnswer }
  | { readonly ok: false; readonly code: "TURN_CLOSED" }

export interface TurnSession {
  readonly conversationId: string
  call(capability: unknown, args: unknown): Promise<CallOutcome>
  validate(answer: unknown, question?: string): Promise<ValidateOutcome>
  commit(): Promise<CommitOutcome>
  /** Estado de trabalho (somente leitura). */
  state(): TurnState
  ledger(): Ledger
  aliases(): AliasTable
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const REF_RE = /^ev_[0-9a-f]{32}$/
const jstr = (x: unknown): string => JSON.stringify(x)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

type Run = (rawArgs: unknown, ctx: MetricsGroupsContext) => { result: Envelope; entry: { capability: CapabilityId; handle: { evidenceRef: string }; view: unknown } | null; aliases?: AliasTable }
const ANALYTIC: ReadonlyMap<string, Run> = new Map<string, Run>([
  ["metrics.query@1", metricsQuery as Run], ["metrics.groups@1", metricsGroups as Run], ["metrics.compare@1", metricsCompare as Run],
  ["exit.breakdown@1", exitBreakdown as Run], ["exit.analysis@1", exitAnalysis as Run], ["rank.groups@1", rankGroupsCapability as Run],
])

/** D-T7: código do dataset/regenerador → código do contrato do modelo (nunca um código novo). */
const toCapabilityCode = (code: string): CapabilityErrorCode =>
  code === "FILE_NOT_AVAILABLE" || code === "FILE_CORRUPT" || code === "IMPORT_NOT_REGISTERED" || code === "NOT_FOUND" ? "FILE_NOT_AVAILABLE" : "ENGINE_REFUSED"

const mapCommit = (code: string): CommitCode =>
  code === "CONFLICT" ? "TURN_CONFLICT"
  : code === "LIMIT_ENTRIES" || code === "LIMIT_ROW" || code === "LIMIT_DELTA" || code === "LIMIT_MESSAGES" ? "LIMIT_EXCEEDED"
  : code === "STORAGE_ERROR" || code === "CORRUPT" ? "STORAGE_ERROR"
  : "COMMIT_REJECTED"

export async function openTurn(deps: TurnDeps, req: OpenTurnRequest): Promise<{ readonly ok: true; readonly session: TurnSession } | { readonly ok: false; readonly code: OpenTurnCode }> {
  const bad = (code: OpenTurnCode): { readonly ok: false; readonly code: OpenTurnCode } => ({ ok: false, code })
  try {
    if (!isRecord(deps) || !isRecord(deps.rawStorage) || !isRecord(deps.importStore) || !isRecord(deps.conversations) || !isRecord(deps.salts)) return bad("INVALID_ARGS")
    const { conversations, salts } = deps
    if (typeof conversations.create !== "function" || typeof conversations.open !== "function" || typeof conversations.commitTurn !== "function" || typeof salts.load !== "function") return bad("INVALID_ARGS")
    if (deps.cache !== undefined && (!isRecord(deps.cache) || typeof deps.cache.getOrLoad !== "function" || typeof deps.cache.put !== "function")) return bad("INVALID_ARGS")
    if (!isRecord(req) || Object.keys(req).some((k) => !["userId", "conversationId", "pin", "userMessage"].includes(k))) return bad("INVALID_ARGS")
    const { userMessage } = req
    if (userMessage !== undefined && (typeof userMessage !== "string" || userMessage.trim() === "" || userMessage.length > MAX_USER_TEXT_CHARS)) return bad("INVALID_ARGS")
    const { userId } = req
    if (!isValidUserId(userId)) return bad("INVALID_ARGS")
    const pin = parseDatasetPin(req.pin)
    if (pin === null) return bad("INVALID_ARGS")
    const conversationId = req.conversationId
    if (conversationId !== undefined && conversationId !== null && typeof conversationId !== "string") return bad("INVALID_ARGS")

    let provider: DatasetSaltProvider
    try { provider = (await salts.load(userId)).provider } catch { return bad("STORAGE_ERROR") }
    const cur = provider.current(userId)
    if (cur === null) return bad("SALT_REQUIRED")

    const got = conversationId === undefined || conversationId === null ? await conversations.create(userId, cur.saltId) : await conversations.open(userId, conversationId)
    if (!got.ok) return bad(got.code === "NOT_FOUND" ? "NOT_FOUND" : got.code === "INVALID_ARGS" ? "INVALID_ARGS" : "STORAGE_ERROR")
    return { ok: true, session: buildSession(deps, userId, pin, provider, cur.saltId, got.open, userMessage) }
  } catch {
    return bad("STORAGE_ERROR")
  }
}

function buildSession(deps: TurnDeps, userId: string, turnPin: DatasetPin, provider: DatasetSaltProvider, saltId: string, open: OpenConversation, userMessage?: string): TurnSession {
  const dsDeps: DatasetDeps = { rawStorage: deps.rawStorage, importStore: deps.importStore, salt: provider }
  const regDeps = { ...dsDeps, ...(deps.cache !== undefined ? { cache: deps.cache } : {}) }

  // ── estado de trabalho ──
  let ledger: Ledger = open.ledger
  let aliases: AliasTable = open.aliases
  let rotateTo: string | null = null
  if (open.epoch !== saltId) {
    const rotated = rotateEpoch(ledger, saltId)
    if (rotated.ok) { ledger = rotated.ledger; aliases = newAliasTable(saltId); rotateTo = saltId }
  }
  const initialAliases = jstr(aliases)
  const writes: Array<{ readonly op: "add" | "refresh"; readonly entry: unknown }> = []
  const specs = new Map<string, { capability: string; args: unknown; pin: DatasetPin }>()
  let state = newTurn()
  let closed = false
  let assistant: { readonly answer: unknown; readonly rendered: unknown } | null = null // E7-9 (D-M5): o PRIMEIRO desfecho terminal do validate

  const specWork = (ref: string): { capability: string; args: unknown } | null => {
    const mine = specs.get(ref)
    return mine !== undefined ? clone({ capability: mine.capability, args: mine.args }) : open.specOf(ref)
  }
  const pinWork = (ref: string): DatasetPin | null => {
    const mine = specs.get(ref)
    return mine !== undefined ? clone(mine.pin) : open.pinOf(ref)
  }
  /** A conversa como o regenerador a lê: ledger/aliases de TRABALHO + specs e pins do turno e persistidos. */
  const view = (): OpenConversation => ({ conversationId: open.conversationId, version: open.version, epoch: ledger.epoch, ledger, aliases, specOf: specWork, pinOf: pinWork, messages: open.messages })

  const ctxMemo = new Map<string, ReturnType<typeof makeContext>>()
  const ctxFor = async (pin: DatasetPin): ReturnType<typeof makeContext> => {
    const key = jstr(pin)
    let pending = ctxMemo.get(key)
    if (pending === undefined) { pending = makeContext(dsDeps, { userId, pin }); ctxMemo.set(key, pending) }
    const made = await pending
    if (!made.ok) ctxMemo.delete(key) // falha não fica memoizada
    return made
  }

  const failWith = (capability: CapabilityId, code: CapabilityErrorCode): Envelope => {
    const rec = recordError(state, capability, code)
    if (rec.ok) state = rec.state
    return errorResult(capability, code)
  }
  const refFromArgs = (args: unknown): string | null => (isRecord(args) && typeof args.evidenceRef === "string" && REF_RE.test(args.evidenceRef) ? args.evidenceRef : null)
  const warm = (ref: string, bundle: unknown): void => { if (deps.cache !== undefined) deps.cache.put(userId, ref, bundle) }

  async function analytic(capability: CapabilityId, run: Run, args: unknown): Promise<Envelope> {
    const made = await ctxFor(turnPin)
    if (!made.ok) return failWith(capability, toCapabilityCode(made.code satisfies DatasetCode))
    const captured: unknown[] = []
    const ctx = { ...made.ctx, aliases, onBundle: (b: unknown): void => { captured.push(b) } } as unknown as MetricsGroupsContext
    let out: ReturnType<Run>
    try { out = run(args, ctx) } catch { return failWith(capability, "ENGINE_REFUSED") }
    if (!out.result.ok) { failWith(capability, out.result.error?.code ?? "ENGINE_REFUSED"); return out.result }
    if (out.entry === null) return failWith(capability, "ENGINE_REFUSED")
    const ref = out.entry.handle.evidenceRef
    const isNew = !Object.hasOwn(ledger.entries, ref)
    const added = addEvidence(ledger, out.entry)
    if (!added.ok) return failWith(capability, "ENGINE_REFUSED") // colisão (mesmo ref, outra capacidade/view): falha fechada, o ledger não muda
    ledger = added.ledger
    if (isNew) writes.push({ op: "add", entry: out.entry })
    if (specWork(ref) === null) specs.set(ref, { capability, args: clone(args), pin: turnPin })
    if (out.aliases !== undefined) aliases = out.aliases
    if (captured.length === 1) warm(ref, captured[0])
    return out.result
  }

  async function explain(args: unknown): Promise<Envelope> {
    const ref = refFromArgs(args)
    let bundleOf: (r: string) => unknown = () => null
    let source: unknown
    if (ref !== null) {
      const prep = await prepareBundle(regDeps, { userId, conversation: view(), ref })
      bundleOf = prep.bundleOf
      const pin = prep.outcome.ok ? pinWork(ref) : null
      if (pin !== null) { const made = await ctxFor(pin); if (made.ok) source = made.ctx.source }
    }
    const out = evidenceExplain(args, { refEpoch: ledger.epoch, ...(source !== undefined ? { source: source as never } : {}), aliases, bundleOf })
    if (!out.result.ok) { failWith("evidence.explain@1", out.result.error?.code ?? "ENGINE_REFUSED"); return out.result }
    // E7-8: a página do explain é uma evidência com ref DERIVADO; a entrada vai ao ledger (add: idempotente se igual; conflito ⇒ falha fechada, o resultado NÃO é entregue).
    // Sem spec e sem aquecer o cache para o ref derivado: ele não é regenerável (o bundle é o do ref analítico).
    if (out.entry === null) return failWith("evidence.explain@1", "ENGINE_REFUSED")
    const pageRef = out.entry.handle.evidenceRef
    const isNew = !Object.hasOwn(ledger.entries, pageRef)
    const added = addEvidence(ledger, out.entry)
    if (!added.ok) return failWith("evidence.explain@1", "ENGINE_REFUSED")
    ledger = added.ledger
    if (isNew) writes.push({ op: "add", entry: out.entry })
    aliases = out.aliases // o explain pode alocar alias de RÓTULO
    return out.result
  }

  async function refresh(args: unknown): Promise<Envelope> {
    const ref = refFromArgs(args)
    const captured: unknown[] = []
    let regenerated: unknown
    let regenCode: string | null = null
    if (ref !== null) {
      const rg = await regeneratedFor(regDeps, { userId, conversation: view(), ref })
      if (rg.ok) regenerated = { ...rg.regenerated, onBundle: (b: unknown): void => { captured.push(b) } }
      else regenCode = rg.code
    }
    const out = evidenceRefresh(args, { ledger, specOf: specWork, regenerated } as never)
    if (!out.result.ok) {
      let code: CapabilityErrorCode = out.result.error?.code ?? "ENGINE_REFUSED"
      if (code === "FILE_NOT_AVAILABLE" && regenCode !== null) code = toCapabilityCode(regenCode)
      return failWith("evidence.refresh@1", code)
    }
    if (out.entry === null || ref === null) return failWith("evidence.refresh@1", "ENGINE_REFUSED")
    const spec = specWork(ref), pin = pinWork(ref)
    const refreshed = refreshEvidence(ledger, out.entry)
    if (!refreshed.ok || spec === null || pin === null) return failWith("evidence.refresh@1", "ENGINE_REFUSED")
    ledger = refreshed.ledger
    writes.push({ op: "refresh", entry: out.entry })
    const newRef = out.entry.handle.evidenceRef
    if (specWork(newRef) === null) specs.set(newRef, { capability: spec.capability, args: spec.args, pin }) // D-T6: regenerável depois
    if (out.aliases !== null && out.aliases !== undefined) aliases = out.aliases
    if (captured.length === 1) warm(newRef, captured[0])
    return out.result
  }

  async function doCall(capability: unknown, args: unknown): Promise<CallOutcome> {
    if (closed) return { ok: false, code: "TURN_CLOSED" }
    const req = requestCall(state, capability as CapabilityId)
    state = req.state
    if (!req.ok) return { ok: false, code: req.error.code }
    const cap = capability as CapabilityId
    try {
      const run = ANALYTIC.get(cap)
      if (run !== undefined) return { ok: true, result: await analytic(cap, run, args) }
      if (cap === "evidence.explain@1") return { ok: true, result: await explain(args) }
      if (cap === "evidence.refresh@1") return { ok: true, result: await refresh(args) }
      return { ok: true, result: failWith(cap, "ARGS_INVALID") }
    } catch {
      return { ok: true, result: failWith(cap, "ENGINE_REFUSED") }
    }
  }

  async function doValidate(answer: unknown, question?: string): Promise<ValidateOutcome> {
    if (closed) return { ok: false, code: "TURN_CLOSED" }
    const verdict = validateAnswer({ answer, ledger, stop: validatorStop(state), ...(typeof question === "string" ? { question } : {}) })
    let reasons: readonly string[] = verdict.ok ? [] : verdict.reasons
    if (verdict.ok) {
      const rendered = renderAnswer({ answer, ledger, notices: notices(state), stop: validatorStop(state), ...(typeof question === "string" ? { question } : {}) })
      if (rendered.ok) {
        if (assistant === null) assistant = { answer: clone(answer), rendered: clone(rendered.rendered) }
        return { ok: true, claims: verdict.claims }
      }
      reasons = ["STRUCTURE_INVALID"] // D-M9: render falho de resposta aceita = rejeição fail-closed
    }
    const rec = recordRejection(state, reasons as never)
    state = rec.state
    if (rec.action === "REGENERATE") return { ok: false, action: "REGENERATE", feedback: rec.feedback }
    const response = stopResponse(state)
    if (assistant === null) assistant = { answer: null, rendered: clone(response) }
    return { ok: false, action: "STOP", stopReason: rec.stopReason, response }
  }

  async function doCommit(): Promise<CommitOutcome> {
    if (closed) return { ok: false, code: "TURN_CLOSED" }
    closed = true // fechada com sucesso OU não: um turno perdedor não se reaproveita
    ctxMemo.clear()
    const change: { rotateTo?: string; writes?: typeof writes; specs?: Array<{ evidenceRef: string; capability: string; args: unknown; pin: DatasetPin }>; aliases?: AliasTable; messages?: NonNullable<TurnChange["messages"]> } = {}
    if (rotateTo !== null) change.rotateTo = rotateTo
    if (writes.length > 0) change.writes = writes
    if (specs.size > 0) change.specs = [...specs].map(([evidenceRef, s]) => ({ evidenceRef, capability: s.capability, args: s.args, pin: s.pin }))
    if (jstr(aliases) !== initialAliases) change.aliases = aliases
    const messages: Array<NonNullable<TurnChange["messages"]>[number]> = []
    if (userMessage !== undefined) messages.push({ role: "user", text: userMessage })
    if (assistant !== null) messages.push({ role: "assistant", answer: assistant.answer, rendered: assistant.rendered })
    if (messages.length > 0) change.messages = messages
    if (Object.keys(change).length === 0) return { ok: true, committed: false, version: open.version }
    try {
      const r = await deps.conversations.commitTurn(open, change)
      return r.ok ? { ok: true, committed: true, version: r.version } : { ok: false, code: mapCommit(r.code) }
    } catch {
      return { ok: false, code: "STORAGE_ERROR" }
    }
  }

  // fila: as operações do turno rodam UMA POR VEZ, na ordem em que foram pedidas
  let tail: Promise<unknown> = Promise.resolve()
  const queued = <T,>(fn: () => Promise<T>): Promise<T> => { const run = tail.then(fn, fn); tail = run.catch(() => undefined); return run }

  return {
    conversationId: open.conversationId,
    call: (capability, args) => queued(() => doCall(capability, args)),
    validate: (answer, question) => queued(() => doValidate(answer, question)),
    commit: () => queued(doCommit),
    state: () => state,
    ledger: () => ledger,
    aliases: () => aliases,
  }
}
