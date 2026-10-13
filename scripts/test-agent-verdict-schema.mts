// E6.6-0d: os schemas do contrato REJEITAM `combined` ≠ combineVerdict(verify, source). Testes escritos ANTES de mexer em contract.ts.
// Expectativa: scripts/expectations/verdict-combine.expected.json → `schema_rejection_cases_for_0d` (S1–S6). Vale para VerdictSchema, EvidenceHandleSchema e EvidenceHandleViewSchema.
//   node scripts/test-agent-verdict-schema.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { CombinedVerdictSchema, EvidenceHandleSchema, EvidenceHandleViewSchema, VerdictSchema } from "../src/lib/agent/contract.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const exp: Any = JSON.parse(readFileSync(`${ROOT}scripts/expectations/verdict-combine.expected.json`, "utf8"))
const VERIFY: string[] = exp.axes.verify
const SOURCE: string[] = exp.axes.source
const COMBINED: string[] = exp.axes.combined

const verdict = (v: string, s: string, combined: string): Any => ({ verify: { status: v, codes: [] }, source: { status: s, codes: [] }, combined })
const handle = (vd: Any): Any => ({
  evidenceRef: `ev_${"a".repeat(32)}`, evidenceHash: "b".repeat(64), subject: { type: "METRIC", id: "netPnl" }, scope: "TOTAL",
  population: { declared: 10, verifiability: "FULL" }, refEpoch: "s1", verdict: vd, freshness: "CURRENT",
})
const view = (vd: Any): Any => { const h = handle(vd); delete h.evidenceHash; return h }
const SCHEMAS: Array<[string, { safeParse: (x: unknown) => { success: boolean; error?: Any } }, (v: Any) => Any]> = [
  ["VerdictSchema", VerdictSchema, (v) => v],
  ["EvidenceHandleSchema", EvidenceHandleSchema, handle],
  ["EvidenceHandleViewSchema (visão do modelo, sem evidenceHash)", EvidenceHandleViewSchema, view],
]

test("S1 — em cada um dos 3 schemas e nas 20 células: o `combined` CORRETO é aceito e os 3 incorretos são rejeitados (3 × 80 verificações; 3 × 20 aceitos, 3 × 60 rejeitados)", () => {
  for (const [name, schema, wrap] of SCHEMAS) {
    let acc = 0, rej = 0
    for (const v of VERIFY) for (const s of SOURCE) for (const cand of COMBINED) {
      const okExpected = exp.matrix[v][s] === cand
      const got = schema.safeParse(wrap(verdict(v, s, cand))).success
      assert.equal(got, okExpected, `${name}: ${v}×${s} com combined=${cand} deveria ser ${okExpected ? "aceito" : "rejeitado"}`)
      if (got) acc += 1
      else rej += 1
    }
    assert.equal(acc, 20, `${name} aceitos`)
    assert.equal(rej, 60, `${name} rejeitados`)
  }
})

test("S2 — o caso do KG1: verify=TAMPERED + source=SOURCE_MISMATCH + combined=VERIFIED é REJEITADO nos 3 schemas", () => {
  for (const [name, schema, wrap] of SCHEMAS) assert.equal(schema.safeParse(wrap(verdict("TAMPERED", "SOURCE_MISMATCH", "VERIFIED"))).success, false, name)
})

test("S3 — verify=VALID + source=NOT_RUN + combined=VERIFIED (ou VERIFIED_PARTIAL) é REJEITADO nos 3 schemas (D4); NOT_VERIFIED é aceito", () => {
  for (const [name, schema, wrap] of SCHEMAS) {
    assert.equal(schema.safeParse(wrap(verdict("VALID", "NOT_RUN", "VERIFIED"))).success, false, `${name} VERIFIED`)
    assert.equal(schema.safeParse(wrap(verdict("VALID", "NOT_RUN", "VERIFIED_PARTIAL"))).success, false, `${name} VERIFIED_PARTIAL`)
    assert.equal(schema.safeParse(wrap(verdict("VALID", "NOT_RUN", "NOT_VERIFIED"))).success, true, `${name} NOT_VERIFIED`)
  }
})

