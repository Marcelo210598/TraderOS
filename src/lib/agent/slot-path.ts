// Resolvedor de `path` de slot + tabela de folhas (E6.6-1). Um slot é um (ref, path) que o modelo cita; o SERVIDOR lê a folha na PromptView e escreve o texto (D2).
// Regras (expectativa: scripts/expectations/agent-answer.expected.json → e66_1.leaf_table, path_cases, e66_1.path_cases_added):
//   · O path usa a gramática do contrato (SLOT_PATH_RE) e é mais estrito: sem zero à esquerda no índice, sem espaço, até 200 caracteres.
//   · SÓ propriedades PRÓPRIAS (Object.hasOwn) e índices de array; nunca protótipo, nunca `__proto__`, nunca descer em null/escalar.
//   · A folha precisa estar na TABELA (por padrão de path, índices viram `[]`); a UNIDADE vem da tabela ou da folha irmã `unit` (validada) — NUNCA adivinhada pelo nome do campo.
//   · Nunca lança; erro é { ok:false, code } com código fixo e sem ecoar path nem valor. A falha de formato (ex.: valor null sem motivo) é FORMAT_INVALID.
import { formatDate, formatEnum, formatNumber, formatUnavailable, reasonText, type DisplayUnit, type EnumTable, type FormatResult } from "./format.ts"
import { PROMPT_VIEWS, UnitSchema } from "./views.ts"

export type SlotViewId = keyof typeof PROMPT_VIEWS
export type SlotError = { readonly ok: false; readonly code: "SLOT_PATH_INVALID" | "VIEW_INVALID" | "FORMAT_INVALID" }

type Spec =
  | { kind: "number"; unit: DisplayUnit | "sibling"; reasonField?: string } // reasonField = nome do irmão que traz o motivo da indisponibilidade (E6.6-V)
  | { kind: "reason" }
  | { kind: "date" }
  | { kind: "enum"; table: EnumTable }
  | { kind: "text" } // alias, parte de chave de grupo ou rótulo: já são texto seguro pelo schema da view
export type Leaf =
  | { kind: "number"; value: number | null; unit: DisplayUnit; reason: string | null | undefined }
  | { kind: "reason"; code: string | null }
  | { kind: "date"; value: string | null }
  | { kind: "enum"; table: EnumTable; code: string | null }
  | { kind: "text"; value: string | null }

const count: Spec = { kind: "number", unit: "count" }
const fraction: Spec = { kind: "number", unit: "fraction" }
const text: Spec = { kind: "text" }

/** Valor de métrica completo (ocorre em metrics[], groups[].metrics[], rows[].value). */
const metricValue = (p: string): Record<string, Spec> => ({
  [`${p}.value`]: { kind: "number", unit: "sibling", reasonField: "reason" },
  [`${p}.sampleSize`]: count,
  [`${p}.coverage.used`]: count,
  [`${p}.coverage.total`]: count,
  [`${p}.coverage.ratio`]: fraction,
  [`${p}.reason`]: { kind: "reason" },
  [`${p}.basis`]: { kind: "enum", table: "basis" },
})
const buckets: Record<string, Spec> = {
  "buckets[].reason": { kind: "enum", table: "exitReason" },
  "buckets[].unit": { kind: "enum", table: "bucketUnit" }, // E6.6-7b: palavra fixa (trades/pernas) em format.ts
  "buckets[].count": count,
  "buckets[].pnlNet": { kind: "number", unit: "usd", reasonField: "pnlNetReason" },
  "buckets[].pnlNetReason": { kind: "reason" },
  "buckets[].share": { kind: "number", unit: "fraction", reasonField: "shareReason" },
  "buckets[].shareReason": { kind: "reason" },
  "buckets[].coverage.used": count,
  "buckets[].coverage.total": count,
  "buckets[].coverage.ratio": fraction,
}
const compare = (p: string): Record<string, Spec> => ({
  [`${p}a.sampleSize`]: count,
  [`${p}b.sampleSize`]: count,
  [`${p}a.key[]`]: text,
  [`${p}b.key[]`]: text,
  [`${p}deltas[].a`]: { kind: "number", unit: "sibling", reasonField: "aReason" },
  [`${p}deltas[].aReason`]: { kind: "reason" },
  [`${p}deltas[].b`]: { kind: "number", unit: "sibling", reasonField: "bReason" },
  [`${p}deltas[].bReason`]: { kind: "reason" },
  [`${p}deltas[].delta`]: { kind: "number", unit: "sibling", reasonField: "reason" },
  [`${p}deltas[].ratio`]: { kind: "number", unit: "ratio", reasonField: "reason" },
  [`${p}deltas[].reason`]: { kind: "reason" },
})
const price: Spec = { kind: "number", unit: "price" }
const usd: Spec = { kind: "number", unit: "usd" }

