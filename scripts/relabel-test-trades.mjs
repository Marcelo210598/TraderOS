// Reetiqueta trades de teste (forward test do bot) para accountLabel="TEST",
// pra nao sujar as metricas reais. Filtra por usuario (email) + data de corte.
//
// Uso:
//   node scripts/relabel-test-trades.mjs --email=voce@email.com               (DRY-RUN: so mostra)
//   node scripts/relabel-test-trades.mjs --email=voce@email.com --apply       (GRAVA de verdade)
//   node scripts/relabel-test-trades.mjs --email=voce@email.com --cutoff=2026-06-07 --apply
//   node scripts/relabel-test-trades.mjs --email=voce@email.com --label=TEST  (label alvo, default TEST)
//
// Conecta no mesmo Neon de producao (DATABASE_URL do .env). DRY-RUN por padrao:
// so grava com --apply. NUNCA apaga nada — so muda o accountLabel.

import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

function parseArgs(argv) {
  let email = null, cutoff = "2026-06-07", label = "TEST", apply = false
  for (const arg of argv) {
    if (arg.startsWith("--email=")) email = arg.split("=")[1].trim().toLowerCase()
    else if (arg.startsWith("--cutoff=")) cutoff = arg.split("=")[1].trim()
    else if (arg.startsWith("--label=")) label = arg.split("=")[1].trim().toUpperCase()
    else if (arg === "--apply") apply = true
  }
  return { email, cutoff, label, apply }
}

async function main() {
  const { email, cutoff, label, apply } = parseArgs(process.argv.slice(2))
  if (!email) {
    console.error("❌ Informe --email=voce@email.com"); process.exit(1)
  }
  const cutoffDate = new Date(`${cutoff}T00:00:00.000Z`)
  if (isNaN(cutoffDate.getTime())) {
    console.error(`❌ cutoff invalido: "${cutoff}" (use YYYY-MM-DD)`); process.exit(1)
  }
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) { console.error("❌ DATABASE_URL nao encontrada (.env)."); process.exit(1) }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  console.log(`\n🏷️  Relabel de trades de teste${apply ? "  ⚠️  MODO APPLY (grava)" : "  (DRY-RUN — nada gravado)"}`)
  console.log(`📧 ${email} | 📅 trades com date >= ${cutoff} | 🎯 label -> "${label}"\n`)

  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
    if (!user) { console.error(`❌ Usuario nao encontrado: ${email}`); process.exit(1) }

    const where = { userId: user.id, date: { gte: cutoffDate } }

    // Quebra por label atual pra voce conferir o que vai mudar
    const alvos = await prisma.trade.findMany({
      where, select: { date: true, accountLabel: true, pnl: true }, orderBy: { date: "asc" },
    })
    if (alvos.length === 0) { console.log("Nenhum trade no periodo. Nada a fazer."); return }

    const porLabel = {}
    let somaPnl = 0
    for (const t of alvos) {
      const k = t.accountLabel ?? "PA"
      porLabel[k] = (porLabel[k] ?? 0) + 1
      somaPnl += Number(t.pnl)
    }
    const ja = alvos.filter((t) => (t.accountLabel ?? "PA") === label).length
    const mudar = alvos.length - ja

    console.log(`Total no periodo: ${alvos.length} trades | PnL somado: $${somaPnl.toFixed(2)}`)
    console.log(`Por label atual:`, porLabel)
    console.log(`Janela: ${alvos[0].date.toISOString().slice(0,10)} -> ${alvos[alvos.length-1].date.toISOString().slice(0,10)}`)
    console.log(`Ja sao "${label}": ${ja} | A reetiquetar: ${mudar}\n`)

    if (!apply) {
      console.log("👉 DRY-RUN. Pra gravar de verdade, rode de novo com --apply")
      return
    }
    const result = await prisma.trade.updateMany({
      where: { ...where, accountLabel: { not: label } },
      data: { accountLabel: label },
    })
    console.log(`✅ ${result.count} trades reetiquetados para "${label}".`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
