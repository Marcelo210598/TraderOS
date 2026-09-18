import type { TourStep } from "@/components/tour/section-tour"

// Conteúdo dos tours guiados por seção — um array por página, adicionado aos
// poucos. Cada `target` precisa bater com um atributo data-tour="..." real na
// página correspondente.

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="dashboard-welcome"]',
    title: "Bem-vindo ao MeuTrade! 👋",
    body: "Que bom ter você aqui. Antes de mais nada, deixa eu te mostrar rapidinho onde estão as principais coisas — leva menos de 1 minuto.",
  },
  {
    target: '[data-tour="dashboard-metrics"]',
    title: "Suas métricas da semana",
    body: "P&L, win rate, trades e profit factor dos últimos 7 dias — o resumo rápido de como você está operando.",
  },
  {
    target: '[data-tour="dashboard-checkin"]',
    title: "Check-in emocional",
    body: "Antes de operar, avalie seu estado. A Vega cruza isso com seu histórico e avisa quando seu stress alto costuma derrubar seu resultado.",
  },
  {
    target: '[data-tour="dashboard-chart"]',
    title: "Performance e streaks",
    body: "O gráfico mostra sua evolução na semana. Os streaks recompensam consistência — dias lucrativos, journal em dia, check-ins — não só lucro.",
  },
  {
    target: '[data-tour="dashboard-recent"]',
    title: "Trades recentes",
    body: "Seus últimos trades aparecem aqui. Clique em qualquer um pra ver o detalhe, o gráfico de execução e a análise da Vega.",
  },
  {
    target: '[data-tour="dashboard-cta"]',
    title: "Comece por aqui",
    body: "Registre seu primeiro trade — pode ser manual ou importado via CSV. É a partir daqui que todo o resto do app ganha vida.",
  },
]

export const VEGA_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="vega-intro"]',
    title: "Converse com a Vega",
    body: "A Vega é uma IA especializada em trading que analisa seus dados reais — não é um chat genérico, ela vê seu histórico de verdade.",
  },
  {
    target: '[data-tour="vega-context"]',
    title: "Ela já conhece seus dados",
    body: "A Vega tem acesso aos seus últimos 90 dias de trades — win rate, setups, sessões, P&L. Toda resposta é baseada no que você realmente operou.",
  },
  {
    target: '[data-tour="vega-suggestions"]',
    title: "Comece com uma pergunta pronta",
    body: "Essas sugestões cobrem as perguntas mais úteis pra começar — clique em qualquer uma pra ver a Vega em ação.",
  },
  {
    target: '[data-tour="vega-input"]',
    title: "Ou pergunte o que quiser",
    body: "Digite em português, sobre qualquer coisa: um setup específico, sua psicologia, regras de prop firm. Enter envia, Shift+Enter quebra linha.",
  },
]

export const CARTEIRA_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="carteira-saldo"]',
    title: "Saldo consolidado",
    body: "O saldo de todas as suas contas somado, com a curva de patrimônio acumulado — sua evolução real, não só o resultado dos trades.",
  },
  {
    target: '[data-tour="carteira-toggle"]',
    title: "Consolidado ou por tipo",
    body: "Alterne entre ver tudo junto ou separado por tipo de conta (Avaliação, Aprovada, Teste) — útil pra comparar performance entre contas.",
  },
  {
    target: '[data-tour="carteira-tipos"]',
    title: "Separado automaticamente",
    body: "O app detecta o tipo de cada conta pelo nome da corretora e agrupa sozinho — sem precisar organizar nada manualmente.",
  },
  {
    target: '[data-tour="carteira-historico"]',
    title: "Histórico de transações",
    body: "Todo trade, depósito e saque aparece aqui, filtrável por tipo de conta. Dá pra ver o journal completo de qualquer trade a partir daqui.",
  },
]

export const JOURNAL_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="journal-stats"]',
    title: "Métricas do mês",
    body: "Trades registrados, win rate e P&L do mês corrente — sempre visível no topo do journal.",
  },
  {
    target: '[data-tour="journal-tools"]',
    title: "Ferramentas úteis",
    body: "Importe trades em massa via CSV (NinjaTrader, Tradovate ou o template do MeuTrade), organize suas contas ou exporte um PDF do journal pra imprimir/enviar.",
  },
  {
    target: '[data-tour="journal-filters"]',
    title: "Filtre como quiser",
    body: "Por resultado, instrumento, setup, tag ou período — combine quantos filtros precisar pra achar o que procura.",
  },
  {
    target: '[data-tour="journal-list"]',
    title: "Sua lista de trades",
    body: "Clique em qualquer trade pra ver o detalhe completo: gráfico de execução, notas e análise da Vega.",
  },
]

export const PROGRESS_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="progress-xp"]',
    title: "Seu progresso",
    body: "Você ganha XP a cada trade registrado, check-in feito e ação de consistência — não é só sobre lucro.",
  },
  {
    target: '[data-tour="progress-tabs"]',
    title: "Conquistas, streaks e histórico",
    body: "Três abas: conquistas desbloqueadas, seus streaks ativos e um histórico geral de estatísticas.",
  },
  {
    target: '[data-tour="progress-achievements"]',
    title: "Suas conquistas",
    body: "Cada conquista tem um critério real baseado nos seus dados — trades registrados, streaks, setups criados.",
  },
]
