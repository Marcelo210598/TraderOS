import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { getUsageStats } from "@/lib/admin-stats"
import { Users, UserPlus, Activity, TrendingUp, ArrowLeft } from "lucide-react"

export const metadata: Metadata = { title: "Uso do app" }

export default async function AdminUsoPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/dashboard")

  const s = await getUsageStats()
  const pagos = s.plans.TRADER + s.plans.PRO
  const pctPago = s.totalUsers > 0 ? Math.round((pagos / s.totalUsers) * 100) : 0

  const cards = [
    { icon: Users, label: "Usuários totais", value: s.totalUsers, sub: `${s.admins} admin` },
    { icon: Activity, label: "Online agora", value: s.online, sub: "últimos 5 min", accent: "text-profit" },
    { icon: Activity, label: "Ativos hoje", value: s.activeToday, sub: `${s.active7d} em 7 dias` },
    { icon: UserPlus, label: "Cadastros (7d)", value: s.signups.d7, sub: `${s.signups.today} hoje · ${s.signups.d30} em 30d` },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Uso do app"
        subtitle="Como o MeuTrade está sendo usado"
        userName={session.user.name}
        userEmail={session.user.email}
        userImage={session.user.image}
        userPlan={session.user.plan as string}
      />

      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao Admin
        </Link>

        {/* Cards principais */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <c.icon className="w-4 h-4" />
                <span className="text-xs">{c.label}</span>
              </div>
              <p className={`text-2xl font-bold font-mono mt-2 ${c.accent ?? "text-foreground"}`}>{c.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Planos */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Distribuição por plano</h2>
            <span className="text-xs text-muted-foreground">{pctPago}% pagantes</span>
          </div>
          <div className="space-y-3">
            {[
              { label: "Free", value: s.plans.FREE, color: "bg-muted-foreground/40" },
              { label: "Trader", value: s.plans.TRADER, color: "bg-yellow-400" },
              { label: "Pro", value: s.plans.PRO, color: "bg-profit" },
            ].map((p) => {
              const pct = s.totalUsers > 0 ? Math.round((p.value / s.totalUsers) * 100) : 0
              return (
                <div key={p.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground font-medium">{p.label}</span>
                    <span className="text-muted-foreground font-mono">{p.value} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full ${p.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Engajamento */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-teal" />
            <h2 className="text-sm font-semibold text-foreground">Engajamento</h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xl font-bold font-mono text-foreground">{s.engagement.usersWithTrade}</p>
              <p className="text-[11px] text-muted-foreground">já registraram trade</p>
            </div>
            <div>
              <p className="text-xl font-bold font-mono text-foreground">{s.engagement.trades7d}</p>
              <p className="text-[11px] text-muted-foreground">trades em 7 dias</p>
            </div>
            <div>
              <p className="text-xl font-bold font-mono text-foreground">{s.engagement.trades30d}</p>
              <p className="text-[11px] text-muted-foreground">trades em 30 dias</p>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/70">
          Visitantes anônimos (quem entra e não cadastra) aparecem no Vercel Analytics e nos pixels de
          retargeting — aqui são só os usuários logados.
        </p>
      </div>
    </div>
  )
}
