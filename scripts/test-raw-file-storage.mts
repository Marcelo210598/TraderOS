// E7-1: `RawFileStorage` (arquivo bruto do usuário, texto UTF-8 exato) — contrato testado contra a implementação de MEMÓRIA e a de DISCO. Escrito ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e7_1 (D-S1…D-S10, C1–C12, D1–D5, S1, RSM1–RSM16).
// E7-10: a MESMA suíte de contrato (C1–C12) roda também na 3ª implementação (objeto + gzip sobre um ObjectStore em memória) e entram G1–G8 (expectativa e7_10; mutações EO1–EO15).
//   COLLECT=1 só para a análise de mutações.
//   node scripts/test-raw-file-storage.mts
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { newAliasTable } from "../src/lib/agent/label.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { makeContext, registerImport } from "../src/lib/infra/dataset.ts"
import { createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryObjectStore, type ObjectStore } from "../src/lib/infra/object-store.ts"
import { createObjectRawFileStorage } from "../src/lib/infra/raw-file-storage-object.ts"
import { createMemorySaltStore } from "../src/lib/infra/salt-store.ts"
import { purgeUserData } from "../src/lib/infra/user-purge.ts"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
import { synthCsv } from "./_evidence-fixtures.mts"
import { MAX_RAW_FILE_BYTES, createMemoryRawFileStorage, isValidSha256, isValidUserId, rawFileKey, type RawFileStorage } from "../src/lib/infra/raw-file-storage.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex")
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const CSV = "Instrumento;Conta\nMGC 12-26;Sim101\n"
const FAIL = (code: string): Any => ({ ok: false, code })

interface Impl { name: string; make: () => { s: RawFileStorage; root?: string; done: () => void } }
const TMPS: string[] = []
const IMPLS: Impl[] = [
  { name: "memória", make: () => ({ s: createMemoryRawFileStorage(), done: () => {} }) },
  { name: "objeto+gzip", make: () => ({ s: createObjectRawFileStorage(createMemoryObjectStore()), done: () => {} }) },
  { name: "disco", make: () => { const root = mkdtempSync(join(tmpdir(), "raw-file-")); TMPS.push(root); return { s: createDiskRawFileStorage(root), root, done: () => rmSync(root, { recursive: true, force: true }) } } },
]
/** Roda `fn` contra TODAS as implementações (o contrato é o mesmo). */
const both = async (fn: (s: RawFileStorage, name: string, root?: string) => Promise<void>): Promise<void> => {
  for (const impl of IMPLS) { const m = impl.make(); try { await fn(m.s, impl.name, m.root) } finally { m.done() } }
}
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : [])

await test("C1 — IDA E VOLTA nas duas implementações: BOM, CRLF, multibyte UTF-8 e 1 byte ⇒ `get` devolve exatamente os mesmos bytes; sha256(get) == o pedido", async () => {
  await both(async (s, name) => {
    const samples = [enc("﻿" + CSV), enc("a;b\r\nc;d\r\n"), enc("Ação;Preço — R$ 1.234,50;日本語;😀\n"), new Uint8Array([0x41])]
    for (const b of samples) {
      const h = sha(b)
      assert.deepEqual(await s.put(U1, h, b), { ok: true, created: true }, `${name} put`)
      const g: Any = await s.get(U1, h)
      assert.equal(g.ok, true)
      assert.deepEqual([...g.bytes], [...b], `${name} bytes`)
      assert.equal(sha(g.bytes), h)
    }
  })
})

await test("C2 — IDEMPOTÊNCIA: `put` repetida ⇒ created:false e o conteúdo segue igual (nunca sobrescreve)", async () => {
  await both(async (s) => {
    const b = enc(CSV), h = sha(b)
    assert.deepEqual(await s.put(U1, h, b), { ok: true, created: true })
    assert.deepEqual(await s.put(U1, h, b), { ok: true, created: false })
    assert.deepEqual(await s.put(U1, h, new Uint8Array(b)), { ok: true, created: false })
    assert.deepEqual([...((await s.get(U1, h)) as Any).bytes], [...b])
  })
})

await test("C3 — HASH DIVERGENTE ⇒ HASH_MISMATCH e NADA fica guardado (get ⇒ NOT_FOUND)", async () => {
  await both(async (s) => {
    const b = enc(CSV), other = sha(enc("outro conteúdo"))
    assert.deepEqual(await s.put(U1, other, b), FAIL("HASH_MISMATCH"))
    assert.deepEqual(await s.get(U1, other), FAIL("NOT_FOUND"))
    assert.deepEqual(await s.get(U1, sha(b)), FAIL("NOT_FOUND"))
  })
})

