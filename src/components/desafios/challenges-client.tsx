"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, CheckCircle2, XCircle, Trophy, Flame } from "lucide-react"
import { cn } from "@/lib/utils"
import { CreateChallengeModal } from "./create-challenge-modal"
import { ChallengeRule, ChallengeRuleResult } from "@/lib/challenges"

interface ChallengeWithResults {
  id: string
  name: string
  description: string | null
  rules: ChallengeRule[]
  isActive: boolean
  startedAt: string
  results: ChallengeRuleResult[]
  passRate: number
  daysActive: number
}

interface Props {
  challenges: ChallengeWithResults[]
}

export function ChallengesClient({ challenges }: Props) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setDeletingId(id)
    await fetch(`/api/challenges/${id}`, { method: "DELETE" })
    router.refresh()
    setDeletingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Crie regras operacionais — o sistema avalia automaticamente seus trades
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal text-teal-foreground text-xs font-medium hover:bg-teal/90 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo Desafio
        </button>
      </div>

      {/* Lista */}
      {challenges.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center space-y-3">
          <Trophy className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <div>
            <p className="text-sm font-medium text-foreground">Nenhum desafio criado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Crie um desafio com regras operacionais e acompanhe sua disciplina automaticamente
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal text-teal-foreground text-sm font-medium hover:bg-teal/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar primeiro desafio
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {challenges.map(ch => (
            <div key={ch.id} className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Card header */}
              <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-foreground truncate">{ch.name}</h3>
                    <span className={cn(
                      "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0",
                      ch.passRate === 100 ? "bg-profit/10 text-profit" : ch.passRate >= 60 ? "bg-yellow-500/10 text-yellow-400" : "bg-loss/10 text-loss"
                    )}>
                      {ch.passRate}% pass
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                      <Flame className="w-3 h-3" />{ch.daysActive}d
                    </span>
                  </div>
                  {ch.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{ch.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(ch.id)}
                  disabled={deletingId === ch.id}
                  className="text-muted-foreground hover:text-loss transition-colors shrink-0 mt-0.5 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Regras */}
              <div className="divide-y divide-border">
                {ch.results.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-3">
                    {r.passed
                      ? <CheckCircle2 className="w-4 h-4 text-profit shrink-0 mt-0.5" />
                      : <XCircle className="w-4 h-4 text-loss shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{r.rule.label}</p>
                      <p className={cn("text-[10px] mt-0.5", r.passed ? "text-muted-foreground" : "text-loss/80")}>
                        {r.detail}
                      </p>
                    </div>
                    {r.offenses > 0 && (
                      <span className="shrink-0 text-[10px] font-mono font-bold text-loss bg-loss/10 px-1.5 py-0.5 rounded">
                        {r.offenses}x
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className={cn(
                "px-5 py-2.5 flex items-center justify-between",
                ch.passRate === 100 ? "bg-profit/5" : ch.passRate >= 60 ? "bg-yellow-500/5" : "bg-loss/5"
              )}>
                <span className="text-[10px] text-muted-foreground">
                  {ch.results.filter(r => r.passed).length}/{ch.results.length} regras cumpridas
                </span>
                <span className={cn(
                  "text-[10px] font-semibold",
                  ch.passRate === 100 ? "text-profit" : ch.passRate >= 60 ? "text-yellow-400" : "text-loss"
                )}>
                  {ch.passRate === 100 ? "Desafio cumprido!" : ch.passRate >= 60 ? "Quase lá..." : "Precisa melhorar"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <CreateChallengeModal onClose={() => { setShowModal(false); router.refresh() }} />}
    </div>
  )
}
