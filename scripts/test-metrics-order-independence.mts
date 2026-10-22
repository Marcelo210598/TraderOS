// E7-17 — o resultado do motor depende só do CONJUNTO de trades, nunca da ordem do array (desempate de saídas empatadas por `id`).
// T1/T2: propriedade de permutação no motor (valores à mão); T3: ponta a ponta com 20 sais (verificador remonta os trades em outra ordem).
// Antes da correção (desempate por `index`) T1–T3 FALHAM. node scripts/test-metrics-order-independence.mts
/* eslint-disable @typescript-eslint/no-explicit-any -- script de teste: a sessão do turno é tipada por `any` como nos outros test-*.mts */
import assert from "node:assert/strict"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { createConversations, createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { registerImport } from "../src/lib/infra/dataset.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { openTurn } from "../src/lib/infra/turn-session.ts"
import { calculateMetrics, mk, ten, val } from "./_metrics-fixtures.mts"
import { synthCsv } from "./_evidence-fixtures.mts"

let passed = 0
let failed = 0
const test = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); passed += 1; console.log(`✓ ${name}`) } catch (e) { failed += 1; console.log(`✗ ${name}\n    ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`) }
}

const SEQ = ["maxDrawdown", "currentDrawdown", "recoveryFactor", "maxConsecutiveWins", "maxConsecutiveLosses", "currentStreak"] as const
// 4 trades de MNQ (US$ 2/ponto, custo 1,20), TODOS com a mesma saída (12/01 10:00): sem ordem cronológica "verdadeira".
//   a +18,80 · b −31,20 · c +38,80 · d +8,80  — em ordem de id (a,b,c,d): patrimônio 18,80 → −12,40 → 26,40 → 35,20
const tied = () => [
  mk({ id: "a", direction: "LONG", entry: 21000, exit: 21010, entryAt: "2026-01-12 09:30:00", exitAt: "2026-01-12 10:00:00" }),
  mk({ id: "b", direction: "LONG", entry: 21000, exit: 20985, entryAt: "2026-01-12 09:31:00", exitAt: "2026-01-12 10:00:00" }),
  mk({ id: "c", direction: "LONG", entry: 21000, exit: 21020, entryAt: "2026-01-12 09:32:00", exitAt: "2026-01-12 10:00:00" }),
  mk({ id: "d", direction: "LONG", entry: 21000, exit: 21005, entryAt: "2026-01-12 09:33:00", exitAt: "2026-01-12 10:00:00" }),
]
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))
}
const close = (a: number | null, b: number, tol = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < tol, `esperado ${b}, veio ${a}`)

await test("T1 empate de saída: valores à mão em ordem de id (a,b,c,d), qualquer que seja a ordem do array", () => {
  for (const p of permutations(tied())) {
    const r = calculateMetrics(p)
    close(val(r, "maxDrawdown"), 31.2)
    close(val(r, "currentDrawdown"), 0)
    close(val(r, "recoveryFactor"), 1.1282, 1e-4) // o motor arredonda a razão em 4 casas
    assert.equal(val(r, "maxConsecutiveWins"), 2) // c,d
    assert.equal(val(r, "maxConsecutiveLosses"), 1)
    assert.equal(val(r, "currentStreak"), 2)
  }
})

await test("T2 propriedade: as 24 permutações de 4 trades empatados dão exatamente o mesmo resultado em TODAS as métricas", () => {
  const base = JSON.stringify(calculateMetrics(tied()).metrics)
  for (const p of permutations(tied())) assert.equal(JSON.stringify(calculateMetrics(p).metrics), base)
})

await test("T2b empate misto dentro de uma série maior (TEN + 3 saídas empatadas): embaralhar não muda as métricas de sequência", () => {
  const extra = [
    mk({ id: "x1", direction: "LONG", entry: 21000, exit: 21030, entryAt: "2026-01-15 09:00:00", exitAt: "2026-01-15 10:00:00" }),
    mk({ id: "x2", direction: "LONG", entry: 21000, exit: 20970, entryAt: "2026-01-15 09:01:00", exitAt: "2026-01-15 10:00:00" }),
    mk({ id: "x3", direction: "LONG", entry: 21000, exit: 21001, entryAt: "2026-01-15 09:02:00", exitAt: "2026-01-15 10:00:00" }),
  ]
  const all = [...ten(), ...extra]
  const ref = calculateMetrics(all)
  for (const p of [[...all].reverse(), [...all.slice(5), ...all.slice(0, 5)], [...extra, ...ten()], [extra[2], ...ten(), extra[0], extra[1]]]) {
    const r = calculateMetrics(p)
    for (const m of SEQ) assert.equal(val(r, m), val(ref, m), m)
  }
})

