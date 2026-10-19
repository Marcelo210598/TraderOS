// Regenerador de bundle (E7-5, D-R2/D-R3/D-R4/D-R7): dado o ref de uma conversa, refaz o MESMO bundle selado a partir da spec + pin guardados (arquivo → pipeline → a MESMA capacidade que gerou o ref, com o gancho `onBundle`).
//   · `regenerateBundle`: só ref CURRENT (STALE ⇒ STALE_EPOCH: o caminho é o evidence.refresh); o bundle regenerado precisa ter ev_+hash === o ref pedido, senão REF_MISMATCH e NADA é servido nem guardado (D-R4).
//   · `prepareBundle`: o passo assíncrono ANTES do evidence.explain (que é síncrono); entrega um `bundleOf` que só conhece o ref preparado. Nunca falha o turno: o motivo vai em `outcome`.
//   · `regeneratedFor`: o `regenerated` que o evidence.refresh espera (ctx da época nova + aliases da conversa), conferido contra a época do ledger (D-R7).
// Fail-closed e sem eco: resultados `{ ok:false, code }` com código fixo; nada lança; sal, caminho, nome de arquivo e mensagens nunca saem daqui. Não importa ingest/salt.ts nem o contrato do agente (o provider vem tipado pelo DatasetDeps).
import { exitAnalysis } from "../agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../agent-capabilities/metrics-compare.ts"
import { metricsGroups, type MetricsGroupsContext } from "../agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../agent-capabilities/rank-groups.ts"
import type { BundleCache, LoadResult } from "./bundle-cache.ts"
import type { OpenConversation } from "./conversation-store.ts"
import { makeContext, type DatasetCode, type DatasetDeps } from "./dataset.ts"
import { isValidUserId } from "./raw-file-storage.ts"

export interface RegenDeps extends DatasetDeps { readonly cache?: BundleCache }
export type RegenCode = DatasetCode | "NOT_FOUND" | "STALE_EPOCH" | "REF_MISMATCH" | "CAPABILITY_FAILED"
export interface RegenFailure { readonly ok: false; readonly code: RegenCode }
export type RegenResult = { readonly ok: true; readonly bundle: unknown; readonly from: "cache" | "regenerated" } | RegenFailure
export interface RegenRequest { readonly userId: string; readonly conversation: OpenConversation; readonly ref: string }
const fail = (code: RegenCode): RegenFailure => ({ ok: false, code })

type Run = (rawArgs: unknown, ctx: MetricsGroupsContext) => { result: { ok: boolean }; entry: { handle: { evidenceRef: string } } | null }
/** As 6 capacidades analíticas que geram bundle. evidence.explain/refresh e qualquer outra NÃO regeneram. */
const REGISTRY: ReadonlyMap<string, Run> = new Map<string, Run>([
  ["metrics.query@1", metricsQuery], ["metrics.groups@1", metricsGroups], ["metrics.compare@1", metricsCompare],
  ["exit.breakdown@1", exitBreakdown], ["exit.analysis@1", exitAnalysis], ["rank.groups@1", rankGroupsCapability],
])
const REF_RE = /^ev_[0-9a-f]{32}$/
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const refOfBundle = (b: unknown): string | null => {
  const h = isRecord(b) ? b.evidenceHash : undefined
  return typeof h === "string" && /^[0-9a-f]{64}$/.test(h) ? `ev_${h.slice(0, 32)}` : null
}

interface Resolved { readonly userId: string; readonly ref: string; readonly epoch: string; readonly stale: boolean; readonly aliases: unknown; readonly capability: string; readonly args: unknown; readonly pin: unknown }

/** Valida o pedido, localiza o ref no ledger e lê spec+pin. Nada lança. */
function resolve(deps: unknown, req: unknown): Resolved | RegenFailure {
  try {
    if (!isRecord(deps) || !isRecord(deps.rawStorage) || !isRecord(deps.importStore) || !isRecord(deps.salt)) return fail("INVALID_ARGS")
    if (deps.cache !== undefined && (!isRecord(deps.cache) || typeof deps.cache.getOrLoad !== "function")) return fail("INVALID_ARGS")
    if (!isRecord(req) || Object.keys(req).some((k) => !["userId", "conversation", "ref"].includes(k))) return fail("INVALID_ARGS")
    const { userId, conversation, ref } = req
    if (!isValidUserId(userId) || typeof ref !== "string" || !REF_RE.test(ref) || !isRecord(conversation)) return fail("INVALID_ARGS")
    const ledger = conversation.ledger
    if (!isRecord(ledger) || typeof ledger.epoch !== "string" || !isRecord(ledger.entries) || typeof conversation.specOf !== "function" || typeof conversation.pinOf !== "function") return fail("INVALID_ARGS")
    if (!Object.hasOwn(ledger.entries, ref)) return fail("NOT_FOUND")
    const entry = ledger.entries[ref]
    const handle = isRecord(entry) ? entry.handle : undefined
    if (!isRecord(handle) || typeof handle.refEpoch !== "string") return fail("INVALID_ARGS")
    const stale = handle.refEpoch !== ledger.epoch
    let spec: unknown, pin: unknown
    try { spec = conversation.specOf(ref); pin = conversation.pinOf(ref) } catch { return fail("STORAGE_ERROR") }
    if (spec === null || spec === undefined || pin === null || pin === undefined) return fail("NOT_FOUND")
    if (!isRecord(spec) || typeof spec.capability !== "string" || !REGISTRY.has(spec.capability)) return fail("CAPABILITY_FAILED")
    return { userId, ref, epoch: ledger.epoch, stale, aliases: conversation.aliases, capability: spec.capability, args: spec.args, pin }
  } catch {
    return fail("STORAGE_ERROR")
  }
}

