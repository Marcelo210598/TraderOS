import { LUCID } from "./lucid"
import { TAMANHOS, type Mesa, type Tamanho } from "./types"

export * from "./types"

export const MESAS: Mesa[] = [LUCID]

export const getMesa = (slug: string) => MESAS.find((m) => m.slug === slug)

/** Link do botão "ver no site": afiliado (se houver) senão o oficial. */
export const linkDaMesa = (m: Mesa) => m.linkAfiliado ?? m.urlOficial

/** Lê `?tamanho=` com segurança (só aceita 25/50/100/150; padrão 50K). */
export const parseTamanho = (raw: string | string[] | undefined): Tamanho => {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return (TAMANHOS as readonly number[]).includes(n) ? (n as Tamanho) : 50
}

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`
