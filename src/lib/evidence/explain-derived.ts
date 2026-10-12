// E6.3 — construtor da Evidence dos derivados: AnalyticsTrade (canônicos) + especificação → DerivedEvidence + TradeEvidence + ImportRef.
// Puro: sem relógio, sem random, sem banco, sem CSV. NÃO calcula nada financeiro nem reimplementa ranking/comparação: chama `computeDerived`
// (as funções reais do E6.2) sobre a "visão por refs" dos trades e COPIA o resultado. A população vem do motor (`tradeSetHash` do E2).

import type { ImportRecord } from "../domain/canonical.ts"
import { ANALYSIS_SCHEMA, ANALYSIS_VERSION } from "../metrics/analysis.ts"
import { ENGINE_VERSION, type AnalyticsTrade } from "../metrics/types.ts"
import { UNIT_OF_OP, computeDerived, derivedIdOf, normalizeSpec, refView, type DerivedSpecInput } from "./derived.ts"
import { explainTrades } from "./explain-trade.ts"
import { sealEvidence, EVIDENCE_SCHEMA } from "./hash.ts"
import { findAccountNameLeak } from "./redact.ts"
import { DerivedEvidenceSchema, type DerivedEvidence, type EvidenceBundle, type ImportRef, type TradeEvidence } from "./schema.ts"

export type ExplainDerivedErrorCode =
  | "E_DERIVED_SPEC_INVALID"
  | "E_DERIVED_COMPUTE_FAILED"
  | "E_POPULATION_IDENTITY_MISSING"
  | "E_DUPLICATE_TRADE_ID"
  | "E_IMPORT_UNRESOLVED"
  | "E_TRADE_EXPLAIN_FAILED"
  | "E_ACCOUNT_NAME_LEAK"
  | "E_STRATEGY_NAME_LEAK"
  | "E_SCHEMA"

export interface ExplainDerivedInput {
  spec: DerivedSpecInput
  /** Trades canônicos COM identidade (tradeId/importId; `id` do motor = `tradeId`). */
  trades: AnalyticsTrade[]
  importRecords: ImportRecord[]
  /** Mesmo sal da importação (accountRef/strategyRef). */
  opts?: { accountRefSalt?: string }
}
export type ExplainDerivedResult =
  | { ok: true; derived: DerivedEvidence; tradeEvidences: TradeEvidence[]; importRefs: ImportRef[]; notes: Array<{ code: string; message: string }> }
  | { ok: false; code: ExplainDerivedErrorCode; message: string }

const fail = (code: ExplainDerivedErrorCode, message: string): ExplainDerivedResult => ({ ok: false, code, message })
const sortedUnique = (xs: string[]) => [...new Set(xs)].sort()

