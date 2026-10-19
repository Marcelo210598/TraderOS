// E7-7: exclusão em cascata / LGPD Art. 18 (infra/user-purge.ts + métodos aditivos nos 4 stores): expurgo total e definitivo, exclusão seletiva de arquivo e de conversa, isolamento entre usuários,
// ordem estrita (arquivos → metadados → conversas → sais → cache; para no PRIMEIRO erro), falha parcial repetível e a corrida do cache (geração por usuário).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_7 (D-LGPD-1…10; I1, C1, S1, B1–B2, P1–P6, D1–D3, V1, R1, X1; mutações EL1–EL16).
//   node scripts/test-user-purge.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { rm as fsRm, unlink as fsUnlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createSaltCipher } from "../src/lib/infra/cipher.ts"
import { createBundleCache, type BundleCache } from "../src/lib/infra/bundle-cache.ts"
import { createConversations, createDiskConversationStore, createMemoryConversationStore, type ConversationStore } from "../src/lib/infra/conversation-store.ts"
import { makeContext, registerImport } from "../src/lib/infra/dataset.ts"
import { sha256Hex } from "../src/lib/infra/hash.ts"
import { createDiskImportSourceStore, createMemoryImportSourceStore, type ImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage, type RawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
import { createDiskSaltStore, createMemorySaltStore, createPersistentSalts, type PersistentSalts, type SaltStore } from "../src/lib/infra/salt-store.ts"
import { openTurn } from "../src/lib/infra/turn-session.ts"
import { deleteConversation, deleteImportFile, purgeUserData } from "../src/lib/infra/user-purge.ts"
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
const UA = "cmd3h2k0a0000abcd1234efgh", UB = "cmd3h2k0a0000zzzz9999yyyy", UC = "cmd3h2k0a0000cccc5555dddd"
const p2 = (x: number): string => String(x).padStart(2, "0")
/** CSV com uma conta MARCADORA (`ACC-{tag}`): se sobrar um byte dela em disco, o usuário não foi esquecido. */
const csvOf = (n: number, seed: number, tag: string): string => synthCsv(Array.from({ length: n }, (_, i) => ({ entryPrice: 2000 + ((i + seed) % 13), exitPrice: 2000 + ((i + seed) % 13) + (((i + seed) % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: `ACC-${tag}` })) as Any)
const CTX = { sourceTz: "America/New_York" }
const PIN = (...shas: string[]): Any => ({ sources: shas.map((fileSha256) => ({ fileSha256 })), analysis: {} })
const Q = { metricIds: ["netPnl", "winRate"], filters: {}, options: {} }
const jstr = (x: unknown): string => JSON.stringify(x)
const walk = (dir: string): string[] => { try { return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] }) } catch { return [] } }

// ── ambientes: memória e disco, com os 4 stores + cache + sais cifrados ──
const TMPS: string[] = []
interface Env { name: string; root?: string; raw: RawFileStorage; imp: ImportSourceStore; conv: ConversationStore; saltStore: SaltStore; cache: BundleCache; salts: PersistentSalts }
const mkSalts = (saltStore: SaltStore): PersistentSalts => { const c = createSaltCipher({ SALT_MASTER_KEY: "ab".repeat(32) }); assert.equal(c.ok, true); return createPersistentSalts({ store: saltStore, cipher: (c as Any).cipher }) }
function memEnv(): Env {
  const saltStore = createMemorySaltStore()
  return { name: "memória", raw: createMemoryRawFileStorage(), imp: createMemoryImportSourceStore(), conv: createMemoryConversationStore(), saltStore, cache: createBundleCache(), salts: mkSalts(saltStore) }
}
function diskEnv(overrides: { imp?: Any; conv?: Any; salt?: Any } = {}): Env {
  const root = mkdtempSync(join(tmpdir(), "purge-")); TMPS.push(root)
  const saltStore = createDiskSaltStore(root, overrides.salt)
  return { name: "disco", root, raw: createDiskRawFileStorage(join(root, "raw")), imp: createDiskImportSourceStore(root, overrides.imp), conv: createDiskConversationStore(root, overrides.conv), saltStore, cache: createBundleCache(), salts: mkSalts(saltStore) }
}
const both = async (fn: (e: Env) => Promise<void>): Promise<void> => { for (const e of [memEnv(), diskEnv()]) await fn(e) }
const purgeDeps = (e: Env, over: Any = {}): Any => ({ rawStorage: e.raw, importStore: e.imp, conversationStore: e.conv, saltStore: e.saltStore, cache: e.cache, ...over })

