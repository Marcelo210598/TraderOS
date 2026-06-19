import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Registra (ou atualiza) a inscrição de push deste dispositivo para o usuário logado.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

    const body = await req.json().catch(() => null)
    const endpoint = body?.endpoint as string | undefined
    const p256dh = body?.keys?.p256dh as string | undefined
    const authKey = body?.keys?.auth as string | undefined

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).pushSubscription.upsert({
      where: { endpoint },
      create: { userId: session.user.id, endpoint, p256dh, auth: authKey },
      update: { userId: session.user.id, p256dh, auth: authKey },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[push/subscribe POST]", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

// Remove a inscrição deste dispositivo (ao desativar notificações).
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

    const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string }
    if (!endpoint) return NextResponse.json({ error: "endpoint obrigatório" }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).pushSubscription.deleteMany({ where: { endpoint, userId: session.user.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[push/subscribe DELETE]", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
