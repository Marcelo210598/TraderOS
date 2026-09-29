import type { Metadata } from "next"
import Link from "next/link"
import { ComparadorMesas } from "@/components/mesas/comparar-tabela"
import { ComparativoEntre } from "@/components/mesas/comparativo-planos"
import { ContatoEspecialista } from "@/components/mesas/contato-especialista"
import { MesasShell } from "@/components/mesas/mesas-shell"
import { MESAS, TAMANHOS, parseTamanho } from "@/lib/mesas"
import { linhasComparar, parsePlanos } from "@/lib/mesas/comparar"
import { cn } from "@/lib/utils"

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export const metadata: Metadata = {
  title: "Comparar mesas proprietárias",
  description: "Compare os planos de todas as mesas proprietárias de futuros em uma tabela só: preço, meta, drawdown, limite diário, consistência e saque.",
}

const dataBR = (iso: string) => iso.split("-").reverse().join("/")

export default async function CompararMesasPage({ searchParams }: Props) {
  const sp = await searchParams
  const tamanho = parseTamanho(sp.tamanho)
  const linhas = linhasComparar(tamanho)
  const escolhidos = parsePlanos(sp.planos)
  const maisAntiga = MESAS.map((m) => m.verificadoEm).sort()[0]

  return (
    <MesasShell>
      <Link href="/mesas" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
        ← Todas as mesas
      </Link>

      <div className="mt-4 max-w-2xl">
        <h1 className="text-2xl font-bold">Comparar mesas</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Todos os planos das {MESAS.length} mesas em uma tabela só. Escolha o tamanho da conta, ligue os filtros que importam pra você e marque de 2 a 3 planos pra
          ver todas as regras lado a lado.
        </p>
      </div>

      <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        Dados lidos nos sites oficiais de cada mesa (o mais antigo em <strong className="text-foreground">{dataBR(maisAntiga)}</strong>). Regras e preços mudam sem aviso:
        confirme no site da mesa antes de comprar. Isto é uma comparação de regras, não uma recomendação.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Todos os planos</h2>
        <nav aria-label="Tamanho da conta" className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Tamanho da conta</span>
          {TAMANHOS.map((t) => (
            <Link
              key={t}
              href={`/mesas/comparar?tamanho=${t}`}
              scroll={false}
              aria-current={t === tamanho ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                t === tamanho ? "border-gold bg-gold/15 text-gold" : "border-gold/30 text-gold/80 hover:border-gold/60 hover:text-gold"
              )}
            >
              {t}K
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-4">
        {/* key = tamanho: ao trocar de tamanho a seleção e os filtros recomeçam, sem misturar planos de outro tamanho */}
        <ComparadorMesas key={tamanho} linhas={linhas} tamanho={tamanho} />
      </div>

      {escolhidos.length >= 2 && (
        <section id="lado-a-lado" className="mt-12 scroll-mt-20">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold">Lado a lado · conta de {tamanho}K</h2>
            <Link href={`/mesas/comparar?tamanho=${tamanho}`} scroll={false} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Fechar comparação
            </Link>
          </div>
          <ComparativoEntre itens={escolhidos} tamanho={tamanho} />
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {[...new Map(escolhidos.map((e) => [e.mesa.slug, e.mesa])).values()].map((m) => (
              <li key={m.slug}>
                <Link href={`/mesas/${m.slug}?tamanho=${tamanho}`} className="text-teal hover:underline underline-offset-2">
                  Ver a página da {m.nome} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12">
        <ContatoEspecialista assunto="a comparação entre mesas proprietárias" />
      </div>
    </MesasShell>
  )
}
