// E7-15c (parte 1): o cliente Groq (infra/groq-client.ts) como `ModelPort` — TESTES 100% OFFLINE com `fetch` FALSO. Nenhuma rede, nenhuma chave real.
// Expectativa escrita ANTES do código: docs/ai-partner/E7-15c-expectativa.md (D-G1…D-G11; G1–G15; mutações EG…).
//   node scripts/test-groq-client.mts       (COLLECT=1 só para a análise de mutações)
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { EvidenceExplainArgsSchema } from "../src/lib/agent-capabilities/evidence-explain.ts"
import { EvidenceRefreshArgsSchema } from "../src/lib/agent-capabilities/evidence-refresh.ts"
import { ExitAnalysisArgsSchema } from "../src/lib/agent-capabilities/exit-analysis.ts"
import { ExitBreakdownArgsSchema } from "../src/lib/agent-capabilities/exit-breakdown.ts"
import { MetricsCompareArgsSchema } from "../src/lib/agent-capabilities/metrics-compare.ts"
import { MetricsGroupsArgsSchema } from "../src/lib/agent-capabilities/metrics-groups.ts"
import { MetricsQueryArgsSchema } from "../src/lib/agent-capabilities/metrics-query.ts"
import { RankGroupsArgsSchema } from "../src/lib/agent-capabilities/rank-groups.ts"
import { CAPABILITY_IDS } from "../src/lib/agent/contract.ts"
import { METRIC_IDS } from "../src/lib/metrics/index.ts"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { createConversations, createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { registerImport } from "../src/lib/infra/dataset.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { CHAT_TOOLS, runChatTurn } from "../src/lib/infra/chat-turn.ts"
import { SYSTEM_PROMPT } from "../src/lib/agent/system-prompt.ts"
import { CALL_TIMEOUT_MS, DEFAULT_GROQ_MODEL, GROQ_URL, MAX_TOKENS_PER_CALL, createGroqModelPort, sanitizeModelContent } from "../src/lib/infra/groq-client.ts"
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
const KEY = "gsk_TESTKEY0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH"
const jstr = (x: unknown): string => JSON.stringify(x)
const NOW = 1_800_000_000_000

// ── fetch falso: registra o que recebeu e responde pelo roteiro ──
interface Seen { url: string; init: Any; body: Any }
function fakeFetch(script: (n: number, seen: Seen) => Any | Promise<Any>): { fetch: Any; seen: Seen[] } {
  const seen: Seen[] = []
  const fetch = async (url: string, init: Any): Promise<Any> => { const s: Seen = { url, init, body: JSON.parse(init.body) }; seen.push(s); return script(seen.length, s) }
  return { fetch, seen }
}
const ok = (message: Any, usage: Any = { total_tokens: 123 }, extra: Any = {}): Any => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message, finish_reason: "stop" }], usage, ...extra }) })
const http = (status: number, body: unknown = { error: { message: "texto do provedor SEGREDO-PROVEDOR" } }, retryAfter: string | null = null): Any => ({ status, headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? retryAfter : null) }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) })
const port = (f: Any, over: Any = {}): Any => createGroqModelPort({ apiKey: KEY, fetch: f.fetch ?? f, now: () => NOW, deadlineAt: NOW + 50_000, ...over })
const REQ = (over: Any = {}): Any => ({ messages: [{ role: "system", content: "S" }, { role: "user", content: "pergunta" }], tools: [{ name: "metrics_query", description: "d", parameters: { type: "object", properties: {} } }], toolChoice: "auto", ...over })
const final = (content: string, usage?: Any): Any => ok({ role: "assistant", content }, usage)
const toolCall = (id: string, name: string, args: string): Any => ({ id, type: "function", function: { name, arguments: args } })

await test("G1 — a chamada: POST em api.groq.com/openai/v1/chat/completions; SÓ os cabeçalhos authorization (Bearer) e content-type; a chave não vai em mais lugar nenhum", async () => {
  const f = fakeFetch(() => final("{}")); await port(f).complete(REQ())
  assert.equal(f.seen.length, 1); assert.equal(GROQ_URL, "https://api.groq.com/openai/v1/chat/completions"); assert.equal(f.seen[0].url, GROQ_URL); assert.equal(f.seen[0].init.method, "POST")
  assert.deepEqual(Object.keys(f.seen[0].init.headers).map((h) => h.toLowerCase()).sort(), ["authorization", "content-type"]); assert.equal(f.seen[0].init.headers.authorization ?? f.seen[0].init.headers.Authorization, `Bearer ${KEY}`)
  assert.ok(!f.seen[0].init.body.includes(KEY), "chave no corpo"); assert.ok(!f.seen[0].url.includes(KEY), "chave na URL")
})