await test("C4 — INVÁLIDOS ⇒ INVALID_ARGS, resultado EXATAMENTE {ok:false, code} e o JSON não contém o valor recusado (userId, sha, bytes)", async () => {
  await both(async (s) => {
    const b = enc(CSV), h = sha(b)
    const badUsers = ["", "..", ".", "../x", "a/b", "a\\b", "a\0b", "x".repeat(65), "usuário", "a b", "a.b", "a:b", 5, null, undefined, {}, ["a"]]
    for (const u of badUsers) {
      for (const r of [await s.put(u as Any, h, b), await s.get(u as Any, h), await s.delete(u as Any, h), await s.deleteAllForUser(u as Any)] as Any[]) {
        assert.deepEqual(r, FAIL("INVALID_ARGS"), `userId ${JSON.stringify(u)}`)
        assert.deepEqual(Object.keys(r).sort(), ["code", "ok"])
        if (typeof u === "string" && u.length > 2) assert.equal(JSON.stringify(r).includes(u), false, "ecoou o userId")
      }
    }
    const badShas = [h.toUpperCase(), h.slice(0, 63), h + "0", "../..", "z".repeat(64), "", 7, null, undefined]
    for (const x of badShas) for (const r of [await s.put(U1, x as Any, b), await s.get(U1, x as Any), await s.delete(U1, x as Any)] as Any[]) { assert.deepEqual(r, FAIL("INVALID_ARGS"), `sha ${JSON.stringify(x)}`); if (typeof x === "string" && x.length > 2) assert.equal(JSON.stringify(r).includes(x), false) }
    const badBytes = ["texto", 5, null, undefined, {}, [1, 2, 3], new Uint8Array(0), new ArrayBuffer(8)]
    for (const x of badBytes) assert.deepEqual(await s.put(U1, h, x as Any), FAIL("INVALID_ARGS"), `bytes ${String(x)}`)
  })
})

await test("C5 — TETO: 25 MiB + 1 ⇒ TOO_LARGE; exatamente 25 MiB ⇒ ok", async () => {
  assert.equal(MAX_RAW_FILE_BYTES, 25 * 1024 * 1024)
  await both(async (s) => {
    const big = new Uint8Array(MAX_RAW_FILE_BYTES + 1).fill(7)
    assert.deepEqual(await s.put(U1, sha(big), big), FAIL("TOO_LARGE"))
    const exact = new Uint8Array(MAX_RAW_FILE_BYTES).fill(7)
    const h = sha(exact)
    assert.deepEqual(await s.put(U1, h, exact), { ok: true, created: true })
    assert.equal(((await s.get(U1, h)) as Any).bytes.length, MAX_RAW_FILE_BYTES)
  })
})

await test("C6 — ISOLAMENTO: o arquivo do usuário A (mesmo sha) é NOT_FOUND para B; `put` de B não altera o de A", async () => {
  await both(async (s) => {
    const b = enc(CSV), h = sha(b)
    assert.equal((await s.put(U1, h, b)).ok, true)
    assert.deepEqual(await s.get(U2, h), FAIL("NOT_FOUND"))
    assert.deepEqual(await s.put(U2, h, b), { ok: true, created: true })
    assert.deepEqual(await s.delete(U2, h), { ok: true, existed: true })
    assert.equal(((await s.get(U1, h)) as Any).ok, true, "A segue intacto")
  })
})

await test("C7 — AUSENTE: `get` ⇒ NOT_FOUND; `delete` ⇒ ok com existed:false", async () => {
  await both(async (s) => {
    const h = sha(enc("nada"))
    assert.deepEqual(await s.get(U1, h), FAIL("NOT_FOUND"))
    assert.deepEqual(await s.delete(U1, h), { ok: true, existed: false })
  })
})

await test("C8 — `delete` ⇒ `get` NOT_FOUND ⇒ novo `put` funciona (created:true)", async () => {
  await both(async (s) => {
    const b = enc(CSV), h = sha(b)
    await s.put(U1, h, b)
    assert.deepEqual(await s.delete(U1, h), { ok: true, existed: true })
    assert.deepEqual(await s.get(U1, h), FAIL("NOT_FOUND"))
    assert.deepEqual(await s.put(U1, h, b), { ok: true, created: true })
  })
})

