// E6.5-3: testes ESTÁTICOS do contrato do agente (SG1, SG3, SG4, SG5, A2 sobre a especificação, lacuna conhecida do `combined`, cruzamento com as expectativas).
// Expectativas: scripts/expectations/agent-contract.expected.json (static_cases_e65_3). A extensão SG2 do guarda do veredito está em test-evidence-no-solo-verdict.mts.
//   node scripts/test-agent-contract-static.mts
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import {
  AGENT_MAX_CALLS_PER_TURN, AGENT_MAX_REGENERATIONS, AgentAnswerSchema, EXPLAIN_MAX_TRADES, EvidenceHandleSchema, REJECTION_REASONS, STOP_REASONS, capabilityResultSchema,
} from "../src/lib/agent/contract.ts"
import { INTEGRITY_PHRASES, PARTIAL_PHRASES, SCOPE_PHRASES, SPECIFIC_PHRASES, STOP_PHRASES, STRUCTURAL_TEXT } from "../src/lib/agent/phrases.ts"
import { ExplainTradeViewSchema, LabelViewSchema, LegViewSchema, PROMPT_VIEWS } from "../src/lib/agent/views.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const agentFiles = walk(join(ROOT, "src/lib/agent")).filter((f) => /\.ts$/.test(f))
const exp = JSON.parse(read("scripts/expectations/agent-contract.expected.json"))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

