// E7-1: `RawFileStorage` (arquivo bruto do usuário, texto UTF-8 exato) — contrato testado contra a implementação de MEMÓRIA e a de DISCO. Escrito ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e7_1 (D-S1…D-S10, C1–C12, D1–D5, S1, RSM1–RSM16).
//   node scripts/test-raw-file-storage.mts
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
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
  { name: "disco", make: () => { const root = mkdtempSync(join(tmpdir(), "raw-file-")); TMPS.push(root); return { s: createDiskRawFileStorage(root), root, done: () => rmSync(root, { recursive: true, force: true }) } } },
]
/** Roda `fn` contra as DUAS implementações (o contrato é o mesmo). */
const both = async (fn: (s: RawFileStorage, name: string, root?: string) => Promise<void>): Promise<void> => {
  for (const impl of IMPLS) { const m = impl.make(); try { await fn(m.s, impl.name, m.root) } finally { m.done() } }
}
const test = async (name: string, fn: () => Promise<void>): Promise<void> => { await fn(); passed += 1; console.log(`✓ ${name}`) }
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

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
console.log(`\n${passed} testes ok`)
