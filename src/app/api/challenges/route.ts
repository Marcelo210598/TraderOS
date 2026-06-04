import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { ChallengeRule } from "@/lib/challenges"

const createSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).optional().nullable(),
  rules: z.array(z.object({
    type: z.string(),
    value: z.number().optional(),
    label: z.string(),
  })).min(1).max(7),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const challenges = await (prisma as any).challenge.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ challenges })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })

  const { name, description, rules } = parsed.data

  const challenge = await (prisma as any).challenge.create({
    data: {
      userId: session.user.id,
      name,
      description: description ?? null,
      rules: rules as ChallengeRule[],
    },
  })

  return NextResponse.json({ challenge }, { status: 201 })
}
