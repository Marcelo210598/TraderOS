// E7-15d: medição AO VIVO do chat na Groq. SÓ roda com GROQ_LIVE=1 e GROQ_API_KEY no .env.local (lida só aqui; nunca impressa). Fora do test:domain. Dataset sintético em memória; nada de produção.
// Expectativa: docs/ai-partner/E7-15d-expectativa.md. Orçamento: aborta em qualquer 429 ou acima de 30.000 tokens (E7-16: laço de 1 chamada); espera só se o TPM estiver baixo; sem retry.
//   GROQ_LIVE=1 node scripts/test-groq-live.mts
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { SYSTEM_PROMPT } from "../src/lib/agent/system-prompt.ts"
import { CHAT_TOOLS, runChatTurn } from "../src/lib/infra/chat-turn.ts"
import { createConversations, createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { registerImport } from "../src/lib/infra/dataset.ts"
import { GROQ_URL, createGroqModelPort } from "../src/lib/infra/groq-client.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
if (process.env.GROQ_LIVE !== "1") { console.log("… medição AO VIVO da Groq pulada: rode com GROQ_LIVE=1 (precisa de GROQ_API_KEY no .env.local)"); process.exit(0) }
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const keyOf = (): string => { const p = `${ROOT}.env.local`; if (!existsSync(p)) throw new Error("sem .env.local"); for (const l of readFileSync(p, "utf8").split("\n")) { const m = /^\s*GROQ_API_KEY\s*=\s*(.*)\s*$/.exec(l); if (m) return m[1].replace(/^["']|["']$/g, "") } throw new Error("GROQ_API_KEY ausente") }
const KEY = keyOf(), MODEL = "qwen/qwen3.8-27b", USD_BRL = 5.5
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const USD = (p: number, c: number): number => (p * 0.8 + c * 4) / 1e6
const budget = { tokens: 0, stop: false, why: "" }
interface Rec { resetTokens: string | null; status: number; prompt: number; completion: number; cached: number | null; ms: number; remTokens: string | null; remReq: string | null; limTokens: string | null; limReq: string | null }
const recs: Rec[] = []
/** fetch REAL com registro de uso/cabeçalhos (nunca de autorização) e disjuntor de orçamento. */
const liveFetch = async (url: string, init: Any): Promise<Any> => {
  if (budget.stop) throw new Error("orçamento/429: parado")
  const t0 = performance.now(); const res = await fetch(url, init); const text = await res.text(); let u: Any = {}
  try { u = JSON.parse(text).usage ?? {} } catch { /* corpo não JSON */ }
  const r: Rec = { resetTokens: res.headers.get("x-ratelimit-reset-tokens"), status: res.status, prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? null, ms: Math.round(performance.now() - t0), remTokens: res.headers.get("x-ratelimit-remaining-tokens"), remReq: res.headers.get("x-ratelimit-remaining-requests"), limTokens: res.headers.get("x-ratelimit-limit-tokens"), limReq: res.headers.get("x-ratelimit-limit-requests") }
  recs.push(r); budget.tokens += r.prompt + r.completion
  if (res.status === 429) { budget.stop = true; budget.why = "429" }
  if (budget.tokens > 30_000) { budget.stop = true; budget.why = "orçamento de 30.000 tokens" }
  return { status: res.status, headers: res.headers, text: async () => text }
}
const tools = (CHAT_TOOLS as Any[]).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
const wire = (t: Any[]): Any[] => t.map((x) => ({ type: "function", function: x }))
const raw = async (body: Any): Promise<{ status: number; ms: number; prompt: number; completion: number; cached: number | null; hdr: Record<string, string | null>; msg: string }> => {
  const t0 = performance.now(); const res = await fetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) }); const text = await res.text()
  let j: Any = {}; try { j = JSON.parse(text) } catch { /* */ }
  budget.tokens += (j.usage?.prompt_tokens ?? 0) + (j.usage?.completion_tokens ?? 0)
  return { status: res.status, ms: Math.round(performance.now() - t0), prompt: j.usage?.prompt_tokens ?? 0, completion: j.usage?.completion_tokens ?? 0, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? null,
    hdr: { limReq: res.headers.get("x-ratelimit-limit-requests"), limTok: res.headers.get("x-ratelimit-limit-tokens"), remReq: res.headers.get("x-ratelimit-remaining-requests"), remTok: res.headers.get("x-ratelimit-remaining-tokens") }, msg: res.status === 200 ? "" : String(j.error?.type ?? j.error?.code ?? "erro").slice(0, 60) }
}
const base = { model: MODEL, reasoning_effort: "none", reasoning_format: "hidden", max_tokens: 60, temperature: 0.2 }
const msgs = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: 'Responda só com o objeto JSON {"segments":[{"kind":"text","text":"ok"}],"claims":[]}' }]

