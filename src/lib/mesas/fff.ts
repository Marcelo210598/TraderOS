// Funded Futures Family (FFF): dados lidos SÓ do site oficial em 2026-09-28 (fundedfuturesfamily.com).
// Levantamento completo: docs/mesas-proprietarias/fff-levantamento-2026-09-28.md. Blog NÃO é fonte (é marketing comparativo).
// Regras mudam sem aviso (Premier+ mudou em 09/09/2026): quem edita este arquivo confere antes no site oficial.

import { QUIZ_FFF } from "./quiz-fff"
import { TAMANHOS } from "./types"
import type { Celula, DadosTamanho, FaixaEscalonamento, Fonte, Mesa, Plano, PorTamanho, Tamanho } from "./types"

const VERIFICADO = "2026-09-28"
const SITE = "https://www.fundedfuturesfamily.com"

const HELP = "https://intercom.help/funded-futures-family/en/articles"

const fonte = (path: string): Fonte => ({ url: `${SITE}/${path}`, verificadoEm: VERIFICADO })
/** Artigo do Help Center oficial (Intercom). Quando as páginas de venda divergem dele, o Help Center manda. */
const fonteHc = (slug: string): Fonte => ({ url: `${HELP}/${slug}`, verificadoEm: VERIFICADO })

type Quatro<T> = [T, T, T, T]

/** [25K, 50K, 100K, 150K] → objeto por tamanho, na ordem das tabelas do site. */
const porTamanho = <T,>(v: Quatro<T>): PorTamanho<T> => ({ 25: v[0], 50: v[1], 100: v[2], 150: v[3] })

/** Monta os tamanhos que existem. `monta` devolve null pro tamanho em que o plano não existe. */
const tamanhos = (monta: (t: Tamanho, i: 0 | 1 | 2 | 3) => DadosTamanho | null): Partial<PorTamanho<DadosTamanho>> => {
  const saida: Partial<PorTamanho<DadosTamanho>> = {}
  TAMANHOS.forEach((t, i) => {
    const d = monta(t, i as 0 | 1 | 2 | 3)
    if (d) saida[t] = d
  })
  return saida
}

/** Célula por tamanho a partir de uma função do índice do tamanho. */
const cadaTamanho = (fn: (i: 0 | 1 | 2 | 3) => string[]): Celula => porTamanho([fn(0), fn(1), fn(2), fn(3)])

const usd = (n: number) => `$${n.toLocaleString("en-US")}`

// ---- números compartilhados ----
const META_25_150 = [1250, 3000, 6000, 9000] as const // Prime
const PERDA_MAXIMA = [1000, 2000, 3000, 4500] as const
const RESET_FINANCIADA = [499, 649, 1099, 1499] as const
/** Nível inicial do trailing EOD (saldo + perda máxima); ao passar dele a perda máxima trava no saldo inicial. */
const NIVEL_TRAVA_EOD = [26000, 52000, 103000, 154500] as const

/** Tabela oficial de escalonamento das contas financiadas (lucro simulado, atualiza no fim da sessão). Faixas repetidas foram juntadas. */
const ESCALONAMENTO: PorTamanho<FaixaEscalonamento[]> = porTamanho([
  [
    { lucroMinimo: 0, minis: 1, micros: 10 },
    { lucroMinimo: 1000, minis: 2, micros: 20 },
    { lucroMinimo: 2000, minis: 3, micros: 30 },
  ],
  [
    { lucroMinimo: 0, minis: 3, micros: 30 },
    { lucroMinimo: 1500, minis: 4, micros: 40 },
    { lucroMinimo: 2000, minis: 5, micros: 50 },
  ],
  [
    { lucroMinimo: 0, minis: 4, micros: 40 },
    { lucroMinimo: 1500, minis: 6, micros: 60 },
    { lucroMinimo: 2000, minis: 7, micros: 70 },
    { lucroMinimo: 3000, minis: 10, micros: 100 },
  ],
  [
    { lucroMinimo: 0, minis: 5, micros: 50 },
    { lucroMinimo: 1500, minis: 7, micros: 70 },
    { lucroMinimo: 2000, minis: 10, micros: 100 },
    { lucroMinimo: 3000, minis: 12, micros: 120 },
    { lucroMinimo: 4500, minis: 15, micros: 150 },
  ],
])

const NOTA_ESCALONAMENTO = "O escalonamento segue a tabela oficial por lucro; o teto é o limite de posição da versão comprada"

