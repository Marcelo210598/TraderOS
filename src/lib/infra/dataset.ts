// Dataset do usuário (E7-4, D-B4/D-B5): `registerImport` leva um arquivo para dentro do sistema (pipeline → RawFileStorage → ImportSourceStore) e `makeContext` o traz de volta como o `ctx` que as capacidades esperam,
// a partir de um PIN (`DatasetPin`: quais arquivos e quais preferências de análise). O ctx é montado SEMPRE pelo mesmo caminho (na consulta original e na regeneração), por isso o `evidenceRef` se reproduz.
// Fail-closed: a linha guardada precisa reproduzir o `importId` (senão IMPORT_MISMATCH e nenhum ctx). O montador NÃO inventa risco (stop/R): o arquivo não traz stop e stops do usuário seriam outra fonte (limite declarado).
// O valor do sal só existe dentro do `ctx` devolvido (uso do servidor); erros são `{ ok:false, code }` — sem mensagem, caminho, nome de arquivo nem conteúdo. Nada lança.
// Não importa `ingest/salt.ts` (o provider vem tipado pelo próprio `ImportContext`) nem o contrato do agente: os portões de aprovação do P1/SC11/SG1 seguem fechados.
import type { ImportRecord } from "../domain/canonical.ts"
import type { VerifySourceOptions } from "../evidence/verify-source.ts"
import { ExitReasonMapError, validateExitReasonMap } from "../ingest/exit-reason.ts"
import { runImportPipeline } from "../ingest/pipeline.ts"
import type { ImportContext } from "../ingest/types.ts"
import { toAnalyticsTrades, type AnalyticsTrade } from "../metrics/index.ts"
import { parseDatasetPin } from "./dataset-pin.ts"
import { sha256Hex } from "./hash.ts"
import { parseImportContext, type ImportContextRecord, type ImportSourceRow, type ImportSourceStore } from "./import-source-store.ts"
import { MAX_RAW_FILE_BYTES, isValidUserId, type RawFileStorage } from "./raw-file-storage.ts"

/** O provider de sal como o pipeline o espera (sem importar o módulo do sal). */
export type DatasetSaltProvider = NonNullable<ImportContext["salt"]>["provider"]
export interface DatasetDeps { readonly rawStorage: RawFileStorage; readonly importStore: ImportSourceStore; readonly salt: DatasetSaltProvider }

export type DatasetCode =
  | "INVALID_ARGS" | "SALT_REQUIRED" | "TOO_LARGE" | "PIPELINE_FAILED" | "CONTEXT_CONFLICT" | "STORAGE_ERROR"
  | "IMPORT_NOT_REGISTERED" | "IMPORT_CORRUPT" | "FILE_NOT_AVAILABLE" | "FILE_CORRUPT" | "IMPORT_MISMATCH" | "PIN_CONTEXT_MISMATCH"
export interface DatasetFailure { readonly ok: false; readonly code: DatasetCode }
const fail = (code: DatasetCode): DatasetFailure => ({ ok: false, code })
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

/** O que as capacidades recebem (forma de `MetricsQueryContext`). `aliases` é da CONVERSA e o orquestrador acrescenta. */
export interface DatasetContext {
  readonly trades: AnalyticsTrade[]
  readonly importRecords: ImportRecord[]
  /** saltId vigente. */
  readonly refEpoch: string
  readonly accountRefSalt: string
  readonly analysis: { timeZone?: string; minSample?: number }
  readonly source: { files: Record<string, Uint8Array>; options: VerifySourceOptions }
}

const ENCODER = new TextEncoder()
/** UTF-8 estrito e SEM tirar o BOM: o texto volta idêntico ao que gerou o `fileSha256`. */
const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** O contexto que o pipeline recebe — o MESMO na gravação e na regeneração. */
function pipelineContext(context: ImportContextRecord, fileName: string | null, deps: DatasetDeps, userId: string): ImportContext {
  return { ...(context as ImportContext), ...(fileName !== null ? { fileName } : {}), salt: { provider: deps.salt, userId } }
}

export interface RegisterImportRequest {
  readonly userId: string
  /** O texto do arquivo (UTF-8; o BOM, se houver, faz parte). */
  readonly text: string
  readonly context?: ImportContextRecord
  readonly fileName?: string
}
export interface RegisterImportResult { readonly ok: true; readonly created: boolean; readonly fileSha256: string; readonly importId: string; readonly trades: number; readonly rejectedRows: number }

