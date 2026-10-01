# MeuTrade — CHECKPOINT 2026-10-01

> **Para o próximo Claude Code:** leia este arquivo inteiro antes de qualquer ação. Ele existe para você **não reconstruir a história**.
> Idioma com o usuário (Marcelo): **sempre português brasileiro**, direto, sem enrolação, avisando riscos. Na dúvida, perguntar antes.
> Este documento é público (repositório público): **sem P&L real, sem nomes de conta/estratégia, sem dados do usuário**.

## PRÓXIMA SESSÃO → continuar a partir de **E1**

R1, R2 e R3 estão **concluídos** (ver §7). Não há pendência bloqueante antes do E1. Antes de escrever código do E1: reler §4 (decisões aprovadas), §5 (não fazer) e a especificação em `data-contract.md` §14, e **apresentar um plano curto de E1 ao usuário para aprovação** (o usuário trabalha em passos pequenos e aprovados).

---

## 1. O produto e a arquitetura

MeuTrade.app: *"Seu parceiro de pesquisa para descobrir o que realmente funciona no seu trading."* Em evolução para um **AI Trading Partner**, começando pela **fundação de dados confiável**.

```text
Ingestão → Canonical Trade → Reconstrução de ciclos → Métricas determinísticas → Evidence → (futuro) AI Agent
```

**Regra fundamental — Evidence não é uma segunda fonte de verdade.**
Canonical Trade = verdade analítica · Metrics = verdade dos cálculos · Evidence = rastreabilidade/explicação/verificação. Evidence **nunca** duplica o CSV.

Princípio do usuário: *"Não construir infraestrutura para um problema que ainda não foi validado."*

## 2. Estado técnico (fim da sessão)

| Item | Valor |
|---|---|
| Repo | `Desktop/Projetos AI/TraderOS` (público: `Marcelo210598/TraderOS`), branch `main` |
| Commit base desta sessão | `72a65ed` (timezone universal). O commit do checkpoint é o **HEAD** (`git log -3 --oneline`) |
| Commits da sessão | `f3ee644` reconstrução de ciclos NT8 + canonical-trade/2 · `72a65ed` timezone universal · (HEAD) checkpoint |
| `npm run test:domain` | **PASS**, 289 linhas ✓ com os fixtures reais locais; **269** em checkout limpo sem fixtures reais (exit 0) |
| `tsc --noEmit` | **PASS** |
| Tipos dos testes (tsconfig temporário) | **PASS** |
| ESLint (`src/lib/ingest`, `domain`, `metrics`) | **PASS** (único aviso antigo e alheio: `gamification.ts`) |
| Fixtures reais | 2 PT-BR (ver §3) — **PASS** no runner, nos testes de métricas (18) e no oráculo Python |
| Push / Deploy / Produção | **NENHUM** push, **NENHUM** deploy, banco de produção **NÃO tocado** |

Rodar tudo: `npm run test:domain && npx tsc --noEmit`. Testes: `scripts/test-*.mts` (Node 24 strip-only: sem enums/parameter properties; imports com `.ts`). Aritmética monetária exata (centavos inteiros).

## 3. Reconstrução NT8 e fixtures reais

**Linha ≠ trade.** Uma linha do NT8 Trade Performance = **matched lot** (lote de entrada casado com lote de saída). Fluxo: `linhas NT8 → matched lots → ciclo de posição → canonical trade`. Ciclo = chave (conta + contrato com vencimento + estratégia + direção), 0 → posição aberta → saídas parciais → 0; sobreposição estrita junta; lacuna separa; mesmo segundo **não agrupa** (separa + `SAME_SECOND_BOUNDARY`).

Código: `src/lib/ingest/reconstruct.ts` (núcleo), `pipeline.ts`, `normalizer.ts`, `build-trade.ts`, `exit-reason.ts`, `parsers/ninjatrader-ptbr.ts`, `src/lib/domain/canonical.ts` (`canonical-trade/2`), `src/lib/metrics/`.

Tratado e testado: múltiplos lotes, scale-in/out, saídas simultâneas, ambiguidades (`SAME_SECOND_BOUNDARY`, `REVERSAL_CANDIDATE`, `OVERLAP_OPPOSITE_DIRECTION`, `CROSS_KEY_OVERLAP`, `ACCUMULATED_MISMATCH`, `ROWS_REJECTED_IN_FILE`, `EXCURSION_CONFLICT`), integridade pelo acumulado do NT8 (oráculo, **nunca** P&L), confiança e completude de bordas. Ciclos de baixa confiança/borda não verificada **entram nas métricas, sinalizados**.

