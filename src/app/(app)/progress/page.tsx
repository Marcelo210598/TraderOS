import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { TrendingUp } from "lucide-react"

export const metadata: Metadata = { title: "Progress" }

export default async function ProgressPage() {
  const session = await auth()
  const user = session?.user

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Progress"
        subtitle="Sua evolução como trader"
        userName={user?.name}
        userEmail={user?.email}
        userImage={user?.image}
        userPlan={(user as { plan?: string })?.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center">
          <TrendingUp className="w-7 h-7 text-teal" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Progress em construção</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Gamificação, XP, conquistas e histórico longitudinal chegam em breve.
          </p>
        </div>
      </div>
    </div>
  )
}
