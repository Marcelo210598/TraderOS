// Alias de ENTRADA (E6.6-5-A): o modelo cita a conta como o servidor a mostrou ("Conta A"); aqui o servidor volta ao NOME real para o motor. O caminho é alias → ref (tabela da conversa,
// `resolveAlias`) → nome (refView(ctx.trades, sal) alinhado por índice com ctx.trades). O normalizeSpec do derivado recebe o NOME e faz o hash: passar o ref daria hash de hash.
// Qualquer falha (sem tabela, época diferente, alias fora da tabela, ref sem trade, lista vazia ou > 8) ⇒ resultado `ok:false` (as capacidades respondem ARGS_INVALID). Nunca aloca alias,
// nunca muta a tabela, nunca ecoa o alias. O VALOR do sal vem do servidor (ctx), nunca do modelo.
// E6.6-5-A2 (estratégia): a CHAVE do grupo é `strategyId ?? strategyName`, mas o filtro do motor é por CAMPO (strategyId e strategyName, com AND). Por isso o filtro só é montado quando ele reproduz EXATAMENTE
// a população da chave (um campo só, e o conjunto selecionado pelo campo == o conjunto da chave); senão ⇒ ok:false (ARGS_INVALID). Como DIMENSÃO do compare basta a chave real (o motor usa a mesma função de chave).
import { resolveAlias, type AliasTable } from "../agent/label.ts"
import { refView } from "../evidence/derived.ts"
import type { MetricsQueryContext } from "./metrics-query.ts"

export const MAX_ACCOUNT_ALIASES = 8
type AliasContext = Pick<MetricsQueryContext, "trades" | "refEpoch" | "accountRefSalt" | "aliases">
export type AccountResolved = { readonly ok: true; readonly ref: string; readonly name: string } | { readonly ok: false }
const NO = { ok: false } as const

/** Um alias de conta → { ref, nome real }. A tabela é lida AQUI (um getter hostil lança e a capacidade responde ENGINE_REFUSED). */
export function resolveAccount(alias: string, ctx: AliasContext): AccountResolved {
  const table: AliasTable | undefined = ctx.aliases
  if (table === undefined || table === null) return NO
  const r = resolveAlias(table, "conta", alias, ctx.refEpoch)
  if (!r.ok) return NO
  const salt = typeof ctx.accountRefSalt === "string" ? ctx.accountRefSalt : ""
  const refs = refView(ctx.trades, salt)
  const names = new Set<string>()
  for (let i = 0; i < refs.length; i++) {
    if (refs[i].trade.account.sourceName !== r.ref) continue
    const name = ctx.trades[i].trade.account.sourceName
    if (typeof name === "string" && name !== "") names.add(name)
  }
  return names.size === 1 ? { ok: true, ref: r.ref, name: [...names][0] } : NO // 0 = ref sem trade; > 1 = ambíguo (não deveria existir): fail-closed
}

/** Lista de aliases (1–8) → nomes reais distintos e ordenados, ou null. */
export function resolveAccountNames(aliases: string | readonly string[], ctx: AliasContext): string[] | null {
  const list = Array.isArray(aliases) ? aliases : [aliases]
  if (list.length < 1 || list.length > MAX_ACCOUNT_ALIASES) return null
  const names = new Set<string>()
  for (const a of list) {
    const r = resolveAccount(a as string, ctx)
    if (!r.ok) return null
    names.add(r.name)
  }
  return [...names].sort()
}

export const MAX_STRATEGY_ALIASES = 8
export type StrategyKeyResolved = { readonly ok: true; readonly ref: string; readonly key: string } | { readonly ok: false }
export type StrategyFilterResolved = { readonly ok: true; readonly field: "strategyId" | "strategyName"; readonly values: string[] } | { readonly ok: false }
const hasId = (a: AliasContext["trades"][number]): boolean => a.strategyId !== undefined && a.strategyId !== null
/** A chave REAL do grupo (a mesma de calculate.ts): strategyId ?? strategyName. */
const keyOf = (a: AliasContext["trades"][number]): string | null => (hasId(a) ? (a.strategyId as string) : a.trade.labels.strategyName)
/** Índices dos trades cuja chave tem o ref pedido (a visão por refs usa o MESMO sal da geração). */
function tradesOfRefs(refs: ReadonlySet<string>, ctx: AliasContext): number[] {
  const salt = typeof ctx.accountRefSalt === "string" ? ctx.accountRefSalt : ""
  const rv = refView(ctx.trades, salt)
  const picked: number[] = []
  for (let i = 0; i < rv.length; i++) {
    const k = rv[i].strategyId ?? rv[i].trade.labels.strategyName
    if (typeof k === "string" && refs.has(k)) picked.push(i)
  }
  return picked
}
const aliasRefs = (list: readonly unknown[], ctx: AliasContext): Set<string> | null => {
  const table: AliasTable | undefined = ctx.aliases
  if (table === undefined || table === null) return null
  const refs = new Set<string>()
  for (const a of list) {
    const r = resolveAlias(table, "estrategia", a as string, ctx.refEpoch)
    if (!r.ok) return null
    refs.add(r.ref)
  }
  return refs
}

