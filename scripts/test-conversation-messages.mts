// E7-9: persistência das MENSAGENS da conversa (infra/conversation-store.ts): `messages` opcional no MESMO delta do turno (atômico, CAS, expurgo LGPD herdados).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_9 (D-M1…D-M9; M1–M8 aqui, N1–N8 em test-turn-session.mts; mutações EM1–EM22).
//   node scripts/test-conversation-messages.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isStale } from "../src/lib/agent/ledger.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"
import { MAX_MESSAGES, createConversations, createDiskConversationStore, createMemoryConversationStore, type ConversationStore, type Conversations, type OpenConversation, type TurnChange } from "../src/lib/infra/conversation-store.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { createMemorySaltStore } from "../src/lib/infra/salt-store.ts"
import { deleteConversation, purgeUserData } from "../src/lib/infra/user-purge.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"

// ── fixtures ──
const REF = (n: string): string => `ev_${n.repeat(32)}`
const handle = (ref: string, epoch = "s1"): Any => ({
  evidenceRef: ref, evidenceHash: "a".repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: 3, verifiability: "FULL" }, refEpoch: epoch, freshness: "CURRENT",
  verdict: buildVerdict({ status: "VALID", codes: [] }, { status: "SOURCE_VERIFIED", codes: [] }),
})
const metric: Any = { metricId: "netPnl", value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null }
const qEntry = (n: string, epoch = "s1"): Any => ({ capability: "metrics.query@1", handle: handle(REF(n), epoch), view: { metrics: [metric], period: { from: null, to: null } } })
const add = (e: Any): Any => ({ op: "add", entry: e })
const USER = (text = "qual foi o resultado?"): Any => ({ role: "user", text })
const answerOf = (...refs: string[]): Any => ({ segments: [{ kind: "text", text: "Segue:" }, ...refs.map((ref) => ({ kind: "slot", ref, path: "metrics[0].value" })), ...refs.map((ref) => ({ kind: "phrase", code: "POPULATION_DECLARED", ref }))], claims: refs.map((ref) => ({ ref, path: "metrics[0].value", mode: "ASSERT" })) })
const RENDERED = (text = "ok"): Any => ({ segments: [{ kind: "text", text }], banner: { combined: null, label: null }, stopReason: null })
const STOP_RENDERED: Any = { segments: [{ kind: "phrase", code: "REGEN_EXHAUSTED", text: "Não consegui." }], banner: { combined: null, label: null }, stopReason: "REGEN_EXHAUSTED" }
const ASST = (answer: Any, rendered: Any = answer === null ? STOP_RENDERED : RENDERED()): Any => ({ role: "assistant", answer, rendered })
/** O que vai NO DELTA (com citations derivadas) a partir da mensagem lida. */
const recOf = (m: Any): Any => (m.role === "user" ? { role: "user", text: m.text } : { role: "assistant", answer: m.answer, citations: m.citations, rendered: m.rendered })
const EMPTY_DELTA = (messages?: Any): Any => ({ rotateTo: null, writes: [], specs: [], alias: null, ...(messages !== undefined ? { messages } : {}) })
const ISO = (n: number): string => new Date(Date.UTC(2026, 9, 20, 10, 0, n)).toISOString()

