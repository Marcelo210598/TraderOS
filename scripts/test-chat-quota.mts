// E7-15b (Portão B): cota mensal do chat + trava de 1 turno ativo — TESTES 100% OFFLINE (memória + cliente Prisma de mentira). Nenhuma conexão, nenhuma URL lida.
// Expectativa escrita ANTES do código: docs/ai-partner/E7-15b-expectativa.md (D-C1…D-C11; C1–C9 por store, Q1–Q13, P1–P6; mutações EQ1…).
//   node scripts/test-chat-quota.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { FREE_CHAT_POOL_PER_MONTH, PLAN_CHAT_QUOTAS } from "../src/lib/plans.ts"
import { CHAT_LEASE_MS, FREE_POOL_USER_ID, createMemoryChatQuotaStore, monthKey } from "../src/lib/infra/chat-quota-store.ts"
import { createPrismaChatQuotaStore } from "../src/lib/infra/prisma-chat-quota-store.ts"
import { deleteChatUsageForUser, getChatUsage, withChatQuota } from "../src/lib/infra/chat-quota.ts"
import { createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createMemorySaltStore } from "../src/lib/infra/salt-store.ts"
import { deleteConversation, purgeUserData } from "../src/lib/infra/user-purge.ts"
import { connectLiveDb, liveEnabled, type LiveDb } from "./_prisma-live.mts"

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
const M = "2026-10"
const T0 = Date.parse("2026-10-21T12:00:00.000Z")
const at = (ms: number): string => new Date(T0 + ms).toISOString()
const jstr = (x: unknown): string => JSON.stringify(x)
const rq = (userId: string, leaseId: string, ms: number, limit = 3, month = M): Any => ({ userId, month, limit, leaseId, now: at(ms) })
const st = (userId: string, leaseId: string, outcome: string, ms = 0, month = M): Any => ({ userId, month, leaseId, outcome, now: at(ms) })

// ── cliente Prisma de MENTIRA: só a tabela ai_chat_usage, com a semântica do banco para o subconjunto de `where`/`data` que o adaptador usa (cada chamada é atômica) ──
interface Fake { client: Any; rows: Map<string, Any>; log: Array<{ method: string; args: Any }>; failAll: { on: boolean }; onCreate: { fn: null | (() => void) } }
function fakeClient(): Fake {
  const rows = new Map<string, Any>(), log: Fake["log"] = [], failAll = { on: false }, onCreate: Fake["onCreate"] = { fn: null }
  const key = (u: string, m: string): string => `${u}|${m}`
  const match = (row: Any, where: Any): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR") { if (!(v as Any[]).some((w) => match(row, w))) return false; continue }
      const cur = row[k]
      if (v === null) { if (cur !== null) return false; continue }
      if (typeof v === "object") {
        for (const [op, x] of Object.entries(v as Any)) {
          if (op === "lt") { if (!(cur !== null && cur < (x as Any))) return false } else if (op === "gt") { if (!(cur !== null && cur > (x as Any))) return false } else throw new Error(`operador fora do subconjunto do fake: ${op}`)
        }
        continue
      }
      if (cur !== v) return false
    }
    return true
  }
  const guard = (method: string, args: Any): void => { log.push({ method, args: JSON.parse(JSON.stringify(args)) }); if (failAll.on) throw new Error("SECRET-DB-URL postgresql://user:senha@host/db") }
  const client = { aiChatUsage: {
    async findUnique(args: Any) { guard("findUnique", args); const w = args.where.userId_month; const r = rows.get(key(w.userId, w.month)); return r === undefined ? null : { ...r } },
    async create(args: Any) { guard("create", args); const d = args.data; if (onCreate.fn !== null) { const f = onCreate.fn; onCreate.fn = null; f() } if (rows.has(key(d.userId, d.month))) throw Object.assign(new Error("unique"), { code: "P2002" }); rows.set(key(d.userId, d.month), { ...d }); return { ...d } },
    async updateMany(args: Any) {
      guard("updateMany", args); let count = 0
      for (const row of rows.values()) {
        if (!match(row, args.where)) continue
        for (const [k, v] of Object.entries(args.data)) { if (v !== null && typeof v === "object") { const o = v as Any; if ("increment" in o) row[k] += o.increment; else if ("decrement" in o) row[k] -= o.decrement; else throw new Error("data fora do subconjunto do fake") } else row[k] = v }
        count += 1
      }
      return { count }
    },
    async deleteMany(args: Any) { guard("deleteMany", args); let count = 0; for (const [k, row] of [...rows]) if (match(row, args.where)) { rows.delete(k); count += 1 } return { count } },
  } }
  return { client, rows, log, failAll, onCreate }
}

interface Impl { name: string; make: () => { store: Any; fake?: Fake }; reset?: () => Promise<void> }
const IMPLS: Impl[] = [
  { name: "memória", make: () => ({ store: createMemoryChatQuotaStore() }) },
  { name: "Prisma (cliente de mentira)", make: () => { const fake = fakeClient(); return { store: createPrismaChatQuotaStore(fake.client), fake } } },
]
// AO VIVO (E7-15b, Portão C): só com PRISMA_LIVE=1 e E7_TEST_DATABASE_URL(_POOLED) da branch descartável (a trava recusa produção). O MESMO contrato C1–C9 roda no Postgres real, direto e pelo pooler.
const LIVE: LiveDb[] = []
if (liveEnabled()) {
  for (const which of ["direct", "pooled"] as const) {
    const live = await connectLiveDb(which); LIVE.push(live)
    IMPLS.push({ name: `Postgres real (${which === "direct" ? "conexão direta" : "pooler"})`, make: () => ({ store: createPrismaChatQuotaStore(live.db) }), reset: async () => { await live.db.aiChatUsage.deleteMany({}) } })
  }
} else if (!process.env.COLLECT) console.log("… contrato AO VIVO do Postgres pulado: rode com PRISMA_LIVE=1 (precisa de E7_TEST_DATABASE_URL e _POOLED)")
const each = async (fn: (i: Impl) => Promise<void>): Promise<void> => { for (const i of IMPLS) { await i.reset?.(); await fn(i) } }

// ═════ contrato do ChatQuotaStore (roda nas duas implementações) ═════
await test("C1 — primeira reserva cria o contador: used 1; usage lê 1; linha ausente lê 0", async () => each(async ({ name, make }) => {
  const { store } = make()
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 0 }, name)
  assert.deepEqual(await store.reserve(rq(U1, "L1", 0)), { ok: true }, name)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 1 }, name)
}))