interface Pop { shas: string[]; convIds: string[]; refs: string[]; salt: string }
/** Popula um usuário de ponta a ponta pelos caminhos reais: sal, 2 imports, 2 conversas (1 turno cada, com commit) e o cache aquecido. */
async function populate(e: Env, userId: string, tag: string): Promise<Pop> {
  await e.salts.ensure(userId)
  const provider = (await e.salts.load(userId)).provider
  const shas: string[] = []
  for (let k = 0; k < 2; k++) {
    const r: Any = await registerImport({ rawStorage: e.raw, importStore: e.imp, salt: provider }, { userId, text: csvOf(40, 1 + k, tag), context: CTX, fileName: `${tag}-${k}.csv` })
    assert.equal(r.ok, true, `registerImport: ${r.code}`); shas.push(r.fileSha256)
  }
  const convIds: string[] = [], refs: string[] = []
  for (let k = 0; k < 2; k++) {
    const r: Any = await openTurn({ rawStorage: e.raw, importStore: e.imp, conversations: createConversations({ store: e.conv }), salts: e.salts, cache: e.cache }, { userId, pin: PIN(shas[k]) })
    assert.equal(r.ok, true, `openTurn: ${r.code}`)
    const s = r.session
    const o: Any = await s.call("metrics.query@1", Q); assert.equal(o.result.ok, true)
    assert.equal(((await s.commit()) as Any).ok, true)
    convIds.push(s.conversationId); refs.push(...Object.keys(s.ledger().entries))
  }
  return { shas, convIds, refs, salt: (await e.salts.load(userId)).provider.current(userId)!.salt }
}
/** O que o usuário tem hoje, lido pelas APIs (serve para memória e disco). */
async function snapshot(e: Env, userId: string, p: Pop): Promise<string> {
  const out: Any = { raw: [], imp: [], conv: [], salts: ((await e.saltStore.loadUser(userId)) as Any).rows, cache: p.refs.map((r) => e.cache.get(userId, r) !== null) }
  for (const sha of p.shas) { const r: Any = await e.raw.get(userId, sha); out.raw.push(r.ok ? sha256Hex(r.bytes) : r.code); const i: Any = await e.imp.get(userId, sha); out.imp.push(i.ok ? i.row : i.code) }
  for (const c of p.convIds) { const r: Any = await e.conv.load(userId, c); out.conv.push(r.ok ? { meta: r.meta, deltas: r.deltas } : r.code) }
  return jstr(out)
}
const treeOf = (e: Env, idPart: string): Record<string, string> => Object.fromEntries(walk(e.root!).filter((f) => f.includes(idPart)).map((f) => [f, sha256Hex(readFileSync(f))]))
const empty = async (e: Env, userId: string, p: Pop): Promise<void> => {
  for (const sha of p.shas) { assert.deepEqual(await e.raw.get(userId, sha), { ok: false, code: "NOT_FOUND" }, `${e.name}: arquivo`); assert.deepEqual(await e.imp.get(userId, sha), { ok: false, code: "NOT_FOUND" }, `${e.name}: linha`) }
  for (const c of p.convIds) assert.deepEqual(await e.conv.load(userId, c), { ok: false, code: "NOT_FOUND" }, `${e.name}: conversa`)
  assert.deepEqual(((await e.saltStore.loadUser(userId)) as Any).rows, [], `${e.name}: sais`)
  for (const r of p.refs) assert.equal(e.cache.get(userId, r), null, `${e.name}: cache`)
}
/** Operações de disco que passam a LANÇAR (com um segredo na mensagem) quando `state.boom` liga. */
const boomOps = (state: { boom: boolean }): Any => ({
  rm: async (...a: Parameters<typeof fsRm>) => { if (state.boom) throw new Error("/Users/x/segredo-9f"); return fsRm(...a) },
  unlink: async (...a: Parameters<typeof fsUnlink>) => { if (state.boom) throw new Error("/Users/x/segredo-9f"); return fsUnlink(...a) },
})
const failing = <T extends object>(store: T, method: string, mode: "code" | "throw"): T => ({ ...store, [method]: async () => { if (mode === "throw") throw new Error("/Users/x/segredo-9f"); return { ok: false, code: "STORAGE_ERROR" } } })

// ───────────────────────────── stores ─────────────────────────────
await test("I1 — ImportSourceStore.delete/deleteAllForUser (memória e disco): existed/contagem corretos, idempotente, isolado por usuário, ids inválidos sem efeito, o diretório do usuário some em disco, falha de disco vira STORAGE_ERROR sem lançar", async () => {
  await both(async (e) => {
    const p = await populate(e, UA, "A"); const q = await populate(e, UB, "B")
    const base: Any = ((await e.imp.get(UA, p.shas[0])) as Any).row
    const extra = "e".repeat(64)
    assert.deepEqual(await e.imp.put({ ...base, fileSha256: extra }), { ok: true, created: true })
    assert.deepEqual(await e.imp.delete(UA, extra), { ok: true, existed: true }, e.name)
    assert.deepEqual(await e.imp.delete(UA, extra), { ok: true, existed: false }, `${e.name}: idempotente`)
    assert.deepEqual(await e.imp.get(UA, extra), { ok: false, code: "NOT_FOUND" }, e.name)
    assert.deepEqual(await e.imp.put({ ...base, fileSha256: extra }), { ok: true, created: true }, `${e.name}: pode recriar a mesma chave`)
    assert.deepEqual(await e.imp.delete(UB, p.shas[0]), { ok: true, existed: false }, `${e.name}: a linha do outro usuário não é alcançável`)
    assert.equal(((await e.imp.get(UA, p.shas[0])) as Any).ok, true)
    const bBefore = jstr([await e.imp.get(UB, q.shas[0]), await e.imp.get(UB, q.shas[1])])
    assert.deepEqual(await e.imp.deleteAllForUser(UA), { ok: true, deleted: 3 }, e.name)
    assert.deepEqual(await e.imp.deleteAllForUser(UA), { ok: true, deleted: 0 }, `${e.name}: idempotente`)
    assert.deepEqual(await e.imp.deleteAllForUser(UC), { ok: true, deleted: 0 }, `${e.name}: usuário sem dados`)
    for (const sha of [...p.shas, extra]) assert.deepEqual(await e.imp.get(UA, sha), { ok: false, code: "NOT_FOUND" }, e.name)
    assert.equal(jstr([await e.imp.get(UB, q.shas[0]), await e.imp.get(UB, q.shas[1])]), bBefore, `${e.name}: B intacto`)
    if (e.root !== undefined) { assert.deepEqual(walk(join(e.root, "import-sources", UA)), [], e.name); assert.ok(walk(join(e.root, "import-sources", UB)).length === 2, e.name) }
    for (const bad of ["", "../x", "a/b", 5, null, "x".repeat(200)]) { assert.deepEqual(await e.imp.deleteAllForUser(bad as Any), { ok: false, code: "INVALID_ARGS" }, `${e.name}: ${String(bad)}`); assert.deepEqual(await e.imp.delete(bad as Any, "a".repeat(64)), { ok: false, code: "INVALID_ARGS" }) }
    for (const sha of ["zz", "", 5, null, "A".repeat(64)]) assert.deepEqual(await e.imp.delete(UB, sha as Any), { ok: false, code: "INVALID_ARGS" }, `${e.name}: sha ${String(sha)}`)
    assert.equal(((await e.imp.get(UB, q.shas[0])) as Any).ok, true, `${e.name}: entradas inválidas não apagaram nada`)
  })
  const state = { boom: false }
  const e = diskEnv({ imp: boomOps(state) })
  const p = await populate(e, UA, "A")
  state.boom = true
  for (const r of [await e.imp.delete(UA, p.shas[0]), await e.imp.deleteAllForUser(UA)]) { assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.equal(jstr(r).includes("segredo"), false) }
  assert.equal(((await e.imp.get(UA, p.shas[0])) as Any).ok, true, "a falha não apagou nada")
  state.boom = false
  assert.deepEqual(await e.imp.deleteAllForUser(UA), { ok: true, deleted: 2 }, "e depois funciona")
})