| Fixture real (LOCAL, ignorado pelo git) | Resultado |
|---|---|
| `nt8-grid-ptbr-2026-09-21` | 7 linhas → 2 ciclos |
| `nt8-grid-ptbr-2026-10-01` | 27 linhas → 15 ciclos (1 contrato, 2 contas, perdas, scale-in/out, saídas simultâneas, bordas `VERIFIED`, 1 `EXCURSION_CONFLICT`, linhas sem rótulo) |

Total real: **34 linhas → 17 ciclos**. Oráculo independente (`scripts/oracle-nt8-cycles.py`): 0 divergências.

**Invariantes financeiros** (reconstruir não pode mudá-los): `netPnl`, `grossPnl`, `commission`, `fees`, `quantity`. Mudam: contagem de trades, média, maior ganho/perda, win rate. ⚠️ `profitFactor` e `maxDrawdown` ficaram iguais nos fixtures atuais, mas **não são invariantes garantidos** (path-dependentes) — não testar como invariante geral.

**MAE/MFE:** nunca somar. Podem **divergir** entre linhas do mesmo ciclo (observado em dado real; a premissa "sempre idênticas" valia só no 1º fixture). Preservar crus em `sourceRows`; reconstruir por extremos absolutos; usar o extremo **mais amplo** (limite inferior/inferência, nunca medição exata); `conflict` + `EXCURSION_CONFLICT`.

**exitReason:** `Target*→TARGET`, `Stop*→STOP`, `Zerar|Flat|Close→MANUAL`, resto `UNKNOWN`; rótulo vazio ⇒ `UNKNOWN` com `reasonRule = NONE`; **nunca inferir pelo P&L**; mapa configurável pelo usuário (`USER_MAP`); sempre preservar `sourceLabel`.

**NT8 em inglês:** `ninjatrader-en` é **ASSUMIDO / NÃO VALIDADO** (nenhum export real; o usuário usa NT8 PT-BR e não consegue exportar em inglês; busca na web só achou páginas que parafraseiam). Não reconstrói ciclos. **Não alterar sem fixture real.** Tradovate/Rithmic: sem parser (só a partir de export real).

## 4. Decisões aprovadas (não reinterpretar)

**Timezone** (implementado, commit `72a65ed`; contrato em `data-contract.md` §13)
- `storage` = UTC · `sourceTimezone` = fuso que gerou os horários **sem offset** (metadado do import) · `analysisTimezone` = preferência do usuário, **nunca** gravada no `CanonicalTrade` · `marketTimezone` pertence ao instrumento (CME: `America/Chicago` p/ dia de pregão, `America/New_York` p/ sessão) e independe do usuário.
- Só IANA (nunca `UTC-3`); DST pelas regras IANA (`E_TIME_GAP`, `FOLD_*_ASSUMED`).
- `analysisTimezone` não altera P&L, quantidade, sequência nem UTC; só agrupamentos temporais. `DATE_ONLY` não tem instante e não é convertido.
- `DEFAULT_SOURCE_TIME_ZONE` e `DEFAULT_ANALYSIS_TIME_ZONE` = `America/Sao_Paulo` **só por compatibilidade** (constantes independentes).
- `sourceTzOrigin`: `USER` · `FILE_OFFSET` · `FILE_DECLARED` (reservado, nenhum parser emite) · `DEFAULT`. Sem fuso informado ⇒ `W_SOURCE_TZ_DEFAULTED` (**aviso, não erro** — decisão adiada para a UI de importação). **Não inferir fuso pelos horários**; heurística só como sugestão.
- Pendente do usuário (não bloqueia nada): fuso do Windows que exportou e versão do NT8. O fixture `2026-10-01` está sem `sourceTz` de propósito.

**Evidence/1** (aprovado, **não implementado**; spec em `data-contract.md` §14)
- Hash **SHA-256 via `node:crypto`**, atrás de um adaptador de infra/servidor (sem criptografia manual, sem espalhar no domínio).
- `tradeId` determinístico/reprodutível: identidade do import/arquivo + linhas de origem + identidade da reconstrução; **sem UUID/random**; mesmo conteúdo ⇒ mesmo id; imports diferentes não colidem; mudança material de reconstrução pode mudar o id; reordenar linhas sem mudar a semântica não precisa mudar a identidade. **Não** usar `fileHash:firstRowNo` como identidade definitiva.
- `account.sourceName` fica só na proveniência interna; a Evidence exposta usa `accountRef` (fingerprint não reversível).
- `importedAt`/`computedAt` fora do hash; JSON canônico com chaves ordenadas.
- Cadeia: `Claim → MetricEvidence → population.tradeIds → TradeEvidence → SourceRowRef → ImportRef`. Campos mínimos em §14 do contrato.

