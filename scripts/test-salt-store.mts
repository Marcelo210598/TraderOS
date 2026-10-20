// E7-2: SaltProvider persistente cifrado — adaptador AES-256-GCM (infra/cipher.ts) + SaltStore (memória e disco) + chaveiro persistente (infra/salt-store.ts).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_2 (D-C1…D-C8, A1–A8, K1–K5, P1–P6, S1–S4, CM1–CM16).
//   node scripts/test-salt-store.mts
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { inspect } from "node:util"
import { createSaltCipher, type SaltCipher, type Sealed } from "../src/lib/infra/cipher.ts"
import { createDiskSaltStore, createMemorySaltStore, createPersistentSalts, SaltStoreError, saltStoreFailure, type SaltRow, type SaltStore, type StoredRow } from "../src/lib/infra/salt-store.ts"
import { InMemorySaltKeyring, SaltError, generateSalt, isStrongSalt, saltCheck } from "../src/lib/ingest/salt.ts"
import { createPrismaSaltStore } from "../src/lib/infra/prisma-salt-store.ts"
import { connectLiveDb, liveEnabled } from "./_prisma-live.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy", U3 = "cmd3h2k0a0000qqqq5555rrrr"
const KEY1 = "a1".repeat(32), KEY2 = "b2".repeat(32), KEY3 = "c3".repeat(32)
const KEY1_B64 = Buffer.from(KEY1, "hex").toString("base64")
const SALT = "9f".repeat(32)
const failed: string[] = []
/** COLLECT=1 (só para a análise de mutações): não aborta no 1º erro; lista TODOS os casos que enxergam a mutação. */
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const mk = (env: Record<string, string | undefined>): SaltCipher => { const r = createSaltCipher(env); assert.equal(r.ok, true, "cifrador deveria montar"); return (r as Any).cipher }
const C1 = (): SaltCipher => mk({ SALT_MASTER_KEY: KEY1 })
const C2 = (): SaltCipher => mk({ SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_VERSION: "2", SALT_MASTER_KEY_PREV_1: KEY1 })
const C2_ONLY = (): SaltCipher => mk({ SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_VERSION: "2" })
const enc = (c: SaltCipher, plain: string, aad: string): Sealed => { const r = c.encrypt(plain, aad); assert.equal(r.ok, true); return (r as Any).sealed }
const flip = (u: Uint8Array, i: number): Uint8Array => { const c = new Uint8Array(u); c[i] ^= 0x01; return c }

// ── armazenamentos: memória e disco, mesma bateria ──
const TMPS: string[] = []
interface Impl { name: string; make: () => { store: SaltStore; root?: string } | Promise<{ store: SaltStore; root?: string }> }
const IMPLS: Impl[] = [
  { name: "memória", make: () => ({ store: createMemorySaltStore() }) },
  { name: "disco", make: () => { const root = mkdtempSync(join(tmpdir(), "salt-store-")); TMPS.push(root); return { store: createDiskSaltStore(root), root } } },
]
// E7-13 (Portão C): a MESMA suíte de contrato também contra o Postgres do banco de TESTE (branch descartável do Neon). Só com PRISMA_LIVE=1 + E7_TEST_DATABASE_URL; a trava recusa a URL de produção.
if (liveEnabled()) {
  const live = await connectLiveDb()
  IMPLS.push({ name: "prisma (banco de teste)", make: async () => { await live.reset(); return { store: createPrismaSaltStore(live.db) } } })
  process.on("beforeExit", () => { void live.close() })
}
const both = async (fn: (store: SaltStore, name: string, root?: string) => Promise<void>): Promise<void> => { for (const impl of IMPLS) { const m = await impl.make(); await fn(m.store, impl.name, m.root) } }
const wrapLoad = (base: SaltStore, f: (userId: string, rows: StoredRow[]) => StoredRow[]): SaltStore => ({ ...base, async loadUser(u) { const r = await base.loadUser(u); return r.ok ? { ok: true, rows: f(u, r.rows) } : r } })
const rowsOf = async (s: SaltStore, u: string): Promise<SaltRow[]> => { const r = await s.loadUser(u); assert.equal(r.ok, true); return (r as Any).rows }
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return "OK" } catch (e) { return (e as Any).code ?? `ERR:${(e as Error).name}` } }

// ───────────────────────────── A: adaptador ─────────────────────────────
await test("A1 — ida e volta: o texto decifrado é idêntico (sal hex e texto multibyte)", async () => {
  const c = C1()
  for (const plain of [SALT, "Ação — 日本語 😀"]) {
    const sealed = enc(c, plain, `${U1}:s1`)
    const back = c.decrypt(sealed, `${U1}:s1`)
    assert.deepEqual(back, { ok: true, plaintext: plain })
  }
})

await test("A2 — nonce NUNCA repete: 10.000 cifragens do mesmo texto ⇒ 10.000 nonces e 10.000 ciphertexts distintos", async () => {
  const c = C1(), nonces = new Set<string>(), cts = new Set<string>()
  for (let i = 0; i < 10_000; i++) { const s = enc(c, SALT, `${U1}:s1`); nonces.add(Buffer.from(s.nonce).toString("hex")); cts.add(Buffer.from(s.ciphertext).toString("hex")) }
  assert.equal(nonces.size, 10_000)
  assert.equal(cts.size, 10_000)
})

