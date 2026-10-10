# MeuTrade — CHECKPOINT 2026-10-09

> **ATUALIZAÇÃO 10/10/2026 — este arquivo é histórico; ler `MEUTRADE-CHECKPOINT-2026-10-10.md` primeiro.** A pendência 1 abaixo (*ordem em empates de saída / `S_ORDER_AMBIGUOUS`*) foi **resolvida pelo commit `83d4408`** (opção 3: a Evidence registra a ordem usada pelo motor, sem mudar resultados) e o E5.3 foi concluído. O texto abaixo foi mantido como estava no fim de 09/10.

> **Para o próximo Claude Code:** leia este arquivo inteiro antes de qualquer ação. Complementa `MEUTRADE-CHECKPOINT-2026-10-08.md` e `-10-01.md` (as decisões e o "NÃO fazer" deles continuam valendo).
> Idioma com o Marcelo: **sempre português brasileiro**, direto, avisando riscos. Na dúvida, perguntar antes. Trabalha em passos pequenos: plano → aprovação → implementação → relatório → revisão.
> Documento público (repo público): **sem P&L real, sem nomes de conta/estratégia, sem dados do usuário**.

## PRÓXIMA SESSÃO → o usuário revisa o visual do Lab e os 2 relatórios, depois decide
**NÃO começar o E5.3 antes da aprovação.** Pendente de decisão do usuário:
1. **Ordem em empates de saída** (achado do E5.2): em trades-linha, `maxDrawdown`, `maxConsecutiveWins/Losses` dependem da ordem de entrada dos dados, que a Evidence não registra. Hoje o V4 marca `S_ORDER_AMBIGUOUS` (⇒ `UNVERIFIABLE`). Opções: manter / desempate determinístico no motor (muda resultados) / registrar a ordem na Evidence.
2. Opcional: tornar `strict` os sub-schemas não-strict do `evidence/1` (hoje o V0 compensa com `V0.unknown-fields`).
3. Depois: E5.3 (validação final + docs), E5b (reexecutar a ingestão no CSV original), E6/G6. Prisma só com contrato validado.

## Estado técnico
| Item | Valor |
|---|---|
| Repo | `Desktop/Projetos AI/TraderOS` (público), `main`, **17 commits locais à frente do `origin/main`**, árvore limpa |
| Commits de 09/10 | `8a190e1` E5.0 · `74f2351` rowHash no fingerprint SOURCE_ROW · `49d6a1c` E5.1 (V0–V2) · `b0392bb` E5.2 (V3/V4) · `b9e7359` Evidence Lab |
| Testes | `npm run test:domain` PASS (todas as suítes; Evidence: verify 26 · verify-math 26 · lab 8 · explain-trade 34 · explain-metric 39) · `tsc --noEmit` PASS · tipos dos `.mts` PASS (comando em `progress.md`/histórico) · ESLint PASS |
| Push / Deploy / Banco / Prisma / Produção | **NENHUM** |

Rodar tudo: `npm run test:domain && npx tsc --noEmit`. Tipos dos testes `.mts`: `npx tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2023,dom --module esnext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --types node scripts/_evidence-fixtures.mts scripts/test-evidence-*.mts` (o `include` do tsconfig NÃO pega `.mts`).

