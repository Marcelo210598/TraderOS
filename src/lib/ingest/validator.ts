// Validador de negócio do CanonicalTrade: coerência de horário, instrumento, P&L, risco e excursões.
// Devolve issues (ERROR rejeita o trade; WARNING/INFO ficam anexados) e a qualidade dos dados.
// Os códigos são ESTÁVEIS (documentados em docs/ai-partner/data-contract.md).

import { issue, type CanonicalTrade, type Issue } from "../domain/canonical.ts"
import { pnlTolerance } from "../domain/pnl.ts"
import { checkExcursionConsistency } from "../domain/risk.ts"
import { durationSeconds } from "../domain/time.ts"

export interface ValidationResult {
  issues: Issue[]
  dataQuality: CanonicalTrade["dataQuality"]
}

export function validateTrade(t: CanonicalTrade): ValidationResult {
  const out: Issue[] = []
  const at = (code: string, severity: Issue["severity"], message: string, field?: string) =>
    out.push(issue(severity, code, message, { field, rowNo: t.source.rowNo ?? undefined }))

  // ── tempo ──────────────────────────────────────────────────────────────────
  const { entry, exit } = t
  if (entry.at.precision === "DATE_ONLY") {
    at("W_TIME_DATE_ONLY", "WARNING", "A fonte só traz a DATA (sem hora): análises por horário/sessão ignoram este trade; nenhuma hora foi inventada.", "entry.at")
  }
  if (entry.at.precision === "DATETIME" && exit.at.precision !== "DATETIME") {
    at("W_EXIT_TIME_MISSING", "WARNING", "Horário de saída ausente: duração e dia de pregão da saída indisponíveis.", "exit.at")
  }
  if (entry.at.ambiguity !== "NONE" || exit.at.ambiguity !== "NONE") {
    at("W_TIME_FOLD_AMBIGUOUS", "WARNING", "Horário em hora que se repete no fim do horário de verão: foi assumida a 1ª/2ª ocorrência (ver ambiguity).", "entry.at")
  }
  const dur = durationSeconds(entry.at.instantUtc, exit.at.instantUtc)
  if (dur !== null && dur < 0) {
    at("E_TIME_ORDER", "ERROR", "Saída anterior à entrada (confira o fuso do arquivo e a ordem dia/mês).", "exit.at")
  } else if (dur !== null && dur > 86400) {
    at("W_DURATION_OVER_24H", "WARNING", `Trade com ${(dur / 3600).toFixed(1)}h de duração.`, "exit.at")
  }

  // ── instrumento ────────────────────────────────────────────────────────────
  if (t.instrument.status === "EMPTY") at("E_INSTRUMENT_EMPTY", "ERROR", "Instrumento ausente.", "instrument")
  else if (t.instrument.status === "UNKNOWN_ROOT") {
    at("W_INSTRUMENT_UNKNOWN", "WARNING", `Instrumento "${t.instrument.raw}" fora do catálogo: sem pointValue — R em dólar, P&L recalculado e MFE/MAE em dólar ficam indisponíveis (nada foi assumido).`, "instrument")
  }

  // ── P&L ────────────────────────────────────────────────────────────────────
  const p = t.pnl
  if (p.commission === null) at("W_COMMISSION_MISSING", "WARNING", "Comissão não informada pela fonte: P&L líquido indisponível (não chamamos o bruto de líquido).", "pnl.commission")
  else if (p.fees === null) at("I_FEES_NOT_PROVIDED", "INFO", "Taxas não informadas separadamente: líquido considera só a comissão.", "pnl.fees")

  if (p.basis === "UNKNOWN") {
    if (p.computedGross !== null && p.reported !== null) {
      at("W_PNL_NOT_RECONCILABLE", "WARNING", `P&L reportado (${p.reported}) não bate nem com o bruto (${p.computedGross}) nem com o líquido pelos preços — base desconhecida; bruto/líquido ficam NULL.`, "pnl.reported")
    } else {
      at("W_PNL_BASIS_UNKNOWN", "WARNING", "Base do P&L (bruto/líquido) desconhecida e sem como inferir (falta pointValue ou valor): bruto/líquido ficam NULL.", "pnl.basis")
    }
  } else if (p.basisSource === "SOURCE_DECLARED" && p.computedGross !== null && p.reported !== null) {
    const costs = p.commission === null ? null : p.commission + (p.fees ?? 0)
    const expected = p.basis === "GROSS" ? p.computedGross : costs === null ? null : p.computedGross - costs
    if (expected !== null && Math.abs(p.reported - expected) > pnlTolerance(expected)) {
      at("W_PNL_MISMATCH", "WARNING", `P&L declarado ${p.basis} (${p.reported}) difere do recalculado pelos preços (${expected.toFixed(2)}).`, "pnl.reported")
    }
  }

  // ── risco / R ──────────────────────────────────────────────────────────────
  if (t.risk.reason === "STOP_WRONG_SIDE") at("E_STOP_WRONG_SIDE", "ERROR", "Stop do lado errado da entrada.", "risk.stopPrice")
  else if (t.risk.reason === "STOP_EQUALS_ENTRY") at("E_STOP_EQUALS_ENTRY", "ERROR", "Stop igual ao preço de entrada (risco zero).", "risk.stopPrice")
  else if (t.r.net === null && t.r.netReason) {
    at("I_R_UNAVAILABLE", "INFO", `R líquido indisponível: ${t.r.netReason}.`, "r.net")
  }

  // ── excursões ──────────────────────────────────────────────────────────────
  for (const [field, reason] of [["excursions.mfe", t.excursions.mfeReason], ["excursions.mae", t.excursions.maeReason]] as const) {
    if (reason === "UNIT_UNKNOWN") at("W_EXCURSION_UNIT_UNKNOWN", "WARNING", "MFE/MAE presente mas a UNIDADE (pontos/dólar) é desconhecida: valor descartado em vez de gravado como pontos.", field)
    else if (reason === "POINT_VALUE_UNKNOWN") at("W_EXCURSION_UNCONVERTIBLE", "WARNING", "MFE/MAE em dólar sem pointValue conhecido: não dá pra converter para pontos.", field)
    else if (reason === "NOT_A_NUMBER") at("W_EXCURSION_NOT_A_NUMBER", "WARNING", "MFE/MAE não numérico.", field)
  }
  for (const e of checkExcursionConsistency({ pointsPerContract: t.pointsPerContract, mfePoints: t.excursions.mfePoints, maePoints: t.excursions.maePoints })) {
    at(e.code, "WARNING", e.message, e.code === "W_MFE_LT_REALIZED" ? "excursions.mfe" : "excursions.mae")
  }

  const complete =
    entry.at.precision === "DATETIME" && exit.at.precision === "DATETIME" && t.instrument.pointValue !== null && p.basis !== "UNKNOWN"
  return { issues: out, dataQuality: complete ? "COMPLETE" : "PARTIAL" }
}
