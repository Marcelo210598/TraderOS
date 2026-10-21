// E7-6: executor DETERMINÍSTICO do turno do agente (infra/turn-session.ts), sem LLM: abre a conversa, carrega o sal 1x, despacha as capacidades sobre o dataset fixado (pin), mantém o estado de trabalho
// (ledger, specs, aliases), traduz falhas SEM inventar código novo e grava UM commit atômico no fim (CAS, sem retry).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_6 (D-T0…D-T9; O1–O3, K1–K9, C1–C5, V1–V2, S1–S2; mutações EM1–EM16).
// E7-8 (citabilidade do evidence.explain): expectativa e7_8 (D-X1…D-X6; T1–T8); K4 e C5 reescritos (a entrada do explain agora vai ao ledger, por ref derivado por página).
// E7-9 (mensagens da conversa): expectativa e7_9 (D-M1…D-M9; N1–N8): userMessage no openTurn, resposta terminal registrada no validate, gravada no commit.
//   node scripts/test-turn-session.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { evidenceExplain } from "../src/lib/agent-capabilities/evidence-explain.ts"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { newAliasTable } from "../src/lib/agent/label.ts"
import { addEvidence, isStale, newLedger } from "../src/lib/agent/ledger.ts"
import { notices } from "/Users/marcelodifoggiajunior/Desktop/Projetos AI/TraderOS/src/lib/agent/turn.ts"
import { renderAnswer, stopResponse } from "../src/lib/agent/render.ts"
import { explainPageRef } from "../src/lib/evidence/hash.ts"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { createBundleCache } from "../src/lib/infra/bundle-cache.ts"
import { createConversations, createDiskConversationStore, createMemoryConversationStore, type ConversationStore } from "../src/lib/infra/conversation-store.ts"
import { makeContext, registerImport, type DatasetDeps } from "../src/lib/infra/dataset.ts"
import { createDiskImportSourceStore, createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
import { regenerateBundle } from "../src/lib/infra/regenerate.ts"
import { openTurn } from "../src/lib/infra/turn-session.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const p2 = (x: number): string => String(x).padStart(2, "0")
const csvOf = (n: number, seed = 0): string => synthCsv(Array.from({ length: n }, (_, i) => ({ entryPrice: 2000 + ((i + seed) % 13), exitPrice: 2000 + ((i + seed) % 13) + (((i + seed) % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: (i + seed) % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
const CTX = { sourceTz: "America/New_York" } // não é o padrão do pipeline
const PIN = (analysis: Any = {}, ...shas: string[]): Any => ({ sources: shas.map((fileSha256) => ({ fileSha256 })), analysis })
const jstr = (x: unknown): string => JSON.stringify(x)
const plain = (x: unknown): Any => JSON.parse(JSON.stringify(x))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

// ── ambientes ──
const TMPS: string[] = []
interface Env { name: string; kr: InMemorySaltKeyring; deps: () => DatasetDeps; conv: () => ConversationStore; root?: string }
function memEnv(): Env {
  const raw = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore(), conv = createMemoryConversationStore(), kr = new InMemorySaltKeyring(); kr.ensure(U1)
  return { name: "memória", kr, deps: () => ({ rawStorage: raw, importStore: imp, salt: kr }), conv: () => conv }
}
function diskEnv(): Env {
  const root = mkdtempSync(join(tmpdir(), "turn-")); TMPS.push(root)
  const kr = new InMemorySaltKeyring(); kr.ensure(U1)
  return { name: "disco", kr, root, deps: () => ({ rawStorage: createDiskRawFileStorage(join(root, "raw")), importStore: createDiskImportSourceStore(join(root, "imports")), salt: kr }), conv: () => createDiskConversationStore(join(root, "conv")) }
}
const both = async (fn: (e: Env) => Promise<void>): Promise<void> => { for (const e of [memEnv(), diskEnv()]) await fn(e) }
async function register(e: Env, text: string, extra: Any = {}): Promise<string> {
  const r: Any = await registerImport(e.deps(), { userId: U1, text, context: CTX, fileName: "export.csv", ...extra })
  assert.equal(r.ok, true, `registerImport: ${r.code}`)
  return r.fileSha256
}
/** As dependências do executor; `extra` sobrescreve (ex.: cache, rawStorage quebrado, conversations de mentira). Cada chamada cria instâncias NOVAS dos stores de disco. */
const turnDeps = (e: Env, extra: Any = {}): Any => { const d = e.deps(); return { rawStorage: d.rawStorage, importStore: d.importStore, conversations: createConversations({ store: e.conv() }), salts: { load: async () => ({ provider: e.kr, unavailable: [] }) }, ...extra } }
async function open(e: Env, pin: Any, conversationId?: string | null, extra: Any = {}, user = U1): Promise<Any> {
  const r: Any = await openTurn(turnDeps(e, extra), { userId: user, conversationId, pin })
  assert.equal(r.ok, true, `openTurn: ${r.code}`)
  return r.session
}

const CAPS: Record<string, { fn: (a: unknown, c: Any) => Any; args: Any }> = {
  "metrics.query@1": { fn: metricsQuery, args: { metricIds: ["netPnl", "winRate"], filters: {}, options: {} } },
  "metrics.groups@1": { fn: metricsGroups, args: { groupBy: ["account"], metricIds: ["netPnl"], filters: {}, options: {} } },
  "metrics.compare@1": { fn: metricsCompare, args: { mode: "PERIOD", a: { from: "2026-03-01", to: "2026-03-10" }, b: { from: "2026-03-15", to: "2026-03-25" }, metricIds: ["netPnl"], filters: {}, options: {} } },
  "exit.breakdown@1": { fn: exitBreakdown, args: { filters: {}, options: {} } },
  "exit.analysis@1": { fn: exitAnalysis, args: { compare: { unit: "TRADE", a: "TARGET", b: "STOP" }, filters: {}, options: {} } },
  "rank.groups@1": { fn: rankGroupsCapability, args: { groupBy: ["account"], metric: "netPnl", order: "DESC", filters: {}, options: {} } },
}
const Q = CAPS["metrics.query@1"].args
/** A consulta DIRETA (o oráculo): o mesmo ctx do makeContext + tabela de alias nova da época. */
async function direct(e: Env, id: string, pin: Any, args: Any = CAPS[id].args, aliases?: Any): Promise<{ out: Any; ctx: Any; bundle: Any }> {
  const made: Any = await makeContext(e.deps(), { userId: U1, pin })
  assert.equal(made.ok, true, made.code)
  let bundle: Any = null
  const out = CAPS[id].fn(args, { ...made.ctx, aliases: aliases ?? newAliasTable(made.ctx.refEpoch), onBundle: (b: unknown) => { bundle = b } })
  return { out, ctx: made.ctx, bundle }
}
const refOfResult = (r: Any): string => r.evidence.evidenceRef

// ───────────────────────────── O: abertura ─────────────────────────────
await test("O1 — abre conversa NOVA e EXISTENTE; o sal é carregado UMA vez por turno (mesmo com várias chamadas); época = a do sal; estado zerado", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    let loads = 0
    const salts = { load: async (): Promise<Any> => { loads += 1; return { provider: e.kr, unavailable: [] } } }
    const s1 = await open(e, PIN({}, sha), undefined, { salts })
    assert.equal(loads, 1, e.name)
    assert.deepEqual([s1.ledger().epoch, Object.keys(s1.ledger().entries).length, s1.state().calls], [e.kr.current(U1)!.saltId, 0, 0], e.name)
    assert.equal(typeof s1.conversationId, "string")
    for (let i = 0; i < 3; i++) assert.equal(((await s1.call("metrics.query@1", Q)) as Any).ok, true)
    assert.equal(loads, 1, `${e.name}: sal carregado 1x apesar de 3 chamadas`)
    const c: Any = await s1.commit(); assert.deepEqual([c.ok, c.committed], [true, true], e.name)
    const s2 = await open(e, PIN({}, sha), s1.conversationId)
    assert.equal(s2.conversationId, s1.conversationId)
    assert.equal(Object.keys(s2.ledger().entries).length, 1, `${e.name}: a conversa existente traz a entrada do turno anterior`)
  })
})

await test("O2 — época DESATUALIZADA (o sal rotacionou): o ledger de trabalho é rotacionado, as entradas viram STALE, o alias é da época nova, e o commit grava rotateTo (committed:true) mesmo sem outra escrita", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s1 = await open(e, PIN({}, sha)); await s1.call("metrics.groups@1", CAPS["metrics.groups@1"].args)
    const ref = Object.keys(s1.ledger().entries)[0]
    assert.equal(((await s1.commit()) as Any).ok, true)
    const next = e.kr.rotate(U1).saltId
    const s2 = await open(e, PIN({}, sha), s1.conversationId)
    assert.equal(s2.ledger().epoch, next, e.name)
    assert.equal(isStale(s2.ledger(), s2.ledger().entries[ref]), true, `${e.name}: a entrada antiga é STALE`)
    assert.equal(s2.aliases().epoch, next, `${e.name}: alias da época nova`)
    const c: Any = await s2.commit()
    assert.deepEqual([c.ok, c.committed], [true, true], `${e.name}: rotação sozinha é um commit`)
    const reopened: Any = await createConversations({ store: e.conv() }).open(U1, s1.conversationId)
    assert.equal(reopened.open.epoch, next, e.name)
    assert.equal(isStale(reopened.open.ledger, reopened.open.ledger.entries[ref]), true, e.name)
    // sem rotação pendente o commit vazio NÃO commita (C5)
    const s3 = await open(e, PIN({}, sha), s1.conversationId); assert.equal(((await s3.commit()) as Any).committed, false, e.name)
  })
})

await test("O3 — falhas de abertura tipadas e sem eco: sem sal ⇒ SALT_REQUIRED; usuário/pin/pedido/deps inválidos ⇒ INVALID_ARGS; conversa inexistente ou de OUTRO usuário ⇒ NOT_FOUND; salts.load que lança ⇒ STORAGE_ERROR; userId nos args da capacidade não vale", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const salt = e.kr.current(U1)!.salt
    const ask = async (deps: Any, req: Any): Promise<Any> => openTurn(deps, req)
    assert.deepEqual(await ask(turnDeps(e, { salts: { load: async () => ({ provider: new InMemorySaltKeyring(), unavailable: [] }) } }), { userId: U1, pin: PIN({}, sha) }), { ok: false, code: "SALT_REQUIRED" }, e.name)
    const bad: Array<[string, Any]> = [
      ["userId inválido", { userId: "a/b", pin: PIN({}, sha) }], ["pin null", { userId: U1, pin: null }], ["pin sem fontes", { userId: U1, pin: PIN({}) }], ["pin com chave extra", { userId: U1, pin: { ...PIN({}, sha), x: 1 } }],
      ["pedido null", null], ["pedido string", "x"], ["chave extra", { userId: U1, pin: PIN({}, sha), extra: 1 }], ["conversationId malformado", { userId: U1, pin: PIN({}, sha), conversationId: 5 }],
    ]
    for (const [why, req] of bad) assert.deepEqual(await ask(turnDeps(e), req), { ok: false, code: "INVALID_ARGS" }, `${e.name}: ${why}`)
    for (const deps of [null, undefined, {}, { ...turnDeps(e), conversations: null }, { ...turnDeps(e), salts: {} }, { ...turnDeps(e), cache: 5 }]) assert.deepEqual(await ask(deps, { userId: U1, pin: PIN({}, sha) }), { ok: false, code: "INVALID_ARGS" }, `${e.name}: deps ${String(deps)}`)
    assert.deepEqual(await ask(turnDeps(e), { userId: U1, pin: PIN({}, sha), conversationId: "conv_inexistente" }), { ok: false, code: "NOT_FOUND" }, e.name)
    const mine = await open(e, PIN({}, sha)); await mine.call("metrics.query@1", Q); await mine.commit()
    e.kr.ensure(U2)
    assert.deepEqual(await ask(turnDeps(e), { userId: U2, pin: PIN({}, sha), conversationId: mine.conversationId }), { ok: false, code: "NOT_FOUND" }, `${e.name}: conversa de outro usuário`)
    const boom = await ask(turnDeps(e, { salts: { load: async () => { throw new Error(`/Users/x/${salt}`) } } }), { userId: U1, pin: PIN({}, sha) })
    assert.deepEqual(boom, { ok: false, code: "STORAGE_ERROR" }); assert.equal(jstr(boom).includes(salt), false)
    // o userId NUNCA vem dos args: a capacidade é strict e a sessão continua sendo do dono
    const s = await open(e, PIN({}, sha))
    const o: Any = await s.call("metrics.query@1", { ...Q, userId: U2 })
    assert.deepEqual([o.ok, o.result.ok, o.result.error.code], [true, false, "ARGS_INVALID"], e.name)
    const o2: Any = await s.call("metrics.query@1", { ...Q, filters: { account: ["Conta A"] }, userId: U2 })
    assert.equal(o2.result.error.code, "ARGS_INVALID", e.name)
  })
})

