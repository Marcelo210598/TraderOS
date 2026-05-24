export const ACCOUNT_OPTIONS = [
  { value: "TEST",   label: "Conta Teste",  color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
  { value: "PA25K",  label: "PA 25K",       color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/30"        },
  { value: "PA50K",  label: "PA 50K",       color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/30"        },
  { value: "PA75K",  label: "PA 75K",       color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/30"        },
  { value: "PA100K", label: "PA 100K",      color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/30"        },
  { value: "PA150K", label: "PA 150K",      color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/30"        },
  { value: "PA250K", label: "PA 250K",      color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/30"        },
] as const

export type AccountLabel = typeof ACCOUNT_OPTIONS[number]["value"]

export function getAccountOption(value: string) {
  return ACCOUNT_OPTIONS.find((a) => a.value === value) ?? ACCOUNT_OPTIONS[0]
}
