// Taxonomia dos TIPOS de conta (a jornada Apex): Teste -> Avaliacao -> Aprovada.
// O `value` casa com o accountLabel gravado no trade (detectado automatico no sync).
// Cores: Teste = neutro (nao conta), Avaliacao = ambar (em progresso), Aprovada = verde (funded).
export const ACCOUNT_OPTIONS = [
  { value: "TEST",   label: "Teste",      color: "text-muted-foreground", bg: "bg-muted",         border: "border-border"        },
  { value: "EVAL",   label: "Avaliação",  color: "text-yellow-400",       bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
  { value: "PA",     label: "Aprovada",   color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
  { value: "PA25K",  label: "PA 25K",     color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
  { value: "PA50K",  label: "PA 50K",     color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
  { value: "PA75K",  label: "PA 75K",     color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
  { value: "PA100K", label: "PA 100K",    color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
  { value: "PA150K", label: "PA 150K",    color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
  { value: "PA250K", label: "PA 250K",    color: "text-profit",           bg: "bg-profit/10",     border: "border-profit/30"     },
] as const

export type AccountLabel = typeof ACCOUNT_OPTIONS[number]["value"]

// Contas cujos trades NAO entram nas metricas reais (simulacao/teste).
export const NON_REAL_LABELS: string[] = ["TEST"]

export function getAccountOption(value: string) {
  return ACCOUNT_OPTIONS.find((a) => a.value === value) ?? ACCOUNT_OPTIONS[0]
}
