// E7-13 (Portão B): persistência relacional (Prisma/Neon) dos 3 stores — TESTES 100% OFFLINE. Nenhuma conexão a banco, nenhuma URL lida. Expectativa escrita ANTES do código:
// scripts/expectations/agent-answer.expected.json → e7_13 (D-P1…D-P8; P1–P6 aqui; a suíte de contrato AO VIVO entra nos test-salt-store/-import-source-store/-conversation-store só com PRISMA_LIVE=1; mutações EP1–EP15).
//   node scripts/test-prisma-stores.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { NONCE_BYTES, TAG_BYTES } from "../src/lib/infra/cipher.ts"
import { createPrismaConversationStore } from "../src/lib/infra/prisma-conversation-store.ts"
import { createPrismaImportSourceStore } from "../src/lib/infra/prisma-import-source-store.ts"
import { createPrismaSaltStore } from "../src/lib/infra/prisma-salt-store.ts"
import { assertSafeTestDatabase } from "./_prisma-live.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex")
const U1 = "cmd3h2k0a0000abcd1234efgh"
const SHA = (c: string): string => c.repeat(64)
const ISO = "2026-10-20T12:00:00.000Z"
const SECRET = "SEGREDO-DO-BANCO select * from users postgres://u:senha@ep-prod.neon.tech/db"
const FAIL = (code: string): Any => ({ ok: false, code })
const jstr = (x: unknown): string => JSON.stringify(x)

// ── fixtures (as mesmas formas dos testes dos outros stores) ──
const saltRow = (o: Any = {}): Any => ({ userId: U1, saltId: "s1", status: "ACTIVE", saltCheck: `slt_${"ab".repeat(12)}`, ciphertext: new Uint8Array(TAG_BYTES + 32).fill(7), nonce: new Uint8Array(NONCE_BYTES).fill(3), keyVersion: 1, createdAt: ISO, retiredAt: null, ...o })
const importRow = (o: Any = {}): Any => ({
  userId: U1, fileSha256: SHA("a"), importId: "imp_47e005e7aabbccdd", fileName: "meu-export.csv", fileBytes: 1234, hasBom: false, lineEnding: "CRLF", hashBasis: "UTF8_TEXT",
  context: { sourceTz: "America/Sao_Paulo", dateOrder: "DMY", numberLocale: "BR", excursionUnit: "USD_TOTAL", declaredPnlBasis: "UNKNOWN", foldPolicy: "EARLIER", reconstructCycles: true, exitReasonMap: [{ pattern: "^alvo", reason: "TARGET" }] }, createdAt: ISO, ...o,
})
const meta = (o: Any = {}): Any => ({ userId: U1, conversationId: "c1", epoch: "s1", createdAt: ISO, ...o })
const delta = (o: Any = {}): Any => ({ rotateTo: null, writes: [], specs: [], alias: null, ...o })
/** As linhas COMO O BANCO AS DEVOLVE (texto para JSON e datas, bytes para o sal). */
const dbSalt = (o: Any = {}): Any => ({ userId: U1, saltId: "s1", status: "ACTIVE", saltCheck: `slt_${"ab".repeat(12)}`, ciphertext: new Uint8Array(TAG_BYTES + 32).fill(7), nonce: new Uint8Array(NONCE_BYTES).fill(3), keyVersion: 1, createdAt: ISO, retiredAt: null, ...o })
const dbImport = (o: Any = {}): Any => { const r = importRow(o); return { ...r, context: jstr(r.context) } }
const dbDeltaBody = (version: number, o: Any = {}): string => jstr({ alias: null, createdAt: ISO, rotateTo: null, specs: [], version, writes: [], ...o })

// ── o cliente de MENTIRA: cada chamada é registrada e respondida por `handler(modelo, método, args)` ──
type Handler = (model: string, method: string, args: Any) => unknown
function mkPort(handler: Handler): { port: Any; calls: string[]; log: Array<{ model: string; method: string; args: Any }> } {
  const calls: string[] = []
  const log: Array<{ model: string; method: string; args: Any }> = []
  const port: Any = {}
  for (const model of ["aiUserSalt", "aiImportSource", "aiConversation", "aiConversationDelta"]) {
    port[model] = {}
    for (const method of ["findUnique", "findMany", "create", "updateMany", "deleteMany"]) port[model][method] = (args: Any) => { calls.push(`${model}.${method}`); log.push({ model, method, args }); return handler(model, method, args) }
  }
  port.$transaction = async (cb: (tx: Any) => Promise<unknown>) => cb(port)
  return { port, calls, log }
}
const allSettled = async (fn: () => Promise<unknown>): Promise<unknown> => { try { return await fn() } catch { assert.fail("o adaptador LANÇOU (nada pode lançar)") } }
const uniqueErr = (): Any => Object.assign(new Error("Unique constraint failed on the fields: (`userId`,`saltId`)"), { code: "P2002" })

