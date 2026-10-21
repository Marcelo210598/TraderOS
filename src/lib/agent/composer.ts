// Compositor de resposta do agente (E7-16; docs/ai-partner/E7-16-expectativa.md, D-S1…D-S10): o SERVIDOR monta o AgentAnswer a partir do ledger do turno. O modelo só escolhe as
// ferramentas: nenhum texto dele entra aqui (a assinatura só aceita { ledger, refs }).
// A saída é feita só de (a) rótulos fixos escritos pelo servidor, (b) `slot` para TODO valor, (c) `phrase` canônicas. Ela passa pelo validateAnswer + renderAnswer SEM alteração
// (auto-checagem): o compositor não decide veredito, banner nem ressalva além do que o validador exige.
// Puro, determinístico, sem rede/relógio/ambiente, nunca lança, saída congelada. Só `./` (SG1).
import { CombinedVerdictSchema, type AgentAnswer, type CapabilityId } from "./contract.ts"
import { lookupRef, type Ledger, type LedgerEntry } from "./ledger.ts"
import { PARTIAL_PHRASES } from "./phrases.ts"

/** Frase fixa quando o modelo não escolheu nenhuma ferramenta (D-S2): cobre pedido operacional, injeção e assunto fora do escopo. */
export const OFF_SCOPE_TEXT = "Só analiso os dados de trades que você importou. Reformule a pergunta sobre eles."
/** Linhas por bloco de grupos/ranking (D-S7): o validador limita 200 segmentos por resposta. */
export const COMPOSER_MAX_ROWS = 12
/** Frase de corte (D-S7): sem número, nunca corta em silêncio. */
export const CUT_TEXT = "Mostrando só os primeiros grupos; refine o filtro para ver o resto."
const MAX_SEGMENTS = 178 // folga sobre o limite de 200 do validador: ~12 segmentos ficam para as frases de população/ressalva do fim de cada bloco
const NEXT_BLOCK_MIN_ROOM = 40
/** Frase de omissão (D-S7): blocos que não couberam; sem número. */
export const OMIT_TEXT = "Outras consultas não couberam nesta resposta; faça uma pergunta por vez."

/** Rótulo de cada métrica do METRIC_CATALOG (D-S6): só letras e espaço. Um teste exige uma entrada por id do catálogo. */
export const METRIC_TEXT: Readonly<Record<string, string>> = Object.freeze({
  totalTrades: "Total de trades", classifiedTrades: "Trades classificáveis", winners: "Trades ganhadores", losers: "Trades com perda", breakeven: "Trades zerados",
  winRate: "Taxa de acerto", lossRate: "Taxa de perdas", breakevenRate: "Taxa de trades zerados",
  grossPnl: "Resultado antes dos custos", netPnl: "Resultado após custos", commission: "Comissão", fees: "Taxas",
  winnersTotal: "Total dos ganhos", losersTotal: "Total das perdas", averageTrade: "Trade médio", averageWinner: "Ganho médio", averageLoser: "Perda média",
  largestWinner: "Ganho máximo", largestLoser: "Perda máxima", payoffRatio: "Payoff", profitFactor: "Fator de lucro",
  largestWinnerSharePct: "Dependência do ganho máximo", top3WinnersSharePct: "Dependência dos principais ganhos",
  totalR: "R total", averageR: "R médio", medianR: "R mediano", winRateR: "Taxa de acerto em R", expectancyR: "Expectativa em R", averageWinnerR: "R médio dos ganhos", averageLoserR: "R médio das perdas",
  maxDrawdown: "Rebaixamento máximo em dólares", maxDrawdownR: "Rebaixamento máximo em R", currentDrawdown: "Rebaixamento atual em dólares", recoveryFactor: "Fator de recuperação",
  maxConsecutiveWins: "Sequência máxima de vitórias", maxConsecutiveLosses: "Sequência máxima de derrotas", currentStreak: "Sequência atual",
  totalPoints: "Pontos totais", averagePoints: "Pontos médios",
})
/** Dimensão de agrupamento → palavra pt-BR (as 12 do contrato). */
export const GROUP_TEXT: Readonly<Record<string, string>> = Object.freeze({
  day: "dia", tradingDay: "dia de pregão", week: "semana", month: "mês", dayOfWeek: "dia da semana", hour: "hora", session: "sessão", symbol: "símbolo", direction: "direção", account: "conta", strategy: "estratégia", exitReason: "motivo de saída",
})

