// Arquiva a conta "Manual" fantasma da Carteira (some da visao, SEM apagar trades).
// Nao reclassifica nada — os trades ficam onde estao, so a conta fica isArchived=true.
// Reversivel: pra desarquivar, use --restore.
//
// Uso:
//   node scripts/archive-manual-account.mjs --email=voce@email.com            (DRY-RUN: so mostra)
//   node scripts/archive-manual-account.mjs --email=voce@email.com --apply     (ARQUIVA de verdade)
//   node scripts/archive-manual-account.mjs --email=voce@email.com --restore --apply  (desarquiva)
//
// Conecta no Neon de producao (DATABASE_URL do .env). DRY-RUN por padrao. NUNCA apaga.

import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

function parseArgs(argv) {
  let email = null, apply = false, restore = false
  for (const arg of argv) {
    if (arg.startsWith("--email=")) email = arg.split("=")[1].trim().toLowerCase()
    else if (arg === "--apply") apply = true
    else if (arg === "--restore") restore = true
  }
  return { email, apply, restore }
}

async function main() {
  const { email, apply, restore } = parseArgs(process.argv.slice(2))
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) { console.error("❌ DATABASE_URL nao encontrada (.env)."); process.exit(1) }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })
  const targetArchived = !restore // arquivar (true) ou restaurar (false)

  console.log(`\n📦 ${restore ? "Restaurar" : "Arquivar"} conta MANUAL${apply ? "  ⚠️  MODO APPLY (grava)" : "  (DRY-RUN — nada gravado)"}\n`)

  try {
    // Resolve o usuario. Se nao passar email, e tiver so 1 user, usa esse.
    let user
    if (email) {
      user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
      if (!user) {
        const all = await prisma.user.findMany({ select: { email: true }, take: 20 })
        console.error(`❌ Usuario nao encontrado: ${email}`)
        console.error(`   Emails no banco:`, all.map((u) => u.email))
        process.exit(1)
      }
    } else {
      const all = await prisma.user.findMany({ select: { id: true, email: true }, take: 5 })
      if (all.length !== 1) {
        console.error(`❌ Informe --email= (achei ${all.length} usuarios):`, all.map((u) => u.email))
        process.exit(1)
      }
      user = all[0]
    }
    console.log(`👤 ${user.email}\n`)

    // Contas MANUAL do usuario
    const manualAccounts = await prisma.tradingAccount.findMany({
      where: { userId: user.id, source: "MANUAL" },
      select: { id: true, name: true, label: true, isArchived: true },
    })
    if (manualAccounts.length === 0) { console.log("Nenhuma conta MANUAL. Nada a fazer."); return }

    for (const acc of manualAccounts) {
      const nTrades = await prisma.trade.count({ where: { accountId: acc.id } })
      const sum = await prisma.trade.aggregate({ where: { accountId: acc.id }, _sum: { pnl: true } })
      const pnl = Number(sum._sum.pnl ?? 0)
      const willChange = acc.isArchived !== targetArchived
      console.log(`  • ${acc.name}  [${acc.label}]  ${nTrades} trades · PnL $${pnl.toFixed(2)}  ` +
        `(arquivada: ${acc.isArchived} → ${targetArchived})  ${willChange ? "◀ MUDA" : "(ja esta assim)"}`)
    }
    console.log("")

    if (!apply) {
      console.log("👉 DRY-RUN. Pra gravar de verdade, rode de novo com --apply\n")
      return
    }

    const res = await prisma.tradingAccount.updateMany({
      where: { userId: user.id, source: "MANUAL" },
      data: { isArchived: targetArchived },
    })
    console.log(`✅ ${res.count} conta(s) MANUAL ${restore ? "restaurada(s)" : "arquivada(s)"}. Trades preservados.\n`)
  } catch (err) {
    console.error("❌ Erro:", err.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
