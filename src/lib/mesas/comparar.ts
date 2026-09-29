// Comparativo ENTRE mesas (/mesas/comparar): uma linha por plano no tamanho escolhido, montada só com os dados que já
// estão em cada mesa (nada novo é inventado aqui). Funções puras: testáveis em scripts/test-comparar-mesas.mts.

import { MESAS, celulaDoTamanho, getMesa } from "./index"
import { MAX_COMPARAR, type LinhaComparar } from "./comparar-filtros"
import type { Mesa, Plano, Tamanho } from "./types"

export * from "./comparar-filtros"

const DRAWDOWN = { EOD: "Fim do dia (EOD)", INTRADAY: "Intraday", ESCOLHA: "Você escolhe" } as const

const drawdownTexto = (p: Plano) => {
  if (p.caminho === "direto") return DRAWDOWN[p.drawdown.financiada]
  const aval = p.drawdown.avaliacao === null ? "" : DRAWDOWN[p.drawdown.avaliacao]
  return p.drawdown.avaliacao === p.drawdown.financiada ? aval : `${aval} na avaliação · ${DRAWDOWN[p.drawdown.financiada]} na financiada`
}

const consistenciaTexto = (p: Plano) => {
  const { avaliacao, financiada } = p.consistencia
  if (avaliacao == null && financiada == null) return "Não tem"
  if (p.caminho === "direto") return `Saque: ${financiada}%`
  return [avaliacao != null ? `Avaliação: ${avaliacao}%` : "Avaliação: não tem", financiada != null ? `Saque: ${financiada}%` : "Saque: não tem"].join(" · ")
}

/** Texto curto da frequência de saque: a frase própria do plano quando existe, senão uma derivada dos dados. */
const saqueTexto = (p: Plano, t: Tamanho): string => {
  if (p.saqueDiario) return "Todos os dias (quando elegível)"
  const propria = celulaDoTamanho(p.celulas?.["Frequência de saque"], t)?.[0]
  return propria ?? "Quando cumprir os critérios"
}

export function linhasComparar(tamanho: Tamanho, mesas: readonly Mesa[] = MESAS): LinhaComparar[] {
  const linhas: LinhaComparar[] = []
  for (const mesa of mesas) {
    for (const p of mesa.planos) {
      const d = p.tamanhos[tamanho]
      if (!d) continue // o plano não existe nesse tamanho
      const tetos = d.saque.maximos.map((m) => m.valor).filter((v): v is number => v != null)
      const semTeto = d.saque.maximos.some((m) => m.valor == null)
      linhas.push({
        chave: `${mesa.slug}:${p.id}`,
        mesaSlug: mesa.slug,
        mesaNome: mesa.nome,
        planoNome: p.nome,
        caminho: p.caminho,
        preco: d.precoTabelaUsd,
        precoRotulo: d.precoRotulo,
        cobranca: p.cobranca ?? "unica",
        ativacao: d.ativacaoUsd ?? 0,
        meta: d.metaAvaliacao,
        perdaMaxima: d.perdaMaxima,
        drawdown: drawdownTexto(p),
        drawdownEod: p.drawdown.financiada === "EOD" || p.drawdown.financiada === "ESCOLHA",
        limiteDiario: d.limiteDiario,
        semLimiteDiario: d.limiteDiario == null || p.dllOpcional,
        consistencia: consistenciaTexto(p),
        semConsistencia: p.consistencia.financiada == null,
        saque: saqueTexto(p, tamanho),
        tetoSaque: semTeto || tetos.length === 0 ? null : Math.max(...tetos),
        split: mesa.splitTexto ?? `${mesa.splitTrader}%`,
      })
    }
  }
  return linhas
}

/** Lê `?planos=mesa:plano,mesa:plano` com segurança: só aceita planos que existem, sem repetir, até MAX_COMPARAR. */
export function parsePlanos(raw: string | string[] | undefined): { mesa: Mesa; plano: Plano }[] {
  const texto = Array.isArray(raw) ? raw[0] : raw
  if (!texto) return []
  const vistos = new Set<string>()
  const saida: { mesa: Mesa; plano: Plano }[] = []
  for (const chave of texto.split(",")) {
    const [slug, id, ...resto] = chave.split(":")
    if (!slug || !id || resto.length > 0 || vistos.has(chave)) continue
    const mesa = getMesa(slug)
    const plano = mesa?.planos.find((p) => p.id === id)
    if (!mesa || !plano) continue
    vistos.add(chave)
    saida.push({ mesa, plano })
    if (saida.length === MAX_COMPARAR) break
  }
  return saida
}

