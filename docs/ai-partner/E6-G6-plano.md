# MeuTrade — Plano E6/G6 (APROVADO em 12/10/2026 — E6.0 a E6.4 implementados; E6.5 aguarda revisão)

> Status: **plano, nada implementado.** Parte dos módulos existentes (`src/lib/metrics`, `src/lib/evidence`, Evidence Lab). Sem segundo motor, sem Prisma, sem agente nesta fase.
> Repo público: sem dados reais. Data: 10/10/2026.

## 1. O que já existe e sobre o que o E6 se apoia

| Peça | Estado hoje (verificado no código) |
|---|---|
| Grupos | `aggregateTrades(trades, { groupBy: Dimension \| Dimension[] })`: 14 dimensões (`day, tradingDay, week, month, dayOfWeek, hour, session, symbol, direction, account, strategy, strategyVersion, setup, timeframe`), todas as 39 métricas por grupo, `sampleFlag` (OK/LOW/TINY), grupo "desconhecido" explícito, soma das amostras = população total, `tradeSetHash` por grupo, trace por grupo. |
| Motivo de saída | Existe **por perna**: `exitLegs[].reason` (TARGET/STOP/MANUAL/UNKNOWN), `reasonRule` (LABEL_RULE/USER_MAP/NONE), `sourceLabel`, `pnl{net,gross,commission,fees}` por perna; e `exitSummary{finalReason, finalReasons, byReason(qtd), mixed}` por trade. **Não existe como dimensão nem como métrica** (é a lacuna G6). O mapa do usuário agora é registrado no `ImportRecord.reproducibility` (§14.12). |
| Evidence de grupo | `MetricEvidence.scope = "GROUP"` + `groupBy/groupKey`; o verificador confere o pertencimento de dimensões derivadas de instante/direção/símbolo (`ENGINE_DIMS`) e da conta (`accountRef`); estratégia/sessão ficam `SKIPPED S_ASSOCIATION_UNVERIFIABLE`. |
| Rastreabilidade | Trace de contribuintes (18 papéis fechados), `population.sequence`, E5 (V0–V4) e E5b (origem). |
| Lacunas relevantes | Trades-linha (`SOURCE_ROW`) **não têm pernas** nem `exitSummary`: motivo = desconhecido. `analyticsTradeFromEvidence` ainda não carrega `exitLegs/exitSummary`. `reconstruction.cycleKey.strategy` expõe o nome da estratégia (achado do E3). |

## 2. Perguntas que o produto poderá responder depois do E6

**Com os dados que já temos (NT8 PT-BR, ciclos reconstruídos):**
1. *"Perdi mais dinheiro em stops?"* — P&L, nº de saídas, quantidade e média por motivo (TARGET/STOP/MANUAL/UNKNOWN), por **perna** e por **motivo final do trade**, com cobertura ("x% das pernas têm motivo conhecido") e a ressalva de que o motivo vem do **nome** da ordem.
2. *"De onde vem meu lucro: targets ou saídas manuais?"* — mesma quebra, com a participação de cada motivo no P&L total.
3. *"Qual hora, dia da semana, conta, ativo ou sessão rende mais/menos?"* — ranking com **contribuição** de cada grupo ao total e `sampleFlag` visível; grupos TINY/LOW nunca entram no ranking sem aviso.
4. *"A conta A está melhor que a B?"* / *"esta semana × a anterior?"* — **comparação** entre dois grupos/períodos: deltas exatos por métrica, razão, e sinal de "amostra insuficiente"; nunca "significativo" sem base estatística.
5. *"Stops me custam mais R que targets me dão?"* — R médio por motivo, **só nos trades com stop informado pelo usuário** (R nunca é inferido).
6. *"Em que condições eu perco mais em stops?"* — cruzamento exitReason × hora/sessão/direção (multi-dimensão já suportado), com cobertura.

