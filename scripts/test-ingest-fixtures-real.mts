// Valida os parsers contra exports REAIS anonimizados em fixtures/<plataforma>/<tipo>/ : node scripts/test-ingest-fixtures-real.mts
//   <nome>.csv            export real, sem editar
//   <nome>.context.json   o que só o usuário sabe: { sourceTz, dateOrder?, numberLocale?, excursionUnit?, … }
//   <nome>.expected.json  (opcional) trades conferidos à mão: { "trades": [ { "row": 2, "entry": "…Z", "exit": "…Z",
//                         "entryPrice": n, "exitPrice": n, "quantity": n, "gross": n|null, "net": n|null, "direction": "LONG" } ] }
// Sem arquivos reais → passa (nada a validar). Plataformas SEM parser (Tradovate, Rithmic) → "pendente", não falha:
// o parser só nasce de um arquivo real (não inventamos formato).
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
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
  console.log("• nenhuma fixture REAL ainda (fixtures/tradovate, ninjatrader, rithmic vazias) — nada a validar.")
  console.log("  Forneça exports reais anonimizados seguindo fixtures/README.md.")
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
      if (e.quantity !== undefined) assert.equal(t.quantity, e.quantity, `${rel}:${e.row} quantidade`)
      if (e.direction !== undefined) assert.equal(t.direction, e.direction, `${rel}:${e.row} direção`)
      if (e.gross !== undefined) assert.equal(t.pnl.gross, e.gross, `${rel}:${e.row} P&L bruto`)
      if (e.net !== undefined) assert.equal(t.pnl.net, e.net, `${rel}:${e.row} P&L líquido`)
    }
  }
  console.log(`✓ ${rel}: ${r.stats.accepted} aceitas, ${r.stats.rejected} rejeitadas, ${r.stats.warnings} avisos (${r.parser?.id})`)
  validated += 1
}

console.log(`\n${validated} fixture(s) real(is) validada(s), ${pending} pendente(s) de parser`)
