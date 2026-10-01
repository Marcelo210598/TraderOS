// Reconstrução de ciclos de posição (algoritmo): node scripts/test-recon-core.mts
// Cenários com valores pequenos, conferidos à mão. MNQ = US$ 2/ponto; comissão padrão 1,00 por linha; líquido = pts × 2 × qtd − 1.
import assert from "node:assert/strict"
import { classifyExitLabel, validateExitReasonMap, ExitReasonMapError } from "../src/lib/ingest/exit-reason.ts"
import { reconstructCycles } from "../src/lib/ingest/reconstruct.ts"
import { at, lot, D, type LotOpts } from "./_recon-fixtures.mts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const run = (rows: ReturnType<typeof lot>[], opts = {}) => reconstructCycles(rows, opts)
const L = (o: LotOpts) => lot(o)
const codes = (t: { reconstruction?: { ambiguities: Array<{ code: string }> } | null }) => (t.reconstruction?.ambiguities ?? []).map((a) => a.code)

// ── scale-out / scale-in ─────────────────────────────────────────────────────

test("SCALE-OUT: 1 entrada de 3 contratos, saídas parciais 1 + 2 → 1 ciclo, saída parcial e saída final", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 110, qty: 1, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 120, qty: 2, exitLabel: "Target2" }),
  ])
  assert.equal(r.cycles.length, 1)
  const t = r.cycles[0]
  assert.deepEqual([t.granularity, t.quantity, t.peakQuantity, t.entry.price], ["POSITION_CYCLE", 3, 3, 100])
  assert.equal(t.entryLegs!.length, 1)
  assert.deepEqual([t.entryLegs![0].role, t.entryLegs![0].quantity], ["ENTRY", 3])
  assert.deepEqual(t.exitLegs!.map((l) => [l.role, l.quantity, l.sizeAfter, l.simultaneous]), [["SCALE_OUT", 1, 2, false], ["EXIT", 2, 0, false]])
  assert.ok(Math.abs(t.exit.price - (110 + 240) / 3) < 1e-5) // saída média ponderada 116,666667
  assert.deepEqual([t.pnl.net, t.pnl.gross, t.pnl.commission], [98, 100, 2]) // (20−1) + (80−1)
  assert.equal(t.exit.at.instantUtc, "2026-02-02T13:20:00.000Z") // saída = a ÚLTIMA perna (10:20 BRT)
})

test("SCALE-IN: 2ª entrada enquanto a posição está aberta → ENTRY + SCALE_IN, pico 2, saída parcial e final", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110, qty: 1, exitLabel: "Target2" }),
    L({ rowNo: 3, entryAt: at("10:10:00"), exitAt: at("10:20:00"), entry: 105, exit: 110, qty: 1, exitLabel: "Target1", entryLabel: "Add1" }),
  ])
  assert.equal(r.cycles.length, 1)
  const t = r.cycles[0]
  assert.deepEqual(t.entryLegs!.map((l) => [l.role, l.price, l.quantity, l.sourceLabel]), [["ENTRY", 100, 1, "Entry"], ["SCALE_IN", 105, 1, "Add1"]])
  assert.deepEqual(t.exitLegs!.map((l) => [l.sourceLabel, l.role, l.sizeAfter]), [["Target1", "SCALE_OUT", 1], ["Target2", "EXIT", 0]])
  assert.deepEqual([t.peakQuantity, t.quantity, t.entry.price, t.pnl.net], [2, 2, 102.5, 28]) // (20−1) + (10−1)
  assert.equal(t.entry.at.instantUtc, "2026-02-02T13:00:00.000Z") // 1ª entrada
})

test("entradas no MESMO segundo com preços diferentes: ambas ENTRY (lote inicial), 2 pernas de entrada", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100.0, exit: 110, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100.5, exit: 110, exitLabel: "Target1" }),
  ])
  assert.equal(r.cycles.length, 1)
  assert.deepEqual(r.cycles[0].entryLegs!.map((l) => [l.role, l.price]), [["ENTRY", 100], ["ENTRY", 100.5]])
})

