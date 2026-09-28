// Perguntas do "Qual plano combina comigo?" da Apex (2 trilhas: EOD e Intraday). Cada motivo/alerta espelha uma regra
// que já está em apex.ts (lida no Help Center oficial em 2026-09-28). Mudou a regra lá → revisar as frases aqui.

import type { QuizMesa } from "./types"

const INTRADAY =
  "Drawdown intraday: o limite inclui o lucro aberto e sobe a cada novo pico, então devolver ganho aberto pode reprovar a avaliação num dia que fecharia no verde"
const EOD = "Drawdown EOD: só sobe com o saldo de fechamento, então o lucro aberto durante o dia não puxa o limite"

export const QUIZ_APEX: QuizMesa = {
  perguntas: [
    {
      id: "estilo",
      texto: "Como você conduz as operações?",
      contexto: "No drawdown intraday o limite sobe junto com o lucro que ainda está aberto. No EOD só conta o saldo no fechamento do dia.",
      opcoes: [
        {
          rotulo: "Deixo o trade correr, com lucro aberto grande",
          efeitos: {
            intraday: { pontos: -3, alerta: INTRADAY },
            eod: { pontos: 3, motivo: EOD },
          },
        },
        {
          rotulo: "Entro e saio rápido (scalp)",
          efeitos: {
            intraday: { pontos: 1, motivo: "Quem realiza lucro rápido sente pouco o drawdown intraday, e a avaliação sai bem mais barata" },
          },
        },
      ],
    },
    {
      id: "orcamento",
      texto: "Quanto pesa o valor de entrada pra você?",
      contexto: "As duas avaliações são pagas uma vez só, mas o preço de tabela do Intraday é bem menor que o do EOD.",
      opcoes: [
        {
          rotulo: "Quero pagar o mínimo pra começar",
          efeitos: {
            intraday: { pontos: 3, motivo: "A avaliação Standard custa de $167 (25K) a $1.190 (150K), bem menos que a do EOD" },
            eod: { pontos: -1, alerta: "A avaliação EOD Standard custa de $490 (25K) a $2.190 (150K)" },
          },
        },
        {
          rotulo: "Posso pagar mais por um limite previsível",
          efeitos: {
            eod: { pontos: 2, motivo: "Você paga mais na compra e ganha um drawdown que só muda no fechamento do dia" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "perda-diaria",
      texto: "Como você lida com um dia ruim?",
      contexto:
        "A avaliação EOD tem limite de perda diário fixo (bateu, a sessão para). A avaliação Intraday não tem. Na PA, as duas trilhas têm um limite diário que escala.",
      opcoes: [
        {
          rotulo: "Prefiro um limite que me trave no dia",
          efeitos: {
            eod: { pontos: 1, motivo: "A avaliação tem limite de perda diário fixo: bateu, a sessão para e você volta no dia seguinte, com a conta ativa" },
          },
        },
        {
          rotulo: "Prefiro liberdade, sem trava no dia",
          efeitos: {
            intraday: { pontos: 2, motivo: "A avaliação não tem limite de perda diário" },
            eod: { pontos: -1, alerta: "A avaliação EOD tem limite de perda diário fixo ($500 no 25K a $2.000 no 150K): bateu, a sessão para" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "metodo",
      texto: "Como está o seu método hoje?",
      contexto: "Nenhuma das duas trilhas tem reset: se reprovar ou passarem os 30 dias, é preciso comprar outra avaliação.",
      opcoes: [
        {
          rotulo: "Ainda estou aprendendo e testando",
          efeitos: {
            eod: { pontos: 1, motivo: "Um limite que só muda no fechamento é mais fácil de acompanhar enquanto você aprende" },
            intraday: { pontos: -1, alerta: "O drawdown intraday acompanha o lucro aberto em tempo real, e não existe reset se você reprovar" },
          },
        },
        { rotulo: "Tenho método, mas o resultado oscila", efeitos: {} },
        { rotulo: "Método validado, resultado consistente", efeitos: {} },
      ],
    },
    {
      id: "saque",
      texto: "O que pesa mais pra você na hora de sacar?",
      contexto: "Nas duas trilhas o saque exige 5 dias qualificados, consistência de 50% e um colchão. Muda o lucro mínimo por dia e o teto por saque.",
      opcoes: [
        {
          rotulo: "Dias de lucro pequeno também servem",
          efeitos: {
            intraday: { pontos: 1, motivo: "O lucro mínimo por dia qualificado é menor no Intraday ($100 a $300, contra $100 a $350 no EOD)" },
          },
        },
        {
          rotulo: "Sacar valores maiores por pedido",
          efeitos: {
            intraday: { pontos: 1, motivo: "Os tetos por saque do Intraday são iguais ou maiores que os do EOD em todos os tamanhos" },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
  ],
}
