// E7-12: cota de arquivos importados por plano (infra/import-quota.ts + PLAN_IMPORT_QUOTAS em plans.ts + list(userId) no ImportSourceStore). Expectativa escrita ANTES do código:
// scripts/expectations/agent-answer.expected.json → e7_12 (D-Q1…D-Q8; L1–L3 em test-import-source-store.mts, Q1–Q11 aqui; mutações EQ1–EQ17).
//   node scripts/test-import-quota.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PLAN_IMPORT_QUOTAS, PLAN_LIMITS } from "../src/lib/plans.ts"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { makeContext, registerImport, type DatasetDeps } from "../src/lib/infra/dataset.ts"
import { getImportUsage, registerImportWithQuota } from "../src/lib/infra/import-quota.ts"
import { createDiskImportSourceStore, createMemoryImportSourceStore, type ImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage, type RawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
import { createMemorySaltStore } from "../src/lib/infra/salt-store.ts"
import { deleteImportFile, purgeUserData } from "../src/lib/infra/user-purge.ts"
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
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy", U3 = "cmd3h2k0a0000semsal0000000"
const MIB = 1024 * 1024
const CTX = { sourceTz: "America/New_York" }
const p2 = (x: number): string => String(x).padStart(2, "0")
const csvOf = (n: number, seed = 0): string => synthCsv(Array.from({ length: n }, (_, i) => ({ entryPrice: 2000 + ((i + seed) % 13), exitPrice: 2000 + ((i + seed) % 13) + (((i + seed) % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: (i + seed) % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
/** O arquivo de número `seed` (conteúdo e sha distintos; o teste confere). */
const FILES = Array.from({ length: 8 }, (_, seed) => csvOf(20 + seed * 3, seed))
const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8")
const req = (text: string, extra: Any = {}): Any => ({ userId: U1, text, context: CTX, fileName: "export.csv", ...extra })
const QUOTAS = (f: [number, number, number], b: [number, number, number] = [1e9, 1e9, 1e9]): Any => ({ FREE: { files: f[0], bytes: b[0] }, TRADER: { files: f[1], bytes: b[1] }, PRO: { files: f[2], bytes: b[2] } })
const FAIL = (code: string): Any => ({ ok: false, code })
const jstr = (x: unknown): string => JSON.stringify(x)

// ── ambientes (memória e disco) ──
const TMPS: string[] = []
interface Env { name: string; kr: InMemorySaltKeyring; raw: RawFileStorage; imp: ImportSourceStore; deps: DatasetDeps; root?: string }
function memEnv(): Env {
  const kr = new InMemorySaltKeyring(); kr.ensure(U1); kr.ensure(U2)
  const raw = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore()
  return { name: "memória", kr, raw, imp, deps: { rawStorage: raw, importStore: imp, salt: kr } }
}
function diskEnv(): Env {
  const root = mkdtempSync(join(tmpdir(), "quota-")); TMPS.push(root)
  const kr = new InMemorySaltKeyring(); kr.ensure(U1); kr.ensure(U2)
  const raw = createDiskRawFileStorage(join(root, "raw")), imp = createDiskImportSourceStore(root)
  return { name: "disco", kr, raw, imp, deps: { rawStorage: raw, importStore: imp, salt: kr }, root }
}
const both = async (fn: (e: Env) => Promise<void>): Promise<void> => { for (const e of [memEnv(), diskEnv()]) await fn(e) }
/** Conta as chamadas de gravação (provar que um pedido barrado NÃO gravou nada) e permite sabotar o `list`. */
function spy(e: Env, over: Partial<ImportSourceStore> = {}): { deps: DatasetDeps; calls: { rawPut: number; importPut: number } } {
  const calls = { rawPut: 0, importPut: 0 }
  const rawStorage: RawFileStorage = { ...e.raw, put: async (...a) => { calls.rawPut += 1; return e.raw.put(...a) }, get: e.raw.get.bind(e.raw), delete: e.raw.delete.bind(e.raw), deleteAllForUser: e.raw.deleteAllForUser.bind(e.raw) }
  const importStore: ImportSourceStore = { put: async (r) => { calls.importPut += 1; return e.imp.put(r) }, get: e.imp.get.bind(e.imp), delete: e.imp.delete.bind(e.imp), deleteAllForUser: e.imp.deleteAllForUser.bind(e.imp), list: e.imp.list.bind(e.imp), ...over }
  return { deps: { rawStorage, importStore, salt: e.kr }, calls }
}
const ok = async (e: Env, text: string, plan: string, quotas?: Any, extra: Any = {}): Promise<Any> => {
  const r: Any = await registerImportWithQuota(e.deps, req(text, extra), plan, quotas === undefined ? undefined : { quotas })
  assert.equal(r.ok, true, `${e.name}: esperava ok e veio ${jstr(r)}`)
  return r
}

await test("Q1 — tabela: PLAN_IMPORT_QUOTAS tem os 3 planos com os números aprovados (Free 2/5 MiB, Starter 20/50 MiB, Pro 100/250 MiB), inteiros positivos, monótona e CONGELADA; plans.ts segue sem imports; PlanLimits/PLAN_LIMITS INALTERADOS", async () => {
  assert.deepEqual(PLAN_IMPORT_QUOTAS, { FREE: { files: 2, bytes: 5 * MIB }, TRADER: { files: 20, bytes: 50 * MIB }, PRO: { files: 100, bytes: 250 * MIB } })
  const plans = ["FREE", "TRADER", "PRO"] as const
  for (const p of plans) for (const k of ["files", "bytes"] as const) assert.ok(Number.isInteger(PLAN_IMPORT_QUOTAS[p][k]) && PLAN_IMPORT_QUOTAS[p][k] > 0, `${p}.${k}`)
  for (const k of ["files", "bytes"] as const) assert.ok(PLAN_IMPORT_QUOTAS.FREE[k] <= PLAN_IMPORT_QUOTAS.TRADER[k] && PLAN_IMPORT_QUOTAS.TRADER[k] <= PLAN_IMPORT_QUOTAS.PRO[k], `monótona em ${k}`)
  assert.equal(Object.isFrozen(PLAN_IMPORT_QUOTAS) && plans.every((p) => Object.isFrozen(PLAN_IMPORT_QUOTAS[p])), true)
  assert.deepEqual(PLAN_LIMITS, { FREE: { tradesPerMonth: 10, setups: 0, vegaPerMonth: 0, accounts: 1, integrations: 0 }, TRADER: { tradesPerMonth: 25, setups: 5, vegaPerMonth: 5, accounts: 1, integrations: 1 }, PRO: { tradesPerMonth: Infinity, setups: Infinity, vegaPerMonth: 40, accounts: Infinity, integrations: Infinity } })
  const code = readFileSync(`${ROOT}src/lib/plans.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  assert.equal(/^\s*(import|export\s[^\n]*\bfrom)\b/m.test(code), false, "plans.ts continua puro")
  assert.equal(new Set(FILES).size, FILES.length, "fixture: arquivos distintos")
})

await test("Q2 — arquivos: dentro da cota passa; o seguinte ⇒ QUOTA_EXCEEDED resource files com limit/used/suggestedPlan; NADA é gravado (nem arquivo, nem linha)", async () => {
  await both(async (e) => {
    await ok(e, FILES[0], "FREE"); await ok(e, FILES[1], "FREE")
    const { deps, calls } = spy(e)
    const r: Any = await registerImportWithQuota(deps, req(FILES[2]), "FREE")
    assert.deepEqual(r, { ok: false, code: "QUOTA_EXCEEDED", resource: "files", limit: 2, used: 2, suggestedPlan: "TRADER" }, e.name)
    assert.deepEqual(calls, { rawPut: 0, importPut: 0 }, `${e.name}: nada gravado`)
    assert.equal(((await e.imp.list(U1)) as Any).rows.length, 2, e.name)
    const starter: Any = await registerImportWithQuota(e.deps, req(FILES[2]), "TRADER"); assert.equal(starter.ok, true, `${e.name}: o mesmo pedido passa no Starter`)
  })
})

await test("Q3 — bytes: a borda exata (usado + novo == limite) passa; +1 byte ⇒ QUOTA_EXCEEDED bytes com used correto; arquivo maior que a cota inteira ⇒ bytes", async () => {
  await both(async (e) => {
    const [s0, s1] = [bytesOf(FILES[0]), bytesOf(FILES[1])]
    await ok(e, FILES[0], "FREE", QUOTAS([10, 10, 10], [s0 + s1, 1e9, 1e9]))
    const usage: Any = await getImportUsage(e.imp, U1, "FREE", { quotas: QUOTAS([10, 10, 10], [s0 + s1, 1e9, 1e9]) }); assert.equal(usage.bytes, s0, `${e.name}: o fileBytes da linha == bytes do texto`)
    await ok(e, FILES[1], "FREE", QUOTAS([10, 10, 10], [s0 + s1, 1e9, 1e9])) // borda exata
    const over: Any = await registerImportWithQuota(e.deps, req(FILES[2]), "FREE", { quotas: QUOTAS([10, 10, 10], [s0 + s1, 1e9, 1e9]) })
    assert.deepEqual(over, { ok: false, code: "QUOTA_EXCEEDED", resource: "bytes", limit: s0 + s1, used: s0 + s1, suggestedPlan: "TRADER" }, e.name)
  })
  await both(async (e) => {
    const [s0, s1] = [bytesOf(FILES[0]), bytesOf(FILES[1])]
    const q = QUOTAS([10, 10, 10], [s0 + s1 - 1, 1e9, 1e9])
    await ok(e, FILES[0], "FREE", q)
    const r: Any = await registerImportWithQuota(e.deps, req(FILES[1]), "FREE", { quotas: q })
    assert.deepEqual(r, { ok: false, code: "QUOTA_EXCEEDED", resource: "bytes", limit: s0 + s1 - 1, used: s0, suggestedPlan: "TRADER" }, `${e.name}: +1 byte`)
    const huge: Any = await registerImportWithQuota(e.deps, req(FILES[3]), "FREE", { quotas: QUOTAS([10, 10, 10], [bytesOf(FILES[3]) - 1, bytesOf(FILES[3]) - 1, bytesOf(FILES[3]) - 1]) })
    assert.deepEqual([huge.code, huge.resource, huge.suggestedPlan], ["QUOTA_EXCEEDED", "bytes", null], `${e.name}: maior que a cota de qualquer plano`)
  })
})

await test("Q4 — idempotência: reenviar o MESMO arquivo com a cota cheia passa (created:false) e não consome cota; um arquivo novo continua barrado", async () => {
  await both(async (e) => {
    const q = QUOTAS([1, 1, 1])
    const first = await ok(e, FILES[0], "FREE", q); assert.equal(first.created, true, e.name)
    const again = await ok(e, FILES[0], "FREE", q); assert.deepEqual([again.created, again.fileSha256], [false, first.fileSha256], e.name)
    assert.equal(((await getImportUsage(e.imp, U1, "FREE", { quotas: q })) as Any).files, 1, `${e.name}: ainda 1 arquivo`)
    const novo: Any = await registerImportWithQuota(e.deps, req(FILES[1]), "FREE", { quotas: q }); assert.equal(novo.code, "QUOTA_EXCEEDED", e.name)
  })
})

await test("Q5 — liberação: deleteImportFile e purgeUserData devolvem a cota (um novo envio passa)", async () => {
  await both(async (e) => {
    const q = QUOTAS([1, 1, 1])
    const a = await ok(e, FILES[0], "FREE", q)
    assert.equal(((await registerImportWithQuota(e.deps, req(FILES[1]), "FREE", { quotas: q })) as Any).code, "QUOTA_EXCEEDED", e.name)
    const del: Any = await deleteImportFile({ rawStorage: e.raw, importStore: e.imp } as Any, { userId: U1, fileSha256: a.fileSha256 }); assert.equal(del.ok, true, e.name)
    await ok(e, FILES[1], "FREE", q)
    const purge: Any = await purgeUserData({ rawStorage: e.raw, importStore: e.imp, conversationStore: createMemoryConversationStore(), saltStore: createMemorySaltStore() } as Any, { userId: U1 }); assert.equal(purge.ok, true, jstr(purge))
    assert.equal(((await getImportUsage(e.imp, U1, "FREE", { quotas: q })) as Any).files, 0, e.name)
    await ok(e, FILES[2], "FREE", q)
  })
})

await test("Q6 — planos: suggestedPlan Free→TRADER, TRADER→PRO e (nem o Pro comporta) null; pula o plano cuja cota de bytes não comporta; rebaixar mantém a leitura (makeContext) e bloqueia só novos envios", async () => {
  await both(async (e) => {
    const q = QUOTAS([1, 2, 3])
    await ok(e, FILES[0], "FREE", q)
    assert.equal(((await registerImportWithQuota(e.deps, req(FILES[1]), "FREE", { quotas: q })) as Any).suggestedPlan, "TRADER", `${e.name}: Free→TRADER`)
    await ok(e, FILES[1], "TRADER", q)
    assert.equal(((await registerImportWithQuota(e.deps, req(FILES[2]), "TRADER", { quotas: q })) as Any).suggestedPlan, "PRO", `${e.name}: TRADER→PRO`)
    const third = await ok(e, FILES[2], "PRO", q)
    assert.equal(((await registerImportWithQuota(e.deps, req(FILES[3]), "PRO", { quotas: q })) as Any).suggestedPlan, null, `${e.name}: Pro estourado ⇒ null`)
    // rebaixar: 3 arquivos, plano Free (cota 1): leitura segue, novo envio barrado
    const made: Any = await makeContext(e.deps, { userId: U1, pin: { sources: [{ fileSha256: third.fileSha256 }], analysis: {} } }); assert.equal(made.ok, true, `${e.name}: ${jstr(made)}`)
    const down: Any = await registerImportWithQuota(e.deps, req(FILES[4]), "FREE", { quotas: q }); assert.deepEqual([down.code, down.resource, down.limit, down.used], ["QUOTA_EXCEEDED", "files", 1, 3], e.name)
    assert.equal(((await getImportUsage(e.imp, U1, "PRO", { quotas: q })) as Any).files, 3, `${e.name}: nada foi apagado`)
  })
  await both(async (e) => { // a cota de BYTES do plano seguinte não comporta ⇒ pula para o Pro
    const b = bytesOf(FILES[1])
    const q = QUOTAS([1, 5, 5], [1e9, b - 1, 1e9])
    await ok(e, FILES[0], "FREE", q)
    assert.equal(((await registerImportWithQuota(e.deps, req(FILES[1]), "FREE", { quotas: q })) as Any).suggestedPlan, "PRO", `${e.name}: o Starter não comporta os bytes`)
  })
})

await test("Q7 — FAIL-CLOSED: plano inválido/ausente/minúsculo ⇒ INVALID_ARGS sem nenhum I/O; list falhando, lançando ou malformado ⇒ STORAGE_ERROR sem gravar; os erros do registerImport passam com o MESMO código", async () => {
  await both(async (e) => {
    const { deps, calls } = spy(e)
    for (const plan of [undefined, null, "pro", "free", "trader", "STARTER", "ENTERPRISE", "", 5, {}, ["PRO"]]) assert.deepEqual(await registerImportWithQuota(deps, req(FILES[0]), plan as Any), FAIL("INVALID_ARGS"), `${e.name}: plano ${jstr(plan)}`)
    assert.deepEqual(calls, { rawPut: 0, importPut: 0 }, e.name)
    for (const [why, over] of [["list falha", { list: async () => FAIL("STORAGE_ERROR") }], ["list lança", { list: async () => { throw new Error("SEGREDO") } }], ["list malformado", { list: async () => ({ ok: true }) }], ["list com linhas inválidas", { list: async () => ({ ok: true, rows: [{ fileBytes: "x" }], corrupt: 0 }) }]] as Array<[string, Partial<ImportSourceStore>]>) {
      const s = spy(e, over); const r: Any = await registerImportWithQuota(s.deps, req(FILES[0]), "PRO")
      assert.deepEqual(r, FAIL("STORAGE_ERROR"), `${e.name}: ${why}`); assert.equal(jstr(r).includes("SEGREDO"), false); assert.deepEqual(s.calls, { rawPut: 0, importPut: 0 }, `${e.name}: ${why}: nada gravado`)
    }
    // o que o registerImport recusa continua com o MESMO código (paridade com a chamada direta)
    const mirror = memEnv(); mirror.kr.ensure(U3)
    for (const [why, request] of [["texto inválido", req("isto não é um csv de trades")], ["texto vazio", req("")], ["chave extra", req(FILES[0], { extra: 1 })], ["contexto inválido", req(FILES[0], { context: { sourceTz: 5 } })], ["texto não string", req(5 as Any)], ["sem sal", req(FILES[0], { userId: U3 })]] as Array<[string, Any]>) {
      const quota: Any = await registerImportWithQuota(e.deps, request, "PRO")
      const direct: Any = await registerImport({ ...mirror.deps, salt: e.kr }, request)
      assert.equal(quota.ok, false, `${e.name}: ${why}`); assert.equal(quota.code, direct.code, `${e.name}: ${why}: ${quota.code} vs ${direct.code}`)
    }
    assert.deepEqual(await registerImportWithQuota(e.deps, { ...req(FILES[0]), userId: "../x" }, "PRO"), FAIL("INVALID_ARGS"), `${e.name}: userId inválido`)
    assert.deepEqual(await registerImportWithQuota(e.deps, null as Any, "PRO"), FAIL("INVALID_ARGS"), `${e.name}: pedido nulo`)
  })
})

await test("Q8 — isolamento e sem eco: o uso de outro usuário não conta; QUOTA_EXCEEDED tem EXATAMENTE as chaves ok/code/resource/limit/used/suggestedPlan; nenhum resultado traz texto, fileName ou userId", async () => {
  await both(async (e) => {
    const q = QUOTAS([1, 1, 1])
    await ok(e, FILES[0], "FREE", q, { userId: U2, fileName: "do-outro.csv" })
    await ok(e, FILES[1], "FREE", q) // o U1 tem a SUA cota
    const blocked: Any = await registerImportWithQuota(e.deps, req(FILES[2], { fileName: "segredo-do-usuario.csv" }), "FREE", { quotas: q })
    assert.deepEqual(Object.keys(blocked).sort(), ["code", "limit", "ok", "resource", "suggestedPlan", "used"], e.name)
    for (const bad of ["segredo-do-usuario", "do-outro", U1, U2, FILES[2].slice(0, 30), "Instrumento"]) assert.equal(jstr(blocked).includes(bad), false, `${e.name}: eco de ${bad}`)
    const u: Any = await getImportUsage(e.imp, U1, "FREE", { quotas: q }); for (const bad of [U1, U2, "do-outro", "export.csv"]) assert.equal(jstr(u).includes(bad), false, `${e.name}: uso ecoa ${bad}`)
  })
})

await test("Q9 — uso: getImportUsage correto depois de importar e de apagar; linha corrompida conta 1 arquivo e 0 bytes e aparece em corrupt; remaining nunca negativo; plano/usuário inválido ⇒ INVALID_ARGS", async () => {
  await both(async (e) => {
    const [s0, s1] = [bytesOf(FILES[0]), bytesOf(FILES[1])]
    assert.deepEqual(await getImportUsage(e.imp, U1, "FREE"), { ok: true, files: 0, bytes: 0, corrupt: 0, limits: { files: 2, bytes: 5 * MIB }, remaining: { files: 2, bytes: 5 * MIB } }, `${e.name}: vazio`)
    const a = await ok(e, FILES[0], "FREE"); await ok(e, FILES[1], "FREE")
    assert.deepEqual(await getImportUsage(e.imp, U1, "FREE"), { ok: true, files: 2, bytes: s0 + s1, corrupt: 0, limits: { files: 2, bytes: 5 * MIB }, remaining: { files: 0, bytes: 5 * MIB - s0 - s1 } }, e.name)
    assert.equal(((await getImportUsage(e.imp, U1, "TRADER")) as Any).limits.files, 20, `${e.name}: o mesmo uso, a cota do Starter`)
    await e.imp.delete(U1, a.fileSha256)
    assert.deepEqual([((await getImportUsage(e.imp, U1, "FREE")) as Any).files, ((await getImportUsage(e.imp, U1, "FREE")) as Any).bytes], [1, s1], `${e.name}: depois de apagar`)
    if (e.root !== undefined) {
      const dir = join(e.root, "import-sources", U1); writeFileSync(join(dir, `${"d".repeat(64)}.json`), "{ lixo"); writeFileSync(join(dir, `${"e".repeat(64)}.json`), "{ lixo")
      const u: Any = await getImportUsage(e.imp, U1, "FREE"); assert.deepEqual([u.files, u.bytes, u.corrupt, u.remaining.files], [3, s1, 2, 0], `${e.name}: corrompidas contam como arquivo, 0 bytes, e remaining não fica negativo`)
      const blocked: Any = await registerImportWithQuota(e.deps, req(FILES[2]), "FREE"); assert.equal(blocked.code, "QUOTA_EXCEEDED", `${e.name}: a cota considera as corrompidas`)
    }
    for (const plan of [undefined, "pro", "X"]) assert.deepEqual(await getImportUsage(e.imp, U1, plan as Any), FAIL("INVALID_ARGS"), e.name)
    assert.deepEqual(await getImportUsage(e.imp, "../x", "FREE"), FAIL("INVALID_ARGS"), e.name)
    assert.deepEqual(await getImportUsage({ ...e.imp, list: async () => FAIL("STORAGE_ERROR") } as Any, U1, "FREE"), FAIL("STORAGE_ERROR"), e.name)
  })
})

await test("Q10 — ESTÁTICA: import-quota.ts importa só ../plans.ts, ./dataset.ts, ./hash.ts, ./import-source-store.ts e ./raw-file-storage.ts, sem process.env/fetch/next/prisma/node:; só o tratador da rota (E7-14) importa import-quota.ts; o schema do Prisma e o plan-guard seguem como estavam", async () => {
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const code = read("src/lib/infra/import-quota.ts")
  assert.deepEqual(importsOf(code).sort(), ["../plans.ts", "./dataset.ts", "./hash.ts", "./import-source-store.ts", "./raw-file-storage.ts"])
  assert.equal(/process\.env|\bfetch\s*\(|from\s+["']next|prisma|node:|@aws-sdk/i.test(code), false, "dependência proibida")
  for (const f of readdirSync(`${ROOT}src/lib/infra`).filter((x) => x.endsWith(".ts") && x !== "import-quota.ts" && x !== "ai-partner-imports.ts")) assert.equal(/import-quota/.test(read(`src/lib/infra/${f}`)), false, `infra/${f}`) // E7-14: o tratador da rota é o consumidor
  for (const dir of ["agent", "agent-capabilities", "evidence", "metrics", "ingest", "domain"]) for (const f of readdirSync(`${ROOT}src/lib/${dir}`).filter((x) => x.endsWith(".ts"))) assert.equal(/import-quota/.test(read(`src/lib/${dir}/${f}`)), false, `${dir}/${f}`)
  assert.equal(/PLAN_IMPORT_QUOTAS/.test(read("src/lib/plan-guard.ts")), false, "o plan-guard não foi tocado")
  assert.equal(/model\s+ImportSource\b/.test(readFileSync(`${ROOT}prisma/schema.prisma`, "utf8")), false)
})

await test("Q11 — CONCORRÊNCIA (limite declarado): 5 envios simultâneos de arquivos distintos com cota 2 ⇒ entre 2 e 5 passam, todas as recusas são QUOTA_EXCEEDED e o envio seguinte já é barrado", async () => {
  await both(async (e) => {
    const q = QUOTAS([2, 2, 2])
    const rs: Any[] = await Promise.all(FILES.slice(0, 5).map((t) => registerImportWithQuota(e.deps, req(t), "FREE", { quotas: q })))
    const passedN = rs.filter((r) => r.ok).length
    assert.ok(passedN >= 2 && passedN <= 5, `${e.name}: passaram ${passedN}`)
    assert.equal(rs.filter((r) => !r.ok).every((r) => r.code === "QUOTA_EXCEEDED"), true, e.name)
    assert.equal(((await registerImportWithQuota(e.deps, req(FILES[6]), "FREE", { quotas: q })) as Any).code, "QUOTA_EXCEEDED", `${e.name}: o próximo já é barrado`)
  })
})

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes da cota de importação passaram.`)
