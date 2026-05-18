import { Flame, Calendar, BookOpen, Target } from "lucide-react"
import { cn } from "@/lib/utils"

interface StreakItem {
  label: string
  current: number
  best: number
  icon: React.ElementType
  color: string
}

const STREAKS: StreakItem[] = [
  {
    label: "Dias lucrativos",
    current: 3,
    best: 7,
    icon: Flame,
    color: "text-orange-400",
  },
  {
    label: "Journal",
    current: 5,
    best: 12,
    icon: BookOpen,
    color: "text-teal",
  },
  {
    label: "Plano de trade",
    current: 2,
    best: 8,
    icon: Target,
    color: "text-secondary",
  },
]

export function StreakWidget() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Streaks</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Consistência é a chave</p>
      </div>

      <div className="divide-y divide-border">
        {STREAKS.map((streak) => (
          <div key={streak.label} className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <streak.icon className={cn("w-4 h-4", streak.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground font-medium">{streak.label}</p>
              <div className="flex items-center gap-2 mt-1">
                {/* Dots de streak */}
                <div className="flex gap-0.5">
                  {Array.from({ length: Math.min(streak.best, 10) }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        i < streak.current ? streak.color.replace("text-", "bg-") : "bg-muted"
                      )}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  máx: {streak.best}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={cn("text-xl font-bold font-mono", streak.color)}>
                {streak.current}
              </p>
              <p className="text-[10px] text-muted-foreground">dias</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
