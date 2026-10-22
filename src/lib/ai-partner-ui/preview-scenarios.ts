// Tela do AI Partner (E7-15e, D-U1): cenários da prévia `/dev/ai-partner` com transporte FALSO. Nenhum fetch, nenhum dado real: respostas fixas no mesmo formato do servidor (RenderedAnswer),
// para ver a tela em todos os estados sem login nem backend. Só a página de desenvolvimento importa este arquivo.
import type { ChatReply, Failure, ImportRow, Transport } from "./transport.ts"

type Verdict = "VERIFIED" | "VERIFIED_PARTIAL" | "NOT_VERIFIED" | "TAMPERED_OR_MISMATCH"
const text = (t: string) => ({ kind: "text", text: t })
const value = (t: string, combined: Verdict, mode: "ASSERT" | "LABELED" = combined === "VERIFIED" || combined === "VERIFIED_PARTIAL" ? "ASSERT" : "LABELED") => ({ kind: "value", text: t, combined, mode })
const phrase = (code: string, t: string) => ({ kind: "phrase", code, text: t })
const BANNER: Record<Verdict, { combined: Verdict; label: string }> = {
  VERIFIED: { combined: "VERIFIED", label: "Verificado" },
  VERIFIED_PARTIAL: { combined: "VERIFIED_PARTIAL", label: "Verificado parcialmente" },
  NOT_VERIFIED: { combined: "NOT_VERIFIED", label: "Não verificado" },
  TAMPERED_OR_MISMATCH: { combined: "TAMPERED_OR_MISMATCH", label: "Não confere" },
}
const answer = (segments: unknown[], banner: Verdict | null, stopReason: "REGEN_EXHAUSTED" | null = null, outcome: "ANSWERED" | "STOPPED" = "ANSWERED"): ChatReply => ({
  ok: true, conversationId: "preview-conv", outcome,
  response: { segments, banner: banner === null ? { combined: null, label: "" } : BANNER[banner], stopReason },
  usage: { used: 4, limit: 100, remaining: 96 },
})

const IMPORT: ImportRow = { fileSha256: "a".repeat(64), importId: "imp-1", fileName: "trades-setembro.csv", fileBytes: 182_431, createdAt: "2026-10-18T14:20:00.000Z" }
const fail = (code: string, extra: { retryAfterSec?: number; suggestedPlan?: "TRADER" | "PRO" } = {}): Failure => ({ ok: false, code, ...extra })

const GROUPS = Array.from({ length: 12 }, (_, i) => [text(`Hora ${String(9 + (i % 8)).padStart(2, "0")}h, conta Sim10${(i % 2) + 1}: `), value(`R$ ${(120 + i * 37).toLocaleString("pt-BR")},00`, "VERIFIED"), text(` em ${10 + i} trades.`)]).flat()

export interface Scenario {
  readonly id: string
  readonly label: string
  readonly imports: readonly ImportRow[]
  readonly reply: (question: string) => ChatReply | Failure
}
const PLAIN = (r: ChatReply | Failure) => () => r

export const SCENARIOS: readonly Scenario[] = [
  { id: "verified", label: "Verificado", imports: [IMPORT], reply: PLAIN(answer([text("Seu resultado no período foi "), value("R$ 1.284,50", "VERIFIED"), text(" com taxa de acerto de "), value("54,2%", "VERIFIED"), text(".")], "VERIFIED")) },
  { id: "partial", label: "Verificado parcialmente", imports: [IMPORT], reply: PLAIN(answer([text("Resultado: "), value("R$ 940,00", "VERIFIED_PARTIAL"), phrase("PARTIAL_COVERAGE", "Parte dos trades não pôde ser conferida com a fonte.")], "VERIFIED_PARTIAL")) },
  { id: "unverified", label: "Não verificado", imports: [IMPORT], reply: PLAIN(answer([text("Drawdown máximo: "), value("R$ 2.310,00", "NOT_VERIFIED"), phrase("NOT_VERIFIED", "Este valor não passou pela conferência independente.")], "NOT_VERIFIED")) },
  { id: "mismatch", label: "Não confere (adulterado)", imports: [IMPORT], reply: PLAIN(answer([text("Não exibo números desta resposta: a conferência detectou divergência."), value("R$ 0,00", "TAMPERED_OR_MISMATCH")], "TAMPERED_OR_MISMATCH")) },
  { id: "indicative", label: "Indicativo (amostra pequena)", imports: [IMPORT], reply: PLAIN(answer([text("Taxa de acerto de segunda a sexta: "), value("62,5%", "VERIFIED"), phrase("INDICATIVE", "Resultado indicativo, não conclusivo.")], "VERIFIED")) },
  { id: "offscope", label: "Fora de escopo", imports: [IMPORT], reply: PLAIN(answer([text("Só analiso os dados de trades que você importou. Reformule a pergunta sobre eles.")], null)) },
  { id: "stopped", label: "Resposta interrompida", imports: [IMPORT], reply: PLAIN(answer([text("Não consegui montar uma resposta confiável para essa pergunta.")], null, "REGEN_EXHAUSTED", "STOPPED")) },
  { id: "long", label: "Lista longa", imports: [IMPORT], reply: PLAIN(answer([...GROUPS, phrase("CUT", "Mostrando só os primeiros grupos; refine o filtro para ver o resto.")], "VERIFIED")) },
  { id: "noimports", label: "Sem importação", imports: [], reply: PLAIN(fail("NO_IMPORTS")) },
  { id: "quota", label: "Cota esgotada", imports: [IMPORT], reply: PLAIN(fail("QUOTA_EXCEEDED", { suggestedPlan: "PRO" })) },
  { id: "pool", label: "Teste gratuito esgotado", imports: [IMPORT], reply: PLAIN(fail("FREE_POOL_EXHAUSTED")) },
  { id: "busy", label: "Ocupado (tentar de novo)", imports: [IMPORT], reply: PLAIN(fail("BUSY", { retryAfterSec: 8 })) },
  { id: "unavailable", label: "Modelo indisponível", imports: [IMPORT], reply: PLAIN(fail("MODEL_UNAVAILABLE")) },
  { id: "full", label: "Conversa cheia", imports: [IMPORT], reply: PLAIN(fail("CONVERSATION_FULL")) },
  { id: "error", label: "Erro de armazenamento", imports: [IMPORT], reply: PLAIN(fail("STORAGE_ERROR")) },
]

export const scenarioById = (id: unknown): Scenario => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]

/** Transporte falso de um cenário. `delayMs` simula a espera do modelo (mostra o estado "analisando"). Upload/remoção só mexem na lista em memória. */
export function createFakeTransport(scenario: Scenario, delayMs = 700): Transport {
  let imports: ImportRow[] = [...scenario.imports]
  const wait = () => new Promise<void>((r) => setTimeout(r, delayMs))
  return {
    async sendChat({ question }) { await wait(); return scenario.reply(question) },
    async listImports() { return { ok: true, imports: [...imports], usage: {} } },
    async uploadImport(file) {
      await wait()
      const n = imports.length + 1
      imports = [{ fileSha256: n.toString(16).padStart(64, "b"), importId: `imp-${n}`, fileName: file.name, fileBytes: file.size, createdAt: new Date().toISOString() }, ...imports]
      return { ok: true, created: true }
    },
    async deleteImport(sha) { imports = imports.filter((i) => i.fileSha256 !== sha); return { ok: true } },
  }
}
