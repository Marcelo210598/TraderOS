// E7-20 — layout estruturado (cartões e tabelas) derivado no SERVIDOR a partir do ledger + do `rendered`: cada célula = o `text`/veredito do RenderedSegment de mesmo (ref, path).
// Expectativa escrita ANTES do código: docs/ai-partner/E7-20-expectativa.md (D-Y1…D-Y10; Y1–Y8). Fixtures reaproveitadas do test-answer-composer.mts.
//   node scripts/test-answer-layout.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { composeAnswer, CUT_TEXT, GROUP_TEXT, METRIC_TEXT } from "../src/lib/agent/composer.ts"
import { renderAnswer } from "../src/lib/agent/render.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { validateText } from "../src/lib/agent/validate-text.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const mod: Any = await import("../src/lib/agent/layout.ts").catch(() => null)
const need = (): Any => { assert.ok(mod, "src/lib/agent/layout.ts ainda não existe"); return mod }
const composer: Any = { composeAnswer }

const HEXOF: Record<string, string> = { q: "a", g: "b", x: "c", m: "d", r: "e", y: "f" } // o ref é ev_ + 32 hex: cada fixture usa um dígito hex
const REF = (c: string): string => `ev_${HEXOF[c].repeat(32)}`
const mv = (metricId: string, value: number | null, unit: string, reason: string | null = null): Any => ({ metricId, value, unit, basis: "NET", sampleSize: 24, coverage: { used: 24, total: 24, ratio: 1 }, reason })
const MQ = (o: { nullFirst?: boolean } = {}): Any => ({ metrics: [o.nullFirst ? mv("netPnl", null, "usd", "DENOMINATOR_ZERO") : mv("netPnl", -144, "usd"), mv("winRate", 41.67, "percent")], period: { from: "2026-03-01", to: "2026-03-28" } })
const grp = (i: number): Any => ({ key: [`${i}`], sampleFlag: "OK", sampleSize: 3, metrics: [mv("netPnl", i * 10, "usd")] })
const MG = (n: number): Any => ({ groupBy: ["hour"], groups: Array.from({ length: n }, (_, i) => grp(i + 1)) })
const bucket = (reason: string): Any => ({ reason, unit: "TRADE", count: 8, pnlNet: 25, pnlNetReason: null, share: 0.5, shareReason: null, coverage: { used: 24, total: 24, ratio: 1 } })
const XB = (): Any => ({ buckets: [bucket("TARGET"), bucket("STOP")], reconciliation: "RECONCILED" })
const CMP = (conclusive: boolean): Any => ({ a: { key: ["Sim101"], sampleSize: 12 }, b: { key: ["Sim102"], sampleSize: 12 }, deltas: [{ metricId: "netPnl", unit: "usd", a: 10, aReason: null, b: -5, bReason: null, delta: 15, ratio: null, reason: "RATIO_UNDEFINED" }], conclusive })
const RK = (): Any => ({ orderedBy: "netPnl DESC", rows: [{ rank: 1, key: ["Conta A"], value: mv("netPnl", 90, "usd"), sampleFlag: "OK", tiedWithPrevious: false, contribution: 0.6, contributionReason: null }, { rank: null, key: ["Conta B"], value: mv("netPnl", 5, "usd"), sampleFlag: "TINY", tiedWithPrevious: false, contribution: null, contributionReason: "UNAVAILABLE_SAMPLE" }] })
const XA = (): Any => ({ buckets: [bucket("TARGET"), bucket("MANUAL")], comparison: null, reconciliation: "RECONCILED" })

