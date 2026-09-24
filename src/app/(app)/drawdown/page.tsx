import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { DrawdownClient } from "@/components/drawdown/drawdown-client"
import type { PlanKey } from "@/lib/plans"

export const metadata: Metadata = { title: "Drawdown" }

interface Props {
  searchParams: Promise<Record<string, string>>
}

export default async function DrawdownPage({ searchParams }: Props) {
  const session = await auth()
  const user = session!.user
  const sp = await searchParams
  const plan = (user.plan ?? "FREE") as PlanKey
  const tab = sp.tab === "simular" ? "simular" : "real"

  const accounts = await prisma.tradingAccount.findMany({
    where: { userId: user.id, isArchived: false },
    select: { id: true, name: true, label: true, initialBalance: true },
    orderBy: { createdAt: "asc" },
  })

  // Conta escolhida (?conta=) ou a primeira. Fora do Pro só a primeira conta é liberada.
  const allowed = plan === "PRO" ? accounts : accounts.slice(0, 1)
  const selected = allowed.find((a) => a.id === sp.conta) ?? allowed[0] ?? null

  const rows = selected
    ? await prisma.trade.findMany({
        where: { userId: user.id, accountId: selected.id },
        select: { date: true, pnl: true, mfe: true, mae: true },
        orderBy: { date: "asc" },
      })
    : []

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Drawdown"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-4 lg:p-6 max-w-5xl mx-auto w-full space-y-2">
        <p className="text-sm text-muted-foreground">
          Calculadora de drawdown: veja quanto ainda pode perder na sua conta, em cada tipo de regra de mesa.
        </p>
        <DrawdownClient
          plan={plan}
          tab={tab}
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            label: a.label,
            initialBalance: Number(a.initialBalance),
          }))}
          selectedId={selected?.id ?? null}
          trades={rows.map((t) => ({
            date: t.date.getTime(),
            pnl: Number(t.pnl),
            mfe: t.mfe === null ? null : Number(t.mfe),
            mae: t.mae === null ? null : Number(t.mae),
          }))}
        />
      </div>
    </div>
  )
}
