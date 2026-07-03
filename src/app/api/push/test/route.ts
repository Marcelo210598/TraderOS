import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { sendPushToUser } from "@/lib/push"

// Envia uma push de teste para os dispositivos do próprio usuário.
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

    const { sent, devices } = await sendPushToUser(session.user.id, {
      title: "🔔 MeuTrade",
      body: "Notificações ativas! Você vai receber os trades do bot aqui.",
      url: "/notificacoes",
    })

    if (devices === 0) {
      return NextResponse.json({ error: "Nenhum dispositivo inscrito. Ative os alertas primeiro." }, { status: 400 })
    }

    return NextResponse.json({ devices, sent })
  } catch (err) {
    console.error("[POST /api/push/test]", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