await test("A3 — AAD errada falha: outro saltId, outro usuário, prefixo/sufixo ⇒ AUTH_FAILED; AAD vazia ⇒ INPUT_INVALID", async () => {
  const c = C1(), s = enc(c, SALT, `${U1}:s1`)
  for (const bad of [`${U1}:s2`, `${U2}:s1`, `${U1}:s1 `, `x${U1}:s1`, `${U1}:`, `${U1}s1`]) assert.deepEqual(c.decrypt(s, bad), { ok: false, code: "AUTH_FAILED" }, bad)
  assert.deepEqual(c.decrypt(s, ""), { ok: false, code: "INPUT_INVALID" })
  assert.deepEqual(c.encrypt(SALT, ""), { ok: false, code: "INPUT_INVALID" })
})

await test("A4 — adulterar 1 byte (em QUALQUER posição do nonce ou do ciphertext+tag), truncar ou estender ⇒ falha", async () => {
  const c = C1(), s = enc(c, SALT, `${U1}:s1`)
  for (let i = 0; i < s.nonce.byteLength; i++) assert.equal(c.decrypt({ ...s, nonce: flip(s.nonce, i) }, `${U1}:s1`).ok, false, `nonce[${i}]`)
  for (let i = 0; i < s.ciphertext.byteLength; i++) assert.equal(c.decrypt({ ...s, ciphertext: flip(s.ciphertext, i) }, `${U1}:s1`).ok, false, `ciphertext[${i}]`)
  assert.equal(c.decrypt({ ...s, ciphertext: s.ciphertext.subarray(0, s.ciphertext.byteLength - 1) }, `${U1}:s1`).ok, false)
  assert.equal(c.decrypt({ ...s, ciphertext: new Uint8Array([...s.ciphertext, 0]) }, `${U1}:s1`).ok, false)
  assert.equal(c.decrypt({ ...s, ciphertext: s.ciphertext.subarray(0, 16) }, `${U1}:s1`).ok, false)
})

await test("A5 — chave errada falha: outra chave com a MESMA versão ⇒ AUTH_FAILED, nunca devolve texto", async () => {
  const s = enc(C1(), SALT, `${U1}:s1`)
  const other = mk({ SALT_MASTER_KEY: KEY2 }) // também versão 1, chave diferente
  assert.deepEqual(other.decrypt(s, `${U1}:s1`), { ok: false, code: "AUTH_FAILED" })
})

await test("A6 — chaves inválidas (vazia, tamanho errado, toda zero, não-hex, base64 curto/longo, versões incoerentes) ⇒ KEY_INVALID", async () => {
  const bad: Array<[string, Record<string, Any>]> = [
    ["ausente", {}], ["vazia", { SALT_MASTER_KEY: "" }], ["espaços", { SALT_MASTER_KEY: "   " }], ["não é string", { SALT_MASTER_KEY: 12345 }],
    ["32 chars", { SALT_MASTER_KEY: "a".repeat(32) }], ["63 hex", { SALT_MASTER_KEY: "a".repeat(63) }], ["65 hex", { SALT_MASTER_KEY: "a".repeat(65) }], ["64 chars não-hex", { SALT_MASTER_KEY: "z".repeat(64) }],
    ["toda zero (hex)", { SALT_MASTER_KEY: "0".repeat(64) }], ["toda zero (base64)", { SALT_MASTER_KEY: Buffer.alloc(32).toString("base64") }],
    ["base64 de 16 bytes", { SALT_MASTER_KEY: Buffer.alloc(16, 7).toString("base64") }], ["base64 de 33 bytes", { SALT_MASTER_KEY: Buffer.alloc(33, 7).toString("base64") }],
    ["versão 0", { SALT_MASTER_KEY: KEY1, SALT_MASTER_KEY_VERSION: "0" }], ["versão texto", { SALT_MASTER_KEY: KEY1, SALT_MASTER_KEY_VERSION: "abc" }], ["versão negativa", { SALT_MASTER_KEY: KEY1, SALT_MASTER_KEY_VERSION: "-1" }],
    ["PREV >= atual", { SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_VERSION: "2", SALT_MASTER_KEY_PREV_2: KEY1 }], ["PREV com versão 0", { SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_VERSION: "2", SALT_MASTER_KEY_PREV_0: KEY1 }],
    ["PREV inválida", { SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_VERSION: "2", SALT_MASTER_KEY_PREV_1: "xyz" }], ["PREV toda zero", { SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_VERSION: "2", SALT_MASTER_KEY_PREV_1: "0".repeat(64) }],
    ["PREV igual à atual", { SALT_MASTER_KEY: KEY1, SALT_MASTER_KEY_VERSION: "2", SALT_MASTER_KEY_PREV_1: KEY1 }], ["PREV ausente da versão", { SALT_MASTER_KEY: KEY2, SALT_MASTER_KEY_PREV_1: KEY1 }],
  ]
  for (const [name, env] of bad) assert.deepEqual(createSaltCipher(env), { ok: false, code: "KEY_INVALID" }, name)
  assert.deepEqual(createSaltCipher(null as Any), { ok: false, code: "KEY_INVALID" })
})