// ---- PRIME ----
const PRIME_INCLUIDA = [129, 179, 279, 365] as const
const PRIME_MAX = [144, 204, 319, 425] as const
const PRIME_MINIS = [2, 4, 6, 10] as const
const PRIME_MAX_MINIS = [3, 5, 10, 15] as const
const PRIME_META_SAQUE = [300, 500, 750, 1000] as const
const PRIME_BUFFER = [26100, 52100, 103100, 154600] as const

const PRIME: Plano = {
  id: "prime",
  nome: "Prime",
  resumo: "Passa a avaliação em 1 dia (sem consistência) e entra num ritmo de saque a cada 3 dias. Drawdown EOD: só conta o saldo no fechamento do dia.",
  paraQuem: "Quem quer velocidade com estrutura: passar rápido, sacar com frequência e não lidar com drawdown intraday.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  cobranca: "mensal",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 40 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Avaliação sem consistência e sem limite de perda diário: um bom dia já passa",
    "Passou, a conta financiada ativa na hora, sem taxa de ativação",
    "Drawdown EOD na avaliação e na financiada: o lucro aberto durante o dia não puxa o limite",
    "Saque a cada 3 dias de trading, com aprovação instantânea",
    "Avaliações e resets ilimitados",
  ],
  atencao: [
    "A avaliação é uma assinatura mensal: quanto mais demora pra passar, mais você paga",
    "Na financiada seu maior dia não pode passar de 40% do lucro do ciclo (a conta zera a cada saque aprovado)",
    "Pra sacar o saldo precisa ficar acima do drawdown + $100, e há uma meta de lucro entre os saques",
    "A versão Incluída tem menos contratos; a Prime Max custa mais e libera mais posição",
    NOTA_ESCALONAMENTO,
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: META_25_150[i],
    perdaMaxima: PERDA_MAXIMA[i],
    limiteDiario: null,
    lotes: { minis: PRIME_MINIS[i], micros: PRIME_MINIS[i] * 10 },
    travaTrailing: NIVEL_TRAVA_EOD[i],
    saque: {
      minimo: null,
      metaLucroCiclo: { primeiro: PRIME_META_SAQUE[i], demais: PRIME_META_SAQUE[i] },
      colchao: PRIME_BUFFER[i] - [25000, 50000, 100000, 150000][i],
      maximos: [
        { rotulo: "1º saque", valor: [1000, 2000, 3000, 3500][i] },
        { rotulo: "2º em diante", valor: [1500, 2500, 3500, 4000][i] },
      ],
    },
    escalonamento: ESCALONAMENTO[[25, 50, 100, 150][i] as Tamanho],
    liveBonus: null,
    precoTabelaUsd: PRIME_INCLUIDA[i],
    precoRotulo: "a partir de",
  })),
  celulas: {
    Drawdown: ["Fim do dia (EOD)", "Trava no saldo inicial depois que o saldo passa do nível inicial"],
    "Lote máximo": cadaTamanho((i) => [
      `Incluída: ${PRIME_MINIS[i]} minis / ${PRIME_MINIS[i] * 10} micros`,
      `Prime Max: ${PRIME_MAX_MINIS[i]} minis / ${PRIME_MAX_MINIS[i] * 10} micros`,
      "Começa menor e sobe com o lucro",
    ]),
    "Pra liberar o saque": cadaTamanho((i) => [
      "Mínimo de 3 dias de trading",
      `Lucro de ${usd(PRIME_META_SAQUE[i])} desde o último saque`,
      `Saldo acima de ${usd(PRIME_BUFFER[i])} (drawdown + $100)`,
      "Maior dia ≤ 40% do lucro do ciclo",
    ]),
    "Frequência de saque": ["A cada 3 dias de trading, quando cumprir os critérios"],
    "Bônus ao ir pra Live": ["Não informado no site"],
  },
  extras: {
    "Versões e preços": cadaTamanho((i) => [`Incluída: ${usd(PRIME_INCLUIDA[i])}/mês`, `Prime Max: ${usd(PRIME_MAX[i])}/mês`]),
    "Reset da conta financiada": cadaTamanho((i) => [usd(RESET_FINANCIADA[i])]),
  },
  fontes: [
    fonte("prime-plan/"),
    fonte("payout-rules/"),
    fonte("faq/how-long-does-it-take-to-pass-an-evaluation/"),
    fonteHc("15705476-prime-funded-account"),
    fonteHc("15715050-prime-payout-requirements"),
    fonteHc("15808673-prime-consistency"),
  ],
}

