// E7-13 (Portão C): o que SÓ um Postgres de verdade prova — AO VIVO no banco de TESTE (branch descartável do Neon). Sem PRISMA_LIVE=1 este arquivo não faz nada (o test:domain segue 100% offline).
// Expectativa: scripts/expectations/agent-answer.expected.json → e7_13 (LIVE; mutações EP12 e EP14). Usa E7_TEST_DATABASE_URL (direta) e E7_TEST_DATABASE_URL_POOLED (pgbouncer); a trava recusa a produção.
//   PRISMA_LIVE=1 node scripts/test-prisma-live.mts
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createPrismaConversationStore } from "../src/lib/infra/prisma-conversation-store.ts"
import { createPrismaImportSourceStore } from "../src/lib/infra/prisma-import-source-store.ts"
import { createPrismaSaltStore } from "../src/lib/infra/prisma-salt-store.ts"
import { purgeUserData } from "../src/lib/infra/user-purge.ts"
import { NONCE_BYTES, TAG_BYTES } from "../src/lib/infra/cipher.ts"
import { connectLiveDb, liveEnabled } from "./_prisma-live.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const ISO = "2026-10-20T12:00:00.000Z"
const SHA = (c: string): string => c.repeat(64)
const delta = (o: Any = {}): Any => ({ rotateTo: null, writes: [], specs: [], alias: null, ...o })
const meta = (o: Any = {}): Any => ({ userId: U1, conversationId: "c1", epoch: "s1", createdAt: ISO, ...o })
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