await test("C9 — `deleteAllForUser`: conta certa, idempotente (2ª ⇒ 0), só do usuário; 'abc' não apaga 'abcd' (prefixo)", async () => {
  await both(async (s) => {
    const a = enc("A"), b = enc("B"), c = enc("C")
    for (const [u, x] of [["abc", a], ["abc", b], ["abcd", c], [U2, a]] as Array<[string, Uint8Array]>) assert.equal((await s.put(u, sha(x), x)).ok, true)
    assert.deepEqual(await s.deleteAllForUser("abc"), { ok: true, deleted: 2 })
    assert.deepEqual(await s.deleteAllForUser("abc"), { ok: true, deleted: 0 })
    assert.equal(((await s.get("abcd", sha(c))) as Any).ok, true, "abcd intacto")
    assert.equal(((await s.get(U2, sha(a))) as Any).ok, true, "outro usuário intacto")
    assert.deepEqual(await s.get("abc", sha(a)), FAIL("NOT_FOUND"))
    assert.deepEqual(await s.deleteAllForUser("ninguem"), { ok: true, deleted: 0 })
  })
})

await test("C10 — SEM ALIASING: mutar o array passado ao `put` e o devolvido pelo `get` não muda o armazenado", async () => {
  await both(async (s) => {
    const b = enc(CSV), h = sha(b), original = [...b]
    await s.put(U1, h, b)
    b.fill(0) // muta o que foi passado
    const g1: Any = await s.get(U1, h)
    assert.deepEqual([...g1.bytes], original, "o armazenado não pode depender do array de entrada")
    g1.bytes.fill(9) // muta o que foi devolvido
    const g2: Any = await s.get(U1, h)
    assert.deepEqual([...g2.bytes], original, "o armazenado não pode depender do array devolvido")
    assert.notEqual(g1.bytes, g2.bytes)
  })
})

await test("C11 — NUNCA REJEITA NEM LANÇA e nenhum resultado revela caminho/valor: bytes hostis (Proxy que lança, getter que lança) e ids exóticos ⇒ INVALID_ARGS", async () => {
  await both(async (s) => {
    const h = sha(enc(CSV))
    const hostileBytes = new Proxy(new Uint8Array(4), { get() { throw new Error("segredo-do-proxy /etc/passwd") }, has() { throw new Error("segredo-do-proxy") }, getPrototypeOf() { throw new Error("segredo-do-proxy") } })
    const getterObj = { get length(): number { throw new Error("segredo-do-getter") } }
    const hostileId = { toString() { throw new Error("segredo-do-id") } }
    for (const bad of [hostileBytes, getterObj]) {
      const r = await s.put(U1, h, bad as Any)
      assert.deepEqual(r, FAIL("INVALID_ARGS"))
      assert.equal(JSON.stringify(r).includes("segredo"), false)
    }
    for (const r of [await s.get(hostileId as Any, h), await s.put(hostileId as Any, h, enc(CSV)), await s.deleteAllForUser(hostileId as Any)] as Any[]) assert.deepEqual(r, FAIL("INVALID_ARGS"))
  })
})

