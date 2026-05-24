import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Endpoint de migração única — delete após usar
const SECRET = process.env.MIGRATION_SECRET ?? "traderos-migrate-2026"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get("secret") !== SECRET) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    // Adiciona coluna accountLabel se não existir
    await prisma.$executeRawUnsafe(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS "accountLabel" TEXT NOT NULL DEFAULT 'PA'`
    )

    // Verifica se funcionou
    const cols = await prisma.$queryRaw<{column_name: string}[]>`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'trades' AND column_name = 'accountLabel'
    `

    return NextResponse.json({
      ok: true,
      columnExists: cols.length > 0,
      message: cols.length > 0 ? "Coluna accountLabel adicionada/confirmada!" : "Algo deu errado"
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
