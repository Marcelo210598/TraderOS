import { APEX } from "./apex"
import { FFF } from "./fff"
import { LUCID } from "./lucid"
import { TRADEIFY } from "./tradeify"
import { TAMANHOS, type Celula, type DadosTamanho, type Mesa, type Plano, type Tamanho } from "./types"

export * from "./types"

export const MESAS: Mesa[] = [LUCID, FFF, APEX, TRADEIFY]

export const getMesa = (slug: string) => MESAS.find((m) => m.slug === slug)

/** Link do botão "ver no site": afiliado (se houver) senão o oficial. */
export const linkDaMesa = (m: Mesa) => m.linkAfiliado ?? m.urlOficial

/** Lê `?tamanho=` com segurança (só aceita 25/50/100/150; padrão 50K). */
export const parseTamanho = (raw: string | string[] | undefined): Tamanho => {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return (TAMANHOS as readonly number[]).includes(n) ? (n as Tamanho) : 50
}

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`

/** Dados do plano no tamanho pedido, ou null se o plano não existe nesse tamanho. */
export const dadosDoTamanho = (p: Plano, t: Tamanho): DadosTamanho | null => p.tamanhos[t] ?? null

/** Resolve uma célula (lista fixa ou por tamanho) pro tamanho pedido. null = sem valor pra esse tamanho. */
export const celulaDoTamanho = (c: Celula | undefined, t: Tamanho): string[] | null => {
  if (!c) return null
  if (Array.isArray(c)) return c
  return c[t] ?? null
}
