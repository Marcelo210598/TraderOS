import { prisma } from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push"

export type Plan = "FREE" | "TRADER" | "PRO"

// Avisa TODOS os admins por push quando alguém novo se cadastra.
// Nunca lança — é chamada de dentro de fluxos de cadastro (não pode quebrá-los).
export async function notifyAdminsNewSignup(user: {
  email?: string | null
  name?: string | null
}): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    })
    if (admins.length === 0) return

    const nome = user.name?.trim() || "Novo usuário"
    const email = user.email ?? "sem email"

    await Promise.all(
      admins.map((a) =>
        sendPushToUser(a.id, {
          title: "🎯 Novo cadastro no TraderOS",
          body: `${nome} · ${email} — toque para liberar acesso`,
          url: "/admin",
        })
      )
    )
  } catch (err) {
    console.error("[notifyAdminsNewSignup]", err)
  }
}

export interface AdminUserDTO {
  id: string
  name: string | null
  email: string
  image: string | null
  plan: Plan
  role: string
  createdAt: string // ISO
  tradesCount: number
  lastTradeAt: string | null // ISO ou null
  loginMethods: string[] // ex: ["Google"], ["Email"], ["Google", "Email"]
}

// Busca usuários para o painel admin (com infos enriquecidas).
// Compartilhado entre a página (server) e a rota de API para não duplicar lógica.
export async function fetchAdminUsers(q: string): Promise<AdminUserDTO[]> {
  const term = q.trim()
  const where = term
    ? {
        OR: [
          { email: { contains: term, mode: "insensitive" as const } },
          { name: { contains: term, mode: "insensitive" as const } },
        ],
      }
    : {}

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      plan: true,
      role: true,
      createdAt: true,
      password: true, // usado só p/ derivar "loga por Email" (NÃO é devolvido ao client)
      accounts: { select: { provider: true } },
      _count: { select: { trades: true } },
      trades: { select: { date: true }, orderBy: { date: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return users.map((u) => {
    const providers = u.accounts.map((a) =>
      a.provider === "google" ? "Google" : a.provider
    )
    const loginMethods = Array.from(
      new Set([...providers, ...(u.password ? ["Email"] : [])])
    )

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      plan: u.plan as Plan,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      tradesCount: u._count.trades,
      lastTradeAt: u.trades[0]?.date.toISOString() ?? null,
      loginMethods,
    }
  })
}