export function explainDerived(input: ExplainDerivedInput): ExplainDerivedResult {
  const salt = input.opts?.accountRefSalt ?? ""
  const { trades, importRecords } = input

  // 1) identidade única (como no explainMetric): a Evidence não fabrica identidade nem deduplica em silêncio
  const occ = new Map<string, number>()
  for (const t of trades) if (t.trade.tradeId) occ.set(t.trade.tradeId, (occ.get(t.trade.tradeId) ?? 0) + 1)
  const dup = [...occ].filter(([, n]) => n > 1).map(([id]) => id).sort()
  if (dup.length > 0) return fail("E_DUPLICATE_TRADE_ID", `${dup.length} tradeId(s) aparecem mais de uma vez em \`trades\` (ex.: ${dup[0]}): remova a duplicata ou decida o dedupe antes de pedir Evidence.`)

  // 2) especificação (refs no lugar de nomes) e cálculo com as funções reais do E6.2
  let spec
  try {
    spec = normalizeSpec(input.spec, salt)
  } catch (e) {
    return fail("E_DERIVED_SPEC_INVALID", e instanceof Error ? e.message : "especificação inválida")
  }
  let comp
  try {
    comp = computeDerived(spec, refView(trades, salt), { select: true })
  } catch (e) {
    return fail("E_DERIVED_COMPUTE_FAILED", e instanceof Error ? e.message : "falha no cálculo")
  }
  const full = comp.population.tradeIds !== null

  // 3) trades referenciados = a população (só quando listada)
  const byId = new Map(trades.map((t) => [t.id, t]))
  const referenced = []
  const importRefs: ImportRef[] = []
  const tradeEvidences: TradeEvidence[] = []
  const notes: Array<{ code: string; message: string }> = []
  if (full) {
    for (const id of comp.population.tradeIds as string[]) {
      const at = byId.get(id)
      if (!at || !at.trade.tradeId || !at.trade.importId || at.trade.tradeId !== at.id) return fail("E_POPULATION_IDENTITY_MISSING", `Trade "${id}" da população não tem tradeId/importId coerentes com o id do motor: não há como apontar para a origem.`)
      referenced.push(at.trade)
    }
    const recordById = new Map(importRecords.map((r) => [r.importId, r]))
    for (const importId of sortedUnique(referenced.map((t) => t.importId as string))) {
      const record = recordById.get(importId)
      if (!record) return fail("E_IMPORT_UNRESOLVED", `ImportRecord "${importId}" não informado.`)
      const names = trades.filter((t) => t.trade.importId === importId).map((t) => t.trade.account.sourceName).filter((n): n is string => !!n)
      const results = explainTrades(referenced.filter((t) => t.importId === importId), record, { accountRefSalt: salt, knownAccountNames: sortedUnique(names) })
      for (const r of results) {
        if (!r.ok) return fail("E_TRADE_EXPLAIN_FAILED", `${r.code}: ${r.message}`)
        tradeEvidences.push(r.tradeEvidence)
        for (const n of r.notes) if (!notes.some((x) => x.code === n.code && x.message === n.message)) notes.push(n)
      }
      const first = results[0]
      if (first && first.ok) importRefs.push(first.importRef)
    }
    tradeEvidences.sort((a, b) => (a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : 0))
  }

  // 4) montagem + schema estrito
  const candidate = {
    derivedId: derivedIdOf(spec, comp.population.tradeSetHash),
    analysis: { op: spec.op, unit: UNIT_OF_OP[spec.op], schema: ANALYSIS_SCHEMA, definitionVersion: ANALYSIS_VERSION, engineVersion: ENGINE_VERSION },
    query: { args: spec.args, filters: spec.filters, options: spec.options },
    population: comp.population,
    verifiability: full ? ("FULL" as const) : ("HASH_ONLY" as const),
    result: comp.result,
    summary: comp.summary,
    // HASH_ONLY: os trades não vão no bundle, então as pernas citadas também não (vale o legSetHash do resultado)
    refs: full ? comp.refs : { legs: { applicable: comp.refs.legs.applicable, items: null } },
    computedAt: null,
  }
  const parsed = DerivedEvidenceSchema.safeParse(candidate)
  if (!parsed.success) return fail("E_SCHEMA", `DerivedEvidence fora do schema evidence/1: ${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}`)

  // 5) trava final (fail-closed): nenhum nome de conta nem de estratégia do conjunto de entrada em NENHUM valor/chave da saída
  const payload = { derived: parsed.data, tradeEvidences, importRefs }
  const accountNames = sortedUnique(trades.map((t) => t.trade.account.sourceName?.trim() ?? "").filter((n) => n !== ""))
  const accLeak = findAccountNameLeak(payload, accountNames)
  if (accLeak) return fail("E_ACCOUNT_NAME_LEAK", `Nome de conta encontrado na Evidence (${accLeak}); resultado descartado.`)
  const strategyNames = sortedUnique(
    trades.flatMap((t) => [t.trade.labels.strategyName, t.trade.reconstruction?.cycleKey.strategy, t.strategyId]).map((n) => n?.trim() ?? "").filter((n) => n !== ""),
  )
  const stratLeak = findAccountNameLeak(payload, strategyNames)
  if (stratLeak) return fail("E_STRATEGY_NAME_LEAK", `Nome de estratégia encontrado na Evidence (${stratLeak}); resultado descartado.`)

  return { ok: true, derived: parsed.data, tradeEvidences, importRefs, notes }
}

/** Monta e sela o bundle de UM derivado: claim → DerivedEvidence → TradeEvidence → ImportRef. */
export function derivedEvidenceBundle(r: Extract<ExplainDerivedResult, { ok: true }>): EvidenceBundle {
  return sealEvidence({
    schema: EVIDENCE_SCHEMA,
    claim: { kind: "DERIVED", statement: null },
    subject: { type: "DERIVED", id: r.derived.derivedId },
    evidence: { imports: r.importRefs, trades: r.tradeEvidences, metrics: [], derived: [r.derived] },
  })
}
