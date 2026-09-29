"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowRight, Check } from "lucide-react"
import { FILTROS, MAX_COMPARAR, aplicarFiltros, ordenar, type Filtro, type LinhaComparar, type Ordem } from "@/lib/mesas/comparar-filtros"
import { cn } from "@/lib/utils"

const usd = (n: number) => `$${n.toLocaleString("en-US")}`

const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "padrao", rotulo: "Ordem das mesas" },
  { id: "preco", rotulo: "Menor preço" },
  { id: "meta", rotulo: "Menor meta" },
  { id: "perda", rotulo: "Maior perda máxima" },
  { id: "teto", rotulo: "Maior teto de saque" },
]

function Preco({ l }: { l: LinhaComparar }) {
  if (l.preco == null) return <span className="text-muted-foreground">Varia</span>
  return (
    <>
      {l.precoRotulo && <span className="block text-[11px] text-muted-foreground">{l.precoRotulo}</span>}
      <span className="font-semibold text-foreground">
        {usd(l.preco)}
        {l.cobranca === "mensal" && <span className="text-xs font-normal text-muted-foreground">/mês</span>}
      </span>
      <span className="block text-[11px] text-muted-foreground">{l.cobranca === "mensal" ? "Assinatura até passar" : "Pagamento único"}</span>
    </>
  )
}