await test("C12 — `rawFileKey`: exatamente users/{userId}/imports/{sha}.csv; PROPRIEDADE (5.000 ids/shas aleatórios com '.', '/', '\\', NUL, unicode): se a validação aceita, o caminho não tem '..', '//' nem sai de users/{userId}/imports/", async () => {
  const h = sha(enc("x"))
  assert.equal(rawFileKey(U1, h), `users/${U1}/imports/${h}.csv`)
  assert.equal(rawFileKey("../x", h), null)
  assert.equal(rawFileKey(U1, h.toUpperCase()), null)
  let seed = 20261016
  const rnd = (n: number): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n) }
  const ALPHA = ["a", "b", "Z", "0", "9", "-", "_", ".", "/", "\\", "\0", "é", "日", " ", "~", ":"]
  const VALID = ["a", "b", "Z", "0", "9", "-", "_", "x", "Q"]
  const SHA_ALPHA = ["0", "9", "a", "f", "A", "g", ".", "/", "z", "-"]
  let accepted = 0
  for (let i = 0; i < 5000; i++) {
    // metade dos ids: só caracteres válidos (com 1 caractere hostil enfiado numa posição aleatória em 1 de cada 3); a outra metade: alfabeto hostil puro
    const baseId = Array.from({ length: 1 + rnd(66) }, () => VALID[rnd(VALID.length)])
    if (rnd(3) === 0) baseId[rnd(baseId.length)] = ALPHA[rnd(ALPHA.length)]
    const u = rnd(2) === 0 ? baseId.join("") : Array.from({ length: rnd(70) }, () => ALPHA[rnd(ALPHA.length)]).join("")
    const x = rnd(4) === 0 ? Array.from({ length: 64 }, () => SHA_ALPHA[rnd(SHA_ALPHA.length)]).join("") : sha(enc(String(i)))
    const k = rawFileKey(u, x)
    assert.equal(k !== null, isValidUserId(u) && isValidSha256(x), `consistência (${JSON.stringify(u)})`)
    if (k === null) continue
    accepted++
    assert.equal(k, `users/${u}/imports/${x}.csv`)
    const parts = k.split("/")
    assert.equal(parts.length, 4)
    assert.ok(parts.every((p) => p !== "" && p !== "." && p !== ".."), `segmento perigoso em ${k}`)
    assert.equal(parts[1], u)
    assert.equal(k.includes("\\") || k.includes("\0"), false)
  }
  assert.ok(accepted > 1000, `a propriedade precisa aceitar ids suficientes (medido 1562 de 5000; aceitou ${accepted})`)
})

// ── DISCO ──
const mkRoot = (): string => { const r = mkdtempSync(join(tmpdir(), "raw-file-")); TMPS.push(r); return r }
const modeOf = (p: string): string => (statSync(p).mode & 0o777).toString(8)

await test("D1 — LAYOUT EM DISCO: root/users/{u}/imports/{sha}.csv com modo 0600, diretórios 0700 e conteúdo == bytes", async () => {
  const root = mkRoot(); const s = createDiskRawFileStorage(root)
  const b = enc(CSV), h = sha(b)
  assert.equal((await s.put(U1, h, b)).ok, true)
  const file = join(root, "users", U1, "imports", `${h}.csv`)
  assert.deepEqual([...readFileSync(file)], [...b])
  assert.equal(modeOf(file), "600")
  for (const d of [join(root, "users"), join(root, "users", U1), join(root, "users", U1, "imports")]) assert.equal(modeOf(d), "700", d.replace(root, ""))
  assert.deepEqual(files(join(root, "users", U1, "imports")), [`${h}.csv`], "nenhum temporário sobrou")
})

await test("D2 — ATOMICIDADE E CORRIDA: falha injetada entre o temporário e o arquivo final ⇒ nada final e nada sobra; 20 `put` simultâneos ⇒ 1 arquivo, todas ok, 1 só com created:true", async () => {
  const b = enc(CSV), h = sha(b)
  const r1 = mkRoot()
  const sLink = createDiskRawFileStorage(r1, { link: async () => { throw new Error("boom /segredo/caminho") } })
  const out = await sLink.put(U1, h, b)
  assert.deepEqual(out, FAIL("STORAGE_ERROR"))
  assert.equal(JSON.stringify(out).includes("boom") || JSON.stringify(out).includes(r1), false)
  assert.deepEqual(files(join(r1, "users", U1, "imports")), [], "não pode sobrar temporário nem arquivo final")
  const r2 = mkRoot()
  const sFull = createDiskRawFileStorage(r2, { writeFile: async () => { const e: Any = new Error("sem espaço"); e.code = "ENOSPC"; throw e } })
  assert.deepEqual(await sFull.put(U1, h, b), FAIL("STORAGE_ERROR"))
  assert.deepEqual(files(join(r2, "users", U1, "imports")), [])
  const r3 = mkRoot(); const s = createDiskRawFileStorage(r3)
  const res: Any[] = await Promise.all(Array.from({ length: 20 }, () => s.put(U1, h, b)))
  assert.ok(res.every((r) => r.ok === true))
  assert.equal(res.filter((r) => r.created === true).length, 1)
  assert.deepEqual(files(join(r3, "users", U1, "imports")), [`${h}.csv`])
})

