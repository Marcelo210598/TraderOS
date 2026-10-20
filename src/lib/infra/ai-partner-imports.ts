// Tratadores PUROS da rota de upload do AI Partner (E7-14, D-F5…D-F10): recebem um `Request` da web e um `ctx` INJETADO (usuário, plano, limite de taxa, dependências) e devolvem um `Response`. Não conhecem Next, auth, Prisma nem
// process.env: a rota do Next só LIGA essas peças (src/app/api/ai-partner/). Fluxo do POST: sessão → configurado? → Origin (CSRF) → limite de taxa → corpo com TETO de 4 MiB (a Vercel corta em 4,5 MB) → tipo (JSON ou multipart) →
// UTF-8 estrito preservando o BOM → nome do arquivo (só o nome base) → plano lido do BANCO a cada pedido → sal do usuário (criado no 1º envio) → registerImportWithQuota → 201 (novo) / 200 (já existia).
// Respostas: JSON sempre com `Cache-Control: no-store`; erros são `{ ok:false, code, error }` com mensagem FIXA — nunca ecoam o texto/nome do arquivo, exceção, SQL, URL ou credencial. Nada lança.
import { registerImportWithQuota, getImportUsage, type QuotaTable } from "./import-quota.ts"
import type { BundleCache } from "./bundle-cache.ts"
import type { DatasetDeps } from "./dataset.ts"
import { parseImportContext, type ImportSourceStore } from "./import-source-store.ts"
import { isValidSha256, isValidUserId, type RawFileStorage } from "./raw-file-storage.ts"
import type { PersistentSalts } from "./salt-store.ts"
import { deleteImportFile, type PurgeDeps } from "./user-purge.ts"

/** Teto do corpo pela rota: 4 MiB de texto (≈20 mil trades), abaixo dos 4,5 MB que a Vercel aceita numa Function. */
export const MAX_ROUTE_BYTES = 4 * 1024 * 1024
const PLANS = ["FREE", "TRADER", "PRO"] as const

export interface AiPartnerDeps { readonly rawStorage: RawFileStorage; readonly importStore: ImportSourceStore; readonly salts: PersistentSalts; readonly cache?: BundleCache }
export interface AiPartnerCtx {
  /** O usuário da sessão, ou null. */
  readonly userId: string | null
  /** O plano do usuário LIDO DO BANCO (a cada pedido). */
  getPlan(userId: string): Promise<unknown>
  rateLimit(userId: string): Promise<{ readonly ok: boolean; readonly retryAfterSec: number }>
  /** null ⇒ a feature está apagada neste ambiente (503 NOT_CONFIGURED). */
  readonly deps: AiPartnerDeps | null
  /** Só para teste. */
  readonly quotas?: QuotaTable
}

const MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "Pedido inválido.", INVALID_ARGS: "Dados inválidos.", INVALID_ENCODING: "O arquivo precisa estar em UTF-8.", UNSUPPORTED_MEDIA_TYPE: "Envie o CSV como arquivo (multipart) ou como JSON.",
  TOO_LARGE_FOR_ROUTE: "Arquivo grande demais para o envio (limite de 4 MiB, cerca de 20 mil trades).", TOO_LARGE: "Arquivo grande demais.", PIPELINE_FAILED: "Não consegui ler esse CSV. Confira o formato e as opções de importação.",
  CONTEXT_CONFLICT: "Este arquivo já foi enviado com outras opções de importação.", RATE_LIMITED: "Muitas requisições. Tente novamente em instantes.", FORBIDDEN_ORIGIN: "Origem não permitida.",
  NOT_FOUND: "Arquivo não encontrado.", STORAGE_ERROR: "Não foi possível processar agora. Tente novamente.", NOT_CONFIGURED: "Recurso indisponível no momento.",
}
const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } })
const fail = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => json(status, { ok: false, code, error: MESSAGES[code] ?? MESSAGES.STORAGE_ERROR, ...extra }, headers)
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const unauthorized = (): Response => json(401, { error: "Não autorizado" })