**Outras**
- `canonical-trade/2` é **retrocompatível** (campos novos opcionais; v1 continua válido). Mudanças futuras no canonical: só aditivas e opcionais.
- Strings com `z.enum` (sem enums de Postgres). `User.timezone` (Prisma legado, default SP) é candidato a `analysisTimezone` — **sem migration**.
- Repo público ⇒ fixtures reais ficam locais; sintéticos em `fixtures/_synthetic/`.
- Banco de produção: **NÃO** acessar, **NÃO** usar credenciais do `.env` para SELECT.

## 5. O que NÃO fazer

- ❌ Mexer no banco de produção · ❌ `git push` · ❌ deploy · ❌ migration/Prisma (até o contrato estar validado).
- ❌ Alterar o parser EN (`ninjatrader-en`) sem fixture real; ❌ inventar formatos Tradovate/Rithmic.
- ❌ Tratar linha do NT8 como trade. ❌ Somar/multiplicar MAE/MFE. ❌ Usar "Acu lucro líquido" como P&L. ❌ Inferir exit reason pelo P&L.
- ❌ Usar timezone fixo / offset fixo; ❌ inferir fuso pelos horários.
- ❌ IDs aleatórios. ❌ Expor `account.sourceName` por padrão. ❌ Transformar Evidence em segunda fonte de verdade ou copiar o CSV para ela.
- ❌ Commitar CSV/JSON real (ficam ignorados) ou colocar P&L/contas reais em docs/testes versionados.
- ❌ Avançar para E2+ sem aprovar E1; ❌ AI Agent, RAG, embeddings, memória, chat, UI complexa, market data, backtest, Fills (até o usuário pedir).
- ❌ Mexer na UI/legado com `America/Sao_Paulo` fixo (`src/lib/date.ts`, `analytics-insights.ts`, componentes) — tratar à parte.

## 6. Lacunas da Evidence (G1–G9) e plano

| # | Lacuna |
|---|---|
| G1 | `tradeId` posicional (`fileHash ?? "file"` + `rowNo` da 1ª linha; o `fileHash` vem do chamador) |
| G2 | Sem `ImportRecord`: o pipeline não calcula SHA-256, bytes, encoding, `importId`, versão do motor de reconstrução |
| G3 | `sourceRows` sem `rowHash` |
| G4 | `tradeSetHash` = `hash53` (53 bits) e o fingerprint não cobre proveniência/reconstrução; `tradeIds` some acima de 500 |
| G5 | Sem mapa de contribuintes por métrica (winners/losers) |
| G6 | Sem dimensão/métrica por **motivo de saída** (hoje só há P&L por perna em `exitLegs[].pnl`); impede "perdi mais em stops?" — **decisão separada** |
| G7 | Confiança/ambiguidade/completude não sobem para a Evidence individual |
| G8 | Sem objeto de claim nem schema versionado de evidência |
| G9 | Privacidade de `account.sourceName` |

Plano (sempre aditivo, puro, **sem Prisma**):

| Inc. | Entrega |
|---|---|
| **E1** | Identidade e import: SHA-256 do texto no pipeline (adaptador), `ImportRecord` (sem relógio), `rowHash` em `sourceRows`, `tradeId` estável, `accountRef`. Único incremento que toca o canonical (opcional/aditivo). Testes de estabilidade, colisão e reordenação |
| E2 | Tipos + schema `evidence/1`, JSON canônico, hash (`src/lib/evidence/`) |
| E3 | `explainTrade`: trade → linhas → import. Testar com os 2 fixtures reais (local) e sintéticos |
| E4 | `explainMetric`: população completa por referência, contribuintes das métricas núcleo, avisos de reconstrução. Sem alterar fórmulas |
| E5 | `verifyEvidence`: recalcula a métrica a partir dos trades referenciados e confere hashes; testes de adulteração |
| E6 | Grupos/comparações + decisão sobre dimensão/métrica de exit reason (G6) |
| Depois | Persistência (Prisma) só com contrato validado; ferramentas do agente |

## 7. R1 / R2 / R3 — CONCLUÍDOS

