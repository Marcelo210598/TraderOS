// E6.6-9: capacidade `rank.groups@1` (ranking de grupos por uma métrica). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_9 (D9-1…D9-10, L1–L14, N1–N16, fixtures CY, CZ e CW).
//   node scripts/test-agent-rank-groups.mts
import assert from "node:assert/strict"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION } from "../src/lib/agent/contract.ts"
import { REASON_TEXTS, formatNumber, formatUnavailable, type DisplayUnit } from "../src/lib/agent/format.ts"
import { allocateAlias, newAliasTable, type AliasTable } from "../src/lib/agent/label.ts"
import { renderSlot } from "../src/lib/agent/slot-path.ts"
import { RankRowViewSchema, RankViewSchema } from "../src/lib/agent/views.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { projectRank } from "../src/lib/agent-capabilities/project.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { refView } from "../src/lib/evidence/derived.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { METRIC_IDS, rankGroups, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const enc = (s: string) => new TextEncoder().encode(s)
const BRT = "America/Sao_Paulo"
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const mkRows = (rows: Any[]): SynthRow[] => rows.flatMap((c) => c.legs.map((l: Any): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any)))

// ── CY (6 trades, minSample 4) ──
const AN = { timeZone: BRT, minSample: 4 } as const
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const CSV_Y = synthCsv(mkRows(CY))
const impY = runImportPipeline(CSV_Y, { sourceTz: BRT, fileName: "segredo-ranking-y.csv" })
const recY = impY.importRecord as ImportRecord
const TY = toAnalyticsTrades(withRisk(impY.trades))

// ── CZ (24 trades, 12 dias × 09:00 e 14:00; minSample 10) ──
const ANZ = { timeZone: BRT, minSample: 10 } as const
const DAYS = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17]
const CZ = DAYS.flatMap((day, i) => [9, 14].map((hour, j) => { const stop = j === 0 ? i % 3 === 0 : i % 2 === 0; return { account: "Sim101", hour, day, legs: [{ exitPrice: stop ? 1996 : 2004, label: stop ? "Stop1" : "Target1", min: 10 }] } }))
const CSV_Z = synthCsv(mkRows(CZ))
const impZ = runImportPipeline(CSV_Z, { sourceTz: BRT, fileName: "segredo-ranking-z.csv" })
const recZ = impZ.importRecord as ImportRecord
const TZ = toAnalyticsTrades(withRisk(impZ.trades))
const FILES_Z = { [recZ.importId]: enc(CSV_Z) }

// ── CW (n dias distintos, 1 trade por dia) ──
const dayRows = (n: number): SynthRow[] => Array.from({ length: n }, (_, i) => { const d = i < 28 ? `${String(i + 1).padStart(2, "0")}/03/2026` : `${String(i - 27).padStart(2, "0")}/04/2026`; return { account: "Sim101", entryPrice: 2000, exitPrice: 2004, entryAt: `${d} 09:00:00`, exitAt: `${d} 09:10:00` } as SynthRow })
const manyCtx = (n: number): Any => { const r = runImportPipeline(synthCsv(dayRows(n)), { sourceTz: BRT, fileName: "dias.csv" }); return { trades: toAnalyticsTrades(withRisk(r.trades)), importRecords: [r.importRecord as ImportRecord], refEpoch: "s1", analysis: { timeZone: BRT, minSample: 4 } } }

const ctxY = (o: Any = {}): Any => ({ trades: TY, importRecords: [recY], refEpoch: "s1", analysis: AN, ...o })
const ctxZ = (o: Any = {}): Any => ({ trades: TZ, importRecords: [recZ], refEpoch: "s1", analysis: ANZ, ...o })
const run = (args: unknown, c: Any): Any => rankGroupsCapability(args, c)
const call = (args: unknown, c: Any): Any => run(args, c).result
const okOf = (r: Any): Any => { assert.equal(r.ok, true, `deveria ser ok: ${JSON.stringify(r).slice(0, 400)}`); return r }
const ERR = (code: string): Any => ({ contract: AGENT_CONTRACT_VERSION, capability: "rank.groups@1", ok: false, data: null, evidence: null, limits: [], error: { code } })
const ARGS = ERR("ARGS_INVALID"), REFUSED = ERR("ENGINE_REFUSED")
const slot = (data: Any, path: string): Any => renderSlot("rank.groups@1", data, path)

