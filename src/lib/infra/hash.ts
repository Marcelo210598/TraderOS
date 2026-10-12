// Adaptador de hash (infra/servidor): é o ÚNICO lugar que conhece `node:crypto`.
// O domínio e as métricas continuam puros; quem precisa de identidade/prova chama estas funções.
// Sem criptografia manual: SHA-256 da plataforma.

import { createHash, randomBytes } from "node:crypto"

/** `bytes` bytes aleatórios criptográficos, em hex minúsculo (2×bytes chars). Fonte única de aleatoriedade (CSPRNG da plataforma). */
export const randomHex = (bytes: number): string => randomBytes(bytes).toString("hex")

/** SHA-256 em hex minúsculo (64 chars). Strings entram como UTF-8. */
export const sha256Hex = (input: string | Uint8Array): string => createHash("sha256").update(input).digest("hex")

/**
 * JSON canônico: chaves de objeto ordenadas, `undefined` omitido, sem espaços. Mesmo conteúdo ⇒ mesma string.
 * Só aceita JSON puro (número finito, string, boolean, null, array, objeto simples); qualquer outra coisa lança erro
 * em vez de gerar um hash silenciosamente instável.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value)
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: número não finito")
      return JSON.stringify(Object.is(value, -0) ? 0 : value)
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`
      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) throw new TypeError("canonicalJson: objeto não simples")
      const obj = value as Record<string, unknown>
      const parts = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      return `{${parts.join(",")}}`
    }
    default:
      throw new TypeError(`canonicalJson: tipo não suportado (${typeof value})`)
  }
}

/** SHA-256 do JSON canônico. */
export const hashCanonical = (value: unknown): string => sha256Hex(canonicalJson(value))
