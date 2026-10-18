// Estado da conversa persistente (E7-3; decisões D-V1…D-V9 em scripts/expectations/agent-answer.expected.json → e7_3). NADA aqui altera ledger.ts/label.ts/contract.ts: o E7-3 só PERSISTE e RECONSTRÓI o que eles produzem.
// Modelo: a conversa é um LOG DE DELTAS (v1, v2, …). Um commit = UM delta atômico {rotação de época, escritas no ledger, specs, tabela de alias} com `expectedVersion` (concorrência otimista; uma `version` por conversa).
// Em disco o commit cria `v<N+1>.json` por link exclusivo (CAS atômico sem lock); em memória, a mesma semântica. No Prisma de produção o log vira linhas + transação.
// Leitura: o log é dobrado (fold) para um MODELO RELACIONAL (linhas com `seq`, épocas em ordem, specs, alias) e o ledger é remontado pelas funções PURAS do domínio, em ordem (índice da época, seq): newLedger → addEvidence →
// rotateEpoch → addEvidence… (uma entrada antiga não passa por addEvidence na época nova, e o refresh sobrescreve a linha no lugar — por isso não basta ordenar por seq). Qualquer inconsistência ⇒ CORRUPT (só daquela conversa).
// Nada lança; erros são códigos fixos, sem mensagem, sem caminho e sem eco. O valor das specs/alias nunca contém nome de conta: refs de alias são hashes `acc_/str_/lbl_` (formato conferido); specs não podem conter nenhum.
import { link, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { CAPABILITY_IDS, EVIDENCE_REF_RE } from "../agent/contract.ts"
import { newAliasTable, type AliasTable } from "../agent/label.ts"
import { addEvidence, lookupRef, newLedger, refreshEvidence, rotateEpoch, type Ledger } from "../agent/ledger.ts"
import { canonicalJson, randomHex } from "./hash.ts"

export const MAX_LEDGER_ENTRIES = 500
export const MAX_ROW_BYTES = 256 * 1024
export const MAX_DELTA_BYTES = 2 * 1024 * 1024
const MAX_VERSION = 999_999
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const EPOCH_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ALIAS_REF_RE = { conta: /^acc_[0-9a-f]{24}$/, estrategia: /^str_[0-9a-f]{24}$/, rotulo: /^lbl_[0-9a-f]{24}$/ } as const
const KINDS = ["conta", "estrategia", "rotulo"] as const
const REAL_REF_RE = /(?:^|[^a-z])(?:acc|str|lbl|pat)_[0-9a-f]{24}/
const MAX_ALIASES = 26 + 26 ** 2 + 26 ** 3
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const isId = (x: unknown): x is string => typeof x === "string" && ID_RE.test(x)
const isIso = (x: unknown): x is string => typeof x === "string" && x.length >= 10 && x.length <= 40 && !Number.isNaN(Date.parse(x))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const bytesOf = (x: unknown): number => Buffer.byteLength(JSON.stringify(x), "utf8")
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ───────────────────────────── tipos do log ─────────────────────────────
export interface LedgerWrite { readonly op: "add" | "refresh"; readonly capability: string; readonly handle: unknown; readonly view: unknown }
export interface SpecWrite { readonly evidenceRef: string; readonly capability: string; readonly args: unknown }
export interface DeltaBody { readonly rotateTo: string | null; readonly writes: readonly LedgerWrite[]; readonly specs: readonly SpecWrite[]; readonly alias: AliasTable | null }
export interface StoredDelta extends DeltaBody { readonly version: number; readonly createdAt: string }
export interface CorruptDelta { readonly version: number; readonly corrupt: true }
export interface ConversationMeta { readonly userId: string; readonly conversationId: string; readonly epoch: string; readonly createdAt: string }

export type ConversationStoreCode = "INVALID_ARGS" | "NOT_FOUND" | "DUPLICATE" | "CONFLICT" | "ROW_TOO_LARGE" | "DELTA_TOO_LARGE" | "CORRUPT" | "STORAGE_ERROR"
export interface ConversationStoreFailure { readonly ok: false; readonly code: ConversationStoreCode }
export const conversationStoreFailure = (code: ConversationStoreCode): ConversationStoreFailure => ({ ok: false, code })

export interface ConversationStore {
  /** Cria a conversa (versão 0). Já existe ⇒ DUPLICATE. */
  create(meta: ConversationMeta): Promise<{ readonly ok: true } | ConversationStoreFailure>
  /** Meta + todos os deltas em ordem (v1…vN). Ausente (ou de outro usuário) ⇒ NOT_FOUND; lacuna no log ⇒ CORRUPT; delta ilegível ⇒ `CorruptDelta` naquela posição. */
  load(userId: string, conversationId: string): Promise<{ readonly ok: true; readonly meta: ConversationMeta; readonly deltas: ReadonlyArray<StoredDelta | CorruptDelta> } | ConversationStoreFailure>
  /** Grava o delta de versão `expectedVersion + 1` SÓ se a conversa está exatamente em `expectedVersion`; senão CONFLICT, sem nenhum efeito. */
  commit(userId: string, conversationId: string, expectedVersion: number, delta: DeltaBody, createdAt: string): Promise<{ readonly ok: true; readonly version: number } | ConversationStoreFailure>
}

// ───────────────────────────── validação estrutural (memória e disco usam a mesma régua) ─────────────────────────────
export function parseAliasTable(x: unknown): AliasTable | null {
  try {
    if (!isRecord(x) || Object.keys(x).sort().join(",") !== "conta,epoch,estrategia,rotulo" || typeof x.epoch !== "string" || !EPOCH_RE.test(x.epoch)) return null
    const out: Record<string, readonly string[]> = {}
    for (const k of KINDS) {
      const list = x[k]
      if (!Array.isArray(list) || list.length > MAX_ALIASES || new Set(list).size !== list.length || !list.every((r) => typeof r === "string" && ALIAS_REF_RE[k].test(r))) return null
      out[k] = Object.freeze([...list] as string[])
    }
    return Object.freeze({ epoch: x.epoch, conta: out.conta, estrategia: out.estrategia, rotulo: out.rotulo })
  } catch {
    return null
  }
}

/** Formato do delta (não a semântica do ledger — essa é do domínio). Devolve uma CÓPIA; inválido ⇒ null. */
export function parseDeltaBody(x: unknown): DeltaBody | null {
  try {
    if (!isRecord(x)) return null
    const keys = Object.keys(x).sort().join(",")
    if (keys !== "alias,rotateTo,specs,writes" && keys !== "alias,createdAt,rotateTo,specs,version,writes") return null
    if (x.rotateTo !== null && (typeof x.rotateTo !== "string" || !EPOCH_RE.test(x.rotateTo))) return null
    if (!Array.isArray(x.writes) || !Array.isArray(x.specs)) return null
    const writes: LedgerWrite[] = []
    for (const w of x.writes) {
      if (!isRecord(w) || Object.keys(w).sort().join(",") !== "capability,handle,op,view" || (w.op !== "add" && w.op !== "refresh") || typeof w.capability !== "string") return null
      canonicalJson(w.handle); canonicalJson(w.view) // só JSON puro
      writes.push({ op: w.op, capability: w.capability, handle: clone(w.handle), view: clone(w.view) })
    }
    const specs: SpecWrite[] = []
    for (const s of x.specs) {
      if (!isRecord(s) || Object.keys(s).sort().join(",") !== "args,capability,evidenceRef" || typeof s.evidenceRef !== "string" || !EVIDENCE_REF_RE.test(s.evidenceRef) || typeof s.capability !== "string" || !(CAPABILITY_IDS as readonly string[]).includes(s.capability)) return null
      canonicalJson(s.args)
      specs.push({ evidenceRef: s.evidenceRef, capability: s.capability, args: clone(s.args) })
    }
    let alias: AliasTable | null = null
    if (x.alias !== null) { alias = parseAliasTable(x.alias); if (alias === null) return null }
    return { rotateTo: x.rotateTo as string | null, writes, specs, alias }
  } catch {
    return null
  }
}

const parseStoredDelta = (x: unknown, version: number): StoredDelta | null => {
  const body = isRecord(x) && x.version === version && isIso(x.createdAt) ? parseDeltaBody(x) : null
  return body === null ? null : { version, createdAt: (x as { createdAt: string }).createdAt, ...body }
}
const parseMeta = (x: unknown, userId: string, conversationId: string): ConversationMeta | null => {
  if (!isRecord(x) || Object.keys(x).sort().join(",") !== "conversationId,createdAt,epoch,userId") return null
  return x.userId === userId && x.conversationId === conversationId && typeof x.epoch === "string" && EPOCH_RE.test(x.epoch) && isIso(x.createdAt) ? { userId, conversationId, epoch: x.epoch, createdAt: x.createdAt } : null
}

/** Limites do armazenamento (por linha e por delta): a camada que grava é a que recusa. */
function checkSizes(delta: DeltaBody): "ROW_TOO_LARGE" | "DELTA_TOO_LARGE" | null {
  for (const w of delta.writes) if (bytesOf({ handle: w.handle, view: w.view }) > MAX_ROW_BYTES) return "ROW_TOO_LARGE"
  return bytesOf(delta) > MAX_DELTA_BYTES ? "DELTA_TOO_LARGE" : null
}
function checkCommitArgs(userId: unknown, conversationId: unknown, expectedVersion: unknown, delta: unknown, createdAt: unknown): { readonly delta: DeltaBody } | ConversationStoreFailure {
  if (!isId(userId) || !isId(conversationId) || !Number.isInteger(expectedVersion) || (expectedVersion as number) < 0 || (expectedVersion as number) >= MAX_VERSION || !isIso(createdAt)) return conversationStoreFailure("INVALID_ARGS")
  const parsed = parseDeltaBody(delta)
  if (parsed === null) return conversationStoreFailure("INVALID_ARGS")
  const size = checkSizes(parsed)
  return size === null ? { delta: parsed } : conversationStoreFailure(size)
}

// ───────────────────────────── memória ─────────────────────────────
export function createMemoryConversationStore(): ConversationStore {
  const convs = new Map<string, { meta: ConversationMeta; deltas: StoredDelta[] }>()
  const key = (u: string, c: string): string => `${u}/${c}`
  return {
    async create(meta) {
      if (!isId(meta?.userId) || !isId(meta?.conversationId) || parseMeta(meta, meta.userId, meta.conversationId) === null) return conversationStoreFailure("INVALID_ARGS")
      const k = key(meta.userId, meta.conversationId)
      if (convs.has(k)) return conversationStoreFailure("DUPLICATE")
      convs.set(k, { meta: { ...meta }, deltas: [] })
      return { ok: true }
    },
    async load(userId, conversationId) {
      if (!isId(userId) || !isId(conversationId)) return conversationStoreFailure("INVALID_ARGS")
      const c = convs.get(key(userId, conversationId))
      if (c === undefined) return conversationStoreFailure("NOT_FOUND")
      return { ok: true, meta: { ...c.meta }, deltas: c.deltas.map((d) => clone(d)) }
    },
    async commit(userId, conversationId, expectedVersion, delta, createdAt) {
      const checked = checkCommitArgs(userId, conversationId, expectedVersion, delta, createdAt)
      if ("ok" in checked) return checked
      const c = convs.get(key(userId, conversationId))
      if (c === undefined) return conversationStoreFailure("NOT_FOUND")
      if (c.deltas.length !== expectedVersion) return conversationStoreFailure("CONFLICT")
      const version = expectedVersion + 1
      c.deltas.push({ version, createdAt, ...checked.delta })
      return { ok: true, version }
    },
  }
}

// ───────────────────────────── disco ─────────────────────────────
// Layout: {root}/conversations/{userId}/{conversationId}/meta.json e v000001.json, v000002.json…; arquivos 0600, diretórios 0700. Criação ATÔMICA de cada arquivo: temporário exclusivo (`wx`) + hard link para o nome final
// (falha se já existe ⇒ DUPLICATE/CONFLICT com escritores simultâneos). Nunca reescreve um delta. Recusa SEGUIR symlink. Lacuna no log ⇒ CORRUPT. Nenhum método lança.
export interface DiskConversationOps { link: typeof link; lstat: typeof lstat; mkdir: typeof mkdir; readFile: typeof readFile; readdir: typeof readdir; unlink: typeof unlink; writeFile: typeof writeFile }
const codeOf = (e: unknown): string | undefined => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined)
const vName = (n: number): string => `v${String(n).padStart(6, "0")}.json`

