# NT8 Trade Performance → Trade analítico (ciclo de posição 0→0) — análise e proposta de contrato

**Status:** APROVADA e IMPLEMENTADA (ver `data-contract.md` §12). Sem Prisma, migration, UI ou push. Evidência: fixture real do NT8 (grade PT-BR, 7 linhas, conta de simulador) e `real-fixture-nt8-2026-09-21.md`.
O documento é público: **não traz valores de P&L nem horários/preços reais**, só a estrutura observada.
Legenda: 🟢 verificado nos dados reais · 🟡 inferência forte · 🔴 não dá para saber só com o relatório.

---

## 1. O que uma LINHA representa (🟢)
**Um par casado "lote de entrada ↔ lote de saída" (matched lot-pair)**, com a quantidade casada. Nem ordem, nem fill, nem round-turn.

Evidências nos dados reais:
- Duas linhas com **o mesmo horário e preço de SAÍDA e o mesmo rótulo** (`Target1`) mas **preços de ENTRADA diferentes** (diferença de 1 décimo de ponto): uma **única execução de saída de 2 contratos casada (FIFO) contra 2 lotes de entrada distintos** ⇒ cada linha é um *par*, não uma execução.
- Duas linhas com **mesma entrada, mesma saída (horário e preço) e rótulos diferentes** (`Stop2`, `Stop3`): **duas ordens de saída distintas** executadas no mesmo segundo ⇒ a linha preserva o **nome da ordem de saída**.
- Linhas com `Qtd > 1` (uma linha de 2 contratos ao lado de duas de 1): **a quantidade é a casada naquele par**, não 1 contrato por linha.
- Numeração (`Núm. Neg.`) e ordem: **crescente por horário de SAÍDA** (🟢 nas 7 linhas). Não é id de ciclo.
- `Entrada`/`Sáída` = **nomes das ordens** de entrada/saída (`Entry`; `Target1`, `Target2`, `Stop2`, `Stop3`, `Zerar`). Na fixture toda entrada é `Entry`.
- `Acu lucro líquido` = **acumulado do relatório inteiro** (em ordem de linha); `Acu_i − Acu_{i−1} = Profit_i` em todas as linhas (🟢). `Barras` = 0.

## 2. O que o CONJUNTO de linhas representa
**O histórico de lotes fechados no período/seleção exportada**, por (conta, contrato, estratégia, direção). **Não** traz: ids de ordem/fill, tamanho de posição ao longo do tempo, marcadores de "posição zerada", lotes ainda abertos, nem a posição líquida da conta. O ciclo 0→0 **não está escrito** no relatório: tem de ser **inferido**.

## 3. É possível reconstruir 0→0 só com este relatório? — **Sim na maioria dos casos, não em todos.**
Cada linha define um **intervalo** `[hora de entrada, hora de saída]` para um lote de uma direção, numa chave **K = (conta, contrato completo com vencimento, estratégia, direção)**.

- **Sobreposição estrita** de intervalos na mesma chave ⇒ a posição esteve **> 0 de forma contínua** ⇒ **mesmo ciclo** (prova, não heurística).
- **Lacuna estrita** (próxima entrada > maior saída até então, em segundos distintos) ⇒ a posição da chave esteve **= 0** ⇒ **ciclos diferentes** (os horários têm resolução de 1 s e truncam de forma monotônica, então segundos diferentes preservam a ordem).
- **Igualdade de segundos** (saída de um lote = entrada de outro) ⇒ **ambíguo** (ver §4).

Isto **não** é "mesmo horário + mesmo preço + mesma estratégia": é um **teste de continuidade de posição** sobre intervalos. Entrada no mesmo segundo só junta linhas porque os intervalos **se sobrepõem** (saída > entrada), não por coincidência de campos. Aplicado à fixture: **7 linhas → 2 ciclos** (4 linhas de um contrato; 3 de outro), sem nenhum caso ambíguo.

