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

export const SETUPS_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="setups-header"]',
    title: "Sua biblioteca de setups",
    body: "Cadastre cada estratégia que você opera — o app calcula win rate, profit factor e P&L automaticamente por setup, a partir dos trades que você já marcou com ele.",
  },
  {
    target: '[data-tour="setups-new"]',
    title: "Crie um novo setup",
    body: "Dá nome, descrição e regras da estratégia. Depois, ao registrar um trade, você marca qual setup foi usado.",
  },
  {
    target: '[data-tour="setups-list"]',
    title: "Compare a performance",
    body: "Veja em cards ou numa tabela comparativa — descubra qual das suas estratégias realmente dá lucro de verdade.",
  },
]

export const PLANNER_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="planner-today"]',
    title: "Plano de hoje",
    body: "Antes de operar, defina o plano do dia — isso evita decisão emocional no meio do pregão.",
  },
  {
    target: '[data-tour="planner-risk"]',
    title: "Risco e alvo do dia",
    body: "Defina seu max loss e profit target antes de abrir a primeira posição. O R:R é calculado automaticamente.",
  },
  {
    target: '[data-tour="planner-setups"]',
    title: "Setups planejados",
    body: "Marque quais estratégias você pretende operar hoje — dá pra comparar depois com o que você realmente fez.",
  },
  {
    target: '[data-tour="planner-notes"]',
    title: "Notas pré-sessão",
    body: "Contexto do mercado, níveis importantes, regras específicas pra hoje — tudo registrado antes de operar, não depois.",
  },
]

export const CALENDARIO_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="calendario-stats"]',
    title: "Resumo do mês",
    body: "P&L, win rate, dias operados, melhor e pior dia — a visão macro do seu mês inteiro.",
  },
  {
    target: '[data-tour="calendario-grid"]',
    title: "Seu mês, dia a dia",
    body: "Verde é dia lucrativo, vermelho é negativo. Clique em qualquer dia com trade pra ver o journal filtrado só daquele dia.",
  },
  {
    target: '[data-tour="calendario-summary"]',
    title: "Médias e distribuição",
    body: "Quanto você ganha num dia bom vs. perde num dia ruim, e quantos dias de cada tipo — a base pra saber se sua expectância é positiva.",
  },
]

export const DRAWDOWN_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="drawdown-tabs"]',
    title: "Real ou Simular",
    body: "Real usa os trades que você já lançou pra mostrar como está sua conta. Simular deixa você testar cenários na mão, sem mexer em nada seu.",
  },
  {
    target: '[data-tour="drawdown-rules"]',
    title: "As regras da sua conta",
    body: "Preencha saldo, meta e drawdown da sua mesa (ou escolha um preset). Campos com cadeado são liberados em planos superiores — toque neles pra ver qual.",
  },
  {
    target: '[data-tour="drawdown-hero"]',
    title: "Quanto ainda posso perder",
    body: "O número que mais importa: a margem até o limite da conta. A cor mostra a zona — folgado, atenção, perigo ou quebrou.",
  },
  {
    target: '[data-tour="drawdown-chart"]',
    title: "Corredor de segurança",
    body: "A área sombreada é o espaço entre seu patrimônio e o limite. Quanto mais fina, mais perto de quebrar. Passe o mouse (ou o dedo) pra ver cada momento.",
  },
  {
    target: '[data-tour="drawdown-scoreboard"]',
    title: "Compare as regras",
    body: "Cada mesa calcula o drawdown de um jeito. Aqui você vê a mesma conta nas quatro regras e qual é a mais apertada. Toque numa regra pra colocá-la em foco.",
  },
  {
    target: '[data-tour="drawdown-risk"]',
    title: "Quanto cabe arriscar",
    body: "Informe o ativo e o stop em pontos: o app calcula o risco por trade e quantos contratos cabem na sua margem — respeitando o limite diário.",
  },
]

export const DESAFIOS_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="desafios-new"]',
    title: "Crie um desafio",
    body: "Desafios são regras operacionais — o app avalia seus trades automaticamente e mostra se você está cumprindo ou não.",
  },
  {
    target: '[data-tour="desafios-templates"]',
    title: "Comece com um template",
    body: "Disciplina, controle de volume, consistência — esses templates já vêm com regras prontas, é só usar.",
  },
  {
    target: '[data-tour="desafios-list"]',
    title: "Acompanhe o cumprimento",
    body: "Cada regra mostra se está passando, com quantas violações — clique em ✕ pra apagar um desafio que não faz mais sentido.",
  },
]

export const TRILHA_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="trilha-progress"]',
    title: "Sua trilha de aprendizado",
    body: "Módulos do básico ao avançado, no seu ritmo — do fundamento até psicologia e gestão de risco.",
  },
  {
    target: '[data-tour="trilha-modules"]',
    title: "Escolha um módulo",
    body: "Clique em qualquer módulo pra começar as aulas — seu progresso fica salvo automaticamente.",
  },
]

export const ANALYTICS_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="analytics-kpis"]',
    title: "Seus números principais",
    body: "P&L total, win rate, profit factor e expectância — os 4 números que resumem se sua operação é lucrativa de verdade.",
  },
  {
    target: '[data-tour="analytics-equity"]',
    title: "Curva de patrimônio",
    body: "Sua evolução acumulada ao longo do tempo. O formato da curva conta mais sobre consistência do que o número final.",
  },
  {
    target: '[data-tour="analytics-drawdown"]',
    title: "Controle de risco",
    body: "Drawdown máximo e atual, streaks de win/loss — essencial pra quem opera com regra de trailing drawdown de prop firm.",
  },
  {
    target: '[data-tour="analytics-whatif"]',
    title: "Simulador \"E se?\"",
    body: "Compare seu resultado real com cenários alternativos: e se você tivesse saído no ponto máximo? E se removesse seus piores losses? (aparece a partir de 5 trades registrados)",
  },
]