export function createDiskConversationStore(rootDir: string, overrides: Partial<DiskConversationOps> = {}): ConversationStore {
  if (typeof rootDir !== "string" || rootDir === "" || !isAbsolute(rootDir)) throw new TypeError("rootDir precisa ser um caminho absoluto")
  const root = resolve(rootDir)
  const ops: DiskConversationOps = { link, lstat, mkdir, readFile, readdir, unlink, writeFile, ...overrides }
  const base = join(root, "conversations")
  const inside = (p: string): boolean => { const rel = relative(root, p); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) }
  const noSymlinks = async (list: string[]): Promise<boolean> => {
    for (const p of list) {
      try { if ((await ops.lstat(p)).isSymbolicLink()) return false } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
    }
    return true
  }
  const dirs = (u: string, c: string): { userDir: string; dir: string } => { const userDir = join(base, u); return { userDir, dir: join(userDir, c) } }
  const prepare = async (u: string, c: string, create: boolean): Promise<string | null> => {
    const { userDir, dir } = dirs(u, c)
    if (!inside(dir) || !(await noSymlinks([base, userDir, dir]))) return null
    if (create) {
      await ops.mkdir(dir, { recursive: true, mode: 0o700 })
      if (!(await noSymlinks([base, userDir, dir]))) return null
    }
    return dir
  }
  /** Criação exclusiva: "created" ⇒ ok; já existia ⇒ "exists"; qualquer outra falha ⇒ lança (quem chamou traduz). Remove o temporário SEMPRE. */
  const createExclusive = async (dir: string, name: string, text: string): Promise<"created" | "exists"> => {
    const tmp = join(dir, `.${name}.${randomHex(8)}.tmp`)
    try {
      await ops.writeFile(tmp, text, { mode: 0o600, flag: "wx" })
      try { await ops.link(tmp, join(dir, name)) } catch (e) { if (codeOf(e) === "EEXIST") return "exists"; throw e }
      return "created"
    } finally {
      await ops.unlink(tmp).catch(() => undefined)
    }
  }
  const exists = async (p: string): Promise<boolean> => { try { await ops.lstat(p); return true } catch (e) { if (codeOf(e) === "ENOENT") return false; throw e } }

  return {
    async create(meta) {
      try {
        if (!isId(meta?.userId) || !isId(meta?.conversationId) || parseMeta(meta, meta.userId, meta.conversationId) === null) return conversationStoreFailure("INVALID_ARGS")
        const dir = await prepare(meta.userId, meta.conversationId, true)
        if (dir === null) return conversationStoreFailure("STORAGE_ERROR")
        const r = await createExclusive(dir, "meta.json", JSON.stringify({ conversationId: meta.conversationId, createdAt: meta.createdAt, epoch: meta.epoch, userId: meta.userId }))
        return r === "created" ? { ok: true } : conversationStoreFailure("DUPLICATE")
      } catch {
        return conversationStoreFailure("STORAGE_ERROR")
      }
    },
    async load(userId, conversationId) {
      try {
        if (!isId(userId) || !isId(conversationId)) return conversationStoreFailure("INVALID_ARGS")
        const dir = await prepare(userId, conversationId, false)
        if (dir === null) return conversationStoreFailure("STORAGE_ERROR")
        let metaText: string
        try { metaText = await ops.readFile(join(dir, "meta.json"), "utf8") } catch (e) { return conversationStoreFailure(codeOf(e) === "ENOENT" || codeOf(e) === "ENOTDIR" ? "NOT_FOUND" : "STORAGE_ERROR") }
        let meta: ConversationMeta | null = null
        try { meta = parseMeta(JSON.parse(metaText), userId, conversationId) } catch { meta = null }
        if (meta === null) return conversationStoreFailure("CORRUPT")
        const versions = (await ops.readdir(dir)).map((n) => /^v(\d{6})\.json$/.exec(n)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1])).sort((a, b) => a - b)
        if (versions.some((v, i) => v !== i + 1)) return conversationStoreFailure("CORRUPT") // lacuna no log
        const deltas: Array<StoredDelta | CorruptDelta> = []
        for (const v of versions) {
          let parsed: StoredDelta | null = null
          try { parsed = parseStoredDelta(JSON.parse(await ops.readFile(join(dir, vName(v)), "utf8")), v) } catch { parsed = null }
          deltas.push(parsed ?? { version: v, corrupt: true })
        }
        return { ok: true, meta, deltas }
      } catch {
        return conversationStoreFailure("STORAGE_ERROR")
      }
    },
    async commit(userId, conversationId, expectedVersion, delta, createdAt) {
      try {
        const checked = checkCommitArgs(userId, conversationId, expectedVersion, delta, createdAt)
        if ("ok" in checked) return checked
        const dir = await prepare(userId, conversationId, false)
        if (dir === null) return conversationStoreFailure("STORAGE_ERROR")
        if (!(await exists(join(dir, "meta.json")))) return conversationStoreFailure("NOT_FOUND")
        if (expectedVersion > 0 && !(await exists(join(dir, vName(expectedVersion))))) return conversationStoreFailure("CONFLICT") // versão futura: não há como "pular" o log
        const version = expectedVersion + 1
        const r = await createExclusive(dir, vName(version), JSON.stringify({ alias: checked.delta.alias, createdAt, rotateTo: checked.delta.rotateTo, specs: checked.delta.specs, version, writes: checked.delta.writes }))
        return r === "created" ? { ok: true, version } : conversationStoreFailure("CONFLICT")
      } catch {
        return conversationStoreFailure("STORAGE_ERROR")
      }
    },
  }
}

