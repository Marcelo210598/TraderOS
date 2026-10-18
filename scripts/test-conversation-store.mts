// E7-3: estado da conversa persistente (infra/conversation-store.ts): log de deltas atômicos + concorrência otimista + remontagem do ledger pelas funções PURAS (replay por época).
// Expectativa escrita ANTES do código: scripts/expectations/agent-answer.expected.json → e7_3 (D-V1…D-V9, R1–R5, I1–I6, V1–V4, U1, F1–F2, S1–S2, M1, VM1–VM14).
//   node scripts/test-conversation-store.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addEvidence, isStale, newLedger, refreshEvidence, rotateEpoch, type Ledger } from "../src/lib/agent/ledger.ts"
import { buildVerdict } from "../src/lib/agent/verdict.ts"
import { MAX_DELTA_BYTES, MAX_LEDGER_ENTRIES, MAX_ROW_BYTES, createConversations, createDiskConversationStore, createMemoryConversationStore, conversationStoreFailure, type ConversationStore, type Conversations, type OpenConversation, type TurnChange } from "../src/lib/infra/conversation-store.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const U1 = "cmd3h2k0a0000abcd1234efgh", U2 = "cmd3h2k0a0000zzzz9999yyyy"
const REALREF = /(?:^|[^a-z])(?:acc|str|lbl|pat)_[0-9a-f]{24}/
const FIXED = (): string => "2026-10-18T12:00:00.000Z"

// ── fixtures: entradas VÁLIDAS do ledger (mesmas dos testes do ledger) ──
const REF = (n: number | string): string => (typeof n === "number" ? `ev_${n.toString(16).padStart(32, "0")}` : `ev_${n.repeat(32)}`)
const metric = (id = "netPnl"): Any => ({ metricId: id, value: 10, unit: "usd", basis: "NET", sampleSize: 3, coverage: { used: 3, total: 3, ratio: 1 }, reason: null })
const qView = (): Any => ({ metrics: [metric()], period: { from: null, to: null } })
const gView = (groups: number): Any => ({ groupBy: ["conta"], groups: Array.from({ length: groups }, (_, i) => ({ key: [`G${i}`], sampleFlag: "OK", sampleSize: 3, metrics: Array.from({ length: 10 }, (_, j) => metric(`m${j}`)) })) })
const handle = (ref: string, epoch = "s1"): Any => ({
  evidenceRef: ref, evidenceHash: "a".repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: 3, verifiability: "FULL" }, refEpoch: epoch, freshness: "CURRENT",
  verdict: buildVerdict({ status: "VALID", codes: [] }, { status: "SOURCE_VERIFIED", codes: [] }),
})
const qEntry = (ref: string | number, epoch = "s1"): Any => { const r = typeof ref === "number" ? REF(ref) : REF(ref); return { capability: "metrics.query@1", handle: handle(r, epoch), view: qView() } }
const gEntry = (ref: string | number, groups: number, epoch = "s1"): Any => ({ capability: "metrics.groups@1", handle: handle(REF(ref), epoch), view: gView(groups) })
const refOf = (e: Any): string => e.handle.evidenceRef
const ACC = (n: number): string => `acc_${n.toString(16).padStart(24, "0")}`
const STR = (n: number): string => `str_${n.toString(16).padStart(24, "0")}`
const table = (epoch: string, conta: string[] = [], estrategia: string[] = [], rotulo: string[] = []): Any => ({ epoch, conta, estrategia, rotulo })
const SPEC = (): Any => ({ groupBy: ["conta"], metricIds: ["netPnl"], filters: { account: ["Conta A"] }, options: {} })
const add = (e: Any): Any => ({ op: "add", entry: e })
const refresh = (e: Any): Any => ({ op: "refresh", entry: e })
const spec = (e: Any, args: unknown = SPEC()): Any => ({ evidenceRef: refOf(e), capability: e.capability, args })

// ── armazenamentos ──
const TMPS: string[] = []
interface Impl { name: string; make: () => { store: ConversationStore; root?: string } }
const IMPLS: Impl[] = [
  { name: "memória", make: () => ({ store: createMemoryConversationStore() }) },
  { name: "disco", make: () => { const root = mkdtempSync(join(tmpdir(), "conv-store-")); TMPS.push(root); return { store: createDiskConversationStore(root), root } } },
]
const both = async (fn: (store: ConversationStore, name: string, root?: string) => Promise<void>): Promise<void> => { for (const impl of IMPLS) { const m = impl.make(); await fn(m.store, impl.name, m.root) } }
const facade = (store: ConversationStore): Conversations => createConversations({ store, now: FIXED })
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const codeOf = (r: Any): string => (r.ok ? "OK" : r.code)
async function start(store: ConversationStore, user = U1, epoch = "s1", id?: string): Promise<{ convs: Conversations; open: OpenConversation }> {
  const convs = facade(store)
  const r: Any = await convs.create(user, epoch, id)
  assert.equal(r.ok, true, `create: ${codeOf(r)}`)
  return { convs, open: r.open }
}
async function commit(convs: Conversations, open: OpenConversation, change: TurnChange): Promise<OpenConversation> {
  const r: Any = await convs.commitTurn(open, change)
  assert.equal(r.ok, true, `commitTurn: ${codeOf(r)}`)
  return r.open
}
async function reopen(store: ConversationStore, user: string, open: OpenConversation): Promise<OpenConversation> {
  const r: Any = await facade(store).open(user, open.conversationId)
  assert.equal(r.ok, true, `open: ${codeOf(r)}`)
  return r.open
}
/** Abre OUTRA aba pela MESMA fachada (o estado só pode ser commitado pela fachada que o produziu). */
async function tab(convs: Conversations, open: OpenConversation): Promise<OpenConversation> {
  const r: Any = await convs.open(U1, open.conversationId)
  assert.equal(r.ok, true, `tab: ${codeOf(r)}`)
  return r.open
}
/** Aplica na "verdade" (funções puras do ledger, SEM passar por armazenamento). */
function truthOf(epoch: string): { l: Ledger; add(e: Any): void; rotate(e: string): void; refresh(e: Any): void } {
  const r0: Any = newLedger(epoch)
  const t = { l: r0.ledger as Ledger, add(e: Any): void { const r: Any = addEvidence(t.l, e); assert.equal(r.ok, true); t.l = r.ledger }, rotate(e: string): void { const r: Any = rotateEpoch(t.l, e); assert.equal(r.ok, true); t.l = r.ledger }, refresh(e: Any): void { const r: Any = refreshEvidence(t.l, e); assert.equal(r.ok, true); t.l = r.ledger } }
  return t
}

