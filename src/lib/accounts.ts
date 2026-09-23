// Taxonomia dos TIPOS de conta (jornada de prop firm): Teste -> Avaliacao -> Aprovada.
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

// Os 3 baldes "macro" que agrupam qualquer accountLabel (TEST, EVAL, PA, PA25K...)
// nas 3 fases da jornada — usado no seletor "por tipo" (Carteira, Analytics,
// Calendário) pra não precisar separar por conta individual.
export type Bucket = "EVAL" | "PA" | "TEST"
export const BUCKET_META: Record<Bucket, { name: string; color: string }> = {
  EVAL: { name: "Avaliação", color: "#F59E0B" },
  PA: { name: "Aprovada", color: "#10B981" },
  TEST: { name: "Teste", color: "#64748B" },
}
export function bucketOf(label: string): Bucket {
  if (label === "TEST") return "TEST"
  if (label?.toUpperCase().startsWith("PA")) return "PA"
  return "EVAL"
}