// ── armazenamentos ──
const TMPS: string[] = []
interface Impl { name: string; make: () => { store: ConversationStore; root?: string } }
const IMPLS: Impl[] = [
  { name: "memória", make: () => ({ store: createMemoryConversationStore() }) },
  { name: "disco", make: () => { const root = mkdtempSync(join(tmpdir(), "conv-msg-")); TMPS.push(root); return { store: createDiskConversationStore(root), root } } },
]
const both = async (fn: (store: ConversationStore, name: string, root?: string) => Promise<void>): Promise<void> => { for (const impl of IMPLS) { const m = impl.make(); await fn(m.store, impl.name, m.root) } }
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const clock = (): (() => string) => { let n = 0; return () => ISO(n++) }
const codeOf = (r: Any): string => (r.ok ? "OK" : r.code)
async function start(store: ConversationStore, user = U1, now: () => string = clock()): Promise<{ convs: Conversations; open: OpenConversation }> {
  const convs = createConversations({ store, now })
  const r: Any = await convs.create(user, "s1")
  assert.equal(r.ok, true, `create: ${codeOf(r)}`)
  return { convs, open: r.open }
}
async function commit(convs: Conversations, open: OpenConversation, change: TurnChange): Promise<OpenConversation> {
  const r: Any = await convs.commitTurn(open, change)
  assert.equal(r.ok, true, `commitTurn: ${codeOf(r)}`)
  return r.open
}
async function reopen(store: ConversationStore, user: string, open: OpenConversation): Promise<OpenConversation> {
  const r: Any = await createConversations({ store }).open(user, open.conversationId)
  assert.equal(r.ok, true, `open: ${codeOf(r)}`)
  return r.open
}
const deltasOf = async (store: ConversationStore, user: string, id: string): Promise<Any[]> => { const r: Any = await store.load(user, id); assert.equal(r.ok, true); return r.deltas }

// ───────────────────────────── M1: formato ─────────────────────────────
await test("M1 — delta SEM messages segue legível (sem a chave, open.messages = []); com messages é gravado e relido igual; formas inválidas ⇒ INVALID_ARGS no store e MESSAGE_INVALID na fachada, SEM efeito", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    // delta antigo (sem a chave) gravado direto no store
    const old: Any = await store.commit(U1, o0.conversationId, 0, EMPTY_DELTA(), ISO(1)); assert.equal(old.ok, true, name)
    const d0 = (await deltasOf(store, U1, o0.conversationId))[0]
    assert.equal(Object.hasOwn(d0, "messages"), false, `${name}: o delta antigo não ganha a chave`)
    const o1 = await reopen(store, U1, o0); assert.deepEqual([o1.version, o1.messages], [1, []], name)
    // com mensagens, pela fachada
    const a = REF("a")
    const o = await commit(convs, ((await convs.open(U1, o0.conversationId)) as Any).open, { writes: [add(qEntry("a"))], messages: [USER(), ASST(answerOf(a))] })
    const back = await reopen(store, U1, o)
    assert.deepEqual(back.messages.map((m: Any) => m.role), ["user", "assistant"], name)
    assert.deepEqual(back.messages, o.messages, `${name}: o estado devolvido pelo commit == o relido`)
    assert.equal(back.messages[0].text, "qual foi o resultado?", name)
    assert.deepEqual(back.messages[1].answer, answerOf(a), name)
    // formas inválidas no STORE (a régua é a mesma em memória e disco)
    const good = recOf(back.messages[1]), gu = recOf(back.messages[0])
    const bads: Array<[string, Any]> = [
      ["não é array", "x"], ["array vazio", []], ["3 itens", [gu, good, gu]], ["dois user", [gu, gu]], ["dois assistant", [good, good]], ["assistant antes do user", [good, gu]],
      ["user com chave extra", [{ ...gu, extra: 1 }]], ["user sem text", [{ role: "user" }]], ["user com text não string", [{ role: "user", text: 5 }]], ["user só espaços", [{ role: "user", text: "   " }]], ["user com 4.001", [{ role: "user", text: "x".repeat(4001) }]],
      ["papel desconhecido", [{ role: "system", text: "oi" }]], ["assistant sem rendered", [{ role: "assistant", answer: null, citations: [] }]], ["assistant com answer inválido", [{ ...good, answer: { segments: [], claims: [] } }]],
      ["citations diferentes das derivadas", [{ ...good, citations: [REF("b")] }]], ["citations fora de ordem/duplicadas", [{ ...good, citations: [REF("a"), REF("a")] }]], ["STOP com answer não nulo", [{ ...good, rendered: STOP_RENDERED }]], ["resposta aceita com rendered de STOP", [{ role: "assistant", answer: null, citations: [], rendered: RENDERED() }]],
      ["rendered com chave extra", [{ ...good, rendered: { ...RENDERED(), x: 1 } }]], ["rendered com segmento desconhecido", [{ ...good, rendered: { ...RENDERED(), segments: [{ kind: "html", text: "x" }] } }]],
    ]
    for (const [why, messages] of bads) {
      const before = (await deltasOf(store, U1, o.conversationId)).length
      const r: Any = await store.commit(U1, o.conversationId, o.version, EMPTY_DELTA(messages), ISO(5))
      assert.deepEqual(r, { ok: false, code: "INVALID_ARGS" }, `${name}: ${why}: ${JSON.stringify(r)}`)
      assert.equal((await deltasOf(store, U1, o.conversationId)).length, before, `${name}: ${why}: sem efeito`)
    }
    // na fachada: o mesmo vira MESSAGE_INVALID (e nada é gravado)
    const facadeBads: Array<[string, Any]> = [["3 itens", [USER(), ASST(null), USER()]], ["dois user", [USER(), USER()]], ["assistant antes", [ASST(null), USER()]], ["user vazio", [USER("")]], ["user 4.001", [USER("x".repeat(4001))]], ["chave extra", [{ ...USER(), extra: 1 }]], ["não array", "x"], ["vazio", []], ["answer inválido", [ASST({ nope: 1 }, RENDERED())]]]
    for (const [why, messages] of facadeBads) {
      const r: Any = await convs.commitTurn(o, { messages } as Any)
      assert.deepEqual(r, { ok: false, code: "MESSAGE_INVALID" }, `${name}: ${why}: ${JSON.stringify(r)}`)
    }
    assert.equal((await reopen(store, U1, o)).version, o.version, `${name}: versão intacta`)
    // o limite de 4.000 é inclusivo
    const edge = await commit(convs, o, { messages: [USER("y".repeat(4000))] }); assert.equal(edge.messages.at(-1)!.text.length, 4000, name)
  })
})

