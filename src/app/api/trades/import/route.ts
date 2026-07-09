import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureAccount } from "@/lib/account"
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
  accountLabel: z.string().default("PA"),
  notes: z.string().max(2000).optional(),
  mfe: z.number().optional().nullable(),
  mae: z.number().optional().nullable(),
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
  const userId = session.user.id
  let errors = 0

  // Monta as linhas válidas em memória, resolvendo a conta (MANUAL) por label —
  // sem isso o trade importado ficava com accountId nulo e sumia da Carteira.
  const accountCache = new Map<string, string>()
  async function resolveAccount(label: string): Promise<string> {
    const cached = accountCache.get(label)
    if (cached) return cached
    const id = await ensureAccount(userId, "MANUAL", label)
    accountCache.set(label, id)
    return id
  }

  const rows: Record<string, unknown>[] = []
  for (const row of trades) {
    const tradeDate = new Date(row.date + "T12:00:00.000Z")
    if (isNaN(tradeDate.getTime())) { errors++; continue }

    const pnlPoints =
      row.direction === "LONG"
        ? (row.exitPrice - row.entryPrice) * row.quantity
        : (row.entryPrice - row.exitPrice) * row.quantity

    const result = row.pnl > 0 ? "WIN" : row.pnl < 0 ? "LOSS" : "BREAKEVEN"

    let accountId: string
    try {
      accountId = await resolveAccount(row.accountLabel)
    } catch {
      errors++
      continue
    }

    rows.push({
      userId,
      accountId,
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
      accountLabel: row.accountLabel,
      notes: row.notes ?? null,
      mfe: row.mfe ?? null,
      mae: row.mae ?? null,
    })
  }

  // Uma única ida ao banco em vez de até 500 inserts sequenciais.
  let imported = 0
  if (rows.length > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (prisma.trade as any).createMany({ data: rows })
      imported = res.count ?? rows.length
    } catch {
      return NextResponse.json({ error: "Falha ao salvar os trades" }, { status: 500 })
    }
  }

  return NextResponse.json({ imported, errors })
}
