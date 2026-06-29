import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import { generateRawApiKey, hashApiKey, apiKeyPrefix } from "@/lib/apikey"
import { checkPlanLimit } from "@/lib/plan-guard"
import type { PlanKey } from "@/lib/plans"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys = await (prisma as any).userApiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    // key (hash) nunca é retornada — apenas keyPrefix para display
    select: { id: true, name: true, keyPrefix: true, lastUsed: true, createdAt: true },
  })

  return NextResponse.json(keys)
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // Limite de integrações (API Keys) por plano (Free 0 · Starter 1 · Pro ∞)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = await (prisma as any).userApiKey.count({ where: { userId: session.user.id } })
  const blocked = checkPlanLimit(session.user.plan as PlanKey, "integrations", count)
  if (blocked) return blocked

  const rawKey = generateRawApiKey()
  const keyHash = hashApiKey(rawKey)
  const keyPrefix = apiKeyPrefix(rawKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (prisma as any).userApiKey.create({
    data: {
      id: crypto.randomUUID(),
      userId: session.user.id,
      key: keyHash,       // apenas o hash é persistido
      keyPrefix,          // prefixo para identificação visual
    },
    select: { id: true, name: true, keyPrefix: true, createdAt: true },
  })

  // rawKey é retornada UMA ÚNICA VEZ — nunca será exibida de novo
  return NextResponse.json({ ...created, rawKey }, { status: 201 })
}
