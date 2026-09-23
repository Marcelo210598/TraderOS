"use client"

import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface CalendarNavProps {
  label: string
  prevMonth: string
  nextMonth: string
  isCurrentMonth: boolean
  // Tipo de conta filtrado (?tipo=EVAL|PA|TEST) — precisa ir junto na troca de
  // mês, senão o filtro reseta sozinho ao navegar.
  tipo?: string | null
}

export function CalendarNav({ label, prevMonth, nextMonth, isCurrentMonth, tipo }: CalendarNavProps) {
  const router = useRouter()
  const tipoQs = tipo ? `&tipo=${tipo}` : ""
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => router.push(`/calendario?month=${prevMonth}${tipoQs}`)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-semibold text-foreground capitalize min-w-36 text-center">
        {label}
      </span>
      <button
        onClick={() => router.push(`/calendario?month=${nextMonth}${tipoQs}`)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-disabled={isCurrentMonth}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
