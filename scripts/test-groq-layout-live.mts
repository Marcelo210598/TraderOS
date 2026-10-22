// E7-20: medição AO VIVO do layout (cartões/tabelas) na Groq. SÓ roda com GROQ_LIVE=1 e GROQ_API_KEY no .env.local (lida só aqui; nunca impressa). Fora do test:domain. Dataset sintético em memória; nada de produção.
// Orçamento: aborta em qualquer 429 ou acima de 20.000 tokens; sem retry. Expectativa: docs/ai-partner/E7-20-expectativa.md §3.
//   GROQ_LIVE=1 node scripts/test-groq-layout-live.mts
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

interface Row { label: string; outcome: string; tokens: number; ms: number; tools: string; layout: string; mismatches: number }
const rows: Row[] = []
async function turn(label: string, question: string): Promise<void> {
  if (budget.stop) { console.log(`⚠ parado antes de "${label}": ${budget.why}`); return }
  const prev = recs[recs.length - 1]; if (prev !== undefined && Number(prev.remTokens) < 4500) { const w = Math.min(65, seconds(prev.resetTokens) + 2); console.log(`   … ritmo: restam ${prev.remTokens} tokens/min; espera ${w.toFixed(0)} s`); await sleep(w * 1000) }
  const before = recs.length; const tools: string[] = []
  const port = createGroqModelPort({ apiKey: KEY, model: MODEL, fetch: liveFetch as Any, now: () => Date.now(), deadlineAt: Date.now() + 120_000 })
  const spy = { complete: async (req: Any): Promise<Any> => { const r = await (port as Any).complete(req); if (r.kind === "tool_calls") for (const c of r.calls) tools.push(`${c.name} ${JSON.stringify(c.arguments)}`); return r } }
  const t0 = performance.now()
  const out: Any = await runChatTurn({ deps, model: spy as Any, userId: U, pin: { sources: [{ fileSha256: reg.fileSha256 }], analysis: {} }, question })
  const mine = recs.slice(before); const pr = mine.reduce((a, r) => a + r.prompt, 0), co = mine.reduce((a, r) => a + r.completion, 0)
  // cada célula do layout TEM de existir como valor do texto corrido (mesmo texto e veredito)
  const values: Any[] = out.ok ? (out.response.segments as Any[]).filter((s) => s.kind === "value") : []
  const cells: Any[] = []
  for (const b of (out.layout?.blocks ?? []) as Any[]) { if (b.kind === "stats") b.items.forEach((i: Any) => cells.push(i.cell)); if (b.kind === "table") b.rows.forEach((r: Any) => r.cells.forEach((c: Any) => cells.push(c))); if (b.kind === "line") b.parts.forEach((p: Any) => p.cell && cells.push(p.cell)) }
  const mism = cells.filter((c) => !values.some((v) => v.combined === c.combined && (c.note === null ? v.text === c.text : v.text.startsWith("indisponível")))).length
  const kinds = out.layout ? (out.layout.blocks as Any[]).map((b) => b.kind === "table" ? `table(${b.rows.length}x${b.columns.length})` : b.kind === "stats" ? `stats(${b.items.length})` : b.kind).join(" · ") : "null"
  rows.push({ label, outcome: out.ok ? out.outcome : `ERRO ${out.code}`, tokens: pr + co, ms: Math.round(performance.now() - t0), tools: tools.join(" | ") || "-", layout: kinds, mismatches: mism })
  const r = rows[rows.length - 1]
  console.log(`\n${label}: "${question}"\n   ${r.outcome} | tokens ${r.tokens} | ${r.ms} ms | ferramentas: ${r.tools}\n   layout: ${r.layout} | células ${cells.length} | sem correspondente no texto corrido: ${r.mismatches}`)
  if (out.layout) for (const b of out.layout.blocks as Any[]) { if (b.kind === "table") console.log(`   [tabela ${b.caption ?? ""}] colunas: ${b.columns.map((c: Any) => c.label).join(" | ")}\n     ${b.rows.slice(0, 3).map((r: Any) => `${r.label}${r.tag ? ` (${r.tag})` : ""}: ${r.cells.map((c: Any) => c.text).join(" | ")}`).join("\n     ")}`); if (b.kind === "stats") console.log(`   [cartões] ${b.items.map((i: Any) => `${i.label}=${i.cell.text}`).join(" | ")}`); if (b.kind === "note") console.log(`   [nota] ${b.text}`) }
}
console.log("═══ LAYOUT AO VIVO ═══")
await turn("T1", "Qual foi meu resultado e minha taxa de acerto?")
await turn("T2", "Qual foi meu resultado por conta?")
await turn("T3", "Como estão minhas saídas por motivo?")
const tot = rows.reduce((a, r) => a + r.tokens, 0)
console.log("\n═══ RESUMO ═══")
console.log(`turnos: ${rows.length} | tokens: ${tot} (média ${rows.length ? Math.round(tot / rows.length) : 0}/turno) | sessão: ${budget.tokens}`)
for (const r of rows) console.log(`${r.label} ${r.outcome.padEnd(9)} tokens ${String(r.tokens).padStart(5)} | layout ${r.layout} | células sem correspondente: ${r.mismatches}`)
if (budget.stop) console.log(`⚠ sessão interrompida por: ${budget.why}`)