test("MESMA saída casada contra MÚLTIPLAS entradas: 1 perna de saída (qtd 2, 2 linhas) e 2 pernas de entrada", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100.0, exit: 110, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100.5, exit: 110, exitLabel: "Target1" }),
  ])
  const t = r.cycles[0]
  assert.equal(t.exitLegs!.length, 1)
  assert.deepEqual([t.exitLegs![0].quantity, t.exitLegs![0].rowRefs, t.exitLegs![0].role, t.exitLegs![0].sizeAfter], [2, [2, 3], "EXIT", 0])
  // cada linha original continua ligada à sua perna de entrada e à perna de saída compartilhada
  assert.deepEqual(t.sourceRows!.map((s) => [s.rowNo, s.entryLeg, s.exitLeg]), [[2, 0, 0], [3, 1, 0]])
  assert.equal(t.pnl.net, 37) // (10×2−1) + (9.5×2−1) = 19 + 18
})

// ── várias saídas no mesmo segundo ───────────────────────────────────────────

test("MÚLTIPLAS SAÍDAS NO MESMO SEGUNDO (rótulos diferentes não se fundem): simultaneous, ambas EXIT, finalReason STOP", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 110, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 100, exitLabel: "Stop2" }),
    L({ rowNo: 4, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 100, exitLabel: "Stop3" }),
  ])
  const t = r.cycles[0]
  assert.deepEqual(t.exitLegs!.map((l) => [l.sourceLabel, l.reason, l.role, l.sizeAfter, l.simultaneous]), [
    ["Target1", "TARGET", "SCALE_OUT", 2, false],
    ["Stop2", "STOP", "EXIT", 0, true],
    ["Stop3", "STOP", "EXIT", 0, true],
  ])
  assert.deepEqual(t.exitSummary, { finalReason: "STOP", finalReasons: ["STOP"], byReason: { TARGET: 1, STOP: 2 }, mixed: true })
})

test("saídas finais simultâneas com motivos DIFERENTES: finalReason = null e finalReasons guarda o conjunto", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 100, exitLabel: "Stop2" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 105, exitLabel: "Zerar" }),
  ])
  assert.deepEqual(r.cycles[0].exitSummary, { finalReason: null, finalReasons: ["MANUAL", "STOP"], byReason: { STOP: 1, MANUAL: 1 }, mixed: true })
})

// ── fronteiras: mesmo segundo, lacuna, reversão ──────────────────────────────

test("BOUNDARY SAME-SECOND: saída e entrada no mesmo segundo NÃO são agrupadas → 2 ciclos + SAME_SECOND_BOUNDARY com evidência", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, entryAt: at("10:30:00"), exitAt: at("10:40:00"), entry: 110, exit: 115 }),
  ])
  assert.equal(r.cycles.length, 2)
  const [a, b] = r.cycles
  for (const t of [a, b]) {
    assert.deepEqual(codes(t), ["SAME_SECOND_BOUNDARY"])
    assert.equal(t.reconstruction!.confidence, "LOW")
  }
  assert.deepEqual([a.reconstruction!.boundary, b.reconstruction!.boundary], [{ prev: "NONE", next: "AMBIGUOUS_TOUCH" }, { prev: "AMBIGUOUS_TOUCH", next: "NONE" }])
  // evidência preservada: quais linhas se tocam
  assert.deepEqual(a.reconstruction!.ambiguities[0].rowNos, [2])
  assert.deepEqual(b.reconstruction!.ambiguities[0].rowNos, [3])
  assert.match(a.reconstruction!.ambiguities[0].message, /MESMO segundo/)
})

test("lacuna de 1 segundo (10:30:00 → 10:30:01) separa SEM ambiguidade; sobreposição estrita junta", () => {
  const gap = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, entryAt: at("10:30:01"), exitAt: at("10:40:00"), entry: 110, exit: 115 }),
  ])
  assert.equal(gap.cycles.length, 2)
  assert.deepEqual(gap.cycles.map((c) => [codes(c), c.reconstruction!.confidence]), [[[], "HIGH"], [[], "HIGH"]])
  const overlap = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, entryAt: at("10:29:59"), exitAt: at("10:40:00"), entry: 110, exit: 115 }),
  ])
  assert.equal(overlap.cycles.length, 1)
})

