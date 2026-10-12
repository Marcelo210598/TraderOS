// Política de sal — P1: generateSalt, saltCheck, chaveiro em memória (SaltProvider). Expectativas: scripts/expectations/salt-policy.expected.json
// (provider_cases P1–P4). NÃO ligado a nada: este teste trava que nenhum outro módulo importa salt.ts ainda.
//   node scripts/test-salt-policy-p1.mts
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { inspect } from "node:util"
import { fileURLToPath } from "node:url"
import { accountRef, labelRef, patternRef, strategyRef } from "../src/lib/ingest/identity.ts"
import { InMemorySaltKeyring, SALT_CHECK_RE, SALT_ID_RE, SALT_MIN_BYTES, SaltError, generateSalt, isStrongSalt, saltCheck } from "../src/lib/ingest/salt.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const ROOT = fileURLToPath(new URL("..", import.meta.url))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`) }
const throwsCode = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof SaltError && e.code === code, code)
const exp = JSON.parse(readFileSync(join(ROOT, "scripts/expectations/salt-policy.expected.json"), "utf8"))
const counter = () => { let n = 0; return () => (++n).toString(16).padStart(64, "0") } // determinístico, 64 hex = forte

test("P1 — generateSalt: 32 bytes aleatórios (64 hex), todas diferentes; recusa < 32 bytes; aceita mais", () => {
  const a = generateSalt(), b = generateSalt()
  assert.match(a, /^[0-9a-f]{64}$/); assert.notEqual(a, b)
  assert.equal(new Set(Array.from({ length: 200 }, () => generateSalt())).size, 200)
  for (const n of [0, 1, 16, 31, -1, 32.5, Number.NaN]) throwsCode(() => generateSalt(n), "E_SALT_WEAK")
  assert.equal(generateSalt(48).length, 96)
  assert.equal(SALT_MIN_BYTES, 32)
  assert.equal(exp.provider_cases.P1_generate.expected.includes("32 bytes"), true)
})

test("P1b — isStrongSalt: só hex minúsculo, tamanho par, ≥ 64 chars", () => {
  assert.equal(isStrongSalt(generateSalt()), true)
  for (const w of ["", "abc", "meusal123", "a".repeat(63), "A".repeat(64), "g".repeat(64), "a".repeat(65), 123, null, undefined]) assert.equal(isStrongSalt(w), false, String(w))
})

test("P2 — saltCheck: slt_<24 hex>, determinístico; sais diferentes ⇒ checks diferentes; sal fraco ⇒ E_SALT_WEAK (nunca publica check de sal fraco)", () => {
  const s1 = generateSalt(), s2 = generateSalt()
  assert.match(saltCheck(s1), SALT_CHECK_RE)
  assert.equal(saltCheck(s1), saltCheck(s1)); assert.notEqual(saltCheck(s1), saltCheck(s2))
  for (const w of ["", "meusal123", "a".repeat(62)]) throwsCode(() => saltCheck(w), "E_SALT_WEAK")
})

test("P2b — saltCheck não vaza o sal e não coincide com nenhum ref (acc_/str_/lbl_/pat_), nem com o ref do próprio sal como texto", () => {
  const s = generateSalt(); const c = saltCheck(s)
  assert.equal(c.includes(s.slice(0, 8)), false)
  assert.equal(c.includes(s), false)
  const hex = c.slice(4)
  for (const r of [accountRef(s), strategyRef(s), labelRef(s), patternRef(s), accountRef("x", s), strategyRef("x", s), labelRef("x", s), patternRef("x", s)]) {
    assert.ok(r); assert.notEqual(r!.slice(4), hex, "saltCheck colide com um ref")
  }
  assert.equal(c.startsWith("slt_"), true)
})

test("P3 — chaveiro: ensure cria s1; rotate cria s2 (atual) e mantém s1 só para verificar; get: ACTIVE(current)/ACTIVE(antigo)/RETIRED/UNKNOWN", () => {
  const k = new InMemorySaltKeyring(counter())
  assert.equal(k.current("u1"), null)
  assert.deepEqual(k.ensure("u1"), { saltId: "s1" }); assert.deepEqual(k.ensure("u1"), { saltId: "s1" }, "ensure é idempotente")
  assert.deepEqual(k.rotate("u1"), { saltId: "s2" })
  assert.equal(k.current("u1")!.saltId, "s2")
  const g1 = k.get("u1", "s1"), g2 = k.get("u1", "s2")
  assert.equal(g1.status, "ACTIVE"); assert.equal((g1 as Any).current, false)
  assert.equal(g2.status, "ACTIVE"); assert.equal((g2 as Any).current, true)
  assert.notEqual((g1 as Any).salt, (g2 as Any).salt)
  assert.deepEqual(k.get("u1", "s99"), { status: "UNKNOWN", saltId: "s99" })
  assert.deepEqual(k.known("u1").map((x) => x.saltId), ["s2", "s1"], "do mais novo ao mais velho")
})

