/**
 * One-off: separa a conta de avaliacao PERDIDA do Marcelo (16 trades de jun/2026) da
 * avaliacao ATUAL (2 trades de jul/2026). Move os antigos p/ uma conta arquivada.
 * Escopo estrito: userId Marcelo + source NINJATRADER + label EVAL.
 */
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const log = (...a) => console.error(...a)

const MARCELO = "cmpbwmkwc0000wn1weeff77lz"
const CUTOFF = new Date("2026-07-01") // antes disso = conta perdida
const DRY = process.argv.includes("--dry")

try {
  // Conta EVAL atual (renomeada de PA no passo anterior)
  const current = await prisma.tradingAccount.findFirst({
    where: { userId: MARCELO, source: "NINJATRADER", label: "EVAL", isArchived: false },
    orderBy: { createdAt: "asc" },
  })
  if (!current) throw new Error("Conta EVAL atual nao encontrada")
  log(`Conta EVAL atual: ${current.id} (${current.name})`)

  const lostTrades = await prisma.trade.findMany({
    where: { userId: MARCELO, source: "NINJATRADER", accountLabel: "EVAL", date: { lt: CUTOFF } },
    select: { id: true, date: true, pnl: true },
  })
  const keepTrades = await prisma.trade.findMany({
    where: { userId: MARCELO, source: "NINJATRADER", accountLabel: "EVAL", date: { gte: CUTOFF } },
    select: { id: true, date: true, pnl: true },
  })
  log(`\nA MOVER p/ conta perdida (< ${CUTOFF.toISOString().slice(0,10)}): ${lostTrades.length} trades`)
  log(`A MANTER na conta atual: ${keepTrades.length} trades`)
  for (const t of keepTrades) log(`  MANTÉM ${t.date.toISOString().slice(0,10)} | $${t.pnl}`)

  if (DRY) { log("\n[DRY-RUN] nada alterado."); await prisma.$disconnect(); process.exit(0) }

  // Conta arquivada da avaliacao perdida (reaproveita se ja existir por nome)
  let lostAcc = await prisma.tradingAccount.findFirst({
    where: { userId: MARCELO, source: "NINJATRADER", name: "Avaliação (perdida)" },
  })
  if (!lostAcc) {
    lostAcc = await prisma.tradingAccount.create({
      data: { userId: MARCELO, source: "NINJATRADER", label: "EVAL", name: "Avaliação (perdida)", isArchived: true },
    })
    log(`\n✓ Criada conta arquivada: ${lostAcc.id}`)
  } else {
    log(`\n✓ Conta perdida ja existe: ${lostAcc.id}`)
  }

  if (lostTrades.length > 0) {
    const res = await prisma.trade.updateMany({
      where: { id: { in: lostTrades.map((t) => t.id) } },
      data: { accountId: lostAcc.id },
    })
    log(`✓ ${res.count} trades movidos p/ conta perdida (arquivada)`)
  }

  // Deixa a conta atual com nome claro
  await prisma.tradingAccount.update({ where: { id: current.id }, data: { name: "Avaliação (atual)" } })
  log(`✓ Conta atual renomeada -> "Avaliação (atual)"`)

  // Confere
  const accs = await prisma.tradingAccount.findMany({
    where: { userId: MARCELO, source: "NINJATRADER" },
    select: { id: true, name: true, label: true, isArchived: true, _count: { select: { trades: true } } },
    orderBy: { createdAt: "asc" },
  })
  log("\n=== Contas NINJATRADER do Marcelo ===")
  for (const a of accs) log(`${a.isArchived ? "🗄️ " : "✅ "}${a.name.padEnd(22)} | ${a.label.padEnd(5)} | ${a._count.trades} trades`)
} catch (e) {
  log("ERRO:", e?.stack || e?.message || e)
  process.exitCode = 1
}
await prisma.$disconnect()
