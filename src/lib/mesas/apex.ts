// Apex Trader Funding: dados lidos SÓ do site oficial em 2026-09-28 (home + Help Center), pelo Chrome do Marcelo
// (o site fica atrás de Cloudflare). Levantamento: docs/mesas-proprietarias/apex-levantamento-2026-09-28.md.
// Conferência manual: docs/mesas-proprietarias/apex-conferencia.md. Valem as contas NOVAS (compradas a partir de 01/03/2026).

import { QUIZ_APEX } from "./quiz-apex"
import { TAMANHOS } from "./types"
import type { Celula, DadosTamanho, FaixaEscalonamento, Fonte, Mesa, Plano, PorTamanho, Tamanho } from "./types"

const VERIFICADO = "2026-09-28"
const HELP = "https://apextraderfunding.com/help-center"

/** `caminho` = artigo do Help Center (ex.: "eod-trailing-drawdown-accounts/eod-payouts"). O teste confere contra apex-hashes. */
const fonte = (caminho: string): Fonte => ({ url: `${HELP}/${caminho}/`, verificadoEm: VERIFICADO })

type Quatro<T> = [T, T, T, T]
const porTamanho = <T,>(v: Quatro<T>): PorTamanho<T> => ({ 25: v[0], 50: v[1], 100: v[2], 150: v[3] })
const cadaTamanho = (fn: (i: 0 | 1 | 2 | 3) => string[]): Celula => porTamanho([fn(0), fn(1), fn(2), fn(3)])
const usd = (n: number) => `$${n.toLocaleString("en-US")}`
const TAM = [25000, 50000, 100000, 150000] as const

// ---- números compartilhados (EOD e Intraday) ----
const META = [1500, 3000, 6000, 9000] as const
const PERDA_MAXIMA = [1000, 2000, 3000, 4000] as const
const LOTES_AVALIACAO = [4, 6, 8, 12] as const
const LOTES_PA_TOPO = [2, 4, 6, 10] as const
const LOTES_PA_INICIO = [1, 2, 3, 4] as const
/** Safety net = drawdown + $100, vale pra vida toda da PA. Também é o saldo em que o threshold trava. */
const SAFETY_NET = [26100, 52100, 103100, 154100] as const
const SALDO_MINIMO_SAQUE = [26600, 52600, 103600, 154600] as const
const MINIMO_SAQUE = 500
const DLL_AVALIACAO_EOD = [500, 1000, 1500, 2000] as const

/** Escalonamento da PA por lucro da conta: [lucro a partir de, contratos, DLL]. Fonte: scaling-levels-pa-explained. */
const NIVEIS: PorTamanho<[number, number, number][]> = porTamanho([
  [[0, 1, 500], [1000, 2, 500], [2000, 2, 1250]],
  [[0, 2, 1000], [1500, 3, 1000], [3000, 4, 2000], [6000, 4, 3000]],
  [[0, 3, 1750], [2000, 4, 1750], [3000, 5, 1750], [5000, 6, 2500], [10000, 6, 3500]],
  [[0, 4, 2500], [2000, 5, 2500], [3000, 7, 2500], [5000, 10, 3000], [10000, 10, 4000]],
])

/** Contratos por faixa de lucro, juntando faixas vizinhas iguais (o DLL sobe sem mudar contratos). */
const escalonamentoDe = (t: Tamanho): FaixaEscalonamento[] => {
  const faixas: FaixaEscalonamento[] = []
  for (const [lucroMinimo, minis] of NIVEIS[t]) {
    if (faixas.at(-1)?.minis === minis) continue
    faixas.push({ lucroMinimo, minis, micros: minis * 10 })
  }
  return faixas
}

const niveisTexto = (t: Tamanho): string[] =>
  NIVEIS[t].map(([de, ct, dll], i, todos) => {
    const proximo = todos[i + 1]
    const faixa = proximo ? `${usd(de)} a ${usd(proximo[0] - 1)}` : `${usd(de)}+`
    return `Lucro de ${faixa}: ${ct} ${ct === 1 ? "contrato" : "contratos"} · DLL ${usd(dll)}`
  })