- **R1 — original fora de qualquer repo git: ✅.** O CSV real de 01/10 foi **movido** do Desktop (dentro do repo privado da home) para `/Users/Shared/MeuTrade-dados-reais/nt8-grid-ptbr-2026-10-01.original.csv` (somente leitura, fora de qualquer repositório), com SHA-256 conferido antes de apagar a cópia do Desktop. O original do 1º fixture foi enviado antes pelo usuário via iCloud (lixeira) — **não localizado/movido**; a cópia local em `fixtures/` é ignorada pelo git. `.gitignore` é só defesa adicional.
- **R2 — oráculo independente: ✅** `scripts/oracle-nt8-cycles.py` (stdlib, sem dados, não importa nada do TS; regra de negócio da spec). Uso: `python3 scripts/oracle-nt8-cycles.py <csv> --expected <expected.json>`. Resultado: 0 divergências nos 2 fixtures e no original.
- **R3 — teste real generalizado: ✅** `scripts/test-real-nt8-metrics.mts` varre todos os `*.csv` com `.context.json` (18 testes em 2 fixtures): cruzamento com o CSV, invariantes financeiros, ciclo a ciclo via `sourceRows`, por símbolo, fuso. Pula se não houver fixtures.

## 8. Mapa rápido de arquivos

```text
docs/ai-partner/  MEUTRADE-AI-plano-estrategico.md · MEUTRADE-AI-technical-foundation.md
                  data-contract.md (§12 reconstrução, §13 timezone, §14 Evidence)
                  nt8-position-reconstruction-spec.md · real-fixture-nt8-2026-09-21.md
                  metrics-audit-dataset.md · ninjatrader-addon-review.md · MEUTRADE-CHECKPOINT-2026-10-01.md
src/lib/domain/   canonical.ts · time.ts · pnl.ts · instruments.ts
src/lib/ingest/   pipeline.ts · reconstruct.ts · normalizer.ts · build-trade.ts · exit-reason.ts · csv.ts · parsers/
src/lib/metrics/  calculate.ts · prepare.ts · catalog.ts · types.ts · exact.ts (hash53)
scripts/          test-*.mts · oracle-nt8-cycles.py · _recon-fixtures.mts · _metrics-fixtures.mts
fixtures/         README.md · _synthetic/ (versionado) · ninjatrader/trade-performance/ (reais, LOCAIS, ignorados)
```

Memória persistente do Claude (fora do repo): `project_meutrade_ai_partner.md` e o índice `MEMORY.md`.

---

## Session Log — 2026-10-01

```text
Último commit:           HEAD = commit do checkpoint (base 72a65ed)
Testes:                  test:domain PASS (289 ✓ com fixtures reais; 269 em checkout limpo) · tsc PASS · ESLint PASS
                         real fixtures PASS (runner + 18 de métricas) · oráculo Python 0 divergências
Arquivos alterados:      data-contract.md, nt8-position-reconstruction-spec.md, real-fixture-nt8-2026-09-21.md,
                         fixtures/README.md, fixtures/ninjatrader/trade-performance/README.md,
                         scripts/test-real-nt8-metrics.mts, scripts/test-ingest-fixtures-real.mts (só uma mensagem)
Arquivos criados:        scripts/oracle-nt8-cycles.py, docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-01.md
Documentação atualizada: §12/§13/§14 do data-contract, correção no §10 da spec, fixture 2 documentado, READMEs de fixtures
Fixtures validadas:      2 PT-BR reais (34 linhas → 17 ciclos); NT8 EN NÃO validado
Código implementado:     (na sessão) reconstrução de ciclos + canonical-trade/2 (f3ee644); timezone universal (72a65ed);
                         (neste checkpoint) oráculo Python e teste real generalizado
Código não implementado: E1, E2, E3, E4, E5, E6 (Evidence); parser EN; UI; Prisma; Agent
Decisões aprovadas:      §4 (timezone, SHA-256/node:crypto, tradeId determinístico, accountRef, Evidence = rastreabilidade)
Pendências:              confirmar fuso do Windows e versão do NT8 (não bloqueia); decidir G6 (exit reason) antes do E6;
                         original do 1º fixture na lixeira do iCloud (não movido); sem NT8 EN real
Próximo passo:           PRÓXIMA SESSÃO → continuar a partir de E1 (apresentar plano curto e esperar aprovação)
Push:                    NÃO realizado
Deploy:                  NÃO realizado
Produção:                NÃO tocada
```
