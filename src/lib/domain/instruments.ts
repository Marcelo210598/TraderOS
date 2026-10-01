// Catálogo de instrumentos do domínio canônico do MeuTrade.
//
// Regra do contrato de dados (docs/ai-partner/data-contract.md §pointValue):
//   instrumento desconhecido => pointValue = null (ou erro explícito). NUNCA assumir NQ.
// O `pointValueFor()` legado (src/lib/instruments.ts) devolve 20 (NQ) em silêncio — este módulo o substitui
// no domínio novo; o legado fica intacto até os chamadores serem migrados.
//
// Fonte dos pointValues: tabela POINT_VALUES já usada no app (src/lib/instruments.ts).
// Fuso: CME Group (CME/CBOT/NYMEX/COMEX) opera em America/Chicago. Tick size NÃO está aqui de propósito:
// ainda nenhum cálculo depende dele e não vamos carregar dado não verificado (entra no seed de Instrument, incremento 2).

export type ExchangeCode = "CME" | "CBOT" | "NYMEX" | "COMEX"

export interface InstrumentSpec {
  root: string
  assetClass: "FUTURES"
  exchange: ExchangeCode
  currency: "USD"
  /** Valor em dólar de 1 ponto de preço, por contrato. */
  pointValue: number
  exchangeTz: string
  /** Raiz do contrato "cheio" quando este é um micro (MNQ → NQ). */
  microOf?: string
}

const CME_TZ = "America/Chicago"

const SPECS: InstrumentSpec[] = [
  { root: "NQ", assetClass: "FUTURES", exchange: "CME", currency: "USD", pointValue: 20, exchangeTz: CME_TZ },
  { root: "MNQ", assetClass: "FUTURES", exchange: "CME", currency: "USD", pointValue: 2, exchangeTz: CME_TZ, microOf: "NQ" },
  { root: "ES", assetClass: "FUTURES", exchange: "CME", currency: "USD", pointValue: 50, exchangeTz: CME_TZ },
  { root: "MES", assetClass: "FUTURES", exchange: "CME", currency: "USD", pointValue: 5, exchangeTz: CME_TZ, microOf: "ES" },
  { root: "YM", assetClass: "FUTURES", exchange: "CBOT", currency: "USD", pointValue: 5, exchangeTz: CME_TZ },
  { root: "RTY", assetClass: "FUTURES", exchange: "CME", currency: "USD", pointValue: 50, exchangeTz: CME_TZ },
  { root: "CL", assetClass: "FUTURES", exchange: "NYMEX", currency: "USD", pointValue: 1000, exchangeTz: CME_TZ },
  { root: "GC", assetClass: "FUTURES", exchange: "COMEX", currency: "USD", pointValue: 100, exchangeTz: CME_TZ },
  { root: "SI", assetClass: "FUTURES", exchange: "COMEX", currency: "USD", pointValue: 5000, exchangeTz: CME_TZ },
  { root: "ZB", assetClass: "FUTURES", exchange: "CBOT", currency: "USD", pointValue: 1000, exchangeTz: CME_TZ },
  { root: "6E", assetClass: "FUTURES", exchange: "CME", currency: "USD", pointValue: 125000, exchangeTz: CME_TZ },
]

const BY_ROOT = new Map(SPECS.map((s) => [s.root, s]))
// Prefixos mais longos primeiro: "MNQZ6" tem que casar MNQ, não "M"+"NQ..." nem NQ.
const ROOTS_LONGEST_FIRST = [...BY_ROOT.keys()].sort((a, b) => b.length - a.length)

export function listInstrumentRoots(): string[] {
  return [...BY_ROOT.keys()]
}

export function getInstrumentSpec(root: string | null | undefined): InstrumentSpec | null {
  if (!root) return null
  return BY_ROOT.get(root.trim().toUpperCase()) ?? null
}

