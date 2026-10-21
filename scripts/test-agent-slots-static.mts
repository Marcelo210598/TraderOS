// E6.6-1: guardas ESTÁTICOS do formatador, do resolvedor e do projetor de rótulo. Teste escrito ANTES do código.
// Expectativa: scripts/expectations/agent-answer.expected.json → e66_1.static_guards (S1–S4).
// LIMITAÇÃO (mesma classe dos outros guardas textuais): provam presença/ausência de TEXTO, não o fluxo real de dados.
//   node scripts/test-agent-slots-static.mts
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const base = (f: string) => f.slice(f.lastIndexOf("/") + 1)
const all = walk(join(ROOT, "src/lib/agent")).filter((f) => /\.ts$/.test(f)).map((f) => ({ name: base(f), code: strip(readFileSync(f, "utf8")) }))
const NEW = ["format.ts", "slot-path.ts", "label.ts"]
const mine = all.filter((f) => NEW.includes(f.name))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

test("S0 — sanidade: os 3 arquivos novos existem e o varredor os enxerga; o diretório tem EXATAMENTE os 15 arquivos esperados", () => {
  for (const f of NEW) assert.equal(existsSync(join(ROOT, "src/lib/agent", f)), true, f)
  assert.deepEqual(all.map((f) => f.name).sort(), ["catalog.ts", "contract.ts", "format.ts", "label.ts", "ledger.ts", "lexicon.ts", "phrases.ts", "render.ts", "slot-path.ts", "system-prompt.ts", "turn.ts", "validate-answer.ts", "validate-structure.ts", "validate-text.ts", "verdict.ts", "views.ts"])
  assert.equal(mine.length, 3)
})

test("S1/S4 — os arquivos novos importam SÓ 'zod' e './'; nunca evidence/, metrics/, ingest/, domain/ nem agent-capabilities/ (o agent/ continua puro, SG1)", () => {
  for (const f of mine) {
    const refs = [...f.code.matchAll(/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]) // import/export de uma linha (os arquivos usam só essa forma)
    assert.equal(/^(?:import|export)\s[^\n]*\bfrom\s*$/m.test(f.code) || /^import\s*["']/m.test(f.code), false, `${f.name}: import em várias linhas ou sem origem (o guarda só lê a forma de uma linha)`)
    for (const r of refs) assert.ok(r === "zod" || r.startsWith("./"), `${f.name}: import fora do permitido: ${r}`)
    assert.equal(/evidence\/|metrics\/|ingest\/|domain\/|agent-capabilities|prisma|process\.env|\bfetch\s*\(|node:|localStorage/i.test(f.code), false, `${f.name}: dependência proibida`)
    assert.equal(/\bimport\s*\(|\brequire\s*\(/.test(f.code), false, `${f.name}: import dinâmico/require`)
  }
})

test("S2 — UMA implementação do projetor: 'rótulo personalizado' só em label.ts (e na regex de views.ts); 'Conta ' e 'Estratégia ' como TEXTO de alias só em label.ts (e a regex de views.ts)", () => {
  const withText = (needle: RegExp) => all.filter((f) => needle.test(f.code)).map((f) => f.name).sort()
  assert.deepEqual(withText(/rótulo personalizado/), ["label.ts", "views.ts"])
  assert.deepEqual(withText(/["'`]Conta /), ["label.ts"])
  assert.deepEqual(withText(/Conta \[A-Z\]/), ["views.ts"])
  assert.deepEqual(withText(/Estratégia /), ["label.ts"])
  // o texto "(sem rótulo)" também só nasce no projetor (e aparece escapado, `\\)`, na regex da view)
  assert.deepEqual(withText(/\(sem rótulo\\?\)/), ["label.ts", "views.ts"])
  // quem produz rótulo para o modelo usa projectLabelView; nenhum outro arquivo define função com esse nome
  const defs = all.filter((f) => /(?:function|const)\s+projectLabelView\b/.test(f.code)).map((f) => f.name)
  assert.deepEqual(defs, ["label.ts"])
})

test("S3 — format.ts, slot-path.ts e label.ts são exatos e determinísticos: sem toFixed/toPrecision/Math.round/Math.floor/Math.trunc/parseFloat/Intl/toLocale*/Date/Math.random/performance/setTimeout/globalThis", () => {
  for (const f of mine) {
    assert.equal(/\.toFixed\b|\.toPrecision\b|\.toExponential\b|Math\.(?:round|floor|ceil|trunc|random)\b|parseFloat|\bIntl\b|toLocale|\bDate\b|performance\.|setTimeout|setInterval|globalThis/.test(f.code), false, `${f.name}: aritmética de ponto flutuante/relógio/aleatório/locale`)
    assert.equal(/^(?:let|var)\s/m.test(f.code), false, `${f.name}: estado mutável de módulo`)
    assert.equal(/new\s+(?:Map|Set|WeakMap|WeakSet)\b/.test(f.code.split("\n").filter((l) => /^(?:export\s+)?const\s+\w+\s*=\s*new\s/.test(l)).join("\n")), false, `${f.name}: cache de módulo`)
  }
})

test("S5 — o formatador não usa `as` para forçar tipo de unidade/resultado e nenhum arquivo novo escreve a palavra do veredito (combined) nem faz cast para Verdict/EvidenceHandle", () => {
  for (const f of mine) {
    assert.equal(/\bas\s+(?:Verdict|EvidenceHandle)\b/.test(f.code), false, `${f.name}: cast de veredito`)
    assert.equal(/["'`](?:VERIFIED_PARTIAL|VERIFIED|NOT_VERIFIED|TAMPERED_OR_MISMATCH)["'`]/.test(f.code), false, `${f.name}: literal de CombinedVerdict`)
  }
})

console.log(`\n${passed} testes ok`)