await test("C2 — enquanto há lease ativo, a 2ª reserva ⇒ TURN_IN_PROGRESS e NADA muda", async () => each(async ({ name, make }) => {
  const { store } = make(); await store.reserve(rq(U1, "L1", 0))
  assert.deepEqual(await store.reserve(rq(U1, "L2", 1000)), { ok: false, code: "TURN_IN_PROGRESS" }, name)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 1 }, name)
}))

await test("C3 — settle CONSUME libera o lease e MANTÉM o uso; a próxima reserva é a nº 2", async () => each(async ({ name, make }) => {
  const { store } = make(); await store.reserve(rq(U1, "L1", 0))
  assert.deepEqual(await store.settle(st(U1, "L1", "CONSUME", 10)), { ok: true, applied: true }, name)
  assert.deepEqual(await store.reserve(rq(U1, "L2", 20)), { ok: true }, name); assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 2 }, name)
}))

await test("C4 — settle REFUND devolve 1; repetido não devolve de novo; lease desconhecido ⇒ applied:false; nunca abaixo de 0", async () => each(async ({ name, make }) => {
  const { store } = make(); await store.reserve(rq(U1, "L1", 0))
  assert.deepEqual(await store.settle(st(U1, "L1", "REFUND", 10)), { ok: true, applied: true }, name)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 0 }, name)
  assert.deepEqual(await store.settle(st(U1, "L1", "REFUND", 20)), { ok: true, applied: false }, name)
  assert.deepEqual(await store.settle(st(U1, "LX", "CONSUME", 20)), { ok: true, applied: false }, name)
  assert.deepEqual(await store.settle(st(U2, "L1", "REFUND", 20)), { ok: true, applied: false }, name)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 0 }, name)
}))

await test("C5 — no limite ⇒ QUOTA_EXCEEDED {used, limit}, com prioridade sobre o lease em andamento; sem efeito", async () => each(async ({ name, make }) => {
  const { store } = make()
  await store.reserve(rq(U1, "L1", 0, 2)); await store.settle(st(U1, "L1", "CONSUME", 1))
  await store.reserve(rq(U1, "L2", 2, 2)) // used 2, lease de L2 ativo
  assert.deepEqual(await store.reserve(rq(U1, "L3", 3, 2)), { ok: false, code: "QUOTA_EXCEEDED", used: 2, limit: 2 }, `${name}: com lease ativo`)
  await store.settle(st(U1, "L2", "CONSUME", 4))
  assert.deepEqual(await store.reserve(rq(U1, "L3", 5, 2)), { ok: false, code: "QUOTA_EXCEEDED", used: 2, limit: 2 }, `${name}: sem lease`)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 2 }, name)
}))

await test("C6 — lease: vale até o instante exato (igual ainda segura); 1 ms depois permite takeover; o dono antigo não afeta mais nada", async () => each(async ({ name, make }) => {
  const { store } = make(); await store.reserve(rq(U1, "L1", 0, 10))
  assert.deepEqual(await store.reserve(rq(U1, "L2", CHAT_LEASE_MS, 10)), { ok: false, code: "TURN_IN_PROGRESS" }, `${name}: no instante exato`)
  assert.deepEqual(await store.reserve(rq(U1, "L2", CHAT_LEASE_MS + 1, 10)), { ok: true }, `${name}: takeover (o consumo do turno morto fica)`)
  assert.deepEqual(await store.settle(st(U1, "L1", "REFUND", CHAT_LEASE_MS + 2)), { ok: true, applied: false }, `${name}: dono antigo`)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 2 }, name)
  assert.deepEqual(await store.reserve(rq(U1, "L3", CHAT_LEASE_MS + 3, 10)), { ok: false, code: "TURN_IN_PROGRESS" }, `${name}: o lease do L2 segue valendo`)
}))

await test("C7 — meses e usuários independentes; deleteForUser apaga só as linhas daquele usuário (todos os meses)", async () => each(async ({ name, make }) => {
  const { store } = make()
  await store.reserve(rq(U1, "L1", 0)); await store.settle(st(U1, "L1", "CONSUME"))
  await store.reserve(rq(U1, "L2", 1, 3, "2026-11")); await store.reserve(rq(U2, "L3", 2))
  assert.deepEqual(await store.usage({ userId: U1, month: "2026-11" }), { ok: true, used: 1 }, name)
  assert.deepEqual(await store.deleteForUser(U1), { ok: true, deleted: 2 }, name)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 0 }, name)
  assert.deepEqual(await store.usage({ userId: U2, month: M }), { ok: true, used: 1 }, name)
  assert.deepEqual(await store.deleteForUser(U1), { ok: true, deleted: 0 }, name)
}))

await test("C8 — concorrência: 10 trabalhadores disputando limite 3 ⇒ EXATAMENTE 3 reservas, nunca 2 donos ao mesmo tempo", async () => each(async ({ name, make }) => {
  const { store } = make(); let ok = 0, active = 0, maxActive = 0, tick = 0
  const worker = async (i: number): Promise<void> => {
    for (let guard = 0; ; guard += 1) {
      assert.ok(guard < 500, `${name}: o limite nunca foi aplicado (laço sem fim)`)
      const r: Any = await store.reserve(rq(U1, `W${i}`, (tick += 1)))
      if (r.ok) { ok += 1; active += 1; maxActive = Math.max(maxActive, active); await Promise.resolve(); active -= 1; assert.equal((await store.settle(st(U1, `W${i}`, "CONSUME", tick))).applied, true); continue }
      if (r.code === "QUOTA_EXCEEDED") return
      assert.equal(r.code, "TURN_IN_PROGRESS", name)
      await Promise.resolve()
    }
  }
  await Promise.all(Array.from({ length: 10 }, (_, i) => worker(i)))
  assert.equal(ok, 3, name); assert.equal(maxActive, 1, name); assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 3 }, name)
}))

await test("C9 — argumentos inválidos ⇒ INVALID_ARGS sem efeito (reserve, settle, usage, deleteForUser)", async () => each(async ({ name, make }) => {
  const { store } = make(); const good = rq(U1, "L1", 0)
  const bad: Any[] = [{ userId: "" }, { userId: "../x" }, { userId: 5 }, { month: "2026-13" }, { month: "26-10" }, { month: 202610 }, { limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: NaN }, { limit: "3" }, { leaseId: "" }, { leaseId: "a b" }, { leaseId: "x".repeat(65) }, { leaseId: 5 }, { now: "ontem" }, { now: 5 }, { now: "2026-10-21" }]
  for (const patch of bad) assert.deepEqual(await store.reserve({ ...good, ...patch }), { ok: false, code: "INVALID_ARGS" }, `${name}: ${jstr(patch)}`)
  assert.deepEqual(await store.reserve(null), { ok: false, code: "INVALID_ARGS" }, name)
  assert.deepEqual(await store.reserve({ ...good, extra: 1 }), { ok: false, code: "INVALID_ARGS" }, `${name}: campo extra`)
  await store.reserve(good)
  for (const patch of [{ outcome: "X" }, { outcome: null }, { leaseId: "" }, { userId: "" }, { month: "x" }, { now: "ontem" }]) assert.deepEqual(await store.settle({ ...st(U1, "L1", "CONSUME"), ...patch }), { ok: false, code: "INVALID_ARGS" }, `${name}: settle ${jstr(patch)}`)
  assert.deepEqual(await store.usage({ userId: "", month: M }), { ok: false, code: "INVALID_ARGS" }, name); assert.deepEqual(await store.usage({ userId: U1, month: "x" }), { ok: false, code: "INVALID_ARGS" }, name)
  assert.deepEqual(await store.deleteForUser(""), { ok: false, code: "INVALID_ARGS" }, name)
  assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 1 }, `${name}: nada mudou`)
}))

