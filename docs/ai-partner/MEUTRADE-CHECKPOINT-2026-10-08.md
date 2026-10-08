# MeuTrade — CHECKPOINT 2026-10-08

> **Para o próximo Claude Code:** leia este arquivo inteiro antes de qualquer ação. Complementa (não substitui) `MEUTRADE-CHECKPOINT-2026-10-01.md` — as decisões e o "NÃO fazer" daquele continuam valendo.
> Idioma com o usuário (Marcelo): **sempre português brasileiro**, direto, sem enrolação, avisando riscos. Na dúvida, perguntar antes.
> Este documento é público (repositório público): **sem P&L real, sem nomes de conta/estratégia, sem dados do usuário**.

## PRÓXIMA SESSÃO → apresentar o plano do **E5 (`verifyEvidence`)** e esperar aprovação

E1, E2, E3 e E4 estão **concluídos e revisados** (E4 entregue, revisão do usuário ainda pendente — ver §6). Não implementar nada do E5 antes do plano ser aprovado. O usuário trabalha em passos pequenos: plano → aprovação → implementação → relatório → revisão.

## 1. Estado técnico (fim da sessão)

| Item | Valor |
|---|---|
| Repo | `Desktop/Projetos AI/TraderOS` (público), branch `main`, **11 commits locais à frente do `origin/main`**, árvore limpa |
| Commits de hoje | `fa19969` E1 · `26674d0` E2 · `272a0be` E3 · `d0b1813` ajuste fileName · `c77ddbb` E4 |
| `npm run test:domain` | **PASS** (16 suítes). Evidence: identity 20 · schema 14 · explain-trade 31 · explain-metric 32 |
| `tsc --noEmit` / ESLint (`src/lib/{ingest,domain,metrics,infra,evidence}`) | **PASS** |
| Tipos dos testes `.mts` | conferir com `tsconfig` temporário (estende o do projeto; apagar depois) — **PASS** |
| Push / Deploy / Banco / Prisma / Produção | **NENHUM** |

Rodar tudo: `npm run test:domain && npx tsc --noEmit`. Testes: `scripts/test-*.mts` (Node 24 strip-only: **sem enums e sem parameter properties**; imports com `.ts`).

## 2. Cadeia de Evidence (o que existe)

```text
CSV → pipeline (identity: importId, rowHash, tradeId, account.ref) → CanonicalTrade
CanonicalTrade + ImportRecord ──explainTrade──► TradeEvidence + ImportRef
MetricsResult + trace (mesma passada do motor) ──explainMetric──► MetricEvidence (+ TradeEvidence + ImportRef)
EvidenceBundle { schema:"evidence/1", claim, subject, evidence{imports,trades,metrics}, evidenceHash }
```

| Módulo | Papel |
|---|---|
| `src/lib/infra/hash.ts` | único ponto com `node:crypto`: `sha256Hex`, `canonicalJson`, `hashCanonical` |
| `src/lib/ingest/identity.ts` | `importId` (arquivo+parser+settings), `rowHash` (conteúdo da linha, sem nº nem acumulado), `tradeId` (import+granularidade+reconstrução+rowHashes+ordinal), `accountRef`, `ImportRecord` |
| `src/lib/evidence/hash.ts` | `tradeFingerprint`, **`tradeSetHash` (SHA-256, população COMPLETA)**, `computeEvidenceHash`/`sealEvidence` |
| `src/lib/evidence/schema.ts` | schema `evidence/1` (tudo `strict`) |
| `src/lib/evidence/redact.ts` | `redactReconstruction`, `redactFileName`, trava `findAccountNameLeak` |
| `src/lib/evidence/explain-trade.ts` | `explainTrade`, `explainTrades` |
| `src/lib/evidence/explain-metric.ts` | `explainMetric`, `metricEvidenceBundle` |
| `src/lib/metrics/trace.ts` | `TraceBuilder`, 18 papéis fechados, `*Traced` em `calculate.ts` |

Detalhe completo: `data-contract.md` §14 (14.1 E1, 14.2 E2, 14.3 E3, 14.4 E4).

## 3. Decisões aprovadas (não reinterpretar)

