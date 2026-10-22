// E7-15e: lógica PURA da tela do AI Partner (src/lib/ai-partner-ui/): RenderedAnswer → blocos, código de erro → mensagem/ação, reducer do chat, guardas de acesso e transporte HTTP.
// Testes escritos ANTES do código. Expectativa: docs/ai-partner/E7-15e-expectativa.md (D-U2, D-U4, D-U5; U1–U6).
//   node scripts/test-ai-partner-ui.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let passed = 0
const failed: string[] = []
const test = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  if (process.env.COLLECT) { try { await fn(); passed += 1 } catch { failed.push(name.split(" ")[0]) } return }
  await fn(); passed += 1; console.log(`✓ ${name}`)
}
const ROOT = fileURLToPath(new URL("..", import.meta.url))
// os módulos ainda não existem na fase vermelha: import tardio
const load = async (f: string): Promise<Any> => import(`../src/lib/ai-partner-ui/${f}.ts`).catch(() => null)
const mod = { view: await load("view"), errors: await load("errors"), chat: await load("chat-state"), guards: await load("guards"), transport: await load("transport") }
const need = (m: Any, name: string): Any => { assert.ok(m, `src/lib/ai-partner-ui/${name}.ts ainda não existe`); return m }
const jstr = (x: unknown): string => JSON.stringify(x)
const REF = `ev_${"a".repeat(32)}`

// ── fixtures ──
const RENDERED = (over: Any = {}): Any => ({
  segments: [
    { kind: "text", text: "Resultado após custos: " },
    { kind: "value", ref: REF, path: "metrics[0].value", text: "-US$ 144,00", combined: "VERIFIED", mode: "ASSERT" },
    { kind: "phrase", code: "POPULATION_DECLARED", text: "Considerando a população declarada de 48 trades." },
    { kind: "server_text", text: "Consultas tentadas: consulta de métricas." },
  ],
  banner: { combined: "VERIFIED", label: "Verificado" }, stopReason: null, ...over,
})
const REPLY = (over: Any = {}): Any => ({ ok: true, conversationId: "conv_1", outcome: "ANSWERED", response: RENDERED(), usage: { used: 1, limit: 3, remaining: 2 }, ...over })

await test("U1a — RenderedAnswer ⇒ blocos: text, value (texto, veredito, rótulo e modo), note (phrase) e text (server_text), na ordem", () => {
  const v = need(mod.view, "view").toBlocks(RENDERED())
  assert.deepEqual(v.blocks, [
    { kind: "text", text: "Resultado após custos: " },
    { kind: "value", text: "-US$ 144,00", verdict: "verified", verdictLabel: "verificado", mode: "ASSERT" },
    { kind: "note", code: "POPULATION_DECLARED", text: "Considerando a população declarada de 48 trades." },
    { kind: "text", text: "Consultas tentadas: consulta de métricas." },
  ])
  assert.deepEqual(v.banner, { verdict: "verified", label: "Verificado" }); assert.equal(v.stopped, false)
})

await test("U1b — os 4 vereditos têm palavra própria em pt-BR (não só cor) e o banner usa o PIOR do servidor; sem banner ⇒ null; stopReason ⇒ stopped", () => {
  const m = need(mod.view, "view")
  const want: Array<[string, string, string]> = [["VERIFIED", "verified", "verificado"], ["VERIFIED_PARTIAL", "partial", "verificado parcialmente"], ["NOT_VERIFIED", "unverified", "não verificado"], ["TAMPERED_OR_MISMATCH", "mismatch", "não confere"]]
  for (const [combined, verdict, label] of want) {
    const r = m.toBlocks({ segments: [{ kind: "value", ref: REF, path: "x", text: "1", combined, mode: "ASSERT" }], banner: { combined, label: "x" }, stopReason: null })
    assert.equal(r.blocks[0].verdict, verdict); assert.equal(r.blocks[0].verdictLabel, label); assert.equal(r.banner.verdict, verdict)
  }
  assert.equal(m.toBlocks(RENDERED({ banner: { combined: null, label: null } })).banner, null)
  assert.equal(m.toBlocks(RENDERED({ stopReason: "REGEN_EXHAUSTED" })).stopped, true)
})

