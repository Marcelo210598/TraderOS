// Valor em dólares de 1 ponto de preço, por instrumento (futuros CME/CBOT/COMEX/NYMEX).
// Fonte única — usada no formulário manual de trade E no parser de import CSV, pra
// converter MAE/MFE em dólar (como vem de export brasileiro do NT8) pra pontos.
export const POINT_VALUES: Record<string, number> = {
  NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, RTY: 50,
  CL: 1000, GC: 100, SI: 5000, ZB: 1000, "6E": 125000,
}

export const INSTRUMENTS = ["NQ", "ES", "YM", "RTY", "CL", "GC", "SI", "ZB", "6E", "MNQ", "MES"]

/**
 * @deprecated Devolve 20 (valor do NQ) em SILÊNCIO para instrumento desconhecido — isso inventa dado.
 * No domínio novo use `pointValueOrNull` / `requirePointValue` de `@/lib/domain/instruments`
 * (desconhecido = null ou erro explícito). Mantido intacto só para os chamadores atuais (UI/importador) até
 * serem migrados (docs/ai-partner/data-contract.md §pointValue).
 */
export function pointValueFor(instrument: string): number {
  return POINT_VALUES[instrument.toUpperCase()] ?? 20
}
