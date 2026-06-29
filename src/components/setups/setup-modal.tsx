"use client"

import { useState, useEffect } from "react"
import { Loader2, X } from "lucide-react"
import type { Setup } from "@/lib/types"
import { openUpgradeModal } from "@/lib/upgrade"

interface SetupModalProps {
  open: boolean
  initial?: Setup | null
  onClose: () => void
  onSaved: (setup: Setup) => void
}

export function SetupModal({ open, initial, onClose, onSaved }: SetupModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({ name: "", description: "", rules: "", tags: "" })

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name,
        description: initial.description ?? "",
        rules: initial.rules ?? "",
        tags: initial.tags.join(", "),
      })
    } else {
      setForm({ name: "", description: "", rules: "", tags: "" })
    }
    setError("")
  }, [initial, open])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const payload = {
      name: form.name,
      description: form.description || null,
      rules: form.rules || null,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    }

    const url = initial ? `/api/setups/${initial.id}` : "/api/setups"
    const method = initial ? "PATCH" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const d = await res.json()
      // Limite de plano atingido → abre modal de upgrade
      if (res.status === 403) {
        openUpgradeModal({
          reason: d.error?.toString(),
          suggestedPlan: d.suggestedPlan ?? "PRO",
        })
        onClose()
        setLoading(false)
        return
      }
      setError(d.error?.toString() ?? "Erro ao salvar setup")
      setLoading(false)
      return
    }

    const saved = await res.json()
    onSaved(saved)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {initial ? "Editar Setup" : "Novo Setup"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome *</label>
            <input
              type="text"
              placeholder="ICT Order Block, VWAP Bounce..."
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              maxLength={80}
              className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Descrição</label>
            <input
              type="text"
              placeholder="Breve descrição do setup"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Regras de entrada</label>
            <textarea
              rows={4}
              placeholder="1. Identificar OB no H1&#10;2. Aguardar retorno ao nível&#10;3. Confirmar FVG no M5..."
              value={form.rules}
              onChange={(e) => setForm((f) => ({ ...f, rules: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tags (separadas por vírgula)</label>
            <input
              type="text"
              placeholder="ICT, M5, scalping, OB..."
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          </div>

          {error && <p className="text-sm text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Salvar" : "Criar setup"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
