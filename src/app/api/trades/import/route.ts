import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const rowSchema = z.object({
  date: z.string().min(1),
  instrument: z.string().min(1).max(20),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  quantity: z.number().int().positive().max(999),
  pnl: z.number(),
  commission: z.number().min(0).default(0),
  session: z.enum(["AM", "PM", "OVERNIGHT"]).default("AM"),
  notes: z.string().max(2000).optional(),
})

const importSchema = z.object({
  trades: z.array(rowSchema).min(1).max(500),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = importSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { trades } = parsed.data
  let imported = 0
  let errors = 0

  for (const row of trades) {
    try {
      const tradeDate = new Date(row.date + "T12:00:00.000Z")
      if (isNaN(tradeDate.getTime())) { errors++; continue }

      const pnlPoints =
        row.direction === "LONG"
          ? (row.exitPrice - row.entryPrice) * row.quantity
          : (row.entryPrice - row.exitPrice) * row.quantity

      const result = row.pnl > 0 ? "WIN" : row.pnl < 0 ? "LOSS" : "BREAKEVEN"

      await prisma.trade.create({
        data: {
          userId: session.user.id,
          date: tradeDate,
          instrument: row.instrument.toUpperCase(),
          direction: row.direction,
          entryPrice: row.entryPrice,
          exitPrice: row.exitPrice,
          quantity: row.quantity,
          pnl: row.pnl,
          pnlPoints,
          commission: row.commission,
          result,
          sessionType: row.session,
          notes: row.notes ?? null,
        },
      })
      imported++
    } catch {
      errors++
    }
  }

  return NextResponse.json({ imported, errors })
}