/** Um alias de estratégia → { ref, CHAVE real (strategyId ?? strategyName) } (dimensão do compare). Chave ambígua ou ref sem trade ⇒ ok:false. */
export function resolveStrategy(alias: string, ctx: AliasContext): StrategyKeyResolved {
  const refs = aliasRefs([alias], ctx)
  if (refs === null) return NO
  const keys = new Set<string>()
  for (const i of tradesOfRefs(refs, ctx)) { const k = keyOf(ctx.trades[i]); if (typeof k === "string" && k !== "") keys.add(k) }
  return keys.size === 1 ? { ok: true, ref: [...refs][0], key: [...keys][0] } : NO
}

/** Lista de aliases (1–8) → o filtro do motor que reproduz EXATAMENTE essas estratégias ({ campo, valores }), ou ok:false. */
export function resolveStrategyKeys(aliases: string | readonly string[], ctx: AliasContext): StrategyFilterResolved {
  const list = Array.isArray(aliases) ? aliases : [aliases]
  if (list.length < 1 || list.length > MAX_STRATEGY_ALIASES) return NO
  const refs = aliasRefs(list, ctx)
  if (refs === null) return NO
  const picked = tradesOfRefs(refs, ctx)
  const seen = new Set<string>()
  const rv = refView(ctx.trades, typeof ctx.accountRefSalt === "string" ? ctx.accountRefSalt : "")
  for (const i of picked) seen.add((rv[i].strategyId ?? rv[i].trade.labels.strategyName) as string)
  if (seen.size !== refs.size) return NO // algum ref sem trade
  const ids = picked.filter((i) => hasId(ctx.trades[i])).length
  if (ids !== 0 && ids !== picked.length) return NO // id e nome na mesma lista: o motor faz AND entre os dois campos
  const field = ids === 0 ? "strategyName" : "strategyId"
  const values = [...new Set(picked.map((i) => keyOf(ctx.trades[i]) as string))].sort()
  if (values.some((v) => typeof v !== "string" || v === "")) return NO
  // EXATIDÃO: o que o motor selecionaria por ESTE campo (o valor do filtro é aparado) == a população da chave
  const wanted = new Set(values.map((v) => v.trim()))
  const selected: number[] = []
  for (let i = 0; i < ctx.trades.length; i++) {
    const v = field === "strategyId" ? ctx.trades[i].strategyId : ctx.trades[i].trade.labels.strategyName
    if (typeof v === "string" && wanted.has(v)) selected.push(i)
  }
  return selected.length === picked.length && selected.every((i, n) => i === picked[n]) ? { ok: true, field, values } : NO
}

/** Troca `filters.account` e `filters.strategy` (aliases) pelo que o motor conhece; os outros filtros passam intactos. Sem nenhum dos dois, nada é lido do contexto. */
export function applyAliasFilters(filters: Record<string, unknown> | undefined, ctx: AliasContext): { readonly ok: true; readonly filters: Record<string, unknown> | undefined } | { readonly ok: false } {
  if (filters === undefined) return { ok: true, filters }
  const hasAccount = Object.hasOwn(filters, "account")
  const hasStrategy = Object.hasOwn(filters, "strategy")
  if (!hasAccount && !hasStrategy) return { ok: true, filters }
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(filters).filter(([k]) => k !== "account" && k !== "strategy"))
  if (hasAccount) {
    const names = resolveAccountNames(filters.account as string | string[], ctx)
    if (names === null) return NO
    out.account = names.length === 1 ? names[0] : names
  }
  if (hasStrategy) {
    const s = resolveStrategyKeys(filters.strategy as string | string[], ctx)
    if (!s.ok) return NO
    out[s.field] = s.values.length === 1 ? s.values[0] : s.values
  }
  return { ok: true, filters: out }
}
