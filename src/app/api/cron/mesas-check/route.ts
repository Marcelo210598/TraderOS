import { NextRequest, NextResponse } from "next/server"
import { notifyAdminsMesas } from "@/lib/admin"
import { kvDisponivel, kvGetJson, kvSetJson } from "@/lib/mesas/kv"
import { ALVOS_MANUAIS, ALVOS_MONITOR, diffLinhas, extrairTexto, hashTexto, tituloDoSlug, urlPermitida, lembreteManualDevido, type AlvoMonitor, type Diferenca } from "@/lib/mesas/monitor"

// Vercel Cron: segundas às 12:00 UTC (9:00 BRT). Configurado em vercel.json.
//
// Baixa as páginas de regras de cada mesa monitorada (Lucid: Help Center; FFF: site), compara com a última versão
// guardada no Redis e, se algo mudou, manda push pros admins. NÃO publica nada e NÃO altera os dados das mesas:
// quem revisa é o Marcelo. Lucid: só o Help Center (o site principal dá 403 Cloudflare e não entra). Sem IA: o diff
// bruto vai na resposta, no log e em `mesas:<mesa>:mudancas`.
//
// `?dry=1`: só lê e compara. Não grava no Redis e não manda push (usar pra testar sem efeito colateral).

export const maxDuration = 60

const CONCORRENCIA = 8
const LIMITE_ERROS_PARA_ALERTA = 5
const MAX_MUDANCAS_GUARDADAS = 20
const MAX_LINHAS_NO_DIFF = 12
const MAX_CHARS_LINHA = 240

interface Snapshot {
  hash: string
  texto: string
  verificadoEm: string
}

type Status = "novo" | "igual" | "mudou" | "erro"

interface Resultado {
  alvo: AlvoMonitor
  id: string
  status: Status
  erro?: string
  diff?: Diferenca
}

interface RegistroMudanca {
  em: string
  id: string
  url: string
  diff: Diferenca
}

// A chave da Lucid mantém o formato original (`mesas:lucid:artigo:<slug>`); as demais seguem o mesmo padrão.
const chaveItem = (mesa: string, id: string) => `mesas:${mesa}:artigo:${id}`
const chaveMudancas = (mesa: string) => `mesas:${mesa}:mudancas`

const encurta = (linhas: string[]) => linhas.slice(0, MAX_LINHAS_NO_DIFF).map((l) => (l.length > MAX_CHARS_LINHA ? `${l.slice(0, MAX_CHARS_LINHA)}…` : l))

async function baixarTexto(url: string): Promise<string> {
  if (!urlPermitida(url)) throw new Error("URL fora da lista permitida")
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MeuTradeMonitor/1.0; +https://meutrade.app)" },
    redirect: "manual", // redirect poderia levar pra fora da lista permitida
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  })
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  const texto = extrairTexto(await res.text())
  if (!texto) throw new Error("sem <article>/<main> (bloqueio ou layout mudou)")
  return texto
}

async function verificar(alvo: AlvoMonitor, id: string, dry: boolean, kv: boolean, agora: string): Promise<Resultado> {
  try {
    const texto = await baixarTexto(alvo.urlDe(id))
    const hash = hashTexto(texto)
    const anterior = kv ? await kvGetJson<Snapshot>(chaveItem(alvo.mesa, id)) : null

    if (!anterior) {
      if (!dry && kv) await kvSetJson(chaveItem(alvo.mesa, id), { hash, texto, verificadoEm: agora } satisfies Snapshot)
      return { alvo, id, status: "novo" }
    }
    if (anterior.hash === hash) return { alvo, id, status: "igual" }

    const diff = diffLinhas(anterior.texto, texto)
    if (!dry) await kvSetJson(chaveItem(alvo.mesa, id), { hash, texto, verificadoEm: agora } satisfies Snapshot)
    return { alvo, id, status: "mudou", diff }
  } catch (err) {
    return { alvo, id, status: "erro", erro: err instanceof Error ? err.message : String(err) }
  }
}

/** Roda `fn` sobre a lista com no máximo `limite` em paralelo, preservando a ordem. */
async function emLotes<T, R>(itens: readonly T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length)
  let proximo = 0
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) {
        const i = proximo++
        saida[i] = await fn(itens[i])
      }
    })
  )
  return saida
}

const plural = (n: number, singular: string, pluralForma: string) => (n === 1 ? singular : pluralForma)

