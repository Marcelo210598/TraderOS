// Seção "Mesas Proprietárias": modelo de dados genérico. Cada mesa é DADO (um arquivo por mesa),
// sem código específico. Fonte de verdade = só sites oficiais (cada campo carrega a URL + data).

export const TAMANHOS = [25, 50, 100, 150] as const
export type Tamanho = (typeof TAMANHOS)[number]

/** Um valor por tamanho de conta (25K, 50K, 100K, 150K). */
export type PorTamanho<T> = Record<Tamanho, T>

export interface Fonte {
  url: string
  /** ISO (YYYY-MM-DD) do dia em que a página oficial foi lida. */
  verificadoEm: string
}

export type TipoDrawdown = "EOD" | "INTRADAY"

export interface FaixaEscalonamento {
  /** Lucro simulado a partir do qual esta faixa vale. */
  lucroMinimo: number
  minis: number
  micros: number
}

export interface LimiteSaque {
  rotulo: string
  /** null = sem teto fixo (tudo que estiver acima do colchão). */
  valor: number | null
  /** Ex.: 50 = "50% do lucro, até `valor`". */
  pctDoLucro?: number
}

export interface DadosTamanho {
  /** null = plano sem avaliação (Direct). */
  metaAvaliacao: number | null
  /** Perda máxima (MLL) — se o saldo encostar nisso, a conta quebra. */
  perdaMaxima: number
  /** Limite de perda diário fixo. null = não existe neste tamanho. */
  limiteDiario: number | null
  lotes: { minis: number; micros: number }
  /** Saldo a partir do qual a perda máxima trava. null = nunca trava (ex.: intraday que só sobe) ou não informado. */
  travaTrailing: number | null
  saque: {
    /** Mínimo por pedido. null = a mesa não publica pra este plano. */
    minimo: number | null
    /** Lucro exigido no ciclo antes de sacar (Pro/Direct). `demais` = do 2º saque em diante. */
    metaLucroCiclo?: { primeiro: number; demais: number }
    /** Dias com lucro mínimo exigidos no ciclo (Flex). */
    diasComLucro?: { dias: number; lucroMinimoPorDia: number }
    /** Lucro que precisa existir acima do saldo inicial e NÃO pode ser sacado (Pro/Daily). */
    colchao?: number
    maximos: LimiteSaque[]
  }
  /** Só Daily: lucro num único dia que move a conta pra análise de Live. */
  tetoLucroDia?: number
  escalonamento?: FaixaEscalonamento[]
  /** Bônus único ao bater a meta na Live (split 90/10). null = plano não tem. */
  liveBonus: number | null
  /** Preço de TABELA em US$ (sem promoção — o valor real muda toda semana). null = varia por configuração. */
  precoTabelaUsd: number | null
  /** Prefixo do preço na tela quando há variantes (ex.: "a partir de"). */
  precoRotulo?: string
  /** Taxa única paga DEPOIS de passar na avaliação pra liberar a conta financiada (US$). Ausente = não tem. */
  ativacaoUsd?: number
}

/** Identificador do plano dentro da mesa (ex.: "pro", "prime"). Único só dentro da mesa. */
export type PlanoId = string

/**
 * Texto de uma linha da tabela. Lista = um item por linha. Por tamanho = valor muda com o tamanho da conta.
 * Usado quando a regra da mesa não cabe nos campos estruturados (variantes, datas de mudança de regra).
 */
export type Celula = string[] | Partial<PorTamanho<string[]>>

