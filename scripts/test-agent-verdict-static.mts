// E6.6-0e: guardas ESTÁTICOS do §6.1 item 3 (nenhum veredito nasce sem `combineVerdict`) + docs sincronizados com o fechamento.
// Expectativa escrita antes do teste: scripts/expectations/verdict-combine.expected.json (history 'E6.6-0e' + `static_cases_for_0e`, G1–G4).
// LIMITAÇÃO (mesma classe dos outros guardas textuais): provam presença/ausência de TEXTO no código, não o fluxo real de dados.
//   node scripts/test-agent-verdict-static.mts
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const base = (f: string) => f.slice(f.lastIndexOf("/") + 1)
const files = walk(join(ROOT, "src/lib/agent")).filter((f) => /\.ts$/.test(f)).map((f) => ({ name: base(f), code: strip(readFileSync(f, "utf8")) }))
const others = files.filter((f) => f.name !== "verdict.ts")
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

const VALUES = "VERIFIED_PARTIAL|VERIFIED|NOT_VERIFIED|TAMPERED_OR_MISMATCH"
const QUOTED = `["'\`](?:${VALUES})["'\`]`
const ASSIGN_LITERAL = new RegExp(`\\bcombined\\b["']?\\s*[:=](?!=)\\s*${QUOTED}`)
const INDEX_ASSIGN = /\[\s*["'`]combined["'`]\s*\]\s*=(?!=)/
const MEMBER_ASSIGN = /\.combined\s*=(?!=)/
const CAST = /\bas\s+(?:Verdict|EvidenceHandle)\b/

test("G0 — o varredor enxerga o diretório (verdict.ts, contract.ts, views.ts, phrases.ts) e as regexes pegam o que devem (sanidade do próprio guarda)", () => {
  assert.deepEqual(files.map((f) => f.name).sort(), ["contract.ts", "phrases.ts", "verdict.ts", "views.ts"])
  for (const bad of ['{ combined: "VERIFIED" }', "{ combined:'NOT_VERIFIED' }", "{ combined: `TAMPERED_OR_MISMATCH` }", 'x.combined = "VERIFIED_PARTIAL"', 'x["combined"] = y', "{ \"combined\": \"VERIFIED\" }"]) {
    assert.ok(ASSIGN_LITERAL.test(bad) || INDEX_ASSIGN.test(bad) || MEMBER_ASSIGN.test(bad), `regex não pegou: ${bad}`)
  }
  for (const ok of ["combined: CombinedVerdictSchema", "combined: combineVerdict(v.status, s.status)", "if (v.combined !== combineVerdict(a, b)) {}", "v.combined === \"VERIFIED\""]) {
    assert.equal(ASSIGN_LITERAL.test(ok) || INDEX_ASSIGN.test(ok) || MEMBER_ASSIGN.test(ok), false, `regex pegou o que é legítimo: ${ok}`)
  }
  assert.ok(CAST.test("x as Verdict") && CAST.test("y as EvidenceHandle") && !CAST.test("x as VerdictView"))
})

test("G1 — NINGUÉM fora de verdict.ts atribui um literal de CombinedVerdict a `combined` (nem por objeto, índice ou membro) nem faz cast `as Verdict`/`as EvidenceHandle`: o veredito só nasce de buildVerdict/combineVerdict", () => {
  for (const f of others) {
    assert.equal(ASSIGN_LITERAL.test(f.code), false, `${f.name}: literal de CombinedVerdict atribuído a combined`)
    assert.equal(INDEX_ASSIGN.test(f.code), false, `${f.name}: atribuição por índice em ["combined"]`)
    assert.equal(MEMBER_ASSIGN.test(f.code), false, `${f.name}: atribuição por membro .combined =`)
    assert.equal(CAST.test(f.code), false, `${f.name}: cast para Verdict/EvidenceHandle contorna o buildVerdict`)
  }
  const v = files.find((f) => f.name === "verdict.ts")!.code
  assert.match(v, /combined:\s*combineVerdict\(v\.status,\s*s\.status\)/, "buildVerdict deve derivar o combined da função")
})

test("G2 — `combineVerdict` tem UMA definição (verdict.ts); os 4 valores de CombinedVerdict só aparecem como string em verdict.ts e no enum de contract.ts (sem 2ª derivação); quem usa a função a importa de ./verdict.ts", () => {
  const DEF = /(?:function|const|let|var|class)\s+combineVerdict\b|\bcombineVerdict\s*=(?!=)|\bas\s+combineVerdict\b/g
  const defs = Object.fromEntries(files.map((f) => [f.name, (f.code.match(DEF) ?? []).length]).filter(([, n]) => (n as number) > 0))
  assert.deepEqual(defs, { "verdict.ts": 1 }, "definição de combineVerdict fora de verdict.ts (ou duplicada)")
  const lit = new RegExp(QUOTED, "g")
  for (const f of others) {
    const hits = f.code.match(lit) ?? []
    if (f.name === "contract.ts") {
      assert.equal(hits.length, 4, `contract.ts: os 4 literais devem estar só no enum (achei ${hits.length})`)
      const enumLine = f.code.split("\n").find((l) => /CombinedVerdictSchema\s*=\s*z\.enum\(/.test(l)) ?? ""
      assert.equal((enumLine.match(lit) ?? []).length, 4, "contract.ts: os 4 literais não estão todos na linha do enum CombinedVerdictSchema")
    } else assert.equal(hits.length, 0, `${f.name}: literal de CombinedVerdict fora do enum (2ª derivação?)`)
  }
  const importRe = /import\s*\{[^}]*\bcombineVerdict\b[^}]*\}\s*from\s*"\.\/verdict\.ts"/
  for (const f of others) if (/\bcombineVerdict\s*\(/.test(f.code)) assert.match(f.code, importRe, `${f.name}: usa combineVerdict sem importar de ./verdict.ts`)
  assert.match(files.find((f) => f.name === "contract.ts")!.code, importRe, "contract.ts deve importar combineVerdict")
})

test("G3 — verdict.ts é puro: único import = `import type` de ./contract.ts (sem ciclo de execução); sem Date/Math.random/process/fs/fetch/import()/require; sem estado mutável de módulo", () => {
  const v = files.find((f) => f.name === "verdict.ts")!.code
  assert.deepEqual([...v.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]), ["./contract.ts"], "imports de verdict.ts")
  assert.match(v, /^import type \{[^}]+\} from "\.\/contract\.ts"$/m, "o import de contract.ts deve ser `import type`")
  assert.equal(/\bimport\s*\(|\brequire\s*\(/.test(v), false, "import dinâmico/require")
  assert.equal(/\bexport\s+(?:\*|\{[^}]*\})\s*from\b/.test(v), false, "re-export")
  assert.equal(/\bDate\b|Math\.random|\bprocess\b|\bfetch\b|\bfs\b|\bglobalThis\b|\bcrypto\b|setTimeout|setInterval|performance\./.test(v), false, "dependência de relógio/aleatório/ambiente/rede")
  assert.equal(/^(?:let|var)\s/m.test(v), false, "estado mutável de módulo (let/var)")
  assert.equal(/new\s+(?:Map|Set|WeakMap|WeakSet)\b/.test(v), false, "cache/memória de módulo")
})

test("G4 — DOCS = CÓDIGO: plano §6.1, capabilities §9, CHANGELOG e as expectativas dizem que os itens 1–3 estão FECHADOS (E6.6-0) e que o EvidenceHandleBase NÃO foi necessário; o texto 'aceita hoje' sumiu", () => {
  const section = (doc: string, from: RegExp, to: RegExp) => { const a = doc.search(from); assert.ok(a >= 0, `seção não achada: ${from}`); const rest = doc.slice(a + 1); const b = rest.search(to); return doc.slice(a, b < 0 ? undefined : a + 1 + b) }
  const plano = section(read("docs/ai-partner/agent-contract-plano.md"), /^## 6\.1 /m, /^## 7\. /m)
  assert.match(plano, /FECHADO/)
  assert.match(plano, /EvidenceHandleBase[^\n]*não foi necess/i)
  assert.equal(/ainda aceita/.test(plano), false, "plano §6.1 ainda diz que o schema aceita")
  const caps = section(read("docs/ai-partner/agent-capabilities.md"), /^## 9\. /m, /^## 10\. /m)
  assert.match(caps, /FECHADO/)
  assert.equal(/aceita hoje/.test(caps), false, "capabilities §9 ainda diz que o schema aceita hoje")
  const log = read("docs/ai-partner/CHANGELOG-contratos.md")
  assert.match(log, /^## 2026-10-13 — .*E6\.6-0/m, "CHANGELOG sem a entrada do E6.6-0")
  const e66: Any = JSON.parse(read("scripts/expectations/agent-contract.expected.json")).e66_mandatory_prerequisites
  assert.match(e66.status, /^closed/)
  assert.match(e66.technical_note, /não foi necess/i)
  assert.equal(/aceita verify=TAMPERED/.test(e66.known_gap_today), false, "known_gap_today ainda descreve a lacuna como aberta")
})

console.log(`\n${passed} testes ok`)
