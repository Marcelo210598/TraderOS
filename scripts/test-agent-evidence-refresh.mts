// E6.6-12: capacidade `evidence.refresh@1` (refaz uma Evidence STALE na época vigente) + `refreshEvidence` no ledger + ajuste do contrato (refresh devolve `data: null`). Testes escritos ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_12 (D12-1…D12-13, RF1–RF13, LR1–LR4, RFM1–RFM22, receita real de VERIFIED_PARTIAL).
//   node scripts/test-agent-evidence-refresh.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { AGENT_CONTRACT_VERSION, CAPABILITY_IDS, capabilityResultSchema } from "../src/lib/agent/contract.ts"
import { addEvidence, isStale, lookupRef, newLedger, refreshEvidence, rotateEpoch } from "../src/lib/agent/ledger.ts"
import { PARTIAL_PHRASES } from "../src/lib/agent/phrases.ts"
import { renderAnswer } from "../src/lib/agent/render.ts"
import { validateAnswer } from "../src/lib/agent/validate-answer.ts"
import { PROMPT_VIEWS } from "../src/lib/agent/views.ts"
import { assessBundle } from "../src/lib/agent-capabilities/assess.ts"
import { errorResult, handleView, okResult } from "../src/lib/agent-capabilities/envelope.ts"
import { evidenceExplain } from "../src/lib/agent-capabilities/evidence-explain.ts"
import { evidenceRefresh } from "../src/lib/agent-capabilities/evidence-refresh.ts"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash, explainPageRef } from "../src/lib/evidence/hash.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { InMemorySaltKeyring, generateSalt, saltCheck } from "../src/lib/ingest/salt.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = (name: string, fn: () => void) => {
  if (process.env.COLLECT) { try { fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return } // COLLECT=1 só para a análise de mutações
  fn(); passed += 1; console.log(`✓ ${name}`)
}
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/agent-answer.expected.json`, "utf8")).e66_12
const enc = (s: string) => new TextEncoder().encode(s)
const BRT = "America/Sao_Paulo"
const AN = { timeZone: BRT, minSample: 4 } as const
const hh = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const dd = (d: number) => `${String(d).padStart(2, "0")}/03/2026`
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const deepFreeze = <T,>(x: T): T => {
  if (typeof x === "object" && x !== null && !ArrayBuffer.isView(x) && !Object.isFrozen(x)) { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x) }
  return x
}

// ── fixture CY (6 trades; 2 contas; horas 9, 10 e 14) ───────────────────────
const CY = [
  { account: "Sim101", hour: 9, day: 2, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }, { exitPrice: 2008, label: "Target2", min: 20 }] },
  { account: "Sim101", hour: 9, day: 3, legs: [{ exitPrice: 1996, label: "Stop1", min: 10 }] },
  { account: "Sim102", hour: 14, day: 5, legs: [{ exitPrice: 2006, label: "Target1", min: 10 }, { exitPrice: 1995, label: "Stop1", min: 20 }] },
  { account: "Sim102", hour: 9, day: 6, legs: [{ exitPrice: 2001, label: "Zerar", min: 10 }] },
  { account: "Sim101", hour: 14, day: 9, legs: [{ exitPrice: 2004, label: "Target1", min: 10 }] },
  { account: "Sim101", hour: 10, day: 10, legs: [{ exitPrice: 1990, label: "Stop1", min: 10 }] },
]
const rows = (): SynthRow[] => CY.flatMap((c) => c.legs.map((l): SynthRow => ({ account: c.account, qty: 1, entryPrice: 2000, exitPrice: l.exitPrice, entryAt: `${dd(c.day)} ${hh(c.hour)}`, exitAt: `${dd(c.day)} ${hh(c.hour, l.min)}`, exitLabel: l.label } as Any)))
const CSV = synthCsv(rows())
const SA = "sal-A-0123456789abcdef-0123456789abcdef"
const SB = "sal-B-0123456789abcdef-fedcba9876543210"
const SC = "sal-C-0123456789abcdef-aaaaaaaaaaaaaaaa"

/** O MESMO arquivo reimportado numa época: com sal (refs de conta mudam) ou sem sal (refs iguais). */
const world = (salt: string | undefined, refEpoch: string, over: Any = {}): Any => {
  const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: "refresh.csv", ...(salt !== undefined ? { accountRefSalt: salt } : {}) } as Any)
  const rec = imp.importRecord as ImportRecord
  const source = { files: { [rec.importId]: enc(CSV) }, ...(salt !== undefined ? { options: { accountRefSalt: salt } } : {}) }
  return { epoch: refEpoch, ctx: { trades: toAnalyticsTrades(withRisk(imp.trades)), importRecords: [rec], refEpoch, analysis: AN, ...(salt !== undefined ? { accountRefSalt: salt } : {}), source, ...over }, rec }
}

const SPECS: Record<string, Any> = {
  "metrics.query@1": { metricIds: ["netPnl", "totalTrades"], filters: { from: "2026-03-02", to: "2026-03-09" }, options: { pnlBasis: "GROSS" } },
  "metrics.groups@1": { groupBy: ["hour"], metricIds: ["netPnl"] },
  "metrics.compare@1": { mode: "GROUP", groupBy: ["hour"], a: { hour: 9 }, b: { hour: 14 }, metricIds: ["netPnl"] },
  "exit.breakdown@1": {},
  "exit.analysis@1": {},
  "rank.groups@1": { groupBy: ["hour"] },
}
const CALL: Record<string, (a: unknown, c: Any) => Any> = {
  "metrics.query@1": metricsQuery, "metrics.groups@1": metricsGroups, "metrics.compare@1": metricsCompare,
  "exit.breakdown@1": exitBreakdown, "exit.analysis@1": exitAnalysis, "rank.groups@1": rankGroupsCapability,
}
const ANALYTIC = Object.keys(SPECS)

/** Ledger na época do mundo 1 com a entrada da capacidade, DEPOIS rotacionado para `next` (a entrada vira STALE). */
const seed = (cap: string, w1: Any, next = "s2", args: unknown = SPECS[cap]): Any => {
  const out = CALL[cap](args, w1.ctx)
  assert.ok(out.entry, `${cap}: a chamada original deveria dar entry: ${JSON.stringify(out.result).slice(0, 200)}`)
  const added: Any = addEvidence((newLedger(w1.epoch) as Any).ledger, out.entry)
  assert.equal(added.ok, true)
  const ref = out.entry.handle.evidenceRef as string
  const rotated: Any = rotateEpoch(added.ledger, next)
  assert.equal(rotated.ok, true)
  return { out, ref, ledger0: added.ledger, ledger: rotated.ledger }
}
const rctx = (s: Any, cap: string, w2: Any, over: Any = {}, args: unknown = SPECS[cap]): Any => ({ ledger: s.ledger, specOf: (r: string) => (r === s.ref ? { capability: cap, args } : null), regenerated: w2.ctx, ...over })
const REFRESH = "evidence.refresh@1"
const err = (code: string): Any => errorResult(REFRESH, code as Any)
const okOf = (out: Any): Any => { assert.equal(out.result.ok, true, `deveria ser ok: ${JSON.stringify(out.result).slice(0, 300)}`); return out.result }

test("RF0 — a expectativa e66_12 existe e conhece os 22 mutantes, as decisões D12 e os casos (sanidade do gerador)", () => {
  assert.equal(exp.mutations_planned.length, 22)
  for (const k of ["D12-1", "D12-2'", "D12-3", "D12-4'", "D12-5", "D12-6", "D12-7", "D12-8", "D12-9", "D12-10", "D12-11_MINHA", "D12-12_MINHA", "D12-13_MINHA"]) assert.ok(k in exp.decisions_D12, k)
  assert.equal(exp.cases.length, 14)
  assert.ok(ANALYTIC.length === 6 && ANALYTIC.every((c) => (CAPABILITY_IDS as readonly string[]).includes(c)))
})

const W1S = world(SA, "s1"), W2S = world(SB, "s2"), W1N = world(undefined, "s1"), W2N = world(undefined, "s2")

test("RF1 — ORÁCULO, import COM sal: ledger s1 → rotateEpoch s2 → refresh (data null, handle CURRENT s2, ref NOVO, sem hash); entry == chamada DIRETA (o oráculo não passa pelo refresh); refreshEvidence mantém a antiga STALE e põe a nova CURRENT", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1S)
  const direct = CALL[cap](SPECS[cap], W2S.ctx)
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2S))
  const r = okOf(out)
  assert.deepEqual(Object.keys(r).sort(), ["capability", "contract", "data", "evidence", "limits", "ok"])
  assert.equal(r.contract, AGENT_CONTRACT_VERSION)
  assert.equal(r.capability, REFRESH)
  assert.equal(r.data, null)
  assert.equal(r.evidence.freshness, "CURRENT")
  assert.equal(r.evidence.refEpoch, "s2")
  assert.notEqual(r.evidence.evidenceRef, s.ref, "com sal o ref muda")
  assert.equal("evidenceHash" in r.evidence, false)
  assert.equal(out.entry.capability, cap, "a entry guarda a capacidade ORIGINAL")
  assert.deepEqual(out.entry.handle, direct.entry.handle)
  assert.deepEqual(out.entry.view, direct.entry.view)
  assert.deepEqual(r.limits, direct.result.limits)
  assert.equal(r.evidence.evidenceRef, out.entry.handle.evidenceRef)
  const merged: Any = refreshEvidence(s.ledger, out.entry)
  assert.equal(merged.ok, true)
  assert.equal(Object.keys(merged.ledger.entries).length, 2)
  assert.equal(isStale(merged.ledger, lookupRef(merged.ledger, s.ref)!), true, "a antiga fica STALE (auditoria)")
  assert.equal(isStale(merged.ledger, lookupRef(merged.ledger, r.evidence.evidenceRef)!), false)
})

test("RF2 — SEM sal (o caso comum): o ref é o MESMO; addEvidence dá LEDGER_CONFLICT (premissa pinada); refreshEvidence substitui no lugar (1 entrada, CURRENT); o ledger original não muda; nova rotação ⇒ STALE de novo", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2N))
  const r = okOf(out)
  assert.equal(r.evidence.evidenceRef, s.ref, "sem sal o ref não muda entre épocas")
  assert.deepEqual(addEvidence(s.ledger, out.entry), { ok: false, code: "LEDGER_CONFLICT" })
  const before = JSON.stringify(s.ledger)
  const merged: Any = refreshEvidence(s.ledger, out.entry)
  assert.equal(merged.ok, true)
  assert.equal(JSON.stringify(s.ledger), before, "o ledger original não mudou")
  assert.equal(Object.keys(merged.ledger.entries).length, 1)
  const e = lookupRef(merged.ledger, s.ref)!
  assert.equal(e.handle.refEpoch, "s2")
  assert.equal(isStale(merged.ledger, e), false)
  const again: Any = rotateEpoch(merged.ledger, "s3")
  assert.equal(isStale(again.ledger, lookupRef(again.ledger, s.ref)!), true)
})

test("RF3 — ARGS_INVALID: campo extra, undefined, null, array, string, ref malformado/vazio/maiúsculo/herdado; ref JÁ CURRENT ⇒ ARGS_INVALID SEM executar nada (specOf e regenerated nem são lidos)", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const c = rctx(s, cap, W2N)
  const ok = `ev_${"a".repeat(32)}`
  for (const bad of [{ evidenceRef: s.ref, extra: 1 }, undefined, null, [], "x", 5, {}, { evidenceRef: "" }, { evidenceRef: "ev_abc" }, { evidenceRef: s.ref.toUpperCase() }, { evidenceRef: "__proto__" }, { evidenceRef: "constructor" }, { evidenceRef: 5 }, { evidenceRef: ok, page: 1 }]) {
    const out = evidenceRefresh(bad, c)
    assert.deepEqual(out.result, err("ARGS_INVALID"), JSON.stringify(bad))
    assert.equal(out.entry, null)
  }
  // ref CURRENT: o ledger NÃO foi rotacionado
  let touched = 0
  const spy: Any = { ledger: s.ledger0, get specOf() { touched += 1; return () => ({ capability: cap, args: SPECS[cap] }) }, get regenerated() { touched += 1; return W2N.ctx } }
  const out = evidenceRefresh({ evidenceRef: s.ref }, spy)
  assert.deepEqual(out.result, err("ARGS_INVALID"))
  assert.equal(out.entry, null)
  assert.equal(touched, 0, "ref vigente: nada é executado nem lido")
})

test("RF4 — NOT_FOUND: ref bem-formado ausente do ledger (ledger vazio e ledger com outro ref)", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const ghost = `ev_${"0".repeat(32)}`
  for (const ledger of [s.ledger, (rotateEpoch((newLedger("s1") as Any).ledger, "s2") as Any).ledger]) {
    const out = evidenceRefresh({ evidenceRef: ghost }, rctx(s, cap, W2N, { ledger }))
    assert.deepEqual(out.result, err("NOT_FOUND"))
    assert.equal(out.entry, null)
  }
})

test("RF5 — FILE_NOT_AVAILABLE: sem regenerated, regenerated sem source (undefined e null), sem specOf, specOf devolvendo null; envelope sem detalhe e entry null", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const base = rctx(s, cap, W2N)
  const variants: Any[] = [
    { ...base, regenerated: undefined },
    { ...base, regenerated: { ...W2N.ctx, source: undefined } },
    { ...base, regenerated: { ...W2N.ctx, source: null } },
    { ...base, specOf: undefined },
    { ...base, specOf: () => null },
    { ...base, specOf: "não é função" },
  ]
  for (const [i, v] of variants.entries()) {
    const out = evidenceRefresh({ evidenceRef: s.ref }, v)
    assert.deepEqual(out.result, err("FILE_NOT_AVAILABLE"), `variante ${i}`)
    assert.equal(out.entry, null)
  }
})

test("RF6 — ESCOPO: evidence.explain@1, evidence.refresh@1, 'x@1', não-string e null como capacidade original ⇒ ARGS_INVALID (inclusive sem regenerated: a ordem importa); as 6 analíticas ⇒ ok, com entry == chamada direta e ALIASES repassados", () => {
  const s = seed("metrics.query@1", W1N)
  for (const cap of ["evidence.explain@1", REFRESH, "x@1", 5, null, undefined, "", "metrics.query"]) {
    const c = rctx(s, "metrics.query@1", W2N, { specOf: () => ({ capability: cap, args: {} }) })
    assert.deepEqual(evidenceRefresh({ evidenceRef: s.ref }, c).result, err("ARGS_INVALID"), String(cap))
    assert.deepEqual(evidenceRefresh({ evidenceRef: s.ref }, { ...c, regenerated: undefined }).result, err("ARGS_INVALID"), `${String(cap)} sem regenerated`)
  }
  for (const cap of ANALYTIC) {
    const s2 = seed(cap, W1N)
    const out = evidenceRefresh({ evidenceRef: s2.ref }, rctx(s2, cap, W2N))
    const r = okOf(out)
    const direct = CALL[cap](SPECS[cap], W2N.ctx)
    assert.equal(out.entry.capability, cap, cap)
    assert.deepEqual(out.entry.view, direct.entry.view, cap)
    assert.deepEqual(out.entry.handle, direct.entry.handle, cap)
    assert.equal(r.evidence.evidenceRef, direct.result.evidence.evidenceRef, cap)
    assert.deepEqual(out.aliases ?? null, direct.aliases ?? null, `${cap}: tabela de alias repassada`)
    assert.equal((refreshEvidence(s2.ledger, out.entry) as Any).ok, true, cap)
  }
})

test("RF7 — ENGINE_REFUSED: época da regenerated ≠ época do ledger; specOf que LANÇA; args do spec inválidos para a capacidade (o código interno NÃO vaza, D12-13); ctx null/sem ledger/ledger malformado; trades null", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const REF = { evidenceRef: s.ref }
  const base = rctx(s, cap, W2N)
  const refused = (c: Any, why: string) => { const out = evidenceRefresh(REF, c); assert.deepEqual(out.result, err("ENGINE_REFUSED"), why); assert.equal(out.entry, null, why) }
  refused({ ...base, regenerated: world(undefined, "s9").ctx }, "época diferente")
  refused({ ...base, regenerated: W1N.ctx }, "época antiga (s1) com ledger em s2")
  refused({ ...base, specOf: () => { throw new Error("segredo") } }, "specOf lança")
  refused(rctx(s, cap, W2N, {}, { metricIds: [] }), "args inválidos ⇒ ARGS_INVALID interno vira ENGINE_REFUSED")
  refused(rctx(s, cap, W2N, {}, { metricIds: ["netPnl"], extra: 1 }), "campo extra no spec")
  refused(null, "ctx null")
  refused({}, "sem ledger")
  refused({ ...base, ledger: { epoch: "s2", entries: null } }, "ledger malformado")
  refused({ ...base, regenerated: { ...W2N.ctx, trades: null } }, "trades null")
  assert.equal(JSON.stringify(evidenceRefresh(REF, rctx(s, cap, W2N, {}, { metricIds: [] })).result).includes("ARGS_INVALID"), false, "o código interno não aparece")
})

test("RF8 — PRESERVAÇÃO DA CONSULTA: filtros (from/to/hour), options (pnlBasis) e groupBy do spec chegam INTACTOS à reexecução (entry == chamada direta COM os filtros e ≠ a SEM eles); o spec congelado não é mutado", () => {
  const cases: Array<[string, Any, Any]> = [
    ["metrics.query@1", SPECS["metrics.query@1"], { metricIds: ["netPnl", "totalTrades"] }],
    ["metrics.groups@1", { groupBy: ["hour"], metricIds: ["netPnl"], filters: { from: "2026-03-02", to: "2026-03-06" }, options: { pnlBasis: "GROSS" } }, { groupBy: ["hour"], metricIds: ["netPnl"] }],
    ["rank.groups@1", { groupBy: ["hour"], metric: "netPnl", order: "ASC", filters: { hour: [9, 14] } }, { groupBy: ["hour"], metric: "netPnl", order: "ASC" }],
    ["exit.breakdown@1", { filters: { session: "AM" } }, {}],
  ]
  for (const [cap, args, without] of cases) {
    const frozen = deepFreeze(clone(args))
    const s = seed(cap, W1N, "s2", frozen)
    const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2N, {}, frozen))
    okOf(out)
    const withF = CALL[cap](frozen, W2N.ctx), noF = CALL[cap](without, W2N.ctx)
    assert.deepEqual(out.entry.view, withF.entry.view, `${cap}: igual à chamada com os filtros`)
    assert.notDeepEqual(out.entry.view, noF.entry.view, `${cap}: os filtros fizeram diferença (premissa)`)
    assert.deepEqual(frozen, args, `${cap}: o spec não foi mutado`)
  }
})

test("RF9 — HONESTIDADE DO VEREDITO (desfecho ÚNICO, sem ramo): com arquivo e sal certo ⇒ VERIFIED; com sal ERRADO no regenerated o refresh NÃO recusa e devolve o handle honesto — verify VALID, source UNVERIFIABLE [S_ACCOUNT_REF_UNVERIFIED], combined NOT_VERIFIED, população {5, FULL}, entry presente — tudo == a chamada direta (o refresh não promove nada)", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1S)
  const good = okOf(evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2S)))
  assert.equal(good.evidence.verdict.combined, "VERIFIED")
  const wrong = world(SB, "s2", { source: { files: W2S.ctx.source.files, options: { accountRefSalt: SC } } })
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, wrong))
  const direct = CALL[cap](SPECS[cap], wrong.ctx)
  // desfecho único, medido em 16/10 (3 execuções): o refresh com sal errado NÃO recusa
  const r = okOf(out)
  assert.deepEqual(r.evidence.verdict, { verify: { status: "VALID", codes: [] }, source: { status: "UNVERIFIABLE", codes: ["S_ACCOUNT_REF_UNVERIFIED"] }, combined: "NOT_VERIFIED" })
  assert.deepEqual(r.limits.map((l: Any) => l.code), ["S_ACCOUNT_REF_UNVERIFIED"])
  assert.deepEqual(r.evidence.population, { declared: 5, verifiability: "FULL" })
  // == a chamada direta com o mesmo ctx (o oráculo): o refresh não promove, não esconde e não altera nada
  assert.deepEqual(r.evidence.verdict, direct.result.evidence.verdict)
  assert.deepEqual(r.evidence.population, direct.result.evidence.population)
  assert.deepEqual(r.limits, direct.result.limits)
  // a entry do ledger: capacidade ORIGINAL, handle CURRENT na época nova, idêntico ao da chamada direta
  assert.notEqual(out.entry, null)
  assert.equal(out.entry!.capability, cap)
  assert.equal(out.entry!.handle.freshness, "CURRENT")
  assert.equal(out.entry!.handle.refEpoch, "s2")
  assert.deepEqual(out.entry!.handle, direct.entry.handle)
  // controle: o caso 'sal certo' NÃO é o 'sal errado' (o teste não é vazio)
  assert.notEqual(good.evidence.verdict.source.status, r.evidence.verdict.source.status)
  assert.equal(good.evidence.verdict.source.status, "SOURCE_VERIFIED")
})

test("RF10 — E2E VERIFIED_PARTIAL (receita REAL, bundle montado à mão como no test-salt-policy-p4): assessBundle e evidenceExplain dão VERIFIED_PARTIAL + [S_POPULATION_PARTIAL, L_SALT_CHECK_DIVERGENT]; ledger → validateAnswer: sem a frase ⇒ MISSING_PARTIAL_PHRASE; com as frases ⇒ ok e o render traz os textos; frase fora dos codes ⇒ rejeitada", () => {
  const S1 = generateSalt(), S2 = generateSalt()
  const csv = synthCsv([
    { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${dd(2)} 09:00:00`, exitAt: `${dd(2)} 09:10:00`, exitLabel: "Stop1" },
    { account: "Conta B", entryPrice: 2000, exitPrice: 2004, entryAt: `${dd(3)} 09:00:00`, exitAt: `${dd(3)} 09:10:00`, exitLabel: "Target1" },
  ] as Any)
  const run = runImportPipeline(csv, { sourceTz: BRT, fileName: "p4.csv", accountRefSalt: S1 } as Any)
  const rec = run.importRecord as ImportRecord
  const T = toAnalyticsTrades(run.trades)
  const t = calculateMetricsTraced(T, { timeZone: BRT } as Any)
  const metric: Any = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [rec], opts: { accountRefSalt: S1 } } as Any)
  const bundle: Any = clone(metricEvidenceBundle(metric))
  for (const imp of bundle.evidence.imports) { imp.reproducibility.saltId = "s1"; imp.reproducibility.saltCheck = saltCheck(S2) }
  bundle.evidenceHash = computeEvidenceHash(bundle)
  const keyring = InMemorySaltKeyring.from([{ userId: "u1", saltId: "s1", salt: S1 }, { userId: "u1", saltId: "s2", salt: S2 }])
  const source = { files: { [rec.importId]: enc(csv) }, options: { salt: { provider: keyring, userId: "u1" } } } as Any
  const a: Any = assessBundle(bundle, { refEpoch: "s1", source })
  assert.equal(a.ok, true)
  assert.deepEqual([a.handle.verdict.verify.status, a.handle.verdict.source.status, a.handle.verdict.combined], ["VALID", "SOURCE_VERIFIED_PARTIAL", "VERIFIED_PARTIAL"])
  assert.deepEqual(a.limits.map((l: Any) => l.code), ["S_POPULATION_PARTIAL", "L_SALT_CHECK_DIVERGENT"])
  const ref = a.handle.evidenceRef
  const ex: Any = evidenceExplain({ evidenceRef: ref }, { refEpoch: "s1", source, bundleOf: (r: string) => (r === ref ? bundle : null) })
  assert.equal(ex.result.ok, true)
  assert.equal(ex.result.evidence.verdict.combined, "VERIFIED_PARTIAL", "uma capacidade REAL carrega o parcial")
  assert.deepEqual(ex.result.limits.map((l: Any) => l.code), ["S_POPULATION_PARTIAL", "L_SALT_CHECK_DIVERGENT"])
  const ledger: Any = (addEvidence((newLedger("s1") as Any).ledger, ex.entry) as Any).ledger
  const cref = ex.result.evidence.evidenceRef // E7-8: a entrada do explain é citada pelo ref DERIVADO da página, não pelo analítico
  assert.equal(cref, explainPageRef(ref, 1)); assert.notEqual(cref, ref)
  const segs = (extra: Any[]) => [{ kind: "text", text: "Trades:" }, { kind: "slot", ref: cref, path: "total" }, ...extra]
  const claims = [{ ref: cref, path: "total", mode: "ASSERT" }]
  const phrase = (code: string) => ({ kind: "phrase", code, ref: cref })
  const none = validateAnswer({ answer: { segments: segs([]), claims }, ledger, stop: null, question: "" }) as Any
  assert.equal(none.ok, false)
  assert.ok(none.reasons.includes("MISSING_PARTIAL_PHRASE"), JSON.stringify(none.reasons))
  const onlyOne = validateAnswer({ answer: { segments: segs([phrase("S_POPULATION_PARTIAL")]), claims }, ledger, stop: null, question: "" }) as Any
  assert.ok(onlyOne.reasons.includes("MISSING_PARTIAL_PHRASE"), "uma das duas frases não basta")
  const full = { segments: segs([phrase("S_POPULATION_PARTIAL"), phrase("L_SALT_CHECK_DIVERGENT")]), claims }
  const good = validateAnswer({ answer: full, ledger, stop: null, question: "" }) as Any
  assert.equal(good.ok, true, JSON.stringify(good))
  const rendered: Any = renderAnswer({ answer: full, ledger, notices: [], stop: null, question: "" })
  assert.equal(rendered.ok, true)
  const text = JSON.stringify(rendered.rendered)
  assert.ok(text.includes(PARTIAL_PHRASES.S_POPULATION_PARTIAL) && text.includes(PARTIAL_PHRASES.L_SALT_CHECK_DIVERGENT), "o render traz os textos canônicos")
  assert.equal(rendered.rendered.banner.combined, "VERIFIED_PARTIAL")
  const wrong = validateAnswer({ answer: { segments: segs([phrase("S_POPULATION_PARTIAL"), phrase("L_SALT_CHECK_DIVERGENT"), phrase("L_SALT_ID_NOT_RESOLVED")]), claims }, ledger, stop: null, question: "" }) as Any
  assert.equal(wrong.ok, false, "frase parcial que NÃO está nos codes do handle é rejeitada")
})