const C = CombinedVerdictSchema.enum // os valores vêm do enum do contrato (o guarda G2 proíbe literal de veredito fora de verdict.ts/contract.ts)
type Seg = AgentAnswer["segments"][number]
type Claim = AgentAnswer["claims"][number]
type Mode = "ASSERT" | "LABELED"
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const COMPOSE_FAILED = Object.freeze({ ok: false as const, code: "COMPOSE_FAILED" as const })

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) }
  return x
}

/** Acumulador: junta texto contíguo num só segmento e guarda a ordem. */
class Builder {
  segs: Seg[] = []
  claims: Claim[] = []
  private pending = ""
  get count(): number { return this.segs.length + (this.pending === "" ? 0 : 1) }
  text(s: string): this { this.pending += s; return this }
  /** Frase própria: fecha o texto pendente (com quebra de linha) e põe `s` sozinha num segmento. */
  own(s: string): this { this.pending += "\n"; this.flush(); this.segs.push({ kind: "text", text: s }); return this }
  private flush(): void { if (this.pending !== "") { this.segs.push({ kind: "text", text: this.pending }); this.pending = "" } }
  slot(ref: string, path: string, mode: Mode): this { this.flush(); this.segs.push({ kind: "slot", ref, path }); this.claims.push({ ref, path, mode }); return this }
  phrase(code: string, ref?: string): this { this.flush(); this.segs.push(ref === undefined ? { kind: "phrase", code: code as never } : { kind: "phrase", code: code as never, ref }); return this }
  done(): AgentAnswer { this.flush(); return { segments: this.segs, claims: this.claims } }
}

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const label = (id: unknown): string => { if (typeof id === "string" && Object.hasOwn(METRIC_TEXT, id)) return METRIC_TEXT[id]; throw new Error("COMPOSE_METRIC_UNKNOWN") }
const groupWords = (g: unknown): string => arr(g).map((x) => { if (typeof x === "string" && Object.hasOwn(GROUP_TEXT, x)) return GROUP_TEXT[x]; throw new Error("COMPOSE_GROUP_UNKNOWN") }).join(" e ")
/** Chave de grupo como slots separados por " / ". */
function keySlots(b: Builder, ref: string, base: string, n: number, mode: Mode): void {
  for (let j = 0; j < n; j++) { if (j > 0) b.text(" / "); b.slot(ref, `${base}.key[${j}]`, mode) }
}

