# Tradeify: como conferir se as regras mudaram (manual, pelo Chrome)

**Por quê manual:** `help.tradeify.co` (Help Center, onde ficam as regras) fica atrás de Cloudflare (o servidor recebe 403). Não burlamos anti-robô, então o cron do MeuTrade **não** vigia a Tradeify. Ele só **lembra** o admin por push na primeira segunda-feira de cada mês (`ALVOS_MANUAIS` em `src/lib/mesas/monitor.ts`). A home `tradeify.co` abre por curl, mas não traz as regras.

**Quando:** ao receber o lembrete, ou antes de qualquer campanha em cima da Tradeify.

## Passo a passo (Claude Code + extensão Claude in Chrome)
1. Abrir `https://help.tradeify.co/en/` no Chrome (passa o desafio) e, pela própria aba, ler cada artigo abaixo (`fetch` na mesma origem ou `get_page_text`).
2. Comparar com `tradeify-levantamento-2026-09-29.md` e `src/lib/mesas/tradeify.ts`: preços, metas, drawdown, DLL, tetos de saque, buffers, consistência, escalonamento.
3. Ficar de olho em: mudança de regra por DATA DE COMPRA (o Select mudou em 01/09/2026 e o Lightning em 12/09/2025), lista de países restritos e preços de tabela.
4. Mudou algo? Ajustar `tradeify.ts` (e o quiz, se a regra virou frase) só depois de conferir no oficial. Depois atualizar `VERIFICADO`.

## Artigos-fonte (prefixo `https://help.tradeify.co/en/articles/`)
- 14369021-tradeify-pricing-reference (preços, resets, bundle, comissões)
- 10495915-growth-evaluation-accounts · 11083796-growth-funded-account-payout-policy
- 12853921-select-evaluation-accounts · 12853966-select-flex-and-select-daily-payout-policies
- 10495938-lightning-funded-accounts · 10495932-lightning-funded-account-payout-policy
- 10468320-rules-consistency-rule · 10495897-rules-trailing-max-drawdowns · 10468321-rules-daily-loss-limit
- 10495874-rules-news-trading · 10495876-rules-permitted-times-to-trade · 10495888-rules-restricted-countries
- 12268167-essential-trading-rules-overview · 12969284-tradeify-elite-program · 14135902-tradeify-3-0-program-updates-improvements
- 16497699-300k-select-account (fora da comparação; só pra ver se virou público)

Coleções pra caçar artigo novo: 11501718 (getting-started), 11501721 (accounts-rules), 11501859 (payouts-billing), 15386667 (live-accounts).
