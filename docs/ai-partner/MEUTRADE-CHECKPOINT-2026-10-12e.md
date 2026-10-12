# MeuTrade — CHECKPOINT 2026-10-12e (E5b para derivados · E6.4 Evidence Lab)

> Substitui o `-10-12d` como ponto de retomada (decisões e "NÃO fazer" anteriores continuam). Português brasileiro, direto. Repo público: sem dados reais.

## PRÓXIMA SESSÃO → o usuário revisa E5b-derivados e E6.4
**Não começar o E6.5 sem a revisão.** Contratos: `data-contract.md` §14.13 (E5b), §15.5 e `evidence-lab.md` (aba Derivados).

## O que mudou (2 commits locais)
1. **E5b para derivados** — `V5.derived` + `coverage.derived`: população FULL do derivado conferida contra o CSV (trades + pernas citadas); HASH_ONLY/ids ausentes = parcial; escopo = população DECLARADA (`L_DERIVED_POPULATION_SCOPE`, só com derivados). Bundles sem derivados: idêntico (5 limitações; 273/8/7).
2. **E6.4** — aba `?tab=derived` no Evidence Lab: 17 cenários reais (sem JSON estático), V6 com os 8 checks, unidades TRADE/LEG separadas, confiança/limitações em PT, E5b do mesmo bundle, navegação até os TradeEvidence, rótulos de origem nunca exibidos, sem endpoint novo. Produção: anônimo 307 /login, logado 404 (verificado em build+start numa cópia apagada).

## Pendências para decidir ANTES da integração do agente
- Minimizar/substituir o `sourceLabel` (e `entryLabel/exitLabel`) nos `TradeEvidence`, mantendo a verificação de origem (E5b depende deles). Nenhum bundle completo vai à Vega IA.

## Estado técnico
`npm run test:domain` PASS · `tsc` PASS (+`.mts`) · ESLint do escopo PASS · push/deploy/banco/Prisma/produção: **nenhum**.

## Pendente (não fazer sem aprovação)
E6.5 contrato do agente (só desenho) · E5c · Vega IA · Prisma · persistência · UI de produto.