type BlockFn = (b: Builder, ref: string, view: Record<string, unknown>, mode: Mode) => void
const BLOCKS: Readonly<Partial<Record<CapabilityId, BlockFn>>> = {
  "metrics.query@1": (b, ref, v, mode) => {
    const metrics = arr(v.metrics)
    for (let i = 0; i < metrics.length; i++) {
      if (b.count + 3 > MAX_SEGMENTS) { b.own(CUT_TEXT); break }
      b.text(`${i > 0 ? "\n" : ""}${label(isRecord(metrics[i]) ? (metrics[i] as Record<string, unknown>).metricId : null)}: `).slot(ref, `metrics[${i}].value`, mode)
    }
    const p = v.period
    if (isRecord(p) && typeof p.from === "string" && typeof p.to === "string") b.text("\nPeríodo: ").slot(ref, "period.from", mode).text(" a ").slot(ref, "period.to", mode)
  },
  "metrics.groups@1": (b, ref, v, mode) => {
    b.text(`Por ${groupWords(v.groupBy)}:`)
    const groups = arr(v.groups)
    for (let i = 0; i < groups.length; i++) {
      const g = isRecord(groups[i]) ? groups[i] as Record<string, unknown> : {}
      const metrics = arr(g.metrics), keyN = arr(g.key).length
      const need = 2 + keyN * 2 + metrics.length * 3 + 2
      if (i >= COMPOSER_MAX_ROWS || b.count + need > MAX_SEGMENTS) { b.own(CUT_TEXT); return }
      b.text("\n"); keySlots(b, ref, `groups[${i}]`, keyN, mode); b.text(": ")
      metrics.forEach((m, k) => { b.text(`${k > 0 ? "; " : ""}${label(isRecord(m) ? m.metricId : null)} `).slot(ref, `groups[${i}].metrics[${k}].value`, mode) })
      b.text(" (").slot(ref, `groups[${i}].sampleFlag`, mode).text(")")
    }
  },
  "exit.breakdown@1": (b, ref, v, mode) => exitBlock(b, ref, v, mode, ""),
  "exit.analysis@1": (b, ref, v, mode) => {
    exitBlock(b, ref, v, mode, "")
    if (isRecord(v.comparison)) { b.text("\n"); compareBlock(b, ref, v.comparison, mode, "comparison.") }
  },
  "metrics.compare@1": (b, ref, v, mode) => compareBlock(b, ref, v, mode, ""),
  "rank.groups@1": (b, ref, v, mode) => {
    b.text(`Ordenado por ${typeof v.orderedBy === "string" && Object.hasOwn(METRIC_TEXT, v.orderedBy) ? METRIC_TEXT[v.orderedBy].toLowerCase() : "métrica"}:`)
    const rows = arr(v.rows)
    for (let i = 0; i < rows.length; i++) {
      const r = isRecord(rows[i]) ? rows[i] as Record<string, unknown> : {}
      const keyN = arr(r.key).length
      if (i >= COMPOSER_MAX_ROWS || b.count + 2 + keyN * 2 + 8 > MAX_SEGMENTS) { b.own(CUT_TEXT); return }
      b.text("\n")
      if (typeof r.rank === "number") b.slot(ref, `rows[${i}].rank`, mode).text(". "); else b.text("Fora do ranking: ")
      keySlots(b, ref, `rows[${i}]`, keyN, mode); b.text(": ").slot(ref, `rows[${i}].value.value`, mode).text(" (").slot(ref, `rows[${i}].sampleFlag`, mode).text(")")
    }
  },
}

function exitBlock(b: Builder, ref: string, v: Record<string, unknown>, mode: Mode, base: string): void {
  b.text("Saídas por motivo:")
  const buckets = arr(v.buckets)
  for (let i = 0; i < buckets.length; i++) {
    if (b.count + 12 > MAX_SEGMENTS) { b.own(CUT_TEXT); return }
    b.text("\n").slot(ref, `${base}buckets[${i}].reason`, mode).text(": ").slot(ref, `${base}buckets[${i}].count`, mode).text(" ").slot(ref, `${base}buckets[${i}].unit`, mode)
      .text("; resultado após custos ").slot(ref, `${base}buckets[${i}].pnlNet`, mode).text("; participação ").slot(ref, `${base}buckets[${i}].share`, mode)
  }
  b.text("\nConciliação: ").slot(ref, `${base}reconciliation`, mode)
}

function compareBlock(b: Builder, ref: string, v: Record<string, unknown>, mode: Mode, base: string): void {
  const a = isRecord(v.a) ? v.a : {}, bb = isRecord(v.b) ? v.b : {}
  b.text("Entre "); keySlots(b, ref, `${base}a`, arr(a.key).length, mode); b.text(" e "); keySlots(b, ref, `${base}b`, arr(bb.key).length, mode); b.text(":")
  const deltas = arr(v.deltas)
  for (let i = 0; i < deltas.length; i++) {
    if (b.count + 12 > MAX_SEGMENTS) { b.own(CUT_TEXT); return }
    const d = isRecord(deltas[i]) ? deltas[i] as Record<string, unknown> : {}
    b.text(`\n${label(d.metricId)}: `).slot(ref, `${base}deltas[${i}].a`, mode).text(" contra ").slot(ref, `${base}deltas[${i}].b`, mode).text("; diferença ").slot(ref, `${base}deltas[${i}].delta`, mode)
  }
}

