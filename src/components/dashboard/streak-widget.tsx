import { Flame, Calendar, BookOpen, Target, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface StreakData {
  type: string
  current: number
  best: number
}

interface StreakWidgetProps {
  streaks: StreakData[]
}

const STREAK_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  PROFITABLE_DAYS: { label: "Dias lucrativos", icon: Flame, color: "text-orange-400" },
  JOURNAL_ENTRIES: { label: "Journal", icon: BookOpen, color: "text-teal" },
  TRADE_PLANS: { label: "Plano de trade", icon: Target, color: "text-secondary" },
  CHECK_INS: { label: "Check-ins", icon: Calendar, color: "text-secondary" },
}

export function StreakWidget({ streaks }: StreakWidgetProps) {
  const displayStreaks = Object.entries(STREAK_META).map(([type, meta]) => {
    const found = streaks.find((s) => s.type === type)
    return {
      type,
      label: meta.label,
      icon: meta.icon,
      color: meta.color,
      current: found?.current ?? 0,
      best: found?.best ?? 0,
    }
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Streaks</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Consistência é a chave</p>
      </div>

      <div className="divide-y divide-border">
        {displayStreaks.map((streak) => {
          const dotsCount = Math.min(Math.max(streak.best, 7), 10)
          return (
            <div key={streak.type} className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <streak.icon className={cn("w-4 h-4", streak.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground font-medium">{streak.label}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex gap-0.5">
                    {Array.from({ length: dotsCount }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          i < streak.current
                            ? streak.color.replace("text-", "bg-")
                            : "bg-muted"
                        )}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">máx: {streak.best}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p
                  className={cn(
                    "text-xl font-bold font-mono",
                    streak.current > 0 ? streak.color : "text-muted-foreground"
                  )}
                >
                  {streak.current}
                </p>
                <p className="text-[10px] text-muted-foreground">dias</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