await test("A7 — nenhuma falha carrega plaintext, chave, nonce ou AAD: só {ok:false, code}", async () => {
  const c = C1(), s = enc(c, SALT, `${U1}:s1`)
  const fails: Any[] = [c.decrypt(s, `${U2}:s1`), c.decrypt({ ...s, ciphertext: flip(s.ciphertext, 3) }, `${U1}:s1`), c.decrypt({ ...s, keyVersion: 9 }, `${U1}:s1`), c.decrypt(null as Any, "x"), c.encrypt("", "x"),
    createSaltCipher({ SALT_MASTER_KEY: KEY1.slice(0, 40) }), createSaltCipher({ SALT_MASTER_KEY: "0".repeat(64) })]
  const secrets = [SALT, KEY1, KEY1_B64, KEY1.slice(0, 40), Buffer.from(s.nonce).toString("hex"), Buffer.from(s.nonce).toString("base64"), `${U1}:s1`, U1]
  for (const f of fails) {
    assert.deepEqual(Object.keys(f).sort(), ["code", "ok"])
    assert.equal(f.ok, false)
    const text = JSON.stringify(f) + String(f) + inspect(f, { depth: 5 })
    for (const sec of secrets) assert.equal(text.includes(sec), false, `vazou ${sec.slice(0, 6)}…`)
  }
})

await test("A8 — formas: nonce 12 bytes, ciphertext = texto + tag(16), keyVersion da chave atual; entradas inválidas ⇒ INPUT_INVALID; o objeto não expõe a chave", async () => {
  const c = C2()
  const s = enc(c, SALT, `${U1}:s1`)
  assert.equal(s.nonce.byteLength, 12)
  assert.equal(s.ciphertext.byteLength, SALT.length + 16)
  assert.equal(s.keyVersion, 2)
  for (const bad of ["", null, undefined, 7, {}]) assert.deepEqual(c.encrypt(bad as Any, "aad"), { ok: false, code: "INPUT_INVALID" })
  assert.deepEqual(c.decrypt({ ...s, nonce: new Uint8Array(11) }, `${U1}:s1`), { ok: false, code: "INPUT_INVALID" })
  assert.deepEqual(c.decrypt({ ...s, keyVersion: "2" as Any }, `${U1}:s1`), { ok: false, code: "INPUT_INVALID" })
  const shown = JSON.stringify(c) + inspect(c, { showHidden: true, depth: 6 }) + JSON.stringify({ ...c })
  for (const key of [KEY1, KEY2, Buffer.from(KEY2, "hex").toString("base64")]) assert.equal(shown.includes(key), false)
  assert.equal(Object.isFrozen(c), true)
})

// ───────────────────────────── K: chaves mestras ─────────────────────────────
await test("K1 — hex (maiúsculo/minúsculo/com quebra de linha) e base64 da MESMA chave são intercambiáveis", async () => {
  const s = enc(mk({ SALT_MASTER_KEY: KEY1 }), SALT, `${U1}:s1`)
  for (const form of [KEY1.toUpperCase(), KEY1 + "\n", KEY1_B64, ` ${KEY1_B64} `]) assert.deepEqual(mk({ SALT_MASTER_KEY: form }).decrypt(s, `${U1}:s1`), { ok: true, plaintext: SALT }, form.slice(0, 8))
})

await test("K2 — keyVersion desconhecida/zero ⇒ KEY_VERSION_UNKNOWN (inclusive uma versão futura)", async () => {
  const c = C1(), s = enc(c, SALT, `${U1}:s1`)
  for (const v of [0, 2, 9, 999]) assert.deepEqual(c.decrypt({ ...s, keyVersion: v }, `${U1}:s1`), { ok: false, code: "KEY_VERSION_UNKNOWN" }, String(v))
})

await test("K3 — duas versões convivem: a v2 decifra o que a v1 cifrou, cifra sempre com a atual; a v1 sozinha não decifra v2", async () => {
  const v1 = C1(), v2 = C2()
  assert.deepEqual([...v2.versions], [2, 1])
  assert.equal(v2.currentVersion, 2)
  const old = enc(v1, SALT, `${U1}:s1`), fresh = enc(v2, SALT, `${U1}:s1`)
  assert.equal(old.keyVersion, 1)
  assert.equal(fresh.keyVersion, 2)
  assert.deepEqual(v2.decrypt(old, `${U1}:s1`), { ok: true, plaintext: SALT })
  assert.deepEqual(v2.decrypt(fresh, `${U1}:s1`), { ok: true, plaintext: SALT })
  assert.deepEqual(v1.decrypt(fresh, `${U1}:s1`), { ok: false, code: "KEY_VERSION_UNKNOWN" })
  assert.deepEqual(C2_ONLY().decrypt(old, `${U1}:s1`), { ok: false, code: "KEY_VERSION_UNKNOWN" })
})

await test("K4 — recipherAll troca TODAS as linhas para a versão atual, mantém o MESMO sal, e a chave antiga pode ser aposentada", async () => {
  await both(async (store, name) => {
    const a = createPersistentSalts({ store, cipher: C1() })
    await a.ensure(U1); await a.rotate(U1); await a.ensure(U2)
    const before = new Map<string, string>()
    for (const u of [U1, U2]) for (const k of (await a.load(u)).provider.known(u)) before.set(`${u}:${k.saltId}`, k.salt)
    const oldRows = [...(await rowsOf(store, U1)), ...(await rowsOf(store, U2))]
    assert.equal(oldRows.every((r) => r.keyVersion === 1), true, name)
    const b = createPersistentSalts({ store, cipher: C2() })
    const r = await b.recipherAll()
    assert.deepEqual({ rewritten: r.rewritten, alreadyCurrent: r.alreadyCurrent, conflicts: r.conflicts, skipped: r.skipped }, { rewritten: 3, alreadyCurrent: 0, conflicts: 0, skipped: [] }, name)
    const newRows = [...(await rowsOf(store, U1)), ...(await rowsOf(store, U2))]
    assert.equal(newRows.every((x) => x.keyVersion === 2), true, name)
    for (let i = 0; i < oldRows.length; i++) assert.notDeepEqual(newRows[i].ciphertext, oldRows[i].ciphertext, "ciphertext precisa mudar")
    // só a chave NOVA já basta (a antiga pode ser aposentada) e os sais são exatamente os mesmos
    const c = createPersistentSalts({ store, cipher: C2_ONLY() })
    for (const u of [U1, U2]) { const l = await c.load(u); assert.deepEqual(l.unavailable, []); for (const k of l.provider.known(u)) assert.equal(k.salt, before.get(`${u}:${k.saltId}`), `${name} ${u}:${k.saltId}`) }
    const again = await b.recipherAll()
    assert.deepEqual({ rewritten: again.rewritten, alreadyCurrent: again.alreadyCurrent }, { rewritten: 0, alreadyCurrent: 3 }, name)
  })
})

