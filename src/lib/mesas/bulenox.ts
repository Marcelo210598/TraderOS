// Bulenox: dados lidos SÓ do site oficial em 2026-09-29 (bulenox.com: Accounts & Pricing, FAQ e Help Center; o texto do
// Help Center vem da API pública do próprio site). Levantamento: docs/mesas-proprietarias/bulenox-levantamento-2026-09-29.md.
// Regras mudam sem aviso: quem edita este arquivo confere antes no site oficial. Os preços da Qualification só existem
// na página de preços (Accounts & Pricing).

import { QUIZ_BULENOX } from "./quiz-bulenox"
import { TAMANHOS } from "./types"
import type { Celula, DadosTamanho, FaixaEscalonamento, Fonte, Mesa, Plano, PorTamanho, Tamanho } from "./types"

const VERIFICADO = "2026-09-29"
const SITE = "https://bulenox.com"

const fonte = (caminho: string): Fonte => ({ url: `${SITE}/${caminho}`, verificadoEm: VERIFICADO })

type Quatro<T> = [T, T, T, T]

/** [25K, 50K, 100K, 150K] → objeto por tamanho, na ordem das tabelas do site. */
const porTamanho = <T,>(v: Quatro<T>): PorTamanho<T> => ({ 25: v[0], 50: v[1], 100: v[2], 150: v[3] })

const tamanhos = (monta: (t: Tamanho, i: 0 | 1 | 2 | 3) => DadosTamanho): Partial<PorTamanho<DadosTamanho>> => {
  const saida: Partial<PorTamanho<DadosTamanho>> = {}
  TAMANHOS.forEach((t, i) => {
    saida[t] = monta(t, i as 0 | 1 | 2 | 3)
  })
  return saida
}

const cadaTamanho = (fn: (i: 0 | 1 | 2 | 3) => string[]): Celula => porTamanho([fn(0), fn(1), fn(2), fn(3)])

const usd = (n: number) => `$${n.toLocaleString("en-US")}`

// ---- números compartilhados ----
const META = [1500, 3000, 6000, 9000] as const
const MINIS_OPCAO_1 = [3, 7, 12, 15] as const // trailing, contratos cheios desde o dia 1
const MINIS_OPCAO_2_FIXO = [2, 4, 8, 12] as const // EOD do Fast Track e do Momentum (sem escalonamento)

/** Escalonamento da Opção 2 da Qualification/Master: sobe e desce conforme o lucro acumulado (cash on hand). */
const ESCALONAMENTO_QUALIFICATION: PorTamanho<FaixaEscalonamento[]> = porTamanho([
  [
    { lucroMinimo: 0, minis: 2, micros: 20 },
    { lucroMinimo: 1501, minis: 3, micros: 30 },
  ],
  [
    { lucroMinimo: 0, minis: 2, micros: 20 },
    { lucroMinimo: 1501, minis: 4, micros: 40 },
    { lucroMinimo: 4001, minis: 7, micros: 70 },
  ],
  [
    { lucroMinimo: 0, minis: 3, micros: 30 },
    { lucroMinimo: 2001, minis: 5, micros: 50 },
    { lucroMinimo: 3001, minis: 8, micros: 80 },
    { lucroMinimo: 5001, minis: 12, micros: 120 },
  ],
  [
    { lucroMinimo: 0, minis: 5, micros: 50 },
    { lucroMinimo: 4001, minis: 8, micros: 80 },
    { lucroMinimo: 8001, minis: 10, micros: 100 },
    { lucroMinimo: 12001, minis: 15, micros: 150 },
  ],
])

const ESCOLHA_DRAWDOWN = "Você escolhe antes de comprar e não muda depois"
const OPCAO_1 = "Opção 1: trailing em tempo real, inclui o lucro aberto e só sobe"
const OPCAO_2 = "Opção 2: EOD, só atualiza no fechamento do dia"

const DIAS_VENCEDORES = [100, 150, 200, 250] as const // lucro mínimo do dia pra contar (Momentum)

// ---- QUALIFICATION → MASTER ----
const QUAL_PRECO = [145, 175, 215, 325] as const
const QUAL_ATIVACAO = [143, 148, 248, 498] as const
const QUAL_PERDA = [1500, 2500, 3000, 4500] as const
const QUAL_DLL = [500, 1100, 2200, 3300] as const
const QUAL_RESERVA = [1600, 2600, 3100, 4600] as const
const QUAL_TRAVA = [26600, 52600, 103100, 154600] as const
const QUAL_TETO_INICIAL = [1000, 1500, 1750, 2000] as const // só os 3 primeiros saques