/** Tabela de folhas por capacidade (índices trocados por `[]`). Folha fora daqui ⇒ SLOT_PATH_INVALID. */
const LEAVES: Readonly<Record<SlotViewId, Readonly<Record<string, Spec>>>> = Object.freeze({
  "metrics.query@1": { ...metricValue("metrics[]"), "period.from": { kind: "date" }, "period.to": { kind: "date" } },
  "metrics.groups@1": { "groups[].sampleSize": count, "groups[].sampleFlag": { kind: "enum", table: "sampleFlag" }, "groups[].key[]": text, ...metricValue("groups[].metrics[]") },
  "exit.breakdown@1": { ...buckets, reconciliation: { kind: "enum", table: "reconciliation" } },
  "metrics.compare@1": compare(""),
  "rank.groups@1": { "rows[].rank": count, "rows[].key[]": text, ...metricValue("rows[].value"), "rows[].sampleFlag": { kind: "enum", table: "sampleFlag" }, "rows[].contribution": { kind: "number", unit: "fraction", reasonField: "contributionReason" }, "rows[].contributionReason": { kind: "reason" } },
  "exit.analysis@1": { ...buckets, ...compare("comparison.") },
  "evidence.explain@1": {
    page: count, pageCount: count, total: count,
    "trades[].ordinal": count, "trades[].quantity": count, "trades[].direction": { kind: "enum", table: "direction" }, "trades[].entryPrice": price, "trades[].exitPrice": price,
    "trades[].pnlNet": usd, "trades[].pnlGross": usd, "trades[].exitReason": { kind: "enum", table: "exitReason" }, "trades[].accountAlias": text,
    "trades[].legs[].price": price, "trades[].legs[].quantity": count, "trades[].legs[].pnlNet": usd, "trades[].legs[].label": text,
  },
})

const MAX_PATH = 200
const SEGMENT = /^([A-Za-z][A-Za-z0-9_]*)(?:\[(0|[1-9][0-9]{0,2})\])?$/
const bad = (): { ok: false; code: "SLOT_PATH_INVALID" } => ({ ok: false, code: "SLOT_PATH_INVALID" })
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

/** Tabela de folhas (exportada só para o guarda de completude dos testes). */
export const LEAF_TABLE = LEAVES