// ───────────────────────────── K: chamadas ─────────────────────────────
for (const id of Object.keys(CAPS)) {
  await test(`K1 — ${id} via executor: resultado e entrada IDÊNTICOS à consulta direta; spec+pin gravados e recuperáveis em instâncias novas; o cache fica AQUECIDO com o bundle certo (memória e disco)`, async () => {
    await both(async (e) => {
      const sha = await register(e, csvOf(80, 2))
      const pin = PIN({}, sha)
      const cache = createBundleCache()
      const s = await open(e, pin, undefined, { cache })
      const o: Any = await s.call(id, CAPS[id].args)
      assert.equal(o.ok, true, `${e.name}: ${jstr(o)}`); assert.equal(o.result.ok, true, `${e.name}: ${jstr(o.result)}`)
      const d = await direct(e, id, pin)
      assert.equal(jstr(o.result), jstr(d.out.result), `${e.name}: envelope`)
      const ref = refOfResult(o.result)
      assert.deepEqual(plain(s.ledger().entries[ref]), plain({ capability: d.out.entry.capability, handle: d.out.entry.handle, view: d.out.entry.view }), `${e.name}: entrada do ledger`)
      assert.equal(jstr(cache.get(U1, ref)), jstr(d.bundle), `${e.name}: cache aquecido com o bundle`)
      assert.equal(((await s.commit()) as Any).ok, true)
      const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
      assert.deepEqual(back.open.specOf(ref), { capability: id, args: CAPS[id].args }, e.name)
      assert.deepEqual(back.open.pinOf(ref), pin, e.name)
    })
  })
}

await test("K2 — o ALIAS flui no mesmo turno: metrics.groups aloca \"Conta A/B\" e a query seguinte filtra por \"Conta A\" na MESMA sessão; a tabela é gravada no commit", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const s = await open(e, PIN({}, sha))
    assert.equal(((await s.call("metrics.groups@1", CAPS["metrics.groups@1"].args)) as Any).result.ok, true)
    assert.ok(s.aliases().conta.length >= 2, e.name)
    const q: Any = await s.call("metrics.query@1", { ...Q, filters: { account: ["Conta A"] } })
    assert.equal(q.result.ok, true, `${e.name}: ${jstr(q.result)}`)
    assert.equal(((await s.commit()) as Any).ok, true)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    assert.deepEqual(back.open.aliases, s.aliases(), `${e.name}: tabela persistida`)
  })
})

await test("K3 — ORÇAMENTO: a 9ª chamada ⇒ BUDGET_EXCEEDED SEM executar (o ledger não muda); capacidade inexistente/não-string consome chamada e dá ARGS_INVALID; falha de capacidade fica registrada", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s = await open(e, PIN({}, sha))
    const bad: Any = await s.call("nao.existe@1", {}); assert.deepEqual(bad, { ok: false, code: "ARGS_INVALID" }, e.name)
    assert.equal(s.state().calls, 1, `${e.name}: consumiu uma chamada`)
    assert.deepEqual(await s.call(5 as Any, {}), { ok: false, code: "ARGS_INVALID" }, e.name); assert.equal(s.state().calls, 2)
    const fail: Any = await s.call("metrics.query@1", { extra: 1 })
    assert.deepEqual([fail.ok, fail.result.error.code], [true, "ARGS_INVALID"], e.name)
    assert.deepEqual(s.state().failed, [{ capability: "metrics.query@1", code: "ARGS_INVALID" }], e.name)
    for (let i = 0; i < 5; i++) assert.equal(((await s.call("metrics.query@1", Q)) as Any).result.ok, true)
    assert.equal(s.state().calls, 8, e.name)
    const entries = Object.keys(s.ledger().entries).length
    const ninth: Any = await s.call("exit.breakdown@1", CAPS["exit.breakdown@1"].args)
    assert.deepEqual(ninth, { ok: false, code: "BUDGET_EXCEEDED" }, e.name)
    assert.equal(Object.keys(s.ledger().entries).length, entries, `${e.name}: a 9ª não executou`)
    assert.deepEqual([s.state().calls, s.state().budgetExceeded], [8, true], e.name)
  })
})

