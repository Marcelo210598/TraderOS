import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { giveXp, updateJournalStreak, updateProfitableDaysStreak, checkAndAwardAchievements } from "@/lib/gamification"
import { XP_REWARDS } from "@/lib/xp"
import { hashApiKey } from "@/lib/apikey"
import { createTradeAlert } from "@/lib/trade-alert"
import { ensureAccount } from "@/lib/account"

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

// Detecta o TIPO de conta pelo nome que a corretora (Apex/Rithmic) manda.
// O que importa é EM QUAL conta o trade rodou — bot ou manual é irrelevante:
//   Sim101 / Demo / Playback  -> "TEST" (simulacao: NAO conta nas metricas reais)
//   APEX-######-##            -> "EVAL" (conta de avaliacao / aprovacao, paga)
//   PAAPEX-######-## / PA50K   -> "PA"   (Performance Account / funded, saque real)
// Quando o trader eh aprovado, a Apex renomeia a conta com prefixo "PA" -> vira PA sozinho.
function detectAccountLabel(accountName?: string): string {
  if (!accountName) return "EVAL" // sem nome: assume avaliacao (fase mais comum)
  const name = accountName.toUpperCase().trim()

  // Simulacao / demo -> TESTE (nao suja metricas reais)
  if (name.includes("SIM") || name.includes("DEMO") || name.includes("PLAYBACK") || name.includes("TEST")) {
    return "TEST"
  }

  // Funded (Performance Account): prefixo "PA" -> "PAAPEX-...", "PA-...", "PA50K"
  if (name.startsWith("PA")) {
    const size = name.match(/PA(\d+K)/i) // PA25K, PA50K, PA100K...
    return size ? `PA${size[1]}` : "PA"
  }

  // Conta de avaliacao Apex: "APEX-######"
  if (name.includes("EVAL") || name.includes("APEX")) return "EVAL"

  // Fallback conservador: avaliacao (nunca marca como funded por engano)
  return "EVAL"
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
  const accountId = await ensureAccount(userId, "NINJATRADER", accountLabel, d.accountName)

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
      accountName: d.accountName ?? null,
      source: "NINJATRADER",
      accountId,
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

  // Alerta in-app em tempo real (foco em quem roda bot na conta).
  // Nunca pode derrubar o sync — se falhar, o trade já foi salvo (HTTP 201).
  try {
    await createTradeAlert(userId, {
      result,
      pnl: d.pnl,
      pnlPoints: d.pnlPoints,
      instrument,
      direction: d.direction,
      quantity: d.quantity,
      accountLabel,
      session,
    })
  } catch (e) {
    console.error("[sync] falha ao criar alerta de trade:", e)
  }

  return NextResponse.json({ ok: true, id: trade.id }, { status: 201 })
}