// ── oráculo: o motor DIRETO ──
const direct = (T: Any, an: Any, groupBy: string[], metric = "netPnl", order = "DESC", filters: Any = {}, opts: Any = {}): Any => rankGroups(T, { groupBy, metric, order, filters, ...an, ...opts } as Any)
/** Linhas esperadas do motor direto (sem a chave, que depende da dimensão). */
const expRows = (c: Any): Any[] => c.rows.map((r: Any) => ({ rank: r.rank, tied: r.tiedWithPrevious, flag: r.sampleFlag, size: r.sampleSize, value: r.value.value, reason: r.value.reason, unit: r.value.unit, contrib: r.contributionToTotal.value, contribReason: r.contributionToTotal.reason }))
const viewRows = (v: Any): Any[] => v.rows.map((r: Any) => ({ rank: r.rank, tied: r.tiedWithPrevious, flag: r.sampleFlag, size: r.value.sampleSize, value: r.value.value, reason: r.value.reason, unit: r.value.unit, contrib: r.contribution, contribReason: r.contributionReason }))
const keysOf = (v: Any): string[][] => v.rows.map((r: Any) => r.key)
const txt = (value: number | null, unit: DisplayUnit, reason: string | null): string => {
  if (value === null) { const u = formatUnavailable(reason) as Any; assert.equal(u.ok, true, `motivo fora do catálogo: ${reason}`); return u.text }
  const r = formatNumber(value, unit) as Any
  assert.equal(r.ok, true)
  return r.text
}

test("L1 — ORÁCULO (CZ, hora, netPnl DESC): cada linha (rank, empate, flag, amostra, valor, unidade, contribuição) == rankGroups DIRETO; literais medidos à mão; chaves '09:00'/'14:00'; orderedBy 'netPnl DESC'; slots == formatador", () => {
  const c = direct(TZ, ANZ, ["hour"])
  const r = okOf(call({ groupBy: ["hour"] }, ctxZ()))
  assert.deepEqual(viewRows(r.data), expRows(c))
  assert.deepEqual(keysOf(r.data), [["09:00"], ["14:00"]])
  assert.deepEqual(r.data.orderedBy, "netPnl DESC")
  assert.deepEqual(Object.keys(r.data).sort(), ["orderedBy", "rows"])
  assert.deepEqual(r.data.rows.map((x: Any) => [x.rank, x.value.value, x.sampleFlag, x.value.sampleSize, x.tiedWithPrevious, x.contribution, x.contributionReason]), [[1, 131.2, "OK", 12, false, 1.2813, null], [2, -28.8, "OK", 12, false, -0.2813, null]])
  for (const row of r.data.rows) { assert.equal(row.value.metricId, "netPnl"); assert.equal(row.value.basis, null); assert.deepEqual(Object.keys(row).sort(), ["contribution", "contributionReason", "key", "rank", "sampleFlag", "tiedWithPrevious", "value"]) }
  r.data.rows.forEach((row: Any, i: number) => {
    assert.deepEqual(slot(r.data, `rows[${i}].rank`), { ok: true, text: String(i + 1) })
    assert.deepEqual(slot(r.data, `rows[${i}].value.value`), { ok: true, text: txt(row.value.value, "usd", row.value.reason) })
    assert.deepEqual(slot(r.data, `rows[${i}].contribution`), { ok: true, text: txt(row.contribution, "fraction", row.contributionReason) })
    assert.deepEqual(slot(r.data, `rows[${i}].key[0]`), { ok: true, text: i === 0 ? "09:00" : "14:00" })
  })
})

