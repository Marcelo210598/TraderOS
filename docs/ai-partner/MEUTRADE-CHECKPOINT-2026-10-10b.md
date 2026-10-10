# MeuTrade — CHECKPOINT 2026-10-10b (E5b)

> **ATUALIZAÇÃO (mesmo dia, depois):** as decisões abertas abaixo foram tratadas — contexto reproduzível (`233d887`), aba do E5b no Lab (`f5ab85f`) e plano E6/G6. Ver `MEUTRADE-CHECKPOINT-2026-10-10c.md`. O texto abaixo foi mantido como estava.

> **Para o próximo Claude Code:** leia este arquivo inteiro antes de qualquer ação. Substitui o `-10-10` como ponto de retomada (ele e o `-10-09` ficam como histórico; as decisões e o "NÃO fazer" dos anteriores continuam valendo).
> Idioma com o Marcelo: **sempre português brasileiro**, direto, avisando riscos. Na dúvida, perguntar antes. Passos pequenos: plano → aprovação → implementação → relatório → revisão.
> Documento público (repo público): **sem P&L real, sem nomes de conta/estratégia, sem dados do usuário**.

## PRÓXIMA SESSÃO → o usuário revisa o E5b e decide a sequência
**NÃO começar E6/G6, integração do agente, Prisma, persistência nem UI pública sem aprovação.** Decisões abertas: (1) E6/G6 (grupos, comparações, motivo de saída) e a integração do AI Trading Partner; (2) expor o E5b no Evidence Lab (hoje fora do escopo); (3) se vale gravar no `ImportRecord` a versão das funções de identidade e o `foldPolicy`/`exitReasonMap` efetivos (tornaria a reprodução autocontida; exige decisão por mexer no registro).

## O que existe agora (E5b)
`verifyEvidenceSource(bundle, files, options?)` em `src/lib/evidence/verify-source.ts` — `files` = `importId → bytes` (Record ou Map); `options` = `{ accountRefSalt?, foldPolicy?, exitReasonMap?, parsers? }`. Relatório `verify-source/1`: 8 checks (`V5.format`, `V5.file`, `V5.context`, `V5.import-id`, `V5.rows`, `V5.trades`, `V5.values`, `V5.coverage`), `coverage`, `limitations`. Estados: `SOURCE_VERIFIED` · `SOURCE_VERIFIED_PARTIAL` · `UNVERIFIABLE` · `SOURCE_MISMATCH` · `INVALID_FORMAT`. Detalhe e limites: `data-contract.md` §14.11.
- Reusa o pipeline, `describeText`/`sha256Hex`, `explainTrades` e `canonicalJson`; sem segundo pipeline/hash; sem caminho de arquivo, banco, relógio ou random; o CSV nunca entra no bundle nem no relatório.
- **Achados da auditoria:** `fileSha256` = hash do TEXTO UTF-8 (bytes exatos = UTF-8 estrito + BOM preservado + round-trip); `accountRefSalt`/`foldPolicy`/`exitReasonMap` não estão no bundle (opções do chamador); só comparar ids não pega a forja coordenada (P&L alterado e tudo regenerado mantém `rowHash`/`tradeId` do CSV) ⇒ o E5b também compara os valores derivados do arquivo.
- **O que NÃO prova:** seleção original, ordem original da sequência, R/stop/issues/fieldProvenance (acrescentados depois), população completa em `HASH_ONLY`, selo/consistência interna (isso é o `verifyEvidence`).

## Estado técnico
| Item | Valor |
|---|---|
| Repo | `Desktop/Projetos AI/TraderOS` (público), `main`, 23 commits locais à frente do `origin/main`, árvore limpa |
| Commits | E5b (commit exclusivo) · `9776251`/`8e893a2` E5.3 · `83d4408` ordem da sequência · anteriores no checkpoint 10/10 |
| Testes | `npm run test:domain` PASS (+ `test-evidence-source.mts` 25) · `tsc --noEmit` PASS · tipos dos `.mts` PASS · ESLint do escopo PASS |
| Motor / V0–V4 | 120 hashes de referência idênticos; V0–V4 com os mesmos resultados (5.238 VALID / 36 UNVERIFIABLE; 7.536 ataques detectados) |
| Push / Deploy / Banco / Prisma / Produção | **NENHUM** |