// ───────────────────────────── R: ida e volta ─────────────────────────────
await test("R1 — ledger com várias capacidades + specs + alias volta IDÊNTICO ao calculado pelas funções puras (memória e disco, facade nova)", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a"), b = qEntry("b"), c = gEntry("c", 10), d = qEntry("d")
    let o = await commit(convs, o0, { writes: [add(a), add(b), add(c)], specs: [spec(a), spec(b, { other: 1 }), spec(c, { groupBy: ["estrategia"] })], aliases: table("s1", [ACC(1)]) })
    o = await commit(convs, o, { writes: [add(d)], specs: [spec(d)], aliases: table("s1", [ACC(1), ACC(2)], [STR(1)]) })
    const truth = truthOf("s1"); for (const e of [a, b, c, d]) truth.add(e)
    const back = await reopen(store, U1, o)
    assert.deepStrictEqual(back.ledger, truth.l, name)
    assert.deepStrictEqual(o.ledger, truth.l, `${name}: o estado devolvido pelo commit também`)
    assert.deepStrictEqual(back.aliases, table("s1", [ACC(1), ACC(2)], [STR(1)]), name)
    assert.equal(back.version, 2, name)
    assert.deepEqual(back.specOf(refOf(b)), { capability: "metrics.query@1", args: { other: 1 } }, name)
    assert.deepEqual(back.specOf(refOf(c)), { capability: "metrics.groups@1", args: { groupBy: ["estrategia"] } }, name)
    assert.equal(back.conversationId, o0.conversationId)
  })
})

await test("R2 — época rotacionada: entradas antigas voltam STALE (isStale) e a nova CURRENT; o alias da época nova começa VAZIO", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a"), n = qEntry("9", "s2")
    let o = await commit(convs, o0, { writes: [add(a)], aliases: table("s1", [ACC(1)]) })
    o = await commit(convs, o, { rotateTo: "s2", writes: [add(n)] })
    const truth = truthOf("s1"); truth.add(a); truth.rotate("s2"); truth.add(n)
    const back = await reopen(store, U1, o)
    assert.deepStrictEqual(back.ledger, truth.l, name)
    assert.equal(back.epoch, "s2", name)
    assert.equal(isStale(back.ledger, back.ledger.entries[refOf(a)]), true, name)
    assert.equal(isStale(back.ledger, back.ledger.entries[refOf(n)]), false, name)
    assert.deepStrictEqual(back.aliases, table("s2"), `${name}: alias da época nova vazio`)
  })
})

await test("R3 — refresh sobrescreve a linha NO LUGAR (STALE → CURRENT no mesmo ref) e volta idêntico; a contagem não cresce", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const x = qEntry("a"), y = qEntry("b"), x2 = qEntry("a", "s2")
    let o = await commit(convs, o0, { writes: [add(x), add(y)], specs: [spec(x)] })
    o = await commit(convs, o, { rotateTo: "s2" })
    o = await commit(convs, o, { writes: [refresh(x2)] })
    const truth = truthOf("s1"); truth.add(x); truth.add(y); truth.rotate("s2"); truth.refresh(x2)
    const back = await reopen(store, U1, o)
    assert.deepStrictEqual(back.ledger, truth.l, name)
    assert.equal(Object.keys(back.ledger.entries).length, 2, name)
    assert.equal(back.ledger.entries[refOf(x)].handle.refEpoch, "s2", name)
    assert.equal(isStale(back.ledger, back.ledger.entries[refOf(x)]), false, name)
    assert.equal(isStale(back.ledger, back.ledger.entries[refOf(y)]), true, name)
    assert.deepEqual(back.specOf(refOf(x)), { capability: "metrics.query@1", args: SPEC() }, `${name}: a spec sobrevive ao refresh`)
  })
})

await test("R4 — ORDEM do replay (índice da época, seq): refresh de uma linha antiga, épocas vazias no meio e linhas novas voltam idênticos à verdade", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const A = qEntry("a"), B = qEntry("b"), A2 = qEntry("a", "s2"), C = qEntry("c", "s2"), D = qEntry("d", "s4")
    let o = await commit(convs, o0, { writes: [add(A), add(B)] })
    o = await commit(convs, o, { rotateTo: "s2", writes: [refresh(A2), add(C)] }) // refresh e rotação no MESMO delta
    o = await commit(convs, o, { rotateTo: "s3" })
    o = await commit(convs, o, { rotateTo: "s4", writes: [add(D)] })
    const truth = truthOf("s1"); truth.add(A); truth.add(B); truth.rotate("s2"); truth.refresh(A2); truth.add(C); truth.rotate("s3"); truth.rotate("s4"); truth.add(D)
    const back = await reopen(store, U1, o)
    assert.deepStrictEqual(back.ledger, truth.l, name)
    assert.equal(back.epoch, "s4", name)
    assert.deepEqual(Object.keys(back.ledger.entries).sort(), [A, B, C, D].map(refOf).sort(), name)
    assert.deepEqual([A, B, C, D].map((e) => isStale(back.ledger, back.ledger.entries[refOf(e)])), [true, true, true, false], name)
  })
})

