// Evidence E1 — identidade determinística (importId, rowHash, tradeId, accountRef) e adaptador SHA-256.
//   node scripts/test-evidence-identity.mts
// Usa só a fixture SINTÉTICA versionada; as fixtures reais locais (se existirem) entram num bloco à parte, sem números embutidos.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { CanonicalTradeSchema, ImportRecordSchema, type CanonicalTrade } from "../src/lib/domain/canonical.ts"
import { canonicalJson, hashCanonical, sha256Hex } from "../src/lib/infra/hash.ts"
import { accountRef, describeText } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { calculateMetrics, toAnalyticsTrades } from "../src/lib/metrics/index.ts"

const CSV = readFileSync(fileURLToPath(new URL("../fixtures/_synthetic/ninjatrader-ptbr-cycles.csv", import.meta.url)), "utf8")
const BRT = "America/Sao_Paulo"
const NY = "America/New_York"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const ids = (ts: CanonicalTrade[]) => ts.map((t) => t.tradeId as string)
const sorted = (xs: string[]) => [...xs].sort()
const cents = (xs: Array<number | null>) => xs.reduce((a: number, b) => a + Math.round((b ?? 0) * 100), 0)
const money = (ts: CanonicalTrade[]) => [cents(ts.map((t) => t.pnl.net)), cents(ts.map((t) => t.pnl.gross)), cents(ts.map((t) => t.pnl.commission)), cents(ts.map((t) => t.pnl.fees)), ts.reduce((a, t) => a + t.quantity, 0)]
const lines = CSV.replace(/\r?\n$/, "").split(/\r?\n/)
const reorder = (order: (rows: string[]) => string[]) => [lines[0], ...order(lines.slice(1))].join("\n") + "\n"

const base = runImportPipeline(CSV, { sourceTz: BRT, fileName: "a.csv" })

// ── adaptador de hash ────────────────────────────────────────────────────────

test("SHA-256: vetor de teste conhecido ('abc') e UTF-8", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  assert.equal(sha256Hex("ç"), sha256Hex(new TextEncoder().encode("ç")))
})

test("JSON canônico: chaves ordenadas, undefined omitido, -0 = 0; tipos inválidos lançam erro", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}')
  assert.equal(hashCanonical({ a: 1, b: 2 }), hashCanonical({ b: 2, a: 1 }))
  assert.equal(canonicalJson(-0), "0")
  assert.throws(() => canonicalJson(Number.NaN), TypeError)
  assert.throws(() => canonicalJson(new Date()), TypeError)
  assert.throws(() => canonicalJson(() => 1), TypeError)
})

// ── estabilidade ─────────────────────────────────────────────────────────────

test("ESTABILIDADE: mesmo conteúdo ⇒ mesmos importId e tradeIds, sempre (sem random, sem relógio)", () => {
  const again = runImportPipeline(CSV, { sourceTz: BRT, fileName: "a.csv" })
  assert.equal(again.importRecord!.importId, base.importRecord!.importId)
  assert.deepEqual(ids(again.trades), ids(base.trades))
  assert.deepEqual(ids(again.rowTrades), ids(base.rowTrades))
  assert.ok(base.trades.every((t) => /^trd_[0-9a-f]{32}$/.test(t.tradeId as string)))
  assert.match(base.importRecord!.importId, /^imp_[0-9a-f]{32}$/)
})

test("ESTABILIDADE: nome do arquivo NÃO entra na identidade (é metadado); fileHash do chamador também não", () => {
  const renamed = runImportPipeline(CSV, { sourceTz: BRT, fileName: "outro-nome.csv", fileHash: "xyz" })
  assert.equal(renamed.importRecord!.importId, base.importRecord!.importId)
  assert.deepEqual(ids(renamed.trades), ids(base.trades))
  assert.equal(renamed.importRecord!.fileName, "outro-nome.csv")
})

test("UNICIDADE: ids únicos dentro do import (ciclos e linhas)", () => {
  assert.equal(new Set(ids(base.trades)).size, base.trades.length)
  assert.equal(new Set(ids(base.rowTrades)).size, base.rowTrades.length)
})