test("L2 — ORDEM: ASC inverte os ranqueados (winRate por hora, CZ); a ordem das rows == a do motor (a view nunca reordena); default DESC/netPnl == explícito; orderedBy carrega métrica e ordem", () => {
  const asc = okOf(call({ groupBy: ["hour"], metric: "winRate", order: "ASC" }, ctxZ()))
  const c = direct(TZ, ANZ, ["hour"], "winRate", "ASC")
  assert.deepEqual(viewRows(asc.data), expRows(c))
  assert.deepEqual(asc.data.rows.map((r: Any) => [r.key[0], r.rank, r.value.value]), [["14:00", 1, 50], ["09:00", 2, 66.67]])
  assert.equal(asc.data.orderedBy, "winRate ASC")
  const desc = okOf(call({ groupBy: ["hour"], metric: "winRate", order: "DESC" }, ctxZ()))
  assert.deepEqual(desc.data.rows.map((r: Any) => r.key[0]), ["09:00", "14:00"])
  assert.deepEqual(call({ groupBy: ["hour"] }, ctxZ()).data, call({ groupBy: ["hour"], metric: "netPnl", order: "DESC" }, ctxZ()).data)
})

test("L3 — EMPATE: CZ hora totalTrades ⇒ rank 1 e 2, tiedWithPrevious false/true, contribuição do LÍQUIDO; cadeia 1→2→3 em hora+dayOfWeek e rank 4 com tied false", () => {
  const t = okOf(call({ groupBy: ["hour"], metric: "totalTrades" }, ctxZ()))
  assert.deepEqual(t.data.rows.map((r: Any) => [r.key[0], r.rank, r.value.value, r.tiedWithPrevious, r.contribution]), [["09:00", 1, 12, false, 1.2813], ["14:00", 2, 12, true, -0.2813]])
  assert.deepEqual(viewRows(t.data), expRows(direct(TZ, ANZ, ["hour"], "totalTrades")))
  assert.deepEqual(slot(t.data, "rows[1].rank"), { ok: true, text: "2" })
  const h = okOf(call({ groupBy: ["hour", "dayOfWeek"] }, ctxZ()))
  const ranked = h.data.rows.filter((r: Any) => r.rank !== null).map((r: Any) => [r.key[0], r.key[1], r.rank, r.value.value, r.tiedWithPrevious])
  assert.deepEqual(ranked, [["09:00", "Seg", 1, 32.8, false], ["09:00", "Ter", 2, 32.8, true], ["14:00", "Ter", 3, 32.8, true], ["14:00", "Seg", 4, -47.2, false]])
  assert.deepEqual(viewRows(h.data), expRows(direct(TZ, ANZ, ["hour", "dayOfWeek"])))
})

test("L4 — SEM POSIÇÃO (CY hora): só o 09:00 tem rank; 14:00 e 10:00 vêm no fim com rank null e valores preservados; slot do rank null ⇒ FORMAT_INVALID; ASC não reordena os sem posição; profitFactor com NO_LOSERS", () => {
  const r = okOf(call({ groupBy: ["hour"] }, ctxY()))
  assert.deepEqual(r.data.rows.map((x: Any) => [x.key[0], x.rank, x.sampleFlag, x.value.sampleSize, x.value.value, x.contribution]), [["09:00", 1, "LOW", 3, 80.4, 3.8654], ["14:00", null, "TINY", 2, 42.8, 2.0577], ["10:00", null, "TINY", 1, -102.4, -4.9231]])
  assert.deepEqual(viewRows(r.data), expRows(direct(TY, AN, ["hour"])))
  assert.deepEqual(slot(r.data, "rows[0].rank"), { ok: true, text: "1" })
  assert.deepEqual(slot(r.data, "rows[1].rank"), { ok: false, code: "FORMAT_INVALID" })
  assert.deepEqual(slot(r.data, "rows[2].rank"), { ok: false, code: "FORMAT_INVALID" })
  assert.deepEqual(slot(r.data, "rows[1].value.value"), { ok: true, text: txt(42.8, "usd", null) })
  const w = okOf(call({ groupBy: ["hour"], metric: "winRate", order: "ASC" }, ctxY()))
  assert.deepEqual(w.data.rows.map((x: Any) => [x.key[0], x.rank, x.value.value]), [["09:00", 1, 66.67], ["14:00", null, 100], ["10:00", null, 0]])
  const p = okOf(call({ groupBy: ["hour"], metric: "profitFactor" }, ctxY()))
  assert.deepEqual(p.data.rows.map((x: Any) => [x.key[0], x.rank, x.value.value, x.value.reason]), [["09:00", 1, 2.8962, null], ["14:00", null, null, "NO_LOSERS"], ["10:00", null, 0, null]])
  assert.deepEqual(slot(p.data, "rows[1].value.value"), { ok: true, text: "indisponível (não há trade perdedor)" })
  assert.deepEqual(viewRows(p.data), expRows(direct(TY, AN, ["hour"], "profitFactor")))
})