**Dependem de dados que NÃO temos hoje:**
- *Por que* saí (decisão, emoção, plano): não está no arquivo (precisa diário/check-in; é outra fonte).
- Se o "Stop" era ordem stop real, stop móvel ou saída manual nomeada "Stop": precisa export de **Orders/Fills** (tipo da ordem); hoje só o nome.
- Slippage/qualidade de execução: precisa fills com preço de ordem × preço executado.
- Contexto de mercado (volatilidade, notícias, regime): precisa **dados de mercado** (ex.: Databento), fora de escopo.
- "E se eu usasse outro stop/alvo?" (contrafactual): precisa barras/backtest.
- Motivo de saída em **trades-linha** (sem pernas) e estratégia/sessão **na Evidence** como referência verificável.
- Eficiência de saída (P&L ÷ MFE) é possível com os campos de excursão já existentes, mas **fica para depois do E6** (E6.x opcional).

## 3. Decisões que preciso de você antes de implementar

1. **Unidade do "motivo de saída" (G6):** (a) por **perna** (correto para "quanto perdi em stops": uma saída parcial em target e a final em stop contam cada uma no seu motivo) e/ou (b) por **trade** via `finalReason` (permite agrupar com o motor atual, mas atribui o P&L do ciclo inteiro ao motivo final). **Recomendação: ambos, com nomes distintos** (`exitReason` como dimensão do trade = `finalReason`, com bucket explícito `MIXED`; e `exitBreakdown` por perna).
2. **Trades com motivos finais diferentes (`mixed`)** e **trades-linha sem pernas:** bucket `MIXED` e `UNKNOWN` explícitos, nunca absorvidos em outro. (Recomendado.)
3. **Evidence dos derivados:** estender `evidence/1` de forma **aditiva** (novo `claim.kind` COMPARISON/BREAKDOWN + bloco opcional `derived[]`) em vez de `evidence/2`. Os átomos continuam sendo `MetricEvidence`; o derivado só é aceito se reproduzível a partir deles.
4. **Estatística:** em E6, **sem p-valor/intervalo de confiança**: só `sampleFlag`, tamanho de efeito (delta, razão) e rótulo "não conclusivo" quando a amostra é LOW/TINY. Inferência estatística é decisão separada.
5. **Privacidade antes do agente consumir:** corrigir `cycleKey.strategy` (nome da estratégia em texto aberto) trocando por `strategyRef` não reversível — **mudança de schema/`evidenceHash`**; recomendo fazer no E6.3, antes de qualquer consumo por IA.
6. **Conjunto mínimo de perguntas do E6** (seção 2, itens 1–6): confirmar ou cortar.

## 4. Arquitetura (sem segundo motor)

Princípio: toda conta financeira continua em `computeMetricSet`/`exact.ts`. As novas peças **escolhem, agrupam, ordenam e subtraem** resultados já calculados, ou reutilizam a mesma passada para produzir o trace.

```
prepareTrades ──► TradeRow (+ exitReason, exitLegs resumo)        [E6.0, aditivo]
      │
      ├─ aggregateTrades(groupBy: [..., "exitReason"])              [E6.0: 1 dimensão nova]
      ├─ exitBreakdown(trades, opts)  (população = PERNAS)          [E6.1: módulo novo, usa exact.ts]
      └─ rankGroups / contribution / compareGroups (sobre AggregateResult)   [E6.2: funções puras]
                │
                └─ Evidence: átomos MetricEvidence (já existem) + derived[] reproduzível   [E6.3]
                          └─ verifyEvidence V6 (derivados) · verifyEvidenceSource (já cobre os trades)
```

### Arquivos previstos (por fase; commits separados)

