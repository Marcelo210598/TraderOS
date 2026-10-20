// E7-14: a FIAÇÃO da ingestão — os tratadores puros da rota de upload do AI Partner (infra/ai-partner-imports.ts) e o montador de dependências (infra/ai-partner-deps.ts), OFFLINE (memória, sem rede, sem banco).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_14 (D-F1…D-F10; H1–H14; mutações EF1–EF19).
//   node scripts/test-ai-partner-imports.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { buildAiPartnerDeps } from "../src/lib/infra/ai-partner-deps.ts"
import { MAX_ROUTE_BYTES, handleImportDelete, handleImportPost, handleImportsGet, type AiPartnerCtx, type AiPartnerDeps } from "../src/lib/infra/ai-partner-imports.ts"
import { createSaltCipher } from "../src/lib/infra/cipher.ts"
import { createMemoryImportSourceStore, type ImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage, type RawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createMemorySaltStore, createPersistentSalts } from "../src/lib/infra/salt-store.ts"
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
const MIB = 1024 * 1024
const URL_BASE = "https://app.test/api/ai-partner/imports"
const UA = "cmd3h2k0a0000abcd1234efgh", UB = "cmd3h2k0a0000zzzz9999yyyy"
const KEY = "ab".repeat(32)
const SECRET = "SEGREDO-INTERNO /chave/r2 postgres://u:senha@host/db"
const CTX_USER = { sourceTz: "America/New_York" }
const p2 = (x: number): string => String(x).padStart(2, "0")
const csvOf = (n: number, seed = 0): string => synthCsv(Array.from({ length: n }, (_, i) => ({ entryPrice: 2000 + ((i + seed) % 13), exitPrice: 2000 + ((i + seed) % 13) + (((i + seed) % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: (i + seed) % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
const FILES = Array.from({ length: 6 }, (_, seed) => csvOf(20 + seed * 3, seed))
const jstr = (x: unknown): string => JSON.stringify(x)
const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex")
const body = async (r: Response): Promise<Any> => JSON.parse(await r.text())

// ── dependências em memória + espiões ──
interface Rig { deps: AiPartnerDeps; saltStore: ReturnType<typeof createMemorySaltStore>; calls: { rawPut: number; importPut: number; salts: number }; raw: RawFileStorage; imp: ImportSourceStore }
function mkRig(over: { raw?: Partial<RawFileStorage>; imp?: Partial<ImportSourceStore>; key?: string; saltStore?: ReturnType<typeof createMemorySaltStore> } = {}): Rig {
  const calls = { rawPut: 0, importPut: 0, salts: 0 }
  const rawBase = createMemoryRawFileStorage(), impBase = createMemoryImportSourceStore(), saltStore = over.saltStore ?? createMemorySaltStore()
  const raw: RawFileStorage = { put: async (...a) => { calls.rawPut += 1; return rawBase.put(...a) }, get: rawBase.get.bind(rawBase), delete: rawBase.delete.bind(rawBase), deleteAllForUser: rawBase.deleteAllForUser.bind(rawBase), ...over.raw }
  const imp: ImportSourceStore = { put: async (r) => { calls.importPut += 1; return impBase.put(r) }, get: impBase.get.bind(impBase), delete: impBase.delete.bind(impBase), deleteAllForUser: impBase.deleteAllForUser.bind(impBase), list: impBase.list.bind(impBase), ...over.imp }
  const cipher = createSaltCipher({ SALT_MASTER_KEY: over.key ?? KEY }); assert.equal(cipher.ok, true)
  const real = createPersistentSalts({ store: saltStore, cipher: (cipher as Any).cipher })
  const salts = { load: async (u: string) => { calls.salts += 1; return real.load(u) }, ensure: real.ensure.bind(real), rotate: real.rotate.bind(real), retire: real.retire.bind(real), recipherAll: real.recipherAll.bind(real) }
  return { deps: { rawStorage: raw, importStore: imp, salts: salts as Any }, saltStore, calls, raw: rawBase, imp: impBase }
}
interface CtxLog { plans: string[]; limited: string[]; planCalls: number }
function mkCtx(rig: Rig | null, o: { userId?: string | null; plan?: unknown | (() => unknown); limit?: { ok: boolean; retryAfterSec: number } } = {}): { ctx: AiPartnerCtx; log: CtxLog } {
  const log: CtxLog = { plans: [], limited: [], planCalls: 0 }
  const ctx: AiPartnerCtx = {
    userId: o.userId === undefined ? UA : o.userId,
    getPlan: async (u) => { log.planCalls += 1; log.plans.push(u); return typeof o.plan === "function" ? (o.plan as () => unknown)() : o.plan === undefined ? "FREE" : o.plan },
    rateLimit: async (u) => { log.limited.push(u); return o.limit ?? { ok: true, retryAfterSec: 0 } },
    deps: rig === null ? null : rig.deps,
  }
  return { ctx, log }
}
const jsonReq = (payload: Any, headers: Record<string, string> = {}, method = "POST"): Request => new Request(URL_BASE, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) })
const formReq = (file: Uint8Array | string, name = "export.csv", extra: Record<string, string> = {}, headers: Record<string, string> = {}): Request => { const fd = new FormData(); fd.append("file", new File([file as BlobPart], name, { type: "text/csv" })); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return new Request(URL_BASE, { method: "POST", headers, body: fd }) }
const post = (ctx: AiPartnerCtx, text: string, extra: Any = {}, headers: Record<string, string> = {}): Promise<Response> => handleImportPost(ctx, jsonReq({ text, fileName: "export.csv", context: CTX_USER, ...extra }, headers))

await test("H1 — AUTENTICAÇÃO: sem usuário ⇒ 401 {error} e NENHUMA chamada às dependências, ao plano ou ao limite de taxa; vale para POST, GET e DELETE", async () => {
  const rig = mkRig(); const { ctx, log } = mkCtx(rig, { userId: null })
  const rs = [await handleImportPost(ctx, jsonReq({ text: FILES[0], context: CTX_USER })), await handleImportsGet(ctx, new Request(URL_BASE)), await handleImportDelete(ctx, new Request(`${URL_BASE}/${"a".repeat(64)}`, { method: "DELETE" }), "a".repeat(64))]
  for (const r of rs) { assert.equal(r.status, 401); assert.deepEqual(await body(r), { error: "Não autorizado" }); assert.equal(r.headers.get("cache-control"), "no-store") }
  assert.deepEqual([rig.calls, log.planCalls, log.limited.length], [{ rawPut: 0, importPut: 0, salts: 0 }, 0, 0])
  for (const bad of ["", "../x", 5 as Any]) assert.equal((await handleImportsGet({ ...ctx, userId: bad as Any }, new Request(URL_BASE))).status, 401, `userId inválido ${jstr(bad)}`)
})

await test("H2 — TIPO DE CONTEÚDO: JSON e multipart dão o mesmo resultado (mesmo sha); text/plain ⇒ 415; sem arquivo/campo, JSON inválido e corpo vazio ⇒ 400; campos desconhecidos são ignorados; contexto inválido ⇒ 400", async () => {
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "PRO" })
  const a = await handleImportPost(ctx, jsonReq({ text: FILES[0], fileName: "a.csv", context: CTX_USER, extra: { x: 1 } })); assert.equal(a.status, 201, jstr(await a.clone().text()))
  const b = await handleImportPost(ctx, formReq(FILES[0], "a.csv", { context: jstr(CTX_USER), lixo: "ignorado" })); assert.equal(b.status, 200)
  const aj = await body(a), bj = await body(b); assert.equal(aj.fileSha256, bj.fileSha256, "mesmo texto por JSON ou multipart ⇒ mesmo sha"); assert.equal(bj.created, false)
  const cases: Array<[string, Request, number]> = [
    ["text/plain", new Request(URL_BASE, { method: "POST", headers: { "content-type": "text/plain" }, body: FILES[1] }), 415], ["sem content-type", new Request(URL_BASE, { method: "POST", body: new Uint8Array([1, 2, 3]) }), 415],
    ["multipart sem file", (() => { const fd = new FormData(); fd.append("outro", "x"); return new Request(URL_BASE, { method: "POST", body: fd }) })(), 400], ["multipart com file de texto (não arquivo)", (() => { const fd = new FormData(); fd.append("file", "isto não é um arquivo"); return new Request(URL_BASE, { method: "POST", body: fd }) })(), 400],
    ["JSON inválido", new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "{ não é json" }), 400], ["JSON sem text", jsonReq({ fileName: "a.csv" }), 400], ["JSON com text não string", jsonReq({ text: 5 }), 400], ["JSON com text vazio", jsonReq({ text: "" }), 400], ["JSON array", jsonReq([1, 2]), 400],
    ["corpo vazio", new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "" }), 400], ["contexto inválido (JSON)", jsonReq({ text: FILES[1], context: { sourceTz: 5 } }), 400], ["contexto inválido (multipart: não é JSON)", formReq(FILES[1], "x.csv", { context: "{ lixo" }), 400],
  ]
  for (const [why, req, status] of cases) { const r = await handleImportPost(ctx, req); assert.equal(r.status, status, `${why}: ${await r.clone().text()}`); const j = await body(r); assert.equal(j.ok, false, why); assert.equal(typeof j.code, "string", why) }
})

