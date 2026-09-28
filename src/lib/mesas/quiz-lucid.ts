// Perguntas do "Qual plano combina comigo?" da Lucid. Cada motivo/alerta espelha uma regra que já está
// em lucid.ts (verificada no Help Center em 2026-09-28). Mudou a regra lá → revisar as frases aqui.

import type { QuizMesa } from "./types"

export const QUIZ_LUCID: QuizMesa = {
  perguntas: [
    {
      id: "metodo",
      texto: "Como está o seu método hoje?",
      contexto: "Uns planos têm avaliação (você passa uma prova antes); o Direct pula a prova e já te põe na conta financiada, por um preço bem maior.",
      opcoes: [
        {
          rotulo: "Ainda estou aprendendo e testando",
          efeitos: {
            pro: { pontos: 1, motivo: "A avaliação deixa você treinar com um custo bem menor que o de comprar direto na financiada" },
            flex: { pontos: 1, motivo: "A avaliação deixa você treinar com um custo bem menor que o de comprar direto na financiada" },
            daily: { pontos: 1, motivo: "A avaliação deixa você treinar com um custo bem menor que o de comprar direto na financiada" },
            direct: { pontos: -3, alerta: "Sem avaliação, você já opera na financiada e paga o preço de tabela mais alto da Lucid" },
          },
        },
        {
          rotulo: "Tenho método, mas o resultado oscila",
          efeitos: {
            direct: { pontos: -1, alerta: "Sem avaliação e com preço de tabela mais alto, uma fase ruim custa mais caro" },
          },
        },
        {
          rotulo: "Método validado, resultado consistente",
          efeitos: {
            direct: { pontos: 2, motivo: "Você pula a avaliação e começa a construir saque desde o primeiro dia" },
          },
        },
      ],
    },
    {
      id: "noticia",
      texto: "Você opera em horário de notícia forte (CPI, payroll, FOMC)?",
      contexto: "Um dos planos proíbe operar notícia de alto impacto, e quebrar essa regra quebra a conta.",
      opcoes: [
        {
          rotulo: "Sim, é onde estão meus setups",
          efeitos: {
            daily: { pontos: -10, bloqueia: true, alerta: "O LucidDaily proíbe operar notícia de alto impacto em USD (1 minuto antes até 1 minuto depois) e quebra a conta se você operar" },
            pro: { pontos: 1, motivo: "Notícia liberada" },
            flex: { pontos: 1, motivo: "Notícia liberada" },
            direct: { pontos: 1, motivo: "Notícia liberada" },
          },
        },
        {
          rotulo: "Às vezes",
          efeitos: {
            daily: { pontos: -3, alerta: "O LucidDaily proíbe operar notícia de alto impacto em USD e quebra a conta se você operar" },
          },
        },
        { rotulo: "Evito, fico fora", efeitos: {} },
      ],
    },
    {
      id: "ganhos",
      texto: "Como costumam ser seus ganhos?",
      contexto: "Na hora do saque, alguns planos exigem que seu melhor dia não seja grande demais perto do lucro total (regra de consistência).",
      opcoes: [
        {
          rotulo: "Poucos dias grandes carregam o resultado",
          efeitos: {
            flex: { pontos: 2, motivo: "Na financiada não tem regra de consistência pra sacar" },
            daily: { pontos: 2, motivo: "Na financiada não tem regra de consistência pra sacar" },
            pro: { pontos: -2, alerta: "Na financiada, seu maior dia não pode passar de 40% do lucro do ciclo pra liberar o saque" },
            direct: { pontos: -3, alerta: "No Direct, seu maior dia não pode passar de 20% do lucro do ciclo pra liberar o saque" },
          },
        },
        {
          rotulo: "Ganhos parecidos, dia após dia",
          efeitos: {
            pro: { pontos: 1, motivo: "A consistência de 40% pra sacar tende a não te atrapalhar" },
            direct: { pontos: 1, motivo: "A consistência de 20% pra sacar tende a não te atrapalhar" },
          },
        },
        { rotulo: "Ainda não sei, tenho poucos dados", efeitos: {} },
      ],
    },
    {
      id: "estilo",
      texto: "Como você conduz as operações?",
      contexto: "No drawdown intraday, o limite sobe junto com o lucro que ainda está aberto. Se você devolve esse lucro, chega perto de quebrar.",
      opcoes: [
        {
          rotulo: "Deixo o trade correr, com lucro aberto grande",
          efeitos: {
            daily: { pontos: -3, alerta: "Na financiada do LucidDaily o drawdown é intraday: acompanha o lucro aberto, e devolver lucro aberto aproxima você da quebra" },
            pro: { pontos: 1, motivo: "O drawdown é EOD: só conta o saldo no fechamento do dia, então o lucro aberto durante o dia não puxa o limite" },
            flex: { pontos: 1, motivo: "O drawdown é EOD: só conta o saldo no fechamento do dia, então o lucro aberto durante o dia não puxa o limite" },
            direct: { pontos: 1, motivo: "O drawdown é EOD: só conta o saldo no fechamento do dia, então o lucro aberto durante o dia não puxa o limite" },
          },
        },
        {
          rotulo: "Entro e saio rápido (scalp)",
          efeitos: {},
        },
      ],
    },
    {
      id: "saque",
      texto: "O que pesa mais pra você na hora de sacar?",
      contexto: "Os planos diferem em frequência de saque, valor máximo por pedido e nas exigências pra liberar.",
      opcoes: [
        {
          rotulo: "Poder sacar com frequência",
          efeitos: {
            daily: { pontos: 3, motivo: "Dá pra pedir saque todo dia em que você estiver elegível" },
          },
        },
        {
          rotulo: "Regras simples, sem pegadinha",
          efeitos: {
            flex: { pontos: 2, motivo: "Na financiada o saque pede só 5 dias com lucro mínimo e lucro líquido positivo, sem consistência nem colchão" },
            daily: { pontos: 1, motivo: "Sem consistência na financiada" },
          },
        },
        {
          rotulo: "Sacar valores maiores por pedido",
          efeitos: {
            daily: { pontos: 2, motivo: "Não tem teto por pedido: dá pra sacar todo o lucro acima do colchão" },
            pro: { pontos: 1, motivo: "Do 2º saque em diante o teto por pedido é maior que o do LucidFlex" },
            direct: { pontos: 1, motivo: "Nos saques 4 e 5 o teto por pedido sobe (a partir do 50K)" },
          },
        },
      ],
    },
  ],
}
