// E7-20: LAYOUT estruturado da resposta (cartões e tabelas), derivado no SERVIDOR do ledger + do `rendered`. Docs: docs/ai-partner/E7-20-expectativa.md (D-Y1…D-Y10).
// Regra de ouro: NENHUM número nasce aqui. A estrutura (grupos, métricas, motivos) vem da `view` da evidência; cada célula é o `text` + o `combined` do RenderedSegment `value` de mesmo (ref, path)
// que o texto corrido já usa. Texto fixo (títulos, legendas, ajudas) é nosso, sem dígito, e passa em validateText. Qualquer anomalia ⇒ null (a tela usa o texto corrido). Puro, congelado, nunca lança.
import { COMPOSER_MAX_ROWS, CUT_TEXT, GROUP_TEXT, METRIC_TEXT, OMIT_TEXT } from "./composer.ts"
import { CombinedVerdictSchema } from "./contract.ts"
import { lookupRef } from "./ledger.ts"

const C = CombinedVerdictSchema.enum // o guarda G2 proíbe literal de veredito fora de verdict.ts/contract.ts

export interface WireCell { readonly text: string; readonly combined: string; readonly note: string | null }
export type WirePart = { readonly text: string } | { readonly cell: WireCell }
export type WireBlock =
  | { readonly kind: "title"; readonly text: string }
  | { readonly kind: "line"; readonly parts: readonly WirePart[] }
  | { readonly kind: "stats"; readonly items: readonly { readonly label: string; readonly help: string | null; readonly cell: WireCell }[] }
  | { readonly kind: "table"; readonly caption: string | null; readonly columns: readonly { readonly label: string; readonly help: string | null }[]; readonly rows: readonly { readonly label: string; readonly tag: string | null; readonly cells: readonly WireCell[] }[] }
  | { readonly kind: "note"; readonly text: string; readonly tone: "info" | "caveat" }
export interface WireLayout { readonly blocks: readonly WireBlock[] }

const T = Object.freeze({
  queryTitle: "Resultados do período", exitTitle: "Saídas por motivo", compareTitle: "Comparação", rankTitle: "Ranking",
  legCaption: "Por ordem de saída", tradeCaption: "Por trade (posição inteira)",
  colRank: "Posição", colCount: "Quantidade", colShare: "Participação", colA: "Primeiro", colB: "Segundo", colDelta: "Diferença",
  helpCount: "Quantas saídas (ou posições) terminaram por esse motivo.", helpShare: "Parcela do total que veio desse motivo.",
  linePeriod: "Período: ", lineTo: " a ", lineRec: "Conciliação: ", lineBetween: "Entre ", lineAnd: " e ", lineSep: " / ", lineOrder: "Ordenado por ", lineDesc: ", em ordem decrescente", lineAsc: ", em ordem crescente",
  noteTrade: "Um trade é uma posição do início ao fim, da entrada até zerar; não é cada linha do arquivo.",
  noteUnknown: "“Desconhecido” quer dizer que o arquivo não informa por qual ordem a posição foi encerrada.",
  noteOutOfRank: "fora do ranking",
})
const HELP: Readonly<Record<string, string>> = Object.freeze({
  totalTrades: "Quantidade de trades no período. Cada trade é uma posição, da entrada até zerar.",
  winners: "Trades que fecharam no positivo.", losers: "Trades que fecharam no negativo.",
  winRate: "Percentual de trades que fecharam no positivo.",
  grossPnl: "Resultado dos trades antes de descontar comissão e taxas.",
  netPnl: "Resultado dos trades, já descontadas comissão e taxas.",
  commission: "Total pago em comissão.", fees: "Total pago em taxas.",
  averageTrade: "Resultado médio por trade.", averageWinner: "Resultado médio dos trades que fecharam no positivo.", averageLoser: "Resultado médio dos trades que fecharam no negativo.",
  payoffRatio: "Ganho médio dividido pela perda média.",
  profitFactor: "Total ganho dividido pelo total perdido. Acima de um, os ganhos superam as perdas.",
  largestWinnerSharePct: "Quanto do total de ganhos veio de um único trade, o mais lucrativo.",
  top3WinnersSharePct: "Quanto do total de ganhos veio dos trades mais lucrativos.",
  maxDrawdown: "Queda mais funda do saldo entre um pico e o fundo seguinte, em dólares.",
  currentDrawdown: "Distância entre o saldo de agora e o último pico.",
  recoveryFactor: "Resultado total dividido pelo rebaixamento máximo.",
  maxConsecutiveWins: "Quantos trades positivos seguidos, no máximo.", maxConsecutiveLosses: "Quantos trades negativos seguidos, no máximo.",
  currentStreak: "Sequência em andamento: positiva se os últimos trades ganharam, negativa se perderam.",
})
/** Explicação de 1 linha por métrica (texto NOSSO). Métrica sem entrada ⇒ sem explicação. */
export const METRIC_HELP: Readonly<Record<string, string>> = HELP
/** Todo texto fixo que o layout pode escrever (varrido por teste: sem dígito, passa em validateText). */
export const LAYOUT_STATIC_TEXTS: readonly string[] = Object.freeze(Object.values(T))

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const valid = new Set<string>(Object.values(C))
const UNAVAILABLE = /^indisponível \(([\s\S]*)\)$/
function deepFreeze<T>(x: T): T { if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) } return x }