type Gate = { readonly res: Response } | { readonly userId: string; readonly deps: AiPartnerDeps }
/** Sessão → configurado → (mutação) Origin → (mutação) limite de taxa. Devolve a resposta de recusa OU quem pode seguir. */
async function gate(ctx: AiPartnerCtx, req: Request, mutating: boolean): Promise<Gate> {
  if (!isRecord(ctx) || !isValidUserId(ctx.userId)) return { res: unauthorized() }
  if (ctx.deps === null || !isRecord(ctx.deps)) return { res: fail(503, "NOT_CONFIGURED") }
  if (mutating) {
    const origin = req.headers.get("origin")
    let own = ""
    try { own = new URL(req.url).origin } catch { own = "" }
    if (origin !== null && origin !== own) return { res: fail(403, "FORBIDDEN_ORIGIN") }
    try {
      const limit = await ctx.rateLimit(ctx.userId)
      if (!limit.ok) return { res: fail(429, "RATE_LIMITED", {}, { "retry-after": String(Math.max(1, Math.ceil(Number(limit.retryAfterSec) || 1))) }) }
    } catch { /* o limitador fora do ar não derruba a feature: a cota segue limitando */ }
  }
  return { userId: ctx.userId, deps: ctx.deps }
}
async function planOf(ctx: AiPartnerCtx, userId: string): Promise<(typeof PLANS)[number] | null> {
  try { const p = await ctx.getPlan(userId); return (PLANS as readonly unknown[]).includes(p) ? (p as (typeof PLANS)[number]) : null } catch { return null }
}

/** Lê o corpo ATÉ o teto (em fluxo): Content-Length acima do teto ⇒ recusa SEM ler; sem ele (ou mentindo), para de ler ao passar. null ⇒ passou do teto. */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_ROUTE_BYTES) { try { await req.body?.cancel() } catch { /* nada */ } return null }
  if (req.body === null) return new Uint8Array(0)
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_ROUTE_BYTES) { try { await reader.cancel() } catch { /* nada */ } return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total); let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}
const decodeUtf8 = (bytes: Uint8Array): string | null => { try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return null } } // ignoreBOM: o BOM FICA no texto (o sha é o do arquivo)

/** Só o nome base (sem caminho), ≤ 255, sem caractere de controle. undefined/null ⇒ null; inválido ⇒ "INVALID". */
function cleanFileName(x: unknown): string | null | "INVALID" {
  if (x === undefined || x === null) return null
  if (typeof x !== "string" || /[\u0000-\u001f\u007f]/.test(x)) return "INVALID"
  const base = x.split(/[\\/]/).pop()!.trim()
  return base === "" || base === "." || base === ".." || base.length > 255 ? "INVALID" : base
}

interface Parsed { readonly text: string; readonly fileName: string | null; readonly context: Record<string, unknown> }
async function parseUpload(req: Request): Promise<Parsed | Response> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase()
  const isJson = type.startsWith("application/json"), isForm = type.startsWith("multipart/form-data")
  if (!isJson && !isForm) { try { await req.body?.cancel() } catch { /* nada */ } return fail(415, "UNSUPPORTED_MEDIA_TYPE") }
  const bytes = await readCapped(req)
  if (bytes === null) return fail(413, "TOO_LARGE_FOR_ROUTE")
  if (bytes.byteLength === 0) return fail(400, "INVALID_REQUEST")
  if (isJson) {
    const raw = decodeUtf8(bytes); if (raw === null) return fail(400, "INVALID_ENCODING")
    let o: unknown; try { o = JSON.parse(raw) } catch { return fail(400, "INVALID_REQUEST") }
    if (!isRecord(o) || typeof o.text !== "string" || o.text === "" || (o.context !== undefined && !isRecord(o.context))) return fail(400, "INVALID_REQUEST")
    const name = cleanFileName(o.fileName); if (name === "INVALID") return fail(400, "INVALID_ARGS")
    return { text: o.text, fileName: name, context: (o.context as Record<string, unknown> | undefined) ?? {} }
  }
  let form: FormData
  try { form = await new Response(bytes as BodyInit, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData() } catch { return fail(400, "INVALID_REQUEST") }
  const file = form.get("file")
  if (!(file instanceof Blob)) return fail(400, "INVALID_REQUEST")
  const text = decodeUtf8(new Uint8Array(await file.arrayBuffer())); if (text === null) return fail(400, "INVALID_ENCODING")
  if (text === "") return fail(400, "INVALID_REQUEST")
  const given = form.get("fileName"), own = (file as File).name
  const name = cleanFileName(typeof given === "string" ? given : own === "" || own === undefined ? undefined : own); if (name === "INVALID") return fail(400, "INVALID_ARGS")
  let context: Record<string, unknown> = {}
  const rawCtx = form.get("context")
  if (typeof rawCtx === "string" && rawCtx !== "") { try { const c: unknown = JSON.parse(rawCtx); if (!isRecord(c)) return fail(400, "INVALID_REQUEST"); context = c } catch { return fail(400, "INVALID_REQUEST") } }
  return { text, fileName: name, context }
}

