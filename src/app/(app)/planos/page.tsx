import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { PlanosGrid } from "./planos-client"
import type { PlanKey } from "@/lib/plans"

export const metadata: Metadata = { title: "Planos" }

export default async function PlanosPage() {
  const session = await auth()
  const user = session!.user
  const currentPlan = (user.plan ?? "FREE") as PlanKey

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Planos"
        subtitle="Escolha o plano certo para sua jornada"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={currentPlan}
      />

      <div className="flex-1 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground">Evolua sua operação</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Pague com Pix, cartão ou boleto. Cancele a qualquer momento, sem fidelidade.
            </p>
          </div>

          <PlanosGrid currentPlan={currentPlan} />

          <div className="mt-10 text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              Dúvidas? Fale com a gente:{" "}
              <a href="mailto:traderos.oficial@gmail.com" className="text-teal hover:underline">
                traderos.oficial@gmail.com
              </a>
            </p>
            <p className="text-xs text-muted-foreground">
              📲 Acompanhe novidades e dicas no Instagram:{" "}
              <a
                href="https://instagram.com/traderos.oficial"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-teal hover:underline"
              >
                @traderos.oficial
              </a>
            </p>
            <p className="text-[10px] text-muted-foreground">
              Pagamentos processados com segurança pela Asaas. Cancele quando quiser.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
