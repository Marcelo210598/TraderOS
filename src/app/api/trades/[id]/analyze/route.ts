import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()

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

  const pnl = Number(trade.pnl)
  const pnlPoints = Number(trade.pnlPoints)
  const direction = trade.direction === "LONG" ? "comprado" : "vendido"
  const sessionMap: Record<string, string> = { AM: "manhã (AM)", PM: "tarde (PM)", OVERNIGHT: "overnight" }

  const prompt = `Você é um mentor de trading especializado em futuros americanos (NQ, ES, etc.). Analise este trade de forma direta e prática.

**Trade:**
- Ativo: ${trade.instrument} | Direção: ${direction.toUpperCase()} | Sessão: ${sessionMap[trade.sessionType] ?? trade.sessionType}
- Entrada: ${Number(trade.entryPrice).toFixed(2)} | Saída: ${Number(trade.exitPrice).toFixed(2)}
- Contratos: ${trade.quantity} | Comissão: $${Number(trade.commission).toFixed(2)}
- Resultado: ${trade.result} | PnL: ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)} (${pnlPoints >= 0 ? "+" : ""}${pnlPoints.toFixed(2)} pts)
${trade.setup ? `- Setup usado: ${trade.setup.name}` : "- Sem setup definido"}
${trade.tags.length > 0 ? `- Tags: ${trade.tags.map((t) => t.name).join(", ")}` : ""}
${trade.notes ? `- Notas do trader: "${trade.notes}"` : ""}

Analise em 3 partes objetivas (máx 250 palavras total):
1. **Leitura do trade** — o que os números dizem sobre a execução
2. **Pontos fortes e fracos** — o que foi bem e o que pode melhorar
3. **Recomendação** — uma ação concreta para o próximo trade similar`

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  })

  const analysis = message.content[0].type === "text" ? message.content[0].text : ""

  await prisma.trade.update({
    where: { id },
    data: { aiAnalysis: analysis },
  })

  return NextResponse.json({ analysis })
}