await test("H3 — TAMANHO: Content-Length > 4 MiB ⇒ 413 SEM ler o corpo; corpo em fluxo sem Content-Length que passa de 4 MiB ⇒ 413 e a leitura PARA no teto; Content-Length mentindo (menor) ⇒ 413 pelo fluxo; exatamente no teto passa a validação de tamanho", async () => {
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "PRO" })
  assert.equal(MAX_ROUTE_BYTES, 4 * MIB)
  let pulled = 0
  const stream = (chunks: number, size = MIB): ReadableStream<Uint8Array> => new ReadableStream({ pull(c) { pulled += 1; if (pulled > chunks) c.close(); else c.enqueue(new Uint8Array(size).fill(65)) } }, { highWaterMark: 0 })
  const big = new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", "content-length": String(MAX_ROUTE_BYTES + 1) }, body: stream(1), duplex: "half" } as Any)
  const r1 = await handleImportPost(ctx, big); assert.equal(r1.status, 413); assert.equal((await body(r1)).code, "TOO_LARGE_FOR_ROUTE"); assert.equal(pulled, 0, "o corpo NÃO foi lido")
  pulled = 0
  const noLen = new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: stream(50), duplex: "half" } as Any)
  const r2 = await handleImportPost(ctx, noLen); assert.equal(r2.status, 413); assert.ok(pulled <= 6, `leu ${pulled} pedaços de 1 MiB: tinha que parar no teto`)
  pulled = 0
  const lying = new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", "content-length": "10" }, body: stream(50), duplex: "half" } as Any)
  const r3 = await handleImportPost(ctx, lying); assert.equal(r3.status, 413, "o fluxo real passa do teto mesmo com o cabeçalho dizendo 10"); assert.ok(pulled <= 6, `leu ${pulled}`)
  const text = FILES[0]; const asJson = jstr({ text, context: CTX_USER })
  const edge = new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", "content-length": String(MAX_ROUTE_BYTES) }, body: asJson })
  const r4 = await handleImportPost(ctx, edge); assert.notEqual(r4.status, 413, "o teto é inclusivo para o cabeçalho");
  assert.equal(rig.calls.rawPut, 1, "o texto pequeno passou e foi gravado")
})

