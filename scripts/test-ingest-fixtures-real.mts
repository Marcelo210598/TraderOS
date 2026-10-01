// Valida os parsers contra exports REAIS anonimizados em fixtures/<plataforma>/<tipo>/ : node scripts/test-ingest-fixtures-real.mts
//   <nome>.csv            export real, sem editar
//   <nome>.context.json   o que só o usuário sabe: { sourceTz, dateOrder?, numberLocale?, excursionUnit?, … }
//   <nome>.expected.json  (opcional) trades conferidos à mão: { "trades": [ { "row": 2, "entry": "…Z", "exit": "…Z",
//                         "entryPrice": n, "exitPrice": n, "quantity": n, "gross": n|null, "net": n|null, "direction": "LONG",
//                         "entryLocal"/"exitLocal": "YYYY-MM-DDTHH:mm:ss" (horário do ARQUIVO, no sourceTz — independe de o fuso estar certo),
//                         "commission", "fees", "pointValue", "basis", "mfePoints", "maePoints" ], "netTotal": n, "grossTotal": n }
// Sem arquivos reais → passa (nada a validar). Plataformas SEM parser (Tradovate, Rithmic) → "pendente", não falha:
// o parser só nasce de um arquivo real (não inventamos formato).
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { toLocal } from "../src/lib/domain/time.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"

const ROOT = fileURLToPath(new URL("../fixtures", import.meta.url))
const HAS_PARSER = new Set(["ninjatrader"]) // atualizar quando existirem parsers de tradovate/rithmic

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_") || name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(csv|txt|tsv)$/i.test(name)) out.push(p)
  }
  return out
}

const files = walk(ROOT)
let validated = 0
let pending = 0

if (files.length === 0) {
  console.log("• nenhum export REAL local encontrado (fixtures reais são locais e ignoradas pelo git) — nada a validar.")
  console.log("  Para validar, coloque exports reais seguindo fixtures/README.md.")
}

