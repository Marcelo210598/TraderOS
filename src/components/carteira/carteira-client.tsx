"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Wallet, TrendingUp, TrendingDown, ArrowRight, ArrowUpRight, ArrowDownLeft, Pencil, Check, X, Loader2, Archive, RotateCcw } from "lucide-react"

interface Account {
  id: string
  name: string
  source: string
  label: string
  currency: string
  color: string
  initialBalance: number
  hasRealBalance: boolean
  balance: number
  totalPnl: number
  monthPnl: number
  tradeCount: number
  winRate: number
  lastTradeAt: string | null
}
interface Pt { t: number; v: number }
interface Series { id: string; name: string; color: string; points: Pt[] }
interface HistItem {
  kind: "TRADE" | "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT"
  id: string; date: string; instrument: string; direction: string
  amount: number; accountId: string | null; accountName: string; accountColor: string
}

const TXN_LABEL: Record<string, string> = { DEPOSIT: "Depósito", WITHDRAWAL: "Saque", ADJUSTMENT: "Ajuste" }
interface ArchivedAccount { id: string; name: string; source: string; tradeCount: number }
interface Props {
  consolidated: { totalBalance: number; totalPnl: number; monthPnl: number; monthPct: number; accountsCount: number; tradesCount: number }
  accounts: Account[]
  consolidatedSeries: Pt[]
  accountSeries: Series[]
  history: HistItem[]
  archived: ArchivedAccount[]
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  MT5: { label: "MT5", cls: "bg-blue-500/15 text-blue-400" },
  NINJATRADER: { label: "NT8", cls: "bg-amber-500/15 text-amber-400" },
  MANUAL: { label: "Manual", cls: "bg-muted text-muted-foreground" },
}