await test("H4 — CODIFICAÇÃO: bytes que não são UTF-8 ⇒ 400 INVALID_ENCODING; o arquivo com BOM é aceito e o sha/hasBom são os do arquivo COM o BOM (por multipart e por JSON)", async () => {
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "PRO" })
  for (const bad of [new Uint8Array([0xff, 0xfe, 0xfa, 0x41]), new Uint8Array([0xc3, 0x28]), new Uint8Array([0x80])]) { const r = await handleImportPost(ctx, formReq(bad)); assert.equal(r.status, 400); assert.equal((await body(r)).code, "INVALID_ENCODING") }
  assert.equal(rig.calls.rawPut, 0)
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(FILES[0])])
  const r = await handleImportPost(ctx, formReq(withBom, "bom.csv", { context: jstr(CTX_USER) })); assert.equal(r.status, 201, await r.clone().text())
  const j = await body(r); assert.equal(j.fileSha256, sha256(withBom), "o sha é o dos bytes COM o BOM")
  const row: Any = await rig.imp.get(UA, j.fileSha256); assert.equal(row.row.hasBom, true)
  const viaJson = await handleImportPost(ctx, jsonReq({ text: "\uFEFF" + FILES[0], fileName: "bom.csv", context: CTX_USER })); assert.equal((await body(viaJson)).fileSha256, j.fileSha256, "JSON com \\uFEFF = os mesmos bytes")
})

