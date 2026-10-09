// Peças visuais do Evidence Lab (Server Components, sem estado). Só formatam o que o domínio devolve.
import Link from "next/link"
import type { ReactNode } from "react"
import type { CheckStatus, VerifyStatus } from "@/lib/evidence/verify"

export type Tone = "ok" | "bad" | "warn" | "mute" | "info"

const TONE: Record<Tone, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  mute: "border-zinc-600/60 bg-zinc-800/60 text-zinc-300",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
}

export function Badge({ tone = "mute", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] leading-4 ${TONE[tone]}`}>
      {children}
    </span>
  )
}

export const checkTone = (s: CheckStatus): Tone => (s === "PASS" ? "ok" : s === "FAIL" ? "bad" : "warn")
export const statusTone = (s: VerifyStatus): Tone => (s === "VALID" ? "ok" : s === "TAMPERED" ? "bad" : s === "UNVERIFIABLE" ? "warn" : "info")

export function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mb-8">
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      {subtitle ? <p className="mt-1 max-w-3xl text-sm text-zinc-400">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>{children}</div>
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap border-b border-zinc-800 px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/80">{children}</tbody>
      </table>
    </div>
  )
}

export const Td = ({ children, mono = false, className = "" }: { children?: ReactNode; mono?: boolean; className?: string }) => (
  <td className={`px-3 py-2 align-top text-zinc-200 ${mono ? "font-mono text-xs" : ""} ${className}`}>{children}</td>
)

export function Kv({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(10rem,14rem)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-zinc-400">{k}</dt>
          <dd className="min-w-0 break-words text-zinc-100">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Hash curto com o valor completo no `title` e selecionável. */
export function Hash({ value, n = 12 }: { value: string | null | undefined; n?: number }) {
  if (!value) return <span className="text-zinc-500">—</span>
  return (
    <span title={value} className="font-mono text-xs text-zinc-100">
      {value.slice(0, n)}…
    </span>
  )
}

export function Json({ value, label, open = false }: { value: unknown; label: string; open?: boolean }) {
  const text = JSON.stringify(value, null, 2)
  return (
    <details open={open} className="rounded-lg border border-zinc-800 bg-zinc-950">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100">
        {label} <span className="text-xs text-zinc-500">({text.length.toLocaleString("pt-BR")} caracteres)</span>
      </summary>
      <pre className="max-h-[32rem] overflow-auto border-t border-zinc-800 p-3 font-mono text-xs leading-5 text-zinc-300">{text}</pre>
    </details>
  )
}

export function Num({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-zinc-500">null</span>
  return <span className="font-mono tabular-nums">{String(v)}</span>
}

/** Link que só muda os parâmetros da URL (a página inteira é renderizada no servidor a cada clique). */
export function QLink({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} className={`rounded-md px-2.5 py-1 text-sm ${active ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:bg-zinc-800"}`}>
      {children}
    </Link>
  )
}

export function Callout({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${TONE[tone]}`}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-zinc-200">{children}</div>
    </div>
  )
}
