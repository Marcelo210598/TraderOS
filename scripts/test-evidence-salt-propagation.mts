// Guarda da PROPAGAÇÃO DO SAL: todo ponto que gera Evidence usa o MESMO sal do import em TODOS os refs (accountRef, strategyRef, labelRef, patternRef).
//   node scripts/test-evidence-salt-propagation.mts
// Por quê: esquecer de repassar o sal NUNCA gera um falso "verificado" (é seguro nesse sentido), mas pode parecer ADULTERAÇÃO e confundir a depuração
// — o bug do E5b (sal "a mais" ⇒ falso SOURCE_MISMATCH) ficou 3 etapas sem ser visto. ATENÇÃO (medido neste teste, 3d): sem mapa de usuário o
// resultado é SOURCE_MISMATCH (falso positivo), não UNVERIFIABLE; só com mapa não vazio cai em UNVERIFIABLE, por acaso. Por isso o guarda é
// PREVENTIVO (impede o esquecimento nos call sites) e a lacuna do lado do verificador está registrada em 3d como LACUNA CONHECIDA. Camadas:
//   (1) ESTÁTICA, funções de ref: toda chamada a uma função que recebe sal em src/ nomeia o sal (o padrão silencioso é `salt = ""`);
//   (2) ESTÁTICA, call sites: todo `explainTrade(s)/explainMetric/explainDerived` em src/ passa o sal OU está numa lista de exceções "sem sal por
//       projeto" (demo do Lab), com justificativa e checagem de que o arquivo nunca importa com sal;
//   (3) COMPORTAMENTAL: gera Evidence de um import SALGADO com os 4 tipos de ref presentes por todos os geradores e verifica que NENHUM ref foi
//       calculado com sal vazio; um controle negativo prova que o teste enxerga o erro.
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { derivedEvidenceBundle, explainDerived } from "../src/lib/evidence/explain-derived.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { explainTrades } from "../src/lib/evidence/explain-trade.ts"
import { verifyEvidence } from "../src/lib/evidence/verify.ts"
import { verifyEvidenceSource } from "../src/lib/evidence/verify-source.ts"
import { accountRef, labelRef, patternRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const SRC = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f))
const rel = (f: string) => f.replace(ROOT, "").replace(/^\//, "")
/** Código sem comentários de linha/bloco (as mensagens de texto ficam; só procuramos chamadas). */
const codeOf = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
/** Texto da chamada que abre em `open` (o índice do "("), com parênteses balanceados. */
function callText(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]
    if (c === "(") depth += 1
    else if (c === ")") { depth -= 1; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open)
}
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

// ── (1) estática: funções de ref com `salt` opcional ─────────────────────────

