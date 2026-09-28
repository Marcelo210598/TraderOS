// Motor do "Qual plano combina comigo?": função pura (sem React), testável em scripts/test-quiz-mesas.mts.
// É uma SUGESTÃO por encaixe de regras, não recomendação financeira.

import type { Plano, PlanoId, QuizMesa } from "./types"

/** respostas[i] = índice da opção escolhida na pergunta i. */
export type Respostas = Record<number, number>

export interface ResultadoPlano {
  plano: Plano
  pontos: number
  bloqueado: boolean
  motivos: string[]
  alertas: string[]
}

export interface Sugestao {
  /** Ordem: melhor encaixe primeiro. Planos bloqueados vão pro fim. */
  ranking: ResultadoPlano[]
  /** Plano sugerido; null só se TODOS estiverem bloqueados (não acontece com os dados atuais). */
  principal: ResultadoPlano | null
  /** 2º colocado não bloqueado, se a nota dele chegou perto (diferença ≤ 2). */
  alternativa: ResultadoPlano | null
}

const MARGEM_ALTERNATIVA = 2

export function calcularSugestao(quiz: QuizMesa, planos: Plano[], respostas: Respostas): Sugestao {
  const porPlano = new Map<PlanoId, ResultadoPlano>(
    planos.map((plano) => [plano.id, { plano, pontos: 0, bloqueado: false, motivos: [], alertas: [] }])
  )

  quiz.perguntas.forEach((pergunta, i) => {
    const opcao = pergunta.opcoes[respostas[i]]
    if (!opcao) return
    for (const [id, efeito] of Object.entries(opcao.efeitos)) {
      const alvo = porPlano.get(id as PlanoId)
      if (!alvo || !efeito) continue
      alvo.pontos += efeito.pontos
      if (efeito.bloqueia) alvo.bloqueado = true
      if (efeito.pontos > 0 && efeito.motivo) alvo.motivos.push(efeito.motivo)
      if ((efeito.pontos < 0 || efeito.bloqueia) && efeito.alerta) alvo.alertas.push(efeito.alerta)
    }
  })

  // Empate: mantém a ordem em que a mesa lista os planos (sort estável).
  const ranking = [...porPlano.values()].sort((a, b) => Number(a.bloqueado) - Number(b.bloqueado) || b.pontos - a.pontos)
  const principal = ranking[0] && !ranking[0].bloqueado ? ranking[0] : null
  const segundo = ranking[1]
  const alternativa = principal && segundo && !segundo.bloqueado && principal.pontos - segundo.pontos <= MARGEM_ALTERNATIVA ? segundo : null

  return { ranking, principal, alternativa }
}