test("RF11 — CONTROLE NEGATIVO: métrica FULL + derivado HASH_ONLY no mesmo bundle ⇒ source PARTIAL mas verify UNVERIFIABLE ⇒ NOT_VERIFIED e S_HASH_ONLY, NUNCA VERIFIED_PARTIAL (fixa a receita refutada)", () => {
  const w = W1N
  const t = calculateMetricsTraced(w.ctx.trades, AN as Any)
  const mb: Any = clone(metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: w.ctx.trades, importRecords: w.ctx.importRecords } as Any) as Any))
  const e: Any = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "account" }, options: { ...AN, tradeIdsLimit: 3 } } as Any, trades: w.ctx.trades, importRecords: w.ctx.importRecords } as Any)
  const hb: Any = derivedEvidenceBundle(e)
  assert.equal(hb.evidence.derived[0].verifiability, "HASH_ONLY")
  mb.evidence.derived = [hb.evidence.derived[0]]
  mb.evidenceHash = computeEvidenceHash(mb)
  const a: Any = assessBundle(mb, { refEpoch: "s1", source: w.ctx.source })
  assert.equal(a.ok, true)
  assert.equal(a.handle.verdict.source.status, "SOURCE_VERIFIED_PARTIAL")
  assert.equal(a.handle.verdict.verify.status, "UNVERIFIABLE")
  assert.equal(a.handle.verdict.combined, "NOT_VERIFIED")
  assert.deepEqual(a.limits.map((l: Any) => l.code), ["S_HASH_ONLY"])
})