await test("U1c — entrada malformada ⇒ null (nunca lança, nunca devolve meia resposta)", () => {
  const m = need(mod.view, "view")
  for (const bad of [null, undefined, 5, "x", [], {}, { segments: "x", banner: null, stopReason: null }, { segments: [], banner: null, stopReason: null },
    RENDERED({ segments: [] }), RENDERED({ segments: [{ kind: "html", text: "<b>" }] }), RENDERED({ segments: [{ kind: "value", text: "1", combined: "VERIFIED", mode: "ASSERT" }, { kind: "value", text: "2", combined: "MAGICO", mode: "ASSERT" }] }),
    RENDERED({ segments: [{ kind: "text" }] }), RENDERED({ segments: [{ kind: "value", text: 5, combined: "VERIFIED", mode: "ASSERT" }] }), RENDERED({ banner: { combined: "INVENTADO", label: "x" } }), RENDERED({ segments: [{ kind: "value", text: "1", combined: "VERIFIED", mode: "FORCED" }] }), RENDERED({ stopReason: 7 })])
    assert.equal(m.toBlocks(bad), null, jstr(bad))
  const hostile = { get segments(): never { throw new Error("boom") }, banner: null, stopReason: null }; assert.equal(m.toBlocks(hostile), null)
})

await test("U1d — D-U4: o bloco de valor NÃO carrega ref/path; nada de ev_…/hash/arquivo na saída; texto com HTML passa como TEXTO literal; saída determinística e congelada", () => {
  const m = need(mod.view, "view")
  const evil = "<script>alert(1)</script><img src=x onerror=1>"
  const r = m.toBlocks(RENDERED({ segments: [{ kind: "text", text: evil }, { kind: "value", ref: REF, path: "metrics[0].value", text: "1", combined: "VERIFIED", mode: "ASSERT" }, { kind: "phrase", code: "X", text: evil }] }))
  assert.equal(r.blocks[0].text, evil); assert.deepEqual(Object.keys(r.blocks[1]).sort(), ["kind", "mode", "text", "verdict", "verdictLabel"])
  assert.doesNotMatch(jstr(r), /ev_[0-9a-f]{32}|[0-9a-f]{64}|metrics\[0\]|"ref"|"path"/)
  assert.equal(jstr(m.toBlocks(RENDERED())), jstr(m.toBlocks(RENDERED()))); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.blocks) && Object.isFrozen(r.blocks[0]))
})

