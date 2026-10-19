// E7-5 (D-R2, D-R3, D-R4, D-R7): regenerador de bundle (infra/regenerate.ts) — dado o ref de uma conversa, refaz o MESMO bundle selado a partir da spec + pin + arquivo guardado.
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_5 (G1–G14, B1–B3, X1–X2; mutações RM1, RM9–RM11, RM13, RM16–RM18).
//   node scripts/test-regenerate.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evidenceExplain } from "../src/lib/agent-capabilities/evidence-explain.ts"
import { evidenceRefresh } from "../src/lib/agent-capabilities/evidence-refresh.ts"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { refreshEvidence } from "../src/lib/agent/ledger.ts"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { createBundleCache } from "../src/lib/infra/bundle-cache.ts"
import { createConversations, createDiskConversationStore, createMemoryConversationStore, type ConversationStore } from "../src/lib/infra/conversation-store.ts"
import { makeContext, registerImport, type DatasetDeps } from "../src/lib/infra/dataset.ts"
import { sha256Hex } from "../src/lib/infra/hash.ts"
import { createDiskImportSourceStore, createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
import { prepareBundle, regeneratedFor, regenerateBundle } from "../src/lib/infra/regenerate.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const p2 = (x: number): string => String(x).padStart(2, "0")
const csvOf = (n: number, seed = 0): string => synthCsv(Array.from({ length: n }, (_, i) => ({ entryPrice: 2000 + ((i + seed) % 13), exitPrice: 2000 + ((i + seed) % 13) + (((i + seed) % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: (i + seed) % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
const CTX = { sourceTz: "America/New_York" } // não é o padrão do pipeline: uma regeneração que ignore o contexto gravado muda o importId
const PIN = (analysis: Any = {}, ...shas: string[]): Any => ({ sources: shas.map((fileSha256) => ({ fileSha256 })), analysis })
const jstr = (x: unknown): string => JSON.stringify(x)
const refOfBundle = (b: Any): string => `ev_${b.evidenceHash.slice(0, 32)}`
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

// ── ambientes: memória e disco (instâncias NOVAS a cada fresh()) ──
const TMPS: string[] = []
interface Env { name: string; kr: InMemorySaltKeyring; deps: () => DatasetDeps; conv: () => ConversationStore; root?: string }
function memEnv(): Env {
  const raw = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore(), conv = createMemoryConversationStore(), kr = new InMemorySaltKeyring(); kr.ensure(U1)
  return { name: "memória", kr, deps: () => ({ rawStorage: raw, importStore: imp, salt: kr }), conv: () => conv }
}
function diskEnv(): Env {
  const root = mkdtempSync(join(tmpdir(), "regen-")); TMPS.push(root)
  const kr = new InMemorySaltKeyring(); kr.ensure(U1)
  return { name: "disco", kr, root, deps: () => ({ rawStorage: createDiskRawFileStorage(join(root, "raw")), importStore: createDiskImportSourceStore(join(root, "imports")), salt: kr }), conv: () => createDiskConversationStore(join(root, "conv")) }
}
const both = async (fn: (e: Env) => Promise<void>): Promise<void> => { for (const e of [memEnv(), diskEnv()]) await fn(e) }
async function register(e: Env, text: string, extra: Any = {}): Promise<string> {
  const r: Any = await registerImport(e.deps(), { userId: U1, text, context: CTX, fileName: "export.csv", ...extra })
  assert.equal(r.ok, true, `registerImport: ${r.code}`)
  return r.fileSha256
}

const CAPS: Record<string, { fn: (a: unknown, c: Any) => Any; args: Any }> = {
  "metrics.query@1": { fn: metricsQuery, args: { metricIds: ["netPnl", "winRate"], filters: {}, options: {} } },
  "metrics.groups@1": { fn: metricsGroups, args: { groupBy: ["account"], metricIds: ["netPnl"], filters: {}, options: {} } },
  "metrics.compare@1": { fn: metricsCompare, args: { mode: "PERIOD", a: { from: "2026-03-01", to: "2026-03-10" }, b: { from: "2026-03-15", to: "2026-03-25" }, metricIds: ["netPnl"], filters: {}, options: {} } },
  "exit.breakdown@1": { fn: exitBreakdown, args: { filters: {}, options: {} } },
  "exit.analysis@1": { fn: exitAnalysis, args: { compare: { unit: "TRADE", a: "TARGET", b: "STOP" }, filters: {}, options: {} } },
  "rank.groups@1": { fn: rankGroupsCapability, args: { groupBy: ["account"], metric: "netPnl", order: "DESC", filters: {}, options: {} } },
}

/** Uma conversa em andamento: cada `ask` roda a capacidade como o orquestrador faria (ctx do pin + aliases da conversa + gancho), grava entrada+spec+aliases e guarda o bundle capturado. */
interface World { e: Env; convs: ReturnType<typeof createConversations>; open: Any; saltId: string }
async function newWorld(e: Env, user = U1): Promise<World> {
  const convs = createConversations({ store: e.conv() })
  const cur = e.kr.current(user)!
  const created: Any = await convs.create(user, cur.saltId)
  assert.equal(created.ok, true, created.code)
  return { e, convs, open: created.open, saltId: cur.saltId }
}
async function ask(w: World, id: string, pin: Any, args: Any = CAPS[id].args, user = U1): Promise<{ ref: string; bundle: Any; entry: Any; ctx: Any }> {
  const made: Any = await makeContext(w.e.deps(), { userId: user, pin })
  assert.equal(made.ok, true, `makeContext: ${made.code}`)
  const captured: Any[] = []
  const ctx = { ...made.ctx, aliases: w.open.aliases, onBundle: (b: unknown) => captured.push(b) }
  const out: Any = CAPS[id].fn(args, ctx)
  assert.equal(out.result.ok, true, `${id}: ${jstr(out.result).slice(0, 120)}`)
  assert.equal(captured.length, 1, `${id}: gancho`)
  const ref = out.entry.handle.evidenceRef
  const done: Any = await w.convs.commitTurn(w.open, { writes: [{ op: "add", entry: out.entry }], specs: [{ evidenceRef: ref, capability: out.entry.capability, args, pin }], ...(out.aliases !== undefined ? { aliases: out.aliases } : {}) })
  assert.equal(done.ok, true, `commitTurn: ${done.code}`)
  w.open = done.open
  return { ref, bundle: captured[0], entry: out.entry, ctx }
}
const regen = (e: Env, w: World, ref: string, extra: Any = {}): Promise<Any> => regenerateBundle({ ...e.deps(), ...extra }, { userId: U1, conversation: w.open, ref })

// ───────────────────────────── G1–G6: o ORÁCULO, uma capacidade por caso ─────────────────────────────
let n = 0
for (const id of Object.keys(CAPS)) {
  n += 1
  await test(`G${n} — ORÁCULO ${id}: consulta original (bundle capturado pelo gancho) × regeneração a partir de pin+spec+arquivo em instâncias NOVAS ⇒ MESMO ref e bundle IDÊNTICO byte a byte (memória e disco)`, async () => {
    await both(async (e) => {
      const sha = await register(e, csvOf(80, 2))
      const w = await newWorld(e)
      const q = await ask(w, id, PIN({}, sha))
      const r = await regen(e, w, q.ref)
      assert.equal(r.ok, true, `${e.name}: ${r.code}`)
      assert.equal(r.from, "regenerated", e.name)
      assert.equal(refOfBundle(r.bundle), q.ref, e.name)
      assert.equal(jstr(r.bundle), jstr(q.bundle), `${e.name}: byte a byte`)
      assert.deepEqual(Object.keys(r).sort(), ["bundle", "from", "ok"], e.name)
    })
  })
}

await test("G7 — filtro por ALIAS de conta nos args guardados: regenera com as aliases da CONVERSA (\"Conta A\" é a mesma conta); sem a tabela a regeneração não existe", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const w = await newWorld(e)
    await ask(w, "metrics.groups@1", PIN({}, sha)) // aloca "Conta A/B" e grava a tabela
    assert.ok(w.open.aliases.conta.length >= 2)
    const args = { metricIds: ["netPnl", "winRate"], filters: { account: ["Conta A"] }, options: {} }
    const q = await ask(w, "metrics.query@1", PIN({}, sha), args)
    const r = await regen(e, w, q.ref)
    assert.equal(r.ok, true, `${e.name}: ${r.code}`)
    assert.equal(jstr(r.bundle), jstr(q.bundle), e.name)
    const semTabela = { ...w.open, aliases: { ...w.open.aliases, conta: [] } }
    const bad: Any = await regenerateBundle(e.deps(), { userId: U1, conversation: semTabela, ref: q.ref })
    assert.deepEqual(bad, { ok: false, code: "CAPABILITY_FAILED" }, `${e.name}: sem a tabela de aliases o filtro não resolve`)
  })
})

await test("G8 — o PIN governa: analysis (timeZone/minSample) muda o ref e é reproduzido; multi-source reproduz o bundle dos DOIS arquivos; ordem das fontes no pin é irrelevante", async () => {
  await both(async (e) => {
    const sha1 = await register(e, csvOf(60, 1)), sha2 = await register(e, csvOf(60, 5))
    const base = await ask(await newWorld(e), "metrics.query@1", PIN({}, sha1))
    for (const analysis of [{ timeZone: "UTC" }, { minSample: 5 }, { timeZone: "UTC", minSample: 5 }]) {
      const w = await newWorld(e)
      const q = await ask(w, "metrics.query@1", PIN(analysis, sha1))
      assert.notEqual(q.ref, base.ref, `${e.name}: ${jstr(analysis)} muda o ref`)
      const r = await regen(e, w, q.ref)
      assert.equal(r.ok, true, `${e.name}: ${r.code}`); assert.equal(jstr(r.bundle), jstr(q.bundle), `${e.name}: ${jstr(analysis)}`)
    }
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha2, sha1)) // fora de ordem de propósito
    const r = await regen(e, w, q.ref)
    assert.equal(r.ok, true, `${e.name}: ${r.code}`); assert.equal(jstr(r.bundle), jstr(q.bundle), `${e.name}: multi-source`)
    assert.notEqual(q.ref, base.ref)
  })
})

await test("G9 — ref ausente ⇒ NOT_FOUND (também sem spec gravada); ref malformado ⇒ INVALID_ARGS; ref STALE ⇒ STALE_EPOCH — MESMO que o bundle esteja no cache (D-R3: só se regenera o que é CURRENT)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    assert.deepEqual(await regen(e, w, "ev_" + "0".repeat(32)), { ok: false, code: "NOT_FOUND" }, e.name)
    for (const bad of ["", "ev_zz", q.ref.toUpperCase(), null, 5, undefined]) assert.deepEqual(await regen(e, w, bad as Any), { ok: false, code: "INVALID_ARGS" }, `${e.name}: ${String(bad)}`)
    // entrada no ledger SEM spec gravada
    const w2 = await newWorld(e)
    const made: Any = await makeContext(e.deps(), { userId: U1, pin: PIN({}, sha) })
    const out: Any = metricsQuery({ metricIds: ["netPnl"], filters: {}, options: {} }, made.ctx)
    const c2: Any = await w2.convs.commitTurn(w2.open, { writes: [{ op: "add", entry: out.entry }] }); w2.open = c2.open
    assert.deepEqual(await regen(e, w2, out.entry.handle.evidenceRef), { ok: false, code: "NOT_FOUND" }, `${e.name}: sem spec`)
    // rotação: a entrada fica STALE e o regenerador recusa, com ou sem cache
    const cache = createBundleCache()
    cache.put(U1, q.ref, q.bundle)
    const next = e.kr.rotate(U1).saltId
    const rot: Any = await w.convs.commitTurn(w.open, { rotateTo: next }); w.open = rot.open
    assert.deepEqual(await regen(e, w, q.ref), { ok: false, code: "STALE_EPOCH" }, `${e.name}: STALE sem cache`)
    assert.deepEqual(await regen(e, w, q.ref, { cache }), { ok: false, code: "STALE_EPOCH" }, `${e.name}: STALE com bundle no cache`)
  })
})