| Fase | Arquivos | Mudança |
|---|---|---|
| **E6.0** dimensão `exitReason` | `metrics/types.ts` (Dimension), `metrics/prepare.ts` (TradeRow: `exitReason`, `exitReasonKnown`), `metrics/calculate.ts` (DIMENSIONS), `metrics/filter.ts` (filtro `exitReason`), `evidence/to-analytics.ts` (carregar `exitSummary`/`exitLegs`), `evidence/verify.ts` (`ENGINE_DIMS`+`exitReason`), testes, `data-contract.md` §15.1 | Aditivo. **Prova de não regressão:** os 120 hashes de referência + `tradeSetHash` idênticos. |
| **E6.1** `exitBreakdown` (perna) | `metrics/legs.ts` (novo), `metrics/index.ts`, trace de pernas (papéis novos: `EXIT_LEG`, `EXIT_LEG_EXCLUDED_NO_PNL`), testes com oráculo à mão, `data-contract.md` §15.2 | Por motivo: nº de pernas, quantidade, P&L líquido/bruto (soma de `exitLegs[].pnl` em centavos), vencedoras/perdedoras, média, participação no total, cobertura (pernas com P&L conhecido). **Conferência cruzada:** Σ P&L das pernas = P&L do trade quando completo. |
| **E6.2** ranking/contribuição/comparação | `metrics/analysis.ts` (novo): `rankGroups`, `contribution`, `compareGroups`; testes; `data-contract.md` §15.3 | Funções puras sobre `AggregateResult`/`MetricsResult`; delta em centavos/R escalado (exato), razão, `sampleFlag` herdado, `conclusive: false` quando LOW/TINY. Nada de recalcular métrica. |
| **E6.3** Evidence dos derivados | `evidence/schema.ts` (aditivo: `claim.kind`, `derived[]`), `evidence/explain-derived.ts` (novo), `evidence/verify.ts` (V6: reconstrói o derivado a partir dos átomos verificados), `evidence/verify-source.ts` (sem mudança de lógica), correção `strategyRef`, testes de adulteração, `data-contract.md` §15.4 | `evidenceHash` de bundles novos muda (documentado, como no E5.0/§14.9). Átomos e fingerprints inalterados, salvo a correção `strategyRef` (decisão 5). |
| **E6.4** Evidence Lab | aba "Grupos e motivos de saída" (cenários sintéticos: stops × targets, comparação A×B, amostra LOW, MIXED/UNKNOWN) | Só depois da aprovação do E6.0–E6.3. |
| **E6.5** contratos para o agente | `docs/ai-partner/agent-capabilities.md` (apenas desenho; **sem código de agente**) | Ver §6. |

### Métricas e dimensões novas

- **Dimensão** `exitReason` (trade): `TARGET | STOP | MANUAL | UNKNOWN | MIXED` (de `exitSummary.finalReason` / `mixed`; trade sem pernas ⇒ `UNKNOWN` com `reasonKnown=false`).
- **Filtro** `exitReason` (lista).
- **`exitBreakdown` (perna)**, por motivo: `legs`, `quantity`, `netPnl`, `grossPnl`, `winnersLegs`, `losersLegs`, `averageNetPerLeg`, `sharePctOfTotalNet`, `coverage` (pernas com P&L líquido conhecido), `userMapLegs` (pernas decididas por mapa do usuário).
- **Derivados** (E6.2): `contribution(group) = netPnl(group) / netPnl(total)` (indisponível quando o total é 0/desconhecido), `rank` por métrica com piso de amostra, `delta = B − A`, `ratio = B / A`.
- Nenhuma das 39 métricas existentes muda de fórmula nem de versão (`DEFINITION_VERSION` permanece).

## 5. Rastreabilidade e compatibilidade com a Evidence

