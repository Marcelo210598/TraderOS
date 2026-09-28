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

      <section className="mt-10">
        <h2 className="text-sm font-semibold mb-3">Mesas disponíveis</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {MESAS.map((m) => (
            <Link
              key={m.slug}
              href={`/mesas/${m.slug}`}
              className="rounded-xl border border-border bg-card p-5 hover:border-teal/60 transition-colors"
            >
              <h3 className="text-base font-semibold">{m.nome}</h3>
              <p className="text-sm text-muted-foreground mt-1">{m.resumo}</p>
              <p className="text-xs text-teal mt-3">Comparar os {m.planos.length} planos →</p>
            </Link>
          ))}
        </div>
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
