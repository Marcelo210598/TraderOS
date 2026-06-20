import { prisma } from "@/lib/prisma"

const SOURCE_LABEL: Record<string, string> = {
  MT5: "MetaTrader 5",
  NINJATRADER: "NinjaTrader",
  MANUAL: "Manual",
}

export function friendlyAccountName(source: string, label: string): string {
  return `${SOURCE_LABEL[source] ?? source} · ${label}`
}

/**
 * Garante que existe uma TradingAccount para (userId, source, label) e devolve o id.
 * Idempotente — usado pelos endpoints de sync ao registrar um trade.
 */
export async function ensureAccount(userId: string, source: string, label: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acc = await (prisma as any).tradingAccount.upsert({
    where: { userId_source_label: { userId, source, label } },
    create: { userId, source, label, name: friendlyAccountName(source, label) },
    update: {},
    select: { id: true },
  })
  return acc.id as string
}
