// Promove/ISENTA usuários para um plano (PRO por padrão) buscando por email.
// Marca accessSource = MANUAL → o webhook do Asaas NUNCA rebaixa esse usuário
// (isenção de pagamento blindada). É a forma de liberar quem você quiser de graça.
//
// Uso:
//   node scripts/promote-users.mjs aluno1@email.com aluno2@email.com
//   node scripts/promote-users.mjs --plan=TRADER aluno@email.com
//   node scripts/promote-users.mjs --dry aluno@email.com   (só mostra, não grava)
//
// Conecta no mesmo Neon de produção (DATABASE_URL do .env).
// Após promover, o aluno precisa fazer LOGOUT/LOGIN (JWT cacheia o plano por 1h).

import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const PLANS_VALIDOS = ["FREE", "TRADER", "PRO"]

function parseArgs(argv) {
  const emails = []
  let plan = "PRO"
  let dry = false

  for (const arg of argv) {
    if (arg.startsWith("--plan=")) {
      plan = arg.split("=")[1].toUpperCase()
    } else if (arg === "--dry" || arg === "--dry-run") {
      dry = true
    } else if (arg.includes("@")) {
      emails.push(arg.trim().toLowerCase())
    } else {
      console.warn(`⚠️  Argumento ignorado (não parece email): "${arg}"`)
    }
  }

  return { emails, plan, dry }
}

async function main() {
  const { emails, plan, dry } = parseArgs(process.argv.slice(2))

  if (!PLANS_VALIDOS.includes(plan)) {
    console.error(`❌ Plano inválido: "${plan}". Use um de: ${PLANS_VALIDOS.join(", ")}`)
    process.exit(1)
  }

  if (emails.length === 0) {
    console.error("❌ Nenhum email informado.")
    console.error("   Exemplo: node scripts/promote-users.mjs aluno1@email.com aluno2@email.com")
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("❌ DATABASE_URL não encontrada (.env). Abortando.")
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  console.log(`\n🎯 Plano alvo: ${plan}${dry ? "  (DRY-RUN — nada será gravado)" : ""}`)
  console.log(`📧 ${emails.length} email(s) a processar\n`)

  const naoEncontrados = []
  const promovidos = []
  const jaEstavam = []

  try {
    for (const email of emails) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, plan: true, accessSource: true },
      })

      if (!user) {
        console.log(`  ❓ ${email} → NÃO CADASTRADO (peça pro aluno criar a conta primeiro)`)
        naoEncontrados.push(email)
        continue
      }

      // Já isento de verdade = plano certo E blindado contra o webhook (MANUAL).
      if (user.plan === plan && user.accessSource === "MANUAL") {
        console.log(`  ✅ ${email} → já em ${plan} + MANUAL (isento, nada a fazer)`)
        jaEstavam.push(email)
        continue
      }

      if (dry) {
        console.log(`  🔸 ${email} → ${user.plan}/${user.accessSource ?? "—"} ➜ ${plan}/MANUAL (dry-run, não gravado)`)
        promovidos.push(email)
        continue
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { plan, accessSource: "MANUAL" },
      })
      console.log(`  ⬆️  ${email} → ${user.plan}/${user.accessSource ?? "—"} ➜ ${plan}/MANUAL  [${user.name || "sem nome"}]`)
      promovidos.push(email)
    }
  } finally {
    await prisma.$disconnect()
  }

  console.log("\n──────── RESUMO ────────")
  console.log(`  Promovidos:     ${promovidos.length}`)
  console.log(`  Já estavam:     ${jaEstavam.length}`)
  console.log(`  Não cadastrados:${naoEncontrados.length}`)
  if (naoEncontrados.length > 0) {
    console.log(`\n  ⚠️  Pendentes (precisam se cadastrar antes):`)
    naoEncontrados.forEach((e) => console.log(`     - ${e}`))
  }
  if (promovidos.length > 0 && !dry) {
    console.log(`\n  💡 Avise os promovidos pra fazer LOGOUT e LOGIN (o plano leva até 1h pra atualizar sozinho).`)
  }
  console.log("")
}

main().catch((err) => {
  console.error("\n❌ Erro:", err.message)
  process.exit(1)
})
