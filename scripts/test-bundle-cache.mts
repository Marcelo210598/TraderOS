// E7-5 (D-R5, D-R6): cache de bundles em memória — LRU por BYTES, chave userId+ref, single-flight por chave. Sem relógio, sem disco, sem rede.
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_5 (C1–C8, F1–F4; mutações RM2, RM5, RM6, RM7, RM8, RM12, RM14).
//   node scripts/test-bundle-cache.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { evidenceExplain } from "../src/lib/agent-capabilities/evidence-explain.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { createBundleCache, DEFAULT_BUNDLE_CACHE_BYTES } from "../src/lib/infra/bundle-cache.ts"
import { sha256Hex } from "../src/lib/infra/hash.ts"
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
const hex = (seed: string): string => sha256Hex(new TextEncoder().encode(seed))
const refOf = (b: { evidenceHash: string }): string => `ev_${b.evidenceHash.slice(0, 32)}`
/** Bundle de mentira com a única forma que o cache confere (evidenceHash hex de 64) e um enchimento para controlar o tamanho. */
const fake = (seed: string, pad = "x".repeat(100)): Any => ({ evidenceHash: hex(seed), pad })
const sizeOf = (b: unknown): number => Buffer.byteLength(JSON.stringify(b), "utf8")
/** Promessa controlável. */
const deferred = <T,>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

await test("C1 — put/get: acerto devolve a MESMA referência; ausente ⇒ null; put da mesma chave substitui e reajusta os bytes; stats", async () => {
  const c = createBundleCache()
  const b = fake("a")
  assert.equal(c.get(U1, refOf(b)), null)
  assert.deepEqual(c.put(U1, refOf(b), b), { ok: true, stored: true })
  assert.equal(c.get(U1, refOf(b)), b, "mesma referência, sem cópia")
  assert.deepEqual([c.stats().entries, c.stats().bytes], [1, sizeOf(b)])
  const b2 = { ...b, pad: "y".repeat(500) }
  assert.deepEqual(c.put(U1, refOf(b), b2), { ok: true, stored: true })
  assert.equal(c.get(U1, refOf(b)), b2)
  assert.deepEqual([c.stats().entries, c.stats().bytes], [1, sizeOf(b2)], "substituir não soma")
  assert.equal(c.stats().maxBytes, DEFAULT_BUNDLE_CACHE_BYTES)
  assert.equal(DEFAULT_BUNDLE_CACHE_BYTES, 64 * 1024 * 1024)
})

await test("C2 — despejo LRU por BYTES: ao estourar, sai o MENOS recente; consultar (get) refresca a posição; despeja quantos forem preciso", async () => {
  const sz = sizeOf(fake("a"))
  const c = createBundleCache({ maxBytes: sz * 3 + 10 })
  const [a, b, d, e] = ["a", "b", "c", "d"].map((s) => fake(s))
  c.put(U1, refOf(a), a); c.put(U1, refOf(b), b); c.put(U1, refOf(d), d)
  assert.equal(c.stats().entries, 3)
  assert.equal(c.get(U1, refOf(a)), a, "a refrescado: agora o mais velho é b")
  c.put(U1, refOf(e), e)
  assert.equal(c.get(U1, refOf(b)), null, "b (o menos recente) foi despejado")
  assert.deepEqual([a, d, e].map((x) => c.get(U1, refOf(x)) === x), [true, true, true])
  // um bundle ~2,5× maior força o despejo de VÁRIOS
  const big = fake("big", "z".repeat(sz * 2))
  assert.equal((c.put(U1, refOf(big), big) as Any).stored, true)
  assert.equal(c.get(U1, refOf(big)), big)
  assert.ok(c.stats().bytes <= sz * 3 + 10, "nunca passa do teto")
  assert.ok(c.stats().entries < 4)
})

await test("C3 — bundle MAIOR que o teto: o put não o guarda (stored:false) e NÃO despeja ninguém; o getOrLoad o entrega mesmo assim, uma vez por pedido", async () => {
  const sz = sizeOf(fake("a"))
  const c = createBundleCache({ maxBytes: sz * 2 + 10 })
  const a = fake("a"); c.put(U1, refOf(a), a)
  const huge = fake("huge", "h".repeat(sz * 5))
  assert.deepEqual(c.put(U1, refOf(huge), huge), { ok: true, stored: false })
  assert.equal(c.get(U1, refOf(huge)), null)
  assert.equal(c.get(U1, refOf(a)), a, "o que já estava continua")
  let loads = 0
  const loader = async (): Promise<Any> => { loads += 1; return { ok: true, bundle: huge } }
  const r1: Any = await c.getOrLoad(U1, refOf(huge), loader), r2: Any = await c.getOrLoad(U1, refOf(huge), loader)
  assert.deepEqual([r1.ok, r1.bundle === huge, r1.from], [true, true, "loaded"])
  assert.equal(r2.from, "loaded"); assert.equal(loads, 2, "não ficou guardado: cada pedido carrega")
  assert.equal(c.get(U1, refOf(a)), a)
})