test("lote de duração zero no mesmo segundo da borda: separado + ambiguidade (não decide sozinho)", () => {
  const r = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, entryAt: at("10:30:00"), exitAt: at("10:30:00"), entry: 110, exit: 110 }),
  ])
  assert.equal(r.cycles.length, 2)
  assert.deepEqual(codes(r.cycles[0]), ["SAME_SECOND_BOUNDARY"])
})

test("REVERSAL CANDIDATE: long encerra e short abre no mesmo segundo → 2 ciclos ligados, INFO, confiança segue ALTA", () => {
  const r = run([
    L({ rowNo: 2, dir: "LONG", entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, dir: "SHORT", entryAt: at("10:30:00"), exitAt: at("10:45:00"), entry: 110, exit: 100 }),
  ])
  assert.equal(r.cycles.length, 2)
  const [a, b] = r.cycles
  assert.deepEqual([a.direction, b.direction], ["LONG", "SHORT"])
  assert.deepEqual(codes(a), ["REVERSAL_CANDIDATE"])
  assert.deepEqual(codes(b), ["REVERSAL_CANDIDATE"])
  assert.deepEqual([a.reconstruction!.boundary.next, b.reconstruction!.boundary.prev], ["REVERSAL_CANDIDATE", "REVERSAL_CANDIDATE"])
  assert.deepEqual([a.reconstruction!.confidence, b.reconstruction!.confidence], ["HIGH", "HIGH"]) // as duas leituras dão 2 ciclos
  assert.deepEqual(a.reconstruction!.ambiguities[0].rowNos, [2, 3])
  // 5 segundos depois já não é candidato
  const later = run([
    L({ rowNo: 2, dir: "LONG", entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, dir: "SHORT", entryAt: at("10:30:05"), exitAt: at("10:45:00"), entry: 110, exit: 100 }),
  ])
  assert.deepEqual(later.cycles.map(codes), [[], []])
})

test("direções OPOSTAS sobrepostas na MESMA estratégia = anomalia (confiança baixa), sem agrupar", () => {
  const r = run([
    L({ rowNo: 2, dir: "LONG", entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, dir: "SHORT", entryAt: at("10:10:00"), exitAt: at("10:20:00"), entry: 110, exit: 100 }),
  ])
  assert.equal(r.cycles.length, 2)
  for (const t of r.cycles) {
    assert.deepEqual(codes(t), ["OVERLAP_OPPOSITE_DIRECTION"])
    assert.equal(t.reconstruction!.confidence, "LOW")
  }
})

// ── ciclos incompletos / bordas ──────────────────────────────────────────────

test("INCOMPLETOS: 1º ciclo da chave = borda de cabeça, último = borda de cauda, o do meio é VERIFIED", () => {
  const mk = (n: number, h: string) => L({ rowNo: n, entryAt: at(`${h}:00:00`), exitAt: at(`${h}:10:00`), entry: 100, exit: 105 })
  const three = run([mk(2, "10"), mk(3, "11"), mk(4, "12")])
  assert.deepEqual(three.cycles.map((c) => c.reconstruction!.completeness), ["UNVERIFIED_HEAD", "VERIFIED", "UNVERIFIED_TAIL"])
  assert.equal(run([mk(2, "10")]).cycles[0].reconstruction!.completeness, "UNVERIFIED_BOTH")
  // chaves diferentes são independentes
  const two = run([mk(2, "10"), L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 105, strategy: "OUTRA" })])
  assert.deepEqual(two.cycles.map((c) => c.reconstruction!.completeness), ["UNVERIFIED_BOTH", "UNVERIFIED_BOTH"])
  // ciclo de borda NÃO é descartado nem tem a confiança derrubada por isso
  assert.deepEqual(three.cycles.map((c) => c.reconstruction!.confidence), ["HIGH", "HIGH", "HIGH"])
})

