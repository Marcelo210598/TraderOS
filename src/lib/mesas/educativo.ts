// Conteúdo educativo do hub /mesas (público iniciante). Tom: encorajador e realista, sem prometer resultado.
// Só afirma o que vale pra mesas em geral ou o que está nos dados verificados da Lucid (lucid.ts). Nada de número inventado.

export interface PassoMesa {
  titulo: string
  texto: string
}

export const COMO_FUNCIONA: PassoMesa[] = [
  {
    titulo: "Você escolhe um plano e paga a avaliação",
    texto: "É uma taxa, não uma conta grande de dinheiro seu. O que você arrisca de início é o valor dessa taxa.",
  },
  {
    titulo: "Passa na avaliação",
    texto: "Você opera até bater uma meta de lucro sem estourar as regras da mesa, principalmente a perda máxima.",
  },
  {
    titulo: "Recebe a conta financiada",
    texto: "Com a mesa bancando o capital, você segue as regras de risco da conta e trabalha pra liberar saques.",
  },
  {
    titulo: "Saca a maior parte do lucro",
    texto: "Cumprindo os critérios do plano, você pede o saque e fica com a maior parte (na Lucid, 90%).",
  },
]

export const VANTAGENS: string[] = [
  "Custo de entrada baixo perto de bancar uma conta grande com o seu próprio dinheiro",
  "Regras claras de risco que te obrigam a ter disciplina, o que também melhora o seu trade",
  "Dá pra começar pequeno (na Lucid, contas de 25K a 150K) e crescer com o tempo",
  "Você fica com a maior parte do lucro sacado (na Lucid, 90%)",
]

export const PONTOS_DE_ATENCAO: string[] = [
  "Passar exige disciplina de risco, não só acertar operações. Trate a avaliação como treino de gestão de risco",
  "Bateu a perda máxima, a conta quebra. Vale conhecer bem esse número antes de operar",
  "Cada plano tem critérios próprios pra liberar saque, e eles mudam de um plano pro outro",
  "Regras e preços mudam sem aviso. Confirme sempre no site oficial da mesa",
  "Lucro não é garantido. Nenhuma mesa nem plano promete resultado",
]

export interface TermoGlossario {
  termo: string
  definicao: string
}

export const GLOSSARIO: TermoGlossario[] = [
  { termo: "Avaliação", definicao: "A prova antes da conta financiada: bater uma meta de lucro respeitando as regras da mesa." },
  { termo: "Conta financiada", definicao: "A conta que você recebe ao passar na avaliação. É nela que você trabalha pra liberar saques." },
  { termo: "Perda máxima (MLL)", definicao: "O quanto a conta pode cair. Se o saldo encostar nesse limite, a conta quebra." },
  {
    termo: "Drawdown EOD",
    definicao: "O limite sobe conforme o seu saldo no fechamento do dia. O lucro aberto durante o dia não puxa o limite.",
  },
  {
    termo: "Drawdown intraday",
    definicao: "O limite acompanha o lucro aberto na hora. Se você devolve lucro aberto, chega mais perto de quebrar.",
  },
  {
    termo: "Limite de perda diário (DLL)",
    definicao: "Um teto de prejuízo por dia. Bateu, você fica travado até a próxima sessão, mas não perde a conta.",
  },
  {
    termo: "Consistência",
    definicao: "Regra que impede que um único dia seja grande demais perto do lucro total. Costuma valer pra passar ou pra sacar.",
  },
  {
    termo: "Escalonamento",
    definicao: "O tamanho máximo do lote começa menor e sobe conforme o seu lucro cresce.",
  },
  {
    termo: "Conta Live",
    definicao: "Etapa depois da financiada. Na Lucid, após alguns saques você entra numa fila de análise pra ela.",
  },
]
