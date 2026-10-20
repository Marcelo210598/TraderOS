// Capacidade `evidence.refresh@1` (E6.6-12): refaz uma Evidence STALE (de época anterior) na época vigente. NÃO gera evidência por conta própria nem lê segredo: REEXECUTA a mesma
// capacidade analítica, com os MESMOS args (a memória da conversa os guarda: `ctx.specOf`), sobre os dados que o SERVIDOR já regerou com o sal da época nova (`ctx.regenerated`,
// que traz também o arquivo original em `source`). Quem decide o STALE é o ledger (`isStale`); o bundle não conhece época. Devolve `data: null` (sem PromptView) + o handle novo;
// a view nova vai na `entry` para o orquestrador chamar `refreshEvidence` (ledger). Qualquer falha interna da capacidade reexecutada vira ENGINE_REFUSED (sem repassar o código). Nunca lança.
import { z } from "zod"
import { EvidenceRefSchema, type CapabilityId, type EvidenceHandle } from "../agent/contract.ts"
import type { AliasTable } from "../agent/label.ts"
import { isStale, lookupRef, type Ledger } from "../agent/ledger.ts"
import { errorResult, okResult } from "./envelope.ts"
import { exitAnalysis } from "./exit-analysis.ts"
import { exitBreakdown } from "./exit-breakdown.ts"
import { metricsCompare } from "./metrics-compare.ts"
import { metricsGroups, type MetricsGroupsContext } from "./metrics-groups.ts"
import { metricsQuery } from "./metrics-query.ts"
import { rankGroupsCapability } from "./rank-groups.ts"

const CAPABILITY: CapabilityId = "evidence.refresh@1"
export const EvidenceRefreshArgsSchema = z.strictObject({ evidenceRef: EvidenceRefSchema })

interface Reexecuted { result: { ok: boolean; limits: Array<{ code: string; text: string }> }; entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null; aliases?: AliasTable }
/** As 6 capacidades analíticas que GERAM evidência (D12-9). explain (só lê um alvo) e o próprio refresh ficam de fora. */
const REEXECUTABLE = new Map<string, (args: unknown, ctx: MetricsGroupsContext) => Reexecuted>([
  ["metrics.query@1", metricsQuery as never],
  ["metrics.groups@1", metricsGroups as never],
  ["metrics.compare@1", metricsCompare as never],
  ["exit.breakdown@1", exitBreakdown as never],
  ["exit.analysis@1", exitAnalysis as never],
  ["rank.groups@1", rankGroupsCapability as never],
])

export interface RefreshContext {
  /** O ledger da CONVERSA na época vigente (`ledger.epoch`); quem decide o STALE. */
  ledger: Ledger
  /** A consulta original (capacidade + args) de um ref, da memória da conversa; null se o servidor não a tem. */
  specOf?: (evidenceRef: string) => { capability: string; args: unknown } | null
  /** Dados regerados com o sal da época vigente + o arquivo original em `source`; `refEpoch` TEM de ser `ledger.epoch`. */
  regenerated?: MetricsGroupsContext
}
type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface EvidenceRefreshOutput {
  result: Envelope
  /** Para `refreshEvidence(ledger, entry)`: a capacidade ORIGINAL + handle COMPLETO novo + view nova; null em erro. */
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
  /** A tabela de alias da capacidade reexecutada (metrics.groups/rank.groups alocam), ou a da regenerated, ou null. */
  aliases: AliasTable | null
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

export function evidenceRefresh(rawArgs: unknown, ctx: RefreshContext): EvidenceRefreshOutput {
  const fail = (code: "ARGS_INVALID" | "NOT_FOUND" | "FILE_NOT_AVAILABLE" | "ENGINE_REFUSED"): EvidenceRefreshOutput => ({ result: errorResult(CAPABILITY, code), entry: null, aliases: null })
  try {
    const parsed = EvidenceRefreshArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { evidenceRef } = parsed.data
    if (!isRecord(ctx)) return fail("ENGINE_REFUSED")
    const ledger = ctx.ledger
    if (!isRecord(ledger) || typeof ledger.epoch !== "string") return fail("ENGINE_REFUSED")
    const entry = lookupRef(ledger as unknown as Ledger, evidenceRef)
    if (entry === null) return fail("NOT_FOUND")
    if (!isStale(ledger as unknown as Ledger, entry)) return fail("ARGS_INVALID") // já vigente: nada a refazer
    if (!REEXECUTABLE.has(entry.capability)) return fail("ARGS_INVALID") // E7-8: ref derivado de página do explain (sem spec, não refrescável): erro honesto, não FILE_NOT_AVAILABLE

    const specOf = ctx.specOf
    if (typeof specOf !== "function") return fail("FILE_NOT_AVAILABLE")
    let spec: unknown
    try { spec = specOf(evidenceRef) } catch { return fail("ENGINE_REFUSED") }
    if (spec === null || spec === undefined) return fail("FILE_NOT_AVAILABLE")
    if (!isRecord(spec) || typeof spec.capability !== "string" || !REEXECUTABLE.has(spec.capability)) return fail("ARGS_INVALID")
    const run = REEXECUTABLE.get(spec.capability)
    if (run === undefined) return fail("ARGS_INVALID")

    const regenerated = ctx.regenerated
    if (!isRecord(regenerated) || regenerated.source === undefined || regenerated.source === null) return fail("FILE_NOT_AVAILABLE")
    if (regenerated.refEpoch !== ledger.epoch) return fail("ENGINE_REFUSED")

    const out = run(spec.args, regenerated as unknown as MetricsGroupsContext)
    if (out.result.ok !== true || out.entry === null || out.entry === undefined) return fail("ENGINE_REFUSED")
    const handle = out.entry.handle
    if (handle.refEpoch !== ledger.epoch || handle.freshness !== "CURRENT" || out.entry.capability !== spec.capability) return fail("ENGINE_REFUSED")
    const envelope = okResult(CAPABILITY, null, handle, out.result.limits)
    if (!envelope.ok) return fail("ENGINE_REFUSED")
    const aliases = out.aliases ?? (regenerated.aliases as AliasTable | undefined) ?? null
    return { result: envelope, entry: { capability: out.entry.capability, handle, view: out.entry.view }, aliases }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