test("REORDENAÇÃO: inverter/embaralhar as linhas mantém rowHashes e a composição dos ciclos; o tradeId acompanha o import (arquivo novo ⇒ import novo)", () => {
  const rev = runImportPipeline(reorder((r) => [...r].reverse()), { sourceTz: BRT })
  const shuf = runImportPipeline(reorder((r) => [r[3], r[0], r[6], r[1], r[5], r[2], r[4]]), { sourceTz: BRT })
  const hashes = (r: typeof base) => sorted(r.trades.flatMap((t) => (t.sourceRows ?? []).map((s) => s.rowHash as string)))
  const cycles = (r: typeof base) => sorted(r.trades.map((t) => (t.sourceRows ?? []).map((s) => s.rowHash as string).sort().join("+")))
  for (const other of [rev, shuf]) {
    assert.equal(other.trades.length, base.trades.length)
    assert.deepEqual(hashes(other), hashes(base)) // o conteúdo da linha não depende da posição
    assert.deepEqual(cycles(other), cycles(base)) // os mesmos ciclos, com as mesmas linhas
    assert.notEqual(other.importRecord!.fileSha256, base.importRecord!.fileSha256)
    assert.notEqual(other.importRecord!.importId, base.importRecord!.importId)
    assert.ok(other.trades.every((t) => !ids(base.trades).includes(t.tradeId as string))) // decisão: id é por import; dedupe entre imports fica para depois
    assert.deepEqual(money(other.trades), money(base.trades))
  }
})

// ── colisão / sensibilidade ──────────────────────────────────────────────────

test("COLISÃO: arquivo diferente ⇒ importId e tradeIds diferentes (todos)", () => {
  const edited = runImportPipeline(CSV.replace("21:10:00", "21:11:00"), { sourceTz: BRT })
  assert.notEqual(edited.importRecord!.importId, base.importRecord!.importId)
  assert.equal(new Set([...ids(edited.trades), ...ids(base.trades)]).size, edited.trades.length + base.trades.length)
})

test("COLISÃO: mesma fonte lida com outro fuso (outros instantes) ⇒ outro importId e outros tradeIds", () => {
  const ny = runImportPipeline(CSV, { sourceTz: NY })
  assert.notEqual(ny.importRecord!.importId, base.importRecord!.importId)
  assert.ok(ny.trades.every((t) => !ids(base.trades).includes(t.tradeId as string)))
})

test("RECONSTRUÇÃO: ciclo e linha-como-trade têm identidades distintas; sem reconstrução, trades = linhas com os MESMOS ids das rowTrades", () => {
  const flat = runImportPipeline(CSV, { sourceTz: BRT, reconstructCycles: false })
  assert.equal(flat.trades.length, 7)
  assert.deepEqual(ids(flat.trades), ids(flat.rowTrades))
  assert.deepEqual(ids(flat.rowTrades), ids(base.rowTrades)) // a linha é a mesma coisa com ou sem reconstrução
  assert.ok(ids(base.trades).every((id) => !ids(base.rowTrades).includes(id)))
  assert.equal(flat.importRecord!.reconstructionMethod, null)
  assert.equal(base.importRecord!.reconstructionMethod, "NT8_ROW_INTERVALS_V1")
  assert.equal(base.importRecord!.reconstructionVersion, "1")
})

test("DUPLICATAS: linha de conteúdo idêntico (reconstrução desligada) ganha ordinal — sem colisão e determinístico", () => {
  const dup = [...lines, lines[1]].join("\n") + "\n"
  const a = runImportPipeline(dup, { sourceTz: BRT, reconstructCycles: false })
  const b = runImportPipeline(dup, { sourceTz: BRT, reconstructCycles: false })
  assert.equal(a.trades.length, 8)
  assert.equal(new Set(ids(a.trades)).size, 8)
  assert.deepEqual(ids(a.trades), ids(b.trades))
})

// ── invariantes financeiros ──────────────────────────────────────────────────

test("INVARIANTE: a identidade não muda dinheiro — soma de net/gross/commission/fees/qtd igual entre linhas e ciclos, e igual ao pipeline sem reconstrução", () => {
  assert.deepEqual(money(base.trades), money(base.rowTrades))
  const m = calculateMetrics(toAnalyticsTrades(base.trades))
  assert.equal(m.population.afterFilters, base.trades.length)
  assert.deepEqual(m.population.tradeIds ? sorted(m.population.tradeIds) : null, sorted(ids(base.trades))) // o motor passa a usar o tradeId real
})

test("SCHEMA: trades com identidade continuam válidos em canonical-trade/2; sem identidade (v1) também", () => {
  for (const t of [...base.trades, ...base.rowTrades]) assert.equal(CanonicalTradeSchema.safeParse(t).success, true)
  const { tradeId, importId, ...bare } = base.trades[0]
  void tradeId
  void importId
  assert.equal(CanonicalTradeSchema.safeParse({ ...bare, schemaVersion: "canonical-trade/1", account: { sourceName: bare.account.sourceName } }).success, true)
})

// ── accountRef / privacidade ─────────────────────────────────────────────────

