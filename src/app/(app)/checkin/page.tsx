import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { CheckInForm } from "@/components/checkin/checkin-form"
import { format, startOfDay, endOfDay } from "date-fns"
import { ptBR } from "date-fns/locale"

export const metadata: Metadata = { title: "Check-in" }

export default async function CheckInPage() {
  const session = await auth()
  const user = session!.user
  const today = new Date()

  // Ver se já fez check-in hoje
  const todayCheckIns = await prisma.checkIn.findMany({
    where: {
      userId: user.id,
      sessionDate: { gte: startOfDay(today), lte: endOfDay(today) },
    },
    orderBy: { createdAt: "asc" },
  })

  const hasPre = todayCheckIns.some((c: { type: string }) => c.type === "PRE")
  const hasPost = todayCheckIns.some((c: { type: string }) => c.type === "POST")
  const nextType: "PRE" | "POST" = hasPre ? "POST" : "PRE"

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Check-in"
        subtitle={`${format(today, "EEEE, dd 'de' MMMM", { locale: ptBR })}`}
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 max-w-xl mx-auto w-full space-y-5">
        {/* Status do dia */}
        <div className="grid grid-cols-2 gap-3">
          <div className={`bg-card border rounded-xl p-3 flex items-center gap-2 ${hasPre ? "border-profit/30" : "border-border"}`}>
            <span className="text-lg">{hasPre ? "✅" : "⏳"}</span>
            <div>
              <p className="text-xs font-medium text-foreground">Pré-sessão</p>
              <p className="text-xs text-muted-foreground">{hasPre ? "Feito" : "Pendente"}</p>
            </div>
          </div>
          <div className={`bg-card border rounded-xl p-3 flex items-center gap-2 ${hasPost ? "border-profit/30" : "border-border"}`}>
            <span className="text-lg">{hasPost ? "✅" : "⏳"}</span>
            <div>
              <p className="text-xs font-medium text-foreground">Pós-sessão</p>
              <p className="text-xs text-muted-foreground">{hasPost ? "Feito" : "Pendente"}</p>
            </div>
          </div>
        </div>

        {/* Formulário ou conclusão */}
        {hasPre && hasPost ? (
          <div className="bg-card border border-profit/30 rounded-xl p-6 text-center space-y-3">
            <span className="text-4xl">🎯</span>
            <h2 className="text-lg font-semibold text-foreground">Check-ins do dia concluídos!</h2>
            <p className="text-sm text-muted-foreground">
              Você completou pré e pós-sessão hoje. Continue assim!
            </p>
            <a href="/dashboard" className="inline-flex items-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              Voltar ao Dashboard
            </a>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-foreground">
                Check-in {nextType === "PRE" ? "Pré-sessão" : "Pós-sessão"}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {nextType === "PRE"
                  ? "Avalie seu estado antes de abrir a plataforma"
                  : "Como foi sua sessão de trading hoje?"}
              </p>
            </div>
            <CheckInForm type={nextType} />
          </div>
        )}

        {/* Check-ins do dia */}
        {todayCheckIns.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Registros de hoje</h3>
            {todayCheckIns.map((c: (typeof todayCheckIns)[number]) => {
              const avg = Math.round((c.emotional + c.energy + c.focus + c.confidence + c.stress) / 5)
              return (
                <div key={c.id} className="flex items-center justify-between py-2 border-t border-border first:border-0 first:pt-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {c.type === "PRE" ? "Pré-sessão" : "Pós-sessão"}
                    </p>
                    {c.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.notes}</p>}
                  </div>
                  <div className={`text-lg font-bold font-mono ${avg >= 7 ? "text-profit" : avg >= 5 ? "text-yellow-400" : "text-loss"}`}>
                    {avg}/10
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