// ═════ pool global do plano Free (D-C12): UM contador por mês para TODOS os Free, sem lease ═════
const pq = (limit = 3, ms = 0, month = M): Any => ({ month, limit, now: at(ms) })
await test("C10 — pool: poolTake até o limite; o seguinte ⇒ POOL_EXHAUSTED; poolGive devolve 1 (idempotente no zero); poolUsage lê; meses independentes", async () => each(async ({ name, make }) => {
  const { store } = make()
  assert.deepEqual(await store.poolUsage({ month: M }), { ok: true, used: 0 }, name)
  for (let i = 0; i < 3; i += 1) assert.deepEqual(await store.poolTake(pq(3, i)), { ok: true }, `${name} #${i + 1}`)
  assert.deepEqual(await store.poolTake(pq(3, 9)), { ok: false, code: "POOL_EXHAUSTED" }, name); assert.deepEqual(await store.poolUsage({ month: M }), { ok: true, used: 3 }, name)
  assert.deepEqual(await store.poolGive({ month: M, now: at(10) }), { ok: true, applied: true }, name); assert.deepEqual(await store.poolTake(pq(3, 11)), { ok: true }, name)
  assert.deepEqual(await store.poolTake(pq(3, 12, "2026-11")), { ok: true }, `${name}: outro mês`); assert.deepEqual(await store.poolUsage({ month: "2026-11" }), { ok: true, used: 1 }, name)
  for (let i = 0; i < 5; i += 1) await store.poolGive({ month: "2026-11", now: at(20 + i) })
  assert.deepEqual(await store.poolUsage({ month: "2026-11" }), { ok: true, used: 0 }, `${name}: nunca abaixo de 0`); assert.deepEqual(await store.poolGive({ month: "2026-11", now: at(30) }), { ok: true, applied: false }, name)
}))

await test("C11 — pool: 10 trabalhadores disputando limite 3 ⇒ EXATAMENTE 3 takes; o pool NÃO serializa (sem lease); o pool não aparece nos usuários e o expurgo de um usuário não o toca; userId reservado do pool é recusado nas reservas", async () => each(async ({ name, make }) => {
  const { store } = make(); let ok = 0
  await Promise.all(Array.from({ length: 10 }, async (_, i) => { for (let g = 0; g < 50; g += 1) { const r: Any = await store.poolTake(pq(3, i)); if (r.ok) { ok += 1; return } if (r.code === "POOL_EXHAUSTED") return; assert.fail(jstr(r)) } }))
  assert.equal(ok, 3, name); assert.deepEqual(await store.poolUsage({ month: M }), { ok: true, used: 3 }, name)
  assert.deepEqual(await store.deleteForUser(U1), { ok: true, deleted: 0 }, `${name}: o pool não é de usuário nenhum`); assert.deepEqual(await store.poolUsage({ month: M }), { ok: true, used: 3 }, name)
  assert.deepEqual(await store.reserve(rq(FREE_POOL_USER_ID, "L1", 0)), { ok: false, code: "INVALID_ARGS" }, name); assert.deepEqual(await store.usage({ userId: FREE_POOL_USER_ID, month: M }), { ok: false, code: "INVALID_ARGS" }, name)
  for (const patch of [{ month: "2026-13" }, { limit: 0 }, { limit: 1.5 }, { now: "ontem" }, { extra: 1 }]) assert.deepEqual(await store.poolTake({ ...pq(), ...patch }), { ok: false, code: "INVALID_ARGS" }, `${name}: ${jstr(patch)}`)
  assert.deepEqual(await store.poolGive({ month: "x", now: at(0) }), { ok: false, code: "INVALID_ARGS" }, name); assert.deepEqual(await store.poolUsage({ month: "x" }), { ok: false, code: "INVALID_ARGS" }, name)
}))

// ═════ regras de negócio (withChatQuota, getChatUsage, deleteChatUsageForUser) ═════
interface Clock { ms: number; deps: Any; store: Any }
const mkDeps = (store: Any = createMemoryChatQuotaStore(), ms = 0): Clock => { let n = 0; const c: Clock = { ms, store, deps: null }; c.deps = { store, now: () => at(c.ms), newLeaseId: () => `L${(n += 1)}` }; return c }
const okFn = async (): Promise<Any> => ({ ok: true, outcome: "ANSWERED", marker: "R" })

await test("Q1 — PLAN_CHAT_QUOTAS: FREE 3 (o mínimo do mínimo), TRADER 100, PRO 300; pool global dos Free 300/mês; inteiros positivos, crescentes, congelado", async () => {
  assert.deepEqual({ ...PLAN_CHAT_QUOTAS }, { FREE: 3, TRADER: 100, PRO: 300 })
  assert.equal(FREE_CHAT_POOL_PER_MONTH, 300); assert.equal(FREE_POOL_USER_ID, "pool-free-chat")
  assert.ok(Object.isFrozen(PLAN_CHAT_QUOTAS)); assert.ok(PLAN_CHAT_QUOTAS.FREE < PLAN_CHAT_QUOTAS.TRADER && PLAN_CHAT_QUOTAS.TRADER < PLAN_CHAT_QUOTAS.PRO)
  for (const v of Object.values(PLAN_CHAT_QUOTAS) as number[]) assert.ok(Number.isInteger(v) && v > 0)
})

await test("Q2 — mês civil em UTC: virada de ano, fuso ignorado; resetsAt = 1º dia do próximo mês 00:00 UTC", async () => {
  assert.equal(monthKey("2026-12-31T23:59:59.999Z"), "2026-12"); assert.equal(monthKey("2027-01-01T00:00:00.000Z"), "2027-01")
  assert.equal(monthKey("2026-10-31T23:30:00.000-03:00"), "2026-11"); assert.equal(monthKey("2026-10-21T12:00:00.000Z"), "2026-10")
  const c = mkDeps(); assert.equal(((await getChatUsage(c.deps, { userId: U1, plan: "FREE" })) as Any).resetsAt, "2026-11-01T00:00:00.000Z")
  const dec = mkDeps(createMemoryChatQuotaStore(), Date.parse("2026-12-15T00:00:00.000Z") - T0); assert.equal(((await getChatUsage(dec.deps, { userId: U1, plan: "FREE" })) as Any).resetsAt, "2027-01-01T00:00:00.000Z")
})

