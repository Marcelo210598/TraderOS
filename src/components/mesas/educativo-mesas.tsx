import { Check, ChevronDown, Info } from "lucide-react"
import { COMO_FUNCIONA, GLOSSARIO, PONTOS_DE_ATENCAO, VANTAGENS } from "@/lib/mesas/educativo"

/** Bloco educativo do hub: o que é mesa prop, como funciona, prós/contras honestos e glossário. */
export function EducativoMesas() {
  return (
    <section id="como-funciona" className="scroll-mt-20">
      <h2 className="text-lg font-semibold">Como funciona uma mesa proprietária</h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
        Nunca operou por uma mesa? Sem problema. O caminho é o mesmo na maioria delas, e entender as regras antes de comprar já te coloca na frente.
      </p>

      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {COMO_FUNCIONA.map((p, i) => (
          <li key={p.titulo} className="flex gap-3 rounded-xl border border-border bg-card p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal/15 text-sm font-semibold text-teal" aria-hidden>
              {i + 1}
            </span>
            <div>
              <h3 className="text-sm font-semibold">{p.titulo}</h3>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{p.texto}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">O que costuma ser bom</h3>
          <ul className="space-y-2 text-sm">
            {VANTAGENS.map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="size-4 mt-0.5 shrink-0 text-profit" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Pra ir de olho</h3>
          <ul className="space-y-2 text-sm">
            {PONTOS_DE_ATENCAO.map((t) => (
              <li key={t} className="flex gap-2">
                <Info className="size-4 mt-0.5 shrink-0 text-teal" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-2">Glossário rápido</h3>
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {GLOSSARIO.map((g) => (
            <details key={g.termo} className="group bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-surface transition-colors [&::-webkit-details-marker]:hidden">
                {g.termo}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-4 pb-3 text-sm text-muted-foreground leading-relaxed">{g.definicao}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