await test("R5 — specOf: devolve a spec do PRÓPRIO ref (cópia, não alias), null para desconhecido/malformado/protótipo; mexer no retorno não altera a próxima chamada", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a"), b = qEntry("b"), c = qEntry("c")
    const o = await commit(convs, o0, { writes: [add(a), add(b), add(c)], specs: [spec(a, { k: "A" }), spec(b, { k: "B" })] })
    const back = await reopen(store, U1, o)
    assert.deepEqual(back.specOf(refOf(a)), { capability: "metrics.query@1", args: { k: "A" } }, name)
    assert.deepEqual(back.specOf(refOf(b)), { capability: "metrics.query@1", args: { k: "B" } }, name)
    assert.equal(back.specOf(refOf(c)), null, `${name}: entrada sem spec`)
    for (const bad of [REF("f"), "", "ev_zz", "__proto__", "constructor", "toString", null as Any, undefined as Any, 5 as Any]) assert.equal(back.specOf(bad), null, `${name}: ${String(bad)}`)
    const s: Any = back.specOf(refOf(a)); s.args.k = "HACK"; s.capability = "x"
    assert.deepEqual(back.specOf(refOf(a)), { capability: "metrics.query@1", args: { k: "A" } }, name)
  })
})

// ───────────────────────────── I: invariantes ─────────────────────────────
await test("I1 — alias só CRESCE pelo fim na mesma época: reordenar, encolher, trocar ou formato inválido (nome de conta!) ⇒ recusado e NADA é gravado", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    let o = await commit(convs, o0, { writes: [add(qEntry("a"))], aliases: table("s1", [ACC(1), ACC(2)]) })
    const tries: Array<[string, Any, string]> = [
      ["reordenado", table("s1", [ACC(2), ACC(1)]), "ALIAS_NOT_EXTENDING"], ["encolhido", table("s1", [ACC(1)]), "ALIAS_NOT_EXTENDING"], ["trocado", table("s1", [ACC(1), ACC(3)]), "ALIAS_NOT_EXTENDING"],
      ["esvaziado", table("s1"), "ALIAS_NOT_EXTENDING"], ["estratégia some", { ...table("s1", [ACC(1), ACC(2)]), estrategia: [] }, "OK"],
      ["nome de conta no lugar do ref", table("s1", [ACC(1), ACC(2), "Conta Demo A"]), "ALIAS_INVALID"], ["ref duplicado", table("s1", [ACC(1), ACC(2), ACC(2)]), "ALIAS_INVALID"], ["ref de tipo errado", table("s1", [ACC(1), ACC(2), STR(9)]), "ALIAS_INVALID"], ["campo extra", { ...table("s1", [ACC(1), ACC(2)]), x: 1 }, "ALIAS_INVALID"],
    ]
    for (const [why, t, expect] of tries) {
      if (expect === "OK") continue
      const r = await convs.commitTurn(o, { writes: [add(qEntry(why.length + 100))], aliases: t })
      assert.equal(codeOf(r), expect, `${name}: ${why}`)
    }
    const back = await reopen(store, U1, o)
    assert.equal(back.version, 1, `${name}: nada foi gravado`)
    assert.deepStrictEqual(back.aliases, table("s1", [ACC(1), ACC(2)]), name)
    assert.equal(Object.keys(back.ledger.entries).length, 1, name)
    o = await commit(convs, o, { aliases: table("s1", [ACC(1), ACC(2), ACC(3)], [STR(1)]) }) // estender é ok (e commit só de alias é válido)
    assert.deepStrictEqual((await reopen(store, U1, o)).aliases, table("s1", [ACC(1), ACC(2), ACC(3)], [STR(1)]), name)
  })
})

await test("I2 — alias e época: tabela de OUTRA época ⇒ ALIAS_EPOCH_MISMATCH; após rotação a tabela antiga NUNCA é reaproveitada; a nova pode ser qualquer, e dali só cresce", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    let o = await commit(convs, o0, { writes: [add(qEntry("a"))], aliases: table("s1", [ACC(1), ACC(2)]) })
    assert.equal(codeOf(await convs.commitTurn(o, { rotateTo: "s2", aliases: table("s1", [ACC(1), ACC(2)]) })), "ALIAS_EPOCH_MISMATCH", `${name}: tabela velha na época nova`)
    assert.equal(codeOf(await convs.commitTurn(o, { aliases: table("s2", [ACC(1)]) })), "ALIAS_EPOCH_MISMATCH", `${name}: tabela de época que não é a vigente`)
    o = await commit(convs, o, { rotateTo: "s2" })
    assert.deepStrictEqual(o.aliases, table("s2"), `${name}: vazia, nova`)
    o = await commit(convs, o, { aliases: table("s2", [ACC(9)]) }) // refs da época nova podem ser outros (outro sal)
    assert.deepStrictEqual((await reopen(store, U1, o)).aliases, table("s2", [ACC(9)]), name)
    assert.equal(codeOf(await convs.commitTurn(o, { aliases: table("s2", [ACC(1)]) })), "ALIAS_NOT_EXTENDING", `${name}: dentro da época nova só cresce`)
  })
})

