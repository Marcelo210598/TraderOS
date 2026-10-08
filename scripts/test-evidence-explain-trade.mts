// Evidence E3 — explainTrade: CanonicalTrade → TradeEvidence → SourceRowRef → ImportRef.   node scripts/test-evidence-explain-trade.mts
// Sintético versionado + (se existirem) as fixtures reais LOCAIS, sem números embutidos e sem nada real no repositório.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CanonicalTrade, ImportRecord } from "../src/lib/domain/canonical.ts"
import { explainTrade, explainTrades, type ExplainTradeResult } from "../src/lib/evidence/explain-trade.ts"
import { EVIDENCE_SCHEMA, sealEvidence } from "../src/lib/evidence/hash.ts"
import { findAccountNameLeak, redactFileName } from "../src/lib/evidence/redact.ts"
import { EvidenceBundleSchema, ImportRefSchema, TradeEvidenceSchema } from "../src/lib/evidence/schema.ts"
import { canonicalJson } from "../src/lib/infra/hash.ts"
import { parseDelimited } from "../src/lib/ingest/csv.ts"
import { accountRef } from "../src/lib/ingest/identity.ts"
import { runImportPipeline } from "../src/lib/ingest/pipeline.ts"
import type { ImportContext } from "../src/lib/ingest/types.ts"
import { synthCsv, type SynthRow } from "./_evidence-fixtures.mts"