## 4. Casos AMBÍGUOS (🔴 precisam de mais dado)
| # | Caso | Por que o relatório não resolve | Tratamento proposto |
|---|---|---|---|
| A1 | **Toque**: saída de uma linha e entrada de outra (mesma chave, mesma direção) **no mesmo segundo** | não se sabe a ordem dos eventos dentro do segundo: sair-e-reentrar (2 ciclos) × entrar-e-sair (scale-in, 1 ciclo) | **separar** + sinalizar `AMBIGUOUS_TOUCH` + `confidence = LOW` (nunca juntar em silêncio) |
| A2 | **Intervalo de duração zero** (entrada = saída) | idem | idem |
| A3 | **Lote ainda aberto na exportação** (resto da posição) | só lotes **fechados** aparecem; a posição parece "completa" com menos contratos | indetectável pelo relatório; exige **posições/ordens**. Avisar: ciclo `completeness = UNVERIFIED_TAIL` |
| A4 | **Ciclo cortado pelo período** (entrada antes do início do filtro) | idem para a cabeça | `UNVERIFIED_HEAD` nas bordas do período |
| A5 | **Lacuna "falsa"**: lote antigo ainda aberto liga duas fases do mesmo ciclo | o lote aberto não aparece | mesmo que A3 |
| A6 | **Várias estratégias na mesma conta/contrato** | a posição da **conta** é líquida; a do relatório é por estratégia | escopo do ciclo = **posição da estratégia** (`scope = STRATEGY_POSITION`); sinalizar sobreposição entre chaves (`CROSS_KEY_OVERLAP`); ciclo **da conta** só com execuções |
| A7 | **Entrada manual** sobre posição de estratégia (estratégia em branco) | a chave muda ⇒ separa | idem A6 (conservador); configurável |
| A8 | **Reversão** (long → short no mesmo instante) | uma execução única × duas execuções (fechar e abrir) | **sempre 2 ciclos** (a posição cruza o zero); `link = REVERSAL_CANDIDATE`; a comissão por linha já vem repartida pelo NT8 |
| A9 | **Direções opostas sobrepostas na mesma chave** | impossível numa posição líquida | anomalia `OVERLAP_OPPOSITE_DIRECTION`; não agrupar |
| A10 | **Fills idênticos fundidos** (2 execuções de entrada no mesmo segundo e preço) | indistinguíveis | economicamente equivalentes (P&L não muda); contagem de fills desconhecida |

## 5. Regra de agrupamento SEGURA (proposta)
1. Particionar as linhas por **K = (conta, contrato completo, estratégia, direção)**.
2. Dentro de K, ordenar por horário de entrada e varrer mantendo `fim = max(saídas até aqui)`:
   - `entrada_j < fim` ⇒ **mesmo ciclo** (sobreposição estrita);
   - `entrada_j > fim` ⇒ **novo ciclo** (lacuna);
   - `entrada_j == fim` (ou duração zero) ⇒ **novo ciclo + ambiguidade A1/A2**.
3. Entre chaves da **mesma conta e contrato**: detectar sobreposição (A6/A7) e **reversão** (direção oposta com `entrada == saída`) apenas como **metadado**, sem juntar.
4. Todo ciclo recebe `reconstruction = { method, scope, confidence, ambiguities[], completeness, sourceRows[] }`.
5. **Integridade do relatório:** `Acu_i − Acu_{i−1} = Profit_i` (🟢 nos dados reais) funciona como **sinal de completude** (linhas faltando quebram a identidade). **Não** é fonte do P&L.

## 6. Quando precisamos de Order / Execution / Fill
- **A1/A2** (ordem dentro do segundo) e o **tamanho real da posição** no tempo;
- **A3/A4/A5** (lotes abertos, bordas do período) — precisa de **posições abertas** ou fills fora da janela;
- **A6** (ciclo da **conta**, posição líquida entre estratégias);
- **A8** (uma execução de reversão × duas) e **comissão por fill**;
- classificar `exitReason` por **tipo de ordem** (stop/limit) em vez de pelo **nome**;
- número real de fills de entrada/saída, `orderId`/`fillId` para dedupe e auditoria.
**Não** precisamos de fills para: P&L total, preço médio, hora de entrada/saída, quantidade total, **pico de posição** (calculável por varredura dos intervalos, exceto empates A1), papéis de scale-in/out por intervalo.

## 7. Representação de scale-in, scale-out, reversão, saída parcial e final
Os lotes das linhas são agrupados em **pernas (legs)**:
- **Perna de entrada** = linhas com mesmo (horário de entrada, preço de entrada, rótulo de entrada) somadas em quantidade. 1ª (e as do mesmo segundo inicial) = `ENTRY`; as seguintes = **`SCALE_IN`** (provado por sobreposição).
- **Perna de saída** = linhas com mesmo (horário de saída, preço de saída, **rótulo de saída**) somadas. Rótulos diferentes **não se fundem** (preserva `Stop2` ≠ `Stop3`).
- `sizeAfter` por perna de saída (varredura por **timestamp distinto**): `> 0` ⇒ **`SCALE_OUT`/saída parcial**; `= 0` ⇒ **`EXIT`/saída final**. Pernas no mesmo segundo ⇒ `simultaneous = true` (ordem desconhecida).
- **Reversão**: não é uma perna; são **2 trades** ligados (`boundary.next/prev = REVERSAL_CANDIDATE`), ambos fechando em 0.
- Cada **linha original** fica registrada (`sourceRows`) ligando **perna de entrada × perna de saída × quantidade × valores crus** ⇒ **nada se perde**.