## O que existe agora (Evidence)
- **E5.0**: `TradeEvidence` carrega `r{net,netReason,points}`, `risk.reason`, `pointsPerContract` (aditivo, `evidence/1`). `tradeFingerprintFromEvidence` ≡ `tradeFingerprint` (mesma `fingerprintOf`). `E_DUPLICATE_TRADE_ID` no `explainMetric`.
- **rowHash** entra no fingerprint dos `SOURCE_ROW` (`tradeSetHash` de ciclos inalterado; o de trades-linha mudou; métricas idênticas).
- **`verifyEvidence`** (`src/lib/evidence/verify.ts`, 30 checks fixos, `limitations` sempre presentes): V0 formato (inclui `V0.unknown-fields`), V1 selo (`computeEvidenceHash`), V2 referências, V3 população (`tradeSetHash` refeito), V4 métricas (MESMO `calculateMetricsTraced`/`aggregateTradesTraced` sobre `analyticsTradeFromEvidence`). Status: `INVALID_FORMAT` · `TAMPERED` · `UNVERIFIABLE` · `VALID` (zero FAIL e nenhum SKIPPED bloqueante; só `S_NOT_APPLICABLE` não bloqueia).
- **Evidence Lab** `/dev/evidence-lab` (ver `evidence-lab.md`): só `NODE_ENV=development`; 6 abas; 18 cenários de adulteração reais; guard em 4 camadas (proxy, layout, page, construtores); validado com `next build` + `next start`. Única mexida em auth: exceção em `src/proxy.ts` só com guard aberto.
- Fixtures reais (locais, ignoradas): 5.274 bundles sem falso positivo, 6.303 ataques detectados.

## Decisões do usuário (09/10, não reinterpretar)
- `HASH_ONLY` nunca é `VALID`; V3/V4 `SKIPPED`; âncoras checadas quando possível.
- `evidenceHash` **não é assinatura**; E5 verifica a **população declarada**, não a seleção original; origem = **E5b** (depois).
- Estratégia/sessão sem referência na Evidence ⇒ associação `SKIPPED`, sem nomes em texto aberto, **sem ampliar o schema agora**.
- Versão incompatível ⇒ `UNVERIFIABLE`, nunca `TAMPERED`. Sem tolerância numérica nos valores.
- Lab: sem banco/Prisma, só dados sintéticos, nunca em produção.

## Limites conhecidos (documentados no contrato §14.5–§14.8 e nos testes)
- Campo do `TradeEvidence` que nem o fingerprint nem a métrica do bundle usam (ex.: `pointsPerContract` num bundle de `netPnl`) só é protegido pelo selo.
- Alteração **coordenada** de tudo é consistente (cenário `coordinated` do Lab = `VALID`): só o CSV (E5b) denuncia.
- `groupKey` de grupo por estratégia mostra o nome da estratégia em texto (existe desde o E4).
- `netPnl` não depende da opção `pnlBasis`: trocar a opção não muda o que se reproduz (não é falha).

## O que NÃO fazer
- ❌ E5.3/E5b/E6/G6, Prisma, UI de produto, agente, sem aprovação. ❌ Mudar o motor (desempate por ordem) sem decisão. ❌ Criar segundo motor/hash no verificador. ❌ Dado real no repo público. ❌ push/deploy/banco.

## Dicas operacionais
- Servidor de dev do projeto costuma já estar rodando na porta 3000 (não derrubar; ele recarrega sozinho). Produção local: `npx next build && NODE_ENV=production npx next start -p 3211`; cookie de sessão válido para teste: `encode` de `@auth/core/jwt` com `AUTH_SECRET` e salt `authjs.session-token`.
- Prova "não mudei o motor": script de baseline (hashes, resultados, traces, `TradeEvidence`) antes/depois; ou `git worktree` do commit anterior com symlink do `node_modules`.
- O parser NT8 PT-BR aceita direção `"Comprada"`/`"Venda"` (não "Vendida").
- zsh: aspas em globs; evitar `echo ===`.

## Session Log — 2026-10-09
```text
Último commit:            b9e7359 (Evidence Lab). Base do dia: 88cdad3
Testes:                   test:domain PASS · tsc PASS · tsc dos .mts PASS · ESLint PASS
Fixtures reais:           5.274 bundles verificados, 0 FAIL limpo, 6.303 ataques detectados
Decisões aprovadas:       acima
Pendências:               ordem em empates; sub-schemas não-strict (opcional); E5.3; E5b; E6/G6
Próximo passo:            usuário revisa o Lab e os relatórios e decide
Push / Deploy / Produção: NÃO / NÃO / NÃO tocada
```
