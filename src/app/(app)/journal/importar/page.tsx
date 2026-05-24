import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { ImportarClient } from "@/components/journal/importar-client"

export const metadata: Metadata = { title: "Importar Trades" }

export default async function ImportarPage() {
  const session = await auth()
  const user = session!.user

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Importar Trades"
        subtitle="Importe múltiplos trades via CSV"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-4 lg:p-6 max-w-4xl mx-auto w-full">
        <ImportarClient />
      </div>
    </div>
  )
}