await test("Q3 — no limite do plano ⇒ QUOTA_EXCEEDED com limit, used e suggestedPlan; a fn NÃO é chamada", async () => {
  for (const [plan, limit, suggested] of [["FREE", 3, "TRADER"], ["TRADER", 100, "PRO"], ["PRO", 300, null]] as const) {
    const c = mkDeps(); let calls = 0
    for (let i = 0; i < limit; i += 1) { const r: Any = await withChatQuota(c.deps, { userId: U1, plan }, async () => { calls += 1; return okFn() }); assert.equal(r.ok, true, `${plan} #${i + 1}`); c.ms += 10 }
    const r: Any = await withChatQuota(c.deps, { userId: U1, plan }, async () => { calls += 1; return okFn() })
    assert.deepEqual(r, { ok: false, code: "QUOTA_EXCEEDED", limit, used: limit, suggestedPlan: suggested }, plan); assert.equal(calls, limit, `${plan}: fn não roda além do limite`)
  }
})

await test("Q4 — turno em andamento: 2ª chamada do MESMO usuário ⇒ TURN_IN_PROGRESS sem chamar a fn; depois de terminar, volta a funcionar; outro usuário não é afetado", async () => {
  const c = mkDeps(); let release: () => void = () => undefined; const gate = new Promise<void>((r) => { release = r }); let second = 0
  const first = withChatQuota(c.deps, { userId: U1, plan: "PRO" }, async () => { await gate; return okFn() })
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(await withChatQuota(c.deps, { userId: U1, plan: "PRO" }, async () => { second += 1; return okFn() }), { ok: false, code: "TURN_IN_PROGRESS" }); assert.equal(second, 0)
  assert.equal(((await withChatQuota(c.deps, { userId: U2, plan: "PRO" }, okFn)) as Any).ok, true)
  release(); assert.equal(((await first) as Any).ok, true)
  assert.equal(((await withChatQuota(c.deps, { userId: U1, plan: "PRO" }, okFn)) as Any).ok, true)
})

await test("Q5 — quem consome e quem devolve (D-C7): todos os códigos do turno", async () => {
  const REFUND = ["INVALID_ARGS", "SALT_REQUIRED", "NOT_FOUND", "STORAGE_ERROR", "MODEL_ERROR", "BUSY", "COMPOSE_FAILED"], CONSUME = ["TURN_CLOSED", "TURN_CONFLICT", "LIMIT_EXCEEDED", "COMMIT_REJECTED", "CODIGO_NOVO_DESCONHECIDO"]
  for (const [codes, expected] of [[REFUND, 0], [CONSUME, 1]] as const) for (const code of codes) {
    const c = mkDeps(); const r = await withChatQuota(c.deps, { userId: U1, plan: "TRADER" }, async () => ({ ok: false, code }))
    assert.deepEqual(r, { ok: false, code }, code); assert.deepEqual(await c.store.usage({ userId: U1, month: M }), { ok: true, used: expected }, `${code}: uso`)
    assert.equal(((await withChatQuota(c.deps, { userId: U1, plan: "TRADER" }, okFn)) as Any).ok, true, `${code}: lease liberado`)
  }
  for (const outcome of ["ANSWERED", "STOPPED"]) { const c = mkDeps(); await withChatQuota(c.deps, { userId: U1, plan: "TRADER" }, async () => ({ ok: true, outcome })); assert.deepEqual(await c.store.usage({ userId: U1, month: M }), { ok: true, used: 1 }, outcome) }
})

await test("Q6 — fn que LANÇA ⇒ devolve a cota e responde STORAGE_ERROR (nada lança); fn que devolve lixo ⇒ CONSOME (fail-closed) e responde STORAGE_ERROR", async () => {
  const c = mkDeps(); const r = await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, async () => { throw new Error("detalhe interno U1") })
  assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.deepEqual(await c.store.usage({ userId: U1, month: M }), { ok: true, used: 0 })
  for (const junk of [null, undefined, 5, "x", [], {}]) { const d = mkDeps(); const g = await withChatQuota(d.deps, { userId: U1, plan: "FREE" }, async () => junk as Any); assert.deepEqual(g, { ok: false, code: "STORAGE_ERROR" }, jstr(junk)); assert.deepEqual(await d.store.usage({ userId: U1, month: M }), { ok: true, used: 1 }, `lixo ${jstr(junk)} consome`) }
})

await test("Q7 — a fn NÃO roda e NADA é gravado com plano/usuário inválidos (sem I/O) nem com erro do banco na reserva; erro ao liquidar não esconde a resposta", async () => {
  let calls = 0; const spy = (): Any => { const inner = createMemoryChatQuotaStore(); const log: string[] = []; return { log, store: new Proxy(inner, { get: (t, p: string) => (typeof (t as Any)[p] === "function" ? (...a: unknown[]) => { log.push(p); return (t as Any)[p](...a) } : (t as Any)[p]) }) } }
  for (const [userId, plan] of [[U1, "ADMIN"], [U1, undefined], [U1, null], [U1, "pro"], ["", "FREE"], ["../x", "FREE"], [5, "FREE"]] as Any[]) { const s = spy(); const c = mkDeps(s.store); assert.deepEqual(await withChatQuota(c.deps, { userId, plan }, async () => { calls += 1; return okFn() }), { ok: false, code: "INVALID_ARGS" }, `${userId}/${plan}`); assert.deepEqual(s.log, [], "sem I/O") }
  const broken = { ...createMemoryChatQuotaStore(), reserve: async () => ({ ok: false, code: "STORAGE_ERROR" }) }
  assert.deepEqual(await withChatQuota(mkDeps(broken).deps, { userId: U1, plan: "FREE" }, async () => { calls += 1; return okFn() }), { ok: false, code: "STORAGE_ERROR" }); assert.equal(calls, 0)
  const inner = createMemoryChatQuotaStore(); const failSettle = { ...inner, settle: async () => ({ ok: false, code: "STORAGE_ERROR" }) }
  const r: Any = await withChatQuota(mkDeps(failSettle).deps, { userId: U1, plan: "FREE" }, okFn); assert.equal(r.marker, "R", "o usuário recebe a resposta que já foi paga")
  const throwSettle = { ...createMemoryChatQuotaStore(), settle: async () => { throw new Error("falha ao liquidar") } }
  const r2: Any = await withChatQuota(mkDeps(throwSettle).deps, { userId: U1, plan: "FREE" }, okFn); assert.equal(r2.marker, "R", "settle que lança também não esconde a resposta")
})