// ───────────────────────────── modelo (fold do log) e remontagem do ledger ─────────────────────────────
interface Row { readonly seq: number; readonly capability: string; readonly handle: unknown; readonly view: unknown }
interface Model {
  readonly userId: string
  readonly conversationId: string
  readonly version: number
  readonly epochs: readonly string[]
  readonly rows: ReadonlyMap<string, Row>
  readonly specs: ReadonlyMap<string, { readonly capability: string; readonly args: unknown }>
  readonly alias: AliasTable | null
  readonly seq: number
}
const currentEpoch = (m: { epochs: readonly string[] }): string => m.epochs[m.epochs.length - 1]

/** Regra do alias entre turnos: da época vigente; dentro da MESMA época só pode crescer pelo fim (senão "Conta A" mudaria de dono). */
export function checkAliasStep(prev: AliasTable | null, epoch: string, next: AliasTable): "ALIAS_EPOCH_MISMATCH" | "ALIAS_NOT_EXTENDING" | null {
  if (next.epoch !== epoch) return "ALIAS_EPOCH_MISMATCH"
  if (prev !== null && prev.epoch === next.epoch) {
    for (const k of KINDS) if (prev[k].length > next[k].length || !prev[k].every((r, i) => next[k][i] === r)) return "ALIAS_NOT_EXTENDING"
  }
  return null
}