await test("H5 — CAMINHO FELIZ: 201 com o corpo EXATO {ok,created,importId,fileSha256,fileName,fileBytes,createdAt}; o GET lista e mostra o uso; o MESMO arquivo de novo ⇒ 200 created:false e a cota NÃO sobe", async () => {
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "FREE" })
  const r = await post(ctx, FILES[0]); assert.equal(r.status, 201); assert.equal(r.headers.get("cache-control"), "no-store")
  const j = await body(r); assert.deepEqual(Object.keys(j).sort(), ["created", "createdAt", "fileBytes", "fileName", "fileSha256", "importId", "ok"])
  assert.equal(j.ok, true); assert.equal(j.created, true); assert.equal(j.fileName, "export.csv"); assert.equal(j.fileBytes, Buffer.byteLength(FILES[0])); assert.match(j.fileSha256, /^[0-9a-f]{64}$/); assert.match(j.importId, /^imp_[0-9a-f]+$/); assert.equal(Number.isNaN(Date.parse(j.createdAt)), false)
  const g = await handleImportsGet(ctx, new Request(URL_BASE)); assert.equal(g.status, 200); const gj = await body(g)
  assert.deepEqual(Object.keys(gj).sort(), ["imports", "usage"]); assert.equal(gj.imports.length, 1); assert.deepEqual(Object.keys(gj.imports[0]).sort(), ["createdAt", "fileBytes", "fileName", "fileSha256", "importId"])
  assert.deepEqual([gj.usage.files, gj.usage.bytes, gj.usage.limits.files, gj.usage.remaining.files], [1, j.fileBytes, 2, 1]); assert.equal(jstr(gj).includes("sourceTz"), false, "o contexto do usuário não vai na listagem")
  const again = await post(ctx, FILES[0]); assert.equal(again.status, 200); const aj = await body(again); assert.deepEqual([aj.created, aj.fileSha256, aj.createdAt], [false, j.fileSha256, j.createdAt], "createdAt original preservado")
  assert.equal((await body(await handleImportsGet(ctx, new Request(URL_BASE)))).usage.files, 1, "o reenvio não consumiu cota")
})

await test("H6 — COTA: o 3º arquivo do Free ⇒ 403 {error,upgrade:true,suggestedPlan:'TRADER',code,resource,limit,used} e NADA gravado; o plano é lido A CADA pedido (promover vale no pedido seguinte)", async () => {
  const rig = mkRig(); let plan: string = "FREE"; const { ctx, log } = mkCtx(rig, { plan: () => plan })
  assert.equal((await post(ctx, FILES[0])).status, 201); assert.equal((await post(ctx, FILES[1])).status, 201)
  const before = { ...rig.calls }
  const r = await post(ctx, FILES[2]); assert.equal(r.status, 403); const j = await body(r)
  assert.deepEqual(Object.keys(j).sort(), ["code", "error", "limit", "ok", "resource", "suggestedPlan", "upgrade", "used"]); assert.deepEqual([j.ok, j.code, j.resource, j.limit, j.used, j.suggestedPlan, j.upgrade], [false, "QUOTA_EXCEEDED", "files", 2, 2, "TRADER", true]); assert.equal(typeof j.error, "string")
  assert.deepEqual([rig.calls.rawPut, rig.calls.importPut], [before.rawPut, before.importPut], "nada gravado")
  plan = "TRADER"; assert.equal((await post(ctx, FILES[2])).status, 201, "promovido ⇒ passa já no pedido seguinte")
  plan = "FREE"; assert.equal((await post(ctx, FILES[3])).status, 403, "rebaixado ⇒ barrado já no pedido seguinte")
  assert.equal(log.planCalls, 5, "o plano foi consultado em TODO pedido"); assert.ok(log.plans.every((u) => u === UA))
  const huge = await post(ctx, "x".repeat(5 * MIB)); assert.equal(huge.status, 413, "acima de 4 MiB ⇒ 413 antes da cota")
})