export async function registerImport(deps: DatasetDeps, req: RegisterImportRequest): Promise<RegisterImportResult | DatasetFailure> {
  try {
    if (!isRecord(req) || Object.keys(req).some((k) => !["userId", "text", "context", "fileName"].includes(k))) return fail("INVALID_ARGS")
    const { userId, text } = req
    if (!isValidUserId(userId) || typeof text !== "string" || text === "") return fail("INVALID_ARGS")
    const context = parseImportContext(req.context ?? {})
    if (context === null) return fail("INVALID_ARGS")
    const fileName = req.fileName === undefined ? null : req.fileName
    if (fileName !== null && (typeof fileName !== "string" || fileName === "" || fileName.length > 255 || fileName.includes("\u0000"))) return fail("INVALID_ARGS")
    try { validateExitReasonMap(context.exitReasonMap as ImportContext["exitReasonMap"]) } catch (e) { if (e instanceof ExitReasonMapError) return fail("INVALID_ARGS"); throw e }
    if (deps.salt.current(userId) === null) return fail("SALT_REQUIRED")

    const bytes = ENCODER.encode(text)
    if (bytes.byteLength > MAX_RAW_FILE_BYTES) return fail("TOO_LARGE")
    const fileSha256 = sha256Hex(bytes)
    const run = runImportPipeline(text, pipelineContext(context, fileName, deps, userId))
    if (run.importRecord === null || run.trades.length === 0) return fail("PIPELINE_FAILED")

    // 1º o arquivo (endereçado por conteúdo e idempotente), 2º a linha: se a linha falhar sobra só o arquivo, inofensivo.
    const stored = await deps.rawStorage.put(userId, fileSha256, bytes)
    if (!stored.ok) return fail(stored.code === "TOO_LARGE" ? "TOO_LARGE" : stored.code === "INVALID_ARGS" ? "INVALID_ARGS" : "STORAGE_ERROR")
    const rec = run.importRecord
    const put = await deps.importStore.put({ userId, fileSha256, importId: rec.importId, fileName, fileBytes: rec.fileBytes, hasBom: rec.hasBom, lineEnding: rec.lineEnding, hashBasis: "UTF8_TEXT", context, createdAt: new Date().toISOString() })
    if (!put.ok) return fail(put.code === "CONFLICT" ? "CONTEXT_CONFLICT" : put.code === "INVALID_ARGS" ? "INVALID_ARGS" : "STORAGE_ERROR")
    return { ok: true, created: put.created, fileSha256, importId: rec.importId, trades: run.trades.length, rejectedRows: run.rejected.length }
  } catch {
    return fail("STORAGE_ERROR")
  }
}

export async function makeContext(deps: DatasetDeps, req: { readonly userId: string; readonly pin: unknown }): Promise<{ readonly ok: true; readonly ctx: DatasetContext } | DatasetFailure> {
  try {
    if (!isRecord(req) || !isValidUserId(req.userId)) return fail("INVALID_ARGS")
    const userId = req.userId
    const pin = parseDatasetPin(req.pin) // forma canônica: sources ordenado por sha
    if (pin === null) return fail("INVALID_ARGS")
    const cur = deps.salt.current(userId)
    if (cur === null) return fail("SALT_REQUIRED")

    // 1) as linhas de TODOS os sources antes de ler qualquer arquivo (e a compatibilidade do par global foldPolicy/exitReasonMap)
    const rows: ImportSourceRow[] = []
    for (const s of pin.sources) {
      const got = await deps.importStore.get(userId, s.fileSha256)
      if (!got.ok) return fail(got.code === "NOT_FOUND" ? "IMPORT_NOT_REGISTERED" : got.code === "CORRUPT" ? "IMPORT_CORRUPT" : "STORAGE_ERROR")
      rows.push(got.row)
    }
    const pair = (c: ImportContextRecord): string => JSON.stringify({ foldPolicy: c.foldPolicy ?? null, exitReasonMap: c.exitReasonMap ?? null })
    if (rows.some((r) => pair(r.context) !== pair(rows[0].context))) return fail("PIN_CONTEXT_MISMATCH")

    // 2) arquivo → pipeline → conferência do importId
    const trades: AnalyticsTrade[] = []
    const importRecords: ImportRecord[] = []
    const files: Record<string, Uint8Array> = {}
    for (const row of rows) {
      const raw = await deps.rawStorage.get(userId, row.fileSha256)
      if (!raw.ok) return fail(raw.code === "NOT_FOUND" ? "FILE_NOT_AVAILABLE" : raw.code === "CORRUPT" ? "FILE_CORRUPT" : "STORAGE_ERROR")
      let text: string
      try { text = DECODER.decode(raw.bytes) } catch { return fail("FILE_CORRUPT") }
      const run = runImportPipeline(text, pipelineContext(row.context, row.fileName, deps, userId))
      if (run.importRecord === null || run.importRecord.importId !== row.importId) return fail("IMPORT_MISMATCH")
      trades.push(...toAnalyticsTrades(run.trades))
      importRecords.push(run.importRecord)
      files[row.importId] = raw.bytes
    }

    const first = rows[0].context
    const options: VerifySourceOptions = {
      salt: { provider: deps.salt, userId },
      ...(first.foldPolicy !== undefined ? { foldPolicy: first.foldPolicy as ImportContext["foldPolicy"] } : {}),
      ...(first.exitReasonMap !== undefined ? { exitReasonMap: first.exitReasonMap as ImportContext["exitReasonMap"] } : {}),
    }
    return { ok: true, ctx: { trades, importRecords, refEpoch: cur.saltId, accountRefSalt: cur.salt, analysis: { ...pin.analysis }, source: { files, options } } }
  } catch {
    return fail("STORAGE_ERROR")
  }
}