/** Anda pelo path (só propriedades próprias) e devolve a FOLHA da tabela, sem formatar. */
export function resolveSlot(viewId: SlotViewId, view: unknown, path: string): { ok: true; leaf: Leaf } | { ok: false; code: "SLOT_PATH_INVALID" } {
  if (typeof viewId !== "string" || !Object.hasOwn(LEAVES, viewId) || typeof path !== "string" || path.length === 0 || path.length > MAX_PATH) return bad()
  const segs: Array<{ name: string; idx: number | null }> = []
  for (const part of path.split(".")) {
    const m = SEGMENT.exec(part)
    if (!m) return bad()
    segs.push({ name: m[1], idx: m[2] === undefined ? null : Number(m[2]) })
  }
  const pattern = segs.map((s) => (s.idx === null ? s.name : `${s.name}[]`)).join(".")
  const table = LEAVES[viewId]
  if (!Object.hasOwn(table, pattern)) return bad()
  const spec = table[pattern]
  let cur: unknown = view
  let parent: Record<string, unknown> | null = null
  for (const s of segs) {
    if (!isRecord(cur) || !Object.hasOwn(cur, s.name)) return bad()
    parent = cur
    cur = cur[s.name]
    if (s.idx !== null) {
      if (!Array.isArray(cur) || s.idx >= cur.length) return bad()
      cur = cur[s.idx]
    }
  }
  const last = segs[segs.length - 1]
  // o objeto que contém a folha: para folha de array (`key[]`) não há irmão `unit`, e nenhuma dessas folhas usa unidade irmã
  if (spec.kind === "number") {
    if (cur !== null && typeof cur !== "number") return bad()
    let unit: DisplayUnit
    if (spec.unit === "sibling") {
      const u = last.idx === null && parent !== null && Object.hasOwn(parent, "unit") ? UnitSchema.safeParse(parent.unit) : null
      if (!u || !u.success) return bad()
      unit = u.data
    } else unit = spec.unit
    let reason: string | null | undefined
    if (spec.reasonField !== undefined) { // o irmão-motivo tem de ser PRÓPRIO e string|null (herdado, ausente ou de outro tipo ⇒ inválido)
      const r = parent !== null && Object.hasOwn(parent, spec.reasonField) ? parent[spec.reasonField] : undefined
      if (r !== null && typeof r !== "string") return bad()
      reason = r
    }
    return { ok: true, leaf: { kind: "number", value: cur as number | null, unit, reason } }
  }
  if (cur !== null && typeof cur !== "string") return bad()
  if (spec.kind === "reason") return { ok: true, leaf: { kind: "reason", code: cur as string | null } }
  if (spec.kind === "date") return { ok: true, leaf: { kind: "date", value: cur as string | null } }
  if (spec.kind === "enum") return { ok: true, leaf: { kind: "enum", table: spec.table, code: cur } } // null (ex.: basis null) ⇒ o formato recusa (FORMAT_INVALID); nunca em branco
  return { ok: true, leaf: { kind: "text", value: cur as string | null } }
}

/** Texto da folha. Valor null: só com motivo conhecido (`indisponível (…)`); sem motivo ⇒ FORMAT_INVALID (nunca zero, nunca em branco). */
function formatLeaf(leaf: Leaf): FormatResult {
  switch (leaf.kind) {
    case "number":
      if (leaf.value === null) return leaf.reason === undefined ? { ok: false, code: "FORMAT_INVALID" } : formatUnavailable(leaf.reason)
      return formatNumber(leaf.value, leaf.unit)
    case "reason": return reasonText(leaf.code)
    case "date": return leaf.value === null ? { ok: false, code: "FORMAT_INVALID" } : formatDate(leaf.value)
    case "enum": return formatEnum(leaf.table, leaf.code as string) // null não é código: o formatador recusa
    case "text": return typeof leaf.value === "string" && leaf.value.length > 0 ? { ok: true, text: leaf.value } : { ok: false, code: "FORMAT_INVALID" }
  }
}

/** viewId → valida a view no schema (strict) → resolve a folha → formata. A view inválida NUNCA chega a render (ex.: campo T0 extra). */
export function renderSlot(viewId: SlotViewId, view: unknown, path: string): { ok: true; text: string } | SlotError {
  if (typeof viewId !== "string" || !Object.hasOwn(PROMPT_VIEWS, viewId)) return bad()
  const parsed = PROMPT_VIEWS[viewId].safeParse(view)
  if (!parsed.success) return { ok: false, code: "VIEW_INVALID" }
  const r = resolveSlot(viewId, parsed.data, path)
  if (!r.ok) return r
  const f = formatLeaf(r.leaf)
  return f.ok ? { ok: true, text: f.text } : { ok: false, code: "FORMAT_INVALID" }
}