await test("K5 — rotação interrompida no meio (falha de infra no 2º replaceCipher) lança, NADA fica ilegível, e rodar de novo termina", async () => {
  await both(async (store, name) => {
    const a = createPersistentSalts({ store, cipher: C1() })
    await a.ensure(U1); await a.rotate(U1); await a.rotate(U1)
    const expected = (await a.load(U1)).provider.known(U1)
    let calls = 0
    const flaky: SaltStore = { ...store, async replaceCipher(...args) { calls += 1; return calls === 2 ? saltStoreFailure("STORAGE_ERROR") : store.replaceCipher(...args) } }
    const b = createPersistentSalts({ store: flaky, cipher: C2() })
    assert.equal(await codeOf(() => b.recipherAll()), "E_SALT_STORE_UNAVAILABLE", name)
    const mixed = (await rowsOf(store, U1)).map((r) => r.keyVersion).sort()
    assert.deepEqual(mixed, [1, 1, 2], `${name}: um recifrado, dois pendentes`)
    const mid = await createPersistentSalts({ store, cipher: C2() }).load(U1)
    assert.deepEqual(mid.unavailable, [], name)
    assert.deepEqual(mid.provider.known(U1), expected, `${name}: mesmos sais no meio da rotação`)
    const done = await createPersistentSalts({ store, cipher: C2() }).recipherAll()
    assert.deepEqual({ rewritten: done.rewritten, alreadyCurrent: done.alreadyCurrent }, { rewritten: 2, alreadyCurrent: 1 }, name)
    assert.equal((await rowsOf(store, U1)).every((r) => r.keyVersion === 2), true, name)
    // CAS do store: 'esperado' velho (keyVersion ou nonce) NÃO atropela a linha já trocada
    const cur = (await rowsOf(store, U1))[0], aad = `${U1}:${cur.saltId}`, fresh = enc(C2(), SALT, aad)
    assert.deepEqual(await store.replaceCipher(U1, cur.saltId, { keyVersion: 1, nonce: cur.nonce! }, fresh), saltStoreFailure("CONFLICT"), `${name}: versão velha`)
    assert.deepEqual(await store.replaceCipher(U1, cur.saltId, { keyVersion: 2, nonce: flip(cur.nonce!, 0) }, fresh), saltStoreFailure("CONFLICT"), `${name}: nonce velho`)
    assert.deepEqual((await rowsOf(store, U1))[0], cur, `${name}: a linha ficou intacta`)
    assert.deepEqual(await store.replaceCipher(U1, "s9", { keyVersion: 2, nonce: cur.nonce! }, fresh), saltStoreFailure("NOT_FOUND"), name)
    // corrida de verdade: outro recifrador troca a linha ENTRE o load e o replace ⇒ recipherAll conta conflito e não atropela
    const x = createPersistentSalts({ store, cipher: C1() })
    await x.ensure(U2)
    const row2 = (await rowsOf(store, U2))[0], mine = enc(C2(), SALT, `${U2}:${row2.saltId}`)
    const racer: SaltStore = { ...store, async replaceCipher(u, sid, expected, next) { await store.replaceCipher(u, sid, expected, mine); return store.replaceCipher(u, sid, expected, next) } }
    const res = await createPersistentSalts({ store: racer, cipher: C2() }).recipherAll()
    assert.equal(res.conflicts, 1, `${name}: conflito contado`)
    assert.deepEqual((await rowsOf(store, U2))[0].ciphertext, mine.ciphertext, `${name}: venceu quem chegou primeiro`)
  })
})