await test("D3 — CORRUPÇÃO: arquivo sobrescrito ou truncado ⇒ `get` ⇒ CORRUPT (nunca os bytes ruins) e o arquivo NÃO é apagado; `put` do mesmo conteúdo sobre um corrompido ⇒ CORRUPT (não sobrescreve em silêncio)", async () => {
  const root = mkRoot(); const s = createDiskRawFileStorage(root)
  const b = enc(CSV), h = sha(b)
  await s.put(U1, h, b)
  const file = join(root, "users", U1, "imports", `${h}.csv`)
  writeFileSync(file, "conteúdo adulterado")
  assert.deepEqual(await s.get(U1, h), FAIL("CORRUPT"))
  assert.equal(existsSync(file), true)
  assert.equal(readFileSync(file, "utf8"), "conteúdo adulterado", "não pode apagar nem consertar sozinho")
  assert.deepEqual(await s.put(U1, h, b), FAIL("CORRUPT"))
  assert.equal(readFileSync(file, "utf8"), "conteúdo adulterado")
  await s.delete(U1, h)
  await s.put(U1, h, b)
  truncateSync(file, 5)
  assert.deepEqual(await s.get(U1, h), FAIL("CORRUPT"))
})

await test("D4 — SYMLINK: `users/{u}` ou `imports` como symlink para fora da raiz ⇒ STORAGE_ERROR em put/get/delete/deleteAll e NADA é escrito/lido/apagado fora da raiz", async () => {
  const b = enc(CSV), h = sha(b)
  for (const variant of ["user", "imports"]) {
    const root = mkRoot(), outside = mkRoot()
    writeFileSync(join(outside, "intocado.txt"), "não mexer")
    mkdirSync(join(root, "users"), { recursive: true })
    if (variant === "user") symlinkSync(outside, join(root, "users", U1))
    else { mkdirSync(join(root, "users", U1)); symlinkSync(outside, join(root, "users", U1, "imports")) }
    const s = createDiskRawFileStorage(root)
    for (const r of [await s.put(U1, h, b), await s.get(U1, h), await s.delete(U1, h), await s.deleteAllForUser(U1)] as Any[]) assert.deepEqual(r, FAIL("STORAGE_ERROR"), variant)
    assert.deepEqual(files(outside), ["intocado.txt"], `${variant}: algo mexeu fora da raiz`)
    assert.equal(readFileSync(join(outside, "intocado.txt"), "utf8"), "não mexer")
    assert.equal(lstatSync(join(root, "users", U1)).isSymbolicLink() || variant === "imports", true)
  }
})

await test("D5 — RAIZ: relativa ⇒ TypeError na criação; raiz inexistente é criada com 0700 (o disco cheio simulado está no D2)", async () => {
  assert.throws(() => createDiskRawFileStorage("relativo/x"), TypeError)
  assert.throws(() => createDiskRawFileStorage(""), TypeError)
  const base = mkRoot(); const root = join(base, "novo", "raiz")
  const s = createDiskRawFileStorage(root)
  const b = enc(CSV), h = sha(b)
  assert.equal((await s.put(U1, h, b)).ok, true)
  assert.equal(modeOf(root), "700")
  assert.equal(modeOf(join(root, "users")), "700")
  assert.equal(((await s.get(U1, h)) as Any).ok, true)
})

await test("S1 — ESTÁTICA: raw-file-storage.ts importa só ./hash.ts e não cita node:fs/node:crypto; o disco importa só node:fs/promises, node:path, ./hash.ts, ./raw-file-storage.ts e não cita node:crypto; nada em src/lib/{agent,agent-capabilities,evidence,metrics,ingest,domain} importa o storage; o schema do Prisma não tem ImportSource", async () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const mem = read("src/lib/infra/raw-file-storage.ts")
  assert.deepEqual(importsOf(mem).sort(), ["./hash.ts"])
  assert.equal(/node:fs|node:crypto|from "fs"|from "crypto"/.test(mem), false)
  const disk = read("src/lib/infra/raw-file-storage-disk.ts")
  assert.deepEqual(importsOf(disk).sort(), ["./hash.ts", "./raw-file-storage.ts", "node:fs/promises", "node:path"])
  assert.equal(/node:crypto|from "crypto"/.test(disk), false)
  for (const dir of ["agent", "agent-capabilities", "evidence", "metrics", "ingest", "domain"]) {
    for (const f of readdirSync(`${ROOT}src/lib/${dir}`).filter((x) => x.endsWith(".ts"))) assert.equal(/raw-file-storage/.test(read(`src/lib/${dir}/${f}`)), false, `${dir}/${f} importa o storage`)
  }
  assert.equal(/model\s+ImportSource\b/.test(readFileSync(`${ROOT}prisma/schema.prisma`, "utf8")), false, "o rascunho do ImportSource fica no doc, não no schema")
})