function foldDelta(m: Model, d: StoredDelta): Model | null {
  if (d.version !== m.version + 1) return null
  let epochs = m.epochs
  if (d.rotateTo !== null) { if (d.rotateTo === currentEpoch(m) || epochs.includes(d.rotateTo)) return null; epochs = [...epochs, d.rotateTo] }
  const rows = new Map(m.rows)
  let seq = m.seq
  for (const w of d.writes) {
    const ref = isRecord(w.handle) ? w.handle.evidenceRef : undefined
    if (typeof ref !== "string" || !EVIDENCE_REF_RE.test(ref)) return null
    const prev = rows.get(ref)
    if (w.op === "add" && prev !== undefined) { if (!sameJson({ c: prev.capability, h: prev.handle, v: prev.view }, { c: w.capability, h: w.handle, v: w.view })) return null; continue }
    rows.set(ref, { seq: prev !== undefined ? prev.seq : ++seq, capability: w.capability, handle: w.handle, view: w.view }) // refresh sobrescreve NO LUGAR (mantém o seq)
  }
  const specs = new Map(m.specs)
  for (const s of d.specs) {
    const prev = specs.get(s.evidenceRef)
    if (prev !== undefined && !sameJson(prev, { capability: s.capability, args: s.args })) return null
    specs.set(s.evidenceRef, { capability: s.capability, args: s.args })
  }
  if (d.alias !== null && checkAliasStep(m.alias, epochs[epochs.length - 1], d.alias) !== null) return null
  return { ...m, version: d.version, epochs, rows, specs, alias: d.alias ?? m.alias, seq }
}

