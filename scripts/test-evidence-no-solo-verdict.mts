// Garantia (decisão de 12/10/2026): o estado do E5b (`SOURCE_VERIFIED`…) NUNCA é lido isolado como "tudo ok".   node scripts/test-evidence-no-solo-verdict.mts
// Cobre: (1) aviso no código e no texto da limitação; (2) todo consumidor de `SOURCE_VERIFIED`/`verifyEvidenceSource` em src/ também lê o
// `verifyEvidence`; (3) as telas que mostram o E5b trazem o aviso fixo; (4) casos reais em que E5b = SOURCE_VERIFIED e V6 = TAMPERED;
// (5) a regra do VEREDITO COMBINADO está escrita no plano do E6.5. Um consumidor novo que viole (2) faz este teste falhar.
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DERIVED_SCENARIOS, derivedContext, runDerivedScenario } from "../src/lib/dev/evidence-lab/derived.ts"
import { buildDemo } from "../src/lib/dev/evidence-lab/model.ts"
import { SOURCE_SCENARIOS, runSourceScenario, sourceContext } from "../src/lib/dev/evidence-lab/source.ts"
import { SOURCE_LIMITATIONS } from "../src/lib/evidence/verify-source.ts"
import { EvidenceHandleSchema, VerdictSchema, capabilityResultSchema } from "../src/lib/agent/contract.ts"
import * as agentViews from "../src/lib/agent/views.ts"

const env = process.env as Record<string, string | undefined>
const ORIGINAL_ENV = env.NODE_ENV
env.NODE_ENV = "development"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
/** Semântica de referência do veredito COMBINADO (plano E6/G6 §6.1 item 4). UNVERIFIABLE (de qualquer lado) = NOT_VERIFIED: nem ok, nem adulteração. */
type Combined = "VERIFIED" | "VERIFIED_PARTIAL" | "NOT_VERIFIED" | "TAMPERED_OR_MISMATCH"
const combined = (verify: string, source: string | null): Combined => {
  if (verify === "TAMPERED" || verify === "INVALID_FORMAT" || source === "SOURCE_MISMATCH" || source === "INVALID_FORMAT") return "TAMPERED_OR_MISMATCH"
  if (verify === "VALID" && source === "SOURCE_VERIFIED") return "VERIFIED"
  if (verify === "VALID" && source === "SOURCE_VERIFIED_PARTIAL") return "VERIFIED_PARTIAL"
  return "NOT_VERIFIED"
}
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

test("CÓDIGO: o verificador de origem carrega o aviso 'NUNCA LER ISOLADO' (topo do arquivo e no tipo SourceStatus) e a limitação do relatório diz que SOURCE_VERIFIED isolado não é 'tudo ok'", () => {
  const src = read("src/lib/evidence/verify-source.ts")
  assert.match(src, /NUNCA LER ISOLADO/)
  assert.match(src, /veredito COMBINADO/)
  assert.match(src, /\/\*\* ATENÇÃO: nenhum destes estados, sozinho, é 'tudo ok'[^]*?export type SourceStatus/)
  const lim = SOURCE_LIMITATIONS.find((l) => l.code === "L_BUNDLE_INTEGRITY_NOT_CHECKED")!
  assert.match(lim.text, /ISOLADO NÃO significa "tudo ok"/)
  assert.match(lim.text, /VALID do verifyEvidence sobre o MESMO evidenceHash/)
})