// ───────────────────────────── OBJETO + GZIP (E7-10) ─────────────────────────────
const MAXB = MAX_RAW_FILE_BYTES
const BIG_CSV = "Instrumento;Conta;Preco\n" + "MGC 12-26;Sim101;2000.50\n".repeat(4000)
const objKey = (u: string, h: string): string => `users/${u}/imports/${h}.csv.gz`
const mkObj = (): { s: RawFileStorage; store: ReturnType<typeof createMemoryObjectStore> } => { const store = createMemoryObjectStore(); return { s: createObjectRawFileStorage(store), store } }
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex")
const getRaw = async (store: ObjectStore, key: string): Promise<Uint8Array> => { const r: Any = await store.get(key); assert.equal(r.ok, true, `objeto ${key}`); return r.bytes }
const plant = async (store: ObjectStore, key: string, bytes: Uint8Array): Promise<void> => { await store.delete(key); const r: Any = await store.putIfAbsent(key, bytes); assert.equal(r.ok, true) }

await test("G1 — LAYOUT E COMPRESSÃO: o objeto fica em users/{u}/imports/{sha}.csv.gz, é gzip (1f 8b), MENOR que o CSV repetitivo, gunzip == bytes; nenhuma chave fora desse molde", async () => {
  const { s, store } = mkObj(); const b = enc(BIG_CSV), h = sha(b), b2 = enc(CSV)
  assert.deepEqual(await s.put(U1, h, b), { ok: true, created: true }); assert.equal((await s.put(U2, sha(b2), b2)).ok, true)
  assert.deepEqual(store.keys().sort(), [objKey(U1, h), objKey(U2, sha(b2))].sort())
  for (const k of store.keys()) assert.match(k, /^users\/[A-Za-z0-9_-]{1,64}\/imports\/[0-9a-f]{64}\.csv\.gz$/)
  const raw = await getRaw(store, objKey(U1, h))
  assert.deepEqual([raw[0], raw[1]], [0x1f, 0x8b], "gzip")
  assert.ok(raw.length < b.length / 2, `comprimido (${raw.length}) deveria ser bem menor que o original (${b.length})`)
  assert.deepEqual([...gunzipSync(raw)], [...b])
  assert.deepEqual([...(((await s.get(U1, h)) as Any).bytes as Uint8Array)], [...b])
  // a porta em memória também não tem aliasing (nem na entrada, nem na saída)
  const mine = enc("xyz"); assert.deepEqual(await store.putIfAbsent("k/1", mine), { ok: true, created: true }); mine.fill(0)
  const g1: Any = await store.get("k/1"); assert.equal(new TextDecoder().decode(g1.bytes), "xyz"); g1.bytes.fill(1)
  assert.equal(new TextDecoder().decode(((await store.get("k/1")) as Any).bytes), "xyz")
})

/** Resumo curto do resultado (nunca imprime 25 MiB num diff de asserção). */
const brief = (r: Any): string => (r.ok ? `OK(${r.bytes?.length ?? "?"} bytes)` : r.code)

await test("G2 — GZIP BOMB: objeto de sha VÁLIDO que descomprime acima de 25 MiB ⇒ get CORRUPT (nunca os bytes); exatamente 25 MiB ⇒ ok", async () => {
  const { s, store } = mkObj()
  const over = new Uint8Array(MAXB + 1).fill(7), hOver = sha(over)
  await plant(store, objKey(U1, hOver), gzipSync(over))
  assert.equal(brief(await s.get(U1, hOver)), "CORRUPT", "o sha confere, mas a saída passa do teto")
  const huge = new Uint8Array(200 * 1024 * 1024), hHuge = sha(huge)
  await plant(store, objKey(U1, hHuge), gzipSync(huge))
  assert.equal(brief(await s.get(U1, hHuge)), "CORRUPT", "200 MiB descomprimidos")
  const exact = new Uint8Array(MAXB).fill(3), hExact = sha(exact)
  assert.equal((await s.put(U1, hExact, exact)).ok, true)
  const g: Any = await s.get(U1, hExact); assert.equal(g.ok, true); assert.equal(g.bytes.length, MAXB)
})