test("L5 — TODOS SEM POSIÇÃO (CZ dia; CY hora+conta): nenhuma linha descartada (contagem == motor), todas com rank null, confidence UNRELIABLE e sampleFlag TINY no handle", () => {
  const d = okOf(call({ groupBy: ["day"] }, ctxZ()))
  assert.equal(d.data.rows.length, 12)
  assert.equal(d.data.rows.every((r: Any) => r.rank === null && r.sampleFlag === "TINY"), true)
  assert.deepEqual(d.data.rows.map((r: Any) => r.key[0]), DAYS.map((x) => dd(x)))
  assert.equal(d.evidence.population.confidence, "UNRELIABLE")
  assert.equal(d.evidence.population.sampleFlag, "TINY")
  const ha = okOf(call({ groupBy: ["hour", "account"] }, ctxY()))
  assert.equal(ha.data.rows.length, direct(TY, AN, ["hour", "account"]).rows.length)
  assert.equal(ha.data.rows.length, 5)
  assert.equal(ha.data.rows.every((r: Any) => r.rank === null), true)
})

test("L6 — ARGS_INVALID: groupBy vazio/3/repetido; fora de COMPARE_DIMENSIONS (session, strategy, strategyVersion, setup, timeframe); metric desconhecida; order inválida; where; limit; extras; undefined; não-objeto; envelope fixo e sem lançar", () => {
  assert.equal(okOf(call({ groupBy: ["hour"] }, ctxZ())).ok, true)
  const bad: unknown[] = [undefined, null, 5, "x", [], {}, { groupBy: [] }, { groupBy: ["hour", "day", "month"] }, { groupBy: ["hour", "hour"] }, { groupBy: "hour" },
    { groupBy: ["session"] }, { groupBy: ["strategy"] }, { groupBy: ["strategyVersion"] }, { groupBy: ["setup"] }, { groupBy: ["timeframe"] },
    { groupBy: ["hour"], metric: "naoExiste" }, { groupBy: ["hour"], metric: 5 }, { groupBy: ["hour"], order: "UP" }, { groupBy: ["hour"], order: "desc" },
    { groupBy: ["hour"], where: { hour: "09" } }, { groupBy: ["hour"], limit: 3 }, { groupBy: ["hour"], foo: 1 }, { groupBy: ["hour"], filters: { setup: "x" } }, { groupBy: ["hour"], filters: { account: "Sim101" } }, { groupBy: ["hour"], filters: { account: "Conta Z" } }, { groupBy: ["hour"], filters: { from: "2026-03-10", to: "2026-03-02" } }]
  for (const b of bad) { assert.doesNotThrow(() => call(b, ctxZ())); assert.deepEqual(call(b, ctxZ()), ARGS, JSON.stringify(b)) }
  assert.equal(Object.hasOwn(call({ groupBy: ["hour"], where: {} }, ctxZ()).error ?? {}, "message"), false)
})