await test("C1 — ConversationStore.delete/deleteAllForUser: apaga a conversa e seus deltas; load ⇒ NOT_FOUND; as outras conversas do usuário e as de outro ficam; idempotente; pode recriar o mesmo id; o diretório some em disco", async () => {
  await both(async (e) => {
    const p = await populate(e, UA, "A"); const q = await populate(e, UB, "B")
    assert.deepEqual(await e.conv.delete(UA, p.convIds[0]), { ok: true, existed: true }, e.name)
    assert.deepEqual(await e.conv.delete(UA, p.convIds[0]), { ok: true, existed: false }, `${e.name}: idempotente`)
    assert.deepEqual(await e.conv.load(UA, p.convIds[0]), { ok: false, code: "NOT_FOUND" }, e.name)
    assert.equal(((await e.conv.load(UA, p.convIds[1])) as Any).ok, true, `${e.name}: a outra conversa do mesmo usuário`)
    assert.deepEqual(await e.conv.delete(UB, p.convIds[1]), { ok: true, existed: false }, `${e.name}: conversa de A não é alcançável por B`)
    assert.equal(((await e.conv.load(UA, p.convIds[1])) as Any).ok, true, e.name)
    assert.deepEqual(await e.conv.create({ userId: UA, conversationId: p.convIds[0], epoch: "s1", createdAt: new Date().toISOString() }), { ok: true }, `${e.name}: recriar o id`)
    const bBefore = jstr([await e.conv.load(UB, q.convIds[0]), await e.conv.load(UB, q.convIds[1])])
    assert.deepEqual(await e.conv.deleteAllForUser(UA), { ok: true, deleted: 2 }, e.name)
    assert.deepEqual(await e.conv.deleteAllForUser(UA), { ok: true, deleted: 0 }, `${e.name}: idempotente`)
    assert.deepEqual(await e.conv.deleteAllForUser(UC), { ok: true, deleted: 0 }, e.name)
    for (const c of p.convIds) assert.deepEqual(await e.conv.load(UA, c), { ok: false, code: "NOT_FOUND" }, e.name)
    assert.equal(jstr([await e.conv.load(UB, q.convIds[0]), await e.conv.load(UB, q.convIds[1])]), bBefore, `${e.name}: B intacto`)
    if (e.root !== undefined) { assert.deepEqual(walk(join(e.root, "conversations", UA)), [], e.name); assert.ok(walk(join(e.root, "conversations", UB)).length > 0, e.name) }
    for (const bad of ["", "../x", "a/b", 5, null, "x".repeat(200)]) { assert.deepEqual(await e.conv.deleteAllForUser(bad as Any), { ok: false, code: "INVALID_ARGS" }, `${e.name}: ${String(bad)}`); assert.deepEqual(await e.conv.delete(bad as Any, "c1"), { ok: false, code: "INVALID_ARGS" }); assert.deepEqual(await e.conv.delete(UB, bad as Any), { ok: false, code: "INVALID_ARGS" }) }
    assert.equal(((await e.conv.load(UB, q.convIds[0])) as Any).ok, true, e.name)
  })
  const state = { boom: false }
  const e = diskEnv({ conv: boomOps(state) })
  const p = await populate(e, UA, "A")
  state.boom = true
  for (const r of [await e.conv.delete(UA, p.convIds[0]), await e.conv.deleteAllForUser(UA)]) { assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.equal(jstr(r).includes("segredo"), false) }
  assert.equal(((await e.conv.load(UA, p.convIds[0])) as Any).ok, true, "a falha não apagou nada")
  state.boom = false
  assert.deepEqual(await e.conv.deleteAllForUser(UA), { ok: true, deleted: 2 }, "e depois funciona")
})