await test("I3 — spec nunca carrega ref real: acc_/str_/lbl_/pat_ em valor, chave ou aninhado ⇒ SPEC_HAS_REAL_REF; alias de texto (\"Conta A\") passa; args não-JSON ⇒ SPEC_INVALID", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a")
    const o = await commit(convs, o0, { writes: [add(a)] })
    const real = [`acc_${"a".repeat(24)}`, `str_${"0".repeat(24)}`, `lbl_${"f".repeat(24)}`, `pat_${"1".repeat(24)}`]
    for (const ref of real) {
      for (const args of [{ filters: { account: [ref] } }, { [ref]: 1 }, { deep: { deeper: [{ x: `Conta ${ref}` }] } }, { s: `x:${ref}` }]) assert.equal(codeOf(await convs.commitTurn(o, { specs: [spec(a, args)] })), "SPEC_HAS_REAL_REF", `${name}: ${ref}`)
    }
    for (const args of [{ f: () => 1 }, { n: NaN }, { n: Infinity }, { d: new Date() }, Symbol("x") as Any, 10n as Any]) assert.equal(codeOf(await convs.commitTurn(o, { specs: [spec(a, args)] })), "SPEC_INVALID", `${name}: ${String(Object.keys(args ?? {}))}`)
    const ok = await commit(convs, o, { specs: [spec(a, { filters: { account: ["Conta A", "Conta B"], strategy: ["Estratégia A"] } })] })
    assert.deepEqual(ok.specOf(refOf(a))!.args, { filters: { account: ["Conta A", "Conta B"], strategy: ["Estratégia A"] } }, name)
    assert.equal((await reopen(store, U1, ok)).version, 2, name)
  })
})

await test("I4 — spec: ref fora do ledger ⇒ SPEC_REF_UNKNOWN; capacidade diferente da entrada ⇒ SPEC_INVALID; mesma spec repetida ok; spec DIFERENTE p/ o mesmo ref ⇒ SPEC_CONFLICT; commit vazio/forjado/campo extra ⇒ INVALID_ARGS", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a")
    let o = await commit(convs, o0, { writes: [add(a)], specs: [spec(a)] })
    assert.equal(codeOf(await convs.commitTurn(o, { specs: [{ evidenceRef: REF("e"), capability: "metrics.query@1", args: {} }] })), "SPEC_REF_UNKNOWN", name)
    assert.equal(codeOf(await convs.commitTurn(o, { specs: [{ evidenceRef: refOf(a), capability: "metrics.groups@1", args: {} }] })), "SPEC_INVALID", name)
    for (const bad of [{ evidenceRef: "xx", capability: "metrics.query@1", args: {} }, { evidenceRef: refOf(a), capability: "nao.existe@1", args: {} }, { evidenceRef: refOf(a), capability: "metrics.query@1", args: {}, extra: 1 }, null, 5]) assert.equal(codeOf(await convs.commitTurn(o, { specs: [bad as Any] })), "SPEC_INVALID", name)
    assert.equal(codeOf(await convs.commitTurn(o, { specs: [spec(a, { outra: "coisa" })] })), "SPEC_CONFLICT", name)
    o = await commit(convs, o, { specs: [spec(a)] }) // idêntica: ok
    assert.equal(o.version, 2, name)
    assert.equal(codeOf(await convs.commitTurn(o, {})), "INVALID_ARGS", `${name}: commit vazio`)
    assert.equal(codeOf(await convs.commitTurn(o, { surpresa: 1 } as Any)), "INVALID_ARGS", name)
    assert.equal(codeOf(await convs.commitTurn({ ...o } as Any, { specs: [spec(a)] })), "INVALID_ARGS", `${name}: estado forjado (não veio da fachada)`)
    assert.equal(codeOf(await convs.commitTurn(null as Any, { specs: [spec(a)] })), "INVALID_ARGS", name)
    assert.equal(codeOf(await convs.commitTurn(o, { writes: "x" as Any })), "INVALID_ARGS", name)
    assert.equal(codeOf(await convs.commitTurn(o, { writes: [{ op: "upsert", entry: a } as Any] })), "INVALID_ARGS", name)
  })
})

await test("I5 — entrada que o ledger recusa NÃO é gravada: outra época, handle STALE, view inválida, capacidade desconhecida; nada fica gravado (versão e ledger intactos)", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const o = await commit(convs, o0, { writes: [add(qEntry("a"))] })
    const stale = { ...qEntry("b"), handle: { ...handle(REF("b")), freshness: "STALE" } }
    const badView = { ...qEntry("c"), view: { buckets: [] } }
    const tries: Array<[string, Any]> = [["outra época", qEntry("b", "s2")], ["STALE", stale], ["view inválida", badView], ["capacidade desconhecida", { ...qEntry("d"), capability: "x@1" }], ["lixo", 5], ["refresh de ref CURRENT diferente", null]]
    for (const [why, e] of tries.slice(0, 5)) assert.equal(codeOf(await convs.commitTurn(o, { writes: [add(e)] })), "LEDGER_ENTRY_INVALID", `${name}: ${why}`)
    assert.equal(codeOf(await convs.commitTurn(o, { rotateTo: "S2 inválida" })), "LEDGER_EPOCH_INVALID", name)
    assert.equal(codeOf(await convs.commitTurn(o, { rotateTo: "s1" })), "LEDGER_EPOCH_INVALID", `${name}: época igual à atual`)
    // um commit com UMA escrita ruim no meio não grava as boas (atômico)
    assert.equal(codeOf(await convs.commitTurn(o, { writes: [add(qEntry("e")), add(stale)] })), "LEDGER_ENTRY_INVALID", name)
    const back = await reopen(store, U1, o)
    assert.equal(back.version, 1, name)
    assert.deepEqual(Object.keys(back.ledger.entries), [REF("a")], name)
  })
})

