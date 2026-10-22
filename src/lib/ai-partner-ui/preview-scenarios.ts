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
const answer = (segments: unknown[], banner: Verdict | null, stopReason: "REGEN_EXHAUSTED" | null = null, outcome: "ANSWERED" | "STOPPED" = "ANSWERED", layout?: unknown): ChatReply => ({
  ok: true, conversationId: "preview-conv", outcome,
  response: { segments, banner: banner === null ? { combined: null, label: "" } : BANNER[banner], stopReason, ...(layout === undefined ? {} : { layout }) },
  usage: { used: 4, limit: 100, remaining: 96 },
})

const IMPORT: ImportRow = { fileSha256: "a".repeat(64), importId: "imp-1", fileName: "trades-setembro.csv", fileBytes: 182_431, createdAt: "2026-10-18T14:20:00.000Z" }
const fail = (code: string, extra: { retryAfterSec?: number; suggestedPlan?: "TRADER" | "PRO" } = {}): Failure => ({ ok: false, code, ...extra })

const GROUPS = Array.from({ length: 12 }, (_, i) => [text(`Hora ${String(9 + (i % 8)).padStart(2, "0")}h, conta Sim10${(i % 2) + 1}: `), value(`R$ ${(120 + i * 37).toLocaleString("pt-BR")},00`, "VERIFIED"), text(` em ${10 + i} trades.`)]).flat()


// ── E7-20: respostas em cartões e tabelas (dados reais dos prints do teste logado) ──
const COMB: Record<string, string> = { verified: "VERIFIED", partial: "VERIFIED_PARTIAL", unverified: "NOT_VERIFIED", mismatch: "TAMPERED_OR_MISMATCH" }
const c = (text: string, verdict = "verified", note: string | null = null) => ({ text, combined: COMB[verdict], note })
const line = (...parts: Array<string | ReturnType<typeof c>>) => ({ kind: "line", parts: parts.map((p) => (typeof p === "string" ? { text: p } : { cell: p })) })
const PERIOD = line("Período: ", c("24/09/2026"), " a ", c("01/10/2026"))
const NA_ORD = "sem ordens registradas", NA_TRD = "sem trades nesse motivo"
const FALLBACK = [text("Resposta em texto corrido (use o layout).")]
const LAYOUT_QUERY = { blocks: [
  { kind: "title", text: "Resultado no período" },
  PERIOD,
  { kind: "stats", items: [
    { label: "Resultado após custos", help: "Soma dos ganhos e perdas de todos os trades, já descontadas corretagem e taxas.", cell: c("-US$ 1.041,90") },
    { label: "Taxa de acerto", help: "De cada 100 trades, quantos fecharam no positivo. Aqui, 5 de 15.", cell: c("33,33%") },
  ] },
  { kind: "note", tone: "info", text: "Um “trade” é uma posição do início ao fim (entrada até zerar). Por isso as 27 linhas do arquivo viram 15 trades." },
  { kind: "note", tone: "caveat", text: "Amostra pequena (15 trades): leia como indicativo, não como conclusão." },
] }
const LAYOUT_GROUPS = { blocks: [
  { kind: "title", text: "Resultado por conta" },
  PERIOD,
  { kind: "table", caption: null,
    columns: [{ label: "Trades", help: null }, { label: "Resultado após custos", help: null }, { label: "Taxa de acerto", help: "Percentual de trades positivos." }, { label: "Trade médio", help: "Resultado médio por trade." }, { label: "Fator de lucro", help: "Total ganho ÷ total perdido. Acima de 1,00 = ganhou mais do que perdeu." }],
    rows: [
      { label: "Conta A", tag: "amostra pequena", cells: [c("8"), c("-US$ 544,50"), c("25,00%"), c("-US$ 68,06"), c("0,4430")] },
      { label: "Conta B", tag: "amostra pequena", cells: [c("7"), c("-US$ 497,40"), c("42,86%"), c("-US$ 71,06"), c("0,2132")] },
    ] },
  { kind: "note", tone: "caveat", text: "Cada conta tem poucos trades: o resultado é indicativo, não conclusivo." },
] }
const exitRows = (legs: boolean) => legs
  ? [["alvo", c("0"), c("—", "verified", NA_ORD), c("—", "verified", NA_ORD)], ["stop", c("6"), c("-US$ 566,60"), c("54,38%")], ["manual", c("6"), c("US$ 69,20"), c("-6,64%")], ["desconhecido", c("11"), c("-US$ 544,50"), c("52,26%")]]
  : [["alvo", c("0"), c("—", "verified", NA_TRD), c("—", "verified", NA_TRD)], ["stop", c("3"), c("-US$ 566,60"), c("54,38%")], ["manual", c("4"), c("US$ 69,20"), c("-6,64%")], ["misto", c("0"), c("—", "verified", NA_TRD), c("—", "verified", NA_TRD)], ["desconhecido", c("8"), c("-US$ 544,50"), c("52,26%")]]
