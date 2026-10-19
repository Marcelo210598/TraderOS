// Registro de arquivos importados (E7-4, D-B3): metadados por (userId, fileSha256). O CONTEÚDO está no RawFileStorage; aqui ficam o que a regeneração precisa para reproduzir o import exato:
// o `importId` esperado, o `fileName` (medido: não muda o importId mas MUDA o evidenceRef), o contexto de import escolhido pelo USUÁRIO (fuso, locale, política de dobra, mapa de motivos…) e o tamanho/BOM/EOL.
// NUNCA entram: sal, provider de sal, `fileHash` (o pipeline o calcula) nem o conteúdo do arquivo. Uma chave tem UM contexto (limite declarado): mesma chave com outro conteúdo ⇒ CONFLICT, sem sobrescrever.
// API tipada por RESULTADO (nada lança; erros são códigos fixos, sem mensagem, caminho ou eco). Memória e disco (mesmo desenho dos outros stores: link exclusivo, 0600/0700, sem seguir symlink).
import { link, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { randomHex } from "./hash.ts"
import { isValidSha256, isValidUserId } from "./raw-file-storage.ts"

const IMPORT_ID_RE = /^imp_[0-9a-f]{8,64}$/
const KEBAB_UPPER = /^[A-Z][A-Z0-9_]{0,31}$/
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_RULES = 200
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const isIso = (x: unknown): x is string => typeof x === "string" && x.length >= 10 && x.length <= 40 && !Number.isNaN(Date.parse(x))

/** O que o USUÁRIO escolheu ao importar (subconjunto de `ImportContext`). A SEMÂNTICA dos valores é conferida quando o pipeline roda (registerImport); aqui só o formato. */
export interface ImportContextRecord {
  readonly sourceTz?: string | null
  readonly dateOrder?: string
  readonly numberLocale?: string
  readonly excursionUnit?: string | null
  readonly declaredPnlBasis?: string
  readonly foldPolicy?: string
  readonly forceParserId?: string
  readonly reconstructCycles?: boolean
  readonly exitReasonMap?: ReadonlyArray<{ readonly pattern: string; readonly reason: string }>
}
export interface ImportSourceRow {
  readonly userId: string
  readonly fileSha256: string
  readonly importId: string
  readonly fileName: string | null
  readonly fileBytes: number
  readonly hasBom: boolean
  readonly lineEnding: "LF" | "CRLF" | "CR" | "MIXED" | "NONE"
  readonly hashBasis: "UTF8_TEXT"
  readonly context: ImportContextRecord
  readonly createdAt: string
}

export type ImportSourceCode = "INVALID_ARGS" | "NOT_FOUND" | "CONFLICT" | "CORRUPT" | "STORAGE_ERROR"
export interface ImportSourceFailure { readonly ok: false; readonly code: ImportSourceCode }
export const importSourceFailure = (code: ImportSourceCode): ImportSourceFailure => ({ ok: false, code })

export interface ImportSourceStore {
  /** Cria a linha. Mesma chave e MESMO conteúdo (createdAt à parte) ⇒ `created:false`; conteúdo diferente ⇒ CONFLICT (nunca sobrescreve). */
  put(row: ImportSourceRow): Promise<{ readonly ok: true; readonly created: boolean } | ImportSourceFailure>
  get(userId: string, fileSha256: string): Promise<{ readonly ok: true; readonly row: ImportSourceRow } | ImportSourceFailure>
}

/** Contexto: só as chaves permitidas, formatos fechados; devolve CÓPIA com ordem de chaves canônica, ou null. */
export function parseImportContext(x: unknown): ImportContextRecord | null {
  try {
    if (!isRecord(x)) return null
    const ALLOWED = ["declaredPnlBasis", "dateOrder", "excursionUnit", "exitReasonMap", "foldPolicy", "forceParserId", "numberLocale", "reconstructCycles", "sourceTz"]
    if (Object.keys(x).some((k) => !ALLOWED.includes(k))) return null
    const out: Record<string, unknown> = {}
    for (const k of ALLOWED) {
      if (!Object.hasOwn(x, k)) continue
      const v = x[k]
      switch (k) {
        case "sourceTz": if (v !== null && (typeof v !== "string" || v === "" || v.length > 64)) return null; break
        case "excursionUnit": if (v !== null && (typeof v !== "string" || !KEBAB_UPPER.test(v))) return null; break
        case "dateOrder": if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) return null; break
        case "numberLocale": if (typeof v !== "string" || !/^[A-Z]{2,8}$/.test(v)) return null; break
        case "declaredPnlBasis": case "foldPolicy": if (typeof v !== "string" || !KEBAB_UPPER.test(v)) return null; break
        case "forceParserId": if (typeof v !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) return null; break
        case "reconstructCycles": if (typeof v !== "boolean") return null; break
        case "exitReasonMap": {
          if (!Array.isArray(v) || v.length > MAX_RULES) return null
          const rules: Array<{ pattern: string; reason: string }> = []
          for (const r of v) {
            if (!isRecord(r) || Object.keys(r).sort().join(",") !== "pattern,reason" || typeof r.pattern !== "string" || r.pattern === "" || r.pattern.length > 500 || typeof r.reason !== "string" || !KEBAB_UPPER.test(r.reason)) return null
            rules.push({ pattern: r.pattern, reason: r.reason })
          }
          out[k] = rules
          continue
        }
      }
      out[k] = v
    }
    return out as ImportContextRecord
  } catch {
    return null
  }
}