type Seg = { readonly text: string; readonly combined: string }
class Fail extends Error {}
class Ctx {
  readonly values = new Map<string, Seg>()
  readonly cut: boolean
  readonly omit: boolean
  constructor(rendered: unknown) {
    if (!isRecord(rendered) || !Array.isArray(rendered.segments)) throw new Fail()
    let cut = false, omit = false
    for (const s of rendered.segments) {
      if (!isRecord(s)) throw new Fail()
      if (s.kind === "value" && typeof s.ref === "string" && typeof s.path === "string" && typeof s.text === "string" && typeof s.combined === "string" && valid.has(s.combined)) { const k = `${s.ref}\u0000${s.path}`; if (!this.values.has(k)) this.values.set(k, { text: s.text, combined: s.combined }) }
      if (s.kind === "text" && s.text === CUT_TEXT) cut = true
      if (s.kind === "text" && s.text === OMIT_TEXT) omit = true
    }
    this.cut = cut; this.omit = omit
  }
  has(ref: string, path: string): boolean { return this.values.has(`${ref}\u0000${path}`) }
  seg(ref: string, path: string): Seg { const v = this.values.get(`${ref}\u0000${path}`); if (v === undefined) throw new Fail(); return v }
  cell(ref: string, path: string): WireCell {
    const v = this.seg(ref, path), m = UNAVAILABLE.exec(v.text)
    return m === null ? { text: v.text, combined: v.combined, note: null } : { text: "—", combined: v.combined, note: m[1] }
  }
}
const label = (id: unknown): string => { if (typeof id === "string" && Object.hasOwn(METRIC_TEXT, id)) return METRIC_TEXT[id]; throw new Fail() }
const help = (id: unknown): string | null => (typeof id === "string" && Object.hasOwn(HELP, id) ? HELP[id] : null)
const groupWords = (g: unknown): string => arr(g).map((x) => { if (typeof x === "string" && Object.hasOwn(GROUP_TEXT, x)) return GROUP_TEXT[x]; throw new Fail() }).join(" e ")
/** Chave de grupo: texto = os slots da chave unidos por " / " (o mesmo que o texto corrido mostra). */
const keyText = (c: Ctx, ref: string, base: string, n: number): string => { if (n < 1) throw new Fail(); return Array.from({ length: n }, (_, j) => c.seg(ref, `${base}.key[${j}]`).text).join(" / ") }
const keyParts = (c: Ctx, ref: string, base: string, n: number): WirePart[] => { if (n < 1) throw new Fail(); const p: WirePart[] = []; for (let j = 0; j < n; j++) { if (j > 0) p.push({ text: T.lineSep }); p.push({ cell: c.cell(ref, `${base}.key[${j}]`) }) } return p }
const sampleTag = (c: Ctx, ref: string, path: string, raw: unknown): string | null => (raw === "OK" ? null : c.seg(ref, path).text)

