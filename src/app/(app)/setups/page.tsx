import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { SetupsClient } from "@/components/setups/setups-client"
import { Zap } from "lucide-react"

export const metadata: Metadata = { title: "Setups" }

export default async function SetupsPage() {
  const session = await auth()
  const user = session!.user

  if (user.plan === "FREE") {
    return (
      <div className="flex flex-col flex-1 overflow-auto">
        <Header
          title="Biblioteca de Setups"
          userName={user.name}
          userEmail={user.email}
          userImage={user.image}
          userPlan={user.plan ?? "FREE"}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-6">
          <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 flex items-center justify-center">
            <Zap className="w-7 h-7 text-yellow-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Recurso do plano Trader</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              A Biblioteca de Setups com estatísticas por estratégia está disponível no plano Trader (R$ 47/mês) ou Pro.
            </p>
          </div>
          <a href="/planos" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Zap className="w-4 h-4" />
            Ver planos
          </a>
        </div>
      </div>
    )
  }

  const setups = await prisma.setup.findMany({
    where: { userId: user.id, isActive: true },
    include: {
      trades: { select: { result: true, pnl: true }, take: 1000 },
    },
    orderBy: { createdAt: "desc" },
  })

  const setupsFormatted = setups.map((s) => {
    const winTrades = s.trades.filter((t) => t.result === "WIN")
    const lossTrades = s.trades.filter((t) => t.result === "LOSS")
    const total = s.trades.length
    const totalPnl = s.trades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossWins = winTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossLosses = Math.abs(lossTrades.reduce((acc, t) => acc + Number(t.pnl), 0))
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      rules: s.rules ?? null,
      tags: s.tags,
      isActive: s.isActive,
      stats: {
        total,
        wins: winTrades.length,
        losses: lossTrades.length,
        winRate: total > 0 ? Math.round((winTrades.length / total) * 100) : 0,
        totalPnl: Number(totalPnl.toFixed(2)),
        avgPnl: total > 0 ? Number((totalPnl / total).toFixed(2)) : 0,
        profitFactor: grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 999 : 0,
        avgWin: winTrades.length > 0 ? Number((grossWins / winTrades.length).toFixed(2)) : 0,
        avgLoss: lossTrades.length > 0 ? Number((grossLosses / lossTrades.length).toFixed(2)) : 0,
      },
      createdAt: s.createdAt.toISOString(),
    }
  })

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Setups"
        subtitle="Sua biblioteca de estratégias"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-6">
        <SetupsClient initialSetups={setupsFormatted} />
      </div>
    </div>
  )
}
