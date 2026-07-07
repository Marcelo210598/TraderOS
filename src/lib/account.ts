import { prisma } from "@/lib/prisma"

// Label das contas de simulacao/demo — nao contam nas metricas reais.
export const TEST_LABEL = "TEST"

// Filtro Prisma para as metricas "reais" do dashboard: exclui simulacao (TEST)
// e qualquer conta arquivada (ex: avaliacao perdida/estourada que o trader guardou).
export const excludeTestTrades = {
  accountLabel: { not: TEST_LABEL },
  NOT: { account: { is: { isArchived: true } } },
}

const SOURCE_LABEL: Record<string, string> = {
  MT5: "MetaTrader 5",
  NINJATRADER: "NinjaTrader",
  MANUAL: "Manual",
}

export function friendlyAccountName(source: string, label: string): string {
  return `${SOURCE_LABEL[source] ?? source} · ${label}`
}

/**
 * Garante que existe uma TradingAccount e devolve o id. Idempotente — chamado pelo sync.
 *
 * Separacao de contas:
 *  - Com `brokerName` (nome/numero real da conta, ex "APEX-245678-01"): cada conta real vira
 *    uma TradingAccount propria. Se o TIPO mudar (avaliacao -> aprovada), atualiza o label.
 *  - Sem `brokerName` (MT5/manual/legado): faz dedup por (userId, source, label).
 *
 * @param label tipo da conta (TEST | EVAL | PA | PA50K...)
 */
export async function ensureAccount(
  userId: string,
  source: string,
  label: string,
  brokerName?: string | null,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (prisma as any).tradingAccount

  const clean = brokerName?.trim() || null

  if (clean) {
    // Uma conta por conta real da corretora.
    const existing = await db.findFirst({
      where: { userId, source, brokerName: clean },
      select: { id: true, label: true },
    })
    if (existing) {
      // Conta subiu de nivel (ex: passou na avaliacao e virou funded): reflete o novo tipo.
      if (existing.label !== label) {
        await db.update({ where: { id: existing.id }, data: { label } })
      }
      return existing.id as string
    }
    try {
      const created = await db.create({
        data: { userId, source, label, brokerName: clean, name: clean },
        select: { id: true },
      })
      return created.id as string
    } catch {
      // Corrida entre dois syncs simultaneos: outra request criou a conta — busca de novo.
      const again = await db.findFirst({ where: { userId, source, brokerName: clean }, select: { id: true } })
      if (again) return again.id as string
      throw new Error("ensureAccount: falha ao criar/achar conta")
    }
  }

  // Legado/manual: dedup por (userId, source, label) entre contas sem brokerName.
  const existing = await db.findFirst({
    where: { userId, source, label, brokerName: null },
    select: { id: true },
  })
  if (existing) return existing.id as string
  const created = await db.create({
    data: { userId, source, label, name: friendlyAccountName(source, label) },
    select: { id: true },
  })
  return created.id as string
}