/** Linha completa: chaves exatas, formatos fechados; devolve CÓPIA ou null. */
export function parseImportSourceRow(x: unknown): ImportSourceRow | null {
  try {
    if (!isRecord(x) || Object.keys(x).sort().join(",") !== "context,createdAt,fileBytes,fileName,fileSha256,hasBom,hashBasis,importId,lineEnding,userId") return null
    if (!isValidUserId(x.userId) || !isValidSha256(x.fileSha256) || typeof x.importId !== "string" || !IMPORT_ID_RE.test(x.importId) || !isIso(x.createdAt)) return null
    if (x.fileName !== null && (typeof x.fileName !== "string" || x.fileName === "" || x.fileName.length > 255 || x.fileName.includes("\u0000"))) return null
    if (typeof x.fileBytes !== "number" || !Number.isInteger(x.fileBytes) || x.fileBytes < 0 || x.fileBytes > MAX_FILE_BYTES * 4 || typeof x.hasBom !== "boolean" || x.hashBasis !== "UTF8_TEXT") return null
    if (x.lineEnding !== "LF" && x.lineEnding !== "CRLF" && x.lineEnding !== "CR" && x.lineEnding !== "MIXED" && x.lineEnding !== "NONE") return null
    const context = parseImportContext(x.context)
    if (context === null) return null
    return { userId: x.userId, fileSha256: x.fileSha256, importId: x.importId, fileName: x.fileName, fileBytes: x.fileBytes, hasBom: x.hasBom, lineEnding: x.lineEnding, hashBasis: "UTF8_TEXT", context, createdAt: x.createdAt }
  } catch {
    return null
  }
}
const withoutCreatedAt = (r: ImportSourceRow): string => JSON.stringify({ ...r, createdAt: null })
const copy = (r: ImportSourceRow): ImportSourceRow => JSON.parse(JSON.stringify(r)) as ImportSourceRow

// ───────────────────────────── memória ─────────────────────────────
export function createMemoryImportSourceStore(): ImportSourceStore {
  const rows = new Map<string, ImportSourceRow>()
  const key = (u: string, s: string): string => `${u}/${s}`
  return {
    async put(input) {
      const row = parseImportSourceRow(input)
      if (row === null) return importSourceFailure("INVALID_ARGS")
      const have = rows.get(key(row.userId, row.fileSha256))
      if (have === undefined) { rows.set(key(row.userId, row.fileSha256), copy(row)); return { ok: true, created: true } }
      return withoutCreatedAt(have) === withoutCreatedAt(row) ? { ok: true, created: false } : importSourceFailure("CONFLICT")
    },
    async get(userId, fileSha256) {
      if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return importSourceFailure("INVALID_ARGS")
      const have = rows.get(key(userId, fileSha256))
      return have === undefined ? importSourceFailure("NOT_FOUND") : { ok: true, row: copy(have) }
    },
  }
}

