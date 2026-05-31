import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { ApexCalculator } from "@/components/guardian/apex-calculator"
import { ChallengeStatus } from "@/components/guardian/challenge-status"
import { GuardianAccountSelector } from "@/components/guardian/account-selector"
import { MultiAccountGrid } from "@/components/guardian/multi-account-grid"
import { ACCOUNTS, type AccountKey } from "@/lib/guardian"
import { Shield, LayoutGrid, Monitor } from "lucide-react"

export const metadata: Metadata = { title: "Guardian" }

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
  const viewMode = sp.view === "multi" ? "multi" : "single"
  const accountKey = (sp.account && sp.account in ACCOUNTS ? sp.account : "PA100K") as AccountKey
  const account = ACCOUNTS[accountKey]

  // ── MODO MULTI: busca todos os trades agrupados por accountLabel ─────────
  let multiData: { key: string; days: { date: string; pnl: number }[]; totalPnl: number }[] = []

  if (viewMode === "multi") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allTradesRaw = await (prisma.trade as any).findMany({
      where: { userId: user.id },
      select: { date: true, pnl: true, accountLabel: true },
      orderBy: { date: "asc" },
    }) as { date: Date; pnl: unknown; accountLabel: string }[]

    const accountDayMaps = new Map<string, Map<string, number>>()
    for (const t of allTradesRaw) {
      const label = t.accountLabel ?? "PA"
      if (!accountDayMaps.has(label)) accountDayMaps.set(label, new Map())
      const dm = accountDayMaps.get(label)!
      const d = new Date(t.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      dm.set(key, (dm.get(key) ?? 0) + Number(t.pnl))
    }

    multiData = Object.keys(ACCOUNTS).map((k) => {
      const dm = accountDayMaps.get(k)
      const days = dm
        ? Array.from(dm.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, pnl]) => ({ date, pnl }))
        : []
      return { key: k, days, totalPnl: days.reduce((a, d) => a + d.pnl, 0) }
    })
  }

  // ── MODO SINGLE: busca trades da conta selecionada ───────────────────────
  let tradesRaw: { date: Date; pnl: unknown }[] = []
  let days: { date: string; pnl: number }[] = []
  let totalPnl = 0

  if (viewMode === "single") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tradesRaw = await (prisma.trade as any).findMany({
      where: { userId: user.id, accountLabel: accountKey },
      select: { date: true, pnl: true },
      orderBy: { date: "asc" },
    }) as { date: Date; pnl: unknown }[]

    const dayMap = new Map<string, number>()
    for (const t of tradesRaw) {
      const d = new Date(t.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      dayMap.set(key, (dayMap.get(key) ?? 0) + Number(t.pnl))
    }
    days = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl }))
    totalPnl = days.reduce((a, d) => a + d.pnl, 0)
  }

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

        {/* Toggle de view */}
        <div className="flex items-center gap-2">
          <a
            href="/guardian"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              viewMode === "single"
                ? "bg-teal/10 border-teal/40 text-teal"
                : "border-border text-muted-foreground hover:border-teal/30 hover:text-foreground"
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Conta única
          </a>
          <a
            href="/guardian?view=multi"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              viewMode === "multi"
                ? "bg-teal/10 border-teal/40 text-teal"
                : "border-border text-muted-foreground hover:border-teal/30 hover:text-foreground"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Todas as contas
          </a>
        </div>

        {/* ── MODO MULTI ── */}
        {viewMode === "multi" && (
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal/10 flex items-center justify-center shrink-0">
                <LayoutGrid className="w-5 h-5 text-teal" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Visão geral — todas as contas</h2>
                <p className="text-xs text-muted-foreground">
                  Clique em qualquer card para ver os detalhes completos
                </p>
              </div>
            </div>
            <MultiAccountGrid accounts={multiData} />
          </section>
        )}

        {/* ── MODO SINGLE ── */}
        {viewMode === "single" && (
          <>
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal/10 flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-teal" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Meu Challenge</h2>
                  <p className="text-xs text-muted-foreground">
                    {tradesRaw.length} trades da conta <span className="text-teal">{account.label}</span> no Journal
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
          </>
        )}
      </div>
    </div>
  )
}