const QUALIFICATION: Plano = {
  id: "qualification",
  nome: "Qualification + Master",
  resumo: "Você passa a meta de lucro (sem mínimo de dias e sem consistência) e depois de uma revisão ativa a conta Master, pagando uma taxa única. Saque semanal, com 100% dos primeiros $10.000.",
  paraQuem: "Quem quer entrada barata na avaliação e aceita as regras mais rígidas da Master: 10 dias por saque, consistência de 40% e uma reserva na conta.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "ESCOLHA", financiada: "ESCOLHA" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 40 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: 3,
  destaques: [
    "Avaliação sem mínimo de dias e sem consistência: dá pra passar em 1 dia",
    "Os primeiros $10.000 em saques são 100% seus",
    "Sem mensalidade na Master: só a taxa única de ativação",
    "Drawdown da Master trava em saldo inicial + $100 e o limite de perda diário some",
  ],
  atencao: [
    "O acesso à avaliação vale 30 dias, e o reset não estende esse prazo",
    "Passar a meta não abre a Master na hora: a conta passa por revisão e depois você paga a taxa de ativação (de $143 a $498)",
    "Na Master, cada saque exige 10 dias de trading, uma reserva que fica na conta e consistência de 40% sobre o lucro total, que não zera depois do saque",
    "O saque sai uma vez por semana, na quarta-feira, e o formulário fiscal (W-8BEN) precisa ser assinado à mão",
    "O modelo de risco (Opção 1 ou 2) é definitivo depois da compra",
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: META[i],
    perdaMaxima: QUAL_PERDA[i],
    limiteDiario: QUAL_DLL[i],
    lotes: { minis: MINIS_OPCAO_1[i], micros: MINIS_OPCAO_1[i] * 10 },
    travaTrailing: QUAL_TRAVA[i],
    saque: {
      minimo: 1000,
      colchao: QUAL_RESERVA[i],
      maximos: [
        { rotulo: "1º ao 3º saque", valor: QUAL_TETO_INICIAL[i] },
        { rotulo: "4º em diante", valor: null },
      ],
    },
    escalonamento: ESCALONAMENTO_QUALIFICATION[t],
    liveBonus: null,
    precoTabelaUsd: QUAL_PRECO[i],
  })),
  celulas: {
    Drawdown: [ESCOLHA_DRAWDOWN, OPCAO_1, OPCAO_2, "Na Master, trava em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) => [
      `Só na Opção 2: ${usd(QUAL_DLL[i])} (pausa o dia, não quebra a conta)`,
      "Some da Master quando o drawdown trava",
    ]),
    Consistência: ["Avaliação: não tem", "Master: 40% do lucro total, e não zera depois do saque"],
    "Lote máximo": cadaTamanho((i) => [
      `Opção 1: ${MINIS_OPCAO_1[i]} minis / ${MINIS_OPCAO_1[i] * 10} micros desde o 1º dia`,
      `Opção 2: de ${ESCALONAMENTO_QUALIFICATION[[25, 50, 100, 150][i] as Tamanho][0].minis} a ${MINIS_OPCAO_1[i]} minis, conforme o lucro (pode cair se o saldo cair)`,
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      "10 dias de trading completos desde o saque anterior",
      `Reserva de ${usd(QUAL_RESERVA[i])} acima do saldo inicial que fica na conta`,
      "Pedido mínimo de $1.000",
      "Maior dia ≤ 40% do lucro total",
    ]),
    "Quanto dá pra sacar": cadaTamanho((i) => [
      `1º ao 3º saque: até ${usd(QUAL_TETO_INICIAL[i])}`,
      "4º em diante: sem teto, respeitando a reserva",
      "Os primeiros $10.000 sacados são 100% seus, depois 90%",
    ]),
    "Frequência de saque": ["Uma vez por semana: pedidos até sexta 23:59 (Central) saem na quarta seguinte"],
    "Bônus ao ir pra Live": ["Não tem. Depois de 3 saques a Bulenox pode considerar a conta pra Funded (regras gerais abaixo)"],
  },
  extras: {
    "Taxa de ativação da Master": cadaTamanho((i) => [usd(QUAL_ATIVACAO[i]), "Paga uma vez, sem mensalidade. O link vale 7 dias"]),
    "Custo total até a Master": cadaTamanho((i) => [usd(QUAL_PRECO[i] + QUAL_ATIVACAO[i])]),
    "Reset da avaliação": ["$78. Devolve o saldo inicial, mas não estende o acesso de 30 dias"],
  },
  fontes: [
    fonte("accounts-pricing"),
    fonte("help-center/qualification"),
    fonte("help-center/master"),
    fonte("help-center/funded"),
    fonte("faq"),
  ],
}