await test("H7 — MAPA DE ERROS: cada falha vira o status/código previstos; falha do R2/banco ⇒ 500 STORAGE_ERROR genérico; plano inválido ⇒ 500 sem I/O; um marcador de segredo na exceção NUNCA aparece na resposta", async () => {
  const sec = (code: string, status: number, mk: () => Rig, req: () => Request, plan: unknown = "PRO"): Promise<void> => (async () => {
    const rig = mk(); const { ctx } = mkCtx(rig, { plan }); const r = await handleImportPost(ctx, req()); const t = await r.text(); const j = JSON.parse(t)
    assert.equal(r.status, status, `${code}: ${t}`); assert.equal(j.code, code, t); assert.equal(j.ok, false); for (const leak of [SECRET, "SEGREDO", "postgres://", "senha", "r2", "export.csv"]) assert.equal(t.includes(leak), false, `${code}: vazou ${leak}`)
  })()
  await sec("STORAGE_ERROR", 500, () => mkRig({ raw: { put: async () => ({ ok: false, code: "STORAGE_ERROR" }) } }), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: CTX_USER }))
  await sec("STORAGE_ERROR", 500, () => mkRig({ raw: { put: async () => { throw new Error(SECRET) } } }), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: CTX_USER }))
  await sec("STORAGE_ERROR", 500, () => mkRig({ imp: { put: async () => { throw new Error(SECRET) } } }), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: CTX_USER }))
  await sec("STORAGE_ERROR", 500, () => mkRig({ imp: { list: async () => { throw new Error(SECRET) } } }), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: CTX_USER }))
  await sec("STORAGE_ERROR", 500, () => mkRig(), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: CTX_USER }), "ENTERPRISE")
  await sec("STORAGE_ERROR", 500, () => mkRig(), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: CTX_USER }), null)
  await sec("PIPELINE_FAILED", 422, () => mkRig(), () => jsonReq({ text: "isto não é um csv de trades\nlinha 2", fileName: "export.csv", context: CTX_USER }))
  await sec("INVALID_ARGS", 400, () => mkRig(), () => jsonReq({ text: FILES[0], fileName: "export.csv", context: { sourceTz: 5 } }))
  // contexto em conflito: o MESMO arquivo reenviado com OUTRO contexto ⇒ 409
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "PRO" }); assert.equal((await post(ctx, FILES[0])).status, 201)
  const c = await post(ctx, FILES[0], { context: { sourceTz: "America/Sao_Paulo" } }); assert.equal(c.status, 409); assert.equal((await body(c)).code, "CONTEXT_CONFLICT")
  // plano inválido: nenhuma dependência tocada
  const r2 = mkRig(); const { ctx: bad } = mkCtx(r2, { plan: "ENTERPRISE" }); await handleImportPost(bad, jsonReq({ text: FILES[0], context: CTX_USER })); assert.deepEqual(r2.calls, { rawPut: 0, importPut: 0, salts: 0 }, "plano inválido ⇒ nada tocado")
  // GET também não vaza
  const g = await handleImportsGet(mkCtx(mkRig({ imp: { list: async () => { throw new Error(SECRET) } } }), { plan: "PRO" }).ctx, new Request(URL_BASE)); assert.equal(g.status, 500); assert.equal((await g.text()).includes("SEGREDO"), false)
})

await test("H8 — ISOLAMENTO e DELETE: o usuário B não vê (GET) nem apaga (DELETE) o arquivo do A — 404 idêntico ao do inexistente; apagar o próprio libera a cota; sha inválido ⇒ 400", async () => {
  const rig = mkRig(); const A = mkCtx(rig, { userId: UA, plan: "FREE" }).ctx, B = mkCtx(rig, { userId: UB, plan: "FREE" }).ctx
  const j = await body(await post(A, FILES[0])); await post(A, FILES[1])
  const gb = await body(await handleImportsGet(B, new Request(URL_BASE))); assert.deepEqual([gb.imports, gb.usage.files], [[], 0], "o B não vê nada do A")
  const del = (c: AiPartnerCtx, sha: string): Promise<Response> => handleImportDelete(c, new Request(`${URL_BASE}/${sha}`, { method: "DELETE" }), sha)
  const cross = await del(B, j.fileSha256), ghost = await del(B, "f".repeat(64)); assert.equal(cross.status, 404); assert.equal(ghost.status, 404); assert.equal(await cross.text(), await ghost.text(), "404 igual: sem revelar existência")
  // IDOR clássico: o B tenta se passar pelo A pela URL (?userId=…); a identidade é SÓ a da sessão
  for (const q of [`?userId=${UA}`, `?user=${UA}`, `?id=${UA}&userId=${UA}`]) {
    const gq = await body(await handleImportsGet(B, new Request(`${URL_BASE}${q}`))); assert.deepEqual(gq.imports, [], `GET ${q}: segue sendo o B`)
    const dq = await handleImportDelete(B, new Request(`${URL_BASE}/${j.fileSha256}${q}`, { method: "DELETE" }), j.fileSha256); assert.equal(dq.status, 404, `DELETE ${q}`)
    const pq = await handleImportPost(B, jsonReq({ text: FILES[5], context: CTX_USER, userId: UA })); assert.equal(pq.status, 201, "POST com userId no corpo: ignorado"); assert.equal(((await rig.imp.get(UA, (await body(pq)).fileSha256)) as Any).ok, false, "o arquivo foi para o B, não para o A")
    await handleImportDelete(B, new Request(`${URL_BASE}/${(await rig.imp.list(UB) as Any).rows[0]?.fileSha256 ?? "a".repeat(64)}`, { method: "DELETE" }), (await rig.imp.list(UB) as Any).rows[0]?.fileSha256 ?? "a".repeat(64))
  }
  assert.equal(((await rig.imp.get(UA, j.fileSha256)) as Any).ok, true, "o arquivo do A segue lá"); assert.equal(((await rig.raw.get(UA, j.fileSha256)) as Any).ok, true)
  assert.equal((await post(A, FILES[2])).status, 403, "o A está na cota")
  const mine = await del(A, j.fileSha256); assert.equal(mine.status, 200); assert.deepEqual(await body(mine), { ok: true, deleted: true }); assert.equal(((await rig.raw.get(UA, j.fileSha256)) as Any).ok, false, "o arquivo do R2 também saiu")
  assert.equal((await post(A, FILES[2])).status, 201, "apagar liberou a cota")
  for (const bad of ["abc", "../x", "A".repeat(64), "g".repeat(64), "", "a".repeat(63)]) assert.equal((await del(A, bad)).status, 400, `sha inválido ${bad}`)
  assert.equal((await post(B, FILES[0])).status, 201, "o B pode enviar o MESMO conteúdo: é o arquivo DELE (outra chave)")
})