test("L7 — TETO (D9-4): 51 grupos ⇒ ARGS_INVALID (nunca trunca); exatamente 50 ⇒ ok com 50 linhas", () => {
  assert.deepEqual(call({ groupBy: ["day"] }, manyCtx(51)), ARGS)
  const r = okOf(call({ groupBy: ["day"] }, manyCtx(50)))
  assert.equal(r.data.rows.length, 50)
  assert.equal(r.evidence.population.declared, 50)
})

// ── contas: a tabela da CONVERSA ──
const REF = (name: string): string => { const rv = refView(TY, ""); const i = TY.findIndex((t: Any) => t.trade.account.sourceName === name); return rv[i].trade.account.sourceName }
const REF101 = REF("Sim101"), REF102 = REF("Sim102")
const CONV: AliasTable = (metricsGroups({ groupBy: ["account"], metricIds: ["totalTrades"] }, ctxY({ aliases: newAliasTable("s1") })) as Any).aliases // Conta A = Sim101
const SWAPPED: AliasTable = (() => { const a = allocateAlias(newAliasTable("s1"), "conta", REF102, "s1") as Any; return (allocateAlias(a.table, "conta", REF101, "s1") as Any).table })()

test("L8 — CONTA: chave 'Conta X' (nunca nome/ref); a tabela da conversa manda (CONV e SWAPPED); sem tabela aloca pela ordem das linhas e DEVOLVE a tabela (D9-8); filters.account por alias; alias inexistente e nome cru ⇒ ARGS_INVALID; getter hostil ⇒ ENGINE_REFUSED", () => {
  const a = run({ groupBy: ["account"] }, ctxY({ aliases: CONV }))
  const ra = okOf(a.result)
  assert.deepEqual(ra.data.rows.map((r: Any) => [r.key[0], r.rank, r.value.value, r.value.sampleSize]), [["Conta A", 1, 8, 4], ["Conta B", null, 12.8, 2]])
  assert.deepEqual(a.aliases.conta, CONV.conta, "tabela devolvida == a da conversa (nada novo a alocar)")
  const s = okOf(call({ groupBy: ["account"] }, ctxY({ aliases: SWAPPED })))
  assert.deepEqual(s.data.rows.map((r: Any) => [r.key[0], r.value.value]), [["Conta B", 8], ["Conta A", 12.8]], "a chave segue a TABELA, não a ordem")
  const fresh = run({ groupBy: ["account"] }, ctxY())
  assert.deepEqual(okOf(fresh.result).data.rows.map((r: Any) => r.key[0]), ["Conta A", "Conta B"])
  assert.deepEqual(fresh.aliases.conta, [REF101, REF102], "devolve a tabela alocada pela ordem das linhas")
  assert.equal(fresh.aliases.epoch, "s1")
  assert.deepEqual(fresh.entry.view.rows.map((r: Any) => r.key[0]), ["Conta A", "Conta B"])
  const f = okOf(call({ groupBy: ["hour"], filters: { account: "Conta B" } }, ctxY({ aliases: CONV })))
  assert.deepEqual(f.data.rows.map((r: Any) => [r.key[0], r.value.sampleSize]), [["09:00", 1], ["14:00", 1]])
  assert.deepEqual(call({ groupBy: ["hour"], filters: { account: "Conta C" } }, ctxY({ aliases: CONV })), ARGS)
  assert.deepEqual(call({ groupBy: ["hour"], filters: { account: "Sim101" } }, ctxY({ aliases: CONV })), ARGS)
  const hostile: Any = ctxY()
  Object.defineProperty(hostile, "aliases", { enumerable: true, get() { throw new Error("getter hostil") } })
  assert.doesNotThrow(() => run({ groupBy: ["account"], filters: { account: "Conta A" } }, hostile))
  assert.deepEqual(call({ groupBy: ["hour"], filters: { account: "Conta A" } }, hostile), REFUSED) // como o A10 do 5-A: o getter é lido pelo filtro de conta
  assert.equal(okOf(call({ groupBy: ["hour"] }, hostile)).ok, true, "sem alias na chamada, o getter hostil é lido dentro do try e vira 'sem tabela' (igual ao metrics.groups)")
  const dump = JSON.stringify(ra)
  for (const leak of ["Sim101", "Sim102", "acc_"]) assert.equal(dump.includes(leak), false, `vazou ${leak}`)
})