// ───────────────────────────── disco ─────────────────────────────
// Layout: {root}/import-sources/{userId}/{fileSha256}.json (0600; diretórios 0700). Criação atômica: temporário exclusivo + hard link (falha se já existe ⇒ compara o conteúdo). Recusa symlink. Nada lança.
export interface DiskImportSourceOps { link: typeof link; lstat: typeof lstat; mkdir: typeof mkdir; readFile: typeof readFile; unlink: typeof unlink; writeFile: typeof writeFile }
const codeOf = (e: unknown): string | undefined => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined)

export function createDiskImportSourceStore(rootDir: string, overrides: Partial<DiskImportSourceOps> = {}): ImportSourceStore {
  if (typeof rootDir !== "string" || rootDir === "" || !isAbsolute(rootDir)) throw new TypeError("rootDir precisa ser um caminho absoluto")
  const root = resolve(rootDir)
  const ops: DiskImportSourceOps = { link, lstat, mkdir, readFile, unlink, writeFile, ...overrides }
  const base = join(root, "import-sources")
  const inside = (p: string): boolean => { const rel = relative(root, p); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) }
  const noSymlinks = async (list: string[]): Promise<boolean> => {
    for (const p of list) {
      try { if ((await ops.lstat(p)).isSymbolicLink()) return false } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
    }
    return true
  }
  const prepare = async (userId: string, create: boolean): Promise<string | null> => {
    const dir = join(base, userId)
    if (!inside(dir) || !(await noSymlinks([base, dir]))) return null
    if (create) {
      await ops.mkdir(dir, { recursive: true, mode: 0o700 })
      if (!(await noSymlinks([base, dir]))) return null
    }
    return dir
  }
  const readRow = async (dir: string, userId: string, sha: string): Promise<{ readonly row: ImportSourceRow } | ImportSourceFailure> => {
    let text: string
    try { text = await ops.readFile(join(dir, `${sha}.json`), "utf8") } catch (e) { if (codeOf(e) === "ENOENT") return importSourceFailure("NOT_FOUND"); throw e }
    let parsed: ImportSourceRow | null = null
    try { parsed = parseImportSourceRow(JSON.parse(text)) } catch { parsed = null }
    return parsed !== null && parsed.userId === userId && parsed.fileSha256 === sha ? { row: parsed } : importSourceFailure("CORRUPT")
  }

  return {
    async put(input) {
      try {
        const row = parseImportSourceRow(input)
        if (row === null) return importSourceFailure("INVALID_ARGS")
        const dir = await prepare(row.userId, true)
        if (dir === null) return importSourceFailure("STORAGE_ERROR")
        const tmp = join(dir, `.${row.fileSha256}.${randomHex(8)}.tmp`)
        let exists = false
        try {
          await ops.writeFile(tmp, JSON.stringify(row), { mode: 0o600, flag: "wx" })
          try { await ops.link(tmp, join(dir, `${row.fileSha256}.json`)) } catch (e) { if (codeOf(e) !== "EEXIST") throw e; exists = true }
        } catch {
          await ops.unlink(tmp).catch(() => undefined)
          return importSourceFailure("STORAGE_ERROR")
        }
        await ops.unlink(tmp).catch(() => undefined)
        if (!exists) return { ok: true, created: true }
        const have = await readRow(dir, row.userId, row.fileSha256)
        if (!("row" in have)) return have.code === "NOT_FOUND" ? importSourceFailure("STORAGE_ERROR") : have
        return withoutCreatedAt(have.row) === withoutCreatedAt(row) ? { ok: true, created: false } : importSourceFailure("CONFLICT")
      } catch {
        return importSourceFailure("STORAGE_ERROR")
      }
    },
    async get(userId, fileSha256) {
      try {
        if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return importSourceFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (dir === null) return importSourceFailure("STORAGE_ERROR")
        const r = await readRow(dir, userId, fileSha256)
        return "row" in r ? { ok: true, row: r.row } : r
      } catch {
        return importSourceFailure("STORAGE_ERROR")
      }
    },
  }
}