await test("G10 — REF_MISMATCH fail-closed: spec adulterada (args de outra consulta), pin trocado para OUTRO arquivo e fileName forjado na linha guardada ⇒ NADA é servido e NADA entra no cache", async () => {
  await both(async (e) => {
    const sha1 = await register(e, csvOf(60, 1)), sha2 = await register(e, csvOf(60, 5))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha1))
    const cache = createBundleCache()
    // cada violação é testada COM cache e SEM cache: a conferência do regenerador não pode depender da do cache
    const modes: Array<[string, Any]> = [["com cache", { cache }], ["sem cache", {}]]
    // (a) args adulterados: grava a spec de outro conjunto de métricas sob o ref original
    const w1 = await newWorld(e)
    const made: Any = await makeContext(e.deps(), { userId: U1, pin: PIN({}, sha1) })
    const entryA: Any = metricsQuery({ metricIds: ["netPnl"], filters: {}, options: {} }, made.ctx)
    const c1: Any = await w1.convs.commitTurn(w1.open, { writes: [{ op: "add", entry: entryA.entry }], specs: [{ evidenceRef: entryA.entry.handle.evidenceRef, capability: "metrics.query@1", args: { metricIds: ["winRate"], filters: {}, options: {} }, pin: PIN({}, sha1) }] })
    assert.equal(c1.ok, true, c1.code)
    // (b) pin aponta para outro arquivo
    const w2 = await newWorld(e)
    const c2: Any = await w2.convs.commitTurn(w2.open, { writes: [{ op: "add", entry: q.entry }], specs: [{ evidenceRef: q.ref, capability: "metrics.query@1", args: CAPS["metrics.query@1"].args, pin: PIN({}, sha2) }] })
    assert.equal(c2.ok, true, c2.code)
    // (c) fileName forjado (não muda o importId, MUDA o ref): fecha o ponto deixado no E7-4
    const row: Any = ((await e.deps().importStore.get(U1, sha1)) as Any).row
    const forgedStore = createMemoryImportSourceStore(); await forgedStore.put({ ...row, fileName: "outro-nome.csv" })
    for (const [mode, extra] of modes) {
      assert.deepEqual(await regen(e, { ...w1, open: c1.open }, entryA.entry.handle.evidenceRef, extra), { ok: false, code: "REF_MISMATCH" }, `${e.name}: args adulterados (${mode})`)
      assert.deepEqual(await regen(e, { ...w2, open: c2.open }, q.ref, extra), { ok: false, code: "REF_MISMATCH" }, `${e.name}: pin trocado (${mode})`)
      assert.deepEqual(await regenerateBundle({ ...e.deps(), importStore: forgedStore, ...extra }, { userId: U1, conversation: w.open, ref: q.ref }), { ok: false, code: "REF_MISMATCH" }, `${e.name}: fileName forjado (${mode})`)
    }
    assert.deepEqual([cache.stats().entries, cache.stats().bytes], [0, 0], `${e.name}: nada no cache`)
    // controle: a regeneração honesta passa
    assert.equal(((await regen(e, w, q.ref, { cache })) as Any).ok, true, e.name)
    assert.equal(cache.stats().entries, 1)
  })
})