test("L9 — HANDLE: DERIVED, scope GROUP, declared == afterFilters, sampleFlag = PIOR de TODAS as linhas (CY ⇒ TINY; CZ hora ⇒ OK), confidence do summary; verify VALID; sem arquivo NOT_VERIFIED + estrutural; com arquivo VERIFIED; adulterado TAMPERED_OR_MISMATCH", () => {
  const y = okOf(call({ groupBy: ["hour"] }, ctxY()))
  assert.equal(y.evidence.subject.type, "DERIVED")
  assert.equal(y.evidence.scope, "GROUP")
  assert.equal(y.evidence.population.declared, 6)
  assert.equal(y.evidence.population.sampleFlag, "TINY")
  assert.equal(y.evidence.population.confidence, "UNRELIABLE")
  assert.equal(y.evidence.verdict.verify.status, "VALID")
  assert.equal(y.evidence.verdict.combined, "NOT_VERIFIED")
  assert.deepEqual(y.limits.map((l: Any) => l.code), ["VERIFICATION_INFRA_MISSING"])
  const z = okOf(call({ groupBy: ["hour"] }, ctxZ()))
  assert.equal(z.evidence.population.declared, 24)
  assert.equal(z.evidence.population.sampleFlag, "OK")
  assert.equal(z.evidence.population.confidence, "OK")
  const good = okOf(call({ groupBy: ["hour"] }, ctxZ({ source: { files: FILES_Z } })))
  assert.equal(good.evidence.verdict.combined, "VERIFIED")
  assert.deepEqual(good.limits, [])
  const bad = okOf(call({ groupBy: ["hour"] }, ctxZ({ source: { files: { [recZ.importId]: enc(CSV_Z.replace("2004", "2005")) } } })))
  assert.equal(bad.evidence.verdict.combined, "TAMPERED_OR_MISMATCH")
  const hd = okOf(call({ groupBy: ["hour", "dayOfWeek"] }, ctxZ()))
  assert.equal(hd.evidence.population.sampleFlag, "TINY", "linhas LOW e TINY: o pior das linhas é TINY")
})

test("L10 — AS 39 MÉTRICAS (CZ, hora): cada metricId roda e a view == rankGroups DIRETO (valor, unidade, motivo, contribuição)", () => {
  assert.equal(METRIC_IDS.length, 39)
  for (const metric of METRIC_IDS) {
    const r = okOf(call({ groupBy: ["hour"], metric }, ctxZ()))
    assert.deepEqual(viewRows(r.data), expRows(direct(TZ, ANZ, ["hour"], metric)), metric)
    assert.equal(r.data.orderedBy, `${metric} DESC`)
    assert.equal(r.data.rows.every((x: Any) => x.value.metricId === metric), true, metric)
  }
})

test("L11 — FILTROS E OPTIONS: filters (symbol/direction/hour/from-to) reduzem a população == direto; options.pnlBasis passa ao motor (GROSS ≠ NET)", () => {
  const f = { direction: "LONG", from: "2026-03-03", to: "2026-03-16" }
  const r = okOf(call({ groupBy: ["hour"], filters: f }, ctxZ()))
  assert.deepEqual(viewRows(r.data), expRows(direct(TZ, ANZ, ["hour"], "netPnl", "DESC", f)))
  assert.notEqual(r.data.rows[0].value.sampleSize, 12, "o filtro precisa mudar a amostra nesta fixture")
  const net = okOf(call({ groupBy: ["hour"], metric: "averageTrade" }, ctxZ()))
  const gross = okOf(call({ groupBy: ["hour"], metric: "averageTrade", options: { pnlBasis: "GROSS" } }, ctxZ()))
  assert.deepEqual(viewRows(gross.data), expRows(direct(TZ, ANZ, ["hour"], "averageTrade", "DESC", {}, { pnlBasis: "GROSS" })))
  assert.notDeepEqual(viewRows(gross.data), viewRows(net.data))
  assert.notEqual(gross.evidence.evidenceRef, net.evidence.evidenceRef)
})

