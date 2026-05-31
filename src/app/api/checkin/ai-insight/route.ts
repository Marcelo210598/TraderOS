import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const schema = z.object({
  type: z.enum(["PRE", "POST"]),
  emotional: z.number().min(1).max(10),
  energy: z.number().min(1).max(10),
  focus: z.number().min(1).max(10),
  stress: z.number().min(1).max(10),
  confidence: z.number().min(1).max(10),
  notes: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })

  const { type, emotional, energy, focus, stress, confidence, notes } = parsed.data
  const avg = (emotional + energy + focus + stress + confidence) / 5

  const sixtyDaysAgo = new Date()
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [historicalCheckIns, recentTrades, todayTrades] = await Promise.all([
    prisma.checkIn.findMany({
      where: {
        userId: session.user.id,
        type: "PRE",
        sessionDate: { gte: sixtyDaysAgo, lt: todayStart },
      },
      select: { sessionDate: true, emotional: true, energy: true, focus: true, stress: true, confidence: true },
      orderBy: { sessionDate: "desc" },
      take: 60,
    }),
    prisma.trade.findMany({
      where: { userId: session.user.id, date: { gte: sixtyDaysAgo, lt: todayStart } },
      select: { date: true, pnl: true, result: true },
    }),
    type === "POST"
      ? prisma.trade.findMany({
          where: { userId: session.user.id, date: { gte: todayStart, lte: todayEnd } },
          select: { pnl: true, result: true },
        })
      : Promise.resolve([]),
  ])

  // Correlaciona check-ins históricos com performance do dia
  let correlationContext = ""
  if (historicalCheckIns.length >= 3) {
    const tradesByDay: Record<string, { pnl: number; wins: number; total: number }> = {}
    for (const t of recentTrades) {
      const day = new Date(t.date).toISOString().split("T")[0]
      if (!tradesByDay[day]) tradesByDay[day] = { pnl: 0, wins: 0, total: 0 }
      tradesByDay[day].pnl += Number(t.pnl)
      tradesByDay[day].total++
      if (t.result === "WIN") tradesByDay[day].wins++
    }

    const cats = {
      high: { days: 0, pnl: 0, wins: 0, trades: 0 },
      medium: { days: 0, pnl: 0, wins: 0, trades: 0 },
      low: { days: 0, pnl: 0, wins: 0, trades: 0 },
    }

    for (const ci of historicalCheckIns) {
      const ciAvg = (ci.emotional + ci.energy + ci.focus + ci.stress + ci.confidence) / 5
      const day = new Date(ci.sessionDate).toISOString().split("T")[0]
      const dt = tradesByDay[day]
      const cat = ciAvg >= 7 ? "high" : ciAvg >= 5 ? "medium" : "low"
      cats[cat].days++
      if (dt) { cats[cat].pnl += dt.pnl; cats[cat].wins += dt.wins; cats[cat].trades += dt.total }
    }

    const lines: string[] = []
    const labels = { high: "estado ≥7", medium: "estado 5-6", low: "estado <5" }
    for (const [cat, data] of Object.entries(cats) as [keyof typeof cats, typeof cats.high][]) {
      if (data.days === 0) continue
      const pnlStr = data.trades > 0
        ? `P&L médio ${data.pnl / data.days >= 0 ? "+" : ""}$${(data.pnl / data.days).toFixed(0)}/dia, win rate ${Math.round((data.wins / data.trades) * 100)}%`
        : "sem trades registrados nesses dias"
      lines.push(`- Dias com ${labels[cat]}: ${data.days} dias → ${pnlStr}`)
    }

    if (lines.length > 0) {
      correlationContext = `\n\nSeu histórico (últimos 60 dias) — estado emocional vs performance:\n${lines.join("\n")}`
    }
  }

  let todayContext = ""
  if (type === "POST" && todayTrades.length > 0) {
    const pnl = todayTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const wins = todayTrades.filter((t) => t.result === "WIN").length
    const wr = Math.round((wins / todayTrades.length) * 100)
    todayContext = `\n\nSessão de hoje: ${todayTrades.length} trades, P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}, win rate ${wr}%`
  }

  const prompt = type === "PRE"
    ? `Check-in pré-sessão:
- Emocional: ${emotional}/10 | Energia: ${energy}/10 | Foco: ${focus}/10 | Confiança: ${confidence}/10 | Stress (inverso): ${stress}/10
- Média: ${avg.toFixed(1)}/10${notes ? `\n- Observações: "${notes}"` : ""}${correlationContext}

Dê um conselho direto em 2-3 frases para esta sessão. Use os dados históricos se disponíveis. Seja como um mentor que conhece este trader.`
    : `Check-in pós-sessão:
- Emocional: ${emotional}/10 | Energia: ${energy}/10 | Foco: ${focus}/10 | Confiança: ${confidence}/10 | Stress (inverso): ${stress}/10
- Média: ${avg.toFixed(1)}/10${notes ? `\n- Observações: "${notes}"` : ""}${todayContext}${correlationContext}

Dê um insight reflexivo em 2-3 frases sobre a sessão. Conecte estado emocional com desempenho se tiver dados. Dê uma lição prática para a próxima sessão.`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: "Você é Vega, analista de trading do TraderOS. Responda em português brasileiro. Seja direto e humano — como um mentor experiente. Máximo 3 frases curtas. Sem introduções genéricas.",
      messages: [{ role: "user", content: prompt }],
    })

    const insight = response.content[0].type === "text" ? response.content[0].text : ""
    return NextResponse.json({ insight })
  } catch (err) {
    console.error("[checkin-ai-insight]", err)
    return NextResponse.json({ error: "Erro ao gerar análise" }, { status: 500 })
  }
}
