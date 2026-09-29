// Tradeify: dados lidos SÓ do Help Center oficial em 2026-09-29 (help.tradeify.co, pelo Chrome do Marcelo: o Help Center
// fica atrás de Cloudflare). Levantamento: docs/mesas-proprietarias/tradeify-levantamento-2026-09-29.md.
// Blog do site NÃO é fonte (é marketing). Regras mudam sem aviso (Select mudou em 01/09/2026): quem edita este arquivo
// confere antes no Help Center oficial. Valem as contas NOVAS (Select a partir de 01/09/2026, Lightning a partir de 12/09/2025).

import { QUIZ_TRADEIFY } from "./quiz-tradeify"
import { TAMANHOS } from "./types"
import type { Celula, DadosTamanho, FaixaEscalonamento, Fonte, Mesa, Plano, PorTamanho, Tamanho } from "./types"

const VERIFICADO = "2026-09-29"
const SITE = "https://tradeify.co"
const HELP = "https://help.tradeify.co/en/articles"

/** Artigo do Help Center oficial (o slug inclui o número). */
const fonteHc = (slug: string): Fonte => ({ url: `${HELP}/${slug}`, verificadoEm: VERIFICADO })

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

/** Célula por tamanho a partir de uma função do índice do tamanho. */
const cadaTamanho = (fn: (i: 0 | 1 | 2 | 3) => string[]): Celula => porTamanho([fn(0), fn(1), fn(2), fn(3)])

const usd = (n: number) => `$${n.toLocaleString("en-US")}`
const TAM = [25000, 50000, 100000, 150000] as const

// ---- números compartilhados ----
const META = [1500, 3000, 6000, 9000] as const // Growth, Select e meta do 1º saque do Lightning
const LOTES_CHEIO = [1, 4, 8, 12] as const // limite da avaliação e do Growth/Lightning
const DIA_VENCEDOR = [100, 150, 200, 250] as const // lucro mínimo do dia pra contar (Growth e Select Flex)

/** Escalonamento das financiadas Select (Flex e Daily): sobe conforme o lucro no fechamento. Na avaliação vale o limite cheio. */
const ESCALONAMENTO_SELECT: PorTamanho<FaixaEscalonamento[]> = porTamanho([
  [
    { lucroMinimo: 0, minis: 1, micros: 10 },
    { lucroMinimo: 1500, minis: 2, micros: 20 },
  ],
  [
    { lucroMinimo: 0, minis: 2, micros: 20 },
    { lucroMinimo: 1500, minis: 3, micros: 30 },
    { lucroMinimo: 2000, minis: 4, micros: 40 },
  ],
  [
    { lucroMinimo: 0, minis: 3, micros: 30 },
    { lucroMinimo: 1500, minis: 4, micros: 40 },
    { lucroMinimo: 2000, minis: 5, micros: 50 },
    { lucroMinimo: 3000, minis: 8, micros: 80 },
  ],
  [
    { lucroMinimo: 0, minis: 3, micros: 30 },
    { lucroMinimo: 1500, minis: 4, micros: 40 },
    { lucroMinimo: 2000, minis: 5, micros: 50 },
    { lucroMinimo: 3000, minis: 8, micros: 80 },
    { lucroMinimo: 4500, minis: 12, micros: 120 },
  ],
])

const SELECT_MINIS_TOPO = [2, 4, 8, 12] as const
const SELECT_PRECO = [109, 165, 265, 369] as const
const SELECT_PRECO_50 = [135, 205, 329, 459] as const
const SELECT_RESET = [75, 109, 169, 239] as const
const SELECT_RESET_50 = [90, 135, 209, 299] as const
const SELECT_PERDA_AVALIACAO = [1000, 2000, 3000, 4500] as const

const NOTA_CONTAS_ANTIGAS = "Contas compradas antes de 12/09/2025 (Growth e Lightning) ou de 01/09/2026 (tetos do Select) seguem números antigos: esta tabela mostra os atuais"

