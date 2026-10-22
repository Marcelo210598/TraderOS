"use client"

// Tela do AI Partner (E7-20): desenha o layout estruturado (cartões e tabelas). Só nós de texto do React; o selo aparece UMA vez (no topo) e, nas células, só quando foge do "verificado".
import { splitEmptyRows, type AnswerLayout, type LayoutBlock, type LayoutCell } from "@/lib/ai-partner-ui/layout"
import type { Verdict } from "@/lib/ai-partner-ui/view"

const EXCEPTION: Record<Exclude<Verdict, "verified">, { glyph: string; label: string; cls: string }> = {
  partial: { glyph: "◐", label: "parcial", cls: "text-gold" },
  unverified: { glyph: "?", label: "não verificado", cls: "text-muted-foreground" },
  mismatch: { glyph: "✕", label: "não confere", cls: "text-loss" },
}
// só o sinal negativo ganha cor: valor positivo não é "bom" por si só (ex.: drawdown), então fica neutro
const tone = (text: string): string => (/^-\s?US\$/.test(text) ? "text-loss" : "text-foreground")

function Value({ cell, big = false }: { cell: LayoutCell; big?: boolean }) {
  if (cell.note !== null) return <span className="text-muted-foreground"><span aria-label="indisponível">—</span><span className="block text-[0.7rem] leading-snug">{cell.note}</span></span>
  const ex = cell.verdict === "verified" ? null : EXCEPTION[cell.verdict]
  return (
    <span className="inline-flex flex-col">
      <span className={`font-semibold tabular-nums ${big ? "text-xl sm:text-2xl" : ""} ${tone(cell.text)}`}>{cell.text}</span>
      {ex ? <span className={`text-[0.7rem] font-medium ${ex.cls}`}><span aria-hidden="true">{ex.glyph} </span>{ex.label}</span> : null}
    </span>
  )
}

function LineValue({ cell }: { cell: LayoutCell }) {
  const ex = cell.verdict === "verified" ? null : EXCEPTION[cell.verdict]
  return <>{cell.note !== null ? `— (${cell.note})` : cell.text}{ex ? <span className={`ml-1 text-[0.7rem] ${ex.cls}`}>({ex.label})</span> : null}</>
}

function Block({ block, hideNotes }: { block: LayoutBlock; hideNotes: ReadonlySet<string> }) {
  if (block.kind === "title") return <h3 className="text-base font-semibold text-foreground">{block.text}</h3>
  if (block.kind === "line") {
    return <p className="text-xs leading-relaxed text-muted-foreground">{block.parts.map((p, i) => ("cell" in p ? <span key={i} className="font-medium text-foreground"><LineValue cell={p.cell} /></span> : <span key={i}>{p.text}</span>))}</p>
  }
  if (block.kind === "note") {
    if (block.tone === "info" && hideNotes.has(block.text)) return null
    return <p className={`border-l-2 pl-3 text-xs leading-relaxed ${block.tone === "caveat" ? "border-gold/60 text-gold" : "border-border text-muted-foreground"}`}>{block.text}</p>
  }
  if (block.kind === "stats") {
    return (
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {block.items.map((it) => (
          <div key={it.label} className="rounded-lg border border-border bg-card/60 px-3 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">{it.label}</dt>
            <dd className="mt-0.5"><Value cell={it.cell} big /></dd>
            {it.help ? <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{it.help}</p> : null}
          </div>
        ))}
      </dl>
    )
  }
  const helps = block.columns.filter((c) => c.help !== null)
  const { shown, empty } = splitEmptyRows(block.rows)
  const wide = block.columns.length > 5 // 6+ colunas não cabem na coluna do chat: um cartão por linha, em qualquer largura
  return (
    <div className="space-y-2">
      {block.caption ? <p className="text-sm font-medium text-foreground">{block.caption}</p> : null}
      <div className={wide ? "grid gap-2 sm:grid-cols-2" : "space-y-2 sm:hidden"}>
        {shown.map((r) => (
          <div key={r.label} className="rounded-lg border border-border bg-card/60 px-3 py-2.5">
            <p className="text-sm font-medium text-foreground">{r.label}{r.tag ? <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] font-normal text-muted-foreground">{r.tag}</span> : null}</p>
            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              {r.cells.map((c, i) => (<div key={i} className="contents"><dt className="text-xs text-muted-foreground">{block.columns[i].label}</dt><dd className="text-right text-sm"><Value cell={c} /></dd></div>))}
            </dl>
          </div>
        ))}
      </div>
      <div className={wide ? "hidden" : "hidden overflow-x-auto rounded-lg border border-border sm:block"}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="sticky left-0 bg-muted px-3 py-2 font-medium" />
              {block.columns.map((c) => <th key={c.label} scope="col" className="min-w-[5.5rem] px-2.5 py-2 text-right align-bottom font-medium leading-tight">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-card px-3 py-2 text-left font-medium text-foreground">
                  {r.label}{r.tag ? <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] font-normal text-muted-foreground">{r.tag}</span> : null}
                </th>
                {r.cells.map((c, i) => <td key={i} className="whitespace-nowrap px-2.5 py-2 text-right align-top"><Value cell={c} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {empty.length > 0 ? <p className="text-xs text-muted-foreground">Sem ocorrências: {empty.join(", ")}.</p> : null}
      {helps.length > 0 ? (
        <details className="text-[0.72rem] leading-snug text-muted-foreground">
          <summary className="min-h-7 cursor-pointer py-1 font-medium focus-visible:outline-2 focus-visible:outline-ring">O que significa cada coluna</summary>
          <dl className="space-y-0.5 pb-1">
            {helps.map((c) => <div key={c.label}><dt className="inline font-medium text-foreground/80">{c.label}: </dt><dd className="inline">{c.help}</dd></div>)}
          </dl>
        </details>
      ) : null}
    </div>
  )
}

export function AnswerLayoutView({ layout, hideNotes }: { layout: AnswerLayout; hideNotes: ReadonlySet<string> }) {
  return <div className="space-y-3">{layout.blocks.map((b, i) => <Block key={i} block={b} hideNotes={hideNotes} />)}</div>
}