await test("S1 — SaltStore.deleteAllForUser: apaga TODAS as linhas (CURRENT, RETIRED e ilegível), o usuário sai do listUsers, outro usuário intacto, idempotente, o diretório some em disco", async () => {
  await both(async (e) => {
    const p = await populate(e, UA, "A"); const q = await populate(e, UB, "B")
    await e.salts.rotate(UA); await e.salts.rotate(UA); await e.salts.retire(UA, "s1")
    if (e.root !== undefined) writeFileSync(join(e.root, "salts", UA, "s9.json"), "{ isso não é uma linha de sal")
    const before = ((await e.saltStore.loadUser(UA)) as Any).rows.length
    assert.ok(before >= 3, e.name)
    const bBefore = jstr(((await e.saltStore.loadUser(UB)) as Any).rows)
    assert.deepEqual(await e.saltStore.deleteAllForUser(UA), { ok: true, deleted: before }, e.name)
    assert.deepEqual(((await e.saltStore.loadUser(UA)) as Any).rows, [], e.name)
    assert.equal(((await e.saltStore.listUsers()) as Any).userIds.includes(UA), false, `${e.name}: fora do listUsers`)
    assert.equal(jstr(((await e.saltStore.loadUser(UB)) as Any).rows), bBefore, `${e.name}: B intacto`)
    assert.deepEqual(await e.saltStore.deleteAllForUser(UA), { ok: true, deleted: 0 }, `${e.name}: idempotente`)
    assert.deepEqual(await e.saltStore.deleteAllForUser(UC), { ok: true, deleted: 0 }, e.name)
    if (e.root !== undefined) { assert.deepEqual(walk(join(e.root, "salts", UA)), [], e.name); assert.ok(walk(join(e.root, "salts", UB)).length > 0, e.name) }
    for (const bad of ["", "../x", "a/b", 5, null, "x".repeat(200)]) assert.deepEqual(await e.saltStore.deleteAllForUser(bad as Any), { ok: false, code: "INVALID_ARGS" }, `${e.name}: ${String(bad)}`)
    void p; void q
  })
  const state = { boom: false }
  const e = diskEnv({ salt: boomOps(state) })
  const p = await populate(e, UA, "A")
  state.boom = true
  const r = await e.saltStore.deleteAllForUser(UA)
  assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.equal(jstr(r).includes("segredo"), false)
  assert.ok(((await e.saltStore.loadUser(UA)) as Any).rows.length > 0, "a falha não apagou nada")
  state.boom = false
  assert.equal(((await e.saltStore.deleteAllForUser(UA)) as Any).ok, true, "e depois funciona"); void p
})

await test("B1 — BundleCache.purgeUser: tira as entradas e os bytes SÓ do usuário (devolve a contagem); os de outros ficam; usuário inválido ou sem entradas ⇒ 0", async () => {
  const c = createBundleCache()
  const mk = (seed: string, pad = "x".repeat(50)): Any => ({ evidenceHash: sha256Hex(new TextEncoder().encode(seed)), pad })
  const ref = (b: Any): string => `ev_${b.evidenceHash.slice(0, 32)}`
  const [a1, a2, b1] = [mk("a1"), mk("a2"), mk("b1")]
  c.put(UA, ref(a1), a1); c.put(UA, ref(a2), a2); c.put(UB, ref(b1), b1)
  const bytesB = Buffer.byteLength(JSON.stringify(b1))
  assert.equal(c.purgeUser(UA), 2)
  assert.deepEqual([c.stats().entries, c.stats().bytes], [1, bytesB])
  assert.equal(c.get(UA, ref(a1)), null); assert.equal(c.get(UB, ref(b1)), b1)
  assert.equal(c.purgeUser(UA), 0); assert.equal(c.purgeUser(UC), 0)
  for (const bad of ["", "../x", 5, null, undefined]) assert.equal(c.purgeUser(bad as Any), 0, String(bad))
  assert.equal(c.get(UB, ref(b1)), b1)
})

await test("B2 — corrida: um voo iniciado ANTES da purga entrega o resultado a quem esperava mas NÃO o guarda (geração por usuário); um voo iniciado DEPOIS guarda; o voo de outro usuário não é afetado", async () => {
  const c = createBundleCache()
  const mk = (seed: string): Any => ({ evidenceHash: sha256Hex(new TextEncoder().encode(seed)), pad: "p" })
  const ref = (b: Any): string => `ev_${b.evidenceHash.slice(0, 32)}`
  const [old, fresh, other] = [mk("old"), mk("fresh"), mk("other")]
  let release!: (v: Any) => void; const gate = new Promise<Any>((r) => { release = r })
  const flightOld = c.getOrLoad(UA, ref(old), () => gate)
  const flightOther = c.getOrLoad(UB, ref(other), async () => ({ ok: true, bundle: other }))
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(c.purgeUser(UA), 0)
  release({ ok: true, bundle: old })
  const r: Any = await flightOld; assert.deepEqual([r.ok, r.bundle === old], [true, true], "quem esperava recebe")
  assert.equal(c.get(UA, ref(old)), null, "mas NÃO ficou guardado depois da purga")
  assert.equal(((await flightOther) as Any).ok, true); assert.equal(c.get(UB, ref(other)), other, "outro usuário guarda normalmente")
  let loads = 0
  const again: Any = await c.getOrLoad(UA, ref(old), async () => { loads += 1; return { ok: true, bundle: old } })
  assert.deepEqual([again.ok, again.from, loads], [true, "loaded", 1], "um novo pedido recarrega")
  assert.equal(c.get(UA, ref(old)), old, "e este guarda")
  // um chamador que chega DEPOIS da purga, com o voo antigo ainda pendente, começa um voo NOVO; e o fim do voo antigo não derruba o voo novo
  let release2!: (v: Any) => void; const gate2 = new Promise<Any>((rr) => { release2 = rr })
  const slow = c.getOrLoad(UA, ref(fresh), () => gate2)
  await new Promise((rr) => setTimeout(rr, 0)); c.purgeUser(UA)
  let release3!: (v: Any) => void; const gate3 = new Promise<Any>((rr) => { release3 = rr })
  let loads2 = 0, loads3 = 0
  const late = c.getOrLoad(UA, ref(fresh), async () => { loads2 += 1; return gate3 })
  await new Promise((rr) => setTimeout(rr, 0))
  release2({ ok: true, bundle: fresh }); await slow // o voo ANTIGO termina (e limpa o que é dele)
  const third = c.getOrLoad(UA, ref(fresh), async () => { loads3 += 1; return { ok: true, bundle: fresh } })
  release3({ ok: true, bundle: fresh })
  assert.equal(((await late) as Any).ok, true); assert.equal(((await third) as Any).ok, true)
  assert.deepEqual([loads2, loads3], [1, 0], "o voo novo foi UM só e o terceiro entrou nele (o fim do voo antigo não o apagou)")
  assert.equal(c.get(UA, ref(fresh)), fresh, "o voo novo guarda (a geração dele é a atual)")
})