test("RF12 — ENVELOPE/CONTRATO: okResult(refresh, null, handle) é válido (data null, evidence sem hash); data ≠ null ⇒ ENGINE_REFUSED; o schema aceita refresh ok com data null e REJEITA refresh ok com data não nula ou sem evidence; as demais capacidades continuam exigindo data; PROMPT_VIEWS segue com as 7 chaves", () => {
  const out = CALL["metrics.query@1"](SPECS["metrics.query@1"], W1N.ctx)
  const handle = out.entry.handle
  const limits = out.result.limits
  const r: Any = okResult(REFRESH, null, handle, limits)
  assert.deepEqual(r, { contract: AGENT_CONTRACT_VERSION, capability: REFRESH, ok: true, data: null, evidence: handleView(handle), limits })
  assert.equal("evidenceHash" in r.evidence, false)
  assert.deepEqual(okResult(REFRESH, out.entry.view, handle, limits), err("ENGINE_REFUSED"))
  assert.deepEqual(okResult(REFRESH, {}, handle, limits), err("ENGINE_REFUSED"))
  assert.deepEqual(okResult("metrics.query@1", null, handle, limits), errorResult("metrics.query@1", "ENGINE_REFUSED"), "as demais continuam exigindo data")
  const schema = capabilityResultSchema(z.any())
  const base = { contract: AGENT_CONTRACT_VERSION, capability: REFRESH, ok: true, data: null, evidence: handleView(handle), limits: [] }
  assert.equal(schema.safeParse(base).success, true)
  assert.equal(schema.safeParse({ ...base, data: { x: 1 } }).success, false, "refresh ok com data não nula")
  assert.equal(schema.safeParse({ ...base, evidence: null }).success, false, "refresh ok sem evidence")
  assert.equal(schema.safeParse({ ...base, capability: "metrics.query@1" }).success, false, "metrics.query ok com data null")
  assert.equal(schema.safeParse({ ...base, capability: "metrics.query@1", data: { x: 1 } }).success, true)
  assert.equal(schema.safeParse({ contract: AGENT_CONTRACT_VERSION, capability: REFRESH, ok: false, data: null, evidence: null, limits: [], error: { code: "FILE_NOT_AVAILABLE" } }).success, true)
  assert.equal(schema.safeParse({ ...base, error: { code: "NOT_FOUND" } }).success, false, "ok=true não tem error")
  assert.deepEqual(Object.keys(PROMPT_VIEWS).sort(), CAPABILITY_IDS.filter((c) => c !== REFRESH).sort())
  assert.equal(Object.keys(PROMPT_VIEWS).length, 7)
})