// ───────────────────────────── M2: limites ─────────────────────────────
await test("M2 — limites: mensagem de EXATAMENTE 64 KiB ok e 1 byte a mais ⇒ LIMIT_MESSAGES; a 200ª mensagem ok e a 201ª ⇒ LIMIT_MESSAGES (versão e mensagens inalteradas)", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const sized = (extra: number): Any => {
      const at = (n: number): Any => ASST(null, { ...STOP_RENDERED, segments: [{ kind: "server_text", text: "a".repeat(n) }] })
      let n = 1000; const bytes = (m: Any): number => Buffer.byteLength(JSON.stringify({ ...m, citations: [] }), "utf8")
      n += 65536 - bytes(at(n)) + extra
      return at(n)
    }
    const exact = sized(0), over = sized(1)
    assert.equal(Buffer.byteLength(JSON.stringify({ ...exact, citations: [] }), "utf8"), 65536, "fixture: exatamente 64 KiB")
    const r: Any = await convs.commitTurn(o0, { messages: [over] }); assert.deepEqual(r, { ok: false, code: "LIMIT_MESSAGES" }, `${name}: ${JSON.stringify(r)}`)
    assert.equal((await reopen(store, U1, o0)).version, 0, `${name}: nada gravado`)
    let o = await commit(convs, o0, { messages: [exact] }); assert.equal(o.messages.length, 1, name)
    // 200 mensagens: 1 já gravada; +199 (99 pares + 1 user) chega a 200
    o = await commit(convs, o, { messages: [USER("p0")] }) // 2
    for (let i = 1; i < 99; i++) o = await commit(convs, o, { messages: [USER(`u${i}`), ASST(null)] }) // 2 + 98*2 = 198
    o = await commit(convs, o, { messages: [USER("u99")] }) // 199
    o = await commit(convs, o, { messages: [USER("u200")] }) // 200
    assert.equal(o.messages.length, MAX_MESSAGES, `${name}: a 200ª foi aceita`)
    const version = o.version
    for (const messages of [[USER("u201")], [USER("a"), ASST(null)]]) {
      const lim: Any = await convs.commitTurn(o, { messages } as Any); assert.deepEqual(lim, { ok: false, code: "LIMIT_MESSAGES" }, `${name}: ${JSON.stringify(lim)}`)
    }
    const back = await reopen(store, U1, o); assert.deepEqual([back.version, back.messages.length], [version, 200], `${name}: inalterada`)
    // o limite é por conversa: outra conversa do mesmo usuário continua livre
    const other = await start(store); assert.equal((await commit(other.convs, other.open, { messages: [USER()] })).messages.length, 1, name)
  })
})