// ── erros ──
const keysOf = (file: string): string[] => {
  const src = readFileSync(ROOT + file, "utf8"); const i = src.indexOf("const MESSAGES: Record<string, string> = {"); assert.ok(i >= 0, file)
  const block = src.slice(i, src.indexOf("\n}", i)); return [...block.matchAll(/\b([A-Z][A-Z_]+):\s*"/g)].map((m) => m[1])
}
await test("U2a — guarda de COMPLETUDE: TODO código do chat e do upload (lidos do código-fonte do backend) + os do cliente têm mensagem pt-BR e ação; código novo sem mapa derruba o teste", () => {
  const e = need(mod.errors, "errors")
  const codes = new Set([...keysOf("src/lib/infra/ai-partner-chat.ts"), ...keysOf("src/lib/infra/ai-partner-imports.ts"), "QUOTA_EXCEEDED", "UNAUTHENTICATED", "NETWORK", "TIMEOUT", "BAD_RESPONSE"])
  assert.ok(codes.size >= 20, `códigos lidos: ${codes.size}`)
  for (const code of codes) {
    const v = e.errorView(code); assert.equal(typeof v.message, "string", code); assert.ok(v.message.length >= 8 && !/^[A-Z_]+$/.test(v.message), code)
    assert.ok(["upgrade", "retry", "import", "newConversation", "none"].includes(v.action.kind), code)
  }
  assert.deepEqual([...e.ERROR_CODES].sort(), [...codes].sort(), "ERROR_CODES == códigos do backend + cliente")
})

await test("U2b — ações: cota/pool ⇒ upgrade; BUSY/RATE_LIMITED/TURN_IN_PROGRESS/TURN_CONFLICT/MODEL_UNAVAILABLE/STORAGE_ERROR/NETWORK/TIMEOUT ⇒ retry; NO_IMPORTS ⇒ import; CONVERSATION_FULL/NOT_FOUND(chat) ⇒ newConversation; o resto ⇒ none", () => {
  const e = need(mod.errors, "errors")
  for (const c of ["QUOTA_EXCEEDED", "FREE_POOL_EXHAUSTED"]) assert.equal(e.errorView(c).action.kind, "upgrade", c)
  for (const c of ["BUSY", "RATE_LIMITED", "TURN_IN_PROGRESS", "TURN_CONFLICT", "MODEL_UNAVAILABLE", "STORAGE_ERROR", "NETWORK", "TIMEOUT"]) assert.equal(e.errorView(c).action.kind, "retry", c)
  assert.equal(e.errorView("NOT_FOUND", { scope: "chat" }).action.kind, "newConversation"); assert.equal(e.errorView("NOT_FOUND", { scope: "imports" }).action.kind, "none"); assert.equal(e.errorView("NOT_FOUND").action.kind, "none")
  assert.equal(e.errorView("NO_IMPORTS").action.kind, "import"); assert.equal(e.errorView("CONVERSATION_FULL").action.kind, "newConversation")
  for (const c of ["INVALID_REQUEST", "INVALID_ARGS", "INVALID_ENCODING", "TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "FORBIDDEN_ORIGIN", "NOT_CONFIGURED", "PIPELINE_FAILED", "CONTEXT_CONFLICT", "UNAUTHENTICATED", "BAD_RESPONSE"]) assert.equal(e.errorView(c).action.kind, "none", c)
})

await test("U2c — retry: segundos do servidor 1…120 (0/negativo/NaN/ausente ⇒ padrão por código; >120 ⇒ 120); código desconhecido ⇒ mensagem genérica sem eco, ação none, sem lançar", () => {
  const e = need(mod.errors, "errors")
  assert.equal(e.errorView("BUSY", { retryAfterSec: 7 }).action.afterSec, 7); assert.equal(e.errorView("BUSY", { retryAfterSec: 99999 }).action.afterSec, 120)
  for (const bad of [0, -3, NaN, Infinity, "7", null, undefined]) { const s = e.errorView("BUSY", { retryAfterSec: bad as never }).action.afterSec; assert.ok(Number.isInteger(s) && s >= 1 && s <= 120, String(bad)) }
  assert.ok(e.errorView("TURN_CONFLICT").action.afterSec >= 0)
  const u = e.errorView("<img src=x onerror=1>"); assert.equal(u.action.kind, "none"); assert.doesNotMatch(u.message, /img|onerror|</)
  assert.equal(e.errorView("QUOTA_EXCEEDED", { suggestedPlan: "PRO" }).action.suggestedPlan, "PRO"); assert.equal(e.errorView("QUOTA_EXCEEDED", { suggestedPlan: "<x>" }).action.suggestedPlan, null)
  assert.doesNotMatch(e.errorView("QUOTA_EXCEEDED", { error: "<script>x</script>" } as never).message, /script/)
})

// ── reducer ──
const S = (): Any => need(mod.chat, "chat-state")
const run = (events: Any[], start?: Any): Any => events.reduce((st, ev) => S().chatReducer(st, ev), start ?? S().initialChatState)

await test("U3a — estado inicial e canSend: sem pendente, pergunta com texto e ≤ 4000 caracteres; vazia/só espaço/4001/pendente ⇒ não", () => {
  const c = S(); assert.deepEqual([c.initialChatState.conversationId, c.initialChatState.messages, c.initialChatState.pending, c.initialChatState.error, c.initialChatState.usage], [null, [], false, null, null])
  assert.equal(c.canSend(c.initialChatState, "Qual foi meu resultado?"), true); assert.equal(c.canSend(c.initialChatState, "x".repeat(4000)), true)
  for (const bad of ["", "   \n\t", "x".repeat(4001)]) assert.equal(c.canSend(c.initialChatState, bad), false)
  assert.equal(c.canSend(run([{ type: "send", question: "oi" }]), "outra"), false)
})

await test("U3b — send ⇒ mensagem do usuário (texto como digitado, sem eco do servidor) + pendente; send inválido ou durante pendente é IGNORADO (estado idêntico)", () => {
  const c = S(); const st = run([{ type: "send", question: "  Qual foi meu resultado?  " }])
  assert.equal(st.pending, true); assert.equal(st.error, null); assert.deepEqual(st.messages.map((m: Any) => [m.role, m.text]), [["user", "  Qual foi meu resultado?  "]])
  assert.equal(jstr(c.chatReducer(st, { type: "send", question: "outra" })), jstr(st)); assert.equal(jstr(c.chatReducer(c.initialChatState, { type: "send", question: "   " })), jstr(c.initialChatState))
})

await test("U3c — reply ⇒ resposta do assistente (blocos), conversationId e uso guardados, pendente falso; reply fora de hora ou malformada não quebra (malformada ⇒ erro BAD_RESPONSE, pergunta mantida)", () => {
  const c = S(); const st = run([{ type: "send", question: "oi" }, { type: "reply", reply: REPLY() }])
  assert.equal(st.pending, false); assert.equal(st.conversationId, "conv_1"); assert.deepEqual(st.usage, { used: 1, limit: 3, remaining: 2 })
  assert.deepEqual(st.messages.map((m: Any) => m.role), ["user", "assistant"]); assert.equal(st.messages[1].view.blocks[1].verdict, "verified")
  assert.equal(jstr(c.chatReducer(c.initialChatState, { type: "reply", reply: REPLY() })), jstr(c.initialChatState), "reply sem pergunta pendente é ignorada")
  const bad = run([{ type: "send", question: "oi" }, { type: "reply", reply: REPLY({ response: { segments: "x" } }) }])
  assert.equal(bad.pending, false); assert.equal(bad.error.code, "BAD_RESPONSE"); assert.equal(bad.messages.length, 1)
})

await test("U3d — fail ⇒ erro com mensagem/ação do mapa, pendente falso, mensagem do usuário mantida; retry reenvia a MESMA pergunta sem duplicar a mensagem; retry sem erro/ação retry é ignorado", () => {
  const c = S(); const failed = run([{ type: "send", question: "oi" }, { type: "fail", code: "BUSY", retryAfterSec: 9 }])
  assert.equal(failed.pending, false); assert.equal(failed.error.code, "BUSY"); assert.equal(failed.error.action.afterSec, 9); assert.equal(failed.messages.length, 1)
  const again = c.chatReducer(failed, { type: "retry" }); assert.equal(again.pending, true); assert.equal(again.error, null); assert.equal(again.messages.length, 1); assert.equal(c.pendingQuestion(again), "oi")
  assert.equal(jstr(c.chatReducer(c.initialChatState, { type: "retry" })), jstr(c.initialChatState))
  const quota = run([{ type: "send", question: "oi" }, { type: "fail", code: "QUOTA_EXCEEDED", suggestedPlan: "PRO" }]); assert.equal(jstr(c.chatReducer(quota, { type: "retry" })), jstr(quota), "upgrade não é 'tentar de novo'")
})

await test("U3e — CONVERSATION_FULL ⇒ ação newConversation; newConversation zera conversa e mensagens, MANTÉM o uso; conversationId volta ao próximo send", () => {
  const c = S(); const full = run([{ type: "send", question: "oi" }, { type: "reply", reply: REPLY() }, { type: "send", question: "mais" }, { type: "fail", code: "CONVERSATION_FULL" }])
  assert.equal(full.error.action.kind, "newConversation")
  const fresh = c.chatReducer(full, { type: "newConversation" }); assert.deepEqual([fresh.conversationId, fresh.messages, fresh.pending, fresh.error], [null, [], false, null]); assert.deepEqual(fresh.usage, { used: 1, limit: 3, remaining: 2 })
  assert.equal(c.pendingConversationId(run([{ type: "send", question: "a" }, { type: "reply", reply: REPLY() }, { type: "send", question: "b" }])), "conv_1")
})

await test("U3f — ids de mensagem únicos e crescentes; reducer puro (não muda o estado de entrada) e determinístico", () => {
  const c = S(); const before = jstr(c.initialChatState)
  const st = run([{ type: "send", question: "a" }, { type: "reply", reply: REPLY() }, { type: "send", question: "b" }, { type: "reply", reply: REPLY() }])
  const ids = st.messages.map((m: Any) => m.id); assert.equal(new Set(ids).size, 4); assert.deepEqual([...ids].sort((x: number, y: number) => x - y), ids)
  assert.equal(jstr(c.initialChatState), before); assert.equal(jstr(run([{ type: "send", question: "a" }])), jstr(run([{ type: "send", question: "a" }])))
  assert.throws(() => { (st as Any).messages.push(1) }, undefined, "estado congelado")
})

// ── guardas ──
await test("U5 — guardas: prévia só com NODE_ENV=development; página real só com AI_PARTNER_UI exatamente '1' (decisão com env injetado)", () => {
  const g = need(mod.guards, "guards")
  assert.equal(g.isAiPartnerPreviewEnabled({ NODE_ENV: "development" }), true)
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "test" }, { NODE_ENV: "Development" }, { NODE_ENV: "" }]) assert.equal(g.isAiPartnerPreviewEnabled(env), false, jstr(env))
  assert.equal(g.isAiPartnerPageEnabled({ AI_PARTNER_UI: "1" }), true)
  for (const env of [{}, { AI_PARTNER_UI: "0" }, { AI_PARTNER_UI: "true" }, { AI_PARTNER_UI: "11" }, { AI_PARTNER_UI: " 1" }, { AI_PARTNER_UI: "" }, { NODE_ENV: "development" }]) assert.equal(g.isAiPartnerPageEnabled(env), false, jstr(env))
})

// ── transporte ──
interface Seen { url: string; init: Any }
const fakeFetch = (reply: (seen: Seen, n: number) => Response | Promise<Response>): { fetch: Any; seen: Seen[] } => { const seen: Seen[] = []; return { seen, fetch: async (url: string, init: Any) => { seen.push({ url, init }); return reply({ url, init }, seen.length) } } }
const JSONRES = (status: number, body: unknown, headers: Record<string, string> = {}): Response => new Response(jstr(body), { status, headers: { "content-type": "application/json", ...headers } })
const tr = (f: Any, extra: Any = {}): Any => need(mod.transport, "transport").createHttpTransport({ fetch: f, ...extra })

await test("U6a — sendChat: POST /api/ai-partner/chat, JSON só com {question[, conversationId]}, mesma origem, sem cache, SEM cabeçalho extra; 200 ⇒ {ok,conversationId,outcome,response,usage}", async () => {
  const f = fakeFetch(() => JSONRES(200, REPLY())); const t = tr(f.fetch)
  const a = await t.sendChat({ question: "oi", conversationId: null })
  assert.equal(f.seen[0].url, "/api/ai-partner/chat"); assert.equal(f.seen[0].init.method, "POST"); assert.deepEqual(JSON.parse(f.seen[0].init.body), { question: "oi" })
  assert.equal(f.seen[0].init.credentials, "same-origin"); assert.equal(f.seen[0].init.cache, "no-store"); assert.deepEqual(Object.keys(f.seen[0].init.headers).map((k: string) => k.toLowerCase()), ["content-type"])
  assert.equal(a.ok, true); assert.equal(a.conversationId, "conv_1"); assert.equal(a.outcome, "ANSWERED"); assert.equal(a.response.banner.label, "Verificado"); assert.deepEqual(a.usage, { used: 1, limit: 3, remaining: 2 })
  await t.sendChat({ question: "e agora", conversationId: "conv_1" }); assert.deepEqual(JSON.parse(f.seen[1].init.body), { question: "e agora", conversationId: "conv_1" })
})

await test("U6b — erros do chat: 403 cota ⇒ {code,suggestedPlan}; 429 BUSY ⇒ retryAfterSec do Retry-After; 401 sem código ⇒ UNAUTHENTICATED; corpo não-JSON ⇒ BAD_RESPONSE; 200 malformado ⇒ BAD_RESPONSE; rede caída ⇒ NETWORK; NUNCA lança nem repassa o texto do servidor", async () => {
  const run1 = async (res: () => Response | Promise<Response>): Promise<Any> => tr(fakeFetch(res).fetch).sendChat({ question: "oi", conversationId: null })
  const q = await run1(() => JSONRES(403, { ok: false, code: "QUOTA_EXCEEDED", error: "<script>x</script>", upgrade: true, suggestedPlan: "PRO", limit: 3, used: 3 })); assert.deepEqual([q.ok, q.code, q.suggestedPlan], [false, "QUOTA_EXCEEDED", "PRO"]); assert.doesNotMatch(jstr(q), /script/)
  const b = await run1(() => JSONRES(429, { ok: false, code: "BUSY", error: "x" }, { "retry-after": "12" })); assert.deepEqual([b.code, b.retryAfterSec], ["BUSY", 12])
  const bad = await run1(() => JSONRES(429, { ok: false, code: "BUSY" }, { "retry-after": "abc" })); assert.equal(bad.retryAfterSec, undefined)
  assert.equal((await run1(() => JSONRES(401, { error: "Não autorizado" }))).code, "UNAUTHENTICATED")
  assert.equal((await run1(() => new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } }))).code, "BAD_RESPONSE")
  assert.equal((await run1(() => JSONRES(200, { ok: true, conversationId: 5, response: "x" }))).code, "BAD_RESPONSE")
  assert.equal((await run1(() => JSONRES(200, REPLY({ outcome: "HACK" })))).code, "BAD_RESPONSE", "outcome fora de ANSWERED/STOPPED não passa")
  assert.equal((await run1(() => JSONRES(500, { ok: false, code: "CODIGO_NOVO_DESCONHECIDO" }))).code, "BAD_RESPONSE", "código fora do mapa não passa adiante")
  assert.equal((await run1(() => { throw new Error("rede") })).code, "NETWORK")
})