test("accountRef: determinístico, não reversível, muda com o sal, ignora espaços; null ⇒ null", () => {
  assert.equal(accountRef("Sim101"), accountRef("  Sim101 "))
  assert.notEqual(accountRef("Sim101"), accountRef("Sim102"))
  assert.notEqual(accountRef("Sim101", "u1"), accountRef("Sim101", "u2"))
  assert.match(accountRef("Sim101") as string, /^acc_[0-9a-f]{24}$/)
  assert.ok(!(accountRef("Sim101") as string).includes("Sim101"))
  assert.equal(accountRef(null), null)
  assert.equal(accountRef("   "), null)
})

test("PRIVACIDADE: trades têm account.ref; o nome da conta não aparece em nenhum hash/id/ref e o sal altera ref e tradeId", () => {
  const t = base.trades[0]
  assert.equal(t.account.ref, accountRef(t.account.sourceName))
  const blob = JSON.stringify([base.importRecord, ...base.trades.map((x) => [x.tradeId, x.importId, x.account.ref, x.sourceRows?.map((r) => r.rowHash)])])
  assert.ok(!blob.includes(t.account.sourceName as string))
  const salted = runImportPipeline(CSV, { sourceTz: BRT, accountRefSalt: "usuario-1" })
  assert.notEqual(salted.trades[0].account.ref, t.account.ref)
  assert.notEqual(salted.trades[0].tradeId, t.tradeId) // rowHash usa o ref salgado
  assert.equal(salted.importRecord!.importId, base.importRecord!.importId) // o sal não é parte do arquivo
})

// ── ImportRecord ─────────────────────────────────────────────────────────────

test("ImportRecord: SHA-256 do texto, bytes UTF-8, fim de linha, BOM, contagens e parser; válido no schema", () => {
  const r = base.importRecord!
  assert.equal(ImportRecordSchema.safeParse(r).success, true)
  assert.equal(r.fileSha256, sha256Hex(CSV))
  assert.equal(r.fileBytes, Buffer.byteLength(CSV, "utf8"))
  assert.deepEqual([r.hashBasis, r.hasBom, r.parserId, r.rowsRead, r.rowsAccepted, r.rowsRejected], ["UTF8_TEXT", false, base.parser!.id, 7, 7, 0])
  assert.deepEqual(r.settings, base.settings)
})

test("describeText: LF/CRLF/CR/MIXED/NONE e BOM", () => {
  assert.equal(describeText("a\nb\n").lineEnding, "LF")
  assert.equal(describeText("a\r\nb\r\n").lineEnding, "CRLF")
  assert.equal(describeText("a\rb\r").lineEnding, "CR")
  assert.equal(describeText("a\r\nb\n").lineEnding, "MIXED")
  assert.equal(describeText("abc").lineEnding, "NONE")
  assert.equal(describeText("﻿abc").hasBom, true)
})

test("ImportRecord: CRLF vs LF é arquivo diferente (outro SHA e importId); mesmos ciclos", () => {
  const crlf = runImportPipeline(CSV.replace(/\n/g, "\r\n"), { sourceTz: BRT })
  assert.equal(crlf.importRecord!.lineEnding, "CRLF")
  assert.notEqual(crlf.importRecord!.fileSha256, base.importRecord!.fileSha256)
  assert.notEqual(crlf.importRecord!.importId, base.importRecord!.importId)
  assert.equal(crlf.trades.length, base.trades.length)
  assert.deepEqual(money(crlf.trades), money(base.trades))
})

test("falha de formato ⇒ importRecord null e nenhum trade", () => {
  const bad = runImportPipeline("a;b\n1;2\n")
  assert.equal(bad.importRecord, null)
  assert.equal(bad.trades.length, 0)
})

// ── fixtures reais (locais; sem números embutidos) ───────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  test(`REAL ${tag}: ids estáveis, únicos, rowHash invariante à ordem; dinheiro intacto`, () => {
    const a = runImportPipeline(text, ctx)
    const b = runImportPipeline(text, ctx)
    assert.deepEqual(ids(a.trades), ids(b.trades))
    assert.equal(new Set(ids(a.trades)).size, a.trades.length)
    const l = text.replace(/\r?\n$/, "").split(/\r?\n/)
    const rev = runImportPipeline([l[0], ...l.slice(1).reverse()].join("\n") + "\n", ctx)
    const rh = (r: typeof a) => sorted(r.trades.flatMap((t) => (t.sourceRows ?? []).map((x) => x.rowHash as string)))
    assert.deepEqual(rh(rev), rh(a)) // rowHash não depende da posição da linha
    assert.deepEqual(money(a.trades), money(a.rowTrades))
    assert.ok(a.trades.every((t) => (t.sourceRows ?? []).every((s) => typeof s.rowHash === "string")))
  })
}

console.log(`\n${passed} testes ok`)