// ───────────────────────────── P: provider persistente ─────────────────────────────
interface Driver { ensure(u: string): Promise<string>; rotate(u: string): Promise<string>; retire(u: string, s: string): Promise<void>; lookup(u: string, s: string): Promise<Any>; current(u: string): Promise<Any>; known(u: string): Promise<Any> }
const memDriver = (): Driver => { const kr = new InMemorySaltKeyring(); return { ensure: async (u) => kr.ensure(u).saltId, rotate: async (u) => kr.rotate(u).saltId, retire: async (u, s) => kr.retire(u, s), lookup: async (u, s) => kr.get(u, s), current: async (u) => kr.current(u), known: async (u) => kr.known(u) } }
const persDriver = (store: SaltStore): Driver => { const p = createPersistentSalts({ store, cipher: C1() }); return { ensure: async (u) => (await p.ensure(u)).saltId, rotate: async (u) => (await p.rotate(u)).saltId, retire: (u, s) => p.retire(u, s), lookup: async (u, s) => (await p.load(u)).provider.get(u, s), current: async (u) => (await p.load(u)).provider.current(u), known: async (u) => (await p.load(u)).provider.known(u) } }
/** Mesma bateria nos dois: devolve um rastro SEM valores de sal (aleatórios), mais os sais coletados para checar força/consistência. */
async function battery(d: Driver): Promise<{ trace: string[]; salts: string[] }> {
  const trace: string[] = [], salts: string[] = []
  const rec = async (label: string, fn: () => Promise<unknown>): Promise<void> => { try { const v = await fn(); trace.push(`${label} => ${JSON.stringify(v)}`) } catch (e) { trace.push(`${label} !! ${(e as Any).code ?? (e as Error).name}`) } }
  const view = (x: Any): unknown => (x === null ? null : Array.isArray(x) ? x.map((k: Any) => k.saltId) : x.salt === undefined ? x : { ...x, salt: undefined, hasValue: isStrongSalt(x.salt) })
  const take = async (u: string): Promise<void> => { for (const k of await d.known(u)) salts.push(k.salt) }
  await rec("current(U1) vazio", async () => d.current(U1))
  await rec("known(U1) vazio", async () => view(await d.known(U1)))
  await rec("ensure(U1)", () => d.ensure(U1))
  await rec("ensure(U1) de novo", () => d.ensure(U1))
  await rec("get s1", async () => view(await d.lookup(U1, "s1")))
  await rec("rotate(U1)", () => d.rotate(U1))
  await rec("get s1 (não atual)", async () => view(await d.lookup(U1, "s1")))
  await rec("get s2 (atual)", async () => view(await d.lookup(U1, "s2")))
  await rec("get s9", async () => view(await d.lookup(U1, "s9")))
  await rec("retire atual", () => d.retire(U1, "s2"))
  await rec("retire desconhecido", () => d.retire(U1, "s9"))
  await rec("retire s1", () => d.retire(U1, "s1"))
  await rec("get s1 aposentado", async () => view(await d.lookup(U1, "s1")))
  await rec("known só o atual", async () => view(await d.known(U1)))
  await rec("rotate(U1) s3", () => d.rotate(U1))
  await rec("known s3,s2", async () => view(await d.known(U1)))
  await rec("current s3", async () => view(await d.current(U1)))
  await rec("usuário vazio", () => d.ensure(""))
  await rec("isolamento U2", async () => d.current(U2))
  await take(U1)
  return { trace, salts }
}

await test("P1 — contrato: ensure/rotate/retire/get/current/known se comportam IDÊNTICO ao InMemorySaltKeyring (memória e disco), com sais fortes, distintos e estáveis", async () => {
  const ref = await battery(memDriver())
  assert.equal(ref.trace.filter((t) => t.includes("!!")).length, 3, "a bateria precisa exercitar os 3 erros de regra (retire atual, retire desconhecido, usuário vazio)")
  await both(async (store, name) => {
    const got = await battery(persDriver(store))
    assert.deepEqual(got.trace, ref.trace, `${name}: rastro diferente do InMemory`)
    assert.equal(got.salts.length, 2)
    assert.equal(got.salts.every((s) => isStrongSalt(s)), true)
    assert.equal(new Set(got.salts).size, got.salts.length)
    // estável: recarregar devolve exatamente os mesmos valores
    const p = createPersistentSalts({ store, cipher: C1() })
    assert.deepEqual((await p.load(U1)).provider.known(U1).map((k) => k.salt), got.salts, name)
    // saltCheck guardado = saltCheck do valor
    for (const r of await rowsOf(store, U1)) if (r.status === "ACTIVE") assert.equal(r.saltCheck, saltCheck(got.salts[r.saltId === "s3" ? 0 : 1]), name)
  })
})

await test("P2 — blob trocado entre s1↔s2, ou copiado de outro usuário ⇒ erro FECHADO (AUTH_FAILED), nenhum valor, e a última linha inválida deixa SEM sal atual", async () => {
  await both(async (store, name) => {
    const p = createPersistentSalts({ store, cipher: C1() })
    await p.ensure(U1); await p.rotate(U1); await p.ensure(U2)
    const swapped = createPersistentSalts({ store: wrapLoad(store, (u, rows) => u !== U1 ? rows : rows.map((r) => { const o = (rows as SaltRow[]).find((x) => x.saltId !== r.saltId)!; return { ...r, ciphertext: o.ciphertext, nonce: o.nonce, keyVersion: o.keyVersion } as SaltRow })), cipher: C1() })
    const a = await swapped.load(U1)
    assert.deepEqual(a.unavailable.map((x) => `${x.saltId}:${x.code}`).sort(), ["s1:AUTH_FAILED", "s2:AUTH_FAILED"], name)
    assert.equal(a.provider.current(U1), null, `${name}: última inválida ⇒ sem sal atual`)
    assert.deepEqual(a.provider.known(U1), [], name)
    assert.equal(a.provider.get(U1, "s1").status === "ACTIVE", false, name)
    assert.equal(await codeOf(() => swapped.ensure(U1)), "E_SALT_NO_CURRENT", name)
    // copiar a linha do U1 (s1) para o U2 trocando só o userId
    const u1s1 = (await rowsOf(store, U1)).find((r) => r.saltId === "s1")!
    const stolen = createPersistentSalts({ store: wrapLoad(store, (u, rows) => u === U2 ? [{ ...u1s1, userId: U2 }] : rows), cipher: C1() })
    const b = await stolen.load(U2)
    assert.deepEqual(b.unavailable, [{ saltId: "s1", code: "AUTH_FAILED" }], name)
    assert.equal(b.provider.current(U2), null, name)
  })
})

