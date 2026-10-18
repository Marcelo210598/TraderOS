// Persistência do chaveiro de sais (E7-2; decisões D-C1…D-C8 em scripts/expectations/agent-answer.expected.json → e7_2).
// O `SaltProvider` (ingest/salt.ts) continua SÍNCRONO e inalterado. Aqui ficam: (1) o `SaltStore` ASSÍNCRONO (linhas cifradas; memória e disco), (2) o `createPersistentSalts`, que decifra as linhas do usuário ANTES do turno
// para dentro de um `InMemorySaltKeyring` e aplica as MESMAS regras dele (ids s1,s2…; só o último gera; aposentar apaga o valor), e (3) `recipherAll` (rotação da chave mestra).
// O sal só existe em claro dentro do InMemorySaltKeyring (campos #). No store vai só ciphertext (AES-256-GCM, AAD `userId:saltId`) + `saltCheck` (que já é público no bundle). Nada daqui põe o valor em erro/JSON/log.
// Linha corrompida/adulterada NÃO derruba o usuário: aquele saltId some do provider (projetado como aposentado, sem valor — falha fechada) e vai listado em `unavailable` com um código. Se for a ÚLTIMA linha,
// não há sal atual (nunca cai para um mais antigo em silêncio).
// Limites declarados: o `provider` é um instantâneo (recarregue por turno); `replaceCipher`/`retire` em disco conferem e depois renomeiam (CAS não atômico entre PROCESSOS — a rotação é operação administrativa de um escritor só).
import { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { SALT_CHECK_RE, SALT_ID_RE } from "../domain/canonical.ts"
import { InMemorySaltKeyring, SaltError, isStrongSalt, saltCheck, type SaltProvider } from "../ingest/salt.ts"
import type { Sealed, SaltCipher } from "./cipher.ts"
import { NONCE_BYTES, TAG_BYTES } from "./cipher.ts"
import { randomHex } from "./hash.ts"
import { isValidUserId } from "./raw-file-storage.ts"

// ───────────────────────────── linhas e contrato do store ─────────────────────────────
export interface SaltRow {
  readonly userId: string
  readonly saltId: string
  readonly status: "ACTIVE" | "RETIRED"
  /** `slt_<24 hex>` do sal (já é público nos bundles). */
  readonly saltCheck: string
  /** ACTIVE: texto cifrado + tag. RETIRED: null. */
  readonly ciphertext: Uint8Array | null
  readonly nonce: Uint8Array | null
  readonly keyVersion: number | null
  readonly createdAt: string
  readonly retiredAt: string | null
}
export interface CorruptRow { readonly userId: string; readonly saltId: string; readonly corrupt: true }
export type StoredRow = SaltRow | CorruptRow

export type SaltStoreFailureCode = "INVALID_ARGS" | "DUPLICATE" | "NOT_FOUND" | "CONFLICT" | "STORAGE_ERROR"
export interface SaltStoreFailure { readonly ok: false; readonly code: SaltStoreFailureCode }
export const saltStoreFailure = (code: SaltStoreFailureCode): SaltStoreFailure => ({ ok: false, code })

export interface SaltStore {
  /** Todas as linhas do usuário (inclusive aposentadas). Linha ilegível ⇒ `CorruptRow` (nunca derruba a leitura das outras). */
  loadUser(userId: string): Promise<{ readonly ok: true; readonly rows: StoredRow[] } | SaltStoreFailure>
  /** Cria a linha; (userId, saltId) já existente ⇒ DUPLICATE (nunca sobrescreve). Atômico. */
  append(row: SaltRow): Promise<{ readonly ok: true } | SaltStoreFailure>
  /** Aposenta: apaga ciphertext/nonce/keyVersion e marca RETIRED. Idempotente. Inexistente ⇒ NOT_FOUND. */
  retire(userId: string, saltId: string, retiredAt: string): Promise<{ readonly ok: true } | SaltStoreFailure>
  /** Troca o ciphertext SÓ se a linha ainda tem `expected` (keyVersion + nonce); senão CONFLICT. */
  replaceCipher(userId: string, saltId: string, expected: { readonly keyVersion: number; readonly nonce: Uint8Array }, next: Sealed): Promise<{ readonly ok: true } | SaltStoreFailure>
  listUsers(): Promise<{ readonly ok: true; readonly userIds: string[] } | SaltStoreFailure>
}

const KEYS = ["ciphertext", "createdAt", "keyVersion", "nonce", "retiredAt", "saltCheck", "saltId", "status", "userId"] // ordem alfabética (comparada com Object.keys().sort())
const isIso = (x: unknown): x is string => typeof x === "string" && x.length >= 10 && x.length <= 40 && !Number.isNaN(Date.parse(x))
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((v, i) => v === b[i])

/** Confere o formato de uma linha (memória e disco usam a mesma régua). Devolve uma CÓPIA; inválida ⇒ null. */
export function parseSaltRow(x: unknown): SaltRow | null {
  try {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return null
    const o = x as Record<string, unknown>
    if (Object.keys(o).sort().join(",") !== KEYS.join(",")) return null
    if (!isValidUserId(o.userId) || typeof o.saltId !== "string" || !SALT_ID_RE.test(o.saltId)) return null
    if (typeof o.saltCheck !== "string" || !SALT_CHECK_RE.test(o.saltCheck) || !isIso(o.createdAt)) return null
    if (o.status === "ACTIVE") {
      if (!(o.ciphertext instanceof Uint8Array) || !(o.nonce instanceof Uint8Array) || !Number.isInteger(o.keyVersion) || (o.keyVersion as number) < 1 || o.retiredAt !== null) return null
      if (o.nonce.byteLength !== NONCE_BYTES || o.ciphertext.byteLength <= TAG_BYTES) return null
      return { userId: o.userId, saltId: o.saltId, status: "ACTIVE", saltCheck: o.saltCheck, ciphertext: new Uint8Array(o.ciphertext), nonce: new Uint8Array(o.nonce), keyVersion: o.keyVersion as number, createdAt: o.createdAt, retiredAt: null }
    }
    if (o.status === "RETIRED") {
      if (o.ciphertext !== null || o.nonce !== null || o.keyVersion !== null || !isIso(o.retiredAt)) return null
      return { userId: o.userId, saltId: o.saltId, status: "RETIRED", saltCheck: o.saltCheck, ciphertext: null, nonce: null, keyVersion: null, createdAt: o.createdAt, retiredAt: o.retiredAt }
    }
    return null
  } catch {
    return null
  }
}
const copyRow = (r: SaltRow): SaltRow => ({ ...r, ciphertext: r.ciphertext === null ? null : new Uint8Array(r.ciphertext), nonce: r.nonce === null ? null : new Uint8Array(r.nonce) })
const retiredOf = (r: SaltRow, retiredAt: string): SaltRow => ({ ...r, status: "RETIRED", ciphertext: null, nonce: null, keyVersion: null, retiredAt })
const sealedPatch = (r: SaltRow, next: Sealed): SaltRow | null => parseSaltRow({ ...r, ciphertext: next.ciphertext, nonce: next.nonce, keyVersion: next.keyVersion })

// ───────────────────────────── memória ─────────────────────────────
export function createMemorySaltStore(): SaltStore {
  const users = new Map<string, Map<string, SaltRow>>()
  return {
    async loadUser(userId) {
      if (!isValidUserId(userId)) return saltStoreFailure("INVALID_ARGS")
      return { ok: true, rows: [...(users.get(userId)?.values() ?? [])].map(copyRow) }
    },
    async append(row) {
      const parsed = parseSaltRow(row)
      if (parsed === null) return saltStoreFailure("INVALID_ARGS")
      const list = users.get(parsed.userId) ?? new Map<string, SaltRow>()
      if (list.has(parsed.saltId)) return saltStoreFailure("DUPLICATE")
      list.set(parsed.saltId, parsed)
      users.set(parsed.userId, list)
      return { ok: true }
    },
    async retire(userId, saltId, retiredAt) {
      if (!isValidUserId(userId) || typeof saltId !== "string" || !SALT_ID_RE.test(saltId) || !isIso(retiredAt)) return saltStoreFailure("INVALID_ARGS")
      const cur = users.get(userId)?.get(saltId)
      if (cur === undefined) return saltStoreFailure("NOT_FOUND")
      if (cur.status === "ACTIVE") users.get(userId)!.set(saltId, retiredOf(cur, retiredAt))
      return { ok: true }
    },
    async replaceCipher(userId, saltId, expected, next) {
      if (!isValidUserId(userId) || typeof saltId !== "string" || !SALT_ID_RE.test(saltId)) return saltStoreFailure("INVALID_ARGS")
      const cur = users.get(userId)?.get(saltId)
      if (cur === undefined) return saltStoreFailure("NOT_FOUND")
      if (cur.status !== "ACTIVE" || cur.keyVersion !== expected.keyVersion || cur.nonce === null || !sameBytes(cur.nonce, expected.nonce)) return saltStoreFailure("CONFLICT")
      const patched = sealedPatch(cur, next)
      if (patched === null) return saltStoreFailure("INVALID_ARGS")
      users.get(userId)!.set(saltId, patched)
      return { ok: true }
    },
    async listUsers() {
      return { ok: true, userIds: [...users.keys()].sort() }
    },
  }
}

// ───────────────────────────── disco ─────────────────────────────
// Layout: {root}/salts/{userId}/{saltId}.json, arquivos 0600 e diretórios 0700. Criação ATÔMICA: temporário exclusivo (`wx`) + hard link para o nome final (falha se já existe ⇒ DUPLICATE com escritores
// simultâneos). Reescrita (retire/replaceCipher): temporário + rename. Recusa SEGUIR symlink em salts/ e salts/{userId}. Nenhum método lança.
export interface DiskSaltOps { link: typeof link; lstat: typeof lstat; mkdir: typeof mkdir; readFile: typeof readFile; readdir: typeof readdir; rename: typeof rename; unlink: typeof unlink; writeFile: typeof writeFile }
const codeOf = (e: unknown): string | undefined => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined)
const b64 = (u: Uint8Array | null): string | null => (u === null ? null : Buffer.from(u).toString("base64"))
const fromB64 = (s: unknown): Uint8Array | null | undefined => (s === null ? null : typeof s === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(s) ? new Uint8Array(Buffer.from(s, "base64")) : undefined)

