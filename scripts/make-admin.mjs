// Define o papel (role) de um ou mais usuários buscando por email.
// É o que libera o acesso ao painel /admin.
// Uso:
//   node scripts/make-admin.mjs voce@email.com            (vira ADMIN)
//   node scripts/make-admin.mjs --role=USER voce@email.com (rebaixa pra USER)
//   node scripts/make-admin.mjs --dry voce@email.com       (só mostra, não grava)
//
// Conecta no mesmo Neon de produção (DATABASE_URL do .env).
// Após virar admin, faça LOGOUT/LOGIN (o JWT cacheia o role por até 1h).

import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const ROLES_VALIDOS = ["USER", "ADMIN"]

function parseArgs(argv) {
  const emails = []
  let role = "ADMIN"
  let dry = false

  for (const arg of argv) {
    if (arg.startsWith("--role=")) {
      role = arg.split("=")[1].toUpperCase()
    } else if (arg === "--dry" || arg === "--dry-run") {
      dry = true
    } else if (arg.includes("@")) {
      emails.push(arg.trim().toLowerCase())
    } else {
      console.warn(`⚠️  Argumento ignorado (não parece email): "${arg}"`)
    }
  }

  return { emails, role, dry }
}

async function main() {
  const { emails, role, dry } = parseArgs(process.argv.slice(2))

  if (!ROLES_VALIDOS.includes(role)) {
    console.error(`❌ Role inválido: "${role}". Use um de: ${ROLES_VALIDOS.join(", ")}`)
    process.exit(1)
  }
  if (emails.length === 0) {
    console.error("❌ Nenhum email informado.")
    console.error("   Exemplo: node scripts/make-admin.mjs voce@email.com")
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("❌ DATABASE_URL não encontrada (.env). Abortando.")
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  console.log(`\n🛡️  Role alvo: ${role}${dry ? "  (DRY-RUN — nada será gravado)" : ""}`)
  console.log(`📧 ${emails.length} email(s) a processar\n`)

  const naoEncontrados = []
  const alterados = []

  try {
    for (const email of emails) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, role: true },
      })

      if (!user) {
        console.log(`  ❓ ${email} → NÃO CADASTRADO (crie a conta no app primeiro)`)
        naoEncontrados.push(email)
        continue
      }
      if (user.role === role) {
        console.log(`  ✅ ${email} → já era ${role} (nada a fazer)`)
        continue
      }
      if (dry) {
        console.log(`  🔸 ${email} → ${user.role} ➜ ${role} (dry-run, não gravado)`)
        continue
      }

      await prisma.user.update({ where: { id: user.id }, data: { role } })
      console.log(`  🛡️  ${email} → ${user.role} ➜ ${role}  [${user.name || "sem nome"}]`)
      alterados.push(email)
    }
  } finally {
    await prisma.$disconnect()
  }

  console.log("\n──────── RESUMO ────────")
  console.log(`  Alterados:       ${alterados.length}`)
  console.log(`  Não cadastrados: ${naoEncontrados.length}`)
  if (alterados.length > 0 && !dry) {
    console.log(`\n  💡 Faça LOGOUT e LOGIN pra o acesso /admin valer (o role leva até 1h sozinho).`)
  }
  console.log("")
}

main().catch((err) => {
  console.error("\n❌ Erro:", err.message)
  process.exit(1)
})
