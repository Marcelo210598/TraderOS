import { ChevronDown } from "lucide-react"
import type { Mesa } from "@/lib/mesas"

/** Regras que valem pra todos os planos da mesa, em blocos recolhíveis (o 1º já vem aberto). */
export function RegrasGerais({ mesa }: { mesa: Mesa }) {
  if (!mesa.regrasGerais?.length) return null
  return (
    <section>
      <h2 className="text-lg font-semibold">Regras que valem pra todos os planos</h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
        Estas regras não mudam de plano pra plano na {mesa.nome}. Vale ler antes de comprar.
      </p>
      <div className="mt-4 rounded-xl border border-border divide-y divide-border overflow-hidden">
        {mesa.regrasGerais.map((bloco, i) => (
          <details key={bloco.titulo} open={i === 0} className="group bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-surface transition-colors [&::-webkit-details-marker]:hidden">
              {bloco.titulo}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="space-y-2 px-4 pb-4 text-sm text-foreground/90 list-disc pl-8 marker:text-muted-foreground">
              {bloco.itens.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  )
}
