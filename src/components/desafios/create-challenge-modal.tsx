"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { X, Plus, Trash2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { RULE_TEMPLATES, ChallengeRule, RuleType } from "@/lib/challenges"

interface Props {
  onClose: () => void
}

export function CreateChallengeModal({ onClose }: Props) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [rules, setRules] = useState<ChallengeRule[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  function addRule(type: RuleType) {
    if (rules.length >= 7) return
    if (rules.find(r => r.type === type)) return
    const tpl = RULE_TEMPLATES.find(t => t.type === type)!
    setRules(prev => [...prev, {
      type,
      label: tpl.defaultLabel,
      value: tpl.defaultValue,
    }])
  }

  function removeRule(type: RuleType) {
    setRules(prev => prev.filter(r => r.type !== type))
  }

  function updateRuleValue(type: RuleType, value: number) {
    setRules(prev => prev.map(r => r.type === type ? { ...r, value } : r))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || rules.length === 0) return
    setLoading(true)
    setError("")

    const res = await fetch("/api/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, rules }),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? "Erro ao criar desafio")
      setLoading(false)
      return
    }

    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold text-foreground">Criar Desafio</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome do desafio</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Disciplina Total, Semana Sem Revenge..."
              maxLength={60}
              className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal/50"
            />
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Descrição <span className="normal-case">(opcional)</span></label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Meta ou motivação deste desafio..."
              maxLength={200}
              className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal/50"
            />
          </div>

          {/* Regras ativas */}
          {rules.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Regras adicionadas</label>
              {rules.map(rule => {
                const tpl = RULE_TEMPLATES.find(t => t.type === rule.type)!
                return (
                  <div key={rule.type} className="flex items-center gap-2 bg-teal/5 border border-teal/20 rounded-lg px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{tpl.defaultLabel}</p>
                      {tpl.defaultValue !== undefined && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-muted-foreground">Valor: $</span>
                          <input
                            type="number"
                            value={rule.value ?? tpl.defaultValue}
                            min={1}
                            max={99999}
                            onChange={e => updateRuleValue(rule.type as RuleType, Number(e.target.value))}
                            className="w-20 text-xs font-mono px-2 py-0.5 rounded bg-input border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-teal/50"
                          />
                          {(rule.type === "min_win_rate") && <span className="text-[10px] text-muted-foreground">%</span>}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRule(rule.type as RuleType)}
                      className="text-muted-foreground hover:text-loss transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Templates de regra */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Adicionar regra {rules.length > 0 && <span className="normal-case text-muted-foreground/60">({rules.length}/7)</span>}
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {RULE_TEMPLATES.map(tpl => {
                const alreadyAdded = rules.some(r => r.type === tpl.type)
                return (
                  <button
                    key={tpl.type}
                    type="button"
                    onClick={() => addRule(tpl.type as RuleType)}
                    disabled={alreadyAdded || rules.length >= 7}
                    className={cn(
                      "text-left px-3 py-2.5 rounded-lg border text-sm transition-all",
                      alreadyAdded
                        ? "bg-teal/5 border-teal/20 text-teal/50 cursor-default"
                        : "bg-muted/30 border-border hover:border-teal/40 hover:bg-teal/5 text-foreground"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium">{tpl.defaultLabel}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.description}</p>
                      </div>
                      {!alreadyAdded && (
                        <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <p className="text-xs text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={!name.trim() || rules.length === 0 || loading}
            className="w-full py-3 rounded-xl bg-teal text-teal-foreground font-medium text-sm hover:bg-teal/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Criando..." : "Criar Desafio"}
          </button>
        </form>
      </div>
    </div>
  )
}