test("P3b — aposentar apaga o VALOR e mantém o registro (RETIRED); o atual não pode ser aposentado; aposentado sai de known() e nunca é o atual", () => {
  const k = new InMemorySaltKeyring(counter())
  k.ensure("u1"); k.rotate("u1")
  throwsCode(() => k.retire("u1", "s2"), "E_SALT_CURRENT_CANNOT_RETIRE")
  throwsCode(() => k.retire("u1", "s9"), "E_SALT_UNKNOWN_ID")
  k.retire("u1", "s1")
  assert.deepEqual(k.get("u1", "s1"), { status: "RETIRED", saltId: "s1" })
  assert.equal("salt" in k.get("u1", "s1"), false, "RETIRED não carrega valor")
  assert.deepEqual(k.known("u1").map((x) => x.saltId), ["s2"])
  assert.equal(k.current("u1")!.saltId, "s2")
  // regra "só o último gera": último registro aposentado (carregado de fora) ⇒ sem sal atual, não cai para o antigo
  const k2 = InMemorySaltKeyring.from([{ userId: "u", saltId: "s1", salt: generateSalt() }, { userId: "u", saltId: "s2", salt: null }])
  throwsCode(() => k2.ensure("u"), "E_SALT_NO_CURRENT") // bloqueio explícito: ensure NÃO recria sal em silêncio
  assert.equal(k2.current("u"), null, "continua sem atual depois do ensure recusado")
  assert.deepEqual(k2.rotate("u"), { saltId: "s3" }); assert.equal(k2.current("u")!.saltId, "s3") // só a ação explícita destrava
  const k3 = InMemorySaltKeyring.from([{ userId: "u", saltId: "s1", salt: generateSalt() }, { userId: "u", saltId: "s2", salt: null }])
  assert.equal(k3.current("u"), null); assert.equal(k2.get("u", "s1").status, "ACTIVE"); assert.equal((k2.get("u", "s1") as Any).current, false)
})

test("P3c — usuários não se enxergam; userId inválido e saltId inválido/duplicado/fraco são erros com código", () => {
  const k = new InMemorySaltKeyring(counter())
  k.ensure("u1"); k.ensure("u2")
  assert.notEqual(k.current("u1")!.salt, k.current("u2")!.salt)
  k.rotate("u1")
  assert.deepEqual(k.known("u2").map((x) => x.saltId), ["s1"]); assert.equal(k.get("u2", "s2").status, "UNKNOWN")
  assert.equal(k.get("outro", "s1").status, "UNKNOWN")
  for (const bad of ["", "  "]) throwsCode(() => k.ensure(bad), "E_SALT_USER_INVALID")
  throwsCode(() => InMemorySaltKeyring.from([{ userId: "u", saltId: "S1", salt: generateSalt() }]), "E_SALT_ID_INVALID")
  throwsCode(() => InMemorySaltKeyring.from([{ userId: "u", saltId: "s 1", salt: generateSalt() }]), "E_SALT_ID_INVALID")
  throwsCode(() => InMemorySaltKeyring.from([{ userId: "u", saltId: "s1", salt: generateSalt() }, { userId: "u", saltId: "s1", salt: generateSalt() }]), "E_SALT_DUPLICATE")
  throwsCode(() => InMemorySaltKeyring.from([{ userId: "u", saltId: "s1", salt: "meusal123" }]), "E_SALT_WEAK")
  for (const id of ["s1", "s2", "usr-2026_a"]) assert.match(id, SALT_ID_RE)
  for (const id of ["", "S1", "-s1", "s".repeat(33)]) assert.doesNotMatch(id, SALT_ID_RE)
})

test("P3d — sigilo: o valor do sal nunca sai por JSON, inspect, spread, mensagem de erro ou ensure/rotate/get RETIRED/UNKNOWN", () => {
  const k = new InMemorySaltKeyring()
  const { saltId } = k.ensure("u1"); k.rotate("u1")
  const salts = k.known("u1").map((x) => x.salt)
  const dump = [JSON.stringify(k), inspect(k, { depth: 5, showHidden: true }), JSON.stringify({ ...k }), String(k), JSON.stringify(k.ensure("u1")), JSON.stringify(k.rotate("u1")), JSON.stringify(k.get("u1", "s9"))]
  for (const s of salts) for (const d of dump) assert.equal(d.includes(s), false)
  assert.equal(saltId, "s1")
  k.retire("u1", "s1"); assert.equal(JSON.stringify(k.get("u1", "s1")).length < 60, true)
  const s = generateSalt()
  for (const f of [() => saltCheck(s.slice(0, 40)), () => InMemorySaltKeyring.from([{ userId: "u", saltId: "s1", salt: s.slice(0, 40) }]), () => generateSalt(8)]) {
    try { f(); assert.fail("devia lançar") } catch (e) { assert.equal((e as Error).message.includes(s.slice(0, 20)), false, "mensagem de erro vaza o sal") }
  }
})

test("P4 — LIGAÇÃO CONTROLADA: só os importadores APROVADOS (leitor, gerador, pipeline, tipo) importam ingest/salt; nada de persistência/banco/Prisma no módulo", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const importers = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && /from\s+["'][^"']*\/salt(\.ts)?["']/.test(readFileSync(f, "utf8")))
  // lista APROVADA de quem importa salt.ts (quem entra aqui é revisado): leitor (E5b, P4), gerador de trade (P3, trava E_SALT_*), pipeline (P3, sal gerenciado) e o tipo do contexto
  const APPROVED = ["src/lib/evidence/explain-trade.ts", "src/lib/evidence/verify-source.ts", "src/lib/ingest/pipeline.ts", "src/lib/ingest/types.ts"]
  assert.deepEqual(importers.map((f) => f.replace(ROOT, "")).sort(), APPROVED, "importador de salt.ts fora da lista aprovada (revise o uso do sal e inclua aqui)")
  const code = readFileSync(join(ROOT, "src/lib/ingest/salt.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  assert.equal(/prisma|process\.env|node:fs|fetch\(|localStorage|console\./i.test(code), false)
  assert.match(code, /from "\.\.\/infra\/hash\.ts"/); assert.equal(/node:crypto/.test(code), false, "aleatoriedade só via infra/hash.ts")
})

console.log(`\n${passed} testes ok`)