await test("K4 — evidence.explain: usa o bundle (cache ou REGENERADO), devolve o MESMO resultado do explain direto, e a entrada VAI ao ledger por ref DERIVADO da página (E7-8; antes D-T4 a deixava de fora); também funciona em turno novo, sem cache; ref desconhecido ⇒ NOT_FOUND sem entrada", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const pin = PIN({}, sha)
    const s = await open(e, pin, undefined, { cache: createBundleCache() })
    const q: Any = await s.call("metrics.query@1", Q); const ref = refOfResult(q.result)
    const before = jstr(s.ledger())
    const oracle = await direct(e, "metrics.query@1", pin)
    const expected = (page: number): Any => evidenceExplain({ evidenceRef: ref, page }, { refEpoch: oracle.ctx.refEpoch, source: oracle.ctx.source, aliases: newAliasTable(oracle.ctx.refEpoch), bundleOf: () => oracle.bundle }).result
    for (const page of [1, 2]) {
      const x: Any = await s.call("evidence.explain@1", { evidenceRef: ref, page })
      assert.deepEqual([x.ok, x.result.ok], [true, true], `${e.name}: ${jstr(x)}`)
      assert.equal(jstr(x.result), jstr(expected(page)), `${e.name}: página ${page}`)
    }
    const after = s.ledger()
    assert.equal(Object.keys(after.entries).length, Object.keys(JSON.parse(before).entries).length + 2, `${e.name}: o explain gravou UMA entrada por página`)
    assert.equal(jstr(after.entries[ref]), jstr(JSON.parse(before).entries[ref]), `${e.name}: a entrada analítica ficou intacta`)
    for (const page of [1, 2]) assert.equal(after.entries[explainPageRef(ref, page) as string].capability, "evidence.explain@1", `${e.name}: página ${page}`)
    assert.equal(((await s.commit()) as Any).ok, true)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    assert.equal(back.open.ledger.entries[ref].capability, "metrics.query@1", e.name)
    assert.equal(back.open.ledger.entries[explainPageRef(ref, 1) as string].capability, "evidence.explain@1", e.name)
    // turno NOVO, sem cache: o bundle vem da regeneração (arquivo)
    const s2 = await open(e, pin, s.conversationId)
    const x2: Any = await s2.call("evidence.explain@1", { evidenceRef: ref, page: 1 })
    assert.equal(x2.result.ok, true, `${e.name}: ${jstr(x2)}`); assert.equal(jstr(x2.result), jstr(expected(1)), `${e.name}: regenerado`)
    const ghost: Any = await s2.call("evidence.explain@1", { evidenceRef: "ev_" + "a".repeat(32), page: 1 })
    assert.deepEqual([ghost.ok, ghost.result.error.code], [true, "NOT_FOUND"], e.name)
    const badArgs: Any = await s2.call("evidence.explain@1", { evidenceRef: 5 }); assert.equal(badArgs.result.error.code, "ARGS_INVALID", e.name)
    assert.equal(Object.keys(s2.ledger().entries).length, Object.keys(back.open.ledger.entries).length, `${e.name}: falhas do explain não gravam nada`)
  })
})

await test("K5 — evidence.refresh NO turno: entrada STALE vira CURRENT no ref novo (igual à consulta direta na época nova); o ref novo herda spec+pin (regenerável depois); o antigo segue STALE; refresh de ref CURRENT ⇒ ARGS_INVALID", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const pin = PIN({}, sha)
    const s1 = await open(e, pin); const q: Any = await s1.call("metrics.query@1", Q); const oldRef = refOfResult(q.result)
    assert.equal(((await s1.commit()) as Any).ok, true)
    const next = e.kr.rotate(U1).saltId
    const cache = createBundleCache()
    const s2 = await open(e, pin, s1.conversationId, { cache })
    const r: Any = await s2.call("evidence.refresh@1", { evidenceRef: oldRef })
    assert.deepEqual([r.ok, r.result.ok], [true, true], `${e.name}: ${jstr(r)}`)
    const newRef = refOfResult(r.result)
    assert.notEqual(newRef, oldRef, e.name)
    assert.equal(isStale(s2.ledger(), s2.ledger().entries[oldRef]), true, `${e.name}: o antigo segue STALE`)
    assert.equal(isStale(s2.ledger(), s2.ledger().entries[newRef]), false, e.name)
    const d = await direct(e, "metrics.query@1", pin)
    assert.equal(d.out.entry.handle.evidenceRef, newRef, e.name)
    assert.equal(jstr(cache.get(U1, newRef)), jstr(d.bundle), `${e.name}: o refresh aquece o cache com o bundle do ref novo`)
    assert.deepEqual(plain(s2.ledger().entries[newRef]), plain({ capability: d.out.entry.capability, handle: d.out.entry.handle, view: d.out.entry.view }), `${e.name}: entrada = consulta direta na época ${next}`)
    const again: Any = await s2.call("evidence.refresh@1", { evidenceRef: newRef })
    assert.deepEqual([again.ok, again.result.error.code], [true, "ARGS_INVALID"], `${e.name}: ref CURRENT`)
    assert.equal(((await s2.commit()) as Any).ok, true)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s1.conversationId)
    assert.deepEqual(back.open.specOf(newRef), { capability: "metrics.query@1", args: Q }, `${e.name}: spec herdada`)
    assert.deepEqual(back.open.pinOf(newRef), pin, `${e.name}: pin herdado`)
    const s3 = await open(e, pin, s1.conversationId)
    const x: Any = await s3.call("evidence.explain@1", { evidenceRef: newRef, page: 1 })
    assert.equal(x.result.ok, true, `${e.name}: o ref novo é regenerável (spec+pin)`)
  })
})

await test("K6 — COLISÃO exit.breakdown × exit.analysis (sem compare) no mesmo turno: a 2ª é ENGINE_REFUSED, o ledger fica intacto (1 entrada, a primeira), a falha é registrada, e o commit grava só a 1ª", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const s = await open(e, PIN({}, sha))
    const a: Any = await s.call("exit.breakdown@1", { filters: {}, options: {} }); assert.equal(a.result.ok, true)
    const before = jstr(s.ledger())
    const b: Any = await s.call("exit.analysis@1", { filters: {}, options: {} })
    assert.deepEqual([b.ok, b.result.ok, b.result.error.code], [true, false, "ENGINE_REFUSED"], `${e.name}: ${jstr(b)}`)
    assert.equal(jstr(s.ledger()), before, e.name)
    assert.deepEqual(s.state().failed, [{ capability: "exit.analysis@1", code: "ENGINE_REFUSED" }], e.name)
    const c: Any = await s.commit(); assert.deepEqual([c.ok, c.committed], [true, true], e.name)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    const refs = Object.keys(back.open.ledger.entries)
    assert.equal(refs.length, 1); assert.equal(back.open.ledger.entries[refs[0]].capability, "exit.breakdown@1", e.name)
    assert.equal(back.open.specOf(refs[0]).capability, "exit.breakdown@1", e.name)
  })
})

await test("K7 — repetição IDÊNTICA é idempotente: mesmo envelope, UMA entrada, UMA spec e UMA escrita no commit (o turno seguinte também aceita a mesma consulta sem conflito)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s = await open(e, PIN({}, sha))
    const a: Any = await s.call("metrics.query@1", Q), b: Any = await s.call("metrics.query@1", Q)
    assert.equal(jstr(a.result), jstr(b.result), e.name); assert.equal(Object.keys(s.ledger().entries).length, 1)
    assert.equal(((await s.commit()) as Any).ok, true)
    const s2 = await open(e, PIN({}, sha), s.conversationId)
    const c: Any = await s2.call("metrics.query@1", Q); assert.equal(c.result.ok, true, e.name)
    const done: Any = await s2.commit(); assert.deepEqual([done.ok, done.committed], [true, false], `${e.name}: nada novo para gravar`)
  })
})

await test("K8 — falhas do makeContext traduzidas SEM código novo: arquivo/linha ausente ⇒ FILE_NOT_AVAILABLE; importId forjado ⇒ ENGINE_REFUSED; pin de arquivo não registrado ⇒ FILE_NOT_AVAILABLE; todas registradas no turno", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const row: Any = ((await e.deps().importStore.get(U1, sha)) as Any).row
    const forged = createMemoryImportSourceStore(); await forged.put({ ...row, importId: "imp_00000000aabbccdd" })
    const table: Array<[string, Any, Any, string]> = [
      ["arquivo ausente", { rawStorage: createMemoryRawFileStorage() }, PIN({}, sha), "FILE_NOT_AVAILABLE"],
      ["linha ausente", { importStore: createMemoryImportSourceStore() }, PIN({}, sha), "FILE_NOT_AVAILABLE"],
      ["importId forjado", { importStore: forged }, PIN({}, sha), "ENGINE_REFUSED"],
      ["pin não registrado", {}, PIN({}, "f".repeat(64)), "FILE_NOT_AVAILABLE"],
    ]
    for (const [why, extra, pin, code] of table) {
      const s = await open(e, pin, undefined, extra)
      const o: Any = await s.call("metrics.query@1", Q)
      assert.deepEqual([o.ok, o.result.ok, o.result.error.code], [true, false, code], `${e.name}: ${why}`)
      assert.deepEqual(s.state().failed, [{ capability: "metrics.query@1", code }], `${e.name}: ${why}`)
      assert.equal(Object.keys(s.ledger().entries).length, 0)
      assert.equal(jstr(o).includes("segredo"), false)
    }
    // falha transitória NÃO fica memoizada: a 1ª leitura falha, a chamada seguinte do mesmo turno refaz o ctx e funciona
    const inner = e.deps().rawStorage; let first = true
    const flaky = { put: inner.put.bind(inner), get: async (u: string, h: string) => { if (first) { first = false; return { ok: false, code: "STORAGE_ERROR" } } return inner.get(u, h) }, delete: inner.delete.bind(inner), deleteAllForUser: inner.deleteAllForUser.bind(inner) }
    const f = await open(e, PIN({}, sha), undefined, { rawStorage: flaky })
    const bad: Any = await f.call("metrics.query@1", Q); assert.deepEqual([bad.result.ok, bad.result.error.code], [false, "ENGINE_REFUSED"], `${e.name}: falha transitória`)
    const good: Any = await f.call("metrics.query@1", Q); assert.equal(good.result.ok, true, `${e.name}: a falha não ficou memoizada`)
  })
})

