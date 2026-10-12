// TradeEvidence → AnalyticsTrade (E5.2): conversão MECÂNICA, campo a campo, para o verificador reaplicar o MESMO motor de métricas
// sobre a população declarada num bundle. Nada é calculado aqui: só se copia o que o `TradeEvidence` carrega.
//
// O motor lê, de cada trade (via `prepareTrades` e `tradeFingerprint`): entry/exit (incl. `at`), pnl, r, risk.reason, pointsPerContract,
// instrument.root, direction, granularity, reconstruction (confiança/completude/…), as linhas de origem (rowHash) e a conta/estratégia/sessão
// SÓ para filtro e agrupamento. A Evidence não carrega nome de conta, estratégia nem sessão (de propósito): ficam `null`, então
// agrupar/filtrar por esses atributos NÃO é reproduzível a partir da Evidence (o verificador declara isso, não finge).
//
// O objeto devolvido é um `CanonicalTrade` PARCIAL (cast documentado): só tem os campos acima. Testes provam que o motor, alimentado por ele,
// reproduz resultado, trace e tradeSetHash do Canonical completo.

import type { CanonicalTrade } from "../domain/canonical.ts"
import type { AnalyticsTrade } from "../metrics/types.ts"
import type { TradeEvidence } from "./schema.ts"

export function analyticsTradeFromEvidence(e: TradeEvidence): AnalyticsTrade {
  const cycle = e.granularity === "POSITION_CYCLE"
  const first = e.sourceRows[0]
  const partial = {
    schemaVersion: "canonical-trade/2",
    tradeId: e.tradeId,
    importId: e.importId,
    granularity: e.granularity,
    account: { sourceName: null, ref: e.accountRef },
    instrument: { raw: e.instrument.raw, root: e.instrument.root },
    direction: e.direction,
    quantity: e.quantity,
    entry: e.entry,
    exit: e.exit,
    pointsPerContract: e.pointsPerContract,
    pnl: e.pnl,
    risk: { reason: e.risk.reason },
    r: e.r,
    labels: { strategyName: null },
    sessionHint: null,
    // E6.0: o motivo de saída por trade deriva das pernas; a Evidence já as carrega (cópia, sem cálculo). Não entram no fingerprint.
    exitLegs: e.exitLegs,
    exitSummary: e.exitSummary,
    reconstruction: e.reconstruction,
    // ciclo: as linhas de `sourceRows`; trade-linha: o `source.rowHash` (a referência à linha entra no fingerprint nos dois casos)
    sourceRows: cycle ? e.sourceRows.map((r) => ({ rowNo: r.rowNo, rowHash: r.rowHash })) : undefined,
    source: { rowNo: first?.rowNo ?? null, rowHash: cycle ? undefined : (first?.rowHash ?? undefined) },
  }
  return { id: e.tradeId, trade: partial as unknown as CanonicalTrade }
}