/** Junta saques seguidos de mesmo valor: [1000,1000,1000,1500] → ["Saques 1 a 3: até $1,000", "Saque 4: até $1,500"]. */
const maximosCompactos = (valores: readonly number[]): string[] => {
  const linhas: string[] = []
  let inicio = 0
  for (let i = 1; i <= valores.length; i++) {
    if (i < valores.length && valores[i] === valores[inicio]) continue
    const fim = i
    const rotulo = fim - inicio === 1 ? `Saque ${inicio + 1}` : `Saques ${inicio + 1} a ${fim}`
    linhas.push(`${rotulo}: até ${usd(valores[inicio])}`)
    inicio = i
  }
  return linhas
}

// Máximo por saque, do 1º ao 6º, por tamanho (eod-payouts / intraday-trailing-drawdown-payouts)
const MAX_SAQUES_EOD: PorTamanho<number[]> = porTamanho([
  [1000, 1000, 1000, 1000, 1000, 1000],
  [1500, 1500, 2000, 2500, 2500, 3000],
  [2000, 2500, 2500, 3000, 4000, 4000],
  [2500, 3000, 3000, 3000, 4000, 5000],
])
const MAX_SAQUES_INTRADAY: PorTamanho<number[]> = porTamanho([
  [1000, 1000, 1000, 1000, 1000, 1000],
  [1500, 2000, 2500, 2500, 3000, 3000],
  [2000, 2500, 3000, 3000, 4000, 4000],
  [2500, 3000, 3000, 4000, 4000, 5000],
])
const LUCRO_MIN_DIA_EOD = [100, 250, 300, 350] as const
const LUCRO_MIN_DIA_INTRADAY = [100, 200, 250, 300] as const

// Preços de tabela (seletor de produtos da home). O cupom SAVENOW chega a 90% de desconto; aqui só o preço cheio.
const PRECO_EOD = { standard: [490, 590, 1190, 2190], semAtivacao: [1090, 1190, 1590, 2490], ativacao: 90 } as const
const PRECO_INTRADAY = { standard: [167, 249, 790, 1190], semAtivacao: [690, 799, 999, 1890], ativacao: 59 } as const

interface Trilha {
  id: "eod" | "intraday"
  preco: typeof PRECO_EOD | typeof PRECO_INTRADAY
  maxSaques: PorTamanho<number[]>
  lucroMinDia: readonly number[]
}

const dadosDaTrilha = (tr: Trilha, i: 0 | 1 | 2 | 3): DadosTamanho => {
  const t = TAMANHOS[i]
  return {
    metaAvaliacao: META[i],
    perdaMaxima: PERDA_MAXIMA[i],
    limiteDiario: tr.id === "eod" ? DLL_AVALIACAO_EOD[i] : null,
    lotes: { minis: LOTES_AVALIACAO[i], micros: LOTES_AVALIACAO[i] * 10 },
    travaTrailing: SAFETY_NET[i],
    saque: {
      minimo: MINIMO_SAQUE,
      diasComLucro: { dias: 5, lucroMinimoPorDia: tr.lucroMinDia[i] },
      colchao: SAFETY_NET[i] - TAM[i],
      maximos: tr.maxSaques[t].map((valor, n) => ({ rotulo: `Saque ${n + 1}`, valor })),
    },
    escalonamento: escalonamentoDe(t),
    liveBonus: null,
    precoTabelaUsd: tr.preco.standard[i],
    ativacaoUsd: tr.preco.ativacao,
    precoRotulo: "Standard",
  }
}

const dllPaTexto = (i: 0 | 1 | 2 | 3): string => {
  const t = TAMANHOS[i]
  const dlls = NIVEIS[t].map(([, , d]) => d)
  return `PA: escala com o nível, de ${usd(Math.min(...dlls))} a ${usd(Math.max(...dlls))}`
}

