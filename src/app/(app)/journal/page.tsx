import type { Metadata } from "next"
import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { TradeFilters } from "@/components/journal/trade-filters"
import { TradeList } from "@/components/journal/trade-list"
import { Plus, BookOpen, Upload } from "lucide-react"
import type { PaginatedTrades } from "@/lib/types"

export const metadata: Metadata = { title: "Journal" }

interface Props {
  searchParams: Promise<Record<string, string>>
}

export default async function JournalPage({ searchParams }: Props) {
  const session = await auth()
  const user = session!.user
  const sp = await searchParams

  const page = Math.max(1, Number(sp.page ?? 1))
  const limit = 20
  const where = {
    userId: user.id,
    ...(sp.result && { result: sp.result as "WIN" | "LOSS" | "BREAKEVEN" }),
    ...(sp.instrument && { instrument: sp.instrument }),
    ...(sp.setupId && { setupId: sp.setupId }),
    ...((sp.from || sp.to) ? {
      date: {
        ...(sp.from && { gte: new Date(sp.from) }),
        ...(sp.to && { lte: new Date(sp.to + "T23:59:59") }),
      }
    } : {}),
  }

  const [tradesRaw, total, setups] = await Promise.all([
    prisma.trade.findMany({
      where,
      include: {
        tags: true,
        setup: { select: { id: true, name: true } },
        screenshots: { select: { id: true, url: true, label: true }, take: 1 },
      },
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.trade.count({ where }),
    prisma.setup.findMany({
      where: { userId: user.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  const trades = tradesRaw.map((t) => ({
    ...t,
    date: t.date.toISOString(),
    entryPrice: Number(t.entryPrice),
    exitPrice: Number(t.exitPrice),
    pnl: Number(t.pnl),
    pnlPoints: Number(t.pnlPoints),
    commission: Number(t.commission),
    createdAt: t.createdAt.toISOString(),
    screenshots: t.screenshots.map((s) => ({ ...s, label: s.label ?? null })),
  }))

  const setupsFormatted = setups.map((s) => ({
    ...s, description: null, rules: null, tags: [], isActive: true,
    stats: { total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 },
    createdAt: new Date().toISOString(),
  }))

  const paginatedData: PaginatedTrades = {
    trades: trades as PaginatedTrades["trades"],
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }

  // Stats rápidas do mês
  const startOfMonth = new Date()
  startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)
  const monthlyTrades = await prisma.trade.findMany({
    where: { userId: user.id, date: { gte: startOfMonth } },
    select: { result: true, pnl: true },
  })
  const monthlyPnl = monthlyTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const monthlyWins = monthlyTrades.filter((t) => t.result === "WIN").length
  const monthlyWinRate = monthlyTrades.length > 0 ? Math.round((monthlyWins / monthlyTrades.length) * 100) : 0

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Journal"
        subtitle="Diário de trades"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Header + CTA */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-teal" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">Seus Trades</h2>
              <p className="text-xs text-muted-foreground">
                {total} trades registrados
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/journal/importar"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-teal/40 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Importar CSV</span>
            </a>
            <a
              href="/journal/novo"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo Trade
            </a>
          </div>
        </div>

        {/* Stats do mês */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Trades este mês", value: String(monthlyTrades.length), sub: user.plan === "FREE" ? `${monthlyTrades.length}/10 do plano Free` : undefined },
            { label: "Win rate", value: `${monthlyWinRate}%`, color: monthlyWinRate >= 50 ? "text-profit" : "text-loss" },
            { label: "P&L do mês", value: `${monthlyPnl >= 0 ? "+" : ""}$${Math.abs(monthlyPnl).toFixed(0)}`, color: monthlyPnl >= 0 ? "text-profit" : "text-loss" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-xl font-bold font-mono mt-1 ${s.color ?? "text-foreground"}`}>{s.value}</p>
              {s.sub && <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>}
            </div>
          ))}
        </div>

        {/* Alerta plano Free */}
        {user.plan === "FREE" && monthlyTrades.length >= 8 && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-yellow-400">
              ⚠️ Você usou {monthlyTrades.length}/10 trades do plano Free este mês.
            </p>
            <a href="/planos" className="text-xs text-yellow-400 underline underline-offset-2 font-medium shrink-0 ml-3">
              Fazer upgrade
            </a>
          </div>
        )}

        {/* Filtros */}
        <Suspense>
          <TradeFilters setups={setupsFormatted} />
        </Suspense>

        {/* Lista */}
        <Suspense fallback={<div className="text-sm text-muted-foreground">Carregando trades...</div>}>
          <TradeList initial={paginatedData} />
        </Suspense>
      </div>
    </div>
  )
}