await test("G11 — os códigos do makeContext PROPAGAM sem virar sucesso nem eco: arquivo ausente, linha ausente, IMPORT_MISMATCH, sem sal, pin guardado inválido", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const run = (deps: Any): Promise<Any> => regenerateBundle(deps, { userId: U1, conversation: w.open, ref: q.ref })
    assert.deepEqual(await run({ ...e.deps(), rawStorage: createMemoryRawFileStorage() }), { ok: false, code: "FILE_NOT_AVAILABLE" }, e.name)
    assert.deepEqual(await run({ ...e.deps(), importStore: createMemoryImportSourceStore() }), { ok: false, code: "IMPORT_NOT_REGISTERED" }, e.name)
    const row: Any = ((await e.deps().importStore.get(U1, sha)) as Any).row
    const forged = createMemoryImportSourceStore(); await forged.put({ ...row, importId: "imp_00000000aabbccdd" })
    assert.deepEqual(await run({ ...e.deps(), importStore: forged }), { ok: false, code: "IMPORT_MISMATCH" }, e.name)
    assert.deepEqual(await run({ ...e.deps(), salt: new InMemorySaltKeyring() }), { ok: false, code: "SALT_REQUIRED" }, e.name)
    const fake = { ...w.open, pinOf: () => ({ sources: [], analysis: {} }) }
    assert.deepEqual(await regenerateBundle(e.deps(), { userId: U1, conversation: fake as Any, ref: q.ref }), { ok: false, code: "INVALID_ARGS" }, `${e.name}: pin guardado inválido`)
  })
})

