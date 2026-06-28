// Teste E2E do webhook Asaas (roda contra o dev server local + Neon).
// Cria user de teste → simula pagamento → confere upgrade → confere downgrade
// → confere que MANUAL não rebaixa → limpa tudo.
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { readFileSync } from "node:fs"

// Carrega .env manualmente (script standalone)
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      let v = l.slice(i + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [l.slice(0, i).trim(), v]
    })
)

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const TOKEN = env.ASAAS_WEBHOOK_TOKEN
const WEBHOOK_URL = "http://localhost:3000/api/asaas/webhook"

const TEST_EMAIL = `asaas-test-${Date.now()}@traderos.test`

function send(event, userId, plan = "PRO", cycle = "MONTHLY") {
  return fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "asaas-access-token": TOKEN },
    body: JSON.stringify({
      event,
      payment: {
        id: "pay_test",
        customer: "cus_test",
        subscription: "sub_test",
        value: 97,
        externalReference: `${userId}|${plan}|${cycle}`,
      },
    }),
  }).then((r) => r.status)
}

async function planOf(id) {
  const u = await prisma.user.findUnique({ where: { id }, select: { plan: true, accessSource: true } })
  return u
}

let ok = true
function assert(cond, msg) {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) ok = false
}

const user = await prisma.user.create({
  data: { email: TEST_EMAIL, name: "Asaas Test", plan: "FREE" },
})
console.log(`\n👤 user de teste: ${user.id}\n`)

try {
  // 1) Pagamento recebido → sobe PRO
  let s = await send("PAYMENT_RECEIVED", user.id)
  let u = await planOf(user.id)
  assert(s === 200 && u.plan === "PRO" && u.accessSource === "PAID", `PAYMENT_RECEIVED → PRO/PAID (plan=${u.plan}, src=${u.accessSource})`)

  // 2) Pagamento atrasado → desce FREE
  s = await send("PAYMENT_OVERDUE", user.id)
  u = await planOf(user.id)
  assert(u.plan === "FREE", `PAYMENT_OVERDUE → FREE (plan=${u.plan})`)

  // 3) Acesso MANUAL não pode ser rebaixado
  await prisma.user.update({ where: { id: user.id }, data: { plan: "PRO", accessSource: "MANUAL" } })
  s = await send("PAYMENT_OVERDUE", user.id)
  u = await planOf(user.id)
  assert(u.plan === "PRO", `PAYMENT_OVERDUE em MANUAL → mantém PRO (plan=${u.plan})`)

  // 4) Subscription registrada
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } })
  assert(!!sub?.asaasSubscriptionId, `Subscription gravada (asaasSubscriptionId=${sub?.asaasSubscriptionId})`)
} finally {
  // limpeza
  await prisma.subscription.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  console.log(`\n🧹 user de teste removido`)
  await prisma.$disconnect()
}

console.log(`\n${ok ? "🎉 TODOS OS TESTES PASSARAM" : "⚠️ ALGUM TESTE FALHOU"}\n`)
process.exit(ok ? 0 : 1)