await test("C4 — isolamento por usuário: o mesmo ref de outro usuário é MISS e o loader dele roda (single-flight também é por usuário)", async () => {
  const c = createBundleCache()
  const b = fake("a")
  c.put(U1, refOf(b), b)
  assert.equal(c.get(U2, refOf(b)), null)
  const d = deferred<Any>(); let loads = 0
  const p1 = c.getOrLoad(U1, refOf(fake("n")), async () => { loads += 1; return d.promise })
  const p2 = c.getOrLoad(U2, refOf(fake("n")), async () => { loads += 1; return d.promise })
  await tick(); assert.equal(loads, 2, "usuários distintos não compartilham o voo")
  d.resolve({ ok: true, bundle: fake("n") }); await Promise.all([p1, p2])
  assert.equal(c.get(U1, refOf(fake("n"))) !== null && c.get(U2, refOf(fake("n"))) !== null, true)
  assert.equal(c.stats().entries, 3)
})

await test("C5 — o tamanho é em BYTES UTF-8 do JSON (não em caracteres): multibyte pesa mais; stats().bytes === Buffer.byteLength", async () => {
  const ascii = fake("a", "a".repeat(200)), multi = fake("b", "ã".repeat(200)) // mesma contagem de caracteres
  assert.ok(sizeOf(multi) > sizeOf(ascii) + 150)
  const c = createBundleCache({ maxBytes: sizeOf(ascii) + 5 })
  assert.deepEqual(c.put(U1, refOf(ascii), ascii), { ok: true, stored: true })
  assert.equal(c.stats().bytes, sizeOf(ascii))
  assert.deepEqual(c.put(U1, refOf(multi), multi), { ok: true, stored: false }, "caberia por caracteres, não por bytes")
  const c2 = createBundleCache(); c2.put(U1, refOf(multi), multi)
  assert.equal(c2.stats().bytes, sizeOf(multi))
})

await test("C6 — falha nunca é guardada: loader com código, que rejeita ou que lança síncrono ⇒ resultado tipado SEM eco da mensagem; nada no cache; o pedido seguinte roda o loader de novo", async () => {
  const c = createBundleCache()
  const ref = refOf(fake("a"))
  assert.deepEqual(await c.getOrLoad(U1, ref, async () => ({ ok: false, code: "FILE_NOT_AVAILABLE" })), { ok: false, code: "FILE_NOT_AVAILABLE" })
  const segredo = "SEGREDO-/etc/passwd-9f9f"
  for (const loader of [async () => { throw new Error(segredo) }, () => { throw new Error(segredo) }, () => Promise.reject(segredo)] as Any[]) {
    const r: Any = await c.getOrLoad(U1, ref, loader)
    assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" })
    assert.equal(JSON.stringify(r).includes("SEGREDO"), false)
  }
  assert.deepEqual([c.get(U1, ref), c.stats().entries], [null, 0])
  let loads = 0
  const ok: Any = await c.getOrLoad(U1, ref, async () => { loads += 1; return { ok: true, bundle: fake("a") } })
  assert.deepEqual([ok.ok, ok.from, loads], [true, "loaded", 1])
  const hit: Any = await c.getOrLoad(U1, ref, async () => { loads += 1; return { ok: true, bundle: fake("a") } })
  assert.deepEqual([hit.ok, hit.from, loads], [true, "cache", 1], "agora vem do cache, sem carregar")
})

