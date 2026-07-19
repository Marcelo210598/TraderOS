import { NextResponse } from "next/server"

// Rate limiter com dois backends:
//   • Upstash Redis (REST) quando UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//     estão setados — robusto e COMPARTILHADO entre todas as instâncias serverless da
//     Vercel (o abuso não escapa distribuindo requests entre instâncias frias).
//   • Fallback in-memory (fixed window) quando não há Upstash — cada instância tem seu
//     próprio Map; barra loops acidentais e abuso casual, mas não escala multi-instância.
// Sem dependência nova: fala com o Upstash pela REST API (endpoint /pipeline) via fetch.

interface Bucket {
  count: number
  resetAt: number
}

const store = new Map<string, Bucket>()

// Faxina ocasional pra não vazar memória em instâncias muito longevas.
function sweep(now: number) {
  if (store.size < 5000) return
  for (const [key, b] of store) {
    if (b.resetAt <= now) store.delete(key)
  }
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

function hitMemory(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now()
  sweep(now)
  const bucket = store.get(key)

  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 }
  }

  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { ok: true, remaining: limit - bucket.count, retryAfterSec: 0 }
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

// Fixed window no Redis: INCR conta; PEXPIRE ... NX arma a janela só na 1ª vez
// (não estende a cada hit); PTTL devolve quanto falta pra resetar. Uma ida só.
async function hitRedis(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const rk = `rl:${key}`
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", rk],
      ["PEXPIRE", rk, windowSec * 1000, "NX"],
      ["PTTL", rk],
    ]),
    // O rate limit nunca pode pendurar a request do usuário.
    signal: AbortSignal.timeout(1500),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)

  const data = (await res.json()) as Array<{ result?: number; error?: string }>
  const count = Number(data[0]?.result ?? 0)
  const ttlMs = Number(data[2]?.result ?? windowSec * 1000)
  const ok = count <= limit

  return {
    ok,
    remaining: Math.max(0, limit - count),
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowSec * 1000) / 1000)),
  }
}

/**
 * Consome 1 do bucket `key`. Permite até `limit` acessos por janela de `windowSec`.
 * Usa Upstash Redis se configurado; senão, in-memory. NUNCA lança — se o Redis falhar,
 * degrada pro in-memory (não derruba a request por causa do limiter).
 */
export async function hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      return await hitRedis(key, limit, windowSec)
    } catch {
      return hitMemory(key, limit, windowSec)
    }
  }
  return hitMemory(key, limit, windowSec)
}

/** Extrai um identificador de IP da request (best-effort, atrás do proxy da Vercel). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

/**
 * Helper pronto: se estourar o limite, devolve a resposta 429; senão, null (segue o fluxo).
 * Uso: `const limited = await enforce(...); if (limited) return limited`
 */
export async function enforce(key: string, limit: number, windowSec: number): Promise<NextResponse | null> {
  const res = await hit(key, limit, windowSec)
  if (res.ok) return null
  return NextResponse.json(
    { error: "Muitas requisições. Tente novamente em instantes." },
    { status: 429, headers: { "Retry-After": String(res.retryAfterSec) } }
  )
}