await test("G3 — CORRUPÇÃO: outro gzip válido, lixo e truncado ⇒ get CORRUPT; put do mesmo conteúdo sobre o corrompido ⇒ CORRUPT; o objeto NÃO é apagado nem sobrescrito", async () => {
  const { s, store } = mkObj(); const b = enc(BIG_CSV), h = sha(b); const key = objKey(U1, h)
  assert.equal((await s.put(U1, h, b)).ok, true); const good = await getRaw(store, key)
  const variants: Array<[string, Uint8Array]> = [["outro gzip válido", gzipSync(enc("outro conteúdo"))], ["lixo", enc("isto não é gzip")], ["truncado", good.slice(0, Math.floor(good.length / 2))], ["vazio", new Uint8Array(1)]]
  for (const [why, bad] of variants) {
    await plant(store, key, bad)
    assert.deepEqual(await s.get(U1, h), FAIL("CORRUPT"), why)
    assert.deepEqual(await s.put(U1, h, b), FAIL("CORRUPT"), `${why}: put não conserta em silêncio`)
    assert.equal(hex(await getRaw(store, key)), hex(bad), `${why}: o objeto segue como estava`)
  }
  await plant(store, key, good); assert.equal(((await s.get(U1, h)) as Any).ok, true, "íntegro volta a ler")
  assert.deepEqual(await s.put(U1, h, b), { ok: true, created: false })
})

await test("G4 — FALHAS DO STORE: cada método da porta rejeitando, lançando, devolvendo forma inesperada ou código desconhecido ⇒ STORAGE_ERROR, sem eco do marcador e sem lançar", async () => {
  const b = enc(CSV), h = sha(b)
  const modes: Array<[string, () => unknown]> = [["rejeita", () => Promise.reject(new Error("SEGREDO-DA-NUVEM /chave"))], ["lança", () => { throw new Error("SEGREDO-DA-NUVEM /chave") }], ["forma estranha", () => ({ ok: "sim" })], ["null", () => null], ["código desconhecido", () => ({ ok: false, code: "SEGREDO-DA-NUVEM" })]]
  for (const method of ["putIfAbsent", "get", "delete", "deleteByPrefix"] as const) {
    for (const [mode, fault] of modes) {
      const base = createMemoryObjectStore(); await base.putIfAbsent(objKey(U1, h), gzipSync(b)) // existe: put chega ao get; delete/deleteAll têm o que apagar
      const faulty: Any = { putIfAbsent: base.putIfAbsent.bind(base), get: base.get.bind(base), delete: base.delete.bind(base), deleteByPrefix: base.deleteByPrefix.bind(base), [method]: fault }
      const s = createObjectRawFileStorage(faulty as ObjectStore)
      const calls: Array<[string, () => Promise<unknown>]> = []
      if (method === "putIfAbsent") calls.push(["put (novo)", () => s.put(U1, sha(enc("novo")), enc("novo"))])
      if (method === "get") { calls.push(["get", () => s.get(U1, h)]); calls.push(["put (existente)", () => s.put(U1, h, b)]) }
      if (method === "delete") calls.push(["delete", () => s.delete(U1, h)])
      if (method === "deleteByPrefix") calls.push(["deleteAll", () => s.deleteAllForUser(U1)])
      for (const [what, call] of calls) {
        let r: unknown; try { r = await call() } catch { assert.fail(`${method}/${mode}/${what}: lançou`) }
        assert.deepEqual(r, FAIL("STORAGE_ERROR"), `${method}/${mode}/${what}`)
        assert.equal(JSON.stringify(r).includes("SEGREDO"), false)
      }
    }
  }
})

await test("G5 — CONCORRÊNCIA: 20 put simultâneos do mesmo conteúdo ⇒ 1 objeto, todos ok, exatamente 1 com created:true", async () => {
  const { s, store } = mkObj(); const b = enc(BIG_CSV), h = sha(b)
  const rs: Any[] = await Promise.all(Array.from({ length: 20 }, () => s.put(U1, h, b)))
  assert.equal(rs.every((r) => r.ok), true); assert.equal(rs.filter((r) => r.created).length, 1)
  assert.equal(store.keys().length, 1)
})

