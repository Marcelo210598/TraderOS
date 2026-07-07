/**
 * One-off: reclassifica a conta de aprovacao (avaliacao) do Marcelo de "PA" -> "EVAL".
 * Os trades reais de 05 e 06/07 foram marcados "PA" (funded) pela deteccao antiga, mas
 * sao da conta de AVALIACAO Apex. Escopo estrito: userId do Marcelo + source NINJATRADER.
 * NAO toca em outros usuarios (ex: Andersson) nem em contas MT5/MANUAL.
 */
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const log = (...a) => console.error(...a)

const MARCELO = "cmpbwmkwc0000wn1weeff77lz"
const DRY = process.argv.includes("--dry")

try {
  // 1) Renomeia a TradingAccount NINJATRADER "PA" -> "EVAL" (se existir e nao houver EVAL ja)
  const paAcc = await prisma.tradingAccount.findFirst({
    where: { userId: MARCELO, source: "NINJATRADER", label: "PA" },
  })
  const evalExists = await prisma.tradingAccount.findFirst({
    where: { userId: MARCELO, source: "NINJATRADER", label: "EVAL" },
  })

  log(`Conta PA encontrada: ${paAcc ? paAcc.id : "NENHUMA"}`)
  log(`Conta EVAL ja existe: ${evalExists ? evalExists.id : "nao"}`)

  // 2) Conta os trades que serao afetados
  const affected = await prisma.trade.findMany({
    where: { userId: MARCELO, source: "NINJATRADER", accountLabel: "PA" },
    select: { id: true, date: true, pnl: true, instrument: true },
  })
  log(`\nTrades PA (NINJATRADER) do Marcelo a reclassificar: ${affected.length}`)
  for (const t of affected) {
    log(`  ${t.date.toISOString().slice(0, 10)} | ${t.instrument} | $${t.pnl}`)
  }

  if (DRY) {
    log("\n[DRY-RUN] Nada foi alterado.")
    await prisma.$disconnect()
    process.exit(0)
  }

  // Aplica
  if (paAcc && !evalExists) {
    await prisma.tradingAccount.update({
      where: { id: paAcc.id },
      data: { label: "EVAL", name: "NinjaTrader · EVAL" },
    })
    log(`\n✓ TradingAccount ${paAcc.id} renomeada PA -> EVAL`)
  } else if (paAcc && evalExists) {
    // Ja existe EVAL: move trades pra ela e arquiva a PA
    await prisma.trade.updateMany({
      where: { userId: MARCELO, source: "NINJATRADER", accountId: paAcc.id },
      data: { accountId: evalExists.id },
    })
    await prisma.tradingAccount.update({ where: { id: paAcc.id }, data: { isArchived: true } })
    log(`\n✓ Trades movidos para EVAL existente; conta PA antiga arquivada`)
  }

  const res = await prisma.trade.updateMany({
    where: { userId: MARCELO, source: "NINJATRADER", accountLabel: "PA" },
    data: { accountLabel: "EVAL" },
  })
  log(`✓ ${res.count} trades reclassificados PA -> EVAL`)

  // Confere
  const byLabel = await prisma.trade.groupBy({
    by: ["accountLabel"],
    where: { userId: MARCELO, source: "NINJATRADER" },
    _count: { _all: true },
  })
  log("\n=== Resultado (NINJATRADER, Marcelo) ===")
  for (const g of byLabel) log(`${g.accountLabel}: ${g._count._all} trades`)
} catch (e) {
  log("ERRO:", e?.stack || e?.message || e)
  process.exitCode = 1
}
await prisma.$disconnect()
