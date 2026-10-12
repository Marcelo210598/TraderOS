// Redação de privacidade da Evidence: o NOME da conta nunca sai em claro; quem precisa distinguir contas usa `accountRef`.
// (E6.0: o mesmo vale para o nome da ESTRATÉGIA → `strategyRef`, com a mesma trava fail-closed.)
// Lugares onde o nome pode aparecer: `account.sourceName`, `reconstruction.cycleKey.account` e o `fileName` do import
// (ex.: "Sim101.csv"). Tudo que vai para a Evidence passa por aqui e, no fim, pela trava `findAccountNameLeak` (fail-closed).

import type { CanonicalTrade } from "../domain/canonical.ts"
import type { ReconstructionEvidence } from "./schema.ts"

/** Nome de conta conhecido + o ref que o substitui. */
export interface KnownAccount {
  name: string
  ref: string
}

/** Nomes curtos (< 4) só casam como token inteiro (evita estragar "MNQ" ou "A1" dentro de outra palavra); os demais, por substring. */
const MIN_SUBSTRING_LEN = 4
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const nameRe = (name: string, flags: string) =>
  new RegExp(name.length >= MIN_SUBSTRING_LEN ? escapeRe(name) : `(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, flags)

/**
 * `cycleKey.account` (nome em claro no Canonical) vira `accountRef`; `cycleKey.strategy` vira `strategyRef` (E6.0). Projeção campo a campo — sem spread da reconstrução.
 * `version` é a do algoritmo (ImportRecord.reconstructionVersion).
 */
export function redactReconstruction(rec: NonNullable<CanonicalTrade["reconstruction"]>, accountRef: string | null, strategyRef: string | null, version: string): ReconstructionEvidence {
  return {
    method: rec.method,
    version,
    scope: rec.scope,
    cycleKey: { accountRef, contract: rec.cycleKey.contract, strategyRef, direction: rec.cycleKey.direction },
    confidence: rec.confidence,
    ambiguities: rec.ambiguities.map((a) => ({ code: a.code, severity: a.severity, rowNos: [...a.rowNos], message: a.message })),
    completeness: rec.completeness,
    boundary: { prev: rec.boundary.prev, next: rec.boundary.next },
    integrity: rec.integrity,
  }
}

/** Troca cada nome de conta conhecido dentro do nome do arquivo pelo `accountRef` (mais longos primeiro). null ⇒ null. */
export function redactFileName(fileName: string | null, accounts: KnownAccount[]): string | null {
  if (fileName === null) return null
  let out = fileName
  for (const a of [...accounts].filter((x) => x.name.trim() !== "").sort((x, y) => y.name.length - x.name.length || (x.name < y.name ? -1 : 1))) {
    out = out.replace(nameRe(a.name.trim(), "gi"), a.ref)
  }
  return out
}

/** Trava final: caminho do primeiro valor string que contém algum nome de conta conhecido, ou null. Percorre objetos e arrays. */
export function findAccountNameLeak(value: unknown, names: string[], path = "$"): string | null {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))]
  if (wanted.length === 0) return null
  const res = wanted.map((n) => nameRe(n, "i"))
  const walk = (v: unknown, p: string): string | null => {
    if (typeof v === "string") return res.some((re) => re.test(v)) ? p : null
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = walk(v[i], `${p}[${i}]`)
        if (r) return r
      }
      return null
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const r = walk(k, `${p}.${k}#key`) ?? walk(x, `${p}.${k}`)
        if (r) return r
      }
    }
    return null
  }
  return walk(value, path)
}