// ---- GROWTH ----
const GROWTH_PERDA = [1000, 2000, 3500, 5000] as const
const GROWTH_DLL = [600, 1250, 2500, 3750] as const
const GROWTH_PRECO = [99, 145, 255, 369] as const
const GROWTH_RESET = [60, 95, 155, 215] as const
const GROWTH_SALDO_MINIMO = [26500, 53000, 104500, 156500] as const
const GROWTH_MINIMO_SAQUE = [250, 500, 1000, 1500] as const
const GROWTH_TRAVA = [26100, 52100, 103600, 155100] as const

const GROWTH: Plano = {
  id: "growth",
  nome: "Growth",
  resumo: "A avaliação mais barata e a única que dá pra passar em 1 dia, sem consistência. Na financiada tem limite de perda diário e consistência de 35% pra sacar.",
  paraQuem: "Quem quer entrar barato ($99 no 25K) e passar rápido, e aceita um limite de perda diário como proteção.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 35 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "A entrada mais barata da Tradeify: a partir de $99, pagamento único",
    "Avaliação sem consistência: um dia bom que bata a meta já passa",
    "Sem prazo pra passar e sem taxa de ativação",
    "Ativação da financiada na hora, direto pelo painel",
  ],
  atencao: [
    "O limite de perda diário existe já na avaliação: bateu, você fica travado até a próxima sessão (a conta não quebra)",
    "Na financiada seu maior dia não pode passar de 35% do lucro pra liberar o saque",
    "O saque exige 5 dias com lucro e saldo mínimo, e a forma de pagamento é fixa (não dá pra escolher Flex ou Daily)",
    "O drawdown é EOD, mas encostar nele durante o dia já quebra a conta, mesmo que você recupere depois",
    NOTA_CONTAS_ANTIGAS,
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: META[i],
    perdaMaxima: GROWTH_PERDA[i],
    limiteDiario: GROWTH_DLL[i],
    lotes: { minis: LOTES_CHEIO[i], micros: LOTES_CHEIO[i] * 10 },
    travaTrailing: GROWTH_TRAVA[i],
    saque: {
      minimo: GROWTH_MINIMO_SAQUE[i],
      diasComLucro: { dias: 5, lucroMinimoPorDia: DIA_VENCEDOR[i] },
      maximos: [
        { rotulo: "1º saque", valor: [1000, 1500, 2000, 2500][i] },
        { rotulo: "2º saque", valor: [1000, 2000, 2500, 3000][i] },
        { rotulo: "3º saque", valor: [1000, 2500, 3000, 4000][i] },
        { rotulo: "4º em diante", valor: [1000, 3000, 4000, 5000][i] },
      ],
    },
    liveBonus: null,
    precoTabelaUsd: GROWTH_PRECO[i],
  })),
  celulas: {
    Drawdown: ["Fim do dia (EOD)", "O limite só sobe no fechamento, mas encostar nele durante o dia já quebra a conta", "Na financiada, trava em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) => [
      `${usd(GROWTH_DLL[i])}: pausa o dia, não quebra a conta`,
      `Sobe pra ${usd(GROWTH_PERDA[i])} aos 6% de lucro`,
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      `5 dias com lucro de pelo menos ${usd(DIA_VENCEDOR[i])}`,
      `Saldo de pelo menos ${usd(GROWTH_SALDO_MINIMO[i])}`,
      "Maior dia ≤ 35% do lucro",
    ]),
    "Frequência de saque": ["A cada 5 dias com lucro, quando cumprir os critérios"],
    "Bônus ao ir pra Live": ["Não tem. Quem vai pra conta Live é escolhido pela Tradeify (regras gerais abaixo)"],
  },
  extras: {
    "Reset da avaliação": cadaTamanho((i) => [usd(GROWTH_RESET[i])]),
    "Com consistência de 50% (add-on)": ["Não existe no Growth"],
  },
  fontes: [
    fonteHc("10495915-growth-evaluation-accounts"),
    fonteHc("11083796-growth-funded-account-payout-policy"),
    fonteHc("14369021-tradeify-pricing-reference"),
    fonteHc("10468321-rules-daily-loss-limit"),
    fonteHc("10495897-rules-trailing-max-drawdowns"),
    fonteHc("10468320-rules-consistency-rule"),
  ],
}

