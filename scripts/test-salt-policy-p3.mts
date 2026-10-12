// Política de sal — P3: PRODUTOR (pipeline com sal gerenciado) + TRAVA de geração (E_SALT_REQUIRED / E_SALT_MISMATCH). Expectativas:
// scripts/expectations/salt-policy.expected.json (generation_cases G1–G6, guard_cases GD2). Ponta a ponta com o leitor do P4.
//   node scripts/test-salt-policy-p3.mts
import assert from "node:assert/strict"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { explainTrade, explainTrades } from "../src/lib/evidence/explain-trade.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource, type VerifySourceOptions } from "../src/lib/evidence/verify-source.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { InMemorySaltKeyring, generateSalt, saltCheck } from "../src/lib/ingest/salt.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const d = (n: number) => `${String(n).padStart(2, "0")}/03/2026`
const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }]
const csvOf = (free: boolean) => synthCsv([
  { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${d(2)} 09:00:00`, exitAt: `${d(2)} 09:10:00`, exitLabel: free ? "meu stop 1" : "Stop1" },
  { account: "Conta B", entryPrice: 2000, exitPrice: 2004, entryAt: `${d(3)} 09:00:00`, exitAt: `${d(3)} 09:10:00`, exitLabel: free ? "Meu Setup X" : "Target1" },
])
type Kind = "metric" | "derived" | "rows"
interface Combo { free: boolean; mapped: boolean; kind: Kind }
const COMBOS: Combo[] = []
for (const kind of ["metric", "derived", "rows"] as const) for (const free of [false, true]) for (const mapped of [false, true]) COMBOS.push({ free, mapped, kind })
const nm = (c: Combo) => `${c.kind.padEnd(7)} rótulo=${c.free ? "livre " : "padrão"} mapa=${String(c.mapped).padEnd(5)}`
const fresh = (): InMemorySaltKeyring => { const k = new InMemorySaltKeyring(); k.ensure("u1"); return k }
const importVia = (c: Combo, kr: InMemorySaltKeyring, userId = "u1") => {
  const csv = csvOf(c.free)
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p3.csv", salt: { provider: kr, userId }, ...(c.mapped ? { exitReasonMap: MAP } : {}) })
  return { csv, run, record: run.importRecord as ImportRecord | null }
}
type Gen = ReturnType<typeof explainMetric> | ReturnType<typeof explainDerived>
function generate(c: Combo, run: Any, record: ImportRecord, saltOpts: { accountRefSalt?: string } | undefined): { ok: boolean; message?: string; bundle?: Any } {
  const T = toAnalyticsTrades(c.kind === "rows" ? run.rowTrades : run.trades)
  const opts = saltOpts ? { opts: saltOpts } : {}
  let r: Gen
  if (c.kind === "derived") r = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "account" }, options: { timeZone: "America/Sao_Paulo", minSample: 1 } }, trades: T, importRecords: [record], ...opts })
  else {
    const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
    r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], ...opts })
  }
  if (!(r as Any).ok) return { ok: false, message: (r as Any).message }
  return { ok: true, bundle: c.kind === "derived" ? derivedEvidenceBundle(r as Any) : metricEvidenceBundle(r as Any) }
}
const vopts = (c: Combo, kr: InMemorySaltKeyring, userId = "u1"): VerifySourceOptions => ({ salt: { provider: kr, userId }, ...(c.mapped ? { exitReasonMap: MAP } : {}) })

test("PRODUTOR — import com sal gerenciado: grava saltId (do sal atual) e saltCheck (nunca o valor); accountRefSalted=true; ids determinísticos; importId/rowHash/tradeId iguais aos de um import com a MESMA string de sal", () => {
  const kr = fresh(); const cur = kr.current("u1")!
  const { csv, run, record } = importVia({ free: true, mapped: true, kind: "metric" }, kr)
  assert.ok(record)
  assert.equal(record!.reproducibility!.saltId, "s1"); assert.equal(record!.reproducibility!.saltCheck, saltCheck(cur.salt)); assert.equal(record!.reproducibility!.accountRefSalted, true)
  assert.equal(JSON.stringify(record).includes(cur.salt), false, "o valor do sal não está no registro")
  const legacy = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p3.csv", accountRefSalt: cur.salt, exitReasonMap: MAP })
  assert.equal(legacy.importRecord!.importId, record!.importId, "importId igual: a política não muda a identidade")
  assert.deepEqual(legacy.trades.map((t) => t.tradeId), run.trades.map((t) => t.tradeId)); assert.deepEqual(legacy.rowTrades.map((t) => t.tradeId), run.rowTrades.map((t) => t.tradeId))
  assert.equal("saltId" in (legacy.importRecord!.reproducibility as Any), false, "caminho legado (string) não declara saltId")
})

test("PRODUTOR (fail-closed) — sem sal atual ⇒ o import FALHA com E_SALT_REQUIRED: usuário sem chaveiro, usuário com último sal aposentado (sem cura silenciosa); ctx.salt + accountRefSalt ⇒ E_SALT_CONFLICT; nenhum registro é produzido", () => {
  const csv = csvOf(false)
  const none = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", salt: { provider: new InMemorySaltKeyring(), userId: "ninguem" } })
  assert.equal(none.importRecord, null); assert.ok(none.issues.some((i) => i.code === "E_SALT_REQUIRED"))
  const retired = InMemorySaltKeyring.from([{ userId: "u", saltId: "s1", salt: generateSalt() }, { userId: "u", saltId: "s2", salt: null }])
  const r2 = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", salt: { provider: retired, userId: "u" } })
  assert.equal(r2.importRecord, null); assert.ok(r2.issues.some((i) => i.code === "E_SALT_REQUIRED")); assert.equal(retired.current("u"), null, "o import não recriou sal")
  const both = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", salt: { provider: fresh(), userId: "u1" }, accountRefSalt: generateSalt() })
  assert.equal(both.importRecord, null); assert.ok(both.issues.some((i) => i.code === "E_SALT_CONFLICT"))
  const weak = { current: () => ({ saltId: "s1", salt: "fraco" }), get: () => ({ status: "UNKNOWN" as const, saltId: "s1" }), known: () => [] }
  const r3 = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", salt: { provider: weak, userId: "u" } })
  assert.equal(r3.importRecord, null); assert.ok(r3.issues.some((i) => i.code === "E_SALT_WEAK")); assert.equal(JSON.stringify(r3.issues).includes("fraco"), false)
})

test("G1 — import salgado (gerenciado), gerar Evidence SEM sal ⇒ erro E_SALT_REQUIRED em explainTrade/explainTrades e (via E_TRADE_EXPLAIN_FAILED) em explainMetric/explainDerived; NENHUM bundle", () => {
  for (const c of COMBOS) {
    const { run, record } = importVia(c, fresh())
    const t = (c.kind === "rows" ? run.rowTrades : run.trades)[0]
    const one = explainTrade(t, record!, {}); assert.equal(one.ok, false); assert.equal((one as Any).code, "E_SALT_REQUIRED")
    assert.equal(explainTrade(t, record!, { accountRefSalt: "" }).ok, false, "sal vazio também é recusado")
    assert.ok(explainTrades(run.trades, record!, {}).every((r) => !r.ok && (r as Any).code === "E_SALT_REQUIRED"))
    const g = generate(c, run, record!, undefined)
    assert.equal(g.ok, false, nm(c)); assert.match(g.message!, /E_SALT_REQUIRED/); assert.equal(g.bundle, undefined)
  }
})

test("G2 — sal ERRADO (outro sal forte, sal fraco, sal do outro usuário) ⇒ E_SALT_MISMATCH; a mensagem não contém nenhum dos sais; nenhum bundle", () => {
  const kr = fresh(); const other = fresh(); const own = kr.current("u1")!.salt, foreign = other.current("u1")!.salt
  for (const c of COMBOS) {
    const { run, record } = importVia(c, kr)
    for (const wrong of [generateSalt(), foreign, "meusal123", own.toUpperCase(), own.slice(0, 32)]) {
      const g = generate(c, run, record!, { accountRefSalt: wrong })
      assert.equal(g.ok, false, `${nm(c)} ${wrong.slice(0, 6)}`); assert.match(g.message!, /E_SALT_MISMATCH/)
      for (const s of [own, foreign, wrong]) assert.equal(g.message!.includes(s.slice(0, 12)), false, "mensagem vaza sal")
    }
  }
})

test("G3 + PONTA A PONTA — sal CERTO ⇒ bundle com saltId/saltCheck no ImportRef; V0–V6 VALID; E5b com o provider SOURCE_VERIFIED (métrica/derivado/linhas × rótulo × mapa); sem o provider ⇒ UNVERIFIABLE; sem o valor do sal em lugar nenhum", () => {
  const rows: string[] = []
  for (const c of COMBOS) {
    const kr = fresh(); const cur = kr.current("u1")!
    const { csv, run, record } = importVia(c, kr)
    const g = generate(c, run, record!, { accountRefSalt: cur.salt })
    assert.equal(g.ok, true, `${nm(c)} ${g.message}`)
    const imp = g.bundle.evidence.imports[0].reproducibility
    assert.equal(imp.saltId, "s1"); assert.equal(imp.saltCheck, saltCheck(cur.salt))
    assert.equal(verifyEvidence(g.bundle).status, "VALID", nm(c))
    const files = { [record!.importId]: new TextEncoder().encode(csv) }
    const r = verifyEvidenceSource(g.bundle, files, vopts(c, kr))
    assert.equal(r.status, "SOURCE_VERIFIED", `${nm(c)} ${JSON.stringify(r.checks.filter((x) => x.status !== "PASS"))}`)
    assert.equal(verifyEvidenceSource(g.bundle, files, c.mapped ? { exitReasonMap: MAP } : {}).status, "UNVERIFIABLE", "sem provider/string")
    for (const out of [JSON.stringify(g.bundle), JSON.stringify(r)]) { assert.equal(out.includes(cur.salt), false); assert.equal(out.includes(cur.salt.slice(0, 16)), false) }
    rows.push(`    ${nm(c)} → gerado c/ s1 · V0–V6 VALID · E5b SOURCE_VERIFIED`)
  }
  console.log(rows.join("\n"))
})

test("ROTAÇÃO ponta a ponta — import 1 sob s1; rotate; import 2 sob s2: gerar o 2º com o sal do s1 ⇒ E_SALT_MISMATCH; ambos os bundles verificam com o chaveiro; aposentar o s1 ⇒ o antigo UNVERIFIABLE (S_SALT_RETIRED) e o novo segue", () => {
  const c: Combo = { free: true, mapped: true, kind: "metric" }
  const kr = fresh(); const s1 = kr.current("u1")!.salt
  const a = importVia(c, kr); kr.rotate("u1"); const s2 = kr.current("u1")!
  const b = importVia(c, kr)
  assert.equal(a.record!.reproducibility!.saltId, "s1"); assert.equal(b.record!.reproducibility!.saltId, "s2")
  assert.notEqual(a.record!.reproducibility!.saltCheck, b.record!.reproducibility!.saltCheck)
  assert.equal(generate(c, b.run, b.record!, { accountRefSalt: s1 }).message?.includes("E_SALT_MISMATCH"), true)
  const ga = generate(c, a.run, a.record!, { accountRefSalt: s1 }), gb = generate(c, b.run, b.record!, { accountRefSalt: s2.salt })
  assert.ok(ga.ok && gb.ok)
  const fa = { [a.record!.importId]: new TextEncoder().encode(a.csv) }, fb = { [b.record!.importId]: new TextEncoder().encode(b.csv) }
  assert.equal(verifyEvidenceSource(ga.bundle, fa, vopts(c, kr)).status, "SOURCE_VERIFIED"); assert.equal(verifyEvidenceSource(gb.bundle, fb, vopts(c, kr)).status, "SOURCE_VERIFIED")
  kr.retire("u1", "s1")
  const old = verifyEvidenceSource(ga.bundle, fa, vopts(c, kr))
  assert.equal(old.status, "UNVERIFIABLE"); assert.ok(old.checks.some((x) => x.code === "S_SALT_RETIRED"))
  assert.equal(verifyEvidenceSource(gb.bundle, fb, vopts(c, kr)).status, "SOURCE_VERIFIED")
})

test("G4/G5/G6 — import SEM sal e import LEGADO (string, sem saltCheck): sem trava, sem saltId; o gerador funciona como sempre (inclusive a lacuna conhecida do legado: sal esquecido não é recusado — não há saltCheck para conferir)", () => {
  for (const c of COMBOS) {
    const csv = csvOf(c.free)
    const plain = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p3.csv", ...(c.mapped ? { exitReasonMap: MAP } : {}) })
    assert.equal("saltId" in (plain.importRecord!.reproducibility as Any), false)
    const gp = generate(c, plain, plain.importRecord as ImportRecord, undefined)
    assert.equal(gp.ok, true, nm(c)); assert.equal(JSON.stringify(gp.bundle).includes("saltId"), false)
    const salt = generateSalt()
    const leg = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "p3.csv", accountRefSalt: salt, ...(c.mapped ? { exitReasonMap: MAP } : {}) })
    assert.equal("saltCheck" in (leg.importRecord!.reproducibility as Any), false)
    assert.equal(generate(c, leg, leg.importRecord as ImportRecord, { accountRefSalt: salt }).ok, true, "legado com sal")
    assert.equal(generate(c, leg, leg.importRecord as ImportRecord, undefined).ok, true, "legado com sal esquecido: gera (lacuna conhecida do legado, pista no E5b)")
    assert.equal(JSON.stringify(gp.bundle).includes("E_SALT"), false)
  }
})

test("GD2 — o wrapper/alias que esquece o sal ou passa o sal errado num import GERENCIADO falha em RUNTIME (cobre os falsos-negativos 1 e 2 do guarda estático, só para imports novos)", () => {
  const c: Combo = { free: true, mapped: true, kind: "metric" }
  const kr = fresh(); const { run, record } = importVia(c, kr)
  const wrapper = (opts: Any) => generate(c, run, record!, opts) // um "wrapper" qualquer, com nome fora de qualquer lista
  const withOpts = (accountRefSalt: string | undefined) => wrapper({ accountRefSalt, someOtherOpt: true })
  assert.equal(wrapper(undefined).ok, false); assert.equal(withOpts(undefined).ok, false); assert.equal(withOpts(generateSalt()).ok, false)
  assert.equal(withOpts(kr.current("u1")!.salt).ok, true)
})

console.log(`\n${passed} testes ok`)
