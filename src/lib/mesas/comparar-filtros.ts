// Parte do comparativo entre mesas que roda no navegador (filtros, ordenação e tipos). NÃO importa os dados das mesas,
// pra não levar o catálogo inteiro pro bundle do cliente. A montagem das linhas fica em comparar.ts (servidor).

/** Máximo de planos lado a lado (mais que isso não cabe na tela). */
export const MAX_COMPARAR = 3

export interface LinhaComparar {
  /** Chave estável `mesa:plano`, usada na URL e na seleção. */
  chave: string
  mesaSlug: string
  mesaNome: string
  planoNome: string
  caminho: "avaliacao" | "direto"
  preco: number | null
  /** Prefixo do preço quando há variantes ("a partir de", "Standard"). */
  precoRotulo?: string
  cobranca: "mensal" | "unica"
  /** Taxa paga depois de passar. 0 = não tem. */
  ativacao: number
  meta: number | null
  perdaMaxima: number
  drawdown: string
  drawdownEod: boolean
  limiteDiario: number | null
  /** true = dá pra ficar sem limite diário (não existe, ou a mesa deixa escolher). */
  semLimiteDiario: boolean
  consistencia: string
  semConsistencia: boolean
  saque: string
  /** Maior teto por pedido de saque. null = sem teto fixo ou não informado. */
  tetoSaque: number | null
  /** Quanto fica com o trader, em texto ("90%" ou o texto próprio da mesa). */
  split: string
}

export type Filtro = "semLimite" | "semConsistencia" | "pagamentoUnico" | "semAvaliacao" | "drawdownEod"

export const FILTROS: { id: Filtro; rotulo: string; ajuda: string }[] = [
  { id: "semLimite", rotulo: "Sem limite de perda diário", ajuda: "Inclui planos em que você escolhe ficar sem o limite." },
  { id: "semConsistencia", rotulo: "Sem consistência pra sacar", ajuda: "Seu maior dia não é limitado pelo lucro total na hora de sacar." },
  { id: "pagamentoUnico", rotulo: "Pagamento único", ajuda: "Sem mensalidade: você paga uma vez." },
  { id: "semAvaliacao", rotulo: "Sem avaliação", ajuda: "Você compra já na conta financiada." },
  { id: "drawdownEod", rotulo: "Drawdown EOD", ajuda: "O limite só se ajusta no fechamento do dia (inclui os planos em que você escolhe)." },
]

const REGRAS: Record<Filtro, (l: LinhaComparar) => boolean> = {
  semLimite: (l) => l.semLimiteDiario,
  semConsistencia: (l) => l.semConsistencia,
  pagamentoUnico: (l) => l.cobranca === "unica",
  semAvaliacao: (l) => l.caminho === "direto",
  drawdownEod: (l) => l.drawdownEod,
}

/** Um plano só aparece se passar em TODOS os filtros ligados. */
export const aplicarFiltros = (linhas: readonly LinhaComparar[], ligados: readonly Filtro[]): LinhaComparar[] =>
  linhas.filter((l) => ligados.every((f) => REGRAS[f](l)))

export type Ordem = "padrao" | "preco" | "meta" | "perda" | "teto"

/** null vai sempre pro fim, em qualquer ordem. */
export function ordenar(linhas: readonly LinhaComparar[], ordem: Ordem): LinhaComparar[] {
  if (ordem === "padrao") return [...linhas]
  const valor = (l: LinhaComparar): number | null =>
    ordem === "preco" ? l.preco : ordem === "meta" ? l.meta : ordem === "perda" ? l.perdaMaxima : l.tetoSaque
  // teto e perda maior é melhor pro trader; preço e meta menor é melhor
  const decrescente = ordem === "teto" || ordem === "perda"
  return [...linhas].sort((a, b) => {
    const va = valor(a)
    const vb = valor(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return decrescente ? vb - va : va - vb
  })
}
