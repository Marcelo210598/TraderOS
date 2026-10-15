// Projetor de rótulo A2 + tabela de alias (E6.6-1). O que o MODELO vê de um rótulo de ordem é SEMPRE uma saída desta função: "(sem rótulo)", uma palavra do
// vocabulário v1 em caixa canônica, ou "rótulo personalizado A/B/…" (alias de token). Texto livre do usuário nunca chega ao modelo (A2).
// Entrada = a saída da PROJEÇÃO da Evidence (null | "" | palavra do vocabulário v1 | `lbl_<24 hex>`). Qualquer outra coisa ⇒ LABEL_NOT_PROJECTED (fail-closed),
// SEM ecoar a entrada. O vocabulário é conferido como o motor o faz (NFD sem acento, minúsculo), mas a SAÍDA é montada a partir do que casou, nunca da entrada.
// Aliases: por ordem de primeira aparição, contador independente por tipo, tabela IMUTÁVEL (cada alocação devolve OUTRA tabela), nova tabela a cada refEpoch (O-B).
// Só `zod`/`./` (SG1); este arquivo não importa nada.

export const ALIAS_KINDS = ["conta", "estrategia", "rotulo"] as const
export type AliasKind = (typeof ALIAS_KINDS)[number]
export interface AliasTable {
  readonly epoch: string
  readonly conta: readonly string[]
  readonly estrategia: readonly string[]
  readonly rotulo: readonly string[]
}

const REF_RE: Readonly<Record<AliasKind, RegExp>> = { conta: /^acc_[0-9a-f]{24}$/, estrategia: /^str_[0-9a-f]{24}$/, rotulo: /^lbl_[0-9a-f]{24}$/ }
const PREFIX: Readonly<Record<AliasKind, string>> = { conta: "Conta ", estrategia: "Estratégia ", rotulo: "rótulo personalizado " }
const EPOCH_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
/** A..Z (26) + AA..ZZ (676) + AAA..ZZZ (17576): acima disso o alias deixaria de casar com os schemas das views ⇒ erro. */
const MAX_ALIASES = 26 + 26 ** 2 + 26 ** 3

const frozenList = (xs: readonly string[]): readonly string[] => Object.freeze([...xs])
const makeTable = (epoch: string, conta: readonly string[], estrategia: readonly string[], rotulo: readonly string[]): AliasTable =>
  Object.freeze({ epoch, conta: frozenList(conta), estrategia: frozenList(estrategia), rotulo: frozenList(rotulo) })

/** Tabela vazia (congelada) para a época `epoch`. */
export function newAliasTable(epoch: string): AliasTable {
  return makeTable(epoch, [], [], [])
}

/** Índice (0-based) → letras em base 26 bijetiva: 0→A, 25→Z, 26→AA, 701→ZZ, 702→AAA. */
function letters(index: number): string {
  let n = index + 1
  let out = ""
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = (n - 1 - r) / 26
  }
  return out
}

export type AliasError = { readonly ok: false; readonly code: "ALIAS_REF_INVALID" | "ALIAS_EXHAUSTED" }

/**
 * Aloca (ou reencontra) o alias de `ref` no tipo `kind`. Época diferente da tabela ⇒ tabela NOVA (a antiga nunca é reaproveitada nem alterada).
 * Não muta a entrada: devolve `{ alias, table }` com OUTRA tabela quando algo foi alocado.
 */
export function allocateAlias(table: AliasTable, kind: AliasKind, ref: string, epoch: string): { ok: true; alias: string; table: AliasTable } | AliasError {
  if (typeof kind !== "string" || !Object.hasOwn(REF_RE, kind) || typeof ref !== "string" || !REF_RE[kind].test(ref) || typeof epoch !== "string" || !EPOCH_RE.test(epoch)) return { ok: false, code: "ALIAS_REF_INVALID" }
  const base = table.epoch === epoch ? table : newAliasTable(epoch)
  const list = base[kind]
  const at = list.indexOf(ref)
  if (at >= 0) return { ok: true, alias: PREFIX[kind] + letters(at), table: base }
  if (list.length >= MAX_ALIASES) return { ok: false, code: "ALIAS_EXHAUSTED" }
  const next = makeTable(epoch, kind === "conta" ? [...base.conta, ref] : base.conta, kind === "estrategia" ? [...base.estrategia, ref] : base.estrategia, kind === "rotulo" ? [...base.rotulo, ref] : base.rotulo)
  return { ok: true, alias: PREFIX[kind] + letters(list.length), table: next }
}

/**
 * Inverso do `allocateAlias` para o alias de ENTRADA (E6.6-5-A): do texto que o modelo cita ("Conta B") ao ref da tabela da conversa. Formato EXATO (prefixo do tipo + 1 a 3 letras
 * A–Z), época IGUAL à da tabela, índice dentro da lista. Nunca aloca, nunca muta a tabela, nunca lança; o erro é fixo e não ecoa a entrada.
 */
export function resolveAlias(table: AliasTable, kind: AliasKind, alias: string, epoch: string): { readonly ok: true; readonly ref: string } | { readonly ok: false } {
  const no = { ok: false } as const
  try {
    if (typeof kind !== "string" || !Object.hasOwn(REF_RE, kind) || typeof alias !== "string" || typeof epoch !== "string" || !EPOCH_RE.test(epoch)) return no
    if (typeof table !== "object" || table === null || table.epoch !== epoch) return no
    const list: unknown = table[kind]
    if (!Array.isArray(list)) return no
    const prefix = PREFIX[kind]
    if (!alias.startsWith(prefix)) return no
    const rest = alias.slice(prefix.length)
    if (!/^[A-Z]{1,3}$/.test(rest)) return no
    let n = 0
    for (const ch of rest) n = n * 26 + (ch.charCodeAt(0) - 64)
    const ref: unknown = list[n - 1]
    return typeof ref === "string" && REF_RE[kind].test(ref) ? { ok: true, ref } : no
  } catch {
    return no
  }
}

const VOCAB = /^(?:(entry|zerar)|(target|stop)([0-9]{0,2}))$/
const CANON: Readonly<Record<string, string>> = { entry: "Entry", zerar: "Zerar", target: "Target", stop: "Stop" }

export type LabelError = { readonly ok: false; readonly code: "LABEL_NOT_PROJECTED" }

/** O rótulo que o MODELO vê para uma saída da projeção da Evidence. Só vocabulário v1 (caixa canônica), "(sem rótulo)" ou alias de token. */
export function projectLabelView(input: string | null, table: AliasTable, epoch: string): { ok: true; label: string; table: AliasTable } | LabelError | AliasError {
  if (input === null || input === "") return { ok: true, label: "(sem rótulo)", table }
  if (typeof input !== "string" || input !== input.trim()) return { ok: false, code: "LABEL_NOT_PROJECTED" }
  if (REF_RE.rotulo.test(input)) {
    const a = allocateAlias(table, "rotulo", input, epoch)
    return a.ok ? { ok: true, label: a.alias, table: a.table } : a
  }
  const m = VOCAB.exec(input.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase())
  if (!m) return { ok: false, code: "LABEL_NOT_PROJECTED" }
  return { ok: true, label: m[1] !== undefined ? CANON[m[1]] : CANON[m[2]] + m[3], table }
}
