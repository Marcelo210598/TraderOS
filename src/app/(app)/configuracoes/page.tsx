import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { ProfileForm, PasswordForm } from "@/components/settings/settings-forms"
import { IntegrationSection } from "@/components/settings/integration-section"
import { PushNotifications } from "@/components/settings/push-notifications"
import Link from "next/link"
import { Shield, User, CreditCard, Link2, Bell } from "lucide-react"

const PLAN_LABELS: Record<string, { label: string; color: string; description: string }> = {
  FREE:   { label: "Free",   color: "text-muted-foreground", description: "Acesso básico ao Journal e Dashboard" },
  TRADER: { label: "Trader", color: "text-teal",             description: "Setups, Guardian e análise avançada" },
  PRO:    { label: "Pro",    color: "text-secondary",        description: "Tudo incluído + Ask Claude (IA)" },
}

export default async function ConfiguracoesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const [user, apiKeys] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, password: true, plan: true, createdAt: true },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).userApiKey.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, key: true, lastUsed: true, createdAt: true },
    }),
  ])

  if (!user) redirect("/login")

  const plan = PLAN_LABELS[user.plan] ?? PLAN_LABELS.FREE

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Configurações"
        subtitle="Gerencie seu perfil e conta"
        userName={session.user.name}
        userEmail={session.user.email}
        userImage={session.user.image}
        userPlan={user.plan}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Perfil */}
          <section className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <User className="w-4 h-4 text-teal" />
              <h2 className="text-sm font-semibold text-foreground">Perfil</h2>
            </div>
            <ProfileForm userName={user.name} userEmail={user.email} />
          </section>

          {/* Senha */}
          <section className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Shield className="w-4 h-4 text-teal" />
              <h2 className="text-sm font-semibold text-foreground">Segurança</h2>
            </div>
            <PasswordForm hasPassword={!!user.password} />
          </section>

          {/* Notificações */}
          <section className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-4 h-4 text-teal" />
              <h2 className="text-sm font-semibold text-foreground">Notificações</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Receba os trades do bot (WIN/LOSS) no celular ou desktop, mesmo com o app fechado.
            </p>
            <PushNotifications />
          </section>

          {/* Integrações */}
          <section className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Link2 className="w-4 h-4 text-teal" />
              <h2 className="text-sm font-semibold text-foreground">Integrações</h2>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <span className="text-sm font-bold font-mono text-foreground">NT</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">NinjaTrader 8</p>
                <p className="text-xs text-muted-foreground">Sync automático de trades — funciona com contas Apex</p>
              </div>
            </div>
            <IntegrationSection initialKeys={apiKeys} />
          </section>

          {/* Plano */}
          <section className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <CreditCard className="w-4 h-4 text-teal" />
              <h2 className="text-sm font-semibold text-foreground">Plano atual</h2>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-lg font-bold font-mono ${plan.color}`}>{plan.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
              </div>
              <Link
                href="/planos"
                className="px-4 py-2 border border-teal text-teal rounded-lg text-sm font-medium hover:bg-teal/10 transition-colors"
              >
                Ver planos
              </Link>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Membro desde {new Date(user.createdAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
              </p>
            </div>
          </section>

          {/* Ferramentas de prop firm (Guardian aposentado — acesso discreto) */}
          <section className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Ferramentas de prop firm</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Calculadoras específicas pra contas de prop firm de futuros (ex: Apex).
            </p>
            <Link
              href="/guardian"
              className="inline-flex items-center gap-2 px-4 py-2 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:text-foreground hover:bg-muted transition-colors"
            >
              <Shield className="w-4 h-4" />
              Abrir Guardian (trailing drawdown)
            </Link>
          </section>

        </div>
      </div>
    </div>
  )
}
