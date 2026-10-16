// Implementação em DISCO do RawFileStorage (E7-1): desenvolvimento/testes e como referência do contrato; produção será um provedor S3-compatível atrás da MESMA interface.
// Layout: {root}/users/{userId}/imports/{sha}.csv, arquivos 0600 e diretórios 0700. Escrita ATÔMICA: temporário exclusivo (`wx`) + hard link para o nome final (o link falha se o final já existe ⇒ "created" exato mesmo
// com `put` simultâneas) + remoção do temporário. Recusa SEGUIR symlink em users/{userId} e imports (conferido ANTES de criar qualquer diretório). `get` confere o SHA-256; diferente ⇒ CORRUPT e o arquivo NÃO é apagado.
// Limite conhecido (declarado): a conferência de symlink e o uso do caminho não são atômicos (TOCTOU) — a raiz é de uso exclusivo da aplicação. Nada lança, nenhum erro leva mensagem ou caminho.
import { link, lstat, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { randomHex, sha256Hex } from "./hash.ts"
import { MAX_RAW_FILE_BYTES, checkPutArgs, isValidSha256, isValidUserId, rawFileFailure, type RawFileFailure, type RawFileStorage } from "./raw-file-storage.ts"

/** As operações de arquivo, injetáveis SÓ para simular falhas nos testes (falha entre o temporário e o final, disco cheio). */
export interface DiskOps { link: typeof link; lstat: typeof lstat; mkdir: typeof mkdir; readFile: typeof readFile; readdir: typeof readdir; rm: typeof rm; stat: typeof stat; unlink: typeof unlink; writeFile: typeof writeFile }

const codeOf = (e: unknown): string | undefined => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined)

export function createDiskRawFileStorage(rootDir: string, overrides: Partial<DiskOps> = {}): RawFileStorage {
  if (typeof rootDir !== "string" || rootDir === "" || !isAbsolute(rootDir)) throw new TypeError("rootDir precisa ser um caminho absoluto")
  const root = resolve(rootDir)
  const ops: DiskOps = { link, lstat, mkdir, readFile, readdir, rm, stat, unlink, writeFile, ...overrides }
  const paths = (userId: string): { users: string; userDir: string; imports: string } => { const users = join(root, "users"); const userDir = join(users, userId); return { users, userDir, imports: join(userDir, "imports") } }
  const inside = (p: string): boolean => { const rel = relative(root, p); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) }

  /** Nenhum componente do caminho do usuário pode ser symlink (ausente é ok). */
  const noSymlinks = async (list: string[]): Promise<boolean> => {
    for (const p of list) {
      try { if ((await ops.lstat(p)).isSymbolicLink()) return false } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
    }
    return true
  }
  const prepare = async (userId: string, create: boolean): Promise<{ readonly ok: true; readonly imports: string; readonly userDir: string } | RawFileFailure> => {
    const { users, userDir, imports } = paths(userId)
    if (!inside(imports)) return rawFileFailure("STORAGE_ERROR")
    if (!(await noSymlinks([users, userDir, imports]))) return rawFileFailure("STORAGE_ERROR") // ANTES de criar qualquer coisa
    if (create) {
      await ops.mkdir(imports, { recursive: true, mode: 0o700 })
      if (!(await noSymlinks([users, userDir, imports]))) return rawFileFailure("STORAGE_ERROR")
    }
    return { ok: true, imports, userDir }
  }
  const readVerified = async (file: string, fileSha256: string): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | RawFileFailure> => {
    let size: number
    try { size = (await ops.stat(file)).size } catch (e) { return rawFileFailure(codeOf(e) === "ENOENT" ? "NOT_FOUND" : "STORAGE_ERROR") }
    if (size > MAX_RAW_FILE_BYTES) return rawFileFailure("CORRUPT")
    let buf: Uint8Array
    try { buf = await ops.readFile(file) } catch (e) { return rawFileFailure(codeOf(e) === "ENOENT" ? "NOT_FOUND" : "STORAGE_ERROR") }
    if (buf.byteLength === 0 || sha256Hex(buf) !== fileSha256) return rawFileFailure("CORRUPT")
    return { ok: true, bytes: new Uint8Array(buf) }
  }

  return {
    async put(userId, fileSha256, bytes) {
      try {
        const checked = checkPutArgs(userId, fileSha256, bytes)
        if (!checked.ok) return checked
        const dir = await prepare(userId, true)
        if (!dir.ok) return dir
        const final = join(dir.imports, `${fileSha256}.csv`)
        const tmp = join(dir.imports, `.${fileSha256}.${randomHex(8)}.tmp`)
        let created = true
        try {
          await ops.writeFile(tmp, checked.bytes, { mode: 0o600, flag: "wx" })
          try { await ops.link(tmp, final) } catch (e) { if (codeOf(e) !== "EEXIST") throw e; created = false }
        } catch {
          await ops.unlink(tmp).catch(() => undefined)
          return rawFileFailure("STORAGE_ERROR")
        }
        await ops.unlink(tmp).catch(() => undefined)
        if (!created) { const current = await readVerified(final, fileSha256); if (!current.ok) return current } // existe: nunca sobrescreve; corrompido ⇒ CORRUPT
        return { ok: true, created }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async get(userId, fileSha256) {
      try {
        if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return rawFileFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (!dir.ok) return dir
        return await readVerified(join(dir.imports, `${fileSha256}.csv`), fileSha256)
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async delete(userId, fileSha256) {
      try {
        if (!isValidUserId(userId) || !isValidSha256(fileSha256)) return rawFileFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (!dir.ok) return dir
        try { await ops.unlink(join(dir.imports, `${fileSha256}.csv`)); return { ok: true, existed: true } } catch (e) { if (codeOf(e) === "ENOENT") return { ok: true, existed: false }; throw e }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
    async deleteAllForUser(userId) {
      try {
        if (!isValidUserId(userId)) return rawFileFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (!dir.ok) return dir
        let deleted = 0
        try { deleted = (await ops.readdir(dir.imports)).filter((n) => n.endsWith(".csv") && !n.startsWith(".")).length } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
        await ops.rm(dir.userDir, { recursive: true, force: true })
        return { ok: true, deleted }
      } catch {
        return rawFileFailure("STORAGE_ERROR")
      }
    },
  }
}