await test("Q8 — 50 chamadas paralelas do mesmo usuário: no máximo 1 fn por vez, nunca mais que o limite, nenhum resultado fora do conjunto permitido", async () => {
  const c = mkDeps(); let running = 0, maxRunning = 0, calls = 0
  const results: Any[] = await Promise.all(Array.from({ length: 50 }, async (_, i) => { await Promise.resolve(); c.ms = i; return withChatQuota(c.deps, { userId: U1, plan: "FREE" }, async () => { calls += 1; running += 1; maxRunning = Math.max(maxRunning, running); await Promise.resolve(); await Promise.resolve(); running -= 1; return okFn() }) }))
  assert.equal(maxRunning, 1); assert.ok(calls >= 1 && calls <= 3, `fn rodou ${calls}×`)
  for (const r of results) assert.ok(r.ok === true || ["TURN_IN_PROGRESS", "QUOTA_EXCEEDED"].includes(r.code), jstr(r))
  const u: Any = await c.store.usage({ userId: U1, month: M }); assert.ok(u.used <= 3 && u.used === calls)
})

await test("Q9 — o mês seguinte zera; usuários independentes; subir de plano libera na hora; descer NÃO apaga o uso (e bloqueia se já passou)", async () => {
  const c = mkDeps(); for (let i = 0; i < 3; i += 1) { await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn); c.ms += 10 }
  assert.equal(((await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn)) as Any).code, "QUOTA_EXCEEDED")
  assert.equal(((await withChatQuota(c.deps, { userId: U2, plan: "FREE" }, okFn)) as Any).ok, true, "outro usuário")
  assert.equal(((await withChatQuota(c.deps, { userId: U1, plan: "TRADER" }, okFn)) as Any).ok, true, "subir libera já")
  const d = mkDeps(); for (let i = 0; i < 50; i += 1) { await withChatQuota(d.deps, { userId: U1, plan: "TRADER" }, okFn); d.ms += 10 }
  assert.deepEqual(await withChatQuota(d.deps, { userId: U1, plan: "FREE" }, okFn), { ok: false, code: "QUOTA_EXCEEDED", limit: 3, used: 50, suggestedPlan: "TRADER" })
  assert.deepEqual(await d.store.usage({ userId: U1, month: M }), { ok: true, used: 50 })
  const e = mkDeps(); for (let i = 0; i < 300; i += 1) { await withChatQuota(e.deps, { userId: U1, plan: "PRO" }, okFn); e.ms += 10 }
  assert.equal(((await withChatQuota(e.deps, { userId: U1, plan: "FREE" }, okFn)) as Any).suggestedPlan, null, "nenhum plano acima comporta 300")
  d.ms = Date.parse("2026-11-01T00:00:01.000Z") - T0; assert.equal(((await withChatQuota(d.deps, { userId: U1, plan: "FREE" }, okFn)) as Any).ok, true, "mês novo")
})

await test("Q10 — apagar conversa e purgeUserData (LGPD) NÃO mexem no uso; só deleteChatUsageForUser (exclusão da conta) apaga", async () => {
  const c = mkDeps(); for (let i = 0; i < 5; i += 1) { await withChatQuota(c.deps, { userId: U1, plan: "TRADER" }, okFn); c.ms += 10 }
  const conversationStore = createMemoryConversationStore()
  const deps = { rawStorage: createMemoryRawFileStorage(), importStore: createMemoryImportSourceStore(), conversationStore, saltStore: createMemorySaltStore() }
  assert.equal(((await deleteConversation(deps, { userId: U1, conversationId: "cmd3h2k0a0000conv00000001" })) as Any).ok, true)
  assert.equal(((await purgeUserData(deps, { userId: U1 })) as Any).ok, true)
  assert.deepEqual(await c.store.usage({ userId: U1, month: M }), { ok: true, used: 5 }, "o furo da LGPD: cota intacta")
  assert.deepEqual(await deleteChatUsageForUser(c.deps, { userId: U1 }), { ok: true, deleted: 1 }); assert.deepEqual(await c.store.usage({ userId: U1, month: M }), { ok: true, used: 0 })
  assert.deepEqual(await deleteChatUsageForUser(c.deps, { userId: "" }), { ok: false, code: "INVALID_ARGS" })
  for (const f of ["src/lib/infra/user-purge.ts"]) assert.doesNotMatch(readFileSync(ROOT + f, "utf8"), /chat-quota|ChatUsage|ai_chat_usage/i, `${f} não conhece o uso`)
})

await test("Q11 — resultados sem userId, leaseId nem texto; QUOTA_EXCEEDED com as chaves exatas", async () => {
  const c = mkDeps(); const seen: string[] = []
  seen.push(jstr(await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn)))
  const r1: Any = await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, async () => ({ ok: false, code: "MODEL_ERROR" })); seen.push(jstr(r1))
  for (let i = 0; i < 20; i += 1) { c.ms += 10; await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn) }
  const ex: Any = await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn); seen.push(jstr(ex)); assert.deepEqual(Object.keys(ex).sort(), ["code", "limit", "ok", "suggestedPlan", "used"])
  seen.push(jstr(await getChatUsage(c.deps, { userId: U1, plan: "FREE" })))
  for (const s of seen) assert.doesNotMatch(s, /cmd3h2k0a0000|"L\d+"|leaseId|Error|detalhe/, s)
})

await test("Q12 — getChatUsage: { used, limit, remaining, resetsAt }; remaining nunca negativo; plano inválido ⇒ INVALID_ARGS", async () => {
  const c = mkDeps(); await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn)
  assert.deepEqual(await getChatUsage(c.deps, { userId: U1, plan: "FREE" }), { ok: true, used: 1, limit: 3, remaining: 2, resetsAt: "2026-11-01T00:00:00.000Z" })
  const d = mkDeps(); for (let i = 0; i < 50; i += 1) { await withChatQuota(d.deps, { userId: U1, plan: "TRADER" }, okFn); d.ms += 10 }
  assert.equal(((await getChatUsage(d.deps, { userId: U1, plan: "FREE" })) as Any).remaining, 0)
  assert.deepEqual(await getChatUsage(c.deps, { userId: U1, plan: "X" as Any }), { ok: false, code: "INVALID_ARGS" })
})