// ───────────────────────────── coordenador ─────────────────────────────
await test("P1 — purgeUserData COMPLETO (memória e disco): relatório com as contagens reais; A sem NENHUM vestígio (APIs, caminhos, CSV, sal); B byte a byte idêntico", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A"); const b = await populate(e, UB, "B")
    const bSnap = await snapshot(e, UB, b)
    const bTree = e.root !== undefined ? treeOf(e, UB) : {}
    const report: Any = await purgeUserData(purgeDeps(e), { userId: UA })
    assert.deepEqual(report, { ok: true, purged: { rawFiles: 2, importSources: 2, conversations: 2, salts: true, cacheEntries: a.refs.length } }, e.name)
    assert.equal(a.refs.length, 2)
    await empty(e, UA, a)
    assert.equal(await snapshot(e, UB, b), bSnap, `${e.name}: B intacto pelas APIs`)
    if (e.root !== undefined) {
      assert.deepEqual(walk(e.root).filter((f) => f.includes(UA)), [], "nenhum caminho do usuário apagado")
      assert.deepEqual(treeOf(e, UB), bTree, "B byte a byte")
      for (const f of walk(e.root)) { const bytes = readFileSync(f); assert.equal(bytes.includes(Buffer.from("ACC-A")), false, `marcador de A em ${f}`); assert.equal(bytes.includes(Buffer.from(a.salt)), false, `sal de A em ${f}`) }
      assert.ok(walk(e.root).some((f) => readFileSync(f).includes(Buffer.from("ACC-B"))), "o CSV de B segue lá")
    }
    assert.equal(jstr(report).includes(UA), false, "o relatório não ecoa o userId")
  })
})

await test("P2 — IDEMPOTÊNCIA: a 2ª purga e a de um usuário que nunca existiu devolvem ok com zeros e salts:false", async () => {
  await both(async (e) => {
    await populate(e, UA, "A")
    assert.equal(((await purgeUserData(purgeDeps(e), { userId: UA })) as Any).ok, true)
    const zero = { ok: true, purged: { rawFiles: 0, importSources: 0, conversations: 0, salts: false, cacheEntries: 0 } }
    assert.deepEqual(await purgeUserData(purgeDeps(e), { userId: UA }), zero, `${e.name}: 2ª`)
    assert.deepEqual(await purgeUserData(purgeDeps(e), { userId: UC }), zero, `${e.name}: nunca existiu`)
  })
})

await test("P3 — FALHA PARCIAL em cada etapa (devolvendo código OU lançando): ok:false com failedStore e done corretos, as etapas SEGUINTES não rodam (o sal e o cache ficam), sem eco da mensagem; reexecutar conclui e o relatório soma o que faltava", async () => {
  const stages: Array<{ store: "rawFiles" | "importSources" | "conversations" | "salts"; key: string; done: Any; rest: Any }> = [
    { store: "rawFiles", key: "rawStorage", done: {}, rest: { rawFiles: 2, importSources: 2, conversations: 2, salts: true, cacheEntries: 2 } },
    { store: "importSources", key: "importStore", done: { rawFiles: 2 }, rest: { rawFiles: 0, importSources: 2, conversations: 2, salts: true, cacheEntries: 2 } },
    { store: "conversations", key: "conversationStore", done: { rawFiles: 2, importSources: 2 }, rest: { rawFiles: 0, importSources: 0, conversations: 2, salts: true, cacheEntries: 2 } },
    { store: "salts", key: "saltStore", done: { rawFiles: 2, importSources: 2, conversations: 2 }, rest: { rawFiles: 0, importSources: 0, conversations: 0, salts: true, cacheEntries: 2 } },
  ]
  for (const mode of ["code", "throw"] as const) for (const st of stages) await both(async (e) => {
    const a = await populate(e, UA, "A")
    const inject = failing((purgeDeps(e) as Any)[st.key], "deleteAllForUser", mode)
    const r: Any = await purgeUserData(purgeDeps(e, { [st.key]: inject }), { userId: UA })
    assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR", failedStore: st.store, done: st.done }, `${e.name}/${mode}/${st.store}`)
    assert.equal(jstr(r).includes("segredo"), false, "sem eco da mensagem")
    // as etapas seguintes NÃO rodaram
    const order = ["rawFiles", "importSources", "conversations", "salts"]
    const idx = order.indexOf(st.store)
    if (idx <= 0) assert.equal(((await e.raw.get(UA, a.shas[0])) as Any).ok, true, `${e.name}/${st.store}: arquivos`)
    if (idx <= 1) assert.equal(((await e.imp.get(UA, a.shas[0])) as Any).ok, true, `${e.name}/${st.store}: metadados`)
    if (idx <= 2) assert.equal(((await e.conv.load(UA, a.convIds[0])) as Any).ok, true, `${e.name}/${st.store}: conversas`)
    assert.ok(((await e.saltStore.loadUser(UA)) as Any).rows.length > 0, `${e.name}/${st.store}: o SAL segue (nunca é destruído se uma etapa anterior falhou)`)
    assert.equal(e.cache.get(UA, a.refs[0]) !== null, true, `${e.name}/${st.store}: o cache só é purgado no fim`)
    // reexecutar conclui
    const again: Any = await purgeUserData(purgeDeps(e), { userId: UA })
    assert.deepEqual(again, { ok: true, purged: st.rest }, `${e.name}/${mode}/${st.store}: reexecução`)
    await empty(e, UA, a)
  })
})

