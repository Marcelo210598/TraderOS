import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

// Vercel Cron: sábados às 12:00 UTC (9:00 BRT)
// Configurado em vercel.json

async function generateSummaryForUser(
  userId: string,
  userName: string | null,
  client: Anthropic
): Promise<{ title: string; content: string } | null> {
  const now = new Date()
  const lastFriday = new Date(now)
  lastFriday.setDate(now.getDate() - 1) // ontem (sexta)
  lastFriday.setHours(23, 59, 59, 999)

  const lastSaturday = new Date(lastFriday)
  lastSaturday.setDate(lastFriday.getDate() - 6)
  lastSaturday.setHours(0, 0, 0, 0)

  const trades = await prisma.trade.findMany({
    where: { userId, date: { gte: lastSaturday, lte: lastFriday } },
    select: {
      date: true,
      instrument: true,
      direction: true,
      pnl: true,
      result: true,
      sessionType: true,
      setup: { select: { name: true } },
      notes: true,
    },
    orderBy: { date: "asc" },
  })

  if (trades.length === 0) return null

  const wins = trades.filter((t) => t.result === "WIN").length
  const losses = trades.filter((t) => t.result === "LOSS").length
  const totalPnl = trades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const winRate = Math.round((wins / trades.length) * 100)

  const tradeLines = trades.map((t) => {
    const date = new Date(t.date).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
    const pnl = Number(t.pnl)
    const setup = t.setup?.name ? ` [${t.setup.name}]` : ""
    const note = t.notes ? ` — "${t.notes.slice(0, 60)}${t.notes.length > 60 ? "..." : ""}"` : ""
    return `- ${date} | ${t.instrument} ${t.direction} | ${t.sessionType}${setup} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)} (${t.result})${note}`
  }).join("\n")

  const weekStr = `${lastSaturday.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${lastFriday.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`

  const prompt = `Você é Vega, analista de trading do TraderOS. Gere um resumo semanal de trading em português brasileiro para ${userName ?? "o trader"}.

Dados da semana (${weekStr}):
- Total de trades: ${trades.length}
- Win rate: ${winRate}%
- P&L total: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)}
- Wins: ${wins} | Losses: ${losses}

Operações:
${tradeLines}

Gere um resumo analítico com estas seções (use markdown):

## 📊 Semana de ${weekStr}

**Uma frase de abertura direta sobre como foi a semana.**

### Números da semana
(tabela ou lista com as métricas principais)

### O que funcionou
(padrões positivos que aparecem nos dados — seja específico)

### O que precisa de atenção
(padrões negativos ou inconsistências — seja direto, sem suavizar)

### Foco para a próxima semana
(1-3 ações concretas baseadas nos dados, não genéricas)

Seja direto e analítico. Não use linguagem motivacional vazia. Máximo 400 palavras.`

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  })

  const content = response.content[0].type === "text" ? response.content[0].text : ""
  if (!content) return null

  const title = `Resumo da semana — ${weekStr}`
  return { title, content }
}

export async function GET(req: NextRequest) {
  // Vercel verifica o header Authorization com o CRON_SECRET
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Busca todos os usuários com plano TRADER ou PRO que têm trades
  const users = await prisma.user.findMany({
    where: { plan: { in: ["TRADER", "PRO"] } },
    select: { id: true, name: true },
  })

  let generated = 0
  let skipped = 0

  for (const user of users) {
    try {
      const result = await generateSummaryForUser(user.id, user.name, client)
      if (!result) { skipped++; continue }

      await (prisma as any).notification.create({
        data: {
          userId: user.id,
          type: "WEEKLY_SUMMARY",
          title: result.title,
          content: result.content,
        },
      })
      generated++
    } catch (err) {
      console.error(`[weekly-summary] erro para user ${user.id}:`, err)
      skipped++
    }
  }

  return NextResponse.json({ ok: true, generated, skipped, total: users.length })
}
