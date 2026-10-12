// S1 do plano do sourceLabel: `labelRef` (token) e `projectLabel` (vocabulário fechado v1).   node scripts/test-evidence-label-vocab.mts
// A tabela de casos vem de scripts/expectations/sourcelabel.expected.json, escrita ANTES do código (S0). Ainda NÃO está ligada ao explain-trade (S2).
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { sha256Hex } from "../src/lib/infra/hash.ts"
import { accountRef, labelRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { LABEL_TOKEN_RE, LABEL_VOCAB_VERSION, isProjectedLabel, isVocabLabel, projectLabel } from "../src/lib/evidence/label-vocab.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const exp = JSON.parse(readFileSync(join(ROOT, "scripts/expectations/sourcelabel.expected.json"), "utf8")) as Any
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const TOKEN = /^lbl_[0-9a-f]{24}$/
const hex = (t: string | null) => (t ?? "").replace(/^[a-z]{3}_/, "")

test("EXPECTATIVA (escrita antes do código): as 36 linhas da tabela de projeção — vocabulário v1 estrito (decisões A e B), tudo fora vira token", () => {
  assert.equal(exp._meta.before_implementation, true)
  assert.equal(LABEL_VOCAB_VERSION, exp.vocabulary.version)
  assert.ok(exp.projection.length >= 36)
  for (const c of exp.projection) {
    const out = projectLabel(c.in)
    if (c.out === "TOKEN") assert.match(out ?? "", TOKEN, `${JSON.stringify(c.in)} → deveria ser token (${c.note})`)
    else assert.equal(out, c.out, `${JSON.stringify(c.in)} (${c.note})`)
  }
})

test("DECISÕES: Flat e Close FORA da v1 (decisão A); sufixo de 0 a 2 dígitos (B); nome padrão do NT8 fora; prefixo ≠ lista (StopLossCustom é token)", () => {
  for (const x of ["Flat", "Close", "flat", "CLOSE", "Stop loss", "Profit target", "Exit on session close", "Buy", "Sell", "StopLossCustom", "Target100", "Stop100", "Target 1", "Target1a"]) assert.match(projectLabel(x) ?? "", TOKEN, x)
  for (const x of ["Target", "Target0", "Target99", "Stop", "Stop00", "Stop99", "Entry", "Zerar"]) assert.equal(projectLabel(x), x, x)
  // não é uma lista de prefixos: só a string inteira
  for (const x of ["Entry1", "Entry ", "Zerar2", "Zerarr", "Entrada"]) assert.equal(isVocabLabel(x.trim()) && x === x.trim(), x === "Entry" || x === "Zerar", x)
})

test("CARACTERES DISFARÇADOS: espaço no meio, invisível (U+200B), dígito de outro alfabeto, largura total, 'l' no lugar de '1' ⇒ token (nada passa por quase-igual)", () => {
  for (const x of ["Tar get1", "Target1​", "​Target1", "Target١", "Ｔａｒｇｅｔ１", "Targetl", "Stop 1", "Stop\t1"]) assert.match(projectLabel(x) ?? "", TOKEN, JSON.stringify(x))
  // espaços comuns nas pontas são aparados; NBSP/TAB nas pontas também são espaço para trim()
  assert.equal(projectLabel("  Target1  "), "Target1")
  assert.equal(projectLabel("\tStop2\n"), "Stop2")
})

test("TOKEN: formato, determinismo, variantes de caixa/acento/espaço dão o mesmo token, textos diferentes dão tokens diferentes, o sal muda o token", () => {
  const t = labelRef("Meu Setup X") as string
  assert.match(t, TOKEN)
  assert.equal(labelRef("Meu Setup X"), t)
  for (const group of exp.token.sameForVariants) for (const v of group) assert.equal(labelRef(v), t, v)
  for (const [a, b] of exp.token.differentForDifferentText) assert.notEqual(labelRef(a), labelRef(b))
  for (const [x, sa, sb] of exp.token.differentWithSalt) assert.notEqual(labelRef(x, sa), labelRef(x, sb))
  assert.notEqual(labelRef("Meu Setup X", "sal"), t)
  assert.equal(labelRef(null), null)
  assert.equal(labelRef(""), null)
  assert.equal(labelRef("   "), null)
  // a projeção usa o mesmo token e o mesmo sal
  assert.equal(projectLabel("Meu Setup X", "sal"), labelRef("Meu Setup X", "sal"))
  assert.equal(projectLabel("MÉU setup x"), t)
})

test("DOMÍNIO SEPARADO: o mesmo texto não gera o mesmo hex em labelRef, accountRef e strategyRef", () => {
  for (const x of ["Meu Setup X", "Sim101", "Entry1x"]) {
    const hs = [hex(labelRef(x)), hex(accountRef(x)), hex(strategyRef(x))]
    assert.equal(new Set(hs).size, 3, x)
    assert.ok(hs.every((h) => /^[0-9a-f]{24}$/.test(h)))
  }
})

test("RE-DERIVAÇÃO INDEPENDENTE: o token = 'lbl_' + SHA-256('meutrade/labelRef/1' ⁞ sal ⁞ texto normalizado à mão).slice(0,24) — o formato documentado, não só 'o que o código faz'", () => {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
  for (const [x, salt] of [["Meu Setup X", ""], ["João do setup", ""], ["Meu Setup X", "sal-a"], ["Saida X", "sal-b"]] as const) {
    const want = `lbl_${sha256Hex(`meutrade/labelRef/1\0${salt}\0${norm(x)}`).slice(0, 24)}`
    assert.equal(labelRef(x, salt), want, `${x}/${salt}`)
  }
})

test("VALIDAÇÃO (regra do V0 no S2): isProjectedLabel aceita null, vazio, vocabulário e token; recusa texto livre, Flat/Close, token malformado, espaço nas pontas", () => {
  for (const c of exp.projection) assert.equal(isProjectedLabel(projectLabel(c.in)), true, `saída de ${JSON.stringify(c.in)}`)
  for (const ok of [null, "", "Entry", "Target12", "Stop", "Zerar", `lbl_${"a".repeat(24)}`]) assert.equal(isProjectedLabel(ok), true, String(ok))
  for (const bad of ["Meu Setup X", "Flat", "Close", "Target100", `lbl_${"a".repeat(23)}`, `lbl_${"a".repeat(25)}`, `lbl_${"A".repeat(24)}`, `lbl_${"g".repeat(24)}`, "Entry ", " Entry", "lbl_", "LBL_" + "a".repeat(24)]) assert.equal(isProjectedLabel(bad), false, JSON.stringify(bad))
  assert.equal(LABEL_TOKEN_RE.test(`lbl_${"0".repeat(24)}`), true)
})

test("NÃO É IDEMPOTENTE DE PROPÓSITO: projetar um token de novo gera outro token (a projeção se aplica UMA vez, ao texto canônico; um texto do usuário parecido com token não se passa por outro rótulo)", () => {
  const t = projectLabel("Meu Setup X") as string
  const spoof = projectLabel(t) as string
  assert.match(spoof, TOKEN)
  assert.notEqual(spoof, t)
  assert.equal(projectLabel(`lbl_${"0".repeat(24)}`) === `lbl_${"0".repeat(24)}`, false)
})

test("ESCOPO DO S1: nada foi ligado — explain-trade e schema ainda não importam o vocabulário (S2 inverte esta asserção de propósito); módulos puros, sem relógio/random/I-O", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
  assert.equal(/label-vocab/.test(read("src/lib/evidence/explain-trade.ts")), false, "S1: explain-trade ainda não usa o vocabulário")
  assert.equal(/label-vocab|labelRef/.test(read("src/lib/evidence/schema.ts")), false)
  for (const f of ["src/lib/evidence/label-vocab.ts"]) {
    const code = read(f).replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    assert.equal(/Date\.now|new Date|Math\.random|randomUUID|node:fs|process\./.test(code), false, f)
  }
  // identidade existente intacta
  assert.match(read("src/lib/ingest/identity.ts"), /export const IDENTITY_VERSIONS = \{ importId: IMPORT_ID_VERSION, rowHash: ROW_HASH_VERSION, tradeId: TRADE_ID_VERSION, accountRef: ACCOUNT_REF_DOMAIN \} as const/)
})