await test("T2c série grande (300 trades, 20 instantes de saída, ~15 empatados por instante): 10 embaralhamentos (semente fixa) dão o mesmo resultado — também exercita a mesclagem do sort", () => {
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const all = Array.from({ length: 300 }, (_, i) => mk({ id: `t${String((i * 7919) % 300).padStart(3, "0")}`, direction: "LONG", entry: 21000, exit: 21000 + ((i * 37) % 41) - 18, entryAt: "2026-02-02 09:00:00", exitAt: `2026-02-${String(2 + (i % 20)).padStart(2, "0")} 10:00:00` }))
  const ref = calculateMetrics(all)
  for (let k = 0; k < 10; k++) {
    const sh = [...all]
    for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]] }
    const r = calculateMetrics(sh)
    for (const m of SEQ) assert.equal(val(r, m), val(ref, m), m)
  }
})

// ── T3: ponta a ponta, 20 sais ─────────────────────────────────────────────────────────────
const U = "cmd3h2k0a0000abcd1234efgh"
const p2 = (x: number) => String(x).padStart(2, "0")
const csv = synthCsv(Array.from({ length: 60 }, (_, i) => ({
  entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2),
  entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`,
  account: i % 3 === 0 ? "Sim101" : "Sim102",
})))
async function session() {
  const raw = createMemoryRawFileStorage(); const imp = createMemoryImportSourceStore(); const kr = new InMemorySaltKeyring(); kr.ensure(U)
  const r: any = await registerImport({ rawStorage: raw, importStore: imp, salt: kr }, { userId: U, text: csv, context: { sourceTz: "America/New_York" }, fileName: "e.csv" })
  const o: any = await openTurn({ rawStorage: raw, importStore: imp, conversations: createConversations({ store: createMemoryConversationStore() }), salts: { load: async () => ({ provider: kr, unavailable: [] }) } } as any, { userId: U, pin: { sources: [{ fileSha256: r.fileSha256 }], analysis: {} }, userMessage: "x" })
  return o.session
}
const status = (o: any) => (o.result.ok ? (o.result.evidence?.verdict.verify.status as string) : `ERRO:${o.result.error?.code}`)
const SALTS = 20
const failuresOf = async (call: (s: any) => Promise<any[]>) => {
  const bad: string[] = []
  for (let i = 0; i < SALTS; i++) { const s = await session(); for (const o of await call(s)) if (status(o) !== "VALID") bad.push(status(o)) }
  return bad
}
const SEQ_IDS = ["maxDrawdown", "currentDrawdown", "recoveryFactor", "maxConsecutiveWins", "maxConsecutiveLosses"]
const per = { mode: "PERIOD", a: { from: "2026-03-01", to: "2026-03-15" }, b: { from: "2026-03-16", to: "2026-03-28" }, filters: {}, options: {} }

await test(`T3 metrics.compare PERIOD × 5 métricas de sequência × ${SALTS} sais ⇒ sempre VALID`, async () => {
  const bad = await failuresOf(async (s) => Promise.all(SEQ_IDS.map((m) => s.call("metrics.compare@1", { ...per, metricIds: [m] }))))
  assert.equal(bad.length, 0, `${bad.length} de ${SALTS * SEQ_IDS.length} chamadas não ficaram VALID (${[...new Set(bad)].join(", ")})`)
})
await test(`T3b metrics.groups (por conta) e rank.groups com métricas de sequência × ${SALTS} sais ⇒ sempre VALID`, async () => {
  const bad = await failuresOf(async (s) => [
    await s.call("metrics.groups@1", { groupBy: ["account"], metricIds: SEQ_IDS, filters: {}, options: {} }),
    await s.call("rank.groups@1", { groupBy: ["account"], metric: "maxDrawdown", order: "DESC", filters: {}, options: {} }),
    await s.call("metrics.query@1", { metricIds: SEQ_IDS, filters: {}, options: {} }),
  ])
  assert.equal(bad.length, 0, `${bad.length} chamadas não ficaram VALID (${[...new Set(bad)].join(", ")})`)
})

console.log(`\n${passed} ok, ${failed} falharam`)
if (failed > 0) process.exit(1)