// ───────────────────────────── M3: leitura ─────────────────────────────
await test("M3 — leitura: mensagens na ordem; turn = versão do delta; createdAt = o do delta; citations distintas e ORDENADAS; cópias profundas CONGELADAS (mutar não muda o store)", async () => {
  await both(async (store, name) => {
    const now = clock()
    const { convs, open: o0 } = await start(store, U1, now)
    const a = REF("a"), b = REF("b")
    let o = await commit(convs, o0, { writes: [add(qEntry("b")), add(qEntry("a"))], messages: [USER("primeira")] })
    o = await commit(convs, o, { messages: [USER("segunda"), ASST(answerOf(b, a, b))] })
    o = await commit(convs, o, { messages: [ASST(null)] })
    const deltas = await deltasOf(store, U1, o.conversationId)
    assert.deepEqual(o.messages.map((m: Any) => [m.role, m.turn]), [["user", 1], ["user", 2], ["assistant", 2], ["assistant", 3]], name)
    assert.deepEqual(o.messages.map((m: Any) => m.createdAt), [deltas[0].createdAt, deltas[1].createdAt, deltas[1].createdAt, deltas[2].createdAt], `${name}: createdAt do delta`)
    assert.notEqual(deltas[0].createdAt, deltas[1].createdAt, `${name}: instantes distintos (o teste distingue)`)
    assert.deepEqual(o.messages[2].citations, [a, b], `${name}: distintas e ordenadas (b,a,b ⇒ a,b)`)
    assert.deepEqual(o.messages[3].citations, [], name)
    const back = await reopen(store, U1, o); assert.deepEqual(back.messages, o.messages, `${name}: relido == devolvido`)
    for (const view of [o, back]) {
      assert.equal(Object.isFrozen(view.messages), true, name); assert.equal(Object.isFrozen(view.messages[2]), true, name); assert.equal(Object.isFrozen(view.messages[2].answer.segments), true, name); assert.equal(Object.isFrozen(view.messages[2].rendered.segments[0]), true, name)
      assert.throws(() => { (view.messages[0] as Any).text = "mutado" }, TypeError, name)
      assert.throws(() => { (view.messages[2].answer.claims as Any).push(1) }, TypeError, name)
    }
    assert.equal((await reopen(store, U1, o)).messages[0].text, "primeira", `${name}: o store não mudou`)
    assert.notEqual(o.messages[2], back.messages[2], `${name}: cópias, não a mesma referência`)
  })
})

// ───────────────────────────── M4: citações ─────────────────────────────
await test("M4 — citações: ref desconhecido ⇒ MESSAGE_INVALID (nada gravado, versão igual); ref escrito NO MESMO commit é aceito; ref STALE é aceito", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const unknown: Any = await convs.commitTurn(o0, { writes: [add(qEntry("a"))], messages: [ASST(answerOf(REF("a"), REF("c")), RENDERED())] })
    assert.deepEqual(unknown, { ok: false, code: "MESSAGE_INVALID" }, `${name}: ${JSON.stringify(unknown)}`)
    assert.equal((await deltasOf(store, U1, o0.conversationId)).length, 0, `${name}: nem as escritas do ledger foram gravadas`)
    const same = await commit(convs, o0, { writes: [add(qEntry("a"))], messages: [ASST(answerOf(REF("a")))] })
    assert.deepEqual(same.messages[0].citations, [REF("a")], name)
    const rot = await commit(convs, same, { rotateTo: "s2", writes: [add(qEntry("b", "s2"))] })
    assert.equal(isStale(rot.ledger, (rot.ledger.entries as Any)[REF("a")]), true, `${name}: a está STALE`)
    const stale = await commit(convs, rot, { messages: [ASST(answerOf(REF("a"), REF("b")))] })
    assert.deepEqual(stale.messages.at(-1)!.citations, [REF("a"), REF("b")], `${name}: STALE incluído`)
    const none: Any = await convs.commitTurn(stale, { messages: [ASST(answerOf(REF("d")))] }); assert.equal(none.code, "MESSAGE_INVALID", name)
  })
})

