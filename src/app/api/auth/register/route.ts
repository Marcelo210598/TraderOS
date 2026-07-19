import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hash } from "bcryptjs"
import { z } from "zod"
import { sendWelcomeEmail } from "@/lib/email"
import { notifyAdminsNewSignup } from "@/lib/admin"
import { sendCapiEvent } from "@/lib/fbcapi"
import { sendGa4Event } from "@/lib/ga4"
import { enforce, clientIp } from "@/lib/rate-limit"

const schema = z.object({
  name: z.string().min(2).max(80),
  // normaliza o email (trim + minusculo) p/ evitar duplicidade e falha de login por case
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8).max(100),
})

export async function POST(req: NextRequest) {
  // Anti brute-force/enumeração: no máx 8 cadastros por IP a cada 10 min.
  const limited = await enforce(`register:${clientIp(req)}`, 8, 600)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
  }

  const { name, email, password } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: "Email já cadastrado" }, { status: 409 })
  }

  const hashed = await hash(password, 12)
  const created = await prisma.user.create({
    data: { name, email, password: hashed },
  })

  // Email de boas-vindas — não bloqueia o cadastro se falhar
  sendWelcomeEmail(email, name).catch(() => null)

  // Avisa admins por push (não bloqueia o cadastro)
  notifyAdminsNewSignup({ email, name }).catch(() => null)

  // Retargeting: cadastro por email/senha também conta como Lead
  sendCapiEvent({ eventName: "Lead", email }).catch(() => null)
  sendGa4Event({ eventName: "generate_lead", userKey: created.id }).catch(() => null)

  return NextResponse.json({ ok: true }, { status: 201 })
}
