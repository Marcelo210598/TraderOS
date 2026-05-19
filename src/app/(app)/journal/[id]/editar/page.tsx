import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { TradeForm } from "@/components/journal/trade-form"

export const metadata: Metadata = { title: "Editar Trade" }

export default async function EditarTradePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const user = session!.user
  const { id } = await params

  const [trade, setups] = await Promise.all([
    prisma.trade.findFirst({
      where: { id, userId: user.id },
      include: { tags: true, setup: { select: { id: true, name: true } } },
    }),
    prisma.setup.findMany({
      where: { userId: user.id, isActive: true },
      select: { id: true, name: true, description: true, rules: true, tags: true, isActive: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
  ])

  if (!trade) notFound()

  const tradeFormatted = {
    ...trade,
    date: trade.date.toISOString(),
    entryPrice: Number(trade.entryPrice),
    exitPrice: Number(trade.exitPrice),
    pnl: Number(trade.pnl),
    pnlPoints: Number(trade.pnlPoints),
    commission: Number(trade.commission),
    createdAt: trade.createdAt.toISOString(),
    screenshots: [],
    aiAnalysis: trade.aiAnalysis ?? null,
  }

  const setupsFormatted = setups.map((s) => ({
    ...s,
    description: s.description ?? null,
    rules: s.rules ?? null,
    stats: { total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 },
    createdAt: s.createdAt.toISOString(),
  }))

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Editar Trade"
        subtitle={`${trade.instrument} · ${trade.direction}`}
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <div className="bg-card border border-border rounded-xl p-6">
          <TradeForm setups={setupsFormatted} initial={tradeFormatted} />
        </div>
      </div>
    </div>
  )
}