const PARTIAL_CODES = Object.keys(PARTIAL_PHRASES)
const INTEGRITY: ReadonlyArray<readonly [string, (e: LedgerEntry) => boolean]> = [
  ["INTEGRITY_SEAL", (e) => e.handle.verdict.verify.status === "TAMPERED"],
  ["INTEGRITY_FORMAT", (e) => e.handle.verdict.verify.status === "INVALID_FORMAT"],
  ["INTEGRITY_SOURCE", (e) => e.handle.verdict.source.status === "SOURCE_MISMATCH"],
]
const NOT_CITABLE_TEXT = "Não consigo citar números desta consulta: o resultado não pôde ser verificado."

function composeBlock(b: Builder, ref: string, e: LedgerEntry): void {
  const v = e.handle.verdict
  // número de evidência adulterada/ilegível/não validável NUNCA é citado (o validador rejeitaria): só a frase de integridade
  if (v.combined === C.TAMPERED_OR_MISMATCH || (v.combined === C.NOT_VERIFIED && v.verify.status !== "VALID")) {
    const codes = INTEGRITY.filter(([, fits]) => fits(e)).map(([c]) => c)
    if (codes.length === 0) b.text(NOT_CITABLE_TEXT); else for (const c of codes) b.phrase(c, ref)
    return
  }
  const block = BLOCKS[e.capability]
  if (block === undefined || !isRecord(e.view)) throw new Error("COMPOSE_CAPABILITY")
  const mode: Mode = v.combined === C.NOT_VERIFIED ? "LABELED" : "ASSERT"
  block(b, ref, e.view, mode)
  b.phrase("POPULATION_DECLARED", ref)
  if (v.combined === C.VERIFIED_PARTIAL) {
    const own = PARTIAL_CODES.filter((c) => v.verify.codes.includes(c) || v.source.codes.includes(c))
    for (const c of own.length > 0 ? own : ["S_POPULATION_PARTIAL"]) b.phrase(c, ref)
  }
  const pop = e.handle.population
  if (pop.conclusive === false || pop.sampleFlag === "LOW" || pop.sampleFlag === "TINY" || (isRecord(e.view) && e.view.conclusive === false)) b.phrase("INDICATIVE_ONLY", ref)
}

/** Monta a resposta das evidências `refs` (na ordem dada, sem repetição). Qualquer anomalia ⇒ COMPOSE_FAILED (bug nosso, nunca do modelo). */
export function composeAnswer(input: { readonly ledger: Ledger; readonly refs: readonly string[] }): { readonly ok: true; readonly answer: AgentAnswer } | { readonly ok: false; readonly code: "COMPOSE_FAILED" } {
  try {
    if (!isRecord(input)) return COMPOSE_FAILED
    const ledger = input.ledger, refs = input.refs
    if (!isRecord(ledger) || !Array.isArray(refs) || refs.length === 0) return COMPOSE_FAILED
    const unique = [...new Set(refs)]
    const b = new Builder()
    for (const [n, ref] of unique.entries()) {
      if (typeof ref !== "string") throw new Error("COMPOSE_REF")
      const e = lookupRef(ledger, ref)
      if (e === null) throw new Error("COMPOSE_REF")
      if (n > 0) {
        if (b.count + NEXT_BLOCK_MIN_ROOM > MAX_SEGMENTS) { b.own(OMIT_TEXT); break } // sem espaço: omite o resto, dizendo
        b.text("\n\n")
      }
      composeBlock(b, ref, e)
    }
    const answer = b.done()
    if (answer.segments.length === 0 || answer.segments.length > 200) return COMPOSE_FAILED
    return { ok: true, answer: deepFreeze(answer) }
  } catch {
    return COMPOSE_FAILED
  }
}

/** Resposta quando o modelo não escolheu nenhuma ferramenta (D-S2): só texto fixo, sem claims. */
export function composeOffScope(): AgentAnswer {
  return deepFreeze({ segments: [{ kind: "text" as const, text: OFF_SCOPE_TEXT }], claims: [] })
}
