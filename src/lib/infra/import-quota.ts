// Cota de arquivos importados por plano (E7-12, D-Q1…D-Q8): o invólucro que o servidor chama NO LUGAR de `registerImport` quando conhece o plano do usuário. Não altera dataset.ts.
//   · confere ANTES de gravar qualquer coisa: arquivos distintos (por sha) e soma dos bytes ORIGINAIS (`fileBytes` das linhas do ImportSourceStore); excedeu ⇒ `QUOTA_EXCEEDED` com `resource`, `limit`, `used`
//     e `suggestedPlan` (o menor plano acima do atual cuja cota comporta o pedido; null se nenhum), SEM texto, nome de arquivo ou userId, e nada é gravado.
//   · o MESMO arquivo reenviado (sha já registrado) não consome cota: passa direto ao registerImport (idempotente). Linha corrompida conta como 1 arquivo e 0 bytes.
//   · fail-closed: plano inválido ⇒ INVALID_ARGS sem I/O; falha ao ler o uso ⇒ STORAGE_ERROR sem gravar. Os erros do registerImport passam com o MESMO código.
//   · rebaixar de plano não apaga nada; apagar um arquivo (E7-7) libera a cota (a conta vem das linhas).
// LIMITE DECLARADO (cota "macia"): sem transação, N envios SIMULTÂNEOS de arquivos diferentes podem ultrapassar a cota por até N−1 arquivos (o seguinte já é barrado); arquivos órfãos no RawFileStorage (a linha falhou
// depois do put) não entram na conta; arquivo acima de 25 MiB segue para o registerImport (TOO_LARGE). Nada lança; resultados tipados.
import { PLAN_IMPORT_QUOTAS, type ImportQuota, type PlanKey } from "../plans.ts"
import { registerImport, type DatasetDeps, type DatasetFailure, type RegisterImportRequest, type RegisterImportResult } from "./dataset.ts"
import { sha256Hex } from "./hash.ts"
import type { ImportSourceStore } from "./import-source-store.ts"
import { MAX_RAW_FILE_BYTES, isValidSha256, isValidUserId } from "./raw-file-storage.ts"

const PLAN_ORDER: readonly PlanKey[] = ["FREE", "TRADER", "PRO"]
const ENCODER = new TextEncoder()
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

export type QuotaTable = Readonly<Record<PlanKey, Readonly<ImportQuota>>>
export interface QuotaOptions {
  /** Só para teste: troca a tabela (o padrão é PLAN_IMPORT_QUOTAS). */
  readonly quotas?: QuotaTable
}
export interface QuotaExceeded {
  readonly ok: false
  readonly code: "QUOTA_EXCEEDED"
  readonly resource: "files" | "bytes"
  readonly limit: number
  readonly used: number
  readonly suggestedPlan: "TRADER" | "PRO" | null
}
export type QuotaFailure = { readonly ok: false; readonly code: "INVALID_ARGS" | "STORAGE_ERROR" }
export interface ImportUsage {
  readonly ok: true
  readonly files: number
  readonly bytes: number
  /** Quantas das linhas estão corrompidas (já contadas em `files`, com 0 bytes). */
  readonly corrupt: number
  readonly limits: ImportQuota
  /** Nunca negativo. */
  readonly remaining: ImportQuota
}

const fail = (code: "INVALID_ARGS" | "STORAGE_ERROR"): QuotaFailure => ({ ok: false, code })
const planOf = (plan: unknown, table: QuotaTable): PlanKey | null => (typeof plan === "string" && (PLAN_ORDER as readonly string[]).includes(plan) && Object.hasOwn(table, plan) ? (plan as PlanKey) : null)
const tableOf = (options: QuotaOptions | undefined): QuotaTable => options?.quotas ?? PLAN_IMPORT_QUOTAS

