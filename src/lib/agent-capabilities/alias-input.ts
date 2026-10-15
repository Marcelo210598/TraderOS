// Alias de ENTRADA (E6.6-5-A): o modelo cita a conta como o servidor a mostrou ("Conta A"); aqui o servidor volta ao NOME real para o motor. O caminho é alias → ref (tabela da conversa,
// `resolveAlias`) → nome (refView(ctx.trades, sal) alinhado por índice com ctx.trades). O normalizeSpec do derivado recebe o NOME e faz o hash: passar o ref daria hash de hash.
// Qualquer falha (sem tabela, época diferente, alias fora da tabela, ref sem trade, lista vazia ou > 8) ⇒ resultado `ok:false` (as capacidades respondem ARGS_INVALID). Nunca aloca alias,
// nunca muta a tabela, nunca ecoa o alias. SÓ a conta (a estratégia é o E6.6-5-A2). O VALOR do sal vem do servidor (ctx), nunca do modelo.
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

/** Troca `filters.account` (aliases) pelos nomes que o motor conhece; os outros filtros passam intactos. Sem `account`, nada é lido do contexto. */
export function applyAccountFilter(filters: Record<string, unknown> | undefined, ctx: AliasContext): { readonly ok: true; readonly filters: Record<string, unknown> | undefined } | { readonly ok: false } {
  if (filters === undefined || !Object.hasOwn(filters, "account")) return { ok: true, filters }
  const names = resolveAccountNames(filters.account as string | string[], ctx)
  if (names === null) return NO
  const rest = Object.fromEntries(Object.entries(filters).filter(([k]) => k !== "account"))
  return { ok: true, filters: { ...rest, account: names.length === 1 ? names[0] : names } }
}