interface H { verify?: string; source?: string; vcodes?: string[]; scodes?: string[]; flag?: string; conclusive?: boolean }
const entry = (c: string, capability: string, view: Any, o: H = {}): Any => ({
  capability,
  handle: { evidenceRef: REF(c), evidenceHash: HEXOF[c].repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: 24, verifiability: "FULL", sampleFlag: o.flag ?? "OK", conclusive: o.conclusive ?? true }, refEpoch: "s1", freshness: "CURRENT",
    verdict: buildVerdict({ status: (o.verify ?? "VALID") as never, codes: o.vcodes ?? [] }, { status: (o.source ?? "SOURCE_VERIFIED") as never, codes: o.scodes ?? [] }) },
  view,
})
const ledgerOf = (entries: Any[]): Any => { let l: Any = (newLedger("s1") as Any).ledger; for (const e of entries) { const r: Any = addEvidence(l, e); assert.equal(r.ok, true, `fixture ${e.handle.evidenceRef.slice(3, 5)}: ${JSON.stringify(r)}`); l = r.ledger } return l }

const answerOf = (ledger: Any, refs: string[]): Any => { const r = composer.composeAnswer({ ledger, refs }); assert.equal(r.ok, true, `compôs? ${JSON.stringify(r)}`); return r.answer }
const render = (ledger: Any, answer: Any): Any => {
  const v: Any = validateAnswer({ answer, ledger, stop: null, question: "Qual foi meu resultado?" }); assert.equal(v.ok, true, `validateAnswer: ${JSON.stringify(v)}`)
  const r: Any = renderAnswer({ answer, ledger, notices: [], stop: null, question: "Qual foi meu resultado?" }); assert.equal(r.ok, true); return r.rendered
}
/** ledger + resposta composta + renderizada + o layout pedido ao módulo. */
const run = (entries: Any[], refs: string[]): { ledger: Any; rendered: Any; layout: Any } => {
  const ledger = ledgerOf(entries); const rendered = render(ledger, answerOf(ledger, refs))
  return { ledger, rendered, layout: need().buildLayout({ ledger, refs }, rendered) }
}
const valueAt = (rendered: Any, ref: string, path: string): Any => { const v = rendered.segments.find((s: Any) => s.kind === "value" && s.ref === ref && s.path === path); assert.ok(v, `sem valor renderizado em ${ref.slice(0, 6)} ${path}`); return v }
const blocks = (layout: Any, kind: string): Any[] => layout.blocks.filter((b: Any) => b.kind === kind)
const cellOk = (c: Any, rendered: Any, ref: string, path: string): void => { const v = valueAt(rendered, ref, path); assert.equal(c.text, c.note === null ? v.text : "—", `${path}: texto da célula`); assert.equal(c.combined, v.combined, `${path}: veredito`) }
const REFQ = REF("q"), REFG = REF("g"), REFX = REF("x"), REFM = REF("m"), REFR = REF("r"), REFY = REF("y")

await test("Y1a — metrics.query ⇒ título + cartões (rótulo do servidor, valor = o do texto corrido, ajuda de METRIC_HELP) + linha de período com as duas datas renderizadas", () => {
  const m = need(); const { rendered, layout } = run([entry("q", "metrics.query@1", MQ())], [REFQ])
  assert.ok(layout, "sem layout"); assert.equal(layout.blocks[0].kind, "title"); assert.ok(layout.blocks[0].text.length > 0)
  const stats = blocks(layout, "stats")[0]; assert.equal(stats.items.length, 2)
  ;["netPnl", "winRate"].forEach((id, i) => { assert.equal(stats.items[i].label, METRIC_TEXT[id]); assert.equal(stats.items[i].help, m.METRIC_HELP[id] ?? null); cellOk(stats.items[i].cell, rendered, REFQ, `metrics[${i}].value`) })
  assert.ok(layout.blocks.some((b: Any) => b.kind === "note" && b.tone === "info" && /posição do início ao fim/.test(b.text)), "nota explicando o que é um trade")
  const line = blocks(layout, "line").find((l: Any) => l.parts.some((p: Any) => p.cell)); assert.ok(line, "sem linha de período")
  const cells = line.parts.filter((p: Any) => p.cell).map((p: Any) => p.cell); assert.equal(cells.length, 2); cellOk(cells[0], rendered, REFQ, "period.from"); cellOk(cells[1], rendered, REFQ, "period.to")
})

