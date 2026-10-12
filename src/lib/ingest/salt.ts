// Política de sal por usuário — P1 (salt-policy-plano.md): funções puras. NÃO ligado a nada ainda (nenhum outro módulo importa este arquivo;
// o teste test-salt-policy-p1.mts trava isso). Decisões D1–D7 aprovadas em 12/10/2026.
//   D1 1 sal por usuário · D2 gerado pelo sistema, ≥ 256 bits · D5 SaltProvider como interface, só em memória nesta fase
//   D6 chaveiro versionado (s1, s2…): só o atual gera; antigos verificam; aposentar apaga o VALOR e mantém o registro.
// O valor do sal NUNCA aparece em erro, JSON, inspect ou log deste módulo.

import { SALT_CHECK_RE, SALT_ID_RE } from "../domain/canonical.ts"
import { randomHex, sha256Hex } from "../infra/hash.ts"

export { SALT_CHECK_RE, SALT_ID_RE } // fonte única dos formatos: domain/canonical.ts (o schema da Evidence os usa)

export const SALT_MIN_BYTES = 32
/** Sal de produto: hex minúsculo, ≥ 32 bytes (64 chars), tamanho par. */
const STRONG_SALT_RE = /^(?:[0-9a-f]{2}){32,}$/
const SALT_CHECK_DOMAIN = "meutrade/saltCheck/1"

export type SaltErrorCode = "E_SALT_WEAK" | "E_SALT_ID_INVALID" | "E_SALT_USER_INVALID" | "E_SALT_DUPLICATE" | "E_SALT_UNKNOWN_ID" | "E_SALT_CURRENT_CANNOT_RETIRE" | "E_SALT_NO_CURRENT"
export class SaltError extends Error {
  readonly code: SaltErrorCode
  constructor(code: SaltErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = "SaltError"
    this.code = code
  }
}

export const isStrongSalt = (salt: unknown): salt is string => typeof salt === "string" && STRONG_SALT_RE.test(salt)

/** Sal novo: `bytes` aleatórios (padrão e mínimo 32) em hex. */
export function generateSalt(bytes: number = SALT_MIN_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < SALT_MIN_BYTES) throw new SaltError("E_SALT_WEAK", `o sal precisa de pelo menos ${SALT_MIN_BYTES} bytes (256 bits)`)
  return randomHex(bytes)
}

/**
 * Autodeclaração do sal (vai no bundle): `slt_<24 hex>`, domínio próprio. Só aceita sal FORTE: com sal fraco, publicar o check permitiria
 * testar palpites offline (risco registrado no plano, §7) — então falha em vez de publicar.
 */
export function saltCheck(salt: string): string {
  if (!isStrongSalt(salt)) throw new SaltError("E_SALT_WEAK", "saltCheck só é calculado para sal gerado pelo sistema (≥ 256 bits); sal fraco não pode ter o check publicado")
  return `slt_${sha256Hex(`${SALT_CHECK_DOMAIN}\0${salt}`).slice(0, 24)}`
}

export type SaltLookup =
  | { status: "ACTIVE"; saltId: string; salt: string; current: boolean }
  | { status: "RETIRED"; saltId: string }
  | { status: "UNKNOWN"; saltId: string }

/** Interface que gerador e verificador receberão no lugar de uma string solta (D5). */
export interface SaltProvider {
  get(userId: string, saltId: string): SaltLookup
  /** Sal com que se GERA agora (só o último do chaveiro); null se o usuário ainda não tem. */
  current(userId: string): { saltId: string; salt: string } | null
  /** Todos os sais com VALOR disponível (atual + antigos ainda guardados), do mais novo ao mais velho — usado na tentativa do O1. */
  known(userId: string): Array<{ saltId: string; salt: string }>
}

interface Entry { saltId: string; salt: string | null }

/**
 * Chaveiro em memória (testes/Lab). Campos privados (#): o sal não sai por JSON.stringify, inspect nem spread.
 * Usuários não se enxergam. Ids sequenciais s1, s2, … por usuário.
 */
export class InMemorySaltKeyring implements SaltProvider {
  readonly #byUser = new Map<string, Entry[]>()
  readonly #gen: () => string