const LAYOUT_EXITS = { blocks: [
  { kind: "title", text: "Saídas por motivo" },
  PERIOD,
  { kind: "table", caption: "Por ordem de saída (perna)", columns: [{ label: "Saídas", help: "Quantas ordens de saída fecharam por esse motivo." }, { label: "Resultado após custos", help: null }, { label: "Participação", help: "Parcela do resultado total que veio desse motivo." }],
    rows: exitRows(true).map(([label, ...cells]) => ({ label, tag: null, cells })) },
  { kind: "table", caption: "Por trade (posição inteira)", columns: [{ label: "Trades", help: "Quantas posições terminaram por esse motivo." }, { label: "Resultado após custos", help: null }, { label: "Participação", help: null }],
    rows: exitRows(false).map(([label, ...cells]) => ({ label, tag: null, cells })) },
  { kind: "note", tone: "info", text: "Conciliação: os números por motivo fecham com o resultado total do arquivo." },
  { kind: "note", tone: "info", text: "“Desconhecido” = o arquivo não informa por qual ordem a posição foi encerrada." },
] }
const LAYOUT_EXTREMES = { blocks: [
  { kind: "title", text: "Maior ganho e maior perda" },
  PERIOD,
  { kind: "stats", items: [
    { label: "Maior ganho em um trade", help: null, cell: c("US$ 267,00") },
    { label: "Maior perda em um trade", help: null, cell: c("-US$ 336,00") },
    { label: "Peso do maior ganho", help: "Quanto do total de ganhos veio só do melhor trade.", cell: c("47,02%") },
    { label: "Peso dos principais ganhos", help: "Quanto do total de ganhos veio dos melhores trades somados.", cell: c("92,80%") },
  ] },
  { kind: "note", tone: "caveat", text: "Ganhos muito concentrados em poucos trades: o resultado depende de poucas operações." },
] }
const LAYOUT_MIXED = { blocks: [
  { kind: "title", text: "Drawdown máximo" },
  PERIOD,
  { kind: "stats", items: [
    { label: "Maior queda do saldo", help: "Maior distância entre um pico do saldo e o fundo seguinte.", cell: c("US$ 1.041,90", "partial") },
    { label: "Em múltiplos de risco (R)", help: null, cell: c("—", "verified", "o risco (R) não está nos seus trades") },
    { label: "Fator de recuperação", help: null, cell: c("-1,0000", "unverified") },
  ] },
] }

export interface Scenario {
  readonly id: string
  readonly label: string
  readonly imports: readonly ImportRow[]
  readonly reply: (question: string) => ChatReply | Failure
}
const PLAIN = (r: ChatReply | Failure) => () => r

export const SCENARIOS: readonly Scenario[] = [
  { id: "L-query", label: "Layout · resultado e taxa de acerto", imports: [IMPORT], reply: PLAIN(answer(FALLBACK, "VERIFIED", null, "ANSWERED", LAYOUT_QUERY)) },
  { id: "L-groups", label: "Layout · resultado por conta (tabela)", imports: [IMPORT], reply: PLAIN(answer(FALLBACK, "VERIFIED", null, "ANSWERED", LAYOUT_GROUPS)) },
  { id: "L-exits", label: "Layout · saídas por motivo (2 tabelas)", imports: [IMPORT], reply: PLAIN(answer(FALLBACK, "VERIFIED", null, "ANSWERED", LAYOUT_EXITS)) },
  { id: "L-extremes", label: "Layout · maior ganho e perda", imports: [IMPORT], reply: PLAIN(answer(FALLBACK, "VERIFIED", null, "ANSWERED", LAYOUT_EXTREMES)) },
  { id: "L-mixed", label: "Layout · selos mistos e indisponível", imports: [IMPORT], reply: PLAIN(answer(FALLBACK, "VERIFIED_PARTIAL", null, "ANSWERED", LAYOUT_MIXED)) },
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