// ---- FAST TRACK ----
const FT_PRECO = [338, 488, 648, 788] as const
const FT_PERDA = [1000, 2250, 4000, 5500] as const
const FT_DLL = [null, 1200, 2500, 3300] as const
const FT_TETO_INICIAL = [1000, 2000, 2500, 3000] as const
const FT_TETO_DEPOIS = [1250, 2500, 3000, 3500] as const
const FT_META_DEMAIS = [1000, 2000, 3000, 4500] as const

const FAST_TRACK: Plano = {
  id: "fast-track",
  nome: "Fast Track",
  resumo: "Sem avaliação: você compra e opera na conta financiada simulada no primeiro dia. Saque processado no mesmo dia, com consistência de 20% que sobe até 30%.",
  paraQuem: "Quem já tem método validado e prefere pagar mais pra pular a avaliação e sacar mais rápido.",
  caminho: "direto",
  drawdown: { avaliacao: null, financiada: "ESCOLHA" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 20 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: 3,
  destaques: [
    "Sem avaliação: paga uma vez e já opera na conta financiada simulada",
    "Sem mínimo de dias pra pedir o primeiro saque",
    "Pedido feito até 12:01 (Central) em dia útil costuma ser processado no mesmo dia",
    "Os primeiros $10.000 em saques são 100% seus",
  ],
  atencao: [
    "É a opção mais cara da Bulenox: de $338 a $788",
    "A consistência sobe a cada saque (20%, depois 25%, depois 30%) e a meta de lucro é sempre de lucro novo depois do último saque",
    "O saque não pode levar o saldo até o limite do drawdown",
    "O modelo de risco (Opção 1 ou 2) é definitivo depois da compra",
    "O site não informa reset da conta Fast Track",
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: null,
    perdaMaxima: FT_PERDA[i],
    limiteDiario: FT_DLL[i],
    lotes: { minis: MINIS_OPCAO_1[i], micros: MINIS_OPCAO_1[i] * 10 },
    travaTrailing: null,
    saque: {
      minimo: 1000,
      metaLucroCiclo: { primeiro: META[i], demais: FT_META_DEMAIS[i] },
      maximos: [
        { rotulo: "1º ao 3º saque", valor: FT_TETO_INICIAL[i] },
        { rotulo: "4º em diante", valor: FT_TETO_DEPOIS[i] },
      ],
    },
    liveBonus: null,
    precoTabelaUsd: FT_PRECO[i],
  })),
  celulas: {
    Drawdown: [ESCOLHA_DRAWDOWN, OPCAO_1, OPCAO_2, "Nas duas, trava em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) =>
      FT_DLL[i] == null
        ? ["Não tem no 25K"]
        : [`Só na Opção 2: ${usd(FT_DLL[i]!)} (pausa o dia, não quebra a conta)`, "Vale a vida toda da conta"]
    ),
    Consistência: ["Saque: 20% no 1º, 25% no 2º e 30% do 3º em diante, sobre o lucro do ciclo"],
    "Lote máximo": cadaTamanho((i) => [
      `Opção 1: ${MINIS_OPCAO_1[i]} minis / ${MINIS_OPCAO_1[i] * 10} micros`,
      `Opção 2: ${MINIS_OPCAO_2_FIXO[i]} minis / ${MINIS_OPCAO_2_FIXO[i] * 10} micros, sem escalonamento`,
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      `Lucro de ${usd(META[i])} no 1º saque e ${usd(FT_META_DEMAIS[i])} de lucro novo nos seguintes`,
      "Maior dia dentro da consistência (20%, 25% e depois 30%)",
      "Sem mínimo de dias de trading",
      "Pedido mínimo de $1.000",
    ]),
    "Frequência de saque": ["Quando bater a meta de lucro. Pedidos até 12:01 (Central), de segunda a sexta, saem no mesmo dia"],
    "Bônus ao ir pra Live": ["Não tem. Depois de 3 saques e 30 dias de trading a Bulenox pode considerar a conta pra Funded (regras gerais abaixo)"],
  },
  extras: {
    "Taxa de ativação da Master": ["Nenhuma informada: a compra é única"],
    "Custo total até a Master": cadaTamanho((i) => [usd(FT_PRECO[i])]),
    "Reset da avaliação": ["Não tem avaliação"],
  },
  fontes: [fonte("accounts-pricing"), fonte("help-center/fast-track"), fonte("help-center/funded"), fonte("faq")],
}

