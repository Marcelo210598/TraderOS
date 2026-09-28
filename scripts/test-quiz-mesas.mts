// Testes do "Qual plano combina comigo?" da Lucid (sem framework): node scripts/test-quiz-mesas.mts
import assert from "node:assert/strict"
import { calcularSugestao, type Respostas } from "../src/lib/mesas/quiz.ts"
import { QUIZ_LUCID } from "../src/lib/mesas/quiz-lucid.ts"
import type { Plano, PlanoId } from "../src/lib/mesas/types.ts"

// Só o `id` importa pro motor; evita importar lucid.ts (imports sem extensão não rodam no node puro).
const ordem: PlanoId[] = ["pro", "flex", "daily", "direct"]
const planos = ordem.map((id) => ({ id, nome: id }) as unknown as Plano)

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

/** Monta respostas pelo TEXTO do início do rótulo, pra o teste não quebrar se a ordem das opções mudar. */
const responde = (...rotulos: string[]): Respostas =>
  Object.fromEntries(
    QUIZ_LUCID.perguntas.map((p, i) => {
      const idx = p.opcoes.findIndex((o) => o.rotulo.startsWith(rotulos[i]))
      assert.notEqual(idx, -1, `opção "${rotulos[i]}" não existe na pergunta ${p.id}`)
      return [i, idx]
    })
  )

test("todas as perguntas têm opções e efeitos só em planos que existem", () => {
  for (const p of QUIZ_LUCID.perguntas) {
    assert.ok(p.opcoes.length >= 2, p.id)
    for (const o of p.opcoes) for (const id of Object.keys(o.efeitos)) assert.ok(ordem.includes(id as PlanoId), `${p.id}: plano ${id}`)
  }
})

test("opera notícia → Daily bloqueado, nunca é o sugerido (mesmo querendo saque frequente)", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, responde("Ainda estou", "Sim", "Poucos dias", "Entro e saio", "Poder sacar"))
  const daily = s.ranking.find((r) => r.plano.id === "daily")!
  assert.equal(daily.bloqueado, true)
  assert.notEqual(s.principal?.plano.id, "daily")
  assert.equal(s.ranking.at(-1)!.plano.id, "daily")
  assert.ok(daily.alertas.length > 0)
})

test("evita notícia + quer saque frequente + scalp → Daily", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, responde("Ainda estou", "Evito", "Poucos dias", "Entro e saio", "Poder sacar"))
  assert.equal(s.principal?.plano.id, "daily")
})

test("deixa correr lucro aberto → Daily leva alerta de drawdown intraday", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, responde("Ainda estou", "Evito", "Poucos dias", "Deixo", "Poder sacar"))
  const daily = s.ranking.find((r) => r.plano.id === "daily")!
  assert.ok(daily.alertas.some((a) => a.includes("intraday")))
})

test("método validado + ganhos regulares + notícia → Direct entra forte", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, responde("Método validado", "Sim", "Ganhos parecidos", "Deixo", "Sacar valores"))
  assert.equal(s.principal?.plano.id, "direct")
})

test("iniciante que quer regra simples → Flex", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, responde("Ainda estou", "Sim", "Poucos dias", "Deixo", "Regras simples"))
  assert.equal(s.principal?.plano.id, "flex")
})

test("iniciante nunca recebe Direct como sugestão", () => {
  for (const noticia of ["Sim", "Às vezes", "Evito"])
    for (const ganhos of ["Poucos dias", "Ganhos parecidos", "Ainda não sei"])
      for (const estilo of ["Deixo", "Entro e saio"])
        for (const saque of ["Poder sacar", "Regras simples", "Sacar valores"]) {
          const s = calcularSugestao(QUIZ_LUCID, planos, responde("Ainda estou", noticia, ganhos, estilo, saque))
          assert.notEqual(s.principal?.plano.id, "direct", `${noticia}/${ganhos}/${estilo}/${saque}`)
        }
})

test("sem resposta nenhuma: sem crash, empate resolvido pela ordem da mesa", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, {})
  assert.equal(s.principal?.plano.id, "pro")
  assert.equal(s.ranking.length, 4)
})

test("alternativa só aparece quando a nota é próxima e o plano não está bloqueado", () => {
  const s = calcularSugestao(QUIZ_LUCID, planos, {})
  assert.equal(s.alternativa?.plano.id, "flex")
  const b = calcularSugestao(QUIZ_LUCID, planos, responde("Ainda estou", "Evito", "Poucos dias", "Entro e saio", "Poder sacar"))
  assert.ok(!b.alternativa || b.principal!.pontos - b.alternativa.pontos <= 2)
})

console.log(`\n${passed} testes ok`)
