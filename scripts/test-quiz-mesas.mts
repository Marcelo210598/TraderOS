// Testes do "Qual plano combina comigo?" da Lucid (sem framework): node scripts/test-quiz-mesas.mts
import assert from "node:assert/strict"
import { calcularSugestao, type Respostas } from "../src/lib/mesas/quiz.ts"
import { QUIZ_APEX } from "../src/lib/mesas/quiz-apex.ts"
import { QUIZ_FFF } from "../src/lib/mesas/quiz-fff.ts"
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

// ---------- Funded Futures Family ----------
const ordemFff: PlanoId[] = ["prime", "velocity", "premier", "s2f", "accelerate"]
const planosFff = ordemFff.map((id) => ({ id, nome: id }) as unknown as Plano)
const respondeFff = (...rotulos: string[]): Respostas =>
  Object.fromEntries(
    QUIZ_FFF.perguntas.map((p, i) => {
      const idx = p.opcoes.findIndex((o) => o.rotulo.startsWith(rotulos[i]))
      assert.notEqual(idx, -1, `FFF: opção "${rotulos[i]}" não existe na pergunta ${p.id}`)
      return [i, idx]
    })
  )
const principalFff = (...r: string[]) => calcularSugestao(QUIZ_FFF, planosFff, respondeFff(...r)).principal?.plano.id

test("FFF: perguntas com opções e efeitos só em planos que existem", () => {
  assert.equal(QUIZ_FFF.perguntas.length, 5)
  for (const p of QUIZ_FFF.perguntas) {
    assert.ok(p.opcoes.length >= 2, p.id)
    for (const o of p.opcoes) for (const id of Object.keys(o.efeitos)) assert.ok(ordemFff.includes(id), `${p.id}: plano ${id}`)
  }
})

test("FFF: quer pagar uma vez + método validado → Straight to Funded", () => {
  assert.equal(principalFff("Método validado", "Prefiro pagar uma vez", "Deixo o trade", "Ganhos parecidos", "Sacar valores"), "s2f")
})

test("FFF: iniciante nunca recebe S2F nem Accelerate, em nenhuma combinação", () => {
  for (const pag of ["Mensalidade", "Prefiro pagar", "Tanto faz"])
    for (const est of ["Deixo o trade", "Entro e saio"])
      for (const gan of ["Poucos dias", "Ganhos parecidos", "Ainda não sei"])
        for (const saq of ["Poder sacar", "Regras simples", "Sacar valores"]) {
          const id = principalFff("Ainda estou", pag, est, gan, saq)
          assert.ok(id !== "s2f" && id !== "accelerate", `${pag}/${est}/${gan}/${saq} → ${id}`)
        }
})

test("FFF: deixa o trade correr → Velocity e Accelerate levam alerta de drawdown intraday", () => {
  const s = calcularSugestao(QUIZ_FFF, planosFff, respondeFff("Tenho método", "Tanto faz", "Deixo o trade", "Ainda não sei", "Poder sacar"))
  for (const id of ["velocity", "accelerate"]) {
    const r = s.ranking.find((x) => x.plano.id === id)!
    assert.ok(r.alertas.some((a) => a.includes("intraday")), id)
  }
  assert.notEqual(s.principal?.plano.id, "velocity")
})

test("FFF: saque frequente + scalp → Velocity (add-on de saque diário)", () => {
  assert.equal(principalFff("Ainda estou", "Mensalidade", "Entro e saio", "Poucos dias", "Poder sacar"), "velocity")
})

test("FFF: regras simples de saque → Premier+", () => {
  assert.equal(principalFff("Ainda estou", "Tanto faz", "Deixo o trade", "Ainda não sei", "Regras simples"), "premier")
})

test("FFF: poucos dias grandes → S2F e Accelerate levam alerta de consistência (25%)", () => {
  const s = calcularSugestao(QUIZ_FFF, planosFff, respondeFff("Método validado", "Prefiro pagar uma vez", "Entro e saio", "Poucos dias", "Sacar valores"))
  for (const id of ["s2f", "accelerate"]) {
    const r = s.ranking.find((x) => x.plano.id === id)!
    assert.ok(r.alertas.some((a) => a.includes("25%")), id)
  }
})

// ---------- Apex ----------
const ordemApex: PlanoId[] = ["eod", "intraday"]
const planosApex = ordemApex.map((id) => ({ id, nome: id }) as unknown as Plano)
const respondeApex = (...rotulos: string[]): Respostas =>
  Object.fromEntries(
    QUIZ_APEX.perguntas.map((p, i) => {
      const idx = p.opcoes.findIndex((o) => o.rotulo.startsWith(rotulos[i]))
      assert.notEqual(idx, -1, `Apex: opção "${rotulos[i]}" não existe na pergunta ${p.id}`)
      return [i, idx]
    })
  )
const sugApex = (...r: string[]) => calcularSugestao(QUIZ_APEX, planosApex, respondeApex(...r))

test("Apex: perguntas com opções e efeitos só em planos que existem", () => {
  assert.equal(QUIZ_APEX.perguntas.length, 5)
  for (const p of QUIZ_APEX.perguntas) {
    assert.ok(p.opcoes.length >= 2, p.id)
    for (const o of p.opcoes) for (const id of Object.keys(o.efeitos)) assert.ok(ordemApex.includes(id), `${p.id}: plano ${id}`)
  }
})

test("Apex: deixa o trade correr → EOD; Intraday leva alerta de lucro aberto", () => {
  const s = sugApex("Deixo o trade", "Tanto faz", "Tanto faz", "Tenho método", "Tanto faz")
  assert.equal(s.principal?.plano.id, "eod")
  const intraday = s.ranking.find((r) => r.plano.id === "intraday")!
  assert.ok(intraday.alertas.some((a) => a.includes("lucro aberto")))
})

test("Apex: scalp + quer pagar pouco + sem trava diária → Intraday", () => {
  assert.equal(sugApex("Entro e saio", "Quero pagar o mínimo", "Prefiro liberdade", "Método validado", "Dias de lucro").principal?.plano.id, "intraday")
})

test("Apex: iniciante que deixa correr e aceita pagar mais → EOD, com motivos", () => {
  const s = sugApex("Deixo o trade", "Posso pagar mais", "Prefiro um limite", "Ainda estou", "Tanto faz")
  assert.equal(s.principal?.plano.id, "eod")
  assert.ok(s.principal!.motivos.length >= 3)
})

test("Apex: sem respostas, empate resolvido pela ordem da mesa (EOD primeiro)", () => {
  assert.equal(calcularSugestao(QUIZ_APEX, planosApex, {}).principal?.plano.id, "eod")
})

console.log(`\n${passed} testes ok`)