test("S4 — a mensagem do erro é FIXA (COMBINED_INCONSISTENT), aponta o campo `combined` e NÃO ecoa os valores de entrada", () => {
  const MARK = "ZZ_MARCADOR_UNICO_ZZ"
  for (const [name, schema, wrap] of SCHEMAS) {
    const bad = verdict("TAMPERED", "SOURCE_MISMATCH", "VERIFIED")
    bad.verify.codes = ["V_" + MARK.replace(/[^A-Z]/g, "")]
    const r = schema.safeParse(wrap(bad))
    assert.equal(r.success, false, name)
    const issues: Any[] = r.error.issues
    assert.equal(issues.length, 1, `${name}: um único problema (${issues.map((i) => i.message).join(" | ")})`)
    assert.equal(issues[0].message, "COMBINED_INCONSISTENT", name)
    assert.equal(issues[0].path[issues[0].path.length - 1], "combined", `${name}: o caminho termina em 'combined'`)
    const text = JSON.stringify(issues)
    for (const leak of ["TAMPERED", "SOURCE_MISMATCH", "VERIFIED", "VZZ"]) assert.equal(text.replace(/COMBINED_INCONSISTENT/g, "").includes(leak), false, `${name}: o erro vazou '${leak}'`)
  }
})

test("S5 — a visão do modelo aplica o MESMO refine; e continua rejeitando o evidenceHash (strict) e aceitando um handle consistente sem ele", () => {
  assert.equal(EvidenceHandleViewSchema.safeParse(view(verdict("VALID", "SOURCE_VERIFIED", "VERIFIED"))).success, true)
  assert.equal(EvidenceHandleViewSchema.safeParse(view(verdict("VALID", "SOURCE_VERIFIED", "NOT_VERIFIED"))).success, false)
  assert.equal(EvidenceHandleViewSchema.safeParse(handle(verdict("VALID", "SOURCE_VERIFIED", "VERIFIED"))).success, false, "com evidenceHash a visão rejeita")
})

test("S6 — continuam valendo as rejeições de FORMA (falta de componente, campo extra, combined fora do enum): o refine não as mascara nem as transforma em COMBINED_INCONSISTENT", () => {
  const base = verdict("VALID", "SOURCE_VERIFIED", "VERIFIED")
  const cases: Array<[string, Any]> = [
    ["sem combined", { verify: base.verify, source: base.source }],
    ["só verify", { verify: base.verify, combined: "VERIFIED" }],
    ["só source", { source: base.source, combined: "VERIFIED" }],
    ["combined fora do enum", { ...base, combined: "OK" }],
    ["campo extra", { ...base, ok: true }],
    ["status de source inválido", { ...base, source: { status: "SKIPPED", codes: [] } }],
  ]
  // status INVÁLIDO nos dois eixos (inclusive não-string): o zod não executa o refine com a base já falha; se um dia executasse, combineVerdict LANÇARIA dentro do safeParse e ESTE teste quebraria (é a trava dessa suposição)
  for (const bv of ["SKIPPED", "valid", "", 5, null, undefined, {}]) cases.push([`verify inválido ${JSON.stringify(bv)}`, { verify: { status: bv, codes: [] }, source: base.source, combined: "VERIFIED" }])
  for (const bs of ["SKIPPED", "NOT_EXECUTED", "", 5, null, undefined, {}]) cases.push([`source inválido ${JSON.stringify(bs)}`, { verify: base.verify, source: { status: bs, codes: [] }, combined: "VERIFIED" }])
  cases.push(["os dois inválidos", { verify: { status: "x", codes: [] }, source: { status: "y", codes: [] }, combined: "VERIFIED" }])
  for (const [why, v] of cases) {
    let r: Any
    assert.doesNotThrow(() => { r = VerdictSchema.safeParse(v) }, `${why}: safeParse NÃO pode lançar`)
    assert.equal(r.success, false, why)
    assert.equal(r.error.issues.some((i: Any) => i.message === "COMBINED_INCONSISTENT"), false, `${why}: forma inválida não deve virar COMBINED_INCONSISTENT`)
  }
  assert.equal(CombinedVerdictSchema.options.length, 4)
})

console.log(`\n${passed} testes ok`)