await test("C7 — o cache entrega a referência SEM congelar e o explain/verificação NÃO mutam o bundle: o hash do JSON antes e depois de evidenceExplain é o mesmo", async () => {
  const text = synthCsv(Array.from({ length: 40 }, (_, i) => ({ entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2), entryAt: `01/03/2026 09:${String(i).padStart(2, "0")}:00`, exitAt: `01/03/2026 09:${String(i).padStart(2, "0")}:30` })))
  const imp: Any = runImportPipeline(text, { sourceTz: "America/Sao_Paulo", accountRefSalt: "9f".repeat(32) })
  let captured: Any = null
  const ctx: Any = { trades: toAnalyticsTrades(imp.trades), importRecords: [imp.importRecord], refEpoch: "s1", accountRefSalt: "9f".repeat(32), analysis: {}, source: null, onBundle: (b: unknown) => { captured = b } }
  const q: Any = metricsQuery({ metricIds: ["netPnl"], filters: {}, options: {} }, ctx)
  assert.equal(q.result.ok, true)
  const ref = q.entry.handle.evidenceRef
  const c = createBundleCache()
  assert.deepEqual(c.put(U1, ref, captured), { ok: true, stored: true })
  const got = c.get(U1, ref)
  assert.equal(Object.isFrozen(got), false, "sem deepFreeze em tempo de execução (custo)")
  const before = sha256Hex(new TextEncoder().encode(JSON.stringify(got)))
  const ex: Any = evidenceExplain({ evidenceRef: ref, page: 1 }, { ledger: undefined, refEpoch: "s1", bundleOf: (r: string) => c.get(U1, r) } as Any)
  assert.equal(typeof ex.result.ok, "boolean")
  assert.equal(sha256Hex(new TextEncoder().encode(JSON.stringify(c.get(U1, ref)))), before, "o bundle em cache não foi alterado")
  assert.equal(c.get(U1, ref), got)
})

await test("C8 — entradas hostis NUNCA lançam: userId/ref inválidos, bundle não-objeto/array/circular/sem hash/hash que não bate com o ref, loader que não é função ou devolve forma estranha; opções inválidas da fábrica são recusadas na construção", async () => {
  const c = createBundleCache()
  const b = fake("a"), ref = refOf(b)
  const circ: Any = { evidenceHash: hex("a") }; circ.self = circ
  // [motivo, userId, ref, bundle, código esperado do getOrLoad]: usuário/ref inválidos ⇒ INVALID_ARGS; bundle que o loader devolve e não serve ⇒ STORAGE_ERROR (forma) ou REF_MISMATCH (não é o do ref)
  const bad: Array<[string, Any, Any, Any, string]> = [
    ["userId inválido", "a/b", ref, b, "INVALID_ARGS"], ["userId vazio", "", ref, b, "INVALID_ARGS"], ["userId não-string", 5, ref, b, "INVALID_ARGS"], ["ref malformado", U1, "ev_zz", b, "INVALID_ARGS"], ["ref maiúsculo", U1, ref.toUpperCase(), b, "INVALID_ARGS"], ["ref não-string", U1, null, b, "INVALID_ARGS"],
    ["bundle null", U1, ref, null, "STORAGE_ERROR"], ["bundle string", U1, ref, "x", "REF_MISMATCH"], ["bundle array", U1, ref, [], "REF_MISMATCH"], ["bundle circular", U1, ref, circ, "STORAGE_ERROR"],
    ["bundle sem evidenceHash", U1, ref, { pad: 1 }, "REF_MISMATCH"], ["evidenceHash não-hex", U1, ref, { evidenceHash: "z".repeat(64) }, "REF_MISMATCH"], ["hash que não bate com o ref", U1, refOf(fake("outro")), b, "REF_MISMATCH"],
  ]
  for (const [why, u, r, x, code] of bad) {
    assert.deepEqual(c.put(u, r, x), { ok: false, code: "INVALID_ARGS" }, why)
    assert.equal(c.get(u, r), null, `${why}: get`)
    assert.deepEqual(await c.getOrLoad(u, r, async () => ({ ok: true, bundle: x })), { ok: false, code }, `${why}: getOrLoad`)
  }
  for (const loader of [null, undefined, 5, "x", {}]) assert.deepEqual(await c.getOrLoad(U1, ref, loader as Any), { ok: false, code: "INVALID_ARGS" })
  for (const shape of [null, undefined, 5, {}, { ok: "sim" }, { ok: true }, { ok: true, bundle: null }, { ok: false }, { ok: false, code: 7 }, { ok: false, code: "com espaço e eco" }]) {
    assert.deepEqual(await c.getOrLoad(U1, ref, async () => shape as Any), { ok: false, code: "STORAGE_ERROR" }, JSON.stringify(shape))
  }
  // loader que entrega bundle de OUTRO ref é recusado sem guardar
  assert.deepEqual(await c.getOrLoad(U1, ref, async () => ({ ok: true, bundle: fake("outro") })), { ok: false, code: "REF_MISMATCH" })
  assert.equal(c.stats().entries, 0)
  for (const o of [{ maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: 1.5 }, { maxBytes: NaN }, { maxBytes: "64" }, { maxBytes: 2 ** 40 }]) assert.throws(() => createBundleCache(o as Any), TypeError, JSON.stringify(o))
})