// ---- SELECT FLEX ----
const FLEX_TRAVA = [26100, 52100, 103100, 154600] as const
const FLEX_TETO = [1250, 2500, 3500, 4500] as const // compras a partir de 01/09/2026

const SELECT_FLEX: Plano = {
  id: "select-flex",
  nome: "Select Flex",
  resumo: "Avaliação Select (mínimo de 3 dias) e, na financiada, sem limite de perda diário e sem consistência. Saque a cada 5 dias com lucro, de até 50% do lucro.",
  paraQuem: "Quem opera com liberdade no dia (sem trava diária) e prefere sacar valores maiores com menos frequência.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: 40, financiada: null },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Na financiada não tem limite de perda diário nem consistência",
    "Sem saldo mínimo: dá pra pedir saque assim que juntar 5 dias com lucro",
    "Você escolhe Flex ou Daily só depois de passar na avaliação",
    "Pagamento único e sem taxa de ativação",
  ],
  atencao: [
    "A avaliação tem consistência de 40% e exige no mínimo 3 dias (com o add-on de 50%, no mínimo 2)",
    "A escolha entre Flex e Daily é permanente naquela conta",
    "O saque é de até 50% do lucro total, com teto por pedido; a partir do 2º saque o ciclo precisa estar no lucro",
    "Você começa a financiada com menos contratos e sobe com o lucro",
    "O drawdown é EOD, mas encostar nele durante o dia já quebra a conta",
    NOTA_CONTAS_ANTIGAS,
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: META[i],
    perdaMaxima: SELECT_PERDA_AVALIACAO[i],
    limiteDiario: null,
    lotes: { minis: SELECT_MINIS_TOPO[i], micros: SELECT_MINIS_TOPO[i] * 10 },
    travaTrailing: FLEX_TRAVA[i],
    saque: {
      minimo: 250,
      diasComLucro: { dias: 5, lucroMinimoPorDia: DIA_VENCEDOR[i] },
      maximos: [{ rotulo: "Cada pedido", valor: FLEX_TETO[i], pctDoLucro: 50 }],
    },
    escalonamento: ESCALONAMENTO_SELECT[t],
    liveBonus: null,
    precoTabelaUsd: SELECT_PRECO[i],
  })),
  exigeLucroLiquidoNoCiclo: true,
  celulas: {
    Drawdown: ["Fim do dia (EOD)", "O limite só sobe no fechamento, mas encostar nele durante o dia já quebra a conta", "Na financiada, trava em saldo inicial + $100"],
    "Lote máximo": cadaTamanho((i) => [
      `Avaliação: ${LOTES_CHEIO[i]} ${LOTES_CHEIO[i] === 1 ? "mini" : "minis"} / ${LOTES_CHEIO[i] * 10} micros`,
      `Financiada: começa em ${ESCALONAMENTO_SELECT[TAM[i] / 1000 as Tamanho][0].minis} e chega a ${SELECT_MINIS_TOPO[i]} minis / ${SELECT_MINIS_TOPO[i] * 10} micros`,
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      `5 dias com lucro de pelo menos ${usd(DIA_VENCEDOR[i])}`,
      "Sem saldo mínimo",
      "A partir do 2º saque, lucro líquido positivo no ciclo",
    ]),
    "Quanto dá pra sacar": cadaTamanho((i) => [
      `Até 50% do lucro total, no máximo ${usd(FLEX_TETO[i])} por pedido`,
      "O lucro total é o saldo menos o saldo inicial (não só o do ciclo)",
    ]),
    "Frequência de saque": ["A cada 5 dias com lucro, quando cumprir os critérios"],
    "Bônus ao ir pra Live": ["Não tem. Quem vai pra conta Live é escolhido pela Tradeify (regras gerais abaixo)"],
  },
  extras: {
    "Reset da avaliação": cadaTamanho((i) => [usd(SELECT_RESET[i])]),
    "Com consistência de 50% (add-on)": cadaTamanho((i) => [`${usd(SELECT_PRECO_50[i])} · reset ${usd(SELECT_RESET_50[i])}`, "Passa em no mínimo 2 dias em vez de 3"]),
  },
  fontes: [
    fonteHc("12853921-select-evaluation-accounts"),
    fonteHc("12853966-select-flex-and-select-daily-payout-policies"),
    fonteHc("14369021-tradeify-pricing-reference"),
    fonteHc("10495897-rules-trailing-max-drawdowns"),
    fonteHc("10468320-rules-consistency-rule"),
  ],
}