function money(n: number, currency = "USD") {
  const sym = currency === "USD" ? "$" : currency === "BRL" ? "R$" : ""
  const s = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? "−" : ""}${sym}${s}`
}

export function CarteiraClient({ consolidated, accounts, consolidatedSeries, accountSeries, history, archived }: Props) {
  const [view, setView] = useState<"consolidated" | "accounts">("consolidated")
  const [filter, setFilter] = useState<string>("all")

  const monthUp = consolidated.monthPnl >= 0
  const filteredHistory = filter === "all" ? history : history.filter((h) => h.accountId === filter)

  return (
    <div className="space-y-6">

      {/* ── Card consolidado + equity curve ── */}
      <section className="bg-card border border-border rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal/[0.04] to-transparent pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-teal" />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Saldo consolidado</span>
            </div>
            <p className="text-3xl font-bold font-mono text-foreground">{money(consolidated.totalBalance)}</p>
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              <span className={cn("flex items-center gap-1 font-medium", monthUp ? "text-profit" : "text-loss")}>
                {monthUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {money(consolidated.monthPnl)} ({monthUp ? "+" : ""}{consolidated.monthPct.toFixed(1)}%) no mês
              </span>
              <span className="text-muted-foreground">{consolidated.accountsCount} conta{consolidated.accountsCount !== 1 ? "s" : ""} · {consolidated.tradesCount} trades</span>
            </div>
          </div>
          {/* toggle de visão */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5">
            <button onClick={() => setView("consolidated")}
              className={cn("text-xs px-3 py-1.5 rounded-md font-medium transition-colors", view === "consolidated" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Consolidado
            </button>
            <button onClick={() => setView("accounts")}
              className={cn("text-xs px-3 py-1.5 rounded-md font-medium transition-colors", view === "accounts" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Por conta
            </button>
          </div>
        </div>

        <EquityCurve
          series={view === "consolidated" ? [{ id: "c", name: "Consolidado", color: "#00C2A8", points: consolidatedSeries }] : accountSeries}
          area={view === "consolidated"}
        />

        {view === "accounts" && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            {accountSeries.map((s) => (
              <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── Saldos por conta + distribuição ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Saldos por conta</h2>
          {accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Nenhuma conta ainda. Conecte o MT5 ou o NinjaTrader e os trades aparecem aqui.</p>
          ) : accounts.map((a) => <AccountCard key={a.id} a={a} />)}
        </div>

        {/* Distribuição (donut) */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Distribuição</h2>
          <DonutDistribution accounts={accounts} />
        </div>
      </section>

      {/* ── Histórico de transações ── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="text-sm font-semibold text-foreground">Histórico de transações</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-foreground outline-none">
            <option value="all">Todas as contas</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {filteredHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">Sem transações nessa visão.</p>
        ) : (
          <div className="divide-y divide-border">
            {filteredHistory.map((h) => {
              const up = h.amount >= 0
              const isTrade = h.kind === "TRADE"
              return (
                <div key={h.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: h.accountColor }} />
                  <div className="flex-1 min-w-0">
                    {isTrade ? (
                      <p className="text-sm text-foreground truncate">
                        <span className="font-medium">{h.instrument}</span>{" "}
                        <span className={cn("text-[10px] font-bold px-1 py-0.5 rounded", h.direction === "LONG" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>{h.direction}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-foreground truncate flex items-center gap-1.5">
                        {h.kind === "WITHDRAWAL" ? <ArrowUpRight className="w-3.5 h-3.5 text-loss" /> : <ArrowDownLeft className="w-3.5 h-3.5 text-profit" />}
                        <span className="font-medium">{TXN_LABEL[h.kind]}</span>
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {h.accountName} · {new Date(h.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <p className={cn("text-sm font-bold font-mono", up ? "text-profit" : "text-loss")}>
                    {up ? "+" : ""}{money(h.amount)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
        <Link href="/journal" className="flex items-center justify-center gap-1.5 text-xs text-teal hover:underline mt-3 pt-3 border-t border-border">
          Ver journal completo <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </section>

      {/* ── Contas arquivadas ── */}
      {archived.length > 0 && <ArchivedSection archived={archived} />}
    </div>
  )
}

function ArchivedSection({ archived }: { archived: ArchivedAccount[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function restore(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: false }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="bg-card/50 border border-border rounded-xl p-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Archive className="w-3.5 h-3.5" />
        Contas arquivadas ({archived.length})
        <span className="ml-auto text-[10px]">{open ? "ocultar" : "ver"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {archived.map((a) => {
            const badge = SOURCE_BADGE[a.source] ?? SOURCE_BADGE.MANUAL
            return (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded font-mono", badge.cls)}>{badge.label}</span>
                <span className="text-foreground/70 flex-1 truncate">{a.name}</span>
                <span className="text-muted-foreground">{a.tradeCount} trades</span>
                <button onClick={() => restore(a.id)} disabled={busy === a.id}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border text-teal hover:bg-teal/10 transition-colors disabled:opacity-50">
                  {busy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Restaurar
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Card de conta (com edição inline de nome e saldo inicial) ────────
function AccountCard({ a }: { a: Account }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(a.name)
  const [initial, setInitial] = useState(String(a.initialBalance || ""))
  const [saving, setSaving] = useState(false)
  const up = a.totalPnl >= 0
  const badge = SOURCE_BADGE[a.source] ?? SOURCE_BADGE.MANUAL

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || a.label, initialBalance: Number(initial) || 0 }),
      })
      if (res.ok) { setEditing(false); router.refresh() }
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    setSaving(true)
    try {
      const res = await fetch(`/api/accounts/${a.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      })
      if (res.ok) router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="bg-card border border-teal/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-1 h-10 rounded-full shrink-0" style={{ background: a.color }} />
          <div className="flex-1 space-y-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Nome da conta</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full text-sm bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-foreground outline-none focus:border-teal/50" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Saldo inicial ({a.currency}) — opcional</label>
              <input value={initial} onChange={(e) => setInitial(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0"
                className="w-full text-sm font-mono bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-foreground outline-none focus:border-teal/50" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button onClick={archive} disabled={saving} title="Arquivar conta (esconde sem apagar)"
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-loss hover:border-loss/30 transition-colors disabled:opacity-50">
            <Archive className="w-3.5 h-3.5" /> Arquivar
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(false); setName(a.name); setInitial(String(a.initialBalance || "")) }}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-teal text-teal-foreground hover:bg-teal/90 transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group bg-card border border-border rounded-xl p-4 flex items-center gap-4">
      <span className="w-1 h-10 rounded-full shrink-0" style={{ background: a.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground truncate">{a.name}</p>
          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded font-mono", badge.cls)}>{badge.label}</span>
          <button onClick={() => setEditing(true)} title="Editar conta"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
            <Pencil className="w-3 h-3" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {a.tradeCount} trades · {a.winRate}% win
          {!a.hasRealBalance && <span className="text-muted-foreground/60"> · saldo estimado</span>}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold font-mono text-foreground">{money(a.balance, a.currency)}</p>
        <p className={cn("text-[11px] font-medium font-mono", up ? "text-profit" : "text-loss")}>
          {up ? "+" : ""}{money(a.totalPnl, a.currency)}
        </p>
      </div>
    </div>
  )
}