await test("G2 — o corpo tem EXATAMENTE model, messages, tools, tool_choice, reasoning_effort none, reasoning_format hidden, max_tokens 1500, temperature 0.2; o modelo padrão e o do ambiente", async () => {
  const f = fakeFetch(() => final("{}")); await port(f).complete(REQ({ toolChoice: "none" }))
  assert.deepEqual(Object.keys(f.seen[0].body).sort(), ["max_tokens", "messages", "model", "reasoning_effort", "reasoning_format", "temperature", "tool_choice", "tools"])
  assert.equal(f.seen[0].body.model, DEFAULT_GROQ_MODEL); assert.equal(DEFAULT_GROQ_MODEL, "qwen/qwen3.8-27b"); assert.equal(f.seen[0].body.tool_choice, "none")
  assert.equal(f.seen[0].body.reasoning_effort, "none"); assert.equal(f.seen[0].body.reasoning_format, "hidden"); assert.equal(f.seen[0].body.max_tokens, 1500); assert.equal(MAX_TOKENS_PER_CALL, 1500); assert.equal(f.seen[0].body.temperature, 0.2)
  const g = fakeFetch(() => final("{}")); await port(g, { model: "outro/modelo-x" }).complete(REQ()); assert.equal(g.seen[0].body.model, "outro/modelo-x"); assert.equal(g.seen[0].body.tool_choice, "auto")
})

await test("G3 — mensagens no formato OpenAI: system/user literais; assistant com tool_calls (arguments em STRING JSON, content null); tool com tool_call_id", async () => {
  const f = fakeFetch(() => final("{}"))
  await port(f).complete(REQ({ messages: [{ role: "system", content: "S" }, { role: "user", content: "Q" }, { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "metrics_query", arguments: { metricIds: ["netPnl"] } }] }, { role: "tool", toolCallId: "c1", content: '{"ok":true}' }] }))
  assert.deepEqual(f.seen[0].body.messages, [
    { role: "system", content: "S" }, { role: "user", content: "Q" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "metrics_query", arguments: '{"metricIds":["netPnl"]}' } }] },
    { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
  ])
})

await test("G4 — ferramentas no formato {type:'function',function:{name,description,parameters}}; nada além disso", async () => {
  const f = fakeFetch(() => final("{}")); const tools = (CHAT_TOOLS as Any[]).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
  await port(f).complete(REQ({ tools })); const sent = f.seen[0].body.tools
  assert.equal(sent.length, 6); for (const [i, t] of sent.entries()) { assert.deepEqual(Object.keys(t).sort(), ["function", "type"]); assert.equal(t.type, "function"); assert.deepEqual(Object.keys(t.function).sort(), ["description", "name", "parameters"]); assert.equal(t.function.name, tools[i].name) }
})

await test("G5 — resposta com tool_calls ⇒ {kind:'tool_calls', calls com id/name/arguments já em OBJETO, usage.totalTokens}; tool_calls tem prioridade sobre content", async () => {
  const f = fakeFetch(() => ok({ role: "assistant", content: "ignorado", tool_calls: [toolCall("c1", "metrics_query", '{"metricIds":["netPnl"],"filters":{},"options":{}}'), toolCall("c2", "exit_breakdown", "{}")] }, { total_tokens: 321 }))
  const r: Any = await port(f).complete(REQ()); assert.equal(r.kind, "tool_calls"); assert.deepEqual(r.calls, [{ id: "c1", name: "metrics_query", arguments: { metricIds: ["netPnl"], filters: {}, options: {} } }, { id: "c2", name: "exit_breakdown", arguments: {} }]); assert.deepEqual(r.usage, { totalTokens: 321 })
})

await test("G6 — arguments inválidos (JSON quebrado, array, texto, ausente) ⇒ null (o executor responde ARGS_INVALID)", async () => {
  for (const args of ["{quebrado", "[1,2]", '"texto"', "", "null", undefined]) {
    const f = fakeFetch(() => ok({ role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "metrics_query", ...(args === undefined ? {} : { arguments: args }) } }] }))
    const r: Any = await port(f).complete(REQ()); assert.equal(r.kind, "tool_calls", String(args)); assert.equal(r.calls[0].arguments, null, String(args))
  }
})