Rodar tudo: `npm run test:domain && npx tsc --noEmit`. Tipos dos `.mts`: `npx tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2023,dom --module esnext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --types node scripts/_evidence-fixtures.mts scripts/test-evidence-*.mts`. Lint conhecido fora do escopo (já existia): `scripts/test-evidence-lab.mts:130`, `scripts/test-evidence-verify.mts:9`, `src/lib/gamification.ts:2`.

## Resultados do E5b (fixtures NT8 PT-BR reais locais; contexto só do `ImportRef`)
- 288 bundles: **273 SOURCE_VERIFIED · 7 SOURCE_VERIFIED_PARTIAL · 8 UNVERIFIABLE (HASH_ONLY sem nenhuma âncora ⇒ sem referência a ligar) · 0 SOURCE_MISMATCH · 0 INVALID_FORMAT**.
- **17 ciclos + 34 trades-linha** distintos, **34 linhas** `(importId,rowNo,rowHash)`, arquivo (`fileSha256`), `importId`, reconstrução/granularidade e valores conferidos; reexecução determinística. 0 divergências de `importId`/`rowHash`/`tradeId`/valores em bundle limpo.
- 552 ataques em amostra (rowHash, tradeId, linha inexistente, P&L, preço, importId, 1 byte do arquivo, BOM), 552 detectados. Sintético: 25 testes (18 cenários pedidos + formato, determinismo, privacidade, fonte, não regressão, reais); 4 mutações do verificador, todas pegas.

## Decisões do usuário em vigor (não reinterpretar)
- Não alterar a ordenação do motor (instante de saída; desempate = posição no array de entrada) nem criar desempate novo. `HASH_ONLY` nunca é `VALID` nem alega população completa. `evidenceHash` não é assinatura. Sem tolerância numérica. Lab sem banco/Prisma e **fora do escopo do E5b**.
- Estratégia/sessão sem referência na Evidence ⇒ associação `SKIPPED`, sem ampliar o schema.

## Opcionais futuros (não bloqueiam)
- Lab: cenário visual de *ordem trocada com selo recalculado* e, se aprovado, painel do E5b.
- Provar a seleção original: reaplicar os filtros declarados ao conjunto reingerido (E5c, a decidir).
- Tornar `strict` os sub-schemas herdados do Canonical.

## O que NÃO fazer
- ❌ E6/G6, agente, Prisma, persistência, UI de produto, **sem aprovação**. ❌ Mudar o motor. ❌ Segundo motor/pipeline/hash. ❌ Dado real (CSV, contas, P&L) no repo público. ❌ push/deploy/banco.

## Dicas operacionais
- Fixtures reais: `fixtures/ninjatrader/trade-performance/*.csv` + `.context.json` (locais, ignoradas). Para verificar origem em teste, passe os BYTES (`readFileSync` sem `"utf8"`) e **não** use o `context.json` na verificação (o contexto sai do `ImportRef`).
- O gerador sintético colapsa linhas "parecidas" e rejeita saída antes da entrada: use dias distintos e confira `trades.length`. Todos os trades sintéticos são LONG (agrupar por direção não divide a população).
- Dev server costuma estar na porta 3000 (não derrubar). zsh: aspas em globs.

## Session Log — 2026-10-10 (E5b)
```text
Commit:                   E5b (exclusivo)
Testes:                   test:domain PASS · tsc PASS · tsc dos .mts PASS · ESLint (escopo) PASS
Motor:                    120 hashes de referência idênticos; V0–V4 inalterados
Fixtures reais:           288 bundles → 273 verificados, 7 parciais, 8 sem referência, 0 divergências; 17 ciclos + 34 trades-linha; 552/552 ataques
Pendências:               revisão do E5b; decidir E6/G6, integração do agente, Lab
Push / Deploy / Produção: NÃO / NÃO / NÃO tocada
```
