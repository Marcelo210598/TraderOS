import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { giveXp, updateJournalStreak, updateProfitableDaysStreak, checkAndAwardAchievements } from "@/lib/gamification"
import { XP_REWARDS } from "@/lib/xp"
import { hashApiKey } from "@/lib/apikey"
import { createTradeAlert } from "@/lib/trade-alert"
import { ensureAccount } from "@/lib/account"

// Sync de trades do MetaTrader 5 (EA TraderOSSync.mq5).
// Diferenças vs NinjaTrader: volume em LOTES (decimal), símbolos forex/CFD,
// PnL vem direto do broker (já em USD/moeda da conta), conta demo vira "TEST".
const syncSchema = z.object({
  symbol: z.string().min(1).max(30),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  volume: z.number().positive().max(10000),          // lotes (0.01, 0.10, 1.0...)
  pnl: z.number(),                                    // lucro/prejuízo já calculado pelo MT5
  pnlPoints: z.number(),                              // variação em pontos do símbolo
  commission: z.number().default(0),
  swap: z.number().default(0),                        // swap/rollover do MT5
  entryTime: z.string(),
  exitTime: z.string(),
  accountType: z.enum(["REAL", "DEMO"]).optional(),
  externalId: z.string().min(1).max(100),            // position_id do MT5
})

// Sessão pelo horário ET (forex roda 24h, mas mantém o padrão do app)
function detectSession(dateStr: string): "AM" | "PM" | "OVERNIGHT" {
  try {
    const date = new Date(dateStr)
    const etHour = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours()
    if (etHour >= 9 && etHour < 12) return "AM"
    if (etHour >= 12 && etHour < 17) return "PM"
    return "OVERNIGHT"
  } catch {
    return "AM"
  }
}

// Normaliza símbolo MT5: tira sufixo do broker (EURUSD.r, US100.cash, EURUSDm) → EURUSD/US100
function normalizeSymbol(raw: string): string {
  return raw.split(/[.\s]/)[0].replace(/m$/i, "").toUpperCase()
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("X-API-Key")
  if (!apiKey) return NextResponse.json({ error: "API Key obrigatória" }, { status: 401 })

  const keyHash = hashApiKey(apiKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyRecord = await (prisma as any).userApiKey.findUnique({
    where: { key: keyHash },
    select: { id: true, userId: true },
  })
  if (!keyRecord) return NextResponse.json({ error: "API Key inválida" }, { status: 401 })

  // Aceita JSON ou form-encoded (MQL5 WebRequest é mais robusto com form-encoded)
  const contentType = req.headers.get("content-type") ?? ""
  let raw: Record<string, unknown> | null = null
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text()
    const params = new URLSearchParams(text)
    raw = {}
    params.forEach((v, k) => {
      if (["entryPrice", "exitPrice", "volume", "pnl", "pnlPoints", "commission", "swap"].includes(k)) {
        raw![k] = Number(v)
      } else {
        raw![k] = v
      }
    })
  } else {
    raw = await req.json().catch(() => null)
  }
  if (!raw) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const parsed = syncSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data
  const userId = keyRecord.userId

  // Dedup pelo position_id do MT5
  const existing = await prisma.trade.findFirst({
    where: { userId, externalId: d.externalId } as never,
  })
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, id: existing.id })
  }

  // Comissão total = comissão + swap (MT5 separa os dois)
  const totalCost = Math.abs(d.commission) + Math.abs(d.swap)
  const result = d.pnl > 0 ? "WIN" : d.pnl < 0 ? "LOSS" : "BREAKEVEN"
  const instrument = normalizeSymbol(d.symbol)
  const tradeDate = new Date(d.exitTime)
  const session = detectSession(d.exitTime)
  // Conta demo → "TEST" (não suja métricas reais), conta real → "MT5"
  const accountLabel = d.accountType === "DEMO" ? "TEST" : "MT5"
  const accountId = await ensureAccount(userId, "MT5", accountLabel)

  const trade = await (prisma.trade as never as {
    create: (args: object) => Promise<{ id: string }>
  }).create({
    data: {
      userId,
      date: tradeDate,
      instrument,
      direction: d.direction,
      entryPrice: d.entryPrice,
      exitPrice: d.exitPrice,
      quantity: d.volume,
      pnl: d.pnl,
      pnlPoints: d.pnlPoints,
      commission: totalCost,
      result,
      sessionType: session,
      accountLabel,
      source: "MT5",
      accountId,
      externalId: d.externalId,
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsed: new Date() },
  })

  // XP + streaks + conquistas (igual ao sync do NinjaTrader)
  await giveXp(userId, XP_REWARDS.TRADE_REGISTERED)
  if (result === "WIN") await giveXp(userId, XP_REWARDS.WIN_TRADE)
  await updateJournalStreak(userId, tradeDate)
  await updateProfitableDaysStreak(userId, tradeDate)
  await checkAndAwardAchievements(userId)

  // Alerta in-app + Web Push (nunca derruba o sync)
  try {
    await createTradeAlert(userId, {
      result,
      pnl: d.pnl,
      pnlPoints: d.pnlPoints,
      instrument,
      direction: d.direction,
      quantity: d.volume,
      accountLabel,
      session,
    })
  } catch (e) {
    console.error("[sync/mt5] falha ao criar alerta:", e)
  }

  return NextResponse.json({ ok: true, id: trade.id }, { status: 201 })
}