if (!liveEnabled()) {
  if (!process.env.COLLECT) console.log("… testes AO VIVO do Prisma pulados: rode com PRISMA_LIVE=1 (precisa de E7_TEST_DATABASE_URL)")
} else {
  let passed = 0
  const test = async (name: string, fn: () => Promise<void>): Promise<void> => { await fn(); passed += 1; console.log(`✓ ${name}`) }
  const direct = await connectLiveDb("direct"), pooled = await connectLiveDb("pooled")
  try {
    const dConv = createPrismaConversationStore(direct.db), pConv = createPrismaConversationStore(pooled.db)

    await test("LV1 — CAS REAL: 10 commits simultâneos na MESMA versão (5 pela conexão direta, 5 pelo pooler) ⇒ EXATAMENTE 1 vence, 9 recebem CONFLICT, e o log fica com 1 delta", async () => {
      await direct.reset(); assert.deepEqual(await dConv.create(meta()), { ok: true })
      const rs: Any[] = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? dConv : pConv).commit(U1, "c1", 0, delta({ rotateTo: i === 0 ? null : null }), ISO)))
      assert.equal(rs.filter((r) => r.ok).length, 1, `vencedores: ${JSON.stringify(rs)}`); assert.equal(rs.filter((r) => !r.ok && r.code === "CONFLICT").length, 9, "os outros 9 ⇒ CONFLICT")
      const loaded: Any = await dConv.load(U1, "c1"); assert.equal(loaded.ok, true); assert.equal(loaded.deltas.length, 1, "1 delta só")
      for (let v = 1; v <= 5; v++) { const x: Any[] = await Promise.all([dConv, pConv, dConv].map((s) => s.commit(U1, "c1", v, delta(), ISO))); assert.equal(x.filter((r) => r.ok).length, 1, `rodada ${v}`) }
      assert.equal(((await pConv.load(U1, "c1")) as Any).deltas.length, 6, "6 versões, sem lacuna (lido pelo pooler)")
    })

    await test("LV2 — TRANSAÇÃO INTERATIVA pelo pooler e ROLLBACK de verdade: um delta já existente (PK duplicada) faz o commit dar CONFLICT e a versão da conversa VOLTA ao que era", async () => {
      await direct.reset(); await pConv.create(meta())
      assert.deepEqual(await pConv.commit(U1, "c1", 0, delta(), ISO), { ok: true, version: 1 }, "commit pelo pooler funciona")
      // planta (à força) um delta v2 SEM avançar a versão da conversa: o próximo commit (expected 1) passa no updateMany e bate na PK do delta
      await direct.db.aiConversationDelta.create({ data: { userId: U1, conversationId: "c1", version: 2, body: JSON.stringify({ alias: null, createdAt: ISO, rotateTo: null, specs: [], version: 2, writes: [] }) } })
      assert.deepEqual(await pConv.commit(U1, "c1", 1, delta(), ISO), { ok: false, code: "CONFLICT" }, "PK do delta duplicada ⇒ CONFLICT")
      const row = await direct.db.aiConversation.findUnique({ where: { userId_conversationId: { userId: U1, conversationId: "c1" } } })
      assert.equal(row.version, 1, "a transação DESFEZ o avanço da versão (rollback real)")
    })

    await test("LV3 — CASCATA da FK e ISOLAMENTO: apagar a conversa apaga seus deltas no banco; deleteAllForUser só mexe no usuário; o mesmo conversationId em outro usuário é outra conversa; o outro usuário NÃO abre a do primeiro", async () => {
      await direct.reset()
      for (const u of [U1, U2]) { assert.deepEqual(await dConv.create(meta({ userId: u })), { ok: true }); assert.equal(((await dConv.commit(u, "c1", 0, delta(), ISO)) as Any).ok, true); assert.equal(((await dConv.commit(u, "c1", 1, delta(), ISO)) as Any).ok, true) }
      assert.deepEqual(await dConv.create(meta({ conversationId: "c2" })), { ok: true })
      assert.deepEqual(await dConv.load(U2, "c2"), { ok: false, code: "NOT_FOUND" }, "o outro usuário não abre a conversa do primeiro")
      const deltasOf = async (u: string, c: string): Promise<number> => (await direct.db.aiConversationDelta.findMany({ where: { userId: u, conversationId: c } })).length
      assert.deepEqual([await deltasOf(U1, "c1"), await deltasOf(U2, "c1")], [2, 2])
      for (const u of [U1, U2]) { const l: Any = await dConv.load(u, "c1"); assert.equal(l.ok, true, `load ${u.slice(0, 6)}: ${JSON.stringify(l).slice(0, 80)}`); assert.deepEqual(l.deltas.map((d: Any) => d.version), [1, 2], "cada usuário vê SÓ os seus 2 deltas, mesmo com o mesmo conversationId") }
      const future: Any = await dConv.commit(U1, "c1", 5, delta(), ISO); assert.deepEqual(future, { ok: false, code: "CONFLICT" }, "versão FUTURA ⇒ CONFLICT (não pula o log)"); assert.equal(((await dConv.load(U1, "c1")) as Any).deltas.length, 2, "sem lacuna")
      assert.deepEqual(await dConv.delete(U1, "c1"), { ok: true, existed: true }); assert.deepEqual([await deltasOf(U1, "c1"), await deltasOf(U2, "c1")], [0, 2], "os deltas saíram pela CASCATA; os do outro usuário ficaram")
      assert.deepEqual(await dConv.delete(U1, "c1"), { ok: true, existed: false })
      assert.deepEqual(await dConv.deleteAllForUser(U2), { ok: true, deleted: 1 }); assert.equal(await deltasOf(U2, "c1"), 0, "deleteAllForUser também cascateia"); assert.equal(((await dConv.load(U1, "c2")) as Any).ok, true, "o U1 (c2) intacto")
    })

    await test("LV4 — BYTES e DATAS EXATOS: ciphertext/nonce com os 256 valores de byte (e zeros) voltam idênticos; createdAt volta como a MESMA string (data só, fração longa, offset) — texto, não Date", async () => {
      await direct.reset()
      const salts = createPrismaSaltStore(direct.db), imps = createPrismaImportSourceStore(direct.db)
      const ct = new Uint8Array(1024).map((_, i) => i % 256), nonce = new Uint8Array(NONCE_BYTES).map((_, i) => (i * 37) % 256)
      const stamps = ["2026-10-20", "2026-10-20T12:00:00.123456+00:00", "2026-10-20T09:00:00-03:00", ISO]
      for (const [i, stamp] of stamps.entries()) {
        const row = { userId: U1, saltId: `s${i + 1}`, status: "ACTIVE" as const, saltCheck: `slt_${"ab".repeat(12)}`, ciphertext: ct, nonce, keyVersion: 7, createdAt: stamp, retiredAt: null }
        assert.deepEqual(await salts.append(row as Any), { ok: true }, stamp)
      }
      const back: Any = await salts.loadUser(U1); assert.equal(back.rows.length, 4)
      back.rows.forEach((r: Any, i: number) => { assert.deepEqual([...r.ciphertext], [...ct], "ciphertext exato"); assert.deepEqual([...r.nonce], [...nonce], "nonce exato"); assert.equal(r.createdAt, stamps[i], `createdAt do sal #${i} igual à string original`) })
      for (const [i, stamp] of stamps.entries()) {
        const row = { userId: U1, fileSha256: SHA(String(i)), importId: "imp_47e005e7aabbccdd", fileName: null, fileBytes: 10, hasBom: false, lineEnding: "LF", hashBasis: "UTF8_TEXT", context: {}, createdAt: stamp }
        assert.deepEqual(await imps.put(row as Any), { ok: true, created: true }, stamp); assert.equal(((await imps.get(U1, SHA(String(i)))) as Any).row.createdAt, stamp, "createdAt do import igual")
      }
      const salt1 = back.rows[0]; const sealed = { ciphertext: new Uint8Array(TAG_BYTES + 8).fill(0), nonce: new Uint8Array(NONCE_BYTES).fill(255), keyVersion: 8 }
      assert.deepEqual(await salts.replaceCipher(U1, "s1", { keyVersion: 7, nonce: salt1.nonce }, sealed), { ok: true }, "CAS do sal (recifrar)")
      assert.deepEqual(await salts.replaceCipher(U1, "s1", { keyVersion: 7, nonce: salt1.nonce }, sealed), { ok: false, code: "CONFLICT" }, "CAS: repetir com o nonce antigo ⇒ CONFLICT")
      const settled: Any[] = await Promise.all([8, 8].map(() => salts.replaceCipher(U1, "s2", { keyVersion: 7, nonce }, { ciphertext: new Uint8Array(TAG_BYTES + 4).fill(1), nonce: new Uint8Array(NONCE_BYTES).fill(9), keyVersion: 8 })))
      assert.equal(settled.filter((r) => r.ok).length, 1, "2 recifragens simultâneas do mesmo estado ⇒ só 1 vence")
    })

    await test("LV5 — EXPURGO LGPD sobre os adaptadores Prisma: purgeUserData zera sal, importações e conversas do usuário e NÃO toca no outro; repetir é idempotente", async () => {
      await direct.reset()
      const salts = createPrismaSaltStore(direct.db), imps = createPrismaImportSourceStore(direct.db)
      for (const u of [U1, U2]) {
        await salts.append({ userId: u, saltId: "s1", status: "ACTIVE", saltCheck: `slt_${"ab".repeat(12)}`, ciphertext: new Uint8Array(TAG_BYTES + 8).fill(5), nonce: new Uint8Array(NONCE_BYTES).fill(1), keyVersion: 1, createdAt: ISO, retiredAt: null } as Any)
        await imps.put({ userId: u, fileSha256: SHA("a"), importId: "imp_47e005e7aabbccdd", fileName: "x.csv", fileBytes: 5, hasBom: false, lineEnding: "LF", hashBasis: "UTF8_TEXT", context: {}, createdAt: ISO } as Any)
        await dConv.create(meta({ userId: u })); await dConv.commit(u, "c1", 0, delta(), ISO)
      }
      const deps: Any = { rawStorage: createMemoryRawFileStorage(), importStore: imps, conversationStore: dConv, saltStore: salts }
      const r: Any = await purgeUserData(deps, { userId: U1 }); assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual([r.purged.importSources, r.purged.conversations, r.purged.salts], [1, 1, true])
      assert.deepEqual([((await salts.loadUser(U1)) as Any).rows.length, ((await imps.list(U1)) as Any).rows.length, (await dConv.load(U1, "c1") as Any).code], [0, 0, "NOT_FOUND"], "tudo do U1 sumiu")
      assert.deepEqual([((await salts.loadUser(U2)) as Any).rows.length, ((await imps.list(U2)) as Any).rows.length, (await dConv.load(U2, "c1") as Any).ok], [1, 1, true], "o U2 intacto")
      const again: Any = await purgeUserData(deps, { userId: U1 }); assert.deepEqual([again.ok, again.purged.conversations, again.purged.salts], [true, 0, false], "idempotente")
    })

    await test("LV6 — LATÊNCIA (reportada, sem limite além de 5 s por chamada): mediana por operação na conexão DIRETA × POOLER", async () => {
      await direct.reset()
      const report: string[] = []
      for (const [label, store] of [["direta", dConv], ["pooler", pConv]] as Array<[string, typeof dConv]>) {
        const id = `lat-${label}`; const t: Record<string, number[]> = { create: [], commit: [], load: [] }
        const time = async (k: string, fn: () => Promise<unknown>): Promise<void> => { const t0 = performance.now(); await fn(); t[k].push(performance.now() - t0) }
        await time("create", () => store.create(meta({ conversationId: id })))
        for (let v = 0; v < 12; v++) { await time("commit", async () => { const r: Any = await store.commit(U1, id, v, delta({ rotateTo: null }), ISO); assert.equal(r.ok, true) }); await time("load", async () => { const r: Any = await store.load(U1, id); assert.equal(r.ok, true) }) }
        report.push(`${label}: create ${median(t.create).toFixed(0)} ms · commit(mediana de 12) ${median(t.commit).toFixed(0)} ms · load ${median(t.load).toFixed(0)} ms`)
        assert.ok(Math.max(...t.commit, ...t.load) < 5000, "nenhuma chamada passou de 5 s")
      }
      console.log("  · " + report.join("\n  · "))
    })

    console.log(`\n${passed} testes AO VIVO do Prisma passaram (banco de teste).`)
  } finally {
    await direct.reset().catch(() => undefined)
    await direct.close(); await pooled.close()
  }
}
void randomBytes
