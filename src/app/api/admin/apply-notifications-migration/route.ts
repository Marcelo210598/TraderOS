import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")
  if (secret !== "traderos-notifications-2026") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "notifications" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'WEEKLY_SUMMARY',
      "title" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "read" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx"
    ON "notifications"("userId", "createdAt")
  `)

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `)
  } catch {
    // constraint já existe, ignora
  }

  const check = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'notifications'
    ) as exists
  `

  return NextResponse.json({
    ok: true,
    tableExists: check[0]?.exists ?? false,
    message: "Tabela notifications criada/confirmada!",
  })
}