await test("P3 — linha corrompida NÃO derruba o usuário: aquele saltId some com erro explícito, os outros seguem; fraco/saltCheck divergente também", async () => {
  await both(async (store, name, root) => {
    const p = createPersistentSalts({ store, cipher: C1() })
    await p.ensure(U1); await p.rotate(U1); await p.rotate(U1)
    const good = (await p.load(U1)).provider.known(U1)
    // 1) bit invertido no ciphertext de s1
    const flipped = createPersistentSalts({ store: wrapLoad(store, (_u, rs) => (rs as SaltRow[]).map((r) => r.saltId === "s1" ? { ...r, ciphertext: flip(r.ciphertext!, 5) } : r)), cipher: C1() })
    const l1 = await flipped.load(U1)
    assert.deepEqual(l1.unavailable, [{ saltId: "s1", code: "AUTH_FAILED" }], name)
    assert.deepEqual(l1.provider.known(U1).map((k) => k.saltId), ["s3", "s2"], name)
    assert.equal(l1.provider.current(U1)!.saltId, "s3", name)
    // 2) saltCheck divergente (formato válido, valor errado)
    const wrongCheck = createPersistentSalts({ store: wrapLoad(store, (_u, rs) => (rs as SaltRow[]).map((r) => r.saltId === "s2" ? { ...r, saltCheck: "slt_" + "0".repeat(24) } : r)), cipher: C1() })
    assert.deepEqual((await wrongCheck.load(U1)).unavailable, [{ saltId: "s2", code: "CHECK_MISMATCH" }], name)
    // 3) texto que decifra mas NÃO é um sal forte
    const weak = enc(C1(), "abc", `${U1}:s2`)
    const weakRow = createPersistentSalts({ store: wrapLoad(store, (_u, rs) => (rs as SaltRow[]).map((r) => r.saltId === "s2" ? { ...r, ...weak } as SaltRow : r)), cipher: C1() })
    assert.deepEqual((await weakRow.load(U1)).unavailable, [{ saltId: "s2", code: "SALT_INVALID" }], name)
    // 4) versão de chave que o cifrador não conhece
    const noKey = await createPersistentSalts({ store, cipher: mk({ SALT_MASTER_KEY: KEY3 }) }).load(U1)
    assert.deepEqual(noKey.unavailable.map((x) => x.code), ["AUTH_FAILED", "AUTH_FAILED", "AUTH_FAILED"], name) // v1 com chave errada
    const futuro = createPersistentSalts({ store: wrapLoad(store, (_u, rs) => (rs as SaltRow[]).map((r) => r.saltId === "s1" ? { ...r, keyVersion: 7 } : r)), cipher: C1() })
    assert.deepEqual((await futuro.load(U1)).unavailable, [{ saltId: "s1", code: "KEY_VERSION_UNKNOWN" }], name)
    // 5) a linha mais nova ilegível: sem sal atual, NUNCA cai para o s2
    const lastBad = createPersistentSalts({ store: wrapLoad(store, (_u, rs) => (rs as SaltRow[]).map((r) => r.saltId === "s3" ? { ...r, ciphertext: flip(r.ciphertext!, 0) } : r)), cipher: C1() })
    const l5 = await lastBad.load(U1)
    assert.equal(l5.provider.current(U1), null, name)
    assert.deepEqual(l5.provider.known(U1).map((k) => k.saltId), ["s2", "s1"], name)
    assert.deepEqual(good.map((k) => k.saltId), ["s3", "s2", "s1"])
    // 6) disco: lixo no arquivo ⇒ CORRUPT só daquela linha; rotate segue com s4
    if (root !== undefined) {
      writeFileSync(join(root, "salts", U1, "s1.json"), "{não é json")
      const l6 = await createPersistentSalts({ store, cipher: C1() }).load(U1)
      assert.deepEqual(l6.unavailable, [{ saltId: "s1", code: "CORRUPT" }])
      assert.deepEqual(l6.provider.known(U1).map((k) => k.saltId), ["s3", "s2"])
      assert.equal((await createPersistentSalts({ store, cipher: C1() }).rotate(U1)).saltId, "s4")
    }
  })
})

await test("P4 — retire apaga o valor DE VERDADE: a linha vira RETIRED com ciphertext/nonce/keyVersion nulos, e o disco não guarda mais os bytes cifrados", async () => {
  await both(async (store, name, root) => {
    const p = createPersistentSalts({ store, cipher: C1(), now: () => "2026-10-18T12:00:00.000Z" })
    await p.ensure(U1); await p.rotate(U1)
    const s1 = (await rowsOf(store, U1)).find((r) => r.saltId === "s1")!
    const oldCt = Buffer.from(s1.ciphertext!).toString("base64")
    await p.retire(U1, "s1")
    const after = (await rowsOf(store, U1)).find((r) => r.saltId === "s1")!
    assert.deepEqual({ status: after.status, ciphertext: after.ciphertext, nonce: after.nonce, keyVersion: after.keyVersion, retiredAt: after.retiredAt }, { status: "RETIRED", ciphertext: null, nonce: null, keyVersion: null, retiredAt: "2026-10-18T12:00:00.000Z" }, name)
    assert.equal((await rowsOf(store, U1)).find((r) => r.saltId === "s2")!.status, "ACTIVE", name)
    assert.deepEqual((await p.load(U1)).provider.get(U1, "s1"), { status: "RETIRED", saltId: "s1" }, name)
    await p.retire(U1, "s1") // idempotente no store
    if (root !== undefined) for (const f of walk(root)) assert.equal(readFileSync(f).includes(oldCt), false, `${name}: ciphertext antigo ainda no disco`)
  })
})

