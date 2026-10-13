// E6.6-0b: testes do `combineVerdict` / `buildVerdict` escritos ANTES da função (src/lib/agent/verdict.ts ainda NÃO existe).
// Expectativa: scripts/expectations/verdict-combine.expected.json (E6.6-0a). Assinaturas combinadas (Q1/Q6):
//   combineVerdict(verifyStatus: string, sourceStatus: string): CombinedVerdict   // recebe só os STATUS; entrada fora do enum LANÇA
//   buildVerdict(verify: {status, codes}, source: {status, codes}): Verdict       // única fábrica de Verdict; combined vem de combineVerdict
//   node scripts/test-agent-verdict-combine.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }

const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/verdict-combine.expected.json`, "utf8"))
const VERIFY: string[] = exp.axes.verify
const SOURCE: string[] = exp.axes.source
const COMBINED: string[] = exp.axes.combined

// ── ORÁCULO B: lista de pares escrita à mão em OUTRA forma (por resultado), sem regra e sem chamar a função ──────────────────
const ORACLE_B: Record<string, Array<[string, string]>> = {
  VERIFIED: [["VALID", "SOURCE_VERIFIED"]],
  VERIFIED_PARTIAL: [["VALID", "SOURCE_VERIFIED_PARTIAL"]],
  NOT_VERIFIED: [
    ["VALID", "UNVERIFIABLE"], ["VALID", "NOT_RUN"],
    ["UNVERIFIABLE", "SOURCE_VERIFIED"], ["UNVERIFIABLE", "SOURCE_VERIFIED_PARTIAL"], ["UNVERIFIABLE", "UNVERIFIABLE"], ["UNVERIFIABLE", "NOT_RUN"],
  ],
  TAMPERED_OR_MISMATCH: [
    ["VALID", "SOURCE_MISMATCH"], ["UNVERIFIABLE", "SOURCE_MISMATCH"],
    ["TAMPERED", "SOURCE_VERIFIED"], ["TAMPERED", "SOURCE_VERIFIED_PARTIAL"], ["TAMPERED", "SOURCE_MISMATCH"], ["TAMPERED", "UNVERIFIABLE"], ["TAMPERED", "NOT_RUN"],
    ["INVALID_FORMAT", "SOURCE_VERIFIED"], ["INVALID_FORMAT", "SOURCE_VERIFIED_PARTIAL"], ["INVALID_FORMAT", "SOURCE_MISMATCH"], ["INVALID_FORMAT", "UNVERIFIABLE"], ["INVALID_FORMAT", "NOT_RUN"],
  ],
}
const fromB = (v: string, s: string): string => {
  const hit = Object.entries(ORACLE_B).filter(([, pairs]) => pairs.some(([pv, ps]) => pv === v && ps === s)).map(([k]) => k)
  assert.equal(hit.length, 1, `célula ${v}×${s} cai em ${hit.length} grupos do oráculo B`)
  return hit[0]
}

test("O0 — os DOIS oráculos (tabela do JSON × lista de pares) concordam nas 20 células ANTES de qualquer comparação com a função", () => {
  assert.equal(VERIFY.length * SOURCE.length, 20)
  assert.equal(Object.values(ORACLE_B).flat().length, 20, "o oráculo B cobre exatamente 20 pares")
  for (const v of VERIFY) for (const s of SOURCE) assert.equal(exp.matrix[v][s], fromB(v, s), `${v}×${s}`)
  assert.deepEqual(COMBINED, ["VERIFIED", "VERIFIED_PARTIAL", "NOT_VERIFIED", "TAMPERED_OR_MISMATCH"])
})

// ── a partir daqui: a função. Enquanto verdict.ts não existir, a importação falha (é o ESPERADO no 0b) ─────────────────────────
const mod: Any = await import("../src/lib/agent/verdict.ts")
const { combineVerdict, buildVerdict } = mod
const { VerdictSchema } = await import("../src/lib/agent/contract.ts")

test("C1 — as 20 células: combineVerdict(verify, source) = matriz esperada (JSON) = oráculo B", () => {
  for (const v of VERIFY) for (const s of SOURCE) {
    const got = combineVerdict(v, s)
    assert.equal(got, exp.matrix[v][s], `${v}×${s}: veio ${got}`)
    assert.equal(got, fromB(v, s), `${v}×${s} (oráculo B)`)
  }
})

test("C2 — as 80 verificações (20 células × 4 candidatos): exatamente 1 candidato é igual ao combinado por célula; 20 aceitos, 60 rejeitados", () => {
  let accepted = 0, rejected = 0
  for (const v of VERIFY) for (const s of SOURCE) for (const cand of COMBINED) {
    if (combineVerdict(v, s) === cand) accepted += 1
    else rejected += 1
  }
  assert.equal(accepted + rejected, 80)
  assert.equal(accepted, 20)
  assert.equal(rejected, 60)
})

test("C3 — invariantes I1–I6 sobre a função", () => {
  let nVerified = 0, nPartial = 0
  for (const v of VERIFY) for (const s of SOURCE) {
    const c = combineVerdict(v, s)
    assert.equal(c === "VERIFIED", v === "VALID" && s === "SOURCE_VERIFIED", `I1 ${v}×${s}`)
    assert.equal(c === "VERIFIED_PARTIAL", v === "VALID" && s === "SOURCE_VERIFIED_PARTIAL", `I2 ${v}×${s}`)
    if (c === "VERIFIED") nVerified += 1
    if (c === "VERIFIED_PARTIAL") nPartial += 1
    if (s === "NOT_RUN") assert.ok(c === "NOT_VERIFIED" || c === "TAMPERED_OR_MISMATCH", `I3 ${v}×${s}`)
    if (v !== "VALID") assert.ok(c !== "VERIFIED" && c !== "VERIFIED_PARTIAL", `I4 ${v}×${s}`)
    if (s === "SOURCE_MISMATCH") assert.equal(c, "TAMPERED_OR_MISMATCH", `I5 ${v}×${s}`)
    if (v === "TAMPERED" || v === "INVALID_FORMAT") assert.equal(c, "TAMPERED_OR_MISMATCH", `I6 ${v}×${s}`)
  }
  assert.equal(nVerified, 1)
  assert.equal(nPartial, 1)
})

test("C4 — I7 monotonia: piorar verify ou source nunca melhora o combinado", () => {
  const RANK_C: Record<string, number> = { VERIFIED: 0, VERIFIED_PARTIAL: 1, NOT_VERIFIED: 2, TAMPERED_OR_MISMATCH: 3 }
  const RANK_V: Record<string, number> = { VALID: 0, UNVERIFIABLE: 1, TAMPERED: 2, INVALID_FORMAT: 2 }
  const RANK_S: Record<string, number> = { SOURCE_VERIFIED: 0, SOURCE_VERIFIED_PARTIAL: 1, UNVERIFIABLE: 2, NOT_RUN: 2, SOURCE_MISMATCH: 3 }
  for (const v1 of VERIFY) for (const s1 of SOURCE) for (const v2 of VERIFY) for (const s2 of SOURCE) {
    if (RANK_V[v1] <= RANK_V[v2] && RANK_S[s1] <= RANK_S[s2]) {
      assert.ok(RANK_C[combineVerdict(v1, s1)] <= RANK_C[combineVerdict(v2, s2)], `monotonia: ${v1}×${s1} → ${v2}×${s2}`)
    }
  }
})

test("C5 — I9 o resultado é sempre um dos 4 valores do enum (nunca INVALID_FORMAT, undefined, null ou string solta)", () => {
  for (const v of VERIFY) for (const s of SOURCE) assert.ok(COMBINED.includes(combineVerdict(v, s)), `${v}×${s}`)
})

test("C6 — I8 pura e determinística: mesma entrada ⇒ mesma saída, em qualquer ordem e repetição", () => {
  const first = new Map<string, string>()
  for (let round = 0; round < 3; round += 1) {
    const vs = round === 1 ? [...VERIFY].reverse() : VERIFY
    const ss = round === 2 ? [...SOURCE].reverse() : SOURCE
    for (const v of vs) for (const s of ss) {
      const got = combineVerdict(v, s)
      const key = `${v}|${s}`
      if (first.has(key)) assert.equal(got, first.get(key), key)
      else first.set(key, got)
    }
  }
  assert.equal(first.size, 20)
})

test("N1/N2 — entrada FORA do enum LANÇA erro (nunca vira NOT_VERIFIED em silêncio)", () => {
  const junk: unknown[] = ["valid", "OK", "", " VALID", "VALID ", "verified", null, undefined, 0, 1, true, {}, [], "NOT_EXECUTED", "skipped"]
  for (const j of junk) {
    assert.throws(() => combineVerdict(j, "SOURCE_VERIFIED"), undefined, `verify=${JSON.stringify(j)}`)
    assert.throws(() => combineVerdict("VALID", j), undefined, `source=${JSON.stringify(j)}`)
  }
  // um valor do enum do OUTRO eixo também é inválido (verify ≠ source)
  assert.throws(() => combineVerdict("SOURCE_VERIFIED", "SOURCE_VERIFIED"), undefined, "status de source no eixo verify")
  assert.throws(() => combineVerdict("VALID", "VALID"), undefined, "status de verify no eixo source")
  assert.throws(() => combineVerdict("NOT_RUN", "NOT_RUN"), undefined, "NOT_RUN no eixo verify")
  assert.throws(() => combineVerdict("INVALID_FORMAT", "INVALID_FORMAT"), undefined, "INVALID_FORMAT no eixo source")
})

test("N3 — objetos {status,codes} no lugar do status LANÇAM (a assinatura recebe os STATUS; os objetos vão para buildVerdict)", () => {
  assert.throws(() => combineVerdict({ status: "VALID", codes: [] }, "SOURCE_VERIFIED"))
  assert.throws(() => combineVerdict("VALID", { status: "SOURCE_VERIFIED", codes: [] }))
  assert.throws(() => (combineVerdict as Any)("VALID"), undefined, "um argumento só")
})

const V = (status: string, codes: string[] = []) => ({ status, codes })

test("B1 — buildVerdict devolve {verify, source, combined} com combined = matriz, em todas as 20 células, e o resultado passa no VerdictSchema", () => {
  for (const v of VERIFY) for (const s of SOURCE) {
    const out = buildVerdict(V(v, ["V_X"]), V(s, ["S_Y"]))
    assert.deepEqual(Object.keys(out).sort(), ["combined", "source", "verify"])
    assert.equal(out.combined, exp.matrix[v][s], `${v}×${s}`)
    assert.equal(out.verify.status, v)
    assert.equal(out.source.status, s)
    assert.deepEqual(out.verify.codes, ["V_X"])
    assert.deepEqual(out.source.codes, ["S_Y"])
    assert.equal(VerdictSchema.safeParse(out).success, true, `${v}×${s}`)
  }
})

test("B2 — buildVerdict NÃO muta as entradas (objetos congelados em profundidade não explodem) e não deixa o `combined` vir de fora", () => {
  const verify = Object.freeze({ status: "TAMPERED", codes: Object.freeze(["V_SEAL"]) })
  const source = Object.freeze({ status: "SOURCE_VERIFIED", codes: Object.freeze([]) })
  const out = buildVerdict(verify, source)
  assert.equal(out.combined, "TAMPERED_OR_MISMATCH")
  // mesmo que o chamador passe um `combined` mentiroso dentro do objeto de entrada, ele é ignorado (única fonte = a função)
  const liar = buildVerdict({ status: "TAMPERED", codes: [], combined: "VERIFIED" } as Any, { status: "SOURCE_MISMATCH", codes: [] })
  assert.equal(liar.combined, "TAMPERED_OR_MISMATCH")
  assert.deepEqual(Object.keys(liar).sort(), ["combined", "source", "verify"])
  assert.equal("combined" in liar.verify, false, "o verify da saída NÃO carrega campo extra da entrada")
})

test("B3 — buildVerdict com status inválido LANÇA (mesmo critério do combineVerdict)", () => {
  assert.throws(() => buildVerdict(V("valid"), V("SOURCE_VERIFIED")))
  assert.throws(() => buildVerdict(V("VALID"), V("ok")))
  assert.throws(() => buildVerdict(null, V("SOURCE_VERIFIED")))
  assert.throws(() => buildVerdict(V("VALID"), undefined))
})

console.log(`\n${passed} testes ok`)
