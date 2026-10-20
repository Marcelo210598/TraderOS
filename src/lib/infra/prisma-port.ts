// Porta estrutural mínima do cliente Prisma (E7-13, D-P5): é TUDO o que os adaptadores relacionais (sal, importação, conversa) enxergam do banco. O cliente real (`PrismaClient`) é INJETADO por quem monta a
// aplicação; nada aqui nem nos adaptadores importa `@prisma/client` ou `src/lib/prisma.ts` (a infra fica sem dependência de fornecedor e testável com um cliente de mentira).
//   · `attempt` roda uma chamada ao banco SEM deixar nada escapar (rejeição OU exceção síncrona) e diz se foi violação de unicidade (`code === "P2002"`); a mensagem/SQL do erro nunca sai daqui.
//   · `countOf` valida a resposta de updateMany/deleteMany (`{ count: inteiro ≥ 0 }`); qualquer outra forma é tratada como falha pelo chamador.
// Sem imports, sem rede, sem ambiente.
export type Where = Readonly<Record<string, unknown>>
export interface PrismaModelPort {
  findUnique(args: { where: Where }): Promise<unknown>
  findMany(args: { where?: Where; select?: Readonly<Record<string, boolean>>; distinct?: readonly string[]; orderBy?: Readonly<Record<string, "asc" | "desc">> }): Promise<unknown>
  create(args: { data: Readonly<Record<string, unknown>> }): Promise<unknown>
  updateMany(args: { where: Where; data: Readonly<Record<string, unknown>> }): Promise<unknown>
  deleteMany(args: { where: Where }): Promise<unknown>
}
export interface PrismaPort {
  readonly aiUserSalt: PrismaModelPort
  readonly aiImportSource: PrismaModelPort
  readonly aiConversation: PrismaModelPort
  readonly aiConversationDelta: PrismaModelPort
  $transaction<T>(fn: (tx: PrismaPort) => Promise<T>): Promise<T>
}

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const METHODS = ["findUnique", "findMany", "create", "updateMany", "deleteMany"] as const
const MODELS = ["aiUserSalt", "aiImportSource", "aiConversation", "aiConversationDelta"] as const
export function isPrismaPort(x: unknown): x is PrismaPort {
  return isRecord(x) && typeof x.$transaction === "function" && MODELS.every((m) => isRecord(x[m]) && METHODS.every((f) => typeof (x[m] as Record<string, unknown>)[f] === "function"))
}
export const isIsoString = (x: unknown): x is string => typeof x === "string" && x.length >= 10 && x.length <= 40 && !Number.isNaN(Date.parse(x))
export const isUniqueViolation = (e: unknown): boolean => isRecord(e) && e.code === "P2002"
export const countOf = (r: unknown): number | null => (isRecord(r) && typeof r.count === "number" && Number.isInteger(r.count) && r.count >= 0 ? r.count : null)

export type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly unique: boolean; /** Só para o chamador distinguir erros PRÓPRIOS (nunca vai a um resultado). */ readonly error: unknown }
export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, unique: isUniqueViolation(error), error }
  }
}