await test("Y1b — metrics.groups ⇒ tabela: linhas = grupos (rótulo = chave renderizada), colunas = métricas, etiqueta de amostra do sampleFlag renderizado, células = valores renderizados", () => {
  const { rendered, layout } = run([entry("g", "metrics.groups@1", MG(3))], [REFG])
  const t = blocks(layout, "table")[0]; assert.ok(t); assert.deepEqual(t.columns.map((c: Any) => c.label), [METRIC_TEXT.netPnl]); assert.equal(t.rows.length, 3)
  assert.match(blocks(layout, "title")[0].text, new RegExp(GROUP_TEXT.hour))
  t.rows.forEach((r: Any, i: number) => { assert.equal(r.label, valueAt(rendered, REFG, `groups[${i}].key[0]`).text); assert.equal(r.tag, null, "amostra adequada não ganha etiqueta (ruído)"); assert.equal(r.cells.length, 1); cellOk(r.cells[0], rendered, REFG, `groups[${i}].metrics[0].value`) })
})

await test("Y1b2 — etiqueta de amostra só quando NÃO é adequada: sampleFlag LOW ⇒ tag = texto renderizado do sampleFlag", () => {
  const view = MG(2); view.groups[1].sampleFlag = "LOW"
  const { rendered, layout } = run([entry("g", "metrics.groups@1", view)], [REFG]); const t = blocks(layout, "table")[0]
  assert.equal(t.rows[0].tag, null); assert.equal(t.rows[1].tag, valueAt(rendered, REFG, "groups[1].sampleFlag").text); assert.ok(t.rows[1].tag.length > 0)
})

await test("Y1b3 — groups com 2 métricas: cada coluna recebe o valor da SUA métrica (colunas na ordem do motor)", () => {
  const view = { groupBy: ["hour"], groups: [1, 2].map((i) => ({ key: [`${i}`], sampleFlag: "OK", sampleSize: 3, metrics: [mv("netPnl", i * 10, "usd"), mv("winRate", 40 + i, "percent")] })) }
  const { rendered, layout } = run([entry("g", "metrics.groups@1", view)], [REFG]); const t = blocks(layout, "table")[0]
  assert.deepEqual(t.columns.map((c: Any) => c.label), [METRIC_TEXT.netPnl, METRIC_TEXT.winRate])
  t.rows.forEach((r: Any, i: number) => { cellOk(r.cells[0], rendered, REFG, `groups[${i}].metrics[0].value`); cellOk(r.cells[1], rendered, REFG, `groups[${i}].metrics[1].value`); assert.notEqual(r.cells[0].text, r.cells[1].text) })
})

await test("Y1c — rank.groups ⇒ tabela com posição e valor; linha 'fora do ranking' tem célula de posição '—' com motivo (sem inventar posição)", () => {
  const { rendered, layout } = run([entry("r", "rank.groups@1", RK())], [REFR])
  const t = blocks(layout, "table")[0]; assert.ok(t); assert.equal(t.columns.length, 2); assert.equal(t.rows.length, 2)
  cellOk(t.rows[0].cells[0], rendered, REFR, "rows[0].rank"); cellOk(t.rows[0].cells[1], rendered, REFR, "rows[0].value.value"); assert.equal(t.rows[0].label, valueAt(rendered, REFR, "rows[0].key[0]").text)
  assert.equal(t.rows[1].cells[0].text, "—"); assert.match(t.rows[1].cells[0].note, /ranking/i); cellOk(t.rows[1].cells[1], rendered, REFR, "rows[1].value.value")
})