test("linhas REJEITADAS antes da reconstrução e acumulado quebrado derrubam a confiança de TODOS os ciclos (nunca silencioso)", () => {
  const rows = [L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 105 })]
  const rej = run(rows, { rejectedRowNos: [5] })
  assert.deepEqual(codes(rej.cycles[0]), ["ROWS_REJECTED_IN_FILE"])
  assert.equal(rej.cycles[0].reconstruction!.confidence, "LOW")
  const brk = run(rows, { integrity: "BROKEN", brokenRowNos: [3] })
  assert.deepEqual(codes(brk.cycles[0]), ["ACCUMULATED_MISMATCH"])
  assert.equal(brk.cycles[0].reconstruction!.integrity, "BROKEN")
})

test("linha sem horário completo não vira ciclo: segue como trade-linha (passthrough), sem sumir", () => {
  const r = L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 105 })
  r.trade = { ...r.trade, exit: { ...r.trade.exit, at: { ...r.trade.exit.at, precision: "UNKNOWN", instantUtc: null } } }
  const out = run([r])
  assert.deepEqual([out.cycles.length, out.passthrough.length], [0, 1])
})

// ── múltiplas estratégias, contratos, contas ─────────────────────────────────

test("MÚLTIPLAS ESTRATÉGIAS (e manual) sobrepostas na mesma conta/contrato: ciclos separados + CROSS_KEY_OVERLAP", () => {
  const r = run([
    L({ rowNo: 2, strategy: "S1", entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, strategy: "S2", entryAt: at("10:10:00"), exitAt: at("10:20:00"), entry: 105, exit: 110 }),
    L({ rowNo: 4, strategy: null, entryAt: at("10:15:00"), exitAt: at("10:25:00"), entry: 106, exit: 110 }),
  ])
  assert.equal(r.cycles.length, 3) // nunca juntou
  assert.deepEqual(r.cycles.map((c) => c.labels.strategyName), ["S1", "S2", null])
  for (const t of r.cycles) {
    assert.ok(codes(t).includes("CROSS_KEY_OVERLAP"))
    assert.equal(t.reconstruction!.confidence, "LOW")
    assert.equal(t.reconstruction!.scope, "STRATEGY_POSITION")
  }
  // a evidência do S1 aponta as linhas das outras estratégias
  assert.deepEqual(r.cycles[0].reconstruction!.ambiguities.find((a) => a.code === "CROSS_KEY_OVERLAP")!.rowNos, [3, 4])
})

test("CONTAS diferentes ou CONTRATOS com vencimentos diferentes nunca se misturam (e não geram ambiguidade entre si)", () => {
  const byAccount = run([
    L({ rowNo: 2, account: "A", entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, account: "B", entryAt: at("10:10:00"), exitAt: at("10:20:00"), entry: 100, exit: 110 }),
  ])
  assert.deepEqual([byAccount.cycles.length, ...byAccount.cycles.map(codes)], [2, [], []])
  const byExpiry = run([
    L({ rowNo: 2, contract: "MNQ 12-26", entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110 }),
    L({ rowNo: 3, contract: "MNQ 03-27", entryAt: at("10:10:00"), exitAt: at("10:20:00"), entry: 100, exit: 110 }),
  ])
  assert.deepEqual([byExpiry.cycles.length, ...byExpiry.cycles.map(codes)], [2, [], []])
  assert.deepEqual(byExpiry.cycles.map((c) => c.reconstruction!.cycleKey.contract), ["MNQ Z26", "MNQ H27"])
  assert.deepEqual(byExpiry.cycles.map((c) => [c.instrument.contract?.month, c.instrument.contract?.yearDigits]), [[12, "26"], [3, "27"]])
})