type Op = [string, (port: Any) => Promise<unknown>]
const SEALED = { ciphertext: new Uint8Array(TAG_BYTES + 32).fill(9), nonce: new Uint8Array(NONCE_BYTES).fill(4), keyVersion: 2 }
const OPS: Record<string, Op[]> = {
  salt: [
    ["loadUser", (p) => createPrismaSaltStore(p).loadUser(U1)], ["append", (p) => createPrismaSaltStore(p).append(saltRow())], ["retire", (p) => createPrismaSaltStore(p).retire(U1, "s1", ISO)],
    ["replaceCipher", (p) => createPrismaSaltStore(p).replaceCipher(U1, "s1", { keyVersion: 1, nonce: new Uint8Array(NONCE_BYTES).fill(3) }, SEALED)], ["listUsers", (p) => createPrismaSaltStore(p).listUsers()], ["deleteAllForUser", (p) => createPrismaSaltStore(p).deleteAllForUser(U1)],
  ],
  import: [
    ["put", (p) => createPrismaImportSourceStore(p).put(importRow())], ["get", (p) => createPrismaImportSourceStore(p).get(U1, SHA("a"))], ["delete", (p) => createPrismaImportSourceStore(p).delete(U1, SHA("a"))],
    ["deleteAllForUser", (p) => createPrismaImportSourceStore(p).deleteAllForUser(U1)], ["list", (p) => createPrismaImportSourceStore(p).list(U1)],
  ],
  conv: [
    ["create", (p) => createPrismaConversationStore(p).create(meta())], ["load", (p) => createPrismaConversationStore(p).load(U1, "c1")], ["commit", (p) => createPrismaConversationStore(p).commit(U1, "c1", 0, delta(), ISO)],
    ["delete", (p) => createPrismaConversationStore(p).delete(U1, "c1")], ["deleteAllForUser", (p) => createPrismaConversationStore(p).deleteAllForUser(U1)],
  ],
}

// ───────────────────────────── P1: schema aditivo ─────────────────────────────
const SCHEMA_BASELINE_SHA = "7a0a4bd7c60734af6bf1bde3ea07b7e23afdb299647d2922dbc9c59b0224fa19" // sha256 do schema do git HEAD (sem o fim de linha final), ANTES do E7-13
const MARKER = "// ─── AI Partner (E7-13)"
await test("P1 — schema ADITIVO: o texto anterior ao marcador tem o MESMO sha256 do schema original (User e todo o legado intactos); só 4 modelos novos Ai… e nenhum enum novo; PKs compostas começando por userId; payload e data em String, bytes em Bytes; sem relação com User; deltas ⇒ conversa com cascade", async () => {
  const s = readFileSync(`${ROOT}prisma/schema.prisma`, "utf8")
  const at = s.indexOf(MARKER); assert.ok(at > 0, "marcador do E7-13 ausente")
  assert.equal(sha256(s.slice(0, at).trimEnd()), SCHEMA_BASELINE_SHA, "algo ANTES do marcador mudou (modelo/enum/campo legado ou o generator/datasource)")
  const added = s.slice(at)
  assert.deepEqual([...added.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]).sort(), ["AiChatUsage" /* E7-15b: tabela aditiva de uso mensal do chat */, "AiConversation", "AiConversationDelta", "AiImportSource", "AiUserSalt"])
  assert.equal(/^enum /m.test(added), false, "nenhum enum novo"); assert.equal(/^(generator|datasource) /m.test(added), false)
  const block = (name: string): string => new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m").exec(added)![0]
  for (const [name, table, pk] of [["AiUserSalt", "ai_user_salts", "userId, saltId"], ["AiImportSource", "ai_import_sources", "userId, fileSha256"], ["AiConversation", "ai_conversations", "userId, conversationId"], ["AiConversationDelta", "ai_conversation_deltas", "userId, conversationId, version"]]) {
    const b = block(name)
    assert.match(b, new RegExp(`@@id\\(\\[${pk}\\]\\)`), `${name}: PK composta começando por userId`); assert.match(b, new RegExp(`@@map\\("${table}"\\)`), `${name}: tabela`)
    assert.equal(/\bUser\b/.test(b), false, `${name}: sem relação com User`); assert.equal(/@default\(cuid\(\)\)|@default\(uuid\(\)\)/.test(b), false, `${name}: sem id sintético`)
    assert.equal(/\b(Json|DateTime)\b/.test(b), false, `${name}: payload e data são TEXTO (D-P3)`)
  }
  assert.match(block("AiUserSalt"), /ciphertext\s+Bytes\?/); assert.match(block("AiUserSalt"), /nonce\s+Bytes\?/)
  assert.match(block("AiImportSource"), /context\s+String\b/); assert.match(block("AiConversationDelta"), /body\s+String\b/); assert.match(block("AiConversation"), /version\s+Int\s+@default\(0\)/)
  assert.match(block("AiConversationDelta"), /@relation\(fields: \[userId, conversationId\], references: \[userId, conversationId\], onDelete: Cascade\)/)
})

