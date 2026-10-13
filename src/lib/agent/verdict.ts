// E6.6-0c: ÚNICA fonte do veredito combinado do agente (agent-contract-plano.md §6.1, D8). Função pura: sem estado, sem I/O, sem relógio, sem aleatoriedade.
// Semântica (E6-G6 §6.1 item 4 + D4 + precedência de agent-capabilities.md):
//   TAMPERED_OR_MISMATCH > NOT_VERIFIED > VERIFIED_PARTIAL > VERIFIED
// Expectativa escrita antes do código: scripts/expectations/verdict-combine.expected.json. Testes: scripts/test-agent-verdict-combine.mts.
// Sem importação em tempo de execução: contract.ts vai importar ESTE módulo (E6.6-0d) para o refine, então aqui só `import type` (evita ciclo).
// As listas abaixo repetem os enums do contrato; um teste confere que são idênticas (não pode haver deriva).
import type { CombinedVerdict, SourceStatus, VerifyStatus, Verdict } from "./contract.ts"

export const VERIFY_STATUSES = ["VALID", "TAMPERED", "UNVERIFIABLE", "INVALID_FORMAT"] as const satisfies readonly VerifyStatus[]
export const SOURCE_STATUSES = ["SOURCE_VERIFIED", "SOURCE_VERIFIED_PARTIAL", "SOURCE_MISMATCH", "UNVERIFIABLE", "NOT_RUN"] as const satisfies readonly SourceStatus[]

const isVerifyStatus = (x: unknown): x is VerifyStatus => typeof x === "string" && (VERIFY_STATUSES as readonly string[]).includes(x)
const isSourceStatus = (x: unknown): x is SourceStatus => typeof x === "string" && (SOURCE_STATUSES as readonly string[]).includes(x)

/** Recebe os dois STATUS (não os objetos). Entrada fora do enum, ou aridade ≠ 2, LANÇA: nunca vira NOT_VERIFIED em silêncio. */
export function combineVerdict(verify: VerifyStatus, source: SourceStatus): CombinedVerdict {
  if (arguments.length !== 2) throw new Error("COMBINE_VERDICT_ARITY")
  if (!isVerifyStatus(verify)) throw new Error("COMBINE_VERDICT_INVALID_VERIFY_STATUS")
  if (!isSourceStatus(source)) throw new Error("COMBINE_VERDICT_INVALID_SOURCE_STATUS")
  if (verify === "TAMPERED" || verify === "INVALID_FORMAT" || source === "SOURCE_MISMATCH") return "TAMPERED_OR_MISMATCH"
  if (verify === "UNVERIFIABLE" || source === "UNVERIFIABLE" || source === "NOT_RUN") return "NOT_VERIFIED"
  // aqui verify = VALID e source ∈ {SOURCE_VERIFIED, SOURCE_VERIFIED_PARTIAL}
  return source === "SOURCE_VERIFIED_PARTIAL" ? "VERIFIED_PARTIAL" : "VERIFIED"
}

interface Component<S extends string> { status: S; codes: readonly string[] }

const copyComponent = <S extends string>(c: Component<S> | null | undefined, ok: (x: unknown) => boolean, label: string): { status: S; codes: string[] } => {
  if (c === null || typeof c !== "object" || !Array.isArray(c.codes) || !ok(c.status)) throw new Error(`BUILD_VERDICT_INVALID_${label}`)
  // copia SÓ status e codes: campo extra (inclusive um `combined` embutido) não passa; não muta nem aliasa a entrada
  return { status: c.status, codes: [...c.codes] }
}

/** ÚNICA fábrica de `Verdict`: o `combined` sai sempre de `combineVerdict`. */
export function buildVerdict(verify: Component<VerifyStatus>, source: Component<SourceStatus>): Verdict {
  const v = copyComponent(verify, isVerifyStatus, "VERIFY")
  const s = copyComponent(source, isSourceStatus, "SOURCE")
  return { verify: v, source: s, combined: combineVerdict(v.status, s.status) }
}
