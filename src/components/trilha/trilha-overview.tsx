"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  BookOpen,
  Shield,
  TrendingUp,
  Brain,
  Target,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
} from "lucide-react"
import { TRILHA, totalLessons } from "@/lib/trilha-content"
import { getCompletedLessons } from "@/lib/trilha-progress"
import { cn } from "@/lib/utils"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BookOpen,
  Shield,
  TrendingUp,
  Brain,
  Target,
}

export function TrilhaOverview() {
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setCompleted(getCompletedLessons())
    setMounted(true)
  }, [])

  const total = totalLessons()
  const doneCount = mounted ? completed.size : 0
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  return (
    <div className="space-y-5">
      {/* Progresso geral */}
      <div className="rounded-xl border border-teal/20 bg-gradient-to-br from-teal/10 to-transparent p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/15">
            <GraduationCap className="h-6 w-6 text-teal" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Sua trilha de aprendizado</p>
            <p className="text-xs text-muted-foreground">
              {doneCount} de {total} aulas concluídas
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-teal tabular-nums">{pct}%</p>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal to-profit transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Módulos */}
      <div className="space-y-3">
        {TRILHA.map((mod) => {
          const Icon = ICONS[mod.icon] ?? BookOpen
          const modDone = mod.lessons.filter((l) => completed.has(l.id)).length
          const modTotal = mod.lessons.length
          const modPct = modTotal > 0 ? Math.round((modDone / modTotal) * 100) : 0
          const isComplete = mounted && modDone === modTotal

          return (
            <Link
              key={mod.id}
              href={`/trilha/${mod.id}`}
              className="group block rounded-xl border border-border bg-card p-4 transition-all hover:border-teal/40 hover:bg-card/80"
            >
              <div className="flex items-center gap-4">
                <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", mod.bg)}>
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-profit" />
                  ) : (
                    <Icon className={cn("h-5 w-5", mod.color)} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Módulo {mod.id}: {mod.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{mod.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-teal transition-all"
                        style={{ width: `${mounted ? modPct : 0}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {mounted ? `${modDone}/${modTotal}` : `${modTotal} aulas`}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-teal" />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
