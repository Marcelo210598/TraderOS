// E7-19: medição AO VIVO da memória curta (Groq). SÓ roda com GROQ_LIVE=1 e GROQ_API_KEY no .env.local (lida só aqui; nunca impressa). Fora do test:domain. Dataset sintético em memória; nada de produção.
// Orçamento: aborta em qualquer 429 ou acima de 20.000 tokens; sem retry. Expectativa: docs/ai-partner/E7-19-expectativa.md §4.
//   GROQ_LIVE=1 node scripts/test-groq-memory-live.mts
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { InMemorySaltKeyring } from "../src/lib/ingest/salt.ts"
import { runChatTurn } from "../src/lib/infra/chat-turn.ts"
import { createConversations, createMemoryConversationStore } from "../src/lib/infra/conversation-store.ts"
import { registerImport } from "../src/lib/infra/dataset.ts"
import { createGroqModelPort } from "../src/lib/infra/groq-client.ts"
import { createMemoryImportSourceStore } from "../src/lib/infra/import-source-store.ts"
import { createMemoryRawFileStorage } from "../src/lib/infra/raw-file-storage.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
if (process.env.GROQ_LIVE !== "1") { console.log("… medição AO VIVO pulada: rode com GROQ_LIVE=1"); process.exit(0) }
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const keyOf = (): string => { const p = `${ROOT}.env.local`; if (!existsSync(p)) throw new Error("sem .env.local"); for (const l of readFileSync(p, "utf8").split("\n")) { const m = /^\s*GROQ_API_KEY\s*=\s*(.*)\s*$/.exec(l); if (m) return m[1].replace(/^["']|["']$/g, "") } throw new Error("GROQ_API_KEY ausente") }
const KEY = keyOf(), MODEL = "qwen/qwen3.8-27b"
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const budget = { tokens: 0, stop: false, why: "" }
interface Rec { status: number; prompt: number; completion: number; remTokens: string | null; resetTokens: string | null }
const recs: Rec[] = []
const liveFetch = async (url: string, init: Any): Promise<Any> => {
  if (budget.stop) throw new Error("orçamento/429: parado")
  const res = await fetch(url, init); const text = await res.text(); let u: Any = {}
  try { u = JSON.parse(text).usage ?? {} } catch { /* corpo não JSON */ }
  recs.push({ status: res.status, prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, remTokens: res.headers.get("x-ratelimit-remaining-tokens"), resetTokens: res.headers.get("x-ratelimit-reset-tokens") })
  budget.tokens += (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)
  if (res.status === 429) { budget.stop = true; budget.why = "429" }
  if (budget.tokens > 20_000) { budget.stop = true; budget.why = "orçamento de 20.000 tokens" }
  return { status: res.status, headers: res.headers, text: async () => text }
}
const seconds = (h: string | null): number => { if (h === null) return 0; const m = /^(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(h.trim()); return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0 }
const p2 = (n: number): string => String(n).padStart(2, "0")
const csv = synthCsv(Array.from({ length: 60 }, (_, i) => ({ entryPrice: 2000 + (i % 13), exitPrice: 2000 + (i % 13) + ((i % 5) - 2), entryAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:00:00`, exitAt: `${p2(1 + (i % 28))}/03/2026 ${p2(9 + (i % 7))}:30:00`, account: i % 3 === 0 ? "Sim101" : "Sim102" })))
const U = "cmd3h2k0a0000abcd1234efgh"; const raw0 = createMemoryRawFileStorage(), imp = createMemoryImportSourceStore(), kr = new InMemorySaltKeyring(); kr.ensure(U)
const reg: Any = await registerImport({ rawStorage: raw0, importStore: imp, salt: kr }, { userId: U, text: csv, context: { sourceTz: "America/New_York" }, fileName: "export.csv" })
const deps: Any = { rawStorage: raw0, importStore: imp, conversations: createConversations({ store: createMemoryConversationStore() }), salts: { load: async () => ({ provider: kr, unavailable: [] }) } }

interface Row { label: string; outcome: string; tokens: number; entrada: number; ms: number; tools: string; sysChars: number; memory: string | null; answer: string }
const rows: Row[] = []
async function turn(label: string, question: string, conversationId: string | null): Promise<{ id: string | null }> {
  if (budget.stop) { console.log(`⚠ parado antes de "${label}": ${budget.why}`); return { id: conversationId } }
  const prev = recs[recs.length - 1]; if (prev !== undefined && Number(prev.remTokens) < 4500) { const w = Math.min(65, seconds(prev.resetTokens) + 2); console.log(`   … ritmo: restam ${prev.remTokens} tokens/min; espera ${w.toFixed(0)} s`); await sleep(w * 1000) }
  const before = recs.length; let sys = ""; const tools: string[] = []
  const port = createGroqModelPort({ apiKey: KEY, model: MODEL, fetch: liveFetch as Any, now: () => Date.now(), deadlineAt: Date.now() + 120_000 })
  const spy = { complete: async (req: Any): Promise<Any> => { sys = req.messages[0].content; const r = await (port as Any).complete(req); if (r.kind === "tool_calls") for (const c of r.calls) tools.push(`${c.name} ${JSON.stringify(c.arguments)}`); return r } }
  const t0 = performance.now()
  const out: Any = await runChatTurn({ deps, model: spy as Any, userId: U, pin: { sources: [{ fileSha256: reg.fileSha256 }], analysis: {} }, question, conversationId })
  const mine = recs.slice(before); const pr = mine.reduce((a, r) => a + r.prompt, 0), co = mine.reduce((a, r) => a + r.completion, 0)
  const i = sys.indexOf("Perguntas anteriores desta conversa")
  const answer = out.ok ? (out.response.segments as Any[]).map((s) => s.text ?? "").join(" ").replace(/\s+/g, " ") : ""
  rows.push({ label, outcome: out.ok ? out.outcome : `ERRO ${out.code}`, tokens: pr + co, entrada: pr, ms: Math.round(performance.now() - t0), tools: tools.join(" | ") || "-", sysChars: sys.length, memory: i >= 0 ? sys.slice(i) : null, answer })
  const r = rows[rows.length - 1]
  console.log(`\n${label}: "${question}"\n   ${r.outcome} | tokens ${r.tokens} (entrada ${pr}, saída ${co}) | ${r.ms} ms | system ${r.sysChars} caracteres\n   ferramentas: ${r.tools}\n   memória no prompt: ${r.memory === null ? "nenhuma" : r.memory.replace(/\n/g, " ⏎ ")}\n   resposta: ${answer.slice(0, 420)}${answer.length > 420 ? "…" : ""}`)
  return { id: out.ok ? out.conversationId : conversationId }
}

console.log("═══ MEMÓRIA CURTA AO VIVO (4 turnos encadeados + 1 controle) ═══")
let cid: string | null = null
cid = (await turn("T1", "Qual foi meu resultado por conta?", cid)).id
cid = (await turn("T2", "E a taxa de acerto de cada uma?", cid)).id
cid = (await turn("T3", "E por hora do dia?", cid)).id
cid = (await turn("T4", "Qual o drawdown máximo?", cid)).id
await turn("CONTROLE (T2 sem memória, conversa nova)", "E a taxa de acerto de cada uma?", null)

const tot = rows.reduce((a, r) => a + r.tokens, 0)
console.log("\n═══ RESUMO ═══")
console.log(`turnos: ${rows.length} | tokens: ${tot} (média ${rows.length ? Math.round(tot / rows.length) : 0}/turno) | tokens totais da sessão: ${budget.tokens} | últimos limites vivos: restam ${recs[recs.length - 1]?.remTokens ?? "?"}/min`)
for (const r of rows) console.log(`${r.label.slice(0, 12).padEnd(12)} ${r.outcome.padEnd(9)} tokens ${String(r.tokens).padStart(5)} | memória ${r.memory === null ? "não" : `sim (${r.memory.length} caracteres)`} | ${r.tools.slice(0, 150)}`)
if (budget.stop) console.log(`⚠ sessão interrompida por: ${budget.why}`)
