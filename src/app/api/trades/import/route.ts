import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureAccount } from "@/lib/account"
import { detectAccountLabel } from "@/lib/account-label"
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
  accountLabel: z.string().optional(),
  // Nome real da conta (ex: "Sim101") — quando presente, o rótulo é inferido
  // no servidor via detectAccountLabel e a conta é resolvida por esse nome,
  // não pelo accountLabel escolhido manualmente no formulário.
  accountName: z.string().optional(),
  source: z.string().max(30).optional(),
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

  // Monta as linhas válidas em memória, resolvendo a conta por label (fluxo manual,
  // sem coluna de conta no CSV) ou por nome real de conta detectado por linha (grade
  // PT-BR do NT8) — sem isso o trade importado ficava com accountId nulo e sumia
  // da Carteira. Cache separado por chave real (accountName) e por label manual,
  // pra não misturar contas reais distintas que por acaso caem no mesmo label.
  const accountCache = new Map<string, string>()
  async function resolveAccountByLabel(label: string): Promise<string> {
    const key = `label:${label}`
    const cached = accountCache.get(key)
    if (cached) return cached
    const id = await ensureAccount(userId, "MANUAL", label)
    accountCache.set(key, id)
    return id
  }
  async function resolveAccountByName(accountName: string, source: string): Promise<{ id: string; label: string }> {
    const key = `name:${accountName}`
    const cached = accountCache.get(key)
    const label = detectAccountLabel(accountName)
    if (cached) return { id: cached, label }
    const id = await ensureAccount(userId, source, label, accountName)
    accountCache.set(key, id)
    return { id, label }
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
    let accountLabel: string
    try {
      if (row.accountName) {
        const resolved = await resolveAccountByName(row.accountName, row.source ?? "NINJATRADER")
        accountId = resolved.id
        accountLabel = resolved.label
      } else {
        accountLabel = row.accountLabel ?? "EVAL"
        accountId = await resolveAccountByLabel(accountLabel)
      }
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
      accountLabel,
      accountName: row.accountName ?? null,
      source: row.source ?? "MANUAL",
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