/** O uso atual do usuário a partir das linhas; null se o store falha ou devolve forma inesperada (fail-closed). */
async function usageOf(store: ImportSourceStore, userId: string): Promise<{ files: number; bytes: number; corrupt: number } | null> {
  try {
    const r: unknown = await store.list(userId)
    if (!isRecord(r) || r.ok !== true || !Array.isArray(r.rows) || typeof r.corrupt !== "number" || !Number.isInteger(r.corrupt) || r.corrupt < 0) return null
    let bytes = 0
    for (const row of r.rows) {
      if (!isRecord(row) || typeof row.fileBytes !== "number" || !Number.isInteger(row.fileBytes) || row.fileBytes < 0) return null
      bytes += row.fileBytes
    }
    return { files: r.rows.length + r.corrupt, bytes, corrupt: r.corrupt }
  } catch {
    return null
  }
}

export async function registerImportWithQuota(deps: DatasetDeps, req: RegisterImportRequest, plan: unknown, options?: QuotaOptions): Promise<RegisterImportResult | DatasetFailure | QuotaExceeded | QuotaFailure> {
  try {
    const table = tableOf(options)
    const current = planOf(plan, table)
    if (current === null || !isRecord(req) || !isValidUserId(req.userId) || !isRecord(deps) || !isRecord(deps.importStore) || typeof deps.importStore.list !== "function" || typeof deps.importStore.get !== "function") return fail("INVALID_ARGS")
    const text = req.text
    // sem texto utilizável, ou grande demais: não há o que contar — o registerImport devolve o erro dele (INVALID_ARGS/TOO_LARGE) sem gravar
    if (typeof text !== "string" || text === "") return await registerImport(deps, req)
    const bytes = ENCODER.encode(text)
    if (bytes.byteLength > MAX_RAW_FILE_BYTES) return await registerImport(deps, req)
    const fileSha256 = sha256Hex(bytes)
    if (!isValidSha256(fileSha256)) return fail("STORAGE_ERROR")

    // o MESMO arquivo já registrado: idempotente, não consome cota (linha corrompida também: o arquivo já existe)
    let known = false
    try {
      const got = await deps.importStore.get(req.userId, fileSha256)
      if (got.ok || got.code === "CORRUPT") known = true
      else if (got.code !== "NOT_FOUND") return fail("STORAGE_ERROR")
    } catch {
      return fail("STORAGE_ERROR")
    }
    if (known) return await registerImport(deps, req)

    const usage = await usageOf(deps.importStore, req.userId)
    if (usage === null) return fail("STORAGE_ERROR")
    const quota = table[current]
    const resource = usage.files + 1 > quota.files ? "files" : usage.bytes + bytes.byteLength > quota.bytes ? "bytes" : null
    if (resource !== null) {
      const suggested = PLAN_ORDER.slice(PLAN_ORDER.indexOf(current) + 1).find((p) => usage.files + 1 <= table[p].files && usage.bytes + bytes.byteLength <= table[p].bytes)
      return { ok: false, code: "QUOTA_EXCEEDED", resource, limit: quota[resource], used: usage[resource], suggestedPlan: suggested === "TRADER" || suggested === "PRO" ? suggested : null }
    }
    return await registerImport(deps, req)
  } catch {
    return fail("STORAGE_ERROR")
  }
}

/** O uso do usuário contra a cota do plano (para a UI mostrar "você usou X de Y"). */
export async function getImportUsage(importStore: ImportSourceStore, userId: unknown, plan: unknown, options?: QuotaOptions): Promise<ImportUsage | QuotaFailure> {
  try {
    const table = tableOf(options)
    const current = planOf(plan, table)
    if (current === null || !isValidUserId(userId) || !isRecord(importStore) || typeof importStore.list !== "function") return fail("INVALID_ARGS")
    const usage = await usageOf(importStore, userId)
    if (usage === null) return fail("STORAGE_ERROR")
    const limits = table[current]
    return { ok: true, files: usage.files, bytes: usage.bytes, corrupt: usage.corrupt, limits: { files: limits.files, bytes: limits.bytes }, remaining: { files: Math.max(0, limits.files - usage.files), bytes: Math.max(0, limits.bytes - usage.bytes) } }
  } catch {
    return fail("STORAGE_ERROR")
  }
}
