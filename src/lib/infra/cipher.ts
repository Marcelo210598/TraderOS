// Adaptador de cifra (E7-2): AES-256-GCM da plataforma (node:crypto). Junto com ./hash.ts, é o ÚNICO lugar do domínio que conhece node:crypto. Sem criptografia manual.
// API tipada por RESULTADO: nada lança; os erros são códigos fixos, SEM mensagem e sem eco de plaintext, chave, nonce ou AAD.
// O nonce (96 bits) é sorteado AQUI dentro, a cada cifragem (o chamador não tem como reusar). A AAD é autenticada junto: mudou ⇒ AUTH_FAILED.
// Chaves mestras (D-C4): SALT_MASTER_KEY = a ATUAL (versão em SALT_MASTER_KEY_VERSION, padrão 1); SALT_MASTER_KEY_PREV_<n> = versões anteriores (n < atual) durante a janela de rotação.
// Cada chave: exatamente 32 bytes em hex (64 chars) ou base64 padrão (44 chars); recusa vazia, tamanho errado, toda zero e a MESMA chave em duas versões.
// As chaves ficam em closure (não em propriedade): JSON.stringify, inspect e spread do objeto devolvido não as enxergam.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export const NONCE_BYTES = 12
export const TAG_BYTES = 16
const KEY_BYTES = 32
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/
const B64_KEY_RE = /^[A-Za-z0-9+/]{43}=$/
const PREV_RE = /^SALT_MASTER_KEY_PREV_(\d+)$/

export type CipherErrorCode = "KEY_INVALID" | "KEY_VERSION_UNKNOWN" | "INPUT_INVALID" | "AUTH_FAILED"
export interface CipherFailure { readonly ok: false; readonly code: CipherErrorCode }
const fail = (code: CipherErrorCode): CipherFailure => ({ ok: false, code })

export interface Sealed { readonly nonce: Uint8Array; readonly ciphertext: Uint8Array; readonly keyVersion: number }

export interface SaltCipher {
  /** Versão da chave que cifra daqui para a frente. */
  readonly currentVersion: number
  /** Todas as versões que sabem decifrar (atual + anteriores), da mais nova à mais velha. */
  readonly versions: readonly number[]
  /** Cifra com a chave ATUAL e um nonce novo. `ciphertext` = texto cifrado + tag (16 bytes). */
  encrypt(plaintext: string, aad: string): { readonly ok: true; readonly sealed: Sealed } | CipherFailure
  /** Decifra com a chave da `keyVersion` do registro. Qualquer falha de autenticação ⇒ AUTH_FAILED (nunca devolve texto parcial). */
  decrypt(sealed: Sealed, aad: string): { readonly ok: true; readonly plaintext: string } | CipherFailure
}

/** 32 bytes em hex ou base64; qualquer outra coisa (inclusive toda zero) ⇒ null. */
function decodeKey(raw: unknown): Buffer | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  let buf: Buffer
  if (HEX_KEY_RE.test(s)) buf = Buffer.from(s, "hex")
  else if (B64_KEY_RE.test(s)) buf = Buffer.from(s, "base64")
  else return null
  if (buf.length !== KEY_BYTES || buf.every((b) => b === 0)) return null
  return buf
}

/**
 * Monta o cifrador a partir das variáveis de ambiente (ou de um objeto equivalente nos testes).
 * Fail-closed: qualquer inconsistência ⇒ KEY_INVALID, sem dizer qual variável nem o valor.
 */
export function createSaltCipher(env: Readonly<Record<string, string | undefined>>): { readonly ok: true; readonly cipher: SaltCipher } | CipherFailure {
  try {
    const current = decodeKey(env.SALT_MASTER_KEY)
    if (current === null) return fail("KEY_INVALID")
    const rawVersion = env.SALT_MASTER_KEY_VERSION
    let currentVersion = 1
    if (rawVersion !== undefined && rawVersion !== "") {
      if (!/^[1-9]\d{0,5}$/.test(rawVersion)) return fail("KEY_INVALID")
      currentVersion = Number(rawVersion)
    }
    const keys = new Map<number, Buffer>([[currentVersion, current]])
    for (const name of Object.keys(env)) {
      const m = PREV_RE.exec(name)
      if (m === null) continue
      if (!/^[1-9]\d{0,5}$/.test(m[1])) return fail("KEY_INVALID")
      const version = Number(m[1])
      if (version >= currentVersion || keys.has(version)) return fail("KEY_INVALID")
      const key = decodeKey(env[name])
      if (key === null) return fail("KEY_INVALID")
      for (const other of keys.values()) if (other.equals(key)) return fail("KEY_INVALID") // versões distintas com a mesma chave não rotacionam nada
      keys.set(version, key)
    }
    const versions = [...keys.keys()].sort((a, b) => b - a)

    const cipher: SaltCipher = {
      currentVersion,
      versions,
      encrypt(plaintext, aad) {
        try {
          if (typeof plaintext !== "string" || plaintext === "" || typeof aad !== "string" || aad === "") return fail("INPUT_INVALID")
          const nonce = randomBytes(NONCE_BYTES)
          const c = createCipheriv("aes-256-gcm", current, nonce, { authTagLength: TAG_BYTES })
          c.setAAD(Buffer.from(aad, "utf8"))
          const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()])
          const ciphertext = new Uint8Array(Buffer.concat([body, c.getAuthTag()]))
          return { ok: true, sealed: { nonce: new Uint8Array(nonce), ciphertext, keyVersion: currentVersion } }
        } catch {
          return fail("INPUT_INVALID")
        }
      },
      decrypt(sealed, aad) {
        try {
          if (typeof sealed !== "object" || sealed === null || typeof aad !== "string" || aad === "") return fail("INPUT_INVALID")
          const { nonce, ciphertext, keyVersion } = sealed
          if (!(nonce instanceof Uint8Array) || !(ciphertext instanceof Uint8Array) || !Number.isInteger(keyVersion)) return fail("INPUT_INVALID")
          if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength <= TAG_BYTES) return fail("INPUT_INVALID")
          const key = keys.get(keyVersion)
          if (key === undefined) return fail("KEY_VERSION_UNKNOWN")
          const d = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES })
          d.setAAD(Buffer.from(aad, "utf8"))
          d.setAuthTag(Buffer.from(ciphertext.subarray(ciphertext.byteLength - TAG_BYTES)))
          const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.byteLength - TAG_BYTES)), d.final()])
          return { ok: true, plaintext: plain.toString("utf8") }
        } catch {
          return fail("AUTH_FAILED")
        }
      },
    }
    return { ok: true, cipher: Object.freeze(cipher) }
  } catch {
    return fail("KEY_INVALID")
  }
}