await test("Q13 — os módulos da cota não têm relógio/aleatório de módulo, ambiente, rede, @prisma/client nem SQL cru (o lease aleatório só em chat-quota.ts)", async () => {
  for (const f of ["src/lib/infra/chat-quota-store.ts", "src/lib/infra/prisma-chat-quota-store.ts", "src/lib/infra/chat-quota.ts"]) {
    const src = readFileSync(ROOT + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    assert.doesNotMatch(src, /Date\.now|new Date\(\s*\)|process\.env|\bfetch\s*\(|@prisma\/client|\$queryRaw|\$executeRaw|\bimport\s*\(/, f)
    if (f !== "src/lib/infra/chat-quota.ts") assert.doesNotMatch(src, /Math\.random|randomUUID|randomBytes/, f)
  }
})

// ═════ adaptador Prisma (forma exata das chamadas) ═════
await test("Q14 — pool do Free em withChatQuota: Free toma 1 do pool por turno; pool esgotado ⇒ FREE_POOL_EXHAUSTED {upgrade TRADER}, fn NÃO roda, o uso do usuário VOLTA e o lease é liberado; TRADER/PRO não tocam no pool; REFUND devolve ao pool, CONSUME mantém; falha do pool ⇒ STORAGE_ERROR sem rodar a fn", async () => {
  const c = mkDeps(); await withChatQuota(c.deps, { userId: U1, plan: "FREE" }, okFn); assert.deepEqual(await c.store.poolUsage({ month: M }), { ok: true, used: 1 })
  for (const plan of ["TRADER", "PRO"] as const) { const d = mkDeps(); await withChatQuota(d.deps, { userId: U2, plan }, okFn); assert.deepEqual(await d.store.poolUsage({ month: M }), { ok: true, used: 0 }, plan) }
  const e = mkDeps(); await withChatQuota(e.deps, { userId: U1, plan: "FREE" }, async () => ({ ok: false, code: "MODEL_ERROR" })); assert.deepEqual(await e.store.poolUsage({ month: M }), { ok: true, used: 0 }, "REFUND devolve ao pool"); assert.deepEqual(await e.store.usage({ userId: U1, month: M }), { ok: true, used: 0 })
  const f = mkDeps(); await withChatQuota(f.deps, { userId: U1, plan: "FREE" }, async () => ({ ok: false, code: "LIMIT_EXCEEDED" })); assert.deepEqual(await f.store.poolUsage({ month: M }), { ok: true, used: 1 }, "CONSUME mantém"); await withChatQuota(f.deps, { userId: U2, plan: "FREE" }, async () => { throw new Error("x") }); assert.deepEqual(await f.store.poolUsage({ month: M }), { ok: true, used: 1 }, "fn que lança devolve")
  const g = mkDeps(); for (let i = 0; i < FREE_CHAT_POOL_PER_MONTH; i += 1) await g.store.poolTake({ month: M, limit: FREE_CHAT_POOL_PER_MONTH, now: at(i) }); let ran = 0
  const r = await withChatQuota(g.deps, { userId: U1, plan: "FREE" }, async () => { ran += 1; return okFn() }); assert.deepEqual(r, { ok: false, code: "FREE_POOL_EXHAUSTED", upgrade: true, suggestedPlan: "TRADER" }); assert.equal(ran, 0)
  assert.deepEqual(await g.store.usage({ userId: U1, month: M }), { ok: true, used: 0 }, "o uso volta"); assert.equal(((await withChatQuota(g.deps, { userId: U1, plan: "TRADER" }, okFn)) as Any).ok, true, "pagante segue (e o lease do Free foi liberado)")
  const h = mkDeps(); const broken = { ...h.store, poolTake: async () => ({ ok: false, code: "STORAGE_ERROR" }) }; let ran2 = 0
  assert.deepEqual(await withChatQuota(mkDeps(broken).deps, { userId: U1, plan: "FREE" }, async () => { ran2 += 1; return okFn() }), { ok: false, code: "STORAGE_ERROR" }); assert.equal(ran2, 0); assert.deepEqual(await h.store.usage({ userId: U1, month: M }), { ok: true, used: 0 })
  const order = mkDeps(); for (let i = 0; i < 3; i += 1) { await withChatQuota(order.deps, { userId: U1, plan: "FREE" }, okFn); order.ms += 10 } const before = await order.store.poolUsage({ month: M })
  assert.equal(((await withChatQuota(order.deps, { userId: U1, plan: "FREE" }, okFn)) as Any).code, "QUOTA_EXCEEDED"); assert.deepEqual(await order.store.poolUsage({ month: M }), before, "cota do usuário esgotada NÃO consome o pool")
})

await test("P1 — reserve = UM updateMany atômico: where { userId, month, used lt limite, OR [lease nulo, lease lt agora] }, data { used increment 1, leaseId, leaseUntil, updatedAt }", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client); await s.reserve(rq(U1, "L1", 0)); await s.reserve(rq(U1, "L2", CHAT_LEASE_MS + 5))
  const upd = f.log.filter((l) => l.method === "updateMany")
  assert.deepEqual(upd[1].args, { where: { userId: U1, month: M, used: { lt: 3 }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: at(CHAT_LEASE_MS + 5) } }] }, data: { used: { increment: 1 }, leaseId: "L2", leaseUntil: at(CHAT_LEASE_MS + 5 + CHAT_LEASE_MS), updatedAt: at(CHAT_LEASE_MS + 5) } })
})

await test("P2 — linha ausente: updateMany(0) → findUnique(userId_month) → create { used 1, lease }; depois a reserva seguinte é só o updateMany", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client); await s.reserve(rq(U1, "L1", 0))
  assert.deepEqual(f.log.map((l) => l.method), ["updateMany", "findUnique", "create"])
  assert.deepEqual(f.log[1].args, { where: { userId_month: { userId: U1, month: M } } })
  assert.deepEqual(f.log[2].args, { data: { userId: U1, month: M, used: 1, leaseId: "L1", leaseUntil: at(CHAT_LEASE_MS), updatedAt: at(0) } })
  f.log.length = 0; await s.settle(st(U1, "L1", "CONSUME", 5)); await s.reserve(rq(U1, "L2", 10)); assert.deepEqual(f.log.map((l) => l.method), ["updateMany", "updateMany"])
})

await test("P3 — corrida na criação (P2002): repete o updateMany UMA vez; vencedor com lease ⇒ TURN_IN_PROGRESS; sem loop", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client)
  f.onCreate.fn = (): void => { f.rows.set(`${U1}|${M}`, { userId: U1, month: M, used: 1, leaseId: "OUTRO", leaseUntil: at(CHAT_LEASE_MS), updatedAt: at(0) }) }
  assert.deepEqual(await s.reserve(rq(U1, "L1", 0)), { ok: false, code: "TURN_IN_PROGRESS" })
  assert.deepEqual(f.log.map((l) => l.method), ["updateMany", "findUnique", "create", "updateMany", "findUnique"])
})