test("CHAVE do ciclo preservada: conta + contrato completo + estratégia + direção", () => {
  const t = run([L({ rowNo: 2, account: "Sim101", contract: "MNQ 12-26", strategy: "ORB", dir: "SHORT", entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 110, exit: 100 })]).cycles[0]
  assert.deepEqual(t.reconstruction!.cycleKey, { account: "Sim101", contract: "MNQ Z26", strategy: "ORB", direction: "SHORT" })
  assert.equal(t.reconstruction!.method, "NT8_ROW_INTERVALS_V1")
})

test("DETERMINISMO: a ordem das linhas de entrada não muda o resultado", () => {
  const rows = [
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 110, exitLabel: "Target2" }),
    L({ rowNo: 3, entryAt: at("10:10:00"), exitAt: at("10:20:00"), entry: 105, exit: 110, exitLabel: "Target1" }),
    L({ rowNo: 4, entryAt: at("11:00:00"), exitAt: at("11:10:00"), entry: 100, exit: 90 }),
  ]
  const a = JSON.stringify(run(rows).cycles)
  const b = JSON.stringify(run([rows[2], rows[1], rows[0]]).cycles)
  assert.equal(a, b)
})

// ── exitReason ───────────────────────────────────────────────────────────────

test("EXIT REASON padrão: Target* → TARGET · Stop* → STOP · Zerar/Flat/Close → MANUAL · resto → UNKNOWN (sem acento/caixa)", () => {
  const cls = (l: string | null) => classifyExitLabel(l)
  for (const l of ["Target1", "Target2", "TARGET", "target 3"]) assert.deepEqual([cls(l).reason, cls(l).rule], ["TARGET", "LABEL_RULE"], l)
  for (const l of ["Stop2", "Stop3", "STOP", " stop loss "]) assert.deepEqual([cls(l).reason, cls(l).rule], ["STOP", "LABEL_RULE"], l)
  for (const l of ["Zerar", "ZERAR", "Flat", "Close", "close position"]) assert.deepEqual([cls(l).reason, cls(l).rule], ["MANUAL", "LABEL_RULE"], l)
  for (const l of ["Exit on close", "Sáída", "TP1", "", "  ", null]) assert.deepEqual([cls(l).reason, cls(l).rule], ["UNKNOWN", "NONE"], String(l))
})

test("EXIT REASON configurável: o mapa do usuário tem prioridade e fica marcado USER_MAP; as padrão seguem valendo", () => {
  const map = [{ pattern: "^tp\\d", reason: "TARGET" as const }, { pattern: "^zerar", reason: "UNKNOWN" as const }]
  assert.deepEqual(classifyExitLabel("TP1", map), { reason: "TARGET", rule: "USER_MAP", matched: "^tp\\d" })
  assert.deepEqual(classifyExitLabel("Zerar", map), { reason: "UNKNOWN", rule: "USER_MAP", matched: "^zerar" })
  assert.deepEqual(classifyExitLabel("Target1", map), { reason: "TARGET", rule: "LABEL_RULE", matched: "^target" })
  assert.throws(() => validateExitReasonMap([{ pattern: "(", reason: "STOP" }]), ExitReasonMapError)
  assert.throws(() => validateExitReasonMap([{ pattern: "x", reason: "TALVEZ" as never }]), ExitReasonMapError)
})

test("EXIT REASON no ciclo: sourceLabel e reasonRule PRESERVADOS por perna; NÃO existe exitReason único no trade; exitSummary derivado", () => {
  const r = run(
    [
      L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 110, qty: 2, exitLabel: "TP1" }),
      L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 112, exitLabel: "Target2" }),
      L({ rowNo: 4, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 101, exitLabel: "Zerar" }),
    ],
    { exitReasonMap: [{ pattern: "^tp\\d", reason: "TARGET" }] },
  )
  const t = r.cycles[0]
  assert.deepEqual(t.exitLegs!.map((l) => [l.sourceLabel, l.reason, l.reasonRule]), [["TP1", "TARGET", "USER_MAP"], ["Target2", "TARGET", "LABEL_RULE"], ["Zerar", "MANUAL", "LABEL_RULE"]])
  assert.equal("exitReason" in t, false)
  assert.deepEqual(t.exitSummary, { finalReason: "MANUAL", finalReasons: ["MANUAL"], byReason: { TARGET: 3, MANUAL: 1 }, mixed: true })
})