await test("K9 — o ctx é MEMOIZADO por pin (3 chamadas ⇒ 1 leitura do arquivo) e o pin do TURNO é o usado: dois arquivos no pin dão o ref da consulta direta sobre os dois", async () => {
  await both(async (e) => {
    const sha1 = await register(e, csvOf(60, 1)), sha2 = await register(e, csvOf(60, 5))
    const inner = e.deps().rawStorage; let reads = 0
    const rawStorage = { put: inner.put.bind(inner), get: async (u: string, h: string) => { reads += 1; return inner.get(u, h) }, delete: inner.delete.bind(inner), deleteAllForUser: inner.deleteAllForUser.bind(inner) }
    const pin = PIN({ minSample: 5 }, sha1, sha2)
    const s = await open(e, pin, undefined, { rawStorage })
    for (const id of ["metrics.query@1", "exit.breakdown@1", "metrics.groups@1"]) assert.equal(((await s.call(id, CAPS[id].args)) as Any).result.ok, true, id)
    assert.equal(reads, 2, `${e.name}: 2 arquivos lidos UMA vez cada, não por chamada`)
    const d = await direct(e, "metrics.query@1", pin)
    assert.equal(refOfResult(((await open(e, pin).then((x: Any) => x.call("metrics.query@1", Q))) as Any).result), d.out.entry.handle.evidenceRef, `${e.name}: pin inteiro (2 fontes + analysis)`)
    const only1 = await direct(e, "metrics.query@1", PIN({ minSample: 5 }, sha1))
    assert.notEqual(only1.out.entry.handle.evidenceRef, d.out.entry.handle.evidenceRef, "o pin de 1 fonte dá outro ref")
  })
})

// ───────────────────────────── C: commit ─────────────────────────────
await test("C1 — o commit persiste entradas, specs e aliases de um turno com várias chamadas; REABRE em instâncias NOVAS com o mesmo ledger e tabela, e cada ref é regenerável a partir do que foi gravado", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const pin = PIN({}, sha)
    const s = await open(e, pin)
    await s.call("metrics.groups@1", CAPS["metrics.groups@1"].args)
    await s.call("metrics.query@1", { ...Q, filters: { account: ["Conta A"] } })
    await s.call("exit.breakdown@1", CAPS["exit.breakdown@1"].args)
    const refs = Object.keys(s.ledger().entries); assert.equal(refs.length, 3)
    const c: Any = await s.commit(); assert.deepEqual([c.ok, c.committed, c.version], [true, true, 1], e.name)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    assert.deepEqual(plain(back.open.ledger), plain(s.ledger()), `${e.name}: ledger`)
    assert.deepEqual(back.open.aliases, s.aliases(), `${e.name}: aliases`)
    for (const ref of refs) {
      assert.deepEqual(back.open.pinOf(ref), pin, e.name)
      const r: Any = await regenerateBundle({ ...e.deps() }, { userId: U1, conversation: back.open, ref })
      assert.equal(r.ok, true, `${e.name}: ${r.code}`)
    }
  })
})

await test("C2 — CONCORRÊNCIA: duas sessões na mesma versão; a 1ª commita, a 2ª recebe TURN_CONFLICT SEM retry — nada do turno perdedor é gravado e o do vencedor fica intacto", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const base = await open(e, PIN({}, sha)); await base.call("metrics.query@1", Q); await base.commit()
    const a = await open(e, PIN({}, sha), base.conversationId), b = await open(e, PIN({}, sha), base.conversationId)
    await a.call("metrics.groups@1", CAPS["metrics.groups@1"].args)
    await b.call("exit.breakdown@1", CAPS["exit.breakdown@1"].args)
    const winner: Any = await a.commit(); assert.deepEqual([winner.ok, winner.version], [true, 2], e.name)
    const loser: Any = await b.commit(); assert.deepEqual(loser, { ok: false, code: "TURN_CONFLICT" }, e.name)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, base.conversationId)
    assert.equal(back.open.version, 2, `${e.name}: nenhuma versão extra (sem retry)`)
    const caps = Object.values(back.open.ledger.entries).map((x: Any) => x.capability).sort()
    assert.deepEqual(caps, ["metrics.groups@1", "metrics.query@1"], `${e.name}: só o vencedor`)
  })
})

await test("C3 — erros do commit TRADUZIDOS sem eco: CONFLICT ⇒ TURN_CONFLICT; LIMIT_* ⇒ LIMIT_EXCEEDED; STORAGE_ERROR/CORRUPT ⇒ STORAGE_ERROR; demais (ledger/spec/alias inválidos) ⇒ COMMIT_REJECTED; a sessão fica fechada", async () => {
  const e = memEnv()
  const sha = await register(e, csvOf(60, 1))
  const table: Array<[string, string]> = [["CONFLICT", "TURN_CONFLICT"], ["LIMIT_ENTRIES", "LIMIT_EXCEEDED"], ["LIMIT_ROW", "LIMIT_EXCEEDED"], ["LIMIT_DELTA", "LIMIT_EXCEEDED"], ["STORAGE_ERROR", "STORAGE_ERROR"], ["CORRUPT", "STORAGE_ERROR"],
    ["LEDGER_CONFLICT", "COMMIT_REJECTED"], ["SPEC_CONFLICT", "COMMIT_REJECTED"], ["ALIAS_NOT_EXTENDING", "COMMIT_REJECTED"], ["INVALID_ARGS", "COMMIT_REJECTED"], ["NOT_FOUND", "COMMIT_REJECTED"], ["DUPLICATE", "COMMIT_REJECTED"]]
  for (const [code, expected] of table) {
    const real = createConversations({ store: e.conv() })
    const conversations = { create: real.create.bind(real), open: real.open.bind(real), commitTurn: async () => ({ ok: false, code }) }
    const s = await open(e, PIN({}, sha), undefined, { conversations })
    await s.call("metrics.query@1", Q)
    assert.deepEqual(await s.commit(), { ok: false, code: expected }, code)
    assert.deepEqual(await s.commit(), { ok: false, code: "TURN_CLOSED" }, `${code}: sessão fechada`)
  }
  const real = createConversations({ store: e.conv() })
  const weird = { create: real.create.bind(real), open: real.open.bind(real), commitTurn: async () => { throw new Error("/Users/x/segredo") } }
  const s = await open(e, PIN({}, sha), undefined, { conversations: weird }); await s.call("metrics.query@1", Q)
  const r: Any = await s.commit(); assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.equal(jstr(r).includes("segredo"), false)
})

await test("C4 — sessão FECHADA após o commit (com sucesso ou não): call, validate e um 2º commit ⇒ TURN_CLOSED; nada é executado nem gravado", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s = await open(e, PIN({}, sha)); await s.call("metrics.query@1", Q)
    assert.equal(((await s.commit()) as Any).ok, true)
    const callsBefore = s.state().calls
    assert.deepEqual(await s.call("metrics.query@1", Q), { ok: false, code: "TURN_CLOSED" }, e.name)
    assert.deepEqual(await s.call("nao.existe@1", {}), { ok: false, code: "TURN_CLOSED" }, e.name)
    assert.deepEqual(await s.validate({ segments: [{ kind: "text", text: "oi" }], claims: [] }), { ok: false, code: "TURN_CLOSED" }, e.name)
    assert.deepEqual(await s.commit(), { ok: false, code: "TURN_CLOSED" }, e.name)
    assert.equal(s.state().calls, callsBefore, `${e.name}: nada foi contado`)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId); assert.equal(back.open.version, 1, e.name)
  })
})

await test("C5 — turno SEM escritas não avança a versão (committed:false): sem chamadas, só falhas, ou só repetição; um turno só de explain COMMITA a entrada nova (E7-8) e repeti-lo não commita", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const empty = await open(e, PIN({}, sha)); const r0: Any = await empty.commit(); assert.deepEqual([r0.ok, r0.committed], [true, false], e.name)
    const onlyFail = await open(e, PIN({}, sha), empty.conversationId); await onlyFail.call("metrics.query@1", { extra: 1 })
    assert.equal(((await onlyFail.commit()) as Any).committed, false, e.name)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, empty.conversationId); assert.equal(back.open.version, 0, `${e.name}: versão inalterada`)
    const seed = await open(e, PIN({}, sha), empty.conversationId); await seed.call("metrics.query@1", Q); assert.equal(((await seed.commit()) as Any).version, 1)
    const ref = Object.keys(seed.ledger().entries)[0]
    const ex = await open(e, PIN({}, sha), empty.conversationId)
    const before = jstr(ex.aliases())
    const x: Any = await ex.call("evidence.explain@1", { evidenceRef: ref, page: 1 }); assert.equal(x.result.ok, true, e.name)
    const c: Any = await ex.commit()
    assert.deepEqual([c.ok, c.committed], [true, true], `${e.name}: a entrada nova do explain é uma escrita (alias alocado: ${jstr(ex.aliases()) !== before})`)
    const again = await open(e, PIN({}, sha), empty.conversationId)
    assert.equal((await again.call("evidence.explain@1", { evidenceRef: ref, page: 1 }) as Any).result.ok, true, e.name)
    const c2: Any = await again.commit()
    assert.deepEqual([c2.ok, c2.committed], [true, false], `${e.name}: repetir o mesmo explain não escreve nada`)
  })
})

