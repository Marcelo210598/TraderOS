// Lucid Trading — dados lidos SÓ das páginas oficiais em 2026-09-28.
// Levantamento completo + texto bruto: docs/mesas-proprietarias/ (lucid-levantamento-2026-09-28.md).
// Regras mudam sem aviso: quem edita este arquivo confere antes no Help Center oficial.

import { QUIZ_LUCID } from "./quiz-lucid"
import type { DadosTamanho, Fonte, FaixaEscalonamento, Mesa, Plano, PorTamanho, Tamanho } from "./types"

const VERIFICADO = "2026-09-28"
const HELP = "https://support.lucidtrading.com/en/articles"

const fonte = (path: string): Fonte => ({ url: `${HELP}/${path}`, verificadoEm: VERIFICADO })

/** [25K, 50K, 100K, 150K] → objeto por tamanho. Mantém as tabelas abaixo legíveis, na ordem do site. */
const porTamanho = <T,>(v: [T, T, T, T]): PorTamanho<T> => ({ 25: v[0], 50: v[1], 100: v[2], 150: v[3] })

const LOTES = porTamanho([
  { minis: 2, micros: 20 },
  { minis: 4, micros: 40 },
  { minis: 6, micros: 60 },
  { minis: 10, micros: 100 },
])
const META_AVALIACAO = porTamanho([1250, 3000, 6000, 9000])
const PERDA_MAXIMA = porTamanho([1000, 2000, 3000, 4500])
const LIMITE_DIARIO = porTamanho<number | null>([600, 1200, 1800, 2700])
const TRAVA_TRAILING = porTamanho([26100, 52100, 103100, 154600])
const COLCHAO = porTamanho([1100, 2100, 3100, 4600])
const LIVE_BONUS = porTamanho([1000, 2000, 3000, 4500])
const MINIMO_SAQUE = 500

const ESCALONAMENTO_FLEX: PorTamanho<FaixaEscalonamento[]> = porTamanho([
  [
    { lucroMinimo: 0, minis: 1, micros: 10 },
    { lucroMinimo: 1000, minis: 2, micros: 20 },
  ],
  [
    { lucroMinimo: 0, minis: 2, micros: 20 },
    { lucroMinimo: 1000, minis: 3, micros: 30 },
    { lucroMinimo: 2000, minis: 4, micros: 40 },
  ],
  [
    { lucroMinimo: 0, minis: 3, micros: 30 },
    { lucroMinimo: 1000, minis: 4, micros: 40 },
    { lucroMinimo: 2000, minis: 5, micros: 50 },
    { lucroMinimo: 3000, minis: 6, micros: 60 },
  ],
  [
    { lucroMinimo: 0, minis: 4, micros: 40 },
    { lucroMinimo: 1000, minis: 5, micros: 50 },
    { lucroMinimo: 2000, minis: 6, micros: 60 },
    { lucroMinimo: 3000, minis: 8, micros: 80 },
    { lucroMinimo: 4500, minis: 10, micros: 100 },
  ],
])

const tamanhos = (monta: (t: Tamanho, i: 0 | 1 | 2 | 3) => DadosTamanho): PorTamanho<DadosTamanho> => ({
  25: monta(25, 0),
  50: monta(50, 1),
  100: monta(100, 2),
  150: monta(150, 3),
})

const PRO: Plano = {
  id: "pro",
  nome: "LucidPro",
  resumo: "Avaliação sem regra de consistência: dá pra passar em 1 dia. O saque na financiada pede meta de lucro e consistência de 40%.",
  paraQuem: "Quem quer passar a avaliação o mais rápido possível e não quer lote reduzido no começo.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  dllOpcional: true,
  consistencia: { avaliacao: null, financiada: 40 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: 5,
  destaques: [
    "Sem consistência na avaliação: dá pra passar em 1 dia",
    "Lote máximo liberado desde o primeiro dia (sem escalonamento)",
    "Notícia liberada",
    "Limite diário opcional — ligar deixa a compra mais barata",
  ],
  atencao: [
    "Na financiada, seu maior dia não pode passar de 40% do lucro do ciclo pra liberar o saque",
    "O saque exige uma meta de lucro no ciclo e um colchão acima do saldo inicial que não pode ser sacado",
    "O valor máximo por saque cresce devagar: 1º saque limitado, do 2º em diante um pouco maior",
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: META_AVALIACAO[t],
    perdaMaxima: PERDA_MAXIMA[t],
    limiteDiario: LIMITE_DIARIO[t],
    lotes: LOTES[t],
    travaTrailing: TRAVA_TRAILING[t],
    saque: {
      minimo: MINIMO_SAQUE,
      metaLucroCiclo: { primeiro: [250, 500, 750, 1000][i], demais: [250, 500, 750, 1000][i] },
      colchao: COLCHAO[t],
      maximos: [
        { rotulo: "1º saque", valor: [1000, 2000, 2500, 3000][i] },
        { rotulo: "2º em diante", valor: [1500, 2500, 3000, 3500][i] },
      ],
    },
    liveBonus: LIVE_BONUS[t],
    precoTabelaUsd: [123, 192, 307, 410][i],
  })),
  fontes: [
    fonte("12890029-lucidpro-evaluation-account"),
    fonte("12890069-lucidpro-funded-account"),
    fonte("12890092-lucidpro-payouts"),
    fonte("12890109-lucidpro-consistency-percentage"),
    fonte("16226068-lucidpro-customization"),
  ],
}

