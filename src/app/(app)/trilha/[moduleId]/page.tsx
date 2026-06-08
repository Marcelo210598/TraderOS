import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { ModuleView } from "@/components/trilha/module-view"
import { getModule } from "@/lib/trilha-content"

export const metadata: Metadata = { title: "Trilha — Módulo" }

export default async function TrilhaModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>
}) {
  const session = await auth()
  const user = session!.user
  const { moduleId } = await params

  const mod = getModule(moduleId)
  if (!mod) notFound()

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title={`Módulo ${mod.id}: ${mod.title}`}
        subtitle={mod.description}
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6">
        <ModuleView module={mod} />
      </div>
    </div>
  )
}
