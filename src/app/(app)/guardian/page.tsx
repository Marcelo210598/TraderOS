import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { Shield } from "lucide-react"

export const metadata: Metadata = { title: "Guardian" }

export default async function GuardianPage() {
  const session = await auth()
  const user = session?.user
  const plan = (user as { plan?: string })?.plan ?? "FREE"

  if (plan === "FREE") {
    redirect("/planos")
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Guardian"
        subtitle="Calculadora de regras Apex Trader Funding"
        userName={user?.name}
        userEmail={user?.email}
        userImage={user?.image}
        userPlan={plan}
      />
      <div className="flex-1 p-6 flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-teal/10 flex items-center justify-center">
          <Shield className="w-7 h-7 text-teal" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Guardian em construção</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Calculadora de trailing drawdown, consistency rule e scaling plan da Apex chegam em breve.
          </p>
        </div>
      </div>
    </div>
  )
}
