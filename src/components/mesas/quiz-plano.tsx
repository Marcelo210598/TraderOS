"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Check, ExternalLink, Info, MessageCircle, RotateCcw } from "lucide-react"
import { dadosDoTamanho, linkDaMesa, usd, type Mesa, type Tamanho } from "@/lib/mesas"
import { ESPECIALISTA, linkWhatsApp } from "@/lib/mesas/contato"
import { calcularSugestao, type Respostas, type ResultadoPlano } from "@/lib/mesas/quiz"
import { cn } from "@/lib/utils"

const unicos = (lista: string[]) => [...new Set(lista)]

function Numeros({ r, tamanho }: { r: ResultadoPlano; tamanho: Tamanho }) {
  const d = dadosDoTamanho(r.plano, tamanho)
  if (!d) {
    return (
      <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted-foreground">
        Este plano não existe na conta de {tamanho}K. Troque o tamanho no comparativo abaixo pra ver onde ele está disponível.
      </p>
    )
  }
  const preco =
    d.precoTabelaUsd != null
      ? `${d.precoRotulo ? `${d.precoRotulo} ` : ""}${usd(d.precoTabelaUsd)}${r.plano.cobranca === "mensal" ? "/mês" : ""}`
      : "Varia pela configuração"
  const itens = [
    { rotulo: "Meta da avaliação", valor: d.metaAvaliacao != null ? usd(d.metaAvaliacao) : "Sem avaliação" },
    { rotulo: "Perda máxima", valor: usd(d.perdaMaxima) },
    { rotulo: "Preço de tabela", valor: preco },
  ]
  return (
    <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
      {itens.map((i) => (
        <div key={i.rotulo}>
          <dt className="text-xs text-muted-foreground">{i.rotulo}</dt>
          <dd className="mt-0.5 font-medium">{i.valor}</dd>
        </div>
      ))}
    </dl>
  )
}