type Out = { blocks: WireBlock[]; cutHere: boolean }
const QUERY = (c: Ctx, ref: string, v: Record<string, unknown>, o: Out): void => {
  o.blocks.push({ kind: "title", text: T.queryTitle })
  const items: { label: string; help: string | null; cell: WireCell }[] = []
  const metrics = arr(v.metrics)
  for (let i = 0; i < metrics.length; i++) {
    const m = isRecord(metrics[i]) ? metrics[i] as Record<string, unknown> : {}
    if (!c.has(ref, `metrics[${i}].value`)) { if (c.cut) { o.cutHere = true; break } throw new Fail() }
    items.push({ label: label(m.metricId), help: help(m.metricId), cell: c.cell(ref, `metrics[${i}].value`) })
  }
  if (items.length === 0) throw new Fail()
  o.blocks.push({ kind: "stats", items })
  const p = v.period
  if (isRecord(p) && typeof p.from === "string" && typeof p.to === "string") o.blocks.push({ kind: "line", parts: [{ text: T.linePeriod }, { cell: c.cell(ref, "period.from") }, { text: T.lineTo }, { cell: c.cell(ref, "period.to") }] })
}
const GROUPS = (c: Ctx, ref: string, v: Record<string, unknown>, o: Out): void => {
  o.blocks.push({ kind: "title", text: `Por ${groupWords(v.groupBy)}` })
  const groups = arr(v.groups)
  const first = isRecord(groups[0]) ? groups[0] as Record<string, unknown> : {}
  const columns = arr(first.metrics).map((m) => { const id = isRecord(m) ? m.metricId : null; return { label: label(id), help: help(id) } })
  const rows: { label: string; tag: string | null; cells: WireCell[] }[] = []
  for (let i = 0; i < groups.length; i++) {
    const g = isRecord(groups[i]) ? groups[i] as Record<string, unknown> : {}
    const metrics = arr(g.metrics), keyN = arr(g.key).length
    const need = [...Array.from({ length: keyN }, (_, j) => `groups[${i}].key[${j}]`), `groups[${i}].sampleFlag`, ...metrics.map((_, k) => `groups[${i}].metrics[${k}].value`)]
    if (i >= COMPOSER_MAX_ROWS || !need.every((p) => c.has(ref, p))) { if (c.cut) { o.cutHere = true; break } throw new Fail() }
    if (metrics.length !== columns.length) throw new Fail()
    rows.push({ label: keyText(c, ref, `groups[${i}]`, keyN), tag: sampleTag(c, ref, `groups[${i}].sampleFlag`, g.sampleFlag), cells: metrics.map((_, k) => c.cell(ref, `groups[${i}].metrics[${k}].value`)) })
  }
  if (rows.length === 0 || columns.length === 0) throw new Fail()
  o.blocks.push({ kind: "table", caption: null, columns, rows })
}
const RANK = (c: Ctx, ref: string, v: Record<string, unknown>, o: Out): void => {
  const ord = typeof v.orderedBy === "string" ? /^([A-Za-z0-9]+) (DESC|ASC)$/.exec(v.orderedBy) : null
  if (ord === null) throw new Fail()
  o.blocks.push({ kind: "title", text: T.rankTitle })
  o.blocks.push({ kind: "line", parts: [{ text: T.lineOrder }, { text: label(ord[1]) }, { text: ord[2] === "DESC" ? T.lineDesc : T.lineAsc }] })
  const rows: { label: string; tag: string | null; cells: WireCell[] }[] = []
  const src = arr(v.rows)
  for (let i = 0; i < src.length; i++) {
    const r = isRecord(src[i]) ? src[i] as Record<string, unknown> : {}
    const keyN = arr(r.key).length, ranked = typeof r.rank === "number"
    const need = [...Array.from({ length: keyN }, (_, j) => `rows[${i}].key[${j}]`), `rows[${i}].value.value`, `rows[${i}].sampleFlag`, ...(ranked ? [`rows[${i}].rank`] : [])]
    if (i >= COMPOSER_MAX_ROWS || !need.every((p) => c.has(ref, p))) { if (c.cut) { o.cutHere = true; break } throw new Fail() }
    const value = c.cell(ref, `rows[${i}].value.value`)
    rows.push({ label: keyText(c, ref, `rows[${i}]`, keyN), tag: sampleTag(c, ref, `rows[${i}].sampleFlag`, r.sampleFlag), cells: [ranked ? c.cell(ref, `rows[${i}].rank`) : { text: "—", combined: value.combined, note: T.noteOutOfRank }, value] })
  }
  if (rows.length === 0) throw new Fail()
  o.blocks.push({ kind: "table", caption: null, columns: [{ label: T.colRank, help: null }, { label: label(ord[1]), help: help(ord[1]) }], rows })
}
const EXITS = (c: Ctx, ref: string, v: Record<string, unknown>, o: Out): void => {
  const byUnit = new Map<string, number[]>()
  const buckets = arr(v.buckets)
  for (let i = 0; i < buckets.length; i++) {
    const b = isRecord(buckets[i]) ? buckets[i] as Record<string, unknown> : {}
    if (!["reason", "count", "pnlNet", "share"].every((f) => c.has(ref, `buckets[${i}].${f}`))) { if (c.cut) { o.cutHere = true; break } throw new Fail() }
    if (b.unit !== "LEG" && b.unit !== "TRADE") throw new Fail()
    byUnit.set(b.unit, [...(byUnit.get(b.unit) ?? []), i])
  }
  if (byUnit.size === 0) throw new Fail()
  o.blocks.push({ kind: "title", text: T.exitTitle })
  for (const [unit, idx] of byUnit) {
    o.blocks.push({ kind: "table", caption: unit === "LEG" ? T.legCaption : T.tradeCaption, columns: [{ label: T.colCount, help: T.helpCount }, { label: METRIC_TEXT.netPnl, help: HELP.netPnl }, { label: T.colShare, help: T.helpShare }],
      rows: idx.map((i) => ({ label: c.seg(ref, `buckets[${i}].reason`).text, tag: null, cells: ["count", "pnlNet", "share"].map((f) => c.cell(ref, `buckets[${i}].${f}`)) })) })
  }
  if (c.has(ref, "reconciliation")) o.blocks.push({ kind: "line", parts: [{ text: T.lineRec }, { cell: c.cell(ref, "reconciliation") }] })
  if ([...c.values.entries()].some(([k, s]) => k.startsWith(`${ref}\u0000buckets[`) && k.endsWith(".reason") && s.text === "desconhecido")) o.blocks.push({ kind: "note", text: T.noteUnknown, tone: "info" })
}
const COMPARE = (base: string) => (c: Ctx, ref: string, v: Record<string, unknown>, o: Out): void => {
  const a = isRecord(v.a) ? v.a : {}, b = isRecord(v.b) ? v.b : {}
  o.blocks.push({ kind: "title", text: T.compareTitle })
  o.blocks.push({ kind: "line", parts: [{ text: T.lineBetween }, ...keyParts(c, ref, `${base}a`, arr(a.key).length), { text: T.lineAnd }, ...keyParts(c, ref, `${base}b`, arr(b.key).length)] })
  const rows: { label: string; tag: string | null; cells: WireCell[] }[] = []
  const deltas = arr(v.deltas)
  for (let i = 0; i < deltas.length; i++) {
    const d = isRecord(deltas[i]) ? deltas[i] as Record<string, unknown> : {}
    if (!["a", "b", "delta"].every((f) => c.has(ref, `${base}deltas[${i}].${f}`))) { if (c.cut) { o.cutHere = true; break } throw new Fail() }
    rows.push({ label: label(d.metricId), tag: null, cells: ["a", "b", "delta"].map((f) => c.cell(ref, `${base}deltas[${i}].${f}`)) })
  }
  if (rows.length === 0) throw new Fail()
  o.blocks.push({ kind: "table", caption: null, columns: [{ label: T.colA, help: null }, { label: T.colB, help: null }, { label: T.colDelta, help: null }], rows })
}
const BUILDERS: Readonly<Record<string, (c: Ctx, ref: string, v: Record<string, unknown>, o: Out) => void>> = {
  "metrics.query@1": QUERY, "metrics.groups@1": GROUPS, "rank.groups@1": RANK, "exit.breakdown@1": EXITS, "metrics.compare@1": COMPARE(""),
  "exit.analysis@1": (c, ref, v, o) => { EXITS(c, ref, v, o); if (isRecord(v.comparison)) COMPARE("comparison.")(c, ref, v.comparison, o) },
}