// ---- SELECT DAILY ----
const DAILY_PERDA = [1000, 2000, 2500, 3500] as const
const DAILY_DLL = [500, 1000, 1250, 1750] as const
const DAILY_BUFFER = [1100, 2100, 2600, 3600] as const
const DAILY_TETO = [600, 1250, 1750, 2500] as const // compras a partir de 01/09/2026
const DAILY_TRAVA = [26100, 52100, 102600, 153600] as const

const SELECT_DAILY: Plano = {
  id: "select-daily",
  nome: "Select Daily",
  resumo: "Mesma avaliação Select, mas a financiada libera saque todo dia, em valores menores, com limite de perda diário e um colchão de lucro que não sai.",
  paraQuem: "Quem quer fluxo de caixa frequente e aceita um limite de perda diário e um drawdown um pouco menor.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: 40, financiada: null },
  operaNoticia: true,
  saqueDiario: true,
  saquesAteLive: null,
  destaques: [
    "Saque elegível todo dia, pago em até 24 a 48 horas",
    "Sem consistência na financiada",
    "Sem exigência de dias mínimos entre um saque e outro",
    "Pagamento único e sem taxa de ativação",
  ],
  atencao: [
    "Tem limite de perda diário na financiada (não use como stop: a perda pode passar dele e quebrar o drawdown)",
    "Os primeiros dólares de lucro (o colchão) ficam na conta e não saem",
    "Cada pedido é de no máximo 2× o lucro desde o último saque, com teto por tamanho",
    "A escolha entre Flex e Daily é permanente naquela conta",
    "No 100K e no 150K o drawdown da financiada é menor que o da avaliação",
    NOTA_CONTAS_ANTIGAS,
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: META[i],
    perdaMaxima: DAILY_PERDA[i],
    limiteDiario: DAILY_DLL[i],
    lotes: { minis: SELECT_MINIS_TOPO[i], micros: SELECT_MINIS_TOPO[i] * 10 },
    travaTrailing: DAILY_TRAVA[i],
    saque: {
      minimo: 250,
      colchao: DAILY_BUFFER[i],
      maximos: [{ rotulo: "Cada pedido (até 2× o lucro desde o último saque)", valor: DAILY_TETO[i] }],
    },
    escalonamento: ESCALONAMENTO_SELECT[t],
    liveBonus: null,
    precoTabelaUsd: SELECT_PRECO[i],
  })),
  exigeLucroLiquidoNoCiclo: true,
  celulas: {
    "Perda máxima": cadaTamanho((i) =>
      SELECT_PERDA_AVALIACAO[i] === DAILY_PERDA[i]
        ? [usd(DAILY_PERDA[i])]
        : [`Avaliação: ${usd(SELECT_PERDA_AVALIACAO[i])}`, `Financiada: ${usd(DAILY_PERDA[i])}`]
    ),
    Drawdown: ["Fim do dia (EOD)", "O limite só sobe no fechamento, mas encostar nele durante o dia já quebra a conta", "Na financiada, trava em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) => ["Avaliação: não tem", `Financiada: ${usd(DAILY_DLL[i])} (pausa o dia, não quebra a conta)`]),
    "Lote máximo": cadaTamanho((i) => [
      `Avaliação: ${LOTES_CHEIO[i]} ${LOTES_CHEIO[i] === 1 ? "mini" : "minis"} / ${LOTES_CHEIO[i] * 10} micros`,
      `Financiada: começa em ${ESCALONAMENTO_SELECT[TAM[i] / 1000 as Tamanho][0].minis} e chega a ${SELECT_MINIS_TOPO[i]} minis / ${SELECT_MINIS_TOPO[i] * 10} micros`,
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      `Saldo acima de ${usd(TAM[i] + DAILY_BUFFER[i])} (colchão de ${usd(DAILY_BUFFER[i])} que não sai)`,
      "Lucro positivo desde o último saque",
      "Sem exigência de dias mínimos",
    ]),
    "Quanto dá pra sacar": cadaTamanho((i) => [
      `Até 2× o lucro desde o último saque, no máximo ${usd(DAILY_TETO[i])} por pedido`,
      "O saldo depois do saque não pode ficar abaixo do colchão",
    ]),
    "Frequência de saque": ["Todos os dias (quando elegível). Só um pedido aberto por vez"],
    "Bônus ao ir pra Live": ["Não tem. Quem vai pra conta Live é escolhido pela Tradeify (regras gerais abaixo)"],
  },
  extras: {
    "Reset da avaliação": cadaTamanho((i) => [usd(SELECT_RESET[i])]),
    "Com consistência de 50% (add-on)": cadaTamanho((i) => [`${usd(SELECT_PRECO_50[i])} · reset ${usd(SELECT_RESET_50[i])}`, "Passa em no mínimo 2 dias em vez de 3"]),
  },
  fontes: [
    fonteHc("12853921-select-evaluation-accounts"),
    fonteHc("12853966-select-flex-and-select-daily-payout-policies"),
    fonteHc("14369021-tradeify-pricing-reference"),
    fonteHc("10468321-rules-daily-loss-limit"),
    fonteHc("10495897-rules-trailing-max-drawdowns"),
  ],
}

