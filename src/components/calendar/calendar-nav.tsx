"use client"

import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface CalendarNavProps {
  label: string
  prevMonth: string
  nextMonth: string
  isCurrentMonth: boolean
}

export function CalendarNav({ label, prevMonth, nextMonth, isCurrentMonth }: CalendarNavProps) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => router.push(`/calendario?month=${prevMonth}`)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-semibold text-foreground capitalize min-w-36 text-center">
        {label}
      </span>
      <button
        onClick={() => router.push(`/calendario?month=${nextMonth}`)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-disabled={isCurrentMonth}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