/** Funções cujo sal tem valor padrão "" (esquecer o argumento NÃO dá erro: gera ref com sal vazio). */
const SALT_FUNCS = ["accountRef", "makeAccountRef", "strategyRef", "makeStrategyRef", "labelRef", "patternRef", "makePatternRef", "projectLabel", "projectReproducibility", "refView", "normalizeSpec", "cycleRowRefs", "entryLegOf", "exitLegOf", "groupLabelView"]
/** Chamadas legítimas sem sal nomeado, com motivo. Chave: arquivo → funções. */
const NO_SALT_OK: Record<string, string[]> = {
  "src/lib/dev/evidence-lab/redact-view.ts": [], // groupLabelView/accountRef daqui recebem `salt` (demo sem sal por padrão, explícito)
  "src/app/dev/evidence-lab/_components/metrics-panel.tsx": ["groupLabelView"], // Lab: o demo é SEM sal por projeto (ver camada 2)
  "src/app/dev/evidence-lab/_components/bundle-panel.tsx": ["groupLabelView"],
}
test("(1) ESTÁTICA — toda chamada a uma função de ref que recebe sal NOMEIA o sal (nada de depender do padrão \"\")", () => {
  const offenders: string[] = []
  let checked = 0
  for (const f of SRC) {
    if (rel(f).endsWith("src/lib/ingest/identity.ts")) continue // as definições
    const src = codeOf(f)
    for (const fn of SALT_FUNCS) {
      for (const m of src.matchAll(new RegExp(`(?<![\\w.])${fn}\\(`, "g"))) {
        const before = src.slice(Math.max(0, (m.index ?? 0) - 9), m.index)
        if (/function\s+$/.test(before) || /const\s+$/.test(before)) continue // definição local
        const call = callText(src, (m.index ?? 0) + fn.length)
        checked += 1
        if (/salt/i.test(call)) continue
        if ((NO_SALT_OK[rel(f).replace(/^\//, "")] ?? []).includes(fn)) continue
        offenders.push(`${rel(f)}: ${fn}${call.slice(0, 70).replace(/\s+/g, " ")}…`)
      }
    }
  }
  assert.ok(checked >= 15, `poucas chamadas inspecionadas (${checked}): o guarda perdeu a visão do código`)
  assert.deepEqual(offenders, [], "chamada sem sal nomeado (gera ref com sal vazio em silêncio)")
})

// ── (2) estática: call sites de geração de Evidence ──────────────────────────

/** Geradores que o Lab chama SEM sal DE PROPÓSITO: todo import do Lab é demo SEM sal. A exceção só vale enquanto o arquivo nunca importa com sal. */
const UNSALTED_BY_DESIGN: Record<string, string> = {
  "src/lib/dev/evidence-lab/model.ts": "demo do Lab: CSV sintético importado SEM sal",
  "src/lib/dev/evidence-lab/derived.ts": "demo dos derivados do Lab: CSV sintético importado SEM sal",
}
test("(2) ESTÁTICA — todo call site de explainTrade(s)/explainMetric/explainDerived em src/ passa o sal (ou está na lista 'sem sal por projeto', com o arquivo provadamente sem sal)", () => {
  const offenders: string[] = []
  const sites: string[] = []
  for (const f of SRC) {
    const src = codeOf(f)
    for (const m of src.matchAll(/(?<![\w.])explain(Trades?|Metric|Derived)\(/g)) {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 24), m.index)
      if (/function\s+$/.test(before) || /export\s+(async\s+)?function\s+$/.test(before)) continue
      const name = `explain${m[1]}`
      const call = callText(src, (m.index ?? 0) + name.length)
      sites.push(`${rel(f)} → ${name}`)
      if (/accountRefSalt|\.\.\.opts|\bopts\b|\.\.\.generatorOpts\(/.test(call)) continue // repassa o sal (ou todo o opts, ou o utilitário ÚNICO das capacidades: ver (2d))
      const why = UNSALTED_BY_DESIGN[rel(f).replace(/^\//, "")]
      if (why) {
        assert.equal(/accountRefSalt/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")), false, `${rel(f)}: exceção 'sem sal' inválida — o arquivo passa a usar sal`)
        continue
      }
      offenders.push(`${rel(f)} → ${name}${call.slice(0, 80).replace(/\s+/g, " ")}…`)
    }
  }
  assert.ok(sites.length >= 6, `call sites vistos: ${sites.length}`)
  assert.deepEqual(offenders, [], "call site de geração de Evidence SEM sal e fora da lista de exceções")
  // as exceções existem de fato (a lista não apodrece)
  for (const f of Object.keys(UNSALTED_BY_DESIGN)) assert.ok(sites.some((s) => s.startsWith(f)), `exceção sem uso: ${f}`)
  // e a propagação interna: explain-metric/explain-derived/verify-source repassam o sal ao explainTrades
  for (const f of ["src/lib/evidence/explain-metric.ts", "src/lib/evidence/explain-derived.ts", "src/lib/evidence/verify-source.ts"]) assert.ok(sites.some((s) => s.startsWith(`${f} → explainTrades`)), f)
})

// ── (2d) o UTILITÁRIO ÚNICO do sal das capacidades (E6.6-7) ────────────────────
// Dentro de src/lib/agent-capabilities/ o repasse do sal é SÓ por `...generatorOpts(ctx)` (salt.ts) e a recusa de import salgado sem sal é SÓ por `saltMissing(ctx)`:
// nada de variável intermediária nem de expressão própria por capacidade. Assim uma capacidade nova não depende de acertar o estilo textual.
test("(2d) ESTÁTICA — nas capacidades, todo call site de explainMetric/explainDerived usa `...generatorOpts(ctx)` e o arquivo chama `saltMissing(ctx)`; salt.ts é a ÚNICA definição e não importa gerador", () => {
  const caps = SRC.filter((f) => rel(f).startsWith("src/lib/agent-capabilities/"))
  const users: string[] = []
  for (const f of caps) {
    const src = codeOf(f)
    if (rel(f).endsWith("/salt.ts")) continue
    const sites = [...src.matchAll(/(?<![\w.])explain(Metric|Derived|Trades?)\(/g)]
    if (sites.length === 0) continue
    users.push(rel(f))
    for (const m of sites) assert.match(callText(src, (m.index ?? 0) + `explain${m[1]}`.length), /\.\.\.generatorOpts\(ctx\)/, `${rel(f)}: call site sem o utilitário único do sal`)
    assert.match(src, /saltMissing\(ctx\)/, `${rel(f)}: sem a recusa de import salgado sem sal`)
    assert.match(src, /from "\.\/salt\.ts"/, `${rel(f)}: não importa o utilitário`)
    assert.equal(/\.accountRefSalt\b|\{\s*accountRefSalt\s*[:,}]|\baccountRefSalt\s*:\s*(?!string)/.test(src), false, `${rel(f)}: acessa/monta accountRefSalt direto (só salt.ts pode; declarar o campo no tipo do contexto é permitido)`)
  }
  assert.ok(users.length >= 2, `capacidades que geram Evidence: ${users.length}`)
  const salt = codeOf(join(ROOT, "src/lib/agent-capabilities/salt.ts"))
  assert.equal(/explain-(?:trade|metric|derived)/.test(salt), false, "salt.ts importa gerador")
  assert.equal((salt.match(/export function generatorOpts/g) ?? []).length, 1)
  assert.equal((salt.match(/export function saltMissing/g) ?? []).length, 1)
  for (const f of SRC) if (!rel(f).startsWith("src/lib/agent-capabilities/")) assert.equal(/generatorOpts|saltMissing/.test(codeOf(f)), false, `${rel(f)}: usa o utilitário fora das capacidades`)
})

// ── (2c) estática: QUEM pode importar um gerador de Evidence ─────────────────
// Fecha a lacuna das camadas 1/2 (só enxergam chamadas de nomes conhecidos): um arquivo NOVO em src/ que importe explain-trade/metric/derived
// (import, re-export ou import dinâmico) FALHA até alguém revisar o uso do sal e incluí-lo aqui. A lista é de revisão humana, não de confiança.
const GENERATOR_IMPORT_RE = /(?:from|import)\s*\(?\s*["'][^"']*explain-(?:trade|metric|derived)(?:\.ts)?["']/g
const APPROVED_GENERATOR_IMPORTERS: Record<string, string> = {
  "src/lib/evidence/explain-metric.ts": "importa explainTrades e repassa o sal (camada 2)",
  "src/lib/evidence/explain-derived.ts": "importa explainTrades e repassa o sal (camada 2)",
  "src/lib/evidence/verify-source.ts": "reingestão do E5b: sal efetivo derivado do import (camada 2, teste S2)",
  "src/lib/agent-capabilities/metrics-query.ts": "capacidade metrics.query@1 (E6.6-5): repassa ctx.accountRefSalt ao explainMetric e RECUSA (ENGINE_REFUSED) import SALGADO sem sal; teste Q14 de test-agent-metrics-query.mts",
  "src/lib/agent-capabilities/metrics-groups.ts": "capacidade metrics.groups@1 (E6.6-6): repassa ctx.accountRefSalt ao explainMetric (TOTAL e cada grupo) e RECUSA (ENGINE_REFUSED) import SALGADO sem sal; teste G11 de test-agent-metrics-groups.mts",
  "src/lib/agent-capabilities/exit-breakdown.ts": "capacidade exit.breakdown@1 (E6.6-7): explainDerived com `...generatorOpts(ctx)` e `saltMissing(ctx)` (utilitário único, guarda 2d); teste X10 de test-agent-exit-breakdown.mts",
  "src/lib/agent-capabilities/metrics-compare.ts": "capacidade metrics.compare@1 (E6.6-8): explainDerived com `...generatorOpts(ctx)` e `saltMissing(ctx)` (utilitário único, guarda 2d); sem sal próprio; teste K9 de test-agent-metrics-compare.mts (salgado sem sal ⇒ ENGINE_REFUSED; com sal ⇒ ok)",
  "src/lib/agent-capabilities/exit-analysis.ts": "capacidade exit.analysis@1 (E6.6-10): 2 explainDerived (análise + comparação) com `...generatorOpts(ctx)` e `saltMissing(ctx)` (utilitário único, guarda 2d); sem sal próprio; teste Y12 de test-agent-exit-analysis.mts (salgado sem sal ⇒ ENGINE_REFUSED; com sal ⇒ ok)",
  "src/lib/agent-capabilities/rank-groups.ts": "capacidade rank.groups@1 (E6.6-9): explainDerived com `...generatorOpts(ctx)` e `saltMissing(ctx)` (utilitário único, guarda 2d); sem sal próprio; teste L12 de test-agent-rank-groups.mts (salgado sem sal ⇒ ENGINE_REFUSED; com sal ⇒ ok)",
  "src/lib/dev/evidence-lab/salt.ts": "cenários de sal do Lab (P5, só dev): imports gerenciados e legado com sal esquecido DE PROPÓSITO (cenário salt-forgotten)",
  "src/lib/dev/evidence-lab/model.ts": "demo do Lab SEM sal por projeto (UNSALTED_BY_DESIGN)",
  "src/lib/dev/evidence-lab/derived.ts": "demo dos derivados do Lab SEM sal por projeto (UNSALTED_BY_DESIGN)",
}
const generatorImporters = (text: string): boolean => new RegExp(GENERATOR_IMPORT_RE.source).test(text)
test("(2c) ESTÁTICA — só arquivos APROVADOS importam explain-trade/metric/derived; arquivo novo falha até ser revisado (e a aprovação não apodrece)", () => {
  const importers = SRC.filter((f) => generatorImporters(codeOf(f))).map((f) => rel(f).replace(/^\//, ""))
  const unapproved = importers.filter((f) => !(f in APPROVED_GENERATOR_IMPORTERS))
  assert.deepEqual(unapproved, [], "arquivo novo importa um gerador de Evidence: revise o sal dos 3 refs (str/lbl/pat) e inclua em APPROVED_GENERATOR_IMPORTERS")
  for (const f of Object.keys(APPROVED_GENERATOR_IMPORTERS)) assert.ok(importers.includes(f), `aprovação sem uso: ${f}`)
  // controle negativo do DETECTOR: as formas de import que um desenvolvedor usaria são vistas
  for (const code of [`import { explainTrades } from "../evidence/explain-trade.ts"`, `export { explainMetric } from "./explain-metric"`, `const m = await import("@/lib/evidence/explain-derived.ts")`, `import x from '../explain-trade'`]) assert.equal(generatorImporters(code), true, code)
  for (const code of [`import { x } from "./explain-other.ts"`, `import { y } from "./verify.ts"`]) assert.equal(generatorImporters(code), false, code)
})

test("(2b) ESTÁTICA — dentro do explain-trade só existe UMA fonte de sal (`opts.accountRefSalt ?? \"\"`): nenhum ref usa sal literal ou outra variável", () => {
  const src = codeOf(join(ROOT, "src/lib/evidence/explain-trade.ts"))
  const uses = [...src.matchAll(/accountRefSalt[^\n]*/g)].map((m) => m[0])
  assert.ok(uses.length >= 7, `usos do sal: ${uses.length}`)
  // cada função de ref chamada em explain-trade recebe o sal derivado de opts (direta ou via helper `salt`)
  for (const fn of ["makeStrategyRef", "makeAccountRef", "projectReproducibility", "cycleRowRefs", "entryLegOf", "exitLegOf"]) {
    for (const m of src.matchAll(new RegExp(`(?<![\\w.])${fn}\\(`, "g"))) {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 9), m.index)
      if (/function\s+$/.test(before) || /const\s+$/.test(before)) continue
      assert.match(callText(src, (m.index ?? 0) + fn.length), /accountRefSalt \?\? ""|\bsalt\b/, `${fn} sem o sal de opts`)
    }
  }
  assert.equal(/(makeStrategyRef|makeAccountRef|projectLabel|makePatternRef)\([^)]*,\s*""\s*\)/.test(src), false, "sal literal vazio")
})

// ── (3) comportamental ───────────────────────────────────────────────────────

const SALT = "sal-propagacao-7"
const MAP = [{ pattern: "^meu stop", reason: "STOP" as const }]
const d = (day: number, hms: string) => `${String(day).padStart(2, "0")}/03/2026 ${hms}`
const ROWS: SynthRow[] = [
  { account: "Conta Alfa Secreta", entryPrice: 2000, exitPrice: 1996, entryAt: d(2, "09:00:00"), exitAt: d(2, "09:10:00"), exitLabel: "meu stop 1" },
  { account: "Conta Alfa Secreta", entryPrice: 2000, exitPrice: 2004, entryAt: d(3, "09:00:00"), exitAt: d(3, "09:10:00"), exitLabel: "Meu Setup X" },
  { account: "Conta Beta Secreta", entryPrice: 2000, exitPrice: 2003, entryAt: d(4, "09:00:00"), exitAt: d(4, "09:10:00"), exitLabel: "Target1" },
  { account: "Conta Beta Secreta", entryPrice: 2000, exitPrice: 1997, entryAt: d(5, "09:00:00"), exitAt: d(5, "09:10:00"), exitLabel: "Stop1" },
]
const CSV = synthCsv(ROWS)
const run = runImportPipeline(CSV, { sourceTz: "America/Sao_Paulo", fileName: "sal.csv", accountRefSalt: SALT, exitReasonMap: MAP })
const record = run.importRecord as ImportRecord
const T = toAnalyticsTrades(run.trades)
const FILES = { [record.importId]: new TextEncoder().encode(CSV) }
const REFS = /\b(acc|str|lbl|pat)_[0-9a-f]{24}\b/g
const refsOf = (x: unknown) => [...JSON.stringify(x).matchAll(REFS)].map((m) => m[0])
const expected = (salt: string) => ({
  acc: ["Conta Alfa Secreta", "Conta Beta Secreta"].map((n) => accountRef(n, salt) as string),
  str: [strategyRef("Estrategia Teste", salt) as string],
  lbl: ["meu stop 1", "Meu Setup X"].map((n) => labelRef(n, salt) as string),
  pat: [patternRef("^meu stop", salt)],
})
const flat = (salt: string) => new Set(Object.values(expected(salt)).flat())
const kind = (r: string) => r.slice(0, 3)

const GENERATORS: Record<string, () => Any> = {
  "explainTrades (direto)": () => explainTrades(run.trades, record, { accountRefSalt: SALT }).map((r: Any) => ({ t: r.tradeEvidence, i: r.importRef })),
  "explainMetric": () => {
    const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
    const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record], opts: { accountRefSalt: SALT } })
    assert.equal(r.ok, true); return metricEvidenceBundle(r as Any)
  },
  "explainDerived (ranking por conta)": () => { const r = explainDerived({ spec: { op: "GROUP_RANKING", args: { groupBy: "account" }, options: { timeZone: "America/Sao_Paulo", minSample: 2 } }, trades: T, importRecords: [record], opts: { accountRefSalt: SALT } }); assert.equal(r.ok, true); return derivedEvidenceBundle(r as Any) },
  "explainDerived (análise por motivo)": () => { const r = explainDerived({ spec: { op: "EXIT_REASON_ANALYSIS", args: {}, options: { timeZone: "America/Sao_Paulo", minSample: 2 } }, trades: T, importRecords: [record], opts: { accountRefSalt: SALT } }); assert.equal(r.ok, true); return derivedEvidenceBundle(r as Any) },
}

test("(3) COMPORTAMENTAL — import SALGADO com conta, estratégia, rótulo livre e mapa do usuário: TODOS os geradores produzem os 4 tipos de ref e NENHUM com sal vazio", () => {
  const withSalt = expected(SALT)
  const empty = flat("")
  for (const [name, gen] of Object.entries(GENERATORS)) {
    const out = gen()
    const found = refsOf(out)
    const kinds = new Set(found.map(kind))
    assert.deepEqual([...kinds].sort(), ["acc", "lbl", "pat", "str"], `${name}: faltou algum tipo de ref (o teste perdeu sensibilidade)`)
    const ok = flat(SALT)
    for (const r of found) {
      assert.ok(ok.has(r), `${name}: ref ${r} não é nenhum dos esperados COM o sal do import`)
      assert.equal(empty.has(r), false, `${name}: ref ${r} foi calculado com sal VAZIO (sal não propagado)`)
    }
    // cada tipo aparece com o valor esperado
    for (const k of ["acc", "str", "lbl", "pat"] as const) assert.ok(found.some((r) => (withSalt[k] as string[]).includes(r)), `${name}: nenhum ${k}_ esperado encontrado`)
    assert.equal(JSON.stringify(out).includes(SALT), false, `${name}: o sal nunca é gravado`)
  }
})

test("(3b) COMPORTAMENTAL — os bundles gerados com o sal CERTO são verificáveis de ponta a ponta com o MESMO sal: VALID + SOURCE_VERIFIED (mapa informado)", () => {
  for (const name of ["explainMetric", "explainDerived (ranking por conta)", "explainDerived (análise por motivo)"]) {
    const b = GENERATORS[name]()
    assert.equal(verifyEvidence(b).status, "VALID", name)
    const s = verifyEvidenceSource(b, FILES, { accountRefSalt: SALT, exitReasonMap: MAP })
    assert.equal(s.status, "SOURCE_VERIFIED", `${name}: ${JSON.stringify(s.checks.filter((c) => c.status !== "PASS"))}`)
  }
})

test("(3c) CONTROLE NEGATIVO — gerar a Evidence SEM repassar o sal (o esquecimento que o guarda existe para pegar): str/lbl/pat saem com sal vazio; COM mapa de usuário o verificador dá UNVERIFIABLE (nunca FAIL) e este teste ENXERGA o erro", () => {
  const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record] }) // ← sem opts.accountRefSalt
  assert.equal(r.ok, true)
  const bad = metricEvidenceBundle(r as Any)
  const found = refsOf(bad)
  const empty = flat("")
  const saltedKinds = new Set(found.filter((x) => flat(SALT).has(x) && !empty.has(x)).map(kind))
  const emptyKinds = new Set(found.filter((x) => empty.has(x)).map(kind))
  assert.deepEqual([...emptyKinds].sort(), ["lbl", "pat", "str"], "str/lbl/pat saem com sal vazio")
  assert.deepEqual([...saltedKinds], ["acc"], "só o accountRef sobrevive (vem pronto do import, por isso o erro passa despercebido)")
  const s = verifyEvidenceSource(bad, FILES, { accountRefSalt: SALT, exitReasonMap: MAP })
  assert.equal(s.checks.some((c) => c.status === "FAIL"), false, "falha segura: não vira adulteração")
  assert.notEqual(s.status, "SOURCE_VERIFIED")
  assert.equal(s.status, "UNVERIFIABLE")
  // o mesmo bundle, com o sal EXATAMENTE como foi gerado (vazio), seria verificado para um import sem sal — o problema é o descasamento
  assert.equal(verifyEvidence(bad).status, "VALID", "o V0–V4 não enxerga o descasamento de sal (só o E5b)")
})

test("(3d) LACUNA CONHECIDA (decisão pendente do Marcelo) — esquecer o sal na GERAÇÃO, SEM mapa de usuário, dá SOURCE_MISMATCH (parece adulteração), não UNVERIFIABLE; nunca dá um falso 'verificado'", () => {
  const plain = runImportPipeline(CSV, { sourceTz: "America/Sao_Paulo", fileName: "sal2.csv", accountRefSalt: SALT }) // import SALGADO, mapa VAZIO
  const rec2 = plain.importRecord as ImportRecord
  const T2 = toAnalyticsTrades(plain.trades)
  const t2 = calculateMetricsTraced(T2, { timeZone: "America/Sao_Paulo" })
  const make = (opts?: { accountRefSalt: string }) => metricEvidenceBundle(explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t2.result, trace: t2.trace }, trades: T2, importRecords: [rec2], ...(opts ? { opts } : {}) }) as Any)
  const files2 = { [rec2.importId]: new TextEncoder().encode(CSV) }
  const verify = (b: Any) => verifyEvidenceSource(b, files2, { accountRefSalt: SALT })
  // com o sal propagado: ok
  assert.equal(verify(make({ accountRefSalt: SALT })).status, "SOURCE_VERIFIED")
  // esquecendo o sal: o que acontece HOJE (documentado; se o E5b passar a diagnosticar isso como UNVERIFIABLE, atualize esta asserção e o CHANGELOG)
  const forgot = verify(make())
  assert.equal(forgot.status, "SOURCE_MISMATCH", "lacuna conhecida: falso positivo que lembra adulteração")
  assert.equal(forgot.checks.find((c) => c.id === "V5.trades")!.code, "V_TRADE_STRUCTURE_MISMATCH")
  assert.notEqual(forgot.status, "SOURCE_VERIFIED", "mas NUNCA verifica em falso")
  // decisão do Marcelo: pista de diagnóstico no TEXTO, sem mudar veredito nem código
  assert.match(forgot.checks.find((c) => c.id === "V5.trades")!.detail, /possível causa: o sal do import não foi propagado na geração/, "pista de diagnóstico presente")
  // adulteração genuína (token/valor trocado, sal correto) NÃO recebe a pista de sal
  const forged = JSON.parse(JSON.stringify(make({ accountRefSalt: SALT })))
  forged.evidence.trades[0].netPnl = { ...forged.evidence.trades[0].netPnl, value: "999999" }
  const fv = verify(forged)
  assert.equal(JSON.stringify(fv.checks).includes("possível causa: o sal"), false, "sem pista quando o sal está certo")
  assert.equal(verifyEvidence(make()).status, "VALID", "o V0–V4 não enxerga o descasamento de sal")
})

console.log(`\n${passed} testes ok`)
