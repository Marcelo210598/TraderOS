import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let keys = await (prisma as any).userApiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { key: true },
    take: 1,
  })

  if (keys.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (prisma as any).userApiKey.count({ where: { userId: session.user.id } })
    if (count < 3) {
      const newKey = `traderos_${crypto.randomBytes(24).toString("hex")}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (prisma as any).userApiKey.create({
        data: { id: crypto.randomUUID(), userId: session.user.id, key: newKey },
        select: { key: true },
      })
      keys = [created]
    } else {
      return NextResponse.json({ error: "Limite de API Keys atingido" }, { status: 400 })
    }
  }

  const apiKey = keys[0].key

  return new NextResponse(apiKey, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="traderos_config.txt"',
      "Content-Length": Buffer.byteLength(apiKey, "utf8").toString(),
    },
  })
}
