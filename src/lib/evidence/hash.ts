// Hashes canônicos da Evidence (evidence/1). Tudo SHA-256 sobre JSON canônico (chaves ordenadas) via `infra/hash.ts`.
// Fora de qualquer hash: `importedAt` e `computedAt` (relógio de quem persiste/calcula). Nenhum random.

import { canonicalJson, sha256Hex } from "../infra/hash.ts"
import type { CanonicalTrade } from "../domain/canonical.ts"
import type { EvidenceBundle } from "./schema.ts"

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

/** `id` = o id que o motor usa para o trade (tradeId real, ou o posicional de fallback). */
export function tradeFingerprint(id: string, t: CanonicalTrade): TradeFingerprint {
  const rec = t.reconstruction
  return {
    id,
    tradeId: t.tradeId ?? null,
    importId: t.importId ?? null,
    granularity: t.granularity === "POSITION_CYCLE" ? "POSITION_CYCLE" : "SOURCE_ROW",
    rowHashes: (t.sourceRows ?? []).map((r) => r.rowHash).filter((h): h is string => typeof h === "string").sort(),
    reconstruction: rec
      ? { method: rec.method, confidence: rec.confidence, completeness: rec.completeness, integrity: rec.integrity, ambiguities: rec.ambiguities.map((a) => a.code).sort() }
      : null,
    values: [t.pnl.net, t.pnl.gross, t.pnl.commission, t.pnl.fees, t.r.net, t.r.points, t.entry.at.instantUtc ?? t.entry.at.localDate, t.exit.at.instantUtc],
  }
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
    },
  }
}

export function computeEvidenceHash(bundle: Omit<EvidenceBundle, "evidenceHash"> & { evidenceHash?: string }): string {
  return sha256Hex(`${EVIDENCE_DOMAIN}\0${canonicalJson(normalizeForHash(bundle))}`)
}

/** Sela o bundle: calcula e grava `evidenceHash`. (Verificar o conteúdo contra os trades é o E5.) */
export function sealEvidence(bundle: Omit<EvidenceBundle, "evidenceHash">): EvidenceBundle {
  return { ...bundle, evidenceHash: computeEvidenceHash(bundle) }
}