// ───────────────────────────── P2: migração segura ─────────────────────────────
const MIGRATIONS_BASELINE_SHA = "0974c6c25dbe15a8f69d3d610bd15ec6001faa90590e51e7f52f0370e3cba6f9" // as 11 migrações antigas + migration_lock.toml, ANTES do E7-13
await test("P2 — migração: UMA pasta nova (…add_ai_partner_storage); o .sql só tem CREATE TABLE/CREATE INDEX/ALTER TABLE ADD CONSTRAINT sobre as 4 tabelas ai_* (nada de DROP/UPDATE/DELETE/TRUNCATE/CREATE TYPE nem tabela legada); as migrações antigas e o lock seguem byte a byte iguais", async () => {
  const dir = `${ROOT}prisma/migrations/`
  const mine = readdirSync(dir).filter((n) => statSync(`${dir}${n}`).isDirectory() && /add_ai_partner_storage/.test(n))
  assert.equal(mine.length, 1, "exatamente uma migração do E7-13")
  const parts: string[] = []
  for (const n of readdirSync(dir).sort()) { if (mine.includes(n) || /add_ai_chat_usage$/.test(n) /* E7-15b: migração aditiva posterior, coberta pelo P6 do test-chat-quota */) continue; const p = `${dir}${n}`; parts.push(`${n}\0${readFileSync(statSync(p).isDirectory() ? `${p}/migration.sql` : p, "utf8")}\0`) }
  assert.equal(parts.length, 12, "11 migrações + migration_lock.toml"); assert.equal(sha256(parts.join("")), MIGRATIONS_BASELINE_SHA, "uma migração antiga mudou")
  const sql = readFileSync(`${dir}${mine[0]}/migration.sql`, "utf8")
  const withoutFkActions = sql.replace(/ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|NO ACTION|SET NULL|SET DEFAULT)/gi, "") // as ações da FK não são comandos
  assert.equal(/\b(DROP|UPDATE|DELETE|TRUNCATE|INSERT|GRANT|REVOKE|CREATE\s+TYPE|CREATE\s+SCHEMA|CREATE\s+EXTENSION|ALTER\s+TYPE)\b/i.test(withoutFkActions), false, "comando proibido")
  const stmts = sql.replace(/--[^\n]*/g, "").split(";").map((x) => x.trim()).filter((x) => x !== "")
  assert.ok(stmts.length >= 5, `instruções (${stmts.length})`)
  const TABLES = "ai_(?:user_salts|import_sources|conversations|conversation_deltas)"
  for (const st of stmts) assert.match(st, new RegExp(`^(?:CREATE TABLE "${TABLES}" \\(|CREATE (?:UNIQUE )?INDEX "[^"]+" ON "${TABLES}"\\(|ALTER TABLE "${TABLES}" ADD CONSTRAINT "[^"]+" )`), `instrução fora do permitido: ${st.slice(0, 80)}`)
  assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort(), ["ai_conversation_deltas", "ai_conversations", "ai_import_sources", "ai_user_salts"])
  for (const legacy of ["users", "trades", "accounts", "sessions", "User", "Trade", "Account"]) assert.equal(new RegExp(`"${legacy}"`).test(sql), false, `não menciona a tabela legada ${legacy}`)
  assert.match(sql, /REFERENCES "ai_conversations"\("user_id", "conversation_id"\) ON DELETE CASCADE/)
})

