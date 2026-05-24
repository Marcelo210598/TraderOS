import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { TradeForm } from "@/components/journal/trade-form"

export const metadata: Metadata = { title: "Novo Trade" }

export default async function NovoTradePage() {
  const session = await auth()
  const user = session!.user

  const setups = await prisma.setup.findMany({
    where: { userId: user.id, isActive: true },
    select: { id: true, name: true, description: true, rules: true, tags: true, isActive: true, createdAt: true },
    orderBy: { name: "asc" },
  })

  const setupsFormatted = setups.map((s) => ({
    ...s,
    description: s.description ?? null,
    rules: s.rules ?? null,
    stats: { total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, profitFactor: 0, avgWin: 0, avgLoss: 0 },
    createdAt: s.createdAt.toISOString(),
  }))

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Novo Trade"
        subtitle="Registre sua operação"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <div className="bg-card border border-border rounded-xl p-6">
          <TradeForm setups={setupsFormatted} />
        </div>
      </div>
    </div>
  )
}
