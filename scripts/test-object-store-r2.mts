// E7-11: cliente S3/R2 que implementa a porta ObjectStore (infra/object-store-r2.ts), SigV4 próprio sem SDK. Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_11
// (D-R1…D-R7; R1–R9 aqui contra um servidor S3 FALSO que reverifica a assinatura, R10 AO VIVO só com R2_LIVE=1; a suíte de contrato C1–C12 roda também na 4ª implementação em test-raw-file-storage.mts; mutações ER1–ER18).
//   node scripts/test-object-store-r2.mts            (offline, determinístico)
//   R2_LIVE=1 node scripts/test-object-store-r2.mts  (também o R10 contra o R2 de verdade, usando .env.local; apaga o que criar)
//   COLLECT=1 só para a análise de mutações.
import assert from "node:assert/strict"
import { createHmac, createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { inspect } from "node:util"
import { fileURLToPath } from "node:url"
import { R2_MAX_LIST_PAGES, createR2ObjectStore, loadR2Config, sigV4Authorization, type R2Config } from "../src/lib/infra/object-store-r2.ts"
import { createFakeS3 } from "./_fake-s3.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const ENV = { R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_BUCKET: "test-bucket", R2_ACCESS_KEY_ID: "fedcba9876543210fedcba9876543210", R2_SECRET_ACCESS_KEY: "ab".repeat(32) }
const SECRET = ENV.R2_SECRET_ACCESS_KEY
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const dec = (b: Uint8Array): string => new TextDecoder().decode(b)
const FAIL = (code: string): Any => ({ ok: false, code })
const loadCfg = (env: Record<string, string> = ENV): R2Config => { const r: Any = loadR2Config(env); assert.equal(r.ok, true, JSON.stringify(r)); return r.config }
const mk = (opts: { fake?: Parameters<typeof createFakeS3>[1]; client?: { timeoutMs?: number }; config?: R2Config } = {}): { store: ReturnType<typeof createR2ObjectStore>; fake: ReturnType<typeof createFakeS3>; cfg: R2Config } => {
  const cfg = opts.config ?? loadCfg()
  const fake = createFakeS3({ accountId: ENV.R2_ACCOUNT_ID, bucket: ENV.R2_BUCKET, accessKeyId: ENV.R2_ACCESS_KEY_ID, secretAccessKey: SECRET }, opts.fake)
  return { store: createR2ObjectStore(cfg, { fetch: fake.fetch as Any, ...(opts.client ?? {}) }), fake, cfg }
}
const objUrl = (key: string): string => `https://${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${ENV.R2_BUCKET}/${key}`
const methods = (fake: ReturnType<typeof createFakeS3>): string[] => fake.log.map((r) => r.method)

// ───────────────────────────── R1: assinatura ─────────────────────────────
await test("R1 — SigV4: o vetor OFICIAL da AWS ('get-vanilla') dá a assinatura exata; a assinatura muda com data, região, serviço, chave, método, caminho, query e cabeçalhos; 60 requisições aleatórias batem com uma implementação independente", async () => {
  const base = { method: "GET", path: "/", query: {}, headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" }, payloadHash: createHash("sha256").update("").digest("hex"), accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", amzDate: "20150830T123600Z", region: "us-east-1", service: "service" }
  const v = sigV4Authorization(base)
  assert.equal(v.signature, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31")
  assert.equal(v.authorization, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31")
  const variants: Array<[string, Any]> = [["data", { ...base, amzDate: "20150830T123601Z", headers: { ...base.headers, "x-amz-date": "20150830T123601Z" } }], ["dia do escopo", { ...base, amzDate: "20150831T123600Z", headers: { ...base.headers, "x-amz-date": "20150831T123600Z" } }], ["região", { ...base, region: "auto" }], ["serviço", { ...base, service: "s3" }],
    ["secret", { ...base, secretAccessKey: base.secretAccessKey + "x" }], ["método", { ...base, method: "PUT" }], ["caminho", { ...base, path: "/a" }], ["query", { ...base, query: { a: "1" } }], ["cabeçalho", { ...base, headers: { ...base.headers, "x-extra": "1" } }], ["host", { ...base, headers: { ...base.headers, host: "other.example.com" } }], ["hash do corpo", { ...base, payloadHash: "0".repeat(64) }]]
  const seen = new Set([v.signature])
  for (const [why, a] of variants) { const s = sigV4Authorization(a).signature; assert.equal(seen.has(s), false, `a assinatura não mudou com: ${why}`); seen.add(s) }
  // propriedade: igual a uma implementação independente (aqui, no teste)
  const ref = (a: Any): string => {
    const names = Object.keys(a.headers).map((n) => n.toLowerCase()).sort(); const h = Object.fromEntries(Object.entries(a.headers).map(([k, x]) => [k.toLowerCase(), x]))
    const e = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    const q = Object.entries(a.query as Record<string, string>).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => `${e(k)}=${e(x)}`).join("&")
    const canon = [a.method, a.path, q, names.map((n) => `${n}:${String(h[n]).trim()}\n`).join(""), names.join(";"), a.payloadHash].join("\n")
    const date = a.amzDate.slice(0, 8), scope = `${date}/${a.region}/${a.service}/aws4_request`
    const toSign = ["AWS4-HMAC-SHA256", a.amzDate, scope, createHash("sha256").update(canon).digest("hex")].join("\n")
    const k = [date, a.region, a.service, "aws4_request"].reduce<Buffer>((acc, d) => createHmac("sha256", acc).update(d).digest(), Buffer.from(`AWS4${a.secretAccessKey}`))
    return createHmac("sha256", k).update(toSign).digest("hex")
  }
  for (let i = 0; i < 60; i++) {
    const r = (): string => randomBytes(4).toString("hex")
    const a = { method: ["GET", "PUT", "DELETE", "HEAD"][i % 4], path: `/b/${r()}/${r()}.csv.gz`, query: i % 3 === 0 ? { "list-type": "2", prefix: `users/${r()}/`, "continuation-token": `${r()}==` } : {}, headers: { host: `${r()}.example.com`, "x-amz-date": "20261020T143000Z", "x-amz-content-sha256": r().padEnd(64, "0"), ...(i % 5 === 0 ? { "if-none-match": "*" } : {}) }, payloadHash: r().padEnd(64, "1"), accessKeyId: r(), secretAccessKey: r() + r(), amzDate: "20261020T143000Z", region: "auto", service: "s3" }
    assert.equal(sigV4Authorization(a).signature, ref(a), `requisição ${i}`)
  }
})

// ───────────────────────────── R2: putIfAbsent ─────────────────────────────
await test("R2 — putIfAbsent: 200 ⇒ created:true; a MESMA chave de novo ⇒ 412 ⇒ created:false SEM sobrescrever; If-None-Match:* vai ASSINADO; URL path-style com o bucket; corpo exato; 401/403/500/forma estranha ⇒ STORAGE_ERROR", async () => {
  const { store, fake } = mk(); const a = enc("conteúdo-A"), b = enc("conteúdo-B-diferente")
  assert.deepEqual(await store.putIfAbsent("users/u1/imports/x.csv.gz", a), { ok: true, created: true })
  assert.deepEqual(await store.putIfAbsent("users/u1/imports/x.csv.gz", b), { ok: true, created: false })
  assert.equal(dec(fake.objects.get("users/u1/imports/x.csv.gz")!), "conteúdo-A", "o original permanece")
  const first = fake.log[0]
  assert.equal(first.method, "PUT"); assert.equal(first.url, objUrl("users/u1/imports/x.csv.gz"))
  assert.equal(Object.entries(first.headers).find(([k]) => k.toLowerCase() === "if-none-match")?.[1], "*")
  assert.match(Object.entries(first.headers).find(([k]) => k.toLowerCase() === "authorization")![1], /SignedHeaders=[^,]*if-none-match/)
  assert.deepEqual([...first.body!], [...a], "corpo enviado == corpo pedido")
  for (const status of [401, 403, 500, 503, 429]) {
    const m = mk(); m.fake.faults.push({ when: () => true, respond: () => new Response("<Error><Code>X</Code></Error>", { status }), times: 1 })
    assert.deepEqual(await m.store.putIfAbsent("k/1", a), FAIL("STORAGE_ERROR"), `HTTP ${status}`)
  }
  const odd = mk(); odd.fake.faults.push({ when: () => true, respond: () => new Response(null, { status: 302 }), times: 1 }); assert.deepEqual(await odd.store.putIfAbsent("k/1", a), FAIL("STORAGE_ERROR"), "status inesperado")
  const wrong = mk({ config: loadCfg({ ...ENV, R2_SECRET_ACCESS_KEY: "cd".repeat(32) }) }); assert.deepEqual(await wrong.store.putIfAbsent("k/1", a), FAIL("STORAGE_ERROR"), "assinatura rejeitada (403)")
})

// ───────────────────────────── R3: get ─────────────────────────────
await test("R3 — get: 200 devolve CÓPIA; 404 ⇒ NOT_FOUND; 403/500/rede/timeout ⇒ STORAGE_ERROR; Content-Length acima do teto ⇒ STORAGE_ERROR SEM ler o corpo", async () => {
  const { store, fake } = mk(); await store.putIfAbsent("k/1", enc("olá R2"))
  const g1: Any = await store.get("k/1"); assert.equal(dec(g1.bytes), "olá R2"); g1.bytes.fill(0)
  assert.equal(dec(((await store.get("k/1")) as Any).bytes), "olá R2", "cópia: mutar o devolvido não muda nada")
  assert.deepEqual(await store.get("k/ausente"), FAIL("NOT_FOUND"))
  for (const status of [401, 403, 500, 503]) { fake.faults.push({ when: (r) => r.method === "GET", respond: () => new Response("x", { status }), times: 1 }); assert.deepEqual(await store.get("k/1"), FAIL("STORAGE_ERROR"), `HTTP ${status}`) }
  fake.faults.push({ when: (r) => r.method === "GET", respond: "throw", times: 1 }); assert.deepEqual(await store.get("k/1"), FAIL("STORAGE_ERROR"), "rede")
  let pulled = false
  fake.faults.push({ when: (r) => r.method === "GET", respond: () => new Response(new ReadableStream({ pull(c) { pulled = true; c.enqueue(new Uint8Array(8)); c.close() } }, { highWaterMark: 0 }), { status: 200, headers: { "content-length": String(40 * 1024 * 1024) } }), times: 1 })
  assert.deepEqual(await store.get("k/1"), FAIL("STORAGE_ERROR"), "corpo declarado gigante"); assert.equal(pulled, false, "o corpo NÃO foi lido")
  const slow = mk({ client: { timeoutMs: 40 } }); slow.fake.faults.push({ when: () => true, respond: "hang", times: 1 })
  const t0 = Date.now(); assert.deepEqual(await slow.store.get("k/1"), FAIL("STORAGE_ERROR"), "timeout"); assert.ok(Date.now() - t0 < 2000, "o timeout é respeitado")
})

// ───────────────────────────── R4: delete ─────────────────────────────
await test("R4 — delete: HEAD 404 ⇒ existed:false SEM DELETE; HEAD 200 ⇒ DELETE ⇒ existed:true (e o objeto some); falha no HEAD ou no DELETE ⇒ STORAGE_ERROR", async () => {
  const { store, fake } = mk(); await store.putIfAbsent("k/1", enc("x"))
  assert.deepEqual(await store.delete("k/ausente"), { ok: true, existed: false }); assert.deepEqual(methods(fake).slice(1), ["HEAD"], "só o HEAD")
  fake.log.length = 0
  assert.deepEqual(await store.delete("k/1"), { ok: true, existed: true }); assert.deepEqual(methods(fake), ["HEAD", "DELETE"]); assert.equal(fake.objects.has("k/1"), false)
  await store.putIfAbsent("k/2", enc("x"))
  fake.faults.push({ when: (r) => r.method === "HEAD", respond: () => new Response(null, { status: 500 }), times: 1 }); assert.deepEqual(await store.delete("k/2"), FAIL("STORAGE_ERROR")); assert.equal(fake.objects.has("k/2"), true, "nada apagado")
  fake.faults.push({ when: (r) => r.method === "DELETE", respond: () => new Response(null, { status: 500 }), times: 1 }); assert.deepEqual(await store.delete("k/2"), FAIL("STORAGE_ERROR"))
  assert.deepEqual(await store.delete("k/2"), { ok: true, existed: true })
})

// ───────────────────────────── R5: deleteByPrefix ─────────────────────────────
await test("R5 — deleteByPrefix: 2.500 chaves em 3 páginas, 1 DELETE por chave, concorrência ≤ 8, contagem exata, outros prefixos intactos; falha no meio ⇒ STORAGE_ERROR e a repetição conclui; resposta com chave fora do prefixo, XML hostil ou paginação infinita ⇒ STORAGE_ERROR sem apagar", async () => {
  const fill = (fake: ReturnType<typeof createFakeS3>): void => {
    for (let i = 0; i < 2500; i++) fake.objects.set(`users/u1/imports/${String(i).padStart(5, "0")}.csv.gz`, enc("x"))
    for (const k of ["users/u2/imports/a.csv.gz", "users/u2/imports/b.csv.gz", "users/u10/imports/a.csv.gz", "users/u1x/imports/a.csv.gz"]) fake.objects.set(k, enc("outro"))
  }
  const { store, fake } = mk(); fill(fake)
  assert.deepEqual(await store.deleteByPrefix("users/u1/"), { ok: true, deleted: 2500 })
  assert.equal(methods(fake).filter((m) => m === "GET").length, 3, "3 páginas de LIST"); assert.equal(methods(fake).filter((m) => m === "DELETE").length, 2500, "1 DELETE por chave")
  const lists = fake.log.filter((r) => r.method === "GET").map((r) => r.url)
  assert.deepEqual(lists.map((u) => u.includes("continuation-token=")), [false, true, true], "a 1ª página sem token; a 2ª e a 3ª COM o token da anterior"); assert.ok(lists.every((u) => u.includes("list-type=2") && u.includes("prefix=users%2Fu1%2F")))
  assert.ok(fake.stats.maxInFlightDeletes <= 8, `concorrência ${fake.stats.maxInFlightDeletes}`); assert.ok(fake.stats.maxInFlightDeletes >= 2, "e usa paralelismo")
  assert.deepEqual([...fake.objects.keys()].sort(), ["users/u10/imports/a.csv.gz", "users/u1x/imports/a.csv.gz", "users/u2/imports/a.csv.gz", "users/u2/imports/b.csv.gz"], "só o prefixo pedido (a barra final protege u10/u1x)")
  assert.deepEqual(await store.deleteByPrefix("users/u1/"), { ok: true, deleted: 0 }, "idempotente")
  // falha no meio
  const m = mk(); fill(m.fake); m.fake.faults.push({ when: (r) => r.method === "DELETE" && r.url.endsWith("/01500.csv.gz"), respond: () => new Response(null, { status: 500 }), times: 1 })
  assert.deepEqual(await m.store.deleteByPrefix("users/u1/"), FAIL("STORAGE_ERROR"))
  const left = [...m.fake.objects.keys()].filter((k) => k.startsWith("users/u1/")).length; assert.ok(left > 0 && left < 2500, `parcial (sobraram ${left})`)
  assert.deepEqual(await m.store.deleteByPrefix("users/u1/"), { ok: true, deleted: left }, "a repetição conclui e conta só o que restava")
  // respostas hostis do LIST: nada é apagado
  const hostile: Array<[string, string]> = [["chave fora do prefixo", `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>users/u2/imports/a.csv.gz</Key></Contents></ListBucketResult>`], ["caminho com ..", `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>users/u1/../u2/a</Key></Contents></ListBucketResult>`], ["entidade/caractere estranho", `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>users/u1/a&amp;b</Key></Contents></ListBucketResult>`],
    ["lixo", "<<<>>> não é xml"], ["sem ListBucketResult", "<Error><Code>X</Code></Error>"], ["truncado sem token", `<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>users/u1/a</Key></Contents></ListBucketResult>`], ["IsTruncated ausente", `<ListBucketResult><Contents><Key>users/u1/a</Key></Contents></ListBucketResult>`]]
  for (const [why, xml] of hostile) {
    const h = mk(); fill(h.fake); h.fake.faults.push({ when: (r) => r.method === "GET", respond: () => new Response(xml, { status: 200 }), times: 1 })
    const before = h.fake.objects.size
    assert.deepEqual(await h.store.deleteByPrefix("users/u1/"), FAIL("STORAGE_ERROR"), why); assert.equal(h.fake.objects.size, before, `${why}: nada apagado`); assert.equal(methods(h.fake).includes("DELETE"), false, `${why}: nenhum DELETE enviado`)
  }
  const loop = mk(); loop.fake.faults.push({ when: (r) => r.method === "GET", respond: () => new Response(`<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>eA==</NextContinuationToken></ListBucketResult>`, { status: 200 }) })
  assert.deepEqual(await loop.store.deleteByPrefix("users/u1/"), FAIL("STORAGE_ERROR"), "paginação infinita"); assert.equal(methods(loop.fake).length, R2_MAX_LIST_PAGES, "para no teto de páginas")
})

// ───────────────────────────── R6: sem vazamento ─────────────────────────────
await test("R6 — SEM VAZAMENTO: o secret nunca aparece em URL, corpo ou cabeçalho enviados (só a assinatura; a access key só no Authorization) nem em nenhum resultado; fetch que lança 'SEGREDO' ⇒ STORAGE_ERROR sem eco", async () => {
  const { store, fake } = mk()
  const results: unknown[] = []
  results.push(await store.putIfAbsent("k/1", enc("a")), await store.putIfAbsent("k/1", enc("b")), await store.get("k/1"), await store.get("k/x"), await store.delete("k/1"), await store.delete("k/1"), await store.deleteByPrefix("k/"))
  fake.faults.push({ when: () => true, respond: "throw", times: 1 }); results.push(await store.get("k/1"))
  fake.faults.push({ when: () => true, respond: () => new Response(`<Error><Code>SEGREDO</Code><Message>${SECRET}</Message></Error>`, { status: 500 }), times: 1 }); results.push(await store.putIfAbsent("k/2", enc("c")))
  results.push(await mk({ config: loadCfg({ ...ENV, R2_SECRET_ACCESS_KEY: "cd".repeat(32) }) }).store.get("k/1"))
  for (const r of results) { const t = JSON.stringify((r as Any).ok ? { ...(r as object), bytes: undefined } : r); for (const bad of [SECRET, ENV.R2_ACCESS_KEY_ID, "SEGREDO", "r2.cloudflarestorage", ENV.R2_ACCOUNT_ID, ENV.R2_BUCKET]) assert.equal(t.includes(bad), false, `resultado vaza ${bad.slice(0, 6)}…: ${t}`) }
  for (const q of fake.log) {
    for (const [k, v] of Object.entries(q.headers)) { assert.equal(v.includes(SECRET), false, `cabeçalho ${k}`); if (k.toLowerCase() !== "authorization") assert.equal(v.includes(ENV.R2_ACCESS_KEY_ID), false, `a access key só vai no Authorization (${k})`) }
    assert.equal(q.url.includes(SECRET) || q.url.includes(ENV.R2_ACCESS_KEY_ID), false, "URL"); assert.equal(q.body !== null && dec(q.body).includes(SECRET), false, "corpo")
  }
  assert.ok(fake.log.length > 8, "as requisições existiram")
})

// ───────────────────────────── R7: config ─────────────────────────────
await test("R7 — loadR2Config: válida ⇒ ok e CONGELADA; campo ausente/malformado/comprido/maiúsculo ⇒ R2_CONFIG_INVALID sem eco; JSON/String/inspect/spread NÃO mostram o secret; o cliente com ela funciona", async () => {
  const c = loadCfg(); assert.equal(Object.isFrozen(c), true)
  for (const view of [JSON.stringify(c), String(c), inspect(c, { depth: 5 }), JSON.stringify({ ...c }), inspect({ cfg: c }, { depth: 5 })]) assert.equal(view.includes(SECRET), false, `vaza: ${view.slice(0, 80)}`)
  assert.equal(loadCfg({ ...ENV, EXTRA: "ignorado", PATH: "/usr/bin" }).accountId, ENV.R2_ACCOUNT_ID, "variáveis alheias são ignoradas")
  const bad: Array<[string, Any]> = [["env nulo", null], ["env string", "x"], ["env array", []], ...Object.keys(ENV).map((k) => [`sem ${k}`, Object.fromEntries(Object.entries(ENV).filter(([x]) => x !== k))] as [string, Any]),
    ["account curto", { ...ENV, R2_ACCOUNT_ID: "abc" }], ["account maiúsculo", { ...ENV, R2_ACCOUNT_ID: ENV.R2_ACCOUNT_ID.toUpperCase() }], ["account com espaço", { ...ENV, R2_ACCOUNT_ID: ` ${ENV.R2_ACCOUNT_ID}` }], ["access não hex", { ...ENV, R2_ACCESS_KEY_ID: "z".repeat(32) }], ["secret curto", { ...ENV, R2_SECRET_ACCESS_KEY: "ab".repeat(31) }], ["secret longo", { ...ENV, R2_SECRET_ACCESS_KEY: "ab".repeat(33) }],
    ["bucket curto", { ...ENV, R2_BUCKET: "ab" }], ["bucket longo", { ...ENV, R2_BUCKET: "a".repeat(64) }], ["bucket maiúsculo", { ...ENV, R2_BUCKET: "Meu-Bucket" }], ["bucket com hífen na ponta", { ...ENV, R2_BUCKET: "-abc" }], ["bucket com ponto", { ...ENV, R2_BUCKET: "a.b.c" }], ["bucket vazio", { ...ENV, R2_BUCKET: "" }], ["valor não string", { ...ENV, R2_BUCKET: 5 }]]
  for (const [why, env] of bad) {
    const r = loadR2Config(env); assert.deepEqual(r, { ok: false, code: "R2_CONFIG_INVALID" }, why)
    for (const v of Object.values(env ?? {})) if (typeof v === "string" && v.length > 3) assert.equal(JSON.stringify(r).includes(v), false, `${why}: eco`)
  }
  const { store } = mk(); assert.deepEqual(await store.putIfAbsent("k/1", enc("ok")), { ok: true, created: true })
})

// ───────────────────────────── R8: chaves inválidas ─────────────────────────────
await test("R8 — chaves e prefixos inválidos (.., //, ., vazio, barra inicial, 1.025, espaço, controle, unicode, ?, #, %, \\) ⇒ INVALID_ARGS e ZERO requisições; bytes que não são Uint8Array ⇒ INVALID_ARGS", async () => {
  const { store, fake } = mk()
  const keys = ["", "/a", "a//b", "../x", "a/../b", "a/./b", ".", "..", "x".repeat(1025), "a b", "ação", "a\nb", "a\0b", "a?b", "a#b", "a%2e%2e/b", "a\\b", "a;b", "a:b", 5, null, undefined, {}, ["a"]]
  for (const k of keys) for (const op of [(): Any => store.putIfAbsent(k as Any, enc("x")), (): Any => store.get(k as Any), (): Any => store.delete(k as Any)]) assert.deepEqual(await op(), FAIL("INVALID_ARGS"), `chave ${JSON.stringify(k)?.slice(0, 20)}`)
  for (const p of ["", "/a/", "a//", "../", "a/../", "x".repeat(1025), "a b/", "ação/", 5, null]) assert.deepEqual(await store.deleteByPrefix(p as Any), FAIL("INVALID_ARGS"), `prefixo ${JSON.stringify(p)?.slice(0, 20)}`)
  for (const b of ["texto", [1, 2], null, undefined, { length: 3 }, new ArrayBuffer(4)]) assert.deepEqual(await store.putIfAbsent("k/1", b as Any), FAIL("INVALID_ARGS"), "bytes inválidos")
  assert.equal(fake.log.length, 0, "nenhuma requisição saiu")
  assert.equal(((await store.putIfAbsent("users/u1/imports/abc-DEF_1.csv.gz", enc("ok"))) as Any).ok, true, "chave legítima passa")
})

// ───────────────────────────── R9: estática ─────────────────────────────
await test("R9 — ESTÁTICA: object-store-r2.ts importa só ./hash.ts e ./object-store.ts, sem node:*, process.env, @aws-sdk nem fetch global direto; hmacSha256 existe só em hash.ts; node:crypto só em hash.ts/cipher.ts; só o montador de dependências do AI Partner (E7-14) importa o cliente; nada fora de infra/ o importa", async () => {
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const code = read("src/lib/infra/object-store-r2.ts")
  assert.deepEqual(importsOf(code).sort(), ["./hash.ts", "./object-store.ts"])
  assert.equal(/node:|process\.env|@aws-sdk|\brequire\s*\(|\bglobalThis\.fetch\b/.test(code), false, "dependência proibida")
  const hash = read("src/lib/infra/hash.ts"); assert.match(hash, /export (const|function) hmacSha256\b/)
  const { readdirSync } = await import("node:fs")
  const infra = readdirSync(`${ROOT}src/lib/infra`).filter((f) => f.endsWith(".ts"))
  assert.deepEqual(infra.filter((f) => /node:crypto/.test(read(`src/lib/infra/${f}`))).sort(), ["cipher.ts", "hash.ts"], "node:crypto só em hash.ts/cipher.ts")
  assert.deepEqual(infra.filter((f) => /hmacSha256/.test(read(`src/lib/infra/${f}`))).sort(), ["hash.ts", "object-store-r2.ts"])
  for (const f of infra.filter((x) => x !== "object-store-r2.ts" && x !== "ai-partner-deps.ts" && x !== "ai-partner-chat-deps.ts" /* E7-15c: o montador do chat repassa o fetch ao R2 */)) assert.equal(/object-store-r2/.test(read(`src/lib/infra/${f}`)), false, `${f} importa o cliente`) // E7-14: o montador de produção é o consumidor
  for (const dir of ["agent", "agent-capabilities", "evidence", "metrics", "ingest", "domain"]) for (const f of readdirSync(`${ROOT}src/lib/${dir}`).filter((x) => x.endsWith(".ts"))) assert.equal(/object-store-r2/.test(read(`src/lib/${dir}/${f}`)), false, `${dir}/${f}`)
})

// ───────────────────────────── R10: AO VIVO (só com R2_LIVE=1) ─────────────────────────────
if (process.env.R2_LIVE === "1") {
  await test("R10 — AO VIVO no R2 (R2_LIVE=1): ida e volta sob _e711-live/<aleatório>/: put novo ⇒ created:true, repetido ⇒ created:false (412 do R2) sem sobrescrever, get igual, delete ⇒ existed:true/false, deleteByPrefix limpa; o bucket fica sem os objetos de teste", async () => {
    const env = Object.fromEntries(readFileSync(`${ROOT}.env.local`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
    const r: Any = loadR2Config(env); assert.equal(r.ok, true, ".env.local inválido"); const store = createR2ObjectStore(r.config)
    const prefix = `_e711-live/${randomBytes(6).toString("hex")}/`
    try {
      assert.deepEqual(await store.putIfAbsent(`${prefix}a.bin`, enc("A")), { ok: true, created: true })
      assert.deepEqual(await store.putIfAbsent(`${prefix}a.bin`, enc("B")), { ok: true, created: false })
      assert.equal(dec(((await store.get(`${prefix}a.bin`)) as Any).bytes), "A", "o 412 não sobrescreveu")
      assert.deepEqual(await store.get(`${prefix}ausente`), FAIL("NOT_FOUND"))
      for (const n of ["b", "c", "d"]) await store.putIfAbsent(`${prefix}${n}.bin`, enc(n))
      assert.deepEqual(await store.delete(`${prefix}a.bin`), { ok: true, existed: true }); assert.deepEqual(await store.delete(`${prefix}a.bin`), { ok: true, existed: false })
      assert.deepEqual(await store.deleteByPrefix(prefix), { ok: true, deleted: 3 })
      assert.deepEqual(await store.get(`${prefix}b.bin`), FAIL("NOT_FOUND"))
      assert.deepEqual(await store.deleteByPrefix(prefix), { ok: true, deleted: 0 })
    } finally { await store.deleteByPrefix(prefix) }
  })
} else if (!process.env.COLLECT) console.log("… R10 (ao vivo) pulado: rode com R2_LIVE=1")

if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do cliente R2 passaram.`)