export function QuizPlano({ mesa, tamanho }: { mesa: Mesa; tamanho: Tamanho }) {
  const quiz = mesa.quiz
  const [passo, setPasso] = useState(0)
  const [respostas, setRespostas] = useState<Respostas>({})
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const primeiraRender = useRef(true)

  // Move o foco pro título a cada troca de passo (leitor de tela + teclado), mas não na carga da página.
  useEffect(() => {
    if (primeiraRender.current) {
      primeiraRender.current = false
      return
    }
    tituloRef.current?.focus()
  }, [passo])

  if (!quiz) return null
  const total = quiz.perguntas.length
  const terminou = passo >= total
  const pergunta = quiz.perguntas[passo]

  const escolher = (indice: number) => {
    setRespostas((atual) => ({ ...atual, [passo]: indice }))
    setPasso((p) => p + 1)
  }
  const refazer = () => {
    setRespostas({})
    setPasso(0)
  }

  const sugestao = terminou ? calcularSugestao(quiz, mesa.planos, respostas) : null
  const principal = sugestao?.principal ?? null
  const alternativa = sugestao?.alternativa ?? null

  return (
    <section id="quiz" className="rounded-xl border border-border bg-card p-5 sm:p-6 scroll-mt-20">
      <h2 className="text-lg font-semibold">Qual plano combina comigo?</h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
        {total} perguntas rápidas sobre o seu jeito de operar. No final, mostramos o plano da {mesa.nome} que mais se encaixa e o que pesa contra.
      </p>

      {!terminou && pergunta && (
        <div className="mt-5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Pergunta {passo + 1} de {total}
            </span>
            <div
              className="h-1 flex-1 rounded-full bg-surface overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={passo}
              aria-label="Progresso do quiz"
            >
              <div className="h-full bg-teal transition-all" style={{ width: `${(passo / total) * 100}%` }} />
            </div>
          </div>

          <h3 ref={tituloRef} tabIndex={-1} className="mt-4 text-base font-semibold outline-none">
            {pergunta.texto}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{pergunta.contexto}</p>

          <div role="group" aria-label={pergunta.texto} className="mt-4 grid gap-2">
            {pergunta.opcoes.map((o, i) => (
              <button
                key={o.rotulo}
                type="button"
                onClick={() => escolher(i)}
                aria-pressed={respostas[passo] === i}
                className={cn(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-colors hover:border-teal hover:bg-teal/5 focus-visible:outline-2 focus-visible:outline-teal",
                  respostas[passo] === i ? "border-teal bg-teal/10" : "border-border"
                )}
              >
                {o.rotulo}
                {o.detalhe && <span className="block text-xs text-muted-foreground mt-0.5">{o.detalhe}</span>}
              </button>
            ))}
          </div>

          {passo > 0 && (
            <button
              type="button"
              onClick={() => setPasso((p) => p - 1)}
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" aria-hidden /> Voltar
            </button>
          )}
        </div>
      )}

      {terminou && (
        <div className="mt-5">
          {principal ? (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-teal">O plano que mais se encaixa</p>
              <h3 ref={tituloRef} tabIndex={-1} className="mt-1 text-xl font-bold outline-none">
                {principal.plano.nome}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{principal.plano.resumo}</p>

              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Conta de {tamanho}K (troque o tamanho no comparativo abaixo)</p>
                <Numeros r={principal} tamanho={tamanho} />
              </div>

              {unicos(principal.motivos).length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Por que combina com você</p>
                  <ul className="space-y-1.5 text-sm">
                    {unicos(principal.motivos).map((t) => (
                      <li key={t} className="flex gap-2">
                        <Check className="size-4 mt-0.5 shrink-0 text-profit" aria-hidden />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Fique de olho</p>
                <ul className="space-y-1.5 text-sm">
                  {unicos([...principal.alertas, ...principal.plano.atencao.slice(0, principal.alertas.length ? 1 : 2)]).map((t) => (
                    <li key={t} className="flex gap-2">
                      <Info className="size-4 mt-0.5 shrink-0 text-teal" aria-hidden />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {alternativa && (
                <p className="mt-5 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                  <span className="font-medium">Também vale olhar: {alternativa.plano.nome}.</span>{" "}
                  <span className="text-muted-foreground">{alternativa.plano.paraQuem}</span>
                  {alternativa.alertas.map((t) => (
                    <span key={t} className="mt-2 flex gap-2 text-foreground/90">
                      <Info className="size-4 mt-0.5 shrink-0 text-teal" aria-hidden />
                      <span>{t}</span>
                    </span>
                  ))}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm">Nenhum plano se encaixou nas suas respostas. Compare todos no quadro abaixo ou fale com o especialista.</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href="#comparativo" className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-teal-foreground hover:opacity-90 transition-opacity">
              Comparar todos os planos
            </a>
            <a
              href={linkDaMesa(mesa)}
              target="_blank"
              rel={mesa.linkAfiliado ? "noopener noreferrer sponsored" : "noopener noreferrer"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Ver no site oficial <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <button
              type="button"
              onClick={refazer}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="size-3.5" aria-hidden /> Refazer
            </button>
          </div>

          <div className="mt-6 rounded-lg border border-teal/40 bg-teal/5 p-4 sm:p-5">
            <p className="text-sm font-semibold">Ainda ficou com dúvida?</p>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Chame o <strong className="text-foreground">{ESPECIALISTA.nome}</strong>, nosso especialista, com{" "}
              {ESPECIALISTA.experiencia}. Ele conversa com você sobre o seu momento e ajuda a
              confirmar se {principal ? `o ${principal.plano.nome}` : "o plano"} é mesmo o melhor caminho.
            </p>
            <a
              href={linkWhatsApp(principal ? `o plano ${principal.plano.nome} da ${mesa.nome}` : `a mesa proprietária ${mesa.nome}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-medium text-teal-foreground hover:opacity-90 transition-opacity"
            >
              <MessageCircle className="size-4" aria-hidden />
              Chamar no WhatsApp
              <span className="text-xs font-normal opacity-80">{ESPECIALISTA.whatsapp.exibicao}</span>
            </a>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              {ESPECIALISTA.avisoParceria} {ESPECIALISTA.avisoSeguranca}
            </p>
          </div>

          <p className="mt-5 text-xs text-muted-foreground leading-relaxed">
            É uma sugestão baseada nas regras publicadas pela mesa, não uma recomendação financeira. Nenhum plano garante resultado: confirme as regras e
            o preço atual no site oficial antes de comprar.
          </p>
        </div>
      )}
    </section>
  )
}