// ───────────────────────────── T: citabilidade do evidence.explain (E7-8) ─────────────────────────────
const exEntries = (ledger: Any): string[] => Object.keys(ledger.entries).filter((r) => ledger.entries[r].capability === "evidence.explain@1")
const citeAnswer = (ref: string, path: string): Any => ({ segments: [{ kind: "text", text: "Segue o valor:" }, { kind: "slot", ref, path }, { kind: "phrase", code: "POPULATION_DECLARED", ref }], claims: [{ ref, path, mode: "ASSERT" }] })
async function withExplain(e: Env, pages: number[] = [1]): Promise<{ s: Any; pin: Any; sha: string; ref: string; ds: string[] }> {
  const sha = await register(e, csvOf(80, 2)); const pin = PIN({}, sha)
  const s = await open(e, pin, undefined, { cache: createBundleCache() })
  const q: Any = await s.call("metrics.query@1", Q); const ref = refOfResult(q.result)
  for (const page of pages) assert.equal(((await s.call("evidence.explain@1", { evidenceRef: ref, page })) as Any).result.ok, true, e.name)
  return { s, pin, sha, ref, ds: pages.map((p) => explainPageRef(ref, p) as string) }
}

await test("T1 — o explain entra no ledger do turno: UMA entrada por (ref, página), capability evidence.explain@1, handle com o ref DERIVADO e o evidenceHash do bundle analítico; a entrada analítica fica intacta; envelope == handle da entrada (sem o hash)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2)); const pin = PIN({}, sha)
    const s = await open(e, pin, undefined, { cache: createBundleCache() })
    const q: Any = await s.call("metrics.query@1", Q); const ref = refOfResult(q.result)
    const analytic = jstr(s.ledger().entries[ref])
    const x1: Any = await s.call("evidence.explain@1", { evidenceRef: ref, page: 1 }), x2: Any = await s.call("evidence.explain@1", { evidenceRef: ref, page: 2 })
    const [d1, d2] = [explainPageRef(ref, 1) as string, explainPageRef(ref, 2) as string]
    assert.notEqual(d1, d2, e.name)
    assert.deepEqual(exEntries(s.ledger()).sort(), [d1, d2].sort(), `${e.name}: duas entradas do explain`)
    assert.equal(Object.keys(s.ledger().entries).length, 3, e.name); assert.equal(jstr(s.ledger().entries[ref]), analytic, `${e.name}: a analítica não mudou`)
    for (const [x, d] of [[x1, d1], [x2, d2]] as const) {
      const en = s.ledger().entries[d]
      assert.equal(x.result.evidence.evidenceRef, d, `${e.name}: o envelope leva o ref derivado`)
      assert.equal(en.handle.evidenceRef, d, e.name)
      assert.equal(en.handle.evidenceHash, s.ledger().entries[ref].handle.evidenceHash, `${e.name}: o hash é o do bundle analítico`)
      assert.deepEqual({ ...en.handle, evidenceHash: undefined }, { ...x.result.evidence, evidenceHash: undefined }, `${e.name}: envelope == handle da entrada`)
      assert.deepEqual(plain(en.view), plain(x.result.data), `${e.name}: a view da entrada é a que o modelo recebeu`)
    }
    assert.deepEqual([s.state().calls, s.state().failed], [3, []], e.name)
  })
})

await test("T2 — CITAÇÃO ponta a ponta: slot em trades[0].pnlNet do ref derivado passa o validate e RENDERIZA o valor; o mesmo caminho sobre o ref ANALÍTICO, um índice fora da página e um caminho de outra view são rejeitados com SLOT_PATH_INVALID", async () => {
  await both(async (e) => {
    const { s, ds } = await withExplain(e, [1, 2])
    const good = citeAnswer(ds[0], "trades[0].pnlNet")
    const v: Any = await s.validate(good); assert.equal(v.ok, true, `${e.name}: ${jstr(v)}`); assert.equal(v.claims.length, 1)
    const rendered: Any = renderAnswer({ answer: good, ledger: s.ledger(), notices: [] })
    assert.equal(rendered.ok, true, e.name)
    const slot = rendered.rendered.segments.find((g: Any) => g.kind === "value")
    assert.match(String(slot.text), /^-?US\$ /, `${e.name}: ${jstr(slot)}`)
    const p2: Any = await s.validate(citeAnswer(ds[1], "trades[0].pnlNet")); assert.equal(p2.ok, true, `${e.name}: página 2 também é citável (${jstr(p2)})`)
    // a 3ª rejeição de uma sessão é STOP (sem feedback): cada caso ruim vai numa sessão nova, com o mesmo ledger
    for (const [why, mk] of [["ref analítico", (r: string) => citeAnswer(r, "trades[0].pnlNet")], ["índice fora da página", (_r: string, d: string[]) => citeAnswer(d[0], "trades[20].pnlNet")], ["caminho de outra view", (_r: string, d: string[]) => citeAnswer(d[0], "metrics[0].value")]] as const) {
      const w = await withExplain(e, [1])
      const r: Any = await w.s.validate(mk(w.ref, w.ds)); assert.equal(r.ok, false, `${e.name}: ${why}`); assert.deepEqual(r.feedback, ["SLOT_PATH_INVALID"], `${e.name}: ${why}: ${jstr(r)}`)
    }
  })
})

await test("T3 — IDEMPOTÊNCIA: o mesmo explain duas vezes no turno ⇒ mesmo envelope e UMA entrada; num turno seguinte (sem cache) também; o commit do repetido não escreve nada (committed:false, versão igual)", async () => {
  await both(async (e) => {
    const { s, sha, pin, ref, ds } = await withExplain(e, [1])
    const again: Any = await s.call("evidence.explain@1", { evidenceRef: ref, page: 1 })
    assert.equal(again.result.evidence.evidenceRef, ds[0], e.name); assert.deepEqual(exEntries(s.ledger()), [ds[0]], `${e.name}: UMA entrada`)
    const c: Any = await s.commit(); assert.deepEqual([c.ok, c.committed], [true, true], e.name)
    const versionAfter = ((await createConversations({ store: e.conv() }).open(U1, s.conversationId)) as Any).open.version
    const s2 = await open(e, pin, s.conversationId)
    const x: Any = await s2.call("evidence.explain@1", { evidenceRef: ref, page: 1 })
    assert.equal(x.result.ok, true, e.name); assert.equal(x.result.evidence.evidenceRef, ds[0], e.name)
    assert.deepEqual(exEntries(s2.ledger()), [ds[0]], e.name)
    const c2: Any = await s2.commit(); assert.deepEqual([c2.ok, c2.committed], [true, false], `${e.name}: repetição não escreve`)
    assert.equal(((await createConversations({ store: e.conv() }).open(U1, s.conversationId)) as Any).open.version, versionAfter, `${e.name}: versão inalterada`)
    void sha
  })
})

await test("T4 — o commit PERSISTE a entrada do explain: reabrir em instâncias NOVAS devolve a mesma entrada (sem spec nem pin: não é regenerável) e a citação continua válida e renderizando o mesmo texto", async () => {
  await both(async (e) => {
    const { s, pin, ds } = await withExplain(e, [1, 2])
    const good = citeAnswer(ds[0], "trades[0].pnlNet")
    const before: Any = renderAnswer({ answer: good, ledger: s.ledger(), notices: [] })
    assert.equal(((await s.commit()) as Any).ok, true)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    for (const d of ds) assert.deepEqual(plain(back.open.ledger.entries[d]), plain(s.ledger().entries[d]), `${e.name}: entrada persistida`)
    assert.deepEqual([back.open.specOf(ds[0]), back.open.pinOf(ds[0])], [null, null], `${e.name}: o ref derivado não tem spec nem pin`)
    const s2 = await open(e, pin, s.conversationId)
    assert.equal(((await s2.validate(good)) as Any).ok, true, e.name)
    assert.equal(jstr(renderAnswer({ answer: good, ledger: s2.ledger(), notices: [] })), jstr(before), `${e.name}: mesma renderização`)
  })
})

