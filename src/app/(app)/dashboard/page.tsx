import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { StatsCard } from "@/components/dashboard/stats-card"
import { RecentTrades } from "@/components/dashboard/recent-trades"
import { PerformanceChart } from "@/components/dashboard/performance-chart"
import { StreakWidget } from "@/components/dashboard/streak-widget"
import { DollarSign, TrendingUp, Target, Activity, BookOpen, Plus } from "lucide-react"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const session = await auth()
  const user = session?.user

  const firstName = user?.name?.split(" ")[0] ?? "Trader"
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Dashboard"
        subtitle={`${greeting}, ${firstName}`}
        userName={user?.name}
        userEmail={user?.email}
        userImage={user?.image}
        userPlan={user?.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Boas-vindas + CTA */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {greeting}, {firstName} 👋
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Resumo da sua operação — semana de 12 a 18 de maio
            </p>
          </div>
          <a
            href="/journal/novo"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Registrar Trade
          </a>
        </div>

        {/* Métricas principais */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatsCard
            title="P&L da Semana"
            value="$1.474"
            change={18.3}
            icon={DollarSign}
            variant="profit"
          />
          <StatsCard
            title="Win Rate"
            value="62"
            suffix="%"
            change={4.2}
            icon={Target}
            variant="default"
          />
          <StatsCard
            title="Trades"
            value="19"
            change={-5.0}
            changeLabel="vs semana passada"
            icon={Activity}
            variant="neutral"
          />
          <StatsCard
            title="Profit Factor"
            value="1.87"
            change={12.1}
            icon={TrendingUp}
            variant="default"
          />
        </div>

        {/* Check-in rápido */}
        <div className="bg-teal/5 border border-teal/20 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal/15 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-teal" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Check-in de hoje ainda não feito
              </p>
              <p className="text-xs text-muted-foreground">
                Avalie seu estado emocional antes de operar
              </p>
            </div>
          </div>
          <a
            href="/checkin"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-teal/30 text-teal text-xs font-medium hover:bg-teal/10 transition-colors shrink-0"
          >
            Fazer check-in
          </a>
        </div>

        {/* Grid principal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <PerformanceChart />
          </div>
          <div>
            <StreakWidget />
          </div>
        </div>

        {/* Trades recentes */}
        <RecentTrades />

        {/* Dica do dia */}
        <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-secondary text-sm">💡</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">
              Dica do dia
            </p>
            <p className="text-sm text-foreground">
              A Apex exige que nenhum dia individual represente mais de{" "}
              <span className="text-teal font-medium">30% do seu lucro total</span> para aprovação
              (Consistency Rule). Monitore isso no{" "}
              <a href="/guardian" className="text-teal underline underline-offset-2">
                Guardian
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
