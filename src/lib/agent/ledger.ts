// Ledger do agente (E6.6-2a): por CONVERSA e por USUÁRIO (uma instância cada; o ledger não guarda userId), `evidenceRef → { capability, handle, view }` de tudo que as
// capacidades emitiram. Puro e IMUTÁVEL: cada operação devolve OUTRO ledger; entradas são cópias profundas congeladas (mutar o que se passou depois não altera nada).
// Frescor: o ledger tem UMA época vigente; entrada de época anterior fica (auditoria) e vira STALE. Erros são { ok:false, code } fixos, sem eco. Nada lança.
// Só `zod` e `./` (SG1).
import { EVIDENCE_REF_RE, EvidenceHandleSchema, type EvidenceHandle } from "./contract.ts"
import { PROMPT_VIEWS } from "./views.ts"

export type LedgerCapability = keyof typeof PROMPT_VIEWS
export interface LedgerEntry { readonly capability: LedgerCapability; readonly handle: EvidenceHandle; readonly view: unknown }
export interface Ledger { readonly epoch: string; readonly entries: Readonly<Record<string, LedgerEntry>> }
export type LedgerError = { readonly ok: false; readonly code: "LEDGER_ENTRY_INVALID" | "LEDGER_CONFLICT" | "LEDGER_EPOCH_INVALID" }

const EPOCH_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) {
    for (const v of Object.values(x)) deepFreeze(v)
    Object.freeze(x)
  }
  return x
}

const make = (epoch: string, entries: Record<string, LedgerEntry>): Ledger => Object.freeze({ epoch, entries: Object.freeze(entries) })

/** Ledger vazio na época vigente `epoch`. */
export function newLedger(epoch: string): { ok: true; ledger: Ledger } | LedgerError {
  return typeof epoch === "string" && EPOCH_RE.test(epoch) ? { ok: true, ledger: make(epoch, {}) } : { ok: false, code: "LEDGER_EPOCH_INVALID" }
}

/** Entrada ao ledger: valida handle e view (schemas do contrato), exige época vigente e frescor CURRENT; mesmo ref com conteúdo diferente ⇒ LEDGER_CONFLICT. */
export function addEvidence(ledger: Ledger, input: unknown): { ok: true; ledger: Ledger } | LedgerError {
  if (!isRecord(input) || typeof input.capability !== "string" || !Object.hasOwn(PROMPT_VIEWS, input.capability)) return { ok: false, code: "LEDGER_ENTRY_INVALID" }
  const capability = input.capability as LedgerCapability
  const handle = EvidenceHandleSchema.safeParse(input.handle)
  const view = PROMPT_VIEWS[capability].safeParse(input.view)
  if (!handle.success || !view.success || handle.data.refEpoch !== ledger.epoch || handle.data.freshness !== "CURRENT") return { ok: false, code: "LEDGER_ENTRY_INVALID" }
  const next: LedgerEntry = deepFreeze({ capability, handle: handle.data, view: view.data }) // o parse já devolveu cópias: não há alias com a entrada do chamador
  const ref = next.handle.evidenceRef
  if (Object.hasOwn(ledger.entries, ref)) return JSON.stringify(ledger.entries[ref]) === JSON.stringify(next) ? { ok: true, ledger } : { ok: false, code: "LEDGER_CONFLICT" }
  return { ok: true, ledger: make(ledger.epoch, { ...ledger.entries, [ref]: next }) }
}

/** Nova época vigente: as entradas antigas FICAM e passam a ser STALE. Época igual à atual ou inválida ⇒ erro. */
export function rotateEpoch(ledger: Ledger, epoch: string): { ok: true; ledger: Ledger } | LedgerError {
  if (typeof epoch !== "string" || !EPOCH_RE.test(epoch) || epoch === ledger.epoch) return { ok: false, code: "LEDGER_EPOCH_INVALID" }
  return { ok: true, ledger: make(epoch, { ...ledger.entries }) }
}

/** A entrada do ref, ou null (ref malformado, ausente, ou propriedade herdada). */
export function lookupRef(ledger: Ledger, ref: string): LedgerEntry | null {
  return typeof ref === "string" && EVIDENCE_REF_RE.test(ref) && Object.hasOwn(ledger.entries, ref) ? ledger.entries[ref] : null
}

export const isStale = (ledger: Ledger, entry: LedgerEntry): boolean => entry.handle.refEpoch !== ledger.epoch
