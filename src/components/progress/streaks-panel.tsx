import { cn } from "@/lib/utils"
import { Flame, BookOpen, Target, TrendingUp } from "lucide-react"

interface StreakData {
  type: string
  current: number
  best: number
}

interface StreaksPanelProps {
  streaks: StreakData[]
}

const STREAK_META: Record<string, { label: string; icon: React.ElementType; color: string; description: string }> = {
  JOURNAL_ENTRIES: { label: "Journal", icon: BookOpen, color: "text-teal", description: "Dias consecutivos registrando trades" },
  PROFITABLE_DAYS: { label: "Dias lucrativos", icon: Flame, color: "text-orange-400", description: "Dias consecutivos no lucro" },
  CHECK_INS: { label: "Check-ins", icon: TrendingUp, color: "text-secondary", description: "Dias consecutivos com check-in" },
  TRADE_PLANS: { label: "Plano de trade", icon: Target, color: "text-profit", description: "Dias consecutivos com plano definido" },
}

export function StreaksPanel({ streaks }: StreaksPanelProps) {
  if (streaks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Comece a operar para acumular streaks!
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {streaks.map((streak) => {
        const meta = STREAK_META[streak.type]
        if (!meta) return null
        const Icon = meta.icon
        const pct = streak.best > 0 ? Math.min((streak.current / streak.best) * 100, 100) : 0

        return (
          <div key={streak.type} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <Icon className={cn("w-4 h-4", meta.color)} />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">{meta.label}</p>
                <p className="text-[10px] text-muted-foreground">{meta.description}</p>
              </div>
            </div>

            <div className="flex items-end justify-between mb-2">
              <div>
                <p className={cn("text-3xl font-bold font-mono", meta.color)}>{streak.current}</p>
                <p className="text-xs text-muted-foreground">atual</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold font-mono text-muted-foreground">{streak.best}</p>
                <p className="text-xs text-muted-foreground">recorde</p>
              </div>
            </div>

            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", meta.color.replace("text-", "bg-"))}
                style={{ width: `${pct}%`, opacity: 0.7 }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