- **Átomos continuam verificáveis como hoje:** cada número de grupo é um `MetricEvidence` (`GROUP`), reproduzido pelo mesmo motor; o `exitReason` do grupo é verificável porque `exitSummary`/`exitLegs` já estão no `TradeEvidence` (E6.0 só faz o conversor mecânico carregá-los).
- **Derivados** (comparação, contribuição, ranking) são **reproduzíveis a partir dos átomos**: o V6 recalcula a diferença/razão/participação com a mesma aritmética exata e confere; não há nova fórmula financeira.
- **Origem (E5b):** os trades citados continuam conferidos contra o CSV; o motivo de saída é derivado do **rótulo** do CSV + mapa registrado (`reproducibility.exitReasonMap`), então é reproduzível pela reingestão.
- **Limites herdados, ditos no relatório:** `HASH_ONLY` não verifica a população inteira; estratégia/sessão sem referência; trades-linha sem motivo; motivo = **nome** da ordem (não o tipo real); seleção original e ordem original não provadas.

## 6. Preparação para o AI Trading Partner (desenho, não integração)

O agente **nunca calcula**: chama capacidades determinísticas e cita a Evidence. Contrato proposto para E6.5 (somente documento/tipos):

| Capacidade (read-only) | Entrada | Saída (sempre) |
|---|---|---|
| `metrics.query` | métricas, filtros, opções | valor, população, cobertura, avisos, `evidenceRef` |
| `metrics.groups` | dimensões, métricas | grupos + `sampleFlag` + `evidenceRef` por grupo |
| `exit.breakdown` | filtros | quebra por motivo (perna e trade) + cobertura |
| `metrics.compare` | grupo A, grupo B, métricas | deltas exatos, razão, `conclusive`, `evidenceRef` |
| `evidence.verify` / `evidence.verifySource` | bundle (+ bytes) | relatório (estados) |

Regras: resposta **sem** `evidenceRef` ou com estado ≠ `VALID` ⇒ o agente declara a limitação em vez de afirmar; população `HASH_ONLY`/`LOW`/`TINY` ⇒ linguagem "indicativo, não conclusivo"; o agente não inventa motivo, R nem causa. Fica **fora do E6**: integração com LLM, prompts, memória, UI de produto.

> **E6.5 em andamento (só desenho):** plano e expectativas em `docs/ai-partner/agent-contract-plano.md` e `scripts/expectations/agent-contract.expected.json` (12/10/2026). Esta tabela é a versão original; vale o plano novo (verify/verifySource não são ferramentas do agente; números por slots; `evidence.explain`/`evidence.refresh`).

