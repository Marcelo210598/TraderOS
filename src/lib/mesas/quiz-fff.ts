// Perguntas do "Qual plano combina comigo?" da Funded Futures Family. Cada motivo/alerta espelha uma regra que já está
// em fff.ts (verificada no site oficial em 2026-09-28). Mudou a regra lá → revisar as frases aqui.

import type { QuizMesa } from "./types"

const AVALIACAO_MENSAL = "A avaliação é uma assinatura mensal: quanto mais demora pra passar, mais você paga"
const INTRADAY = "Drawdown intraday: o limite inclui o lucro aberto e sobe a cada novo pico, então devolver ganho aberto pode quebrar a conta"
const EOD = "Drawdown EOD: só conta o saldo no fechamento do dia, então o lucro aberto durante o dia não puxa o limite"

export const QUIZ_FFF: QuizMesa = {
  perguntas: [
    {
      id: "metodo",
      texto: "Como está o seu método hoje?",
      contexto: "O Straight to Funded pula a avaliação: você já opera na conta financiada, com as regras de saque mais exigentes da FFF.",
      opcoes: [
        {
          rotulo: "Ainda estou aprendendo e testando",
          efeitos: {
            prime: { pontos: 1, motivo: "A avaliação deixa você treinar antes de entrar nas regras de saque da conta financiada" },
            velocity: { pontos: 1, motivo: "A avaliação deixa você treinar antes de entrar nas regras de saque da conta financiada" },
            premier: { pontos: 1, motivo: "A avaliação deixa você treinar antes de entrar nas regras de saque da conta financiada" },
            s2f: { pontos: -2, alerta: "Sem avaliação você já opera com as regras de conta financiada: 7 dias qualificados e consistência de 25% pra sacar" },
            accelerate: { pontos: -3, alerta: "O próprio site diz que o S2F Accelerate não é plano pra iniciante" },
          },
        },
        {
          rotulo: "Tenho método, mas o resultado oscila",
          efeitos: {
            s2f: { pontos: -1, alerta: "Sem avaliação você já opera com as regras de conta financiada, sem período de teste" },
            accelerate: { pontos: -2, alerta: "O S2F Accelerate exige operar cheio (5 minis) e aguentar um drawdown intraday que nunca trava" },
          },
        },
        {
          rotulo: "Método validado, resultado consistente",
          efeitos: {
            s2f: { pontos: 2, motivo: "Você paga uma vez e já começa a trabalhar pro saque, sem avaliação" },
            accelerate: { pontos: 1, motivo: "Opera com 5 minis desde o 1º dia e chega ao 1º saque com 5 dias qualificados" },
          },
        },
      ],
    },
    {
      id: "pagamento",
      texto: "Como você prefere pagar?",
      contexto: "As avaliações da FFF são assinaturas mensais. O Straight to Funded é pagamento único.",
      opcoes: [
        {
          rotulo: "Mensalidade menor e passar rápido",
          efeitos: {
            prime: { pontos: 1, motivo: "Dá pra passar a avaliação em 1 dia, o que limita quantos meses você paga" },
            premier: { pontos: 1, motivo: "O Fast Pass pode passar em 1 dia qualificado, o que limita quantos meses você paga" },
            velocity: { pontos: 1, motivo: "Entrada barata: a partir de $79 por mês no 25K" },
          },
        },
        {
          rotulo: "Prefiro pagar uma vez só, sem mensalidade",
          efeitos: {
            s2f: { pontos: 3, motivo: "Pagamento único, sem mensalidade e sem avaliação" },
            accelerate: { pontos: 3, motivo: "Pagamento único, sem mensalidade e sem avaliação" },
            prime: { pontos: -1, alerta: AVALIACAO_MENSAL },
            velocity: { pontos: -1, alerta: AVALIACAO_MENSAL },
            premier: { pontos: -1, alerta: AVALIACAO_MENSAL },
          },
        },
        { rotulo: "Tanto faz", efeitos: {} },
      ],
    },
    {
      id: "estilo",
      texto: "Como você conduz as operações?",
      contexto: "No drawdown intraday o limite sobe junto com o lucro aberto. No EOD só conta o saldo no fechamento do dia.",
      opcoes: [
        {
          rotulo: "Deixo o trade correr, com lucro aberto grande",
          efeitos: {
            velocity: { pontos: -3, alerta: INTRADAY },
            accelerate: { pontos: -3, alerta: `${INTRADAY}, e no Accelerate ele nunca trava` },
            prime: { pontos: 2, motivo: EOD },
            s2f: { pontos: 2, motivo: EOD },
            premier: { pontos: 1, motivo: "Você escolhe o drawdown EOD, que só conta o saldo no fechamento do dia" },
          },
        },
        {
          rotulo: "Entro e saio rápido (scalp)",
          efeitos: {
            velocity: { pontos: 1, motivo: "Quem realiza lucro rápido sente pouco o drawdown intraday, e o plano sai mais barato" },
          },
        },
      ],
    },
    {
      id: "ganhos",
      texto: "Como costumam ser seus ganhos?",
      contexto: "Quase todos os planos limitam quanto um único dia pode pesar no lucro total pra você poder sacar (regra de consistência).",
      opcoes: [
        {
          rotulo: "Poucos dias grandes carregam o resultado",
          efeitos: {
            velocity: { pontos: 2, motivo: "Com o add-on de saque diário não há consistência na financiada" },
            premier: { pontos: 1, motivo: "O Fast Pass não tem consistência na avaliação (contas novas têm 40% na financiada)" },
            prime: { pontos: -2, alerta: "Na financiada, seu maior dia não pode passar de 40% do lucro do ciclo pra liberar o saque" },
            s2f: { pontos: -3, alerta: "No Straight to Funded, seu maior dia não pode passar de 25% do lucro pra liberar o saque" },
            accelerate: { pontos: -3, alerta: "No Accelerate o limite de 25% vale pra vida toda da conta e não zera depois de um saque" },
          },
        },
        {
          rotulo: "Ganhos parecidos, dia após dia",
          efeitos: {
            prime: { pontos: 1, motivo: "A consistência de 40% pra sacar tende a não te atrapalhar" },
            s2f: { pontos: 1, motivo: "A consistência de 25% pra sacar tende a não te atrapalhar" },
          },
        },
        { rotulo: "Ainda não sei, tenho poucos dados", efeitos: {} },
      ],
    },
    {
      id: "saque",
      texto: "O que pesa mais pra você na hora de sacar?",
      contexto: "Os planos diferem em frequência de saque, valor máximo por pedido e no que exigem pra liberar.",
      opcoes: [
        {
          rotulo: "Poder sacar com frequência",
          efeitos: {
            velocity: { pontos: 3, motivo: "Com o add-on, o saque fica elegível todo dia, sem consistência" },
            prime: { pontos: 2, motivo: "Dá pra pedir saque a cada 3 dias de trading" },
            premier: { pontos: 1, motivo: "Saque a cada 5 dias qualificados, sem colchão" },
            accelerate: { pontos: 1, motivo: "O 1º saque sai depois de 5 dias qualificados" },
            s2f: { pontos: -1, alerta: "São 7 dias qualificados antes do 1º saque, e depois saques a cada 7 dias" },
          },
        },
        {
          rotulo: "Regras simples, com poucas exigências",
          efeitos: {
            premier: { pontos: 3, motivo: "Sem colchão: pra pedir de novo basta $1 de lucro líquido desde o último saque" },
            velocity: { pontos: 1, motivo: "Com o add-on, só o lucro exigido conta, sem dias e sem consistência" },
          },
        },
        {
          rotulo: "Sacar valores maiores por pedido",
          efeitos: {
            prime: { pontos: 2, motivo: "Do 2º saque em diante o teto por pedido chega a $4.000 (no 150K)" },
            s2f: { pontos: 1, motivo: "O teto por pedido chega a $3.500 no saque 4 (no 150K)" },
            velocity: { pontos: -1, alerta: "Os tetos por saque começam baixos: $750 no 25K padrão e $600 com o add-on" },
          },
        },
      ],
    },
  ],
}