const FLEX: Plano = {
  id: "flex",
  exigeLucroLiquidoNoCiclo: true,
  nome: "LucidFlex",
  resumo: "O saque mais simples da Lucid: na financiada não tem consistência nem colchão. Em troca, o lote começa menor e cresce com o lucro.",
  paraQuem: "Quem prefere regras de saque simples e não se importa em começar com lote menor na financiada.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "EOD", financiada: "EOD" },
  dllOpcional: true,
  consistencia: { avaliacao: 50, financiada: null },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: 5,
  destaques: [
    "Sem consistência e sem colchão na financiada",
    "Saque pede só 5 dias com um lucro mínimo e lucro líquido positivo no ciclo",
    "Notícia liberada",
    "Limite diário opcional — ligar deixa a compra mais barata",
  ],
  atencao: [
    "A avaliação tem consistência de 50% (dá pra passar em 2 dias, com uma pequena folga embutida)",
    "Na financiada o lote começa menor e sobe conforme o lucro; ao sacar, o degrau pode descer",
    "O saque é de até 50% do lucro, com um teto que não cresce nos saques seguintes",
    "Ao pedir o primeiro saque, a perda máxima trava no saldo inicial + $100",
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: META_AVALIACAO[t],
    perdaMaxima: PERDA_MAXIMA[t],
    limiteDiario: LIMITE_DIARIO[t],
    lotes: LOTES[t],
    travaTrailing: TRAVA_TRAILING[t],
    saque: {
      minimo: MINIMO_SAQUE,
      diasComLucro: { dias: 5, lucroMinimoPorDia: [100, 150, 200, 250][i] },
      maximos: [{ rotulo: "Cada saque", valor: [1000, 2000, 2500, 3000][i], pctDoLucro: 50 }],
    },
    escalonamento: ESCALONAMENTO_FLEX[t],
    liveBonus: LIVE_BONUS[t],
    precoTabelaUsd: [89, 146, 293, 407][i],
  })),
  fontes: [
    fonte("12945790-lucidflex-evaluation-account"),
    fonte("12945795-lucidflex-funded-account"),
    fonte("12945796-lucidflex-payouts"),
    fonte("12945808-lucidflex-scaling-plan"),
    fonte("12945815-lucidflex-drawdown"),
  ],
}

const DAILY: Plano = {
  id: "daily",
  exigeLucroLiquidoNoCiclo: true,
  nome: "LucidDaily",
  resumo: "Saque diário e sem consistência na financiada. Em troca: drawdown intraday na financiada e proibido operar notícia forte.",
  paraQuem: "Quem quer sacar com frequência e evita operar em horário de notícia.",
  caminho: "avaliacao",
  drawdown: { avaliacao: "ESCOLHA", financiada: "INTRADAY" },
  dllOpcional: true,
  consistencia: { avaliacao: 50, financiada: null },
  operaNoticia: false,
  saqueDiario: true,
  saquesAteLive: null,
  destaques: [
    "Pode pedir saque todo dia em que estiver elegível",
    "Sem consistência na financiada",
    "Sem teto por pedido: dá pra sacar todo o lucro acima do colchão",
    "Você escolhe o drawdown da avaliação (EOD ou intraday) e se quer limite diário",
  ],
  atencao: [
    "Operar notícia de alto impacto em USD quebra a conta: fique fora de 1 minuto antes até 1 minuto depois",
    "Na financiada o drawdown é sempre intraday, ou seja, sobe junto com o lucro aberto",
    "Bater o teto de lucro em um único dia move você pra análise de Live",
    "O preço varia conforme as 4 combinações de configuração (limite diário × drawdown da avaliação)",
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: META_AVALIACAO[t],
    perdaMaxima: PERDA_MAXIMA[t],
    limiteDiario: LIMITE_DIARIO[t],
    lotes: LOTES[t],
    travaTrailing: TRAVA_TRAILING[t],
    saque: {
      minimo: MINIMO_SAQUE,
      colchao: COLCHAO[t],
      maximos: [{ rotulo: "Cada saque", valor: null }],
    },
    tetoLucroDia: [6000, 8000, 10000, 12000][i],
    liveBonus: null,
    precoTabelaUsd: null,
  })),
  fontes: [
    fonte("15996664-luciddaily-evaluation"),
    fonte("15997244-luciddaily-funded-account"),
    fonte("15997266-luciddaily-payouts"),
    fonte("15998425-luciddaily-drawdown"),
    fonte("16033858-luciddaily-customization"),
  ],
}