await test("U6c — timeout (AbortController): fetch que nunca responde ⇒ {ok:false, code:'TIMEOUT'} depois de timeoutMs; padrão do timeout > 60 s (o maxDuration da rota)", async () => {
  const t = tr((_url: string, init: Any) => new Promise((_, rej) => { init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))) }), { timeoutMs: 20 })
  const r = await t.sendChat({ question: "oi", conversationId: null }); assert.deepEqual([r.ok, r.code], [false, "TIMEOUT"])
  assert.ok(need(mod.transport, "transport").DEFAULT_TIMEOUT_MS > 60_000)
})

await test("U6d — importações: list ⇒ {ok,imports,usage}; upload ⇒ multipart com campo 'file' (SEM content-type manual, o navegador põe o boundary) e created pelo status (201/200); delete valida o sha ANTES de chamar a rede", async () => {
  const sha = "a".repeat(64)
  const f = fakeFetch((s) => s.init.method === "GET" ? JSONRES(200, { usage: { files: 1, bytes: 10, corrupt: 0, limits: {}, remaining: {} }, imports: [{ fileSha256: sha, importId: "i", fileName: "x.csv", fileBytes: 10, createdAt: "2026-10-21T00:00:00.000Z" }] }) : s.init.method === "POST" ? JSONRES(201, { ok: true }) : JSONRES(200, { ok: true, deleted: true }))
  const t = tr(f.fetch)
  const l = await t.listImports(); assert.equal(l.ok, true); assert.equal(l.imports[0].fileName, "x.csv"); assert.equal(f.seen[0].url, "/api/ai-partner/imports"); assert.equal(f.seen[0].init.method, "GET")
  const file = new File(["a;b\n1;2\n"], "export.csv", { type: "text/csv" }); const u = await t.uploadImport(file)
  assert.deepEqual([u.ok, u.created], [true, true]); assert.equal(f.seen[1].url, "/api/ai-partner/imports"); assert.equal(f.seen[1].init.method, "POST"); assert.ok(f.seen[1].init.body instanceof FormData); assert.ok(f.seen[1].init.body.get("file") instanceof Blob)
  assert.equal(Object.keys(f.seen[1].init.headers ?? {}).some((k: string) => k.toLowerCase() === "content-type"), false)
  const n = f.seen.length; for (const bad of ["", "abc", "../x", sha.slice(1), sha.toUpperCase() + "g"]) assert.deepEqual(await t.deleteImport(bad), { ok: false, code: "INVALID_ARGS" }); assert.equal(f.seen.length, n, "sha inválido não chama a rede")
  const d = await t.deleteImport(sha); assert.equal(d.ok, true); assert.equal(f.seen[n].url, `/api/ai-partner/imports/${sha}`); assert.equal(f.seen[n].init.method, "DELETE")
  const tooBig = await t.uploadImport(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.csv")); assert.deepEqual([tooBig.ok, tooBig.code], [false, "TOO_LARGE_FOR_ROUTE"]); assert.equal(f.seen.length, n + 1, "arquivo acima do teto nem sai do navegador")
})

await test("U6e — nenhuma dessas camadas tem dangerouslySetInnerHTML, innerHTML, eval, process.env, localStorage nem import dinâmico (varredura do código-fonte)", () => {
  for (const f of ["view", "errors", "chat-state", "guards", "transport"]) {
    const src = readFileSync(`${ROOT}src/lib/ai-partner-ui/${f}.ts`, "utf8")
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /dangerouslySetInnerHTML|innerHTML|\beval\s*\(|new Function|localStorage|sessionStorage|\bimport\s*\(/, f)
  }
  assert.doesNotMatch(readFileSync(`${ROOT}src/lib/ai-partner-ui/view.ts`, "utf8"), /process\.env/)
})

// ── E7-18: acesso só para e-mails permitidos (página E chat) ──
await test("L1 — isAiPartnerUserAllowed: exige AI_PARTNER_UI '1' E e-mail na lista (exato, sem diferença de maiúsculas/espaços); lista ausente/vazia ⇒ ninguém; e-mail parecido ou ausente ⇒ não", () => {
  const g = need(mod.guards, "guards")
  const f = g.isAiPartnerUserAllowed
  assert.equal(typeof f, "function", "isAiPartnerUserAllowed ainda não existe")
  const on = (list?: string) => ({ AI_PARTNER_UI: "1", ...(list === undefined ? {} : { AI_PARTNER_ALLOWED_EMAILS: list }) })
  assert.equal(f(on("a@x.com"), "a@x.com"), true)
  assert.equal(f(on(" A@X.com , b@y.org "), "b@Y.ORG"), true, "vários, espaços e maiúsculas")
  assert.equal(f(on("a@x.com"), "  a@x.com "), true, "e-mail da sessão com espaços nas pontas")
  for (const e of ["ba@x.com", "a@x.com.br", "a@x.co", "xa@x.com", "a@x.com,b@y.org", "", null, undefined, 5, {}]) assert.equal(f(on("a@x.com"), e), false, jstr(e))
  for (const e of ["", "   "]) assert.equal(f(on("a@x.com,,"), e), false, "e-mail vazio nunca casa com entrada vazia da lista")
  for (const list of [undefined, "", " ", ",", " , ,", ";"]) assert.equal(f(on(list), "a@x.com"), false, `lista ${jstr(list)}`)
  for (const ui of [undefined, "0", "true", " 1", "11", ""]) assert.equal(f({ ...(ui === undefined ? {} : { AI_PARTNER_UI: ui }), AI_PARTNER_ALLOWED_EMAILS: "a@x.com" }, "a@x.com"), false, `UI ${jstr(ui)}`)
  assert.equal(f({ AI_PARTNER_ALLOWED_EMAILS: "a@x.com" }, "a@x.com"), false, "lista sem a flag")
})

const SRC = (f: string): string => readFileSync(`${ROOT}${f}`, "utf8")
await test("L2 — a página real chama isAiPartnerUserAllowed com o e-mail da sessão e dá notFound() ANTES de renderizar a tela", () => {
  const src = SRC("src/app/(app)/ai-partner/page.tsx")
  const call = src.search(/if\s*\(\s*!\s*isAiPartnerUserAllowed\(\s*process\.env\s*,\s*user\.email/)
  assert.ok(call >= 0, "a página não consulta a lista de e-mails")
  const nf = src.indexOf("notFound()", call)
  const render = src.indexOf("<AiPartnerRealScreen", call)
  assert.ok(nf >= 0 && render >= 0 && nf < render, "notFound() tem de vir antes da tela")
  assert.match(src, /isAiPartnerPageEnabled\(process\.env\)/, "continua exigindo AI_PARTNER_UI")
})

await test("L3 — aiPartnerChatCtx: quem não passa na lista fica com deps null (rota ⇒ 503 NOT_CONFIGURED); a lista é lida do e-mail da SESSÃO", () => {
  const src = SRC("src/app/api/ai-partner/_ctx.ts")
  const fn = src.slice(src.indexOf("export async function aiPartnerChatCtx"))
  assert.match(fn, /deps:\s*built\.ok\s*&&\s*isAiPartnerUserAllowed\(\s*process\.env\s*,\s*session\?\.user\?\.email\s*\)\s*\?\s*built\.deps\s*:\s*null/, "deps tem de ser null quando não permitido (e-mail da sessão)")
  // o ctx dos imports (já em produção) NÃO muda (D-L2)
  const imp = src.slice(src.indexOf("export async function aiPartnerCtx"), src.indexOf("// Chat (E7-15c)"))
  assert.doesNotMatch(imp, /isAiPartnerUserAllowed/)
})

await test("L4 — nenhum e-mail real no repositório: o endereço do dono nunca aparece em src/, scripts/, docs/, fixtures/ nem .env.example; guards/_ctx/página não têm endereço fixo", () => {
  const owner = ["difoggi", "junior", "marcelo", "@", "gmail", ".com"].join("")
  const hits: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(`${ROOT}${dir}`, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(rel) } else if (/\.(ts|tsx|mts|md|json|css|txt|example)$/.test(e.name) && readFileSync(`${ROOT}${rel}`, "utf8").toLowerCase().includes(owner)) hits.push(rel)
    }
  }
  for (const d of ["src", "scripts", "docs", "fixtures"]) walk(d)
  try { if (readFileSync(`${ROOT}.env.example`, "utf8").toLowerCase().includes(owner)) hits.push(".env.example") } catch { /* sem .env.example */ }
  assert.deepEqual(hits, [])
  for (const f of ["src/lib/ai-partner-ui/guards.ts", "src/app/api/ai-partner/_ctx.ts", "src/app/(app)/ai-partner/page.tsx"]) assert.doesNotMatch(SRC(f), /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, `${f} tem e-mail fixo`)
})

if (process.env.COLLECT) console.log(JSON.stringify({ passed, failed }))
else console.log(`\n${passed} testes ✓`)
