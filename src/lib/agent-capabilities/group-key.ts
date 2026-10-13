// Chave do grupo como o MODELO a vê (E6.6-6). Entrada = o valor CRU do `groupKey` da EVIDÊNCIA (refs de conta/estratégia, nunca o nome); saída = texto seguro. Todo valor fora do
// formato da dimensão é RECUSADO (fail-closed) e a entrada nunca é ecoada. Conta/estratégia viram alias pela tabela imutável do E6.6-1 (estável na conversa, nova por época).
// strategyVersion, setup e timeframe NÃO estão aqui (texto livre do usuário; D6-1). Sem spread; só ../agent/ e './'.
import { formatDate, formatEnum } from "../agent/format.ts"
import { allocateAlias, type AliasTable } from "../agent/label.ts"

export const GROUP_DIMENSIONS = ["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "session", "symbol", "direction", "account", "strategy", "exitReason"] as const
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]
export type GroupKeyResult = { readonly ok: true; readonly text: string; readonly aliases: AliasTable } | { readonly ok: false }
const FAIL: GroupKeyResult = { ok: false }
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const
export const UNKNOWN_KEY = "(desconhecido)"

export function groupKeyPart(dimension: GroupDimension, raw: string | null, aliases: AliasTable, epoch: string): GroupKeyResult {
  try {
    if (typeof dimension !== "string" || !(GROUP_DIMENSIONS as readonly string[]).includes(dimension)) return FAIL
    if (raw === null) return { ok: true, text: UNKNOWN_KEY, aliases }
    if (typeof raw !== "string") return FAIL
    const done = (text: string): GroupKeyResult => ({ ok: true, text, aliases })
    switch (dimension) {
      case "day":
      case "tradingDay": { const d = formatDate(raw); return d.ok ? done(d.text) : FAIL }
      case "week": { const d = formatDate(raw); return d.ok ? done(`semana de ${d.text}`) : FAIL }
      case "month": { const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw); return m ? done(`${m[2]}/${m[1]}`) : FAIL }
      case "dayOfWeek": return /^[0-6]$/.test(raw) ? done(WEEKDAYS[Number(raw)]) : FAIL
      case "hour": return /^(?:[01]\d|2[0-3])$/.test(raw) ? done(`${raw}:00`) : FAIL
      case "session": return raw === "AM" || raw === "PM" || raw === "OVERNIGHT" ? done(raw) : FAIL
      case "symbol": return /^[A-Z0-9]{1,12}$/.test(raw) ? done(raw) : FAIL
      case "direction": { const w = formatEnum("direction", raw); return w.ok ? done(w.text) : FAIL }
      case "exitReason": { const w = formatEnum("exitReason", raw); return w.ok ? done(w.text) : FAIL }
      case "account":
      case "strategy": {
        const kind = dimension === "account" ? "conta" : "estrategia"
        if (!(dimension === "account" ? /^acc_[0-9a-f]{24}$/ : /^str_[0-9a-f]{24}$/).test(raw)) return FAIL
        const a = allocateAlias(aliases, kind, raw, epoch)
        return a.ok ? { ok: true, text: a.alias, aliases: a.table } : FAIL
      }
    }
  } catch {
    return FAIL
  }
}
