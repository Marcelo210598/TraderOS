import crypto from "crypto"

// ─── Fonte ÚNICA da lógica de API Key ────────────────────────────────────────
// Toda rota que CRIA ou VALIDA uma API key DEVE usar estas funções.
// Não duplique o algoritmo de hash em outro lugar: se a geração e a validação
// usarem hashes diferentes, a key nunca casa e o sync falha com 401 — foi
// exatamente esse o bug de 07/06 (config salvava raw, sync buscava hash).
//
// Contrato (ver prisma/schema.prisma → UserApiKey):
//   - `key`       = SHA-256 hex da raw key (nunca a raw em texto)
//   - `keyPrefix` = primeiros 16 chars da raw (apenas para exibição)
//   - a raw key (`traderos_…`) só existe no momento da criação e é entregue
//     UMA vez ao usuário; não há como recuperá-la depois.

const RAW_PREFIX = "traderos_"

/** Gera uma nova raw API key (o valor que vai no traderos_config.txt). */
export function generateRawApiKey(): string {
  return `${RAW_PREFIX}${crypto.randomBytes(24).toString("hex")}`
}

/** Hash determinístico armazenado no banco e usado para validar no sync. */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex")
}

/** Prefixo de exibição (primeiros 16 chars da raw) — só para o usuário identificar a key. */
export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 16)
}
