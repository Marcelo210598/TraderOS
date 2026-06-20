import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { CarteiraClient } from "@/components/carteira/carteira-client"

export const metadata: Metadata = { title: "Carteira" }

const COLORS = ["#00C2A8", "#F59E0B", "#3B82F6", "#A855F7", "#EC4899", "#10B981", "#EF4444"]

interface RawTrade {
  id: string
  date: Date
  instrument: string
  direction: string
  pnl: unknown
  result: string
  accountId: string | null
  accountLabel: string
  source: string
}

export default async function CarteiraPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const userId = session.user.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountsRaw = await (prisma as any).tradingAccount.findMany({
    where: { userId, isArchived: false },
    orderBy: { createdAt: "asc" },
  })

  const trades = (await prisma.trade.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { id: true, date: true, instrument: true, direction: true, pnl: true, result: true, accountId: true, accountLabel: true, source: true },
  })) as unknown as RawTrade[]

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // ── Agrega por conta ──────────────────────────────────────────────
  const accounts = accountsRaw.map((a: Record<string, unknown>, i: number) => {
    const accTrades = trades.filter((t) => t.accountId === a.id)
    const totalPnl = accTrades.reduce((s, t) => s + Number(t.pnl), 0)
    const monthPnl = accTrades.filter((t) => new Date(t.date) >= monthStart).reduce((s, t) => s + Number(t.pnl), 0)
    const wins = accTrades.filter((t) => t.result === "WIN").length
    const closed = accTrades.filter((t) => t.result === "WIN" || t.result === "LOSS").length
    const initial = Number(a.initialBalance ?? 0)
    const realBalance = a.balance != null ? Number(a.balance) : null
    const balance = realBalance ?? initial + totalPnl
    return {
      id: a.id as string,
      name: a.name as string,
      source: a.source as string,
      label: a.label as string,
      currency: (a.currency as string) ?? "USD",
      color: COLORS[i % COLORS.length],
      initialBalance: initial,
      hasRealBalance: realBalance != null,
      balance,
      totalPnl,
      monthPnl,
      tradeCount: accTrades.length,
      winRate: closed > 0 ? Math.round((wins / closed) * 100) : 0,
      lastTradeAt: accTrades.length > 0 ? new Date(accTrades[accTrades.length - 1].date).toISOString() : null,
    }
  })

  // ── Consolidado ───────────────────────────────────────────────────
  const totalBalance = accounts.reduce((s: number, a: { balance: number }) => s + a.balance, 0)
  const totalPnl = accounts.reduce((s: number, a: { totalPnl: number }) => s + a.totalPnl, 0)
  const monthPnl = accounts.reduce((s: number, a: { monthPnl: number }) => s + a.monthPnl, 0)
  const totalInitial = accounts.reduce((s: number, a: { initialBalance: number }) => s + a.initialBalance, 0)
  const balanceMonthAgo = totalBalance - monthPnl
  const monthPct = balanceMonthAgo !== 0 ? (monthPnl / Math.abs(balanceMonthAgo)) * 100 : 0

  // ── Equity curve (consolidada + por conta) ────────────────────────
  // série = pontos {t, v}; v é o saldo acumulado (initial + PnL corrido)
  function buildSeries(initial: number, accTrades: RawTrade[]) {
    let running = initial
    const pts: { t: number; v: number }[] = [{ t: accTrades[0] ? new Date(accTrades[0].date).getTime() - 1 : now.getTime(), v: round2(running) }]
    for (const t of accTrades) {
      running += Number(t.pnl)
      pts.push({ t: new Date(t.date).getTime(), v: round2(running) })
    }
    return pts
  }
  const consolidatedSeries = buildSeries(totalInitial, trades)
  const accountSeries = accounts.map((a: { id: string; name: string; color: string; initialBalance: number }) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    points: buildSeries(a.initialBalance, trades.filter((t) => t.accountId === a.id)),
  }))

  // ── Histórico (últimos 60 trades, mais recentes primeiro) ─────────
  const accNameById = new Map<string, { name: string; color: string }>(
    accounts.map((a: { id: string; name: string; color: string }) => [a.id, { name: a.name, color: a.color }])
  )
  const history = trades
    .slice()
    .reverse()
    .slice(0, 60)
    .map((t) => ({
      id: t.id,
      date: new Date(t.date).toISOString(),
      instrument: t.instrument,
      direction: t.direction,
      pnl: Number(t.pnl),
      result: t.result,
      accountId: t.accountId,
      accountName: (t.accountId && accNameById.get(t.accountId)?.name) || t.accountLabel,
      accountColor: (t.accountId && accNameById.get(t.accountId)?.color) || "#64748B",
    }))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Carteira"
        subtitle="Saldos e evolução de todas as suas contas"
        userName={session.user.name}
        userEmail={session.user.email}
        userImage={session.user.image}
        userPlan={(session.user as { plan?: string }).plan ?? "FREE"}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <CarteiraClient
            consolidated={{ totalBalance: round2(totalBalance), totalPnl: round2(totalPnl), monthPnl: round2(monthPnl), monthPct: round2(monthPct), accountsCount: accounts.length, tradesCount: trades.length }}
            accounts={accounts}
            consolidatedSeries={consolidatedSeries}
            accountSeries={accountSeries}
            history={history}
          />
        </div>
      </div>
    </div>
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