test("CONSUMIDORES: todo arquivo de src/ que lê SOURCE_VERIFIED ou chama verifyEvidenceSource também lê o verifyEvidence (nenhum consome o E5b sozinho)", () => {
  const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("src/lib/evidence/verify-source.ts"))
  const consumers = files.filter((f) => /SOURCE_VERIFIED|verifyEvidenceSource\(|SourceVerifyReport/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")))
  assert.ok(consumers.length >= 4, `consumidores encontrados: ${consumers.length}`)
  for (const f of consumers) {
    const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")
    assert.ok(/verifyEvidence\(|VerifyReport|verify\/?"|evidence\/verify"|\.verify\b|\bVerifyStatus\b/.test(code), `${f.replace(ROOT, "")}: consome o E5b sem ler o verifyEvidence`)
  }
})

test("TELAS: as abas que mostram o estado do E5b trazem o aviso fixo 'SOURCE_VERIFIED sozinho não é “tudo ok”'", () => {
  assert.match(read("src/app/dev/evidence-lab/_components/ui.tsx"), /SOURCE_VERIFIED sozinho não é “tudo ok”/)
  for (const f of ["src/app/dev/evidence-lab/_components/source-panel.tsx", "src/app/dev/evidence-lab/_components/derived-panel.tsx"]) assert.match(read(f), /<SoloVerdictCallout \/>/, f)
  // a aba de derivados mostra os DOIS vereditos lado a lado
  assert.match(read("src/app/dev/evidence-lab/_components/derived-panel.tsx"), /V6\/verifyEvidence: \{s\.report\.status\}/)
})

test("CASOS REAIS: existem situações em que o E5b diz SOURCE_VERIFIED e o veredito combinado NÃO é ok — então 'E5b isolado = ok' seria falso", () => {
  const ok = (v: string, s: string) => v === "VALID" && (s === "SOURCE_VERIFIED" || s === "SOURCE_VERIFIED_PARTIAL")
  // (a) casos de borda de refs.legs (arquivo de expectativa escrito antes)
  const edge = JSON.parse(read("scripts/expectations/derived-legrefs-edge.expected.json")) as Any
  const solo = Object.entries(edge.cases).filter(([, c]: [string, Any]) => c.e5bStatus === "SOURCE_VERIFIED" && c.v6Status === "TAMPERED").map(([k]) => k)
  assert.deepEqual(solo.sort(), ["item_duplicado", "item_removido", "itens_fora_de_ordem"])
  for (const k of solo) assert.equal(ok(edge.cases[k].v6Status, edge.cases[k].e5bStatus), false, k)
  // (b) cenários do Lab, executados agora (funções reais)
  const ctx = derivedContext()
  for (const id of ["forged-value", "forged-delta"]) {
    const r = runDerivedScenario(ctx, DERIVED_SCENARIOS.find((s) => s.id === id)!)
    assert.equal(r.source.status, "SOURCE_VERIFIED", id)
    assert.equal(r.report.status, "TAMPERED", id)
    assert.equal(ok(r.report.status, r.source.status), false, id)
    assert.equal(r.source.evidenceHash, (r.bundle as Any).evidenceHash, "os dois relatórios falam do MESMO evidenceHash")
  }
})

test("UNVERIFIABLE (não só SOURCE_VERIFIED): arquivo ausente, versão incompatível e HASH_ONLY dão NOT_VERIFIED — nem ok, nem adulteração (nenhum FAIL); só VERIFIED/VERIFIED_PARTIAL contam como verificado", () => {
  const sctx = sourceContext(buildDemo())
  for (const id of ["no-file", "version"]) {
    const r = runSourceScenario(sctx, SOURCE_SCENARIOS.find((s) => s.id === id)!)
    assert.equal(r.report.status, "UNVERIFIABLE", id)
    assert.equal(r.report.checks.some((c) => c.status === "FAIL"), false, `${id}: indisponibilidade não é adulteração`)
    assert.equal(combined(r.verify.status, r.report.status), "NOT_VERIFIED", id)
  }
  const dctx = derivedContext()
  for (const id of ["hash-only", "version", "strategy-dim"]) {
    const r = runDerivedScenario(dctx, DERIVED_SCENARIOS.find((s) => s.id === id)!)
    assert.equal(r.report.status, "UNVERIFIABLE", id)
    assert.equal(r.report.checks.some((c) => c.status === "FAIL"), false, id)
    assert.equal(combined(r.report.status, r.source.status), "NOT_VERIFIED", `${id}: ${r.source.status}`)
  }
  // matriz dos 17 cenários: VERIFIED* só com os DOIS lados ok; adulteração nunca vira NOT_VERIFIED
  for (const s of DERIVED_SCENARIOS) {
    const r = runDerivedScenario(dctx, s)
    const c = combined(r.report.status, r.source.status)
    if (r.report.status === "TAMPERED" || r.source.status === "SOURCE_MISMATCH") assert.equal(c, "TAMPERED_OR_MISMATCH", s.id)
    else if (r.report.status === "UNVERIFIABLE" || r.source.status === "UNVERIFIABLE") assert.equal(c, "NOT_VERIFIED", s.id)
    if (c === "VERIFIED" || c === "VERIFIED_PARTIAL") assert.ok(r.report.status === "VALID" && ["SOURCE_VERIFIED", "SOURCE_VERIFIED_PARTIAL"].includes(r.source.status), s.id)
  }
  // divergência perna×trade: V6 reproduz (VALID) e o E5b acusa ⇒ o combinado NÃO é verificado
  const div = runDerivedScenario(dctx, DERIVED_SCENARIOS.find((s) => s.id === "divergence")!)
  assert.equal(combined(div.report.status, div.source.status), "TAMPERED_OR_MISMATCH")
})

test("S4b (mapa do usuário): os casos previstos estão escritos nas expectativas (antes do código) e FORAM EXECUTADOS contra código real em scripts/test-evidence-sourcelabel-s4b.mts (tabela dos 4 casos): mapa ausente/divergente = NOT_VERIFIED sem FAIL; mapa correto e mapa vazio = VERIFIED", () => {
  const g = (JSON.parse(read("scripts/expectations/sourcelabel.expected.json")) as Any).guard_no_solo_verdict
  assert.deepEqual(Object.keys(g.combined_semantics).sort(), ["NOT_VERIFIED", "TAMPERED_OR_MISMATCH", "VERIFIED", "VERIFIED_PARTIAL"])
  for (const k of ["user_map_not_supplied", "user_map_wrong"]) {
    assert.deepEqual([g.S4b_cases[k].source, g.S4b_cases[k].code, g.S4b_cases[k].combined, g.S4b_cases[k].has_FAIL], ["UNVERIFIABLE", "S_CONTEXT_INSUFFICIENT", "NOT_VERIFIED", false], k)
    assert.equal(combined(g.S4b_cases[k].verify, g.S4b_cases[k].source), "NOT_VERIFIED", k)
  }
  assert.equal(combined(g.S4b_cases.user_map_correct.verify, g.S4b_cases.user_map_correct.source), "VERIFIED")
  assert.equal(combined(g.S4b_cases.empty_map.verify, g.S4b_cases.empty_map.source), "VERIFIED")
})

test("E6.5: a regra do VEREDITO COMBINADO está escrita no plano (6.1); o teste-guarda é citado como ponto de extensão", () => {
  const plan = read("docs/ai-partner/E6-G6-plano.md")
  assert.match(plan, /Regra do VEREDITO COMBINADO/)
  assert.match(plan, /mesmo `evidenceHash`/)
  assert.match(plan, /test-evidence-no-solo-verdict\.mts/)
  assert.match(plan, /Nenhum campo "ok"\/"verified" agregado pode existir sem trazer os dois componentes/)
})

env.NODE_ENV = ORIGINAL_ENV
if (ORIGINAL_ENV === undefined) delete env.NODE_ENV
test("E6.5 / SG2 (extensão para o AGENTE): o veredito do contrato tem EXATAMENTE {verify, source, combined}; nenhum schema do contrato tem chave agregada ('verified', 'valid', 'trusted', 'allOk'…); 'ok' só no topo do CapabilityResult (= a capacidade executou, não veredito); source/verify nunca aparecem sozinhos num handle", () => {
  const views = agentViews
  const keysOf = (schema: Any, out = new Set<string>(), seen = new Set<unknown>()): Set<string> => {
    if (!schema || seen.has(schema)) return out
    seen.add(schema)
    const def = schema._zod?.def ?? schema.def
    if (!def) return out
    if (def.type === "object") for (const [k, v] of Object.entries(def.shape as Record<string, unknown>)) { out.add(k); keysOf(v, out, seen) }
    else if (def.type === "array") keysOf(def.element, out, seen)
    else if (def.type === "optional" || def.type === "nullable") keysOf(def.innerType, out, seen)
    else if (def.type === "union") for (const o of def.options) keysOf(o, out, seen)
    return out
  }
  assert.deepEqual([...keysOf(VerdictSchema)].filter((k) => !["status", "codes"].includes(k)).sort(), ["combined", "source", "verify"], "o verdict tem de ter os DOIS componentes e o combinado, e nada mais")
  const AGGREGATE = /^(ok|verified|isverified|valid|isvalid|trusted|allok|passed|safe|confirmed)$/i
  const handleKeys = keysOf(EvidenceHandleSchema)
  assert.equal([...handleKeys].some((k) => AGGREGATE.test(k)), false, "o handle não pode ter campo agregado")
  const results = Object.values(views.PROMPT_VIEWS).map((v) => capabilityResultSchema(v as Any))
  for (const [name, schema] of [...Object.entries(views).filter(([k]) => /Schema$/.test(k)), ...results.map((r, n) => [`CapabilityResult#${n}`, r] as [string, unknown])] as Array<[string, Any]>) {
    const bad = [...keysOf(schema)].filter((k) => AGGREGATE.test(k) && !(k === "ok" && name.startsWith("CapabilityResult")))
    assert.deepEqual(bad, [], `${name}: chave agregada de veredito ${bad.join(",")}`)
  }
  // um verdict só com um dos componentes é inválido (a própria regra do §6.1)
  assert.equal(VerdictSchema.safeParse({ verify: { status: "VALID", codes: [] }, combined: "VERIFIED" }).success, false)
  assert.equal(VerdictSchema.safeParse({ source: { status: "SOURCE_VERIFIED", codes: [] }, combined: "VERIFIED" }).success, false)
  // todo arquivo do agente que cita SOURCE_VERIFIED também define o status do verify (os dois componentes juntos)
  for (const f of walk(join(ROOT, "src/lib/agent")).filter((x) => x.endsWith(".ts"))) {
    const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")
    // E6.6-0c (Marcelo, Opção 1, 13/10/2026): `VERIFY_STATUSES` (verdict.ts, lista local que evita ciclo com o contrato) vale como `VerifyStatusSchema`. Prova PRESENÇA textual, não uso real (limitação conhecida dos guardas textuais).
    if (/SOURCE_VERIFIED/.test(code)) assert.ok(/VerifyStatusSchema|VERIFY_STATUSES/.test(code) && /"VALID"/.test(code), `${f.replace(ROOT, "")}: cita o estado do E5b sem o do verify`)
  }
})

console.log(`\n${passed} testes ok`)
