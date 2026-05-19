import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { ApexCalculator } from "@/components/guardian/apex-calculator"
import { Shield } from "lucide-react"

export const metadata: Metadata = { title: "Guardian" }

export default async function GuardianPage() {
  const session = await auth()
  const user = session!.user
  const plan = user.plan ?? "FREE"

  if (plan === "FREE") {
    redirect("/planos")
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Guardian"
        subtitle="Calculadora de regras Apex Trader Funding"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={plan}
      />

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-teal/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-teal" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Apex Trader Funding</h2>
            <p className="text-xs text-muted-foreground">Selecione sua conta e calcule seus limites</p>
          </div>
        </div>

        <ApexCalculator />
      </div>
    </div>
  )
}
