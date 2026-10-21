// E6.6-4: guardas ESTÁTICOS da fronteira agent/ × agent-capabilities/ (Q7). Teste escrito ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_4.static_guards_Q7. LIMITAÇÃO: provam presença/ausência de TEXTO, não o fluxo de dados.
//   node scripts/test-agent-capabilities-static.mts
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] }) : [])
// import/export com `from`, import de EFEITO COLATERAL (`import "x"`), import() e require(): nenhuma forma escapa do guarda (achado por mutação: o `import "x"` nu escapava)
const importsOf = (code: string): string[] => [...code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4])
const cap = walk(join(ROOT, "src/lib/agent-capabilities")).filter((f) => /\.ts$/.test(f)).map((f) => ({ name: f.slice(f.lastIndexOf("/") + 1), code: strip(readFileSync(f, "utf8")) }))
const agent = walk(join(ROOT, "src/lib/agent")).filter((f) => /\.ts$/.test(f)).map((f) => ({ name: f.slice(f.lastIndexOf("/") + 1), code: strip(readFileSync(f, "utf8")) }))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

test("Q0 — sanidade: o diretório agent-capabilities/ existe com os 14 arquivos esperados e o varredor enxerga o agent/", () => {
  assert.deepEqual(cap.map((f) => f.name).sort(), ["alias-input.ts", "assess.ts", "envelope.ts", "evidence-explain.ts", "evidence-refresh.ts", "exit-analysis.ts", "exit-breakdown.ts", "group-key.ts", "metrics-compare.ts", "metrics-groups.ts", "metrics-query.ts", "project.ts", "rank-groups.ts", "salt.ts"])
  assert.ok(agent.length >= 12)
})

test("Q1 — agent/ NUNCA importa agent-capabilities/, evidence/, metrics/, ingest/ nem domain/ (só zod e ./)", () => {
  for (const f of agent) for (const p of importsOf(f.code)) { assert.ok(p === "zod" || p.startsWith("./"), `agent/${f.name}: import ${p}`); assert.equal(/agent-capabilities|evidence|metrics|ingest|domain/.test(p), false, `agent/${f.name}: ${p}`) }
})

test("Q2 — agent-capabilities/ só importa ../agent/, ../evidence/, ../metrics/, './' e zod: nada de ingest/, domain/, infra/, prisma, rede, ambiente, relógio, aleatório ou LLM", () => {
  for (const f of cap) {
    for (const p of importsOf(f.code)) assert.ok(p === "zod" || p.startsWith("./") || /^\.\.\/(?:agent|evidence|metrics)\//.test(p), `${f.name}: import fora do permitido: ${p}`)
    assert.equal(/\bimport\s*\(|\brequire\s*\(/.test(f.code), false, `${f.name}: import dinâmico`)
    assert.equal(/process\.env|\bfetch\s*\(|prisma|anthropic|openai|@ai-sdk|node:|localStorage|XMLHttpRequest|WebSocket/i.test(f.code), false, `${f.name}: dependência proibida`)
    assert.equal(/\bDate\b|Math\.random|performance\.|setTimeout|setInterval|globalThis/.test(f.code), false, `${f.name}: relógio/aleatório`)
    assert.equal(/\buserId\b/.test(f.code), false, `${f.name}: userId nunca é argumento (Q12)`)
    assert.equal(/^(?:let|var)\s/m.test(f.code), false, `${f.name}: estado mutável de módulo`)
  }
})

test("Q3 — NÃO LIGADO: ninguém fora de agent-capabilities/ e dos testes (scripts/) importa agent-capabilities/ — exceções NOMINAIS, por arquivo: infra/regenerate.ts (E7-5: roda a mesma capacidade que gerou o ref) infra/turn-session.ts (E7-6: executor do turno) e infra/chat-turn.ts (E7-15a: esquemas de argumentos das ferramentas do chat)", () => {
  const src = walk(join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f) && !f.includes("/src/lib/agent-capabilities/") && !f.endsWith("/src/lib/infra/regenerate.ts") && !f.endsWith("/src/lib/infra/turn-session.ts") && !f.endsWith("/src/lib/infra/chat-turn.ts"))
  // qualquer CAMINHO para o diretório (import estático, dinâmico, require, string): relativo ou com alias @/. A versão do contrato ("agent-capabilities/1") não é caminho.
  const offenders = src.filter((f) => /["'`](?:\.{1,2}\/|@\/)[^"'`\n]*agent-capabilities/.test(strip(readFileSync(f, "utf8"))))
  assert.deepEqual(offenders.map((f) => f.replace(ROOT, "")), [])
})

test("Q4 — projeção por lista branca: envelope.ts e project.ts NÃO usam spread (`...`), nem Object.assign, nem JSON.parse(JSON.stringify()): é cópia explícita campo a campo", () => {
  for (const f of cap.filter((x) => ["envelope.ts", "project.ts", "group-key.ts"].includes(x.name))) {
    assert.equal(/\.\.\./.test(f.code), false, `${f.name}: spread`)
    assert.equal(/Object\.assign|structuredClone|JSON\.parse\s*\(\s*JSON\.stringify|Object\.fromEntries\s*\(\s*Object\.entries/.test(f.code), false, `${f.name}: cópia genérica`)
  }
})

test("Q5 — nenhum literal de CombinedVerdict nem cast de Verdict/EvidenceHandle em agent-capabilities/ (o veredito só nasce de buildVerdict)", () => {
  for (const f of cap) {
    assert.equal(/["'`](?:VERIFIED_PARTIAL|VERIFIED|NOT_VERIFIED|TAMPERED_OR_MISMATCH)["'`]/.test(f.code), false, `${f.name}: literal de CombinedVerdict`)
    assert.equal(/\bas\s+(?:Verdict|EvidenceHandle)\b/.test(f.code), false, `${f.name}: cast de veredito`)
    // `combined` só é COPIADO do handle já validado (handleView); derivar/atribuir de outro lugar é proibido (só buildVerdict faz)
    const assigns = [...f.code.matchAll(/combined\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
    assert.deepEqual(assigns.filter((a) => a !== "h.verdict.combined"), [], `${f.name}: atribui combined de outra origem`)
  }
  const assess = cap.find((f) => f.name === "assess.ts")!.code
  assert.match(assess, /buildVerdict\(/)
  assert.equal(/combineVerdict/.test(assess), false)
})

test("Q6 — evidence-refresh.ts só REEXECUTA capacidades e usa o ledger: não importa gerador de Evidence (explain-*), verificador nem o motor de métricas (E6.6-12; por isso o guarda do sal não é acionado)", () => {
  const f = cap.find((x) => x.name === "evidence-refresh.ts")!
  const paths = importsOf(f.code)
  assert.deepEqual(paths.filter((p) => /evidence\/|metrics\//.test(p)), [], "nenhum import de ../evidence/ nem ../metrics/")
  assert.equal(/explain(?:Metric|Derived|Trade)\s*\(|accountRefSalt\s*[:=]/.test(f.code), false, "não gera Evidence nem fabrica sal")
  assert.ok(paths.includes("../agent/ledger.ts"))
})

console.log(`\n${passed} testes ok`)