test("RF13 — PUREZA: ctx, ledger e spec congelados fundo ⇒ nada lança e a saída é a mesma; determinística; JSON do result sem tradeId/rowNo/rowHash/hash completo/sal/nome do arquivo; ctx hostil (proxy que lança, getters que lançam) ⇒ ENGINE_REFUSED sem lançar", () => {
  const cap = "metrics.groups@1"
  const s = seed(cap, W1S)
  const c = rctx(s, cap, W2S)
  const first = evidenceRefresh({ evidenceRef: s.ref }, c)
  const frozenCtx = deepFreeze({ ledger: clone(s.ledger), specOf: c.specOf, regenerated: { ...clone({ ...W2S.ctx, source: null }), source: W2S.ctx.source } })
  const second = evidenceRefresh(deepFreeze({ evidenceRef: s.ref }), frozenCtx)
  assert.deepEqual(second.result, first.result)
  assert.deepEqual(second.entry, first.entry)
  assert.deepEqual(evidenceRefresh({ evidenceRef: s.ref }, c).result, first.result, "determinística")
  const json = JSON.stringify(first.result)
  assert.equal(/tradeId|rowNo|rowHash|evidenceHash|refresh\.csv|Sim10/.test(json), false)
  assert.equal(json.includes(SA) || json.includes(SB), false, "o sal nunca sai")
  assert.equal(/[0-9a-f]{64}/.test(json), false, "nenhum hash completo")
  const hostile = [
    new Proxy({}, { get() { throw new Error("x") }, has() { throw new Error("x") }, ownKeys() { throw new Error("x") } }),
    { get ledger() { throw new Error("x") } },
    { ledger: s.ledger, get specOf() { throw new Error("x") }, regenerated: W2S.ctx },
    { ledger: s.ledger, specOf: c.specOf, get regenerated() { throw new Error("x") } },
  ]
  for (const [i, h] of hostile.entries()) assert.deepEqual(evidenceRefresh({ evidenceRef: s.ref }, h).result, err("ENGINE_REFUSED"), `hostil ${i}`)
})