await test("H9 — LIMITE DE TAXA: excedeu ⇒ 429 com Retry-After e NADA é processado (POST e DELETE); o limitador é consultado POR USUÁRIO; o GET não é limitado", async () => {
  const rig = mkRig(); const { ctx, log } = mkCtx(rig, { plan: "PRO", limit: { ok: false, retryAfterSec: 7 } })
  const r = await post(ctx, FILES[0]); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "7"); assert.equal((await body(r)).code, "RATE_LIMITED")
  const d = await handleImportDelete(ctx, new Request(`${URL_BASE}/${"a".repeat(64)}`, { method: "DELETE" }), "a".repeat(64)); assert.equal(d.status, 429)
  assert.deepEqual([rig.calls, log.planCalls], [{ rawPut: 0, importPut: 0, salts: 0 }, 0], "nada processado"); assert.deepEqual(log.limited, [UA, UA], "por usuário")
  assert.equal((await handleImportsGet(ctx, new Request(URL_BASE))).status, 200, "o GET não é limitado")
})

await test("H10 — CSRF: Origin de outro site (ou 'null', ou outra porta/protocolo) ⇒ 403 sem processar (POST e DELETE); Origin igual ao do pedido ou ausente passa", async () => {
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "PRO" })
  for (const origin of ["https://evil.example", "null", "http://app.test", "https://app.test:8443", "https://app.test.evil.example", "https://sub.app.test"]) {
    const r = await post(ctx, FILES[0], {}, { origin }); assert.equal(r.status, 403, origin); assert.equal((await body(r)).code, "FORBIDDEN_ORIGIN")
    const d = await handleImportDelete(ctx, new Request(`${URL_BASE}/${"a".repeat(64)}`, { method: "DELETE", headers: { origin } }), "a".repeat(64)); assert.equal(d.status, 403, `DELETE ${origin}`)
  }
  assert.deepEqual(rig.calls, { rawPut: 0, importPut: 0, salts: 0 }, "nada processado")
  assert.equal((await post(ctx, FILES[0], {}, { origin: "https://app.test" })).status, 201, "mesma origem passa"); assert.equal((await post(ctx, FILES[1])).status, 201, "sem Origin passa")
})

await test("H11 — NOME DO ARQUIVO: caminho removido (../x/y.csv ⇒ y.csv; C:\\d\\z.csv ⇒ z.csv; o nome do multipart serve quando não há fileName); > 255, NUL e controle ⇒ 400; o nome NUNCA aparece nas mensagens de erro", async () => {
  const rig = mkRig(); const { ctx } = mkCtx(rig, { plan: "PRO" })
  const names: Array<[string, string]> = [["../x/y.csv", "y.csv"], ["C:\\dir\\z.csv", "z.csv"], ["a/b/c/d.csv", "d.csv"], ["simples.csv", "simples.csv"]]
  for (const [i, [given, stored]] of names.entries()) { const r = await post(ctx, FILES[i], { fileName: given }); assert.equal(r.status, 201, given); assert.equal((await body(r)).fileName, stored) }
  const mp = await handleImportPost(ctx, formReq(FILES[4], "../../etc/passwd.csv", { context: jstr(CTX_USER) })); assert.equal((await body(mp)).fileName, "passwd.csv", "multipart: o nome do arquivo sem caminho")
  const nameless = await post(ctx, FILES[5], { fileName: undefined }); assert.equal((await body(nameless)).fileName, null)
  for (const bad of ["x".repeat(256) + ".csv", "a\u0000b.csv", "a\nb.csv", "a\u0007.csv", "dir/", "..", ".", ""]) { const r = await post(ctx, FILES[0], { fileName: bad }); assert.equal(r.status, 400, jstr(bad).slice(0, 30)); if (bad.length > 3) assert.equal((await r.text()).includes(bad), false, "o erro não ecoa o nome (só nomes distintivos: \".\" casaria com o ponto final da mensagem)") }
  const marker = "MARCADOR-DE-NOME-123.csv"; const e = await handleImportPost(ctx, jsonReq({ text: "isto não é csv", fileName: marker, context: CTX_USER })); assert.equal((await e.text()).includes("MARCADOR"), false, "erro não ecoa o nome")
})