await test("P5 — último aposentado ⇒ SEM sal atual (E_SALT_NO_CURRENT), como no InMemory; nada cai para um sal mais antigo; rotate é a ação explícita", async () => {
  await both(async (store, name) => {
    const p = createPersistentSalts({ store, cipher: C1() })
    await p.ensure(U1); await p.rotate(U1)
    await store.retire(U1, "s2", "2026-10-18T12:00:00.000Z") // ação direta no store: o último aposentado
    const l = await p.load(U1)
    assert.equal(l.provider.current(U1), null, name)
    assert.deepEqual(l.provider.known(U1).map((k) => k.saltId), ["s1"], name)
    const mem = InMemorySaltKeyring.from([{ userId: U1, saltId: "s1", salt: SALT }, { userId: U1, saltId: "s2", salt: null }])
    assert.equal(mem.current(U1), null)
    assert.equal(await codeOf(async () => mem.ensure(U1)), "E_SALT_NO_CURRENT")
    assert.equal(await codeOf(() => p.ensure(U1)), "E_SALT_NO_CURRENT", name)
    assert.equal((await p.rotate(U1)).saltId, "s3", name)
    assert.equal((await p.load(U1)).provider.current(U1)!.saltId, "s3", name)
  })
})

await test("P6 — concorrência: 8 `ensure` em 2 instâncias ⇒ UM só sal (mesmo saltId e mesmo valor); `rotate` simultâneos nunca repetem saltId", async () => {
  await both(async (store, name) => {
    let oks = 0, dups = 0
    const counted: SaltStore = { ...store, async append(r) { const x = await store.append(r); if (x.ok) oks += 1; else if (x.code === "DUPLICATE") dups += 1; return x } }
    const a = createPersistentSalts({ store: counted, cipher: C1() }), b = createPersistentSalts({ store: counted, cipher: C1() })
    const ids = await Promise.all([a, b, a, b, a, b, a, b].map((x) => x.ensure(U3)))
    assert.deepEqual(new Set(ids.map((i) => i.saltId)), new Set(["s1"]), name)
    assert.equal(oks, 1, `${name}: só UM append pode criar o s1 (os outros veem DUPLICATE e convergem)`)
    assert.equal(dups >= 1, true, `${name}: a corrida precisa ter acontecido de verdade`)
    assert.equal((await rowsOf(store, U3)).length, 1, name)
    const va = (await a.load(U3)).provider.current(U3)!.salt, vb = (await b.load(U3)).provider.current(U3)!.salt
    assert.equal(va, vb, name)
    const settled = await Promise.allSettled([a.rotate(U3), b.rotate(U3), a.rotate(U3)])
    const ok = settled.filter((s) => s.status === "fulfilled").map((s) => (s as Any).value.saltId)
    assert.equal(new Set(ok).size, ok.length, `${name}: saltId repetido`)
    for (const s of settled) if (s.status === "rejected") assert.equal((s.reason as Any).code, "E_SALT_DUPLICATE", name)
    assert.equal(ok.length >= 1, true, name)
    const rows = await rowsOf(store, U3)
    assert.equal(rows.length, 1 + ok.length, name)
    assert.deepEqual(rows.map((r) => r.saltId).sort(), Array.from({ length: rows.length }, (_, i) => `s${i + 1}`), `${name}: cadeia contígua`)
  })
})

// ───────────────────────────── S: segurança ─────────────────────────────
await test("S1 — nenhum byte do store contém o sal em claro (utf8, hex→bytes, base64 de ambos), em ativo, rotacionado, aposentado e recifrado; linhas só têm campos cifrados", async () => {
  await both(async (store, name, root) => {
    const p = createPersistentSalts({ store, cipher: C1() })
    await p.ensure(U1); await p.rotate(U1); await p.rotate(U1); await p.retire(U1, "s1")
    await createPersistentSalts({ store, cipher: C2() }).recipherAll()
    const all = (await createPersistentSalts({ store, cipher: C2() }).load(U1)).provider.known(U1)
    assert.equal(all.length, 2)
    const needles = (s: string): Buffer[] => [Buffer.from(s, "utf8"), Buffer.from(s, "hex"), Buffer.from(Buffer.from(s, "utf8").toString("base64")), Buffer.from(Buffer.from(s, "hex").toString("base64")), Buffer.from(s.slice(0, 32))]
    const hay: Buffer[] = root !== undefined ? walk(root).map((f) => readFileSync(f)) : [Buffer.from(JSON.stringify(await rowsOf(store, U1)))]
    for (const k of all) for (const n of needles(k.salt)) for (const h of hay) assert.equal(h.includes(n), false, `${name}: sal em claro no store`)
    for (const r of await rowsOf(store, U1)) assert.deepEqual(Object.keys(r).sort(), ["ciphertext", "createdAt", "keyVersion", "nonce", "retiredAt", "saltCheck", "saltId", "status", "userId"], name)
    if (root !== undefined) for (const f of walk(root)) assert.equal((statSync(f).mode & 0o077), 0, `${name}: ${f} legível por outros`)
  })
})

