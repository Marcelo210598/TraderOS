// Hashes canônicos da Evidence (evidence/1). Tudo SHA-256 sobre JSON canônico (chaves ordenadas) via `infra/hash.ts`.
// Fora de qualquer hash: `importedAt` e `computedAt` (relógio de quem persiste/calcula). Nenhum random.

import { canonicalJson, sha256Hex } from "../infra/hash.ts"
import type { CanonicalTrade } from "../domain/canonical.ts"
import type { EvidenceBundle, TradeEvidence } from "./schema.ts"

export const EVIDENCE_SCHEMA = "evidence/1" as const
const TRADE_SET_DOMAIN = "meutrade/tradeSet/1"
const EVIDENCE_DOMAIN = "meutrade/evidence/1"

/** Entrada do fingerprint de UM trade: identidade + proveniência + reconstrução + valores que alimentam as métricas. */
export interface TradeFingerprint {
  id: string
  tradeId: string | null
  importId: string | null
  granularity: "POSITION_CYCLE" | "SOURCE_ROW"
  rowHashes: string[]
  reconstruction: { method: string; confidence: string; completeness: string; integrity: string; ambiguities: string[] } | null
  values: Array<number | string | null>
}

/** Os campos (já extraídos) de que o fingerprint precisa — comuns ao CanonicalTrade e ao TradeEvidence. A fórmula vive só em `fingerprintOf`. */
interface FingerprintParts {
  tradeId: string | null
  importId: string | null
  granularity: "POSITION_CYCLE" | "SOURCE_ROW"
  /** rowHash das linhas de origem: as de `sourceRows` (ciclo) ou o `source.rowHash` do próprio trade (trade-linha). Sem ele a referência à linha não entra no hash. */
  rowHashes: Array<string | null | undefined>
  reconstruction: { method: string; confidence: string; completeness: string; integrity: string; ambiguities: Array<{ code: string }> } | null
  pnl: { net: number | null; gross: number | null; commission: number | null; fees: number | null }
  r: { net: number | null; points: number | null }
  entryAt: { instantUtc: string | null; localDate: string | null }
  exitAt: { instantUtc: string | null }
}

function fingerprintOf(id: string, p: FingerprintParts): TradeFingerprint {
  const rec = p.reconstruction
  return {
    id,
    tradeId: p.tradeId,
    importId: p.importId,
    granularity: p.granularity,
    rowHashes: p.rowHashes.filter((h): h is string => typeof h === "string").sort(),
    reconstruction: rec ? { method: rec.method, confidence: rec.confidence, completeness: rec.completeness, integrity: rec.integrity, ambiguities: rec.ambiguities.map((a) => a.code).sort() } : null,
    values: [p.pnl.net, p.pnl.gross, p.pnl.commission, p.pnl.fees, p.r.net, p.r.points, p.entryAt.instantUtc ?? p.entryAt.localDate, p.exitAt.instantUtc],
  }
}

/** `id` = o id que o motor usa para o trade (tradeId real, ou o posicional de fallback). */
export function tradeFingerprint(id: string, t: CanonicalTrade): TradeFingerprint {
  return fingerprintOf(id, {
    tradeId: t.tradeId ?? null,
    importId: t.importId ?? null,
    granularity: t.granularity === "POSITION_CYCLE" ? "POSITION_CYCLE" : "SOURCE_ROW",
    // ciclo: as linhas de `sourceRows`; trade-linha (SOURCE_ROW): o próprio `source.rowHash` (a referência à linha entra no tradeSetHash)
    rowHashes: t.granularity === "POSITION_CYCLE" ? (t.sourceRows ?? []).map((r) => r.rowHash) : [t.source.rowHash],
    reconstruction: t.reconstruction ?? null,
    pnl: t.pnl,
    r: t.r,
    entryAt: t.entry.at,
    exitAt: t.exit.at,
  })
}