// ── Equity curve (linhas + área opcional) ────────────────────────────
function EquityCurve({ series, area }: { series: Series[]; area: boolean }) {
  const W = 800, H = 220, PAD = 8
  const { paths, areaPath, hasData } = useMemo(() => {
    const allPts = series.flatMap((s) => s.points)
    if (allPts.length < 2) return { paths: [], areaPath: "", hasData: false }
    const tMin = Math.min(...allPts.map((p) => p.t))
    const tMax = Math.max(...allPts.map((p) => p.t))
    const vMin = Math.min(...allPts.map((p) => p.v))
    const vMax = Math.max(...allPts.map((p) => p.v))
    const tSpan = tMax - tMin || 1
    const vSpan = vMax - vMin || 1
    const x = (t: number) => PAD + ((t - tMin) / tSpan) * (W - PAD * 2)
    const y = (v: number) => PAD + (1 - (v - vMin) / vSpan) * (H - PAD * 2)

    const paths = series.map((s) => {
      const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ")
      return { id: s.id, color: s.color, d }
    })
    let areaPath = ""
    if (area && series[0]) {
      const pts = series[0].points
      const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ")
      areaPath = `${line} L ${x(pts[pts.length - 1].t).toFixed(1)} ${H - PAD} L ${x(pts[0].t).toFixed(1)} ${H - PAD} Z`
    }
    return { paths, areaPath, hasData: true }
  }, [series, area])

  if (!hasData) {
    return <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">Faça alguns trades pra ver a evolução do saldo aqui 📈</div>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00C2A8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#00C2A8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && areaPath && <path d={areaPath} fill="url(#equityFill)" />}
      {paths.map((p) => (
        <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

// ── Donut de distribuição por saldo ──────────────────────────────────
function DonutDistribution({ accounts }: { accounts: Account[] }) {
  const positives = accounts.filter((a) => a.balance > 0)
  const total = positives.reduce((s, a) => s + a.balance, 0)
  if (total <= 0) {
    return <p className="text-xs text-muted-foreground text-center py-8">Sem saldo positivo pra distribuir ainda.</p>
  }
  const R = 52, C = 60, STROKE = 16, circ = 2 * Math.PI * R
  const fracs = positives.map((a) => a.balance / total)
  const segs = positives.map((a, i) => {
    const offsetFrac = fracs.slice(0, i).reduce((s, f) => s + f, 0)
    return { color: a.color, dash: fracs[i] * circ, offset: offsetFrac * circ, pct: Math.round(fracs[i] * 100), name: a.name }
  })
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
        <circle cx={C} cy={C} r={R} fill="none" stroke="currentColor" strokeWidth={STROKE} className="text-muted/30" />
        {segs.map((s, i) => (
          <circle key={i} cx={C} cy={C} r={R} fill="none" stroke={s.color} strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${circ - s.dash}`} strokeDashoffset={-s.offset} />
        ))}
      </svg>
      <div className="w-full space-y-1.5 mt-4">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-foreground/80 flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground font-mono">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