// ---- MOMENTUM ----
const MOM_PRECO = [94, 143, 248, 358] as const
const MOM_PERDA = [1000, 2250, 4000, 5500] as const
const MOM_DLL = [600, 1200, 2500, 3300] as const
const MOM_SALDO_MINIMO = [26500, 53000, 104500, 156500] as const
const MOM_MINIMO_SAQUE = [500, 1000, 1000, 1000] as const

const MOMENTUM: Plano = {
  id: "momentum",
  nome: "Momentum",
  resumo: "Avaliação em que a Master já vem incluída: sem taxa de ativação. Sem mínimo de dias na avaliação, e saque processado no mesmo dia com 5 dias de lucro e consistência de 35%.",
  paraQuem: "Quem quer o menor custo total até a conta financiada e aceita uma avaliação de 30 dias de acesso.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "ESCOLHA", financiada: "ESCOLHA" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 35 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "A partir de $94: menor custo total da Bulenox, com a Master incluída",
    "Ativação da Master de graça, sem taxa e sem mensalidade",
    "Avaliação sem mínimo de dias e sem consistência",
    "Pedido de saque processado no mesmo dia, sem a espera semanal da Master comum",
  ],
  atencao: [
    "O acesso à avaliação vale 30 dias",
    "Cada saque exige 5 dias com lucro mínimo, consistência de 35% sobre o lucro do ciclo e saldo mínimo",
    "Passar a meta não abre a Master na hora: existe revisão antes da ativação",
    "O lucro da avaliação não passa pra Master: ela começa com o saldo inicial",
    "O modelo de risco (Opção 1 ou 2) é definitivo depois da compra",
    "O site não informa o reset do Momentum",
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: META[i],
    perdaMaxima: MOM_PERDA[i],
    limiteDiario: MOM_DLL[i],
    lotes: { minis: MINIS_OPCAO_1[i], micros: MINIS_OPCAO_1[i] * 10 },
    travaTrailing: null,
    saque: {
      minimo: MOM_MINIMO_SAQUE[i],
      diasComLucro: { dias: 5, lucroMinimoPorDia: DIAS_VENCEDORES[i] },
      maximos: [
        { rotulo: "1º saque", valor: [1000, 1500, 2000, 2500][i] },
        { rotulo: "2º saque", valor: [1000, 2000, 2500, 3000][i] },
        { rotulo: "3º saque", valor: [1000, 2500, 3000, 4000][i] },
        { rotulo: "4º em diante", valor: [1000, 3000, 4000, 5000][i] },
      ],
    },
    liveBonus: null,
    precoTabelaUsd: MOM_PRECO[i],
  })),
  celulas: {
    Drawdown: [ESCOLHA_DRAWDOWN, OPCAO_1, OPCAO_2],
    "Limite de perda diário": cadaTamanho((i) => [`Só na Opção 2: ${usd(MOM_DLL[i])} (pausa o dia, não quebra a conta)`]),
    Consistência: ["Avaliação: não tem", "Saque: 35% do lucro do ciclo"],
    "Lote máximo": cadaTamanho((i) => [
      `Opção 1: ${MINIS_OPCAO_1[i]} minis / ${MINIS_OPCAO_1[i] * 10} micros`,
      `Opção 2: ${MINIS_OPCAO_2_FIXO[i]} minis / ${MINIS_OPCAO_2_FIXO[i] * 10} micros, sem escalonamento`,
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      `5 dias com lucro líquido de pelo menos ${usd(DIAS_VENCEDORES[i])}, em cada ciclo`,
      `Saldo de pelo menos ${usd(MOM_SALDO_MINIMO[i])}`,
      "Maior dia ≤ 35% do lucro do ciclo",
      `Pedido mínimo de ${usd(MOM_MINIMO_SAQUE[i])}`,
    ]),
    "Frequência de saque": ["A cada 5 dias com lucro, quando cumprir os critérios. O pedido sai no mesmo dia"],
    "Bônus ao ir pra Live": ["Não tem. A Bulenox pode considerar a conta pra Funded depois de 3 saques (regras gerais abaixo)"],
  },
  extras: {
    "Taxa de ativação da Master": ["Grátis: a Master já vem incluída"],
    "Custo total até a Master": cadaTamanho((i) => [usd(MOM_PRECO[i])]),
    "Reset da avaliação": ["Não informado no site"],
  },
  fontes: [fonte("accounts-pricing"), fonte("help-center/momentum"), fonte("faq")],
}

