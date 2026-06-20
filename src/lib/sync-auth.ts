import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashApiKey } from "@/lib/apikey"

/** Valida a API Key do header e devolve o userId (ou null). Usado pelos endpoints de sync. */
export async function authSync(req: NextRequest): Promise<{ userId: string; keyId: string } | null> {
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("X-API-Key")
  if (!apiKey) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec = await (prisma as any).userApiKey.findUnique({
    where: { key: hashApiKey(apiKey) },
    select: { id: true, userId: true },
  })
  return rec ? { userId: rec.userId, keyId: rec.id } : null
}

/** Lê o body como JSON ou form-encoded (MQL5 WebRequest usa form). `numeric` = campos a converter pra Number. */
export async function readBody(req: NextRequest, numeric: string[]): Promise<Record<string, unknown> | null> {
  const ct = req.headers.get("content-type") ?? ""
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await req.text())
    const raw: Record<string, unknown> = {}
    params.forEach((v, k) => { raw[k] = numeric.includes(k) ? Number(v) : v })
    return raw
  }
  return req.json().catch(() => null)
}
