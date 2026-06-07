import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const planSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maxLoss: z.number().positive(),
  profitTarget: z.number().positive(),
  setupsPlanned: z.array(z.string()).default([]),
  notes: z.string().optional(),
})

function serialize(p: { id: string; userId: string; date: Date; maxLoss: unknown; profitTarget: unknown; setupsPlanned: string[]; notes: string | null; executed: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    ...p,
    maxLoss: Number(p.maxLoss),
    profitTarget: Number(p.profitTarget),
    date: p.date.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const plans = await prisma.tradePlan.findMany({
    where: { userId: session.user.id },
    orderBy: { date: "desc" },
    take: 14,
  })

  return NextResponse.json(plans.map(serialize))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const parsed = planSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { date, maxLoss, profitTarget, setupsPlanned, notes } = parsed.data

  const dayStart = new Date(date + "T00:00:00.000Z")
  const dayEnd = new Date(date + "T23:59:59.999Z")

  const existing = await prisma.tradePlan.findFirst({
    where: { userId: session.user.id, date: { gte: dayStart, lte: dayEnd } },
  })

  if (existing) {
    const updated = await prisma.tradePlan.update({
      where: { id: existing.id },
      data: { maxLoss, profitTarget, setupsPlanned, notes: notes ?? null },
    })
    return NextResponse.json(serialize(updated))
  }

  const plan = await prisma.tradePlan.create({
    data: {
      userId: session.user.id,
      date: dayStart,
      maxLoss,
      profitTarget,
      setupsPlanned,
      notes: notes ?? null,
    },
  })

  return NextResponse.json(serialize(plan), { status: 201 })
}