await test("T5 — ROTAÇÃO de época: a entrada derivada antiga vira STALE (citar ⇒ STALE_REF); refresh do analítico + explain no ref NOVO grava um ref derivado NOVO (≠ do antigo) que passa a citação; o antigo segue STALE na auditoria", async () => {
  await both(async (e) => {
    const { s, pin, ref, ds } = await withExplain(e, [1])
    assert.equal(((await s.commit()) as Any).ok, true)
    e.kr.rotate(U1)
    const s2 = await open(e, pin, s.conversationId)
    assert.equal(isStale(s2.ledger(), s2.ledger().entries[ds[0]]), true, `${e.name}: derivada antiga STALE`)
    const stale: Any = await s2.validate(citeAnswer(ds[0], "trades[0].pnlNet")); assert.equal(stale.ok, false, e.name); assert.ok(stale.feedback.includes("STALE_REF"), `${e.name}: ${jstr(stale)}`)
    const r: Any = await s2.call("evidence.refresh@1", { evidenceRef: ref }); const newRef = refOfResult(r.result)
    assert.notEqual(newRef, ref, e.name)
    const x: Any = await s2.call("evidence.explain@1", { evidenceRef: newRef, page: 1 }); assert.equal(x.result.ok, true, `${e.name}: ${jstr(x)}`)
    const dNew = explainPageRef(newRef, 1) as string
    assert.notEqual(dNew, ds[0], e.name)
    assert.equal(isStale(s2.ledger(), s2.ledger().entries[dNew]), false, `${e.name}: a nova é CURRENT`)
    assert.equal(isStale(s2.ledger(), s2.ledger().entries[ds[0]]), true, `${e.name}: a antiga segue STALE`)
    assert.equal(((await s2.validate(citeAnswer(dNew, "trades[0].pnlNet"))) as Any).ok, true, e.name)
    assert.equal(((await s2.commit()) as Any).ok, true)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    assert.deepEqual(exEntries(back.open.ledger).sort(), [ds[0], dNew].sort(), `${e.name}: as duas ficam na conversa`)
  })
})

await test("T6 — o ref derivado NÃO é regenerável nem refrescável: explain sobre ele ⇒ NOT_FOUND; refresh dele (CURRENT ou STALE) ⇒ ARGS_INVALID; nenhuma spec/pin nova é gravada", async () => {
  await both(async (e) => {
    const { s, pin, ds } = await withExplain(e, [1])
    const ex: Any = await s.call("evidence.explain@1", { evidenceRef: ds[0], page: 1 }); assert.deepEqual([ex.ok, ex.result.error.code], [true, "NOT_FOUND"], e.name)
    const rf: Any = await s.call("evidence.refresh@1", { evidenceRef: ds[0] }); assert.deepEqual([rf.ok, rf.result.error.code], [true, "ARGS_INVALID"], `${e.name}: CURRENT`)
    assert.equal(((await s.commit()) as Any).ok, true)
    e.kr.rotate(U1)
    const s2 = await open(e, pin, s.conversationId)
    const rf2: Any = await s2.call("evidence.refresh@1", { evidenceRef: ds[0] }); assert.deepEqual([rf2.ok, rf2.result.error.code], [true, "ARGS_INVALID"], `${e.name}: STALE`)
    const back: Any = await createConversations({ store: e.conv() }).open(U1, s.conversationId)
    assert.deepEqual([back.open.specOf(ds[0]), back.open.pinOf(ds[0])], [null, null], e.name)
  })
})

await test("T7 — CONFLITO no ref derivado (entrada CURRENT diferente já no ledger): ENGINE_REFUSED, o ledger fica intacto, a falha é registrada e NENHUM dado do explain chega ao modelo", async () => {
  await both(async (e) => {
    const { s, pin, ref, ds } = await withExplain(e, [1])
    assert.equal(((await s.commit()) as Any).ok, true)
    // ledger FORJADO: a entrada do explain com a view alterada (mesmo ref derivado, conteúdo diferente)
    const real = createConversations({ store: e.conv() })
    const forged = { ...real, open: async (u: string, id: string): Promise<Any> => {
      const got: Any = await real.open(u, id)
      const entry = got.open.ledger.entries[ds[0]]
      const mutated = { capability: entry.capability, handle: entry.handle, view: { ...entry.view, total: entry.view.total + 1 } }
      const base: Any = addEvidence((newLedger(got.open.ledger.epoch) as Any).ledger, got.open.ledger.entries[ref])
      const forgedLedger: Any = addEvidence(base.ledger, mutated)
      assert.equal(forgedLedger.ok, true, "o ledger forjado precisa ser válido")
      return { ok: true, open: { ...got.open, ledger: forgedLedger.ledger } }
    } }
    const s2: Any = (await openTurn(turnDeps(e, { conversations: forged }), { userId: U1, conversationId: s.conversationId, pin })).session
    const before = jstr(s2.ledger())
    const x: Any = await s2.call("evidence.explain@1", { evidenceRef: ref, page: 1 })
    assert.deepEqual([x.ok, x.result.ok, x.result.error.code], [true, false, "ENGINE_REFUSED"], `${e.name}: ${jstr(x)}`)
    assert.equal(x.result.data, null, e.name); assert.equal(jstr(x).includes("trades"), false, `${e.name}: nenhum dado do explain`)
    assert.equal(jstr(s2.ledger()), before, `${e.name}: ledger intacto`)
    assert.deepEqual(s2.state().failed, [{ capability: "evidence.explain@1", code: "ENGINE_REFUSED" }], e.name)
  })
})

await test("T8 — ISOLAMENTO: o explain não aquece o cache sob o ref derivado (as estatísticas não mudam e get(derivado) é null); o outro usuário não vê a conversa nem a entrada", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2)); const pin = PIN({}, sha)
    const cache = createBundleCache()
    const s = await open(e, pin, undefined, { cache })
    const q: Any = await s.call("metrics.query@1", Q); const ref = refOfResult(q.result)
    const stats = jstr(cache.stats())
    for (const page of [1, 2]) assert.equal(((await s.call("evidence.explain@1", { evidenceRef: ref, page })) as Any).result.ok, true, e.name)
    assert.equal(jstr(cache.stats()), stats, `${e.name}: cache inalterado pelo explain`)
    for (const page of [1, 2]) { assert.equal(cache.get(U1, explainPageRef(ref, page) as string), null, e.name); assert.equal(cache.get(U2, explainPageRef(ref, page) as string), null, e.name) }
    // por construção o cache NÃO aceita o bundle sob o ref derivado (ref × hash): é por isso que "aquecer o cache sob o derivado" é impossível
    const oracle = await direct(e, "metrics.query@1", pin)
    assert.deepEqual(cache.put(U1, explainPageRef(ref, 1) as string, oracle.bundle), { ok: false, code: "INVALID_ARGS" }, `${e.name}: o cache recusa o bundle sob o ref derivado`)
    assert.equal(((await s.commit()) as Any).ok, true)
    e.kr.ensure(U2)
    assert.deepEqual(await openTurn(turnDeps(e), { userId: U2, pin: PIN({}, sha), conversationId: s.conversationId }), { ok: false, code: "NOT_FOUND" }, `${e.name}: outro usuário`)
  })
})

// ───────────────────────────── V: validação roteirizada ─────────────────────────────
await test("V1 — session.validate sobre o ledger de TRABALHO: resposta válida aceita (inclui citar um slot real); inválida ⇒ REGENERATE com feedback só de códigos; a 3ª rejeição ⇒ STOP/REGEN_EXHAUSTED com a resposta canônica; citar ref STALE é rejeitado", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const s = await open(e, PIN({}, sha))
    const q: Any = await s.call("metrics.query@1", { metricIds: ["netPnl", "winRate"], filters: {}, options: {} }); const ref = refOfResult(q.result)
    const good = { segments: [{ kind: "text", text: "Segue o valor:" }, { kind: "slot", ref, path: "metrics[0].value" }, { kind: "phrase", code: "POPULATION_DECLARED", ref }], claims: [{ ref, path: "metrics[0].value", mode: "ASSERT" }] }
    const v: Any = await s.validate(good); assert.equal(v.ok, true, `${e.name}: ${jstr(v)}`); assert.equal(v.claims.length, 1)
    const r1: Any = await s.validate({ nope: 1 }); assert.deepEqual([r1.ok, r1.action, r1.feedback], [false, "REGENERATE", ["STRUCTURE_INVALID"]], e.name)
    const r2: Any = await s.validate({ segments: [{ kind: "slot", ref: "ev_" + "0".repeat(32), path: "metrics[0].value" }], claims: [] })
    assert.deepEqual([r2.ok, r2.action], [false, "REGENERATE"], e.name); assert.ok(r2.feedback.length > 0)
    const r3: Any = await s.validate(null)
    assert.deepEqual([r3.ok, r3.action, r3.stopReason], [false, "STOP", "REGEN_EXHAUSTED"], e.name)
    assert.equal(jstr(r3.response), jstr(stopResponse(s.state())), `${e.name}: resposta canônica de parada`)
    assert.equal(s.state().rejections, 3, e.name)
    // ref STALE na resposta
    assert.equal(((await s.commit()) as Any).ok, true)
    e.kr.rotate(U1)
    const s2 = await open(e, PIN({}, sha), s.conversationId)
    const stale: Any = await s2.validate(good); assert.equal(stale.ok, false, e.name); assert.ok(stale.feedback.includes("STALE_REF"), `${e.name}: ${jstr(stale)}`)
  })
})