// ── ledger.refreshEvidence ───────────────────────────────────────────────────
test("LR1 — ref NOVO: adiciona e mantém a antiga STALE; entradas e ledger devolvidos são congelados; o ledger de entrada não muda", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1S)
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2S))
  const before = JSON.stringify(s.ledger)
  const m: Any = refreshEvidence(s.ledger, out.entry)
  assert.equal(m.ok, true)
  assert.equal(JSON.stringify(s.ledger), before)
  assert.equal(Object.isFrozen(m.ledger) && Object.isFrozen(m.ledger.entries) && Object.isFrozen(lookupRef(m.ledger, out.entry.handle.evidenceRef)), true)
  assert.equal(m.ledger.epoch, "s2")
  assert.deepEqual(lookupRef(m.ledger, s.ref), lookupRef(s.ledger, s.ref), "a antiga ficou como estava")
})

test("LR2 — MESMO ref STALE da MESMA capability ⇒ substitui no lugar (handle novo CURRENT); capability DIFERENTE com o mesmo ref ⇒ LEDGER_CONFLICT (D12-12)", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2N))
  const m: Any = refreshEvidence(s.ledger, out.entry)
  assert.equal(m.ok, true)
  assert.equal(Object.keys(m.ledger.entries).length, 1)
  assert.equal(lookupRef(m.ledger, s.ref)!.handle.refEpoch, "s2")
  const other = exitBreakdown({}, W2N.ctx)
  const forged = { capability: "exit.breakdown@1", handle: out.entry.handle, view: other.entry.view }
  assert.deepEqual(refreshEvidence(s.ledger, forged), { ok: false, code: "LEDGER_CONFLICT" })
})

