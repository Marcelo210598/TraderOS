# MeuTrade — CHECKPOINT 2026-10-12b (E6.1 · `exitBreakdown` por perna)

> Substitui o `-10-12` como ponto de retomada (decisões e "NÃO fazer" dele continuam). Português brasileiro, direto. Repo público: sem dados reais.

## PRÓXIMA SESSÃO → o usuário revisa o E6.1
**Não começar o E6.2 sem a revisão.** Contrato: `data-contract.md` §15.2.

## O que mudou (1 commit local: E6.1)
- `exitBreakdown()` (`src/lib/metrics/legs.ts`): por motivo (TARGET/STOP/MANUAL/UNKNOWN) quantidade, líquido/bruto/comissão/taxas **da origem por perna**, cobertura, contribuição, `legRefs` (`tradeId`+`legIndex`+`rowNos`), `legSetHash`; MIXED é só bucket do trade (E6.0 intacto, `legsInMixedTrades`/`legsInPartialTrades`).
- Conferência perna×trade por campo (RECONCILED / DIVERGENT mostrada / NOT_COMPARABLE) + quantidade + dupla contagem de linhas.
- Sem mudança de schema (`evidence/1`), ingestão, hashes, métricas. Evidence→breakdown idêntico ao do Canonical.

## Limites
Perna não guarda base do P&L (só o trade) ⇒ net/gross só com base conhecida; trades-linha sem pernas ficam fora (contados); motivo = nome da ordem; UNKNOWN ≠ "sem stop".

## Estado técnico
`npm run test:domain` PASS (559) · `tsc` PASS (+`.mts`) · ESLint do escopo PASS · push/deploy/banco/Prisma/produção: **nenhum**.

## Pendente (não fazer sem aprovação)
E6.2 ranking/contribuição/comparação · E6.3 Evidence dos derivados · E6.4 aba no Lab · E6.5 contrato do agente. Sem Vega IA, Prisma, UI de produto.