/** Grava o histórico de mudanças da mesa, avisa os admins e devolve quantos pushes saíram. */
async function tratarMesa(alvo: AlvoMonitor, resultados: Resultado[], agora: string): Promise<number> {
  const mudaram = resultados.filter((r) => r.status === "mudou")
  const novos = resultados.filter((r) => r.status === "novo")
  const erros = resultados.filter((r) => r.status === "erro")
  const itemSing = alvo.rotulo === "páginas" ? "página" : "artigo"
  let pushes = 0

  if (mudaram.length > 0) {
    const registros: RegistroMudanca[] = mudaram.map((m) => ({
      em: agora,
      id: m.id,
      url: alvo.urlDe(m.id),
      diff: { removidas: encurta(m.diff!.removidas), adicionadas: encurta(m.diff!.adicionadas) },
    }))
    try {
      const antigos = (await kvGetJson<RegistroMudanca[]>(chaveMudancas(alvo.mesa))) ?? []
      await kvSetJson(chaveMudancas(alvo.mesa), [...registros, ...antigos].slice(0, MAX_MUDANCAS_GUARDADAS))
    } catch (err) {
      console.error(`[mesas-check:${alvo.mesa}] falha ao guardar mudanças`, err)
    }
    console.warn(`[mesas-check:${alvo.mesa}] MUDOU`, JSON.stringify(registros))

    const titulos = mudaram.slice(0, 3).map((m) => tituloDoSlug(m.id))
    const resto = mudaram.length > 3 ? ` e mais ${mudaram.length - 3}` : ""
    pushes += await notifyAdminsMesas(
      `📋 ${alvo.nome} mudou ${mudaram.length} ${plural(mudaram.length, itemSing, alvo.rotulo === "páginas" ? "páginas" : "artigos")}`,
      `${titulos.join(", ")}${resto}. Revise os dados da mesa antes de mantê-los.`,
      `/mesas/${alvo.mesa}`
    )
  } else if (novos.length === resultados.length) {
    // Primeira execução dessa mesa: só criou a base de comparação. Um aviso confirma que o monitor está vivo.
    pushes += await notifyAdminsMesas(
      `✅ Monitor das mesas ativo: ${alvo.nome}`,
      `Base criada com ${novos.length} ${alvo.rotulo}. A partir da próxima semana avisamos se algo mudar.`,
      `/mesas/${alvo.mesa}`
    )
  }

  if (erros.length >= LIMITE_ERROS_PARA_ALERTA) {
    console.error(`[mesas-check:${alvo.mesa}] muitos erros`, JSON.stringify(erros.slice(0, 5).map((e) => ({ id: e.id, erro: e.erro }))))
    pushes += await notifyAdminsMesas(
      `⚠️ Monitor das mesas com falhas: ${alvo.nome}`,
      `${erros.length} de ${resultados.length} ${alvo.rotulo} não puderam ser lidos (ex.: ${erros[0].erro}).`,
      `/mesas/${alvo.mesa}`
    )
  }
  return pushes
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const dry = req.nextUrl.searchParams.get("dry") === "1"
  const kv = kvDisponivel()
  if (!kv && !dry) {
    // Sem Redis não há como comparar com a semana passada; melhor falhar alto do que fingir que checou.
    return NextResponse.json({ error: "Upstash Redis não configurado" }, { status: 500 })
  }

  const agora = new Date().toISOString()
  const tarefas = ALVOS_MONITOR.flatMap((alvo) => alvo.itens.map((id) => ({ alvo, id })))
  const todos = await emLotes(tarefas, CONCORRENCIA, ({ alvo, id }) => verificar(alvo, id, dry, kv, agora))

  let pushes = 0
  const porMesa = []
  for (const alvo of ALVOS_MONITOR) {
    const resultados = todos.filter((r) => r.alvo.mesa === alvo.mesa)
    const mudaram = resultados.filter((r) => r.status === "mudou")
    const novos = resultados.filter((r) => r.status === "novo")
    const erros = resultados.filter((r) => r.status === "erro")
    if (!dry) pushes += await tratarMesa(alvo, resultados, agora)
    porMesa.push({
      mesa: alvo.mesa,
      resumo: {
        total: resultados.length,
        iguais: resultados.length - mudaram.length - novos.length - erros.length,
        mudaram: mudaram.length,
        novos: novos.length,
        erros: erros.length,
      },
      mudancas: mudaram.map((m) => ({ id: m.id, url: alvo.urlDe(m.id), removidas: encurta(m.diff!.removidas), adicionadas: encurta(m.diff!.adicionadas) })),
      erros: erros.map((e) => ({ id: e.id, erro: e.erro })),
    })
  }

  // Mesas que o servidor não consegue ler: lembra o admin de conferir à mão (1x por mês).
  const lembretes: string[] = []
  if (lembreteManualDevido(new Date())) {
    for (const m of ALVOS_MANUAIS) {
      lembretes.push(m.mesa)
      if (!dry) {
        pushes += await notifyAdminsMesas(
          `🔎 Hora de conferir a ${m.nome}`,
          `A leitura automática não funciona (${m.motivo}). Peça pro Claude conferir pelo Chrome: docs/mesas-proprietarias/${m.doc}.`,
          `/mesas/${m.mesa}`
        )
      }
    }
  }

  return NextResponse.json({ dry, pushes, mesas: porMesa, lembretes })
}
