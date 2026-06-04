import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { ChallengesClient } from "@/components/desafios/challenges-client"
import { evaluateRules, ChallengeRule, TradeForEval } from "@/lib/challenges"
import { differenceInDays } from "date-fns"

export const metadata: Metadata = { title: "Desafios" }

export default async function DesafiosPage() {
  const session = await auth()
  const user = session!.user

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [rawChallenges, trades] = await Promise.all([
    (prisma as any).challenge.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.trade.findMany({
      where: { userId: user.id, date: { gte: thirtyDaysAgo } },
      select: { id: true, date: true, pnl: true, result: true, sessionType: true, tags: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
  ])

  const tradesToEval: TradeForEval[] = trades.map(t => ({
    id: t.id,
    date: t.date,
    pnl: Number(t.pnl),
    result: t.result,
    sessionType: t.sessionType,
    tags: t.tags,
  }))

  const challenges = rawChallenges.map((ch: any) => {
    const rules = ch.rules as ChallengeRule[]
    const results = evaluateRules(rules, tradesToEval)
    const passed = results.filter(r => r.passed).length
    const passRate = results.length > 0 ? Math.round((passed / results.length) * 100) : 0
    const daysActive = differenceInDays(new Date(), new Date(ch.startedAt)) + 1

    return {
      id: ch.id,
      name: ch.name,
      description: ch.description,
      rules,
      isActive: ch.isActive,
      startedAt: ch.startedAt.toISOString(),
      results,
      passRate,
      daysActive,
    }
  })

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Desafios"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-4 lg:p-6 max-w-2xl mx-auto w-full">
        <ChallengesClient challenges={challenges} />
      </div>
    </div>
  )
}