await test("P4 — pedido e deps HOSTIS: userId inválido (vazio, ../, separador, não-string, enorme), chaves extras, deps sem store ou sem função ⇒ INVALID_ARGS sem tocar em nada; nenhuma resposta ecoa o valor recebido", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A"); const snap = await snapshot(e, UA, a)
    const evil = "../../etc/passwd"
    const bads: Any[] = ["", evil, "a/b", "a\\b", 5, null, undefined, "x".repeat(200)]
    for (const userId of bads) { const r: Any = await purgeUserData(purgeDeps(e), { userId }); assert.deepEqual(r, { ok: false, code: "INVALID_ARGS", failedStore: null, done: {} }, `${e.name}: ${String(userId)}`) }
    for (const req of [null, undefined, 5, "x", [], {}, { userId: UA, extra: 1 }]) { const r: Any = await purgeUserData(purgeDeps(e), req as Any); assert.equal(r.ok, false, jstr(req)); assert.equal(r.code, "INVALID_ARGS") }
    for (const deps of [null, undefined, {}, purgeDeps(e, { rawStorage: null }), purgeDeps(e, { saltStore: {} }), purgeDeps(e, { importStore: { deleteAllForUser: 5 } }), purgeDeps(e, { conversationStore: undefined }), purgeDeps(e, { cache: 5 }), purgeDeps(e, { cache: {} })]) {
      const r: Any = await purgeUserData(deps as Any, { userId: UA }); assert.deepEqual(r, { ok: false, code: "INVALID_ARGS", failedStore: null, done: {} }, `${e.name}: deps ${String(deps)}`)
    }
    assert.equal(jstr(await purgeUserData(purgeDeps(e), { userId: evil })).includes("etc/passwd"), false, "sem eco")
    assert.equal(await snapshot(e, UA, a), snap, `${e.name}: nada foi tocado`)
    for (const f of [deleteImportFile, deleteConversation]) assert.deepEqual(await f(purgeDeps(e), null as Any), { ok: false, code: "INVALID_ARGS", failedStore: null, done: {} }, e.name)
  })
})

await test("P5 — PÓS-PURGA: makeContext ⇒ IMPORT_NOT_REGISTERED; openTurn ⇒ SALT_REQUIRED; ensure cria um sal NOVO (valor diferente do destruído) e o usuário recomeça do zero", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A")
    assert.equal(((await purgeUserData(purgeDeps(e), { userId: UA })) as Any).ok, true)
    const provider = (await e.salts.load(UA)).provider
    assert.equal(provider.current(UA), null, `${e.name}: sem sal`)
    assert.deepEqual(await openTurn({ rawStorage: e.raw, importStore: e.imp, conversations: createConversations({ store: e.conv }), salts: e.salts }, { userId: UA, conversationId: a.convIds[0], pin: PIN(a.shas[0]) }), { ok: false, code: "SALT_REQUIRED" }, e.name)
    await e.salts.ensure(UA)
    const fresh = (await e.salts.load(UA)).provider
    assert.equal(fresh.current(UA)!.saltId, "s1"); assert.notEqual(fresh.current(UA)!.salt, a.salt, `${e.name}: o sal destruído não volta`)
    assert.deepEqual(await makeContext({ rawStorage: e.raw, importStore: e.imp, salt: fresh }, { userId: UA, pin: PIN(a.shas[0]) }), { ok: false, code: "IMPORT_NOT_REGISTERED" }, e.name)
    const t: Any = await openTurn({ rawStorage: e.raw, importStore: e.imp, conversations: createConversations({ store: e.conv }), salts: e.salts }, { userId: UA, conversationId: a.convIds[0], pin: PIN(a.shas[0]) })
    assert.deepEqual(t, { ok: false, code: "NOT_FOUND" }, `${e.name}: a conversa antiga não existe`)
  })
})

await test("P6 — o cache: a purga de A tira SÓ os bundles de A (os de B ficam byte a byte), e os refs antigos de A não são mais alcançáveis pelo executor", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A"); const b = await populate(e, UB, "B")
    const bundlesB = b.refs.map((r) => jstr(e.cache.get(UB, r)))
    assert.ok(bundlesB.every((x) => x !== "null"), "pré-condição: B aquecido")
    const stats = e.cache.stats()
    const r: Any = await purgeUserData(purgeDeps(e), { userId: UA })
    assert.equal(r.purged.cacheEntries, a.refs.length)
    assert.deepEqual(b.refs.map((x) => jstr(e.cache.get(UB, x))), bundlesB, `${e.name}: B intacto no cache`)
    assert.equal(e.cache.stats().entries, stats.entries - a.refs.length, e.name)
    for (const ref of a.refs) assert.equal(e.cache.get(UA, ref), null, e.name)
  })
})

