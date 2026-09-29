// Testes do comparativo entre mesas (sem framework): npx tsx scripts/test-comparar-mesas.mts
import assert from "node:assert/strict"
import { MESAS } from "../src/lib/mesas/index.ts"
import { TAMANHOS } from "../src/lib/mesas/types.ts"
import { MAX_COMPARAR, aplicarFiltros, ordenar } from "../src/lib/mesas/comparar-filtros.ts"
import { linhasComparar, parsePlanos } from "../src/lib/mesas/comparar.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

test("uma linha por plano que existe no tamanho, com chave única mesa:plano", () => {
  for (const t of TAMANHOS) {
    const esperado = MESAS.flatMap((m) => m.planos.filter((p) => p.tamanhos[t])).length
    const linhas = linhasComparar(t)
    assert.equal(linhas.length, esperado, `${t}K`)
    assert.equal(new Set(linhas.map((l) => l.chave)).size, linhas.length, `chaves repetidas no ${t}K`)
  }
})

test("plano que não existe no tamanho fica de fora (S2F Accelerate só no 50K)", () => {
  assert.ok(linhasComparar(50).some((l) => l.chave === "fff:s2f-accelerate" || l.mesaSlug === "fff" && l.planoNome.includes("Accelerate")))
  assert.ok(!linhasComparar(25).some((l) => l.mesaSlug === "fff" && l.planoNome.includes("Accelerate")))
})

test("taxa depois de passar: Apex e Bulenox Qualification têm, Tradeify não", () => {
  const l = linhasComparar(50)
  assert.equal(l.find((x) => x.chave === "bulenox:qualification")!.ativacao, 148)
  assert.equal(l.find((x) => x.chave === "apex:eod")!.ativacao, 90)
  assert.equal(l.find((x) => x.chave === "apex:intraday")!.ativacao, 59)
  assert.equal(l.find((x) => x.chave === "tradeify:growth")!.ativacao, 0)
  assert.equal(l.find((x) => x.chave === "bulenox:momentum")!.ativacao, 0)
})

test("preço, meta e perda máxima batem com os dados da mesa (Tradeify Growth 50K)", () => {
  const g = linhasComparar(50).find((x) => x.chave === "tradeify:growth")!
  assert.equal(g.preco, 145)
  assert.equal(g.meta, 3000)
  assert.equal(g.perdaMaxima, 2000)
  assert.equal(g.limiteDiario, 1250)
  assert.equal(g.cobranca, "unica")
})

test("split: texto próprio da Bulenox, percentual nas demais", () => {
  const l = linhasComparar(50)
  assert.equal(l.find((x) => x.chave === "bulenox:momentum")!.split, "100% dos primeiros $10.000 e 90% depois")
  assert.equal(l.find((x) => x.chave === "tradeify:growth")!.split, "90%")
  assert.equal(l.find((x) => x.chave === "apex:eod")!.split, "100%")
})

test("filtro 'sem avaliação' só deixa planos diretos", () => {
  const r = aplicarFiltros(linhasComparar(50), ["semAvaliacao"])
  assert.ok(r.length > 0 && r.every((x) => x.caminho === "direto"))
})

test("filtro 'pagamento único' tira as mensalidades da FFF", () => {
  const todas = linhasComparar(50)
  const r = aplicarFiltros(todas, ["pagamentoUnico"])
  assert.ok(todas.some((x) => x.cobranca === "mensal"))
  assert.ok(r.every((x) => x.cobranca === "unica"))
  assert.ok(!r.some((x) => x.chave === "fff:prime"))
})

test("filtro 'sem limite diário' inclui quando é opcional (Bulenox) e exclui Tradeify Growth", () => {
  const r = aplicarFiltros(linhasComparar(50), ["semLimite"])
  assert.ok(r.some((x) => x.chave === "bulenox:qualification"))
  assert.ok(!r.some((x) => x.chave === "tradeify:growth"))
  assert.ok(r.some((x) => x.chave === "tradeify:select-flex"))
})

test("filtros combinados valem todos ao mesmo tempo (E)", () => {
  const a = aplicarFiltros(linhasComparar(50), ["semLimite"]).length
  const ab = aplicarFiltros(linhasComparar(50), ["semLimite", "pagamentoUnico"])
  assert.ok(ab.length <= a)
  assert.ok(ab.every((x) => x.semLimiteDiario && x.cobranca === "unica"))
  assert.equal(aplicarFiltros(linhasComparar(50), []).length, linhasComparar(50).length)
})

test("ordenar por preço: crescente e sem preço (null) sempre no fim", () => {
  const r = ordenar(linhasComparar(50), "preco")
  const precos = r.map((x) => x.preco)
  const primeiroNull = precos.findIndex((p) => p == null)
  const numericos = primeiroNull === -1 ? precos : precos.slice(0, primeiroNull)
  assert.deepEqual([...numericos].sort((a, b) => (a as number) - (b as number)), numericos)
  if (primeiroNull !== -1) assert.ok(precos.slice(primeiroNull).every((p) => p == null))
})

test("ordenar por teto de saque: maior primeiro; ordem 'padrao' mantém a das mesas", () => {
  const r = ordenar(linhasComparar(50), "teto").map((x) => x.tetoSaque).filter((v): v is number => v != null)
  assert.deepEqual([...r].sort((a, b) => b - a), r)
  assert.deepEqual(ordenar(linhasComparar(50), "padrao").map((x) => x.chave), linhasComparar(50).map((x) => x.chave))
})

test("parsePlanos: aceita válidos, ignora inválidos, repetidos e passa de 3", () => {
  const ok = parsePlanos("tradeify:growth,bulenox:momentum")
  assert.deepEqual(ok.map((x) => `${x.mesa.slug}:${x.plano.id}`), ["tradeify:growth", "bulenox:momentum"])
  assert.equal(parsePlanos("tradeify:growth,tradeify:growth,lucid:pro").length, 2)
  assert.equal(parsePlanos("tradeify:growth,bulenox:momentum,lucid:pro,apex:eod").length, MAX_COMPARAR)
  assert.equal(parsePlanos(undefined).length, 0)
  assert.equal(parsePlanos("").length, 0)
})

test("parsePlanos resiste a lixo e tentativa de injeção", () => {
  for (const ruim of ["x", ":", "tradeify", "tradeify:", ":growth", "tradeify:growth:extra", "__proto__:constructor", "../etc:passwd", "<script>:alert", "tradeify:naoexiste", "naoexiste:growth"]) {
    assert.equal(parsePlanos(ruim).length, 0, ruim)
  }
  assert.equal(parsePlanos(["tradeify:growth", "lucid:pro"]).length, 1) // array (parâmetro repetido): só o primeiro valor
})

console.log(`\n${passed} testes ok`)
