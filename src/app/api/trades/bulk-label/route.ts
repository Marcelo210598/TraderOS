import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const schema = z.object({
  tradeIds: z.array(z.string()).optional(),
  accountLabel: z.string().min(1).max(20),
  applyToAll: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tradeIds, accountLabel, applyToAll } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradeModel = prisma.trade as any

  if (applyToAll) {
    const result = await tradeModel.updateMany({
      where: { userId: session.user.id },
      data: { accountLabel },
    })
    return NextResponse.json({ updated: result.count })
  }

  if (!tradeIds || tradeIds.length === 0) {
    return NextResponse.json({ error: "Forneça tradeIds ou applyToAll: true" }, { status: 400 })
  }

  const result = await tradeModel.updateMany({
    where: { userId: session.user.id, id: { in: tradeIds } },
    data: { accountLabel },
  })

  return NextResponse.json({ updated: result.count })
}