### 6.1 Regra do VEREDITO COMBINADO (decisão do Marcelo, 12/10/2026 — obrigatória no E6.5)
O estado do E5b **nunca** é lido isolado como "tudo ok". `SOURCE_VERIFIED` liga os **trades** ao CSV; não confere selo, métricas nem derivados (V0–V6) e não julga completude, ordem ou duplicidade das citações de pernas (isso é do V6). Exemplos reais já testados: derivado com valor adulterado e selo refeito, citação duplicada, lista fora de ordem ou com item removido ⇒ E5b `SOURCE_VERIFIED` **e** V6 `TAMPERED`.
Consequências para o contrato do agente (E6.5):
1. Toda capacidade que devolve um número/derivado devolve **os dois** veredictos sobre o **mesmo `evidenceHash`**: `verify` (VALID/TAMPERED/UNVERIFIABLE/INVALID_FORMAT, com V6 quando há derivados) e `source` (SOURCE_VERIFIED/…_PARTIAL/SOURCE_MISMATCH/UNVERIFIABLE, ou "não executado").
2. Só se afirma "verificado" com `verify = VALID` **e** `source` ∈ {SOURCE_VERIFIED, SOURCE_VERIFIED_PARTIAL (dito como parcial)}. `source` sozinho, ou `verify` sozinho, ⇒ o agente declara a limitação em vez de afirmar.
3. Nenhum campo "ok"/"verified" agregado pode existir sem trazer os dois componentes e o escopo (população declarada, não a importação inteira).
4. **Semântica do veredito combinado** (UNVERIFIABLE incluído): `VERIFIED` = verify `VALID` ∧ source `SOURCE_VERIFIED`; `VERIFIED_PARTIAL` = `VALID` ∧ `SOURCE_VERIFIED_PARTIAL` (dito como parcial); **`NOT_VERIFIED` = qualquer `UNVERIFIABLE` (do verify ou do source — inclusive por arquivo ausente, versão, HASH_ONLY e, a partir do S4b do plano do `sourceLabel`, mapa do usuário ausente/divergente) — não é ok e **não** é adulteração**; `TAMPERED_OR_MISMATCH` = verify `TAMPERED`/`INVALID_FORMAT` ∨ source `SOURCE_MISMATCH`.
5. Teste-guarda: `scripts/test-evidence-no-solo-verdict.mts` (trava os consumidores atuais; o E6.5 deve estendê-lo).

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Motivo de saída = nome da ordem (Stop em break-even continua STOP; stop móvel ≠ stop) | Dito na saída e na UI; mapa do usuário registrado e reproduzível; nunca chamar de "stop real". |
| Dupla contagem perna × trade | Duas unidades com nomes distintos; teste cruzado Σ pernas = trade. |
| Atribuir P&L do ciclo ao `finalReason` engana | Bucket `MIXED`; a pergunta "quanto perdi em stops" usa a quebra por **perna**. |
| Trades-linha sem pernas parecerem "sem stops" | `UNKNOWN` + cobertura obrigatória em toda saída. |
| Comparação passar por "prova" | `conclusive` só com amostra OK; sem p-valor no E6; linguagem de efeito, não de causa. |
| Regressão do motor | Baseline de 120 hashes + novo golden por fase; dimensão nova é aditiva e testada com/sem. |
| Crescimento do `evidenceHash`/schema | Aditivo em `evidence/1`, documentado; sem persistência/consumidores hoje. |
| Privacidade (`cycleKey.strategy`) | Decisão 5 antes de qualquer consumo por IA. |
| Custo/explosão de bundles (grupos × métricas) | Derivados referenciam átomos já gerados; limite `tradeIdsLimit` e `HASH_ONLY` continuam valendo. |

## 8. Critérios de aceite

**Geral:** `test:domain`, `tsc` (incl. `.mts`), ESLint do escopo verdes; os **120 hashes de referência** e os `tradeSetHash`/`importId`/`tradeId` idênticos; V0–V4 e E5b com os mesmos resultados nas fixtures reais (5.238 VALID / 288 bundles de origem); nenhum dado real no repo; sem push/deploy/banco/Prisma.

- **E6.0:** `groupBy:"exitReason"` particiona a população (soma das amostras = total, buckets `MIXED`/`UNKNOWN` explícitos); filtro por motivo; oráculo à mão (tabela de pernas → bucket); bundle de grupo `exitReason` verificável no V4.association (ou `SKIPPED` justificado); nada muda sem a dimensão.
- **E6.1:** Σ P&L das pernas por motivo = P&L total das pernas conhecidas (centavos exatos); Σ pernas = pernas do ciclo; cobertura sempre presente; 2 fixtures reais (locais) sem divergência vs oráculo independente; caso "target parcial + stop final" coberto.
- **E6.2:** delta/razão/contribuição exatos (oráculo à mão); `conclusive=false` para LOW/TINY; ranking determinístico (desempate documentado, sem novo critério escondido); nenhuma métrica recalculada.
- **E6.3:** derivado reproduzido pelo verificador; adulteração de delta/razão/ordem de ranking com selo refeito ⇒ `TAMPERED`; privacidade (`strategyRef`) sem nome de conta/estratégia/sessão em texto aberto; E5b cobre os trades citados.
- **E6.4/E6.5:** Lab mostra os cenários com estados reais; documento de capacidades sem código de agente.

## 9. Ordem sugerida e pontos de parada
E6.0 → (revisão) → E6.1 → (revisão) → E6.2 → E6.3 → (revisão) → E6.4 → E6.5. Um commit local por fase, relatório entre fases, sem push.
