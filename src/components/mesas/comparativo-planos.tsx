import { usd, type DadosTamanho, type Plano, type Tamanho } from "@/lib/mesas"

const DRAWDOWN_LABEL = { EOD: "Fim do dia (EOD)", INTRADAY: "Intraday" } as const

const drawdownTexto = (p: Plano) => {
  if (p.caminho === "direto") return `${DRAWDOWN_LABEL[p.drawdown.financiada]} (já financiada)`
  const aval = p.drawdown.avaliacao === "ESCOLHA" ? "Você escolhe" : DRAWDOWN_LABEL[p.drawdown.avaliacao as "EOD" | "INTRADAY"]
  return p.drawdown.avaliacao === p.drawdown.financiada
    ? aval
    : `Avaliação: ${aval} · Financiada: ${DRAWDOWN_LABEL[p.drawdown.financiada]}`
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
  if (p.id === "flex" || p.id === "daily") linhas.push("Lucro líquido positivo desde o último saque")
  return linhas
}

const maximoTexto = (d: DadosTamanho) =>
  d.saque.maximos.map((m) => {
    if (m.valor == null) return `${m.rotulo}: todo o lucro acima do colchão`
    if (m.pctDoLucro) return `${m.rotulo}: ${m.pctDoLucro}% do lucro, até ${usd(m.valor)}`
    return `${m.rotulo}: até ${usd(m.valor)}`
  })

interface Linha {
  rotulo: string
  ajuda?: string | ((splitTrader: number) => string)
  celula: (p: Plano, d: DadosTamanho) => React.ReactNode
}

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
  {
    rotulo: "Pra liberar o saque",
    celula: (p, d) => (
      <ul className="space-y-1">
        {criteriosSaque(p, d).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    ),
  },
  {
    rotulo: "Quanto dá pra sacar",
    ajuda: (split) => `Mínimo de $500 por pedido. Você fica com ${split}%.`,
    celula: (_, d) => (
      <ul className="space-y-1">
        {maximoTexto(d).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    ),
  },
  { rotulo: "Frequência de saque", celula: (p) => (p.saqueDiario ? "Todos os dias (quando elegível)" : "Quando cumprir os critérios") },
  {
    rotulo: "Bônus ao ir pra Live",
    ajuda: "Pago 1x se você for promovido a conta real e bater a meta lá.",
    celula: (_, d) => (d.liveBonus != null ? usd(d.liveBonus) : "Não tem"),
  },
  {
    rotulo: "Preço de tabela",
    ajuda: "Sem promoção. O valor final muda toda semana — confira no site.",
    celula: (_, d) => (d.precoTabelaUsd != null ? `${usd(d.precoTabelaUsd)}` : "Varia pela configuração"),
  },
]

export function ComparativoPlanos({ planos, tamanho, splitTrader }: { planos: Plano[]; tamanho: Tamanho; splitTrader: number }) {
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
          {LINHAS.map((l) => (
            <tr key={l.rotulo} className="border-t border-border align-top">
              <th scope="row" className="sticky left-0 bg-background text-left font-medium text-[13px] sm:text-sm px-3 sm:px-4 py-3 w-28 sm:w-44">
                {l.rotulo}
                {l.ajuda && (
                  <span className="hidden sm:block text-xs font-normal text-muted-foreground mt-0.5">
                    {typeof l.ajuda === "function" ? l.ajuda(splitTrader) : l.ajuda}
                  </span>
                )}
              </th>
              {planos.map((p) => (
                <td key={p.id} className="px-3 sm:px-4 py-3 text-foreground/90">
                  {l.celula(p, p.tamanhos[tamanho])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