await test("G12 — hostil: capacidade evidence.*/inexistente/não-string na spec, specOf/pinOf que lançam, conversa/pedido/deps malformados ⇒ resultado tipado, NADA lança, e nenhuma resposta ecoa sal, caminho, nome de arquivo ou mensagem", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1), { fileName: "segredo-cliente.csv" })
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const salt = e.kr.current(U1)!.salt
    const outs: unknown[] = []
    const withSpec = (spec: unknown): Any => ({ ...w.open, specOf: () => spec })
    const hostile: Array<[string, Any]> = [
      ["evidence.explain@1", withSpec({ capability: "evidence.explain@1", args: {} })], ["evidence.refresh@1", withSpec({ capability: "evidence.refresh@1", args: {} })],
      ["capacidade inexistente", withSpec({ capability: "nao.existe@1", args: {} })], ["capacidade não-string", withSpec({ capability: 5, args: {} })], ["spec string", withSpec("x")],
      ["specOf lança", { ...w.open, specOf: () => { throw new Error(`/Users/x/${salt}`) } }], ["pinOf lança", { ...w.open, pinOf: () => { throw new Error(salt) } }],
      ["pinOf devolve lixo", { ...w.open, pinOf: () => 42 }], ["args da spec hostis", withSpec({ capability: "metrics.query@1", args: { __proto__: { x: 1 }, metricIds: 5 } })],
    ]
    for (const [why, conversation] of hostile) {
      const r: Any = await regenerateBundle(e.deps(), { userId: U1, conversation, ref: q.ref })
      assert.equal(r.ok, false, `${e.name}: ${why}`); assert.equal(typeof r.code, "string"); assert.deepEqual(Object.keys(r).sort(), ["code", "ok"], why); outs.push(r)
    }
    const hostileReq: unknown[] = [null, undefined, 5, "x", [], {}, { userId: U1 }, { userId: U1, ref: q.ref }, { userId: U1, conversation: null, ref: q.ref }, { userId: "a/b", conversation: w.open, ref: q.ref }, { userId: U1, conversation: w.open, ref: q.ref, extra: 1 }, { userId: U1, conversation: { ledger: null }, ref: q.ref }, { userId: U1, conversation: {}, ref: q.ref }]
    for (const req of hostileReq) { const r: Any = await regenerateBundle(e.deps(), req as Any); assert.equal(r.ok, false, jstr(req)); outs.push(r) }
    for (const deps of [null, undefined, {}, { rawStorage: null }, { ...e.deps(), cache: 5 }, { ...e.deps(), cache: {} }]) { const r: Any = await regenerateBundle(deps as Any, { userId: U1, conversation: w.open, ref: q.ref }); assert.equal(r.ok, false); outs.push(r) }
    for (const r of outs) {
      const s = jstr(r)
      for (const leak of [salt, "segredo-cliente", "/Users/", "tmp", "Error", "prototype"]) assert.equal(s.includes(leak), false, `${e.name}: eco de "${leak}" em ${s}`)
    }
    if (e.root !== undefined) for (const f of walk(e.root)) assert.equal(readFileSync(f).includes(Buffer.from(salt)), false, `sal em ${f}`)
  })
})

