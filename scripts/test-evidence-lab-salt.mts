// Evidence Lab — cenários da política de sal (P5): funções reais, estados previstos, sigilo do valor do sal e guard de produção.
//   node scripts/test-evidence-lab-salt.mts   (a validação HTTP contra o servidor de dev é manual)
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildDemo } from "../src/lib/dev/evidence-lab/model.ts"
import { SALT_SOURCE_DEFS } from "../src/lib/dev/evidence-lab/salt.ts"
import { SOURCE_SCENARIOS, runAllSourceScenarios, runSourceScenario, sourceContext } from "../src/lib/dev/evidence-lab/source.ts"
import { sha256Hex } from "../src/lib/infra/hash.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const ORIGINAL_ENV = process.env.NODE_ENV
;(process.env as Record<string, string | undefined>).NODE_ENV = "development"
const demo = buildDemo(); const ctx = sourceContext(demo)
const runs = runAllSourceScenarios(ctx)
const run = (id: string) => runs.find((r) => r.scenario.id === id)!
const IDS = ["salt-ok", "salt-rotated", "salt-check-diverges", "salt-tampered-both", "salt-id-unknown", "salt-retired", "salt-id-wrong", "salt-forgotten"]
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

test("CENÁRIOS: os 8 cenários de sal existem na aba Origem, executam as funções reais e o estado REAL = o previsto pelo contrato", () => {
  assert.deepEqual(SALT_SOURCE_DEFS.map((s) => s.id), IDS)
  for (const id of IDS) { assert.ok(SOURCE_SCENARIOS.some((s) => s.id === id), id); assert.equal(run(id).matchesContract, true, `${id}: real ${run(id).report.status} ≠ previsto ${run(id).scenario.expected}`) }
  const want: Record<string, string> = { "salt-ok": "SOURCE_VERIFIED", "salt-rotated": "SOURCE_VERIFIED", "salt-check-diverges": "SOURCE_VERIFIED_PARTIAL", "salt-tampered-both": "SOURCE_MISMATCH", "salt-id-unknown": "UNVERIFIABLE", "salt-retired": "UNVERIFIABLE", "salt-id-wrong": "SOURCE_VERIFIED_PARTIAL", "salt-forgotten": "SOURCE_MISMATCH" }
  for (const [id, st] of Object.entries(want)) assert.equal(run(id).report.status, st, id)
})

test("CÓDIGOS: o caso do atacante (V6) acusa V_SALT_CHECK_MISMATCH e NUNCA UNVERIFIABLE; unknown/retired têm códigos distintos; aviso e limitações aparecem; o legado traz a pista", () => {
  const codes = (id: string) => run(id).report.checks.filter((c) => c.status !== "PASS").map((c) => `${c.id}:${c.code}`)
  assert.ok(codes("salt-tampered-both").includes("V5.context:V_SALT_CHECK_MISMATCH")); assert.notEqual(run("salt-tampered-both").report.status, "UNVERIFIABLE")
  assert.ok(codes("salt-id-unknown").some((c) => c.endsWith("S_SALT_UNKNOWN"))); assert.ok(codes("salt-retired").some((c) => c.endsWith("S_SALT_RETIRED")))
  assert.ok(run("salt-check-diverges").report.limitations.some((l) => l.code === "L_SALT_CHECK_DIVERGENT"))
  assert.ok(run("salt-id-wrong").report.limitations.some((l) => l.code === "L_SALT_ID_NOT_RESOLVED"))
  assert.match(run("salt-forgotten").report.checks.map((c) => c.detail).join(" "), /possível causa: o sal do import não foi propagado/)
  for (const id of ["salt-ok", "salt-rotated"]) assert.equal(run(id).report.limitations.some((l) => l.code.startsWith("L_SALT")), false, id)
})

test("V0–V6 do mesmo bundle: independente do E5b (VALID nos íntegros e nos que só o E5b acusa); sem texto livre; saltId/saltCheck presentes só nos gerenciados", () => {
  for (const id of ["salt-ok", "salt-rotated", "salt-check-diverges", "salt-forgotten"]) assert.equal(run(id).verify.status, "VALID", id)
  for (const id of ["salt-ok", "salt-rotated", "salt-check-diverges", "salt-tampered-both", "salt-id-unknown", "salt-retired", "salt-id-wrong"]) {
    const r = (run(id).bundle as Any).evidence.imports[0].reproducibility
    assert.match(r.saltId, /^s\d+$/); assert.match(r.saltCheck, /^slt_[0-9a-f]{24}$/)
  }
  assert.equal("saltId" in (run("salt-forgotten").bundle as Any).evidence.imports[0].reproducibility, false)
})

test("REINGESTÃO exibida: nos cenários em que o E5b reproduz com o sal do provider a tabela vem do pipeline REAL e os tradeIds batem com os do bundle; só hashes/contagens vão para a página", () => {
  for (const id of ["salt-ok", "salt-rotated", "salt-check-diverges"]) {
    const r = run(id)
    assert.ok(r.reingestion, `${id}: sem reingestão`)
    const declared = (r.bundle as Any).evidence.trades.map((t: Any) => t.tradeId).sort()
    for (const t of declared) assert.ok(r.reingestion!.tradeIds.includes(t), `${id}: tradeId declarado ausente na reingestão`)
  }
  for (const id of ["salt-id-unknown", "salt-retired"]) assert.equal(run(id).reingestion, null, `${id}: sem sal não se reexecuta`)
})

test("SIGILO: o valor de nenhum sal DEMO aparece em bundle, relatórios V0–V6/E5b, reingestão ou no que a página recebe (JSON do SourceRun inteiro); o código das páginas não lê sal", () => {
  const salts = ["a", "b", "x", "y", "outro", "falso"].map((t) => sha256Hex(`lab-demo-salt/${t}`))
  for (const r of runs) {
    const text = JSON.stringify(r, (k, v) => (k === "scenario" ? undefined : v)) // o que vai à página (o cenário em si é função, não serializa)
    for (const s of salts) { assert.equal(text.includes(s), false, `${r.scenario.id}: sal em claro`); assert.equal(text.includes(s.slice(0, 16)), false) }
  }
  for (const f of walk(join(ROOT, "src/app/dev")).filter((x) => /\.tsx?$/.test(x))) {
    const code = readFileSync(f, "utf8")
    assert.equal(/accountRefSalt|\.salt\b|lab-demo-salt/.test(code), false, `${f}: a página não pode tocar no sal`)
  }
})

test("PRODUÇÃO: os cenários de sal só executam em desenvolvimento (guard) e o módulo é só do Lab", () => {
  const env = process.env as Record<string, string | undefined>; const prev = env.NODE_ENV
  try { env.NODE_ENV = "production"; assert.throws(() => runSourceScenario(ctx, SOURCE_SCENARIOS.find((s) => s.id === "salt-ok")!), /indisponível/) } finally { env.NODE_ENV = prev }
  const src = readFileSync(join(ROOT, "src/lib/dev/evidence-lab/salt.ts"), "utf8")
  assert.ok(src.includes("assertEvidenceLabEnabled()"))
  assert.equal(/prisma|process\.env|fetch\(|node:fs/i.test(src.replace(/\/\/.*$/gm, "")), false)
  const importers = walk(join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f) && /from\s+["'][^"']*evidence-lab\/salt(\.ts)?["']/.test(readFileSync(f, "utf8")))
  assert.deepEqual(importers, [], "só source.ts (mesma pasta, import relativo) usa os cenários")
})

if (ORIGINAL_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
else (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV
console.log(`\n${passed} testes ok`)