// ── MAE / MFE ────────────────────────────────────────────────────────────────

const excursionRows = () => [
  // extremos ABSOLUTOS iguais nas 3 linhas (alta 110, baixa 99), entradas ligeiramente diferentes, qtd diferentes
  L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100.0, exit: 105, qty: 1, high: 110, low: 99, exitLabel: "Target1" }),
  L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100.1, exit: 105, qty: 1, high: 110, low: 99, exitLabel: "Target2" }),
  L({ rowNo: 4, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100.1, exit: 106, qty: 2, high: 110, low: 99, exitLabel: "Zerar" }),
]

test("MAE/MFE REPETIDOS NÃO SÃO SOMADOS: extremos absolutos (alta 110 / baixa 99), relativos à entrada MÉDIA PONDERADA", () => {
  const t = run(excursionRows()).cycles[0]
  // entrada média = (100,0×1 + 100,1×1 + 100,1×2) / 4 = 100,075 ⇒ MFE = 110 − 100,075 ; MAE = 100,075 − 99
  assert.deepEqual([t.excursions.highPrice, t.excursions.lowPrice], [110, 99])
  assert.deepEqual([t.excursions.mfePoints, t.excursions.maePoints], [9.925, 1.075])
  assert.equal(t.excursions.conflict, false)
  // a soma ingênua das linhas daria ~29,8 pontos (e multiplicar por quantidade, mais ainda)
  const naiveSum = t.sourceRows!.reduce((a, s) => a + (s.mfeUsd as number) / (2 * s.quantity), 0)
  assert.ok(naiveSum > 29 && (t.excursions.mfePoints as number) < 10)
  // os valores CRUS por linha continuam preservados (auditoria), em US$ totais da linha
  assert.deepEqual(t.sourceRows!.map((s) => [s.rowNo, s.mfeUsd, s.maeUsd]), [[2, 20, 2], [3, 19.8, 2.2], [4, 39.6, 4.4]])
})

test("ORIGEM: excursão reconstruída é marcada RECONSTRUCTED_NT8_ROWS / INFERRED — nunca como valor nativo de trade", () => {
  const t = run(excursionRows()).cycles[0]
  assert.equal(t.excursions.origin, "RECONSTRUCTED_NT8_ROWS")
  assert.equal(t.fieldProvenance["excursions.mfe"], "INFERRED")
  assert.equal(t.fieldProvenance["excursions.mae"], "INFERRED")
  const row = excursionRows()[0].trade
  assert.equal(row.excursions.origin, "SOURCE_ROW") // a linha, sim, é da fonte
})

test("CONFLITO: extremos divergentes entre as linhas → usa o mais amplo, conflict = true, ambiguidade INFO + aviso", () => {
  const t = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 105, high: 110, low: 99, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 105, high: 108, low: 99.5, exitLabel: "Target2" }),
  ]).cycles[0]
  assert.deepEqual([t.excursions.highPrice, t.excursions.lowPrice, t.excursions.conflict], [110, 99, true])
  assert.deepEqual([t.excursions.mfePoints, t.excursions.maePoints], [10, 1])
  assert.ok(codes(t).includes("EXCURSION_CONFLICT"))
  assert.ok(t.issues.some((i) => i.code === "W_EXCURSION_CONFLICT"))
  assert.equal(t.reconstruction!.confidence, "HIGH") // conflito de excursão é INFO; não derruba a confiança do ciclo
})

test("excursão PARCIAL (uma linha sem MAE/MFE) usa as que existem; NENHUMA → null com motivo e origem NONE", () => {
  const partial = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 105, high: 110, low: 99, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 105, high: null, low: null, exitLabel: "Target2" }),
  ]).cycles[0]
  assert.deepEqual([partial.excursions.mfePoints, partial.excursions.maePoints, partial.excursions.conflict], [10, 1, false])
  const none = run([L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 105, high: null, low: null })]).cycles[0]
  assert.deepEqual([none.excursions.mfePoints, none.excursions.mfeReason, none.excursions.origin], [null, "NOT_PROVIDED", "NONE"])
})

