import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"

const SYSTEM_PROMPT = `Você é Vega, um analista de trading especializado em futuros americanos (NQ, ES, YM, RTY) integrado ao TraderOS.

Você ajuda traders a:
- Analisar setups e estratégias (ICT, SMC, Order Flow, Price Action)
- Interpretar métricas de performance (win rate, profit factor, drawdown)
- Entender regras de prop firms como Apex Trader Funding
- Melhorar psicologia e disciplina no trading
- Revisar e otimizar o plano de trade

Seja direto, prático e use linguagem de trader. Responda sempre em português brasileiro.
Evite respostas genéricas — seja específico e acionável.
Não dê conselhos financeiros nem recomende ativos específicos para compra/venda.`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (session.user.plan !== "PRO") return NextResponse.json({ error: "Plano PRO necessário" }, { status: 403 })

  const { messages } = await req.json()
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 })
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
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
    console.error("[ask-claude] status:", errAny?.status, "detail:", detail, "full:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)))
    return NextResponse.json({ error: `Erro Anthropic: ${detail.slice(0, 300)}` }, { status: 500 })
  }
}
