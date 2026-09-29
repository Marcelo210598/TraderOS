// Perguntas do "Qual plano combina comigo?" da Tradeify. Cada motivo/alerta espelha uma regra que já está
// em tradeify.ts (verificada no Help Center oficial em 2026-09-29). Mudou a regra lá → revisar as frases aqui.

import type { QuizMesa } from "./types"

const DLL_ALERTA = "Tem limite de perda diário na financiada: bateu, você fica travado até a próxima sessão"
const CONSISTENCIA_ALERTA_GROWTH = "Na financiada, seu maior dia não pode passar de 35% do lucro pra liberar o saque"
const CONSISTENCIA_ALERTA_LIGHTNING = "A consistência pra sacar é de 20%, sobe pra 25% e depois 30%: um dia grande atrasa o saque"
const SEM_RESET = "O Lightning não tem reset: se a conta quebrar, precisa comprar outra"

export const QUIZ_TRADEIFY: QuizMesa = {
  perguntas: [
    {
      id: "metodo",
      texto: "Como está o seu método hoje?",
      contexto: "O Lightning pula a avaliação e não tem reset. Nos outros você treina na avaliação e pode recomeçar pagando o reset.",
      opcoes: [
        {
          rotulo: "Ainda estou aprendendo e testando",
          efeitos: {
            growth: { pontos: 1, motivo: "Avaliação barata e sem prazo: dá pra treinar antes de entrar nas regras da financiada" },
            "select-flex": { pontos: 1, motivo: "Avaliação sem prazo e com reset mais barato que comprar de novo" },
            "select-daily": { pontos: 1, motivo: "Avaliação sem prazo e com reset mais barato que comprar de novo" },
            lightning: { pontos: -3, alerta: `${SEM_RESET}, e é a opção mais cara` },
          },
        },
        {
          rotulo: "Tenho método, mas o resultado oscila",
          efeitos: {
            lightning: { pontos: -2, alerta: SEM_RESET },
          },
        },
        {
          rotulo: "Método validado, resultado consistente",
          efeitos: {
            lightning: { pontos: 2, motivo: "Você pula a avaliação e já começa a trabalhar pro saque no primeiro dia" },
          },
        },
      ],
    },
    {
      id: "custo",
      texto: "O que pesa mais no custo pra você?",
      contexto: "Todos os planos são pagamento único. Growth é o mais barato, e o Lightning o mais caro, mas já vem financiado.",
      opcoes: [
        {
          rotulo: "Pagar o mínimo pra começar",
          efeitos: {
            growth: { pontos: 3, motivo: "A entrada mais barata: a partir de $99, pagamento único" },
            "select-flex": { pontos: 1, motivo: "Entrada a partir de $109, pagamento único" },
            "select-daily": { pontos: 1, motivo: "Entrada a partir de $109, pagamento único" },
            lightning: { pontos: -2, alerta: "É a opção mais cara: a partir de $345" },
          },
        },
        {
          rotulo: "Posso pagar mais pra ir direto pra financiada",
          efeitos: {
            lightning: { pontos: 3, motivo: "Sem avaliação: você paga uma vez e já opera financiado" },
            growth: { pontos: -1, alerta: "Você ainda precisa passar na avaliação antes de sacar" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "saque",
      texto: "Como você prefere sacar?",
      contexto: "Os planos diferem em frequência, valor por pedido e no que exigem pra liberar.",
      opcoes: [
        {
          rotulo: "Todo dia, em valores menores",
          efeitos: {
            "select-daily": { pontos: 3, motivo: "Saque elegível todo dia, até 2× o lucro desde o último saque" },
            "select-flex": { pontos: -1, alerta: "O saque só libera a cada 5 dias com lucro" },
            growth: { pontos: -1, alerta: "O saque só libera a cada 5 dias com lucro" },
          },
        },
        {
          rotulo: "De vez em quando, em valores maiores",
          efeitos: {
            "select-flex": { pontos: 2, motivo: "Cada 5 dias com lucro você saca até 50% do lucro total" },
            growth: { pontos: 1, motivo: "Cada 5 dias com lucro você saca até o teto (chega a $5.000 no 150K)" },
            lightning: { pontos: 1, motivo: "Sem exigência de dias mínimos: sacou assim que bate a meta de lucro" },
            "select-daily": { pontos: -1, alerta: "O teto por pedido é menor: até $2.500 no 150K" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "ganhos",
      texto: "Como costumam ser seus ganhos?",
      contexto: "Alguns planos limitam quanto um único dia pode pesar no lucro total pra você poder sacar (regra de consistência).",
      opcoes: [
        {
          rotulo: "Poucos dias grandes carregam o resultado",
          efeitos: {
            "select-flex": { pontos: 2, motivo: "Na financiada do Select não existe consistência" },
            "select-daily": { pontos: 2, motivo: "Na financiada do Select não existe consistência" },
            growth: { pontos: -2, alerta: CONSISTENCIA_ALERTA_GROWTH },
            lightning: { pontos: -3, alerta: CONSISTENCIA_ALERTA_LIGHTNING },
          },
        },
        {
          rotulo: "Ganhos parecidos, dia após dia",
          efeitos: {
            growth: { pontos: 1, motivo: "A consistência de 35% pra sacar tende a não te atrapalhar" },
            lightning: { pontos: 1, motivo: "A consistência de 20% a 30% pra sacar tende a não te atrapalhar" },
          },
        },
        { rotulo: "Ainda não sei, tenho poucos dados", efeitos: {} },
      ],
    },
    {
      id: "limite",
      texto: "Como você lida com o risco durante o dia?",
      contexto: "Growth, Select Daily e Lightning (50K ou mais) têm limite de perda diário. Select Flex não tem. Em todos, o drawdown quebra a conta na hora se você encostar nele.",
      opcoes: [
        {
          rotulo: "Prefiro um limite diário que me trave",
          efeitos: {
            "select-daily": { pontos: 1, motivo: "O limite de perda diário te trava antes de o estrago crescer" },
            growth: { pontos: 1, motivo: "O limite de perda diário te trava antes de o estrago crescer" },
          },
        },
        {
          rotulo: "Quero liberdade, sem trava diária",
          efeitos: {
            "select-flex": { pontos: 3, motivo: "Na financiada do Flex não existe limite de perda diário" },
            growth: { pontos: -1, alerta: DLL_ALERTA },
            "select-daily": { pontos: -2, alerta: DLL_ALERTA },
            lightning: { pontos: -1, alerta: `${DLL_ALERTA} (menos no 25K)` },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
  ],
}
