"use client"

import { useState } from "react"
import { SetupCard } from "./setup-card"
import { SetupModal } from "./setup-modal"
import { Plus, BarChart3 } from "lucide-react"
import type { Setup } from "@/lib/types"

interface SetupsClientProps {
  initialSetups: Setup[]
}

export function SetupsClient({ initialSetups }: SetupsClientProps) {
  const [setups, setSetups] = useState(initialSetups)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Setup | null>(null)

  function handleEdit(setup: Setup) {
    setEditing(setup)
    setModalOpen(true)
  }

  function handleNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function handleSaved(saved: Setup) {
    setSetups((prev) => {
      const exists = prev.find((s) => s.id === saved.id)
      if (exists) return prev.map((s) => (s.id === saved.id ? { ...s, ...saved } : s))
      return [{ ...saved, stats: { total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 } }, ...prev]
    })
  }

  function handleDeleted(id: string) {
    setSetups((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-teal" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Biblioteca de Setups</h2>
            <p className="text-xs text-muted-foreground">{setups.length} setup{setups.length !== 1 ? "s" : ""} cadastrado{setups.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Setup
        </button>
      </div>

      {setups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhum setup cadastrado</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Crie seu primeiro setup para começar a rastrear a performance de cada estratégia.
          </p>
          <button
            onClick={handleNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors mt-2"
          >
            <Plus className="w-4 h-4" />
            Criar primeiro setup
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {setups.map((setup) => (
            <SetupCard key={setup.id} setup={setup} onEdit={handleEdit} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      <SetupModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />
    </>
  )
}
