import { celulaDoTamanho, dadosDoTamanho, usd, type DadosTamanho, type Mesa, type Plano, type Tamanho } from "@/lib/mesas"

const DRAWDOWN_LABEL = { EOD: "Fim do dia (EOD)", INTRADAY: "Intraday", ESCOLHA: "Você escolhe" } as const

const drawdownTexto = (p: Plano) => {
  if (p.caminho === "direto") return `${DRAWDOWN_LABEL[p.drawdown.financiada]} (já financiada)`
  const aval = p.drawdown.avaliacao === null ? "" : DRAWDOWN_LABEL[p.drawdown.avaliacao]
  return p.drawdown.avaliacao === p.drawdown.financiada ? aval : `Avaliação: ${aval} · Financiada: ${DRAWDOWN_LABEL[p.drawdown.financiada]}`
}

const limiteDiarioTexto = (p: Plano, d: DadosTamanho) => {
  if (d.limiteDiario == null) return "Não tem"
  return p.dllOpcional ? `${usd(d.limiteDiario)} (opcional)` : usd(d.limiteDiario)
}

const consistenciaTexto = (p: Plano) => {
  const { avaliacao, financiada } = p.consistencia
  if (p.caminho === "direto") return financiada != null ? `Saque: ${financiada}%` : "Não tem"
  if (avaliacao == null && financiada == null) return "Não tem"
  const partes: string[] = []
  partes.push(avaliacao != null ? `Avaliação: ${avaliacao}%` : "Avaliação: não tem")
  partes.push(financiada != null ? `Saque: ${financiada}%` : "Saque: não tem")
  return partes.join(" · ")
}

/** Critérios que precisam ser cumpridos antes de pedir saque, em linhas curtas. */
const criteriosSaque = (p: Plano, d: DadosTamanho): string[] => {
  const s = d.saque
  const linhas: string[] = []
  if (s.metaLucroCiclo) {
    const { primeiro, demais } = s.metaLucroCiclo
    linhas.push(primeiro === demais ? `Lucro de ${usd(primeiro)} no ciclo` : `Lucro no ciclo: ${usd(primeiro)} (1º) · ${usd(demais)} (depois)`)
  }
  if (s.diasComLucro) linhas.push(`${s.diasComLucro.dias} dias com lucro ≥ ${usd(s.diasComLucro.lucroMinimoPorDia)}`)
  if (s.colchao) linhas.push(`Colchão de ${usd(s.colchao)} de lucro que não sai`)
  if (p.consistencia.financiada != null) linhas.push(`Maior dia ≤ ${p.consistencia.financiada}% do lucro`)
  if (p.exigeLucroLiquidoNoCiclo) linhas.push("Lucro líquido positivo desde o último saque")
  return linhas
}

const maximoTexto = (d: DadosTamanho) =>
  d.saque.maximos.map((m) => {
    if (m.valor == null) return `${m.rotulo}: todo o lucro acima do colchão`
    if (m.pctDoLucro) return `${m.rotulo}: ${m.pctDoLucro}% do lucro, até ${usd(m.valor)}`
    return `${m.rotulo}: até ${usd(m.valor)}`
  })

const precoTexto = (p: Plano, d: DadosTamanho): React.ReactNode => {
  if (d.precoTabelaUsd == null) return "Varia pela configuração"
  const valor = `${d.precoRotulo ? `${d.precoRotulo} ` : ""}${usd(d.precoTabelaUsd)}${p.cobranca === "mensal" ? "/mês" : ""}`
  const como = p.cobranca === "mensal" ? "Assinatura mensal até passar" : p.cobranca === "unica" ? "Pagamento único" : null
  return (
    <>
      {valor}
      {como && <span className="block text-xs text-muted-foreground">{como}</span>}
    </>
  )
}