test("excursão em SHORT: favorável é para BAIXO (MFE = entrada média − mínima), adverso para cima", () => {
  const t = run([
    L({ rowNo: 2, dir: "SHORT", entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 90, high: 101, low: 88, exitLabel: "Target1" }),
    L({ rowNo: 3, dir: "SHORT", entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 95, high: 101, low: 88, exitLabel: "Target2" }),
  ]).cycles[0]
  assert.deepEqual([t.excursions.highPrice, t.excursions.lowPrice], [101, 88])
  assert.deepEqual([t.excursions.mfePoints, t.excursions.maePoints], [12, 1])
})

// ── P&L ──────────────────────────────────────────────────────────────────────

test("P&L do ciclo = SOMA das pernas = SOMA das linhas (líquido, bruto, comissão, taxas); custos exatos", () => {
  const rows = [
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 110, commission: 0.7, exitLabel: "Target1" }),
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 105, commission: 0.6, exitLabel: "Target2" }),
    L({ rowNo: 4, entryAt: at("10:00:00"), exitAt: at("10:30:00"), entry: 100, exit: 102, commission: 0.3, exitLabel: "Zerar" }),
  ]
  const t = run(rows).cycles[0]
  assert.deepEqual([t.pnl.commission, t.pnl.fees, t.pnl.gross, t.pnl.net], [1.6, 0, 34, 32.4]) // 0,7+0,6+0,3 = 1,6 (não 1,5999…); (10+5+2) pts × US$ 2 = 34
  assert.deepEqual([t.pnl.basis, t.pnl.netStatus], ["NET", "COMPLETE"])
  // soma das pernas = trade
  const sum = (f: (p: NonNullable<typeof t.exitLegs>[number]["pnl"]) => number | null) => Math.round(t.exitLegs!.reduce((a, l) => a + (f(l.pnl) as number) * 100, 0)) / 100
  assert.deepEqual([sum((p) => p.net), sum((p) => p.gross), sum((p) => p.commission)], [32.4, 34, 1.6])
  // …e = soma dos Profit REPORTADOS das linhas
  assert.equal(Math.round(t.sourceRows!.reduce((a, s) => a + (s.reportedProfit as number) * 100, 0)) / 100, 32.4)
  assert.equal(t.pnl.reported, 32.4)
})

test("P&L: o 'Acu lucro líquido' NÃO é P&L — acumulado absurdo não altera nada, só fica guardado cru", () => {
  const mk = (cum: number | null) => run([L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 110, cumulative: cum })]).cycles[0]
  const a = mk(19)
  const b = mk(999999)
  assert.deepEqual([a.pnl.net, b.pnl.net], [19, 19])
  assert.equal(b.sourceRows![0].cumulativeNetReported, 999999)
})

test("P&L: base NET só quando TODAS as linhas concordam e têm líquido; mistura/inconsistência ⇒ UNKNOWN e net NULL", () => {
  const t = run([
    L({ rowNo: 2, entryAt: at("10:00:00"), exitAt: at("10:10:00"), entry: 100, exit: 110, exitLabel: "Target1" }),
    // Profit reportado que não bate nem com bruto nem com líquido ⇒ base desconhecida nesta linha
    L({ rowNo: 3, entryAt: at("10:00:00"), exitAt: at("10:20:00"), entry: 100, exit: 110, profit: 7.77, exitLabel: "Target2" }),
  ]).cycles[0]
  assert.deepEqual([t.pnl.basis, t.pnl.net, t.pnl.gross, t.pnl.netStatus], ["UNKNOWN", null, null, "UNAVAILABLE"])
  assert.equal(t.pnl.commission, 2) // custos seguem somados
  assert.ok(t.issues.some((i) => i.code === "W_PNL_BASIS_UNKNOWN"))
})

console.log(`\n${passed} testes ok`)
void D
