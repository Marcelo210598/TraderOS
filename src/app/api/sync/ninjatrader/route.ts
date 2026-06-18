import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { giveXp, updateJournalStreak, updateProfitableDaysStreak, checkAndAwardAchievements } from "@/lib/gamification"
import { XP_REWARDS } from "@/lib/xp"
import { hashApiKey } from "@/lib/apikey"

const syncSchema = z.object({
  instrument: z.string().min(1).max(20),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  quantity: z.number().int().positive().max(100),
  pnl: z.number(),
  pnlPoints: z.number(),
  commission: z.number().min(0).default(0),
  entryTime: z.string(),
  exitTime: z.string(),
  accountName: z.string().optional(),
  externalId: z.string().min(1).max(100),
})

// Detecta sessão baseado no horário ET
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

// Normaliza nome do instrumento (ex: "NQ 06-25" → "NQ", "MNQ 06-25" → "MNQ")
function normalizeInstrument(raw: string): string {
  return raw.split(" ")[0].toUpperCase()
}

// Detecta accountLabel pela conta Apex
function detectAccountLabel(accountName?: string): string {
  if (!accountName) return "PA"
  const name = accountName.toUpperCase()
  // Conta de simulacao (Sim101, SIM-xxx) -> "TEST": forward test do bot NAO suja metricas reais.
  if (name.includes("SIM")) return "TEST"
  if (name.includes("EVAL") || name.includes("EVALUATION")) return "EVAL"
  if (name.includes("TEST")) return "TEST"
  // Detecta PA por tamanho: PA25K, PA50K, etc
  const match = name.match(/PA(\d+K?)/i)
  if (match) return `PA${match[1]}`
  return "PA"
}

export async function POST(req: NextRequest) {
  // Auth via API Key no header — busca pelo hash SHA-256
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("X-API-Key")
  if (!apiKey) return NextResponse.json({ error: "API Key obrigatória" }, { status: 401 })

  const keyHash = hashApiKey(apiKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyRecord = await (prisma as any).userApiKey.findUnique({
    where: { key: keyHash },
    select: { id: true, userId: true },
  })

  if (!keyRecord) return NextResponse.json({ error: "API Key inválida" }, { status: 401 })

  // Aceita JSON ou form-encoded (NinjaScript usa form-encoded por ser mais robusto)
  const contentType = req.headers.get("content-type") ?? ""
  let raw: Record<string, unknown> | null = null
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text()
    const params = new URLSearchParams(text)
    raw = {}
    params.forEach((v, k) => {
      if (["entryPrice", "exitPrice", "pnl", "pnlPoints", "commission"].includes(k)) {
        raw![k] = Number(v)
      } else if (k === "quantity") {
        raw![k] = parseInt(v, 10)
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

  // Deduplicação — ignora silenciosamente se já existe
  const existing = await prisma.trade.findFirst({
    where: { userId, externalId: d.externalId } as never,
  })
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, id: existing.id })
  }

  const result = d.pnl > 0 ? "WIN" : d.pnl < 0 ? "LOSS" : "BREAKEVEN"
  const instrument = normalizeInstrument(d.instrument)
  const tradeDate = new Date(d.exitTime)
  const session = detectSession(d.exitTime)
  const accountLabel = detectAccountLabel(d.accountName)

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
      quantity: d.quantity,
      pnl: d.pnl,
      pnlPoints: d.pnlPoints,
      commission: d.commission,
      result,
      sessionType: session,
      accountLabel,
      externalId: d.externalId,
    },
  })

  // Atualiza lastUsed na API key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsed: new Date() },
  })

  // XP + streaks + conquistas (igual ao POST manual)
  await giveXp(userId, XP_REWARDS.TRADE_REGISTERED)
  if (result === "WIN") await giveXp(userId, XP_REWARDS.WIN_TRADE)
  await updateJournalStreak(userId, tradeDate)
  await updateProfitableDaysStreak(userId, tradeDate)
  await checkAndAwardAchievements(userId)

  return NextResponse.json({ ok: true, id: trade.id }, { status: 201 })
}