await test("D1 — deleteImportFile: ordem ARQUIVO → linha → cache. Falha no arquivo deixa tudo; falha na linha deixa a linha apontando para arquivo ausente (makeContext ⇒ FILE_NOT_AVAILABLE); reexecutar conclui", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A")
    const sha = a.shas[0]
    for (const mode of ["code", "throw"] as const) {
      const r1: Any = await deleteImportFile(purgeDeps(e, { rawStorage: failing(e.raw, "delete", mode) }), { userId: UA, fileSha256: sha })
      assert.deepEqual(r1, { ok: false, code: "STORAGE_ERROR", failedStore: "rawFiles", done: {} }, `${e.name}/${mode}`)
      assert.equal(((await e.raw.get(UA, sha)) as Any).ok, true); assert.equal(((await e.imp.get(UA, sha)) as Any).ok, true, `${e.name}: nada mudou`)
    }
    const r2: Any = await deleteImportFile(purgeDeps(e, { importStore: failing(e.imp, "delete", "code") }), { userId: UA, fileSha256: sha })
    assert.deepEqual(r2, { ok: false, code: "STORAGE_ERROR", failedStore: "importSources", done: { rawFile: true } }, e.name)
    assert.deepEqual(await e.raw.get(UA, sha), { ok: false, code: "NOT_FOUND" }, `${e.name}: o arquivo já se foi`)
    assert.equal(((await e.imp.get(UA, sha)) as Any).ok, true, `${e.name}: a linha ficou`)
    const provider = (await e.salts.load(UA)).provider
    assert.deepEqual(await makeContext({ rawStorage: e.raw, importStore: e.imp, salt: provider }, { userId: UA, pin: PIN(sha) }), { ok: false, code: "FILE_NOT_AVAILABLE" }, `${e.name}: linha sem arquivo falha limpo`)
    const r3: Any = await deleteImportFile(purgeDeps(e), { userId: UA, fileSha256: sha })
    assert.deepEqual(r3, { ok: true, rawFile: false, importSource: true, cacheEntries: a.refs.length }, `${e.name}: reexecução`)
    assert.deepEqual(await e.imp.get(UA, sha), { ok: false, code: "NOT_FOUND" }, e.name)
    const r4: Any = await deleteImportFile(purgeDeps(e), { userId: UA, fileSha256: a.shas[1] })
    assert.deepEqual([r4.ok, r4.rawFile, r4.importSource], [true, true, true], `${e.name}: o outro arquivo`)
  })
})

await test("D2 — apagar um arquivo NÃO derruba as conversas (ledger e pins intactos), mas regenerar/analisar sobre ele falha LIMPO (FILE_NOT_AVAILABLE / explain NOT_FOUND), o outro arquivo segue funcionando e o cache do usuário foi purgado", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A")
    const before: Any = await e.conv.load(UA, a.convIds[0])
    const r: Any = await deleteImportFile(purgeDeps(e), { userId: UA, fileSha256: a.shas[0] })
    assert.equal(r.ok, true); assert.ok(r.cacheEntries >= 1)
    assert.equal(jstr(await e.conv.load(UA, a.convIds[0])), jstr(before), `${e.name}: a conversa não foi tocada`)
    for (const ref of a.refs) assert.equal(e.cache.get(UA, ref), null, `${e.name}: o cache do usuário foi purgado`)
    const deps = { rawStorage: e.raw, importStore: e.imp, conversations: createConversations({ store: e.conv }), salts: e.salts }
    const t: Any = await openTurn(deps, { userId: UA, conversationId: a.convIds[0], pin: PIN(a.shas[0]) })
    assert.equal(t.ok, true)
    const x: Any = await t.session.call("evidence.explain@1", { evidenceRef: a.refs[0], page: 1 })
    assert.deepEqual([x.ok, x.result.ok, x.result.error.code], [true, false, "NOT_FOUND"], `${e.name}: o explain não encontra o bundle`)
    const q: Any = await t.session.call("metrics.query@1", Q)
    assert.deepEqual([q.result.ok, q.result.error.code], [false, "FILE_NOT_AVAILABLE"], `${e.name}: nova análise sobre o arquivo apagado`)
    const t2: Any = await openTurn(deps, { userId: UA, conversationId: a.convIds[1], pin: PIN(a.shas[1]) })
    const ok: Any = await t2.session.call("metrics.query@1", Q); assert.equal(ok.result.ok, true, `${e.name}: o outro arquivo segue`)
  })
})

await test("D3 — deleteImportFile: ISOLAMENTO (o sha de A pedido por B não apaga nada de A) e sha/usuário inválidos ⇒ INVALID_ARGS sem efeito", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A"); const b = await populate(e, UB, "B"); const snap = await snapshot(e, UA, a)
    const bBundles = b.refs.map((x) => jstr(e.cache.get(UB, x)))
    const r: Any = await deleteImportFile(purgeDeps(e), { userId: UB, fileSha256: a.shas[0] })
    assert.equal(r.ok, true); assert.deepEqual([r.rawFile, r.importSource], [false, false], e.name)
    assert.equal(await snapshot(e, UA, a), snap, `${e.name}: A intacto`)
    assert.equal(r.cacheEntries, 0, `${e.name}: nada foi apagado ⇒ o cache do usuário não é tocado`)
    assert.deepEqual(b.refs.map((x) => jstr(e.cache.get(UB, x))), bBundles, `${e.name}: o cache de quem pediu também não é tocado`)
    for (const bad of [{ userId: "../x", fileSha256: a.shas[0] }, { userId: UA, fileSha256: "zz" }, { userId: UA, fileSha256: "A".repeat(64) }, { userId: UA }, { fileSha256: a.shas[0] }, { userId: UA, fileSha256: a.shas[0], extra: 1 }, null, 5]) {
      assert.deepEqual(await deleteImportFile(purgeDeps(e), bad as Any), { ok: false, code: "INVALID_ARGS", failedStore: null, done: {} }, `${e.name}: ${jstr(bad)}`)
    }
    assert.equal(await snapshot(e, UA, a), snap, e.name)
  })
})