export const BULENOX: Mesa = {
  slug: "bulenox",
  nome: "Bulenox",
  urlOficial: `${SITE}/`,
  linkAfiliado: null,
  splitTrader: 90,
  resumo:
    "Mesa de futuros com 3 caminhos: Qualification (avaliação barata que vira Master), Momentum (avaliação com a Master já incluída) e Fast Track (compra direta na financiada). Pagamento único, sem mensalidade, e os primeiros $10.000 em saques ficam 100% com você.",
  planos: [QUALIFICATION, MOMENTUM, FAST_TRACK],
  ajudaPreco: "Preço de tabela, pagamento único. O acesso à avaliação vale 30 dias. Promoções e cupons aparecem no checkout.",
  linhasExtras: [
    { rotulo: "Taxa de ativação da Master", ajuda: "Na Qualification, depois de passar você paga uma taxa única pra ativar a Master. No Momentum ela é grátis e no Fast Track não existe." },
    { rotulo: "Custo total até a Master", ajuda: "Preço da conta somado à taxa de ativação, sem promoção." },
    { rotulo: "Reset da avaliação", ajuda: "Se você quebra a avaliação, pode recomeçar no mesmo tamanho pagando o reset." },
  ],
  avisos: [
    "Antes de comprar, você escolhe entre Opção 1 (trailing em tempo real, contratos cheios) e Opção 2 (EOD, com limite de perda diário). A escolha vale pra vida toda da conta, e a tabela mostra as duas.",
    "Os saques têm regras diferentes por plano: a Master (Qualification) paga toda quarta e exige 10 dias de trading. Fast Track e Momentum processam no mesmo dia.",
  ],
  regrasGerais: [
    {
      titulo: "Dinheiro e saque",
      itens: [
        "Os primeiros $10.000 em saques são 100% seus, contando uma vez por trader, somando todas as contas. Depois disso você fica com 90%",
        "Você recebe por transferência (ACH ou wire) ou PayPal. A Bulenox não cobra taxa, mas o banco ou o PayPal podem cobrar",
        "Antes do primeiro saque é preciso enviar o formulário de saque, um documento de identidade e o formulário fiscal (o W-8BEN pra quem não é americano). O W-8BEN precisa ser assinado à mão: assinatura eletrônica não é aceita",
        "Quem for americano recebe o formulário 1099-NEC. Os traders são prestadores independentes e cuidam dos próprios impostos",
        "Na Master, o saque é processado uma vez por semana, na quarta. Pedidos até sexta 23:59 (horário Central) entram na quarta seguinte",
        "No Fast Track e no Momentum, pedidos feitos até 12:01 (Central) de segunda a sexta costumam sair no mesmo dia. Fim de semana, feriado bancário e checagens podem atrasar",
      ],
    },
    {
      titulo: "Compra, taxas e limites",
      itens: [
        "Todas as contas são pagamento único: não existe assinatura e nada renova sozinho. O acesso à avaliação vale 30 dias e expira sozinho",
        "Pagamento por cartão de crédito, débito, PayPal ou cripto",
        "Não há reembolso depois que a conta é criada e acessada. Dá pra encerrar antes, mas a conta não volta",
        "Dados de mercado: quem se declara não profissional não paga nada. Quem se declara profissional paga cerca de $116 por mês. A escolha é feita no acordo da Rithmic e vale pra vida toda",
        "Comissão por lado, já com taxas da bolsa: $2,09 no ES e no NQ ($4,18 ida e volta) e $0,61 no MES e no MNQ ($1,22 ida e volta)",
        "Até 5 contas de nível Master ao mesmo tempo, somando Master, Fast Track e Momentum. Avaliações (Qualification) são ilimitadas",
        "Um perfil e um usuário Rithmic por trader. Criar mais de um pode levar à suspensão",
      ],
    },
    {
      titulo: "Como operar",
      itens: [
        "Notícia liberada, sem bloqueio nem fechamento forçado. Os limites são o drawdown e o número de contratos",
        "O dia de trading vai das 17:00 às 16:00 (Central). Tudo precisa estar fechado até 15:59. Segurar posição de um dia pro outro ou no fim de semana é proibido",
        "Micro e mini juntos, com 1 mini = 10 micros",
        "Robô, algoritmo e copiador são permitidos só se forem ferramentas suas, pra uso pessoal. Ferramenta comercial, compartilhada ou alugada é proibida. Conectar por API de terceiros na Rithmic custa $100 por mês",
        "O drawdown da Opção 1 (trailing) inclui o lucro aberto e só sobe. Se você fechar com menos lucro, o limite fica onde estava",
        "Nos limites diários da Opção 2, bater o limite só pausa o dia. Ultrapassar o drawdown fecha ou suspende a conta",
        "Se a plataforma ou os dados falharem em dia de muita volatilidade, a Bulenox diz que não se responsabiliza",
      ],
    },
    {
      titulo: "Plataforma",
      itens: [
        "Todas as contas operam pela Rithmic, com mais de 20 plataformas (NinjaTrader, R|Trader Pro, Quantower, Sierra Chart, MultiCharts, ATAS...). A Master vem com licença grátis do NinjaTrader 8",
        "A Rithmic só roda no Windows. Ela não é compatível com macOS nem com ChromeOS, então quem usa Mac precisa de outro caminho (como um computador Windows ou uma VPS)",
        "A Rithmic faz manutenção nos fins de semana e o login pode ficar indisponível",
        "Mais de 40 futuros da CME, CBOT, NYMEX e COMEX: índices, energia, metais, moedas, grãos, pecuária e micro Bitcoin e Ether",
      ],
    },
    {
      titulo: "Conta Funded (Live)",
      itens: [
        "Depois de 3 saques bem-sucedidos, a Bulenox pode considerar suas contas Master pra uma Funded. Não é automático e depende da análise de risco deles. No Fast Track são 3 saques e 30 dias de trading",
        "Conta Master com pelo menos 1 saque também pode ser considerada, e cada uma vira uma Funded separada. Conta sem nenhum saque não migra",
        "Nenhum lucro ou saldo da Master passa pra Funded. Cada Funded começa com um drawdown EOD próprio: $1.500 (25K), $2.000 (50K), $3.000 (100K) ou $4.500 (150K)",
        "Se você não aceitar a transição, a Master é fechada. Você precisa assinar o acordo da Funded e enviar os documentos",
      ],
    },
    {
      titulo: "Quem pode operar",
      itens: [
        "A Bulenox atende mais de 100 países e tem uma lista de países restritos",
        "O Brasil não aparece na lista, mas ela pode mudar com regulamentações",
        "Não há verificação de antecedentes pra abrir a conta",
      ],
    },
  ],
  vantagens: [
    "Avaliação sem mínimo de dias e sem consistência",
    "Os primeiros $10.000 em saques ficam 100% com você",
    "Pagamento único: sem mensalidade, e a Master do Momentum tem ativação grátis",
    "Notícia liberada e até 15:59 (Central) pra operar",
    "Fast Track e Momentum processam o saque no mesmo dia",
    "Escolha entre trailing com contratos cheios (Opção 1) e EOD com limite diário (Opção 2)",
  ],
  atencao: [
    "O acesso à avaliação vale 30 dias, e o reset não estende o prazo",
    "A Rithmic só roda no Windows",
    "Na Master (Qualification) o saque exige 10 dias de trading, uma reserva na conta e consistência de 40% que não zera",
    "O formulário fiscal W-8BEN tem que ser assinado à mão",
    "A escolha de modelo de risco (Opção 1 ou 2) e a de dados de mercado (profissional ou não) são definitivas",
    "Sem reembolso depois que a conta é criada e acessada",
    "O Help Center e a página de preços são a fonte das regras",
  ],
  quiz: QUIZ_BULENOX,
  verificadoEm: VERIFICADO,
  fontes: [
    fonte("accounts-pricing"),
    fonte("faq"),
    fonte("help-center/connection"),
    fonte("help-center/subscription"),
    fonte("legal/Bulenox-Rates.pdf"),
  ],
}
