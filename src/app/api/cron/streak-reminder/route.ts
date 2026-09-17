import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push"

// Vercel Cron: todo dia às 23:00 UTC (20:00 BRT) — mesmo critério de "dia" (UTC)
// que src/lib/gamification.ts::updateCheckInStreak usa pra não incrementar/resetar
// o streak. Configurado em vercel.json.
//
// Lembra o usuário só quando o streak de check-in já vale a pena proteger (>=2
// dias) e ele ainda não fez o check-in de hoje — antes que o streak reset pra 1
// no próximo check-in dele. Nunca manda 2x no mesmo dia (guarda por notificação
// já criada hoje).

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const atRiskStreaks = await prisma.streak.findMany({
    where: { type: "CHECK_INS", current: { gte: 2 }, lastUpdated: { lt: today } },
    select: { userId: true, current: true },
  })

  let sent = 0
  let skipped = 0

  for (const streak of atRiskStreaks) {
    try {
      // Já lembrado hoje? (idempotência se o cron rodar mais de uma vez no dia)
      const alreadyReminded = await prisma.notification.findFirst({
        where: { userId: streak.userId, type: "STREAK_REMINDER", createdAt: { gte: today } },
        select: { id: true },
      })
      if (alreadyReminded) { skipped++; continue }

      const title = `🔥 Seu streak de ${streak.current} dias está em risco`
      const body = `Você não fez o check-in de hoje ainda. Faça agora pra não perder os ${streak.current} dias seguidos.`

      await prisma.notification.create({
        data: { userId: streak.userId, type: "STREAK_REMINDER", title, content: body },
      })
      await sendPushToUser(streak.userId, { title, body, url: "/checkin" })
      sent++
    } catch (err) {
      console.error(`[streak-reminder] erro para user ${streak.userId}:`, err)
      skipped++
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, total: atRiskStreaks.length })
}
