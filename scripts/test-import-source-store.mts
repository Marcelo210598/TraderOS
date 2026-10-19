// E7-4: ImportSourceStore (infra/import-source-store.ts) — metadados por (userId, fileSha256): importId, fileName, contexto do usuário, tamanho/BOM/EOL.
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_4 (D-B3; T1–T5, S1; mutações DM8, DM9, DM11).
//   node scripts/test-import-source-store.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDiskImportSourceStore, createMemoryImportSourceStore, importSourceFailure, type ImportSourceStore } from "../src/lib/infra/import-source-store.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const SHA = (c: string): string => c.repeat(64)
const row = (o: Any = {}): Any => ({
  userId: U1, fileSha256: SHA("a"), importId: "imp_47e005e7aabbccdd", fileName: "meu-export.csv", fileBytes: 1234, hasBom: false, lineEnding: "CRLF", hashBasis: "UTF8_TEXT",
  context: { sourceTz: "America/Sao_Paulo", dateOrder: "DMY", numberLocale: "BR", excursionUnit: "USD_TOTAL", declaredPnlBasis: "UNKNOWN", foldPolicy: "EARLIER", reconstructCycles: true, exitReasonMap: [{ pattern: "^alvo", reason: "TARGET" }] },
  createdAt: "2026-10-19T12:00:00.000Z", ...o,
})
const TMPS: string[] = []
interface Impl { name: string; make: () => { store: ImportSourceStore; root?: string } }
const IMPLS: Impl[] = [
  { name: "memória", make: () => ({ store: createMemoryImportSourceStore() }) },
  { name: "disco", make: () => { const root = mkdtempSync(join(tmpdir(), "import-src-")); TMPS.push(root); return { store: createDiskImportSourceStore(root), root } } },
]
const both = async (fn: (store: ImportSourceStore, name: string, root?: string) => Promise<void>): Promise<void> => { for (const impl of IMPLS) { const m = impl.make(); await fn(m.store, impl.name, m.root) } }
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

await test("T1 — ida e volta (memória e disco): put cria, get devolve a MESMA linha em cópia (mexer no retorno ou na entrada depois do put não altera o guardado)", async () => {
  await both(async (store, name) => {
    const input = row()
    assert.deepEqual(await store.put(input), { ok: true, created: true }, name)
    input.context.sourceTz = "UTC"; input.fileName = "mudou.csv"
    const got: Any = await store.get(U1, SHA("a"))
    assert.equal(got.ok, true, name)
    assert.deepEqual(got.row, row(), name)
    got.row.context.exitReasonMap.push({ pattern: "x", reason: "STOP" }); got.row.fileName = "hack"
    assert.deepEqual(((await store.get(U1, SHA("a"))) as Any).row, row(), `${name}: cópia defensiva`)
    for (const variant of [row({ fileSha256: SHA("b"), fileName: null, hasBom: true, lineEnding: "MIXED", context: {} }), row({ fileSha256: SHA("c"), context: { sourceTz: null, excursionUnit: null } })]) {
      assert.equal(((await store.put(variant)) as Any).ok, true, name)
      assert.deepEqual(((await store.get(U1, variant.fileSha256)) as Any).row, variant, name)
    }
  })
})

await test("T2 — put idempotente: mesma linha ⇒ created:false (createdAt original preservado); contexto/importId/fileName diferentes na MESMA chave ⇒ CONFLICT e nada é sobrescrito", async () => {
  await both(async (store, name) => {
    await store.put(row())
    assert.deepEqual(await store.put(row({ createdAt: "2027-01-01T00:00:00.000Z" })), { ok: true, created: false }, name)
    assert.equal(((await store.get(U1, SHA("a"))) as Any).row.createdAt, "2026-10-19T12:00:00.000Z", name)
    const diffs: Array<[string, Any]> = [
      ["sourceTz", row({ context: { ...row().context, sourceTz: "UTC" } })], ["foldPolicy", row({ context: { ...row().context, foldPolicy: "LATER" } })], ["exitReasonMap", row({ context: { ...row().context, exitReasonMap: [] } })],
      ["context vazio", row({ context: {} })], ["importId", row({ importId: "imp_00000000aabbccdd" })], ["fileName", row({ fileName: "outro.csv" })], ["fileName null", row({ fileName: null })], ["fileBytes", row({ fileBytes: 1 })], ["hasBom", row({ hasBom: true })],
    ]
    for (const [why, r] of diffs) assert.deepEqual(await store.put(r), importSourceFailure("CONFLICT"), `${name}: ${why}`)
    assert.deepEqual(((await store.get(U1, SHA("a"))) as Any).row, row(), `${name}: o original segue intacto`)
  })
})

