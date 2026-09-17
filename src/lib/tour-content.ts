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