await test("H12 — NÃO CONFIGURADO: sem dependências ⇒ 503 NOT_CONFIGURED (POST/GET/DELETE) SEM tocar em plano/limite/nada; buildAiPartnerDeps com ambiente válido monta tudo; ambiente inválido, ausente ou cliente inválido ⇒ NOT_CONFIGURED sem eco e sem lançar", async () => {
  const { ctx, log } = mkCtx(null)
  for (const r of [await handleImportPost(ctx, jsonReq({ text: FILES[0], context: CTX_USER })), await handleImportsGet(ctx, new Request(URL_BASE)), await handleImportDelete(ctx, new Request(`${URL_BASE}/${"a".repeat(64)}`, { method: "DELETE" }), "a".repeat(64))]) { assert.equal(r.status, 503); const j = await body(r); assert.deepEqual(j, { ok: false, code: "NOT_CONFIGURED", error: j.error }); assert.equal(typeof j.error, "string") }
  assert.deepEqual([log.planCalls, log.limited.length], [0, 0])
  const port: Any = { $transaction: async (f: Any) => f(port) }; for (const m of ["aiUserSalt", "aiImportSource", "aiConversation", "aiConversationDelta"]) port[m] = { findUnique: async () => null, findMany: async () => [], create: async () => ({}), updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) }
  const ENV = { R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_BUCKET: "test-bucket", R2_ACCESS_KEY_ID: "fedcba9876543210fedcba9876543210", R2_SECRET_ACCESS_KEY: "cd".repeat(32), SALT_MASTER_KEY: KEY }
  const ok: Any = buildAiPartnerDeps(ENV, port); assert.equal(ok.ok, true, jstr(ok)); for (const k of ["rawStorage", "importStore", "salts"]) assert.equal(typeof ok.deps[k], "object", k); assert.equal(typeof ok.deps.rawStorage.put, "function")
  for (const k of Object.keys(ENV)) { const r: Any = buildAiPartnerDeps(Object.fromEntries(Object.entries(ENV).filter(([x]) => x !== k)), port); assert.deepEqual(r, { ok: false, code: "NOT_CONFIGURED" }, `sem ${k}`) }
  for (const [why, env] of [["R2 inválido", { ...ENV, R2_BUCKET: "AB" }], ["chave mestra curta", { ...ENV, SALT_MASTER_KEY: "abc" }], ["chave toda zero", { ...ENV, SALT_MASTER_KEY: "00".repeat(32) }], ["env nulo", null], ["env string", "x"]] as Array<[string, Any]>) { const r: Any = buildAiPartnerDeps(env, port); assert.deepEqual(r, { ok: false, code: "NOT_CONFIGURED" }, why); for (const v of Object.values(env ?? {})) if (typeof v === "string" && v.length > 6) assert.equal(jstr(r).includes(v), false, `${why}: eco`) }
  for (const badPort of [null, undefined, {}, "x"]) assert.deepEqual(buildAiPartnerDeps(ENV, badPort as Any), { ok: false, code: "NOT_CONFIGURED" }, `prisma ${jstr(badPort)}`)
})

await test("H13 — SAL: o primeiro envio de um usuário novo cria o sal (1 linha no SaltStore) e funciona; os seguintes reutilizam (continua 1 linha); outra chave mestra sobre o mesmo store ⇒ erro genérico sem gravar o arquivo", async () => {
  const saltStore = createMemorySaltStore(); const rig = mkRig({ saltStore }); const { ctx } = mkCtx(rig, { plan: "PRO" })
  assert.equal(((await saltStore.loadUser(UA)) as Any).rows.length, 0, "usuário novo: sem sal")
  assert.equal((await post(ctx, FILES[0])).status, 201); assert.equal(((await saltStore.loadUser(UA)) as Any).rows.length, 1, "o sal nasceu no 1º envio")
  assert.equal((await post(ctx, FILES[1])).status, 201); assert.equal(((await saltStore.loadUser(UA)) as Any).rows.length, 1, "o 2º reutiliza")
  const other = mkRig({ saltStore, key: "cd".repeat(32) }); const { ctx: c2 } = mkCtx(other, { plan: "PRO" })
  const r = await post(c2, FILES[2]); assert.ok(r.status >= 500, `status ${r.status}`); const t = await r.text(); assert.equal(JSON.parse(t).code === "STORAGE_ERROR" || JSON.parse(t).code === "NOT_CONFIGURED", true, t); assert.equal(other.calls.rawPut, 0, "nada gravado no R2 com a chave errada"); assert.equal(t.includes("cd".repeat(8)), false)
  const keyring = new InMemorySaltKeyring(); assert.equal(typeof keyring.ensure, "function")
})

