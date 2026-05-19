import { getLevelTitle } from "@/lib/xp"
import { cn } from "@/lib/utils"
import { Star, Zap } from "lucide-react"

interface XpCardProps {
  xp: number
  level: number
  currentXp: number
  xpNeeded: number
  progress: number
  totalTrades: number
  winRate: number
}

export function XpCard({ xp, level, currentXp, xpNeeded, progress, totalTrades, winRate }: XpCardProps) {
  const title = getLevelTitle(level)

  return (
    <div className="bg-card border border-teal/20 rounded-xl p-5 glow-teal-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-10 h-10 rounded-xl bg-teal/15 flex items-center justify-center">
              <Star className="w-5 h-5 text-teal" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Nível {level}</p>
              <p className="text-lg font-bold text-foreground">{title}</p>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-3xl font-bold font-mono text-teal">{xp.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">XP total</p>
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-mono">{currentXp} XP</span>
          <span className="text-muted-foreground">→ Nível {level + 1}: {getLevelTitle(level + 1)}</span>
          <span className="text-teal font-mono">{xpNeeded} XP</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal to-teal/60 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-right text-xs text-muted-foreground">{progress}% para o próximo nível</p>
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
        {[
          { label: "Trades", value: totalTrades.toString() },
          { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? "text-profit" : "text-loss" },
          { label: "XP hoje", value: "+0" },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className={cn("text-base font-bold font-mono", s.color ?? "text-foreground")}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