// ---- LIGHTNING FUNDED ----
const LIGHTNING_PERDA = [1000, 2000, 4000, 5250] as const
const LIGHTNING_DLL = [null, 1250, 2500, 3000] as const
const LIGHTNING_PRECO = [345, 492, 660, 796] as const
// 150K: a tabela oficial de trava (156.100) ainda usa o drawdown antigo de $6.000; com $5.250 não bate, então fica sem valor
const LIGHTNING_TRAVA = [26100, 52100, 104100, null] as const
const LIGHTNING_META_DEMAIS = [1000, 2000, 3500, 4500] as const

const LIGHTNING: Plano = {
  id: "lightning",
  nome: "Lightning Funded",
  resumo: "Compra já financiada, sem avaliação. Você começa a trabalhar pro saque no primeiro dia, com consistência que sobe de 20% pra 30%.",
  paraQuem: "Quem já tem método validado e prefere pagar mais pra pular a avaliação.",
  caminho: "direto",
  drawdown: { avaliacao: null, financiada: "EOD" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 20 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Sem avaliação: você começa financiado no dia da compra",
    "Sem exigência de dias mínimos pra pedir saque",
    "O pedido de saque sai direto pelo painel quando bate a meta e a consistência",
    "Pagamento único e sem taxa de ativação",
  ],
  atencao: [
    "Não tem reset: se a conta quebrar, é preciso comprar outra",
    "É a opção mais cara da Tradeify e a consistência exigida sobe a cada saque (20%, depois 25%, depois 30%)",
    "O teto por saque é baixo em relação à meta: no 150K você precisa lucrar $9.000 pra sacar no máximo $3.000 no 1º saque",
    "Depois de cada saque a meta de lucro zera: o lucro que sobrou não conta pro próximo",
    "O 25K não tem limite de perda diário, mas os outros tamanhos têm",
    NOTA_CONTAS_ANTIGAS,
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: null,
    perdaMaxima: LIGHTNING_PERDA[i],
    limiteDiario: LIGHTNING_DLL[i],
    lotes: { minis: LOTES_CHEIO[i], micros: LOTES_CHEIO[i] * 10 },
    travaTrailing: LIGHTNING_TRAVA[i],
    saque: {
      minimo: 1000,
      metaLucroCiclo: { primeiro: META[i], demais: LIGHTNING_META_DEMAIS[i] },
      maximos: [
        { rotulo: "1º ao 3º saque", valor: [1000, 2000, 2500, 3000][i] },
        { rotulo: "4º em diante", valor: [1000, 2500, 3000, 3500][i] },
      ],
    },
    liveBonus: null,
    precoTabelaUsd: LIGHTNING_PRECO[i],
  })),
  celulas: {
    Drawdown: ["Fim do dia (EOD)", "O limite só sobe no fechamento, mas encostar nele durante o dia já quebra a conta", "Trava em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) =>
      LIGHTNING_DLL[i] == null ? ["Não tem"] : [`${usd(LIGHTNING_DLL[i]!)}: pausa o dia, não quebra a conta`, "Sobe aos 6% de lucro"]
    ),
    Consistência: ["Saque: 20% no 1º, 25% no 2º e 30% do 3º em diante"],
    "Pra liberar o saque": cadaTamanho((i) => [
      `Lucro de ${usd(META[i])} no 1º saque e ${usd(LIGHTNING_META_DEMAIS[i])} nos seguintes`,
      "Maior dia dentro da consistência (20%, 25% e depois 30%)",
      "Sem exigência de dias mínimos",
    ]),
    "Frequência de saque": ["Quando bater a meta de lucro e a consistência. Só um pedido aberto por vez"],
    "Bônus ao ir pra Live": ["Não tem. Quem vai pra conta Live é escolhido pela Tradeify (regras gerais abaixo)"],
  },
  extras: {
    "Reset da avaliação": ["Não tem reset: quebrou, compra outra"],
    "Com consistência de 50% (add-on)": ["Não existe no Lightning"],
  },
  fontes: [
    fonteHc("10495938-lightning-funded-accounts"),
    fonteHc("10495932-lightning-funded-account-payout-policy"),
    fonteHc("14369021-tradeify-pricing-reference"),
    fonteHc("10468321-rules-daily-loss-limit"),
    fonteHc("10468320-rules-consistency-rule"),
  ],
}

