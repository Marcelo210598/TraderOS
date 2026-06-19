import { prisma } from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push"

export interface TradeAlertData {
  result: "WIN" | "LOSS" | "BREAKEVEN"
  pnl: number
  pnlPoints: number
  instrument: string
  direction: "LONG" | "SHORT"
  quantity: number
  accountLabel: string
  session: "AM" | "PM" | "OVERNIGHT"
}

// Monta o título curto do alerta (ex: "WIN +$120 · NQ LONG")
function buildTitle(d: TradeAlertData): string {
  const sign = d.pnl >= 0 ? "+" : "-"
  const value = Math.abs(d.pnl).toFixed(0)
  return `${d.result} ${sign}$${value} · ${d.instrument} ${d.direction}`
}

// Corpo do push (ex: "MNQ LONG ×1 · TEST · +$333")
function buildPushBody(d: TradeAlertData): string {
  const sign = d.pnl >= 0 ? "+" : "-"
  const value = Math.abs(d.pnl).toFixed(0)
  return `${d.instrument} ${d.direction} ×${d.quantity} · ${d.accountLabel} · ${sign}$${value}`
}

// Cria o alerta de trade vindo do sync do NinjaTrader:
//  1. Notificação in-app (sino + página /notificacoes + toast quando o app está aberto)
//  2. Web Push (chega no celular/desktop mesmo com o app fechado)
// O `content` guarda os dados estruturados (JSON) — o card renderiza colorido por resultado.
// Falha NUNCA deve derrubar o sync do trade: o caller deve dar try/catch.
export async function createTradeAlert(userId: string, d: TradeAlertData): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).notification.create({
    data: {
      userId,
      type: "TRADE_ALERT",
      title: buildTitle(d),
      content: JSON.stringify(d),
    },
  })

  // Push (não bloqueia o fluxo se falhar — sendPushToUser nunca lança)
  const emoji = d.result === "WIN" ? "🟢" : d.result === "LOSS" ? "🔴" : "⚪"
  await sendPushToUser(userId, {
    title: `${emoji} ${d.result} ${d.pnl >= 0 ? "+" : "-"}$${Math.abs(d.pnl).toFixed(0)}`,
    body: buildPushBody(d),
    url: "/notificacoes",
  })
}
