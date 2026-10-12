# MeuTrade — CHECKPOINT 2026-10-12 (E6.0 · `exitReason` por trade · `strategyRef`)

> **Para o próximo Claude Code:** leia inteiro antes de agir. Substitui o `-10-10c` como ponto de retomada (decisões e "NÃO fazer" dele continuam valendo). Português brasileiro, direto, avisando riscos. Repo público: **sem P&L real, nomes de conta/estratégia ou dados do usuário**.

## PRÓXIMA SESSÃO → o usuário revisa o E6.0
**Não começar o E6.1 sem a revisão.** Plano aprovado (6 decisões do Marcelo, 12/10): `docs/ai-partner/E6-G6-plano.md`; contrato: `data-contract.md` §15.1.

## O que mudou (1 commit local: E6.0)
- `exitReason` = dimensão (`groupBy`) e filtro. Bucket por trade sobre TODAS as pernas de saída: 1 motivo → ele; ≥2 distintos → `MIXED` (`partial` se algum é `UNKNOWN`); só desconhecidos/sem pernas → `UNKNOWN`. Nunca inferido do P&L. Trades-linha = `UNKNOWN` ("não sei").
- Evidence: `exitReason` é verificável no V4.association (a Evidence já carrega as pernas); veracidade do rótulo continua sendo a do E5b.
- Privacidade: `cycleKey.strategy` → `strategyRef`; filtros de estratégia → refs; trava `E_STRATEGY_NAME_LEAK`. `evidence/1` mantido; `evidenceHash` de bundles novos mudou.
- Nada financeiro mudou: métricas, `tradeSetHash`, `tradeId`, `rowHash` idênticos; 120 hashes de referência, 5.238 VALID/36 UNVERIFIABLE e E5b 273/7/8 (288) iguais ao baseline.

## Estado técnico
| Item | Valor |
|---|---|
| Testes | `npm run test:domain` PASS (+`test-metrics-exit-reason.mts`, 24) · `tsc` PASS · tipos dos `.mts` PASS · ESLint do escopo PASS |
| Push / Deploy / Banco / Prisma / Produção | **NENHUM** |

## Pendente (não fazer sem aprovação)
E6.1 `exitBreakdown` por perna · E6.2 ranking/contribuição/comparação · E6.3 Evidence dos derivados · E6.4 aba no Lab · E6.5 contrato do agente. Sem Vega IA, Prisma, persistência, UI de produto.

## Seis perguntas aprovadas do E6 (escopo fechado)
1. "Perdi mais dinheiro em stops?" 2. "De onde vem meu lucro: targets ou saídas manuais?" 3. "Qual hora, dia da semana, conta, ativo ou sessão rende mais/menos?" 4. "A conta A está melhor que a B?" / "esta semana × a anterior?" 5. "Stops me custam mais R que targets me dão?" (só com stop informado pelo usuário) 6. "Em que condições eu perco mais em stops?" (exitReason × hora/sessão/direção, com cobertura).