await test("V2 — o stop do turno CHEGA ao validador: após a 9ª chamada (BUDGET_CALLS) uma resposta sem a frase de limite é rejeitada; com a frase, aceita; antes do estouro a mesma frase é inválida", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s = await open(e, PIN({}, sha))
    const plainAnswer = { segments: [{ kind: "text", text: "Segue o resumo." }], claims: [] }
    const withPhrase = { segments: [{ kind: "text", text: "Segue o resumo." }, { kind: "phrase", code: "BUDGET_LIMIT_REACHED" }], claims: [] }
    assert.equal(((await s.validate(plainAnswer)) as Any).ok, true, `${e.name}: sem estouro`)
    assert.equal(((await s.validate(withPhrase)) as Any).ok, false, `${e.name}: a frase de limite fora de hora`)
    for (let i = 0; i < 8; i++) await s.call("metrics.query@1", Q)
    assert.deepEqual(await s.call("metrics.query@1", Q), { ok: false, code: "BUDGET_EXCEEDED" })
    const bad: Any = await s.validate(plainAnswer); assert.deepEqual([bad.ok, bad.feedback], [false, ["INCOMPLETE_PRESENTED_AS_COMPLETE"]], e.name)
    assert.equal(((await s.validate(withPhrase)) as Any).ok, true, `${e.name}: com a frase de limite`)
  })
})

// ───────────────────────────── S: segurança ─────────────────────────────
await test("S1 — NADA sai com sal, caminho, fileName ou mensagem: todos os resultados de sucesso e de falha são varridos; os arquivos em disco não contêm o valor do sal", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1), { fileName: "segredo-cliente.csv" })
    const salt = e.kr.current(U1)!.salt
    const outs: unknown[] = []
    const s = await open(e, PIN({}, sha), undefined, { cache: createBundleCache() })
    outs.push(await s.call("metrics.groups@1", CAPS["metrics.groups@1"].args), await s.call("metrics.query@1", { ...Q, filters: { account: ["Conta A"] } }), await s.call("metrics.query@1", { extra: salt }), await s.call("nao.existe@1", { x: salt }))
    const ref = Object.keys(s.ledger().entries)[0]
    outs.push(await s.call("evidence.explain@1", { evidenceRef: ref, page: 1 }), await s.call("evidence.explain@1", { evidenceRef: "ev_" + "a".repeat(32), page: 1 }), await s.call("evidence.refresh@1", { evidenceRef: ref }))
    outs.push(await s.validate({ nope: salt }), await s.commit(), await s.commit())
    const broken = await open(e, PIN({}, sha), undefined, { rawStorage: createMemoryRawFileStorage() })
    outs.push(await broken.call("metrics.query@1", Q), await openTurn(turnDeps(e, { salts: { load: async () => { throw new Error(`/Users/x/${salt}/segredo-cliente.csv`) } } }), { userId: U1, pin: PIN({}, sha) }))
    for (const o of outs) {
      const t = jstr(o)
      for (const leak of [salt, "segredo-cliente", "/Users/", "Error", "export.csv"]) assert.equal(t.includes(leak), false, `${e.name}: eco de "${leak}" em ${t.slice(0, 160)}`)
    }
    if (e.root !== undefined) for (const f of walk(e.root)) assert.equal(readFileSync(f).includes(Buffer.from(salt)), false, `${e.name}: sal em ${f}`)
  })
})

await test("S2 — tripwire de imports: só turn-session.ts (além de regenerate.ts) importa agent-capabilities/; só ele, chat-turn.ts e conversation-store.ts importam agent/ dentro de infra/; não importa salt.ts nem node:crypto; sem Date/aleatório de módulo no fluxo de decisão", async () => {
  const dir = join(ROOT, "src", "lib", "infra")
  const strip = (c: string): string => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  const importers = (re: RegExp): string[] => readdirSync(dir).filter((f) => f.endsWith(".ts") && re.test(strip(readFileSync(join(dir, f), "utf8")))).sort()
  assert.deepEqual(importers(/from\s+["'][^"']*agent-capabilities\//), ["regenerate.ts", "turn-session.ts"])
  assert.deepEqual(importers(/from\s+["'][^"']*\.\.\/agent\//), ["chat-turn.ts", "conversation-store.ts", "turn-session.ts"])
  const code = strip(readFileSync(join(dir, "turn-session.ts"), "utf8"))
  assert.equal(/from\s+["'][^"']*ingest\/salt(\.ts)?["']/.test(code), false, "importa salt.ts")
  assert.equal(/from\s+["'](node:)?crypto["']/.test(code), false, "importa node:crypto")
  assert.equal(/process\.env|\bfetch\s*\(|prisma|anthropic|openai|@ai-sdk/i.test(code), false, "dependência proibida (sem LLM, sem ambiente, sem rede)")
  assert.equal(/\buserId\s*:\s*[a-zA-Z.]*args/.test(code) || /args\.userId|args\)\.userId/.test(code), false, "userId nunca vem dos args")
})

// ───────────────────────────── N: mensagens da conversa (E7-9) ─────────────────────────────
const goodAnswer = (ref: string): Any => ({ segments: [{ kind: "text", text: "Segue o valor:" }, { kind: "slot", ref, path: "metrics[0].value" }, { kind: "phrase", code: "POPULATION_DECLARED", ref }], claims: [{ ref, path: "metrics[0].value", mode: "ASSERT" }] })
const otherAnswer = (ref: string): Any => ({ segments: [{ kind: "text", text: "Outro valor:" }, { kind: "slot", ref, path: "metrics[1].value" }, { kind: "phrase", code: "POPULATION_DECLARED", ref }], claims: [{ ref, path: "metrics[1].value", mode: "ASSERT" }] })
const withMessage = async (e: Env, userMessage: string | undefined, sha: string, conversationId?: string | null, extra: Any = {}): Promise<Any> => {
  const r: Any = await openTurn(turnDeps(e, extra), { userId: U1, pin: PIN({}, sha), conversationId, ...(userMessage !== undefined ? { userMessage } : {}) } as Any)
  assert.equal(r.ok, true, `openTurn: ${r.code}`)
  return r.session
}
const messagesOf = async (e: Env, id: string): Promise<Any[]> => { const r: Any = await createConversations({ store: e.conv() }).open(U1, id); assert.equal(r.ok, true, r.code); return r.open.messages }

await test("N1 — userMessage: válida (inclusive 4.000) é gravada LITERAL no commit; não-string/null/vazia/só espaços/4.001/objeto ⇒ INVALID_ARGS; ausente ⇒ nada muda (turno vazio segue committed:false)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    for (const v of [5, null, "", "   \n\t", "x".repeat(4001), { a: 1 }, ["oi"]]) assert.deepEqual(await openTurn(turnDeps(e), { userId: U1, pin: PIN({}, sha), userMessage: v } as Any), { ok: false, code: "INVALID_ARGS" }, `${e.name}: ${jstr(v).slice(0, 30)}`)
    for (const text of ["  qual o resultado?  ", "y".repeat(4000)]) {
      const s = await withMessage(e, text, sha); const c: Any = await s.commit()
      assert.deepEqual([c.ok, c.committed, c.version], [true, true, 1], e.name)
      assert.deepEqual((await messagesOf(e, s.conversationId)).map((m) => [m.role, m.text]), [["user", text]], `${e.name}: literal (sem trim, sem alteração)`)
    }
    const none = await withMessage(e, undefined, sha); const c0: Any = await none.commit()
    assert.deepEqual([c0.ok, c0.committed, c0.version], [true, false, 0], `${e.name}: sem userMessage o turno vazio não commita`)
    const calls = await withMessage(e, undefined, sha); await calls.call("metrics.query@1", Q); await calls.commit()
    assert.deepEqual(await messagesOf(e, calls.conversationId), [], `${e.name}: sem userMessage e sem resposta, nenhuma mensagem`)
  })
})

await test("N2 — resposta ACEITA vira a mensagem do assistente na ordem [user, assistant]: answer validado + rendered IGUAL ao renderAnswer(mesmo answer/ledger/notices) + citations; o ledger e a época não alteram o registrado", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const s = await withMessage(e, "resultado e taxa de acerto?", sha); const ref = refOfResult(((await s.call("metrics.query@1", Q)) as Any).result)
    const good = goodAnswer(ref); const v: Any = await s.validate(good); assert.equal(v.ok, true, `${e.name}: ${jstr(v)}`)
    const expected: Any = renderAnswer({ answer: good, ledger: s.ledger(), notices: notices(s.state()), stop: null })
    assert.equal(expected.ok, true, e.name)
    assert.equal((await s.commit() as Any).committed, true, e.name)
    const msgs = await messagesOf(e, s.conversationId)
    assert.deepEqual(msgs.map((m) => [m.role, m.turn]), [["user", 1], ["assistant", 1]], `${e.name}: ordem`)
    assert.deepEqual(msgs[1].answer, good, e.name); assert.deepEqual(msgs[1].citations, [ref], e.name)
    assert.equal(jstr(msgs[1].rendered), jstr(expected.rendered), `${e.name}: rendered == renderAnswer`)
    assert.ok(msgs[1].rendered.segments.some((g: Any) => g.kind === "value" && g.ref === ref), `${e.name}: o valor está no texto renderizado`)
    // o registro NÃO é recalculado: depois de a época girar o ref vira STALE, mas a mensagem relida é a mesma
    e.kr.rotate(U1); const s2 = await withMessage(e, undefined, sha, s.conversationId)
    assert.equal(jstr((await messagesOf(e, s2.conversationId))[1].rendered), jstr(expected.rendered), `${e.name}: registro intacto após rotação`)
  })
})

await test("N3 — STOP: após 3 rejeições a mensagem do assistente é answer NULO + rendered == stopResponse(state) (stopReason REGEN_EXHAUSTED), sem texto do modelo", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s = await withMessage(e, "pergunta", sha); await s.call("metrics.query@1", Q)
    for (let i = 0; i < 2; i++) assert.equal(((await s.validate({ nope: i })) as Any).action, "REGENERATE", e.name)
    const stop: Any = await s.validate({ nope: "SEGREDO-DO-MODELO" }); assert.equal(stop.action, "STOP", e.name)
    await s.commit()
    const msgs = await messagesOf(e, s.conversationId); const a = msgs[1]
    assert.deepEqual([a.role, a.answer, a.citations, a.rendered.stopReason], ["assistant", null, [], "REGEN_EXHAUSTED"], e.name)
    assert.equal(jstr(a.rendered), jstr(stop.response), `${e.name}: == a resposta devolvida pelo validate`)
    assert.equal(jstr(a.rendered), jstr(stopResponse(s.state())), `${e.name}: == stopResponse(state)`)
    assert.equal(jstr(msgs).includes("SEGREDO-DO-MODELO"), false, e.name)
  })
})

