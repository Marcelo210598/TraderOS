import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { NotificacoesClient } from "@/components/notifications/notificacoes-client"

export const metadata: Metadata = { title: "Notificações" }

export default async function NotificacoesPage() {
  const session = await auth()
  const user = session!.user

  const notifications = await ((prisma as any).notification as any).findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  }) as {
    id: string
    type: string
    title: string
    content: string
    read: boolean
    createdAt: Date
  }[]

  // Marca todas como lidas ao abrir a página
  const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id)
  if (unreadIds.length > 0) {
    await ((prisma as any).notification as any).updateMany({
      where: { id: { in: unreadIds }, userId: user.id },
      data: { read: true },
    })
  }

  const formatted = notifications.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }))

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Notificações"
        subtitle="Resumos semanais e avisos do sistema"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 max-w-3xl w-full mx-auto">
        <NotificacoesClient notifications={formatted} userPlan={user.plan ?? "FREE"} />
      </div>
    </div>
  )
}