await test("Y1d — exit.breakdown ⇒ UMA tabela por unidade (perna/trade) agrupando as faixas pela unit bruta; linhas = motivo renderizado; células = contagem/resultado/participação renderizados; linha de conciliação", () => {
  const view = { buckets: [{ ...XB().buckets[0], unit: "LEG", count: 6 }, { ...XB().buckets[1], unit: "LEG", count: 5 }, XB().buckets[0], XB().buckets[1]], reconciliation: "RECONCILED" }
  const { rendered, layout } = run([entry("x", "exit.breakdown@1", view)], [REFX])
  const ts = blocks(layout, "table"); assert.equal(ts.length, 2, "uma por unidade"); assert.notEqual(ts[0].caption, ts[1].caption); assert.ok(ts.every((t: Any) => t.caption !== null && t.rows.length === 2))
  ;[[0, 0], [0, 1], [1, 2], [1, 3]].forEach(([ti, bi]) => { const r = ts[ti].rows[bi % 2]; assert.equal(r.label, valueAt(rendered, REFX, `buckets[${bi}].reason`).text); ;["count", "pnlNet", "share"].forEach((f, k) => cellOk(r.cells[k], rendered, REFX, `buckets[${bi}].${f}`)) })
  const rec = blocks(layout, "line").find((l: Any) => l.parts.some((p: Any) => p.cell)); assert.ok(rec); cellOk(rec.parts.find((p: Any) => p.cell).cell, rendered, REFX, "reconciliation")
})

await test("Y1e — metrics.compare ⇒ tabela (linha = métrica; colunas primeiro/segundo/diferença) + linha 'Entre X e Y' com as chaves renderizadas", () => {
  const { rendered, layout } = run([entry("m", "metrics.compare@1", CMP(true))], [REFM])
  const t = blocks(layout, "table")[0]; assert.ok(t); assert.equal(t.columns.length, 3); assert.equal(t.rows[0].label, METRIC_TEXT.netPnl)
  ;["a", "b", "delta"].forEach((f, k) => cellOk(t.rows[0].cells[k], rendered, REFM, `deltas[0].${f}`))
  const line = blocks(layout, "line").find((l: Any) => l.parts.filter((p: Any) => p.cell).length === 2); assert.ok(line, "linha das duas chaves")
  const [ka, kb] = line.parts.filter((p: Any) => p.cell).map((p: Any) => p.cell); cellOk(ka, rendered, REFM, "a.key[0]"); cellOk(kb, rendered, REFM, "b.key[0]")
})

await test("Y1f — exit.analysis ⇒ as tabelas de saída (sem comparação quando a análise não traz)", () => {
  const { rendered, layout } = run([entry("y", "exit.analysis@1", XA())], [REFY])
  const t = blocks(layout, "table")[0]; assert.ok(t); assert.equal(t.rows.length, 2); cellOk(t.rows[0].cells[0], rendered, REFY, "buckets[0].count")
  assert.ok(!layout.blocks.some((b: Any) => b.kind === "note" && /posição do início ao fim/.test(b.text)), "análise só de saídas não repete a nota de trade")
})

await test("Y2 — fidelidade: com 40 grupos o layout mostra SÓ as linhas do texto corrido (COMPOSER_MAX_ROWS) + a frase de corte; nenhuma linha com célula faltando", () => {
  const { rendered, layout } = run([entry("g", "metrics.groups@1", MG(40))], [REFG])
  const t = blocks(layout, "table")[0]; const shown = new Set(rendered.segments.filter((s: Any) => s.kind === "value" && /groups\[\d+\]\.key\[0\]/.test(s.path)).map((s: Any) => s.path))
  assert.equal(t.rows.length, shown.size); assert.ok(shown.size < 40 && shown.size > 0)
  assert.ok(layout.blocks.some((b: Any) => b.kind === "note" && b.text === CUT_TEXT), "frase de corte")
  const small = run([entry("g", "metrics.groups@1", MG(3))], [REFG]).layout; assert.ok(!small.blocks.some((b: Any) => b.kind === "note" && b.text === CUT_TEXT), "sem corte, sem a frase")
})

