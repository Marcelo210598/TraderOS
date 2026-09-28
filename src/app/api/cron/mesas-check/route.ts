import { NextRequest, NextResponse } from "next/server"
import { notifyAdminsMesas } from "@/lib/admin"
import { kvDisponivel, kvGetJson, kvSetJson } from "@/lib/mesas/kv"
import { ARTIGOS_LUCID, diffLinhas, extrairTexto, hashTexto, tituloDoSlug, urlArtigo, urlPermitida, type Diferenca } from "@/lib/mesas/monitor"

// Vercel Cron: segundas às 12:00 UTC (9:00 BRT). Configurado em vercel.json.
//
// Baixa os artigos de regras do Help Center da Lucid, compara com a última versão guardada no Redis e,
// se algum mudou, manda push pros admins. NÃO publica nada e NÃO altera lucid.ts: quem revisa é o Marcelo.
// Só o Help Center (o site principal dá 403 Cloudflare e não entra). Sem IA: o diff bruto vai na resposta,
// no log e em `mesas:lucid:mudancas`.
//
// `?dry=1`: só lê e compara. Não grava no Redis e não manda push (usar pra testar sem efeito colateral).

export const maxDuration = 60

const CONCORRENCIA = 5
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
  slug: string
  status: Status
  erro?: string
  diff?: Diferenca
}

interface RegistroMudanca {
  em: string
  slug: string
  url: string
  diff: Diferenca
}

const chaveArtigo = (slug: string) => `mesas:lucid:artigo:${slug}`
const CHAVE_MUDANCAS = "mesas:lucid:mudancas"

const encurta = (linhas: string[]) => linhas.slice(0, MAX_LINHAS_NO_DIFF).map((l) => (l.length > MAX_CHARS_LINHA ? `${l.slice(0, MAX_CHARS_LINHA)}…` : l))

async function baixarTexto(slug: string): Promise<string> {
  const url = urlArtigo(slug)
  if (!urlPermitida(url)) throw new Error("URL fora da lista permitida")
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MeuTradeMonitor/1.0; +https://meutrade.app)" },
    redirect: "manual", // redirect poderia levar pra fora do host permitido
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  })
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  const texto = extrairTexto(await res.text())
  if (!texto) throw new Error("sem <article> (bloqueio ou layout mudou)")
  return texto
}

async function verificar(slug: string, dry: boolean, kv: boolean, agora: string): Promise<Resultado> {
  try {
    const texto = await baixarTexto(slug)
    const hash = hashTexto(texto)
    const anterior = kv ? await kvGetJson<Snapshot>(chaveArtigo(slug)) : null

    if (!anterior) {
      if (!dry && kv) await kvSetJson(chaveArtigo(slug), { hash, texto, verificadoEm: agora } satisfies Snapshot)
      return { slug, status: "novo" }
    }
    if (anterior.hash === hash) return { slug, status: "igual" }

    const diff = diffLinhas(anterior.texto, texto)
    if (!dry) await kvSetJson(chaveArtigo(slug), { hash, texto, verificadoEm: agora } satisfies Snapshot)
    return { slug, status: "mudou", diff }
  } catch (err) {
    return { slug, status: "erro", erro: err instanceof Error ? err.message : String(err) }
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
  const resultados = await emLotes(ARTIGOS_LUCID, CONCORRENCIA, (slug) => verificar(slug, dry, kv, agora))

  const mudaram = resultados.filter((r) => r.status === "mudou")
  const novos = resultados.filter((r) => r.status === "novo")
  const erros = resultados.filter((r) => r.status === "erro")
  const resumo = { total: resultados.length, iguais: resultados.length - mudaram.length - novos.length - erros.length, mudaram: mudaram.length, novos: novos.length, erros: erros.length }

  let pushes = 0
  if (!dry) {
    if (mudaram.length > 0) {
      const registros: RegistroMudanca[] = mudaram.map((m) => ({
        em: agora,
        slug: m.slug,
        url: urlArtigo(m.slug),
        diff: { removidas: encurta(m.diff!.removidas), adicionadas: encurta(m.diff!.adicionadas) },
      }))
      try {
        const antigos = (await kvGetJson<RegistroMudanca[]>(CHAVE_MUDANCAS)) ?? []
        await kvSetJson(CHAVE_MUDANCAS, [...registros, ...antigos].slice(0, MAX_MUDANCAS_GUARDADAS))
      } catch (err) {
        console.error("[mesas-check] falha ao guardar mudanças", err)
      }
      console.warn("[mesas-check] MUDOU", JSON.stringify(registros))

      const titulos = mudaram.slice(0, 3).map((m) => tituloDoSlug(m.slug))
      const resto = mudaram.length > 3 ? ` e mais ${mudaram.length - 3}` : ""
      pushes = await notifyAdminsMesas(
        `📋 Lucid mudou ${mudaram.length} artigo${mudaram.length > 1 ? "s" : ""} do Help Center`,
        `${titulos.join(", ")}${resto}. Revise o lucid.ts antes de manter os dados.`,
        "/mesas/lucid"
      )
    } else if (novos.length === resultados.length) {
      // Primeira execução: só criou a base de comparação. Um aviso confirma que o monitor está vivo.
      pushes = await notifyAdminsMesas("✅ Monitor das mesas ativo", `Base criada com ${novos.length} artigos da Lucid. A partir da próxima semana avisamos se algo mudar.`)
    }

    if (erros.length >= LIMITE_ERROS_PARA_ALERTA) {
      console.error("[mesas-check] muitos erros", JSON.stringify(erros.slice(0, 5)))
      pushes += await notifyAdminsMesas("⚠️ Monitor das mesas com falhas", `${erros.length} de ${resultados.length} artigos não puderam ser lidos (ex.: ${erros[0].erro}).`)
    }
  }

  return NextResponse.json({
    dry,
    resumo,
    pushes,
    mudancas: mudaram.map((m) => ({ slug: m.slug, url: urlArtigo(m.slug), removidas: encurta(m.diff!.removidas), adicionadas: encurta(m.diff!.adicionadas) })),
    erros: erros.map((e) => ({ slug: e.slug, erro: e.erro })),
  })
}
