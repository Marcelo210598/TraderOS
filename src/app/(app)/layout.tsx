import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Sidebar } from "@/components/layout/sidebar"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        userPlan={session.user.plan as string}
        userName={session.user.name ?? undefined}
        userImage={session.user.image ?? undefined}
        userXp={(session.user as { xp?: number }).xp ?? 0}
        userLevel={(session.user as { level?: number }).level ?? 1}
      />
      <main className="flex-1 ml-60 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  )
}