function encodeRow(r: SaltRow): string {
  return JSON.stringify({ createdAt: r.createdAt, ciphertext: b64(r.ciphertext), keyVersion: r.keyVersion, nonce: b64(r.nonce), retiredAt: r.retiredAt, saltCheck: r.saltCheck, saltId: r.saltId, status: r.status, userId: r.userId })
}
function decodeRow(text: string, userId: string, saltId: string): StoredRow {
  const bad: CorruptRow = { userId, saltId, corrupt: true }
  try {
    const o = JSON.parse(text) as Record<string, unknown>
    if (typeof o !== "object" || o === null) return bad
    const ciphertext = fromB64(o.ciphertext), nonce = fromB64(o.nonce)
    if (ciphertext === undefined || nonce === undefined) return bad
    const row = parseSaltRow({ ...o, ciphertext, nonce })
    return row !== null && row.userId === userId && row.saltId === saltId ? row : bad
  } catch {
    return bad
  }
}

export function createDiskSaltStore(rootDir: string, overrides: Partial<DiskSaltOps> = {}): SaltStore {
  if (typeof rootDir !== "string" || rootDir === "" || !isAbsolute(rootDir)) throw new TypeError("rootDir precisa ser um caminho absoluto")
  const root = resolve(rootDir)
  const ops: DiskSaltOps = { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile, ...overrides }
  const salts = join(root, "salts")
  const inside = (p: string): boolean => { const rel = relative(root, p); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) }
  const noSymlinks = async (list: string[]): Promise<boolean> => {
    for (const p of list) {
      try { if ((await ops.lstat(p)).isSymbolicLink()) return false } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
    }
    return true
  }
  const prepare = async (userId: string, create: boolean): Promise<string | null> => {
    const dir = join(salts, userId)
    if (!inside(dir) || !(await noSymlinks([salts, dir]))) return null
    if (create) {
      await ops.mkdir(dir, { recursive: true, mode: 0o700 })
      if (!(await noSymlinks([salts, dir]))) return null
    }
    return dir
  }
  const readRow = async (dir: string, userId: string, saltId: string): Promise<StoredRow | "ENOENT"> => {
    try { return decodeRow(await ops.readFile(join(dir, `${saltId}.json`), "utf8"), userId, saltId) } catch (e) { if (codeOf(e) === "ENOENT") return "ENOENT"; throw e }
  }
  const rewrite = async (dir: string, saltId: string, row: SaltRow): Promise<void> => {
    const tmp = join(dir, `.${saltId}.${randomHex(8)}.tmp`)
    try {
      await ops.writeFile(tmp, encodeRow(row), { mode: 0o600, flag: "wx" })
      await ops.rename(tmp, join(dir, `${saltId}.json`))
    } catch (e) {
      await ops.unlink(tmp).catch(() => undefined)
      throw e
    }
  }
  const validIds = (userId: unknown, saltId: unknown): boolean => isValidUserId(userId) && typeof saltId === "string" && SALT_ID_RE.test(saltId)

  return {
    async loadUser(userId) {
      try {
        if (!isValidUserId(userId)) return saltStoreFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (dir === null) return saltStoreFailure("STORAGE_ERROR")
        let names: string[] = []
        try { names = await ops.readdir(dir) } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
        const rows: StoredRow[] = []
        for (const name of names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
          const saltId = name.slice(0, -".json".length)
          if (!SALT_ID_RE.test(saltId)) { rows.push({ userId, saltId: "invalid", corrupt: true }); continue }
          const r = await readRow(dir, userId, saltId)
          if (r !== "ENOENT") rows.push(r)
        }
        return { ok: true, rows }
      } catch {
        return saltStoreFailure("STORAGE_ERROR")
      }
    },
    async append(row) {
      try {
        const parsed = parseSaltRow(row)
        if (parsed === null) return saltStoreFailure("INVALID_ARGS")
        const dir = await prepare(parsed.userId, true)
        if (dir === null) return saltStoreFailure("STORAGE_ERROR")
        const tmp = join(dir, `.${parsed.saltId}.${randomHex(8)}.tmp`)
        try {
          await ops.writeFile(tmp, encodeRow(parsed), { mode: 0o600, flag: "wx" })
          await ops.link(tmp, join(dir, `${parsed.saltId}.json`))
        } catch (e) {
          await ops.unlink(tmp).catch(() => undefined)
          return saltStoreFailure(codeOf(e) === "EEXIST" ? "DUPLICATE" : "STORAGE_ERROR")
        }
        await ops.unlink(tmp).catch(() => undefined)
        return { ok: true }
      } catch {
        return saltStoreFailure("STORAGE_ERROR")
      }
    },
    async retire(userId, saltId, retiredAt) {
      try {
        if (!validIds(userId, saltId) || !isIso(retiredAt)) return saltStoreFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (dir === null) return saltStoreFailure("STORAGE_ERROR")
        const cur = await readRow(dir, userId, saltId)
        if (cur === "ENOENT") return saltStoreFailure("NOT_FOUND")
        if ("corrupt" in cur) return saltStoreFailure("STORAGE_ERROR")
        if (cur.status === "ACTIVE") await rewrite(dir, saltId, retiredOf(cur, retiredAt))
        return { ok: true }
      } catch {
        return saltStoreFailure("STORAGE_ERROR")
      }
    },
    async replaceCipher(userId, saltId, expected, next) {
      try {
        if (!validIds(userId, saltId)) return saltStoreFailure("INVALID_ARGS")
        const dir = await prepare(userId, false)
        if (dir === null) return saltStoreFailure("STORAGE_ERROR")
        const cur = await readRow(dir, userId, saltId)
        if (cur === "ENOENT") return saltStoreFailure("NOT_FOUND")
        if ("corrupt" in cur) return saltStoreFailure("STORAGE_ERROR")
        if (cur.status !== "ACTIVE" || cur.keyVersion !== expected.keyVersion || cur.nonce === null || !sameBytes(cur.nonce, expected.nonce)) return saltStoreFailure("CONFLICT")
        const patched = sealedPatch(cur, next)
        if (patched === null) return saltStoreFailure("INVALID_ARGS")
        await rewrite(dir, saltId, patched)
        return { ok: true }
      } catch {
        return saltStoreFailure("STORAGE_ERROR")
      }
    },
    async listUsers() {
      try {
        if (!(await noSymlinks([salts]))) return saltStoreFailure("STORAGE_ERROR")
        let names: string[] = []
        try { names = await ops.readdir(salts) } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
        return { ok: true, userIds: names.filter(isValidUserId).sort() }
      } catch {
        return saltStoreFailure("STORAGE_ERROR")
      }
    },
  }
}