await test("Y3 — falha segura: valor ausente no rendered, capacidade desconhecida, entradas malformadas/congeladas ⇒ null, sem lançar", () => {
  const m = need(); const ledger = ledgerOf([entry("q", "metrics.query@1", MQ())]); const rendered = render(ledger, answerOf(ledger, [REFQ]))
  const without = { ...rendered, segments: rendered.segments.filter((s: Any) => !(s.kind === "value" && s.path === "metrics[1].value")) }
  assert.equal(m.buildLayout({ ledger, refs: [REFQ] }, without), null, "célula faltando ⇒ null")
  for (const bad of [null, undefined, 5, "x", [], {}, { ledger: null, refs: [] }, { ledger, refs: [] }, { ledger, refs: ["ev_" + "0".repeat(32)] }, { ledger, refs: [5] }]) assert.equal(m.buildLayout(bad, rendered), null, JSON.stringify(bad)?.slice(0, 40))
  for (const badR of [null, {}, { segments: 5 }, { segments: [null] }]) assert.equal(m.buildLayout({ ledger, refs: [REFQ] }, badR), null)
  const frozen = JSON.parse(JSON.stringify(rendered)); const fl = m.buildLayout({ ledger, refs: [REFQ] }, (function f(x: Any): Any { if (x && typeof x === "object") { Object.values(x).forEach(f); Object.freeze(x) } return x })(frozen))
  assert.ok(fl && Object.isFrozen(fl), "entrada congelada ok, saída congelada"); assert.deepEqual(JSON.parse(JSON.stringify(m.buildLayout({ ledger, refs: [REFQ] }, rendered))), JSON.parse(JSON.stringify(fl)), "determinístico")
})

await test("Y3b — linha incompleta SEM a frase de corte no texto corrido é inconsistência (⇒ null), em groups, rank e saídas; com a frase de corte é só corte", () => {
  const m = need()
  for (const [c, cap, view, path] of [["g", "metrics.groups@1", MG(3), "groups[1].metrics[0].value"], ["r", "rank.groups@1", RK(), "rows[1].value.value"], ["x", "exit.breakdown@1", XB(), "buckets[1].pnlNet"]] as Any[]) {
    const ledger = ledgerOf([entry(c, cap, view)]); const ref = REF(c); const rendered = render(ledger, answerOf(ledger, [ref]))
    assert.ok(m.buildLayout({ ledger, refs: [ref] }, rendered), `${cap}: base válida`)
    const cut = { ...rendered, segments: rendered.segments.filter((s: Any) => !(s.kind === "value" && s.path === path)) }
    assert.equal(m.buildLayout({ ledger, refs: [ref] }, cut), null, `${cap}: faltou ${path} sem frase de corte`)
    const withCut = { ...cut, segments: [...cut.segments, { kind: "text", text: CUT_TEXT }] }; const l = m.buildLayout({ ledger, refs: [ref] }, withCut); assert.ok(l, `${cap}: com a frase de corte é só corte`); assert.ok(l.blocks.some((b: Any) => b.kind === "note" && b.text === CUT_TEXT))
  }
})

await test("Y4 — integridade: evidência adulterada/ilegível (só frase de integridade) ⇒ null; NOT_VERIFIED válido e parcial ⇒ células com o veredito do contrato; vários refs ⇒ blocos de todos, na ordem", () => {
  const tampered = run([entry("q", "metrics.query@1", MQ(), { verify: "TAMPERED", vcodes: ["V_SEAL_MISMATCH"] })], [REFQ]); assert.equal(tampered.layout, null)
  const nv = run([entry("q", "metrics.query@1", MQ(), { source: "UNVERIFIABLE", scodes: ["S_SOURCE_NOT_PROVIDED"] })], [REFQ]); assert.ok(nv.layout)
  for (const b of blocks(nv.layout, "stats")) for (const it of b.items) assert.equal(it.cell.combined, valueAt(nv.rendered, REFQ, "metrics[0].value").combined)
  const part = run([entry("q", "metrics.query@1", MQ(), { source: "SOURCE_VERIFIED_PARTIAL", scodes: ["S_POPULATION_PARTIAL"] })], [REFQ]); assert.equal(blocks(part.layout, "stats")[0].items[0].cell.combined, "VERIFIED_PARTIAL")
  const two = run([entry("q", "metrics.query@1", MQ()), entry("g", "metrics.groups@1", MG(2))], [REFQ, REFG]); assert.ok(two.layout)
  const kinds = two.layout.blocks.map((b: Any) => b.kind); assert.ok(kinds.indexOf("stats") < kinds.indexOf("table"), "ordem dos refs")
})

