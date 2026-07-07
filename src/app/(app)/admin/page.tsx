import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { BarChart3 } from "lucide-react"
import { auth } from "@/auth"
import { fetchAdminUsers } from "@/lib/admin"
import { Header } from "@/components/layout/header"
import { AdminClient } from "@/components/admin/admin-client"

export const metadata: Metadata = { title: "Admin" }

export default async function AdminPage() {
  const session = await auth()

  // Guard duplo: além da API, a própria página só abre pra ADMIN.
  if (!session?.user) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/dashboard")

  // Lista inicial: usuários mais recentes (a busca refina via API).
  const initialUsers = await fetchAdminUsers("")

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Admin"
        subtitle="Liberar e bloquear acesso de usuários"
        userName={session.user.name}
        userEmail={session.user.email}
        userImage={session.user.image}
        userPlan={session.user.plan as string}
      />

      <div className="flex-1 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/admin/uso"
            className="mb-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-teal/30 bg-teal/5 text-sm font-medium text-teal hover:bg-teal/10 transition-colors"
          >
            <BarChart3 className="w-4 h-4" /> Painel de uso do app
          </Link>
          <AdminClient initialUsers={initialUsers} currentUserId={session.user.id} />
        </div>
      </div>
    </div>
  )
}
