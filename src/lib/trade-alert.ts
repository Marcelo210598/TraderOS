import { prisma } from "@/lib/prisma"

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

// Cria uma notificação in-app de alerta de trade vindo do sync do NinjaTrader.
// O `content` guarda os dados estruturados (JSON) — o card renderiza colorido por resultado.
// Falha de notificação NUNCA deve derrubar o sync do trade: o caller deve dar try/catch.
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
}