export async function handleImportPost(ctx: AiPartnerCtx, req: Request): Promise<Response> {
  try {
    const g = await gate(ctx, req, true); if ("res" in g) return g.res
    const parsed = await parseUpload(req); if (parsed instanceof Response) return parsed
    if (parseImportContext(parsed.context) === null) return fail(400, "INVALID_ARGS")
    const plan = await planOf(ctx, g.userId); if (plan === null) return fail(500, "STORAGE_ERROR")
    const { deps, userId } = g
    let provider
    try { await deps.salts.ensure(userId); provider = (await deps.salts.load(userId)).provider } catch { return fail(500, "STORAGE_ERROR") }
    const dsDeps: DatasetDeps = { rawStorage: deps.rawStorage, importStore: deps.importStore, salt: provider as DatasetDeps["salt"] }
    const r = await registerImportWithQuota(dsDeps, { userId, text: parsed.text, context: parsed.context as never, ...(parsed.fileName !== null ? { fileName: parsed.fileName } : {}) }, plan, ctx.quotas !== undefined ? { quotas: ctx.quotas } : undefined)
    if (!r.ok) {
      if (r.code === "QUOTA_EXCEEDED") { const q = r as { resource: string; limit: number; used: number; suggestedPlan: string | null }; return fail(403, "QUOTA_EXCEEDED", { upgrade: true, suggestedPlan: q.suggestedPlan, resource: q.resource, limit: q.limit, used: q.used }) }
      const map: Record<string, number> = { INVALID_ARGS: 400, TOO_LARGE: 413, PIPELINE_FAILED: 422, CONTEXT_CONFLICT: 409 }
      return map[r.code] !== undefined ? fail(map[r.code], r.code) : fail(500, "STORAGE_ERROR")
    }
    const row = await deps.importStore.get(userId, r.fileSha256)
    if (!row.ok) return fail(500, "STORAGE_ERROR")
    return json(r.created ? 201 : 200, { ok: true, created: r.created, importId: r.importId, fileSha256: r.fileSha256, fileName: row.row.fileName, fileBytes: row.row.fileBytes, createdAt: row.row.createdAt })
  } catch {
    return fail(500, "STORAGE_ERROR")
  }
}

export async function handleImportsGet(ctx: AiPartnerCtx, req: Request): Promise<Response> {
  try {
    const g = await gate(ctx, req, false); if ("res" in g) return g.res
    const plan = await planOf(ctx, g.userId); if (plan === null) return fail(500, "STORAGE_ERROR")
    const usage = await getImportUsage(g.deps.importStore, g.userId, plan, ctx.quotas !== undefined ? { quotas: ctx.quotas } : undefined)
    const list = await g.deps.importStore.list(g.userId)
    if (!usage.ok || !list.ok) return fail(500, "STORAGE_ERROR")
    const imports = [...list.rows].sort((a, b) => (a.createdAt === b.createdAt ? (a.fileSha256 < b.fileSha256 ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1)).map((r) => ({ fileSha256: r.fileSha256, importId: r.importId, fileName: r.fileName, fileBytes: r.fileBytes, createdAt: r.createdAt }))
    return json(200, { usage: { files: usage.files, bytes: usage.bytes, corrupt: usage.corrupt, limits: usage.limits, remaining: usage.remaining }, imports })
  } catch {
    return fail(500, "STORAGE_ERROR")
  }
}

export async function handleImportDelete(ctx: AiPartnerCtx, req: Request, sha: string): Promise<Response> {
  try {
    const g = await gate(ctx, req, true); if ("res" in g) return g.res
    if (!isValidSha256(sha)) return fail(400, "INVALID_ARGS")
    // 404 idêntico para "inexistente" e "de outro usuário": a chave é (userId, sha), então o de outro usuário simplesmente não existe para este
    const r = await deleteImportFile({ rawStorage: g.deps.rawStorage, importStore: g.deps.importStore, ...(g.deps.cache !== undefined ? { cache: g.deps.cache } : {}) } as unknown as PurgeDeps, { userId: g.userId, fileSha256: sha })
    if (!r.ok) return fail(500, "STORAGE_ERROR")
    return r.rawFile || r.importSource ? json(200, { ok: true, deleted: true }) : fail(404, "NOT_FOUND")
  } catch {
    return fail(500, "STORAGE_ERROR")
  }
}
