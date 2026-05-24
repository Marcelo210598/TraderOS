import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { BulkLabelClient } from "@/components/journal/bulk-label-client"

export const metadata: Metadata = { title: "Gerenciar Contas" }

export default async function ContasPage() {
  const session = await auth()
  const user = session!.user

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradesRaw = await (prisma.trade as any).findMany({
    where: { userId: user.id },
    select: { id: true, date: true, instrument: true, pnl: true, accountLabel: true },
    orderBy: { date: "desc" },
    take: 500,
  }) as { id: string; date: Date; instrument: string; pnl: unknown; accountLabel: string }[]

  const trades = tradesRaw.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    instrument: t.instrument,
    pnl: Number(t.pnl),
    accountLabel: t.accountLabel ?? "PA",
  }))

  const totalCount = await prisma.trade.count({ where: { userId: user.id } })

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Gerenciar Contas"
        subtitle="Classifique seus trades por conta"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-4 lg:p-6 max-w-3xl mx-auto w-full">
        <BulkLabelClient trades={trades} totalCount={totalCount} />
      </div>
    </div>
  )
}