- Evidence **não é segunda fonte de verdade**; **não fabrica identidade** (trade/população sem `tradeId`/`importId` ⇒ `E_IDENTITY_MISSING` / `E_POPULATION_IDENTITY_MISSING`, nunca id posicional).
- **Um hash só**: `tradeSetHash` SHA-256 (hash53 foi removido). Sem hash por trade; integridade = `evidenceHash` do bundle. `importedAt`/`computedAt` fora do hash.
- **O id é por import**: reordenar o arquivo gera outro `importId`/`tradeId`; o `rowHash` e a composição dos ciclos são estáveis. Dedupe entre exports sobrepostos: **não decidido**.
- **Privacidade**: `account.sourceName` nunca na Evidence; conta = `accountRef` (inclui `cycleKey`, `filters.account`→`accountRefs`, `groupKey` da dimensão account); `label` de grupo nunca entra; `fileName` só quando a lista de contas do import é COMPLETA (`ImportRecord.accountCount` = só a contagem), senão `null`; trava fail-closed `E_ACCOUNT_NAME_LEAK`. Projeção sempre por **lista branca** (nunca spread de `trade`/`source`/`reconstruction`).
- **Trace como subproduto do motor** (opção A): `explainMetric` nunca reaplica critério/fórmula; `calculateMetrics`/`aggregateTrades` ≡ `*Traced().result` (testado). Papéis: WINNER, LOSER, BREAKEVEN, EXCLUDED_NO_PNL, INCLUDED, EXCLUDED_UNKNOWN, LARGEST_WINNER, LARGEST_LOSER, TOP_WINNER, R_POSITIVE, R_NEGATIVE, R_ZERO, EXCLUDED_R_UNKNOWN, DRAWDOWN_PEAK/WINDOW/TROUGH/RECOVERY, STREAK_RUN — **não acrescentar**. Sem conjunto natural (`applicable:false`): totalTrades, medianR, currentDrawdown, recoveryFactor. Contribuinte ≠ "soma que bate" (só vale para algumas famílias).
- **Limite 500** (`tradeIdsLimit`): acima → `tradeIds=null`, `verifiability:"HASH_ONLY"`, só âncoras + `roleCounts` completo; o `tradeSetHash` continua o da população completa.
- `source.rowHash` (opcional, aditivo) só nos trades `SOURCE_ROW`. `RECONSTRUCTION_VERSION` (em `reconstruct.ts`) **deve subir** quando o algoritmo de ciclos mudar de resultado.

## 4. O que NÃO fazer (somar ao §5 do checkpoint de 01/10)

- ❌ Implementar E5/E6, G6 (motivo de saída), Prisma, UI ou agente sem plano aprovado.
- ❌ Criar segundo motor de métricas na Evidence; ❌ reclassificar/recalcular em `explainMetric`.
- ❌ Hash por trade ou segundo `tradeSetHash`; ❌ id posicional na Evidence.
- ❌ Expor nome de conta (ou `fileName` com conta) em qualquer campo; ❌ spread de objetos do Canonical.
- ❌ Commitar CSV/JSON real ou P&L/contas reais (repo público; fixtures reais ficam locais e ignoradas).
- ❌ git push / deploy / banco de produção.

## 5. Próximo passo — E5 `verifyEvidence` (a PLANEJAR, não implementado)

Do plano original: recalcula a métrica **a partir dos trades referenciados** no bundle e confere hashes; testes de adulteração. Pontos a decidir no plano (apresentar ao usuário): o que significa "recalcular" sem virar segundo motor (usar o MESMO `calculateMetrics` sobre os trades reconstruídos a partir dos TradeEvidence? o que fazer com `HASH_ONLY`?); o que se verifica por nível (bundle hash, `tradeSetHash`, `rowHash` × ImportRef, valores × TradeEvidence, contribuintes × trace); códigos de resultado (válido / adulterado / não verificável); testes de adulteração (valor, hash, rowHash, trade removido/trocado, import trocado). Só então E6 (grupos/comparações + decisão G6).

## 6. Pendências e pontos em aberto

- **Revisão do usuário do E4 ainda não feita.** Pontos que ele deve avaliar: (1) período/qualidade/avisos por grupo ficam `null`/`[]` (o motor só calcula para o total); (2) `dataQuality` copiado por cópia profunda (não campo a campo); (3) o id do motor precisa ser igual ao `tradeId` — quando o Prisma chegar, exigirá decisão; (4) contributors de `maxDrawdownR` sem teste dedicado com valores de R.
- Do usuário (não bloqueiam): fuso do Windows que exportou o NT8 + versão do NT8; original do 1º fixture na lixeira do iCloud; sem export NT8 em inglês (parser EN continua NÃO validado).
- Dívida conhecida: UI/legado ainda com `America/Sao_Paulo` fixo (`src/lib/date.ts`, `analytics-insights.ts`).

## 7. Dicas operacionais

- Provar "não mudei o motor": rodar o mesmo script num `git worktree` do commit anterior (symlink do `node_modules`) e dar `diff` na saída. Foi assim que se confirmou que o resultado completo do motor é idêntico (66 cenários).
- Fixtures reais (locais, ignoradas): `fixtures/ninjatrader/trade-performance/*.csv` + `.context.json`; originais em `/Users/Shared/MeuTrade-dados-reais/`. Sintéticas versionadas: `fixtures/_synthetic/` e o gerador `scripts/_evidence-fixtures.mts`.
- zsh: aspas em `--include='*.ts'`; evitar `echo ===`.

---

## Session Log — 2026-10-08

```text
Último commit:           c77ddbb (E4). Base do dia: 69c054c
Testes:                  test:domain PASS (16 suítes) · tsc PASS · ESLint PASS · tipos dos testes PASS
Fixtures reais:          2 imports (17 ciclos + 34 linhas): E3 51 trades ok; E4 1.871 métricas / 43 grupos / 8.226 TradeEvidence / 5.048 contribuintes; 0 divergências
Código implementado:     E1 identidade · E2 schema+hashes · E3 explainTrade · E4 explainMetric (+trace no motor)
Código não implementado: E5 verifyEvidence · E6 · G6 · Prisma · UI · agente · parser EN
Decisões aprovadas:      §3
Pendências:              §6
Próximo passo:           apresentar plano do E5 e esperar aprovação
Push / Deploy / Produção: NÃO / NÃO / NÃO tocada
```
