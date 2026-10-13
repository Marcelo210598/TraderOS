// Envelope das capacidades (E6.6-4): handle SEM evidenceHash para o modelo, resultado ok e resultado de erro. Projeção por lista branca: CÓPIA explícita campo a campo
// (nunca spread, nunca cópia genérica), para que um campo novo do handle NÃO chegue ao modelo sem decisão. Toda falha de schema vira ENGINE_REFUSED (Q17), sem detalhe.
import { AGENT_CONTRACT_VERSION, CAPABILITY_IDS, CapabilityErrorCodeSchema, EvidenceHandleViewSchema, capabilityResultSchema, type CapabilityErrorCode, type CapabilityId, type EvidenceHandle, type EvidenceHandleView, type Limit } from "../agent/contract.ts"
import { PROMPT_VIEWS } from "../agent/views.ts"

/** O handle como o MODELO o vê: só o evidenceRef (o selo completo fica no servidor). */
export function handleView(h: EvidenceHandle): EvidenceHandleView {
  const population: EvidenceHandleView["population"] = { declared: h.population.declared, verifiability: h.population.verifiability }
  if (h.population.sampleFlag !== undefined) population.sampleFlag = h.population.sampleFlag
  if (h.population.conclusive !== undefined) population.conclusive = h.population.conclusive
  if (h.population.confidence !== undefined) population.confidence = h.population.confidence
  return {
    evidenceRef: h.evidenceRef,
    subject: { type: h.subject.type, id: h.subject.id },
    scope: h.scope,
    population,
    refEpoch: h.refEpoch,
    verdict: {
      verify: { status: h.verdict.verify.status, codes: h.verdict.verify.codes.slice() },
      source: { status: h.verdict.source.status, codes: h.verdict.source.codes.slice() },
      combined: h.verdict.combined,
    },
    freshness: h.freshness,
  }
}

const isCapability = (x: unknown): x is CapabilityId => typeof x === "string" && (CAPABILITY_IDS as readonly string[]).includes(x)

/** Envelope de erro (ok = false). Capacidade ou código fora do contrato é erro de programação (RangeError). */
export function errorResult(capability: CapabilityId, code: CapabilityErrorCode) {
  if (!isCapability(capability) || !CapabilityErrorCodeSchema.safeParse(code).success) throw new RangeError("capacidade ou código de erro fora do contrato")
  return { contract: AGENT_CONTRACT_VERSION, capability, ok: false as const, data: null, evidence: null, limits: [] as Limit[], error: { code } }
}

/** Envelope de sucesso: valida data contra a PromptView da capacidade, o handle e os limits. Qualquer falha ⇒ erro ENGINE_REFUSED (a view T0/inconsistente nunca sai). */
export function okResult(capability: CapabilityId, data: unknown, handle: EvidenceHandle, limits: readonly Limit[]) {
  if (!isCapability(capability)) throw new RangeError("capacidade fora do contrato")
  try {
    if (!Object.hasOwn(PROMPT_VIEWS, capability)) return errorResult(capability, "ENGINE_REFUSED")
    const schema = capabilityResultSchema(PROMPT_VIEWS[capability as keyof typeof PROMPT_VIEWS])
    const view = handleView(handle)
    if (!EvidenceHandleViewSchema.safeParse(view).success) return errorResult(capability, "ENGINE_REFUSED")
    const parsed = schema.safeParse({ contract: AGENT_CONTRACT_VERSION, capability, ok: true, data, evidence: view, limits: limits.map((l) => ({ code: l.code, text: l.text })) })
    return parsed.success ? parsed.data : errorResult(capability, "ENGINE_REFUSED")
  } catch {
    return errorResult(capability, "ENGINE_REFUSED")
  }
}