await test("N4 — o PRIMEIRO desfecho terminal vence: REGENERATE não grava; aceito seguido de outro aceito ou de rejeição não muda o registrado; STOP seguido de resposta válida também não", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const s = await withMessage(e, "q", sha); const ref = refOfResult(((await s.call("metrics.query@1", Q)) as Any).result)
    assert.equal(((await s.validate({ nope: 1 })) as Any).action, "REGENERATE", e.name)
    const first = goodAnswer(ref); assert.equal(((await s.validate(first)) as Any).ok, true, e.name)
    assert.equal(((await s.validate(otherAnswer(ref))) as Any).ok, true, `${e.name}: o 2º aceito`)
    assert.equal(((await s.validate({ nope: 2 })) as Any).ok, false, e.name)
    await s.commit()
    const a = (await messagesOf(e, s.conversationId))[1]
    assert.deepEqual(a.answer, first, `${e.name}: o primeiro aceito (nem a rejeição anterior, nem os posteriores)`)
    // STOP primeiro, resposta válida depois
    const t = await withMessage(e, "q2", sha); const r2 = refOfResult(((await t.call("metrics.query@1", Q)) as Any).result)
    for (let i = 0; i < 3; i++) await t.validate({ nope: i })
    assert.equal(((await t.validate(goodAnswer(r2))) as Any).ok !== undefined, true, e.name)
    await t.commit()
    const b = (await messagesOf(e, t.conversationId))[1]
    assert.deepEqual([b.answer, b.rendered.stopReason], [null, "REGEN_EXHAUSTED"], `${e.name}: o STOP, que veio primeiro, permanece`)
  })
})

await test("N5 — turno SÓ com a mensagem do usuário (sem chamadas, sem resposta) commita (committed:true, versão +1) e a conversa reaberta traz a mensagem; um 2º turno acumula na ordem", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const s = await withMessage(e, "primeira", sha); const c: Any = await s.commit(); assert.deepEqual([c.ok, c.committed, c.version], [true, true, 1], e.name)
    const t = await withMessage(e, "segunda", sha, s.conversationId); const c2: Any = await t.commit(); assert.deepEqual([c2.committed, c2.version], [true, 2], e.name)
    assert.deepEqual((await messagesOf(e, s.conversationId)).map((m) => [m.turn, m.text]), [[1, "primeira"], [2, "segunda"]], e.name)
  })
})

await test("N6 — notices: com uma capacidade que FALHOU no turno a resposta renderizada traz a frase de falha e é IGUAL ao renderAnswer direto com os mesmos notices (e diferente do render sem eles)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const s = await withMessage(e, "q", sha)
    const bad: Any = await s.call("metrics.query@1", { metricIds: ["inexistente"] }); assert.equal(bad.result.ok, false, e.name)
    const ref = refOfResult(((await s.call("metrics.query@1", Q)) as Any).result)
    assert.deepEqual(notices(s.state()), ["CAPABILITY_FAILED"], e.name)
    const good = goodAnswer(ref); const v: Any = await s.validate(good); assert.equal(v.ok, true, `${e.name}: ${jstr(v)}`)
    const withN: Any = renderAnswer({ answer: good, ledger: s.ledger(), notices: ["CAPABILITY_FAILED"], stop: null }), without: Any = renderAnswer({ answer: good, ledger: s.ledger(), notices: [], stop: null })
    assert.notEqual(jstr(withN.rendered), jstr(without.rendered), `${e.name}: o fixture distingue`)
    await s.commit()
    const a = (await messagesOf(e, s.conversationId))[1]
    assert.equal(jstr(a.rendered), jstr(withN.rendered), `${e.name}: com notices`)
    assert.ok(a.rendered.segments.some((g: Any) => g.kind === "phrase" && g.code === "CAPABILITY_FAILED"), e.name)
  })
})

await test("N7 — TURN_CONFLICT: duas sessões na mesma versão, ambas com mensagens: a perdedora recebe TURN_CONFLICT e NENHUMA mensagem dela é gravada; a vencedora persiste", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const base = await withMessage(e, "base", sha); await base.commit()
    const a = await withMessage(e, "vencedora", sha, base.conversationId), b = await withMessage(e, "perdedora", sha, base.conversationId)
    await a.call("metrics.query@1", Q); await b.call("exit.breakdown@1", CAPS["exit.breakdown@1"].args)
    assert.deepEqual([((await a.commit()) as Any).ok, await b.commit()], [true, { ok: false, code: "TURN_CONFLICT" }], e.name)
    const msgs = await messagesOf(e, base.conversationId)
    assert.deepEqual(msgs.map((m) => m.text), ["base", "vencedora"], e.name)
    assert.equal(jstr(msgs).includes("perdedora"), false, e.name)
  })
})

await test("N8 — erros traduzidos SEM código novo e sem eco: LIMIT_MESSAGES ⇒ LIMIT_EXCEEDED; MESSAGE_INVALID ⇒ COMMIT_REJECTED; a mensagem do usuário não aparece em nenhum resultado; o limite real de 200 chega como LIMIT_EXCEEDED", async () => {
  const e = memEnv(); const sha = await register(e, csvOf(60, 1)); const SECRET = "SEGREDO-DO-USUARIO-7741"
  for (const [code, expected] of [["LIMIT_MESSAGES", "LIMIT_EXCEEDED"], ["MESSAGE_INVALID", "COMMIT_REJECTED"]] as const) {
    const real = createConversations({ store: e.conv() })
    const s = await withMessage(e, SECRET, sha, undefined, { conversations: { create: real.create.bind(real), open: real.open.bind(real), commitTurn: async () => ({ ok: false, code }) } })
    const r: Any = await s.commit(); assert.deepEqual(r, { ok: false, code: expected }, code); assert.equal(jstr(r).includes(SECRET), false, code)
    assert.deepEqual(await s.commit(), { ok: false, code: "TURN_CLOSED" }, `${code}: sessão fechada`)
  }
  // o limite REAL: 100 turnos de 2 mensagens enchem a conversa; o próximo turno com mensagem é recusado
  let id: string | undefined
  for (let i = 0; i < 100; i++) {
    const s = await withMessage(e, `u${i}`, sha, id); id = s.conversationId
    await s.call("metrics.query@1", Q); const ref = refOfResult(((await s.call("metrics.query@1", Q)) as Any).result)
    assert.equal(((await s.validate(goodAnswer(ref))) as Any).ok, true, `turno ${i}`); const c: Any = await s.commit(); assert.equal(c.ok, true, `turno ${i}: ${jstr(c)}`)
  }
  const full = await withMessage(e, SECRET, sha, id); const lim: Any = await full.commit()
  assert.deepEqual(lim, { ok: false, code: "LIMIT_EXCEEDED" }); assert.equal(jstr(lim).includes(SECRET), false)
  assert.equal((await messagesOf(e, id!)).length, 200)
})

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do executor de turno passaram.`)