// ───────────────────────────── M5: atomicidade ─────────────────────────────
await test("M5 — atomicidade: mensagens + escritas do ledger no MESMO delta; CONFLICT (versão velha) não grava NADA de nenhum dos dois", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const tabA = o0, tabB = ((await convs.open(U1, o0.conversationId)) as Any).open as OpenConversation
    const won = await commit(convs, tabA, { writes: [add(qEntry("a"))], messages: [USER("vencedora"), ASST(answerOf(REF("a")))] })
    const deltas = await deltasOf(store, U1, o0.conversationId)
    assert.equal(deltas.length, 1, name); assert.equal(deltas[0].writes.length, 1, name); assert.equal(deltas[0].messages.length, 2, `${name}: um delta só`)
    const lost: Any = await convs.commitTurn(tabB, { writes: [add(qEntry("b"))], messages: [USER("perdedora")] })
    assert.deepEqual(lost, { ok: false, code: "CONFLICT" }, name)
    const back = await reopen(store, U1, won)
    assert.deepEqual([back.version, back.messages.map((m: Any) => m.role === "user" ? m.text : "assistant"), Object.keys(back.ledger.entries)], [1, ["vencedora", "assistant"], [REF("a")]], `${name}: nada do perdedor`)
    assert.equal(JSON.stringify(await deltasOf(store, U1, o0.conversationId)).includes("perdedora"), false, name)
  })
})

// ───────────────────────────── M6: persistência e corrupção ─────────────────────────────
await test("M6 — instâncias NOVAS devolvem as mesmas mensagens; em disco, um delta com mensagem corrompida vira CorruptDelta e a conversa CORRUPT — só ela", async () => {
  await both(async (store, name, root) => {
    const { convs, open: o0 } = await start(store)
    const o = await commit(convs, o0, { writes: [add(qEntry("a"))], messages: [USER("persiste"), ASST(answerOf(REF("a")))] })
    const fresh = root === undefined ? store : createDiskConversationStore(root)
    const back = await reopen(fresh, U1, o); assert.deepEqual(back.messages, o.messages, name)
    const other = await start(store, U1); await commit(other.convs, other.open, { messages: [USER("outra")] })
    if (root === undefined) return
    const file = walk(root).find((p) => p.includes(o0.conversationId) && p.endsWith("v000001.json"))!
    const doc = JSON.parse(readFileSync(file, "utf8"))
    assert.equal(Array.isArray(doc.messages), true, `${name}: o disco GRAVA as mensagens`)
    for (const bad of [[{ role: "user" }], [...doc.messages, doc.messages[0]], [{ ...doc.messages[1], citations: [REF("z")] }], "x"]) {
      writeFileSync(file, JSON.stringify({ ...doc, messages: bad }))
      const loaded: Any = await createDiskConversationStore(root).load(U1, o0.conversationId)
      assert.equal(loaded.deltas[0].corrupt, true, `${name}: CorruptDelta`)
      assert.equal(codeOf(await createConversations({ store: createDiskConversationStore(root) }).open(U1, o0.conversationId) as Any), "CORRUPT", name)
      assert.equal(codeOf(await createConversations({ store: createDiskConversationStore(root) }).open(U1, other.open.conversationId) as Any), "OK", `${name}: a outra conversa segue`)
    }
  })
})