// ───────────────────────────── chaveiro persistente ─────────────────────────────
/** Falha de INFRAESTRUTURA (store/cifra). Só o código — sem valor, sem caminho. Regras de negócio seguem lançando `SaltError` (as mesmas do InMemory). */
export class SaltStoreError extends Error {
  readonly code: "E_SALT_STORE_UNAVAILABLE" | "E_SALT_CIPHER_FAILED"
  constructor(code: "E_SALT_STORE_UNAVAILABLE" | "E_SALT_CIPHER_FAILED") {
    super(code)
    this.name = "SaltStoreError"
    this.code = code
  }
}

export type UnavailableCode = "CORRUPT" | "AUTH_FAILED" | "KEY_VERSION_UNKNOWN" | "INPUT_INVALID" | "SALT_INVALID" | "CHECK_MISMATCH"
export interface UnavailableSalt { readonly saltId: string; readonly code: UnavailableCode }

export interface PersistentSalts {
  /** Instantâneo SÍNCRONO do usuário (decifrado). Linhas ilegíveis ficam fora do provider e listadas em `unavailable`. */
  load(userId: string): Promise<{ readonly provider: SaltProvider; readonly unavailable: UnavailableSalt[] }>
  /** Cria o s1 só se o usuário nunca teve sal (mesmas regras do `InMemorySaltKeyring.ensure`); simultâneos convergem para o MESMO sal. */
  ensure(userId: string): Promise<{ readonly saltId: string }>
  /** Novo sal atual (s{n+1}). Outro escritor chegou primeiro ⇒ E_SALT_DUPLICATE. */
  rotate(userId: string): Promise<{ readonly saltId: string }>
  retire(userId: string, saltId: string): Promise<void>
  /** Recifra para a chave mestra ATUAL todas as linhas que ainda estão em versão antiga. Idempotente; falha de infra no meio ⇒ lança, e nada fica ilegível (as duas chaves seguem válidas). */
  recipherAll(): Promise<{ readonly rewritten: number; readonly alreadyCurrent: number; readonly conflicts: number; readonly skipped: Array<{ readonly userId: string; readonly saltId: string; readonly code: UnavailableCode }> }>
}

