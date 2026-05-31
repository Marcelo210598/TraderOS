import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Sidebar } from "@/components/layout/sidebar"
import { SidebarProvider } from "@/components/layout/sidebar-context"
import { BottomNav } from "@/components/layout/bottom-nav"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          userPlan={session.user.plan as string}
          userName={session.user.name ?? undefined}
          userImage={session.user.image ?? undefined}
          userXp={(session.user as { xp?: number }).xp ?? 0}
          userLevel={(session.user as { level?: number }).level ?? 1}
        />
        <main className="flex-1 lg:ml-60 flex flex-col overflow-hidden pb-16 lg:pb-0">
          {children}
        </main>
      </div>
      <BottomNav />
    </SidebarProvider>
  )
}