await test("G13 — COLISÃO exit.breakdown × exit.analysis (sem compare): o ledger falha fechado (LEDGER_CONFLICT na 2ª entrada) e o regenerador entrega o MESMO bundle seja qual for a capacidade da spec (caracterização, sem mudar nada)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const args = { filters: {}, options: {} }
    const w1 = await newWorld(e), w2 = await newWorld(e)
    const a = await ask(w1, "exit.breakdown@1", PIN({}, sha), args)
    const b = await ask(w2, "exit.analysis@1", PIN({}, sha), args)
    assert.equal(a.ref, b.ref, "mesmo ref")
    assert.equal(jstr(a.bundle), jstr(b.bundle), "mesmo bundle")
    const c: Any = await w1.convs.commitTurn(w1.open, { writes: [{ op: "add", entry: b.entry }] })
    assert.deepEqual([c.ok, c.code], [false, "LEDGER_CONFLICT"], `${e.name}: a 2ª entrada do mesmo ref é recusada`)
    const ra = await regen(e, w1, a.ref), rb = await regen(e, w2, b.ref)
    assert.equal(jstr((ra as Any).bundle), jstr((rb as Any).bundle), e.name)
    assert.equal(jstr((ra as Any).bundle), jstr(a.bundle), e.name)
  })
})