await test("I6 — mesmo ref com conteúdo DIFERENTE ⇒ LEDGER_CONFLICT; idêntico ⇒ idempotente (ok); refresh de ref CURRENT diferente ⇒ LEDGER_CONFLICT; e a conversa continua legível depois", async () => {
  await both(async (store, name) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a")
    let o = await commit(convs, o0, { writes: [add(a)] })
    const other = { ...a, view: { ...qView(), period: { from: "2026-01-01", to: null } } }
    assert.equal(codeOf(await convs.commitTurn(o, { writes: [add(other)] })), "LEDGER_CONFLICT", name)
    assert.equal(codeOf(await convs.commitTurn(o, { writes: [refresh(other)] })), "LEDGER_CONFLICT", name)
    o = await commit(convs, o, { writes: [add(a)] }) // idêntico: aceito
    assert.equal(o.version, 2, name)
    assert.equal(Object.keys((await reopen(store, U1, o)).ledger.entries).length, 1, name)
  })
})

// ───────────────────────────── V: concorrência otimista ─────────────────────────────
await test("V1 — duas abas com a MESMA versão: uma vence, a outra leva CONFLICT (nunca as duas)", async () => {
  await both(async (store, name) => {
    const { convs, open } = await start(store)
    const tab1 = await tab(convs, open), tab2 = await tab(convs, open)
    const r1: Any = await convs.commitTurn(tab1, { writes: [add(qEntry("a"))] })
    const r2: Any = await convs.commitTurn(tab2, { writes: [add(qEntry("b"))] })
    assert.deepEqual([r1.ok, r1.version], [true, 1], name)
    assert.deepEqual([r2.ok, r2.code], [false, "CONFLICT"], name)
    assert.deepEqual(Object.keys((await reopen(store, U1, open)).ledger.entries), [REF("a")], name)
  })
})

await test("V2 — o PERDEDOR não deixa efeito algum: nem linha, nem spec, nem alias, nem rotação de época, nem versão", async () => {
  await both(async (store, name, root) => {
    const { convs, open } = await start(store)
    const winner = await tab(convs, open), loser = await tab(convs, open)
    await commit(convs, winner, { writes: [add(qEntry("a"))], specs: [spec(qEntry("a"))], aliases: table("s1", [ACC(1)]) })
    const b = qEntry("b", "s2")
    assert.equal(codeOf(await convs.commitTurn(loser, { rotateTo: "s2", writes: [add(b)], specs: [spec(b, { x: 1 })], aliases: table("s2", [ACC(7)]) })), "CONFLICT", name)
    const back = await reopen(store, U1, open)
    assert.equal(back.version, 1, name)
    assert.equal(back.epoch, "s1", name)
    assert.deepEqual(Object.keys(back.ledger.entries), [REF("a")], name)
    assert.equal(back.specOf(refOf(b)), null, name)
    assert.deepStrictEqual(back.aliases, table("s1", [ACC(1)]), name)
    if (root !== undefined) assert.deepEqual(readdirSync(join(root, "conversations", U1, open.conversationId)).sort(), ["meta.json", "v000001.json"], `${name}: nenhum arquivo extra`)
  })
})

await test("V3 — 8 commits simultâneos (8 abas, mesma versão) ⇒ EXATAMENTE 1 vencedor e 7 CONFLICT; o log tem uma só versão", async () => {
  await both(async (store, name, root) => {
    const { convs, open } = await start(store)
    const tabs = await Promise.all(Array.from({ length: 8 }, () => tab(convs, open)))
    const results: Any[] = await Promise.all(tabs.map((t, i) => convs.commitTurn(t, { writes: [add(qEntry(i + 1))], specs: [spec(qEntry(i + 1))] })))
    assert.equal(results.filter((r) => r.ok).length, 1, name)
    assert.deepEqual([...new Set(results.filter((r) => !r.ok).map((r) => r.code))], ["CONFLICT"], name)
    const back = await reopen(store, U1, open)
    assert.equal(back.version, 1, name)
    assert.equal(Object.keys(back.ledger.entries).length, 1, name)
    if (root !== undefined) assert.deepEqual(readdirSync(join(root, "conversations", U1, open.conversationId)).sort(), ["meta.json", "v000001.json"], name)
  })
})

await test("V4 — depois do CONFLICT, reabrir e recomitar funciona (a versão avança 1 por vez, sem buracos); versão 'do futuro' é recusada pelo store", async () => {
  await both(async (store, name) => {
    const { convs, open } = await start(store)
    const t1 = await tab(convs, open), t2 = await tab(convs, open)
    await commit(convs, t1, { writes: [add(qEntry("a"))] })
    assert.equal(codeOf(await convs.commitTurn(t2, { writes: [add(qEntry("b"))] })), "CONFLICT", name)
    const fresh = await tab(convs, open)
    const o2 = await commit(convs, fresh, { writes: [add(qEntry("b"))] })
    assert.equal(o2.version, 2, name)
    const body = { rotateTo: null, writes: [], specs: [], alias: null }
    assert.deepEqual(await store.commit(U1, open.conversationId, 5, body, FIXED()), conversationStoreFailure("CONFLICT"), `${name}: versão futura`)
    assert.deepEqual(await store.commit(U1, open.conversationId, 0, body, FIXED()), conversationStoreFailure("CONFLICT"), `${name}: versão passada`)
    assert.equal((await reopen(store, U1, open)).version, 2, name)
  })
})