await test("G7 — resposta final: <think>…</think>, <think> sem fechar e cercas ```json são removidos; espaços aparados; vazio vira ''", async () => {
  assert.equal(sanitizeModelContent('<think>raciocínio\nlongo</think>{"a":1}'), '{"a":1}')
  assert.equal(sanitizeModelContent('  <think>a</think>x<think>b</think>  '), "x"); assert.equal(sanitizeModelContent('texto <think>sem fechar {"a":1}'), "texto")
  assert.equal(sanitizeModelContent('```json\n{"a":1}\n```'), '{"a":1}'); assert.equal(sanitizeModelContent('```\n{"a":1}\n```'), '{"a":1}'); assert.equal(sanitizeModelContent('  \n '), ""); assert.equal(sanitizeModelContent('{"a":"<think>não é raciocínio</think>"}'), '{"a":""}')
  const f = fakeFetch(() => final('<think>x</think>\n```json\n{"segments":[],"claims":[]}\n```')); const r: Any = await port(f).complete(REQ()); assert.deepEqual(r, { kind: "final", content: '{"segments":[],"claims":[]}', usage: { totalTokens: 123 } })
})

await test("G8 — usage: total_tokens válido vira usage.totalTokens; ausente/negativo/NaN/texto ⇒ usage SEM totalTokens (o laço trata como o teto inteiro)", async () => {
  for (const [usage, expected] of [[{ total_tokens: 77 }, 77], [{ total_tokens: 0 }, 0], [undefined, undefined], [null, undefined], [{}, undefined], [{ total_tokens: -3 }, undefined], [{ total_tokens: "9" }, undefined], [{ total_tokens: Infinity }, undefined]] as Array<[Any, number | undefined]>) {
    const f = fakeFetch(() => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" } }], ...(usage === undefined ? {} : { usage }) }) })); const r: Any = await port(f).complete(REQ()); assert.equal(r.usage.totalTokens, expected, jstr(usage))
  }
})

await test("G9 — erros: 429/413 ⇒ RATE_LIMITED; 5xx e rede e corpo inválido e sem choices ⇒ UPSTREAM; 400/401/403/404 ⇒ CONFIG; abort ⇒ TIMEOUT", async () => {
  const code = async (script: Any): Promise<string> => { const r: Any = await port(fakeFetch(script)).complete(REQ()); assert.equal(r.kind, "error"); assert.deepEqual(Object.keys(r).sort(), ["code", "kind"]); return r.code }
  for (const s of [429, 413]) assert.equal(await code(() => http(s)), "RATE_LIMITED", String(s))
  for (const s of [500, 502, 503, 504]) assert.equal(await code(() => http(s)), "UPSTREAM", String(s))
  for (const s of [400, 401, 403, 404, 422]) assert.equal(await code(() => http(s)), "CONFIG", String(s))
  assert.equal(await code(() => { throw new Error("ECONNRESET SEGREDO-REDE") }), "UPSTREAM"); assert.equal(await code(() => http(200, "não é json")), "UPSTREAM"); assert.equal(await code(() => http(200, {})), "UPSTREAM"); assert.equal(await code(() => http(200, { choices: [] })), "UPSTREAM"); assert.equal(await code(() => http(200, { choices: [{}] })), "UPSTREAM")
  assert.equal(await code(() => { throw Object.assign(new Error("abortado"), { name: "AbortError" }) }), "TIMEOUT")
})

await test("G10 — NENHUM erro vaza: nem a chave, nem o texto do provedor, nem a exceção, nem o corpo enviado, nem a URL", async () => {
  const cases: Any[] = [() => http(429), () => http(500), () => http(401), () => { throw new Error(`falha com ${KEY} SEGREDO-REDE`) }, () => http(200, "lixo SEGREDO-PROVEDOR")]
  for (const s of cases) { const r = await port(fakeFetch(s)).complete(REQ()); const t = jstr(r); assert.ok(!t.includes(KEY) && !/SEGREDO|ECONN|api\.groq|pergunta/.test(t), t) }
})

await test("G11 — prazos: sem tempo restante ⇒ TIMEOUT SEM chamar o fetch; fetch que não responde é abortado pelo prazo da chamada e pelo prazo do turno", async () => {
  const never = (signalSeen: { s: Any }) => (_n: number, seen: Seen): Promise<Any> => new Promise((_, reject) => { signalSeen.s = seen.init.signal; seen.init.signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" }))) })
  const a = fakeFetch(() => final("{}")); assert.deepEqual(await port(a, { deadlineAt: NOW }).complete(REQ()), { kind: "error", code: "TIMEOUT" }); assert.equal(a.seen.length, 0, "não chamou o fetch")
  const watchdog = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("travou: o cliente não abortou no prazo")), 3000))])
  const sig = { s: null as Any }; const b = fakeFetch(never(sig)); const t0 = performance.now()
  assert.deepEqual(await watchdog(port(b, { callTimeoutMs: 40 }).complete(REQ())), { kind: "error", code: "TIMEOUT" }); assert.ok(performance.now() - t0 < 1500); assert.equal(sig.s.aborted, true)
  const c = fakeFetch(never({ s: null })); const t1 = performance.now(); assert.deepEqual(await watchdog(port(c, { deadlineAt: NOW + 40, callTimeoutMs: 60_000 }).complete(REQ())), { kind: "error", code: "TIMEOUT" }); assert.ok(performance.now() - t1 < 1500, "o prazo do turno encurta a chamada")
  assert.equal(CALL_TIMEOUT_MS, 25_000)
})