// ───────────────────────────── P3: tradução de erros e semântica (cliente de mentira) ─────────────────────────────
await test("P3 — erros e semântica com o cliente de MENTIRA: rejeição/exceção ⇒ STORAGE_ERROR em TODA operação dos 3 adaptadores; P2002 ⇒ DUPLICATE (sal.append, conversa.create) e CONFLICT (delta); forma inesperada ⇒ STORAGE_ERROR; linha ilegível ⇒ CORRUPT; nada lança e nenhum resultado carrega mensagem, SQL, URL ou valor", async () => {
  // 1) falha uniforme: rejeita, lança sync, ou P2002 em tudo
  const uniform: Array<[string, Handler]> = [["rejeita", () => Promise.reject(new Error(SECRET))], ["lança", () => { throw new Error(SECRET) }]]
  for (const [fname, h] of uniform) for (const [store, ops] of Object.entries(OPS)) for (const [name, op] of ops) {
    const { port } = mkPort(h); const r: Any = await allSettled(() => op(port))
    assert.deepEqual(r, FAIL("STORAGE_ERROR"), `${fname}/${store}.${name}`); assert.equal(jstr(r).includes("SEGREDO") || jstr(r).includes("postgres://"), false, `${fname}/${store}.${name}: eco`)
  }
  const p2002 = mkPort(() => Promise.reject(uniqueErr()))
  assert.deepEqual(await allSettled(() => OPS.salt[1][1](p2002.port)), FAIL("DUPLICATE"), "sal.append + P2002"); assert.deepEqual(await allSettled(() => OPS.conv[0][1](p2002.port)), FAIL("DUPLICATE"), "conversa.create + P2002")
  for (const [store, ops] of Object.entries(OPS)) for (const [name, op] of ops) if (!["salt.append", "conv.create"].includes(`${store === "conv" ? "conv" : store}.${name}`)) {
    const r: Any = await allSettled(() => op(mkPort(() => Promise.reject(uniqueErr())).port))
    assert.equal(r.code, "STORAGE_ERROR", `P2002 fora de um create de chave ⇒ STORAGE_ERROR (${store}.${name}: ${jstr(r)})`)
  }
  // 2) formas inesperadas
  for (const bad of ["texto", 5, [], undefined]) assert.deepEqual(await allSettled(() => OPS.conv[1][1](mkPort((_m, method) => (method === "findUnique" ? bad : null)).port)), FAIL("STORAGE_ERROR"), `findUnique devolvendo ${jstr(bad)}`)
  for (const bad of ["texto", 5, {}, undefined, null]) for (const op of [OPS.salt[0], OPS.salt[4], OPS.import[4]]) assert.deepEqual(await allSettled(() => op[1](mkPort((_m, method) => (method === "findMany" ? bad : null)).port)), FAIL("STORAGE_ERROR"), `findMany devolvendo ${jstr(bad)} (${op[0]})`)
  for (const bad of [{ count: "1" }, { count: -1 }, { count: 1.5 }, {}, null, "x", undefined]) {
    for (const [name, op] of [OPS.salt[5], OPS.import[2], OPS.import[3], OPS.conv[3], OPS.conv[4]] as Op[]) assert.deepEqual(await allSettled(() => op(mkPort((_m, method) => (method === "deleteMany" ? bad : null)).port)), FAIL("STORAGE_ERROR"), `deleteMany devolvendo ${jstr(bad)} (${name})`)
    assert.deepEqual(await allSettled(() => OPS.conv[2][1](mkPort((_m, method) => (method === "updateMany" ? bad : null)).port)), FAIL("STORAGE_ERROR"), `updateMany devolvendo ${jstr(bad)} (commit)`)
  }
  // 3) sal: retire/replaceCipher/listUsers
  const gone = mkPort(() => null); assert.deepEqual(await allSettled(() => OPS.salt[2][1](gone.port)), FAIL("NOT_FOUND"), "retire de inexistente"); assert.deepEqual(await allSettled(() => OPS.salt[3][1](gone.port)), FAIL("NOT_FOUND"), "replaceCipher de inexistente")
  const retired = mkPort((_m, method) => (method === "findUnique" ? dbSalt({ status: "RETIRED", ciphertext: null, nonce: null, keyVersion: null, retiredAt: ISO }) : { count: 1 }))
  assert.deepEqual(await allSettled(() => OPS.salt[2][1](retired.port)), { ok: true }, "retire de aposentada é idempotente"); assert.equal(retired.calls.includes("aiUserSalt.updateMany"), false, "…sem escrever")
  const active = mkPort((_m, method) => (method === "findUnique" ? dbSalt() : { count: 1 })); assert.deepEqual(await allSettled(() => OPS.salt[2][1](active.port)), { ok: true }, "retire de ativa")
  const patch = mkPort((_m, method) => (method === "findUnique" ? dbSalt() : { count: 1 })); await OPS.salt[2][1](patch.port)
  const wrongKv = mkPort((_m, method) => (method === "findUnique" ? dbSalt({ keyVersion: 5 }) : { count: 1 })); assert.deepEqual(await allSettled(() => OPS.salt[3][1](wrongKv.port)), FAIL("CONFLICT"), "keyVersion diferente ⇒ CONFLICT"); assert.equal(wrongKv.calls.includes("aiUserSalt.updateMany"), false, "…sem escrever")
  const raced = mkPort((_m, method) => (method === "findUnique" ? dbSalt() : { count: 0 })); assert.deepEqual(await allSettled(() => OPS.salt[3][1](raced.port)), FAIL("CONFLICT"), "perdeu a corrida (0 linhas) ⇒ CONFLICT")
  assert.deepEqual(await allSettled(() => OPS.salt[3][1](mkPort((_m, method) => (method === "findUnique" ? dbSalt() : { count: 1 })).port)), { ok: true }, "replaceCipher ok")
  assert.deepEqual(await allSettled(() => OPS.salt[4][1](mkPort(() => [{ userId: U1 }, { userId: "../x" }, { userId: "a" }]).port)), { ok: true, userIds: ["a", U1].sort() }, "listUsers filtra ids inválidos e ordena")
  const loadSalt: Any = await allSettled(() => OPS.salt[0][1](mkPort(() => [dbSalt({ saltId: "s2" }), dbSalt({ saltId: "s1" }), dbSalt({ saltId: "s3", nonce: new Uint8Array(3) }), "lixo"]).port))
  assert.equal(loadSalt.ok, true); assert.deepEqual(loadSalt.rows.map((r: Any) => [r.saltId, r.corrupt === true]), [["invalid", true], ["s1", false], ["s2", false], ["s3", true]], "ordenado por saltId; ilegível vira CorruptRow sem derrubar as outras")
  assert.deepEqual([...loadSalt.rows[1].ciphertext], [...new Uint8Array(TAG_BYTES + 32).fill(7)], "bytes voltam iguais")
  // 4) importação: idempotência por unicidade
  const sameRow = mkPort((_m, method) => (method === "create" ? Promise.reject(uniqueErr()) : dbImport({ createdAt: "2027-01-01T00:00:00.000Z" })))
  assert.deepEqual(await allSettled(() => OPS.import[0][1](sameRow.port)), { ok: true, created: false }, "mesma linha (createdAt à parte) ⇒ created:false")
  const otherRow = mkPort((_m, method) => (method === "create" ? Promise.reject(uniqueErr()) : dbImport({ fileName: "outro.csv" }))); assert.deepEqual(await allSettled(() => OPS.import[0][1](otherRow.port)), FAIL("CONFLICT"), "conteúdo diferente ⇒ CONFLICT")
  const vanished = mkPort((_m, method) => (method === "create" ? Promise.reject(uniqueErr()) : null)); assert.deepEqual(await allSettled(() => OPS.import[0][1](vanished.port)), FAIL("STORAGE_ERROR"), "sumiu entre o create e a leitura")
  assert.deepEqual(await allSettled(() => OPS.import[0][1](mkPort(() => ({})).port)), { ok: true, created: true }, "create ok")
  const got: Any = await allSettled(() => OPS.import[1][1](mkPort(() => dbImport()).port)); assert.deepEqual(got, { ok: true, row: importRow() }, "get devolve a linha (o context volta como objeto)")
  assert.deepEqual(await allSettled(() => OPS.import[1][1](mkPort(() => null).port)), FAIL("NOT_FOUND")); assert.deepEqual(await allSettled(() => OPS.import[1][1](mkPort(() => dbImport({ context: "{ não é json" })).port)), FAIL("CORRUPT"), "context ilegível ⇒ CORRUPT")
  assert.deepEqual(await allSettled(() => OPS.import[1][1](mkPort(() => ({ userId: U1 })).port)), FAIL("CORRUPT"), "linha incompleta ⇒ CORRUPT")
  const listed: Any = await allSettled(() => OPS.import[4][1](mkPort(() => [dbImport({ fileSha256: SHA("c") }), dbImport({ fileSha256: SHA("a") }), dbImport({ fileSha256: SHA("b"), context: "lixo" }), "x"]).port)); assert.deepEqual([listed.ok, listed.corrupt, listed.rows.map((r: Any) => r.fileSha256)], [true, 2, [SHA("a"), SHA("c")]], "list: ordenada por sha, corrompidas só contadas")
  assert.deepEqual(await allSettled(() => OPS.import[2][1](mkPort(() => ({ count: 1 })).port)), { ok: true, existed: true }); assert.deepEqual(await allSettled(() => OPS.import[2][1](mkPort(() => ({ count: 0 })).port)), { ok: true, existed: false })
  // 5) conversa: CAS e leitura
  const noConv = mkPort((_m, method) => (method === "updateMany" ? { count: 0 } : null)); assert.deepEqual(await allSettled(() => OPS.conv[2][1](noConv.port)), FAIL("NOT_FOUND"), "commit em conversa inexistente"); assert.equal(noConv.calls.includes("aiConversationDelta.create"), false)
  const stale = mkPort((_m, method) => (method === "updateMany" ? { count: 0 } : { userId: U1, conversationId: "c1", epoch: "s1", createdAt: ISO, version: 3 })); assert.deepEqual(await allSettled(() => OPS.conv[2][1](stale.port)), FAIL("CONFLICT"), "versão velha ⇒ CONFLICT"); assert.equal(stale.calls.includes("aiConversationDelta.create"), false, "o delta NÃO é inserido")
  let upd: Any = null; const win = mkPort((model, method, args) => { if (method === "updateMany") { upd = args; return { count: 1 } } return model === "aiConversationDelta" ? {} : null })
  assert.deepEqual(await allSettled(() => createPrismaConversationStore(win.port).commit(U1, "c1", 4, delta(), ISO)), { ok: true, version: 5 }, "commit ok"); assert.deepEqual(upd.where, { userId: U1, conversationId: "c1", version: 4 }, "CAS por (userId, conversationId, version)"); assert.equal(upd.data.version, 5)
  const dup = mkPort((model, method) => (method === "updateMany" ? { count: 1 } : model === "aiConversationDelta" && method === "create" ? Promise.reject(uniqueErr()) : null)); assert.deepEqual(await allSettled(() => OPS.conv[2][1](dup.port)), FAIL("CONFLICT"), "violação da PK do delta ⇒ CONFLICT")
  const convRow = (v: number): Any => ({ userId: U1, conversationId: "c1", epoch: "s1", createdAt: ISO, version: v })
  const loadConv = (v: number, deltas: Any[]): Handler => (model, method) => (model === "aiConversation" ? convRow(v) : model === "aiConversationDelta" && method === "findMany" ? deltas : null)
  const okLoad: Any = await allSettled(() => OPS.conv[1][1](mkPort(loadConv(2, [{ version: 1, body: dbDeltaBody(1) }, { version: 2, body: dbDeltaBody(2) }])).port)); assert.deepEqual([okLoad.ok, okLoad.meta, okLoad.deltas.map((d: Any) => d.version)], [true, meta(), [1, 2]])
  for (const [why, v, deltas] of [["lacuna", 2, [{ version: 1, body: dbDeltaBody(1) }, { version: 3, body: dbDeltaBody(3) }]], ["cabeça ≠ nº de deltas", 3, [{ version: 1, body: dbDeltaBody(1) }]], ["começa em 2", 1, [{ version: 2, body: dbDeltaBody(2) }]]] as Array<[string, number, Any[]]>) assert.deepEqual(await allSettled(() => OPS.conv[1][1](mkPort(loadConv(v, deltas)).port)), FAIL("CORRUPT"), why)
  const withBad: Any = await allSettled(() => OPS.conv[1][1](mkPort(loadConv(2, [{ version: 1, body: "{ lixo" }, { version: 2, body: dbDeltaBody(2) }])).port)); assert.deepEqual([withBad.ok, withBad.deltas[0], withBad.deltas[1].version], [true, { version: 1, corrupt: true }, 2], "delta ilegível ⇒ CorruptDelta só dele")
  assert.deepEqual(await allSettled(() => OPS.conv[1][1](mkPort(() => null).port)), FAIL("NOT_FOUND")); assert.deepEqual(await allSettled(() => OPS.conv[1][1](mkPort((m) => (m === "aiConversation" ? { userId: U1 } : [])).port)), FAIL("CORRUPT"), "meta ilegível ⇒ CORRUPT")
  assert.deepEqual(await allSettled(() => OPS.conv[3][1](mkPort(() => ({ count: 1 })).port)), { ok: true, existed: true }); assert.deepEqual(await allSettled(() => OPS.conv[4][1](mkPort(() => ({ count: 7 })).port)), { ok: true, deleted: 7 })
  // 6) ISOLAMENTO POR ARGUMENTOS: TODA chamada ao banco (leitura, escrita ou apagamento) carrega o userId do chamador — nenhuma operação pode alcançar linhas de outro usuário
  for (const [store, ops] of Object.entries(OPS)) for (const [name, op] of ops) {
    if (name === "listUsers") continue // varre os usuários de propósito (admin)
    const { port, log } = mkPort((m, method) => (m === "aiConversation" && method === "findUnique" ? { userId: U1, conversationId: "c1", epoch: "s1", createdAt: ISO, version: 0 } : method === "findMany" ? [] : method === "findUnique" ? null : { count: 0 })) // a conversa EXISTE (para o load chegar a ler os deltas)
    await allSettled(() => op(port))
    assert.ok(log.length > 0, `${store}.${name}: chamou o banco`)
    for (const c of log) { const scope = c.args?.where ?? c.args?.data; assert.ok(scope !== undefined, `${store}.${name}: ${c.model}.${c.method} sem where/data`); assert.equal(jstr(scope).includes(U1), true, `${store}.${name}: ${c.model}.${c.method} SEM o userId (alcançaria outro usuário)`) }
  }
  // o CAS do sal é na ESCRITA: só troca se a linha ainda é ACTIVE com o (keyVersion, nonce) esperados; e a aposentadoria só mexe em ACTIVE
  const casLog: Any[] = []; await allSettled(() => OPS.salt[3][1](mkPort((_m, method, args) => { if (method === "findUnique") return dbSalt(); casLog.push(args); return { count: 1 } }).port))
  assert.deepEqual([casLog[0].where.userId, casLog[0].where.saltId, casLog[0].where.status, casLog[0].where.keyVersion, [...casLog[0].where.nonce]], [U1, "s1", "ACTIVE", 1, [...new Uint8Array(NONCE_BYTES).fill(3)]], "replaceCipher: where do CAS")
  assert.deepEqual([casLog[0].data.keyVersion, [...casLog[0].data.nonce]], [2, [...SEALED.nonce]], "replaceCipher: data")
  const retLog: Any[] = []; await allSettled(() => OPS.salt[2][1](mkPort((_m, method, args) => { if (method === "findUnique") return dbSalt(); retLog.push(args); return { count: 1 } }).port))
  assert.deepEqual([retLog[0].where, retLog[0].data], [{ userId: U1, saltId: "s1", status: "ACTIVE" }, { status: "RETIRED", ciphertext: null, nonce: null, keyVersion: null, retiredAt: ISO }], "retire: só ACTIVE; apaga o valor cifrado")
  const commitUpd: Any[] = []; await allSettled(() => createPrismaConversationStore(mkPort((_m, method, args) => { if (method === "updateMany") commitUpd.push(args); return { count: 0 } }).port).commit(U1, "c1", 0, delta(), ISO)); assert.equal(commitUpd[0]?.where?.version, 0, "o commit é condicionado à versão esperada")
})

