// Evidence Lab — aba "Origem (E5b)": cenários executados com as funções REAIS, guard de produção, privacidade.   node scripts/test-evidence-lab-source.mts
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildDemo } from "../src/lib/dev/evidence-lab/model.ts"
import { SOURCE_SCENARIOS, runAllSourceScenarios, runSourceScenario, sourceContext } from "../src/lib/dev/evidence-lab/source.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"

const ORIGINAL_ENV = process.env.NODE_ENV
;(process.env as Record<string, string | undefined>).NODE_ENV = "development"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

const demo = buildDemo()
const ctx = sourceContext(demo)
const runs = runAllSourceScenarios(ctx)
const run = (id: string) => runs.find((r) => r.scenario.id === id)!

test("CENÁRIOS: os 9+ cenários pedidos existem, todos executam as funções reais e cada estado real = o previsto pelo contrato", () => {
  const ids = SOURCE_SCENARIOS.map((s) => s.id)
  for (const need of ["intact", "byte", "cell", "hash", "importid", "rowhash", "tradeid", "forged", "partial", "no-file", "version"]) assert.ok(ids.includes(need), need)
  assert.equal(runs.length, SOURCE_SCENARIOS.length)
  for (const r of runs) assert.equal(r.matchesContract, true, `${r.scenario.id}: real ${r.report.status} ≠ previsto ${r.scenario.expected}`)
})

test("OS QUATRO RESULTADOS do E5b são alcançados e distintos: SOURCE_VERIFIED, SOURCE_VERIFIED_PARTIAL, SOURCE_MISMATCH, UNVERIFIABLE", () => {
  const states = new Set(runs.map((r) => r.report.status))
  for (const s of ["SOURCE_VERIFIED", "SOURCE_VERIFIED_PARTIAL", "SOURCE_MISMATCH", "UNVERIFIABLE"]) assert.ok(states.has(s as Any), s)
  assert.equal(run("intact").report.status, "SOURCE_VERIFIED")
  assert.equal(run("partial").report.status, "SOURCE_VERIFIED_PARTIAL")
  assert.equal(run("partial").report.coverage?.populations.complete, false) // parcial nunca é apresentado como completo
  assert.equal(run("no-file").report.status, "UNVERIFIABLE")
  assert.equal(run("no-file").report.checks.filter((c) => c.status === "FAIL").length, 0) // indisponibilidade ≠ adulteração
  assert.equal(run("version").report.status, "UNVERIFIABLE")
  for (const id of ["byte", "cell", "hash", "importid", "rowhash", "tradeid", "forged"]) assert.equal(run(id).report.status, "SOURCE_MISMATCH", id)
})

test("NADA SIMULADO: o relatório mostrado = chamada DIRETA a verifyEvidenceSource/verifyEvidence; 3 cenários refeitos à mão, fora do Lab, dão o mesmo estado", () => {
  for (const r of runs) {
    assert.equal(canonicalJson(r.verify), canonicalJson(verifyEvidence(r.bundle)), `${r.scenario.id}: V0–V4`)
    const made = r.scenario.make(ctx)
    assert.equal(canonicalJson(r.report), canonicalJson(verifyEvidenceSource(made.bundle, made.files, made.options)), `${r.scenario.id}: E5b`)
  }
  const id = ctx.base.evidence.imports[0].importId
  const enc = new TextEncoder()
  const flipped = ctx.bytes.slice()
  flipped[flipped.indexOf("T".charCodeAt(0))] ^= 0x01
  assert.equal(verifyEvidenceSource(ctx.base, { [id]: flipped }).status, run("byte").report.status)
  const rh = JSON.parse(JSON.stringify(ctx.base)) as Any
  rh.evidence.trades[2].sourceRows[0].rowHash = "f".repeat(64)
  rh.evidenceHash = computeEvidenceHash(rh)
  assert.equal(verifyEvidenceSource(rh, { [id]: ctx.bytes }).status, run("rowhash").report.status)
  assert.equal(verifyEvidenceSource(ctx.hashOnly, { [id]: ctx.bytes }).status, run("partial").report.status)
  assert.ok(enc.encode(demo.csv).length === ctx.bytes.length)
})

test("O CONTRASTE que justifica o E5b: o bundle forjado e o de hash trocado são VALID no V0–V4 e SOURCE_MISMATCH no E5b; o valor alterado só aparece em V5.values", () => {
  for (const id of ["forged", "hash"]) {
    assert.equal(run(id).verify.status, "VALID", id)
    assert.equal(run(id).report.status, "SOURCE_MISMATCH", id)
  }
  const f = run("forged").report
  assert.equal(f.checks.find((c) => c.id === "V5.file")?.status, "PASS")
  assert.equal(f.checks.find((c) => c.id === "V5.rows")?.status, "PASS") // rowHash e tradeId continuam os do CSV
  assert.equal(f.checks.find((c) => c.id === "V5.values")?.code, "V_TRADE_VALUES_MISMATCH")
  assert.equal(run("rowhash").verify.status, "TAMPERED")
})