await test("V1 — deleteConversation: existed true/false, as outras conversas e os arquivos do usuário intactos, o cache do usuário purgado (o de outro não), conversa de OUTRO usuário ⇒ existed:false e nada muda; ids inválidos ⇒ INVALID_ARGS", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A"); const b = await populate(e, UB, "B")
    const keep: Any = await e.conv.load(UA, a.convIds[1]); const bBundles = b.refs.map((r) => jstr(e.cache.get(UB, r)))
    const foreign: Any = await deleteConversation(purgeDeps(e), { userId: UB, conversationId: a.convIds[0] })
    assert.deepEqual([foreign.ok, foreign.existed], [true, false], `${e.name}: de outro usuário`)
    assert.equal(((await e.conv.load(UA, a.convIds[0])) as Any).ok, true, e.name)
    const r: Any = await deleteConversation(purgeDeps(e), { userId: UA, conversationId: a.convIds[0] })
    assert.deepEqual(r, { ok: true, existed: true, cacheEntries: a.refs.length }, e.name)
    assert.deepEqual(await e.conv.load(UA, a.convIds[0]), { ok: false, code: "NOT_FOUND" }, e.name)
    assert.equal(jstr(await e.conv.load(UA, a.convIds[1])), jstr(keep), `${e.name}: a outra conversa`)
    for (const sha of a.shas) { assert.equal(((await e.raw.get(UA, sha)) as Any).ok, true, e.name); assert.equal(((await e.imp.get(UA, sha)) as Any).ok, true, e.name) }
    for (const ref of a.refs) assert.equal(e.cache.get(UA, ref), null, e.name)
    assert.deepEqual(b.refs.map((x) => jstr(e.cache.get(UB, x))), bBundles, `${e.name}: cache de B`)
    const again: Any = await deleteConversation(purgeDeps(e), { userId: UA, conversationId: a.convIds[0] })
    assert.deepEqual([again.ok, again.existed], [true, false], `${e.name}: idempotente`)
    const fail: Any = await deleteConversation(purgeDeps(e, { conversationStore: failing(e.conv, "delete", "throw") }), { userId: UA, conversationId: a.convIds[1] })
    assert.deepEqual(fail, { ok: false, code: "STORAGE_ERROR", failedStore: "conversations", done: {} }, e.name); assert.equal(jstr(fail).includes("segredo"), false)
    for (const bad of [{ userId: UA, conversationId: "../x" }, { userId: UA, conversationId: "" }, { userId: "a/b", conversationId: a.convIds[1] }, { userId: UA }, { userId: UA, conversationId: a.convIds[1], extra: 1 }]) assert.deepEqual(await deleteConversation(purgeDeps(e), bad as Any), { ok: false, code: "INVALID_ARGS", failedStore: null, done: {} }, `${e.name}: ${jstr(bad)}`)
    assert.equal(((await e.conv.load(UA, a.convIds[1])) as Any).ok, true, `${e.name}: nada apagado por entradas inválidas`)
  })
})

await test("R1 — CARACTERIZAÇÃO (D-LGPD-6): os stores NÃO trancam a conta — depois da purga um registerImport e um ensure RECRIAM dados; por isso o bloqueio da conta é da camada de auth/servidor antes de disparar o expurgo", async () => {
  await both(async (e) => {
    const a = await populate(e, UA, "A")
    await purgeUserData(purgeDeps(e), { userId: UA })
    await e.salts.ensure(UA)
    const provider = (await e.salts.load(UA)).provider
    const r: Any = await registerImport({ rawStorage: e.raw, importStore: e.imp, salt: provider }, { userId: UA, text: csvOf(40, 1, "A"), context: CTX, fileName: "A-0.csv" })
    assert.equal(r.ok, true, `${e.name}: recriou`)
    assert.equal(((await e.raw.get(UA, r.fileSha256)) as Any).ok, true, `${e.name}: o arquivo voltou a existir`)
    const second: Any = await purgeUserData(purgeDeps(e), { userId: UA })
    assert.deepEqual([second.ok, second.purged.rawFiles, second.purged.importSources, second.purged.salts], [true, 1, 1, true], `${e.name}: e uma nova purga limpa de novo`)
    void a
  })
})

await test("X1 — tripwire: user-purge.ts importa só módulos de infra (stores/tipos), nunca salt.ts, o contrato do agente, node:crypto, nem fs/process.env/rede; nenhum portão estático foi aberto para ele", async () => {
  const code = readFileSync(join(ROOT, "src", "lib", "infra", "user-purge.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const p of imports) assert.ok(/^\.\/[a-z-]+\.ts$/.test(p), `import fora do permitido: ${p}`)
  assert.equal(imports.some((p) => /salt\.ts$/.test(p) && !/salt-store\.ts$/.test(p)), false, "importa salt.ts")
  assert.equal(/from\s+["'](node:)?(crypto|fs|fs\/promises|path)["']/.test(code), false, "importa node:crypto/fs/path")
  assert.equal(/process\.env|\bfetch\s*\(|prisma|anthropic|openai|\bDate\b|Math\.random/i.test(code), false, "dependência proibida")
  for (const gate of ["test-agent-capabilities-static.mts", "test-agent-contract-types.mts", "test-agent-contract-static.mts"]) assert.equal(readFileSync(join(ROOT, "scripts", gate), "utf8").includes("user-purge"), false, `${gate}: portão aberto para user-purge.ts`)
})

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes da exclusão LGPD passaram.`)
