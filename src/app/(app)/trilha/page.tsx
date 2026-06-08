import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { TrilhaOverview } from "@/components/trilha/trilha-overview"

export const metadata: Metadata = { title: "Trilha" }

export default async function TrilhaPage() {
  const session = await auth()
  const user = session!.user

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Trilha de Aprendizado"
        subtitle="Evolua do básico ao avançado no seu ritmo"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <TrilhaOverview />
      </div>
    </div>
  )
}