export async function regenerateBundle(deps: RegenDeps, req: RegenRequest): Promise<RegenResult> {
  try {
    const r = resolve(deps, req)
    if ("ok" in r) return r
    if (r.stale) return fail("STALE_EPOCH") // D-R3: independe do cache; o caminho de uma entrada STALE é o evidence.refresh
    const run = REGISTRY.get(r.capability)!
    const load = async (): Promise<LoadResult> => {
      const made = await makeContext(deps, { userId: r.userId, pin: r.pin })
      if (!made.ok) return { ok: false, code: made.code }
      if (made.ctx.refEpoch !== r.epoch) return { ok: false, code: "STALE_EPOCH" } // o sal vigente não é a época da conversa
      const captured: unknown[] = []
      const ctx = { ...made.ctx, ...(isRecord(r.aliases) ? { aliases: r.aliases as unknown as MetricsGroupsContext["aliases"] } : {}), onBundle: (b: unknown): void => { captured.push(b) } }
      let out: ReturnType<Run>
      try { out = run(r.args, ctx as unknown as MetricsGroupsContext) } catch { return { ok: false, code: "CAPABILITY_FAILED" } }
      if (!out.result.ok || out.entry === null || captured.length !== 1) return { ok: false, code: "CAPABILITY_FAILED" }
      if (out.entry.handle.evidenceRef !== r.ref || refOfBundle(captured[0]) !== r.ref) return { ok: false, code: "REF_MISMATCH" } // D-R4
      return { ok: true, bundle: captured[0] }
    }
    if (deps.cache === undefined) {
      const loaded = await load()
      return loaded.ok ? { ok: true, bundle: loaded.bundle, from: "regenerated" } : fail(loaded.code as RegenCode)
    }
    const got = await deps.cache.getOrLoad(r.userId, r.ref, load)
    return got.ok ? { ok: true, bundle: got.bundle, from: got.from === "cache" ? "cache" : "regenerated" } : fail(got.code as RegenCode)
  } catch {
    return fail("STORAGE_ERROR")
  }
}

export interface PreparedBundle {
  readonly ok: true
  /** Síncrono, como o evidence.explain espera: devolve o bundle SÓ para o ref preparado; qualquer outra coisa ⇒ null. */
  readonly bundleOf: (evidenceRef: string) => unknown
  readonly outcome: { readonly ok: true; readonly from: "cache" | "regenerated" } | RegenFailure
}

export async function prepareBundle(deps: RegenDeps, req: RegenRequest): Promise<PreparedBundle> {
  let wanted = ""
  try { if (isRecord(req) && typeof req.ref === "string") wanted = req.ref } catch { wanted = "" }
  const res = await regenerateBundle(deps, req)
  const bundle = res.ok ? res.bundle : null
  return {
    ok: true,
    bundleOf: (evidenceRef: string): unknown => (res.ok && wanted !== "" && evidenceRef === wanted ? bundle : null),
    outcome: res.ok ? { ok: true, from: res.from } : res,
  }
}

/** O `regenerated` do evidence.refresh: o ctx da época NOVA (arquivo → pipeline com o sal vigente) + as aliases da conversa. */
export async function regeneratedFor(deps: RegenDeps, req: RegenRequest): Promise<{ readonly ok: true; readonly regenerated: MetricsGroupsContext } | RegenFailure> {
  try {
    const r = resolve(deps, req)
    if ("ok" in r) return r
    const made = await makeContext(deps, { userId: r.userId, pin: r.pin })
    if (!made.ok) return fail(made.code)
    if (made.ctx.refEpoch !== r.epoch) return fail("STALE_EPOCH") // D-R7: o refresh exige refEpoch === ledger.epoch
    const regenerated = { ...made.ctx, ...(isRecord(r.aliases) ? { aliases: r.aliases } : {}) } as unknown as MetricsGroupsContext
    return { ok: true, regenerated }
  } catch {
    return fail("STORAGE_ERROR")
  }
}