await test("H14 — ESTÁTICA: tratador e montador importam só módulos de infra/plans (sem next, @/auth, @prisma/client, process.env, node:, fetch); as rotas do Next são FINAS (só ligam) e exportam só GET/POST/DELETE; a rota antiga /api/trades/import está intacta; ninguém além das rotas importa o tratador", async () => {
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const handler = read("src/lib/infra/ai-partner-imports.ts"), deps = read("src/lib/infra/ai-partner-deps.ts")
  const HANDLER_OK = ["../plans.ts", "./bundle-cache.ts", "./dataset.ts", "./import-quota.ts", "./import-source-store.ts", "./raw-file-storage.ts", "./salt-store.ts", "./user-purge.ts"]
  for (const i of importsOf(handler)) assert.ok(HANDLER_OK.includes(i), `o tratador importa ${i}`)
  const DEPS_OK = ["./bundle-cache.ts", "./cipher.ts", "./import-source-store.ts", "./object-store-r2.ts", "./prisma-conversation-store.ts", "./prisma-import-source-store.ts", "./prisma-port.ts", "./prisma-salt-store.ts", "./raw-file-storage-object.ts", "./raw-file-storage.ts", "./salt-store.ts", "./ai-partner-imports.ts"]
  for (const i of importsOf(deps)) assert.ok(DEPS_OK.includes(i), `o montador importa ${i}`)
  for (const [n, code] of [["tratador", handler], ["montador", deps]]) assert.equal(/from\s+["'](next|@\/|@prisma|node:)|process\.env|\bfetch\s*\(|\bnew PrismaClient\b/.test(code), false, `${n}: dependência proibida`)
  const routes: Array<[string, string[]]> = [["src/app/api/ai-partner/imports/route.ts", ["GET", "POST"]], ["src/app/api/ai-partner/imports/[sha]/route.ts", ["DELETE"]]]
  for (const [f, methods] of routes) {
    const src = readFileSync(`${ROOT}${f}`, "utf8"); const code = strip(src)
    assert.deepEqual([...code.matchAll(/^export\s+(?:async\s+function|const)\s+(\w+)/gm)].map((m) => m[1]).sort(), methods.sort(), `${f}: só exporta ${methods}`)
    assert.ok(src.split("\n").length <= 70, `${f}: rota fina (≤ 70 linhas)`)
    for (const bad of ["registerImport", "getImportUsage", "QUOTA", "TextDecoder", "formData", "arrayBuffer", "sha256", "PLAN_IMPORT"]) assert.equal(code.includes(bad), false, `${f}: regra de negócio na rota (${bad})`)
    assert.match(code, /from\s+["']\.\.\/(?:\.\.\/)?_ctx["']/, `${f}: usa a ligação compartilhada`); assert.match(code, /from\s+["']@\/lib\/infra\/ai-partner-imports["']/)
  }
  const ctxSrc = readFileSync(`${ROOT}src/app/api/ai-partner/_ctx.ts`, "utf8"), ctxCode = strip(ctxSrc)
  for (const must of ["@/auth", "@/lib/prisma", "@/lib/rate-limit", "@/lib/infra/ai-partner-deps"]) assert.ok(ctxCode.includes(`"${must}"`), `_ctx.ts liga ${must}`)
  assert.ok(ctxSrc.split("\n").length <= 45, "a ligação é fina (≤ 45 linhas)"); assert.equal(/registerImport|getImportUsage|TextDecoder|formData/.test(ctxCode), false, "_ctx.ts sem regra de negócio")
  assert.equal(sha256(readFileSync(`${ROOT}src/app/api/trades/import/route.ts`, "utf8")), "b2842dcddc384a7f16f05c2e0f9060b1a85e63ad089b6acba5e8b1796b551e24", "a rota antiga de trades NÃO foi tocada")
  for (const dir of ["agent", "agent-capabilities", "evidence", "metrics", "ingest", "domain"]) for (const f of readdirSync(`${ROOT}src/lib/${dir}`).filter((x) => x.endsWith(".ts"))) assert.equal(/ai-partner-imports|ai-partner-deps/.test(read(`src/lib/${dir}/${f}`)), false, `${dir}/${f}`)
  for (const f of readdirSync(`${ROOT}src/lib/infra`).filter((x) => x.endsWith(".ts") && !x.startsWith("ai-partner-"))) assert.equal(/ai-partner-imports/.test(read(`src/lib/infra/${f}`)), false, `infra/${f}`)
})

if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes da fiação da ingestão passaram.`)
