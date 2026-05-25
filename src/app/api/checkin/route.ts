import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { giveXp, updateCheckInStreak, checkAndAwardAchievements } from "@/lib/gamification"
import { XP_REWARDS } from "@/lib/xp"

const checkInSchema = z.object({
  type: z.enum(["PRE", "POST"]),
  sessionDate: z.string(),
  emotional: z.number().int().min(1).max(10),
  energy: z.number().int().min(1).max(10),
  focus: z.number().int().min(1).max(10),
  stress: z.number().int().min(1).max(10),
  confidence: z.number().int().min(1).max(10),
  notes: z.string().optional().nullable(),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get("date")

  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId: session.user.id,
      ...(date && {
        sessionDate: {
          gte: new Date(date + "T00:00:00"),
          lte: new Date(date + "T23:59:59"),
        },
      }),
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  })

  return NextResponse.json(checkIns)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json()
  const parsed = checkInSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const checkIn = await prisma.checkIn.create({
    data: {
      ...parsed.data,
      sessionDate: new Date(parsed.data.sessionDate),
      userId: session.user.id,
    },
  })

  await giveXp(session.user.id, XP_REWARDS.CHECK_IN)
  await updateCheckInStreak(session.user.id)
  await checkAndAwardAchievements(session.user.id)

  return NextResponse.json(checkIn, { status: 201 })
}