await test("F1 — single-flight: 10 pedidos concorrentes do MESMO usuário+ref rodam UM loader; todos recebem o mesmo bundle; o seguinte vem do cache", async () => {
  const c = createBundleCache()
  const b = fake("a"), ref = refOf(b)
  const d = deferred<Any>(); let loads = 0
  const ps = Array.from({ length: 10 }, () => c.getOrLoad(U1, ref, async () => { loads += 1; return d.promise }))
  await tick(); assert.equal(loads, 1)
  d.resolve({ ok: true, bundle: b })
  const rs: Any[] = await Promise.all(ps)
  assert.ok(rs.every((r) => r.ok === true && r.bundle === b && r.from === "loaded"))
  assert.equal(loads, 1)
  const next: Any = await c.getOrLoad(U1, ref, async () => { loads += 1; return { ok: true, bundle: b } })
  assert.deepEqual([next.from, loads], ["cache", 1])
})

await test("F2 — a falha do voo é COMPARTILHADA pelos concorrentes e NÃO fica guardada: 5 pedidos recebem o mesmo erro com 1 loader; o pedido seguinte tenta de novo e pode dar certo", async () => {
  const c = createBundleCache()
  const b = fake("a"), ref = refOf(b)
  const d = deferred<Any>(); let loads = 0
  const ps = Array.from({ length: 5 }, () => c.getOrLoad(U1, ref, async () => { loads += 1; return d.promise }))
  await tick(); d.resolve({ ok: false, code: "IMPORT_MISMATCH" })
  const rs: Any[] = await Promise.all(ps)
  assert.ok(rs.every((r) => r.ok === false && r.code === "IMPORT_MISMATCH"))
  assert.equal(loads, 1)
  const again: Any = await c.getOrLoad(U1, ref, async () => { loads += 1; return { ok: true, bundle: b } })
  assert.deepEqual([again.ok, again.from, loads], [true, "loaded", 2])
  // rejeição também limpa o voo
  const c2 = createBundleCache(); const d2 = deferred<Any>()
  const q = c2.getOrLoad(U1, ref, async () => d2.promise); d2.reject(new Error("x")); assert.deepEqual(await q, { ok: false, code: "STORAGE_ERROR" })
  const ok2: Any = await c2.getOrLoad(U1, ref, async () => ({ ok: true, bundle: b })); assert.equal(ok2.ok, true)
})

await test("F3 — refs distintos NÃO se bloqueiam: um voo pendente não impede outro ref de terminar; os dois loaders rodam em paralelo", async () => {
  const c = createBundleCache()
  const a = fake("a"), b = fake("b")
  const da = deferred<Any>(); let running = 0, peak = 0
  const track = async (p: Promise<Any>): Promise<Any> => { running += 1; peak = Math.max(peak, running); try { return await p } finally { running -= 1 } }
  const pa = c.getOrLoad(U1, refOf(a), () => track(da.promise))
  const pb = c.getOrLoad(U1, refOf(b), () => track(Promise.resolve({ ok: true, bundle: b })))
  const rb: Any = await pb
  assert.equal(rb.ok, true)
  assert.equal(c.get(U1, refOf(a)), null, "a ainda pendente")
  assert.equal(peak, 2)
  da.resolve({ ok: true, bundle: a })
  assert.equal(((await pa) as Any).bundle, a)
})

await test("F4 — quem desiste de esperar não derruba os outros: o voo continua, os demais recebem o resultado e ele fica no cache", async () => {
  const c = createBundleCache()
  const b = fake("a"), ref = refOf(b)
  const d = deferred<Any>(); let loads = 0
  const loader = async (): Promise<Any> => { loads += 1; return d.promise }
  const desistente = Promise.race([c.getOrLoad(U1, ref, loader), new Promise((r) => setTimeout(() => r("desisti"), 5))])
  const fiel = c.getOrLoad(U1, ref, loader)
  assert.equal(await desistente, "desisti")
  d.resolve({ ok: true, bundle: b })
  const r: Any = await fiel
  assert.deepEqual([r.ok, r.bundle === b, loads], [true, true, 1])
  assert.equal(c.get(U1, ref), b)
})

if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do cache de bundles passaram.`)