/** Remonta o ledger pelas funções PURAS, em ordem (índice da época, seq). Linha inválida, época desconhecida ou contagem diferente ⇒ null. */
function ledgerOf(m: Model): Ledger | null {
  const first = newLedger(m.epochs[0])
  if (!first.ok) return null
  let ledger = first.ledger
  const byEpoch = new Map<string, Array<[string, Row]>>(m.epochs.map((e) => [e, []]))
  for (const [ref, row] of m.rows) {
    const epoch = isRecord(row.handle) ? row.handle.refEpoch : undefined
    const bucket = typeof epoch === "string" ? byEpoch.get(epoch) : undefined
    if (bucket === undefined) return null
    bucket.push([ref, row])
  }
  for (let i = 0; i < m.epochs.length; i++) {
    if (i > 0) { const r = rotateEpoch(ledger, m.epochs[i]); if (!r.ok) return null; ledger = r.ledger }
    for (const [, row] of byEpoch.get(m.epochs[i])!.sort((a, b) => a[1].seq - b[1].seq)) {
      const r = addEvidence(ledger, { capability: row.capability, handle: row.handle, view: row.view })
      if (!r.ok) return null
      ledger = r.ledger
    }
  }
  return Object.keys(ledger.entries).length === m.rows.size ? ledger : null
}

