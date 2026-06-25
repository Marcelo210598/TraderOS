import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { fetchAdminUsers } from "@/lib/admin"
import { z } from "zod"

// Garante que só ADMIN acessa. Retorna a sessão se ok, senão um NextResponse de erro.
async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) }
  }
  return { session }
}

// GET /api/admin/users?q=termo  → busca usuários por email/nome (máx 50)
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const q = req.nextUrl.searchParams.get("q") ?? ""
  const users = await fetchAdminUsers(q)
  return NextResponse.json({ users })
}

const patchSchema = z.object({
  userId: z.string().min(1),
  plan: z.enum(["FREE", "TRADER", "PRO"]),
})

// PATCH /api/admin/users  { userId, plan }  → altera o plano de um usuário
export async function PATCH(req: NextRequest) {
  const { session, error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
  }

  const { userId, plan } = parsed.data

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  })
  if (!target) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
  }

  // Trava de segurança: o admin não pode se auto-rebaixar e perder o acesso ao painel.
  if (target.id === session!.user.id && plan !== "PRO") {
    return NextResponse.json(
      { error: "Você não pode rebaixar seu próprio acesso aqui." },
      { status: 400 }
    )
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { plan },
    select: { id: true, plan: true },
  })

  return NextResponse.json({ user: updated })
}