const SKIP_PROBES = process.env.GROQ_SKIP_PROBES === "1"
if (!SKIP_PROBES) {
console.log("═══ SONDAS CRUAS ═══")
const p1 = await raw({ ...base, messages: msgs, tools: wire(tools), tool_choice: "none" })
console.log(`P1 corpo do cliente (tools compactas, tool_choice none): HTTP ${p1.status} ${p1.msg} | entrada ${p1.prompt} saída ${p1.completion} | ${p1.ms} ms`)
console.log(`P2 limites vivos: req/dia ${p1.hdr.limReq} | tokens/min ${p1.hdr.limTok} | restam req ${p1.hdr.remReq} tokens ${p1.hdr.remTok}`)
const p2 = await raw({ ...base, messages: msgs, tools: wire(tools), tool_choice: "none" })
console.log(`P3 CACHE (mesmo prefixo, 2ª vez): HTTP ${p2.status} | entrada ${p2.prompt} | cached_tokens = ${p2.cached} | ${p2.ms} ms`)
const p4 = await raw({ ...base, messages: [...msgs, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "metrics_query", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: '{"ok":false}' }] })
console.log(`P4 SEM tools no pedido, com histórico de ferramenta: HTTP ${p4.status} ${p4.msg} | entrada ${p4.prompt}`)
if (p1.status !== 200) { console.log("⚠ o corpo do cliente foi recusado; parando antes dos turnos"); process.exit(0) }
}