/**
 * O MESMO fingerprint a partir de um `TradeEvidence` (E5.0: a Evidence carrega `r`). O id do motor = `tradeId` (o E4 recusa o contrário).
 * `rowHashes` = o `rowHash` de TODAS as linhas de origem do trade: no ciclo, as `FULL` (= `sourceRows` do Canonical); no trade-linha, a
 * única `TRADE_VALUES` (= `source.rowHash`). Assim a referência à linha de origem de qualquer granularidade entra no `tradeSetHash`.
 */
export function tradeFingerprintFromEvidence(e: TradeEvidence): TradeFingerprint {
  return fingerprintOf(e.tradeId, {
    tradeId: e.tradeId,
    importId: e.importId,
    granularity: e.granularity,
    rowHashes: e.sourceRows.map((r) => r.rowHash),
    reconstruction: e.reconstruction,
    pnl: e.pnl,
    r: e.r,
    entryAt: e.entry.at,
    exitAt: e.exit.at,
  })
}

/** Trade com identidade completa (tradeId + importId) — sem isso a proveniência está incompleta. */
export const hasIdentity = (f: TradeFingerprint): boolean => f.tradeId !== null && f.importId !== null

/** SHA-256 do CONJUNTO COMPLETO de trades (independe da ordem de entrada e do limite de `tradeIds`). */
export function tradeSetHash(fingerprints: TradeFingerprint[]): string {
  const items = fingerprints.map((f) => canonicalJson(f)).sort()
  return sha256Hex(`${TRADE_SET_DOMAIN}\0${items.length}\0${items.join("\n")}`)
}

/** Forma normalizada p/ hash: sem `importedAt`/`computedAt`, sem o próprio `evidenceHash`, listas em ordem canônica. */
export function normalizeForHash(bundle: Omit<EvidenceBundle, "evidenceHash"> & { evidenceHash?: string }): unknown {
  const { evidenceHash: _ignored, ...rest } = bundle
  void _ignored
  const bySortKey = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  return {
    ...rest,
    evidence: {
      imports: bySortKey(
        rest.evidence.imports.map(({ importedAt: _i, ...imp }) => (void _i, imp)),
        (i) => i.importId,
      ),
      trades: bySortKey(rest.evidence.trades, (t) => t.tradeId),
      metrics: bySortKey(
        rest.evidence.metrics.map(({ computedAt: _c, ...m }) => (void _c, m)),
        (m) => canonicalJson(m),
      ),
      // E6.3: só entra quando há derivados — bundles sem eles hasheiam EXATAMENTE como antes (aditivo)
      ...(rest.evidence.derived && rest.evidence.derived.length > 0
        ? { derived: bySortKey(rest.evidence.derived.map(({ computedAt: _d, ...d }) => (void _d, d)), (d) => d.derivedId) }
        : {}),
    },
  }
}

export function computeEvidenceHash(bundle: Omit<EvidenceBundle, "evidenceHash"> & { evidenceHash?: string }): string {
  return sha256Hex(`${EVIDENCE_DOMAIN}\0${canonicalJson(normalizeForHash(bundle))}`)
}

const EXPLAIN_REF_RE = /^ev_[0-9a-f]{32}$/
/**
 * E7-8 (D-X1): o ref CITÁVEL de uma página do evidence.explain. Cada página tem view própria e o ledger guarda uma entrada por ref; por isso a página ganha um ref derivado,
 * `ev_` + 32 hex de sha256(JSON canônico de {v:"explain@1", ref, page}). Determinístico; sem época (o ref analítico já carrega o sal). Entrada inválida ⇒ null (nunca lança).
 */
export function explainPageRef(ref: unknown, page: unknown): string | null {
  try {
    if (typeof ref !== "string" || !EXPLAIN_REF_RE.test(ref) || typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return null
    return `ev_${sha256Hex(canonicalJson({ v: "explain@1", ref, page })).slice(0, 32)}`
  } catch {
    return null
  }
}

/** Sela o bundle: calcula e grava `evidenceHash`. (Verificar o conteúdo contra os trades é o E5.) */
export function sealEvidence(bundle: Omit<EvidenceBundle, "evidenceHash">): EvidenceBundle {
  return { ...bundle, evidenceHash: computeEvidenceHash(bundle) }
}
