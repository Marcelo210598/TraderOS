import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const userId = session.user.id
  const userName = session.user.name ?? null

  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const trades = await prisma.trade.findMany({
    where: { userId, date: { gte: sevenDaysAgo } },
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

  if (trades.length === 0) {
    return NextResponse.json({ error: "Nenhum trade nos últimos 7 dias para gerar o resumo." }, { status: 400 })
  }

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

  const startStr = sevenDaysAgo.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
  const endStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
  const weekStr = `${startStr} a ${endStr}`

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: `Você é Vega, analista de trading do MeuTrade. Gere um resumo semanal de trading em português brasileiro para ${userName ?? "o trader"}.

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
    }],
  })

  const content = response.content[0].type === "text" ? response.content[0].text : ""
  if (!content) return NextResponse.json({ error: "Erro ao gerar resumo" }, { status: 500 })

  const notification = await (prisma as any).notification.create({
    data: {
      userId,
      type: "WEEKLY_SUMMARY",
      title: `Resumo da semana — ${weekStr}`,
      content,
    },
  })

  return NextResponse.json({
    ok: true,
    notification: {
      ...notification,
      createdAt: notification.createdAt.toISOString(),
    },
  })
}