await test("G14 — cache no regenerador: 1ª chamada \"regenerated\", 2ª \"cache\" SEM tocar no armazenamento; 5 chamadas concorrentes ⇒ UMA leitura do arquivo; usuário sem cache obtém sempre do arquivo", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    let reads = 0
    const inner = e.deps().rawStorage
    const spy: DatasetDeps = { ...e.deps(), rawStorage: { put: inner.put.bind(inner), get: async (u: string, s: string) => { reads += 1; return inner.get(u, s) }, delete: inner.delete.bind(inner), deleteAllForUser: inner.deleteAllForUser.bind(inner) } }
    const cache = createBundleCache()
    const r1: Any = await regenerateBundle({ ...spy, cache }, { userId: U1, conversation: w.open, ref: q.ref })
    assert.deepEqual([r1.ok, r1.from, reads], [true, "regenerated", 1], e.name)
    const r2: Any = await regenerateBundle({ ...spy, cache }, { userId: U1, conversation: w.open, ref: q.ref })
    assert.deepEqual([r2.ok, r2.from, reads, r2.bundle === r1.bundle], [true, "cache", 1, true], e.name)
    const fresh = createBundleCache(); reads = 0
    const rs: Any[] = await Promise.all(Array.from({ length: 5 }, () => regenerateBundle({ ...spy, cache: fresh }, { userId: U1, conversation: w.open, ref: q.ref })))
    assert.ok(rs.every((r) => r.ok && jstr(r.bundle) === jstr(q.bundle)), e.name)
    assert.equal(reads, 1, `${e.name}: single-flight de ponta a ponta`)
    reads = 0
    await regenerateBundle(spy, { userId: U1, conversation: w.open, ref: q.ref }); await regenerateBundle(spy, { userId: U1, conversation: w.open, ref: q.ref })
    assert.equal(reads, 2, `${e.name}: sem cache, sempre do arquivo`)
  })
})