// ───────────────────────────── a fachada ─────────────────────────────
export interface OpenConversation {
  readonly conversationId: string
  readonly version: number
  readonly epoch: string
  readonly ledger: Ledger
  /** Tabela de alias da época vigente (nova e vazia se a época mudou sem alocação). */
  readonly aliases: AliasTable
  /** A consulta original do ref (cópia), ou null. Síncrono: o que o `evidence.refresh` espera em `ctx.specOf`. */
  specOf(evidenceRef: string): { capability: string; args: unknown } | null
}
export type ConversationErrorCode =
  | "INVALID_ARGS" | "NOT_FOUND" | "DUPLICATE" | "CONFLICT" | "CORRUPT" | "STORAGE_ERROR"
  | "LEDGER_ENTRY_INVALID" | "LEDGER_CONFLICT" | "LEDGER_EPOCH_INVALID"
  | "ALIAS_INVALID" | "ALIAS_EPOCH_MISMATCH" | "ALIAS_NOT_EXTENDING"
  | "SPEC_INVALID" | "SPEC_REF_UNKNOWN" | "SPEC_HAS_REAL_REF" | "SPEC_CONFLICT"
  | "LIMIT_ENTRIES" | "LIMIT_ROW" | "LIMIT_DELTA"
export interface ConversationFailure { readonly ok: false; readonly code: ConversationErrorCode }
const fail = (code: ConversationErrorCode): ConversationFailure => ({ ok: false, code })