// ---- VELOCITY ----
const VELOCITY_BASE = [79, 125, 225, 325] as const
const VELOCITY_ADDON = [108, 164, 284, 394] as const
const VELOCITY_META = [2500, 4000, 7000, 10000] as const
const VELOCITY_PERDA = [1250, 2250, 3250, 4750] as const
const VELOCITY_MINIS = [3, 5, 10, 15] as const
const VELOCITY_LUCRO_SAQUE = [1500, 3000, 6000, 9000] as const

const VELOCITY: Plano = {
  id: "velocity",
  nome: "Velocity",
  resumo: "Assinatura de entrada baixa: avaliação de no mínimo 3 dias com drawdown intraday. Tem um add-on que troca o ritmo por saque diário e tira a consistência.",
  paraQuem: "Quem tira lucro rápido (não deixa ganho aberto devolver) e quer entrar barato ($79 por mês no 25K), ou quer saque diário com o add-on.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "INTRADAY", financiada: "INTRADAY" },
  cobranca: "mensal",
  dllOpcional: false,
  consistencia: { avaliacao: 40, financiada: 40 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Entrada barata: a partir de $79 por mês no 25K",
    "Avaliação em no mínimo 3 dias, sem limite de perda diário",
    "Add-on de saque diário ($29 a $69 por mês): sem exigência de dias e sem consistência na financiada",
    "Avaliações e resets ilimitados",
  ],
  atencao: [
    "Drawdown intraday na avaliação e na financiada: ele inclui o lucro aberto e sobe a cada novo pico. Devolver lucro aberto pode quebrar a conta mesmo num dia que fecharia no verde",
    "A avaliação tem consistência de 40%, e a financiada padrão também (zera a cada saque)",
    "O teto por saque começa baixo: $750 no 25K padrão e $600 com o add-on (chega a $3.250 no 150K)",
    "A avaliação é uma assinatura mensal e o add-on também é cobrado por mês",
    NOTA_ESCALONAMENTO,
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: VELOCITY_META[i],
    perdaMaxima: VELOCITY_PERDA[i],
    limiteDiario: null,
    lotes: { minis: VELOCITY_MINIS[i], micros: VELOCITY_MINIS[i] * 10 },
    travaTrailing: null,
    saque: {
      minimo: null,
      metaLucroCiclo: { primeiro: VELOCITY_LUCRO_SAQUE[i], demais: VELOCITY_LUCRO_SAQUE[i] },
      diasComLucro: { dias: 3, lucroMinimoPorDia: 200 },
      maximos: [
        { rotulo: "Padrão", valor: [750, 1250, 2250, 3250][i] },
        { rotulo: "Com add-on de saque diário", valor: [600, 1000, 1500, 2500][i] },
      ],
    },
    escalonamento: ESCALONAMENTO[[25, 50, 100, 150][i] as Tamanho],
    liveBonus: null,
    precoTabelaUsd: VELOCITY_BASE[i],
  })),
  celulas: {
    Drawdown: ["Intraday", "Inclui o lucro aberto: sobe a cada novo pico e nunca desce"],
    Consistência: ["Avaliação: 40%", "Financiada: 40% (o add-on de saque diário remove)"],
    "Pra liberar o saque": cadaTamanho((i) => [
      "3 dias de trading com lucro ≥ $200",
      `Lucro de ${usd(VELOCITY_LUCRO_SAQUE[i])} desde o último saque`,
      "Maior dia ≤ 40% do lucro do ciclo",
      "Com o add-on: só o lucro exigido, sem dias e sem consistência",
    ]),
    "Frequência de saque": ["A cada 3 dias de trading", "Todos os dias com o add-on"],
    "Bônus ao ir pra Live": ["Não informado no site"],
  },
  extras: {
    "Versões e preços": cadaTamanho((i) => [`Base: ${usd(VELOCITY_BASE[i])}/mês`, `Com add-on de saque diário: ${usd(VELOCITY_ADDON[i])}/mês`]),
    "Reset da conta financiada": cadaTamanho((i) => [usd(RESET_FINANCIADA[i])]),
  },
  fontes: [
    fonte("velocity-plan/"),
    fonte("payout-rules/"),
    fonte("faq/does-funded-futures-family-have-a-consistency-rule/"),
    fonteHc("15851015-velocity-funded-account"),
    fonteHc("15878902-velocity-payout-requirements"),
  ],
}