// ───────────────────────────── M7: LGPD ─────────────────────────────
await test("M7 — LGPD: deleteConversation e purgeUserData removem as mensagens; nenhum byte do texto marcador sobra em arquivo algum; o outro usuário fica byte a byte idêntico", async () => {
  await both(async (store, name, root) => {
    const MARK = "MARCADOR-LGPD-9f3a77"
    const mk = async (user: string, text: string): Promise<OpenConversation> => { const s = await start(store, user); return commit(s.convs, s.open, { messages: [USER(text)] }) }
    const a1 = await mk(U1, `${MARK}-a1`), a2 = await mk(U1, `${MARK}-a2`), b1 = await mk(U2, "do outro usuário")
    const snap = (): string => (root === undefined ? "" : walk(root).filter((p) => p.includes(`/${U2}/`)).sort().map((p) => `${p}=${readFileSync(p, "utf8")}`).join("\n"))
    const deps: Any = { rawStorage: createMemoryRawFileStorage(), importStore: createMemoryImportSourceStore(), conversationStore: store, saltStore: createMemorySaltStore() }
    const bBefore = snap()
    const one: Any = await deleteConversation(deps, { userId: U1, conversationId: a1.conversationId }); assert.deepEqual([one.ok, one.existed], [true, true], name)
    assert.equal(codeOf(await createConversations({ store }).open(U1, a1.conversationId) as Any), "NOT_FOUND", name)
    if (root !== undefined) assert.equal(walk(root).some((p) => readFileSync(p, "utf8").includes(`${MARK}-a1`)), false, `${name}: a1 não sobra`)
    assert.equal((await reopen(store, U1, a2)).messages[0].text, `${MARK}-a2`, `${name}: a2 segue`)
    const all: Any = await purgeUserData(deps, { userId: U1 }); assert.equal(all.ok, true, `${name}: ${JSON.stringify(all)}`)
    assert.equal(codeOf(await createConversations({ store }).open(U1, a2.conversationId) as Any), "NOT_FOUND", name)
    if (root !== undefined) { assert.equal(walk(root).some((p) => readFileSync(p, "utf8").includes(MARK)), false, `${name}: nenhum byte do marcador`); assert.equal(snap(), bBefore, `${name}: o outro usuário idêntico`) }
    assert.equal((await reopen(store, U2, b1)).messages[0].text, "do outro usuário", name)
  })
})

// ───────────────────────────── M8: isolamento e sem eco ─────────────────────────────
await test("M8 — isolamento: outro usuário não abre a conversa nem vê mensagens; os erros não ecoam o texto da mensagem", async () => {
  await both(async (store, name) => {
    const SECRET = "SEGREDO-NAO-ECOAR-5521"
    const { convs, open: o0 } = await start(store)
    const o = await commit(convs, o0, { messages: [USER(SECRET)] })
    const other: Any = await createConversations({ store }).open(U2, o.conversationId); assert.deepEqual(other, { ok: false, code: "NOT_FOUND" }, name)
    assert.equal(JSON.stringify(other).includes(SECRET), false, name)
    const bads: Any[] = [await convs.commitTurn(o, { messages: [{ role: "user", text: SECRET, extra: 1 }] } as Any), await convs.commitTurn(o, { messages: [USER(SECRET), USER(SECRET)] } as Any), await convs.commitTurn(o, { messages: [ASST(answerOf(REF("9")), RENDERED(SECRET))] } as Any),
      await store.commit(U1, o.conversationId, o.version, EMPTY_DELTA([{ role: "user", text: SECRET, extra: 1 }]), ISO(7)), await store.commit(U2, o.conversationId, o.version, EMPTY_DELTA([recOf(o.messages[0])]), ISO(7))]
    for (const r of bads) { assert.equal(r.ok, false, name); assert.deepEqual(Object.keys(r).sort(), ["code", "ok"], name); assert.equal(JSON.stringify(r).includes(SECRET), false, `${name}: ${JSON.stringify(r)}`) }
    assert.equal((await reopen(store, U1, o)).version, 1, `${name}: nada entrou`)
  })
})

for (const r of TMPS) rmSync(r, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes das mensagens da conversa passaram.`)