export interface TurnChange {
  /** Nova época vigente (aplicada ANTES das escritas; as entradas antigas viram STALE). */
  readonly rotateTo?: string
  /** `add` = addEvidence; `refresh` = refreshEvidence (STALE → CURRENT no mesmo ref). */
  readonly writes?: ReadonlyArray<{ readonly op: "add" | "refresh"; readonly entry: unknown }>
  /** A consulta original de cada ref gravado/existente (aliases, nunca refs reais). */
  readonly specs?: ReadonlyArray<{ readonly evidenceRef: string; readonly capability: string; readonly args: unknown }>
  /** A tabela de alias que a capacidade devolveu (da época vigente, só crescendo pelo fim). */
  readonly aliases?: AliasTable
}

export interface Conversations {
  create(userId: string, epoch: string, conversationId?: string): Promise<{ readonly ok: true; readonly open: OpenConversation } | ConversationFailure>
  open(userId: string, conversationId: string): Promise<{ readonly ok: true; readonly open: OpenConversation } | ConversationFailure>
  /** UM commit atômico. Conflito de versão ⇒ CONFLICT (sem retry; quem orquestra decide). Sucesso devolve o NOVO estado já aberto. */
  commitTurn(open: OpenConversation, change: TurnChange): Promise<{ readonly ok: true; readonly version: number; readonly open: OpenConversation } | ConversationFailure>
}