## 8. `exitReason` em trade com várias saídas
A estrutura que você propôs está **correta**; refino:
```
exitLegs[i] = { reason: TARGET|STOP|MANUAL|UNKNOWN, reasonRule: LABEL_RULE|USER_MAP|NONE,
                sourceLabel: "Target1", quantity, at, price, role, sizeAfter, pnl{...}, rowRefs[] }
exitSummary = { finalReason: <da perna que levou a 0>, byReason: {TARGET: qtd, STOP: qtd, MANUAL: qtd, UNKNOWN: qtd},
                mixed: boolean }
```
- **Não existe `exitReason` único no trade**: só `exitSummary` **derivado** (`finalReason` = perna que zerou; se simultâneas, o conjunto).
- **`reason` ≠ resultado.** `STOP` é o **nome** da ordem: um `Stop` em break-even/lucro continua `STOP` (aparece na fixture). Resultado fica em `pnl` da perna.
- **Classificação inicial por rótulo** (heurística, sempre com `reasonRule` e o rótulo original preservado): `Target*`/`TP*`/`Profit*` → TARGET · `Stop*`/`SL*`/`Trail*` → STOP · `Zerar`/`Flat`/`Close`/`Exit*` → MANUAL · resto → UNKNOWN.
- **`MANUAL` aqui significa "comando de zerar/fechar", não necessariamente decisão discricionária** (um `Zerar` pode vir da estratégia). Por isso o mapa de rótulos é **configurável por usuário/estratégia** (`USER_MAP`).
- O **rótulo de entrada** (`Entry`) também é preservado (`sourceLabel` da perna de entrada); não classificamos.

## 9. P&L agregado
**P&L do trade = soma dos P&L das linhas** (cada linha é um par independente, logo é aditivo):
- `net = Σ Profit_linha` · `commission = Σ Corretagem` · `fees = Σ taxas` · `gross = Σ (pontos_linha × pointValue × qtd_linha)`.
- Equivale a `Q × (saída média − entrada média)` com médias ponderadas por quantidade (mesma identidade já usada em `aggregateExecutions`).
- Base do trade: `NET` se **todas** as linhas forem `NET`; se houver mistura/desconhecida ⇒ `UNKNOWN` (não afirmamos).
- P&L **por perna de saída** = soma das suas linhas (exato).
- **`Acu lucro líquido` não é P&L do trade**: só oráculo de completude/teste.

## 10. MAE/MFE com várias linhas — **não somar, não multiplicar**
Verificado nos dados reais (🟢):
1. **Em preço ABSOLUTO, todas as linhas de um mesmo ciclo têm exatamente o mesmo extremo** (`entrada + MFE/(pv·qtd)` e `entrada − MAE/(pv·qtd)` coincidem em todas as linhas — nos dois ciclos da fixture), **mesmo com saídas em horários diferentes e entradas a preços ligeiramente diferentes**.
2. `ETD = MFE − Profit` em **todas** as linhas (🟢) ⇒ ETD é **derivado**, redundante; serve de **verificação de unidade**.
3. 🟡 Há indício de que o NT8 mede a excursão **da posição inteira (até a última saída)** e **repete** o valor em cada linha: no ciclo observado, o extremo favorável ultrapassa o preço do alvo da 2ª saída, que só executou **depois** da 1ª saída — logo o extremo não pode pertencer à janela de vida da 1ª linha.

**Conclusão:** o valor por linha **não é uma excursão independente** — é a **mesma** excursão (do ciclo), repetida e escalada pela quantidade da linha. **Somar triplicaria**; multiplicar por quantidade também erra.
**Regra proposta (trade):** converter cada linha para **preços extremos absolutos** (`high`/`low`), tomar **`high = máximo` e `low = mínimo`** entre as linhas e derivar `mfePoints/maePoints` **relativos à entrada média** (pontos por contrato). Se as linhas **discordarem** nos extremos (janelas diferentes) ⇒ usar o extremo mais amplo e marcar `excursion.conflict = true` (é um **limite inferior** da excursão real). Proveniência: `BROKER_POSITION_LEVEL (inferred)`. US$ do trade = pontos × pointValue × quantidade (informativo). Os valores crus por linha ficam em `sourceRows` (auditoria, sem perda).

