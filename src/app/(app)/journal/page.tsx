import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { BookOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Journal" }

export default async function JournalPage() {
  const session = await auth()
  const user = session?.user

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Journal"
        subtitle="Diário de trades"
        userName={user?.name}
        userEmail={user?.email}
        userImage={user?.image}
        userPlan={(user as { plan?: string })?.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center">
          <BookOpen className="w-7 h-7 text-teal" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Journal em construção</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            O módulo de diário de trades está sendo desenvolvido. Em breve você poderá registrar,
            filtrar e analisar todas as suas operações aqui.
          </p>
        </div>
        <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90" disabled>
          <Plus className="w-4 h-4" />
          Novo Trade
        </Button>
      </div>
    </div>
  )
}
