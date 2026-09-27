import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { enforcePlan, type AccountRules } from "@/lib/drawdown-rules"
import type { PlanKey } from "@/lib/plans"

// Espelha DrawdownType (drawdown-engine.ts) + AccountRules (drawdown-rules.ts).
const rulesSchema = z.object({
  startBalance: z.number().finite().min(0).max(100_000_000),
  profitTarget: z.number().finite().min(0).max(100_000_000).nullable(),
  maxDrawdown: z.number().finite().min(0).max(100_000_000),
  trailingLock: z.number().finite().min(0).max(100_000_000).nullable(),
  dailyLossLimit: z.number().finite().min(0).max(100_000_000).nullable(),
  consistencyMaxPct: z.number().finite().min(0).max(100).nullable(),
  consistencyBase: z.enum(["NET_PROFIT", "ABS_SUM"]),
  minTradingDays: z.number().int().min(0).max(366).nullable(),
  type: z.enum(["INTRADAY", "END_OF_DAY", "END_OF_POSITION", "STATIC"]),
  dayRolloverHour: z.number().int().min(0).max(23),
  preset: z.string().max(60).nullable(),
})

// Regras de drawdown de uma conta — leitura/escrita restrita ao próprio usuário.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = await (prisma as any).tradingAccount.findFirst({
    where: { id, userId: session.user.id },
    select: { drawdownRules: true },
  })
  if (!account) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  return NextResponse.json({ rules: account.drawdownRules ?? null })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  const userId = session.user.id

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = rulesSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Reforça o gate de plano no servidor — o front já esconde/trava os campos Pro,
  // mas a API não confia só nisso (um PUT direto não pode "vazar" regra fora do plano).
  const rules: AccountRules = enforcePlan(session.user.plan as PlanKey, parsed.data)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma as any).tradingAccount.updateMany({
    where: { id, userId },
    data: { drawdownRules: rules },
  })
  if (updated.count === 0) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  return NextResponse.json({ ok: true, rules })
}
