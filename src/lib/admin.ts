import { prisma } from "@/lib/prisma"

export type Plan = "FREE" | "TRADER" | "PRO"

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