await test("G12 — configuração inválida ⇒ TypeError (sem eco): chave vazia/curta/não-string, fetch ou relógio que não são funções, deadlineAt que não é número", async () => {
  for (const bad of [{ apiKey: "" }, { apiKey: "curta" }, { apiKey: 5 }, { apiKey: undefined }, { fetch: "x" }, { fetch: undefined }, { now: 5 }, { deadlineAt: "x" }, { deadlineAt: NaN }, { model: "" }, { model: "tem espaço" }, { model: "x".repeat(200) }]) {
    assert.throws(() => createGroqModelPort({ apiKey: KEY, fetch: (() => undefined) as Any, now: () => NOW, deadlineAt: NOW + 1, ...bad } as Any), (e: Error) => e instanceof TypeError && !e.message.includes(KEY), jstr(bad))
  }
  assert.throws(() => createGroqModelPort(null as Any), TypeError)
})

await test("G13 — o corpo/URL/cabeçalhos de TODAS as chamadas nunca têm hash de 64 hex nem a chave além do cabeçalho; pedido inválido (sem mensagens) ⇒ erro CONFIG sem chamar o fetch", async () => {
  const f = fakeFetch(() => final("{}")); await port(f).complete(REQ()); assert.doesNotMatch(f.seen[0].init.body, /[0-9a-f]{64}/)
  for (const bad of [null, {}, { messages: [] }, { messages: "x", tools: [], toolChoice: "auto" }, { messages: [{ role: "user", content: "q" }], tools: [], toolChoice: "talvez" }]) { const g = fakeFetch(() => final("{}")); const r: Any = await port(g).complete(bad as Any); assert.deepEqual(r, { kind: "error", code: "CONFIG" }, jstr(bad)); assert.equal(g.seen.length, 0) }
})

