import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { ContatoEspecialista } from "@/components/mesas/contato-especialista"
import { MesasShell } from "@/components/mesas/mesas-shell"
import { ComparativoPlanos } from "@/components/mesas/comparativo-planos"
import { PlanoCards } from "@/components/mesas/plano-cards"
import { PontosDaMesa } from "@/components/mesas/pontos-da-mesa"
import { QuizPlano } from "@/components/mesas/quiz-plano"
import { TAMANHOS, getMesa, linkDaMesa, parseTamanho } from "@/lib/mesas"
import { cn } from "@/lib/utils"

interface Props {
  params: Promise<{ mesa: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

const dataBR = (iso: string) => iso.split("-").reverse().join("/")

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const mesa = getMesa((await params).mesa)
  if (!mesa) return { title: "Mesa não encontrada" }
  return {
    title: `${mesa.nome}: compare os planos`,
    description: `Compare os ${mesa.planos.length} planos da ${mesa.nome} lado a lado: meta, drawdown, consistência, saque e preço de tabela.`,
  }
}

export default async function MesaPage({ params, searchParams }: Props) {
  const mesa = getMesa((await params).mesa)
  if (!mesa) notFound()

  const tamanho = parseTamanho((await searchParams).tamanho)
  const temAfiliado = !!mesa.linkAfiliado

  return (
    <MesasShell>
      <Link href="/mesas" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
        ← Todas as mesas
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold">{mesa.nome}</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{mesa.resumo}</p>
        </div>
        <a
          href={linkDaMesa(mesa)}
          target="_blank"
          rel={temAfiliado ? "noopener noreferrer sponsored" : "noopener noreferrer"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal px-4 py-2 text-sm font-medium text-teal-foreground hover:opacity-90 transition-opacity"
        >
          Ver no site oficial <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>

      <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        Dados lidos nos sites oficiais da mesa em <strong className="text-foreground">{dataBR(mesa.verificadoEm)}</strong>. Regras e preços mudam sem
        aviso: confirme no site antes de comprar.{" "}
        {temAfiliado
          ? "O botão acima é um link de afiliado: podemos receber uma comissão, sem custo extra pra você."
          : "O botão acima é o link oficial da mesa; não recebemos comissão."}
      </p>

      {mesa.quiz && (
        <div className="mt-8">
          <QuizPlano mesa={mesa} tamanho={tamanho} />
        </div>
      )}

      <section id="comparativo" className="mt-10 scroll-mt-20">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">Comparativo lado a lado</h2>
          <nav aria-label="Tamanho da conta" className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Tamanho da conta</span>
            {TAMANHOS.map((t) => (
              <Link
                key={t}
                href={`/mesas/${mesa.slug}?tamanho=${t}`}
                scroll={false}
                aria-current={t === tamanho ? "page" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                  t === tamanho
                    ? "border-gold bg-gold/15 text-gold"
                    : "border-gold/30 text-gold/80 hover:border-gold/60 hover:text-gold"
                )}
              >
                {t}K
              </Link>
            ))}
          </nav>
        </div>
        <ComparativoPlanos planos={mesa.planos} tamanho={tamanho} splitTrader={mesa.splitTrader} />
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold mb-4">O que muda na prática</h2>
        <PlanoCards planos={mesa.planos} tamanho={tamanho} />
      </section>

      <div className="mt-12">
        <PontosDaMesa mesa={mesa} />
      </div>

      <div className="mt-12">
        <ContatoEspecialista assunto={`a mesa proprietária ${mesa.nome}`} />
      </div>

      <section className="mt-12 text-xs text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground mb-2">Fontes oficiais</h2>
        <ul className="space-y-1">
          {[...mesa.fontes, ...mesa.planos.flatMap((p) => p.fontes)].map((f) => (
            <li key={f.url}>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-2 break-all">
                {f.url}
              </a>{" "}
              · lido em {dataBR(f.verificadoEm)}
            </li>
          ))}
        </ul>
      </section>
    </MesasShell>
  )
}
