import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).$executeRawUnsafe(
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe DECIMAL(10,2);"
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).$executeRawUnsafe(
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae DECIMAL(10,2);"
  )

  return NextResponse.json({ ok: true, message: "Colunas mfe e mae adicionadas em trades." })
}
