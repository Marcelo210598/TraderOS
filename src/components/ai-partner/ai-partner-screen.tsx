"use client"

// Tela do AI Partner (E7-15e). Apresentação pura: recebe um `transport` (HTTP na página real, falso na prévia) e só renderiza NÓS DE TEXTO do React —
// nada da resposta vira HTML, link ou atributo (D-U4). Estado da conversa = reducer puro de `lib/ai-partner-ui/chat-state`.
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react"
import Link from "next/link"
import { canSend, chatReducer, initialChatState, MAX_QUESTION_CHARS, pendingConversationId, pendingQuestion } from "@/lib/ai-partner-ui/chat-state"
import { errorView, type ErrorView } from "@/lib/ai-partner-ui/errors"
import type { ImportRow, Transport } from "@/lib/ai-partner-ui/transport"
import { introState } from "@/lib/ai-partner-ui/layout"
import { AnswerLayoutView } from "./answer-layout"
import { HELP_ITEMS, SUGGESTIONS, isNoDataReply } from "@/lib/ai-partner-ui/help"
import type { AnswerView, DisplayBlock, Verdict } from "@/lib/ai-partner-ui/view"

const VERDICT_STYLE: Record<Verdict, { glyph: string; cls: string }> = {
  verified: { glyph: "✓", cls: "border-profit/40 bg-profit/10 text-profit" },
  partial: { glyph: "◐", cls: "border-gold/40 bg-gold/10 text-gold" },
  unverified: { glyph: "?", cls: "border-border bg-muted text-muted-foreground" },
  mismatch: { glyph: "✕", cls: "border-loss/40 bg-loss/10 text-loss" },
}

const fmtBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
}

function ValueChip({ block }: { block: Extract<DisplayBlock, { kind: "value" }> }) {
  const s = VERDICT_STYLE[block.verdict]
  return (
    <span className={`mx-0.5 inline-flex items-baseline gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 align-baseline text-[0.95em] font-semibold tabular-nums ${s.cls}`}>
      {block.text}
      <span className="text-[0.7em] font-medium uppercase tracking-wide opacity-90"><span aria-hidden="true">{s.glyph} </span>{block.verdictLabel}</span>
    </span>
  )
}