const celulasComuns = (tr: Trilha): Record<string, Celula> => ({
  "Lote máximo": cadaTamanho((i) => [
    `Avaliação: ${LOTES_AVALIACAO[i]} minis / ${LOTES_AVALIACAO[i] * 10} micros, fixo`,
    `PA: de ${LOTES_PA_INICIO[i]} a ${LOTES_PA_TOPO[i]} minis (${LOTES_PA_INICIO[i] * 10} a ${LOTES_PA_TOPO[i] * 10} micros), conforme o lucro`,
  ]),
  "Notícia forte": ["Liberada com a sua estratégia normal", "Proibido perseguir o mercado ou apostar nos dois lados"],
  "Pra liberar o saque": cadaTamanho((i) => [
    `5 dias qualificados (lucro líquido ≥ ${usd(tr.lucroMinDia[i])} no dia, não precisam ser seguidos)`,
    `Saldo de pelo menos ${usd(SALDO_MINIMO_SAQUE[i])}, sempre acima do safety net de ${usd(SAFETY_NET[i])}`,
    "Maior dia < 50% do lucro desde o último saque",
    `Mínimo de ${usd(MINIMO_SAQUE)} por pedido`,
  ]),
  "Quanto dá pra sacar": cadaTamanho((i) => [...maximosCompactos(tr.maxSaques[TAMANHOS[i]]), "No máximo 6 saques por PA"]),
  "Frequência de saque": ["A cada 5 dias qualificados, quando cumprir os critérios", "Até 6 saques por PA"],
  "Bônus ao ir pra Live": ["Não tem. A Live é por convite da Apex"],
})

const extrasComuns = (tr: Trilha): Record<string, Celula> => ({
  "Versões e preços": cadaTamanho((i) => [
    `Standard: ${usd(tr.preco.standard[i])} + ativação de ${usd(tr.preco.ativacao)} (${usd(tr.preco.standard[i] + tr.preco.ativacao)} até a PA)`,
    `Sem taxa de ativação: ${usd(tr.preco.semAtivacao[i])}`,
  ]),
  "Escalonamento e limite diário da PA": cadaTamanho((i) => niveisTexto(TAMANHOS[i])),
})

const EOD: Plano = {
  id: "eod",
  nome: "Apex EOD",
  resumo: "Drawdown de fim de dia: o limite só sobe com o saldo de fechamento, então o lucro aberto durante o dia não puxa nada. A avaliação tem limite de perda diário fixo.",
  paraQuem: "Quem segura operações abertas e prefere um limite previsível (só muda no fechamento), aceitando pagar mais na avaliação.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 50 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Drawdown EOD: o lucro aberto durante o dia não puxa o limite",
    "Passa em 1 dia, sem consistência e sem dias mínimos na avaliação",
    "Saque a cada 5 dias qualificados, com 100% de split",
    "Avaliação em pagamento único, sem mensalidade",
  ],
  atencao: [
    "Tocou o threshold em qualquer momento da sessão, a avaliação é reprovada na hora. Não existe reset: é preciso comprar outra",
    "A avaliação EOD tem limite de perda diário fixo ($500 no 25K a $2.000 no 150K). Bateu, a sessão para, mas a conta segue",
    "Na PA o saque exige consistência de 50% e um colchão (drawdown + $100) que nunca sai",
    "É a trilha mais cara da Apex: a avaliação Standard custa de $490 (25K) a $2.190 (150K)",
    "Depois de passar, a taxa de ativação da PA é de $90 e tem 7 dias corridos pra pagar (ou compre a versão sem taxa, bem mais cara)",
  ],
  tamanhos: (() => {
    const tr: Trilha = { id: "eod", preco: PRECO_EOD, maxSaques: MAX_SAQUES_EOD, lucroMinDia: LUCRO_MIN_DIA_EOD }
    const saida: Partial<PorTamanho<DadosTamanho>> = {}
    TAMANHOS.forEach((t, i) => (saida[t] = dadosDaTrilha(tr, i as 0 | 1 | 2 | 3)))
    return saida
  })(),
  celulas: {
    ...celulasComuns({ id: "eod", preco: PRECO_EOD, maxSaques: MAX_SAQUES_EOD, lucroMinDia: LUCRO_MIN_DIA_EOD }),
    Drawdown: ["Fim do dia (EOD)", "Calculado 1x por dia às 16:59 ET; na PA trava em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) => [
      `Avaliação: ${usd(DLL_AVALIACAO_EOD[i])}, fixo`,
      dllPaTexto(i),
      "Bateu: fecha as posições e pausa a sessão. A conta continua ativa",
    ]),
    Consistência: ["Avaliação: não tem", "PA (saque): 50%, zera a cada saque aprovado"],
  },
  extras: extrasComuns({ id: "eod", preco: PRECO_EOD, maxSaques: MAX_SAQUES_EOD, lucroMinDia: LUCRO_MIN_DIA_EOD }),
  fontes: [
    fonte("eod-trailing-drawdown-accounts/eod-evaluations"),
    fonte("eod-trailing-drawdown-accounts/eod-performance-accounts-pa"),
    fonte("eod-trailing-drawdown-accounts/eod-payouts"),
    fonte("eod-trailing-drawdown-accounts/eod-drawdown-explained"),
    fonte("additional-helpful-items/daily-loss-limit-explained"),
  ],
}