await test("S2 — o valor do sal não vaza em JSON.stringify, inspect, String(err), stack, `unavailable`, store, facade, provider nem erros de infra", async () => {
  await both(async (store, name) => {
    const p = createPersistentSalts({ store, cipher: C1() })
    await p.ensure(U1); await p.rotate(U1)
    const l = await p.load(U1)
    const values = l.provider.known(U1).map((k) => k.salt)
    assert.equal(values.length, 2)
    const errs: Any[] = []
    for (const fn of [() => p.retire(U1, "s2"), () => p.retire(U1, "s9"), () => p.ensure(""), () => createPersistentSalts({ store: { ...store, loadUser: async () => saltStoreFailure("STORAGE_ERROR") }, cipher: C1() }).load(U1), () => createPersistentSalts({ store: { ...store, append: async () => saltStoreFailure("STORAGE_ERROR") }, cipher: C1() }).rotate(U1)]) { try { await fn() } catch (e) { errs.push(e) } }
    assert.equal(errs.length, 5, name)
    assert.equal(errs.some((e) => e instanceof SaltStoreError), true, name)
    assert.equal(errs.some((e) => e instanceof SaltError), true, name)
    const bad = await createPersistentSalts({ store: wrapLoad(store, (_u, rs) => (rs as SaltRow[]).map((r) => ({ ...r, ciphertext: flip(r.ciphertext!, 0) }))), cipher: C1() }).load(U1)
    const surfaces: unknown[] = [l, l.provider, l.unavailable, p, store, bad, bad.unavailable, ...errs]
    for (const s of surfaces) {
      const text = JSON.stringify(s) + inspect(s, { depth: 8, showHidden: true }) + String(s) + ((s as Any)?.stack ?? "")
      for (const v of values) assert.equal(text.includes(v), false, `${name}: vazou o sal`)
    }
    for (const e of errs) assert.equal(String(e.message).includes(U1), false, "erro de infra não ecoa o userId")
  })
})

await test("S3 — tripwire: só infra/hash.ts e infra/cipher.ts importam node:crypto nas camadas novas; cifra (createCipheriv) SÓ em cipher.ts; salt.ts não conhece cifra nem store", async () => {
  const importsCrypto = (code: string): boolean => /^\s*import\b[^\n]*from\s+["'](node:)?crypto["']/m.test(code) || /\brequire\(\s*["'](node:)?crypto["']\s*\)/.test(code)
  const lib = join(ROOT, "src", "lib")
  const tsFiles = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tsFiles(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [])
  const offenders: string[] = []
  for (const layer of ["domain", "metrics", "ingest", "evidence", "agent"]) for (const f of tsFiles(join(lib, layer))) if (importsCrypto(readFileSync(f, "utf8"))) offenders.push(f.replace(ROOT, ""))
  for (const f of tsFiles(join(lib, "infra"))) if (importsCrypto(readFileSync(f, "utf8")) && !/infra\/(hash|cipher)\.ts$/.test(f)) offenders.push(f.replace(ROOT, ""))
  assert.deepEqual(offenders, [], "node:crypto fora do lugar")
  const cipherUsers = tsFiles(join(ROOT, "src")).filter((f) => /createCipheriv|createDecipheriv/.test(readFileSync(f, "utf8"))).map((f) => f.replace(ROOT, ""))
  assert.deepEqual(cipherUsers, ["src/lib/infra/cipher.ts"])
  const saltTs = readFileSync(join(lib, "ingest", "salt.ts"), "utf8")
  assert.equal(/cipher|salt-store|node:fs/.test(saltTs.replace(/\/\/.*$/gm, "")), false, "salt.ts permanece puro e síncrono")
  const store = readFileSync(join(lib, "infra", "salt-store.ts"), "utf8")
  assert.equal(/from\s+["'](node:)?crypto["']/.test(store), false)
  // ninguém na pipeline/evidence/agent importa o store nem o cifrador (nada ligado ainda)
  for (const layer of ["ingest", "evidence", "agent", "metrics", "domain"]) for (const f of tsFiles(join(lib, layer))) assert.equal(/infra\/(cipher|salt-store)/.test(readFileSync(f, "utf8")), false, f)
})

await test("S4 — as variáveis (SALT_MASTER_KEY, _VERSION, _PREV_<n>) estão documentadas SEM valor: no doc versionado e, quando existir, no .env.example (ignorado pelo Git)", async () => {
  const doc = readFileSync(join(ROOT, "docs", "ai-partner", "E7-2-chave-mestra.md"), "utf8")
  for (const needle of ["SALT_MASTER_KEY=", "SALT_MASTER_KEY_VERSION=", "SALT_MASTER_KEY_PREV_<n>=", "openssl rand -hex 32", "irrecuperáveis", "recipherAll"]) assert.equal(doc.includes(needle), true, needle)
  const files = [doc]
  try { files.push(readFileSync(join(ROOT, ".env.example"), "utf8")) } catch { /* checkout limpo: .env.example não é versionado */ }
  for (const text of files) {
    for (const m of text.matchAll(/SALT_MASTER_KEY=(\S?)/g)) assert.equal(["", "<", "`", "|"].includes(m[1]), true, `SALT_MASTER_KEY com valor: ${m[0]}`)
    for (const line of text.split("\n").filter((l) => l.includes("SALT_MASTER_KEY"))) assert.equal(/[0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=/.test(line), false, line)
  }
  assert.match(files[files.length - 1], /SALT_MASTER_KEY/)
  assert.equal(generateSalt().length, 64) // sanidade: o gerador do domínio segue o mesmo formato que o store cifra
})

for (const d of TMPS) rmSync(d, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do E7-2 passaram.`)
