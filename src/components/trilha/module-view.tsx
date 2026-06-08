"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  PartyPopper,
} from "lucide-react"
import type { TrilhaModule } from "@/lib/trilha-content"
import { getCompletedLessons, setLessonCompleted } from "@/lib/trilha-progress"
import { LessonContent } from "./lesson-content"
import { cn } from "@/lib/utils"

export function ModuleView({ module }: { module: TrilhaModule }) {
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)

  useEffect(() => {
    setCompleted(getCompletedLessons())
    setMounted(true)
  }, [])

  const lessons = module.lessons
  const current = lessons[currentIdx]
  const isDone = mounted && completed.has(current.id)
  const doneCount = mounted ? lessons.filter((l) => completed.has(l.id)).length : 0
  const allDone = mounted && doneCount === lessons.length

  const pct = useMemo(
    () => (lessons.length > 0 ? Math.round((doneCount / lessons.length) * 100) : 0),
    [doneCount, lessons.length]
  )

  function toggleDone() {
    const next = setLessonCompleted(current.id, !completed.has(current.id))
    setCompleted(new Set(next))
  }

  function goTo(idx: number) {
    if (idx >= 0 && idx < lessons.length) {
      setCurrentIdx(idx)
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  function completeAndAdvance() {
    if (!completed.has(current.id)) {
      const next = setLessonCompleted(current.id, true)
      setCompleted(new Set(next))
    }
    if (currentIdx < lessons.length - 1) goTo(currentIdx + 1)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* Voltar + progresso do módulo */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/trilha"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar à trilha
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">
          {doneCount}/{lessons.length} concluídas · {pct}%
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Lista de aulas */}
        <aside className="space-y-1.5 lg:sticky lg:top-4 lg:self-start">
          {lessons.map((l, i) => {
            const done = mounted && completed.has(l.id)
            const active = i === currentIdx
            return (
              <button
                key={l.id}
                onClick={() => goTo(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all",
                  active
                    ? "border-teal/40 bg-teal/10"
                    : "border-transparent bg-card hover:border-border"
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" />
                ) : (
                  <Circle className={cn("h-4 w-4 shrink-0", active ? "text-teal" : "text-muted-foreground")} />
                )}
                <span
                  className={cn(
                    "text-xs leading-snug",
                    active ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  {l.title}
                </span>
              </button>
            )
          })}
        </aside>

        {/* Conteúdo da aula */}
        <article className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-teal">
              Aula {currentIdx + 1}/{lessons.length}
            </span>
            <span>·</span>
            <Clock className="h-3 w-3" />
            <span>{current.duration}</span>
          </div>
          <h2 className="mb-5 text-lg font-bold text-foreground sm:text-xl">{current.title}</h2>

          <LessonContent blocks={current.blocks} />

          {/* Ações */}
          <div className="mt-7 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={toggleDone}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all",
                isDone
                  ? "border-profit/30 bg-profit/10 text-profit"
                  : "border-border text-muted-foreground hover:border-teal/40 hover:text-foreground"
              )}
            >
              {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              {isDone ? "Concluída" : "Marcar como concluída"}
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => goTo(currentIdx - 1)}
                disabled={currentIdx === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                Anterior
              </button>
              <button
                onClick={completeAndAdvance}
                disabled={currentIdx === lessons.length - 1 && isDone}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal px-4 py-2.5 text-sm font-medium text-teal-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {currentIdx === lessons.length - 1 ? "Concluir" : "Próxima"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Parabéns ao terminar o módulo */}
          {allDone && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-profit/20 bg-profit/5 p-4">
              <PartyPopper className="h-5 w-5 shrink-0 text-profit" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Módulo concluído! 🎉</p>
                <p className="text-xs text-muted-foreground">
                  Mandou bem. Volte à trilha e siga pro próximo módulo.
                </p>
              </div>
              <Link
                href="/trilha"
                className="shrink-0 rounded-lg bg-teal px-3 py-2 text-xs font-medium text-teal-foreground hover:opacity-90"
              >
                Ver trilha
              </Link>
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
