// Capacidade `evidence.explain@1` (E6.6-11): o DETALHE dos trades de uma Evidence que o modelo já recebeu (≤ K = 20 por página), pela PROJEÇÃO T2: hora local, preços, quantidade, P&L, motivo
// de saída e pernas; sem tradeId/rowNo/rowHash/nomes. LÊ o bundle — não gera evidência (não usa trades/importRecords do contexto nem os geradores de Evidence). O bundle vem do servidor por
// `ctx.bundleOf(evidenceRef)` (o ledger guarda só handle+view; a persistência real é a E7). Rótulo só por projectLabelView (A2); aloca alias de RÓTULO e devolve a tabela; conta é só leitura.
// O veredito é o do próprio bundle (assessBundle, com o arquivo se houver). Nulls da view renderizam "não informado (…)" (PD-3, motivo fixo na folha). Nunca lança.
import { z } from "zod"
import { newAliasTable, type AliasTable } from "../agent/label.ts"
import { EvidenceRefSchema, EXPLAIN_MAX_TRADES, type CapabilityId, type EvidenceHandle } from "../agent/contract.ts"
import { verifyEvidence } from "../evidence/verify.ts"
import { assessBundle } from "./assess.ts"
import { errorResult, okResult } from "./envelope.ts"
import type { MetricsQueryContext } from "./metrics-query.ts"
import { projectExplainPage } from "./project.ts"

const CAPABILITY: CapabilityId = "evidence.explain@1"
export const EvidenceExplainArgsSchema = z.strictObject({ evidenceRef: EvidenceRefSchema, page: z.number().int().positive().default(1) })

export interface ExplainContext {
  refEpoch: string
  /** Arquivo(s) original(is) por importId (opcional; sem ele o veredito fica NOT_VERIFIED). */
  source?: MetricsQueryContext["source"]
  /** Tabela de alias da CONVERSA (imutável); ausente ⇒ tabela nova da época. O chamador guarda a que volta. */
  aliases?: AliasTable
  /** O servidor devolve o bundle SELADO do ref (ou null). */
  bundleOf?: (evidenceRef: string) => unknown
}
type Envelope = ReturnType<typeof okResult> | ReturnType<typeof errorResult>
export interface EvidenceExplainOutput {
  result: Envelope
  entry: { capability: CapabilityId; handle: EvidenceHandle; view: unknown } | null
  aliases: AliasTable
}

export function evidenceExplain(rawArgs: unknown, ctx: ExplainContext): EvidenceExplainOutput {
  let aliases: AliasTable | undefined
  try { aliases = typeof ctx === "object" && ctx !== null ? ctx.aliases : undefined } catch { aliases = undefined }
  const fallbackAliases = (): AliasTable => aliases ?? newAliasTable("s1")
  const fail = (code: "ARGS_INVALID" | "ENGINE_REFUSED" | "NOT_FOUND"): EvidenceExplainOutput => ({ result: errorResult(CAPABILITY, code), entry: null, aliases: fallbackAliases() })
  try {
    const parsed = EvidenceExplainArgsSchema.safeParse(rawArgs)
    if (!parsed.success) return fail("ARGS_INVALID")
    const { evidenceRef, page } = parsed.data
    if (typeof ctx !== "object" || ctx === null) return fail("ENGINE_REFUSED")
    const lookup = ctx.bundleOf
    if (typeof lookup !== "function") return fail("NOT_FOUND")
    let bundle: unknown
    try { bundle = lookup(evidenceRef) } catch { return fail("ENGINE_REFUSED") }
    if (bundle === null || bundle === undefined) return fail("NOT_FOUND")
    if (verifyEvidence(bundle).status === "INVALID_FORMAT") return fail("ENGINE_REFUSED")
    const b = bundle as { evidenceHash: string; evidence: { trades: unknown[] } }
    if (`ev_${b.evidenceHash.slice(0, 32)}` !== evidenceRef) return fail("ENGINE_REFUSED") // o bundle devolvido não é o do ref pedido

    const total = b.evidence.trades.length
    if (page > Math.max(1, Math.ceil(total / EXPLAIN_MAX_TRADES))) return fail("ARGS_INVALID")
    const projection = projectExplainPage(b.evidence.trades, page, ctx.refEpoch, aliases)
    if (projection === null) return fail("ENGINE_REFUSED")
    const assessed = assessBundle(bundle, { refEpoch: ctx.refEpoch, source: ctx.source ?? null })
    if (!assessed.ok || assessed.handle.evidenceRef !== evidenceRef) return fail("ENGINE_REFUSED")

    const envelope = okResult(CAPABILITY, projection.view, assessed.handle, assessed.limits)
    return envelope.ok ? { result: envelope, entry: { capability: CAPABILITY, handle: assessed.handle, view: projection.view }, aliases: projection.aliases } : { result: envelope, entry: null, aliases: fallbackAliases() }
  } catch {
    return fail("ENGINE_REFUSED")
  }
}
