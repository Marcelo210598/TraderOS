// Aba "Origem (E5b)" do Evidence Lab: roda `verifyEvidenceSource` (e `verifyEvidence`, que é independente) de VERDADE sobre cenários SINTÉTICOS.
// NADA aqui verifica, hasheia ou lê CSV por conta própria: os estados vêm das funções reais; as tabelas "declarado × reingestão" só
// mostram valores que o pipeline real produziu. Sem banco/Prisma, sem fixtures reais, sem endpoint, sem persistir bytes; recusa fora de
// NODE_ENV=development. Os bytes do CSV (inventado) nunca são devolvidos à página: só metadados (tamanho, SHA-256, BOM, quebra de linha).

import type { CanonicalTrade } from "../../domain/canonical.ts"
import { computeEvidenceHash } from "../../evidence/hash.ts"
import type { EvidenceBundle } from "../../evidence/schema.ts"
import { verifyEvidence, type VerifyReport } from "../../evidence/verify.ts"
import { decodeSourceBytes, sourceContextOf, verifyEvidenceSource, type SourceStatus, type SourceVerifyReport, type VerifySourceOptions } from "../../evidence/verify-source.ts"
import { describeText } from "../../ingest/identity.ts"
import { runImportPipeline } from "../../ingest/pipeline.ts"
import { DEFAULT_PARSERS } from "../../ingest/registry.ts"
import { assertEvidenceLabEnabled } from "./guard.ts"
import { buildBundle, buildDemo, type Demo } from "./model.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export interface SourceContext {
  demo: Demo
  /** Bytes do CSV sintético (ficam no servidor; nunca vão para a página). */
  bytes: Uint8Array
  /** Bundle íntegro de `netPnl` (população completa). */
  base: EvidenceBundle
  /** Bundle íntegro de `largestWinner` com limite 3 (HASH_ONLY, só âncoras). */
  hashOnly: EvidenceBundle
}

interface Made {
  bundle: unknown
  files: Record<string, Uint8Array>
  options?: VerifySourceOptions
}

