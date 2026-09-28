# Apex: como conferir se as regras mudaram (manual, pelo Chrome)

**Por quê manual:** `apextraderfunding.com` e o suporte ficam atrás de Cloudflare (o servidor recebe 403). Não burlamos anti-robô, então o cron do MeuTrade **não** vigia a Apex. O que ele faz é **lembrar** o admin por push na primeira segunda-feira de cada mês (`ALVOS_MANUAIS` em `src/lib/mesas/monitor.ts`).

**Quando:** ao receber o lembrete, ou antes de qualquer campanha em cima da Apex.

## Passo a passo (feito pelo Claude Code com a extensão Claude in Chrome conectada)
1. Abrir uma aba em `https://apextraderfunding.com/`.
2. Definir o leitor no console da aba (mesmo extrator do marco zero, pra o hash bater):
```js
window.__lerPagina = async (u) => {
  const r = await fetch(u, { credentials: 'same-origin' })
  const h = await r.text()
  const d = new DOMParser().parseFromString(h, 'text/html')
  d.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((e) => e.remove())
  const c = d.querySelector('article') || d.querySelector('main') || d.body
  const t = (c.innerText || c.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim()
  return { status: r.status, len: t.length, texto: t }
}
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('')
```
3. Pra cada linha de `fontes/apex-hashes-2026-09-28.txt` (ou a versão mais nova), ler `https://apextraderfunding.com/help-center/<caminho>/`, calcular `sha(texto).slice(0, 16)` e comparar. Pausar ~300 ms entre requisições e não passar de 1 leitura por vez.
4. Artigo com hash diferente = **mudou**. Ler o texto novo, comparar com `apex-levantamento-*.md` e ajustar `src/lib/mesas/apex.ts` (números, regras, texto) só depois de conferir.
5. Conferir também o **seletor de preços da home** (preços de tabela e taxa de ativação, 16 combinações: EOD/Intraday × Standard/No Activation Fee × 4 tamanhos) e a **lista de países restritos**.
6. Artigo novo no Help Center (`/hc-category/...`)? Acrescentar ao arquivo de hashes.
7. Atualizar `fontes/apex-hashes-<data>.txt` e o `verificadoEm` em `apex.ts`; commit + deploy.

Observação: o texto de cada artigo NÃO fica no Git (é conteúdo de terceiros). Só as impressões digitais e o nosso resumo (`apex-levantamento-*.md`).
