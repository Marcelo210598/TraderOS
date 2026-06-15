import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"

// A chave é armazenada APENAS como hash SHA-256 (ver schema: key = SHA-256 da raw).
// Como o hash é irreversível, não dá pra re-exibir uma chave já criada — então cada
// download gera uma chave nova, rotacionando a anterior. O sync valida pelo hash.
function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const rawKey = `traderos_${crypto.randomBytes(24).toString("hex")}`

  // Rotaciona: remove chaves antigas do usuário e cria a nova (guardando só o hash)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.deleteMany({ where: { userId: session.user.id } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).userApiKey.create({
    data: { id: crypto.randomUUID(), userId: session.user.id, key: hashKey(rawKey) },
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