const INTRADAY: Plano = {
  id: "intraday",
  nome: "Apex Intraday",
  resumo: "Drawdown em tempo real, que inclui o lucro aberto. É a entrada mais barata e a avaliação não tem limite de perda diário. Na PA aparece um limite diário que escala.",
  paraQuem: "Quem realiza lucro rápido (não devolve ganho aberto) e quer entrar pagando menos.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "INTRADAY", financiada: "INTRADAY" },
  cobranca: "unica",
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 50 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: null,
  destaques: [
    "Mais barato que o EOD nos 4 tamanhos (versão Standard): a partir de $167 no 25K",
    "A avaliação não tem limite de perda diário",
    "Passa em 1 dia, sem consistência e sem dias mínimos na avaliação",
    "Saque a cada 5 dias qualificados, com 100% de split e lucro mínimo diário menor ($100 a $300)",
  ],
  atencao: [
    "O drawdown inclui o lucro aberto e sobe a cada novo pico. Devolver lucro aberto pode reprovar a avaliação num dia que fecharia no verde",
    "Não existe reset: falhou ou passaram os 30 dias, é preciso comprar outra avaliação",
    "Na PA há limite de perda diário que escala com o lucro e consistência de 50% pra sacar",
    "Depois de passar, a taxa de ativação da PA é de $59 e tem 7 dias corridos pra pagar (ou compre a versão sem taxa, mais cara)",
  ],
  tamanhos: (() => {
    const tr: Trilha = { id: "intraday", preco: PRECO_INTRADAY, maxSaques: MAX_SAQUES_INTRADAY, lucroMinDia: LUCRO_MIN_DIA_INTRADAY }
    const saida: Partial<PorTamanho<DadosTamanho>> = {}
    TAMANHOS.forEach((t, i) => (saida[t] = dadosDaTrilha(tr, i as 0 | 1 | 2 | 3)))
    return saida
  })(),
  celulas: {
    ...celulasComuns({ id: "intraday", preco: PRECO_INTRADAY, maxSaques: MAX_SAQUES_INTRADAY, lucroMinDia: LUCRO_MIN_DIA_INTRADAY }),
    Drawdown: ["Intraday, em tempo real", "Inclui o lucro aberto; na PA para de subir em saldo inicial + $100"],
    "Limite de perda diário": cadaTamanho((i) => [
      "Avaliação: não tem",
      dllPaTexto(i),
      "Bateu: fecha as posições e pausa a sessão. A conta continua ativa",
    ]),
    Consistência: ["Avaliação: não tem", "PA (saque): 50%, zera a cada saque aprovado"],
  },
  extras: extrasComuns({ id: "intraday", preco: PRECO_INTRADAY, maxSaques: MAX_SAQUES_INTRADAY, lucroMinDia: LUCRO_MIN_DIA_INTRADAY }),
  fontes: [
    fonte("evaluation-accounts-ea/intraday-trailing-drawdown-evaluations"),
    fonte("intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-performance-accounts-pa"),
    fonte("intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-payouts"),
    fonte("intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained"),
    fonte("additional-helpful-items/daily-loss-limit-explained"),
  ],
}