for (const file of files) {
  const rel = relative(ROOT, file)
  const platform = rel.split("/")[0]
  if (!HAS_PARSER.has(platform)) {
    console.log(`… PENDENTE ${rel}: ainda não há parser de "${platform}" (será escrito a partir deste arquivo real)`)
    pending += 1
    continue
  }
  const ctxPath = file.replace(/\.[^.]+$/, ".context.json")
  assert.ok(existsSync(ctxPath), `${rel}: falta ${relative(ROOT, ctxPath)} (fuso/ordem de data só o usuário sabe)`)
  const ctx = JSON.parse(readFileSync(ctxPath, "utf8")) as ImportContext & { notes?: string }
  const r = runImportPipeline(readFileSync(file, "utf8"), { ...ctx, fileName: rel })

  const fileErrors = r.issues.filter((i) => i.severity === "ERROR")
  assert.equal(fileErrors.length, 0, `${rel}: erros de arquivo → ${fileErrors.map((i) => `${i.code}: ${i.message}`).join(" | ")}`)
  assert.ok(r.stats.accepted > 0, `${rel}: nenhuma linha aceita (${r.stats.rejected} rejeitadas: ${r.rejected[0]?.issues.map((i) => i.code).join(",")})`)

  const expPath = file.replace(/\.[^.]+$/, ".expected.json")
  if (existsSync(expPath)) {
    const exp = JSON.parse(readFileSync(expPath, "utf8")) as { trades: Array<Record<string, unknown>> }
    for (const e of exp.trades) {
      const t = r.trades.find((x) => x.source.rowNo === e.row)
      assert.ok(t, `${rel}: linha ${e.row} não foi aceita`)
      if (e.entry !== undefined) assert.equal(t.entry.at.instantUtc, e.entry, `${rel}:${e.row} entrada UTC`)
      if (e.exit !== undefined) assert.equal(t.exit.at.instantUtc, e.exit, `${rel}:${e.row} saída UTC`)
      if (e.entryPrice !== undefined) assert.equal(t.entry.price, e.entryPrice, `${rel}:${e.row} preço entrada`)
      if (e.exitPrice !== undefined) assert.equal(t.exit.price, e.exitPrice, `${rel}:${e.row} preço saída`)
      if (e.direction !== undefined) assert.equal(t.direction, e.direction, `${rel}:${e.row} direção`)
      if (e.gross !== undefined) assert.equal(t.pnl.gross, e.gross, `${rel}:${e.row} P&L bruto`)
      if (e.net !== undefined) assert.equal(t.pnl.net, e.net, `${rel}:${e.row} P&L líquido`)
      if (e.commission !== undefined) assert.equal(t.pnl.commission, e.commission, `${rel}:${e.row} comissão`)
      if (e.fees !== undefined) assert.equal(t.pnl.fees, e.fees, `${rel}:${e.row} taxas`)
      if (e.pointValue !== undefined) assert.equal(t.instrument.pointValue, e.pointValue, `${rel}:${e.row} pointValue`)
      if (e.basis !== undefined) assert.equal(t.pnl.basis, e.basis, `${rel}:${e.row} base do P&L`)
      if (e.mfePoints !== undefined) assert.equal(t.excursions.mfePoints, e.mfePoints, `${rel}:${e.row} MFE (pts/contrato)`)
      if (e.maePoints !== undefined) assert.equal(t.excursions.maePoints, e.maePoints, `${rel}:${e.row} MAE (pts/contrato)`)
      const tz = ctx.sourceTz as string
      const local = (u: string | null) => (u ? ((l) => `${l.date}T${l.time}`)(toLocal(u, tz)) : null)
      if (e.quantity !== undefined) assert.equal(t.quantity, e.quantity, `${rel}:${e.row} quantidade total`)
      if (e.peakQuantity !== undefined) assert.equal(t.peakQuantity, e.peakQuantity, `${rel}:${e.row} pico de posição`)
      if (e.entryLegs !== undefined) assert.equal(t.entryLegs?.length, e.entryLegs, `${rel}:${e.row} nº de pernas de entrada`)
      if (e.exitLabels !== undefined) assert.deepEqual(t.exitLegs?.map((l) => l.sourceLabel), e.exitLabels, `${rel}:${e.row} rótulos das saídas`)
      if (e.finalReason !== undefined) assert.equal(t.exitSummary?.finalReason, e.finalReason, `${rel}:${e.row} motivo final`)
      if (e.byReason !== undefined) assert.deepEqual(t.exitSummary?.byReason, e.byReason, `${rel}:${e.row} saída por motivo`)
      if (e.confidence !== undefined) assert.equal(t.reconstruction?.confidence, e.confidence, `${rel}:${e.row} confiança`)
      if (e.entryLocal !== undefined) assert.equal(local(t.entry.at.instantUtc), e.entryLocal, `${rel}:${e.row} entrada (local)`)
      if (e.exitLocal !== undefined) assert.equal(local(t.exit.at.instantUtc), e.exitLocal, `${rel}:${e.row} saída (local)`)
    }
    const cents = (xs: Array<number | null>) => Math.round(xs.reduce<number>((a, b) => a + (b ?? 0) * 100, 0)) / 100
    const expTotals = exp as unknown as { netTotal?: number; grossTotal?: number; rowsIn?: number; cycles?: number }
    if (expTotals.rowsIn !== undefined) assert.equal(r.stats.accepted, expTotals.rowsIn, `${rel}: linhas lidas`)
    if (expTotals.cycles !== undefined) assert.equal(r.stats.trades, expTotals.cycles, `${rel}: ciclos reconstruídos`)
    if (expTotals.netTotal !== undefined) assert.equal(cents(r.trades.map((t) => t.pnl.net)), expTotals.netTotal, `${rel}: líquido total`)
    if (expTotals.grossTotal !== undefined) assert.equal(cents(r.trades.map((t) => t.pnl.gross)), expTotals.grossTotal, `${rel}: bruto total`)
  }
  console.log(`✓ ${rel}: ${r.stats.accepted} aceitas, ${r.stats.rejected} rejeitadas, ${r.stats.warnings} avisos (${r.parser?.id})`)
  validated += 1
}

console.log(`\n${validated} fixture(s) real(is) validada(s), ${pending} pendente(s) de parser`)