// ───────────────────────────── P4: validação antes do banco ─────────────────────────────
await test("P4 — validação ANTES do banco: ids, linhas, deltas e argumentos inválidos ⇒ INVALID_ARGS com ZERO chamadas ao cliente e sem eco (a régua é a dos outros stores)", async () => {
  const bad = "../x"; const N = new Uint8Array(NONCE_BYTES)
  const cases: Array<[string, (p: Any) => Promise<unknown>]> = [
    ["sal.loadUser", (p) => createPrismaSaltStore(p).loadUser(bad)], ["sal.append (chave extra)", (p) => createPrismaSaltStore(p).append({ ...saltRow(), extra: 1 })], ["sal.append (nonce curto)", (p) => createPrismaSaltStore(p).append(saltRow({ nonce: new Uint8Array(3) }))], ["sal.append (status)", (p) => createPrismaSaltStore(p).append(saltRow({ status: "X" }))],
    ["sal.append (nulo)", (p) => createPrismaSaltStore(p).append(null as Any)], ["sal.retire (id)", (p) => createPrismaSaltStore(p).retire(U1, "x!", ISO)], ["sal.retire (data)", (p) => createPrismaSaltStore(p).retire(U1, "s1", "ontem")], ["sal.retire (user)", (p) => createPrismaSaltStore(p).retire(bad, "s1", ISO)],
    ["sal.replaceCipher (id)", (p) => createPrismaSaltStore(p).replaceCipher(U1, "x!", { keyVersion: 1, nonce: N }, SEALED)], ["sal.replaceCipher (sealed inválido)", (p) => createPrismaSaltStore(p).replaceCipher(U1, "s1", { keyVersion: 1, nonce: N }, { ciphertext: new Uint8Array(2), nonce: N, keyVersion: 2 })], ["sal.deleteAllForUser", (p) => createPrismaSaltStore(p).deleteAllForUser(bad)],
    ["imp.put (linha)", (p) => createPrismaImportSourceStore(p).put(importRow({ fileSha256: "zz" }))], ["imp.put (extra)", (p) => createPrismaImportSourceStore(p).put({ ...importRow(), x: 1 })], ["imp.get", (p) => createPrismaImportSourceStore(p).get(bad, SHA("a"))], ["imp.get (sha)", (p) => createPrismaImportSourceStore(p).get(U1, "abc")],
    ["imp.delete", (p) => createPrismaImportSourceStore(p).delete(U1, "abc")], ["imp.deleteAllForUser", (p) => createPrismaImportSourceStore(p).deleteAllForUser(bad)], ["imp.list", (p) => createPrismaImportSourceStore(p).list(bad)],
    ["conv.create (user)", (p) => createPrismaConversationStore(p).create(meta({ userId: bad }))], ["conv.create (epoch)", (p) => createPrismaConversationStore(p).create(meta({ epoch: "X Y" }))], ["conv.create (data)", (p) => createPrismaConversationStore(p).create(meta({ createdAt: "x" }))], ["conv.create (extra)", (p) => createPrismaConversationStore(p).create({ ...meta(), z: 1 })],
    ["conv.load", (p) => createPrismaConversationStore(p).load(U1, "a/b")], ["conv.commit (versão negativa)", (p) => createPrismaConversationStore(p).commit(U1, "c1", -1, delta(), ISO)], ["conv.commit (versão fracionária)", (p) => createPrismaConversationStore(p).commit(U1, "c1", 1.5, delta(), ISO)],
    ["conv.commit (delta)", (p) => createPrismaConversationStore(p).commit(U1, "c1", 0, { rotateTo: 5 } as Any, ISO)], ["conv.commit (data)", (p) => createPrismaConversationStore(p).commit(U1, "c1", 0, delta(), "ontem")], ["conv.commit (user)", (p) => createPrismaConversationStore(p).commit(bad, "c1", 0, delta(), ISO)],
    ["conv.commit (mensagens inválidas)", (p) => createPrismaConversationStore(p).commit(U1, "c1", 0, delta({ messages: [{ role: "x" }] }), ISO)], ["conv.delete", (p) => createPrismaConversationStore(p).delete(bad, "c1")], ["conv.deleteAllForUser", (p) => createPrismaConversationStore(p).deleteAllForUser(bad)],
  ]
  for (const [name, op] of cases) { const { port, calls } = mkPort(() => ({ count: 1 })); const r: Any = await allSettled(() => op(port)); assert.deepEqual(r, FAIL("INVALID_ARGS"), name); assert.deepEqual(calls, [], `${name}: o cliente NÃO foi chamado`); assert.equal(jstr(r).includes(bad), false, `${name}: eco`) }
  for (const f of [createPrismaSaltStore, createPrismaImportSourceStore, createPrismaConversationStore]) for (const notPort of [null, undefined, {}, "x", { aiUserSalt: {} }]) assert.throws(() => f(notPort as Any), TypeError, `${f.name}: cliente inválido`)
})

