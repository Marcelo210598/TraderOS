# Bulenox: o que o cron vigia e o que é conferência manual

## Automático (cron semanal, `/api/cron/mesas-check`)
O site da Bulenox carrega o Help Center e o FAQ de uma **API pública do próprio site** (`https://bulenox.com/cms/items/help_items` e `.../faq_items`). O `robots.txt` deixa essa API aberta de propósito e não há Cloudflare, então o cron lê direto (sem burlar nada). Ele vigia 10 itens: as 9 categorias do Help Center (general, qualification, fast-track, momentum, master, funded, connection, subscription, warning) e o FAQ. Só o texto em inglês entra na comparação (`cmsParaTexto` em `src/lib/mesas/monitor.ts`). Mudou algo → push pros admins; o Marcelo/Claude revisa `src/lib/mesas/bulenox.ts`.

## Manual (lembrete mensal, primeira segunda do mês)
1. **Preços da Qualification** ($145 / $175 / $215 / $325): só existem dentro do JavaScript da página `https://bulenox.com/accounts-pricing` (arquivo `assets/index-*.js`, o nome muda a cada build). Conferir no navegador (Chrome) a página de preços e comparar com `QUAL_PRECO` em `bulenox.ts`. O preço do Fast Track e do Momentum também aparece nas tabelas do Help Center (essas o cron pega).
2. **Metas, drawdown, DLL e contratos da Qualification** (mesma fonte, só na página de preços): `META`, `QUAL_PERDA`, `QUAL_DLL`.
3. **Lista de países restritos** está no FAQ (o cron pega); conferir se o Brasil segue fora.
4. **Comissões:** `https://bulenox.com/legal/Bulenox-Rates.pdf` (data no topo do PDF). Comparar os valores citados nas regras gerais.
5. **Coleções novas na API:** se o Help Center ganhar categoria nova (`/cms/items/help_categories`), acrescentar em `ITENS_BULENOX`.

Ao mudar `bulenox.ts`, atualizar `VERIFICADO` e os textos do quiz (`quiz-bulenox.ts`) que citam a regra.