await test("T3 — isolamento: outro usuário não vê (NOT_FOUND) e grava a SUA linha na mesma chave sem conflito; ids inválidos ⇒ INVALID_ARGS", async () => {
  await both(async (store, name) => {
    await store.put(row())
    assert.deepEqual(await store.get(U2, SHA("a")), importSourceFailure("NOT_FOUND"), name)
    assert.deepEqual(await store.get(U1, SHA("b")), importSourceFailure("NOT_FOUND"), name)
    assert.deepEqual(await store.put(row({ userId: U2, context: { sourceTz: "UTC" } })), { ok: true, created: true }, name)
    assert.equal(((await store.get(U2, SHA("a"))) as Any).row.context.sourceTz, "UTC", name)
    assert.equal(((await store.get(U1, SHA("a"))) as Any).row.context.sourceTz, "America/Sao_Paulo", name)
    for (const [u, s] of [["", SHA("a")], ["../x", SHA("a")], ["a/b", SHA("a")], [U1, "A".repeat(64)], [U1, "a".repeat(63)], [U1, ""], [null, SHA("a")], [U1, undefined]] as Any[]) assert.deepEqual(await store.get(u, s), importSourceFailure("INVALID_ARGS"), `${name}: ${String(u)}/${String(s)}`)
  })
})

await test("T4 — linha inválida ⇒ INVALID_ARGS e NADA gravado: chave extra, sha/importId/userId malformados, sal/provider/fileHash no contexto, não-JSON, exitReasonMap inválido, tamanhos absurdos", async () => {
  await both(async (store, name) => {
    const ctx = (extra: Any): Any => ({ ...row().context, ...extra })
    const bad: Array<[string, Any]> = [
      ["chave extra na linha", { ...row(), extra: 1 }], ["sem createdAt", (({ createdAt: _omit, ...r }) => (void _omit, r))(row())], ["createdAt inválido", row({ createdAt: "ontem" })], ["sha curto", row({ fileSha256: "a".repeat(10) })], ["sha maiúsculo", row({ fileSha256: "A".repeat(64) })],
      ["importId sem prefixo", row({ importId: "47e005e7aabbccdd" })], ["importId com caractere inválido", row({ importId: "imp_ZZZZZZZZ" })], ["userId com barra", row({ userId: "a/b" })],
      ["hashBasis outro", row({ hashBasis: "BYTES" })], ["lineEnding outro", row({ lineEnding: "CRCR" })], ["fileBytes negativo", row({ fileBytes: -1 })], ["fileBytes fracionário", row({ fileBytes: 1.5 })], ["fileBytes enorme", row({ fileBytes: 10 ** 12 })], ["hasBom texto", row({ hasBom: "sim" })],
      ["fileName vazio", row({ fileName: "" })], ["fileName 300 chars", row({ fileName: "x".repeat(300) })], ["fileName com NUL", row({ fileName: "a\u0000b" })], ["fileName número", row({ fileName: 5 })],
      ["accountRefSalt no contexto", row({ context: ctx({ accountRefSalt: "9f".repeat(32) }) })], ["salt/provider no contexto", row({ context: ctx({ salt: { provider: {}, userId: U1 } }) })], ["fileHash no contexto", row({ context: ctx({ fileHash: SHA("a") }) })], ["fileName dentro do contexto", row({ context: ctx({ fileName: "x.csv" }) })],
      ["contexto não é objeto", row({ context: [] })], ["contexto null", row({ context: null })], ["contexto com função", row({ context: ctx({ sourceTz: () => 1 }) })], ["sourceTz número", row({ context: ctx({ sourceTz: 5 }) })], ["dateOrder minúsculo", row({ context: ctx({ dateOrder: "dmy" }) })],
      ["reconstructCycles texto", row({ context: ctx({ reconstructCycles: "true" }) })], ["forceParserId com espaço", row({ context: ctx({ forceParserId: "a b" }) })], ["exitReasonMap não é array", row({ context: ctx({ exitReasonMap: {} }) })], ["exitReasonMap item com chave extra", row({ context: ctx({ exitReasonMap: [{ pattern: "x", reason: "TARGET", z: 1 }] }) })],
      ["exitReasonMap pattern vazio", row({ context: ctx({ exitReasonMap: [{ pattern: "", reason: "TARGET" }] }) })], ["exitReasonMap pattern gigante", row({ context: ctx({ exitReasonMap: [{ pattern: "x".repeat(501), reason: "TARGET" }] }) })], ["exitReasonMap 201 itens", row({ context: ctx({ exitReasonMap: Array.from({ length: 201 }, () => ({ pattern: "x", reason: "TARGET" })) }) })],
      ["null", null], ["array", []], ["string", "x"],
    ]
    for (const [why, r] of bad) assert.deepEqual(await store.put(r), importSourceFailure("INVALID_ARGS"), `${name}: ${why}`)
    assert.deepEqual(await store.get(U1, SHA("a")), importSourceFailure("NOT_FOUND"), `${name}: nada foi gravado`)
  })
})