// ---- PREMIER+ ----
const PREMIER_META = [1500, 3000, 6000, 9000] as const
const PREMIER_PERDA_INTRADAY = [1000, 2000, 3000, 4500] as const
const PREMIER_PERDA_EOD = [750, 1500, 2500, 4000] as const
const PREMIER_INTRADAY_FAST = [114, 154, 229, 319] as const
const PREMIER_INTRADAY_STD = [89, 119, 189, 259] as const
const PREMIER_EOD_FAST = [144, 194, 299, 529] as const
const PREMIER_EOD_STD = [119, 159, 249, 459] as const
const PREMIER_RESET = [649, 649, 1099, 1499] as const
const PREMIER_MINIS_NOVAS = [2, 4, 6, 10] as const // contas compradas a partir de 09/09/2026 (fixo, sem escalonamento)
const PREMIER_MINIS_ANTIGAS = [3, 5, 10, 15] as const // contas anteriores (com escalonamento)

const PREMIER: Plano = {
  id: "premier",
  nome: "Premier+",
  resumo: "O plano mais flexível: você escolhe entre Fast Pass ou Standard e entre drawdown Intraday ou EOD. Saque a cada 5 dias qualificados, sem colchão.",
  paraQuem: "Quem quer escolher o drawdown que combina com o seu estilo e um saque com poucas exigências além dos dias qualificados.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "ESCOLHA", financiada: "ESCOLHA" },
  cobranca: "mensal",
  dllOpcional: false,
  consistencia: { avaliacao: 50, financiada: 40 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Fast Pass: pode passar em 1 dia qualificado, sem consistência na avaliação",
    "Você escolhe o drawdown: Intraday (mais barato, perda máxima maior) ou EOD",
    "Sem colchão: pra pedir de novo basta $1 de lucro líquido desde o último saque",
    "Saque de 50% do lucro, com teto de $1.000 a $3.000 conforme o tamanho",
  ],
  atencao: [
    "As regras mudaram em 09/09/2026: contas novas têm consistência de 40% na financiada e contratos fixos (2, 4, 6 e 10 minis), sem escalonamento",
    "Contas compradas antes de 09/09/2026 seguem as regras antigas (sem consistência na financiada, escalonamento e mais contratos)",
    "A consistência de 40% na financiada vale pra todas as contas Premier+ compradas a partir de 09/09/2026, inclusive no Standard",
    "No Standard (2 dias pra passar), a página do plano diz que há consistência de 50% na avaliação, mas o Help Center diz que não há. Confirme no site antes de comprar",
    "Ao pedir o primeiro saque, o drawdown sobe pro saldo base da conta",
    "Cada saque exige 5 dias qualificados (lucro de pelo menos $200 no dia)",
    "A avaliação é uma assinatura mensal, e o EOD custa mais que o Intraday",
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: PREMIER_META[i],
    perdaMaxima: PREMIER_PERDA_INTRADAY[i],
    limiteDiario: null,
    lotes: { minis: PREMIER_MINIS_NOVAS[i], micros: PREMIER_MINIS_NOVAS[i] * 10 },
    travaTrailing: null,
    saque: {
      minimo: null,
      diasComLucro: { dias: 5, lucroMinimoPorDia: 200 },
      maximos: [{ rotulo: "Cada saque", valor: [1000, 2000, 2500, 3000][i], pctDoLucro: 50 }],
    },
    liveBonus: null,
    precoTabelaUsd: PREMIER_INTRADAY_STD[i],
    precoRotulo: "a partir de",
  })),
  celulas: {
    "Perda máxima": cadaTamanho((i) => [`Intraday: ${usd(PREMIER_PERDA_INTRADAY[i])}`, `EOD: ${usd(PREMIER_PERDA_EOD[i])}`]),
    Drawdown: ["Você escolhe: Intraday ou EOD", "No EOD, trava no saldo inicial depois que o saldo passa dele"],
    Consistência: [
      "Fast Pass: sem consistência na avaliação",
      "Standard: 50% na avaliação segundo a página do plano (o Help Center diz que não tem; confirme)",
      "Financiada, em todas as versões: 40% (contas a partir de 09/09/2026; as anteriores mantêm os termos originais)",
    ],
    "Lote máximo": cadaTamanho((i) => [
      `Contas a partir de 09/09/2026: ${PREMIER_MINIS_NOVAS[i]} minis / ${PREMIER_MINIS_NOVAS[i] * 10} micros, fixo`,
      `Contas anteriores: até ${PREMIER_MINIS_ANTIGAS[i]} minis / ${PREMIER_MINIS_ANTIGAS[i] * 10} micros, com escalonamento`,
    ]),
    "Pra liberar o saque": [
      "5 dias qualificados (lucro ≥ $200 no dia)",
      "Pelo menos $1 de lucro líquido desde o último saque",
      "Sem colchão de saldo",
      "Maior dia ≤ 40% do lucro (contas a partir de 09/09/2026)",
    ],
    "Frequência de saque": ["A cada 5 dias qualificados"],
    "Bônus ao ir pra Live": ["Não informado no site"],
  },
  extras: {
    "Versões e preços": cadaTamanho((i) => [
      `Intraday · Fast Pass ${usd(PREMIER_INTRADAY_FAST[i])}/mês · Standard ${usd(PREMIER_INTRADAY_STD[i])}/mês`,
      `EOD · Fast Pass ${usd(PREMIER_EOD_FAST[i])}/mês · Standard ${usd(PREMIER_EOD_STD[i])}/mês`,
    ]),
    "Reset da conta financiada": cadaTamanho((i) => [usd(PREMIER_RESET[i])]),
  },
  fontes: [
    fonte("premier-plan/"),
    fonte("payout-rules/"),
    fonte("faq/does-funded-futures-family-have-a-consistency-rule/"),
    fonteHc("15809232-premier-evaluation"),
    fonteHc("15811095-premier-funded-account"),
    fonteHc("15811464-premier-payout-requirements"),
    fonteHc("16964667-premier-consistency"),
  ],
}

