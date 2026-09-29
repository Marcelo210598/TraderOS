// Perguntas do "Qual plano combina comigo?" da Bulenox. Cada motivo/alerta espelha uma regra que já está
// em bulenox.ts (verificada no site oficial em 2026-09-29). Mudou a regra lá → revisar as frases aqui.

import type { QuizMesa } from "./types"

const ACESSO_30 = "O acesso à avaliação vale 30 dias, e o reset não estende o prazo"
const MASTER_REGRAS = "Na Master, cada saque exige 10 dias de trading, uma reserva na conta e consistência de 40% sobre o lucro total"
const FT_CARO = "É a opção mais cara da Bulenox: a partir de $338, sem avaliação pra treinar"

export const QUIZ_BULENOX: QuizMesa = {
  perguntas: [
    {
      id: "metodo",
      texto: "Como está o seu método hoje?",
      contexto: "O Fast Track pula a avaliação: você já opera na conta financiada. Nos outros você treina passando a meta antes.",
      opcoes: [
        {
          rotulo: "Ainda estou aprendendo e testando",
          efeitos: {
            qualification: { pontos: 1, motivo: "A avaliação é barata e sem mínimo de dias, então dá pra treinar antes da conta financiada" },
            momentum: { pontos: 1, motivo: "A avaliação é barata e sem mínimo de dias, então dá pra treinar antes da conta financiada" },
            "fast-track": { pontos: -3, alerta: FT_CARO },
          },
        },
        {
          rotulo: "Tenho método, mas o resultado oscila",
          efeitos: {
            "fast-track": { pontos: -2, alerta: FT_CARO },
          },
        },
        {
          rotulo: "Método validado, resultado consistente",
          efeitos: {
            "fast-track": { pontos: 2, motivo: "Você pula a avaliação e já começa a trabalhar pro saque no primeiro dia" },
          },
        },
      ],
    },
    {
      id: "custo",
      texto: "O que pesa mais no custo pra você?",
      contexto: "Todos os planos são pagamento único. No Momentum a Master já vem incluída e na Qualification você paga uma taxa depois de passar.",
      opcoes: [
        {
          rotulo: "Menor custo total até a conta financiada",
          efeitos: {
            momentum: { pontos: 3, motivo: "Custo total a partir de $94, com a Master incluída e sem taxa de ativação" },
            qualification: { pontos: 1, motivo: "A avaliação começa em $145, mas depois vem a taxa de ativação da Master ($143 a $498)" },
            "fast-track": { pontos: -2, alerta: FT_CARO },
          },
        },
        {
          rotulo: "Posso pagar mais pra ir direto",
          efeitos: {
            "fast-track": { pontos: 3, motivo: "Sem avaliação: paga uma vez e já opera na conta financiada simulada" },
            momentum: { pontos: -1, alerta: "Você ainda precisa passar na avaliação antes de sacar" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "saque",
      texto: "Como você prefere receber os saques?",
      contexto: "A Master paga uma vez por semana. O Fast Track e o Momentum processam o pedido no mesmo dia.",
      opcoes: [
        {
          rotulo: "Rápido, no mesmo dia",
          efeitos: {
            "fast-track": { pontos: 2, motivo: "Pedido feito até 12:01 (Central) em dia útil costuma ser processado no mesmo dia" },
            momentum: { pontos: 2, motivo: "O pedido de saque é processado no mesmo dia" },
            qualification: { pontos: -2, alerta: "Na Master o saque só é processado uma vez por semana, na quarta" },
          },
        },
        {
          rotulo: "Uma vez por semana está bom",
          efeitos: {
            qualification: { pontos: 1, motivo: "Não há teto a partir do 4º saque, e você tem 100% dos primeiros $10.000" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "ganhos",
      texto: "Como costumam ser seus ganhos?",
      contexto: "Todos os planos limitam quanto um único dia pode pesar no lucro pra você poder sacar (regra de consistência), e a régua muda.",
      opcoes: [
        {
          rotulo: "Poucos dias grandes carregam o resultado",
          efeitos: {
            momentum: { pontos: 1, motivo: "A consistência de 35% é a mais folgada, e é calculada só sobre o lucro de cada ciclo" },
            qualification: { pontos: -2, alerta: "Na Master, o maior dia não pode passar de 40% do lucro total, e essa conta não zera depois do saque" },
            "fast-track": { pontos: -3, alerta: "A consistência é de 20% no 1º saque e sobe até 30%: um dia grande atrasa o saque" },
          },
        },
        {
          rotulo: "Ganhos parecidos, dia após dia",
          efeitos: {
            qualification: { pontos: 1, motivo: "A consistência de 40% sobre o lucro total tende a não te atrapalhar" },
            "fast-track": { pontos: 1, motivo: "A consistência de 20% a 30% pra sacar tende a não te atrapalhar" },
          },
        },
        { rotulo: "Ainda não sei, tenho poucos dados", efeitos: {} },
      ],
    },
    {
      id: "rotina",
      texto: "Como é a sua rotina de trading?",
      contexto: "A avaliação vale 30 dias de acesso. Na Master (Qualification) cada saque pede 10 dias de trading, e no Momentum pede 5 dias com lucro.",
      opcoes: [
        {
          rotulo: "Opero quase todo dia e consigo passar rápido",
          efeitos: {
            qualification: { pontos: 1, motivo: "Com dias de trading em sequência, os 10 dias da Master passam mais rápido" },
            momentum: { pontos: 1, motivo: "Com rotina diária, os 5 dias com lucro por ciclo acontecem sem esforço" },
          },
        },
        {
          rotulo: "Opero poucos dias e preciso de tempo",
          efeitos: {
            "fast-track": { pontos: 2, motivo: "Não tem prazo de acesso da avaliação nem mínimo de dias pra sacar" },
            qualification: { pontos: -2, alerta: `${ACESSO_30}. ${MASTER_REGRAS}` },
            momentum: { pontos: -2, alerta: `${ACESSO_30}, e cada saque exige 5 dias com lucro` },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
  ],
}