/** Layout da resposta (blocos na ordem dos refs) ou `null` se qualquer coisa não bater (a tela mostra o texto corrido). */
export function buildLayout(input: unknown, rendered: unknown): WireLayout | null {
  try {
    if (!isRecord(input) || !isRecord(input.ledger) || !Array.isArray(input.refs) || input.refs.length === 0) return null
    const c = new Ctx(rendered)
    const o: Out = { blocks: [], cutHere: false }
    let usesTrade = false
    for (const [n, ref] of [...new Set(input.refs)].entries()) {
      if (typeof ref !== "string") return null
      const e = lookupRef(input.ledger as never, ref)
      if (e === null) return null
      const v = e.handle.verdict
      // evidência adulterada/ilegível: o texto corrido só tem a frase de integridade (sem números) ⇒ sem layout
      if (v.combined === C.TAMPERED_OR_MISMATCH || (v.combined === C.NOT_VERIFIED && v.verify.status !== "VALID")) return null
      const build = BUILDERS[e.capability]
      if (build === undefined || !isRecord(e.view)) return null
      if (n > 0 && c.omit && ![...c.values.keys()].some((k) => k.startsWith(`${ref}\u0000`))) { o.blocks.push({ kind: "note", text: OMIT_TEXT, tone: "caveat" }); break }
      o.cutHere = false
      build(c, ref, e.view, o)
      if (o.cutHere) o.blocks.push({ kind: "note", text: CUT_TEXT, tone: "caveat" })
      if (e.capability !== "exit.breakdown@1" && e.capability !== "exit.analysis@1") usesTrade = true
    }
    if (usesTrade) o.blocks.push({ kind: "note", text: T.noteTrade, tone: "info" })
    return o.blocks.length === 0 ? null : deepFreeze({ blocks: o.blocks })
  } catch {
    return null
  }
}
