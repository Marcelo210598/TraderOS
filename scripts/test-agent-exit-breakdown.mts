// E6.6-7: capacidade `exit.breakdown@1` (src/lib/agent-capabilities/exit-breakdown.ts + projectExitBreakdown/mapReconciliation em project.ts). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_7 (args, flow, view_mapping, casos X1–X12, decisões D7-1..D7-5).
// ORÁCULO: exitReasonAnalysis (E6.2) chamado DIRETO; o mapeamento esperado das linhas é escrito AQUI, a partir do resultado direto, sem passar pela capacidade.
//   node scripts/test-agent-exit-breakdown.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { formatNumber, formatUnavailable } from "../src/lib/agent/format.ts"
import { addEvidence, newLedger } from "../src/lib/agent/ledger.ts"
import { renderSlot } from "../src/lib/agent/slot-path.ts"
import { renderAnswer } from "../src/lib/agent/render.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { mapReconciliation, projectExitBreakdown } from "../src/lib/agent-capabilities/project.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { exitReasonAnalysis, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const enc = (s: string) => new TextEncoder().encode(s)

const BRT = "America/Sao_Paulo"
const AN = { timeZone: BRT, minSample: 4 } as const
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const CSV = synthCsv(CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any))))
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "segredo-saidas.csv" })
const rec = imp.importRecord as ImportRecord
const T = toAnalyticsTrades(withRisk(imp.trades))
const FILES = { [rec.importId]: enc(CSV) }
const ctx = (o: Any = {}): Any => ({ trades: T, importRecords: [rec], refEpoch: "s1", analysis: AN, ...o })
const run = (args: unknown, c: Any = ctx()): Any => exitBreakdown(args, c)
const call = (args: unknown, c: Any = ctx()): Any => run(args, c).result
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 300)}`); return r }
const ERR = (code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability: "exit.breakdown@1", ok: false, data: null, evidence: null, limits: [], error: { code } })
const ARGS = ERR("ARGS_INVALID"), REFUSED = ERR("ENGINE_REFUSED")

// ── oráculo: o mapeamento esperado, escrito aqui a partir do resultado DIRETO ─
const direct = (filters: Any = {}, opts: Any = {}): Any => exitReasonAnalysis(T, { filters, ...AN, ...opts } as Any)
const cov = (c: Any): Any => ({ used: c.used, total: c.total, ratio: c.ratio === null ? 0 : c.ratio })
const expectedBuckets = (d: Any): Any[] => [
  ...d.legs.rows.map((r: Any) => ({ reason: r.reason, unit: "LEG", count: r.legs, pnlNet: r.net.value, pnlNetReason: r.net.reason, share: r.contributionToLegNet.value, shareReason: r.contributionToLegNet.reason, coverage: cov(r.net.coverage) })),
  ...d.trades.rows.map((r: Any) => ({ reason: r.bucket, unit: "TRADE", count: r.trades, pnlNet: r.net.value, pnlNetReason: r.net.reason, share: r.contributionToTotalNet.value, shareReason: r.contributionToTotalNet.reason, coverage: cov(r.net.coverage) })),
]
const txtOf = (value: number | null, unit: "usd" | "fraction" | "count", reason: string | null): string => { if (value === null) return (formatUnavailable(reason) as Any).text; const r = formatNumber(value, unit); assert.equal(r.ok, true, `formatador recusou ${value}`); return (r as Any).text }
const slot = (data: Any, path: string): Any => renderSlot("exit.breakdown@1", data, path)

test("X1 — ORÁCULO: nº e ORDEM das linhas (4 de perna + 5 de trade), contagens, pnlNet, share, motivos e coverage == exitReasonAnalysis DIRETO; texto de cada slot == formatador sobre o valor direto; a linha UNKNOWN vazia sai 'indisponível (…)'", () => {
  const d = direct()
  const r = okOf(call({}))
  assert.deepEqual(r.data.buckets, expectedBuckets(d))
  assert.equal(r.data.buckets.length, 9)
  r.data.buckets.forEach((b: Any, i: number) => {
    assert.deepEqual(slot(r.data, `buckets[${i}].pnlNet`), { ok: true, text: txtOf(b.pnlNet, "usd", b.pnlNetReason) }, `buckets[${i}] pnlNet`)
    assert.deepEqual(slot(r.data, `buckets[${i}].share`), { ok: true, text: txtOf(b.share, "fraction", b.shareReason) }, `buckets[${i}] share`)
    assert.deepEqual(slot(r.data, `buckets[${i}].count`), { ok: true, text: (formatNumber(b.count, "count") as Any).text }, `buckets[${i}] count`)
  })
  const legUnknown = r.data.buckets.find((b: Any) => b.unit === "LEG" && b.reason === "UNKNOWN")
  const tradeUnknown = r.data.buckets.find((b: Any) => b.unit === "TRADE" && b.reason === "UNKNOWN")
  assert.equal(legUnknown.count, 0)
  assert.equal(slot(r.data, `buckets[${r.data.buckets.indexOf(legUnknown)}].pnlNet`).text, "indisponível (não há ordens registradas)")
  assert.equal(slot(r.data, `buckets[${r.data.buckets.indexOf(tradeUnknown)}].pnlNet`).text, "indisponível (não há trades)")
  assert.equal(slot(r.data, "buckets[0].reason").text, { TARGET: "alvo", STOP: "stop", MANUAL: "manual", UNKNOWN: "desconhecido", MIXED: "misto" }[d.legs.rows[0].reason as string])
  assert.deepEqual(slot(r.data, "reconciliation"), { ok: true, text: "conciliado" })
  assert.equal(r.data.reconciliation, "RECONCILED")
})

test("X2 — UNIDADES: LEG antes de TRADE; nenhuma linha mistura unidade; Σ count das linhas LEG == total de pernas do motor; Σ count das linhas TRADE == afterFilters; a mesma 'reason' nas duas unidades NUNCA é somada", () => {
  const d = direct()
  const r = okOf(call({}))
  const units: string[] = r.data.buckets.map((b: Any) => b.unit)
  assert.deepEqual(units, [...units].sort((a, b) => (a === b ? 0 : a === "LEG" ? -1 : 1)), "LEG antes de TRADE")
  assert.deepEqual(new Set(units), new Set(["LEG", "TRADE"]))
  const sum = (u: string) => r.data.buckets.filter((b: Any) => b.unit === u).reduce((n: number, b: Any) => n + b.count, 0)
  assert.equal(sum("LEG"), d.legs.total.legs)
  assert.equal(sum("TRADE"), d.population.afterFilters)
  assert.notEqual(sum("LEG"), sum("TRADE"), "pernas ≠ trades nesta amostra (há ciclos de várias pernas)")
  const target = r.data.buckets.filter((b: Any) => b.reason === "TARGET")
  assert.deepEqual(target.map((b: Any) => b.unit), ["LEG", "TRADE"])
  assert.notEqual(target[0].count, target[1].count)
  for (const b of r.data.buckets) assert.deepEqual(Object.keys(b).sort(), ["count", "coverage", "pnlNet", "pnlNetReason", "reason", "share", "shareReason", "unit"])
})

test("X3 — filtros e base: exitReason/hour/from-to ⇒ == direto com os mesmos filtros; pnlBasis GROSS ⇒ == direto GROSS; from > to ⇒ ARGS_INVALID", () => {
  for (const filters of [{ exitReason: "STOP" }, { hour: 9 }, { from: "2026-03-05", to: "2026-03-09" }, { direction: "LONG" }]) {
    const r = call({ filters })
    if (!r.ok) assert.fail(`filtro ${JSON.stringify(filters)} deveria ser aceito: ${JSON.stringify(r.error)}`)
    assert.deepEqual(r.data.buckets, expectedBuckets(direct(filters)), JSON.stringify(filters))
    assert.equal(r.evidence.population.declared, direct(filters).population.afterFilters)
  }
  const net = okOf(call({ options: { pnlBasis: "NET" } })), gross = okOf(call({ options: { pnlBasis: "GROSS" } }))
  assert.deepEqual(gross.data.buckets, expectedBuckets(direct({}, { pnlBasis: "GROSS" })))
  assert.deepEqual(net.data.buckets, expectedBuckets(direct({}, { pnlBasis: "NET" })))
  assert.deepEqual(call({ filters: { from: "2026-03-09", to: "2026-03-02" } }), ARGS)
  // as opções ficam REGISTRADAS no bundle: base diferente ⇒ evidenceRef diferente (e a mesma base explícita == o padrão NET)
  assert.notEqual(net.evidence.evidenceRef, gross.evidence.evidenceRef)
  assert.equal(net.evidence.evidenceRef, okOf(call({})).evidence.evidenceRef)
  // o fuso do USUÁRIO (ctx) chega ao motor: hora 9 em Brasília ≠ hora 9 em Nova York
  const NY = "America/New_York"
  const brt = okOf(call({ filters: { hour: 9 } }, ctx({ analysis: { timeZone: BRT, minSample: 4 } }))), ny = okOf(call({ filters: { hour: 9 } }, ctx({ analysis: { timeZone: NY, minSample: 4 } })))
  assert.deepEqual(brt.data.buckets, expectedBuckets(direct({ hour: 9 })))
  assert.deepEqual(ny.data.buckets, expectedBuckets(exitReasonAnalysis(T, { filters: { hour: 9 }, timeZone: NY, minSample: 4 } as Any)))
  assert.notEqual(brt.evidence.population.declared, ny.evidence.population.declared, "o fuso precisa mudar a população nesta amostra")
})

test("X4 — HANDLE: DERIVED, scope TOTAL, declared = afterFilters, confidence do summary, sampleFlag = o PIOR das linhas com contagem > 0; verify VALID; sem arquivo NOT_VERIFIED + estrutural; COM arquivo (E5b real de derivado) VERIFIED; arquivo adulterado ⇒ TAMPERED_OR_MISMATCH", () => {
  const d = direct()
  const r = okOf(call({}))
  assert.equal(r.evidence.subject.type, "DERIVED")
  assert.equal(r.evidence.scope, "TOTAL")
  assert.equal(r.evidence.population.declared, d.population.afterFilters)
  assert.equal(r.evidence.population.confidence, "UNRELIABLE")
  const flags = [...d.legs.rows.filter((x: Any) => x.legs > 0).map((x: Any) => x.sampleFlag), ...d.trades.rows.filter((x: Any) => x.trades > 0).map((x: Any) => x.sampleFlag)]
  const worst = (["OK", "LOW", "TINY"] as const)[Math.max(...flags.map((f: string) => ["OK", "LOW", "TINY"].indexOf(f)))]
  assert.equal(r.evidence.population.sampleFlag, worst)
  assert.equal(worst, "TINY")
  assert.equal(r.evidence.verdict.verify.status, "VALID")
  assert.equal(r.evidence.verdict.combined, "NOT_VERIFIED")
  assert.deepEqual(r.limits.map((l: Any) => l.code), ["VERIFICATION_INFRA_MISSING"])
  const good = okOf(call({}, ctx({ source: { files: FILES } })))
  assert.equal(good.evidence.verdict.combined, "VERIFIED")
  assert.deepEqual(good.limits, [])
  const bad = okOf(call({}, ctx({ source: { files: { [rec.importId]: enc(CSV.replace("2004", "2005")) } } })))
  assert.equal(bad.evidence.verdict.combined, "TAMPERED_OR_MISMATCH")
})

test("X5 — mapReconciliation (D7-1), função pura sobre as 4 entradas do motor: FULL ⇒ RECONCILED, DIVERGENT ⇒ DIVERGENT, PARTIAL e NO_LEGS ⇒ NOT_COMPARABLE; qualquer outra ⇒ null", () => {
  assert.equal(mapReconciliation("FULL"), "RECONCILED")
  assert.equal(mapReconciliation("DIVERGENT"), "DIVERGENT")
  assert.equal(mapReconciliation("PARTIAL"), "NOT_COMPARABLE")
  assert.equal(mapReconciliation("NO_LEGS"), "NOT_COMPARABLE")
  for (const bad of ["OK", "full", "", null, undefined, 5, {}, "__proto__", "constructor"]) assert.equal(mapReconciliation(bad as never), null, String(bad))
})

test("X5b — reconciliação ponta a ponta: trades SEM pernas (importação sem reconstrução de ciclos) ⇒ o status do motor (≠ FULL) vira 'não comparável' na view e a palavra sai no slot; a reconciliação FULL continua 'conciliado'", () => {
  const flat = runImportPipeline(CSV, { sourceTz: BRT, fileName: "plano.csv", reconstructCycles: false } as Any)
  const fT = toAnalyticsTrades(withRisk(flat.trades))
  const d: Any = exitReasonAnalysis(fT, { ...AN } as Any)
  assert.notEqual(d.reconciliation.status, "FULL", "premissa: trades sem pernas não conciliam")
  const r = okOf(call({}, ctx({ trades: fT, importRecords: [flat.importRecord as ImportRecord] })))
  assert.equal(r.data.reconciliation, mapReconciliation(d.reconciliation.status))
  assert.equal(r.data.reconciliation, "NOT_COMPARABLE")
  assert.deepEqual(slot(r.data, "reconciliation"), { ok: true, text: "não comparável" })
  assert.equal(okOf(call({})).data.reconciliation, "RECONCILED")
})

test("X6 — PRIVACIDADE: o envelope serializado NÃO contém nome de conta, rótulos de ordem (Target1, Target2, Stop1, Zerar), legSetHash, hash completo, importId, nome de arquivo nem chave T0; a view só tem a lista branca", () => {
  const r = okOf(call({}))
  const dump = JSON.stringify(r)
  for (const leak of ["Sim101", "Sim102", "Target1", "Target2", "Stop1", "Zerar", "legSetHash", "segredo-saidas", rec.importId, "evidenceHash", "rowHash", "rowNo", "fileSha256", "saltId", "userId", "label", ...T.slice(0, 3).map((t) => t.id)]) assert.equal(dump.includes(leak), false, `vazou: ${leak}`)
  assert.equal(/[0-9a-f]{64}/.test(dump), false)
  assert.deepEqual(Object.keys(r.data).sort(), ["buckets", "reconciliation"])
})

test("X7 — VAZIO: filtro que exclui tudo ⇒ resposta OK (nenhum erro), linhas de contagem 0 com valor indisponível e motivo; declared 0; sem sampleFlag", () => {
  const r = okOf(call({ filters: { from: "2030-01-01" } }))
  assert.equal(r.evidence.population.declared, 0)
  assert.equal("sampleFlag" in r.evidence.population, false)
  assert.ok(r.data.buckets.length >= 1)
  for (const [i, b] of r.data.buckets.entries()) {
    assert.equal(b.count, 0)
    assert.equal(b.pnlNet, null)
    assert.equal(typeof b.pnlNetReason, "string")
    assert.match((slot(r.data, `buckets[${i}].pnlNet`) as Any).text, /^indisponível \(.+\)$/)
  }
  assert.equal(okOf(call({}, ctx({ trades: [] }))).evidence.population.declared, 0)
})

test("X8 — FIM A FIM: ledger → validateAnswer → renderAnswer com slots de motivo de saída, contagem, valor, fração e reconciliação; ASSERT sem arquivo ⇒ MISSING_NOT_VERIFIED_LABEL; amostra TINY exige INDICATIVE_ONLY", () => {
  const out = run({}, ctx({ source: { files: FILES } }))
  const r = okOf(out.result)
  const ref = r.evidence.evidenceRef
  const ledger = (addEvidence((newLedger("s1") as Any).ledger, out.entry) as Any).ledger
  const paths = ["buckets[0].reason", "buckets[0].count", "buckets[0].pnlNet", "buckets[0].share", "reconciliation"]
  const segs = (extra: Any[]) => [{ kind: "text", text: "Saídas:" }, ...paths.map((p) => ({ kind: "slot", ref, path: p })), { kind: "phrase", code: "POPULATION_DECLARED", ref }, ...extra]
  const claims = paths.map((path) => ({ ref, path, mode: "ASSERT" }))
  const noIndicative = { segments: segs([]), claims }
  assert.deepEqual((validateAnswer({ answer: noIndicative, ledger, stop: null, question: "" }) as Any).reasons, ["INCONCLUSIVE_AS_CONCLUSIVE"], "amostra TINY sem a frase de indicativo")
  const answer = { segments: segs([{ kind: "phrase", code: "INDICATIVE_ONLY", ref }]), claims }
  assert.equal(validateAnswer({ answer, ledger, stop: null, question: "" }).ok, true)
  const rendered: Any = renderAnswer({ answer, ledger, notices: [], stop: null, question: "" })
  assert.equal(rendered.ok, true)
  const d = direct(), leg0 = d.legs.rows[0]
  assert.deepEqual(rendered.rendered.segments.filter((s: Any) => s.kind === "value").map((s: Any) => s.text), [{ TARGET: "alvo", STOP: "stop", MANUAL: "manual", UNKNOWN: "desconhecido" }[leg0.reason as string], (formatNumber(leg0.legs, "count") as Any).text, txtOf(leg0.net.value, "usd", leg0.net.reason), txtOf(leg0.contributionToLegNet.value, "fraction", leg0.contributionToLegNet.reason), "conciliado"])
  assert.equal(rendered.rendered.banner.combined, "VERIFIED")
  const no = run({})
  const l2 = (addEvidence((newLedger("s1") as Any).ledger, no.entry) as Any).ledger
  const ref2 = okOf(no.result).evidence.evidenceRef
  const asserted = { segments: [{ kind: "slot", ref: ref2, path: "buckets[0].pnlNet" }], claims: [{ ref: ref2, path: "buckets[0].pnlNet", mode: "ASSERT" }] }
  assert.deepEqual((validateAnswer({ answer: asserted, ledger: l2, stop: null, question: "" }) as Any).reasons, ["MISSING_NOT_VERIFIED_LABEL", "INCONCLUSIVE_AS_CONCLUSIVE"], "os DOIS: sem rótulo de não verificado E amostra TINY sem a frase de indicativo")
})

test("X9 — ARGS_INVALID: metricIds (não existe aqui), filtros de conta/estratégia/setup, campos extras, tipos errados, args que não são objeto; nunca lança; {} = pedido completo válido; undefined = ARGS_INVALID (E6.6-7b: o título dizia o contrário do corpo)", () => {
  const bad: unknown[] = [{ metricIds: ["netPnl"] }, { filters: { account: "Sim101" } }, { filters: { strategyName: "x" } }, { filters: { setup: "x" } }, { filters: { hour: 24 } }, { filters: { from: "x" } }, { filters: null }, { options: { timeZone: "UTC" } }, { options: { pnlBasis: "MELHOR" } }, { extra: 1 }, { filters: {}, extra: 1 }, null, 5, "x", [], [{}]]
  for (const b of bad) { assert.doesNotThrow(() => call(b)); assert.deepEqual(call(b), ARGS, JSON.stringify(b)) }
  assert.equal(call({}).ok, true)
  assert.equal(call({ filters: {}, options: {} }).ok, true)
  assert.equal(exitBreakdown(undefined as never, ctx()).result.ok, false, "undefined não é um objeto de args: o chamador envia {}")
})

test("X9b — E6.6-7b: a EXPECTATIVA do X9 (e66_7.cases) concorda com o teste: undefined ⇒ ARGS_INVALID, e a frase antiga ('{} ou undefined = pedido completo válido') não volta", () => {
  const x9: string = (exp.e66_7.cases as string[]).find((t) => t.startsWith("X9 ")) as string
  assert.ok(x9.includes("`undefined` NÃO é objeto de args ⇒ ARGS_INVALID"), x9)
  assert.equal(x9.includes("({} ou undefined) = pedido completo válido") && !x9.includes("antes dizia"), false, "a frase antiga voltou sem a ressalva")
  assert.equal(x9.replace(/\[texto corrigido[^\]]*\]/, "").includes("undefined) = pedido completo válido"), false, "frase antiga fora da ressalva")
  assert.equal((exitBreakdown(undefined as never, ctx()).result as Any).ok, false)
})

test("X10 — contexto/sal: import SALGADO sem sal ⇒ ENGINE_REFUSED; com sal (e arquivo + sal) ⇒ VERIFIED; trades sem identidade ⇒ ENGINE_REFUSED; ctx hostil ⇒ ENGINE_REFUSED sem lançar; puro (não altera ctx; mesma saída)", () => {
  const SALT = "sal-de-teste-das-saidas-0123456789abcdef"
  const salted = runImportPipeline(CSV, { sourceTz: BRT, fileName: "salgado.csv", accountRefSalt: SALT } as Any)
  const sRec = salted.importRecord as ImportRecord
  const base: Any = { trades: toAnalyticsTrades(withRisk(salted.trades)), importRecords: [sRec], refEpoch: "s1", analysis: AN }
  assert.deepEqual(exitBreakdown({}, base).result, REFUSED)
  assert.equal(okOf(exitBreakdown({}, { ...base, accountRefSalt: SALT }).result).ok, true)
  assert.equal(okOf(exitBreakdown({}, { ...base, accountRefSalt: SALT, source: { files: { [sRec.importId]: enc(CSV) }, options: { accountRefSalt: SALT } } }).result).evidence.verdict.combined, "VERIFIED")
  const noId = T.map((t) => ({ ...t, trade: { ...t.trade, tradeId: null, importId: null } })) as Any
  assert.deepEqual(call({}, ctx({ trades: noId })), REFUSED)
  const hostile: Any = ctx()
  Object.defineProperty(hostile, "trades", { enumerable: true, get() { throw new Error("getter hostil") } })
  for (const c of [hostile, null, undefined, 5, ctx({ importRecords: null }), ctx({ refEpoch: "" }), ctx({ trades: [null] })]) {
    assert.doesNotThrow(() => exitBreakdown({}, c as never))
    const o = exitBreakdown({}, c as never)
    assert.deepEqual(o.result, REFUSED)
    assert.equal(o.entry, null)
  }
  const c = ctx()
  const snap = [JSON.stringify(c.trades), JSON.stringify(c.importRecords)]
  const a = run({ filters: { hour: 9 } }, c), b = run({ filters: { hour: 9 } }, c)
  assert.deepEqual([JSON.stringify(c.trades), JSON.stringify(c.importRecords)], snap)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test("X11 — projectExitBreakdown recusa (null) coverage com ratio null e total > 0, valor null sem motivo, linha sem campo, contagem negativa/fracionária, status de reconciliação desconhecido, motivo de saída fora do enum, resultado que não é objeto; descarta campos extras; nunca lança", () => {
  const good = (): Any => clone(direct())
  const clone = (x: unknown): Any => JSON.parse(JSON.stringify(x))
  assert.notEqual(projectExitBreakdown(good()), null)
  const mut = (fn: (d: Any) => void): unknown => { const d = good(); fn(d); return projectExitBreakdown(d) }
  assert.equal(mut((d) => { d.legs.rows[0].net.coverage = { used: 1, total: 4, ratio: null } }), null)
  assert.equal(mut((d) => { d.legs.rows[0].net.value = null; d.legs.rows[0].net.reason = null }), null)
  assert.equal(mut((d) => { d.trades.rows[0].contributionToTotalNet.value = null; d.trades.rows[0].contributionToTotalNet.reason = null }), null)
  assert.equal(mut((d) => { delete d.legs.rows[0].net }), null)
  assert.equal(mut((d) => { d.legs.rows[0].legs = -1 }), null)
  assert.equal(mut((d) => { d.trades.rows[0].trades = 1.5 }), null)
  assert.equal(mut((d) => { d.reconciliation.status = "OUTRO" }), null)
  assert.equal(mut((d) => { d.legs.rows[0].reason = "REAL" }), null)
  assert.equal(mut((d) => { d.trades.rows[0].bucket = "stop" }), null)
  assert.equal(mut((d) => { d.legs.rows = "x" }), null)
  const extra: Any = good(); extra.legs.rows[0].label = "Target1"; extra.legs.rows[0].legSetHash = "h"; extra.userId = "u"
  assert.equal(JSON.stringify(projectExitBreakdown(extra)).includes("Target1"), false)
  for (const bad of [null, undefined, 5, "x", [], {}]) { assert.doesNotThrow(() => projectExitBreakdown(bad as never)); assert.equal(projectExitBreakdown(bad as never), null) }
  const hostile: Any = good()
  Object.defineProperty(hostile, "legs", { enumerable: true, get() { throw new Error("getter hostil") } })
  assert.equal(projectExitBreakdown(hostile), null)
  const emptyCov: Any = good(); emptyCov.legs.rows[3].net.coverage = { used: 0, total: 0, ratio: null }
  assert.notEqual(projectExitBreakdown(emptyCov), null, "ratio null com total 0 ⇒ 0")
})

test("X12 — a expectativa conhece os 13 casos e as 5 decisões D7", () => {
  assert.equal(exp.e66_7.cases.length, 13)
  assert.deepEqual(Object.keys(exp.e66_7.decisions_D7), ["D7-1", "D7-2", "D7-3", "D7-4", "D7-5"])
})

// ── E6.6-7a (review do Gemini, achados #3, #4, #5): SÓ TESTES. Expectativa: expected.json → e66_7a ──────────────────────────────────────
test("X13 — rBasis chega ao motor: POINTS ⇒ evidenceRef diferente de NET; NET explícito == padrão; combinado com pnlBasis também difere (achado #3: apagar a linha do rBasis deixava a suíte verde)", () => {
  const ref = (options?: Any): string => okOf(call(options === undefined ? {} : { options })).evidence.evidenceRef
  const base = ref(), net = ref({ rBasis: "NET" }), pts = ref({ rBasis: "POINTS" })
  assert.equal(net, base, "NET explícito é o padrão")
  assert.notEqual(pts, net, "rBasis POINTS precisa mudar o evidenceRef")
  assert.notEqual(ref({ rBasis: "POINTS", pnlBasis: "GROSS" }), ref({ pnlBasis: "GROSS" }), "rBasis também conta junto com pnlBasis")
  assert.notEqual(ref({ rBasis: "POINTS", pnlBasis: "GROSS" }), pts, "e pnlBasis também conta junto com rBasis")
})

test("X14 — DIVERGENT ponta a ponta (achado #4): um trade com o líquido adulterado (+5, em CÓPIA do canônico) ⇒ motor DIVERGENT; capacidade ok com reconciliation DIVERGENT e slot 'divergente'; as linhas de PERNA não mudam; a de TRADE reflete o trade adulterado; unidades separadas", () => {
  const tampered: Any[] = structuredClone(imp.trades)
  tampered[0].pnl.net = tampered[0].pnl.net + 5
  const tT = toAnalyticsTrades(withRisk(tampered))
  const d: Any = exitReasonAnalysis(tT, { ...AN } as Any)
  assert.equal(d.reconciliation.status, "DIVERGENT", "premissa: o motor enxerga a divergência")
  const r = okOf(call({}, ctx({ trades: tT })))
  assert.equal(r.data.reconciliation, "DIVERGENT")
  assert.equal(r.data.reconciliation, mapReconciliation(d.reconciliation.status))
  assert.deepEqual(slot(r.data, "reconciliation"), { ok: true, text: "divergente" })
  const base = okOf(call({}))
  const legs = (x: Any): Any[] => x.data.buckets.filter((b: Any) => b.unit === "LEG")
  const trades = (x: Any): Any[] => x.data.buckets.filter((b: Any) => b.unit === "TRADE")
  assert.deepEqual(legs(r), legs(base), "a divergência é MOSTRADA, não corrigida: as pernas seguem iguais")
  const tTarget = (x: Any): Any => trades(x).find((b: Any) => b.reason === "TARGET")
  assert.equal(tTarget(base).pnlNet.toFixed(2), "152.80")
  assert.equal(tTarget(r).pnlNet.toFixed(2), "157.80", "o trade adulterado é o 1º (TARGET): +5 só na unidade TRADE")
  assert.equal(r.data.buckets.length, 9)
  assert.notEqual(r.evidence.evidenceRef, base.evidence.evidenceRef, "outro conjunto de trades ⇒ outra evidência")
  assert.notEqual(tampered[0].pnl.net, imp.trades[0].pnl.net, "a cópia foi adulterada e o canônico original não")
})

test("X15 — LITERAIS da fixture CY escritos à mão (achado #5): 8 pernas (TARGET 4, STOP 3, MANUAL 1, UNKNOWN 0) e 6 trades (TARGET 2, STOP 2, MANUAL 1, MIXED 1, UNKNOWN 0), com os valores derivados em pontos (US$ 10/pt, comissão US$ 2,40 por perna)", () => {
  const r = okOf(call({}))
  const cell = (unit: string, reason: string): Any => r.data.buckets.find((b: Any) => b.unit === unit && b.reason === reason)
  // [unidade, motivo, contagem, líquido em US$ (string de 2 casas) | null]
  const LITERAL: [string, string, number, string | null][] = [
    ["LEG", "TARGET", 4, "210.40"], // +4 +8 +6 +4 = 22 pts · 220,00 − 4×2,40
    ["LEG", "STOP", 3, "-197.20"], // −4 −5 −10 = −19 pts · −190,00 − 3×2,40
    ["LEG", "MANUAL", 1, "7.60"], // +1 pt · 10,00 − 2,40
    ["LEG", "UNKNOWN", 0, null],
    ["TRADE", "TARGET", 2, "152.80"], // (+4+8) e (+4) = 16 pts · 160,00 − 3×2,40
    ["TRADE", "STOP", 2, "-144.80"], // −4 e −10 = −14 pts · −140,00 − 2×2,40
    ["TRADE", "MANUAL", 1, "7.60"],
    ["TRADE", "MIXED", 1, "5.20"], // +6 −5 = +1 pt · 10,00 − 2×2,40
    ["TRADE", "UNKNOWN", 0, null],
  ]
  assert.equal(r.data.buckets.length, LITERAL.length)
  for (const [unit, reason, count, net] of LITERAL) {
    const b = cell(unit, reason)
    assert.ok(b, `${unit}/${reason} ausente`)
    assert.equal(b.count, count, `${unit}/${reason} count`)
    assert.equal(b.pnlNet === null ? null : b.pnlNet.toFixed(2), net, `${unit}/${reason} pnlNet`)
  }
  assert.equal(LITERAL.filter(([u]) => u === "LEG").reduce((a, x) => a + x[2], 0), 8, "Σ pernas")
  assert.equal(LITERAL.filter(([u]) => u === "TRADE").reduce((a, x) => a + x[2], 0), 6, "Σ trades")
})

// ── E6.6-7a' (review do Gemini, rodada 2): SÓ TESTES. Expectativa: expected.json → e66_7a2 ───────────────────────────────────────────────
test("X14b — DIVERGENT por QUANTIDADE ponta a ponta: o trade com a quantidade adulterada (+1, em CÓPIA do canônico) ⇒ motor DIVERGENT (divergentTotal 1); capacidade ok com reconciliation DIVERGENT e slot 'divergente'; as linhas de PERNA não mudam", () => {
  const tampered: Any[] = structuredClone(imp.trades)
  tampered[0].quantity = tampered[0].quantity + 1
  const tT = toAnalyticsTrades(withRisk(tampered))
  const d: Any = exitReasonAnalysis(tT, { ...AN } as Any)
  assert.equal(d.reconciliation.status, "DIVERGENT", "premissa: o motor enxerga a divergência de quantidade")
  assert.equal(d.reconciliation.divergentTotal, 1)
  const r = okOf(call({}, ctx({ trades: tT })))
  assert.equal(r.data.reconciliation, "DIVERGENT")
  assert.deepEqual(slot(r.data, "reconciliation"), { ok: true, text: "divergente" })
  const legs = (x: Any): Any[] => x.data.buckets.filter((b: Any) => b.unit === "LEG")
  assert.deepEqual(legs(r), legs(okOf(call({}))), "a divergência é mostrada, não corrigida: as pernas seguem iguais")
  assert.notEqual(tampered[0].quantity, imp.trades[0].quantity, "a cópia foi adulterada e o canônico original não")
})

test("X15b — LITERAIS de coverage e sampleFlag da fixture CY (achado #2 da rodada 2): toda célula com contagem > 0 tem used == total == count e ratio 1; as células vazias têm 0/0/0; a evidência declara 6 trades e sampleFlag TINY (há linhas de 1 trade/perna, abaixo do minSample 4)", () => {
  const r = okOf(call({}))
  const EMPTY = new Set(["LEG/UNKNOWN", "TRADE/UNKNOWN"])
  for (const b of r.data.buckets) {
    const full = !EMPTY.has(`${b.unit}/${b.reason}`)
    assert.deepEqual(b.coverage, full ? { used: b.count, total: b.count, ratio: 1 } : { used: 0, total: 0, ratio: 0 }, `${b.unit}/${b.reason} coverage`)
    assert.equal(b.count > 0, full, `${b.unit}/${b.reason}: só as UNKNOWN estão vazias nesta fixture`)
  }
  assert.equal(r.evidence.population.declared, 6)
  assert.equal(r.evidence.population.sampleFlag, "TINY")
})

test("X15c — a projeção PRESERVA cobertura parcial (used ≠ total): resultado do motor montado à mão com coverage {3, 4, 0.75} numa linha de perna e {1, 5, 0.2} numa de trade sai idêntico na view (a fixture CY é toda completa e não distingue used de total; mutação N4 do review escapou do X15b)", () => {
  const d: Any = JSON.parse(JSON.stringify(direct()))
  d.legs.rows[0].net.coverage = { used: 3, total: 4, ratio: 0.75 }
  d.trades.rows[0].net.coverage = { used: 1, total: 5, ratio: 0.2 }
  const p: Any = projectExitBreakdown(d)
  assert.notEqual(p, null)
  assert.deepEqual(p.buckets[0].coverage, { used: 3, total: 4, ratio: 0.75 })
  assert.deepEqual(p.buckets.find((b: Any) => b.unit === "TRADE" && b.reason === d.trades.rows[0].bucket).coverage, { used: 1, total: 5, ratio: 0.2 })
})

console.log(`\n${passed} testes ok`)