test("L12 — SEGURANÇA: o envelope não tem nome de conta, arquivo, importId, hashes, acc_, sal nem userId; sal ausente em import salgado ⇒ ENGINE_REFUSED; ctx hostil ⇒ ENGINE_REFUSED sem lançar; T0 injetado não passa pela projeção", () => {
  const r = okOf(call({ groupBy: ["hour", "account"], metric: "totalTrades" }, ctxY()))
  const dump = JSON.stringify(r)
  for (const leak of ["Sim101", "Sim102", "segredo-ranking", recY.importId, "tradeSetHash", "evidenceHash", "rowHash", "rowNo", "fileSha256", "saltId", "userId", "acc_", "str_", "label"]) assert.equal(dump.includes(leak), false, `vazou: ${leak}`)
  assert.equal(/[0-9a-f]{64}/.test(dump), false)
  const SALT = "sal-de-teste-do-ranking-0123456789abcdef"
  const salted = runImportPipeline(CSV_Z, { sourceTz: BRT, fileName: "salgado.csv", accountRefSalt: SALT } as Any)
  const base: Any = { trades: toAnalyticsTrades(withRisk(salted.trades)), importRecords: [salted.importRecord], refEpoch: "s1", analysis: ANZ }
  assert.deepEqual(call({ groupBy: ["hour"] }, base), REFUSED)
  assert.equal(okOf(call({ groupBy: ["hour"] }, { ...base, accountRefSalt: SALT })).ok, true)
  const hostile: Any = ctxZ()
  Object.defineProperty(hostile, "trades", { enumerable: true, get() { throw new Error("getter hostil") } })
  for (const c of [hostile, null, undefined, 5, ctxZ({ importRecords: null }), ctxZ({ refEpoch: "" }), ctxZ({ trades: [null] })]) { assert.doesNotThrow(() => run({ groupBy: ["hour"] }, c as never)); assert.deepEqual(call({ groupBy: ["hour"] }, c as never), REFUSED) }
  // T0 injetado no resultado do motor
  const ex: Any = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: ["hour"], metric: "netPnl", order: "DESC" }, filters: {}, options: { timeZone: BRT, minSample: 10 } } as never, trades: TZ, importRecords: [recZ] } as never)
  assert.equal(ex.ok, true)
  const dirty: Any = JSON.parse(JSON.stringify(ex.derived.result))
  dirty.secret = "SEGREDO_T0"
  dirty.rows = dirty.rows.map((x: Any) => ({ ...x, extra: "SEGREDO_T0", value: { ...x.value, details: { x: "SEGREDO_T0" } } }))
  const pj: Any = projectRank(dirty, "s1")
  assert.notEqual(pj, null)
  assert.equal(JSON.stringify(pj).includes("SEGREDO_T0"), false)
})

