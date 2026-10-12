# MeuTrade — CHECKPOINT 2026-10-12d (E6.3 · Evidence dos derivados · V6)

> Substitui o `-10-12c` como ponto de retomada (decisões e "NÃO fazer" anteriores continuam). Português brasileiro, direto. Repo público: sem dados reais.

## PRÓXIMA SESSÃO → o usuário revisa o E6.3
**Não começar o E6.4 sem a revisão.** Contrato: `data-contract.md` §15.4.

## O que mudou (1 commit local: E6.3)
- `evidence/1` ganha, de forma ADITIVA, `evidence.derived?` + `claim.kind/subject.type = DERIVED`. Bundles sem derivados têm o MESMO `evidenceHash`; com derivados o selo é novo (esperado).
- `explainDerived` + `derivedEvidenceBundle` (visão por refs; conta/estratégia só como ref; trava fail-closed) e núcleo único `derived.ts` (spec, `computeDerived`, resumo, diff).
- **V6** no `verifyEvidence` (8 checks; catálogo 31 → 39): reexecuta as funções REAIS do E6.2 sobre os TradeEvidence e compara (valores, deltas/contribuições/posições, amostra/cobertura/confidence/limitations/reconciliação, refs, determinismo). HASH_ONLY / versão / dimensão sem referência ⇒ SKIPPED (nunca PASS) ⇒ UNVERIFIABLE; FAIL só para inconsistência detectada.
- Nenhuma fórmula, `tradeSetHash`, `tradeId`/`importId`/`rowHash`, métrica, bucket, breakdown ou resultado do E6.2 mudou.

## Pontos para decisão (não resolvidos de propósito)
1. `sourceLabel` (e `sourceRows[].entryLabel/exitLabel`) já estão nos TradeEvidence desde o E3 (o E5b precisa deles). O derivado não os replica; se forem sensíveis, remover/hashear é uma decisão separada (muda E3, E5b e hash).
2. O E5b só olha `metrics[]` para "população completa": conservador para bundles só com derivados.

## Estado técnico
`npm run test:domain` PASS (600) · `tsc` PASS (+`.mts`) · ESLint do escopo PASS · push/deploy/banco/Prisma/produção: **nenhum**.

## Pendente (não fazer sem aprovação)
E6.4 aba no Evidence Lab · E6.5 contrato do agente. Sem Vega IA, Prisma, persistência, UI de produto.
