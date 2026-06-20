import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { authSync, readBody } from "@/lib/sync-auth"
import { ensureAccount } from "@/lib/account"

// Fase 2 — o EA do MT5 envia DEPÓSITOS e SAQUES (deals de saldo).
// Cria uma BalanceTransaction (extrato completo da Carteira). Dedup por externalId.
const schema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"]),
  amount: z.number(),         // positivo = entra, negativo = sai
  date: z.string(),
  externalId: z.string().min(1).max(100),
  accountType: z.enum(["REAL", "DEMO"]).optional(),
  note: z.string().max(200).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authSync(req)
  if (!auth) return NextResponse.json({ error: "API Key inválida" }, { status: 401 })

  const raw = await readBody(req, ["amount"])
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // Dedup pelo id da transação no broker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma as any).balanceTransaction.findFirst({
    where: { userId: auth.userId, externalId: d.externalId },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ ok: true, skipped: true, id: existing.id })

  const accountLabel = d.accountType === "DEMO" ? "TEST" : "MT5"
  const accountId = await ensureAccount(auth.userId, "MT5", accountLabel)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (prisma as any).balanceTransaction.create({
    data: {
      userId: auth.userId,
      accountId,
      type: d.type,
      amount: d.amount,
      date: new Date(d.date),
      externalId: d.externalId,
      note: d.note ?? null,
    },
  })

  return NextResponse.json({ ok: true, id: tx.id }, { status: 201 })
}
