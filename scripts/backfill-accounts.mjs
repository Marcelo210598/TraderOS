/**
 * Backfill da Carteira (Fase 1):
 *  1. Define trade.source pelo padrão do externalId (MT5_ / NT_ / manual)
 *  2. Cria uma TradingAccount para cada (userId, source, label) distinto
 *  3. Liga cada trade à sua conta (accountId)
 *
 * Idempotente: pode rodar mais de uma vez. Uso: node scripts/backfill-accounts.mjs
 */
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const SOURCE_LABEL = { MT5: "MetaTrader 5", NINJATRADER: "NinjaTrader", MANUAL: "Manual" }

// 1. source pelo externalId
const r1 = await prisma.$executeRawUnsafe(`
  UPDATE trades SET source = CASE
    WHEN "externalId" LIKE 'MT5_%' THEN 'MT5'
    WHEN "externalId" LIKE 'NT_%'  THEN 'NINJATRADER'
    ELSE 'MANUAL' END`)
console.log(`1) source atualizado em ${r1} trades`)

// 2. contas distintas
const combos = await prisma.$queryRawUnsafe(`
  SELECT DISTINCT "userId", source, "accountLabel" AS label FROM trades`)

let created = 0
for (const c of combos) {
  const friendly = `${SOURCE_LABEL[c.source] ?? c.source} · ${c.label}`
  const acc = await prisma.tradingAccount.upsert({
    where: { userId_source_label: { userId: c.userId, source: c.source, label: c.label } },
    create: { userId: c.userId, source: c.source, label: c.label, name: friendly },
    update: {},
  })
  // 3. liga os trades dessa combinação à conta
  await prisma.trade.updateMany({
    where: { userId: c.userId, source: c.source, accountLabel: c.label },
    data: { accountId: acc.id },
  })
  created++
  console.log(`   ↳ ${friendly}  (${acc.id.slice(0, 8)})`)
}
console.log(`2/3) ${created} conta(s) garantidas e trades ligados`)

await prisma.$disconnect()