await test("P3b — se a criação perde a corrida DUAS vezes (estado impossível), para: exatamente 1 create, STORAGE_ERROR, sem laço", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client)
  ;(f.client.aiChatUsage as Any).create = async (args: Any) => { f.log.push({ method: "create", args }); throw Object.assign(new Error("unique"), { code: "P2002" }) }
  assert.deepEqual(await s.reserve(rq(U1, "L1", 0)), { ok: false, code: "STORAGE_ERROR" })
  assert.deepEqual(f.log.map((l) => l.method), ["updateMany", "findUnique", "create", "updateMany", "findUnique"])
})

await test("P4 — settle: where { userId, month, leaseId } (+ used gt 0 no REFUND); data libera o lease e (REFUND) used decrement 1; sem nada além disso", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client); await s.reserve(rq(U1, "L1", 0)); f.log.length = 0
  await s.settle(st(U1, "L1", "CONSUME", 7)); await s.reserve(rq(U1, "L2", 8)); f.log.length = 0; await s.settle(st(U1, "L2", "REFUND", 9))
  assert.deepEqual(f.log[0].args, { where: { userId: U1, month: M, leaseId: "L2", used: { gt: 0 } }, data: { leaseId: null, leaseUntil: null, used: { decrement: 1 }, updatedAt: at(9) } })
  const g = fakeClient(); const t = createPrismaChatQuotaStore(g.client); await t.reserve(rq(U1, "L1", 0)); g.log.length = 0; await t.settle(st(U1, "L1", "CONSUME", 7))
  assert.deepEqual(g.log[0].args, { where: { userId: U1, month: M, leaseId: "L1" }, data: { leaseId: null, leaseUntil: null, updatedAt: at(7) } })
})

await test("P5 — QUALQUER falha do banco ⇒ STORAGE_ERROR sem eco (URL/mensagem/userId); resposta malformada ou linha corrompida ⇒ STORAGE_ERROR (fail-closed)", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client); f.failAll.on = true
  const all: Any[] = [await s.reserve(rq(U1, "L1", 0)), await s.settle(st(U1, "L1", "CONSUME")), await s.usage({ userId: U1, month: M }), await s.deleteForUser(U1)]
  for (const r of all) { assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.doesNotMatch(jstr(r), /SECRET|postgres|senha|cmd3h2k0a0000/) }
  for (const weird of [undefined, null, 5, { count: -1 }, { count: 1.5 }, { count: "1" }]) {
    const g = fakeClient(); (g.client.aiChatUsage as Any).updateMany = async () => weird; const t = createPrismaChatQuotaStore(g.client)
    assert.deepEqual(await t.reserve(rq(U1, "L1", 0)), { ok: false, code: "STORAGE_ERROR" }, jstr(weird)); assert.deepEqual(await t.settle(st(U1, "L1", "CONSUME")), { ok: false, code: "STORAGE_ERROR" }, jstr(weird))
  }
  for (const row of [{ userId: U1, month: M, used: "x", leaseId: null, leaseUntil: null, updatedAt: at(0) }, { userId: U1, month: M, used: -2, leaseId: null, leaseUntil: null, updatedAt: at(0) }, { userId: U2, month: M, used: 1, leaseId: null, leaseUntil: null, updatedAt: at(0) }, "lixo"]) {
    const g = fakeClient(); (g.client.aiChatUsage as Any).findUnique = async () => row; const t = createPrismaChatQuotaStore(g.client)
    assert.deepEqual(await t.usage({ userId: U1, month: M }), { ok: false, code: "STORAGE_ERROR" }, jstr(row)); assert.deepEqual(await t.reserve(rq(U1, "L1", 0, 1)), { ok: false, code: "STORAGE_ERROR" }, `reserve: ${jstr(row)}`)
  }
  { const g = fakeClient(); (g.client.aiChatUsage as Any).create = async () => { throw new Error("SECRET-DB-URL") }; const t = createPrismaChatQuotaStore(g.client); const r = await t.reserve(rq(U1, "L1", 0)); assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.doesNotMatch(jstr(r), /SECRET/); assert.deepEqual(g.log.map((l) => l.method), ["updateMany", "findUnique"], "falha que não é P2002 não repete") }
  assert.throws(() => createPrismaChatQuotaStore({} as Any), TypeError); assert.throws(() => createPrismaChatQuotaStore(null as Any), TypeError)
})

await test("P7 — pool no Prisma: take = updateMany { userId do pool, month, used lt limite } com increment; linha ausente ⇒ findUnique → create { used 1, sem lease }; P2002 ⇒ repete UMA vez; give = updateMany { used gt 0 } com decrement; falhas ⇒ STORAGE_ERROR sem eco", async () => {
  const f = fakeClient(); const s = createPrismaChatQuotaStore(f.client); await s.poolTake(pq(3, 0)); await s.poolTake(pq(3, 5)); await s.poolGive({ month: M, now: at(7) })
  assert.deepEqual(f.log.map((l) => l.method), ["updateMany", "findUnique", "create", "updateMany", "updateMany"])
  assert.deepEqual(f.log[0].args, { where: { userId: FREE_POOL_USER_ID, month: M, used: { lt: 3 } }, data: { used: { increment: 1 }, updatedAt: at(0) } })
  assert.deepEqual(f.log[2].args, { data: { userId: FREE_POOL_USER_ID, month: M, used: 1, leaseId: null, leaseUntil: null, updatedAt: at(0) } })
  assert.deepEqual(f.log[4].args, { where: { userId: FREE_POOL_USER_ID, month: M, used: { gt: 0 } }, data: { used: { decrement: 1 }, updatedAt: at(7) } })
  const g = fakeClient(); const t = createPrismaChatQuotaStore(g.client); g.onCreate.fn = (): void => { g.rows.set(`${FREE_POOL_USER_ID}|${M}`, { userId: FREE_POOL_USER_ID, month: M, used: 1, leaseId: null, leaseUntil: null, updatedAt: at(0) }) }
  assert.deepEqual(await t.poolTake(pq(3, 0)), { ok: true }); assert.deepEqual(g.log.map((l) => l.method), ["updateMany", "findUnique", "create", "updateMany"])
  const h = fakeClient(); const u = createPrismaChatQuotaStore(h.client); h.failAll.on = true
  for (const r of [await u.poolTake(pq()), await u.poolGive({ month: M, now: at(0) }), await u.poolUsage({ month: M })] as Any[]) { assert.deepEqual(r, { ok: false, code: "STORAGE_ERROR" }); assert.doesNotMatch(jstr(r), /SECRET|postgres|senha/) }
})

