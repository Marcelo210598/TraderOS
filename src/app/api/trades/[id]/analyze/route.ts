import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()

const VEGA_SYSTEM = `Você é Vega, analista sênior de trading do TraderOS. Você analisa trades de futuros americanos (NQ, ES, YM, RTY) com profundidade e precisão cirúrgica.

Diretrizes:
- Seja direto, específico e acionável — sem enrolação
- Responda sempre em português brasileiro
- Referencie os dados reais (MFE/MAE, histórico do setup, métricas do trader) quando disponíveis
- Compare o trade analisado com o histórico do trader para dar contexto real
- Não dê conselhos financeiros nem recomende compra/venda de ativos específicos
- Seja um mentor experiente que conhece este trader — direto, honesto, prático`

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (session.user.plan !== "PRO") {
    return NextResponse.json({ error: "Recurso exclusivo do plano Pro" }, { status: 403 })
  }

  const { id } = await params
  const trade = await prisma.trade.findFirst({
    where: { id, userId: session.user.id },
    include: { tags: true, setup: true },
  })
  if (!trade) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 })

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const [allTrades, setupTrades] = await Promise.all([
    prisma.trade.findMany({
      where: { userId: session.user.id, date: { gte: ninetyDaysAgo } },
      select: { result: true, pnl: true, pnlPoints: true, mfe: true, mae: true, sessionType: true },
    }),
    trade.setupId
      ? prisma.trade.findMany({
          where: { userId: session.user.id, setupId: trade.setupId },
          select: { result: true, pnl: true, pnlPoints: true, mfe: true, mae: true },
          take: 200,
        })
      : Promise.resolve([]),
  ])

  // Overall metrics
  const overallWins = allTrades.filter(t => t.result === "WIN").length
  const overallWr = allTrades.length > 0 ? Math.round((overallWins / allTrades.length) * 100) : 0
  const overallAvgPnl = allTrades.length > 0
    ? allTrades.reduce((acc, t) => acc + Number(t.pnl), 0) / allTrades.length
    : 0

  // Overall MFE/MAE
  const allWithMfe = allTrades.filter(t => t.mfe !== null && Number(t.mfe) > 0)
  const overallAvgMfe = allWithMfe.length > 0
    ? allWithMfe.reduce((acc, t) => acc + Number(t.mfe), 0) / allWithMfe.length
    : null

  // Overall exit efficiency
  const overallEffTrades = allTrades.filter(t => t.mfe !== null && Number(t.mfe) > 0)
  const overallExitEff = overallEffTrades.length > 0
    ? Math.round(overallEffTrades.reduce((acc, t) => acc + (Number(t.pnlPoints) / Number(t.mfe)), 0) / overallEffTrades.length * 100)
    : null

  // Session stats (same session as this trade)
  const sameSessioTrades = allTrades.filter(t => t.sessionType === trade.sessionType)
  const sessionWins = sameSessioTrades.filter(t => t.result === "WIN").length
  const sessionWr = sameSessioTrades.length > 0
    ? Math.round((sessionWins / sameSessioTrades.length) * 100)
    : null

  // Setup stats
  let setupContext = ""
  if (trade.setup && setupTrades.length >= 3) {
    const sw = setupTrades.filter(t => t.result === "WIN").length
    const sWr = Math.round((sw / setupTrades.length) * 100)
    const sTotalPnl = setupTrades.reduce((acc, t) => acc + Number(t.pnl), 0)
    const sAvgPnl = sTotalPnl / setupTrades.length
    const sGrossW = setupTrades.filter(t => t.result === "WIN").reduce((acc, t) => acc + Number(t.pnl), 0)
    const sGrossL = Math.abs(setupTrades.filter(t => t.result === "LOSS").reduce((acc, t) => acc + Number(t.pnl), 0))
    const sPf = sGrossL > 0 ? (sGrossW / sGrossL).toFixed(2) : sGrossW > 0 ? "∞" : "0"

    const setupWithMfe = setupTrades.filter(t => t.mfe !== null && Number(t.mfe) > 0)
    const setupAvgMfe = setupWithMfe.length > 0
      ? setupWithMfe.reduce((acc, t) => acc + Number(t.mfe), 0) / setupWithMfe.length
      : null

    const setupEffTrades = setupTrades.filter(t => t.mfe !== null && Number(t.mfe) > 0)
    const setupExitEff = setupEffTrades.length > 0
      ? Math.round(setupEffTrades.reduce((acc, t) => acc + (Number(t.pnlPoints) / Number(t.mfe)), 0) / setupEffTrades.length * 100)
      : null

    setupContext = `

**Histórico do setup "${trade.setup.name}" (${setupTrades.length} trades totais):**
- Win rate: ${sWr}% | Profit Factor: ${sPf} | Avg P&L: ${sAvgPnl >= 0 ? "+" : ""}$${sAvgPnl.toFixed(0)}/trade
${setupAvgMfe !== null ? `- MFE médio do setup: ${setupAvgMfe.toFixed(1)} pts` : ""}
${setupExitEff !== null ? `- Eficiência de saída média do setup: ${setupExitEff}%` : ""}
${trade.setup.rules ? `- Regras do setup: ${trade.setup.rules}` : ""}
${trade.setup.description ? `- Descrição: ${trade.setup.description}` : ""}`
  }

  // This trade's MFE/MAE
  const pnl = Number(trade.pnl)
  const pnlPoints = Number(trade.pnlPoints)
  const mfe = trade.mfe ? Number(trade.mfe) : null
  const mae = trade.mae ? Number(trade.mae) : null

  let exitEfficiencyLine = ""
  if (mfe !== null && mfe > 0) {
    const eff = Math.round((pnlPoints / mfe) * 100)
    exitEfficiencyLine = `\n- Eficiência de saída: ${eff}% (saiu em ${pnlPoints >= 0 ? "+" : ""}${pnlPoints.toFixed(1)} pts, MFE foi ${mfe.toFixed(1)} pts)`
    if (overallExitEff !== null) {
      const diff = eff - overallExitEff
      exitEfficiencyLine += ` — sua média é ${overallExitEff}% (${diff >= 0 ? "+" : ""}${diff}pp neste trade)`
    }
  }

  const direction = trade.direction === "LONG" ? "LONG (comprado)" : "SHORT (vendido)"
  const sessionMap: Record<string, string> = { AM: "manhã (AM)", PM: "tarde (PM)", OVERNIGHT: "overnight" }

  const prompt = `Analise este trade do meu journal:

**Trade:**
- Ativo: ${trade.instrument} | Direção: ${direction} | Sessão: ${sessionMap[trade.sessionType] ?? trade.sessionType}
- Entrada: ${Number(trade.entryPrice).toFixed(2)} | Saída: ${Number(trade.exitPrice).toFixed(2)}
- Contratos: ${trade.quantity} | Comissão: $${Number(trade.commission).toFixed(2)}
- Resultado: ${trade.result} | P&L: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)} (${pnlPoints >= 0 ? "+" : ""}${pnlPoints.toFixed(2)} pts)
${mfe !== null ? `- MFE: ${mfe.toFixed(1)} pts | MAE: ${mae !== null ? mae.toFixed(1) + " pts" : "N/A"}` : ""}${exitEfficiencyLine}
${trade.setup ? `- Setup: ${trade.setup.name}` : "- Sem setup definido"}
${trade.tags.length > 0 ? `- Tags: ${trade.tags.map(t => t.name).join(", ")}` : ""}
${trade.notes ? `- Notas do trader: "${trade.notes}"` : ""}

**Contexto do trader (últimos 90 dias, ${allTrades.length} trades):**
- Win rate geral: ${overallWr}% | Avg P&L: ${overallAvgPnl >= 0 ? "+" : ""}$${overallAvgPnl.toFixed(0)}/trade
${sessionWr !== null ? `- Sessão ${sessionMap[trade.sessionType] ?? trade.sessionType}: ${sameSessioTrades.length} trades, ${sessionWr}% win rate` : ""}
${overallAvgMfe !== null ? `- MFE médio geral: ${overallAvgMfe.toFixed(1)} pts` : ""}
${overallExitEff !== null ? `- Eficiência de saída média geral: ${overallExitEff}%` : ""}${setupContext}

Analise em 3 partes diretas (máx 380 palavras total):
**1. Leitura da execução** — o que os números dizem; se tiver MFE/MAE, compare com o histórico do setup e do trader
**2. Pontos fortes e fracos** — compare com o histórico do setup/sessão; se o setup tem regras, avalie aderência
**3. Próximo passo concreto** — uma ação específica e implementável para o próximo trade similar`

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [
      { type: "text" as const, text: VEGA_SYSTEM, cache_control: { type: "ephemeral" as const } },
    ],
    messages: [{ role: "user", content: prompt }],
  })

  const analysis = message.content[0].type === "text" ? message.content[0].text : ""

  await prisma.trade.update({
    where: { id },
    data: { aiAnalysis: analysis },
  })

  return NextResponse.json({ analysis })
}