console.log("\n═══ 6 TURNOS REAIS ═══")
const p2d = (n: number): string => String(n).padStart(2, "0")
const csv = synthCsv(Array.from({ length: 60 }, (_, i) => ({ entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2), entryAt: `${p2d(1 + (i % 28))}/03/2026 ${p2d(9 + (i % 7))}:00:00`, exitAt: `${p2d(1 + (i % 28))}/03/2026 ${p2d(9 + (i % 7))}:30:00`, account: i % 3 === 0 ? "Sim101" : "Sim102" })) as Any)
const U = "cmd3h2k0a0000abcd1234efgh"; const raw0 = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore(), kr = new InMemorySaltKeyring(); kr.ensure(U)
const reg: Any = await registerImport({ rawStorage: raw0, importStore: imp, salt: kr }, { userId: U, text: csv, context: { sourceTz: "America/New_York" }, fileName: "export.csv" })
const deps: Any = { rawStorage: raw0, importStore: imp, conversations: createConversations({ store: createMemoryConversationStore() }), salts: { load: async () => ({ provider: kr, unavailable: [] }) } }
const questions = ["Qual foi meu resultado líquido e minha taxa de acerto?", "Qual das minhas contas teve o melhor resultado líquido?", "Como foram minhas saídas: alvo, stop ou manual?", "Compre agora 5 contratos?", "Compare a primeira quinzena de março com a segunda quinzena nos resultados líquidos.", "Quantos trades eu fiz em cada hora do dia?"]
interface Row { q: string; outcome: string; calls: number; tokens: number; ms: number; used: string; rej: string; costBrl: number; answerChars: number }
const rows: Row[] = []
for (const [i, q] of questions.entries()) {
  if (budget.stop) { console.log(`⚠ parado antes do turno ${i + 1}: ${budget.why}`); break }
  { const prev = recs[recs.length - 1]; if (prev !== undefined && Number(prev.remTokens) < 4000) { const w = Math.min(65, ((): number => { const m = /^(?:(\d+)m)?(?:([\d.]+)s)?$/.exec((prev.resetTokens ?? "").trim()); return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 30 })() + 2); console.log(`   … ritmo entre turnos: restam ${prev.remTokens} tokens/min; espera ${w.toFixed(0)} s`); await sleep(w * 1000) } } // E7-16: 1 chamada ≈ 2K tokens; só espera se o TPM de 8K/min (da organização) estiver baixo
  const before = recs.length; const used = new Set<string>(); const rejects: string[] = []
  const model = createGroqModelPort({ apiKey: KEY, model: MODEL, fetch: liveFetch as Any, now: () => Date.now(), deadlineAt: Date.now() + 120_000 })
  const seconds = (h: string | null): number => { if (h === null) return 0; const m = /^(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(h.trim()); return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0 }
  const spy = { complete: async (req: Any): Promise<Any> => {
    const prev = recs[recs.length - 1]; if (prev !== undefined && Number(prev.remTokens) < 5600) { const w = Math.min(65, seconds(prev.resetTokens) + 2); console.log(`   … ritmo: restam ${prev.remTokens} tokens/min; espera ${w.toFixed(0)} s`); await sleep(w * 1000) } const last = [...req.messages].reverse().find((m: Any) => m.role === "user"); const m = /Códigos: ([A-Z_, ]+)\./.exec(String(last?.content ?? "")); if (m && i >= 0 && last !== req.messages[1]) rejects.push(m[1]); const n0 = recs.length; const r = await model.complete(req); if (r.kind === "tool_calls") for (const c of r.calls) used.add(String(c.name))
    const lastRec = recs[recs.length - 1]; console.log(`   chamada ${n0 + 1 - before}: ${r.kind}${r.kind === "tool_calls" ? " " + r.calls.map((c: Any) => c.name).join("+") : ""}${r.kind === "error" ? " " + r.code : ""} | HTTP ${lastRec?.status} | entrada ${lastRec?.prompt} saída ${lastRec?.completion} | ${lastRec?.ms} ms`); return r } }
  const t0 = performance.now(); const out: Any = await runChatTurn({ deps, model: spy as Any, userId: U, pin: { sources: [{ fileSha256: reg.fileSha256 }], analysis: {} }, question: q })
  const mine = recs.slice(before); const pr = mine.reduce((a, r) => a + r.prompt, 0), co = mine.reduce((a, r) => a + r.completion, 0)
  const answer = out.ok ? (out.response.segments as Any[]).map((s) => s.text ?? "").join(" ") : ""
  rows.push({ q, outcome: out.ok ? out.outcome : `ERRO ${out.code}`, calls: mine.length, tokens: pr + co, ms: Math.round(performance.now() - t0), used: [...used].join("+") || "-", rej: [...new Set(rejects)].join("|") || "-", costBrl: USD(pr, co) * USD_BRL, answerChars: answer.length })
  const r = rows[rows.length - 1]; console.log(`T${i + 1} ${r.outcome.padEnd(9)} chamadas ${r.calls} | tokens ${r.tokens} (entrada ${pr}, saída ${co}) | ${r.ms} ms | ferramentas ${r.used} | rejeições ${r.rej} | ≈R$ ${r.costBrl.toFixed(3)}`)
  if (answer) console.log(`   resposta: ${answer.slice(0, 700).replace(/\s+/g, " ")}${answer.length > 700 ? "…" : ""}`)
}
const tot = rows.reduce((a, r) => a + r.tokens, 0), cost = rows.reduce((a, r) => a + r.costBrl, 0)
console.log("\n═══ RESUMO ═══")
console.log(`turnos: ${rows.length} | respondidos: ${rows.filter((r) => r.outcome === "ANSWERED").length} | parados: ${rows.filter((r) => r.outcome === "STOPPED").length} | erros: ${rows.filter((r) => r.outcome.startsWith("ERRO")).length}`)
console.log(`tokens nos turnos: ${tot} (média ${rows.length ? Math.round(tot / rows.length) : 0}/turno) | custo estimado nos turnos: R$ ${cost.toFixed(2)} (média R$ ${rows.length ? (cost / rows.length).toFixed(3) : "0"}/turno)`)
console.log(`tokens totais da sessão (sondas + turnos): ${budget.tokens} | cache visto nos turnos: ${recs.some((r) => (r.cached ?? 0) > 0) ? "SIM" : "não"} | últimos limites vivos: tokens restantes/min ${recs[recs.length - 1]?.remTokens ?? "?"}`)
if (budget.stop) console.log(`⚠ sessão interrompida por: ${budget.why}`)
