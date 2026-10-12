// Evidence Lab — aba "Derivados (E6)": guard de produção, funções reais (nada simulado), V6 visível, privacidade e isolamento.
//   node scripts/test-evidence-lab-derived.mts      (a validação HTTP contra o servidor de dev é manual; ver docs/ai-partner/evidence-lab.md)
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CODE_HELP,
  DERIVED_SCENARIOS,
  LIMITATION_HELP,
  V6_HELP,
  derivedContext,
  redactLabels,
  runAllDerivedScenarios,
  runDerivedScenario,
} from "../src/lib/dev/evidence-lab/derived.ts"
import { assertEvidenceLabEnabled } from "../src/lib/dev/evidence-lab/guard.ts"
import { derivedDemoCsv } from "../src/lib/dev/evidence-lab/synthetic.ts"
import { groupLabelView, maskLabel } from "../src/lib/dev/evidence-lab/redact-view.ts"
import { buildDemo, groupsView } from "../src/lib/dev/evidence-lab/model.ts"
import { accountRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { CHECK_CATALOG, verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { rankGroups } from "../src/lib/metrics/index.ts"

const ORIGINAL_ENV = process.env.NODE_ENV
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = "development"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const J = JSON.stringify
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
// o nome do arquivo (inventado, sem nome de conta) pode aparecer no ImportRef por política do E3 (redigido quando contém conta); aqui só conta/estratégia
const SECRETS = ["Conta Demo A", "Conta Demo B", "Estratégia Demo"]
const LABELS = ["Target1", "Target2", "Stop1", "Stop2", "Zerar", "Saida X"]

const ctx = derivedContext()
const runs = runAllDerivedScenarios(ctx)
const run = (id: string) => runs.find((r) => r.scenario.id === id)!
const v6 = (r: ReturnType<typeof run>) => r.report.checks.filter((c) => c.level === "V6")

test("PRODUÇÃO: com NODE_ENV=production todo construtor/executor dos derivados RECUSA (defesa em profundidade); o mesmo guard de 4 camadas protege a aba (é a mesma página/rota)", () => {
  try {
    env.NODE_ENV = "production"
    assert.throws(() => derivedContext(), /indisponível/)
    assert.throws(() => derivedDemoCsv(), /indisponível/)
    assert.throws(() => runDerivedScenario(ctx, DERIVED_SCENARIOS[0]), /indisponível/)
    assert.throws(() => runAllDerivedScenarios(ctx), /indisponível/)
    assert.throws(() => assertEvidenceLabEnabled(), /indisponível/)
  } finally {
    env.NODE_ENV = "development"
  }
  // pontos de entrada inalterados e nenhuma API/route handler nova: a aba é só parâmetro de URL da MESMA página protegida
  assert.match(read("src/proxy.ts"), /isEvidenceLabPath\(nextUrl\.pathname\) && isEvidenceLabEnabled\(\)/)
  assert.match(read("src/app/dev/evidence-lab/layout.tsx"), /if \(!isEvidenceLabEnabled\(\)\) notFound\(\)/)
  assert.match(read("src/app/dev/evidence-lab/page.tsx"), /if \(!isEvidenceLabEnabled\(\)\) notFound\(\)/)
  assert.ok(read("src/lib/dev/evidence-lab/derived.ts").includes("assertEvidenceLabEnabled()"))
  assert.equal(walk(join(ROOT, "src/app/dev")).filter((f) => /route\.(ts|tsx)$/.test(f)).length, 0, "nenhum route handler em /dev")
  assert.equal(walk(join(ROOT, "src/app/api")).filter((f) => /evidence|\/dev\//.test(f)).length, 0, "nenhuma API de Evidence/dev")
  assert.match(read("src/app/dev/evidence-lab/_components/params.ts"), /id: "derived", label: "Derivados \(E6\)"/)
})

test("ISOLAMENTO: os arquivos novos não importam banco/Prisma/auth, fixtures reais, node:fs nem dependência externa; sem persistir bytes", () => {
  const files = ["src/lib/dev/evidence-lab/derived.ts", "src/app/dev/evidence-lab/_components/derived-panel.tsx", "src/lib/dev/evidence-lab/synthetic.ts"]
  for (const f of files) {
    const src = read(f).replace(/\/\/.*$/gm, "")
    const code = src.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``")
    for (const m of [...src.matchAll(/from\s+"([^"]+)"/g)].map((x) => x[1])) {
      assert.ok(!/prisma|auth|next-auth/i.test(m), `${f}: ${m}`)
      assert.ok(!/fixtures|trade-performance/.test(m), `${f}: fixture ${m}`)
      assert.ok(m.startsWith(".") || m.startsWith("@/") || m === "react" || m === "next" || m.startsWith("next/"), `${f}: dependência externa ${m}`)
    }
    assert.ok(!/readFileSync|writeFileSync|node:fs|process\.cwd|DATABASE_URL|fetch\(/.test(code), `${f}: arquivo/banco/rede`)
  }
  // o Lab não acessa o dashboard principal
  assert.ok(!/dashboard/.test(read("src/lib/dev/evidence-lab/derived.ts")))
})

test("SINTÉTICO: o CSV dos derivados é inventado (contas e estratégia fictícias); o pipeline aceita 100%; há UNKNOWN, MIXED, quantidades diferentes, 2 contas, 2 horários, 2 semanas", () => {
  assert.ok(ctx.csv.includes("Conta Demo A") && ctx.csv.includes("Estratégia Demo") && !/Sim10\d|LFE|APEX/i.test(ctx.csv))
  assert.deepEqual([ctx.rowsRead, ctx.cycles], [21, 13])
  const buckets = new Set(ctx.canonical.map((t) => t.exitSummary?.mixed))
  assert.ok(buckets.has(true) && buckets.has(false))
  assert.ok(ctx.canonical.some((t) => t.exitLegs?.some((l) => l.reason === "UNKNOWN")))
  assert.ok(ctx.canonical.some((t) => t.exitLegs?.some((l) => l.quantity > 1)))
  assert.ok(ctx.canonical.some((t) => t.direction === "SHORT"))
})

test("FIDELIDADE: cada cenário chama as funções REAIS — selo = computeEvidenceHash; veredito = verifyEvidence direto; origem = verifyEvidenceSource direto; derivado = explainDerived direto; nenhum resultado em JSON estático", () => {
  for (const r of runs) {
    assert.equal(canonicalJson(r.report), canonicalJson(verifyEvidence(r.bundle)), r.scenario.id)
    assert.equal(canonicalJson(r.source), canonicalJson(verifyEvidenceSource(r.bundle, { [ctx.importRecord.importId]: ctx.bytes })), r.scenario.id)
    assert.equal((r.bundle as Any).evidenceHash, computeEvidenceHash(r.bundle as Any), `${r.scenario.id}: selo (adulterações refazem o selo)`)
    assert.equal(r.matchesContract, true, `${r.scenario.id}: ${r.report.status} ≠ ${r.scenario.expected}`)
  }
  // o bundle do cenário íntegro = chamada direta ao domínio fora do Lab (mesmo evidenceHash)
  const direct = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "hour" }, options: { timeZone: "America/Sao_Paulo", minSample: 4 } }, trades: ctx.trades, importRecords: [ctx.importRecord] })
  assert.equal(direct.ok, true)
  assert.equal(derivedEvidenceBundle(direct as Any).evidenceHash, (run("rank-hour").bundle as Any).evidenceHash)
  // o ranking guardado = rankGroups direto (E6.2), com conta/estratégia só como ref (aqui por hora: sem nomes)
  const rk = JSON.parse(J(rankGroups(ctx.trades, { groupBy: "hour", timeZone: "America/Sao_Paulo", minSample: 4 })))
  assert.deepEqual((run("rank-hour").bundle as Any).evidence.derived[0].result, rk)
  // código-fonte sem resultados embutidos
  const src = read("src/lib/dev/evidence-lab/derived.ts")
  assert.ok(!/tradeSetHash\s*:\s*"[0-9a-f]{64}"/.test(src) && !/evidenceHash\s*:\s*"[0-9a-f]{64}"/.test(src))
})

test("CENÁRIOS (todos os pedidos): íntegro, comparação, UNKNOWN/MIXED, divergência, amostra pequena, métrica indisponível, alteração com selo refeito, referência inválida, HASH_ONLY e limitações — com o veredito e os checks do V6 previstos", () => {
  const need = ["rank-hour", "compare-acc", "compare-period", "exit-analysis", "compare-legs", "leg-rank", "small-sample", "unavailable", "divergence", "forged-value", "forged-delta", "forged-quality", "invalid-ref", "swapped-dim", "hash-only", "version", "strategy-dim", "free-label", "forged-token"]
  assert.deepEqual(DERIVED_SCENARIOS.map((s) => s.id), need)
  const st = (id: string, c: string) => v6(run(id)).find((x) => x.id === c)!
  for (const id of ["rank-hour", "compare-acc", "compare-period", "exit-analysis", "compare-legs", "leg-rank", "small-sample", "unavailable", "divergence"]) {
    assert.equal(run(id).report.status, "VALID", id)
    assert.ok(v6(run(id)).every((c) => c.status === "PASS"), id)
  }
  // adulteração com selo refeito: V1 passa, V6 acusa o check certo
  assert.equal(run("forged-value").report.checks.find((c) => c.id === "V1.seal")!.status, "PASS")
  assert.equal(st("forged-value", "V6.result").status, "FAIL")
  assert.equal(st("forged-delta", "V6.derived").status, "FAIL")
  assert.equal(st("forged-delta", "V6.result").status, "PASS")
  assert.equal(st("forged-quality", "V6.quality").status, "FAIL")
  assert.equal(st("invalid-ref", "V6.refs").status, "FAIL")
  assert.equal(st("invalid-ref", "V6.result").status, "SKIPPED")
  assert.equal(st("swapped-dim", "V6.result").status === "FAIL" || st("swapped-dim", "V6.derived").status === "FAIL", true)
  // limites: SKIPPED com código, UNVERIFIABLE, sem FAIL
  for (const [id, code] of [["hash-only", "S_HASH_ONLY"], ["version", "S_VERSION_INCOMPATIBLE"], ["strategy-dim", "S_ASSOCIATION_UNVERIFIABLE"]] as const) {
    assert.equal(run(id).report.status, "UNVERIFIABLE", id)
    assert.ok(v6(run(id)).some((c) => c.status === "SKIPPED" && c.code === code), id)
    assert.equal(run(id).report.checks.some((c) => c.status === "FAIL"), false, id)
    assert.ok(!v6(run(id)).some((c) => c.id === "V6.result" && c.status === "PASS"), `${id}: SKIPPED nunca vira PASS`)
  }
  // o V6 mostra sempre os 8 checks, na ordem do catálogo
  for (const r of runs) assert.deepEqual(v6(r).map((c) => c.id), CHECK_CATALOG.filter((c) => c.level === "V6").map((c) => c.id))
  assert.equal(CHECK_CATALOG.filter((c) => c.level === "V6").length, 8)
})

test("UNIDADES E LIMITAÇÕES: pernas (LEG) e trades (TRADE) nunca misturados; UNKNOWN/MIXED preservados; divergência declarada e rebaixa a confiança; amostra pequena sem posição; indisponível = null com motivo", () => {
  const d = (id: string) => (run(id).bundle as Any).evidence.derived[0]
  assert.equal(d("exit-analysis").analysis.unit, "TRADE_AND_LEG")
  assert.equal(d("compare-legs").analysis.unit, "LEG")
  assert.equal(d("rank-hour").analysis.unit, "TRADE")
  assert.equal(d("exit-analysis").result.legs.unit, "LEG")
  assert.equal(d("exit-analysis").result.trades.unit, "TRADE")
  assert.deepEqual(d("exit-analysis").result.trades.rows.map((r: Any) => r.bucket), ["TARGET", "STOP", "MANUAL", "MIXED", "UNKNOWN"])
  assert.ok(d("exit-analysis").result.trades.rows.find((r: Any) => r.bucket === "UNKNOWN").trades >= 1)
  assert.ok(d("exit-analysis").result.trades.rows.find((r: Any) => r.bucket === "MIXED").trades >= 1)
  assert.ok(d("exit-analysis").summary.limitations.includes("UNKNOWN_EXIT_REASON"))
  assert.equal(d("divergence").summary.reconciliation, "DIVERGENT")
  assert.equal(d("divergence").summary.confidence, "UNRELIABLE")
  assert.equal(run("divergence").report.status, "VALID", "reproduzível…")
  assert.equal(run("divergence").source.status, "SOURCE_MISMATCH", "…mas o E5b vê que o valor da perna não é o do CSV: as duas verificações dizem coisas diferentes")
  const small = d("small-sample").result.rows
  assert.ok(small.some((r: Any) => r.sampleFlag === "TINY" && r.rank === null), "TINY listado e sem posição")
  assert.equal(d("small-sample").result.rows.length, 5)
  assert.ok(d("unavailable").result.rows.every((r: Any) => r.value.value === null && r.value.reason && r.rank === null))
  assert.equal(d("hash-only").verifiability, "HASH_ONLY")
  assert.deepEqual([d("hash-only").population.tradeIds, (run("hash-only").bundle as Any).evidence.trades.length], [null, 0])
  // toda limitação, código e check mostrado na interface tem texto em português
  const limits = new Set<string>(runs.flatMap((r) => ((r.bundle as Any).evidence?.derived?.[0]?.summary?.limitations ?? []) as string[]))
  for (const l of limits) assert.ok(LIMITATION_HELP[l], `limitação sem texto: ${l}`)
  for (const r of runs) for (const c of v6(r)) { assert.ok(V6_HELP[c.id]); if (c.code) assert.ok(CODE_HELP[c.code], `código sem texto: ${c.code}`) }
})

test("PRIVACIDADE: nenhum nome de conta/estratégia/arquivo nos bundles, relatórios e na visão da interface; rótulos de origem nunca exibidos (redactLabels); o painel não lê sourceLabel/entryLabel/exitLabel", () => {
  for (const r of runs) {
    const shown = J(redactLabels(r.bundle))
    for (const s of SECRETS) {
      assert.equal(J(r.bundle).includes(s), false, `${r.scenario.id}: bundle vazou ${s}`)
      assert.equal(J(r.report).includes(s), false, `${r.scenario.id}: relatório V0–V6 vazou ${s}`)
      assert.equal(J(r.source).includes(s), false, `${r.scenario.id}: relatório E5b vazou ${s}`)
    }
    for (const l of LABELS) {
      if (l === "Saida X") assert.equal(shown.includes(l), false, `${r.scenario.id}: texto livre ${l} na visão da interface`) // S5: palavras do vocabulário (Target1…) agora aparecem de propósito
      const d = (r.bundle as Any).evidence?.derived?.[0]
      if (d) assert.equal(J(d).includes(l), false, `${r.scenario.id}: rótulo ${l} dentro do derivado`)
      assert.equal(J(r.report).includes(l), false)
    }
  }
  assert.ok(J(runs[0].bundle).includes("Target1"), "premissa do teste: a Evidence mantém a palavra do vocabulário nos TradeEvidence (E5b depende dela)")
  assert.ok(/lbl_[0-9a-f]{24}/.test(J(runs[0].bundle)), "rótulo livre ('Saida X') aparece como token na Evidence")
  assert.equal(J(runs[0].bundle).includes("Saida X"), false, "texto livre nunca está na Evidence (S2)")
  assert.ok(J(redactLabels(runs[0].bundle)).includes("Target1"), "S5: a visão mostra a palavra do vocabulário como está")
  for (const f of ["src/lib/dev/evidence-lab/derived.ts", "src/app/dev/evidence-lab/_components/derived-panel.tsx"]) {
    const code = read(f).replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``")
    assert.equal(/\.(sourceLabel|entryLabel|exitLabel)\b/.test(code), false, `${f}: lê rótulo de origem`)
    assert.equal(/\bVega\b|anthropic|openai|fetch\(/i.test(code), false, `${f}: encaminha dados a IA/rede`)
  }
  // contas só como ref nos derivados por conta
  const acc = J((run("compare-acc").bundle as Any).evidence.derived[0].result)
  assert.match(acc, /acc_[0-9a-f]{24}/)
})

test("NAVEGAÇÃO: do derivado às evidências de origem — população, pernas citadas e métricas existem e resolvem para TradeEvidence do bundle", () => {
  for (const id of ["rank-hour", "leg-rank", "exit-analysis"]) {
    const b = run(id).parsed!
    const d = b.evidence.derived![0]
    const ids = new Set(b.evidence.trades.map((t) => t.tradeId))
    assert.deepEqual([...ids].sort(), [...(d.population.tradeIds ?? [])].sort(), id)
    for (const l of d.refs.legs.items ?? []) assert.ok(ids.has(l.tradeId), `${id}: perna fora do bundle`)
  }
  assert.ok((run("leg-rank").parsed!.evidence.derived![0].refs.legs.items ?? []).length > 0)
})

test("VISÃO GERAL: nova camada Derivados com sonda ao vivo ok; pendências E6.5 e sourceLabel registradas; nenhuma integração com Vega IA", () => {
  const layers = read("src/lib/dev/evidence-lab/layers.ts")
  assert.match(layers, /id: "derivados"/)
  assert.match(layers, /id: "sourcelabel"/)
  assert.match(layers, /Nenhum bundle completo vai à Vega IA nesta etapa/)
})

test("REDAÇÃO EM TODAS AS ABAS (inclusive as antigas): o componente Json sempre redige rótulos; tabelas usam maskLabel; nenhum painel renderiza sourceLabel/entryLabel/exitLabel cru", () => {
  assert.equal(maskLabel(null), "—")
  assert.equal(maskLabel(undefined), "—")
  assert.equal(maskLabel(""), "(vazio)")
  assert.equal(maskLabel("Target1"), "Target1", "S5: palavra do vocabulário aparece")
  assert.equal(maskLabel("lbl_0123456789abcdef01234567"), "lbl_0123456789abcdef01234567", "S5: token aparece")
  assert.equal(maskLabel("Meu Setup X"), "«omitido»", "falha fechada: texto livre (não projetado) nunca aparece")
  const sample = { a: { sourceLabel: "Meu Setup X", entryLabel: null, exitLabel: "", deep: [{ sourceLabel: "texto livre 2" }] }, keep: "Target1-nao-e-chave" }
  const red = redactLabels(sample) as Any
  assert.deepEqual([red.a.sourceLabel, red.a.entryLabel, red.a.exitLabel, red.a.deep[0].sourceLabel, red.keep], ["«omitido»", null, "", "«omitido»", "Target1-nao-e-chave"])
  assert.equal(J(sample).includes("Meu Setup X"), true, "a função não altera o original")
  assert.match(read("src/app/dev/evidence-lab/_components/ui.tsx"), /JSON\.stringify\(redactLabels\(value\), null, 2\)/)
  const panels = walk(join(ROOT, "src/app/dev/evidence-lab/_components")).filter((f) => f.endsWith(".tsx"))
  assert.ok(panels.length >= 9)
  for (const f of panels) {
    const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")
    // todo uso de .sourceLabel/.entryLabel/.exitLabel dentro de um painel precisa estar dentro de maskLabel(...)
    for (const m of code.matchAll(/[A-Za-z_]+\.(?:sourceLabel|entryLabel|exitLabel)\b/g)) {
      const before = code.slice(Math.max(0, (m.index ?? 0) - 11), m.index)
      assert.ok(before.endsWith("maskLabel("), `${f.replace(ROOT, "")}: ${m[0]} fora de maskLabel`)
    }
  }
  // todos os bundles do Lab principal (abas antigas), vistos pela interface, não mostram rótulo
  for (const l of ["Saida X"]) assert.equal(J(redactLabels(runs[0].bundle)).includes(l), false, "texto livre nunca visível")
  assert.equal(J(redactLabels({ sourceLabel: "Saida X" })).includes("Saida X"), false, "injeção de texto livre numa chave de rótulo é omitida")
})

test("MÉTRICAS POR CONTA/ESTRATÉGIA: o grupo do motor é mostrado como accountRef/strategyRef (nome em claro nunca); chave nula e outras dimensões mantêm o rótulo do motor; select do bundle usa o mesmo helper", () => {
  const demo = buildDemo()
  const acc = groupsView(demo, { pnl: "NET", r: "NET" }, "account").result.groups
  assert.ok(acc.length >= 2 && acc.some((g) => g.label.includes("Conta Demo")), "premissa: o motor agrupa pelo nome")
  const shown = acc.map((g) => groupLabelView("account", g))
  assert.ok(shown.every((l) => /^acc_[0-9a-f]{24}$/.test(l)), J(shown))
  assert.deepEqual(shown, acc.map((g) => accountRef(g.key[0] as string)))
  const str = groupsView(demo, { pnl: "NET", r: "NET" }, "strategy").result.groups.map((g) => groupLabelView("strategy", g))
  assert.ok(str.every((l) => /^str_[0-9a-f]{24}$/.test(l)))
  assert.equal(str.some((l) => l.includes("Estratégia")), false)
  assert.deepEqual(str, groupsView(demo, { pnl: "NET", r: "NET" }, "strategy").result.groups.map((g) => strategyRef(g.key[0] as string)))
  assert.equal(groupLabelView("account", { key: [null], label: "(desconhecido)" }), "(desconhecido)")
  assert.equal(groupLabelView("hour", { key: ["09"], label: "09:00" }), "09:00")
  assert.equal(groupLabelView(null, { key: ["x"], label: "L" }), "L")
  // nenhum cenário de adulteração injeta nome de conta de verdade (extra-field usa marcador neutro)
  assert.equal(read("src/lib/dev/evidence-lab/model.ts").includes("Conta Demo"), false)
  // nenhum painel renderiza g.label cru
  for (const f of ["src/app/dev/evidence-lab/_components/metrics-panel.tsx", "src/app/dev/evidence-lab/_components/bundle-panel.tsx"]) assert.equal(/\bg\.label\b/.test(read(f).replace(/\/\/.*$/gm, "")), false, f)
})

if (ORIGINAL_ENV === undefined) delete env.NODE_ENV
else env.NODE_ENV = ORIGINAL_ENV
console.log(`\n${passed} testes ok`)
