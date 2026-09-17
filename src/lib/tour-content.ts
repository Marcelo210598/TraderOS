import type { TourStep } from "@/components/tour/section-tour"

// Conteúdo dos tours guiados por seção — um array por página, adicionado aos
// poucos. Cada `target` precisa bater com um atributo data-tour="..." real na
// página correspondente.

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
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