export const APEX: Mesa = {
  slug: "apex",
  nome: "Apex Trader Funding",
  urlOficial: "https://apextraderfunding.com/",
  linkAfiliado: null,
  splitTrader: 100,
  resumo:
    "Mesa de futuros com duas trilhas, EOD e Intraday. A avaliação é paga uma vez só (30 dias), a taxa de ativação só vem se você passar, e 100% dos saques aprovados ficam com você.",
  planos: [EOD, INTRADAY],
  saqueMinimo: MINIMO_SAQUE,
  ajudaPreco: "Preço de tabela, sem promoção (a Apex faz descontos de até 90% com cupom). Pagamento único; a taxa de ativação da PA vem depois.",
  linhasExtras: [
    { rotulo: "Versões e preços", ajuda: "Standard: paga a ativação da PA só se passar. Sem taxa de ativação: paga mais já na compra." },
    { rotulo: "Escalonamento e limite diário da PA", ajuda: "Na PA os contratos e o limite de perda diário sobem conforme o lucro da conta." },
  ],
  avisos: [
    "Valem as regras das contas novas (compradas a partir de 01/03/2026). As contas legadas seguem regras antigas e não estão nesta comparação.",
  ],
  regrasGerais: [
    {
      titulo: "Dinheiro e saque",
      itens: [
        "Você fica com 100% dos saques aprovados. A Apex não fica com parte do lucro",
        "Saque a cada 5 dias qualificados (dia com lucro líquido mínimo), sem prazo pra juntar os dias. Cada PA paga no máximo 6 saques; depois ela fecha e só se obtém outra passando em outra avaliação",
        "Consistência de 50%: o maior dia lucrativo precisa ser menor que 50% do lucro desde o último saque. Se não for, só some o botão de saque: a conta não é reprovada",
        "Safety net: a PA precisa ficar acima do drawdown + $100 pra vida toda. Mínimo de $500 por pedido",
        "Análise em até 2 dias úteis, envio em 3 a 4 dias úteis e mais 3 a 7 dias no banco: em média de 5 a 11 dias úteis. A home fala em 'sem revisão de saque'; o Help Center descreve esse prazo",
        "Nos EUA o saque vai por ACH. Fora dos EUA vai pela Plane: precisa de conta bancária no país onde você mora, ID ou passaporte, e o e-mail do login. A Apex não emite formulário fiscal pra quem não é americano",
        "O aviso de risco do site diz que saques são discricionários e sujeitos a elegibilidade, conformidade e leis fiscais",
      ],
    },
    {
      titulo: "Avaliação, ativação e cobrança",
      itens: [
        "A avaliação é paga uma vez só. Não é assinatura, não renova e não há nada a cancelar",
        "30 dias corridos de acesso (fim às 18:00 ET do dia 30), sem extensão e sem reset. Falhou ou expirou: compra outra. O saldo não passa pra próxima",
        "Não há reembolso, nem parcial. A taxa de ativação e os dados de mercado também não são reembolsáveis. Escolher plano ou plataforma errada não dá direito a troca",
        "Passou: a avaliação é marcada depois das 18:00 ET. A partir daí são 7 dias corridos pra pagar a taxa de ativação da PA ($59 no Intraday, $90 no EOD, ou grátis na versão sem taxa). Perdeu o prazo, precisa passar outra avaliação. A PA sai em até 6 horas (compra depois do fechamento de sexta só é criada no domingo às 18:00 ET)",
        "Dá pra comprar 5 avaliações do mesmo tamanho e tipo de uma vez, com desconto. Elas dividem o mesmo prazo de 30 dias e são independentes. A PA não vende em pacote",
        "Dados de nível 1 estão incluídos. Profundidade de mercado (DOM) é paga à parte",
      ],
    },
    {
      titulo: "Como operar",
      itens: [
        "Feche tudo antes das 16:59 (horário de Nova York). Posição aberta no fechamento faz você perder a conta e os saldos. Agrícolas fecham antes (pecuária 14:05, grãos 14:20). Pode fechar mais cedo em feriado. O mercado volta às 18:00",
        "Stop é obrigatório (pendente ou mental), com gestão de risco definida. É proibido risco desproporcional (ex.: alvo de 5 ticks com stop de 150) e usar o threshold inteiro como stop",
        "Sem hedge de qualquer tipo: long e short ao mesmo tempo no mesmo instrumento ou em correlacionados fecha a conta na hora. Sem robô ou algoritmo, sem HFT e sem ordens dos dois lados esperando sorte",
        "Notícia é permitida com a sua estratégia normal. Perseguir o mercado ou apostar nos dois lados na notícia é proibido",
        "Não divida acesso, computador, IP, cartão nem copie trades entre traders. Pagamento e saque só em contas em seu nome. VPN ou proxy pra esconder identidade, aparelho ou local é proibido. Várias contas de usuário são motivo de banimento",
        "Ordens acima do limite de contratos são rejeitadas, sem punição. 10 micros contam como 1 contrato, somando todos os instrumentos",
      ],
    },
    {
      titulo: "Contas, limites e inatividade",
      itens: [
        "Até 20 PAs ativas ao mesmo tempo, somando contas legadas, EOD e Intraday. Não há limite de avaliações",
        "A PA precisa de 2 dias com pelo menos $50 de lucro líquido dentro de qualquer janela de 30 dias corridos. Aos 15 dias parada ela vira 'dormente' e recebe avisos (dias 15 e 20). Aos 30 dias fecha, perde o direito a saques e não volta",
        "Bater o limite de perda diário só pausa a sessão até as 18:00 ET. A conta segue ativa",
        "As contas não convertem entre plataformas: Tradovate, Rithmic e WealthCharts. Cada uma é uma conta separada",
        "Na avaliação, o drawdown trava quando chega ao saldo da meta em Rithmic e WealthCharts. Na Tradovate ele segue o pico sem parar",
      ],
    },
    {
      titulo: "Conta simulada e Live",
      itens: [
        "A avaliação e a PA são contas simuladas (Sim Funded). Os saques são reais",
        "A Live é por convite da Apex e não é automática. Ela pode monitorar você depois de, por exemplo, 3 saques seguidos de uma PA. Uma vez selecionado, não dá pra manter contas simuladas junto",
        "Na Live o split é 90/10 e o saque é diário (mínimo $500, sem teto). Não há taxa de conta, o drawdown inicial é de $3.000 EOD e você pode chegar a 5 contas",
        "A Live é decisão da Apex: o convite depende da avaliação que ela faz da sua disciplina, da sua consistência e do seu histórico",
      ],
    },
    {
      titulo: "Quem pode operar",
      itens: [
        "A Apex diz atender mais de 100 países. Há uma lista de países restritos e o Brasil não aparece nela",
        "São aceitos só documentos físicos de identidade (não cópia, não digital, não foto de tela). Em país restrito não dá pra comprar, sacar nem operar",
        "O aviso de risco do site diz que os serviços são destinados a usuários dos EUA e não são oferecidos onde a lei local proíbe. Confirme com a Apex a sua situação antes de comprar",
      ],
    },
    {
      titulo: "Contas legadas (fora da comparação)",
      itens: [
        "Contas compradas antes de 01/03/2026 continuam nas regras antigas, com assinatura recorrente até você cancelar, e reset só nelas",
        "Elas não convertem pras contas novas. A home mostra uma promoção por tempo limitado com avaliações legadas de volta",
      ],
    },
  ],
  vantagens: [
    "Você fica com 100% dos saques aprovados",
    "Avaliação em pagamento único, sem assinatura",
    "Passa em 1 dia, sem consistência na avaliação",
    "Duas trilhas de drawdown (EOD e Intraday), pra escolher o que combina com o seu estilo",
    "Até 20 contas PA ao mesmo tempo e a possibilidade de convite pra Live",
  ],
  atencao: [
    "Não existe reset: falhou ou expirou (30 dias corridos), compra outra avaliação",
    "Sem reembolso, nem se você escolher a plataforma ou o plano errado",
    "Feche tudo antes das 16:59 de Nova York, ou perde a conta e os saldos",
    "Só 6 saques por PA, e a PA fecha se ficar 30 dias sem 2 dias de $50 de lucro",
    "Fora dos EUA o saque vem pela Plane, com conta no país onde você mora, e sem formulário fiscal",
    "Stop é obrigatório e hedge, robô e VPN pra esconder identidade são proibidos",
  ],
  quiz: QUIZ_APEX,
  verificadoEm: VERIFICADO,
  fontes: [
    { url: "https://apextraderfunding.com/", verificadoEm: VERIFICADO },
    fonte("getting-started/futures-trading-times"),
    fonte("getting-started/prohibited-activities"),
    fonte("getting-started/restricted-countries"),
    fonte("billing/evaluation-plan-fees-and-access-explained"),
    fonte("billing/pa-activation-process-deadline-explained"),
    fonte("billing/refund-policy"),
    fonte("billing/inactivity-policy-on-performance-accounts-pa"),
    fonte("additional-helpful-items/50-consistency-requirement"),
    fonte("additional-helpful-items/scaling-levels-pa-explained"),
    fonte("additional-helpful-items/payout-method-information"),
    fonte("additional-helpful-items/payout-method-international-users"),
    fonte("getting-started/apex-live-prop-trading-program-faq"),
    fonte("legacy-products/legacy-products-overview"),
  ],
}