await test("Y5 — texto fixo: todo título/legenda/coluna/nota e toda ajuda passam em validateText, sem dígito; METRIC_HELP só tem métricas do catálogo; guarda de completude dos textos do layout", () => {
  const m = need(); const all: string[] = [...m.LAYOUT_STATIC_TEXTS, ...Object.values(m.METRIC_HELP) as string[]]
  assert.ok(all.length >= 12 && all.every((t) => typeof t === "string" && t.length > 0))
  const ledger = (newLedger("s1") as Any).ledger
  for (const t of all) { assert.doesNotMatch(t, /\p{Nd}/u, `dígito em "${t}"`); const r: Any = validateText({ answer: { segments: [{ kind: "text", text: t }], claims: [] }, ledger }); assert.equal(r.ok, true, `validateText recusou "${t}": ${JSON.stringify(r)}`) }
  for (const id of Object.keys(m.METRIC_HELP)) assert.ok(Object.hasOwn(METRIC_TEXT, id), `METRIC_HELP.${id} fora do catálogo`)
  for (const id of ["netPnl", "winRate", "profitFactor", "maxDrawdown", "averageTrade"]) assert.ok(m.METRIC_HELP[id], `sem ajuda de ${id}`)
  const { layout } = run([entry("q", "metrics.query@1", MQ()), entry("g", "metrics.groups@1", MG(2)), entry("x", "exit.breakdown@1", XB()), entry("m", "metrics.compare@1", CMP(true)), entry("r", "rank.groups@1", RK())], [REFQ, REFG, REFX, REFM, REFR])
  const used: string[] = []; for (const b of layout.blocks) { if (b.kind === "title" || b.kind === "note") used.push(b.text); if (b.kind === "table" && b.caption) used.push(b.caption); if (b.kind === "table") b.columns.forEach((c: Any) => used.push(c.label)); if (b.kind === "line") b.parts.forEach((p: Any) => p.text !== undefined && used.push(p.text)) }
  const dynamic = new Set<string>([...Object.values(METRIC_TEXT), ...Object.values(GROUP_TEXT), CUT_TEXT])
  for (const t of used) assert.ok(dynamic.has(t) || m.LAYOUT_STATIC_TEXTS.some((s: string) => t === s || t.includes(s) || s.includes(t)) || /^Por /.test(t), `texto do layout fora da lista fixa: "${t}"`)
})

await test("Y6 — valor indisponível: 'indisponível (motivo)' do formatador ⇒ célula '—' com o motivo em `note`; valor normal ⇒ note null", () => {
  const { rendered, layout } = run([entry("q", "metrics.query@1", MQ({ nullFirst: true }))], [REFQ])
  const it = blocks(layout, "stats")[0].items[0]; const v = valueAt(rendered, REFQ, "metrics[0].value"); assert.match(v.text, /^indisponível \(/)
  assert.equal(it.cell.text, "—"); assert.equal(it.cell.note, v.text.replace(/^indisponível \((.*)\)$/, "$1")); assert.equal(blocks(layout, "stats")[0].items[1].cell.note, null)
})

if (process.env.COLLECT) console.log(JSON.stringify({ passed, failed }))
else console.log(`\n${passed} testes ✓`)
