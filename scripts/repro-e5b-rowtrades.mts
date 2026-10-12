// Reprodução + medidas da investigação e5b-rowtrades (NÃO está no test:domain; imprime o que o código faz HOJE).
//   node scripts/repro-e5b-rowtrades.mts            (usa src/lib/evidence/verify-source.ts)
//   E5B_MODULE=../src/lib/evidence/verify-source.exp.ts node scripts/repro-e5b-rowtrades.mts   (cópia experimental descartável)
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainMetric, metricEvidenceBundle } from "../src/lib/evidence/explain-metric.ts"
import { computeEvidenceHash } from "../src/lib/evidence/hash.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../src/lib/metrics/index.ts"
import { synthCsv } from "./_evidence-fixtures.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const mod = await import(process.env.E5B_MODULE ?? "../src/lib/evidence/verify-source.ts")
const verifyEvidenceSource = mod.verifyEvidenceSource as typeof import("../src/lib/evidence/verify-source.ts").verifyEvidenceSource
console.log(`# módulo: ${process.env.E5B_MODULE ?? "src/lib/evidence/verify-source.ts"}`)
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const d = (n: number) => `${String(n).padStart(2, "0")}/03/2026`
const CSV = synthCsv([
  { account: "Conta A", entryPrice: 2000, exitPrice: 1996, entryAt: `${d(2)} 09:00:00`, exitAt: `${d(2)} 09:10:00`, exitLabel: "Stop1" },
  { account: "Conta A", entryPrice: 2000, exitPrice: 2004, entryAt: `${d(2)} 09:20:00`, exitAt: `${d(2)} 09:30:00`, exitLabel: "Target1" },
  { account: "Conta B", entryPrice: 2000, exitPrice: 2003, entryAt: `${d(4)} 09:00:00`, exitAt: `${d(4)} 09:10:00`, exitLabel: "Target1" },
])
const bundleOf = (trades: Any[], record: ImportRecord) => {
  const T = toAnalyticsTrades(trades)
  const t = calculateMetricsTraced(T, { timeZone: "America/Sao_Paulo" })
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [record] })
  if (!(r as Any).ok) throw new Error(`explainMetric falhou: ${(r as Any).message}`)
  return metricEvidenceBundle(r as Any) as Any
}
const show = (name: string, r: Any) => {
  const bad = r.checks.filter((c: Any) => c.status !== "PASS" && c.status !== "SKIPPED" || (c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE"))
  console.log(`${name.padEnd(44)} ${r.status}  ${bad.map((c: Any) => `${c.id}:${c.code}`).join(" ") || "—"}`)
}

// ── sintético, reconstrução LIGADA ───────────────────────────────────────────
const on = runImportPipeline(CSV, { sourceTz: "America/Sao_Paulo", fileName: "rows.csv" })
const recOn = on.importRecord as ImportRecord
const filesOn = { [recOn.importId]: new TextEncoder().encode(CSV) }
console.log(`\n# sintético: ${on.rowTrades.length} linhas → ${on.trades.length} ciclos (reconstrução ligada)`)
const idsRows = new Set(on.rowTrades.map((t: Any) => t.tradeId as string))
const idsCycles = new Set(on.trades.map((t: Any) => t.tradeId as string))
console.log(`  ids de linha ∩ ids de ciclo = ${[...idsRows].filter((x) => idsCycles.has(x)).length} (0 ⇒ espaços de id disjuntos)`)
const R1 = bundleOf(on.rowTrades, recOn)
const r1 = verifyEvidenceSource(R1, filesOn)
show("R1 linhas, reconstrução LIGADA", r1)
const failIds = (r1.checks.find((c: Any) => c.id === "V5.trades")?.detail.match(/trd_[0-9a-f]{8}/g) ?? []) as string[]
const full = (p: string) => [...idsRows].find((x) => x.startsWith(p))
console.log(`M1  ids citados no FAIL: ${failIds.length}; todos ∈ rowTrades: ${failIds.every((p) => !!full(p))}; algum ∈ ciclos: ${failIds.some((p) => [...idsCycles].some((c) => c.startsWith(p)))}`)
const R3 = bundleOf(on.trades, recOn)
show("R3 ciclos, reconstrução ligada", verifyEvidenceSource(R3, filesOn))

// ── M2: reconstrução DESLIGADA ───────────────────────────────────────────────
const off = runImportPipeline(CSV, { sourceTz: "America/Sao_Paulo", fileName: "rows.csv", reconstructCycles: false })
const recOff = off.importRecord as ImportRecord
const filesOff = { [recOff.importId]: new TextEncoder().encode(CSV) }
console.log(`\n# sintético, reconstrução DESLIGADA: ${off.rowTrades.length} linhas, ${off.trades.length} trades (trades === linhas)`)
show("M2/R2 linhas (reconstrução OFF)", verifyEvidenceSource(bundleOf(off.trades, recOff), filesOff))

// ── negativos ────────────────────────────────────────────────────────────────
console.log("\n# negativos")
{
  const b = clone(R3); b.evidence.trades[0].granularity = "SOURCE_ROW"
  show("R4 ciclo declarado como linha", verifyEvidenceSource(reseal(b), filesOn))
}
{
  const b = clone(R1); b.evidence.trades[0].granularity = "POSITION_CYCLE"
  show("R5 linha declarada como ciclo", verifyEvidenceSource(reseal(b), filesOn))
}
{
  const b = clone(R1); const t = b.evidence.trades[0]
  const before = t.pnl.net
  t.pnl.net = (before ?? 0) + 999
  if (t.pnl.net === before) throw new Error("R6: o forge não alterou o valor (premissa do teste)")
  show("R6 valor da linha adulterado (pnl.net)", verifyEvidenceSource(reseal(b), filesOn))
}
{
  const b = clone(R1); const sr = b.evidence.trades[0].sourceRows?.[0] ?? b.evidence.trades[0].source
  if (sr?.rowHash) sr.rowHash = "0".repeat(64)
  show("R7 rowHash da linha trocado", verifyEvidenceSource(reseal(b), filesOn))
}
{
  const b = clone(R1); b.evidence.trades[0].tradeId = "trd_" + "0".repeat(32)
  show("R8 tradeId inexistente", verifyEvidenceSource(reseal(b), filesOn))
}
{ // M4/R9: ciclo + uma linha que pertence a ele
  const cycle = on.trades.find((t: Any) => (t.sourceRows?.length ?? 0) > 1) ?? on.trades[0]
  const rowOfCycle = on.rowTrades.find((t: Any) => cycle.sourceRows?.some((s: Any) => s.rowNo === t.source.rowNo)) ?? on.rowTrades[0]
  show("M4/R9 misto: ciclo + linha desse ciclo", verifyEvidenceSource(bundleOf([cycle, rowOfCycle], recOn), filesOn))
}

// ── fixtures reais ───────────────────────────────────────────────────────────
const DIR = join(ROOT, "fixtures/ninjatrader/trade-performance")
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
console.log("\n# fixtures reais (local)")
for (const nm of names) {
  const tag = nm.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, nm), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8"))
  const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
  const rec = run.importRecord as ImportRecord
  const files = { [rec.importId]: new TextEncoder().encode(text) }
  const o = { ...(ctx.accountRefSalt ? { accountRefSalt: ctx.accountRefSalt } : {}), ...(ctx.exitReasonMap ? { exitReasonMap: ctx.exitReasonMap } : {}) }
  console.log(`  ${tag.slice(0, 10)}…: ${run.rowTrades.length} linhas → ${run.trades.length} ciclos`)
  show("  R11 linhas", verifyEvidenceSource(bundleOf(run.rowTrades, rec), files, o))
  show("  ciclos (controle)", verifyEvidenceSource(bundleOf(run.trades, rec), files, o))
}