// ---- S2F STANDARD ----
const S2F_PRECO = [329, 469, 629, 734] as const
const S2F_MINIS = [1, 5, 10, 15] as const

const S2F: Plano = {
  id: "s2f",
  nome: "Straight to Funded",
  resumo: "Sem avaliação e sem mensalidade: você paga uma vez e já opera numa conta financiada. Em troca, o saque é o mais exigente da FFF.",
  paraQuem: "Quem já sabe operar e prefere pagar uma vez pra pular a avaliação, aceitando 7 dias qualificados e consistência de 25%.",
  caminho: "direto",
  drawdown: { avaliacao: null, financiada: "EOD" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 25 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Pagamento único, sem mensalidade e sem avaliação pra passar",
    "Conta financiada no mesmo dia da compra",
    "Drawdown EOD que trava no saldo inicial",
    "Sem taxa de ativação e sem mensalidade",
  ],
  atencao: [
    "O reset não está disponível no S2F: se a conta for fechada, o Help Center não prevê restaurá-la",
    "Precisa de 7 dias qualificados (lucro de pelo menos $200) antes do primeiro saque, e saques a cada 7 dias",
    "Consistência de 25%: seu lucro total precisa ser pelo menos 4 vezes o seu melhor dia (zera a cada saque)",
    "Você já trabalha com as regras de conta financiada desde o primeiro trade, sem período de teste",
    "Custa mais no começo do que o primeiro mês da avaliação do mesmo tamanho",
    "No 25K o Help Center mostra 1 mini de contrato máximo, mas a tabela de escalonamento chega a 3 minis. Usamos 1 mini; confirme no site",
    NOTA_ESCALONAMENTO,
  ],
  tamanhos: tamanhos((_, i) => ({
    metaAvaliacao: null,
    perdaMaxima: PERDA_MAXIMA[i],
    limiteDiario: null,
    lotes: { minis: S2F_MINIS[i], micros: S2F_MINIS[i] * 10 },
    travaTrailing: NIVEL_TRAVA_EOD[i],
    saque: {
      minimo: null,
      metaLucroCiclo: { primeiro: [1500, 3000, 6000, 9000][i], demais: [1000, 2000, 3000, 4500][i] },
      diasComLucro: { dias: 7, lucroMinimoPorDia: 200 },
      maximos: [
        { rotulo: "Saques 1 a 3", valor: [1000, 2000, 2500, 3000][i] },
        { rotulo: "Saque 4", valor: [1000, 2500, 3000, 3500][i] },
      ],
    },
    escalonamento: ESCALONAMENTO[[25, 50, 100, 150][i] as Tamanho],
    liveBonus: null,
    precoTabelaUsd: S2F_PRECO[i],
  })),
  celulas: {
    Drawdown: ["Fim do dia (EOD)", "Trava no saldo inicial depois que o saldo passa do nível inicial"],
    "Frequência de saque": ["A cada 7 dias, quando cumprir os critérios"],
    "Bônus ao ir pra Live": ["Não informado no site"],
  },
  extras: {
    "Versões e preços": cadaTamanho((i) => [`${usd(S2F_PRECO[i])} em pagamento único`]),
    "Reset da conta financiada": ["Não disponível no S2F"],
  },
  fontes: [
    fonte("straight-to-funded/"),
    fonte("payout-rules/"),
    fonte("faq/what-is-straight-to-funded-and-what-does-it-cost/"),
    fonteHc("15879855-straight-to-funded-s2f-funded-account"),
    fonteHc("15879981-straight-to-funded-s2f-payout-requirements"),
    fonteHc("16310780-straight-to-funded-s2f-scaling-plan"),
    fonteHc("15650785-account-fees"),
  ],
}

