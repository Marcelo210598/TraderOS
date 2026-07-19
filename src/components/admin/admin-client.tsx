"use client"

import { useState, useEffect, useRef } from "react"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { formatDateBR } from "@/lib/date"
import {
  Search,
  Loader2,
  Check,
  ShieldCheck,
  Ban,
  User as UserIcon,
  CalendarDays,
  Activity,
  Clock,
  KeyRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminUserDTO, Plan } from "@/lib/admin"

const PLAN_META: Record<Plan, { label: string; className: string }> = {
  FREE: { label: "Free", className: "bg-muted text-muted-foreground border-border" },
  TRADER: { label: "Starter", className: "bg-teal/10 text-teal border-teal/30" },
  PRO: { label: "Pro", className: "bg-primary/15 text-primary border-primary/30" },
}

export function AdminClient({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUserDTO[]
  currentUserId: string
}) {
  const [users, setUsers] = useState<AdminUserDTO[]>(initialUsers)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; msg: string } | null>(null)
  const reqId = useRef(0)

  // Busca com debounce — ignora respostas fora de ordem via reqId.
  useEffect(() => {
    const id = ++reqId.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        if (id === reqId.current && res.ok) setUsers(data.users)
      } finally {
        if (id === reqId.current) setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  async function setPlan(user: AdminUserDTO, plan: Plan) {
    if (user.plan === plan || savingId) return
    setSavingId(user.id)
    setFeedback(null)
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, plan }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFeedback({ id: user.id, ok: false, msg: data.error ?? "Erro ao salvar" })
        return
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, plan } : u)))
      setFeedback({
        id: user.id,
        ok: true,
        msg: plan === "FREE" ? "Acesso bloqueado (Free)" : `Liberado: ${PLAN_META[plan].label}`,
      })
    } catch {
      setFeedback({ id: user.id, ok: false, msg: "Falha de conexão" })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por email ou nome..."
          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal/50"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      <p className="text-xs text-muted-foreground px-1">
        {users.length} usuário{users.length !== 1 ? "s" : ""}
        {query.trim() ? ` para "${query.trim()}"` : " (mais recentes)"} · liberar Pro = acesso total
        da comunidade
      </p>

      {/* Lista */}
      <div className="space-y-3">
        {users.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-10">
            Nenhum usuário encontrado.
          </div>
        )}

        {users.map((u) => {
          const isSelf = u.id === currentUserId
          const meta = PLAN_META[u.plan]
          const cadastro = formatDateBR(u.createdAt)
          const atividade = u.lastTradeAt
            ? formatDistanceToNow(new Date(u.lastTradeAt), { addSuffix: true, locale: ptBR })
            : "sem trades"

          return (
            <div key={u.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
              {/* Identidade */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {u.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground break-words">
                      {u.name || "Sem nome"}
                    </p>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-md border font-mono shrink-0",
                        meta.className
                      )}
                    >
                      {meta.label}
                    </span>
                    {u.role === "ADMIN" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-secondary/30 bg-secondary/10 text-secondary font-mono shrink-0">
                        admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground break-all">{u.email}</p>
                </div>
              </div>

              {/* Infos detalhadas */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground border-t border-border/60 pt-3">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                  Cadastro: <span className="text-foreground/80 font-medium">{cadastro}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-foreground/80 font-medium">{u.tradesCount}</span> trades
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  Ativo: <span className="text-foreground/80 font-medium">{atividade}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 shrink-0" />
                  {u.loginMethods.length ? u.loginMethods.join(" + ") : "—"}
                </span>
              </div>

              {/* Feedback */}
              {feedback?.id === u.id && (
                <p className={cn("text-[11px]", feedback.ok ? "text-profit" : "text-loss")}>
                  {feedback.msg}
                </p>
              )}

              {/* Ações — cheias no mobile, compactas no desktop */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setPlan(u, "PRO")}
                  disabled={savingId === u.id || u.plan === "PRO"}
                  className={cn(
                    "flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-default",
                    u.plan === "PRO"
                      ? "bg-primary/10 text-primary cursor-default"
                      : "bg-teal text-white hover:bg-teal/90"
                  )}
                >
                  {savingId === u.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : u.plan === "PRO" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  {u.plan === "PRO" ? "Liberado" : "Liberar Pro"}
                </button>

                <button
                  onClick={() => setPlan(u, "FREE")}
                  disabled={savingId === u.id || u.plan === "FREE" || isSelf}
                  title={isSelf ? "Você não pode bloquear a si mesmo" : "Bloquear (volta pra Free)"}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-loss hover:border-loss/40 transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:text-muted-foreground disabled:hover:border-border"
                >
                  <Ban className="w-4 h-4" />
                  Bloquear
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 px-1 pt-2">
        ⏱️ Após mudar o plano, o usuário vê a alteração ao fazer logout/login (ou em até 1h
        automaticamente).
      </p>
    </div>
  )
}
