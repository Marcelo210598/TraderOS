// Evidence — ordem da sequência (empates de saída/entrada) registrada na Evidence e reproduzida pelo verificador.   node scripts/test-evidence-sequence.mts
// Princípio: o motor NÃO mudou (baseline congelado de antes da mudança, em fixtures/_synthetic/engine-baseline-pre-sequence.json);
// a Evidence só registra, como subproduto do trace, a ordem que o motor usou, e o verificador alimenta o MESMO motor com ela.
// Oráculos de drawdown/sequência: tabelas escritas à mão (centavos), não o motor.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import type { EvidenceBundle } from "../src/lib/evidence/schema.ts"
import { verifyEvidence, type VerifyReport } from "../src/lib/evidence/verify.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { SEQUENCE_METRICS } from "../src/lib/metrics/sequence.ts"
import { METRIC_IDS, aggregateTrades, aggregateTradesTraced, calculateMetrics, calculateMetricsTraced, toAnalyticsTrades, type AnalyticsTrade } from "../src/lib/metrics/index.ts"
import { synthCsv, withRisk } from "./_evidence-fixtures.mts"

const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// ── dados sintéticos (MGC, US$ 10/ponto, comissão US$ 2,40, 1 contrato ⇒ net = 10·pts − 2,40) ─────────────────────────
const dd = (i: number, h: number, m = 0) => `${String(2 + (i % 9)).padStart(2, "0")}/03/2026 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
const TIE_EXIT = "20/03/2026 12:00:00"
interface Spec { pts: number[]; exit: (i: number) => string; entry: (i: number) => string; account?: (i: number) => string }
function importOf(spec: Spec, name: string, risk = true) {
  const rows = spec.pts.map((p, i) => ({ account: spec.account ? spec.account(i) : "Sim101", entryPrice: 2000, exitPrice: 2000 + p, entryAt: spec.entry(i), exitAt: spec.exit(i) }))
  const run = runImportPipeline(synthCsv(rows), { sourceTz: BRT, fileName: `${name}.csv`, reconstructCycles: false })
  // stop 10 pts atrás da entrada ⇒ risco US$ 100 ⇒ R_i = net_i / 100
  return { trades: toAnalyticsTrades(risk ? withRisk(run.trades, [10]) : run.trades), record: run.importRecord as ImportRecord }
}
const exitTie = (pts: number[], account?: (i: number) => string) => importOf({ pts, exit: () => TIE_EXIT, entry: (i) => dd(i, 9 + (i % 4)), account }, `tie-${pts.join(",")}`)

function bundleOf(metricId: string, d: { trades: AnalyticsTrade[]; record: ImportRecord }, args: Parameters<typeof calculateMetricsTraced>[1] = {}): EvidenceBundle {
  const { result, trace } = calculateMetricsTraced(d.trades, args)
  const r = explainMetric({ metricId, source: { kind: "METRICS", result, trace }, trades: d.trades, importRecords: [d.record] })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
function groupBundleOf(by: string, index: number, metricId: string, d: { trades: AnalyticsTrade[]; record: ImportRecord }): EvidenceBundle {
  const ag = aggregateTradesTraced(d.trades, { groupBy: by as Any })
  const r = explainMetric({ metricId, source: { kind: "AGGREGATE", result: ag.result, trace: ag.trace, scope: { kind: "GROUP", index } }, trades: d.trades, importRecords: [d.record] })
  assert.equal(r.ok, true, r.ok ? "" : (r as Any).message)
  return metricEvidenceBundle(r as Any)
}
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const edit = (b: EvidenceBundle, fn: (x: Any) => void, sealed = true): Any => {
  const c = clone(b) as Any
  fn(c)
  return sealed ? reseal(c) : c
}
const check = (rep: VerifyReport, id: string) => {
  const c = rep.checks.find((x) => x.id === id)
  assert.ok(c, `check ${id} ausente`)
  return c
}
const fails = (rep: VerifyReport) => rep.checks.filter((c) => c.status === "FAIL").map((c) => c.id)
const seqOf = (b: Any) => b.evidence.metrics[0].population.sequence as { dependent: boolean; order: string[] | null }
const ids = (d: { trades: AnalyticsTrade[] }) => d.trades.map((t) => t.id)

// A: vencedor/perdedor… em ordem de entrada dos dados, TODAS as saídas no mesmo instante.
//   net  = [27,60 · −22,40 · −22,40 · 37,60 · −12,40]   equity = [27,60 · 5,20 · −17,20 · 20,40 · 8,00]
//   pico 27,60 → fundo −17,20 (3º trade) ⇒ maxDrawdown 44,80 (R 0,448) · perdedores seguidos 2 · vencedores seguidos 1 · atual −1 (perdedor)
// B: o MESMO conjunto com os 2 primeiros trocados na ENTRADA dos dados (nada mais muda):
//   net = [−22,40 · 27,60 · −22,40 · 37,60 · −12,40]    equity = [−22,40 · 5,20 · −17,20 · 20,40 · 8,00]
//   pico 0 → −22,40 (1º) ⇒ maxDrawdown 22,40 (R 0,224) · perdedores seguidos 1 · vencedores seguidos 1 · atual −1
const PTS_A = [3, -2, -2, 4, -1]
const PTS_B = [-2, 3, -2, 4, -1]
const A = exitTie(PTS_A)
const B = exitTie(PTS_B)

// ── 0. o motor não mudou ─────────────────────────────────────────────────────

const baseline = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/engine-baseline-pre-sequence.json", import.meta.url)), "utf8")) as Record<string, string>
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")

test("NÃO REGRESSÃO: calculateMetrics/aggregateTrades dão EXATAMENTE os mesmos resultados de antes (baseline pré-mudança, 120 hashes: empates de saída/entrada, 3 ordens de entrada, com/sem R, 4 agrupamentos)", () => {
  const pts = [4, 3, -2, -3, -1, 6, 0, 2, -4, 5, 1, -1, 7, 3, -5, -2, 2, 2, -1, 3]
  const mk = (exit: (i: number) => string, entry: (i: number) => string) => pts.map((p, i) => ({ account: i % 3 ? "Sim101" : "Sim102", entryPrice: 2000, exitPrice: 2000 + p, entryAt: entry(i), exitAt: exit(i) }))
  const sets: Record<string, ReturnType<typeof mk>> = {
    exitTie: mk(() => "20/03/2026 12:00:00", (i) => dd(i, 9 + (i % 4))),
    entryTie: mk((i) => dd(i, 10, 10 + (i % 5)), () => "10/03/2026 09:00:00"),
    pairsTie: mk((i) => dd(Math.floor(i / 2), 10 + Math.floor(i / 8), 10), (i) => dd(i, 9)),
    noTie: mk((i) => dd(i, 10 + (i % 5), i), (i) => dd(i, 9)),
  }
  const got: Record<string, string> = {}
  for (const [k, rows] of Object.entries(sets)) {
    const run = runImportPipeline(synthCsv(rows), { sourceTz: BRT, fileName: `${k}.csv`, reconstructCycles: false })
    for (const risk of [false, true]) {
      const T = toAnalyticsTrades(risk ? withRisk(run.trades) : run.trades)
      ;[T, [...T].reverse(), [...T].sort((a, b) => (a.trade.pnl.net ?? 0) - (b.trade.pnl.net ?? 0))].forEach((v, n) => {
        got[`${k}/${risk}/${n}/total`] = sha(calculateMetrics(v))
        for (const by of ["account", "direction", "hour", ["account", "hour"]] as Any[]) got[`${k}/${risk}/${n}/${JSON.stringify(by)}`] = sha(aggregateTrades(v, { groupBy: by }))
      })
    }
  }
  assert.equal(Object.keys(baseline).length, 120)
  assert.deepEqual(got, baseline)
})

test("NÃO REGRESSÃO: o resultado do caminho traced é idêntico ao de calculateMetrics/aggregateTrades (o trace só observa)", () => {
  for (const d of [A, B]) {
    assert.deepEqual(calculateMetricsTraced(d.trades).result, calculateMetrics(d.trades))
    assert.deepEqual(aggregateTradesTraced(d.trades, { groupBy: "hour" }).result, aggregateTrades(d.trades, { groupBy: "hour" }))
  }
})

// ── 1–5. oráculo à mão: empate de saída, drawdown, drawdown em R, sequências ─────────────────────────────

test("EMPATE DE SAÍDA: o motor desempata pela ordem de entrada dos dados (oráculo à mão) — e a ordem de entrada muda drawdown e sequências", () => {
  assert.equal(new Set(A.trades.map((t) => t.trade.exit.at.instantUtc)).size, 1)
  const ma = calculateMetrics(A.trades).metrics
  const mb = calculateMetrics(B.trades).metrics
  assert.equal(ma.maxDrawdown.value, 44.8)
  assert.equal(ma.maxDrawdownR.value, 0.448)
  assert.equal(ma.maxConsecutiveLosses.value, 2)
  assert.equal(ma.maxConsecutiveWins.value, 1)
  assert.equal(ma.currentStreak.value, -1)
  assert.equal(mb.maxDrawdown.value, 22.4)
  assert.equal(mb.maxDrawdownR.value, 0.224)
  assert.equal(mb.maxConsecutiveLosses.value, 1)
  assert.equal(mb.maxConsecutiveWins.value, 1)
  // o conjunto é o mesmo: tradeSetHash NÃO depende da ordem
  assert.equal(calculateMetrics(A.trades).population.tradeSetHash.length, 64)
})

test("ENTRADAS COM O MESMO HORÁRIO e saídas distintas: a ordem é a das saídas; o bundle registra essa ordem e é VALID", () => {
  const E = importOf({ pts: [3, -2, -2, 4, -1], entry: () => "10/03/2026 09:00:00", exit: (i) => dd(0, 10, 50 - 10 * i) }, "entrada-igual")
  // saídas em ordem DECRESCENTE de horário (10:50, 10:40, …): a sequência é a INVERSA da entrada dos dados
  const exits = E.trades.map((t) => t.trade.exit.at.instantUtc as string)
  assert.deepEqual([...exits].sort(), [...exits].reverse())
  for (const id of SEQUENCE_METRICS) {
    const b = bundleOf(id, E)
    assert.deepEqual(seqOf(b).order, [...ids(E)].reverse(), id)
    const rep = verifyEvidence(b)
    assert.equal(rep.status, "VALID", `${id}: ${JSON.stringify(rep.checks.filter((c) => c.status !== "PASS" && c.code !== "S_NOT_APPLICABLE"))}`)
    assert.equal(check(rep, "V4.sequence").status, "PASS")
  }
})

test("REGISTRO: a ordem do bundle = a ordem de entrada dos dados em empate (≠ ordem por tradeId); só em métrica sequencial; população inteira", () => {
  for (const d of [A, B]) {
    for (const id of METRIC_IDS) {
      const s = seqOf(bundleOf(id, d))
      if ((SEQUENCE_METRICS as readonly string[]).includes(id)) {
        assert.equal(s.dependent, true, id)
        assert.deepEqual(s.order, ids(d), id)
      } else assert.deepEqual(s, { dependent: false, order: null }, id)
    }
    assert.notDeepEqual([...ids(d)].sort(), ids(d), "a ordem registrada não pode coincidir por acaso com a ordem por tradeId")
  }
  // o trace do motor é a fonte: mesma lista
  assert.deepEqual(calculateMetricsTraced(A.trades).trace.sequence, ids(A))
  assert.deepEqual(calculateMetricsTraced(B.trades).trace.sequence, ids(B))
})

test("VERIFICADOR: reproduz drawdown, drawdown em R e sequências (oráculo) a partir da ordem registrada ⇒ VALID, V4.sequence PASS", () => {
  const oracle: Array<[string, Any, Any]> = [
    ["maxDrawdown", 44.8, 22.4],
    ["maxDrawdownR", 0.448, 0.224],
    ["maxConsecutiveLosses", 2, 1],
    ["maxConsecutiveWins", 1, 1],
    ["currentStreak", -1, -1],
  ]
  for (const [id, va, vb] of oracle) {
    for (const [d, want] of [[A, va], [B, vb]] as const) {
      const b = bundleOf(id, d)
      assert.equal(b.evidence.metrics[0].value, want, `${id} declarado`)
      const rep = verifyEvidence(b)
      assert.equal(rep.status, "VALID", `${id}: ${JSON.stringify(rep.checks.filter((c) => c.status !== "PASS" && c.code !== "S_NOT_APPLICABLE"))}`)
      assert.equal(check(rep, "V4.sequence").status, "PASS")
      assert.match(check(rep, "V4.sequence").detail, /desempate dos instantes iguais/)
    }
  }
  for (const id of ["currentDrawdown", "recoveryFactor"]) assert.equal(verifyEvidence(bundleOf(id, A)).status, "VALID", id) // sequenciais sem contribuintes
})

test("MÉTRICA NÃO SEQUENCIAL: V4.sequence é NOT_APPLICABLE e não impede VALID", () => {
  const rep = verifyEvidence(bundleOf("netPnl", A))
  assert.equal(rep.status, "VALID")
  assert.equal(check(rep, "V4.sequence").code, "S_NOT_APPLICABLE")
})

// ── 6. agrupamentos ──────────────────────────────────────────────────────────

test("GRUPOS: a ordem de cada grupo é a do PRÓPRIO grupo (subsequência da total), reproduzida pelo verificador", () => {
  const G = exitTie([3, -2, -2, 4, -1, 2, -3, 1], (i) => (i % 2 ? "Sim102" : "Sim101"))
  const total = calculateMetricsTraced(G.trades).trace.sequence
  assert.deepEqual(total, ids(G))
  const ag = aggregateTradesTraced(G.trades, { groupBy: "account" })
  assert.equal(ag.result.groups.length, 2)
  ag.result.groups.forEach((_, gi) => {
    const gSeq = ag.trace.groups[gi].trace.sequence
    assert.equal(gSeq.length, ag.result.groups[gi].metrics.totalTrades.value)
    assert.deepEqual(gSeq, total.filter((id) => gSeq.includes(id))) // subsequência da ordem total, mesma ordem relativa
    for (const id of SEQUENCE_METRICS) {
      const b = groupBundleOf("account", gi, id, G)
      assert.deepEqual(seqOf(b).order, gSeq, `${id} grupo ${gi}`)
      const rep = verifyEvidence(b)
      assert.equal(rep.status, "VALID", `${id} grupo ${gi}: ${JSON.stringify(rep.checks.filter((c) => c.status !== "PASS" && c.code !== "S_NOT_APPLICABLE"))}`)
      assert.equal(check(rep, "V4.sequence").status, "PASS")
    }
  })
  // grupo cuja ordem registrada é trocada (selo refeito) é acusado
  const b = groupBundleOf("account", 0, "maxDrawdown", G)
  const swapped = edit(b, (x) => { const o = x.evidence.metrics[0].population.sequence.order; [o[0], o[1]] = [o[1], o[0]] })
  assert.equal(verifyEvidence(swapped).status, "TAMPERED")
})

// ── 7. reconstrução da ordem pelo verifyEvidence + 8. ordem adulterada com selo refeito ────────────────────────

test("ADULTERAÇÃO da ordem com selo recalculado: trocar empatados que mudam o resultado ⇒ TAMPERED (value/contributors); a ordem sozinha continua coerente com os instantes", () => {
  const b = bundleOf("maxDrawdown", A)
  assert.equal(verifyEvidence(b).status, "VALID")
  const swapped = verifyEvidence(edit(b, (x) => { const o = x.evidence.metrics[0].population.sequence.order; [o[0], o[1]] = [o[1], o[0]] }))
  assert.equal(swapped.status, "TAMPERED")
  assert.equal(check(swapped, "V1.seal").status, "PASS") // selo refeito
  assert.equal(check(swapped, "V4.sequence").status, "PASS") // empatados podem ser permutados: não contradiz os instantes…
  assert.equal(check(swapped, "V4.metric-value").status, "FAIL") // …mas o resultado declarado (44,8) não sai dessa ordem (22,4)
  assert.equal(check(swapped, "V4.contributors").status, "FAIL")
  // o selo NÃO refeito é pego pelo V1
  assert.equal(check(verifyEvidence(edit(b, (x) => { const o = x.evidence.metrics[0].population.sequence.order; [o[0], o[1]] = [o[1], o[0]] }, false)), "V1.seal").status, "FAIL")
  // o evidenceHash entra a ordem: duas ordens ⇒ dois selos; o tradeSetHash é o mesmo
  assert.notEqual(bundleOf("maxDrawdown", A).evidenceHash, bundleOf("maxDrawdown", B).evidenceHash)
  assert.equal(
    bundleOf("maxDrawdown", A).evidence.metrics[0].population.tradeSetHash,
    bundleOf("maxDrawdown", { trades: [...A.trades].reverse(), record: A.record }).evidence.metrics[0].population.tradeSetHash,
  )
})

test("ADULTERAÇÃO: ordem que contradiz os instantes de saída, ids faltando/repetidos/inventados, dependent mentindo ⇒ FAIL em V4.sequence", () => {
  // saídas DISTINTAS: a ordem é totalmente determinada pelos instantes
  const N = importOf({ pts: [3, -2, -2, 4, -1], entry: (i) => dd(i, 9), exit: (i) => dd(i, 10 + i) }, "sem-empate")
  const b = bundleOf("maxDrawdown", N)
  assert.deepEqual(seqOf(b).order, ids(N))
  assert.equal(verifyEvidence(b).status, "VALID")
  const cases: Array<[string, (x: Any) => void]> = [
    ["instantes fora de ordem", (x) => { const o = x.evidence.metrics[0].population.sequence.order; [o[1], o[3]] = [o[3], o[1]] }],
    ["ordem invertida", (x) => x.evidence.metrics[0].population.sequence.order.reverse()],
    ["id removido", (x) => x.evidence.metrics[0].population.sequence.order.pop()],
    ["id repetido", (x) => (x.evidence.metrics[0].population.sequence.order[1] = x.evidence.metrics[0].population.sequence.order[0])],
    ["id inventado", (x) => (x.evidence.metrics[0].population.sequence.order[2] = "trade_inventado")],
    ["lista vazia", (x) => (x.evidence.metrics[0].population.sequence.order = [])],
    ["dependent=false escondendo a ordem", (x) => (x.evidence.metrics[0].population.sequence = { dependent: false, order: null })],
  ]
  for (const [what, fn] of cases) {
    const rep = verifyEvidence(edit(b, fn))
    assert.equal(rep.status, "TAMPERED", what)
    assert.equal(check(rep, "V4.sequence").status, "FAIL", what)
    assert.equal(check(rep, "V1.seal").status, "PASS", `${what}: selo refeito`)
  }
  // ordem numa métrica que não depende dela, ou sem a população listada ⇒ forma inválida (V2)
  const net = bundleOf("netPnl", N)
  const inj = verifyEvidence(edit(net, (x) => (x.evidence.metrics[0].population.sequence = { dependent: false, order: ids(N) })))
  assert.equal(inj.status, "TAMPERED")
  assert.equal(check(inj, "V2.population-shape").status, "FAIL")
  const claimed = verifyEvidence(edit(net, (x) => (x.evidence.metrics[0].population.sequence = { dependent: true, order: null })))
  assert.equal(check(claimed, "V4.sequence").status, "FAIL") // o motor diz que netPnl não depende da ordem
})

test("SEM ORDEM REGISTRADA: sem empate de instante a ordem é determinada pelos instantes (VALID); com empate ⇒ UNVERIFIABLE com motivo", () => {
  const N = importOf({ pts: [3, -2, -2, 4, -1], entry: (i) => dd(i, 9), exit: (i) => dd(i, 10 + i) }, "sem-empate-2")
  const noOrder = verifyEvidence(edit(bundleOf("maxDrawdown", N), (x) => (x.evidence.metrics[0].population.sequence.order = null)))
  assert.equal(noOrder.status, "VALID")
  assert.match(check(noOrder, "V4.sequence").detail, /sem empate de instante/)
  const tied = verifyEvidence(edit(bundleOf("maxDrawdown", A), (x) => (x.evidence.metrics[0].population.sequence.order = null)))
  assert.equal(tied.status, "UNVERIFIABLE")
  assert.deepEqual(fails(tied), [])
  assert.equal(check(tied, "V4.sequence").code, "S_ORDER_NOT_RECORDED")
})

// ── 9. população completa × HASH_ONLY ────────────────────────────────────────

test("HASH_ONLY: sem ordem no bundle, sem alegar verificação da sequência ⇒ UNVERIFIABLE (S_HASH_ONLY); FULL da mesma população ⇒ VALID", () => {
  const full = bundleOf("maxDrawdown", A)
  assert.equal(full.evidence.metrics[0].verifiability, "FULL")
  assert.equal(verifyEvidence(full).status, "VALID")
  const h = bundleOf("maxDrawdown", A, { tradeIdsLimit: 3 })
  const m = h.evidence.metrics[0]
  assert.equal(m.verifiability, "HASH_ONLY")
  assert.deepEqual(m.population.sequence, { dependent: true, order: null })
  assert.equal(m.population.tradeIds, null)
  assert.equal(m.population.tradeSetHash, full.evidence.metrics[0].population.tradeSetHash)
  const rep = verifyEvidence(h)
  assert.equal(rep.status, "UNVERIFIABLE")
  assert.deepEqual(fails(rep), [])
  assert.equal(check(rep, "V4.sequence").code, "S_HASH_ONLY")
  assert.match(check(rep, "V4.sequence").detail, /sequência completa .* não está no bundle/)
  assert.equal(check(rep, "V4.metric-value").code, "S_HASH_ONLY")
  // injetar uma ordem num HASH_ONLY (selo refeito) é forma inválida: não se aceita ordem sem a população listada
  const forged = verifyEvidence(edit(h, (x) => (x.evidence.metrics[0].population.sequence.order = ids(A))))
  assert.equal(forged.status, "TAMPERED")
  assert.equal(check(forged, "V2.population-shape").status, "FAIL")
})

test("PRIVACIDADE: a ordem são só tradeIds — nenhum nome de conta/estratégia/sessão no campo; o schema é strict", () => {
  const b = bundleOf("maxDrawdown", exitTie(PTS_A, () => "Conta Secreta XYZ"))
  assert.equal(JSON.stringify(seqOf(b)).includes("Secreta"), false)
  assert.equal(JSON.stringify(b).includes("Secreta"), false)
  const extra = verifyEvidence(edit(b, (x) => (x.evidence.metrics[0].population.sequence.account = "Sim101")))
  assert.equal(extra.status, "INVALID_FORMAT")
})

console.log(`\n${passed} testes ok`)
