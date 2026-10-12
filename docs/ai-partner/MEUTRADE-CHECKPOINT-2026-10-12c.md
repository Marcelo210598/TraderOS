# MeuTrade — CHECKPOINT 2026-10-12c (E6.2 · ranking, contribuição e comparação)

> Substitui o `-10-12b` como ponto de retomada (decisões e "NÃO fazer" anteriores continuam). Português brasileiro, direto. Repo público: sem dados reais.

## PRÓXIMA SESSÃO → o usuário revisa o E6.2
**Não começar o E6.3 sem a revisão.** Contrato: `data-contract.md` §15.3.

## O que mudou (1 commit local: E6.2)
`src/lib/metrics/analysis.ts`: `rankGroups`, `compareGroups`, `comparePeriods`, `exitReasonAnalysis`, `compareExitReasons`, `compareTradeBuckets`, `rankGroupsByExitLegs`. Funções puras sobre o motor/E6.0/E6.1, descritivas (sem p-valor), unidade TRADE × LEG explícita, indisponível = null + motivo, UNKNOWN/MIXED/TINY listados, divergência perna×trade rebaixa a confiança (política do E6.1 mantida), conta/estratégia só como ref. Nenhuma fórmula, hash, schema ou ingestão mudou.

## Estado técnico
`npm run test:domain` PASS (580) · `tsc` PASS (+`.mts`) · ESLint do escopo PASS · push/deploy/banco/Prisma/produção: **nenhum**.

## Pendente (não fazer sem aprovação)
E6.3 Evidence dos derivados (`claim.kind`/`derived[]` aditivos em `evidence/1`, verificador V6, mudança material ⇒ `evidenceHash`) · E6.4 aba no Lab · E6.5 contrato do agente. Sem Vega IA, Prisma, UI de produto.