  /** `gen` só existe para testes determinísticos; o padrão é o CSPRNG (`generateSalt`). */
  constructor(gen: () => string = () => generateSalt()) { this.#gen = gen }

  /** Carrega entradas existentes (testes/env). Cada sal precisa ser forte; `salt: null` = aposentado (registro sem valor). */
  static from(entries: Array<{ userId: string; saltId: string; salt: string | null }>): InMemorySaltKeyring {
    const k = new InMemorySaltKeyring()
    for (const e of entries) k.#add(e.userId, e.saltId, e.salt)
    return k
  }

  #entries(userId: string): Entry[] {
    if (typeof userId !== "string" || userId.trim() === "") throw new SaltError("E_SALT_USER_INVALID", "userId vazio")
    return this.#byUser.get(userId) ?? []
  }
  #add(userId: string, saltId: string, salt: string | null): void {
    const list = this.#entries(userId)
    if (!SALT_ID_RE.test(saltId)) throw new SaltError("E_SALT_ID_INVALID", `saltId fora do formato ${SALT_ID_RE.source}`)
    if (list.some((e) => e.saltId === saltId)) throw new SaltError("E_SALT_DUPLICATE", `saltId ${saltId} já existe para o usuário`)
    if (salt !== null && !isStrongSalt(salt)) throw new SaltError("E_SALT_WEAK", `o sal de ${saltId} não é forte (≥ 256 bits em hex)`)
    this.#byUser.set(userId, [...list, { saltId, salt }])
  }

  /**
   * Cria o sal do usuário (s1) SÓ se ele nunca teve nenhum; se já tem, devolve o atual. Nunca devolve o valor do sal.
   * Usuário que tem registros mas nenhum atual (último aposentado) NÃO é curado em silêncio: lança E_SALT_NO_CURRENT e a geração fica
   * bloqueada até uma ação administrativa explícita (`rotate`). Fail-closed de propósito.
   */
  ensure(userId: string): { saltId: string } {
    const cur = this.current(userId)
    if (cur) return { saltId: cur.saltId }
    if (this.#entries(userId).length > 0) throw new SaltError("E_SALT_NO_CURRENT", "o usuário tem sais mas nenhum atual (o último foi aposentado): rotacione explicitamente")
    return this.rotate(userId)
  }

  /** Novo sal atual (s{n+1}); o anterior segue guardado só para VERIFICAR. */
  rotate(userId: string): { saltId: string } {
    const list = this.#entries(userId)
    const saltId = `s${list.length + 1}`
    this.#add(userId, saltId, this.#gen())
    return { saltId }
  }

  /** Aposenta: apaga o VALOR e mantém o registro (get ⇒ RETIRED). O sal atual não pode ser aposentado (rotacione antes). */
  retire(userId: string, saltId: string): void {
    const list = this.#entries(userId)
    const i = list.findIndex((e) => e.saltId === saltId)
    if (i < 0) throw new SaltError("E_SALT_UNKNOWN_ID", `saltId ${saltId} não existe para o usuário`)
    if (this.#currentIndex(list) === i) throw new SaltError("E_SALT_CURRENT_CANNOT_RETIRE", "o sal atual não pode ser aposentado: rotacione antes")
    list[i] = { saltId, salt: null }
  }

  #currentIndex(list: Entry[]): number {
    // "só o último gera": se o último registro está aposentado, NÃO há sal atual (não cai para um mais antigo)
    return list.length > 0 && list[list.length - 1].salt !== null ? list.length - 1 : -1
  }

  get(userId: string, saltId: string): SaltLookup {
    const list = this.#entries(userId)
    const i = list.findIndex((e) => e.saltId === saltId)
    if (i < 0) return { status: "UNKNOWN", saltId }
    const e = list[i]
    if (e.salt === null) return { status: "RETIRED", saltId }
    return { status: "ACTIVE", saltId, salt: e.salt, current: this.#currentIndex(list) === i }
  }

  current(userId: string): { saltId: string; salt: string } | null {
    const list = this.#entries(userId)
    const i = this.#currentIndex(list)
    return i < 0 ? null : { saltId: list[i].saltId, salt: list[i].salt as string }
  }

  known(userId: string): Array<{ saltId: string; salt: string }> {
    return this.#entries(userId).filter((e) => e.salt !== null).map((e) => ({ saltId: e.saltId, salt: e.salt as string })).reverse()
  }
}
