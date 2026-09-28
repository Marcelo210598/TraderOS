import { Check, Info } from "lucide-react"
import type { Mesa } from "@/lib/mesas"

/** "A {mesa} como mesa": vantagens e pontos de atenção da mesa toda (os de cada plano ficam nos cards). */
export function PontosDaMesa({ mesa }: { mesa: Mesa }) {
  if (!mesa.vantagens?.length && !mesa.atencao?.length) return null
  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">A {mesa.nome} como mesa</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {mesa.vantagens && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">A favor</h3>
            <ul className="space-y-2 text-sm">
              {mesa.vantagens.map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="size-4 mt-0.5 shrink-0 text-profit" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {mesa.atencao && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Vale saber antes</h3>
            <ul className="space-y-2 text-sm">
              {mesa.atencao.map((t) => (
                <li key={t} className="flex gap-2">
                  <Info className="size-4 mt-0.5 shrink-0 text-teal" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
