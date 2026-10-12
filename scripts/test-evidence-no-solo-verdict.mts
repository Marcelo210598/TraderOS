// Garantia (decisão de 12/10/2026): o estado do E5b (`SOURCE_VERIFIED`…) NUNCA é lido isolado como "tudo ok".   node scripts/test-evidence-no-solo-verdict.mts
// Cobre: (1) aviso no código e no texto da limitação; (2) todo consumidor de `SOURCE_VERIFIED`/`verifyEvidenceSource` em src/ também lê o
// `verifyEvidence`; (3) as telas que mostram o E5b trazem o aviso fixo; (4) casos reais em que E5b = SOURCE_VERIFIED e V6 = TAMPERED;
// (5) a regra do VEREDITO COMBINADO está escrita no plano do E6.5. Um consumidor novo que viole (2) faz este teste falhar.
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DERIVED_SCENARIOS, derivedContext, runDerivedScenario } from "../src/lib/dev/evidence-lab/derived.ts"
import { SOURCE_LIMITATIONS } from "../src/lib/evidence/verify-source.ts"

const env = process.env as Record<string, string | undefined>
const ORIGINAL_ENV = env.NODE_ENV
env.NODE_ENV = "development"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

test("CÓDIGO: o verificador de origem carrega o aviso 'NUNCA LER ISOLADO' (topo do arquivo e no tipo SourceStatus) e a limitação do relatório diz que SOURCE_VERIFIED isolado não é 'tudo ok'", () => {
  const src = read("src/lib/evidence/verify-source.ts")
  assert.match(src, /NUNCA LER ISOLADO/)
  assert.match(src, /veredito COMBINADO/)
  assert.match(src, /\/\*\* ATENÇÃO: nenhum destes estados, sozinho, é 'tudo ok'[^]*?export type SourceStatus/)
  const lim = SOURCE_LIMITATIONS.find((l) => l.code === "L_BUNDLE_INTEGRITY_NOT_CHECKED")!
  assert.match(lim.text, /ISOLADO NÃO significa "tudo ok"/)
  assert.match(lim.text, /VALID do verifyEvidence sobre o MESMO evidenceHash/)
})

test("CONSUMIDORES: todo arquivo de src/ que lê SOURCE_VERIFIED ou chama verifyEvidenceSource também lê o verifyEvidence (nenhum consome o E5b sozinho)", () => {
  const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("src/lib/evidence/verify-source.ts"))
  const consumers = files.filter((f) => /SOURCE_VERIFIED|verifyEvidenceSource\(|SourceVerifyReport/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")))
  assert.ok(consumers.length >= 4, `consumidores encontrados: ${consumers.length}`)
  for (const f of consumers) {
    const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")
    assert.ok(/verifyEvidence\(|VerifyReport|verify\/?"|evidence\/verify"|\.verify\b|\bVerifyStatus\b/.test(code), `${f.replace(ROOT, "")}: consome o E5b sem ler o verifyEvidence`)
  }
})

test("TELAS: as abas que mostram o estado do E5b trazem o aviso fixo 'SOURCE_VERIFIED sozinho não é “tudo ok”'", () => {
  assert.match(read("src/app/dev/evidence-lab/_components/ui.tsx"), /SOURCE_VERIFIED sozinho não é “tudo ok”/)
  for (const f of ["src/app/dev/evidence-lab/_components/source-panel.tsx", "src/app/dev/evidence-lab/_components/derived-panel.tsx"]) assert.match(read(f), /<SoloVerdictCallout \/>/, f)
  // a aba de derivados mostra os DOIS vereditos lado a lado
  assert.match(read("src/app/dev/evidence-lab/_components/derived-panel.tsx"), /V6\/verifyEvidence: \{s\.report\.status\}/)
})

test("CASOS REAIS: existem situações em que o E5b diz SOURCE_VERIFIED e o veredito combinado NÃO é ok — então 'E5b isolado = ok' seria falso", () => {
  const ok = (v: string, s: string) => v === "VALID" && (s === "SOURCE_VERIFIED" || s === "SOURCE_VERIFIED_PARTIAL")
  // (a) casos de borda de refs.legs (arquivo de expectativa escrito antes)
  const edge = JSON.parse(read("scripts/expectations/derived-legrefs-edge.expected.json")) as Any
  const solo = Object.entries(edge.cases).filter(([, c]: [string, Any]) => c.e5bStatus === "SOURCE_VERIFIED" && c.v6Status === "TAMPERED").map(([k]) => k)
  assert.deepEqual(solo.sort(), ["item_duplicado", "item_removido", "itens_fora_de_ordem"])
  for (const k of solo) assert.equal(ok(edge.cases[k].v6Status, edge.cases[k].e5bStatus), false, k)
  // (b) cenários do Lab, executados agora (funções reais)
  const ctx = derivedContext()
  for (const id of ["forged-value", "forged-delta"]) {
    const r = runDerivedScenario(ctx, DERIVED_SCENARIOS.find((s) => s.id === id)!)
    assert.equal(r.source.status, "SOURCE_VERIFIED", id)
    assert.equal(r.report.status, "TAMPERED", id)
    assert.equal(ok(r.report.status, r.source.status), false, id)
    assert.equal(r.source.evidenceHash, (r.bundle as Any).evidenceHash, "os dois relatórios falam do MESMO evidenceHash")
  }
})

test("E6.5: a regra do VEREDITO COMBINADO está escrita no plano (6.1); o teste-guarda é citado como ponto de extensão", () => {
  const plan = read("docs/ai-partner/E6-G6-plano.md")
  assert.match(plan, /Regra do VEREDITO COMBINADO/)
  assert.match(plan, /mesmo `evidenceHash`/)
  assert.match(plan, /test-evidence-no-solo-verdict\.mts/)
  assert.match(plan, /Nenhum campo "ok"\/"verified" agregado pode existir sem trazer os dois componentes/)
})

env.NODE_ENV = ORIGINAL_ENV
if (ORIGINAL_ENV === undefined) delete env.NODE_ENV
console.log(`\n${passed} testes ok`)