export const TRADEIFY: Mesa = {
  slug: "tradeify",
  nome: "Tradeify",
  urlOficial: `${SITE}/`,
  linkAfiliado: null,
  splitTrader: 90,
  resumo:
    "Mesa de futuros com 4 caminhos: Growth (a avaliação mais barata), Select (com saque Flex ou Daily) e Lightning (já financiada, sem avaliação). Tudo em pagamento único, sem mensalidade e sem taxa de ativação, e você fica com 90% dos saques.",
  planos: [GROWTH, SELECT_FLEX, SELECT_DAILY, LIGHTNING],
  ajudaPreco: "Preço de tabela, pagamento único. As promoções são frequentes e aparecem no checkout.",
  linhasExtras: [
    { rotulo: "Reset da avaliação", ajuda: "Se você quebra a avaliação, dá pra recomeçar pagando o reset (mais barato que comprar de novo)." },
    { rotulo: "Com consistência de 50% (add-on)", ajuda: "Só no Select: custa mais e deixa um único dia pesar até metade do lucro, passando em 2 dias em vez de 3." },
  ],
  avisos: [
    "Contas Select compradas a partir de 01/09/2026 têm tetos de saque menores. A tabela mostra os atuais, e contas antigas seguem os números antigos.",
    "A Tradeify publica que 17,2% das avaliações iniciadas de ago/2025 a jul/2026 foram concluídas. Vale treinar antes de pagar por uma avaliação.",
  ],
  regrasGerais: [
    {
      titulo: "Dinheiro e saque",
      itens: [
        "Você fica com 90% do lucro sacado nas contas simuladas financiadas (Growth, Select e Lightning), desde o primeiro saque",
        "Pagamento pela Rise (principal) ou pela Plane. Depois de aprovado o saque, o dinheiro sai da conta na hora e o pagamento chega em até 24 horas (Lightning) ou 24 a 48 horas (Growth e Select)",
        "Pedidos feitos fora do horário comercial de Nova York (segunda a sexta, 8h às 17h) e em feriados podem levar até 72 horas",
        "O pedido de saque não pode ser editado nem cancelado, e só um pode ficar aberto por vez em cada conta",
        "Se a conta quebrar ou o saldo cair abaixo do mínimo antes de o pedido ser processado, o saque é negado",
        "Não tem taxa de ativação em nenhum tipo de conta",
        "O saldo e o lucro são conferidos todo dia, por volta das 18h às 20h em Nova York, e é essa conferência que libera o pedido de saque",
      ],
    },
    {
      titulo: "Compra, resets e limites",
      itens: [
        "Todas as contas são pagamento único. Não existe assinatura nem cobrança recorrente",
        "Não há reembolso em nenhuma compra, nem em reset. Confira tudo antes de pagar",
        "Compra de 5 contas do mesmo tipo e tamanho (só Growth e Select 25K e 50K) dá 5% de desconto automático, e soma com cupom",
        "Comissão por contrato, ida e volta: $5,76 no ES e no NQ, $1,82 no MES e no MNQ. 10 micros custam bem mais que 1 mini",
        "Dados de mercado de nível 1 são grátis, desde que você assine o acordo de não profissional no primeiro login. Sem isso, cobra-se $300 por mês",
        "Máximo de 15 avaliações compradas em 30 dias, com até 10 resets por avaliação em 30 dias",
        "Até 5 contas financiadas simuladas ao mesmo tempo, somando todos os tipos (no Growth, ativa no máximo 5 por dia)",
        "Plataformas: Tradovate (com NinjaTrader e TradingView), Rithmic (Tradesea, Quantower, Sierra Chart, R|Trader) e WealthCharts. O preço é o mesmo em todas",
      ],
    },
    {
      titulo: "Como operar",
      itens: [
        "Notícia liberada, por sua conta e risco. Em notícia forte pode ter derrapagem e ordens executadas longe do preço esperado",
        "Nada pode ficar aberto depois das 16:45 (Nova York), e em feriado de pregão curto às 12:59. Posição esquecida é fechada sozinha, sem quebrar a conta, mas pode sair num preço ruim",
        "Não dá pra segurar posição de um dia pro outro nem no fim de semana. Dentro de uma mesma sessão (18:00 a 16:45) pode ficar posicionado",
        "O drawdown é calculado no fechamento do dia (EOD), mas vale em tempo real contra o saldo com lucro e prejuízo abertos. Encostou nele, a conta quebra na hora, mesmo que você recupere depois",
        "O limite de perda diário só pausa o dia (volta às 18:00). Não use como stop: a perda pode passar dele e quebrar o drawdown",
        "Scalp: nas contas financiadas, mais de 50% dos trades e mais de 50% do lucro precisam vir de operações de mais de 10 segundos, senão o saque não libera. Na avaliação não vale",
        "Pelo menos 1 trade por semana (segunda a sexta) em qualquer conta. Pode ser de 5 segundos",
        "Robô só se a estratégia for sua, exclusiva e sem alta frequência (você precisa provar). Hedge é proibido, inclusive com posições opostas em ativos correlacionados e entre contas. Explorar erro da plataforma é proibido",
      ],
    },
    {
      titulo: "Conta Live (Tradeify Elite)",
      itens: [
        "Você só entra no radar da Live depois de 3 saques numa mesma conta ou 10 saques no total desde a última transição. Isso é o mínimo pra ser considerado, não garantia",
        "Quem escolhe é a Tradeify e, se você for escolhido, não pode recusar. Todas as contas simuladas fecham. Só as que já tiveram pelo menos 1 saque migram",
        "A conta Live começa com $0: nenhum lucro simulado é levado. Você fica com 80% do lucro, com drawdown EOD de $1.500 (25K) a $4.500 (150K) e sem limite de perda diário",
        "Saque diário de tudo que passar do capital inicial ($0). Se o saque zerar a conta, ela fecha",
        "Cada conta Live ganha um fundo de recompensa (de $2.000 no 25K a $12.000 no 150K, com bônus de 1,5× pra quem veio do Select com boa consistência), liberado por mês conforme desempenho",
        "Você não pode ter conta simulada financiada e Live ativas ao mesmo tempo, nem qualquer pessoa do seu domicílio. Se quebrar a Live, espera até 4 semanas pra recomeçar",
        "Na Live precisa de pelo menos 1 trade a cada 30 dias, senão a conta fecha",
      ],
    },
    {
      titulo: "Quem pode operar",
      itens: [
        "A regra vale pelo país onde você mora, não por onde você está",
        "Há uma lista de 58 países restritos. O Brasil não aparece nela, mas a lista pode mudar",
      ],
    },
    {
      titulo: "Fora desta comparação",
      itens: [
        "Select 300K: lançamento limitado, com KYC antes da compra, sem reset e no máximo 3 por pessoa",
        "Se a Tradeify colocar você no modo Elite-Only, só o plano Select fica disponível pra comprar",
      ],
    },
  ],
  vantagens: [
    "Pagamento único: sem mensalidade e sem cobrança recorrente",
    "Sem taxa de ativação em nenhuma conta",
    "Você fica com 90% dos saques desde o primeiro",
    "Notícia liberada",
    "Growth passa em 1 dia (sem consistência na avaliação), e o Lightning pula a avaliação",
    "Sem prazo pra passar a avaliação",
    "Saque Daily elegível todo dia, e Select Flex sem limite de perda diário nem consistência",
  ],
  atencao: [
    "Não há reembolso em nenhuma compra nem em reset",
    "O drawdown é EOD, mas quebra a conta na hora se o saldo com lucro aberto encostar nele",
    "Posições precisam estar fechadas até 16:45 (Nova York)",
    "Escolher Flex ou Daily depois da avaliação é permanente",
    "As regras de saque do Select mudaram em 01/09/2026, e contas antigas seguem as regras antigas",
    "Se a Tradeify chamar você pra Live, não dá pra recusar, e a conta começa zerada",
    "O Help Center é a fonte das regras: quando a página de venda divergir dele, vale o Help Center",
  ],
  quiz: QUIZ_TRADEIFY,
  verificadoEm: VERIFICADO,
  fontes: [
    fonteHc("12268167-essential-trading-rules-overview"),
    fonteHc("10495876-rules-permitted-times-to-trade"),
    fonteHc("10495874-rules-news-trading"),
    fonteHc("10495888-rules-restricted-countries"),
    fonteHc("12969284-tradeify-elite-program"),
    fonteHc("14135902-tradeify-3-0-program-updates-improvements"),
    { url: `${SITE}/`, verificadoEm: VERIFICADO },
  ],
}