const CHAIN_ID_RE = /^s[1-9]\d*$/
const aadOf = (userId: string, saltId: string): string => `${userId}:${saltId}`
const idNumber = (saltId: string): number => Number(saltId.slice(1))

export function createPersistentSalts(deps: { store: SaltStore; cipher: SaltCipher; now?: () => string }): PersistentSalts {
  const { store, cipher } = deps
  const now = deps.now ?? ((): string => new Date().toISOString())

  /** Decifra uma linha e confere força + saltCheck. */
  const open = (row: SaltRow): { readonly salt: string } | { readonly code: UnavailableCode } => {
    if (row.ciphertext === null || row.nonce === null || row.keyVersion === null) return { code: "CORRUPT" }
    const dec = cipher.decrypt({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion }, aadOf(row.userId, row.saltId))
    if (!dec.ok) return { code: dec.code === "KEY_INVALID" ? "AUTH_FAILED" : dec.code } // KEY_INVALID só nasce na montagem do cifrador, nunca em decrypt
    if (!isStrongSalt(dec.plaintext)) return { code: "SALT_INVALID" }
    if (saltCheck(dec.plaintext) !== row.saltCheck) return { code: "CHECK_MISMATCH" }
    return { salt: dec.plaintext }
  }

  const loadRows = async (userId: string): Promise<StoredRow[]> => {
    if (!isValidUserId(userId)) throw new SaltError("E_SALT_USER_INVALID", "userId inválido")
    const res = await store.loadUser(userId)
    if (!res.ok) throw new SaltStoreError("E_SALT_STORE_UNAVAILABLE")
    return res.rows
  }

  const build = (userId: string, rows: StoredRow[]): { readonly kr: InMemorySaltKeyring; readonly unavailable: UnavailableSalt[]; readonly ids: Set<string> } => {
    const unavailable: UnavailableSalt[] = []
    const chain: Array<{ saltId: string; salt: string | null }> = []
    const ids = new Set<string>()
    for (const row of [...rows].sort((a, b) => (CHAIN_ID_RE.test(a.saltId) && CHAIN_ID_RE.test(b.saltId) ? idNumber(a.saltId) - idNumber(b.saltId) : a.saltId < b.saltId ? -1 : 1))) {
      if (!CHAIN_ID_RE.test(row.saltId)) { unavailable.push({ saltId: row.saltId, code: "CORRUPT" }); continue } // fora da cadeia s1,s2…
      ids.add(row.saltId)
      if ("corrupt" in row) { chain.push({ saltId: row.saltId, salt: null }); unavailable.push({ saltId: row.saltId, code: "CORRUPT" }); continue }
      if (row.status === "RETIRED") { chain.push({ saltId: row.saltId, salt: null }); continue }
      const o = open(row)
      if ("code" in o) { chain.push({ saltId: row.saltId, salt: null }); unavailable.push({ saltId: row.saltId, code: o.code }); continue }
      chain.push({ saltId: row.saltId, salt: o.salt })
    }
    return { kr: InMemorySaltKeyring.from(chain.map((e) => ({ userId, ...e }))), unavailable, ids }
  }

  const persistCurrent = async (userId: string, kr: InMemorySaltKeyring): Promise<"CREATED" | "DUPLICATE"> => {
    const cur = kr.current(userId)
    if (cur === null) throw new SaltStoreError("E_SALT_CIPHER_FAILED")
    const enc = cipher.encrypt(cur.salt, aadOf(userId, cur.saltId))
    if (!enc.ok) throw new SaltStoreError("E_SALT_CIPHER_FAILED")
    const res = await store.append({ userId, saltId: cur.saltId, status: "ACTIVE", saltCheck: saltCheck(cur.salt), ciphertext: enc.sealed.ciphertext, nonce: enc.sealed.nonce, keyVersion: enc.sealed.keyVersion, createdAt: now(), retiredAt: null })
    if (res.ok) return "CREATED"
    if (res.code === "DUPLICATE") return "DUPLICATE"
    throw new SaltStoreError("E_SALT_STORE_UNAVAILABLE")
  }

  return {
    async load(userId) {
      const { kr, unavailable } = build(userId, await loadRows(userId))
      const provider: SaltProvider = Object.freeze({
        get: (u: string, s: string) => kr.get(u, s),
        current: (u: string) => kr.current(u),
        known: (u: string) => kr.known(u),
      })
      return { provider, unavailable }
    },
    async ensure(userId) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { kr, ids } = build(userId, await loadRows(userId))
        const { saltId } = kr.ensure(userId) // lança E_SALT_NO_CURRENT como o InMemory
        if (ids.has(saltId)) return { saltId }
        if ((await persistCurrent(userId, kr)) === "CREATED") return { saltId }
        // DUPLICATE: outro escritor criou o s1 primeiro ⇒ recarrega e devolve o dele
      }
      throw new SaltError("E_SALT_DUPLICATE", "não foi possível convergir para um sal único")
    },
    async rotate(userId) {
      const { kr } = build(userId, await loadRows(userId))
      const { saltId } = kr.rotate(userId)
      if ((await persistCurrent(userId, kr)) === "DUPLICATE") throw new SaltError("E_SALT_DUPLICATE", `saltId ${saltId} já existe para o usuário`)
      return { saltId }
    },
    async retire(userId, saltId) {
      const { kr } = build(userId, await loadRows(userId))
      kr.retire(userId, saltId) // E_SALT_UNKNOWN_ID / E_SALT_CURRENT_CANNOT_RETIRE vêm da regra
      const res = await store.retire(userId, saltId, now())
      if (!res.ok) throw new SaltStoreError("E_SALT_STORE_UNAVAILABLE")
    },
    async recipherAll() {
      const users = await store.listUsers()
      if (!users.ok) throw new SaltStoreError("E_SALT_STORE_UNAVAILABLE")
      let rewritten = 0, alreadyCurrent = 0, conflicts = 0
      const skipped: Array<{ userId: string; saltId: string; code: UnavailableCode }> = []
      for (const userId of users.userIds) {
        for (const row of await loadRows(userId)) {
          if ("corrupt" in row) { skipped.push({ userId, saltId: row.saltId, code: "CORRUPT" }); continue }
          if (row.status !== "ACTIVE") continue
          if (row.keyVersion === cipher.currentVersion) { alreadyCurrent++; continue }
          const o = open(row)
          if ("code" in o) { skipped.push({ userId, saltId: row.saltId, code: o.code }); continue }
          const enc = cipher.encrypt(o.salt, aadOf(userId, row.saltId))
          if (!enc.ok) throw new SaltStoreError("E_SALT_CIPHER_FAILED")
          const back = cipher.decrypt(enc.sealed, aadOf(userId, row.saltId)) // confere ANTES de gravar
          if (!back.ok || back.plaintext !== o.salt) throw new SaltStoreError("E_SALT_CIPHER_FAILED")
          const res = await store.replaceCipher(userId, row.saltId, { keyVersion: row.keyVersion as number, nonce: row.nonce as Uint8Array }, enc.sealed)
          if (res.ok) rewritten++
          else if (res.code === "CONFLICT") conflicts++
          else throw new SaltStoreError("E_SALT_STORE_UNAVAILABLE")
        }
      }
      return { rewritten, alreadyCurrent, conflicts, skipped }
    },
  }
}
