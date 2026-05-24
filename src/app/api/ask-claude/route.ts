import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const BASE_SYSTEM = `Você é Vega, um analista de trading integrado ao TraderOS. Você tem acesso aos dados reais de performance do trader.

Você ajuda traders de futuros americanos (NQ, ES, YM, RTY) a:
- Analisar padrões nos seus próprios dados (win rate, horários, setups, drawdown)
- Identificar pontos fracos específicos baseado no histórico real
- Melhorar psicologia, disciplina e gestão de risco
- Entender regras de prop firms como Apex Trader Funding (trailing drawdown EOD, consistency rule, etc.)
- Revisar e otimizar o plano de trade

Diretrizes:
- Seja direto, específico e acionável. Referencie os dados reais do trader quando relevante.
- Responda sempre em português brasileiro.
- Evite respostas genéricas — prefira "seu win rate no PM é 38%, bem abaixo do AM" a "trading em diferentes sessões pode afetar resultados".
- Não dê conselhos financeiros nem recomende compra/venda de ativos específicos.`

async function buildTraderContext(userId: string): Promise<{ context: string; tradeCount: number }> {
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const [trades, setups] = await Promise.all([
    prisma.trade.findMany({
      where: { userId, date: { gte: ninetyDaysAgo } },
      select: {
        date: true,
        instrument: true,
        direction: true,
        pnl: true,
        result: true,
        sessionType: true,
        setup: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 120,
    }),
    prisma.setup.findMany({
      where: { userId, isActive: true },
      include: {
        trades: {
          select: { result: true, pnl: true },
          take: 500,
        },
      },
    }),
  ])

  if (trades.length === 0) {
    return {
      context: "\n\n## Contexto do trader\nO trader ainda não registrou trades no TraderOS. Oriente-o a começar pelo Journal.",
      tradeCount: 0,
    }
  }

  const wins = trades.filter((t) => t.result === "WIN").length
  const losses = trades.filter((t) => t.result === "LOSS").length
  const totalPnl = trades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const winRate = Math.round((wins / trades.length) * 100)
  const avgPnl = totalPnl / trades.length

  // Por sessão
  const bySession: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of trades) {
    const s = t.sessionType
    if (!bySession[s]) bySession[s] = { count: 0, pnl: 0, wins: 0 }
    bySession[s].count++
    bySession[s].pnl += Number(t.pnl)
    if (t.result === "WIN") bySession[s].wins++
  }

  // Por instrumento
  const byInstrument: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of trades) {
    const k = t.instrument
    if (!byInstrument[k]) byInstrument[k] = { count: 0, pnl: 0, wins: 0 }
    byInstrument[k].count++
    byInstrument[k].pnl += Number(t.pnl)
    if (t.result === "WIN") byInstrument[k].wins++
  }

  // Últimos 10 trades
  const last10 = trades.slice(0, 10).map((t) => {
    const date = new Date(t.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    const pnl = Number(t.pnl)
    const setup = t.setup?.name ? ` [${t.setup.name}]` : ""
    return `  - ${date} | ${t.instrument} ${t.direction}${setup} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)} (${t.result})`
  })

  // Setups
  const setupLines = setups.map((s) => {
    const w = s.trades.filter((t) => t.result === "WIN").length
    const total = s.trades.length
    const pnl = s.trades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossW = s.trades.filter((t) => t.result === "WIN").reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossL = Math.abs(s.trades.filter((t) => t.result === "LOSS").reduce((acc, t) => acc + Number(t.pnl), 0))
    const pf = grossL > 0 ? (grossW / grossL).toFixed(2) : grossW > 0 ? "∞" : "N/A"
    const wr = total > 0 ? Math.round((w / total) * 100) : 0
    return `  - ${s.name}: ${total} trades | ${wr}% win | PF ${pf} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`
  })

  const sessionLines = Object.entries(bySession)
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([k, v]) => {
      const wr = Math.round((v.wins / v.count) * 100)
      return `  - ${k}: ${v.count} trades | ${wr}% win | ${v.pnl >= 0 ? "+" : ""}$${v.pnl.toFixed(0)}`
    })

  const instrumentLines = Object.entries(byInstrument)
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([k, v]) => {
      const wr = Math.round((v.wins / v.count) * 100)
      return `  - ${k}: ${v.count} trades | ${wr}% win | ${v.pnl >= 0 ? "+" : ""}$${v.pnl.toFixed(0)}`
    })

  const context = `

## Dados reais do trader (últimos 90 dias)

**Resumo geral:**
- Total de trades: ${trades.length}
- Win rate: ${winRate}%
- P&L total: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)}
- Média por trade: ${avgPnl >= 0 ? "+" : ""}$${avgPnl.toFixed(0)}
- Wins: ${wins} | Losses: ${losses} | Breakeven: ${trades.length - wins - losses}

**Últimas 10 operações:**
${last10.join("\n")}

${setupLines.length > 0
    ? `**Performance por setup:**\n${setupLines.join("\n")}`
    : "**Setups:** Nenhum setup cadastrado ainda."
  }

**Por sessão:**
${sessionLines.join("\n")}

**Por instrumento:**
${instrumentLines.join("\n")}

Use esses dados ao responder. Seja específico e referecie os números reais quando fizer sentido.`

  return { context, tradeCount: trades.length }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (session.user.plan !== "PRO") return NextResponse.json({ error: "Plano PRO necessário" }, { status: 403 })

  const { messages } = await req.json()
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 })
  }

  try {
    const [{ context }, client] = await Promise.all([
      buildTraderContext(session.user.id),
      Promise.resolve(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
    ])

    const systemPrompt = BASE_SYSTEM + context

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    })

    const text = response.content[0].type === "text" ? response.content[0].text : ""
    return NextResponse.json({ reply: text })
  } catch (err) {
    const errAny = err as { status?: number; message?: string; error?: { error?: { message?: string } } }
    const detail = errAny?.error?.error?.message || errAny?.message || String(err)
    console.error("[ask-claude]", errAny?.status, detail)
    return NextResponse.json({ error: `Erro: ${detail.slice(0, 300)}` }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (session.user.plan !== "PRO") return NextResponse.json({ error: "Plano PRO necessário" }, { status: 403 })

  const { tradeCount } = await buildTraderContext(session.user.id)
  return NextResponse.json({ tradeCount })
}
