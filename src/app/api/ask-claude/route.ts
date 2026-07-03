import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { upgradeResponse } from "@/lib/plan-guard"

const BASE_SYSTEM = `Você é Vega, analista sênior de trading integrado ao MeuTrade. Você tem acesso aos dados reais de performance do trader e os usa para dar análises precisas e personalizadas.

Você ajuda traders de futuros americanos (NQ, ES, YM, RTY) a:
- Analisar padrões nos seus próprios dados (win rate, horários, setups, drawdown, eficiência de saída)
- Identificar pontos fracos específicos baseado no histórico real
- Melhorar psicologia, disciplina e gestão de risco
- Entender regras de prop firms como Apex Trader Funding (trailing drawdown EOD, consistency rule, etc.)
- Revisar e otimizar o plano de trade

Diretrizes:
- Seja direto, específico e acionável. Referencie os dados reais do trader quando relevante.
- Responda sempre em português brasileiro.
- Evite respostas genéricas — prefira "seu win rate no PM é 38%, bem abaixo dos 61% no AM" a "trading em diferentes sessões pode afetar resultados".
- Não dê conselhos financeiros nem recomende compra/venda de ativos específicos.
- Seja como um mentor experiente que conhece este trader — honesto, direto, sem enrolação.`

const BEHAVIORAL_TAGS = ["revenge", "fomo", "overtrading", "impulsivo", "medo", "hesitação", "saiu cedo", "over", "frustração"]

