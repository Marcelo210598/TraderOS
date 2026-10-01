// Registro de parsers. Adicionar um formato novo = criar o ParserDescriptor, registrá-lo aqui e adicionar fixtures.
// Tradovate (Orders/Fills) e Rithmic NÃO estão aqui de propósito: serão escritos a partir de arquivos REAIS
// (fixtures/…). Não inventamos formato de export.

import { issue, type Issue } from "../domain/canonical.ts"
import type { CsvTable } from "./csv.ts"
import { meutradeTemplate } from "./parsers/meutrade-template.ts"
import { ninjaTraderEn } from "./parsers/ninjatrader-en.ts"
import { ninjaTraderPtBr } from "./parsers/ninjatrader-ptbr.ts"
import type { ParserDescriptor } from "./types.ts"

export const DEFAULT_PARSERS: ParserDescriptor[] = [ninjaTraderPtBr, ninjaTraderEn, meutradeTemplate]

export type ParserSelection =
  | { ok: true; parser: ParserDescriptor; confidence: number }
  | { ok: false; issue: Issue }

const MIN_CONFIDENCE = 0.8

/** Detecta o formato. Sem empate claro ou sem confiança suficiente → erro explícito (não escolhe "o mais parecido"). */
export function selectParser(table: CsvTable, parsers: ParserDescriptor[], forceId?: string): ParserSelection {
  if (forceId) {
    const p = parsers.find((x) => x.id === forceId)
    if (!p) return { ok: false, issue: issue("ERROR", "E_PARSER_NOT_FOUND", `Parser "${forceId}" não existe.`) }
    return { ok: true, parser: p, confidence: 1 }
  }
  const scored = parsers
    .map((p) => ({ p, ...p.detect(table) }))
    .filter((s) => s.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
  if (scored.length === 0) {
    return {
      ok: false,
      issue: issue(
        "ERROR",
        "E_FORMAT_UNKNOWN",
        `Formato não reconhecido. Cabeçalhos lidos: ${table.originalHeaders.join(" | ")}. Formatos suportados: ${parsers.map((p) => p.id).join(", ")}.`,
      ),
    }
  }
  if (scored.length > 1 && scored[0].confidence === scored[1].confidence) {
    return {
      ok: false,
      issue: issue("ERROR", "E_FORMAT_AMBIGUOUS", `Mais de um formato casa com o arquivo (${scored.map((s) => s.p.id).join(", ")}). Escolha o formato.`),
    }
  }
  return { ok: true, parser: scored[0].p, confidence: scored[0].confidence }
}