export interface Plano {
  id: PlanoId
  nome: string
  /** Uma frase que resume a ideia do plano. */
  resumo: string
  paraQuem: string
  /** "direto" = compra já financiada, sem avaliação. */
  caminho: "avaliacao" | "direto"
  drawdown: {
    avaliacao: TipoDrawdown | "ESCOLHA" | null
    financiada: TipoDrawdown | "ESCOLHA"
  }
  /** Como o preço é cobrado. Padrão: "unica" (compra única). "mensal" = assinatura até passar. */
  cobranca?: "mensal" | "unica"
  /** Saque exige lucro líquido positivo desde o último saque (Lucid Flex/Daily). */
  exigeLucroLiquidoNoCiclo?: boolean
  /** Dá pra ligar/desligar o limite diário na compra (ligar costuma sair mais barato). */
  dllOpcional: boolean
  consistencia: { avaliacao: number | null; financiada: number | null }
  operaNoticia: boolean
  saqueDiario: boolean
  /** Quantos saques até entrar na fila de análise pra Live. null = não se aplica. */
  saquesAteLive: number | null
  destaques: string[]
  atencao: string[]
  /** Tamanho ausente = o plano não existe nele (ex.: só no 50K). */
  tamanhos: Partial<PorTamanho<DadosTamanho>>
  /** Sobrescreve linhas do comparativo, por rótulo da linha (ex.: "Perda máxima"). */
  celulas?: Record<string, Celula>
  /** Valores das linhas extras da mesa (`Mesa.linhasExtras`), por rótulo. */
  extras?: Record<string, Celula>
  fontes: Fonte[]
}

/** Efeito de UMA resposta sobre UM plano. Só vale pontuar quando o motivo/alerta bate com uma regra dos dados acima. */
export interface EfeitoResposta {
  /** Soma na nota do plano (negativo = pesa contra). */
  pontos: number
  /** Frase mostrada quando o plano é sugerido e esta resposta jogou a favor. */
  motivo?: string
  /** Frase mostrada quando o plano é sugerido apesar de esta resposta pesar contra. */
  alerta?: string
  /** true = a regra da mesa incompatibiliza (ex.: notícia proibida). O plano nunca é o sugerido. */
  bloqueia?: boolean
}

export interface OpcaoQuiz {
  rotulo: string
  detalhe?: string
  efeitos: Partial<Record<PlanoId, EfeitoResposta>>
}

export interface PerguntaQuiz {
  id: string
  texto: string
  /** Por que a pergunta importa (uma frase, mostrada abaixo do texto). */
  contexto: string
  opcoes: OpcaoQuiz[]
}

export interface QuizMesa {
  perguntas: PerguntaQuiz[]
}

/** Linha do comparativo que só existe pra esta mesa (ex.: "Reset da conta financiada"). */
export interface LinhaExtra {
  rotulo: string
  ajuda?: string
}

export interface BlocoRegras {
  titulo: string
  itens: string[]
}

export interface Mesa {
  slug: string
  nome: string
  /** Site oficial (destino do botão quando não há link de afiliado). */
  urlOficial: string
  /** Vazio por enquanto. Preenchido = botão usa este link e o aviso de comissão aparece. */
  linkAfiliado: string | null
  /** Percentual que fica com o trader nos saques. */
  splitTrader: number
  /** Texto do split quando não é um percentual único (ex.: "100% dos primeiros $10.000 e 90% depois"). */
  splitTexto?: string
  resumo: string
  planos: Plano[]
  /** Mínimo de saque que vale pra mesa toda (aparece na ajuda da linha de saque). */
  saqueMinimo?: number
  /** Ajuda da linha "Preço de tabela". Padrão fala de promoção semanal. */
  ajudaPreco?: string
  linhasExtras?: LinhaExtra[]
  /** Regras que valem pra todos os planos da mesa, em blocos (conduta, horários, limites...). */
  regrasGerais?: BlocoRegras[]
  /** Avisos de destaque no topo da comparação (ex.: regra que mudou numa data). */
  avisos?: string[]
  /** Pontos fortes da MESA como um todo (não de um plano). Só regra verificada no oficial. */
  vantagens?: string[]
  /** Pontos de atenção da MESA como um todo. Tom realista, sem desanimar. */
  atencao?: string[]
  /** "Qual plano combina comigo?" — opcional; sem ele a página não mostra o bloco. */
  quiz?: QuizMesa
  /** Quando a mesa como um todo foi conferida pela última vez. */
  verificadoEm: string
  fontes: Fonte[]
}
