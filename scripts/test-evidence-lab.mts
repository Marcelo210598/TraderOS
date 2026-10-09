// MeuTrade — Evidence Lab (ferramenta de dev): guard de produção, isolamento, dados sintéticos e fidelidade ao domínio real.
//   node scripts/test-evidence-lab.mts      (a validação HTTP contra o servidor de dev é manual; ver docs)
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { EVIDENCE_LAB_BASE_PATH, assertEvidenceLabEnabled, isEvidenceLabEnabled, isEvidenceLabPath } from "../src/lib/dev/evidence-lab/guard.ts"
import { LAYERS, PENDING, layerViews } from "../src/lib/dev/evidence-lab/layers.ts"
import { SCENARIOS, buildBundle, buildDemo, metricsView, runAllScenarios, runScenario, scenarioContext } from "../src/lib/dev/evidence-lab/model.ts"
import { NT8_PTBR_HEADER, demoCsv } from "../src/lib/dev/evidence-lab/synthetic.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { METRIC_IDS, calculateMetrics } from "../src/lib/metrics/index.ts"

// O Lab só existe em desenvolvimento: o teste liga NODE_ENV=development (e restaura no fim) para exercitar o que o servidor de dev renderiza.
const ORIGINAL_ENV = process.env.NODE_ENV
;(process.env as Record<string, string | undefined>).NODE_ENV = "development"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const labFiles = [...walk(join(ROOT, "src/lib/dev/evidence-lab")), ...walk(join(ROOT, "src/app/dev"))].filter((f) => /\.(ts|tsx)$/.test(f))

test("GUARD: só NODE_ENV=development libera; production, test e vazio recusam (allowlist, não blocklist)", () => {
  assert.equal(isEvidenceLabEnabled({ NODE_ENV: "development" }), true)
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "test" }, { NODE_ENV: "" }, { NODE_ENV: "Development" }, { NODE_ENV: "prod" }, {}]) assert.equal(isEvidenceLabEnabled(env), false, JSON.stringify(env))
  assert.doesNotThrow(() => assertEvidenceLabEnabled({ NODE_ENV: "development" }))
  assert.throws(() => assertEvidenceLabEnabled({ NODE_ENV: "production" }), /indisponível/)
  assert.equal(isEvidenceLabPath(EVIDENCE_LAB_BASE_PATH), true)
  assert.equal(isEvidenceLabPath(`${EVIDENCE_LAB_BASE_PATH}/x`), true)
  for (const p of ["/dev", "/dev/evidence-labx", "/dev/other", "/", "/api/dev/evidence-lab", "/dashboard"]) assert.equal(isEvidenceLabPath(p), false, p)
})

test("DEFESA EM PROFUNDIDADE: com NODE_ENV=production o construtor de dados, o CSV, as views e os cenários RECUSAM (não confiam no chamador)", () => {
  const before = process.env.NODE_ENV
  const demo = buildDemo() // criado em desenvolvimento
  const ctx = scenarioContext(demo)
  const env = process.env as Record<string, string | undefined>
  try {
    env.NODE_ENV = "production"
    assert.throws(() => buildDemo(), /indisponível/)
    assert.throws(() => demoCsv(), /indisponível/)
    assert.throws(() => metricsView(demo, { pnl: "NET", r: "NET" }), /indisponível/)
    assert.throws(() => buildBundle(demo, { metricId: "netPnl", view: { pnl: "NET", r: "NET" } }), /indisponível/)
    assert.throws(() => runScenario(ctx, SCENARIOS[0]), /indisponível/)
  } finally {
    env.NODE_ENV = before
  }
})