const BRT = "America/Sao_Paulo"
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
type Ok = Extract<ExplainTradeResult, { ok: true }>
type Err = Extract<ExplainTradeResult, { ok: false }>
const ok = (r: ExplainTradeResult): Ok => {
  assert.equal(r.ok, true, r.ok ? "" : `${(r as Err).code}: ${(r as Err).message}`)
  return r as Ok
}
const err = (r: ExplainTradeResult, code: string): Err => {
  assert.equal(r.ok, false)
  assert.equal((r as Err).code, code)
  return r as Err
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const cents = (xs: Array<number | null>) => xs.reduce((a: number, b) => a + Math.round((b ?? 0) * 100), 0)

// ── fixture sintética: 5 ciclos em 2 contas ──────────────────────────────────

const ROWS: SynthRow[] = [
  // A: scale-in (2ª entrada 5 min depois) + scale-out (duas saídas em horários diferentes); extremos divergem
  { entryPrice: 2000, exitPrice: 2004, entryAt: "02/02/2026 21:00:00", exitAt: "02/02/2026 21:30:00", exitLabel: "Target1" },
  { entryPrice: 2001, exitPrice: 2006, entryAt: "02/02/2026 21:05:00", exitAt: "02/02/2026 21:40:00", exitLabel: "Target2" },
  // B e C: saída de um e entrada do outro no MESMO segundo (ciclos separados, LOW_CONFIDENCE)
  { entryPrice: 2000, exitPrice: 2003, entryAt: "02/02/2026 21:50:00", exitAt: "02/02/2026 22:00:00" },
  { entryPrice: 2003, exitPrice: 2005, entryAt: "02/02/2026 22:00:00", exitAt: "02/02/2026 22:10:00" },
  // D: mesma janela, MFE diferente ⇒ EXCURSION_CONFLICT
  { entryPrice: 2000, exitPrice: 2005, entryAt: "03/02/2026 21:00:00", exitAt: "03/02/2026 21:10:00", mfe: 90, mae: 8 },
  { entryPrice: 2000, exitPrice: 2005, entryAt: "03/02/2026 21:00:00", exitAt: "03/02/2026 21:10:00", mfe: 50, mae: 8 },
  // E: outra conta, sem ambiguidade
  { account: "Sim102", entryPrice: 2000, exitPrice: 2002, entryAt: "04/02/2026 21:00:00", exitAt: "04/02/2026 21:10:00" },
]
const CSV = synthCsv(ROWS)
const FILE = "Sim101_Sim102-fevereiro.csv"
const imp = runImportPipeline(CSV, { sourceTz: BRT, fileName: FILE })
const rec = imp.importRecord as ImportRecord
const [A, B, C, D, E] = imp.trades
const all = explainTrades(imp.trades, rec).map(ok)
const [eA, eB, eC, eD, eE] = all
const NAMES = ["Sim101", "Sim102"]

// ── contrato básico / schema ─────────────────────────────────────────────────

test("a fixture sintética produz o que o plano precisa: 5 ciclos, scale-in/out, mesmo segundo, conflito, 2 contas", () => {
  assert.equal(imp.trades.length, 5)
  assert.deepEqual(A.entryLegs!.map((l) => l.role), ["ENTRY", "SCALE_IN"])
  assert.deepEqual(A.exitLegs!.map((l) => l.role), ["SCALE_OUT", "EXIT"])
  assert.deepEqual([B, C].map((t) => t.reconstruction!.ambiguities.map((a) => a.code)), [["SAME_SECOND_BOUNDARY"], ["SAME_SECOND_BOUNDARY"]])
  assert.equal(D.excursions.conflict, true)
  assert.deepEqual([A, B, C, D, E].map((t) => t.account.sourceName), ["Sim101", "Sim101", "Sim101", "Sim101", "Sim102"])
})

test("SCHEMA: todo TradeEvidence e ImportRef gerados passam no evidence/1 estrito e dentro de um bundle selado", () => {
  for (const r of all) {
    assert.equal(TradeEvidenceSchema.safeParse(r.tradeEvidence).success, true)
    assert.equal(ImportRefSchema.safeParse(r.importRef).success, true)
  }
  const bundle = sealEvidence({
    schema: EVIDENCE_SCHEMA,
    claim: { kind: "TRADE", statement: null },
    subject: { type: "TRADE", id: eA.tradeEvidence.tradeId },
    evidence: { imports: [eA.importRef], trades: all.map((r) => r.tradeEvidence), metrics: [] },
  })
  assert.equal(EvidenceBundleSchema.safeParse(bundle).success, true)
  assert.equal(EvidenceBundleSchema.safeParse({ ...bundle, extra: 1 }).success, false)
  assert.equal(TradeEvidenceSchema.safeParse({ ...eA.tradeEvidence, labels: { notes: "x" } }).success, false)
})

// ── identidade / rastreabilidade ─────────────────────────────────────────────

test("IDENTIDADE: tradeId, importId e rowHash são PRESERVADOS (nenhum gerado, nenhum alterado)", () => {
  imp.trades.forEach((t, i) => {
    const e = all[i].tradeEvidence
    assert.equal(e.tradeId, t.tradeId)
    assert.equal(e.importId, t.importId)
    assert.equal(e.importId, rec.importId)
    assert.deepEqual(e.sourceRows.map((r) => [r.rowNo, r.rowHash, r.importId]), t.sourceRows!.map((r) => [r.rowNo, r.rowHash, t.importId]))
    assert.equal(e.provenance, "COMPLETE")
    assert.deepEqual(all[i].notes.filter((n) => n.code !== "N_FILENAME_REDACTED"), [])
  })
})

test("RASTREABILIDADE: 'de onde veio?' — TradeEvidence → SourceRowRef(importId,rowNo,rowHash) → ImportRef (arquivo, SHA-256, parser, reconstrução)", () => {
  const ref = eA.tradeEvidence.sourceRows[0]
  assert.equal(ref.importId, eA.importRef.importId)
  assert.equal(eA.importRef.fileSha256, rec.fileSha256)
  assert.deepEqual([eA.importRef.parserId, eA.importRef.parserVersion, eA.importRef.reconstructionMethod, eA.importRef.reconstructionVersion], [rec.parserId, rec.parserVersion, "NT8_ROW_INTERVALS_V1", "1"])
  assert.deepEqual([eA.importRef.rowsRead, eA.importRef.rowsAccepted, eA.importRef.rowsRejected], [7, 7, 0])
  assert.equal(eA.importRef.hashBasis, "UTF8_TEXT")
})

test("LINHAS: sourceRows de ciclo = FULL com valores crus (MAE/MFE/ETD por linha, NÃO somados), ordenadas por rowNo", () => {
  const rows = eD.tradeEvidence.sourceRows
  assert.deepEqual(rows.map((r) => [r.rowNo, r.detail]), [[6, "FULL"], [7, "FULL"]])
  assert.deepEqual(rows.map((r) => [r.maeUsd, r.mfeUsd, r.etdUsd]), [[8, 90, 40], [8, 50, 40]]) // crus, linha a linha
  assert.deepEqual(rows.map((r) => [r.entryLabel, r.exitLabel]), [["Entry", "Target1"], ["Entry", "Target1"]])
  assert.ok(rows.every((r) => r.cumulativeNetReported !== null))
  // cada rowRef das pernas existe em sourceRows
  const known = new Set(eA.tradeEvidence.sourceRows.map((r) => r.rowNo))
  for (const leg of [...eA.tradeEvidence.entryLegs!, ...eA.tradeEvidence.exitLegs!]) assert.ok(leg.rowRefs.every((n) => known.has(n)))
})

// ── SOURCE_ROW (linha como trade) ────────────────────────────────────────────

const flat = runImportPipeline(CSV, { sourceTz: BRT, fileName: FILE, reconstructCycles: false })
test("SOURCE_ROW: o trade-linha leva o rowHash em source.rowHash; a Evidence tem SourceRowRef TRADE_VALUES (resto null, declarado)", () => {
  assert.equal(flat.trades.length, 7)
  const rows = explainTrades(flat.trades, flat.importRecord as ImportRecord).map(ok)
  rows.forEach((r, i) => {
    const t = flat.trades[i]
    assert.equal(t.source.rowHash?.length, 64)
    assert.equal(r.tradeEvidence.granularity, "SOURCE_ROW")
    assert.equal(r.tradeEvidence.provenance, "COMPLETE")
    assert.equal(r.tradeEvidence.sourceRows.length, 1)
    const s = r.tradeEvidence.sourceRows[0]
    assert.deepEqual([s.rowNo, s.rowHash, s.importId, s.detail], [t.source.rowNo, t.source.rowHash, t.importId, "TRADE_VALUES"])
    assert.deepEqual([s.entryLabel, s.maeUsd, s.mfeUsd, s.etdUsd, s.entryLeg, s.cumulativeNetReported], [null, null, null, null, null, null])
    assert.equal(r.tradeEvidence.entryLegs, null)
    assert.equal(r.tradeEvidence.reconstruction, null)
  })
})

test("SOURCE_ROW: o rowHash da linha é o MESMO com ou sem reconstrução (linha 2 no ciclo A = linha 2 solta)", () => {
  const solta = flat.trades.find((t) => t.source.rowNo === 2) as CanonicalTrade
  assert.equal(solta.source.rowHash, A.sourceRows!.find((r) => r.rowNo === 2)?.rowHash)
  // nos ciclos o rowHash NÃO vai em source (cada linha tem o seu em sourceRows)
  assert.ok(imp.trades.every((t) => t.source.rowHash === undefined))
})

// ── reconstruction ───────────────────────────────────────────────────────────

test("RECONSTRUCTION: method, version, scope, confidence, completeness, integrity, boundary e ambiguidades preservados; cycleKey com accountRef", () => {
  const r = eA.tradeEvidence.reconstruction!
  assert.deepEqual([r.method, r.version, r.scope, r.confidence, r.completeness, r.integrity], [A.reconstruction!.method, "1", "STRATEGY_POSITION", A.reconstruction!.confidence, A.reconstruction!.completeness, "CONSISTENT"])
  assert.deepEqual(r.boundary, A.reconstruction!.boundary)
  assert.deepEqual(r.cycleKey, { accountRef: A.account.ref, contract: A.reconstruction!.cycleKey.contract, strategy: "Estrategia Teste", direction: "LONG" })
  assert.equal("account" in r.cycleKey, false)
  assert.equal(eA.tradeEvidence.accountRef, A.account.ref)
  assert.notEqual(eA.tradeEvidence.accountRef, eE.tradeEvidence.accountRef) // contas distintas continuam distinguíveis
  assert.equal(r.cycleKey.accountRef, eA.tradeEvidence.accountRef)
  assert.equal("ambiguities" in eA.tradeEvidence, false) // única fonte: reconstruction.ambiguities
})

test("AMBIGUIDADES: SAME_SECOND_BOUNDARY (LOW_CONFIDENCE, com rowNos e mensagem) e ACCUMULATED_MISMATCH preservados sem alteração", () => {
  for (const [e, t] of [[eB, B], [eC, C]] as const) {
    const amb = e.tradeEvidence.reconstruction!.ambiguities
    assert.deepEqual(amb, t.reconstruction!.ambiguities)
    assert.deepEqual([amb[0].code, amb[0].severity], ["SAME_SECOND_BOUNDARY", "LOW_CONFIDENCE"])
    assert.equal(e.tradeEvidence.reconstruction!.confidence, "LOW")
  }
  const broken = runImportPipeline(synthCsv(ROWS.slice(0, 2), { breakCumulative: true }), { sourceTz: BRT })
  const eb = ok(explainTrade(broken.trades[0], broken.importRecord as ImportRecord))
  assert.ok(eb.tradeEvidence.reconstruction!.ambiguities.some((a) => a.code === "ACCUMULATED_MISMATCH"))
  assert.equal(eb.tradeEvidence.reconstruction!.integrity, "BROKEN")
})

// ── legs / P&L / excursions ──────────────────────────────────────────────────

test("PERNAS: scale-in e scale-out com horário, preço, qtd, rótulo, motivo/regra, sizeAfter e P&L por perna — idênticos ao canonical", () => {
  const e = eA.tradeEvidence
  assert.deepEqual(e.entryLegs!.map((l) => [l.role, l.price, l.quantity, l.sourceLabel, l.at.instantUtc]), A.entryLegs!.map((l) => [l.role, l.price, l.quantity, l.sourceLabel, l.at.instantUtc]))
  assert.deepEqual(e.exitLegs, A.exitLegs)
  assert.deepEqual(e.exitSummary, A.exitSummary)
  assert.deepEqual(e.exitLegs!.map((l) => [l.role, l.sizeAfter, l.reason, l.reasonRule]), [["SCALE_OUT", 1, "TARGET", "LABEL_RULE"], ["EXIT", 0, "TARGET", "LABEL_RULE"]])
  assert.equal(e.peakQuantity, 2)
  // saídas simultâneas (mesmo segundo) continuam marcadas
  const sim = runImportPipeline(synthCsv([
    { entryPrice: 2000, exitPrice: 2002, entryAt: "02/02/2026 21:00:00", exitAt: "02/02/2026 21:10:00", exitLabel: "Stop2" },
    { entryPrice: 2000, exitPrice: 2002, entryAt: "02/02/2026 21:00:00", exitAt: "02/02/2026 21:10:00", exitLabel: "Stop3" },
  ]), { sourceTz: BRT })
  const es = ok(explainTrade(sim.trades[0], sim.importRecord as ImportRecord))
  assert.ok(es.tradeEvidence.exitLegs!.every((l) => l.simultaneous === sim.trades[0].exitLegs![0].simultaneous))
  assert.deepEqual(es.tradeEvidence.exitLegs, sim.trades[0].exitLegs)
})

test("EXCURSÕES: conflito e origem preservados; MAE/MFE do ciclo vêm do canonical (nada somado/reinterpretado); sem conflito ⇒ conflict=false", () => {
  for (const [e, t] of [[eA, A], [eD, D], [eE, E]] as const) {
    const x = e.tradeEvidence.excursions
    assert.deepEqual(x, {
      mfePoints: t.excursions.mfePoints, maePoints: t.excursions.maePoints, mfeReason: t.excursions.mfeReason, maeReason: t.excursions.maeReason,
      highPrice: t.excursions.highPrice, lowPrice: t.excursions.lowPrice, conflict: t.excursions.conflict, origin: t.excursions.origin,
    })
  }
  assert.deepEqual([eD.tradeEvidence.excursions.conflict, eD.tradeEvidence.excursions.origin], [true, "RECONSTRUCTED_NT8_ROWS"])
  assert.equal(eE.tradeEvidence.excursions.conflict, false)
  // o extremo mais amplo (MFE 90 USD = 9 pts em 1 contrato), NUNCA a soma 140 USD
  assert.equal(eD.tradeEvidence.excursions.highPrice, 2009)
  assert.ok(eD.tradeEvidence.sourceRows.every((r) => (r.mfeUsd as number) <= 90))
  assert.ok(eD.tradeEvidence.reconstruction!.ambiguities.some((a) => a.code === "EXCURSION_CONFLICT"))
  assert.ok(eD.tradeEvidence.issues.some((i) => i.code === "W_EXCURSION_CONFLICT"))
})

test("INVARIANTES FINANCEIROS: P&L (net/gross/commission/fees/basis), qtd e preços da Evidence = canonical (deep-equal); soma idêntica à do pipeline", () => {
  imp.trades.forEach((t, i) => {
    const e = all[i].tradeEvidence
    assert.deepEqual(e.pnl, t.pnl)
    assert.deepEqual([e.quantity, e.entry.price, e.exit.price, e.direction, e.instrument.root], [t.quantity, t.entry.price, t.exit.price, t.direction, t.instrument.root])
    assert.deepEqual(e.entry.at, t.entry.at)
    assert.deepEqual(e.exit.at, t.exit.at)
    assert.deepEqual(e.issues, t.issues)
    assert.deepEqual(e.fieldProvenance, t.fieldProvenance)
  })
  for (const f of ["net", "gross", "commission", "fees"] as const) {
    assert.equal(cents(all.map((r) => r.tradeEvidence.pnl[f])), cents(imp.trades.map((t) => t.pnl[f])))
  }
})

// ── erros (fail-closed) ──────────────────────────────────────────────────────

test("E_IDENTITY_MISSING: sem tradeId ou sem importId a Evidence é RECUSADA (nenhum id é fabricado)", () => {
  const noTrade = clone(A)
  delete noTrade.tradeId
  const noImport = clone(A)
  delete noImport.importId
  err(explainTrade(noTrade, rec), "E_IDENTITY_MISSING")
  err(explainTrade(noImport, rec), "E_IDENTITY_MISSING")
  // trade vindo direto do construtor, sem passar pelo pipeline de identidade
  const raw = runImportPipeline(CSV, { sourceTz: BRT }).trades[0]
  delete raw.tradeId
  err(explainTrade(raw, rec), "E_IDENTITY_MISSING")
})

test("E_IMPORT_MISMATCH: importId do trade ≠ do ImportRecord, ou reconstrução do trade ≠ a do import", () => {
  err(explainTrade(A, { ...rec, importId: "imp_outro" }), "E_IMPORT_MISMATCH")
  err(explainTrade(A, flat.importRecord as ImportRecord), "E_IMPORT_MISMATCH") // outro import (também outro importId)
  err(explainTrade(A, { ...rec, reconstructionMethod: null, reconstructionVersion: null }), "E_IMPORT_MISMATCH")
})

test("E_ROWREF_DANGLING: perna que aponta para linha ausente em sourceRows", () => {
  const t = clone(A)
  t.exitLegs![0].rowRefs = [999]
  err(explainTrade(t, rec), "E_ROWREF_DANGLING")
  const t2 = clone(A)
  t2.entryLegs![0].rowRefs = [...t2.entryLegs![0].rowRefs, 1234]
  err(explainTrade(t2, rec), "E_ROWREF_DANGLING")
})

test("E_ACCOUNT_KEY_MISMATCH e E_SCHEMA: conta do ciclo divergente / dado fora do contrato", () => {
  const t = clone(A)
  t.reconstruction!.cycleKey.account = "Sim999"
  err(explainTrade(t, rec), "E_ACCOUNT_KEY_MISMATCH")
  const bad = clone(A)
  ;(bad as { direction: string }).direction = "SIDEWAYS"
  err(explainTrade(bad, rec), "E_SCHEMA")
})

test("PROVENIÊNCIA INCOMPLETA é explícita (não erro): linha de ciclo sem rowHash ⇒ INCOMPLETE + nota; rowHash nulo na Evidência", () => {
  const t = clone(A)
  delete t.sourceRows![0].rowHash
  const e = ok(explainTrade(t, rec))
  assert.equal(e.tradeEvidence.provenance, "INCOMPLETE")
  assert.equal(e.tradeEvidence.sourceRows[0].rowHash, null)
  assert.ok(e.notes.some((n) => n.code === "N_ROWHASH_MISSING"))
  const t2 = clone(flat.trades[0])
  delete t2.source.rowHash
  const e2 = ok(explainTrade(t2, flat.importRecord as ImportRecord))
  assert.equal(e2.tradeEvidence.provenance, "INCOMPLETE")
})

// ── privacidade ──────────────────────────────────────────────────────────────

test("PRIVACIDADE (conta): nenhum nome de conta em NENHUM valor/chave de TradeEvidence nem de ImportRef; tudo usa accountRef", () => {
  for (const r of all) {
    assert.equal(findAccountNameLeak({ t: r.tradeEvidence, i: r.importRef }, NAMES), null)
    const blob = JSON.stringify(r)
    assert.ok(!/Sim10[12]/i.test(blob))
    assert.match(r.tradeEvidence.accountRef as string, /^acc_[0-9a-f]{24}$/)
  }
  assert.equal(findAccountNameLeak({ x: "olha Sim101 aqui" }, NAMES), "$.x") // a trava funciona
})

test("PRIVACIDADE (fileName, lista COMPLETA): explainTrades troca as contas do arquivo por accountRef; ImportRef IGUAL em todos os trades", () => {
  const r1 = accountRef("Sim101") as string
  const r2 = accountRef("Sim102") as string
  assert.equal(rec.accountCount, 2) // só a contagem fica no ImportRecord (nunca os nomes)
  assert.equal(eA.importRef.fileName, `${r1}_${r2}-fevereiro.csv`)
  assert.equal(eA.importRef.accountCount, 2)
  assert.ok(all.every((r) => canonicalJson(r.importRef) === canonicalJson(eA.importRef)))
  assert.ok(eA.notes.some((n) => n.code === "N_FILENAME_REDACTED"))
  assert.equal(rec.fileName, FILE) // o original continua só no ImportRecord (proveniência interna)
  // nome de arquivo sem conta: preservado (informação útil de origem), com a lista completa
  const plain = runImportPipeline(CSV, { sourceTz: BRT, fileName: "exportacao-fevereiro.csv" })
  const ep = explainTrades(plain.trades, plain.importRecord as ImportRecord).map(ok)
  assert.ok(ep.every((r) => r.importRef.fileName === "exportacao-fevereiro.csv"))
  assert.ok(!ep[0].notes.some((n) => n.code === "N_FILENAME_REDACTED" || n.code === "N_FILENAME_OMITTED"))
  // sem arquivo ⇒ null (e sem nota: não havia nada a omitir)
  const anon = runImportPipeline(CSV, { sourceTz: BRT })
  const ea = ok(explainTrades(anon.trades, anon.importRecord as ImportRecord)[0] as ExplainTradeResult)
  assert.equal(ea.importRef.fileName, null)
  assert.ok(!ea.notes.some((n) => n.code === "N_FILENAME_OMITTED"))
})

test("PRIVACIDADE (fileName, explainTrade AVULSO): sem a lista completa de contas o fileName é NULL — nunca expõe outra conta", () => {
  // trade da conta Sim101 num arquivo que se chama 'Sim101_Sim102-…': o nome da OUTRA conta (Sim102) estaria no fileName
  for (const r of [explainTrade(A, rec), explainTrade(A, rec, { knownAccountNames: [] }), explainTrade(A, rec, { knownAccountNames: ["Sim101"] })]) {
    const e = ok(r)
    assert.equal(e.importRef.fileName, null)
    assert.ok(e.notes.some((n) => n.code === "N_FILENAME_OMITTED"))
    assert.equal(findAccountNameLeak(e, NAMES), null)
    assert.ok(!JSON.stringify(e).includes("fevereiro"))
  }
  assert.equal(rec.fileName, FILE) // o original segue só no ImportRecord
  // lista completa informada explicitamente ⇒ fileName exposto, redigido
  const full = ok(explainTrade(A, rec, { knownAccountNames: ["Sim101", "Sim102"] }))
  assert.equal(full.importRef.fileName, eA.importRef.fileName)
  // lista com a conta do trade mas de TAMANHO errado (conta a mais ou a menos) não vale
  assert.equal(ok(explainTrade(A, rec, { knownAccountNames: ["Sim101", "Sim102", "Sim103"] })).importRef.fileName, null)
  // lista completa em número mas sem a conta do próprio trade não vale
  assert.equal(ok(explainTrade(A, rec, { knownAccountNames: ["Sim102", "Sim103"] })).importRef.fileName, null)
})

test("PRIVACIDADE (fileName, subconjunto): explainTrades com SÓ ALGUNS trades de um arquivo multi-conta não conhece todas as contas ⇒ fileName null", () => {
  const onlyFirstAccount = explainTrades([A, B, C, D], rec).map(ok)
  assert.ok(onlyFirstAccount.every((r) => r.importRef.fileName === null))
  assert.ok(onlyFirstAccount.every((r) => r.notes.some((n) => n.code === "N_FILENAME_OMITTED")))
  assert.ok(onlyFirstAccount.every((r) => !JSON.stringify(r).includes("Sim102")))
  // completando a lista à mão, volta a expor
  assert.equal(explainTrades([A, B], rec, { knownAccountNames: ["Sim102"] }).map(ok)[0].importRef.fileName, eA.importRef.fileName)
})

test("PRIVACIDADE (fileName, arquivo sem coluna de conta): accountCount=0 ⇒ nada a vazar, fileName preservado mesmo no avulso com lista vazia", () => {
  const noAcc = runImportPipeline(synthCsv(ROWS.slice(0, 2).map((r) => ({ ...r, account: "" }))), { sourceTz: BRT, fileName: "so-estrategia.csv" })
  const nr = noAcc.importRecord as ImportRecord
  assert.equal(nr.accountCount, 0)
  assert.equal(noAcc.trades[0].account.sourceName, null)
  assert.equal(ok(explainTrade(noAcc.trades[0], nr, { knownAccountNames: [] })).importRef.fileName, "so-estrategia.csv")
  assert.equal(ok(explainTrade(noAcc.trades[0], nr)).importRef.fileName, null) // sem informar a lista, continua fail-closed
})

test("accountCount: conta linhas rejeitadas também (a conta de uma linha rejeitada pode estar no nome do arquivo)", () => {
  const lines = CSV.trimEnd().split("\n")
  lines[lines.length - 1] = lines[lines.length - 1].replace("Comprada", "DIRECAO_INVALIDA") // linha da Sim102 rejeitada
  const rej = runImportPipeline(lines.join("\n") + "\n", { sourceTz: BRT, fileName: FILE })
  assert.equal(rej.stats.rejected, 1)
  assert.equal((rej.importRecord as ImportRecord).accountCount, 2) // Sim102 só aparece numa linha rejeitada
  // os trades aceitos só conhecem a Sim101 ⇒ lista incompleta ⇒ fileName omitido (fail-closed)
  assert.ok(explainTrades(rej.trades, rej.importRecord as ImportRecord).map(ok).every((r) => r.importRef.fileName === null))
})

test("redactFileName: sem distinguir caixa; nome curto só como token inteiro; mais longo primeiro", () => {
  const acc = [{ name: "Sim101", ref: "acc_X" }, { name: "A1", ref: "acc_Y" }, { name: "Sim1010", ref: "acc_Z" }]
  assert.equal(redactFileName("sim101-export.csv", acc), "acc_X-export.csv")
  assert.equal(redactFileName("Sim1010.csv", acc), "acc_Z.csv")
  assert.equal(redactFileName("A1.csv", acc), "acc_Y.csv")
  assert.equal(redactFileName("DATA1.csv", acc), "DATA1.csv") // "A1" dentro de outra palavra não é conta
  assert.equal(redactFileName(null, acc), null)
})

test("PRIVACIDADE (trava fail-closed): nome de conta que escape em issues/mensagens/rótulos ⇒ E_ACCOUNT_NAME_LEAK, resultado descartado", () => {
  const t = clone(A)
  t.issues.push({ code: "X", severity: "INFO", message: "conta Sim101 com problema", field: null, rowNo: null })
  const r = err(explainTrade(t, rec), "E_ACCOUNT_NAME_LEAK")
  assert.ok(!("tradeEvidence" in r))
  const t2 = clone(A)
  t2.reconstruction!.ambiguities.push({ code: "Y", severity: "INFO", rowNos: [2], message: "ver Sim102" })
  err(explainTrade(t2, rec, { knownAccountNames: ["Sim102"] }), "E_ACCOUNT_NAME_LEAK")
  const t3 = clone(A)
  t3.entryLegs![0].sourceLabel = "Sim101-entry"
  err(explainTrade(t3, rec), "E_ACCOUNT_NAME_LEAK")
})

test("LISTA BRANCA: campos do Canonical que não foram escolhidos (notes, tags, fileName, fileHash, campo novo) NÃO chegam à Evidência", () => {
  const t = clone(A) as CanonicalTrade & { novoCampoSecreto?: string }
  t.labels.notes = "nota privada do usuário"
  t.labels.tags = ["tag-secreta"]
  t.source.fileName = "interno.csv"
  t.source.fileHash = "hash-do-chamador"
  t.novoCampoSecreto = "valor-secreto"
  const e = ok(explainTrade(t, rec))
  const blob = JSON.stringify(e)
  for (const s of ["nota privada", "tag-secreta", "interno.csv", "hash-do-chamador", "valor-secreto", "novoCampoSecreto"]) assert.ok(!blob.includes(s), s)
  assert.equal(canonicalJson(e.tradeEvidence), canonicalJson(eA.tradeEvidence)) // e a saída é a mesma de antes
})

test("LISTA BRANCA (código): explain-trade.ts e redact.ts não usam spread de trade/source/reconstruction/importRecord", () => {
  for (const f of ["../src/lib/evidence/explain-trade.ts", "../src/lib/evidence/redact.ts"]) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8").replace(/\/\/.*$/gm, "")
    const bad = src.match(/\{\s*\.\.\.(trade|source|rec|importRecord|t|r|l|a|p)\b(?![.\w(])/g)
    assert.equal(bad, null, `${f}: ${bad}`)
  }
})

// ── ImportRef ────────────────────────────────────────────────────────────────

test("IMPORTREF: reaproveita o ImportRecord do E1 (mesmos campos) sem o conteúdo do CSV; importedAt vazio (fora do hash)", () => {
  const { fileName: _a, ...refRest } = eA.importRef
  const { fileName: _b, ...recRest } = rec
  void _a
  void _b
  const { importedAt, ...refNoClock } = refRest
  assert.equal(importedAt, null)
  assert.deepEqual(refNoClock, recRest)
  const blob = JSON.stringify(all)
  assert.ok(!blob.includes("Núm. Neg.") && !blob.includes("Estrategia Teste;Comprada"))
  assert.ok(!blob.includes("21:00:00;"))
})

// ── determinismo ─────────────────────────────────────────────────────────────

test("DETERMINISMO: mesma entrada ⇒ mesma Evidence byte a byte e mesmo evidenceHash; independe de ordem de chaves; sem relógio", () => {
  const again = runImportPipeline(CSV, { sourceTz: BRT, fileName: FILE })
  const e2 = explainTrades(again.trades, again.importRecord as ImportRecord).map(ok)
  assert.equal(canonicalJson(e2.map((r) => r.tradeEvidence)), canonicalJson(all.map((r) => r.tradeEvidence)))
  assert.equal(canonicalJson(e2[0].importRef), canonicalJson(all[0].importRef))
  const mk = (rs: Ok[]) => sealEvidence({ schema: EVIDENCE_SCHEMA, claim: { kind: "TRADE", statement: null }, subject: { type: "TRADE", id: rs[0].tradeEvidence.tradeId }, evidence: { imports: [rs[0].importRef], trades: rs.map((r) => r.tradeEvidence), metrics: [] } })
  assert.equal(mk(e2).evidenceHash, mk(all).evidenceHash)
  // chamar duas vezes o mesmo trade dá o mesmo resultado
  assert.equal(canonicalJson(explainTrade(A, rec)), canonicalJson(explainTrade(A, rec)))
  const src = readFileSync(fileURLToPath(new URL("../src/lib/evidence/explain-trade.ts", import.meta.url)), "utf8").replace(/\/\/.*$/gm, "")
  assert.ok(!/Date\.now|new Date|Math\.random|randomUUID/.test(src))
})

// ── fixtures reais (locais; sem números embutidos) ───────────────────────────

const DIR = fileURLToPath(new URL("../fixtures/ninjatrader/trade-performance", import.meta.url))
const names = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.endsWith(".csv") && existsSync(join(DIR, n.replace(/\.csv$/, ".context.json")))).sort() : []
let realTotal = 0
let realOk = 0
let realDivergences = 0
for (const name of names) {
  const tag = name.replace(/\.csv$/, "")
  const text = readFileSync(join(DIR, name), "utf8")
  const ctx = JSON.parse(readFileSync(join(DIR, `${tag}.context.json`), "utf8")) as ImportContext
  test(`REAL ${tag}: TODOS os trades (ciclos e linhas) explicados com ok=true; tradeId/importId/rowHash idênticos ao pipeline; sem nome de conta; determinístico`, () => {
    const accounts = [...new Set(parseDelimited(text).rows.map((r) => (r.fields["conta"] ?? "").trim()).filter(Boolean))]
    assert.ok(accounts.length > 0, "nenhuma conta lida do CSV — a checagem de privacidade ficaria vazia")
    const fileName = `${accounts[0]}-${tag}.csv`
    for (const [label, run] of [["ciclos", runImportPipeline(text, { ...ctx, fileName })], ["linhas", runImportPipeline(text, { ...ctx, fileName, reconstructCycles: false })]] as const) {
      const record = run.importRecord as ImportRecord
      const results = explainTrades(run.trades, record)
      assert.equal(results.length, run.trades.length, label)
      results.forEach((r, i) => {
        realTotal += 1
        const t = run.trades[i]
        const e = ok(r).tradeEvidence
        realOk += 1
        const hashes = t.granularity === "POSITION_CYCLE" ? t.sourceRows!.map((s) => s.rowHash) : [t.source.rowHash]
        const sameIds = e.tradeId === t.tradeId && e.importId === t.importId && e.importId === record.importId
        const sameHashes = canonicalJson(e.sourceRows.map((s) => s.rowHash)) === canonicalJson(hashes) && e.sourceRows.every((s) => s.rowHash?.length === 64 && s.importId === record.importId)
        if (!sameIds || !sameHashes) realDivergences += 1
        assert.ok(sameIds && sameHashes, `${label}[${i}]`)
        assert.equal(e.provenance, "COMPLETE")
        assert.equal(canonicalJson(e.pnl), canonicalJson(t.pnl))
        assert.equal(e.accountRef, t.account.ref)
      })
      const evid = results.map((r) => ok(r))
      assert.equal(findAccountNameLeak(evid.map((r) => [r.tradeEvidence, r.importRef]), accounts), null, `${label}: nome de conta vazou`)
      assert.ok(evid.every((r) => canonicalJson(r.importRef) === canonicalJson(evid[0].importRef)))
      for (const f of ["net", "gross", "commission", "fees"] as const) assert.equal(cents(evid.map((r) => r.tradeEvidence.pnl[f])), cents(run.trades.map((t) => t.pnl[f])), `${label} ${f}`)
      const again = explainTrades(runImportPipeline(text, { ...ctx, fileName, ...(label === "linhas" ? { reconstructCycles: false } : {}) }).trades, record)
      assert.equal(canonicalJson(again.map((r) => ok(r).tradeEvidence)), canonicalJson(evid.map((r) => r.tradeEvidence)))
    }
  })
}
if (names.length) console.log(`  → fixtures reais: ${realTotal} trades explicados (ciclos + linhas), ${realOk} com ok=true, ${realDivergences} divergência(s) em tradeId/importId/rowHash`)

console.log(`\n${passed} testes ok`)