await test("G6 — PREFIXO: 'abc' × 'abcd': deleteAllForUser('abc') conta certo e deixa os outros usuários byte a byte iguais", async () => {
  const { s, store } = mkObj(); const a = enc("A"), b = enc("B"), c = enc("C")
  for (const [u, x] of [["abc", a], ["abc", b], ["abcd", c], [U2, a]] as Array<[string, Uint8Array]>) assert.equal((await s.put(u, sha(x), x)).ok, true)
  const snap = async (): Promise<string> => { const out: string[] = []; for (const k of store.keys().sort()) if (!k.startsWith("users/abc/")) out.push(`${k}=${hex(await getRaw(store, k))}`); return out.join("\n") }
  const before = await snap()
  assert.deepEqual(await s.deleteAllForUser("abc"), { ok: true, deleted: 2 }); assert.deepEqual(await s.deleteAllForUser("abc"), { ok: true, deleted: 0 })
  assert.equal(await snap(), before); assert.equal(store.keys().some((k) => k.startsWith("users/abc/")), false)
})

await test("G7 — ESTÁTICA: object-store.ts não importa nada; o adaptador importa só node:zlib, ./hash.ts, ./raw-file-storage.ts e ./object-store.ts, sem fetch/env/aws/s3/cloudflare; só ele importa a porta; nada fora de infra/ importa nenhum dos dois", async () => {
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const port = read("src/lib/infra/object-store.ts"), ad = read("src/lib/infra/raw-file-storage-object.ts")
  assert.deepEqual(importsOf(port), [])
  assert.deepEqual(importsOf(ad).sort(), ["./hash.ts", "./object-store.ts", "./raw-file-storage.ts", "node:zlib"])
  for (const [n, code] of [["porta", port], ["adaptador", ad]]) assert.equal(/\bfetch\s*\(|process\.env|\b(aws|s3|cloudflare|r2)\b|node:(fs|net|http|https|crypto)/i.test(code), false, `${n}: dependência proibida`)
  const infra = readdirSync(`${ROOT}src/lib/infra`).filter((f) => f.endsWith(".ts"))
  assert.deepEqual(infra.filter((f) => /object-store/.test(read(`src/lib/infra/${f}`))), ["raw-file-storage-object.ts"])
  for (const dir of ["agent", "agent-capabilities", "evidence", "metrics", "ingest", "domain"]) for (const f of readdirSync(`${ROOT}src/lib/${dir}`).filter((x) => x.endsWith(".ts"))) assert.equal(/object-store|raw-file-storage-object/.test(read(`src/lib/${dir}/${f}`)), false, `${dir}/${f}`)
})

await test("G8 — PONTA A PONTA: registerImport + makeContext + metrics.query sobre o adaptador dão o MESMO resultado que sobre a memória pura; purgeUserData apaga os objetos", async () => {
  const p2 = (x: number): string => String(x).padStart(2, "0")
  const text = synthCsv(Array.from({ length: 80 }, (_, i) => ({ entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: i % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
  const kr = new InMemorySaltKeyring(); kr.ensure(U1)
  const objStore = createMemoryObjectStore()
  const variants = [["memória", createMemoryRawFileStorage()], ["objeto+gzip", createObjectRawFileStorage(objStore)]] as const
  const results: string[] = []
  const importStores = variants.map(() => createMemoryImportSourceStore())
  for (const [i, [name, rawStorage]] of variants.entries()) {
    const deps: Any = { rawStorage, importStore: importStores[i], salt: kr }
    const reg: Any = await registerImport(deps, { userId: U1, text, context: { sourceTz: "America/New_York" }, fileName: "export.csv" }); assert.equal(reg.ok, true, `${name}: ${reg.code}`)
    const made: Any = await makeContext(deps, { userId: U1, pin: { sources: [{ fileSha256: reg.fileSha256 }], analysis: {} } }); assert.equal(made.ok, true, `${name}: ${made.code}`)
    const out: Any = metricsQuery({ metricIds: ["netPnl", "winRate"], filters: {}, options: {} }, { ...made.ctx, aliases: newAliasTable(made.ctx.refEpoch) })
    assert.equal(out.result.ok, true, name); results.push(JSON.stringify(out.result))
  }
  assert.equal(results[0], results[1], "o resultado (inclusive o evidenceRef) não depende de o arquivo estar comprimido no repouso")
  assert.equal(objStore.keys().length, 1)
  const purge: Any = await purgeUserData({ rawStorage: variants[1][1], importStore: importStores[1], conversationStore: createMemoryConversationStore(), saltStore: createMemorySaltStore() } as Any, { userId: U1 })
  assert.equal(purge.ok, true, JSON.stringify(purge)); assert.equal(purge.purged.rawFiles, 1); assert.equal(objStore.keys().length, 0)
})

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes ok`)