async function buildTraderContext(userId: string): Promise<{ context: string; tradeCount: number }> {
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const [trades, setups, streaks] = await Promise.all([
    prisma.trade.findMany({
      where: { userId, date: { gte: ninetyDaysAgo } },
      select: {
        date: true,
        instrument: true,
        direction: true,
        pnl: true,
        pnlPoints: true,
        result: true,
        sessionType: true,
        notes: true,
        mfe: true,
        mae: true,
        setup: { select: { name: true } },
        tags: { select: { name: true } },
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
    prisma.streak.findMany({ where: { userId } }),
  ])

  if (trades.length === 0) {
    return {
      context: "\n\n## Contexto do trader\nO trader ainda não registrou trades no MeuTrade. Oriente-o a começar pelo Journal.",
      tradeCount: 0,
    }
  }

  // ── Métricas gerais ──────────────────────────────────────────────────────────
  const wins = trades.filter(t => t.result === "WIN").length
  const losses = trades.filter(t => t.result === "LOSS").length
  const totalPnl = trades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const winRate = Math.round((wins / trades.length) * 100)
  const avgPnl = totalPnl / trades.length

  const winTrades = trades.filter(t => t.result === "WIN")
  const lossTrades = trades.filter(t => t.result === "LOSS")
  const avgWin = winTrades.length > 0
    ? winTrades.reduce((acc, t) => acc + Number(t.pnl), 0) / winTrades.length : 0
  const avgLoss = lossTrades.length > 0
    ? Math.abs(lossTrades.reduce((acc, t) => acc + Number(t.pnl), 0) / lossTrades.length) : 0
  const grossWins = winTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
  const grossLosses = Math.abs(lossTrades.reduce((acc, t) => acc + Number(t.pnl), 0))
  const profitFactor = grossLosses > 0 ? (grossWins / grossLosses).toFixed(2) : grossWins > 0 ? "∞" : "0"
  const rMultiple = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "N/A"

  // ── MFE/MAE agregado ─────────────────────────────────────────────────────────
  const tradesWithMfe = trades.filter(t => t.mfe !== null && Number(t.mfe) > 0)
  const tradesWithMae = trades.filter(t => t.mae !== null)
  const avgMfe = tradesWithMfe.length > 0
    ? tradesWithMfe.reduce((acc, t) => acc + Number(t.mfe), 0) / tradesWithMfe.length
    : null
  const avgMae = tradesWithMae.length > 0
    ? tradesWithMae.reduce((acc, t) => acc + Number(t.mae), 0) / tradesWithMae.length
    : null
  const exitEffTrades = trades.filter(t => t.mfe !== null && Number(t.mfe) > 0)
  const avgExitEff = exitEffTrades.length > 0
    ? Math.round(exitEffTrades.reduce((acc, t) => acc + (Number(t.pnlPoints) / Number(t.mfe)), 0) / exitEffTrades.length * 100)
    : null

  // ── Streak atual (wins/losses consecutivos) ──────────────────────────────────
  let currentStreak = 0
  let currentStreakType: "WIN" | "LOSS" | null = null
  for (const t of trades) {
    if (currentStreakType === null) {
      if (t.result === "WIN") { currentStreakType = "WIN"; currentStreak = 1 }
      else if (t.result === "LOSS") { currentStreakType = "LOSS"; currentStreak = 1 }
    } else if (t.result === currentStreakType) {
      currentStreak++
    } else break
  }

  const profitStreak = streaks.find(s => s.type === "PROFITABLE_DAYS")

  // ── Por sessão ───────────────────────────────────────────────────────────────
  const bySession: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of trades) {
    const s = t.sessionType
    if (!bySession[s]) bySession[s] = { count: 0, pnl: 0, wins: 0 }
    bySession[s].count++
    bySession[s].pnl += Number(t.pnl)
    if (t.result === "WIN") bySession[s].wins++
  }

  // ── Por instrumento ──────────────────────────────────────────────────────────
  const byInstrument: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of trades) {
    const k = t.instrument
    if (!byInstrument[k]) byInstrument[k] = { count: 0, pnl: 0, wins: 0 }
    byInstrument[k].count++
    byInstrument[k].pnl += Number(t.pnl)
    if (t.result === "WIN") byInstrument[k].wins++
  }

  // ── Por dia da semana ────────────────────────────────────────────────────────
  const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
  const byDow: Record<number, { count: number; pnl: number; wins: number }> = {}
  for (const t of trades) {
    const dow = new Date(t.date).getDay()
    if (!byDow[dow]) byDow[dow] = { count: 0, pnl: 0, wins: 0 }
    byDow[dow].count++
    byDow[dow].pnl += Number(t.pnl)
    if (t.result === "WIN") byDow[dow].wins++
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────
  const tagStats: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of trades) {
    for (const tag of t.tags) {
      const k = tag.name
      if (!tagStats[k]) tagStats[k] = { count: 0, pnl: 0, wins: 0 }
      tagStats[k].count++
      tagStats[k].pnl += Number(t.pnl)
      if (t.result === "WIN") tagStats[k].wins++
    }
  }
  const topTags = Object.entries(tagStats).sort(([, a], [, b]) => b.count - a.count).slice(0, 8)
  const behavioralTagsUsed = topTags.filter(([name]) =>
    BEHAVIORAL_TAGS.some(bt => name.toLowerCase().includes(bt))
  )

  // ── Últimas 10 operações ─────────────────────────────────────────────────────
  const last10 = trades.slice(0, 10).map(t => {
    const date = new Date(t.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    const pnl = Number(t.pnl)
    const setup = t.setup?.name ? ` [${t.setup.name}]` : ""
    const tags = t.tags.length > 0 ? ` {${t.tags.map(tg => tg.name).join(", ")}}` : ""
    return `  - ${date} | ${t.instrument} ${t.direction}${setup}${tags} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)} (${t.result})`
  })

  // ── Setups ───────────────────────────────────────────────────────────────────
  const setupLines = setups.map(s => {
    const w = s.trades.filter(t => t.result === "WIN").length
    const total = s.trades.length
    const pnl = s.trades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossW = s.trades.filter(t => t.result === "WIN").reduce((acc, t) => acc + Number(t.pnl), 0)
    const grossL = Math.abs(s.trades.filter(t => t.result === "LOSS").reduce((acc, t) => acc + Number(t.pnl), 0))
    const pf = grossL > 0 ? (grossW / grossL).toFixed(2) : grossW > 0 ? "∞" : "N/A"
    const wr = total > 0 ? Math.round((w / total) * 100) : 0
    return `  - ${s.name}: ${total} trades | ${wr}% win | PF ${pf} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`
  })

  // ── Anotações recentes ────────────────────────────────────────────────────────
  const tradesWithNotes = trades
    .filter(t => t.notes && t.notes.trim().length > 0)
    .slice(0, 8)
    .map(t => {
      const date = new Date(t.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
      return `  - ${date} [${t.result} ${t.instrument}]: "${t.notes}"`
    })

  // ── Formatação final ──────────────────────────────────────────────────────────
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

  const dowLines = Object.entries(byDow)
    .filter(([, v]) => v.count >= 3)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([dow, v]) => {
      const wr = Math.round((v.wins / v.count) * 100)
      return `  - ${DOW[Number(dow)]}: ${v.count} trades | ${wr}% win | ${v.pnl >= 0 ? "+" : ""}$${v.pnl.toFixed(0)}`
    })

  const tagLines = topTags.map(([name, v]) => {
    const wr = Math.round((v.wins / v.count) * 100)
    const isBehavioral = BEHAVIORAL_TAGS.some(bt => name.toLowerCase().includes(bt))
    return `  - "${name}"${isBehavioral ? " ⚠️" : ""}: ${v.count} usos | ${wr}% win | ${v.pnl >= 0 ? "+" : ""}$${v.pnl.toFixed(0)}`
  })

  const context = `

## Dados reais do trader (últimos 90 dias)

**Resumo geral:**
- Total de trades: ${trades.length}
- Win rate: ${winRate}%
- P&L total: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)}
- Média por trade: ${avgPnl >= 0 ? "+" : ""}$${avgPnl.toFixed(0)}
- Wins: ${wins} | Losses: ${losses} | Breakeven: ${trades.length - wins - losses}
- Avg win: +$${avgWin.toFixed(0)} | Avg loss: -$${avgLoss.toFixed(0)} | R múltiplo: ${rMultiple}x
- Profit Factor: ${profitFactor}
${currentStreakType ? `- Streak atual: ${currentStreak} ${currentStreakType === "WIN" ? "trades vencedores" : "trades perdedores"} consecutivos` : ""}
${profitStreak ? `- Streak de dias lucrativos: ${profitStreak.current} dias (recorde: ${profitStreak.best} dias)` : ""}

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

${dowLines.length > 0 ? `**Por dia da semana:**\n${dowLines.join("\n")}` : ""}

${avgMfe !== null || avgMae !== null || avgExitEff !== null ? `**MFE/MAE — eficiência de saída:**
${avgMfe !== null ? `  - MFE médio: ${avgMfe.toFixed(1)} pts (máximo favorável antes de sair)` : ""}
${avgMae !== null ? `  - MAE médio: ${avgMae.toFixed(1)} pts (máximo adverso antes de sair)` : ""}
${avgExitEff !== null ? `  - Eficiência de saída: ${avgExitEff}% (quanto do potencial máximo o trader captura em média)` : ""}` : ""}

${tagLines.length > 0 ? `**Tags mais usadas** (⚠️ = comportamental):\n${tagLines.join("\n")}` : ""}
${behavioralTagsUsed.length > 0 ? `\n⚠️ Tags comportamentais detectadas: ${behavioralTagsUsed.map(([n]) => n).join(", ")}` : ""}

${tradesWithNotes.length > 0 ? `**Anotações recentes dos trades:**\n${tradesWithNotes.join("\n")}` : ""}

Use esses dados ao responder. Seja específico e referencie os números reais. Tags marcadas com ⚠️ são comportamentais — relevantes para análise psicológica.`

  return { context, tradeCount: trades.length }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (session.user.plan !== "PRO") return upgradeResponse("O chat com a Vega é exclusivo do plano Pro.", "PRO")

  const { messages } = await req.json()
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 })
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const { context } = await buildTraderContext(session.user.id)

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [
        { type: "text" as const, text: BASE_SYSTEM, cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: context },
      ],
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