const DIRECT: Plano = {
  id: "direct",
  nome: "LucidDirect",
  resumo: "Sem avaliação: você compra e já opera na financiada. Custa mais, e o saque exige consistência de 20%.",
  paraQuem: "Quem já tem confiança no método e quer pular a avaliação, aceitando pagar mais e uma consistência mais rígida.",
  caminho: "direto",
  drawdown: { avaliacao: null, financiada: "EOD" },
  dllOpcional: false,
  consistencia: { avaliacao: null, financiada: 20 },
  operaNoticia: true,
  saqueDiario: false,
  saquesAteLive: 5,
  destaques: [
    "Sem avaliação: começa a construir saque desde o primeiro dia",
    "Lote máximo liberado desde o começo (sem escalonamento)",
    "Notícia liberada",
    "Perda máxima maior nos tamanhos 100K e 150K",
  ],
  atencao: [
    "Consistência de 20%: seu maior dia não pode passar de 20% do lucro do ciclo pra liberar o saque",
    "A meta de lucro do 1º saque é bem maior (ex.: $3.000 no 50K)",
    "Preço de tabela mais alto que os planos com avaliação",
    "O limite diário só existe a partir do 50K, e é fixo até a conta passar da trava do trailing",
  ],
  tamanhos: tamanhos((t, i) => ({
    metaAvaliacao: null,
    perdaMaxima: [1000, 2000, 3500, 5000][i],
    limiteDiario: [null, 1200, 2100, 3000][i],
    lotes: LOTES[t],
    travaTrailing: [26100, 52100, 103600, 155100][i],
    saque: {
      minimo: MINIMO_SAQUE,
      metaLucroCiclo: { primeiro: [1500, 3000, 6000, 9000][i], demais: [1250, 2500, 3500, 4500][i] },
      maximos: [
        { rotulo: "Saques 1 a 3", valor: [1000, 2000, 2500, 3000][i] },
        { rotulo: "Saques 4 e 5", valor: [1000, 2500, 3000, 3500][i] },
      ],
    },
    liveBonus: LIVE_BONUS[t],
    precoTabelaUsd: [329, 515, 700, 836][i],
  })),
  fontes: [
    fonte("12890148-luciddirect-funded-account"),
    fonte("12890164-luciddirect-payout-objectives"),
    fonte("12890178-luciddirect-consistency-percentage"),
    fonte("12890185-luciddirect-daily-loss-limit"),
    fonte("12890192-luciddirect-drawdown"),
  ],
}

export const LUCID: Mesa = {
  slug: "lucid",
  nome: "Lucid Trading",
  urlOficial: "https://lucidtrading.com/#plans",
  linkAfiliado: null,
  splitTrader: 90,
  resumo:
    "Mesa de futuros com 4 tipos de plano, sem mensalidade e sem taxa de ativação da conta financiada. Você fica com 90% dos saques.",
  planos: [PRO, FLEX, DAILY, DIRECT],
  saqueMinimo: MINIMO_SAQUE,
  vantagens: [
    "Sem mensalidade e sem taxa de ativação da conta financiada",
    "Você fica com 90% dos saques",
    "4 tipos de plano, pra estilos diferentes de operar e de sacar",
    "Funciona em NinjaTrader, Tradovate, TradingView (CQG) e Rithmic",
    "Contas de 25K a 150K: dá pra começar pequeno",
  ],
  atencao: [
    "Conta sem lucro ou prejuízo de pelo menos $1 em 30 dias é deletada, então não deixe a conta parada",
    "Hedge, HFT e microscalping têm punição, que vai de reset da conta a perda de lucro. Leia essas regras antes de operar",
    "O preço de tabela é só referência: o valor final muda toda semana, confira no site",
    "No Help Center o reset está documentado só pra avaliação. Pra conta financiada quebrada, confirme com a mesa",
  ],
  quiz: QUIZ_LUCID,
  verificadoEm: VERIFICADO,
  fontes: [
    { url: "https://support.lucidtrading.com/en/", verificadoEm: VERIFICADO },
    { url: "https://lucidtrading.com/#plans", verificadoEm: VERIFICADO },
  ],
}