function AnswerBody({ view, prior }: { view: AnswerView; prior: readonly AnswerView[] }) {
  const { showIntro, seenNotes } = introState(prior)
  const notes = view.blocks.filter((b): b is Extract<DisplayBlock, { kind: "note" }> => b.kind === "note")
  const flow = view.blocks.filter((b) => b.kind !== "note")
  const banner = view.banner ? (
    <div className="space-y-1">
      <p className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${VERDICT_STYLE[view.banner.verdict].cls}`}>
        <span aria-hidden="true">{VERDICT_STYLE[view.banner.verdict].glyph}</span>{view.banner.label}
      </p>
      {view.layout && showIntro && view.banner.verdict === "verified" ? <p className="text-xs text-muted-foreground">Todos os valores foram recalculados de forma independente a partir do seu arquivo.</p> : null}
    </div>
  ) : null
  if (view.layout) {
    return (
      <div className="space-y-3">
        {banner}
        <AnswerLayoutView layout={view.layout} hideNotes={seenNotes} />
        {notes.length > 0 ? <ul className="space-y-1 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">{notes.map((n, i) => <li key={i}>{n.text}</li>)}</ul> : null}
        {view.stopped ? <p className="text-xs text-muted-foreground">A resposta foi interrompida por segurança. Reformule a pergunta.</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {banner}
      <p className="whitespace-pre-line break-words leading-relaxed text-foreground">
        {flow.map((b, i) => (b.kind === "value" ? <ValueChip key={i} block={b} /> : <span key={i}>{b.kind === "text" ? b.text : ""}</span>))}
      </p>
      {notes.length > 0 ? (
        <ul className="space-y-1 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {notes.map((n, i) => <li key={i}>{n.text}</li>)}
        </ul>
      ) : null}
      {view.stopped ? <p className="text-xs text-muted-foreground">A resposta foi interrompida por segurança. Reformule a pergunta.</p> : null}
    </div>
  )
}

function HelpList() {
  return (
    <dl className="space-y-2.5 text-sm">
      {HELP_ITEMS.map((h) => (
        <div key={h.title}>
          <dt className="font-medium text-foreground">{h.title}</dt>
          <dd className="text-muted-foreground">{h.text}</dd>
        </div>
      ))}
    </dl>
  )
}

function Suggestions({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((q) => (
        <button key={q} type="button" disabled={disabled} onClick={() => onPick(q)}
          className="min-h-9 rounded-full border border-border bg-background px-3 py-1 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
          {q}
        </button>
      ))}
    </div>
  )
}

function ErrorNotice({ error, onRetry, onNew, onImport }: { error: ErrorView; onRetry: () => void; onNew: () => void; onImport: () => void }) {
  const [left, setLeft] = useState(error.action.kind === "retry" ? error.action.afterSec : 0)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  const btn = "inline-flex min-h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
  const a = error.action
  return (
    <div role="alert" className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm">
      <p className="text-foreground">{error.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {a.kind === "retry" ? <button type="button" className={btn} disabled={left > 0} onClick={onRetry}>{left > 0 ? `Tentar de novo em ${left} s` : "Tentar de novo"}</button> : null}
        {a.kind === "upgrade" ? <Link href="/planos" className={btn}>{a.suggestedPlan === "PRO" ? "Ver plano Pro" : a.suggestedPlan === "TRADER" ? "Ver plano Trader" : "Ver planos"}</Link> : null}
        {a.kind === "import" ? <button type="button" className={btn} onClick={onImport}>Enviar arquivo</button> : null}
        {a.kind === "newConversation" ? <button type="button" className={btn} onClick={onNew}>Nova conversa</button> : null}
      </div>
    </div>
  )
}

export function AiPartnerScreen({ transport }: { transport: Transport }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const [draft, setDraft] = useState("")
  const [imports, setImports] = useState<ImportRow[] | null>(null)
  const [importError, setImportError] = useState<ErrorView | null>(null)
  const [busyUpload, setBusyUpload] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const counterId = useId()

  const applyList = useCallback((r: Awaited<ReturnType<Transport["listImports"]>>) => {
    if (r.ok) { setImports(r.imports); setImportError(null) } else { setImports((p) => p ?? []); setImportError(errorView(r.code, { retryAfterSec: r.retryAfterSec, scope: "imports" })) }
  }, [])
  const refreshImports = useCallback(async () => { applyList(await transport.listImports()) }, [transport, applyList])
  useEffect(() => {
    let alive = true
    void transport.listImports().then((r) => { if (alive) applyList(r) })
    return () => { alive = false }
  }, [transport, applyList])

  // Turno: quando o reducer marca `pending`, dispara UMA chamada ao transporte e devolve o desfecho ao reducer.
  useEffect(() => {
    if (!state.pending) return
    const question = pendingQuestion(state)
    if (question === null) return
    let alive = true
    void transport.sendChat({ question, conversationId: pendingConversationId(state) }).then((r) => {
      if (!alive) return
      if (r.ok) dispatch({ type: "reply", reply: r })
      else dispatch({ type: "fail", code: r.code, retryAfterSec: r.retryAfterSec, suggestedPlan: r.suggestedPlan })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só o início do turno dispara (pending false→true)
  }, [state.pending])

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [state.messages.length, state.pending])

  const send = (q: string) => { if (canSend(state, q)) { dispatch({ type: "send", question: q }); setDraft("") } }
  const upload = async (file: File | undefined) => {
    if (!file || busyUpload) return
    setBusyUpload(true); setImportError(null)
    const r = await transport.uploadImport(file)
    if (!r.ok) setImportError(errorView(r.code, { retryAfterSec: r.retryAfterSec, scope: "imports" }))
    else await refreshImports()
    setBusyUpload(false)
    if (fileRef.current) fileRef.current.value = ""
  }
  const remove = async (sha: string) => {
    setConfirmDelete(null)
    const r = await transport.deleteImport(sha)
    if (!r.ok) setImportError(errorView(r.code, { scope: "imports" }))
    else await refreshImports()
  }

  const over = draft.length > MAX_QUESTION_CHARS
  const card = "rounded-xl border border-border bg-card"
  const hasImports = (imports?.length ?? 0) > 0

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Conversa" className={`${card} flex min-h-[28rem] min-w-0 flex-col lg:h-[calc(100vh-9rem)]`}>
        <div ref={logRef} className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4" role="log" aria-live="polite" aria-relevant="additions" aria-label="Mensagens">
          {state.messages.length === 0 && !state.pending ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Pergunte sobre os trades do arquivo que você enviou. Eu respondo só com números conferidos pelo motor, sem conselho de compra ou venda.</p>
              <Suggestions onPick={send} disabled={!hasImports || state.pending} />
              {!hasImports && imports !== null ? <p className="text-xs text-muted-foreground">Envie um CSV ao lado para liberar as perguntas.</p> : null}
              <div className="rounded-lg border border-border bg-background p-3"><h2 className="mb-2 text-sm font-semibold text-foreground">Como perguntar</h2><HelpList /></div>
            </div>
          ) : null}
          {state.messages.map((m, idx) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{m.text}</p>
              </div>
            ) : (
              <div key={m.id} className="max-w-[95%] space-y-2">
                <div className="rounded-2xl rounded-bl-sm border border-border bg-background px-3 py-2.5 text-sm"><AnswerBody view={m.view} prior={state.messages.slice(0, idx).flatMap((x) => (x.role === "assistant" ? [x.view] : []))} /></div>
                {isNoDataReply(m.view) ? <div className="space-y-1.5"><p className="text-xs text-muted-foreground">Perguntas que eu respondo (veja também “Como perguntar” abaixo):</p><Suggestions onPick={send} disabled={state.pending} /></div> : null}
              </div>
            ),
          )}
          {state.pending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <span className="inline-block size-2 animate-pulse rounded-full bg-teal" aria-hidden="true" />Analisando seus trades…
            </p>
          ) : null}
          {state.error ? <ErrorNotice key={state.nextId + state.error.code} error={state.error} onRetry={() => dispatch({ type: "retry" })} onNew={() => dispatch({ type: "newConversation" })} onImport={() => fileRef.current?.click()} /> : null}
        </div>
        {state.messages.length > 0 ? (
          <details className="border-t border-border px-3 pt-2 text-sm">
            <summary className="min-h-9 cursor-pointer py-1.5 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">Como perguntar</summary>
            <div className="max-h-56 overflow-y-auto pb-2"><HelpList /></div>
          </details>
        ) : null}
        <form className="border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
          <label htmlFor={inputId} className="sr-only">Sua pergunta</label>
          <div className="flex items-end gap-2">
            <textarea id={inputId} value={draft} rows={2} maxLength={MAX_QUESTION_CHARS + 500} aria-describedby={counterId} placeholder="Pergunte sobre seus trades…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft) } }}
              className="field-sizing-content max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring sm:text-sm" />
            <button type="submit" disabled={!canSend(state, draft)}
              className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
              Enviar
            </button>
          </div>
          <p id={counterId} className={`mt-1 flex justify-between text-xs ${over ? "text-loss" : "text-muted-foreground"}`}>
            <span>Enter envia · Shift+Enter quebra linha</span>
            <span className="tabular-nums">{draft.length}/{MAX_QUESTION_CHARS}</span>
          </p>
        </form>
      </section>

      <aside className="min-w-0 space-y-4" aria-label="Arquivos e uso">
        <section className={`${card} p-3 sm:p-4`}>
          <h2 className="text-sm font-semibold text-foreground">Seus arquivos</h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files[0]) }}
            className={`mt-2 rounded-lg border border-dashed p-3 text-center text-sm transition-colors ${dragging ? "border-teal bg-teal/10" : "border-border"}`}>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id={`${inputId}-file`} onChange={(e) => void upload(e.target.files?.[0])} />
            <label htmlFor={`${inputId}-file`} className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-border bg-background px-3 font-medium text-foreground transition-colors hover:bg-muted focus-within:outline-2 focus-within:outline-ring">
              {busyUpload ? "Enviando…" : "Escolher CSV"}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">ou arraste aqui · até 4 MB</p>
          </div>
          {importError ? <div className="mt-2"><ErrorNotice key={importError.code} error={importError} onRetry={() => void refreshImports()} onNew={() => {}} onImport={() => fileRef.current?.click()} /></div> : null}
          {imports === null ? <p className="mt-3 text-xs text-muted-foreground">Carregando…</p> : imports.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Nenhum arquivo enviado ainda.</p> : (
            <ul className="mt-3 divide-y divide-border">
              {imports.map((f, i) => (
                <li key={f.fileSha256} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{f.fileName ?? "Sem nome"}</p>
                    <p className="text-xs text-muted-foreground">{fmtBytes(f.fileBytes)} · {fmtDate(f.createdAt)}{i === 0 ? " · em uso" : ""}</p>
                  </div>
                  {confirmDelete === f.fileSha256 ? (
                    <span className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => void remove(f.fileSha256)} className="min-h-9 rounded-md border border-loss/50 px-2 text-xs font-medium text-loss hover:bg-loss/10 focus-visible:outline-2 focus-visible:outline-ring">Apagar</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Cancelar</button>
                    </span>
                  ) : (
                    <button type="button" aria-label={`Apagar ${f.fileName ?? "arquivo"}`} onClick={() => setConfirmDelete(f.fileSha256)} className="min-h-9 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Apagar</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${card} p-3 sm:p-4`} aria-label="Uso do mês">
          <h2 className="text-sm font-semibold text-foreground">Uso neste mês</h2>
          {state.usage ? (
            <>
              <p className="mt-1 text-sm tabular-nums text-foreground">{state.usage.used} de {state.usage.limit} turnos</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation"><div className="h-full rounded-full bg-teal" style={{ width: `${Math.min(100, Math.round((state.usage.used / Math.max(1, state.usage.limit)) * 100))}%` }} /></div>
            </>
          ) : <p className="mt-1 text-xs text-muted-foreground">Aparece depois da primeira resposta.</p>}
          {state.messages.length > 0 ? <button type="button" onClick={() => dispatch({ type: "newConversation" })} className="mt-3 min-h-9 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Nova conversa</button> : null}
        </section>
      </aside>
    </div>
  )
}