// ───────────────────────────── B: prepareBundle + evidence.explain ─────────────────────────────
await test("B1 — prepareBundle + evidenceExplain REAL devolve exatamente o que o explain devolveria com o bundle original (resultado, entry e aliases idênticos)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const prep: Any = await prepareBundle(e.deps(), { userId: U1, conversation: w.open, ref: q.ref })
    assert.equal(prep.ok, true); assert.equal(prep.outcome.ok, true, e.name)
    const base = { refEpoch: q.ctx.refEpoch, source: q.ctx.source, aliases: w.open.aliases }
    const viaPrepare = evidenceExplain({ evidenceRef: q.ref, page: 1 }, { ...base, bundleOf: prep.bundleOf })
    const original = evidenceExplain({ evidenceRef: q.ref, page: 1 }, { ...base, bundleOf: () => q.bundle })
    assert.equal(viaPrepare.result.ok, true, jstr(viaPrepare.result).slice(0, 100))
    assert.equal(jstr(viaPrepare), jstr(original), e.name)
    assert.equal(typeof prep.bundleOf, "function")
  })
})

await test("B2 — com o arquivo disponível o veredito do explain regenerado é VERIFIED (o source do makeContext chega ao explain)", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const prep: Any = await prepareBundle(e.deps(), { userId: U1, conversation: w.open, ref: q.ref })
    const made: Any = await makeContext(e.deps(), { userId: U1, pin: PIN({}, sha) })
    const ex: Any = evidenceExplain({ evidenceRef: q.ref, page: 1 }, { refEpoch: made.ctx.refEpoch, source: made.ctx.source, aliases: w.open.aliases, bundleOf: prep.bundleOf })
    assert.equal(ex.result.ok, true)
    assert.equal(ex.entry.handle.verdict.combined, "VERIFIED", e.name)
    const semArquivo: Any = evidenceExplain({ evidenceRef: q.ref, page: 1 }, { refEpoch: made.ctx.refEpoch, aliases: w.open.aliases, bundleOf: prep.bundleOf })
    assert.notEqual(semArquivo.entry.handle.verdict.combined, "VERIFIED", "sem o arquivo o veredito é outro (a honestidade do E6.6)")
  })
})

await test("B3 — ref sem bundle: prepareBundle NÃO falha o turno (ok:true) mas informa o motivo em outcome, e o bundleOf devolve null ⇒ o evidence.explain responde NOT_FOUND; o bundleOf só conhece o ref preparado", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const ghost = "ev_" + "a".repeat(32)
    const prep: Any = await prepareBundle(e.deps(), { userId: U1, conversation: w.open, ref: ghost })
    assert.deepEqual([prep.ok, prep.outcome], [true, { ok: false, code: "NOT_FOUND" }])
    assert.equal(prep.bundleOf(ghost), null)
    const ex: Any = evidenceExplain({ evidenceRef: ghost, page: 1 }, { refEpoch: w.saltId, bundleOf: prep.bundleOf })
    assert.equal(ex.result.ok, false); assert.equal(ex.result.error.code, "NOT_FOUND")
    const ok: Any = await prepareBundle(e.deps(), { userId: U1, conversation: w.open, ref: q.ref })
    assert.equal(ok.bundleOf("ev_" + "b".repeat(32)), null, "só o ref preparado")
    assert.equal(ok.bundleOf(5 as Any), null); assert.equal(ok.bundleOf(null as Any), null)
    for (const bad of [null, undefined, 5, { userId: U1 }]) { const r: Any = await prepareBundle(e.deps(), bad as Any); assert.equal(r.ok, true); assert.equal(r.outcome.ok, false); assert.equal(r.bundleOf("x"), null) }
  })
})