export function ComparadorMesas({ linhas, tamanho }: { linhas: LinhaComparar[]; tamanho: number }) {
  const [filtros, setFiltros] = useState<Filtro[]>([])
  const [ordem, setOrdem] = useState<Ordem>("padrao")
  const [selecionadas, setSelecionadas] = useState<string[]>([])

  const visiveis = useMemo(() => ordenar(aplicarFiltros(linhas, filtros), ordem), [linhas, filtros, ordem])

  const alternaFiltro = (f: Filtro) => setFiltros((atual) => (atual.includes(f) ? atual.filter((x) => x !== f) : [...atual, f]))
  const alternaLinha = (chave: string) =>
    setSelecionadas((atual) => (atual.includes(chave) ? atual.filter((c) => c !== chave) : atual.length >= MAX_COMPARAR ? atual : [...atual, chave]))

  const cheio = selecionadas.length >= MAX_COMPARAR
  const pronto = selecionadas.length >= 2
  const hrefComparar = `/mesas/comparar?tamanho=${tamanho}&planos=${selecionadas.join(",")}#lado-a-lado`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
        {FILTROS.map((f) => {
          const ligado = filtros.includes(f.id)
          return (
            <button
              key={f.id}
              type="button"
              title={f.ajuda}
              aria-pressed={ligado}
              onClick={() => alternaFiltro(f.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                ligado ? "border-gold bg-gold/15 text-gold" : "border-gold/30 text-gold/80 hover:border-gold/60 hover:text-gold"
              )}
            >
              {ligado && <Check className="size-3" aria-hidden />}
              {f.rotulo}
            </button>
          )
        })}
        {filtros.length > 0 && (
          <button type="button" onClick={() => setFiltros([])} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Limpar filtros
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p aria-live="polite">
          {visiveis.length === linhas.length ? `${linhas.length} planos` : `${visiveis.length} de ${linhas.length} planos`} na conta de {tamanho}K
        </p>
        <label className="inline-flex items-center gap-2">
          Ordenar por
          <select
            value={ordem}
            onChange={(e) => setOrdem(e.target.value as Ordem)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {ORDENS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visiveis.length === 0 ? (
        <p className="mt-4 rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum plano tem todas essas características ao mesmo tempo. Tire um filtro pra ver mais opções.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-sm border-collapse">
            <thead>
              <tr className="bg-surface text-left text-xs font-medium text-muted-foreground">
                <th className="w-10 px-2.5 py-3">
                  <span className="sr-only">Selecionar pra comparar</span>
                </th>
                <th className="sticky left-0 z-10 bg-surface px-2.5 py-3 min-w-[150px]">Plano</th>
                <th className="px-2.5 py-3">Preço</th>
                <th className="px-2.5 py-3" title="Taxa paga depois de passar, pra liberar a conta financiada">
                  Taxa depois de passar
                </th>
                <th className="px-2.5 py-3">Meta</th>
                <th className="px-2.5 py-3">Perda máxima</th>
                <th className="px-2.5 py-3">Drawdown</th>
                <th className="px-2.5 py-3">Limite diário</th>
                <th className="px-2.5 py-3">Consistência</th>
                <th className="px-2.5 py-3 min-w-[140px]">Saque</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const marcada = selecionadas.includes(l.chave)
                return (
                  <tr key={l.chave} className={cn("border-t border-border align-top", marcada && "bg-teal/5")}>
                    <td className="px-2.5 py-3">
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={!marcada && cheio}
                        onChange={() => alternaLinha(l.chave)}
                        aria-label={`Comparar ${l.mesaNome} ${l.planoNome}`}
                        className="size-4 accent-teal disabled:opacity-40"
                      />
                    </td>
                    <th scope="row" className="sticky left-0 z-[1] bg-background px-2.5 py-3 text-left font-normal">
                      <Link href={`/mesas/${l.mesaSlug}?tamanho=${tamanho}`} className="text-xs font-medium text-teal hover:underline underline-offset-2">
                        {l.mesaNome}
                      </Link>
                      <span className="block font-semibold">{l.planoNome}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {l.caminho === "direto" ? "Direto na financiada" : "Avaliação → financiada"} · você fica com {l.split}
                      </span>
                    </th>
                    <td className="px-2.5 py-3">
                      <Preco l={l} />
                    </td>
                    <td className="px-2.5 py-3">{l.ativacao > 0 ? usd(l.ativacao) : <span className="text-muted-foreground">Não tem</span>}</td>
                    <td className="px-2.5 py-3">{l.meta != null ? usd(l.meta) : <span className="text-muted-foreground">Sem avaliação</span>}</td>
                    <td className="px-2.5 py-3">{usd(l.perdaMaxima)}</td>
                    <td className="px-2.5 py-3 max-w-[150px]">{l.drawdown}</td>
                    <td className="px-2.5 py-3">
                      {l.limiteDiario == null ? (
                        <span className="text-muted-foreground">Não tem</span>
                      ) : (
                        <>
                          {usd(l.limiteDiario)}
                          {l.semLimiteDiario && <span className="block text-[11px] text-muted-foreground">opcional</span>}
                        </>
                      )}
                    </td>
                    <td className="px-2.5 py-3 max-w-[150px]">{l.consistencia}</td>
                    <td className="px-2.5 py-3">
                      {l.saque}
                      <span className="block text-[11px] text-muted-foreground">{l.tetoSaque != null ? `Teto de ${usd(l.tetoSaque)} por pedido` : "Sem teto fixo informado"}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Preço de tabela, sem promoção. Nas mensalidades, o valor é por mês e continua até você passar. Marque de 2 a {MAX_COMPARAR} planos pra ver todas as regras lado a lado.
      </p>

      <div
        className={cn(
          "sticky bottom-4 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur transition-colors",
          selecionadas.length > 0 ? "border-teal/50 bg-background/95" : "border-border bg-background/80"
        )}
      >
        <p className="text-sm" aria-live="polite">
          {selecionadas.length === 0
            ? "Marque os planos que quer comparar"
            : `${selecionadas.length} ${selecionadas.length === 1 ? "plano marcado" : "planos marcados"}${cheio ? " (máximo)" : ""}`}
        </p>
        <div className="flex items-center gap-3">
          {selecionadas.length > 0 && (
            <button type="button" onClick={() => setSelecionadas([])} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Limpar
            </button>
          )}
          {pronto ? (
            <Link
              href={hrefComparar}
              className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-teal-foreground hover:opacity-90 transition-opacity"
            >
              Comparar lado a lado <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground" aria-disabled>
              Marque pelo menos 2
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