// ───────────────────────────── U: isolamento ─────────────────────────────
await test("U1 — usuários não se enxergam: conversationId de outro ⇒ NOT_FOUND (igual a inexistente); o MESMO id em dois usuários são conversas independentes", async () => {
  await both(async (store, name) => {
    const { convs, open } = await start(store, U1, "s1", "conv-compartilhada")
    await commit(convs, open, { writes: [add(qEntry("a"))] })
    const other: Any = await facade(store).open(U2, "conv-compartilhada")
    const ghost: Any = await facade(store).open(U2, "conv-que-nao-existe")
    assert.deepEqual([other.ok, other.code], [false, "NOT_FOUND"], name)
    assert.deepEqual(other, ghost, `${name}: indistinguível de inexistente`)
    assert.deepEqual(await store.load(U2, "conv-compartilhada"), conversationStoreFailure("NOT_FOUND"), name)
    assert.deepEqual(await store.commit(U2, "conv-compartilhada", 1, { rotateTo: null, writes: [], specs: [], alias: null }, FIXED()), conversationStoreFailure("NOT_FOUND"), name)
    const mine = await start(store, U2, "s1", "conv-compartilhada") // mesmo id, outro usuário: cria normalmente
    await commit(mine.convs, mine.open, { writes: [add(qEntry("8"))] })
    assert.deepEqual(Object.keys((await reopen(store, U1, open)).ledger.entries), [REF("a")], name)
    assert.deepEqual(Object.keys((await reopen(store, U2, mine.open)).ledger.entries), [REF("8")], name)
    assert.equal(codeOf(await facade(store).create(U1, "s1", "conv-compartilhada")), "DUPLICATE", name)
    for (const bad of ["", "../x", "a/b", "a b", "x".repeat(65)]) assert.equal(codeOf(await facade(store).open(U1, bad)), "INVALID_ARGS", `${name}: ${bad}`)
  })
})

// ───────────────────────────── F: falhas ─────────────────────────────
await test("F1 — falha de infra no meio do commit NUNCA deixa estado parcial: versão não avança, nenhum arquivo/temporário sobra, e o commit seguinte funciona", async () => {
  await both(async (store, name, root) => {
    const { convs, open } = await start(store)
    const o1 = await commit(convs, open, { writes: [add(qEntry("a"))] })
    const boom = (): never => { throw Object.assign(new Error("EIO"), { code: "EIO" }) }
    let flaky: ConversationStore
    if (root !== undefined) {
      flaky = createDiskConversationStore(root, { link: async () => boom() })
      const half = createDiskConversationStore(root, { writeFile: async (p: Any, d: Any) => { writeFileSync(p as string, String(d).slice(0, 10)); return boom() } })
      const fh = facade(half)
      const o = await fh.open(U1, open.conversationId) as Any
      assert.equal(codeOf(await fh.commitTurn(o.open, { writes: [add(qEntry("b"))] })), "STORAGE_ERROR", `${name}: escrita parcial`)
      assert.deepEqual(readdirSync(join(root, "conversations", U1, open.conversationId)).sort(), ["meta.json", "v000001.json"], `${name}: sem temporário`)
    } else {
      flaky = { ...store, async commit() { return conversationStoreFailure("STORAGE_ERROR") } }
    }
    const f = facade(flaky)
    const fo = await f.open(U1, open.conversationId) as Any
    assert.equal(codeOf(await f.commitTurn(fo.open, { writes: [add(qEntry("b"))], specs: [spec(qEntry("b"))], aliases: table("s1", [ACC(1)]) })), "STORAGE_ERROR", name)
    if (root !== undefined) assert.deepEqual(readdirSync(join(root, "conversations", U1, open.conversationId)).sort(), ["meta.json", "v000001.json"], `${name}: sem temporário após falha no link`)
    const back = await reopen(store, U1, open)
    assert.equal(back.version, 1, name)
    assert.deepEqual(Object.keys(back.ledger.entries), [REF("a")], name)
    assert.deepStrictEqual(back.aliases, table("s1"), name)
    const o2 = await commit(convs, o1, { writes: [add(qEntry("b"))] }) // a mesma aba ainda tem a versão certa
    assert.equal(o2.version, 2, name)
  })
})