// ───────────────────────────── P5: estática ─────────────────────────────
await test("P5 — ESTÁTICA: os 3 adaptadores e a porta não importam @prisma/client, src/lib/prisma, node:*, process.env, fetch nem agent/; só imports de infra permitidos; só o montador de produção (E7-14) importa os adaptadores; prisma.ts e prisma.config.ts intactos (cliente do app não é usado)", async () => {
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const read = (p: string): string => strip(readFileSync(`${ROOT}${p}`, "utf8"))
  const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const files = ["prisma-port.ts", "prisma-salt-store.ts", "prisma-import-source-store.ts", "prisma-conversation-store.ts", "prisma-chat-quota-store.ts" /* E7-15b */]
  const ALLOWED = ["./prisma-port.ts", "./salt-store.ts", "./import-source-store.ts", "./conversation-store.ts", "./raw-file-storage.ts", "./cipher.ts", "../domain/canonical.ts", "./chat-quota-store.ts" /* E7-15b */]
  for (const f of files) {
    assert.equal(existsSync(`${ROOT}src/lib/infra/${f}`), true, f)
    const code = read(`src/lib/infra/${f}`)
    for (const i of importsOf(code)) assert.ok(ALLOWED.includes(i), `${f} importa ${i}`)
    assert.equal(/@prisma|lib\/prisma|process\.env|\bfetch\s*\(|node:|from\s+["']\.\.\/agent|@aws-sdk|\bnew PrismaClient\b/.test(code), false, `${f}: dependência proibida`)
  }
  assert.deepEqual(importsOf(read("src/lib/infra/prisma-port.ts")), [], "a porta não importa nada")
  const infra = readdirSync(`${ROOT}src/lib/infra`).filter((x) => x.endsWith(".ts") && !files.includes(x))
  for (const f of infra.filter((x) => x !== "ai-partner-deps.ts" && x !== "ai-partner-chat-deps.ts" /* E7-15c */)) assert.equal(/prisma-(port|salt-store|import-source-store|conversation-store|chat-quota-store)/.test(read(`src/lib/infra/${f}`)), false, `infra/${f} importa um adaptador`) // E7-14: o montador de produção é o consumidor
  for (const dir of ["agent", "agent-capabilities", "evidence", "metrics", "ingest", "domain"]) for (const f of readdirSync(`${ROOT}src/lib/${dir}`).filter((x) => x.endsWith(".ts"))) assert.equal(/infra\/prisma-/.test(read(`src/lib/${dir}/${f}`)), false, `${dir}/${f}`)
  assert.equal(readFileSync(`${ROOT}src/lib/prisma.ts`, "utf8").includes("new PrismaPg({ connectionString })"), true, "src/lib/prisma.ts intacto")
  assert.equal(sha256(readFileSync(`${ROOT}prisma.config.ts`, "utf8")).length, 64); assert.match(readFileSync(`${ROOT}prisma.config.ts`, "utf8"), /url:\s*process\.env\.DATABASE_URL!/)
})

// ───────────────────────────── P6: a trava de segurança do banco de teste ─────────────────────────────
await test("P6 — TRAVA assertSafeTestDatabase: recusa URL ausente/vazia/não-string, protocolo errado, a MESMA URL de produção, o MESMO servidor de produção (outro banco, senha/parâmetros diferentes, host em maiúsculas, par pooler × direto) e prod ilegível; aceita uma branch com host diferente (mesmo nome de banco); a resposta nunca contém a URL", async () => {
  const PROD = "postgresql://owner:senhaprod@ep-aaa-bbb-123456.sa-east-1.aws.neon.tech/neondb?sslmode=require"
  const BRANCH = "postgresql://owner:senhabranch@ep-ccc-ddd-654321.sa-east-1.aws.neon.tech/neondb?sslmode=require"
  const ok: Any = assertSafeTestDatabase(BRANCH, PROD); assert.deepEqual([ok.ok, ok.host, ok.database], [true, "ep-ccc-ddd-654321.sa-east-1.aws.neon.tech", "neondb"], "uma branch de verdade (mesmo nome de banco, host DIFERENTE) passa")
  assert.equal((assertSafeTestDatabase("postgres://u:p@localhost:5432/teste", PROD) as Any).ok, true, "banco local passa")
  assert.equal((assertSafeTestDatabase(BRANCH, undefined) as Any).ok, true, "sem produção para comparar (ex.: CI) passa")
  const refuse: Array<[string, unknown, unknown, string]> = [
    ["ausente", undefined, PROD, "TEST_DB_URL_MISSING"], ["null", null, PROD, "TEST_DB_URL_MISSING"], ["vazia", "", PROD, "TEST_DB_URL_MISSING"], ["só espaços", "   ", PROD, "TEST_DB_URL_MISSING"], ["não string", 5, PROD, "TEST_DB_URL_MISSING"],
    ["protocolo http", "http://x/db", PROD, "TEST_DB_URL_INVALID"], ["mysql", "mysql://u:p@h/db", PROD, "TEST_DB_URL_INVALID"], ["sem host", "postgresql:///db", PROD, "TEST_DB_URL_INVALID"], ["sem banco", "postgresql://u:p@host.example.com/", PROD, "TEST_DB_URL_INVALID"], ["lixo", "isto não é url", PROD, "TEST_DB_URL_INVALID"],
    ["IGUAL à produção", PROD, PROD, "TEST_DB_IS_PRODUCTION"], ["mesmo servidor, outra senha e parâmetros", "postgresql://outro:x@ep-aaa-bbb-123456.sa-east-1.aws.neon.tech/neondb?connect_timeout=5", PROD, "TEST_DB_IS_PRODUCTION"],
    ["mesmo servidor, OUTRO banco", "postgresql://owner:x@ep-aaa-bbb-123456.sa-east-1.aws.neon.tech/outro_banco", PROD, "TEST_DB_IS_PRODUCTION"], ["host em maiúsculas", "postgresql://o:x@EP-AAA-BBB-123456.SA-EAST-1.AWS.NEON.TECH/neondb", PROD, "TEST_DB_IS_PRODUCTION"],
    ["pooler × direto do mesmo endpoint", "postgresql://o:x@ep-aaa-bbb-123456-pooler.sa-east-1.aws.neon.tech/neondb", PROD, "TEST_DB_IS_PRODUCTION"], ["direto × pooler (produção é o pooler)", "postgresql://o:x@ep-aaa-bbb-123456.sa-east-1.aws.neon.tech/neondb", PROD.replace("ep-aaa-bbb-123456", "ep-aaa-bbb-123456-pooler"), "TEST_DB_IS_PRODUCTION"],
    ["porta diferente, mesmo host", "postgresql://o:x@ep-aaa-bbb-123456.sa-east-1.aws.neon.tech:6543/neondb", PROD, "TEST_DB_IS_PRODUCTION"], ["produção ilegível (não dá para comparar)", BRANCH, "isto não é url", "TEST_DB_PROD_UNVERIFIABLE"], ["produção não string", BRANCH, 5, "TEST_DB_PROD_UNVERIFIABLE"],
  ]
  for (const [why, test_, prod, code] of refuse) { const r: Any = assertSafeTestDatabase(test_, prod); assert.deepEqual(r, { ok: false, code }, why); for (const leak of ["senhaprod", "senhabranch", "neon.tech", "owner", "outro:x"]) assert.equal(jstr(r).includes(leak), false, `${why}: eco de ${leak}`) }
})

if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes dos stores Prisma (offline) passaram.`)