const lista = (itens: string[]): React.ReactNode =>
  itens.length === 1 ? (
    itens[0]
  ) : (
    <ul className="space-y-1">
      {itens.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  )

interface Contexto {
  split: number
  saqueMinimo?: number
  ajudaPreco?: string
}

interface Linha {
  rotulo: string
  ajuda?: string | ((c: Contexto) => string)
  celula: (p: Plano, d: DadosTamanho) => React.ReactNode
}

const AJUDA_PRECO_PADRAO = "Sem promoção. O valor final muda toda semana — confira no site."

const LINHAS: Linha[] = [
  { rotulo: "Caminho", celula: (p) => (p.caminho === "direto" ? "Direto pra financiada (sem avaliação)" : "Avaliação → financiada") },
  { rotulo: "Meta da avaliação", celula: (_, d) => (d.metaAvaliacao != null ? usd(d.metaAvaliacao) : "Sem avaliação") },
  { rotulo: "Perda máxima", ajuda: "Se o saldo encostar nisso, a conta quebra.", celula: (_, d) => usd(d.perdaMaxima) },
  { rotulo: "Drawdown", ajuda: "EOD conta o saldo só no fechamento do dia; intraday acompanha o lucro aberto na hora.", celula: (p) => drawdownTexto(p) },
  { rotulo: "Limite de perda diário", ajuda: "Bateu, você fica travado até a próxima sessão, mas não perde a conta.", celula: (p, d) => limiteDiarioTexto(p, d) },
  { rotulo: "Consistência", ajuda: "Seu maior dia não pode ser grande demais perto do lucro total.", celula: (p) => consistenciaTexto(p) },
  { rotulo: "Notícia forte", celula: (p) => (p.operaNoticia ? "Liberada" : "Proibida (quebra a conta)") },
  {
    rotulo: "Lote máximo",
    celula: (p, d) => (
      <>
        {d.lotes.minis} minis ou {d.lotes.micros} micros
        <span className="block text-xs text-muted-foreground">{d.escalonamento ? "Começa menor e sobe com o lucro" : "Liberado desde o 1º dia"}</span>
      </>
    ),
  },
  { rotulo: "Pra liberar o saque", celula: (p, d) => lista(criteriosSaque(p, d)) },
  {
    rotulo: "Quanto dá pra sacar",
    ajuda: (c) => `${c.saqueMinimo ? `Mínimo de $${c.saqueMinimo} por pedido. ` : ""}Você fica com ${c.split}%.`,
    celula: (_, d) => lista(maximoTexto(d)),
  },
  { rotulo: "Frequência de saque", celula: (p) => (p.saqueDiario ? "Todos os dias (quando elegível)" : "Quando cumprir os critérios") },
  {
    rotulo: "Bônus ao ir pra Live",
    ajuda: "Pago 1x se você for promovido a conta real e bater a meta lá.",
    celula: (_, d) => (d.liveBonus != null ? usd(d.liveBonus) : "Não tem"),
  },
  {
    rotulo: "Preço de tabela",
    ajuda: (c) => c.ajudaPreco ?? AJUDA_PRECO_PADRAO,
    celula: (p, d) => precoTexto(p, d),
  },
]

export function ComparativoPlanos({ mesa, tamanho }: { mesa: Mesa; tamanho: Tamanho }) {
  const { planos } = mesa
  const ctx: Contexto = { split: mesa.splitTrader, saqueMinimo: mesa.saqueMinimo, ajudaPreco: mesa.ajudaPreco }
  const ajudaDe = (l: { ajuda?: string | ((c: Contexto) => string) }) => (typeof l.ajuda === "function" ? l.ajuda(ctx) : l.ajuda)

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[820px] text-sm border-collapse">
        <thead>
          <tr className="bg-surface">
            <th className="sticky left-0 z-10 bg-surface text-left font-medium text-muted-foreground text-xs px-3 sm:px-4 py-3 w-28 sm:w-44">
              Conta {tamanho}K
            </th>
            {planos.map((p) => (
              <th key={p.id} className="text-left px-3 sm:px-4 py-3 align-bottom min-w-[170px]">
                <span className="block text-base font-semibold">{p.nome}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LINHAS.map((l, linhaIdx) => (
            <tr key={l.rotulo} className="border-t border-border align-top">
              <th
                scope="row"
                className="sticky left-0 bg-background text-left font-medium text-[13px] sm:text-sm px-3 sm:px-4 py-3 w-28 sm:w-44"
              >
                {l.rotulo}
                {l.ajuda && <span className="hidden sm:block text-xs font-normal text-muted-foreground mt-0.5">{ajudaDe(l)}</span>}
              </th>
              {planos.map((p) => {
                const d = dadosDoTamanho(p, tamanho)
                let conteudo: React.ReactNode
                if (!d) conteudo = linhaIdx === 0 ? `Não existe na conta de ${tamanho}K` : "—"
                else {
                  const sobrescrita = celulaDoTamanho(p.celulas?.[l.rotulo], tamanho)
                  conteudo = sobrescrita ? lista(sobrescrita) : l.celula(p, d)
                }
                return (
                  <td key={p.id} className={`px-3 sm:px-4 py-3 ${d ? "text-foreground/90" : "text-muted-foreground"}`}>
                    {conteudo}
                  </td>
                )
              })}
            </tr>
          ))}
          {mesa.linhasExtras?.map((l) => (
            <tr key={l.rotulo} className="border-t border-border align-top">
              <th
                scope="row"
                className="sticky left-0 bg-background text-left font-medium text-[13px] sm:text-sm px-3 sm:px-4 py-3 w-28 sm:w-44"
              >
                {l.rotulo}
                {l.ajuda && <span className="hidden sm:block text-xs font-normal text-muted-foreground mt-0.5">{l.ajuda}</span>}
              </th>
              {planos.map((p) => {
                const itens = dadosDoTamanho(p, tamanho) ? celulaDoTamanho(p.extras?.[l.rotulo], tamanho) : null
                return (
                  <td key={p.id} className={`px-3 sm:px-4 py-3 ${itens ? "text-foreground/90" : "text-muted-foreground"}`}>
                    {itens ? lista(itens) : "—"}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Lado a lado de planos de MESAS diferentes (até 3), usando as mesmas linhas do comparativo de uma mesa só. */
export function ComparativoEntre({ itens, tamanho }: { itens: { mesa: Mesa; plano: Plano }[]; tamanho: Tamanho }) {
  // Cada mesa tem seu split, mínimo de saque e nota de preço: nas ajudas dinâmicas, um texto neutro (o split de cada uma vai numa linha própria).
  const AJUDA_NEUTRA: Record<string, string> = {
    "Quanto dá pra sacar": "Teto de cada pedido de saque, conforme o número do saque.",
    "Preço de tabela": "Sem promoção. Mensalidade é por mês e continua até passar. Promoções mudam toda semana.",
  }
  const ajudaDe = (l: { rotulo?: string; ajuda?: string | ((c: Contexto) => string) }) =>
    typeof l.ajuda === "function" ? (l.rotulo ? AJUDA_NEUTRA[l.rotulo] : undefined) : l.ajuda

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm border-collapse">
        <thead>
          <tr className="bg-surface">
            <th className="sticky left-0 z-10 bg-surface text-left font-medium text-muted-foreground text-xs px-3 sm:px-4 py-3 w-28 sm:w-44">
              Conta {tamanho}K
            </th>
            {itens.map(({ mesa, plano }) => (
              <th key={`${mesa.slug}:${plano.id}`} className="text-left px-3 sm:px-4 py-3 align-bottom min-w-[200px]">
                <span className="block text-xs font-medium text-teal">{mesa.nome}</span>
                <span className="block text-base font-semibold">{plano.nome}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LINHAS.map((l, linhaIdx) => (
            <tr key={l.rotulo} className="border-t border-border align-top">
              <th scope="row" className="sticky left-0 bg-background text-left font-medium text-[13px] sm:text-sm px-3 sm:px-4 py-3 w-28 sm:w-44">
                {l.rotulo}
                {ajudaDe(l) && <span className="hidden sm:block text-xs font-normal text-muted-foreground mt-0.5">{ajudaDe(l)}</span>}
              </th>
              {itens.map(({ mesa, plano }) => {
                const d = dadosDoTamanho(plano, tamanho)
                let conteudo: React.ReactNode
                if (!d) conteudo = linhaIdx === 0 ? `Não existe na conta de ${tamanho}K` : "—"
                else {
                  const sobrescrita = celulaDoTamanho(plano.celulas?.[l.rotulo], tamanho)
                  conteudo = sobrescrita ? lista(sobrescrita) : l.celula(plano, d)
                }
                return (
                  <td key={`${mesa.slug}:${plano.id}`} className={`px-3 sm:px-4 py-3 ${d ? "text-foreground/90" : "text-muted-foreground"}`}>
                    {conteudo}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="border-t border-border align-top">
            <th scope="row" className="sticky left-0 bg-background text-left font-medium text-[13px] sm:text-sm px-3 sm:px-4 py-3 w-28 sm:w-44">
              Você fica com
              <span className="hidden sm:block text-xs font-normal text-muted-foreground mt-0.5">Parte do lucro sacado que fica com você.</span>
            </th>
            {itens.map(({ mesa, plano }) => (
              <td key={`${mesa.slug}:${plano.id}`} className="px-3 sm:px-4 py-3 text-foreground/90">
                {mesa.splitTexto ?? `${mesa.splitTrader}% dos saques`}
              </td>
            ))}
          </tr>
          <tr className="border-t border-border align-top">
            <th scope="row" className="sticky left-0 bg-background text-left font-medium text-[13px] sm:text-sm px-3 sm:px-4 py-3 w-28 sm:w-44">
              Taxa depois de passar
              <span className="hidden sm:block text-xs font-normal text-muted-foreground mt-0.5">Pago uma vez pra liberar a conta financiada.</span>
            </th>
            {itens.map(({ mesa, plano }) => {
              const d = dadosDoTamanho(plano, tamanho)
              return (
                <td key={`${mesa.slug}:${plano.id}`} className="px-3 sm:px-4 py-3 text-foreground/90">
                  {!d ? "—" : d.ativacaoUsd ? usd(d.ativacaoUsd) : "Não tem"}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
