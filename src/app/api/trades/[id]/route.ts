import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const updateTradeSchema = z.object({
  date: z.string().optional(),
  instrument: z.string().optional(),
  direction: z.enum(["LONG", "SHORT"]).optional(),
  entryPrice: z.number().optional(),
  exitPrice: z.number().optional(),
  quantity: z.number().int().positive().optional(),
  pnl: z.number().optional(),
  pnlPoints: z.number().optional(),
  commission: z.number().min(0).optional(),
  result: z.enum(["WIN", "LOSS", "BREAKEVEN"]).optional(),
  sessionType: z.enum(["AM", "PM", "OVERNIGHT"]).optional(),
  accountLabel: z.string().optional(),
  setupId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  mfe: z.number().optional().nullable(),
  mae: z.number().optional().nullable(),
  tags: z.array(z.string()).optional(),
  screenshots: z.array(z.object({
    url: z.string().url(),
    key: z.string(),
    label: z.string().nullable().optional(),
  })).optional(),
})

async function getTradeOrFail(id: string, userId: string) {
  const trade = await prisma.trade.findFirst({ where: { id, userId } })
  if (!trade) return null
  return trade
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const trade = await prisma.trade.findFirst({
    where: { id, userId: session.user.id },
    include: {
      tags: true,
      setup: { select: { id: true, name: true } },
      screenshots: true,
    },
  })

  if (!trade) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })
  return NextResponse.json(trade)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const trade = await getTradeOrFail(id, session.user.id)
  if (!trade) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })

  const body = await req.json()
  const parsed = updateTradeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { tags, screenshots, ...data } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma.trade as any).update({
    where: { id },
    data: {
      ...data,
      ...(data.date && { date: new Date(data.date) }),
      ...(tags !== undefined && {
        tags: {
          deleteMany: {},
          create: tags.map((name) => ({ name })),
        },
      }),
      ...(screenshots !== undefined && {
        screenshots: {
          deleteMany: {},
          create: screenshots.map((s) => ({ url: s.url, key: s.key, label: s.label ?? null })),
        },
      }),
    },
    include: { tags: true, setup: { select: { id: true, name: true } } },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await params
  const trade = await getTradeOrFail(id, session.user.id)
  if (!trade) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })

  await prisma.trade.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
