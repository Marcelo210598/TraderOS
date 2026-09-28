// Mini cliente do Upstash Redis (REST) pro monitor das mesas. Mesmo Redis do rate-limit, chaves com prefixo `mesas:`.
// Sem dependência nova: um POST com o comando em JSON. Lança em erro (o cron precisa saber que não gravou).

const url = () => process.env.UPSTASH_REDIS_REST_URL?.trim()
const token = () => process.env.UPSTASH_REDIS_REST_TOKEN?.trim()

export const kvDisponivel = () => !!(url() && token())

async function comando(args: string[]): Promise<unknown> {
  const res = await fetch(url()!, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  const json = (await res.json()) as { result?: unknown; error?: string }
  if (!res.ok || json.error) throw new Error(`Upstash: ${json.error ?? res.status}`)
  return json.result
}

export async function kvGetJson<T>(chave: string): Promise<T | null> {
  const raw = await comando(["GET", chave])
  return typeof raw === "string" ? (JSON.parse(raw) as T) : null
}

export async function kvSetJson(chave: string, valor: unknown): Promise<void> {
  await comando(["SET", chave, JSON.stringify(valor)])
}