// ───────────────────────────── X: regeneratedFor + evidence.refresh ─────────────────────────────
await test("X1 — época nova: rotateEpoch ⇒ ref STALE ⇒ regeneratedFor ⇒ evidence.refresh REAL devolve a entrada CURRENT (igual à consulta direta na época nova) ⇒ refreshEvidence funciona", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(80, 2))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const next = e.kr.rotate(U1).saltId
    const rot: Any = await w.convs.commitTurn(w.open, { rotateTo: next }); assert.equal(rot.ok, true); w.open = rot.open
    const rg: Any = await regeneratedFor(e.deps(), { userId: U1, conversation: w.open, ref: q.ref })
    assert.equal(rg.ok, true, `${e.name}: ${rg.code}`)
    assert.equal(rg.regenerated.refEpoch, next)
    assert.deepEqual(rg.regenerated.aliases, w.open.aliases)
    const out: Any = evidenceRefresh({ evidenceRef: q.ref }, { ledger: w.open.ledger, specOf: w.open.specOf, regenerated: rg.regenerated })
    assert.equal(out.result.ok, true, jstr(out.result).slice(0, 120))
    assert.equal(out.entry.handle.freshness, "CURRENT"); assert.equal(out.entry.handle.refEpoch, next)
    assert.notEqual(out.entry.handle.evidenceRef, q.ref, "o sal novo muda o ref")
    const direct: Any = await makeContext(e.deps(), { userId: U1, pin: PIN({}, sha) })
    const oracle: Any = metricsQuery(CAPS["metrics.query@1"].args, { ...direct.ctx, aliases: w.open.aliases })
    assert.deepStrictEqual(out.entry, oracle.entry, `${e.name}: entrada idêntica à consulta direta`)
    const ledger2: Any = refreshEvidence(w.open.ledger, out.entry); assert.equal(ledger2.ok, true, ledger2.code)
    assert.equal(Object.keys(ledger2.ledger.entries).length, 2)
  })
})

await test("X2 — regeneratedFor recusa o que não fecha: conversa à frente do sal (refEpoch ≠ ledger.epoch) ⇒ STALE_EPOCH; ref/spec ausente ⇒ NOT_FOUND; pedido hostil ⇒ INVALID_ARGS; códigos do makeContext propagam; sem eco", async () => {
  await both(async (e) => {
    const sha = await register(e, csvOf(60, 1))
    const w = await newWorld(e)
    const q = await ask(w, "metrics.query@1", PIN({}, sha))
    const ahead: Any = await w.convs.commitTurn(w.open, { rotateTo: "s_futura" }); w.open = ahead.open // o ledger rotou para uma época que o sal ainda não tem
    assert.deepEqual(await regeneratedFor(e.deps(), { userId: U1, conversation: w.open, ref: q.ref }), { ok: false, code: "STALE_EPOCH" }, e.name)
    assert.deepEqual(await regeneratedFor(e.deps(), { userId: U1, conversation: w.open, ref: "ev_" + "0".repeat(32) }), { ok: false, code: "NOT_FOUND" }, e.name)
    for (const bad of [null, undefined, 5, {}, { userId: "a/b", conversation: w.open, ref: q.ref }, { userId: U1, conversation: w.open, ref: "zz" }, { userId: U1, conversation: null, ref: q.ref }]) {
      const r: Any = await regeneratedFor(e.deps(), bad as Any); assert.equal(r.ok, false, jstr(bad)); assert.equal(jstr(r).includes(e.kr.current(U1)!.salt), false)
    }
    assert.deepEqual(await regeneratedFor({ ...e.deps(), rawStorage: createMemoryRawFileStorage() }, { userId: U1, conversation: w.open, ref: q.ref }), { ok: false, code: "FILE_NOT_AVAILABLE" }, e.name)
  })
})

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
void sha256Hex; void U2
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do regenerador passaram.`)