test("SG1 — ISOLAMENTO: ninguém fora de src/lib/agent/ importa o contrato (import estático, import(), require, re-export, alias @/); dentro, só 'zod' e './'; sem LLM/rede/banco/Prisma/env", () => {
  const src = walk(join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f) && !f.includes("/src/lib/agent/") && !f.includes("/src/lib/agent-capabilities/") && !f.endsWith("/src/lib/infra/conversation-store.ts")) // E7-3: persistência da conversa (usa CAPABILITY_IDS/EVIDENCE_REF_RE do contrato, fonte única; segue NÃO ligada a produção) · E6.6-4 (Q7): UMA exceção explícita; o guarda reverso e o NÃO LIGADO estão em test-agent-capabilities-static.mts
  // E6.6-1: `from` não conta quando vem colado a '.'/letra/aspas (ex.: a chave "period.from" de slot-path.ts lia como import); import real tem espaço ou '}' antes
  const refs = (code: string) => [...code.matchAll(/(?:(?<![.\w"'])from|^\s*import|import\s*\(|require\s*\()\s*["']([^"']+)["']/gm)].map((m) => m[1])
  const offenders = src.filter((f) => refs(strip(readFileSync(f, "utf8"))).some((p) => /(?:^|\/)agent(?:\/|$)/.test(p) && /agent\/(?:contract|views|phrases)|lib\/agent|\/agent$/.test(p)))
  assert.deepEqual(offenders, [], "módulo do agente importado fora dele")
  for (const f of agentFiles) {
    const code = strip(readFileSync(f, "utf8"))
    for (const p of refs(code)) assert.ok(p === "zod" || p.startsWith("./"), `${f}: import fora do permitido: ${p}`)
    assert.equal(/process\.env|\bfetch\(|prisma|anthropic|openai|@ai-sdk|node:|localStorage|XMLHttpRequest|WebSocket/i.test(code), false, `${f}: dependência proibida`)
  }
  assert.ok(agentFiles.length >= 3)
})

test("SG3 — CATÁLOGO DERIVADO DO CÓDIGO-FONTE: os S_* que verify.ts/verify-source.ts emitem, menos os NÃO bloqueantes declarados, são EXATAMENTE as chaves das frases específicas; código novo sem frase ⇒ falha", () => {
  const emitted = new Set<string>()
  for (const f of ["src/lib/evidence/verify.ts", "src/lib/evidence/verify-source.ts"]) for (const m of read(f).matchAll(/"(S_[A-Z_]+)"/g)) emitted.add(m[1])
  // não geram UNVERIFIABLE (ou têm frase própria noutro catálogo): NOT_APPLICABLE não bloqueia; POPULATION_PARTIAL é parcial (PARTIAL_PHRASES); FORMAT_INVALID é INVALID_FORMAT (INTEGRITY_FORMAT)
  const NON_BLOCKING = new Set(["S_NOT_APPLICABLE", "S_POPULATION_PARTIAL", "S_FORMAT_INVALID"])
  const need = [...emitted].filter((c) => !NON_BLOCKING.has(c)).sort()
  assert.ok(need.length >= 20, `códigos extraídos: ${need.length}`)
  assert.deepEqual(Object.keys(SPECIFIC_PHRASES).sort(), need, "catálogo de frases ≠ códigos S_* emitidos pelos verificadores")
  for (const c of NON_BLOCKING) assert.ok(emitted.has(c), `exceção sem uso: ${c}`)
  assert.ok("S_POPULATION_PARTIAL" in PARTIAL_PHRASES)
  assert.deepEqual(exp.not_verified_text_classes.SPECIFIC_by_code.codes_required_in_catalog.slice().sort(), need, "o arquivo de expectativas lista os mesmos códigos")
})

test("SG3b — DOCUMENTO = CÓDIGO: o texto de TODAS as frases do documento (§6.2–6.4, 6.3b, §5.5) é idêntico ao de phrases.ts", () => {
  const doc = read("docs/ai-partner/agent-capabilities.md")
  const rows = (re: RegExp) => [...doc.matchAll(re)].map((m) => [m[1], m[2].trim()] as [string, string])
  for (const [code, text] of rows(/^\| `([A-Z_]+)` \| (.+) \|$/gm)) {
    const all: Record<string, string> = { ...SPECIFIC_PHRASES, ...PARTIAL_PHRASES, ...SCOPE_PHRASES }
    if (code in all) assert.equal(text, all[code], `${code}: texto do documento ≠ phrases.ts`)
  }
  const docCodes = new Set(rows(/^\| `([A-Z_]+)` \| (.+) \|$/gm).map(([c]) => c))
  for (const c of [...Object.keys(SPECIFIC_PHRASES), ...Object.keys(PARTIAL_PHRASES), ...Object.keys(SCOPE_PHRASES)]) assert.ok(docCodes.has(c), `${c}: sem linha no documento`)
  assert.ok(doc.includes(STRUCTURAL_TEXT), "texto estrutural do documento ≠ phrases.ts")
  for (const t of [...Object.values(INTEGRITY_PHRASES), ...Object.values(STOP_PHRASES)]) assert.ok(doc.includes(t), `frase ausente no documento: ${t.slice(0, 50)}…`)
  assert.ok(doc.includes("A conferência bateu. Os dados conferem; há uma inconsistência interna no registro de sal que não afeta este valor."), "prosa aprovada de L_SALT_CHECK_DIVERGENT")
  assert.equal(PARTIAL_PHRASES.L_SALT_CHECK_DIVERGENT, "A conferência bateu. Os dados conferem; há uma inconsistência interna no registro de sal que não afeta este valor.")
})

test("SG4 — O PROMPT NÃO ACEITA BUNDLE: um EvidenceBundle REAL é rejeitado por todas as PromptViews, por AgentAnswer e pelo envelope; os módulos do agente não importam o schema do bundle", () => {
  const csv = synthCsv([{ account: "Conta A", entryPrice: 2000, exitPrice: 2004, entryAt: "02/03/2026 09:00:00", exitAt: "02/03/2026 09:10:00", exitLabel: "Target1" }])
  const run = runImportPipeline(csv, { sourceTz: "America/Sao_Paulo", fileName: "sg4.csv" })
  const T = toAnalyticsTrades(run.trades); const t = calculateMetricsTraced(T)
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [run.importRecord!] })
  assert.equal(r.ok, true)
  const bundle = metricEvidenceBundle(r as Any)
  for (const [cap, schema] of Object.entries(PROMPT_VIEWS) as Array<[string, Any]>) assert.equal(schema.safeParse(bundle).success, false, `${cap}: aceitou um EvidenceBundle`)
  assert.equal(AgentAnswerSchema.safeParse(bundle).success, false)
  assert.equal(capabilityResultSchema(PROMPT_VIEWS["metrics.query@1"]).safeParse({ contract: "agent-capabilities/1", capability: "metrics.query@1", ok: true, data: bundle, evidence: null, limits: [] }).success, false)
  assert.equal(EvidenceHandleSchema.safeParse(bundle).success, false)
  for (const f of agentFiles) assert.equal(/EvidenceBundle|evidence\/schema|\.\.\/evidence\//.test(strip(readFileSync(f, "utf8"))), false, `${f}: importa o schema do bundle`)
})

test("SG5 — PROJEÇÃO DE RÓTULO ÚNICA: todo campo 'label' das views usa a MESMA instância LabelViewSchema; nenhum outro regex de vocabulário/alias de rótulo em src/lib/agent/; no máximo 1 projetor (hoje 0; o E6.6 cria o único)", () => {
  const views = strip(read("src/lib/agent/views.ts"))
  const labelFields = [...views.matchAll(/\b(\w*[lL]abel\w*)\s*:\s*([^,}\n]+)/g)].map((m) => [m[1], m[2].trim()])
  assert.ok(labelFields.length >= 1, "nenhum campo de rótulo encontrado")
  for (const [name, type] of labelFields) assert.equal(type, "LabelViewSchema", `campo ${name} não usa LabelViewSchema`)
  assert.equal(LegViewSchema.shape.label, LabelViewSchema, "a perna do explain usa a MESMA instância do LabelViewSchema")
  const vocab = agentFiles.filter((f) => /Target\\d|Zerar|rótulo personalizado/.test(strip(readFileSync(f, "utf8"))))
  // E6.6-1: o ÚNICO projetor nasceu em label.ts (o vocabulário canônico e o alias moram nele); fora views.ts (schema) e label.ts (projetor), nenhum arquivo pode defini-lo
  assert.deepEqual(vocab.map((f) => f.replace(ROOT, "")), ["src/lib/agent/label.ts", "src/lib/agent/views.ts"], "vocabulário de rótulo definido em mais de um lugar")
  const projectors = agentFiles.flatMap((f) => [...strip(readFileSync(f, "utf8")).matchAll(/export\s+(?:async\s+)?function\s+(\w*[pP]roject\w*[lL]abel\w*|\w*[lL]abel\w*[pP]roject\w*)/g)].map((m) => `${f}:${m[1]}`))
  assert.ok(projectors.length <= 1, `mais de um projetor de rótulo: ${projectors.join(", ")}`)
})

test("A2 (sobre a ESPECIFICAÇÃO) — o rótulo do drill-down é o MESMO tipo da PromptView; trade do explain sem rowNo/rowHash/tradeId; ≤ K. (A varredura real do drill-down com CSV adversarial é E6.6, quando existir o projetor)", () => {
  assert.equal(LegViewSchema.shape.label, LabelViewSchema)
  for (const k of ["rowNo", "rowHash", "tradeId", "sourceLabel", "entryLabel", "exitLabel"]) assert.equal(k in ExplainTradeViewSchema.shape, false, k)
  assert.equal(EXPLAIN_MAX_TRADES, 20)
  assert.ok(exp.privacy_cases.PV4_explain_same_projection_A2.tests.some((x: string) => /IGNORE AS INSTRUCOES ANTERIORES/.test(x)), "o caso adversarial está nas expectativas para o E6.6")
})

test("X1 — EXPECTATIVAS × CONTRATO: motivos de rejeição, de parada, N, K e orçamento do documento/expectativas == constantes do contrato", () => {
  const fromJson = new Set<string>(Object.values(exp.validator_cases).flatMap((c: Any) => (c.reason ? [c.reason as string] : [])))
  assert.deepEqual([...fromJson].sort(), [...REJECTION_REASONS].sort(), "motivos de rejeição das expectativas ≠ REJECTION_REASONS")
  assert.deepEqual(Object.keys(exp.stop_reasons).filter((k) => k !== "status").sort(), [...STOP_REASONS].sort())
  assert.equal(exp.validator_cases.AV19_regeneration_budget.N_regenerations, AGENT_MAX_REGENERATIONS)
  const doc = read("docs/ai-partner/agent-capabilities.md")
  assert.match(doc, new RegExp(`\\*\\*N\\*\\*\\)[^|]*\\| \\*\\*${AGENT_MAX_REGENERATIONS}\\*\\*`)); assert.match(doc, new RegExp(`\\*\\*K\\*\\*\\)[^|]*\\| \\*\\*${EXPLAIN_MAX_TRADES}\\*\\*`))
  assert.match(doc, new RegExp(`no máximo \\*\\*${AGENT_MAX_CALLS_PER_TURN} chamadas\\*\\* de capacidade`))
  assert.match(read("docs/ai-partner/agent-contract-plano.md"), /PRÉ-REQUISITO OBRIGATÓRIO do E6\.6/)
})

test("KG1 — LACUNA FECHADA (E6.6-0d): o schema REJEITA um handle com combined inconsistente (verify=TAMPERED + combined=VERIFIED); a função que decide mora só em verdict.ts e o contrato a usa. A matriz completa verify×source×combined está em test-agent-verdict-schema.mts", () => {
  const handle = { evidenceRef: `ev_${"a".repeat(32)}`, evidenceHash: "b".repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL", population: { declared: 1, verifiability: "FULL" }, refEpoch: "s1", freshness: "CURRENT",
    verdict: { verify: { status: "TAMPERED", codes: [] }, source: { status: "SOURCE_MISMATCH", codes: [] }, combined: "VERIFIED" } }
  assert.equal(EvidenceHandleSchema.safeParse(handle).success, false, "LACUNA REABERTA: o schema voltou a aceitar combined inconsistente")
  // quem DEFINE combineVerdict é só verdict.ts (única fonte, Q1); o contrato a IMPORTA e a aplica no refine do Verdict
  const definers = agentFiles.filter((f) => /(function|const)\s+combineVerdict\b/.test(strip(readFileSync(f, "utf8")))).map((f) => f.slice(f.lastIndexOf("/") + 1))
  assert.deepEqual(definers, ["verdict.ts"], "combineVerdict definido fora de verdict.ts")
  const contractCode = strip(readFileSync(join(ROOT, "src/lib/agent/contract.ts"), "utf8"))
  assert.match(contractCode, /import \{ combineVerdict \} from "\.\/verdict\.ts"/)
  assert.match(contractCode, /combineVerdict\(v\.verify\.status, v\.source\.status\)/)
  assert.match(read("docs/ai-partner/agent-contract-plano.md"), /combined.*inconsistente|inconsistente.*combined/s)
})

console.log(`\n${passed} testes ok`)
