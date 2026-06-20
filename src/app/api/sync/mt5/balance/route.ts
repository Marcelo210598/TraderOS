import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { authSync, readBody } from "@/lib/sync-auth"
import { ensureAccount } from "@/lib/account"

// Fase 2 — o EA do MT5 envia o SALDO REAL da conta (balance/equity).
// Atualiza a TradingAccount: a Carteira passa a mostrar o saldo do broker, não a estimativa.
const schema = z.object({
  balance: z.number(),
  equity: z.number().optional(),
  currency: z.string().min(2).max(8).optional(),
  accountType: z.enum(["REAL", "DEMO"]).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authSync(req)
  if (!auth) return NextResponse.json({ error: "API Key inválida" }, { status: 401 })

  const raw = await readBody(req, ["balance", "equity"])
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const accountLabel = d.accountType === "DEMO" ? "TEST" : "MT5"
  const accountId = await ensureAccount(auth.userId, "MT5", accountLabel)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).tradingAccount.update({
    where: { id: accountId },
    data: {
      balance: d.balance,
      equity: d.equity ?? d.balance,
      currency: d.currency ?? "USD",
      balanceSyncAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true }, { status: 200 })
}