// ---- S2F ACCELERATE (só 50K) ----
const ACCELERATE: Plano = {
  id: "accelerate",
  nome: "S2F Accelerate",
  resumo: "Só no 50K. Sem avaliação, com todos os 5 minis desde o 1º dia e saque depois de 5 dias qualificados. O preço é um drawdown intraday que nunca trava.",
  paraQuem: "Quem já opera cheio (5 minis), aguenta um limite que sobe junto com o lucro aberto e quer o 1º saque o mais rápido possível. O próprio site diz que não é plano pra iniciante.",
  caminho: "direto",
  drawdown: { avaliacao: null, financiada: "INTRADAY" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 25 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "5 minis (50 micros) liberados desde o 1º dia, sem escalonamento",
    "1º saque depois de 5 dias qualificados, em vez de 7 do S2F Standard",
    "Pagamento único e sem avaliação",
  ],
  atencao: [
    "Drawdown intraday de $2.000 que nunca trava: o limite fica $2.000 abaixo do maior saldo já atingido, lucro aberto incluído",
    "Consistência de 25% pra vida toda da conta: ela não zera depois de um saque",
    "Tetos de saque menores que os do S2F Standard ($1.250 nos dois primeiros, $1.500 depois)",
    "Existe só na conta de 50K. O site anuncia uma oferta de lançamento; confira o preço no checkout",
  ],
  tamanhos: tamanhos((t) =>
    t === 50
      ? {
          metaAvaliacao: null,
          perdaMaxima: 2000,
          limiteDiario: null,
          lotes: { minis: 5, micros: 50 },
          travaTrailing: null,
          saque: {
            minimo: 500,
            diasComLucro: { dias: 5, lucroMinimoPorDia: 200 },
            colchao: 2100,
            maximos: [
              { rotulo: "1º e 2º saque", valor: 1250 },
              { rotulo: "3º em diante", valor: 1500 },
            ],
          },
          liveBonus: null,
          precoTabelaUsd: 499,
        }
      : null
  ),
  celulas: {
    Drawdown: ["Intraday que nunca trava", "Fica $2,000 abaixo do maior saldo já atingido, lucro aberto incluído"],
    "Pra liberar o saque": [
      "5 dias qualificados (lucro fechado ≥ $200 no dia)",
      "Saldo acima de $52,100 (não dá pra sacar o colchão)",
      "Maior dia ≤ 25% do lucro total, sempre (não zera)",
    ],
    Consistência: ["Saque: 25%, pra vida toda da conta"],
    "Frequência de saque": ["Depois de 5 dias qualificados, quando cumprir os critérios"],
    "Bônus ao ir pra Live": ["Não informado no site"],
  },
  extras: {
    "Versões e preços": ["$499 de tabela, pagamento único", "Há oferta de lançamento: confira no checkout"],
    "Reset da conta financiada": ["Não disponível no S2F"],
  },
  fontes: [fonte("s2f-accelerate/"), fonte("payout-rules/"), fonteHc("16949878-accelerate-plan-funded-account"), fonteHc("16950249-accelerate-plan-payout-requirements")],
}

