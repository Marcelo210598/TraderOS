"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, CheckCircle2, XCircle, Trophy, Flame, Loader2 } from "lucide-react"
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

const PRESET_CHALLENGES = [
  {
    name: "Disciplina Total",
    description: "A base de qualquer trader consistente",
    rules: [
      { type: "max_loss_per_trade", value: 150, label: "Max loss por trade" },
      { type: "max_daily_loss", value: 300, label: "Max loss diário" },
      { type: "no_behavioral_tag", label: "Sem tags comportamentais" },
    ],
  },
  {
    name: "Controle de Volume",
    description: "Para quem opera demais nos dias ruins",
    rules: [
      { type: "max_trades_per_day", value: 4, label: "Max trades por dia" },
      { type: "max_consecutive_losses", value: 3, label: "Max losses consecutivos" },
      { type: "only_am_session", label: "Operar só AM" },
    ],
  },
  {
    name: "Consistência 50%",
    description: "Win rate mínimo + disciplina básica",
    rules: [
      { type: "min_win_rate", value: 50, label: "Win rate mínimo" },
      { type: "max_loss_per_trade", value: 200, label: "Max loss por trade" },
      { type: "no_behavioral_tag", label: "Sem tags comportamentais" },
    ],
  },
] as const

export function ChallengesClient({ challenges }: Props) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [creatingPreset, setCreatingPreset] = useState<string | null>(null)

  async function createPreset(preset: typeof PRESET_CHALLENGES[number]) {
    setCreatingPreset(preset.name)
    await fetch("/api/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preset),
    })
    router.refresh()
    setCreatingPreset(null)
  }

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
      {/* Templates de exemplo */}
      {challenges.length === 0 && (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-5 text-center space-y-1">
            <Trophy className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">Comece com um template</p>
            <p className="text-xs text-muted-foreground">Clique em um dos exemplos abaixo ou crie do zero</p>
          </div>

          <div className="grid gap-2">
            {PRESET_CHALLENGES.map(preset => (
              <div key={preset.name} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-3 hover:border-teal/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{preset.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {preset.rules.map((r, i) => (
                      <span key={i} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => createPreset(preset)}
                  disabled={creatingPreset === preset.name}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal/10 text-teal text-xs font-medium hover:bg-teal/20 transition-colors disabled:opacity-50"
                >
                  {creatingPreset === preset.name
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Plus className="w-3 h-3" />}
                  Usar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {challenges.length > 0 && (
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