// ── fixtures reais LOCAIS: a projeção é a IDENTIDADE (0 tokens), sem imprimir nenhum rótulo ──
const DIR = join(ROOT, "fixtures/ninjatrader/trade-performance")
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
if (names.length === 0) console.log("• nenhuma fixture real do NT8 (local, não versionada) — pulando a parte real")
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  test(`[real ${tag.slice(0, 8)}…] todo rótulo é vocabulário v1 ou vazio ⇒ a projeção é a identidade (0 tokens); classes só contadas`, () => {
    const text = readFileSync(join(DIR, name), "utf8")
    const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
    const run = runImportPipeline(text, { ...ctx, fileName: `${tag}.csv` })
    let n = 0
    let tokens = 0
    let nonVocab = 0
    for (const t of run.trades) {
      for (const l of [...(t.entryLegs ?? []), ...(t.exitLegs ?? [])]) {
        n += 1
        const raw = l.sourceLabel
        if (!isVocabLabel(raw)) nonVocab += 1
        const out = projectLabel(raw)
        if (out !== null && TOKEN.test(out)) tokens += 1
        assert.equal(out, raw === null ? null : raw.trim(), "projeção deve ser a identidade nos rótulos reais")
      }
    }
    assert.equal(nonVocab, 0, "sem texto livre nas fixtures reais (medido em 12/10/2026)")
    assert.equal(tokens, 0)
    console.log(`  → real: ${n} pernas · 0 fora do vocabulário · 0 tokens`)
  })
}

console.log(`\n${passed} testes ok`)