await test("T5 — disco: 0600/0700, recusa symlink, arquivo corrompido ⇒ CORRUPT só daquela linha (as outras seguem), falha de infra não deixa temporário, e escritores simultâneos convergem", async () => {
  const root = mkdtempSync(join(tmpdir(), "import-src-")); TMPS.push(root)
  const store = createDiskImportSourceStore(root)
  await store.put(row()); await store.put(row({ fileSha256: SHA("b") }))
  for (const f of walk(root)) assert.equal(statSync(f).mode & 0o077, 0, `${f} legível por outros`)
  assert.equal(statSync(join(root, "import-sources", U1)).mode & 0o077, 0)
  // corrompido
  writeFileSync(join(root, "import-sources", U1, `${SHA("a")}.json`), "{lixo")
  assert.deepEqual(await store.get(U1, SHA("a")), importSourceFailure("CORRUPT"))
  assert.equal(((await store.get(U1, SHA("b"))) as Any).ok, true)
  assert.deepEqual(await store.put(row()), importSourceFailure("CORRUPT"), "put sobre linha corrompida não a esconde")
  writeFileSync(join(root, "import-sources", U1, `${SHA("b")}.json`), JSON.stringify({ ...row({ fileSha256: SHA("b") }), userId: U2 })) // conteúdo de outro usuário no meu arquivo
  assert.deepEqual(await store.get(U1, SHA("b")), importSourceFailure("CORRUPT"))
  // symlink: o diretório do usuário aponta para fora
  const outside = mkdtempSync(join(tmpdir(), "import-out-")); TMPS.push(outside)
  const root2 = mkdtempSync(join(tmpdir(), "import-src-")); TMPS.push(root2)
  mkdirSync(join(root2, "import-sources"), { recursive: true }); symlinkSync(outside, join(root2, "import-sources", U1))
  const s2 = createDiskImportSourceStore(root2)
  assert.deepEqual(await s2.put(row()), importSourceFailure("STORAGE_ERROR"))
  assert.deepEqual(await s2.get(U1, SHA("a")), importSourceFailure("STORAGE_ERROR"))
  assert.deepEqual(readdirSync(outside), [], "nada escapou pelo symlink")
  // falhas de infra
  const root3 = mkdtempSync(join(tmpdir(), "import-src-")); TMPS.push(root3)
  const boom = (): never => { throw Object.assign(new Error("EIO"), { code: "EIO" }) }
  const flaky = createDiskImportSourceStore(root3, { link: async () => boom() })
  assert.deepEqual(await flaky.put(row()), importSourceFailure("STORAGE_ERROR"))
  const half = createDiskImportSourceStore(root3, { writeFile: async (p: Any, d: Any) => { writeFileSync(p as string, String(d).slice(0, 7)); return boom() } })
  assert.deepEqual(await half.put(row()), importSourceFailure("STORAGE_ERROR"))
  assert.deepEqual(readdirSync(join(root3, "import-sources", U1)), [], "sem temporário nem linha parcial")
  assert.deepEqual(await createDiskImportSourceStore(root3).get(U1, SHA("a")), importSourceFailure("NOT_FOUND"))
  // simultâneos: mesma linha ⇒ 1 created; contextos diferentes ⇒ 1 vence, os outros CONFLICT
  const root4 = mkdtempSync(join(tmpdir(), "import-src-")); TMPS.push(root4)
  const racers = Array.from({ length: 8 }, () => createDiskImportSourceStore(root4))
  const same: Any[] = await Promise.all(racers.map((s) => s.put(row())))
  assert.equal(same.filter((r) => r.ok && r.created).length, 1)
  assert.equal(same.every((r) => r.ok), true)
  const diff: Any[] = await Promise.all(racers.map((s, i) => s.put(row({ fileSha256: SHA("d"), context: { sourceTz: `Etc/GMT+${i}` } }))))
  assert.equal(diff.filter((r) => r.ok && r.created).length, 1, "exatamente um vencedor")
  assert.deepEqual([...new Set(diff.filter((r) => !(r.ok && r.created)).map((r) => (r.ok ? "idem" : r.code)))].filter((x) => x !== "CONFLICT"), [], "os demais levam CONFLICT")
})

await test("S1 — o que vai ao disco: só os campos da linha (sem sal, provider, fileHash nem conteúdo do arquivo); arquivos 0600", async () => {
  const root = mkdtempSync(join(tmpdir(), "import-src-")); TMPS.push(root)
  const store = createDiskImportSourceStore(root)
  await store.put(row())
  const files = walk(root)
  assert.equal(files.length, 1)
  const text = readFileSync(files[0], "utf8")
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["context", "createdAt", "fileBytes", "fileName", "fileSha256", "hasBom", "hashBasis", "importId", "lineEnding", "userId"])
  for (const forbidden of ["salt", "Salt", "provider", "fileHash", "accountRef", "password", "token"]) assert.equal(text.includes(forbidden), false, forbidden)
  assert.equal(statSync(files[0]).mode & 0o077, 0)
})

for (const d of TMPS) rmSync(d, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do ImportSourceStore passaram.`)