/** pointValue ou null. Nunca um default. */
export function pointValueOrNull(root: string | null | undefined): number | null {
  return getInstrumentSpec(root)?.pointValue ?? null
}

export class UnknownInstrumentError extends Error {
  readonly code = "E_INSTRUMENT_UNKNOWN"
  readonly raw: string
  // Sem "parameter properties": o Node roda estes módulos nos testes só removendo tipos (strip-only).
  constructor(raw: string) {
    super(`Instrumento desconhecido: "${raw}". Não há pointValue cadastrado — recusado em vez de assumir um valor.`)
    this.name = "UnknownInstrumentError"
    this.raw = raw
  }
}

/** Para quem PRECISA do valor: lança erro explícito em vez de chutar. */
export function requirePointValue(root: string | null | undefined): number {
  const pv = pointValueOrNull(root)
  if (pv === null) throw new UnknownInstrumentError(String(root ?? ""))
  return pv
}

// ── Símbolo/contrato ─────────────────────────────────────────────────────────

const MONTH_CODES: Record<string, number> = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 }
const CODE_BY_MONTH = Object.fromEntries(Object.entries(MONTH_CODES).map(([c, m]) => [m, c])) as Record<number, string>

export interface ContractInfo {
  /** Código do mês (F..Z). */
  monthCode: string
  month: number
  /** Dígitos do ano como vieram: "6" (NQZ6), "26" (NQZ26/NQ 12-26) ou "2026". Não resolvemos década aqui de propósito. */
  yearDigits: string
}

export type SymbolStatus = "KNOWN_ROOT" | "UNKNOWN_ROOT" | "EMPTY"

export interface ParsedSymbol {
  raw: string
  /** Raiz reconhecida no catálogo, ou null. Nunca um palpite. */
  root: string | null
  contract: ContractInfo | null
  status: SymbolStatus
}

/**
 * Entende "NQ", "NQZ6", "NQZ26", "MNQ 12-26" (formato NinjaTrader), "6EH6".
 * Se a raiz não está no catálogo → status UNKNOWN_ROOT e root = null (o chamador decide; nada de assumir).
 */
export function parseContractSymbol(raw: string | null | undefined): ParsedSymbol {
  const text = (raw ?? "").trim().toUpperCase()
  if (!text) return { raw: raw ?? "", root: null, contract: null, status: "EMPTY" }

  // NinjaTrader: "NQ 06-25" / "MNQ 12-26"
  const nt = text.match(/^([A-Z0-9]{1,5})\s+(\d{1,2})-(\d{2})$/)
  if (nt) {
    const root = BY_ROOT.has(nt[1]) ? nt[1] : null
    const month = Number(nt[2])
    if (!root || month < 1 || month > 12) return { raw: raw ?? "", root: null, contract: null, status: "UNKNOWN_ROOT" }
    return {
      raw: raw ?? "",
      root,
      contract: { monthCode: CODE_BY_MONTH[month], month, yearDigits: nt[3] },
      status: "KNOWN_ROOT",
    }
  }

  for (const root of ROOTS_LONGEST_FIRST) {
    if (!text.startsWith(root)) continue
    const rest = text.slice(root.length)
    if (rest === "") return { raw: raw ?? "", root, contract: null, status: "KNOWN_ROOT" }
    const m = rest.match(/^([FGHJKMNQUVXZ])(\d{1,4})$/)
    if (m) {
      return {
        raw: raw ?? "",
        root,
        contract: { monthCode: m[1], month: MONTH_CODES[m[1]], yearDigits: m[2] },
        status: "KNOWN_ROOT",
      }
    }
    // Começa com uma raiz conhecida mas o resto não é mês+ano ("NQ1!", "NQX"): trata como desconhecido, não como NQ.
    return { raw: raw ?? "", root: null, contract: null, status: "UNKNOWN_ROOT" }
  }
  return { raw: raw ?? "", root: null, contract: null, status: "UNKNOWN_ROOT" }
}