await test("P6 — schema e migração: modelo AiChatUsage (PK userId+month, sem relação), migração SÓ cria a tabela nova, modelos anteriores intactos, nenhum DROP/ALTER/DELETE", async () => {
  const schema = readFileSync(ROOT + "prisma/schema.prisma", "utf8"); const block = /model AiChatUsage \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? ""
  assert.ok(block.length > 0, "modelo ausente"); assert.match(block, /@@id\(\[userId, month\]\)/); assert.match(block, /@@map\("ai_chat_usage"\)/); assert.doesNotMatch(block, /@relation/)
  for (const m of ["AiUserSalt", "AiImportSource", "AiConversation", "AiConversationDelta", "User"]) assert.match(schema, new RegExp(`model ${m} \\{`), m)
  const dir = readdirSync(ROOT + "prisma/migrations").filter((d) => /add_ai_chat_usage$/.test(d)); assert.equal(dir.length, 1)
  const sql = readFileSync(ROOT + `prisma/migrations/${dir[0]}/migration.sql`, "utf8")
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1); assert.match(sql, /CREATE TABLE "ai_chat_usage"/); assert.match(sql, /PRIMARY KEY \("user_id","month"\)/)
  assert.doesNotMatch(sql, /\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE|INSERT|REFERENCES|FOREIGN)\b/i)
  for (const col of ["user_id", "month", "used", "lease_id", "lease_until", "updated_at"]) assert.match(sql, new RegExp(`"${col}"`), col)
})

// ═════ só no Postgres real ═════
if (LIVE.length > 0) {
  const [direct, pooled] = LIVE
  await test("V1 — 10 PRIMEIRAS reservas simultâneas da mesma linha nova (corrida real de criação, P2002 de verdade) ⇒ EXATAMENTE 1 dona; as outras TURN_IN_PROGRESS; nenhum STORAGE_ERROR", async () => {
    for (const live of LIVE) {
      await live.db.aiChatUsage.deleteMany({}); const store = createPrismaChatQuotaStore(live.db)
      const rs: Any[] = await Promise.all(Array.from({ length: 10 }, (_, i) => store.reserve(rq(U1, `V${i}`, 0, 5))))
      assert.equal(rs.filter((r) => r.ok).length, 1, jstr(rs)); assert.equal(rs.filter((r) => r.code === "TURN_IN_PROGRESS").length, 9, jstr(rs))
      assert.deepEqual(await store.usage({ userId: U1, month: M }), { ok: true, used: 1 })
    }
  })
  await test("V2 — a ordem de TEXTO ISO no Postgres real == a cronológica (o `lt` do lease): 150 pares de instantes de 2026–2028, incluindo viradas de mês/ano e milissegundos", async () => {
    const pad = (n: number, w = 2): string => String(n).padStart(w, "0"); let seed = 12345; const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    const iso = (): string => new Date(Date.UTC(2026 + rnd(3), rnd(12), 1 + rnd(28), rnd(24), rnd(60), rnd(60), rnd(1000))).toISOString()
    const pairs = [["2026-12-31T23:59:59.999Z", "2027-01-01T00:00:00.000Z"], ["2026-10-21T12:01:30.000Z", "2026-10-21T12:01:30.001Z"], ["2026-09-30T23:59:59.999Z", "2026-10-01T00:00:00.000Z"], ["2026-10-21T09:00:00.000Z", "2026-10-21T10:00:00.000Z"], ...Array.from({ length: 146 }, () => [iso(), iso()])]
    void pad
    const rows: Any[] = await Promise.all(pairs.map(([a, b]) => direct.db.$queryRawUnsafe("SELECT ($1::text < $2::text) AS lt", a, b)))
    pairs.forEach(([a, b], i) => assert.equal(rows[i][0].lt, a < b, `${a} < ${b}`))
  })
  await test("V3 — 10 trabalhadores × limite 3 no pooler E na conexão direta ao mesmo tempo (20 trabalhadores, usuários diferentes): cada usuário recebe EXATAMENTE 3; a latência de reserva+liquidação é medida", async () => {
    await direct.db.aiChatUsage.deleteMany({}); const sd = createPrismaChatQuotaStore(direct.db), sp = createPrismaChatQuotaStore(pooled.db)
    const counts: Record<string, number> = { [U1]: 0, [U2]: 0 }; let tick = 0; const lat: number[] = []
    const worker = async (store: Any, user: string, i: number): Promise<void> => {
      for (let guard = 0; ; guard += 1) {
        assert.ok(guard < 800, "laço sem fim"); const t0 = performance.now(); const r: Any = await store.reserve(rq(user, `X${user.slice(-2)}${i}`, (tick += 1), 3))
        if (r.ok) { counts[user] += 1; await store.settle(st(user, `X${user.slice(-2)}${i}`, "CONSUME", tick)); lat.push(performance.now() - t0); continue }
        if (r.code === "QUOTA_EXCEEDED") return
        assert.equal(r.code, "TURN_IN_PROGRESS")
      }
    }
    await Promise.all([...Array.from({ length: 10 }, (_, i) => worker(sd, U1, i)), ...Array.from({ length: 10 }, (_, i) => worker(sp, U2, i))])
    assert.deepEqual(counts, { [U1]: 3, [U2]: 3 }); lat.sort((a, b) => a - b); console.log(`   latência reserva+liquidação: p50 ${lat[Math.floor(lat.length / 2)].toFixed(0)} ms, máx ${lat[lat.length - 1].toFixed(0)} ms (${lat.length} amostras)`)
  })
  await test("V4 — a tabela real: colunas e tipos esperados; PK composta (user_id, month); nenhuma outra tabela ganhou coluna (as 4 ai_* e o legado seguem como estavam)", async () => {
    const cols: Any[] = await direct.db.$queryRawUnsafe("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'ai_chat_usage' ORDER BY ordinal_position")
    assert.deepEqual(cols.map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`), ["user_id:text:NO", "month:text:NO", "used:integer:NO", "lease_id:text:YES", "lease_until:text:YES", "updated_at:text:NO"])
    const pk: Any[] = await direct.db.$queryRawUnsafe("SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'ai_chat_usage'::regclass AND i.indisprimary ORDER BY a.attnum")
    assert.deepEqual(pk.map((r) => r.attname), ["user_id", "month"])
    const tables: Any[] = await direct.db.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ai\\_%' ORDER BY 1")
    assert.deepEqual(tables.map((t) => t.table_name), ["ai_chat_usage", "ai_conversation_deltas", "ai_conversations", "ai_import_sources", "ai_user_salts"])
  })
  for (const live of LIVE) { await live.db.aiChatUsage.deleteMany({}); await live.close() }
}

if (process.env.COLLECT) console.log(JSON.stringify({ passed, failed }))
else console.log(`\n${passed} testes ✓`)
