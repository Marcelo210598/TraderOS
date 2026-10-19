// E7-4: vínculo de dataset + montador de ctx (infra/dataset.ts): registerImport (pipeline → RawFileStorage → ImportSourceStore) e makeContext (pin → ctx das capacidades, reproduzível).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_4 (D-B4/D-B5; R1–R5, M1–M10, I1–I2, S2; mutações DM1–DM16).
//   node scripts/test-dataset.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { exitAnalysis } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { exitBreakdown } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { metricsCompare } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { metricsGroups } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { metricsQuery } from "../src/lib/agent-capabilities/metrics-query.ts"
import { rankGroupsCapability } from "../src/lib/agent-capabilities/rank-groups.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { createConversations, createDiskConversationStore, createMemoryConversationStore, type ConversationStore } from "../src/lib/infra/conversation-store.ts"
import { makeContext, registerImport, type DatasetDeps } from "../src/lib/infra/dataset.ts"
import { sha256Hex } from "../src/lib/infra/hash.ts"
import { createDiskImportSourceStore, createMemoryImportSourceStore, type ImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { MAX_RAW_FILE_BYTES, createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createDiskRawFileStorage } from "../src/lib/infra/raw-file-storage-disk.ts"
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
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const BRT = "America/Sao_Paulo"
const p2 = (x: number): string => String(x).padStart(2, "0")
/** CSV NT8 PT-BR sintético; `seed` muda o conteúdo (e o sha); `accounts` variam as contas. */
const csvOf = (n: number, seed = 0, crlf = false): string => {
  const t = synthCsv(Array.from({ length: n }, (_, i) => ({ entryPrice: 2000 + ((i + seed) % 13), exitPrice: 2000 + ((i + seed) % 13) + (((i + seed) % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: (i + seed) % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
  return crlf ? t.replace(/\r?\n/g, "\r\n") : t
}
const shaOf = (text: string): string => sha256Hex(new TextEncoder().encode(text))
const CTX = { sourceTz: "America/New_York" } // NÃO é o padrão do pipeline (SP): uma mutação que ignore o contexto gravado muda o importId
const PIN = (...shas: string[]): Any => ({ sources: shas.map((fileSha256) => ({ fileSha256 })), analysis: {} })
const codeOf = (r: Any): string => (r.ok ? "OK" : r.code)

// ── ambientes: memória e disco ──
const TMPS: string[] = []
interface Env { name: string; deps: DatasetDeps; kr: InMemorySaltKeyring; fresh: () => DatasetDeps; root?: string; conv: () => ConversationStore }
function memEnv(): Env {
  const raw = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore(), conv = createMemoryConversationStore(), kr = new InMemorySaltKeyring()
  kr.ensure(U1)
  const deps: DatasetDeps = { rawStorage: raw, importStore: imp, salt: kr }
  return { name: "memória", deps, kr, fresh: () => deps, conv: () => conv }
}
function diskEnv(): Env {
  const root = mkdtempSync(join(tmpdir(), "dataset-")); TMPS.push(root)
  const kr = new InMemorySaltKeyring(); kr.ensure(U1)
  const mk = (): DatasetDeps => ({ rawStorage: createDiskRawFileStorage(join(root, "raw")), importStore: createDiskImportSourceStore(join(root, "imports")), salt: kr })
  return { name: "disco", deps: mk(), kr, fresh: mk, root, conv: () => createDiskConversationStore(join(root, "conv")) }
}
const envs = (): Env[] => [memEnv(), diskEnv()]
const both = async (fn: (e: Env) => Promise<void>): Promise<void> => { for (const e of envs()) await fn(e) }
async function register(e: Env, text: string, extra: Any = {}): Promise<Any> {
  const r: Any = await registerImport(e.deps, { userId: U1, text, context: CTX, fileName: "export.csv", ...extra })
  assert.equal(r.ok, true, `registerImport: ${codeOf(r)}`)
  return r
}
async function ctxOf(e: Env, pin: Any, user = U1): Promise<Any> {
  const r: Any = await makeContext(e.fresh(), { userId: user, pin })
  assert.equal(r.ok, true, `makeContext: ${codeOf(r)}`)
  return r.ctx
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const ARGS = {
  query: { metricIds: ["netPnl", "winRate"], filters: {}, options: {} },
  groups: { groupBy: ["account"], metricIds: ["netPnl"], filters: {}, options: {} },
  compare: { mode: "PERIOD", a: { from: "2026-03-01", to: "2026-03-10" }, b: { from: "2026-03-15", to: "2026-03-25" }, metricIds: ["netPnl"], filters: {}, options: {} },
  breakdown: { filters: {}, options: {} },
  analysis: { filters: {}, options: {} },
  rank: { groupBy: ["account"], metric: "netPnl", order: "DESC", filters: {}, options: {} },
}
const runAll = (ctx: Any): Record<string, Any> => ({
  "metrics.query@1": metricsQuery(ARGS.query, ctx), "metrics.groups@1": metricsGroups(ARGS.groups, ctx), "metrics.compare@1": metricsCompare(ARGS.compare, ctx),
  "exit.breakdown@1": exitBreakdown(ARGS.breakdown, ctx), "exit.analysis@1": exitAnalysis(ARGS.analysis, ctx), "rank.groups@1": rankGroupsCapability(ARGS.rank, ctx),
})

// ───────────────────────────── R: registerImport ─────────────────────────────
await test("R1 — registerImport grava o TEXTO no RawFileStorage e a linha no ImportSourceStore; importId = o do pipeline; o resumo e os arquivos NÃO levam o valor do sal", async () => {
  await both(async (e) => {
    const text = csvOf(40)
    const r = await register(e, text)
    const direct: Any = runImportPipeline(text, { ...CTX, fileName: "export.csv", salt: { provider: e.kr, userId: U1 } } as Any)
    assert.equal(r.created, true, e.name)
    assert.equal(r.fileSha256, shaOf(text), e.name)
    assert.equal(r.importId, direct.importRecord.importId, e.name)
    assert.deepEqual([r.trades, r.rejectedRows], [direct.trades.length, direct.rejected.length], e.name)
    assert.deepEqual(Object.keys(r).sort(), ["created", "fileSha256", "importId", "ok", "rejectedRows", "trades"], e.name)
    const stored: Any = await e.deps.rawStorage.get(U1, r.fileSha256)
    assert.equal(new TextDecoder().decode(stored.bytes), text, e.name)
    const row: Any = await e.deps.importStore.get(U1, r.fileSha256)
    assert.deepEqual([row.row.importId, row.row.fileName, row.row.fileBytes, row.row.hasBom, row.row.lineEnding, row.row.context], [r.importId, "export.csv", new TextEncoder().encode(text).length, false, direct.importRecord.lineEnding, CTX], e.name)
    const salt = e.kr.current(U1)!.salt
    assert.equal(JSON.stringify(r).includes(salt), false, e.name)
    if (e.root !== undefined) for (const f of walk(e.root)) assert.equal(readFileSync(f).includes(Buffer.from(salt)), false, `${e.name}: sal em ${f}`)
  })
})

await test("R2 — BOM, CRLF e multibyte UTF-8 preservados byte a byte (o sha é o do TEXTO UTF-8, BOM incluído); hasBom/lineEnding/fileBytes vêm do ImportRecord", async () => {
  await both(async (e) => {
    const withBom = "﻿" + csvOf(30, 1, true).replace("Estrategia Teste", "Estratégia Ação")
    const r = await register(e, withBom, { fileName: "açãò.csv" })
    const bytes = new TextEncoder().encode(withBom)
    assert.equal(r.fileSha256, sha256Hex(bytes), e.name)
    assert.deepEqual(Buffer.from(((await e.deps.rawStorage.get(U1, r.fileSha256)) as Any).bytes), Buffer.from(bytes), `${e.name}: bytes idênticos`)
    const row: Any = ((await e.deps.importStore.get(U1, r.fileSha256)) as Any).row
    assert.deepEqual([row.hasBom, row.lineEnding, row.fileBytes, row.fileName], [true, "CRLF", bytes.length, "açãò.csv"], e.name)
  })
})

await test("R3 — falha ANTES de gravar não deixa nada: formato desconhecido, sem sal atual, argumentos/contexto inválidos ⇒ códigos fixos e nem arquivo nem linha", async () => {
  await both(async (e) => {
    const junk = "isso;não;é;um;export\n1;2;3;4;5\n"
    const none = async (text: string, user = U1): Promise<void> => {
      assert.deepEqual(await e.deps.rawStorage.get(user, shaOf(text)), { ok: false, code: "NOT_FOUND" }, `${e.name}: arquivo gravado indevidamente`)
      assert.deepEqual(await e.deps.importStore.get(user, shaOf(text)), { ok: false, code: "NOT_FOUND" }, `${e.name}: linha gravada indevidamente`)
    }
    assert.equal(codeOf(await registerImport(e.deps, { userId: U1, text: junk, context: CTX })), "PIPELINE_FAILED", e.name); await none(junk)
    const good = csvOf(10)
    assert.equal(codeOf(await registerImport(e.deps, { userId: U2, text: good, context: CTX })), "SALT_REQUIRED", `${e.name}: U2 não tem sal`); await none(good, U2)
    const bad: Array<[string, Any]> = [
      ["texto vazio", { userId: U1, text: "" }], ["texto não-string", { userId: U1, text: 5 }], ["userId inválido", { userId: "a/b", text: good }], ["contexto com sal", { userId: U1, text: good, context: { accountRefSalt: "9f".repeat(32) } }],
      ["contexto com provider", { userId: U1, text: good, context: { salt: {} } }], ["exitReasonMap com regex inválida", { userId: U1, text: good, context: { exitReasonMap: [{ pattern: "(", reason: "TARGET" }] } }], ["exitReasonMap com motivo inexistente", { userId: U1, text: good, context: { exitReasonMap: [{ pattern: "x", reason: "ZZZ" }] } }],
      ["fileName vazio", { userId: U1, text: good, fileName: "" }], ["fileName gigante", { userId: U1, text: good, fileName: "x".repeat(300) }], ["pedido null", null], ["pedido extra", { userId: U1, text: good, extra: 1 }],
    ]
    for (const [why, req] of bad) assert.equal(codeOf(await registerImport(e.deps, req as Any)), "INVALID_ARGS", `${e.name}: ${why}`)
    await none(good)
  })
})

await test("R4 — idempotente com o MESMO contexto (created:false); a mesma chave com contexto/fileName diferente ⇒ CONTEXT_CONFLICT e a linha original segue", async () => {
  await both(async (e) => {
    const text = csvOf(25)
    const a = await register(e, text)
    const again: Any = await registerImport(e.deps, { userId: U1, text, context: CTX, fileName: "export.csv" })
    assert.deepEqual([again.ok, again.created, again.importId], [true, false, a.importId], e.name)
    for (const other of [{ context: { sourceTz: "UTC" } }, { fileName: "outro.csv" }, { fileName: undefined }]) assert.equal(codeOf(await registerImport(e.deps, { userId: U1, text, context: CTX, fileName: "export.csv", ...other } as Any)), "CONTEXT_CONFLICT", `${e.name}: ${JSON.stringify(other)}`)
    const row: Any = ((await e.deps.importStore.get(U1, a.fileSha256)) as Any).row
    assert.deepEqual([row.context, row.fileName], [CTX, "export.csv"], e.name)
  })
})

await test("R5 — arquivo acima do teto ⇒ TOO_LARGE (sem rodar o pipeline nem gravar); falha ao gravar a LINHA deixa só o arquivo (endereçado por conteúdo, inofensivo) e o retry completa", async () => {
  await both(async (e) => {
    const huge = "a".repeat(MAX_RAW_FILE_BYTES + 1)
    assert.equal(codeOf(await registerImport(e.deps, { userId: U1, text: huge, context: CTX })), "TOO_LARGE", e.name)
    assert.deepEqual(await e.deps.rawStorage.get(U1, shaOf(huge)), { ok: false, code: "NOT_FOUND" }, e.name)
    const text = csvOf(15)
    const failing: ImportSourceStore = { ...e.deps.importStore, async put() { return { ok: false, code: "STORAGE_ERROR" } } }
    assert.equal(codeOf(await registerImport({ ...e.deps, importStore: failing }, { userId: U1, text, context: CTX })), "STORAGE_ERROR", e.name)
    assert.equal(((await e.deps.rawStorage.get(U1, shaOf(text))) as Any).ok, true, `${e.name}: o arquivo ficou`)
    assert.deepEqual(await e.deps.importStore.get(U1, shaOf(text)), { ok: false, code: "NOT_FOUND" }, `${e.name}: a linha não`)
    const retry: Any = await registerImport(e.deps, { userId: U1, text, context: CTX })
    assert.deepEqual([retry.ok, retry.created], [true, true], `${e.name}: o retry completa (o put do arquivo é idempotente)`)
  })
})

// ───────────────────────────── M: makeContext ─────────────────────────────
await test("M1 — duas montagens INDEPENDENTES (instâncias novas sobre o mesmo armazenamento) dão ctx idênticos, o ctx NÃO inventa risco (= pipeline puro) e as 6 capacidades dão os MESMOS evidenceRef", async () => {
  await both(async (e) => {
    const text = csvOf(60)
    const r = await register(e, text)
    const c1 = await ctxOf(e, PIN(r.fileSha256)), c2 = await ctxOf(e, PIN(r.fileSha256))
    assert.deepStrictEqual(c1, c2, e.name)
    const direct: Any = runImportPipeline(text, { ...CTX, fileName: "export.csv", salt: { provider: e.kr, userId: U1 } } as Any)
    assert.deepStrictEqual(c1.trades, toAnalyticsTrades(direct.trades), `${e.name}: nada de risco inventado`)
    assert.deepStrictEqual(c1.importRecords, [direct.importRecord], e.name)
    assert.equal(c1.refEpoch, e.kr.current(U1)!.saltId, e.name)
    assert.equal(c1.accountRefSalt, e.kr.current(U1)!.salt, e.name)
    assert.deepStrictEqual(Object.keys(c1).sort(), ["accountRefSalt", "analysis", "importRecords", "refEpoch", "source", "trades"], e.name)
    assert.deepEqual(Buffer.from(c1.source.files[r.importId]), Buffer.from(new TextEncoder().encode(text)), `${e.name}: o arquivo da fonte`)
    const o1 = runAll(c1), o2 = runAll(c2)
    for (const cap of Object.keys(o1)) {
      assert.ok(o1[cap].entry, `${e.name}: ${cap} deveria gerar entrada (${JSON.stringify(o1[cap].result).slice(0, 120)})`)
      assert.equal(o1[cap].entry.handle.evidenceRef, o2[cap].entry.handle.evidenceRef, `${e.name}: ${cap}`)
      assert.deepStrictEqual(o1[cap].entry, o2[cap].entry, `${e.name}: ${cap} entrada idêntica`)
    }
    const distinct = new Set(Object.values(o1).map((o: Any) => o.entry.handle.evidenceRef)).size
    if (e.name === "memória") console.log(`  · M1: ${distinct} evidenceRef distintos nas 6 capacidades (${Object.entries(o1).map(([k, v]: Any) => `${k.split("@")[0]}=${v.entry.handle.evidenceRef.slice(3, 9)}`).join(" ")})`)
  })
})

await test("M2 — multi-source: a ORDEM do pin é irrelevante (mesmo ctx, mesmo ref); e acrescentar um arquivo ao pin muda o ref", async () => {
  await both(async (e) => {
    const a = await register(e, csvOf(30, 0)), b = await register(e, csvOf(30, 5), { fileName: "outro.csv" })
    assert.notEqual(a.fileSha256, b.fileSha256)
    const ab = await ctxOf(e, PIN(a.fileSha256, b.fileSha256)), ba = await ctxOf(e, PIN(b.fileSha256, a.fileSha256)), only = await ctxOf(e, PIN(a.fileSha256))
    assert.deepStrictEqual(ab, ba, e.name)
    assert.equal(ab.importRecords.length, 2, e.name)
    const ref = (c: Any): string => metricsQuery(ARGS.query, c).entry.handle.evidenceRef
    assert.equal(ref(ab), ref(ba), e.name)
    assert.notEqual(ref(ab), ref(only), `${e.name}: mais um arquivo ⇒ outra população ⇒ outro ref`)
  })
})

await test("M3 — as preferências de análise vêm do PIN (não do usuário de hoje) e MUDAM o ref: timeZone e minSample", async () => {
  await both(async (e) => {
    const r = await register(e, csvOf(60))
    const ref = async (analysis: Any): Promise<string> => { const c = await ctxOf(e, { sources: [{ fileSha256: r.fileSha256 }], analysis }); assert.deepEqual(c.analysis, analysis, e.name); return metricsQuery(ARGS.query, c).entry.handle.evidenceRef }
    const base = await ref({}), tz = await ref({ timeZone: "UTC" }), ms = await ref({ minSample: 5 }), both2 = await ref({ timeZone: "UTC", minSample: 5 })
    assert.equal(new Set([base, tz, ms, both2]).size, 4, e.name)
    assert.equal(await ref({}), base, `${e.name}: o mesmo pin dá o mesmo ref`)
  })
})

await test("M4 — erros de dados: import não registrado ⇒ IMPORT_NOT_REGISTERED; arquivo ausente ⇒ FILE_NOT_AVAILABLE; arquivo adulterado ⇒ FILE_CORRUPT; linha ilegível ⇒ IMPORT_CORRUPT", async () => {
  await both(async (e) => {
    const r = await register(e, csvOf(20))
    assert.equal(codeOf(await makeContext(e.deps, { userId: U1, pin: PIN("e".repeat(64)) })), "IMPORT_NOT_REGISTERED", e.name)
    const emptyRaw: DatasetDeps = { ...e.deps, rawStorage: createMemoryRawFileStorage() }
    assert.equal(codeOf(await makeContext(emptyRaw, { userId: U1, pin: PIN(r.fileSha256) })), "FILE_NOT_AVAILABLE", e.name)
    const corruptRow: DatasetDeps = { ...e.deps, importStore: { ...e.deps.importStore, async get() { return { ok: false, code: "CORRUPT" } } } }
    assert.equal(codeOf(await makeContext(corruptRow, { userId: U1, pin: PIN(r.fileSha256) })), "IMPORT_CORRUPT", e.name)
    const broken: DatasetDeps = { ...e.deps, rawStorage: { ...e.deps.rawStorage, async get() { return { ok: false, code: "CORRUPT" } } } }
    assert.equal(codeOf(await makeContext(broken, { userId: U1, pin: PIN(r.fileSha256) })), "FILE_CORRUPT", e.name)
    if (e.root !== undefined) {
      const file = join(e.root, "raw", "users", U1, "imports", `${r.fileSha256}.csv`)
      writeFileSync(file, readFileSync(file, "utf8").replace("Sim101", "Sim999")) // adulterado em disco
      assert.equal(codeOf(await makeContext(e.fresh(), { userId: U1, pin: PIN(r.fileSha256) })), "FILE_CORRUPT", `${e.name}: o SHA do storage pega`)
    }
    const erro = await makeContext(e.deps, { userId: U1, pin: PIN("e".repeat(64)) })
    assert.deepEqual(erro, { ok: false, code: "IMPORT_NOT_REGISTERED" }, e.name)
  })
})

await test("M5 — linha com importId que o pipeline não reproduz (forjada, ou parser/versão divergente) ⇒ IMPORT_MISMATCH, e NUNCA devolve ctx", async () => {
  await both(async (e) => {
    const text = csvOf(20)
    const r = await register(e, text)
    const good: Any = ((await e.deps.importStore.get(U1, r.fileSha256)) as Any).row
    for (const forged of [{ ...good, importId: "imp_00000000aabbccdd" }, { ...good, context: { ...good.context, sourceTz: "UTC" } }]) {  // forjar só o fileName não muda o importId (medido): quem pega é a conferência do ref no E7-5
      const store = createMemoryImportSourceStore(); await store.put(forged)
      const res: Any = await makeContext({ ...e.deps, importStore: store }, { userId: U1, pin: PIN(r.fileSha256) })
      assert.deepEqual(res, { ok: false, code: "IMPORT_MISMATCH" }, `${e.name}: ${JSON.stringify(forged.context).slice(0, 40)} ${forged.importId}`)
    }
  })
})

await test("M6 — sem sal atual ⇒ SALT_REQUIRED; com o sal ROTACIONADO o ctx vem na época nova e os refs mudam (regenerar vale para a época corrente; o importId segue o mesmo)", async () => {
  await both(async (e) => {
    const r = await register(e, csvOf(40))
    const before = await ctxOf(e, PIN(r.fileSha256)), refBefore = metricsQuery(ARGS.query, before).entry.handle.evidenceRef
    assert.equal(codeOf(await makeContext(e.deps, { userId: U2, pin: PIN(r.fileSha256) })), "SALT_REQUIRED", `${e.name}: usuário sem sal`)
    e.kr.rotate(U1)
    const after = await ctxOf(e, PIN(r.fileSha256))
    assert.equal(before.refEpoch, "s1"); assert.equal(after.refEpoch, "s2", e.name)
    assert.notEqual(after.accountRefSalt, before.accountRefSalt, e.name)
    assert.notEqual(metricsQuery(ARGS.query, after).entry.handle.evidenceRef, refBefore, `${e.name}: outro sal ⇒ outro ref`)
    assert.equal(after.importRecords[0].importId, before.importRecords[0].importId, `${e.name}: o importId não depende do sal`)
  })
})

await test("M7 — multi-source com foldPolicy ou exitReasonMap DIFERENTES ⇒ PIN_CONTEXT_MISMATCH (o verificador só aceita um par global); iguais passam", async () => {
  await both(async (e) => {
    const a = await register(e, csvOf(20, 0), { context: { ...CTX, foldPolicy: "EARLIER" } })
    const b = await register(e, csvOf(20, 3), { context: { ...CTX, foldPolicy: "LATER" }, fileName: "b.csv" })
    const c = await register(e, csvOf(20, 7), { context: { ...CTX, foldPolicy: "EARLIER", exitReasonMap: [{ pattern: "^alvo", reason: "TARGET" }] }, fileName: "c.csv" })
    const d = await register(e, csvOf(20, 9), { context: { ...CTX, foldPolicy: "EARLIER" }, fileName: "d.csv" })
    assert.equal(codeOf(await makeContext(e.deps, { userId: U1, pin: PIN(a.fileSha256, b.fileSha256) })), "PIN_CONTEXT_MISMATCH", `${e.name}: foldPolicy`)
    assert.equal(codeOf(await makeContext(e.deps, { userId: U1, pin: PIN(a.fileSha256, c.fileSha256) })), "PIN_CONTEXT_MISMATCH", `${e.name}: exitReasonMap`)
    const ok: Any = await makeContext(e.deps, { userId: U1, pin: PIN(a.fileSha256, d.fileSha256) })
    assert.equal(ok.ok, true, e.name)
    assert.equal(ok.ctx.source.options.foldPolicy, "EARLIER", e.name)
  })
})

await test("M8 — isolamento: pin com o arquivo de OUTRO usuário ⇒ IMPORT_NOT_REGISTERED (indistinguível de inexistente); pin inválido ⇒ INVALID_ARGS", async () => {
  await both(async (e) => {
    e.kr.ensure(U2)
    const r = await register(e, csvOf(20))
    assert.deepEqual(await makeContext(e.deps, { userId: U2, pin: PIN(r.fileSha256) }), await makeContext(e.deps, { userId: U2, pin: PIN("e".repeat(64)) }), e.name)
    assert.equal(codeOf(await makeContext(e.deps, { userId: U2, pin: PIN(r.fileSha256) })), "IMPORT_NOT_REGISTERED", e.name)
    for (const bad of [null, undefined, {}, PIN(), { sources: [{ fileSha256: "x" }], analysis: {} }, { sources: [{ fileSha256: r.fileSha256 }], analysis: { minSample: 0 } }, PIN(r.fileSha256, r.fileSha256)]) assert.equal(codeOf(await makeContext(e.deps, { userId: U1, pin: bad as Any })), "INVALID_ARGS", `${e.name}: ${JSON.stringify(bad)?.slice(0, 50)}`)
    assert.equal(codeOf(await makeContext(e.deps, { userId: "a/b", pin: PIN(r.fileSha256) })), "INVALID_ARGS", e.name)
    assert.equal(codeOf(await makeContext(e.deps, null as Any)), "INVALID_ARGS", e.name)
  })
})

await test("M9 — nenhum erro carrega sal, caminho, nome de arquivo ou conteúdo: só {ok:false, code}", async () => {
  await both(async (e) => {
    const r = await register(e, csvOf(20), { fileName: "segredo-do-cliente.csv" })
    const salt = e.kr.current(U1)!.salt
    const results: Any[] = [
      await makeContext(e.deps, { userId: U1, pin: PIN("e".repeat(64)) }), await makeContext({ ...e.deps, rawStorage: createMemoryRawFileStorage() }, { userId: U1, pin: PIN(r.fileSha256) }),
      await makeContext(e.deps, { userId: U2, pin: PIN(r.fileSha256) }), await makeContext(e.deps, { userId: U1, pin: null as Any }),
      await registerImport(e.deps, { userId: U1, text: "lixo;lixo\n1;2\n", context: CTX, fileName: "segredo-do-cliente.csv" }), await registerImport(e.deps, { userId: U2, text: csvOf(10), context: CTX, fileName: "segredo-do-cliente.csv" }),
      await registerImport(e.deps, { userId: U1, text: csvOf(20), context: { sourceTz: "UTC" }, fileName: "segredo-do-cliente.csv" }),
    ]
    for (const x of results) {
      assert.equal(x.ok, false)
      assert.deepEqual(Object.keys(x).sort(), ["code", "ok"])
      const text = JSON.stringify(x) + String(x)
      for (const secret of [salt, "segredo-do-cliente", "Sim101", "Estrategia", e.root ?? "/tmp/", U1, r.fileSha256]) assert.equal(text.includes(secret), false, `${e.name}: vazou ${secret.slice(0, 8)}`)
    }
  })
})

await test("M10 — arquivo com BOM: o ctx reproduz o import do texto ORIGINAL (decodificar sem ignoreBOM tiraria o BOM e mudaria o importId)", async () => {
  await both(async (e) => {
    const text = "﻿" + csvOf(30)
    const r = await register(e, text)
    const c = await ctxOf(e, PIN(r.fileSha256))
    const direct: Any = runImportPipeline(text, { ...CTX, fileName: "export.csv", salt: { provider: e.kr, userId: U1 } } as Any)
    assert.equal(direct.importRecord.hasBom, true)
    assert.deepStrictEqual(c.importRecords, [direct.importRecord], e.name)
    assert.deepEqual(Buffer.from(c.source.files[r.importId]), Buffer.from(new TextEncoder().encode(text)), `${e.name}: o BOM segue nos bytes da fonte`)
  })
})

// ───────────────────────────── I: ponta a ponta ─────────────────────────────
await test("I1 — PONTA A PONTA: registerImport → makeContext → metrics.query → commitTurn (spec + pin) → reabrir em instâncias NOVAS → pinOf/specOf → makeContext → mesma consulta ⇒ MESMO evidenceRef e entrada idêntica", async () => {
  await both(async (e) => {
    const r = await register(e, csvOf(80))
    const pin = { sources: [{ fileSha256: r.fileSha256 }], analysis: { timeZone: BRT, minSample: 3 } }
    const ctx = await ctxOf(e, pin)
    const out = metricsQuery(ARGS.query, ctx)
    assert.ok(out.entry)
    const store = e.conv()
    const convs = createConversations({ store })
    const created: Any = await convs.create(U1, ctx.refEpoch)
    assert.equal(created.ok, true)
    const done: Any = await convs.commitTurn(created.open, { writes: [{ op: "add", entry: out.entry }], specs: [{ evidenceRef: out.entry!.handle.evidenceRef, capability: out.entry!.capability, args: ARGS.query, pin }] })
    assert.equal(done.ok, true, codeOf(done))
    // outra "máquina": tudo novo, só o armazenamento em comum (no disco). Na memória, as mesmas instâncias (não há outro processo).
    const back: Any = await createConversations({ store: e.root !== undefined ? createDiskConversationStore(join(e.root, "conv")) : store }).open(U1, created.open.conversationId)
    assert.equal(back.ok, true)
    const ref = out.entry!.handle.evidenceRef
    const spec = back.open.specOf(ref), pin2 = back.open.pinOf(ref)
    assert.deepEqual(pin2, { sources: pin.sources, analysis: pin.analysis }, e.name)
    const ctx2 = await ctxOf(e, pin2)
    const again = metricsQuery(spec.args, ctx2)
    assert.equal(again.entry!.handle.evidenceRef, ref, e.name)
    assert.deepStrictEqual(again.entry, out.entry, `${e.name}: entrada idêntica (handle completo + view)`)
    assert.equal(back.open.ledger.entries[ref].handle.evidenceHash, again.entry!.handle.evidenceHash, e.name)
  })
})

await test("I2 — ponta a ponta com metrics.groups e ALIAS: a tabela guardada na conversa é reaproveitada na regeneração ⇒ mesmo ref e mesma view (\"Conta A\" segue sendo a mesma conta)", async () => {
  await both(async (e) => {
    const r = await register(e, csvOf(80, 2))
    const pin = PIN(r.fileSha256)
    const ctx = await ctxOf(e, pin)
    const out = metricsGroups(ARGS.groups, ctx)
    assert.ok(out.entry)
    assert.equal(out.aliases.conta.length >= 2, true, "duas contas alocadas")
    const convs = createConversations({ store: e.conv() })
    const created: Any = await convs.create(U1, ctx.refEpoch)
    const done: Any = await convs.commitTurn(created.open, { writes: [{ op: "add", entry: out.entry }], specs: [{ evidenceRef: out.entry!.handle.evidenceRef, capability: out.entry!.capability, args: ARGS.groups, pin }], aliases: out.aliases })
    assert.equal(done.ok, true, codeOf(done))
    const reopened: Any = await convs.open(U1, created.open.conversationId)
    const ref = out.entry!.handle.evidenceRef
    const ctx2 = { ...(await ctxOf(e, reopened.open.pinOf(ref))), aliases: reopened.open.aliases }
    const again = metricsGroups(reopened.open.specOf(ref).args, ctx2)
    assert.equal(again.entry!.handle.evidenceRef, ref, e.name)
    assert.deepStrictEqual(again.entry!.view, out.entry!.view, `${e.name}: a view (com os aliases) é idêntica`)
    assert.deepStrictEqual(again.aliases, out.aliases, e.name)
    // sem a tabela guardada, a regeneração ainda dá o mesmo ref (o ref não depende do alias), mas a ORDEM dos aliases seria outra se as contas aparecessem em outra ordem: a tabela é o que garante a estabilidade
    const noTable = metricsGroups(reopened.open.specOf(ref).args, await ctxOf(e, reopened.open.pinOf(ref)))
    assert.equal(noTable.entry!.handle.evidenceRef, ref, e.name)
  })
})

// ───────────────────────────── S ─────────────────────────────
await test("S2 — tripwire: dataset.ts e import-source-store.ts não importam salt.ts nem o contrato do agente (portões do P1/SC11/SG1 seguem fechados); node:crypto só em hash.ts/cipher.ts", async () => {
  for (const f of ["dataset.ts", "import-source-store.ts", "dataset-pin.ts"]) {
    const code = readFileSync(join(ROOT, "src", "lib", "infra", f), "utf8").replace(/\/\/.*$/gm, "")
    assert.equal(/from\s+["'][^"']*ingest\/salt(\.ts)?["']/.test(code), false, `${f} importa salt.ts`)
    assert.equal(/from\s+["'][^"']*\/agent\/(contract|views|phrases)(\.ts)?["']/.test(code), false, `${f} importa o contrato`)
    assert.equal(/from\s+["'](node:)?crypto["']/.test(code), false, `${f} importa node:crypto`)
  }
  const dataset = readFileSync(join(ROOT, "src", "lib", "infra", "dataset.ts"), "utf8").replace(/\/\/.*$/gm, "")
  assert.equal(/withRisk|riskUsd|stopPrice/.test(dataset), false, "o montador não inventa risco")
})

for (const d of TMPS) rmSync(d, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do dataset passaram.`)