test("LR3 — ref JÁ CURRENT: idêntico ⇒ ok sem mudança; diferente (mesmo ref, veredito diferente) ⇒ LEDGER_CONFLICT; o addEvidence segue intocado (mesmo conflito)", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2N))
  const m1: Any = refreshEvidence(s.ledger, out.entry)
  const again: Any = refreshEvidence(m1.ledger, out.entry)
  assert.equal(again.ok, true)
  assert.equal(JSON.stringify(again.ledger), JSON.stringify(m1.ledger))
  const noFile = metricsQuery(SPECS[cap], { ...W2N.ctx, source: undefined }) as Any
  assert.equal(noFile.entry.handle.evidenceRef, s.ref, "premissa: sem arquivo o ref é o mesmo; só o veredito muda")
  assert.notEqual(noFile.entry.handle.verdict.combined, out.entry.handle.verdict.combined)
  assert.deepEqual(refreshEvidence(m1.ledger, noFile.entry), { ok: false, code: "LEDGER_CONFLICT" })
  assert.deepEqual(addEvidence(m1.ledger, noFile.entry), { ok: false, code: "LEDGER_CONFLICT" })
})

test("LR4 — entrada inválida ⇒ LEDGER_ENTRY_INVALID: época errada, freshness STALE, view fora do schema, capability refresh/desconhecida, não-objeto, handle ausente; nada lança", () => {
  const cap = "metrics.query@1"
  const s = seed(cap, W1N)
  const out = evidenceRefresh({ evidenceRef: s.ref }, rctx(s, cap, W2N))
  const good = out.entry
  const INVALID = { ok: false, code: "LEDGER_ENTRY_INVALID" }
  assert.deepEqual(refreshEvidence(s.ledger, s.out.entry), INVALID, "entrada da época ANTIGA (refEpoch s1 num ledger s2)")
  assert.deepEqual(refreshEvidence(s.ledger, { ...good, handle: { ...good.handle, freshness: "STALE" } }), INVALID)
  assert.deepEqual(refreshEvidence(s.ledger, { ...good, view: { metrics: "x" } }), INVALID)
  assert.deepEqual(refreshEvidence(s.ledger, { ...good, capability: REFRESH }), INVALID)
  assert.deepEqual(refreshEvidence(s.ledger, { ...good, capability: "x@1" }), INVALID)
  assert.deepEqual(refreshEvidence(s.ledger, { ...good, handle: undefined }), INVALID)
  for (const bad of [null, undefined, 5, "x", []]) assert.deepEqual(refreshEvidence(s.ledger, bad), INVALID, String(bad))
})

test("RF14 — E7-8: entrada STALE cuja capability é evidence.explain@1 (ref derivado de página) ⇒ ARGS_INVALID ANTES de consultar a spec (spec nula, ausente, que lança ou analítica não muda o resultado); a entrada analítica sem spec segue FILE_NOT_AVAILABLE", () => {
  const s = seed("metrics.query@1", W1N)
  const L: Any = clone(s.ledger); L.entries[s.ref].capability = "evidence.explain@1"
  for (const specOf of [() => null, undefined, () => { throw new Error("x") }, () => ({ capability: "metrics.query@1", args: SPECS["metrics.query@1"] })]) {
    assert.deepEqual(evidenceRefresh({ evidenceRef: s.ref }, { ledger: L, specOf, regenerated: W2N.ctx } as Any).result, err("ARGS_INVALID"))
  }
  assert.deepEqual(evidenceRefresh({ evidenceRef: s.ref }, { ledger: s.ledger, specOf: () => null, regenerated: W2N.ctx } as Any).result, err("FILE_NOT_AVAILABLE"), "analítica sem spec: inalterado")
})

if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes ok`)
