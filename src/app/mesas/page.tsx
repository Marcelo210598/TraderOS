import type { Metadata } from "next"
import Link from "next/link"
import { ContatoEspecialista } from "@/components/mesas/contato-especialista"
import { EducativoMesas } from "@/components/mesas/educativo-mesas"
import { MesasShell } from "@/components/mesas/mesas-shell"
import { MESAS } from "@/lib/mesas"

export const metadata: Metadata = {
  title: "Mesas Proprietárias",
  description: "Compare os planos das mesas proprietárias de futuros lado a lado e escolha com mais segurança. Dados lidos dos sites oficiais.",
}

export default function MesasPage() {
  return (
    <MesasShell>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Mesas Proprietárias</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Uma mesa proprietária te dá acesso a capital pra operar depois de passar por uma avaliação, e você fica com a maior parte do lucro
          que sacar. Aqui você compara os planos de cada mesa lado a lado, com as regras traduzidas pro dia a dia, pra escolher com mais segurança.
        </p>
        <a href="#como-funciona" className="mt-3 inline-block text-xs text-teal hover:underline underline-offset-2">
          Nunca ouviu falar? Veja como funciona ↓
        </a>
      </div>

      <section className="mt-12" aria-labelledby="escolha-mesa">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-teal">Comece por aqui</p>
            <h2 id="escolha-mesa" className="mt-1 text-2xl font-bold">Escolha a sua mesa</h2>
          </div>
          <p className="hidden sm:block text-xs text-muted-foreground">Dados lidos nos sites oficiais e monitorados toda semana</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {MESAS.map((m) => (
            <Link
              key={m.slug}
              href={`/mesas/${m.slug}`}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-teal/40 bg-gradient-to-br from-teal/15 via-card to-card p-6 sm:p-7 shadow-[0_0_40px_-18px] shadow-teal transition-all hover:-translate-y-0.5 hover:border-teal hover:shadow-[0_0_60px_-14px] focus-visible:outline-2 focus-visible:outline-teal"
            >
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-teal/20 blur-3xl transition-opacity group-hover:opacity-100 opacity-70" />

              <div className="relative flex items-start justify-between gap-3">
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight">{m.nome}</h3>
                <span className="shrink-0 rounded-full border border-teal/50 bg-teal/10 px-3 py-1 text-xs font-semibold text-teal">
                  {m.planos.length} planos
                </span>
              </div>

              <p className="relative mt-3 text-sm text-muted-foreground leading-relaxed">{m.resumo}</p>

              <ul className="relative mt-5 flex flex-wrap gap-2" aria-label="Planos">
                {m.planos.map((p) => (
                  <li key={p.id} className="rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium">
                    {p.nome}
                  </li>
                ))}
              </ul>

              <dl className="relative mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <div>
                  <dt className="inline">Você fica com </dt>
                  <dd className="inline font-semibold text-foreground">{m.splitTexto ?? `${m.splitTrader}% dos saques`}</dd>
                </div>
                <div>
                  <dt className="inline">Conferido em </dt>
                  <dd className="inline font-semibold text-foreground">{m.verificadoEm.split("-").reverse().join("/")}</dd>
                </div>
              </dl>

              <div className="relative mt-auto pt-6">
                <span className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-teal-foreground transition-opacity group-hover:opacity-90">
                  Comparar os {m.planos.length} planos <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>

        <Link
          href="/mesas/comparar"
          className="group mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/10 via-card to-card p-5 sm:p-6 transition-all hover:border-gold hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-gold"
        >
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-gold">Ainda em dúvida?</p>
            <h3 className="mt-1 text-lg sm:text-xl font-bold tracking-tight">Compare todas as mesas em uma tabela só</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Filtre por sem limite diário, sem consistência ou pagamento único, e ponha até 3 planos lado a lado.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-background transition-opacity group-hover:opacity-90">
            Comparar as mesas <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </span>
        </Link>
      </section>

      <div className="mt-12">
        <EducativoMesas />
      </div>

      <div className="mt-12">
        <ContatoEspecialista assunto="mesas proprietárias" />
      </div>
    </MesasShell>
  )
}