test("L13 — PROJEÇÃO PURA: projectRank recusa (null) rank 0/negativo/fracionário, unidade inválida, valor null sem motivo, motivo fora do catálogo (valor e contribuição), chave fora do formato, época inválida, entrada não-objeto; não muta; determinística", () => {
  const ex: Any = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: ["hour"], metric: "netPnl", order: "DESC" }, filters: {}, options: { timeZone: BRT, minSample: 10 } } as never, trades: TZ, importRecords: [recZ] } as never)
  const good: Any = ex.derived.result
  const snap = JSON.stringify(good)
  const p1: Any = projectRank(good, "s1")
  assert.notEqual(p1, null)
  assert.equal(JSON.stringify(good), snap, "não muta a entrada")
  assert.deepEqual(projectRank(good, "s1"), p1)
  assert.equal(p1.worstFlag, "OK")
  assert.deepEqual(p1.view.rows.map((r: Any) => r.key), [["09:00"], ["14:00"]])
  const mut = (f: (r: Any) => void): Any => { const c: Any = JSON.parse(snap); f(c); return projectRank(c, "s1") }
  assert.equal(mut((r) => { r.rows[0].rank = 2 }), null, "ranks em sequência 1..n")
  assert.equal(mut((r) => { r.rows[0].rank = null }), null, "sem posição só no fim")
  assert.equal(mut((r) => { r.rows[1].rank = null }) === null, false, "sem posição no fim é válido")
  assert.equal(mut((r) => { r.rows[1].key.dims = ["dayOfWeek"]; r.rows[1].key.key = ["1"] }), null, "dimensões iguais em todas as linhas")
  assert.equal(mut((r) => { for (const row of r.rows) { row.key.dims = ["session"]; row.key.key = ["AM"] } }), null, "dimensão fora das 10 verificáveis (session) ⇒ recusa")
  assert.equal(mut((r) => { r.rows[0].rank = 0 }), null)
  assert.equal(mut((r) => { r.rows[0].rank = -1 }), null)
  assert.equal(mut((r) => { r.rows[0].rank = 1.5 }), null)
  assert.equal(mut((r) => { r.rows[0].value.unit = "xyz" }), null)
  assert.equal(mut((r) => { r.rows[0].value.value = null; r.rows[0].value.reason = null }), null)
  assert.equal(mut((r) => { r.rows[0].value.value = null; r.rows[0].value.reason = "MOTIVO_INVENTADO" }), null)
  assert.equal(mut((r) => { r.rows[0].contributionToTotal.value = null; r.rows[0].contributionToTotal.reason = "MOTIVO_INVENTADO" }), null)
  assert.equal(mut((r) => { r.rows[0].contributionToTotal.value = null; r.rows[0].contributionToTotal.reason = null }), null)
  assert.equal(mut((r) => { r.rows[0].key.key = ["9h"] }), null)
  assert.equal(mut((r) => { r.rows[0].key.key = [null, "x"] }), null)
  assert.equal(mut((r) => { r.rows[0].sampleFlag = "HUGE" }), null)
  assert.equal(mut((r) => { r.order = "UP" }), null)
  assert.equal(mut((r) => { r.metric.id = 5 }), null)
  assert.equal(projectRank(good, "S 1"), null)
  for (const x of [null, undefined, 5, "x", [], {}]) assert.equal(projectRank(x, "s1"), null)
  // chave null (grupo desconhecido) vira '(desconhecido)'
  const unk: Any = JSON.parse(snap); unk.rows[1].key.key = [null]
  assert.deepEqual((projectRank(unk, "s1") as Any).view.rows[1].key, ["(desconhecido)"])
})

test("L14 — SCHEMA: RankRowViewSchema aceita rank null e segue recusando 0, -1, 1.5 e '1'; RankViewSchema aceita a view do ranking", () => {
  const mv = { metricId: "netPnl", value: 1, unit: "usd", basis: null, sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null }
  const row = (rank: unknown): Any => ({ rank, key: ["09:00"], value: mv, sampleFlag: "OK", tiedWithPrevious: false, contribution: 0.5, contributionReason: null })
  assert.equal(RankRowViewSchema.safeParse(row(null)).success, true)
  assert.equal(RankRowViewSchema.safeParse(row(1)).success, true)
  for (const bad of [0, -1, 1.5, "1", undefined]) assert.equal(RankRowViewSchema.safeParse(row(bad)).success, false, String(bad))
  assert.equal(RankViewSchema.safeParse({ rows: [row(1), row(null)], orderedBy: "netPnl DESC" }).success, true)
  assert.ok(Object.hasOwn(REASON_TEXTS, "NO_LOSERS"))
})

console.log(`\n${passed} testes do E6.6-9 (rank.groups@1) passaram`)
