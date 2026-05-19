import { cn } from "@/lib/utils"
import { ACHIEVEMENTS_CONFIG } from "@/lib/xp"

interface EarnedAchievement {
  achievementId: string
  earnedAt: string
}

interface AchievementsGridProps {
  earned: EarnedAchievement[]
  tradeCount: number
  winStreak: number
  journalStreak: number
  setupCount: number
}

export function AchievementsGrid({ earned, tradeCount, winStreak, journalStreak, setupCount }: AchievementsGridProps) {
  const earnedIds = new Set(earned.map((e) => e.achievementId))

  function getProgress(ach: typeof ACHIEVEMENTS_CONFIG[number]): number {
    switch (ach.type) {
      case "TRADES_COUNT": return Math.min((tradeCount / ach.requirement) * 100, 100)
      case "WIN_STREAK": return Math.min((winStreak / ach.requirement) * 100, 100)
      case "JOURNAL_STREAK": return Math.min((journalStreak / ach.requirement) * 100, 100)
      case "SETUP_LIBRARY": return Math.min((setupCount / ach.requirement) * 100, 100)
      default: return 0
    }
  }

  const sorted = [...ACHIEVEMENTS_CONFIG].sort((a, b) => {
    const aEarned = earnedIds.has(a.key) ? 0 : 1
    const bEarned = earnedIds.has(b.key) ? 0 : 1
    return aEarned - bEarned
  })

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {sorted.map((ach) => {
        const isEarned = earnedIds.has(ach.key)
        const progress = getProgress(ach)

        return (
          <div
            key={ach.key}
            className={cn(
              "bg-card border rounded-xl p-4 flex flex-col items-center text-center gap-2 transition-all",
              isEarned ? "border-teal/30 glow-teal-sm" : "border-border opacity-60"
            )}
          >
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center text-2xl",
              isEarned ? "bg-teal/10" : "bg-muted grayscale"
            )}>
              {ach.icon}
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">{ach.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{ach.description}</p>
            </div>
            <div className="w-full">
              {isEarned ? (
                <p className="text-[10px] text-teal font-medium">+{ach.xpReward} XP ✓</p>
              ) : (
                <>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-teal/50 rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{Math.round(progress)}%</p>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