test("PONTOS DE ENTRADA: proxy, layout e page consultam o guard (4 camadas, nenhuma só visual); sem API de dev e sem endpoint novo", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
  assert.match(read("src/proxy.ts"), /isEvidenceLabPath\(nextUrl\.pathname\) && isEvidenceLabEnabled\(\)/)
  assert.match(read("src/app/dev/evidence-lab/layout.tsx"), /if \(!isEvidenceLabEnabled\(\)\) notFound\(\)/)
  assert.match(read("src/app/dev/evidence-lab/page.tsx"), /if \(!isEvidenceLabEnabled\(\)\) notFound\(\)/)
  assert.ok(read("src/lib/dev/evidence-lab/model.ts").includes("assertEvidenceLabEnabled()"))
  assert.equal(walk(join(ROOT, "src/app/dev")).filter((f) => /route\.(ts|tsx)$/.test(f)).length, 0, "nenhum route handler em /dev")
  assert.equal(walk(join(ROOT, "src/app/api")).filter((f) => /evidence|\/dev\//.test(f)).length, 0, "nenhuma API de Evidence/dev")
})

test("ISOLAMENTO: sem banco/Prisma/auth, sem as fixtures reais e sem dependências novas nos arquivos do Lab", () => {
  assert.ok(labFiles.length >= 14)
  for (const f of labFiles) {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")
    const code = src.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``") // só código: textos da interface podem citar "Prisma", "fixtures"…
    const specs = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    for (const m of specs) {
      assert.ok(!/prisma|auth|next-auth/i.test(m), `${f}: importa banco/auth (${m})`)
      assert.ok(!/fixtures|trade-performance/.test(m), `${f}: importa fixture (${m})`)
      const external = !m.startsWith(".") && !m.startsWith("@/")
      assert.ok(!external || m === "react" || m === "next" || m.startsWith("next/"), `${f}: dependência externa ${m}`)
    }
    assert.ok(!/readFileSync|node:fs|process\.cwd|DATABASE_URL/.test(code), `${f}: leitura de arquivo/banco`)
  }
})

test("SINTÉTICO: o CSV é inventado (contas e estratégia fictícias), o cabeçalho = o do CSV sintético versionado, o pipeline aceita 100% das linhas", () => {
  const header = readFileSync(join(ROOT, "fixtures/_synthetic/ninjatrader-ptbr-cycles.csv"), "utf8").split(/\r?\n/)[0]
  assert.equal(NT8_PTBR_HEADER, header)
  const csv = demoCsv()
  assert.ok(csv.includes("Conta Demo A") && csv.includes("Estratégia Demo") && !/Sim10\d|LFE|APEX/i.test(csv))
  const demo = buildDemo()
  assert.equal(demo.rowsRead, 16)
  assert.equal(demo.rowsRejected, 0)
  assert.equal(demo.cycles, 14)
  assert.ok(demo.trades.some((t) => t.reconstruction?.ambiguities.some((a) => a.code === "SAME_SECOND_BOUNDARY")))
  assert.ok(demo.trades.some((t) => t.reconstruction?.ambiguities.some((a) => a.code === "EXCURSION_CONFLICT")))
  assert.ok(demo.trades.some((t) => t.direction === "SHORT") && demo.trades.some((t) => (t.entryLegs?.length ?? 0) > 1))
  assert.ok(demo.trades.some((t) => t.r.net !== null) && demo.trades.some((t) => t.r.net === null && t.r.netReason !== null))
  assert.ok(!JSON.stringify(demo.tradeEvidence).includes("Conta Demo")) // privacidade de conta vale também no Lab
})

test("FIDELIDADE: métricas, bundle e selo do Lab = chamadas DIRETAS ao domínio (nada reimplementado)", () => {
  const demo = buildDemo()
  for (const v of [{ pnl: "NET", r: "NET" }, { pnl: "GROSS", r: "POINTS" }] as const) {
    const lab = metricsView(demo, v).result
    const direct = calculateMetrics(demo.analytics, { pnlBasis: v.pnl, rBasis: v.r })
    assert.equal(canonicalJson(lab), canonicalJson(direct))
    assert.equal(Object.keys(lab.metrics).length, METRIC_IDS.length)
  }
  for (const id of ["netPnl", "winners", "maxDrawdownR", "totalPoints"]) {
    const b = buildBundle(demo, { metricId: id, view: { pnl: "NET", r: "NET" } })
    assert.ok(b.ok)
    assert.equal(b.bundle.evidenceHash, computeEvidenceHash(b.bundle))
    assert.equal(b.bundle.evidence.metrics[0].population.tradeSetHash, calculateMetrics(demo.analytics).population.tradeSetHash)
    assert.equal(verifyEvidence(b.bundle).status, "VALID")
  }
  const ho = buildBundle(demo, { metricId: "largestWinner", view: { pnl: "NET", r: "NET" }, tradeIdsLimit: 3 })
  assert.ok(ho.ok && ho.bundle.evidence.metrics[0].verifiability === "HASH_ONLY")
  assert.equal(verifyEvidence(ho.bundle).status, "UNVERIFIABLE")
})

test("CENÁRIOS: executam as funções reais; o status mostrado = verifyEvidence direto; todos batem com o contrato; os do usuário estão presentes", () => {
  const demo = buildDemo()
  const ctx = scenarioContext(demo)
  const runs = runAllScenarios(ctx)
  assert.equal(runs.length, SCENARIOS.length)
  for (const r of runs) {
    assert.equal(canonicalJson(r.report), canonicalJson(verifyEvidence(r.bundle)), r.scenario.id)
    assert.equal(r.matchesContract, true, `${r.scenario.id}: real ${r.report.status} ≠ previsto ${r.scenario.expected}`)
  }
  const ids = SCENARIOS.map((s) => s.id)
  for (const need of ["intact", "value-noseal", "value-reseal", "remove-trade", "remove-import", "rowhash", "contributor", "rolecounts"]) assert.ok(ids.includes(need), need)
  // independência: refaz 3 adulterações à mão, fora do Lab, e compara com o que o Lab mostra
  const manual = (fn: (x: any) => void, seal: boolean) => { const c = JSON.parse(JSON.stringify(ctx.base)); fn(c); if (seal) c.evidenceHash = computeEvidenceHash(c); return verifyEvidence(c) }
  assert.equal(manual((x) => (x.evidence.metrics[0].value += 1), false).status, runs.find((r) => r.scenario.id === "value-noseal")?.report.status)
  assert.equal(manual((x) => x.evidence.trades.shift(), true).status, runs.find((r) => r.scenario.id === "remove-trade")?.report.status)
  assert.equal(manual((x) => (x.evidence.trades[2].sourceRows[0].rowHash = "f".repeat(64)), true).status, runs.find((r) => r.scenario.id === "rowhash")?.report.status)
  // o selo muda no cenário com novo selo e NÃO muda no que não recalcula
  assert.notEqual(runs.find((r) => r.scenario.id === "value-reseal")?.sealAfter, ctx.base.evidenceHash)
  assert.equal(runs.find((r) => r.scenario.id === "value-noseal")?.sealAfter, ctx.base.evidenceHash)
  // o cenário coordenado é VALID (o limite documentado) e traz mudanças reais no JSON
  const coord = runs.find((r) => r.scenario.id === "coordinated")!
  assert.equal(coord.report.status, "VALID")
  assert.ok(coord.changes.length > 1)
})

test("VISÃO GERAL: estados válidos, sondas ao vivo ok, nada verde sem implementação; pendentes e fora de escopo listados; V3/V4 já refletidos", () => {
  const demo = buildDemo()
  const ctx = scenarioContext(demo)
  const views = layerViews(demo, ctx)
  assert.equal(views.length, 8)
  for (const v of views) assert.ok(v.probe?.ok, `${v.id}: ${v.probe?.text}`)
  assert.ok(["concluido", "parcial", "pendente", "fora"].includes(views[0].status))
  assert.ok(LAYERS.every((l) => l.limits.length > 0 && l.basis.length > 0), "toda camada declara base E limites")
  // a verificação NÃO fica com selo de 'concluído' pleno: tem limites estruturais (origem, seleção, selo≠assinatura)
  assert.equal(LAYERS.find((l) => l.id === "verificacao")?.status, "parcial")
  assert.equal(LAYERS.find((l) => l.id === "ingestao")?.status, "parcial") // parser EN não validado
  assert.ok(PENDING.some((p) => p.id === "e5b" && p.status === "pendente"))
  assert.ok(PENDING.some((p) => p.id === "ui-produto" && p.status === "fora"))
  assert.match(views.find((v) => v.id === "verificacao")!.probe!.text, /VALID/)
})

if (ORIGINAL_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
else (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV
console.log(`\n${passed} testes ok`)
