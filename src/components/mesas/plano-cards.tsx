import { Check, Info } from "lucide-react"
import { dadosDoTamanho, usd, type Plano, type Tamanho } from "@/lib/mesas"

export function PlanoCards({ planos, tamanho }: { planos: Plano[]; tamanho: Tamanho }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {planos.map((p) => {
        const dados = dadosDoTamanho(p, tamanho)
        const escalonamento = dados?.escalonamento
        return (
          <article key={p.id} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
            <header>
              <h3 className="text-base font-semibold">{p.nome}</h3>
              <p className="text-sm text-muted-foreground mt-1">{p.resumo}</p>
            </header>

            <p className="text-sm">
              <span className="font-medium">Combina com quem: </span>
              <span className="text-foreground/90">{p.paraQuem}</span>
            </p>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">A favor</p>
              <ul className="space-y-1.5 text-sm">
                {p.destaques.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="size-4 mt-0.5 shrink-0 text-profit" aria-hidden />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Vale saber antes</p>
              <ul className="space-y-1.5 text-sm">
                {p.atencao.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Info className="size-4 mt-0.5 shrink-0 text-teal" aria-hidden />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            {!dados && (
              <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                Este plano não existe na conta de {tamanho}K. Troque o tamanho no comparativo pra ver onde ele está disponível.
              </p>
            )}

            {escalonamento && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  Escalonamento na financiada · conta {tamanho}K
                </p>
                <ul className="text-sm space-y-1">
                  {escalonamento.map((f, i) => {
                    const prox = escalonamento[i + 1]
                    const faixa = prox ? `${usd(f.lucroMinimo)} a ${usd(prox.lucroMinimo - 1)}` : `${usd(f.lucroMinimo)}+`
                    return (
                      <li key={f.lucroMinimo} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Lucro de {faixa}</span>
                        <span>
                          {f.minis} minis / {f.micros} micros
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
