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

const BEHAVIORAL_TAGS = ["revenge", "fomo", "overtrading", "impulsivo", "medo", "hesitação", "saiu cedo", "over", "frustração"]

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
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [historicalCheckIns, recentTrades, last7DaysTrades, streaks] = await Promise.all([
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
      orderBy: { date: "desc" },
    }),
    prisma.trade.findMany({
      where: { userId: session.user.id, date: { gte: sevenDaysAgo, lt: todayStart } },
      select: { date: true, pnl: true, result: true },
      orderBy: { date: "asc" },
    }),
    prisma.streak.findMany({ where: { userId: session.user.id } }),
  ])

  let todayTrades: Array<{
    pnl: unknown; result: string; instrument: string; sessionType: string
    notes: string | null; tags: Array<{ name: string }>; setup: { name: string } | null
  }> = []
  if (type === "POST") {
    todayTrades = await prisma.trade.findMany({
      where: { userId: session.user.id, date: { gte: todayStart, lte: todayEnd } },
      select: {
        pnl: true, result: true, instrument: true, sessionType: true,
        notes: true,
        tags: { select: { name: true } },
        setup: { select: { name: true } },
      },
      orderBy: { date: "asc" },
    })
  }

  // ── Correlação emocional histórica ──────────────────────────────────────────
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
        : "sem trades registrados"
      lines.push(`- Dias com ${labels[cat]}: ${data.days} dias → ${pnlStr}`)
    }

    if (lines.length > 0) {
      correlationContext = `\nHistórico emocional vs performance (60 dias):\n${lines.join("\n")}`
    }
  }

  // ── Tendência recente (7 dias) ───────────────────────────────────────────────
  let recentTrendContext = ""
  if (last7DaysTrades.length > 0) {
    const tradesByDay: Record<string, { pnl: number; wins: number; total: number }> = {}
    for (const t of last7DaysTrades) {
      const day = new Date(t.date).toISOString().split("T")[0]
      if (!tradesByDay[day]) tradesByDay[day] = { pnl: 0, wins: 0, total: 0 }
      tradesByDay[day].pnl += Number(t.pnl)
      tradesByDay[day].total++
      if (t.result === "WIN") tradesByDay[day].wins++
    }

    const days = Object.entries(tradesByDay).sort(([a], [b]) => a.localeCompare(b))
    const totalPnl7d = days.reduce((acc, [, d]) => acc + d.pnl, 0)
    const profitDays = days.filter(([, d]) => d.pnl > 0).length
    const lossDays = days.filter(([, d]) => d.pnl < 0).length

    let consecutiveLossDays = 0
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i][1].pnl < 0) consecutiveLossDays++
      else break
    }

    recentTrendContext = `\nÚltimos 7 dias: P&L total ${totalPnl7d >= 0 ? "+" : ""}$${totalPnl7d.toFixed(0)} | ${profitDays} dias verdes, ${lossDays} dias vermelhos`
    if (consecutiveLossDays >= 2) {
      recentTrendContext += `\n⚠️ ${consecutiveLossDays} dias consecutivos negativos mais recentes`
    }
  }

  // ── Streak ───────────────────────────────────────────────────────────────────
  let streakContext = ""
  const profitStreak = streaks.find(s => s.type === "PROFITABLE_DAYS")
  if (profitStreak && profitStreak.current >= 2) {
    streakContext = `\nStreak atual: ${profitStreak.current} dias lucrativos consecutivos`
  }

  // ── Trades de hoje (POST) ────────────────────────────────────────────────────
  let todayContext = ""
  if (type === "POST" && todayTrades.length > 0) {
    const totalPnl = todayTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const wins = todayTrades.filter(t => t.result === "WIN").length
    const wr = Math.round((wins / todayTrades.length) * 100)

    const allTags = todayTrades.flatMap(t => t.tags.map(tag => tag.name.toLowerCase()))
    const tagCounts: Record<string, number> = {}
    for (const tag of allTags) tagCounts[tag] = (tagCounts[tag] || 0) + 1

    const behavioralFound = Object.entries(tagCounts)
      .filter(([tag]) => BEHAVIORAL_TAGS.some(bt => tag.includes(bt)))
      .map(([tag, count]) => `${tag}${count > 1 ? ` (${count}x)` : ""}`)

    const tradeLines = todayTrades.map((t, i) => {
      const pnlV = Number(t.pnl)
      const tags = t.tags.map(tg => tg.name).join(", ")
      const setup = t.setup?.name ? ` [${t.setup.name}]` : ""
      return `  ${i + 1}. ${t.instrument}${setup} | ${t.result} | ${pnlV >= 0 ? "+" : ""}$${Math.abs(pnlV).toFixed(0)}${tags ? ` | tags: ${tags}` : ""}${t.notes ? ` | nota: "${t.notes}"` : ""}`
    })

    todayContext = `\nTrades de hoje: ${todayTrades.length} operações | P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)} | Win rate: ${wr}%\n${tradeLines.join("\n")}`
    if (behavioralFound.length > 0) {
      todayContext += `\n⚠️ Tags comportamentais detectadas: ${behavioralFound.join(", ")}`
    }
  }

  const prompt = type === "PRE"
    ? `Check-in pré-sessão:
- Emocional: ${emotional}/10 | Energia: ${energy}/10 | Foco: ${focus}/10 | Confiança: ${confidence}/10 | Ausência de stress: ${stress}/10
- Média: ${avg.toFixed(1)}/10${notes ? `\n- Observações do trader: "${notes}"` : ""}${recentTrendContext}${streakContext}${correlationContext}

Dê um conselho direto em 3-4 frases para esta sessão. Se houver padrão nos dados históricos (ex: win rate cai quando stress está alto), cite os números reais. Seja como um mentor que conhece este trader — sem enrolação, sem introdução genérica.`
    : `Check-in pós-sessão:
- Emocional: ${emotional}/10 | Energia: ${energy}/10 | Foco: ${focus}/10 | Confiança: ${confidence}/10 | Ausência de stress: ${stress}/10
- Média: ${avg.toFixed(1)}/10${notes ? `\n- Observações do trader: "${notes}"` : ""}${todayContext}${correlationContext}

Dê 2-3 insights diretos sobre a sessão. Se detectou tags comportamentais (revenge, FOMO, etc.), aborde-as pelo nome — cite o impacto em P&L se possível. Termine com uma lição prática e específica para a próxima sessão. Sem introdução genérica.`

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: "Você é Vega, analista de trading do TraderOS. Responda em português brasileiro. Seja direto e humano — mentor experiente. Vá direto ao ponto, sem introduções genéricas, sem textão motivacional.",
      messages: [{ role: "user", content: prompt }],
    })

    const insight = response.content[0].type === "text" ? response.content[0].text : ""
    return NextResponse.json({ insight })
  } catch (err) {
    console.error("[checkin-ai-insight]", err)
    return NextResponse.json({ error: "Erro ao gerar análise" }, { status: 500 })
  }
}
