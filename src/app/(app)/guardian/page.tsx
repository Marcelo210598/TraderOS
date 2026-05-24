import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { ApexCalculator } from "@/components/guardian/apex-calculator"
import { ChallengeStatus } from "@/components/guardian/challenge-status"
import { GuardianAccountSelector } from "@/components/guardian/account-selector"
import { Shield } from "lucide-react"

export const metadata: Metadata = { title: "Guardian" }

const ACCOUNTS = {
  PA25K:  { label: "PA 25K",  balance: 25000,  drawdown: 1500, target: 1500,  minDays: 10, maxContracts: 5  },
  PA50K:  { label: "PA 50K",  balance: 50000,  drawdown: 2500, target: 3000,  minDays: 10, maxContracts: 10 },
  PA75K:  { label: "PA 75K",  balance: 75000,  drawdown: 2750, target: 4500,  minDays: 10, maxContracts: 12 },
  PA100K: { label: "PA 100K", balance: 100000, drawdown: 3000, target: 6000,  minDays: 10, maxContracts: 14 },
  PA150K: { label: "PA 150K", balance: 150000, drawdown: 5000, target: 9000,  minDays: 15, maxContracts: 17 },
  PA250K: { label: "PA 250K", balance: 250000, drawdown: 7500, target: 15000, minDays: 20, maxContracts: 20 },
} as const

type AccountKey = keyof typeof ACCOUNTS

interface Props {
  searchParams: Promise<Record<string, string>>
}

export default async function GuardianPage({ searchParams }: Props) {
  const session = await auth()
  const user = session!.user
  const plan = user.plan ?? "FREE"

  if (plan === "FREE") {
    redirect("/planos")
  }

  const sp = await searchParams
  const accountKey = (sp.account && sp.account in ACCOUNTS ? sp.account : "PA100K") as AccountKey
  const account = ACCOUNTS[accountKey]

  // Fetch all trades ordered by date
  const tradesRaw = await prisma.trade.findMany({
    where: { userId: user.id },
    select: { date: true, pnl: true },
    orderBy: { date: "asc" },
  })

  // Group by trading day
  const dayMap = new Map<string, number>()
  for (const t of tradesRaw) {
    const d = new Date(t.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    dayMap.set(key, (dayMap.get(key) ?? 0) + Number(t.pnl))
  }

  const days = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date, pnl }))

  const totalPnl = days.reduce((a, d) => a + d.pnl, 0)

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Guardian"
        subtitle="Monitoramento e calculadora de regras"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={plan}
      />

      <div className="flex-1 p-4 lg:p-6 max-w-3xl mx-auto w-full space-y-8">
        {/* Meu Challenge — dados reais do Journal */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal/10 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-teal" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Meu Challenge</h2>
              <p className="text-xs text-muted-foreground">
                Status baseado nos {tradesRaw.length} trades registrados no seu Journal
              </p>
            </div>
          </div>

          <GuardianAccountSelector currentAccount={accountKey} />

          <ChallengeStatus account={account} days={days} totalPnl={totalPnl} />
        </section>

        {/* Divisor */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border/40" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 bg-background text-[11px] text-muted-foreground uppercase tracking-wider">
              Calculadora manual
            </span>
          </div>
        </div>

        {/* Calculadora manual */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Calculadora Apex</h2>
            <p className="text-xs text-muted-foreground">Simule cenários manualmente sem depender do Journal</p>
          </div>
          <ApexCalculator />
        </section>
      </div>
    </div>
  )
}
