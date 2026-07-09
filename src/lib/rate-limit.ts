import { NextResponse } from "next/server"

// Rate limiter in-memory (fixed window). Simples e sem dependência/infra externa.
//
// Limitação: em serverless (Vercel), cada instância tem seu próprio Map. Instâncias
// quentes reaproveitam o estado entre requests, então isto barra loops acidentais e
// abuso casual — que é o risco principal aqui (custo de tokens de IA, brute force leve).
// Para proteção robusta multi-instância, plugar Upstash Redis depois (o código chamador
// não muda: só a implementação de `hit` passa a usar Redis).

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

/**
 * Consome 1 do bucket `key`. Permite até `limit` acessos por janela de `windowSec`.
 */
export function hit(key: string, limit: number, windowSec: number): RateLimitResult {
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

/** Extrai um identificador de IP da request (best-effort, atrás do proxy da Vercel). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

/**
 * Helper pronto: se estourar o limite, devolve a resposta 429; senão, null (segue o fluxo).
 * Uso: `const limited = enforce(...); if (limited) return limited`
 */
export function enforce(key: string, limit: number, windowSec: number): NextResponse | null {
  const res = hit(key, limit, windowSec)
  if (res.ok) return null
  return NextResponse.json(
    { error: "Muitas requisições. Tente novamente em instantes." },
    { status: 429, headers: { "Retry-After": String(res.retryAfterSec) } }
  )
}