## 11. Modelo mínimo (conceitual — sem Prisma)
```
Trade  (extensão do CanonicalTrade → "canonical-trade/2"; campos atuais mantidos, agora DERIVADOS das pernas)
  ├─ cycleKey      { account, contract(raiz+vencimento), strategyLabel|null, direction }
  ├─ quantity      total fechado          peakQuantity (varredura de intervalos)
  ├─ entry / exit  { at, price }          ← 1ª entrada / última saída; preços MÉDIOS ponderados (compatibilidade)
  ├─ entryLegs[]   { at, price, quantity, role: ENTRY|SCALE_IN, sourceLabel, rowRefs[] }
  ├─ exitLegs[]    { at, price, quantity, role: SCALE_OUT|EXIT, sizeAfter, simultaneous,
  │                  reason, reasonRule, sourceLabel, pnl{net,gross,commission,fees}, rowRefs[] }
  ├─ exitSummary   { finalReason, byReason{}, mixed }
  ├─ pnl           agregado (§9)          excursions  { highPrice, lowPrice, mfePoints, maePoints, conflict, source }
  ├─ reconstruction{ method: "NT8_ROW_INTERVALS_V1" | "FILLS_FLAT_TO_FLAT",
  │                  scope: STRATEGY_POSITION|ACCOUNT_POSITION, confidence: HIGH|LOW,
  │                  ambiguities[{code, rowNos[]}], completeness: VERIFIED|UNVERIFIED_HEAD|UNVERIFIED_TAIL,
  │                  boundary{ prev, next: NONE|REVERSAL_CANDIDATE|AMBIGUOUS_TOUCH } }
  └─ sourceRows[]  { rowNo, entryLeg, exitLeg, quantity, profit, commission, fees, maeUsd, mfeUsd, etdUsd, barras }   ← valores CRUS

granularity das pernas: FILL | ORDER_AVERAGE | MATCHED_LOT   (MATCHED_LOT = linha casada do NT8)
```
`TradeLeg` já existe em `executions.ts` (role, quantity, price, at, orderId, fillId, commission, fees, granularity, rowNo): a proposta **promove** esse conceito para dentro do trade, para que **as duas rotas** (fills → `aggregateExecutions`; linhas NT8 → reconstrutor) produzam o **mesmo formato**.

## 12. O `CanonicalTrade` atual comporta isso sem perda? — **Não.**
Tem **uma** entrada e **uma** saída (médias + 1º/último horário) e `source.rowNo` único. Perderia: horário/preço/quantidade de **cada** saída e entrada, **rótulos**, razão por saída, P&L por perna, tamanho após cada saída, papéis scale-in/out, ambiguidades, escopo/confiança, **valores crus por linha** e a excursão com proveniência.
**Menor extensão necessária** (retrocompatível; o motor de métricas **não muda**, pois só lê P&L, horários e R do trade):
`entryLegs[]`, `exitLegs[]` (com `reason`/`sourceLabel`), `exitSummary`, `reconstruction`, `sourceRows[]`, `excursions.{highPrice,lowPrice,conflict}`, `peakQuantity` + `granularity: MATCHED_LOT`. Para fontes simples (template só com data) `legs` pode ser `null`.
Efeito nas métricas: **`totalTrades` passa a contar ciclos** (na fixture, 2 em vez de 7) — resolve a inflação de win rate/contagem; a distribuição por saída (TARGET/STOP/MANUAL) vira uma análise nova baseada em `exitLegs`.

---

## Decisões que preciso de você
1. **Toque ambíguo (A1/A2):** default **separar + sinalizar** (recomendado) ou juntar?
2. **Escopo do ciclo:** **posição da estratégia** (recomendado; chave inclui estratégia) ou da conta (impossível só com o relatório)?
3. **Mapa de rótulos → reason:** aprova os padrões do §8 e a ideia de **mapa configurável**? "Zerar" = `MANUAL` (comando de zerar)?
4. **Excursão do trade:** aprova "extremos absolutos máximos entre as linhas, relativos à entrada média, nunca somar"?
5. **Extensão `canonical-trade/2`** (legs + reconstruction + sourceRows, retrocompatível): aprova?
6. **Ciclos com `confidence = LOW`/`UNVERIFIED_*`:** entram nas métricas com sinalização (recomendado) ou ficam fora por padrão?

## Plano de testes (quando aprovado; nada implementado agora)
Fixture real (2 ciclos esperados, conferidos à mão) · sintéticos: scale-in; scale-out; entradas no mesmo segundo com preços diferentes; toque (A1); duração zero; lacuna de 1 s; reversão; duas estratégias sobrepostas; entrada manual sobre estratégia; qtd > 1 por linha; linhas fora de ordem; linhas faltando (identidade do acumulado quebrada); excursões discordantes; rótulos desconhecidos; soma dos P&L por perna = P&L do trade (invariante).