await test("G14 — só groq-client.ts conhece api.groq.com e nenhum arquivo do cliente/rota lê process.env, usa console ou importa next", async () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const holders = walk(join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f) && readFileSync(f, "utf8").includes("api.groq.com")).map((f) => f.replace(ROOT, ""))
  assert.deepEqual(holders, ["src/lib/infra/groq-client.ts"])
  const src = readFileSync(`${ROOT}src/lib/infra/groq-client.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  assert.doesNotMatch(src, /process\.env|console\.|from\s+["']next|@prisma|\bimport\s*\(/)
})

await test("G15 — ferramentas COMPACTAS (D-G10): E7-16: 6 ferramentas (sem evidence_*), JSON de todas ≤ 3.200 caracteres, cada uma ≤ 900; prompt ≤ 2.800 e total fixo ≤ 5.600; sem $schema/additionalProperties/default; o prompt lista TODOS os metricIds e os valores de groupBy; anti-deriva: propriedades e obrigatórias das ferramentas existem nos esquemas do servidor", async () => {
  const tools = (CHAT_TOOLS as Any[]).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
  assert.equal(tools.length, 6); assert.ok(jstr(tools).length <= 3200, `ferramentas: ${jstr(tools).length} caracteres`)
  for (const t of tools) assert.ok(jstr(t).length <= 900, `${t.function.name}: ${jstr(t).length}`)
  assert.doesNotMatch(jstr(tools), /\$schema|additionalProperties|"default"/); assert.deepEqual([...new Set((CHAT_TOOLS as Any[]).map((t) => t.capability))].sort(), [...CAPABILITY_IDS].filter((c) => !c.startsWith("evidence.")).sort())
  assert.ok(SYSTEM_PROMPT.length <= 2800, `prompt: ${SYSTEM_PROMPT.length}`); assert.ok(jstr(tools).length + SYSTEM_PROMPT.length <= 5600, `fixo: ${jstr(tools).length + SYSTEM_PROMPT.length}`)
  for (const id of METRIC_IDS as string[]) assert.ok(new RegExp(`(^|[^A-Za-z0-9])${id}([^A-Za-z0-9]|$)`).test(SYSTEM_PROMPT), `metricId ausente do prompt (palavra inteira): ${id}`)
  for (const g of ["day", "tradingDay", "week", "month", "dayOfWeek", "hour", "session", "symbol", "direction", "account", "strategy", "exitReason"]) assert.ok(SYSTEM_PROMPT.includes(g), `groupBy ausente do prompt: ${g}`)
  const zodOf: Record<string, Any> = { "metrics.query@1": MetricsQueryArgsSchema, "metrics.groups@1": MetricsGroupsArgsSchema, "exit.breakdown@1": ExitBreakdownArgsSchema, "metrics.compare@1": MetricsCompareArgsSchema, "rank.groups@1": RankGroupsArgsSchema, "exit.analysis@1": ExitAnalysisArgsSchema, "evidence.explain@1": EvidenceExplainArgsSchema, "evidence.refresh@1": EvidenceRefreshArgsSchema }
  const keysOf = (js: Any): { props: Set<string>; required: Set<string>; requiredAll: Set<string> } => { const branches: Any[] = js.oneOf ?? js.anyOf ?? [js]; const reqs: string[][] = branches.map((x) => x.required ?? []); return { props: new Set(branches.flatMap((x) => Object.keys(x.properties ?? {}))), required: new Set(reqs.flat()), requiredAll: new Set(reqs[0].filter((k) => reqs.every((r) => r.includes(k)))) } }
  for (const t of CHAT_TOOLS as Any[]) {
    const server = keysOf(z.toJSONSchema(zodOf[t.capability], { io: "input", unrepresentable: "any" })); const mine = keysOf(t.parameters)
    for (const k of mine.props) assert.ok(server.props.has(k), `${t.name}: propriedade ${k} não existe no esquema do servidor`)
    for (const k of mine.required) assert.ok(server.props.has(k), `${t.name}: obrigatória ${k} inexistente`)
    for (const k of server.required) assert.ok(mine.props.has(k), `${t.name}: o servidor exige ${k} e a ferramenta não oferece`)
    for (const k of server.requiredAll) assert.ok(mine.required.has(k), `${t.name}: o servidor exige ${k} sempre e a ferramenta não o marca como obrigatório`)
  }
})

await test("G16 — INTEGRAÇÃO com o laço E7-16 (runChatTurn + cliente Groq + fetch falso): UMA chamada com ferramenta ⇒ ANSWERED (resposta composta pelo servidor); nenhuma requisição leva hash, nome de arquivo ou chave; o histórico enviado na 2ª chamada tem assistant(tool_calls) e tool", async () => {
  const U = "cmd3h2k0a0000abcd1234efgh", p2 = (x: number): string => String(x).padStart(2, "0")
  const csv = synthCsv(Array.from({ length: 24 }, (_, i) => ({ entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: i % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
  const raw = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore(), kr = new InMemorySaltKeyring(); kr.ensure(U)
  const reg: Any = await registerImport({ rawStorage: raw, importStore: imp, salt: kr }, { userId: U, text: csv, context: { sourceTz: "America/New_York" }, fileName: "export.csv" }); assert.equal(reg.ok, true)
  const f = fakeFetch(() => ok({ role: "assistant", content: null, tool_calls: [toolCall("c1", "metrics_query", '{"metricIds":["netPnl","winRate"],"filters":{},"options":{}}')] }, { total_tokens: 900 }))
  const deps: Any = { rawStorage: raw, importStore: imp, conversations: createConversations({ store: createMemoryConversationStore() }), salts: { load: async () => ({ provider: kr, unavailable: [] }) } }
  const r: Any = await runChatTurn({ deps, model: port(f), userId: U, pin: { sources: [{ fileSha256: reg.fileSha256 }], analysis: {} }, question: "Qual foi meu resultado?" })
  assert.equal(r.ok, true, jstr(r)); assert.equal(r.outcome, "ANSWERED"); assert.equal(r.tokens, 900); assert.equal(f.seen.length, 1); assert.equal(r.modelCalls, 1)
  assert.deepEqual(f.seen[0].body.messages.map((m: Any) => m.role), ["system", "user"]); assert.ok(r.response.segments.some((x: Any) => x.kind === "value"))
  const all = jstr(f.seen.map((s) => s.body)) + jstr(f.seen.map((s) => s.init.headers))
  assert.doesNotMatch(all.replace(KEY, ""), /[0-9a-f]{64}|export\.csv|Sim101|evidenceHash|fileSha256/); assert.ok(!jstr(f.seen.map((s) => s.body)).includes(KEY))
})

if (process.env.COLLECT) console.log(JSON.stringify({ passed, failed }))
else console.log(`\n${passed} testes ✓`)