export function createConversations(deps: { store: ConversationStore; now?: () => string }): Conversations {
  const { store } = deps
  const now = deps.now ?? ((): string => new Date().toISOString())
  const models = new WeakMap<OpenConversation, Model>() // só estados produzidos por esta fachada podem ser commitados

  const makeOpen = (m: Model, ledger: Ledger): OpenConversation => {
    const aliases = m.alias !== null && m.alias.epoch === currentEpoch(m) ? m.alias : newAliasTable(currentEpoch(m))
    const open: OpenConversation = Object.freeze({
      conversationId: m.conversationId, version: m.version, epoch: currentEpoch(m), ledger, aliases,
      specOf: (ref: string) => { const s = typeof ref === "string" && EVIDENCE_REF_RE.test(ref) ? m.specs.get(ref) : undefined; return s === undefined ? null : clone({ capability: s.capability, args: s.args }) },
    })
    models.set(open, m)
    return open
  }
  const build = (meta: ConversationMeta, deltas: ReadonlyArray<StoredDelta | CorruptDelta>): { readonly ok: true; readonly open: OpenConversation } | ConversationFailure => {
    let m: Model | null = { userId: meta.userId, conversationId: meta.conversationId, version: 0, epochs: [meta.epoch], rows: new Map(), specs: new Map(), alias: null, seq: 0 }
    for (const d of deltas) { if ("corrupt" in d) return fail("CORRUPT"); m = foldDelta(m, d); if (m === null) return fail("CORRUPT") }
    const ledger = ledgerOf(m)
    return ledger === null ? fail("CORRUPT") : { ok: true, open: makeOpen(m, ledger) }
  }
  const mapStore = (code: ConversationStoreCode): ConversationFailure => fail(code === "ROW_TOO_LARGE" ? "LIMIT_ROW" : code === "DELTA_TOO_LARGE" ? "LIMIT_DELTA" : code)

  return {
    async create(userId, epoch, conversationId) {
      try {
        const id = conversationId ?? `c${randomHex(15)}`
        const meta: ConversationMeta = { userId, conversationId: id, epoch, createdAt: now() }
        const created = await store.create(meta)
        if (!created.ok) return mapStore(created.code)
        const loaded = await store.load(userId, id)
        return loaded.ok ? build(loaded.meta, loaded.deltas) : mapStore(loaded.code)
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
    async open(userId, conversationId) {
      try {
        const loaded = await store.load(userId, conversationId)
        return loaded.ok ? build(loaded.meta, loaded.deltas) : mapStore(loaded.code)
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
    async commitTurn(open, change) {
      try {
        const m = models.get(open)
        if (m === undefined || !isRecord(change) || Object.keys(change).some((k) => !["rotateTo", "writes", "specs", "aliases"].includes(k))) return fail("INVALID_ARGS")
        const { rotateTo, writes = [], specs = [] } = change
        if (!Array.isArray(writes) || !Array.isArray(specs) || (rotateTo !== undefined && typeof rotateTo !== "string")) return fail("INVALID_ARGS")
        if (rotateTo === undefined && writes.length === 0 && specs.length === 0 && change.aliases === undefined) return fail("INVALID_ARGS") // commit vazio não avança a versão

        // 1) ledger: SÓ as funções puras decidem
        let ledger = open.ledger
        if (rotateTo !== undefined) { const r = rotateEpoch(ledger, rotateTo); if (!r.ok) return fail(r.code); ledger = r.ledger }
        const written: string[] = []
        for (const w of writes) {
          if (!isRecord(w) || Object.keys(w).sort().join(",") !== "entry,op" || (w.op !== "add" && w.op !== "refresh")) return fail("INVALID_ARGS")
          const r = w.op === "add" ? addEvidence(ledger, w.entry) : refreshEvidence(ledger, w.entry)
          if (!r.ok) return fail(r.code)
          ledger = r.ledger
          const ref = isRecord(w.entry) && isRecord(w.entry.handle) ? w.entry.handle.evidenceRef : undefined
          if (typeof ref === "string") written.push(ref)
        }
        if (Object.keys(ledger.entries).length > MAX_LEDGER_ENTRIES) return fail("LIMIT_ENTRIES")

        // 2) alias: da época vigente, só crescendo pelo fim
        let alias: AliasTable | null = null
        if (change.aliases !== undefined) {
          const parsed = parseAliasTable(change.aliases)
          if (parsed === null) return fail("ALIAS_INVALID")
          const bad = checkAliasStep(open.aliases, ledger.epoch, parsed)
          if (bad !== null) return fail(bad)
          alias = sameJson(parsed, open.aliases) ? null : parsed
        }

        // 3) specs: ref existente no ledger, mesma capacidade, args puros e SEM refs reais
        const specWrites: SpecWrite[] = []
        for (const s of specs) {
          if (!isRecord(s) || Object.keys(s).sort().join(",") !== "args,capability,evidenceRef" || typeof s.evidenceRef !== "string" || !EVIDENCE_REF_RE.test(s.evidenceRef) || typeof s.capability !== "string" || !(CAPABILITY_IDS as readonly string[]).includes(s.capability)) return fail("SPEC_INVALID")
          const entry = lookupRef(ledger, s.evidenceRef)
          if (entry === null) return fail("SPEC_REF_UNKNOWN")
          if (entry.capability !== s.capability) return fail("SPEC_INVALID")
          let text: string
          try { text = canonicalJson(s.args) } catch { return fail("SPEC_INVALID") }
          if (REAL_REF_RE.test(text)) return fail("SPEC_HAS_REAL_REF")
          const have = m.specs.get(s.evidenceRef)
          if (have !== undefined && !sameJson(have, { capability: s.capability, args: clone(s.args) })) return fail("SPEC_CONFLICT")
          specWrites.push({ evidenceRef: s.evidenceRef, capability: s.capability, args: clone(s.args) })
        }

        // 4) o que se grava é a forma NORMALIZADA que o domínio aceitou (saída do zod), não a entrada crua
        const body: DeltaBody = {
          rotateTo: rotateTo ?? null,
          writes: writes.map((w, i) => { const e = lookupRef(ledger, written[i])!; return { op: (w as { op: "add" | "refresh" }).op, capability: e.capability, handle: clone(e.handle), view: clone(e.view) } }),
          specs: specWrites,
          alias,
        }
        const res = await store.commit(m.userId, m.conversationId, m.version, body, now())
        if (!res.ok) return mapStore(res.code)
        const next = foldDelta(m, { version: res.version, createdAt: now(), ...parseDeltaBody(body)! })
        const nextLedger = next === null ? null : ledgerOf(next)
        return next === null || nextLedger === null ? fail("STORAGE_ERROR") : { ok: true, version: res.version, open: makeOpen(next, nextLedger) }
      } catch {
        return fail("STORAGE_ERROR")
      }
    },
  }
}