await test("F2 — delta corrompido isola SÓ aquela conversa (CORRUPT, sem lançar); lacuna no log, ledger/alias inconsistentes e época desconhecida também; as outras seguem abertas", async () => {
  await both(async (store, name, root) => {
    const good = await start(store, U1, "s1", "boa")
    const gOpen = await commit(good.convs, good.open, { writes: [add(qEntry("a"))] })
    const tamper = (f: (deltas: Any[]) => Any[]): ConversationStore => ({ ...store, async load(u, c) { const r: Any = await store.load(u, c); return r.ok && c === "ruim" ? { ...r, deltas: f(JSON.parse(JSON.stringify(r.deltas))) } : r } })
    const bad = await start(store, U1, "s1", "ruim")
    let b = await commit(bad.convs, bad.open, { writes: [add(qEntry("b"))], aliases: table("s1", [ACC(1), ACC(2)]) })
    b = await commit(bad.convs, b, { rotateTo: "s2", writes: [add(qEntry("c", "s2"))] })
    assert.equal(b.version, 2)
    const cases: Array<[string, (d: Any[]) => Any[]]> = [
      ["delta marcado corrompido", (d) => [d[0], { version: 2, corrupt: true }]],
      ["linha com época desconhecida", (d) => { d[1].writes[0].handle.refEpoch = "zz"; return d }],
      ["linha inválida para o ledger", (d) => { d[0].writes[0].view = { buckets: [] }; return d }],
      ["alias não-extensor", (d) => { d[1].alias = table("s2", [ACC(3)]); d[0].alias = table("s1", [ACC(1), ACC(2)]); d.push({ version: 3, createdAt: FIXED(), rotateTo: null, writes: [], specs: [], alias: table("s2", [ACC(4)]) }); return d }],
      ["versão fora de ordem", (d) => [d[1], d[0]]],
      ["mesmo ref com conteúdo diferente", (d) => { d[0].writes.push({ ...d[0].writes[0], view: { ...qView(), period: { from: "x", to: null } } }); return d }],
      ["rotação para época repetida", (d) => { d[1].rotateTo = "s1"; return d }],
    ]
    for (const [why, f] of cases) {
      const r: Any = await facade(tamper(f)).open(U1, "ruim")
      assert.deepEqual([r.ok, r.code], [false, "CORRUPT"], `${name}: ${why}`)
    }
    assert.equal((await facade(tamper((d) => d)).open(U1, "ruim") as Any).ok, true, `${name}: sem adulterar, abre`)
    assert.equal(codeOf(await facade(store).open(U1, "boa")), "OK", `${name}: a outra conversa segue aberta`)
    assert.equal((await reopen(store, U1, gOpen)).version, 1, name)
    if (root !== undefined) {
      const dir = join(root, "conversations", U1, "ruim")
      writeFileSync(join(dir, "v000002.json"), "{lixo")
      assert.equal(codeOf(await facade(store).open(U1, "ruim")), "CORRUPT", `${name}: arquivo com lixo`)
      assert.equal(codeOf(await facade(store).open(U1, "boa")), "OK", name)
      rmSync(join(dir, "v000001.json"))
      assert.equal(codeOf(await facade(store).open(U1, "ruim")), "CORRUPT", `${name}: lacuna no log (v1 sumiu)`)
      writeFileSync(join(dir, "meta.json"), "{x")
      assert.equal(codeOf(await facade(store).open(U1, "ruim")), "CORRUPT", `${name}: meta ilegível`)
      assert.equal(codeOf(await facade(store).open(U1, "boa")), "OK", name)
    }
  })
})

// ───────────────────────────── S: segurança e limites ─────────────────────────────
await test("S1 — o que vai ao armazenamento: specs SEM refs reais, alias SÓ com hashes no formato (nunca nome de conta), arquivos 0600/0700, e nada de nome plantado", async () => {
  await both(async (store, name, root) => {
    const { convs, open: o0 } = await start(store)
    const a = qEntry("a")
    let o = await commit(convs, o0, { writes: [add(a)], specs: [spec(a, { filters: { account: ["Conta A"] } })], aliases: table("s1", [ACC(1)], [STR(1)]) })
    for (const nome of ["Conta Demo A", "Apex-12345", "Minha Estratégia"]) {
      assert.equal(codeOf(await convs.commitTurn(o, { aliases: table("s1", [ACC(1), nome]) })), "ALIAS_INVALID", `${name}: ${nome}`)
      assert.equal(codeOf(await convs.commitTurn(o, { specs: [spec(a, { filters: { account: [`${nome} acc_${"a".repeat(24)}`] } })] })), "SPEC_HAS_REAL_REF", `${name}: ${nome}`)
    }
    o = await commit(convs, o, { rotateTo: "s2" })
    const files = (await (async () => { const st = await store.load(U1, o.conversationId); assert.equal(st.ok, true); return (st as Any).deltas })()) as Any[]
    for (const d of files) {
      assert.equal(REALREF.test(JSON.stringify(d.specs)), false, `${name}: ref real em spec`)
      if (d.alias !== null) for (const k of ["conta", "estrategia", "rotulo"]) for (const r of d.alias[k]) assert.match(r, /^(acc|str|lbl)_[0-9a-f]{24}$/)
    }
    if (root !== undefined) {
      for (const f of walk(root)) {
        const text = readFileSync(f, "utf8")
        for (const nome of ["Conta Demo A", "Apex-12345", "Minha Estratégia"]) assert.equal(text.includes(nome), false, `${name}: ${nome} em ${f}`)
        assert.equal(statSync(f).mode & 0o077, 0, `${name}: ${f} legível por outros`)
      }
      assert.equal(statSync(join(root, "conversations", U1)).mode & 0o077, 0, name)
    }
  })
})