export interface SourceScenario {
  id: string
  title: string
  what: string
  /** O que o contrato prevê (metadado para o Lab acusar divergência; o status mostrado é sempre o real). */
  expected: SourceStatus
  expectedNote: string
  make: (c: SourceContext) => Made
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const reseal = (b: Any): Any => {
  try {
    return { ...b, evidenceHash: computeEvidenceHash(b) }
  } catch {
    return b
  }
}
const edit = (b: EvidenceBundle, fn: (x: Any) => void): Any => {
  const c = clone(b) as Any
  fn(c)
  return reseal(c)
}
const enc = (s: string) => new TextEncoder().encode(s)
const importIdOf = (b: EvidenceBundle) => b.evidence.imports[0].importId

function replaceInCsv(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const text = decodeSourceBytes(bytes) as string
  const at = text.indexOf(from)
  if (at < 0) throw new Error(`Lab: trecho ${JSON.stringify(from)} não existe no CSV sintético`)
  return enc(text.slice(0, at) + to + text.slice(at + from.length))
}

export const SOURCE_SCENARIOS: SourceScenario[] = [
  {
    id: "intact",
    title: "Arquivo original íntegro",
    what: "O bundle de netPnl e os bytes exatos do CSV sintético de onde ele saiu.",
    expected: "SOURCE_VERIFIED",
    expectedNote: "Arquivo, importId, rowHash, tradeId e valores derivados do arquivo conferem; a população declarada inteira está listada.",
    make: (c) => ({ bundle: c.base, files: { [importIdOf(c.base)]: c.bytes } }),
  },
  {
    id: "byte",
    title: "Arquivo alterado em UM byte",
    what: "Um único byte do rótulo de saída (Target1 → Uarget1) é trocado no CSV entregue ao verificador.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "V5.file: o SHA-256 dos bytes não é o registrado. O resto não é executado como se o arquivo fosse o original.",
    make: (c) => ({ bundle: c.base, files: { [importIdOf(c.base)]: replaceInCsv(c.bytes, "Target1", "Uarget1") } }),
  },
  {
    id: "cell",
    title: "CSV com uma célula financeira modificada",
    what: "O preço de saída do primeiro trade (2004,0) vira 2009,0 no CSV entregue. O bundle é o original.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "V5.file: o arquivo mudou. Quem corrige uma célula 'a mão' no CSV é denunciado pelo SHA-256 registrado.",
    make: (c) => ({ bundle: c.base, files: { [importIdOf(c.base)]: replaceInCsv(c.bytes, "2004,0", "2009,0") } }),
  },
  {
    id: "hash",
    title: "Hash de arquivo divergente no bundle",
    what: "O fileSha256 do ImportRef é trocado por outro valor e o selo é recalculado; o CSV entregue é o original.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "V5.file: o SHA-256 dos bytes ≠ o registrado. O verifyEvidence (V0–V4) não lê o arquivo e não percebe.",
    make: (c) => ({ bundle: edit(c.base, (x) => (x.evidence.imports[0].fileSha256 = "0".repeat(64))), files: { [importIdOf(c.base)]: c.bytes } }),
  },
  {
    id: "importid",
    title: "importId divergente",
    what: "O importId é trocado por outro, de forma consistente em todo o bundle (selo recalculado); o CSV entregue é o original.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "V5.import-id: a reingestão reconstrói o importId pela função canônica e ele não é o declarado.",
    make: (c) => {
      const fake = `imp_${"0".repeat(32)}`
      const forged = edit(c.base, (x) => Object.assign(x, JSON.parse(JSON.stringify(x).split(importIdOf(c.base)).join(fake))))
      return { bundle: forged, files: { [fake]: c.bytes } }
    },
  },
  {
    id: "rowhash",
    title: "rowHash divergente",
    what: "O rowHash de uma linha de origem é trocado no TradeEvidence (selo recalculado); o CSV é o original.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "V5.rows: a linha existe, mas o conteúdo dela não corresponde ao hash registrado. (O V3 também acusa: o tradeSetHash declarado não fecha.)",
    make: (c) => ({ bundle: edit(c.base, (x) => (x.evidence.trades[2].sourceRows[0].rowHash = "f".repeat(64))), files: { [importIdOf(c.base)]: c.bytes } }),
  },
  {
    id: "tradeid",
    title: "tradeId divergente",
    what: "O tradeId de um trade é trocado por outro (selo recalculado); o CSV é o original.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "V5.trades: a reingestão não produz esse tradeId (id alterado ou composição diferente). Não há id substituto nem deduplicação.",
    make: (c) => ({ bundle: edit(c.base, (x) => (x.evidence.trades[1].tradeId = `trd_${"a".repeat(32)}`)), files: { [importIdOf(c.base)]: c.bytes } }),
  },
  {
    id: "forged",
    title: "Bundle forjado: P&L alterado e selo recalculado",
    what: "O P&L de um trade é alterado no dado e o bundle é REGENERADO com as funções reais (trade, tradeSetHash, valor, selo): internamente coerente. O CSV entregue é o original.",
    expected: "SOURCE_MISMATCH",
    expectedNote: "O verifyEvidence acha tudo consistente (VALID: é o limite do E5). Só a reingestão do arquivo denuncia: rowHash e tradeId continuam os do CSV, mas o P&L não é o que o arquivo produz (V5.values).",
    make: (c) => {
      const forgedDemo = buildDemo((ts: CanonicalTrade[]) => ts.map((t, i) => (i === 0 ? ({ ...t, pnl: { ...t.pnl, net: (t.pnl.net ?? 0) + 100, gross: (t.pnl.gross ?? 0) + 100 } } as CanonicalTrade) : t)))
      const b = buildBundle(forgedDemo, { metricId: "netPnl", view: { pnl: "NET", r: "NET" } })
      if (!b.ok) throw new Error(`Lab: bundle forjado recusado (${b.code})`)
      return { bundle: b.bundle, files: { [importIdOf(b.bundle)]: c.bytes } }
    },
  },
  {
    id: "partial",
    title: "População parcial (HASH_ONLY)",
    what: "largestWinner com tradeIdsLimit = 3: só o tradeSetHash e as âncoras estão no bundle. O CSV é o original.",
    expected: "SOURCE_VERIFIED_PARTIAL",
    expectedNote: "As referências PRESENTES (âncoras) conferem com o arquivo, mas a população completa NÃO está no bundle e não foi conferida. Não é SOURCE_VERIFIED.",
    make: (c) => ({ bundle: c.hashOnly, files: { [importIdOf(c.hashOnly)]: c.bytes } }),
  },
  {
    id: "no-file",
    title: "Arquivo original não fornecido",
    what: "Nenhum arquivo é entregue ao verificador.",
    expected: "UNVERIFIABLE",
    expectedNote: "V5.file: S_SOURCE_NOT_PROVIDED. Indisponibilidade de dados NÃO é adulteração: nada falhou, nada foi verificado.",
    make: (c) => ({ bundle: c.base, files: {} }),
  },
  {
    id: "version",
    title: "Versão do parser incompatível",
    what: "O registro de parsers atual tem outra versão do parser NT8 PT-BR que a usada na importação. O CSV é o original.",
    expected: "UNVERIFIABLE",
    expectedNote: "V5.context: S_VERSION_INCOMPATIBLE. O arquivo ainda é conferido (SHA-256), mas a identidade não é reproduzível com outra versão — e isso não é adulteração.",
    make: (c) => ({
      bundle: c.base,
      files: { [importIdOf(c.base)]: c.bytes },
      options: { parsers: DEFAULT_PARSERS.map((p) => (p.id === c.base.evidence.imports[0].parserId ? { ...p, version: "99.0.0" } : p)) },
    }),
  },
]

export function sourceContext(demo: Demo): SourceContext {
  assertEvidenceLabEnabled()
  const base = buildBundle(demo, { metricId: "netPnl", view: { pnl: "NET", r: "NET" } })
  const hashOnly = buildBundle(demo, { metricId: "largestWinner", view: { pnl: "NET", r: "NET" }, tradeIdsLimit: 3 })
  if (!base.ok) throw new Error(`Lab: bundle base do E5b recusado (${base.code})`)
  if (!hashOnly.ok) throw new Error(`Lab: bundle HASH_ONLY do E5b recusado (${hashOnly.code})`)
  return { demo, bytes: new TextEncoder().encode(demo.csv), base: base.bundle, hashOnly: hashOnly.bundle }
}

export interface FileFacts {
  provided: boolean
  /** Metadados calculados por `describeText` (a função real do E1). Nunca o conteúdo. */
  facts: { bytes: number; sha256: string; hasBom: boolean; lineEnding: string } | null
  utf8Valid: boolean
}

export interface Reingestion {
  parser: string
  rowsRead: number
  rowsAccepted: number
  rowsRejected: number
  tradesProduced: number
  importId: string
  /** rowNo → rowHash, só das linhas aceitas. */
  rowHashes: Record<number, string>
  tradeIds: string[]
}

export interface SourceRun {
  scenario: SourceScenario
  bundle: unknown
  report: SourceVerifyReport
  /** verifyEvidence (V0–V4) sobre o MESMO bundle: independente do E5b. */
  verify: VerifyReport
  file: FileFacts
  /** Reexecução mostrada só quando o verificador a executou (V5.context PASS); é a mesma `runImportPipeline` com o contexto do ImportRef. */
  reingestion: Reingestion | null
  matchesContract: boolean
}

export function runSourceScenario(ctx: SourceContext, scenario: SourceScenario): SourceRun {
  assertEvidenceLabEnabled()
  const made = scenario.make(ctx)
  const report = verifyEvidenceSource(made.bundle, made.files, made.options)
  const verify = verifyEvidence(made.bundle)

  const bundle = made.bundle as Any
  const imp = bundle?.evidence?.imports?.[0] as Any
  const given = imp ? made.files[imp.importId] : undefined
  const text = given ? decodeSourceBytes(given) : null
  const d = text !== null ? describeText(text) : null
  const file: FileFacts = {
    provided: given !== undefined,
    facts: d && given ? { bytes: given.length, sha256: d.fileSha256, hasBom: d.hasBom, lineEnding: d.lineEnding } : null,
    utf8Valid: text !== null,
  }

  let reingestion: Reingestion | null = null
  if (text !== null && imp && report.checks.find((c) => c.id === "V5.context")?.status === "PASS") {
    const run = runImportPipeline(text, sourceContextOf(imp, made.options ?? {}), made.options?.parsers)
    if (run.importRecord) {
      const rowHashes: Record<number, string> = {}
      for (const t of run.rowTrades) if (t.source.rowNo !== null && t.source.rowHash) rowHashes[t.source.rowNo] = t.source.rowHash
      reingestion = {
        parser: `${run.importRecord.parserId}@${run.importRecord.parserVersion}`,
        rowsRead: run.stats.rowsRead,
        rowsAccepted: run.stats.accepted,
        rowsRejected: run.stats.rejected,
        tradesProduced: run.trades.length,
        importId: run.importRecord.importId,
        rowHashes,
        tradeIds: run.trades.map((t) => t.tradeId as string),
      }
    }
  }
  return { scenario, bundle: made.bundle, report, verify, file, reingestion, matchesContract: report.status === scenario.expected }
}

export function runAllSourceScenarios(ctx: SourceContext): SourceRun[] {
  assertEvidenceLabEnabled()
  return SOURCE_SCENARIOS.map((s) => runSourceScenario(ctx, s))
}
