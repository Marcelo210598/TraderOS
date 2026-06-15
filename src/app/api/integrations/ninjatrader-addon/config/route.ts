import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import { generateRawApiKey, hashApiKey, apiKeyPrefix } from "@/lib/apikey"

// A chave é armazenada APENAS como hash SHA-256 (ver @/lib/apikey e o schema).
// Como o hash é irreversível, não dá pra re-exibir uma chave já criada — então cada
// download gera uma chave nova, rotacionando a anterior. O sync valida pelo mesmo hash.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const rawKey = generateRawApiKey()

  // Rotaciona: remove chaves antigas do usuário e cria a nova (guardando só o hash)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.deleteMany({ where: { userId: session.user.id } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.create({
    data: {
      id: crypto.randomUUID(),
      userId: session.user.id,
      key: hashApiKey(rawKey),
      keyPrefix: apiKeyPrefix(rawKey),
    },
  })

  // Devolve a chave CRUA (única vez que ela existe em texto) para o traderos_config.txt
  return new NextResponse(rawKey, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="traderos_config.txt"',
      "Content-Length": Buffer.byteLength(rawKey, "utf8").toString(),
    },
  })
}
