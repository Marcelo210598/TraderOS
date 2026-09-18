import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const schema = z.object({ id: z.string().min(1).max(40) })

// Marca um SectionTour como visto pro usuário logado — server-side, pra nao
// repetir o guia toda vez que ele abre o app num navegador/dispositivo novo
// (localStorage sozinho nao acompanha a conta, so o browser).
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { seenTours: true },
  })
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })

  if (!user.seenTours.includes(parsed.data.id)) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { seenTours: [...user.seenTours, parsed.data.id] },
    })
  }

  return NextResponse.json({ ok: true })
}