test("REEXECUÇÃO exibida: só quando o verificador a executou (V5.context PASS); no íntegro confere 14 ciclos, importId e rowHash; sem arquivo/arquivo alterado/versão incompatível não há reexecução", () => {
  const re = run("intact").reingestion!
  assert.equal(re.tradesProduced, 14)
  assert.equal(re.rowsRead, 16)
  assert.equal(re.importId, ctx.base.evidence.imports[0].importId)
  assert.ok(ctx.base.evidence.trades.every((t) => t.sourceRows.every((r) => re.rowHashes[r.rowNo] === r.rowHash)))
  assert.ok(ctx.base.evidence.trades.every((t) => re.tradeIds.includes(t.tradeId)))
  for (const id of ["byte", "cell", "hash", "no-file", "version"]) assert.equal(run(id).reingestion, null, id)
  assert.notEqual(run("importid").reingestion?.importId, (run("importid").bundle as Any).evidence.imports[0].importId)
  assert.ok(run("partial").reingestion)
})

test("PRIVACIDADE: nenhum byte/trecho do CSV, conta ou estratégia no que o E5b e a reexecução devolvem; só metadados do arquivo; a estratégia só aparece no campo JÁ CONHECIDO do bundle (cycleKey.strategy)", () => {
  const csvLines = demo.csv.split("\n").filter(Boolean)
  const strip = (r: (typeof runs)[number]) => ({ report: r.report, verify: r.verify, file: r.file, reingestion: r.reingestion })
  const text = JSON.stringify(runs.map(strip))
  for (const forbidden of ["Conta Demo A", "Conta Demo B", "Estratégia Demo", "MGC 12-26", "Núm. Neg.", csvLines[1], csvLines[2]]) assert.equal(text.includes(forbidden), false, `vazou: ${forbidden}`)
  // bundles: conta nunca; CSV nunca; a estratégia só em reconstruction.cycleKey.strategy (limite pré-existente desde o E3, documentado como achado)
  for (const r of runs) {
    const b = JSON.stringify(r.bundle)
    for (const forbidden of ["Conta Demo A", "Conta Demo B", "Núm. Neg.", csvLines[1], csvLines[2]]) assert.equal(b.includes(forbidden), false, `${r.scenario.id}: vazou ${forbidden}`)
    const withoutKnownField = JSON.stringify(r.bundle, (k, v) => (k === "strategy" ? undefined : v))
    assert.equal(withoutKnownField.includes("Estratégia Demo"), false, `${r.scenario.id}: estratégia fora do campo conhecido`)
  }
  for (const r of runs) {
    assert.equal("bytes" in (r.file as object) && (r.file as Any).bytes instanceof Uint8Array, false)
    if (r.file.facts) assert.deepEqual(Object.keys(r.file.facts).sort(), ["bytes", "hasBom", "lineEnding", "sha256"])
  }
  // o painel não lê o CSV: nenhum arquivo da aba referencia `demo.csv`/decodificação de bytes para renderizar
  const app = walk(join(ROOT, "src/app/dev")).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n")
  assert.equal(/demo\.csv|decodeSourceBytes|TextDecoder/.test(app), false)
})

test("GUARD: com NODE_ENV=production o contexto e a execução dos cenários RECUSAM (defesa em profundidade); a aba só existe dentro da página protegida; sem endpoint novo", () => {
  const env = process.env as Record<string, string | undefined>
  const before = env.NODE_ENV
  try {
    env.NODE_ENV = "production"
    assert.throws(() => sourceContext(demo), /indisponível/)
    assert.throws(() => runSourceScenario(ctx, SOURCE_SCENARIOS[0]), /indisponível/)
    assert.throws(() => runAllSourceScenarios(ctx), /indisponível/)
  } finally {
    env.NODE_ENV = before
  }
  const page = readFileSync(join(ROOT, "src/app/dev/evidence-lab/page.tsx"), "utf8")
  assert.match(page, /if \(!isEvidenceLabEnabled\(\)\) notFound\(\)/)
  assert.ok(page.indexOf("function SourceTab") > page.indexOf("if (!isEvidenceLabEnabled()) notFound()"), "SourceTab só é usado dentro da página guardada")
  assert.equal(walk(join(ROOT, "src/app/dev")).filter((f) => /route\.(ts|tsx)$/.test(f)).length, 0)
  assert.equal(walk(join(ROOT, "src/app")).filter((f) => /route\.(ts|tsx)$/.test(f) && /evidence|\/dev\//.test(f)).length, 0)
  assert.ok(readFileSync(join(ROOT, "src/lib/dev/evidence-lab/source.ts"), "utf8").includes("assertEvidenceLabEnabled()"))
})

test("ISOLAMENTO: source.ts e o painel não importam banco/Prisma/auth/fixtures, nem node:fs, e a aba usa só dados sintéticos do Lab", () => {
  for (const f of [join(ROOT, "src/lib/dev/evidence-lab/source.ts"), join(ROOT, "src/app/dev/evidence-lab/_components/source-panel.tsx")]) {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")
    for (const m of [...src.matchAll(/from\s+"([^"]+)"/g)].map((x) => x[1])) {
      assert.ok(!/prisma|auth|next-auth|fixtures|trade-performance|node:fs/i.test(m), `${f}: ${m}`)
    }
    assert.equal(/readFileSync|process\.cwd|DATABASE_URL/.test(src.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')), false, f)
  }
})

if (ORIGINAL_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
else (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV
console.log(`\n${passed} testes ok`)
