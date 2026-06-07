import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { PlannerClient } from "@/components/planner/planner-client"

export const metadata: Metadata = { title: "Planner" }

export default async function PlannerPage() {
  const session = await auth()
  const user = session!.user

  const todayStr = new Date().toISOString().slice(0, 10)

  const [plans, setups] = await Promise.all([
    prisma.tradePlan.findMany({
      where: { userId: user.id },
      orderBy: { date: "desc" },
      take: 14,
    }),
    prisma.setup.findMany({
      where: { userId: user.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  const serialized = plans.map((p) => ({
    ...p,
    maxLoss: Number(p.maxLoss),
    profitTarget: Number(p.profitTarget),
    date: p.date.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }))

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Planner"
        subtitle="Planeje sua sessão antes de operar"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <PlannerClient plans={serialized} setups={setups} todayStr={todayStr} />
      </div>
    </div>
  )
}