export const FFF: Mesa = {
  slug: "fff",
  nome: "Funded Futures Family",
  urlOficial: `${SITE}/`,
  linkAfiliado: null,
  splitTrader: 90,
  resumo:
    "Mesa de futuros com 3 planos de avaliação mensal (Prime, Velocity e Premier+) e o Straight to Funded, que pula a avaliação com pagamento único. Você fica com 90% dos saques e nenhum plano tem limite de perda diário.",
  planos: [PRIME, VELOCITY, PREMIER, S2F, ACCELERATE],
  ajudaPreco: "Preço de tabela, sem promoção. Nas avaliações é por mês. Promoções são frequentes e aparecem no checkout.",
  linhasExtras: [
    { rotulo: "Versões e preços", ajuda: "As versões mudam contratos, drawdown ou saque, e o preço muda junto." },
    { rotulo: "Reset da conta financiada", ajuda: "Se a conta financiada fecha, dá pra restaurar (até 3 vezes por conta)." },
  ],
  avisos: [
    "As avaliações da FFF são assinaturas mensais (o valor aparece por mês). O Straight to Funded é pagamento único.",
    "O Premier+ mudou em 09/09/2026: contas novas têm consistência de 40% na financiada e contratos fixos. Onde a regra difere, a tabela mostra as duas versões.",
  ],
  regrasGerais: [
    {
      titulo: "Dinheiro e saque",
      itens: [
        "Você fica com 90% do lucro sacado, em todos os planos, desde o primeiro dólar",
        "Teto de $100.000 de saque por usuário, somando todas as contas",
        "Saque pela Rise (Riseworks): precisa de KYC (KYB se for LLC) e conta Rise verificada",
        "Os saques são aprovados a cada fim de dia (EOD), segundo o Help Center. As páginas de venda falam em aprovação instantânea",
        "Depois de aprovado: transferência bancária leva de 1 a 3 dias úteis e cripto sai no mesmo dia (até 24 horas). Taxas de saque são do provedor, não da FFF",
        "Dia qualificado = dia com pelo menos $200 de lucro. Os dias mínimos só contam a partir do dia seguinte ao pedido de saque, e o pedido enviado é final",
        "Não tem taxa de ativação nem taxa de processamento da FFF nos saques",
      ],
    },
    {
      titulo: "Assinatura, resets e reembolso",
      itens: [
        "A assinatura da avaliação começa no dia do cadastro e renova todo mês nessa mesma data, mesmo se você resetar a conta",
        "Passou na avaliação, a assinatura para sozinha e não há mensalidade na conta financiada",
        "Estourou a conta: ela reseta no próximo ciclo e a assinatura continua, a menos que você cancele manualmente no painel",
        "Resets: ilimitados na avaliação e até 3 por conta financiada. O S2F não tem reset",
        "Reembolso só se não houve nenhum trade, só na primeira conta que você abriu e em até 14 dias. Fora isso, as taxas são finais",
      ],
    },
    {
      titulo: "Como operar",
      itens: [
        "Sem limite de perda diário em nenhum plano. O limite de risco é o drawdown máximo",
        "Notícia liberada, inclusive as de maior impacto. Lembre que gap, derrapagem e atraso de dados aumentam nessas horas",
        "Dá pra segurar posição à noite, mas nada pode ficar aberto no intervalo diário do mercado nem no fim de semana. O Help Center diz que tudo fecha às 16:45 (Nova York) e que posição esquecida é fechada sozinha, sem quebrar a conta. O FAQ do site cita 16:15. Na dúvida, feche antes das 16:15. O mercado reabre às 18:00",
        "Scalp manual e micros liberados, desde que mais de 50% dos trades e mais de 50% do lucro venham de posições seguradas por mais de 10 segundos",
        "Proibido robô/algoritmo e hedge entre contas. A conta tem que estar no seu nome, e o pagamento também (cartão de terceiros é proibido). Não divida o aparelho com outro trader. VPN e VPS são permitidos por sua conta e risco",
        "Índices futuros e commodities (petróleo, gás, ouro, prata, agrícolas). Plataformas: Tradovate, TradingView, NinjaTrader (via Tradovate) e WealthCharts",
      ],
    },
    {
      titulo: "Contas e limites",
      itens: [
        "Até 5 contas financiadas ativas por domicílio, somando todos os planos",
        "Depois de passar na avaliação, você tem 7 dias pra ativar a conta financiada (sem taxa). Se não ativar nesse prazo, ela é fechada",
        "Cada conta precisa de pelo menos 1 trade de no mínimo 10 segundos por semana (segunda a sexta). Conta parada uma semana inteira é fechada e não pode ser restaurada. Se for pausar, avise antes",
        "Avaliação não ativada em 30 dias é suspensa (dá pra pedir renovação em até 6 meses)",
        "Mais de 3 resets em 24 horas ou várias avaliações ao mesmo tempo podem levar à suspensão de novos pedidos",
      ],
    },
    {
      titulo: "Conta simulada, saque real e Live",
      itens: [
        "A conta de trading é simulada, com dados de mercado ao vivo. Os saques são reais",
        "A transição pra conta Live (infraestrutura Rithmic) acontece ao acumular $5.000 em saques aprovados da etapa profissional, ou ao receber um primeiro saque profissional mostrando consistência e gestão de risco",
        "Cada transição é analisada individualmente pela mesa Live e não é imediata: exige documentação e o processamento pelo corretor",
      ],
    },
    {
      titulo: "Quem pode operar",
      itens: [
        "A FFF fica na Califórnia (EUA) e atende a maioria dos países",
        "Há uma lista de países restritos, atualizada em 01/09/2026. O Brasil não aparece nela, mas a lista muda com sanções e regulações",
      ],
    },
    {
      titulo: "Nos Termos de Uso",
      itens: [
        "A FFF decide, a critério dela, o que é conduta proibida. A violação pode ser tratada como reprovação, apagar trades, negar saque ou encerrar a conta sem reembolso",
        "Cláusula dura contra chargeback: abra um ticket de suporte antes de qualquer disputa no banco, sob risco de perder saques e benefícios",
        "Os dados do seu trading podem ser usados pela FFF pra fins legítimos do negócio dela",
      ],
    },
    {
      titulo: "Outros programas que aparecem só no Help Center",
      itens: [
        "Prestige: programa só por convite (avaliação de 5 dias com consistência de 40%, depois ambiente Live com saque diário). Não dá pra pedir acesso",
        "Base $2K: conta de $2.000 com saque todo dia (de $500 a $1.000), sem consistência, drawdown intraday que trava com $2.000 de lucro e saldo mínimo de $4.000 depois do saque",
        "Nenhum dos dois aparece nas páginas de venda, então não estão nesta comparação. Se virarem públicos, entram aqui",
      ],
    },
  ],
  vantagens: [
    "Você fica com 90% dos saques desde o primeiro dólar",
    "Nenhum plano tem limite de perda diário, e notícia é liberada",
    "Sem taxa de ativação da conta financiada",
    "5 opções de plano, inclusive um sem avaliação e sem mensalidade",
    "Saque aprovado a cada fim de dia, com pagamento pela Rise (cripto no mesmo dia)",
  ],
  atencao: [
    "As avaliações são mensalidades que renovam todo mês, e estourar a conta não cancela a assinatura. Só o Straight to Funded é pagamento único",
    "Feche as posições antes de 16:15 (Nova York): o Help Center fala em 16:45, o FAQ em 16:15",
    "Conta sem nenhum trade por uma semana inteira é fechada e não volta",
    "Depois de passar, você tem só 7 dias pra ativar a conta financiada",
    "Teto de saque por pedido menor nos planos de entrada, e teto total de $100.000 por usuário",
    "O saque vem pela Rise (Riseworks): confirme se o seu cadastro e o seu banco funcionam por lá antes de comprar",
    "Reembolso só na primeira conta, sem nenhum trade e em até 14 dias. A FFF decide o que é conduta proibida",
  ],
  quiz: QUIZ_FFF,
  verificadoEm: VERIFICADO,
  fontes: [
    { url: `${SITE}/payout-rules/`, verificadoEm: VERIFICADO },
    { url: `${SITE}/payout-speed/`, verificadoEm: VERIFICADO },
    { url: `${SITE}/terms-and-conditions/`, verificadoEm: VERIFICADO },
    { url: `${SITE}/faq/`, verificadoEm: VERIFICADO },
    fonteHc("11157829-understanding-your-billing-cycle"),
    fonteHc("11157832-refund-policy-explained"),
    fonteHc("15697017-payout-methods"),
    fonteHc("15892350-permitted-times-to-trade"),
    fonteHc("15892427-maximum-account-idle-time"),
    fonteHc("15892228-live-stage-structure"),
    fonteHc("17076299-base-plan-funded-account"),
    fonteHc("16911595-prestige-evaluation"),
  ],
}