await test("S2 — limites: 500 entradas (a 501ª ⇒ LIMIT_ENTRIES), linha ≤ 256 KiB e delta ≤ 2 MiB (exatamente no teto passa, 1 byte acima ⇒ recusado SEM gravar), na fachada e no store", async () => {
  await both(async (store, name) => {
    // 500 entradas em lotes de 100; a 501ª é recusada e nada muda
    const { convs, open: o0 } = await start(store)
    let o = o0
    for (let b = 0; b < 5; b++) o = await commit(convs, o, { writes: Array.from({ length: 100 }, (_, i) => add(qEntry(b * 100 + i + 1))) })
    assert.equal(Object.keys(o.ledger.entries).length, MAX_LEDGER_ENTRIES, name)
    assert.equal(codeOf(await convs.commitTurn(o, { writes: [add(qEntry(501))] })), "LIMIT_ENTRIES", name)
    assert.equal(codeOf(await convs.commitTurn(o, { writes: [add(qEntry(1))] })), "OK", `${name}: reescrever uma existente (idempotente) não conta`)
    assert.equal((await reopen(store, U1, o)).version, 6, name) // 5 commits + o idempotente
    // linha acima de 256 KiB, com uma view VÁLIDA (groups enorme)
    const per = JSON.stringify(gView(1).groups[0]).length
    const big = gEntry(900, Math.ceil((MAX_ROW_BYTES + 1) / per) + 2), fits = gEntry(901, Math.floor((MAX_ROW_BYTES - 2000) / per))
    assert.equal(JSON.stringify({ handle: big.handle, view: big.view }).length > MAX_ROW_BYTES, true)
    assert.equal(JSON.stringify({ handle: fits.handle, view: fits.view }).length <= MAX_ROW_BYTES, true)
    const small = await start(store, U2)
    assert.equal(codeOf(await small.convs.commitTurn(small.open, { writes: [add(big)] })), "LIMIT_ROW", name)
    // delta > 2 MiB feito de linhas que cabem, cada uma, em 256 KiB
    const nRows = Math.ceil(MAX_DELTA_BYTES / (JSON.stringify({ handle: fits.handle, view: fits.view }).length)) + 1
    const many = Array.from({ length: nRows }, (_, i) => add(gEntry(1000 + i, Math.floor((MAX_ROW_BYTES - 2000) / per))))
    assert.equal(codeOf(await small.convs.commitTurn(small.open, { writes: many })), "LIMIT_DELTA", name)
    assert.equal((await reopen(store, U2, small.open)).version, 0, `${name}: nada gravado`)
    assert.equal(codeOf(await small.convs.commitTurn(small.open, { writes: [add(fits)] })), "OK", `${name}: uma linha que cabe passa`)
    // no STORE, com blobs de tamanho exato (handle/view são JSON qualquer): teto inclusivo
    const pad = (n: number): Any => { const base = { handle: { evidenceRef: REF("a") }, view: { p: "" } }; const extra = n - Buffer.byteLength(JSON.stringify(base)); return { handle: base.handle, view: { p: "x".repeat(extra) } } }
    const mkBody = (n: number): Any => ({ rotateTo: null, writes: [{ op: "add", capability: "metrics.query@1", ...pad(n) }], specs: [], alias: null })
    const st = await start(store, U1, "s1", "so-store")
    assert.equal(Buffer.byteLength(JSON.stringify({ handle: mkBody(MAX_ROW_BYTES).writes[0].handle, view: mkBody(MAX_ROW_BYTES).writes[0].view })), MAX_ROW_BYTES)
    assert.deepEqual(await store.commit(U1, st.open.conversationId, 0, mkBody(MAX_ROW_BYTES + 1), FIXED()), conversationStoreFailure("ROW_TOO_LARGE"), `${name}: 1 byte acima`)
    assert.equal(((await store.commit(U1, st.open.conversationId, 0, mkBody(MAX_ROW_BYTES), FIXED())) as Any).ok, true, `${name}: exatamente no teto`)
    const wide = (k: number): Any => ({ rotateTo: null, writes: Array.from({ length: k }, () => ({ op: "add", capability: "metrics.query@1", ...pad(MAX_ROW_BYTES - 1000) })), specs: [], alias: null })
    const per8 = Buffer.byteLength(JSON.stringify(wide(8))) // 8 linhas ≈ 2 MiB
    assert.equal(per8 <= MAX_DELTA_BYTES, true)
    assert.equal(((await store.commit(U1, st.open.conversationId, 1, wide(8), FIXED())) as Any).ok, true, `${name}: delta de ${per8} bytes passa`)
    assert.deepEqual(await store.commit(U1, st.open.conversationId, 2, wide(9), FIXED()), conversationStoreFailure("DELTA_TOO_LARGE"), `${name}: delta acima de 2 MiB`)
    assert.equal(((await store.load(U1, "so-store")) as Any).deltas.length, 2, `${name}: a recusa não gravou`)
  })
})

// ───────────────────────────── M: medição ─────────────────────────────
await test("M1 — medição do replay com 500 entradas (50 delas groups 50×10 ≈ 70 KB): reportada, sem limite de tempo; e o conteúdo volta íntegro", async () => {
  await both(async (store, name, root) => {
    const { convs, open: o0 } = await start(store)
    let o = o0
    const t0 = performance.now()
    for (let b = 0; b < 10; b++) o = await commit(convs, o, { writes: Array.from({ length: 50 }, (_, i) => { const n = b * 50 + i + 1; return add(n % 10 === 0 ? gEntry(n, 50) : qEntry(n)) }), specs: Array.from({ length: 50 }, (_, i) => { const n = b * 50 + i + 1; return spec(n % 10 === 0 ? gEntry(n, 50) : qEntry(n)) }) })
    const tWrite = performance.now() - t0
    const t1 = performance.now()
    const back = await reopen(store, U1, o)
    const tOpen = performance.now() - t1
    assert.equal(Object.keys(back.ledger.entries).length, 500, name)
    assert.deepStrictEqual(back.ledger, o.ledger, name)
    const bytes = root !== undefined ? walk(root).reduce((s, f) => s + statSync(f).size, 0) : -1
    console.log(`  · M1 ${name}: 10 commits de 50 entradas em ${tWrite.toFixed(0)} ms; open (fold + replay de 500 entradas) em ${tOpen.toFixed(0)} ms${bytes >= 0 ? `; ${(bytes / 1048576).toFixed(2)} MiB em disco` : ""}`)
  })
})

for (const d of TMPS) rmSync(d, { recursive: true, force: true })
if (process.env.COLLECT) { console.log(`FAILED:${failed.join(",")}`); process.exit(failed.length > 0 ? 1 : 0) }
console.log(`\n${passed} testes do E7-3 passaram.`)
