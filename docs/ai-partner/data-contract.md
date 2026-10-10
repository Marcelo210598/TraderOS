# MeuTrade — Data Contract (v0.1, 01/10/2026)

Contrato de semântica dos dados canônicos. **É a referência única**: parsers, validador, métricas, evidência e (no Incremento 2) o schema do banco devem obedecê-lo.
Implementação de referência: `src/lib/domain/*` e `src/lib/ingest/*` (testes em `scripts/test-*.mts`, `npm run test:domain`).

## Princípios
1. **Nada é inventado.** Valor desconhecido = `null` (ou erro explícito) + motivo. Nunca um default "razoável".
2. **A origem fica registrada** (`pnl.basisSource`, `fieldProvenance`, `source.settings`): dá para auditar "por que esse número?".
3. **Tempo em UTC**; horário local só é derivado para análise/exibição. Hora ausente nunca é preenchida.
4. **Bruto ≠ líquido.** Um bruto nunca é chamado de líquido; uma base desconhecida não é nem um nem outro.
5. **Dinheiro em `number` arredondado a centavos** (`round2`) na borda; comparações usam tolerância (`pnlTolerance` = max(US$ 0,05; 0,1%)).

---

## 1. Tempo

| Campo | Definição |
|---|---|
| `TimeValue.instantUtc` | instante em UTC (ISO com ms e `Z`); `null` se não há hora |
| `TimeValue.precision` | `DATETIME` (data+hora) · `DATE_ONLY` (só data) · `UNKNOWN` (nada) |
| `TimeValue.localDate` | data civil **na origem** (para `DATE_ONLY` é a única informação) |
| `TimeValue.sourceTz` / `explicitOffset` | fuso IANA usado na conversão / o texto já trazia offset (`Z`, `-03:00`) |
| `TimeValue.ambiguity` | `NONE` · `FOLD_EARLIER_ASSUMED` / `FOLD_LATER_ASSUMED` (hora repetida no fim do horário de verão) |

Regras:
- Texto **sem offset** só é convertido com `sourceTz` explícito (o fuso do PC/plataforma que exportou). Sem ele → `E_TZ_REQUIRED` (linha rejeitada). Nunca se assume UTC ou BRT.
- Data com barra/ponto (`a/b/aaaa`): ordem **DMY/MDY conhecida** (padrão do formato ou do usuário; ou inferida **pelo arquivo inteiro** quando há dia > 12). Ambígua → `E_DATE_ORDER_REQUIRED`.
- Horário de verão é resolvido pelo banco IANA (Intl): **lacuna** (hora inexistente) → `E_TIME_GAP`; **repetição** → política `EARLIER` (padrão) e `ambiguity` sinalizada.
- **Só data ⇒ `DATE_ONLY`, `instantUtc = null`.** (O importador legado grava `data + "T12:00:00.000Z"`, que vira 09:00 BRT — ver §10.)
- Derivados (funções, não gravados): `toLocal(instant, tz)`, `tradingDay(instant)`, `legacySessionType(instant)`, `durationSeconds`.
- **Dia de pregão** (`tradingDay`): convenção CME equity index — a sessão que abre 17:00 CT pertence ao dia **seguinte**; sex ≥ 17:00 CT, sábado e dom < 17:00 CT = `null` (fechado). Overnight e trades que cruzam a meia-noite caem no mesmo pregão.

## 2. Instrumento e `pointValue`

| Campo | Definição / regra |
|---|---|
| `instrument.raw` | símbolo como veio (`MNQ 03-26`, `NQZ6`) |
| `instrument.root` | raiz **do catálogo** (`NQ, MNQ, ES, MES, YM, RTY, CL, GC, SI, ZB, 6E`) ou **`null`** — nunca um palpite |
| `instrument.contract` | `{monthCode, month, yearDigits}` quando o símbolo traz contrato; década **não** é resolvida |
| `instrument.pointValue` | US$ por ponto **por contrato**, do catálogo. **Desconhecido ⇒ `null`** |

- `requirePointValue()` **lança** `UnknownInstrumentError` para desconhecido; `pointValueOrNull()` devolve `null`. **Não existe default.**
- Sem `pointValue` ficam **indisponíveis**: bruto recalculado, `riskUsd`, R líquido, conversão de MFE/MAE de dólar para pontos. Aviso `W_INSTRUMENT_UNKNOWN`.
- `pointValueFor()` legado (**devolve 20 = NQ em silêncio**) está `@deprecated` e **não** é usado no domínio novo.

## 3. Quantidade, preços e pontos

| Campo | Definição | Unidade |
|---|---|---|
| `quantity` | **total de contratos fechados** no round-turn (igual ao NT8); pico de posição fica nas `legs` (`peakQuantity`) | contratos (> 0) |
| `entry.price` / `exit.price` | preço **médio ponderado** por quantidade | preço do instrumento (> 0) |
| `pointsPerContract` | long: saída − entrada · short: entrada − saída; **com sinal** (+ = a favor); independe de quantidade, pointValue e custos | pontos / contrato |

## 4. P&L

| Campo | Definição | Origem | Cálculo | Bruto/Líq. | Depende de qty | Depende de pointValue | Desconhecido → |
|---|---|---|---|---|---|---|---|
| `pnl.reported` | número **como a fonte reportou** | arquivo | — | **base em `pnl.basis`** | já embutido | já embutido | `null` (ex.: trade montado de fills) |
| `pnl.basis` | o que `reported` é: `GROSS` · `NET` · `UNKNOWN` | declarado pela fonte **ou** inferido | ver abaixo | — | — | inferência exige | `UNKNOWN` |
| `pnl.basisSource` | `SOURCE_DECLARED` · `INFERRED_FROM_PRICES` · `DERIVED_FROM_FILLS` · `UNDETERMINED` | — | — | — | — | — | `UNDETERMINED` |
| `pnl.computedGross` | bruto recalculado pelos preços | derivado | `pointsPerContract × pointValue × quantity` | bruto | sim | **sim** | `null` |
| `pnl.gross` (**grossPnl**) | resultado antes de custos | arquivo / derivado | `basis=GROSS`: `reported`; `NET`: `reported + commission + fees` (só se custos conhecidos); fills: `computedGross` | bruto | sim | só p/ fills | `null` |
| `pnl.commission` | corretagem | arquivo | soma | custo | — | — | `null` (**≠ 0**) |
| `pnl.fees` | taxas de bolsa/clearing/NFA… | arquivo | soma | custo | — | — | `null` (**≠ 0**) |
| `pnl.net` (**netPnl**) | resultado **líquido de custos** | derivado | `gross − commission − fees`; se `basis=NET`: `reported` | **líquido** | sim | — | **`null`** se a comissão é desconhecida |
| `pnl.netStatus` | `COMPLETE` (comissão **e** taxas informadas) · `COMMISSION_ONLY` (taxas não informadas) · `UNAVAILABLE` | derivado | — | — | — | — | `UNAVAILABLE` |

**Inferência da base** (quando a fonte não declara): compara `reported` com o cálculo por preços, tolerância `pnlTolerance`:
`reported ≈ computedGross` ⇒ `GROSS` · `reported ≈ computedGross − (commission + fees)` ⇒ `NET` · senão `UNKNOWN`
(⇒ `gross` e `net` ficam **`null`**; só `reported` existe). Sem `pointValue` não há como inferir ⇒ `UNKNOWN`.

`analysisPnl(pnl)` → `{value, kind}` com `kind ∈ NET | GROSS | REPORTED_UNKNOWN_BASIS`: **toda agregação deve carregar o `kind`**; misturar tipos sem rotular é proibido.
**Convenção aprovada:** o P&L canônico das análises é o **líquido** quando disponível; não disponível ⇒ `net = null`, **não** "bruto chamado de líquido".

## 5. Risco e R

| Campo | Definição | Cálculo | qty | pointValue | Desconhecido → |
|---|---|---|---|---|---|
| `risk.stopPrice` / `targetPrice` | níveis iniciais | arquivo/usuário (hoje **nenhuma** fonte do app traz) | — | — | `null`, `riskSource = NONE` |
| `risk.riskPoints` | distância até o stop, **do lado certo** | long: entrada − stop; short: stop − entrada | não | não | `null` + `reason` |
| `risk.riskUsd` | risco em dólar | `riskPoints × pointValue × quantity` | sim | **sim** | `null` |
| **`r.net`** (R canônico) | múltiplo de R **líquido** | `pnl.net / riskUsd` | sim | sim | `null` + `netReason` ∈ `RISK_UNKNOWN`, `RISK_USD_UNAVAILABLE`, `NET_PNL_UNAVAILABLE` |
| `r.points` | R em pontos (**sem custos**) | `pointsPerContract / riskPoints` | não | não | `null` |

Stop do lado errado ou igual à entrada ⇒ **erro** (`E_STOP_WRONG_SIDE`, `E_STOP_EQUALS_ENTRY`). R **nunca é estimado**. `r.net` e `r.points` **não se misturam** na mesma métrica sem rótulo.

## 6. MFE / MAE

| Campo | Definição | Unidade canônica | Origem | Desconhecido → |
|---|---|---|---|---|
| `excursions.mfePoints` | maior movimento **a favor** durante o trade | **pontos por contrato, valor absoluto** | broker (NT8) | `null` + `mfeReason` |
| `excursions.maePoints` | maior movimento **contra** | idem | idem | `null` + `maeReason` |

Conversão (`normalizeExcursion`) conforme a **unidade declarada** do arquivo: `POINTS_PER_CONTRACT` (como está) · `USD_PER_CONTRACT` (`÷ pointValue`) · `USD_TOTAL` (`÷ (pointValue × quantity)`). Motivos de `null`: `NOT_PROVIDED`, **`UNIT_UNKNOWN`** (número sem unidade **não** vira pontos), **`POINT_VALUE_UNKNOWN`**, `NOT_A_NUMBER`.
Coerência: `MFE ≥ ganho realizado` e `MAE ≥ perda realizada` (tolerância 0,05 pt) ⇒ senão `W_MFE_LT_REALIZED` / `W_MAE_LT_REALIZED` (unidade suspeita).
Fontes: NT8 PT-BR documenta MAE/MFE em **dólar total** (padrão do parser); NT8 EN **depende da configuração do usuário** (desconhecida ⇒ não gravamos até o usuário informar).

## 7. Order ≠ Fill ≠ Trade

- **Order**: intenção enviada (0..N fills; pode ser cancelada/parcial). `CanonicalOrder`.
- **Fill / Execution**: execução real (preço, qtd, hora). `CanonicalExecution` com `granularity`: `FILL` (individual) ou **`ORDER_AVERAGE`** (preço médio de uma ordem; vem de relatórios de Orders; **comissão desconhecida = `null`**).
- **Trade**: round-turn **flat → flat** montado dos fills (`aggregateExecutions`): scale-in/out dentro do mesmo trade; **flip** divide o fill (comissão proporcional); posição aberta no fim **não** vira trade; bruto = pelos preços (`DERIVED_FROM_FILLS`); qualquer fill sem comissão ⇒ comissão do trade `null`.

## 8. Qualidade e proveniência

- `dataQuality = COMPLETE` ⇔ entrada **e** saída `DATETIME` **e** `pointValue` conhecido **e** `pnl.basis ≠ UNKNOWN`; senão `PARTIAL`.
- `fieldProvenance[campo] ∈ FILE | INFERRED | DERIVED | ABSENT`.
- `source.settings` guarda as configurações **efetivas** (fuso, ordem de data, locale numérico, unidade de MFE/MAE, base declarada) — auditável.

## 9. Códigos de issue (estáveis)

**ERROR (rejeita a linha):** `E_FILE_EMPTY`, `E_FORMAT_UNKNOWN`, `E_FORMAT_AMBIGUOUS`, `E_PARSER_NOT_FOUND`, `E_TZ_REQUIRED`, `E_TZ_INVALID`, `E_DATE_ORDER_REQUIRED`, `E_DATE_INVALID`, `E_TIME_FORMAT`, `E_TIME_EMPTY`, `E_TIME_GAP`, `E_TIME_ORDER`, `E_NUMBER_EMPTY|FORMAT|AMBIGUOUS`, `E_DIRECTION_INVALID`, `E_QUANTITY_INVALID`, `E_PRICE_INVALID`, `E_INSTRUMENT_EMPTY`, `E_STOP_WRONG_SIDE`, `E_STOP_EQUALS_ENTRY`, `E_EXECUTION_TIME_REQUIRED`, `E_SCHEMA_INTERNAL`.
**WARNING:** `W_TIME_DATE_ONLY`, `W_EXIT_TIME_MISSING`, `W_TIME_FOLD_AMBIGUOUS`, `W_DURATION_OVER_24H`, `W_INSTRUMENT_UNKNOWN`, `W_COMMISSION_MISSING`, `W_PNL_BASIS_UNKNOWN`, `W_PNL_NOT_RECONCILABLE`, `W_PNL_MISMATCH`, `W_EXCURSION_UNIT_UNKNOWN`, `W_EXCURSION_UNCONVERTIBLE`, `W_EXCURSION_NOT_A_NUMBER`, `W_MFE_LT_REALIZED`, `W_MAE_LT_REALIZED`, `W_HEADER_DUPLICATE`, `W_ROW_COLUMN_MISMATCH`, `W_COLUMN_MISSING`.
**INFO:** `I_FEES_NOT_PROVIDED`, `I_R_UNAVAILABLE`, `I_POSITION_OPEN`, `I_ORDER_AVERAGE_FILLS`.

## 10. Semântica ATUAL (legado) × canônica — divergências encontradas

| Campo | CSV import (`importar-client` + `/api/trades/import`) | Sync NT8 (`TraderOSSync.cs` + `/api/sync/ninjatrader`) | Canônico |
|---|---|---|---|
| **Horário** (`Trade.date`) | **só a data**; grava `data + "T12:00:00.000Z"` ⇒ vira **09:00 BRT**; a hora lida em `entry_time` é descartada | `exitTime` (ISO **sem offset**, hora local do PC) lido como **UTC**; `entryTime` **recebido e descartado** | `entry.at` / `exit.at` em UTC, com `sourceTz` explícito; `DATE_ONLY` ⇒ instante nulo |
| **Sessão** (`sessionType`) | `inferSession` pela hora do texto, sem fuso | `detectSession(exitTime)` em ET sobre o instante mal interpretado | derivada de UTC correto (`legacySessionType`) |
| **`pnl`** | "Profit" como veio (**base desconhecida**) | `pts × pv × qty − commission` (**líquido de comissão**, taxas dependem do NT8) | `reported` + `basis` explícitos; `gross`/`net` separados |
| **`pnlPoints`** | `(saída − entrada) × quantidade` | `pts` **por contrato** (4 casas) | **por contrato**, com sinal |
| **commission** | PT-BR: **soma** corretagem + taxas | `ex.Commission` acumulado | `commission` (corretagem) e `fees` (taxas) **separados** |
| **MFE/MAE** | PT-BR: $ → pontos com `pointValueFor` (default NQ); EN: valor cru **sem unidade** | — | pontos/contrato com unidade explícita; sem unidade ⇒ `null` |
| **pointValue** | `pointValueFor()` ⇒ **20 se desconhecido** | `MasterInstrument.PointValue : 20.0` (**mesmo default**) | `null`/erro |
| Outros defaults 20 no app | `trade-form.tsx: POINT_VALUES[…] ?? 20` · `drawdown/result-panel.tsx: pointValueFor` | | a migrar nos chamadores (fora do escopo desta etapa) |
| Dedupe | **nenhum** (sem `externalId`) | `externalId` + anti-espelho | `dedupeKey`/`fillKey` (Incremento 3) |
| Limite de plano | **não aplicado** | **não aplicado** | a preservar no pipeline novo |

> Nada disso foi corrigido no código em produção nesta etapa (sem banco/Prisma/UI). O domínio novo é a base para corrigir (Incrementos 2–3).

---

## 11. Métricas determinísticas (Incremento 4 — `src/lib/metrics/`)

O motor recebe `AnalyticsTrade[]` (= `CanonicalTrade` + `id` estável + vínculos de estratégia/versão/setup/timeframe) e devolve estruturas auditáveis.
**Não conhece** banco, UI, LLM, Evidence completo nem dado de mercado. API: `filterTrades()` → `calculateMetrics()` / `aggregateTrades()` (+ `perTradeR()`).

### 11.1 Princípios
1. **Nada de zero disfarçado:** sem dado ⇒ `value = null`, `available = false`, `reason` (`NO_PNL_DATA`, `NO_LOSERS`, `R_UNAVAILABLE`, `MIXED_INSTRUMENTS`…). Um `0` é um zero verdadeiro.
2. **Cobertura em todo número:** `coverage = {used, total, ratio}` e `sampleSize`. `totalTrades` conta **todos**; cada métrica só usa quem tem o dado.
3. **Base explícita e carimbada** (`basis`): `NET` | `GROSS` (P&L) e `R_NET` | `R_POINTS` (R). **Não existe "melhor disponível"** (misturar bruto e líquido é proibido). Trade sem P&L na base escolhida fica **fora** de vencedores/perdedores/médias/drawdown — e o aviso diz quantos.
4. **R nunca é inferido:** vem do trade canônico (`r.net` = líquido / risco $; `r.points` = pontos / risco em pontos). Sem stop ⇒ sem R.
5. **Dinheiro em centavos inteiros, R em 1e-4 inteiros** (somas exatas); arredondamento só na saída, **meia afasta do zero** por deslocamento decimal (1,005 → 1,01).
   Saída: dinheiro 2 casas · R 4 · percentual (0–100) 2 · razões 4 · pontos 6.
6. **Determinismo:** mesma população ⇒ mesmo resultado, independente da ordem do array. Empates entre extremos desempatam por `id`; a **ordem da sequência** usa o horário de **saída** (desempate: ordem de entrada dos dados).
7. **Evidência-pronto:** cada `MetricValue` traz `metric, value, unit, sampleSize, coverage, basis, available, reason, definitionVersion` (+ `details` com ids). Cada resultado traz `query` (filtros **normalizados** + opções efetivas, incl. fuso), `period`, `population` (`afterFilters`, `tradeSetHash`, `tradeIds` até o limite) e `dataQuality`.

### 11.2 Opções (todas ecoadas no resultado)
| Opção | Padrão | Efeito |
|---|---|---|
| `timeZone` | `America/New_York` | fuso para hora/dia/semana/mês/dia da semana |
| `timeAnchor` | `ENTRY` | instante que define "quando": entrada ou saída |
| `pnlBasis` | `NET` | `NET` usa `pnl.net`; `GROSS` usa `pnl.gross` |
| `rBasis` | `NET` | `NET` = `r.net`; `POINTS` = `r.points` |
| `minSample` | 30 | limiar de amostra baixa (`W_LOW_SAMPLE`); grupo < 3 = `TINY` (mesmos `MIN_SAMPLE`/`MIN_BUCKET` do app) |

### 11.3 Definições (N = trades na população; `pnl_i` na base escolhida; n = |{pnl_i conhecido}|; m = |{R_i conhecido}|)
**Contagens e taxas** — `winners = |pnl>0|`, `losers = |pnl<0|`, `breakeven = |pnl=0|` (todas sobre n). `winRate = 100·winners/n`, `lossRate = 100·losers/n`, `breakevenRate` idem. Empate **não** é vitória nem derrota.
**P&L** — `grossPnl = Σ gross_i`, `netPnl = Σ net_i`, `commission = Σ commission_i`, `fees = Σ fees_i` (cada um **só** sobre quem tem o componente; sem agregar bruto e líquido). `winnersTotal = Σ pnl_i (pnl>0)`; `losersTotal = Σ pnl_i (pnl<0)` (**negativo**). `averageTrade = Σpnl/n` (= expectancy em $); `averageWinner = winnersTotal/winners`; `averageLoser = losersTotal/losers`; `largestWinner/Loser = max/min pnl` (+ `tradeId`).
`payoffRatio = averageWinner/|averageLoser|`. **`profitFactor = winnersTotal/|losersTotal|`** — sem perdedores ⇒ **indisponível** (`NO_LOSERS`), nunca infinito; sem ganhos e com perdas ⇒ 0.
`largestWinnerSharePct = 100·largestWinner/winnersTotal`; `top3WinnersSharePct` idem com os 3 maiores (dependência de outliers).
**R (só m trades com R conhecido)** — `totalR = ΣR`; `averageR = ΣR/m`; `medianR` = mediana (par: média dos 2 centrais); `winRateR = 100·|R>0|/m`; `averageWinnerR`/`averageLoserR` = média dos R>0 / R<0; **`expectancyR = pW·avgWinnerR + pL·avgLoserR ≡ ΣR/m`** (R=0 contribui 0; calculada pela soma exata e o teste confere a identidade).
**Drawdown** — curva `equity_0 = 0; equity_i = equity_{i-1} + v_i` na **ordem de saída**; `peak_i = max(0, max_{j≤i} equity_j)` (o capital inicial **conta como pico**; pico novo exige `>` estrito); `dd_i = peak_i − equity_i`.
`maxDrawdown = max dd_i` (**$ absoluto**; sem % porque não conhecemos o saldo da conta), com `details`: trade do pico, do fundo, `recovered` (1º trade depois do fundo com `equity ≥ pico`), `tradesPeakToTrough`, `tradesToRecover`, `windowTradeIds`. `currentDrawdown = dd_N`. **`maxDrawdownR`** = o mesmo sobre a curva de R (só trades com R, na ordem de saída). Empate de drawdowns ⇒ vale o **primeiro**.
**`recoveryFactor = Σpnl / maxDrawdown`** (lucro líquido ÷ pior queda); sem drawdown ⇒ indisponível (`NO_DRAWDOWN`); negativo quando o resultado é negativo.
**Sequências** — `maxConsecutiveWins/Losses` = maior run de `pnl>0` / `pnl<0` consecutivos; **empate quebra ambas**; empate de tamanho ⇒ 1ª ocorrência. `currentStreak = +n` (n vitórias até o último), `−n` (derrotas), `0` (último foi empate).
**Pontos** — `totalPoints = Σ pointsPerContract_i` e `averagePoints` (por contrato; **não** pondera quantidade). Só com **um único instrumento conhecido** (pontos de ES ≠ pontos de NQ): senão `MIXED_INSTRUMENTS` / `UNKNOWN_INSTRUMENT`.

### 11.4 Filtros (`TradeFilters`) — composáveis, sem função por combinação
`from`/`to` (data local `YYYY-MM-DD`, inclusivo, do instante âncora), `symbol`, `direction`, `account`, `session` (`AM`/`PM`/`OVERNIGHT`, derivada em ET), `hour` (0–23 no fuso), `dayOfWeek` (0=dom), `tradingDay` (dia de pregão CME), `strategyId`, `strategyName`, `strategyVersionId`, `setup`, `timeframe`.
**AND entre campos; array = OR dentro do campo.** Atributo **desconhecido** no trade (ex.: filtro de hora num trade só com data) ⇒ o trade é **excluído e contado** em `report.excluded[campo].unknown` (nunca "passa por não saber"). Filtro inválido (`from > to`, hora 24…) ⇒ `MetricsInputError` (não é ignorado). Filtros são ecoados **normalizados** (caixa, ordenados, sem repetição).

### 11.5 Dimensões (`groupBy`, uma ou várias)
`day`, `tradingDay`, `week` (segunda-feira), `month`, `dayOfWeek`, `hour`, `session`, `symbol`, `direction`, `account`, `strategy` (`strategyId ?? nome`), `strategyVersion`, `setup`, `timeframe`.
Os grupos **particionam** a população: a soma das amostras = total (grupo **desconhecido**, `key = null`, vai por último: "sem horário", "sem setup"…). Cada grupo tem as métricas completas, **cobertura relativa ao grupo** e `sampleFlag` (`OK` ≥ minSample · `LOW` · `TINY` < 3).
Tempo: **DATE_ONLY** só tem data ⇒ entra em `day/week/month/dayOfWeek`; **hora, sessão e dia de pregão** ficam em "sem horário". `session` = derivada do instante (ET); no DATE_ONLY usa a dica declarada pelo usuário, se houver.

### 11.5.1 Fuso
Hora/dia/dia da semana mudam com `timeZone` (ecoado). **Sessão** (ET) e **dia de pregão** (CME) **não** dependem do fuso de exibição. Entrada × saída (`timeAnchor`) muda o dia de um trade que atravessa a meia-noite.

### 11.6 Avisos (`warnings`) e qualidade (`dataQuality`)
`W_NO_TRADES`, `W_LOW_SAMPLE`, `W_R_UNAVAILABLE`, `W_R_PARTIAL_COVERAGE`, `W_PNL_PARTIAL_COVERAGE`, `W_UNKNOWN_BASIS_EXCLUDED`, `W_COMMISSION_PARTIAL`, `W_DATE_ONLY_TRADES`, `W_ORDER_APPROXIMATE`, `W_UNKNOWN_INSTRUMENT`, `W_FILTER_EXCLUDED_UNKNOWN` (+ nos grupos: `W_GROUP_UNKNOWN_BUCKET`, `W_LOW_SAMPLE_GROUPS`).
`dataQuality.level`: `COMPLETE` (todos com líquido, hora completa e instrumento conhecido) · `PARTIAL` · `EMPTY`; mais contagens de P&L conhecido, R conhecido (por motivo), precisão de tempo, instrumentos desconhecidos e ordem aproximada.

### 11.7 Limitações conhecidas (v1.0.0)
- **Drawdown em % não existe** (falta o saldo da conta); só $ e R. Equity usa **apenas trades fechados** (sem marcação a mercado).
- **R só existe se algum trade tem stop**; hoje nenhuma fonte de importação do app traz stop ⇒ na prática R vem de edição do usuário/IA (futuro).
- Strategy/StrategyVersion/setup/timeframe entram como **vínculos externos** (`AnalyticsTrade`); o `CanonicalTrade` ainda só guarda `labels.strategyName`.
- Sequências de trades **só com data** têm ordem intradiária desconhecida (usa a ordem dos dados; avisa).
- Sem MFE/MAE agregados, sem Monte Carlo, sem intervalo de confiança/significância (virão com o Research).
- Em memória (arrays); funções puras, prontas para rodar sobre o resultado de uma query ou num worker.

## 12. canonical-trade/2 — reconstrução de ciclos de posição (NT8)

**Implementado** (spec: `nt8-position-reconstruction-spec.md`). **Unidade analítica.** Uma linha do NT8 Trade Performance = par casado **lote de entrada ↔ lote de saída** (*matched lot*), **não** necessariamente um Trade. O sistema reconstrói `linhas NT8 → matched lots → ciclo de posição → canonical trade`: 7 linhas reais viraram 2 ciclos, 27 viraram 15.

**Invariantes financeiros.** Reconstruir **não pode** mudar `netPnl`, `grossPnl`, `commission`, `fees` nem `quantity` (testado em dado real por `scripts/test-real-nt8-metrics.mts`). Muda a **unidade analítica**, então mudam `trade count`, `averageTrade`, `largestWinner/Loser`, `winRate`. `profitFactor` e `maxDrawdown` são path-dependentes: ficaram iguais nos fixtures reais atuais, mas **não são invariantes garantidos** (um ciclo com linhas de sinais opostos os alteraria).

Linha do NT8 Trade Performance = par casado lote-de-entrada ↔ lote-de-saída, **não** um trade. O **Trade analítico = ciclo reconstruído** (0 → posição aberta → saídas parciais → 0) por chave `conta + contrato (com vencimento) + estratégia + direção`.

- **Só o parser `ninjatrader-trades-ptbr` reconstrói** (`reconstruction: "NT8_ROW_INTERVALS_V1"`). NT8 EN, template e execuções por fill não mudam de comportamento (`granularity: "SOURCE_ROW"`); opt-out via `reconstructCycles: false`.
- **Continuidade:** entrada < última saída do ciclo ⇒ mesmo ciclo; lacuna ⇒ separa; **entrada e saída no mesmo segundo ⇒ separa** + ambiguidade `SAME_SECOND_BOUNDARY` (confiança LOW). Nunca agrupa automaticamente.
- **Campos novos (todos opcionais ⇒ v1 continua válido):** `granularity` (`POSITION_CYCLE`|`SOURCE_ROW`), `peakQuantity`, `entryLegs[]`, `exitLegs[]` (`role`, `sizeAfter`, `simultaneous`, `reason`, `reasonRule`, `pnl`), `exitSummary` (derivado), `reconstruction` (`method`, `scope`, `cycleKey`, `confidence`, `ambiguities[]`, `completeness`, `boundary`, `integrity`), `sourceRows[]` (valores crus preservados), `excursions.{highPrice,lowPrice,conflict,origin}`.
- **exitReason:** `Target*→TARGET`, `Stop*→STOP`, `Zerar|Flat|Close→MANUAL`, demais `UNKNOWN`; mapa configurável (`exitReasonMap`); preserva `sourceLabel` e `reasonRule`. Não existe exitReason único no Trade.
- **P&L:** soma das pernas/linhas (centavos exatos); "Acu lucro líquido" é só **oráculo de integridade** (`CONSISTENT|BROKEN|UNAVAILABLE`), nunca P&L. Base NET só quando todas as linhas concordam.
- **MAE/MFE:** nunca somados. **Descoberta em dado real:** os valores **não** se repetem necessariamente em todas as linhas de um mesmo ciclo (o 2º fixture real trouxe divergência; o 1º não). Regra: preservar os valores crus em `sourceRows`; reconstruir de extremos absolutos (máx high / mín low) relativos à entrada média ponderada (`origin = RECONSTRUCTED_NT8_ROWS`); se divergirem, usar o extremo **mais amplo** e marcar `conflict` + `EXCURSION_CONFLICT`. Nesse caso o valor é um **limite inferior / inferência**, nunca uma medição exata, e não pode ser apresentado como tal.
- **exitReason vazio:** nome de saída ausente ⇒ `UNKNOWN` com `reasonRule = NONE`. **Nunca** inferir Target/Stop/Manual pelo P&L.
- **Ambiguidades:** `SAME_SECOND_BOUNDARY`, `REVERSAL_CANDIDATE` (INFO), `OVERLAP_OPPOSITE_DIRECTION`, `CROSS_KEY_OVERLAP`, `ACCUMULATED_MISMATCH`, `ROWS_REJECTED_IN_FILE`, `EXCURSION_CONFLICT`. Ciclos LOW e com bordas não verificadas (`UNVERIFIED_HEAD|TAIL|BOTH`) **entram nas métricas, sinalizados** (`W_RECONSTRUCTION_LOW_CONFIDENCE`, `W_RECONSTRUCTION_UNVERIFIED_EDGES`, `W_MIXED_GRANULARITY`).
- **Fuso:** ver §13 (quatro conceitos independentes).

## 13. Timezone universal

O MeuTrade não assume onde o usuário mora. Quatro conceitos **independentes**:

| Conceito | Papel | Onde vive |
|---|---|---|
| **storage** | Instante canônico: sempre **UTC** (`instantUtc`, ISO com `Z`). Fonte de verdade, imutável. | `TimeValue.instantUtc` |
| **source** | Interpreta timestamps **sem offset** do arquivo/plataforma. Metadado do import. | `ImportContext.sourceTz` → `source.settings.sourceTz` / `sourceTzOrigin`; `TimeValue.sourceTz` |
| **analysis** | Preferência do usuário para agrupar/exibir (hora, dia, semana, mês, dia da semana). **Nunca é gravado no `CanonicalTrade`.** | opção `AnalysisOptions.timeZone` (ecoada no resultado); futuramente `User.timezone` |
| **market** | Pertence ao instrumento/calendário, independe do usuário: dia de pregão CME em `America/Chicago` (17:00 CT), sessão AM/PM/OVERNIGHT em `America/New_York`. | `tradingDay()`, `legacySessionType()`, `instruments.ts` |

**Defaults.** `DEFAULT_SOURCE_TIME_ZONE` e `DEFAULT_ANALYSIS_TIME_ZONE` são constantes separadas; hoje ambas valem `America/Sao_Paulo` por **compatibilidade**, não por regra do produto, e podem divergir. A fonte só cai no default se o chamador não informar nenhum fuso, e isso é registrado (`sourceTzOrigin = DEFAULT`) e avisado (`W_SOURCE_TZ_DEFAULTED`, mensagem neutra com o fuso usado). Virar bloqueio fica para o fluxo de importação.

**`sourceTzOrigin`:**

| Valor | Significado |
|---|---|
| `USER` | O usuário/chamador informou o fuso explicitamente. |
| `FILE_OFFSET` | Todos os horários com hora traziam offset explícito; o offset é a autoridade e `sourceTz` fica `null` (nunca parece ter sido interpretado pelo default). |
| `FILE_DECLARED` | O formato do arquivo declara o fuso. **Reservado**: nenhum parser real emite ainda; só o contrato o aceita. |
| `DEFAULT` | Assumido pelo default configurado (`DEFAULT_SOURCE_TIME_ZONE`). |

Regras de proveniência: o offset explícito já é representado por `TimeValue.explicitOffset = true` + `sourceTz = null` (sem campo novo). Se o chamador informa `sourceTz` e o texto traz offset, vale o offset no instante e a origem do import segue `USER`. Por linha, `source.settings.sourceTzOrigin` reflete o que **aquela** linha usou; no resultado do arquivo, `FILE_OFFSET` só aparece se todas as linhas se bastaram com o offset.

**Invariantes:**
- `analysisTimezone` **não altera** P&L, quantidade, sequência financeira (ordem por UTC) nem o instante UTC; só altera agrupamentos temporais (`hour`, `day`, `week`, `month`, `dayOfWeek`). `session` e `tradingDay` são de mercado e não mudam com ele. Ex.: um trade às 23:30 UTC é 12/01 em SP/NY e 13/01 em Berlim/Tóquio.
- `DATE_ONLY` não tem instante: dia/semana/mês vêm da data da fonte e **não** são convertidos pelo fuso de análise; hora e sessão ficam indisponíveis.
- Fuso é **sempre IANA** (`America/New_York`, `Europe/Berlin`…). Offsets fixos (`UTC-3`) não são aceitos como configuração (`E_TZ_INVALID`).
- DST segue as regras IANA: hora inexistente → `E_TIME_GAP`; hora repetida → `FOLD_*_ASSUMED` registrado.
- Nunca converter silenciosamente com fuso desconhecido; heurísticas (ex.: janela de pregão) podem no máximo **sugerir**.
- `User.timezone` (Prisma legado, default `America/Sao_Paulo`) é candidato a `analysisTimezone`; não foi alterado nesta etapa.

## 14. Evidence — arquitetura aprovada (evidence/1, NÃO implementada)

> **Evidence não é uma segunda fonte de verdade.** Canonical Trade = verdade analítica · Metrics = verdade dos cálculos · Evidence = rastreabilidade, explicação e verificação. Nunca duplica o CSV.

```text
Claim → MetricEvidence → population.tradeIds → TradeEvidence → SourceRowRef → ImportRef
```

Decisões aprovadas:
- **Hash:** SHA-256 via `node:crypto`, atrás de um adaptador de infraestrutura/servidor (sem criptografia manual e sem espalhar a dependência pelo domínio). `tradeSetHash` passa a SHA-256 na Evidence.
- **tradeId:** determinístico e reprodutível (identidade do import/arquivo + linhas de origem + identidade da reconstrução); **sem UUID/random**; mesmo conteúdo ⇒ mesmo id; imports diferentes não colidem; mudança material na reconstrução pode mudar o id; reordenar linhas sem mudar a semântica não precisa mudar a identidade. `fileHash:firstRowNo` **não** é a identidade definitiva.
- **Privacidade:** `account.sourceName` fica só na proveniência interna; a Evidence exposta usa `accountRef` (fingerprint não reversível).
- `importedAt` e `computedAt` ficam **fora** do hash de identidade; JSON canônico (chaves ordenadas).

Campos mínimos: **ImportRef** (importId, platform, parserId/Version, reconstructionMethod/Version, fileName, fileSha256, fileBytes, encoding, lineEnding, rowsRead/Accepted/Rejected, sourceTz, sourceTzOrigin, dateOrder, numberLocale, excursionUnit, declaredPnlBasis, resumo da reconstrução, importedAt) · **SourceRowRef** (importId, rowNo, rowHash, reportedProfit, commission, fees, quantity, preços, rótulos, MAE/MFE/ETD crus) · **TradeEvidence** (tradeId, importId, instrumento, direção, qty, pico, entradas/saídas, pnl{net,gross,commission,fees,basis,basisSource}, legs+rowRefs+label+reasonRule, reconstruction, excursions, issues, fieldProvenance, sourceRows) · **MetricEvidence** (metricId, definitionVersion, engineVersion, value, unit, basis, sampleSize, coverage, reason, query/filtros/opções/timeZone/groupKey, period, population{inputTrades, afterFilters, tradeSetHash, tradeIds, filterReport}, contributors, dataQuality, warnings) · **EvidenceBundle** (`evidence/1`, claim, subject, evidence, evidenceHash).

Lacunas conhecidas (G1–G9): id posicional; sem ImportRecord/SHA-256/encoding/importId/versão do motor; sem `rowHash`; `tradeSetHash` = hash53 e fingerprint incompleto (**fechado no E2**); sem mapa de contribuintes; sem dimensão/métrica por motivo de saída (P&L por motivo existe só por perna, `exitLegs[].pnl`); confiança/ambiguidade/completude não sobem para a Evidence individual; sem claim nem schema versionado; privacidade de `account.sourceName`. Plano E1–E6 e retomada: `MEUTRADE-CHECKPOINT-2026-10-01.md`.

### 14.1 E1 — identidade e import (IMPLEMENTADO em 2026-10-08)

Código: `src/lib/infra/hash.ts` (único ponto com `node:crypto`: `sha256Hex`, `canonicalJson`, `hashCanonical`) · `src/lib/ingest/identity.ts` · testes `scripts/test-evidence-identity.mts`. Tudo **aditivo e opcional** no `canonical-trade/2` (v1 continua válido). Fecha G1, G2, G3 e G9 (parcial: `account.ref`; `sourceName` ainda existe no trade, só não entra em hash/Evidence).

| Campo | Definição |
|---|---|
| `PipelineResult.importRecord` | `ImportRecord`: `importId`, `fileSha256` (**do texto UTF-8 recebido**, `hashBasis: "UTF8_TEXT"` — não dos bytes originais), `fileBytes`, `hasBom`, `lineEnding`, parser, `reconstructionMethod/Version`, contagens, `settings`. **Sem `importedAt`** (quem persiste grava; fora do hash) |
| `importId` | `imp_` + H(fileSha256 + parserId/Version + settings efetivas). Fora: `fileName`, `ctx.fileHash`, `accountRefSalt` |
| `rowHash` (em `sourceRows[]`) | H(conteúdo da linha: conta via ref, estratégia, ativo, direção, qtd, horário **cru** + UTC, preços, rótulos, P&L declarado, comissão, taxas, MAE/MFE/ETD, barras). **Sem** nº da linha e **sem** acumulado (dependem da ordem) |
| `tradeId` | `trd_` + H(importId + granularidade + identidade da reconstrução [método + `RECONSTRUCTION_VERSION`, só p/ ciclos] + `rowHash`es ordenados + ordinal de duplicata). Sem UUID/random |
| `account.ref` | `acc_` + 24 hex de H(domínio + sal + nome aparado). **Pseudônimo, não segredo**; passar `accountRefSalt` (ex.: id do usuário) para não ser igual entre usuários |

Decisões tomadas no E1 (revisáveis):
- **O id é por import.** Reordenar as linhas do arquivo (ou qualquer byte novo) gera outro `importId` e portanto outros `tradeId`; o que permanece invariante é o `rowHash` e a composição dos ciclos. Dedupe do mesmo trade entre exports diferentes/sobrepostos **não** foi decidido (usar `rowHash` quando chegar a hora). **Desde o E5.0:** o mesmo arquivo importado 2× no mesmo conjunto (mesmo `importId` ⇒ mesmos `tradeId`) é recusado pelo `explainMetric` com `E_DUPLICATE_TRADE_ID` (§14.5); o dedupe em si continua não decidido.
- `exitReasonMap` do usuário **não** entra no `tradeId` (reclassificar rótulo não troca o trade); `RECONSTRUCTION_VERSION` (em `reconstruct.ts`) **deve subir** quando o algoritmo de ciclos mudar de resultado.
- Linhas idênticas (mesmo conteúdo, mesmo import) ganham ordinal pelo nº da linha: não colidem e são determinísticas.
- `toAnalyticsTrades` passou a preferir `trade.tradeId` (fallback posicional continua para trades sem identidade).
- `tradeSetHash` ainda era hash53 no E1 — trocado no E2 (§14.2).

### 14.2 E2 — schema `evidence/1` e hashes (IMPLEMENTADO em 2026-10-08)

Código: `src/lib/evidence/` (`schema.ts`, `hash.ts`, `redact.ts`) · testes `scripts/test-evidence-schema.mts`. **Só o formato e os hashes**: ainda não há geradores (E3 `explainTrade`, E4 `explainMetric`, E5 `verifyEvidence`). Fecha G4 e G8 (formato).

**`tradeSetHash` agora é SHA-256 (hex, 64)** em `MetricsResult.population` e em cada `GroupResult` — um único hash canônico; `hash53` foi **removido** (`exact.ts`). Nenhum consumidor fora de testes/docs existia (busca no projeto). Cobre a população **completa**; `tradeIds` continua limitado a `tradeIdsLimit` (500) só para listagem — acima disso `tradeIds = null` e vale o hash. Independe da ordem dos trades e do limite.

Entrada de cada trade no fingerprint: `id` do motor · `tradeId` · `importId` · granularidade · `rowHash`es (ordenados) · identidade da reconstrução (método, confiança, completude, integridade, códigos de ambiguidade) · valores (net, gross, comissão, taxas, R, instantes). Entradas ordenadas pelo JSON canônico antes do hash.

**Fallback sem identidade:** trade sem `tradeId`/`importId` continua entrando (id posicional `<fileHash|file>:<linha>`), mas `Population.provenance = { withIdentity, withoutIdentity }` e o aviso `W_TRADE_IDENTITY_MISSING` (INFO) sinalizam a proveniência incompleta. Os números das métricas não mudam.

**`evidence/1`** (`EvidenceBundle`: `schema, claim, subject, evidence{imports, trades, metrics}, evidenceHash`): todos os objetos são `strict` (campo não previsto é rejeitado). Reaproveita `ImportRecord`, `SourceRow` (+`importId`, `rowHash` obrigatório), `Pnl`, legs etc. do canonical. `evidenceHash` = SHA-256 do JSON canônico do bundle **sem** `evidenceHash`, `imports[].importedAt` e `metrics[].computedAt`, com `imports` (por importId), `trades` (por tradeId) e `metrics` (por JSON canônico) em ordem canônica.

**Privacidade:** `TradeEvidence` só tem `accountRef`; **não existe** `sourceName`. Atenção: no Canonical o nome da conta também aparece em `reconstruction.cycleKey.account` — na Evidence esse campo vira `cycleKey.accountRef` (`redactReconstruction` em `redact.ts`; o schema recusa a forma não redigida). **Pendente para o E4:** `MetricEvidence.query.filters.account` e `groupKey` (dimensão `account`) podem carregar o nome da conta quando a consulta filtra/agrupa por conta — o gerador precisa trocá-los por `accountRef`.

`MetricEvidence.contributors` existe só como formato opcional (G5): quem preenche é o E4.

### 14.3 E3 — `explainTrade` (IMPLEMENTADO em 2026-10-08)

Código: `src/lib/evidence/explain-trade.ts` (`explainTrade`, `explainTrades`) · `redact.ts` · testes `scripts/test-evidence-explain-trade.mts` (+ gerador sintético `scripts/_evidence-fixtures.mts`).

```text
explainTrade(trade: CanonicalTrade, importRecord: ImportRecord, { accountRefSalt?, knownAccountNames? })
  → { ok: true, tradeEvidence, importRef, notes[] } | { ok: false, code, message }
```
Cópia fiel, **projeção por lista branca** (nunca `...trade`/`...source`; um teste varre o código-fonte). Nada é recalculado (P&L, R, MAE/MFE, reconstrução), o CSV não é relido, não há relógio/random/banco e **não existe hash por trade** (a integridade é do `evidenceHash` do bundle; a identidade é o `tradeId` do E1).

Erros (retorno, nunca exceção): `E_IDENTITY_MISSING` (sem `tradeId`/`importId` — **nunca se fabrica id**) · `E_IMPORT_MISMATCH` (importId ou método de reconstrução ≠ do ImportRecord) · `E_ACCOUNT_KEY_MISMATCH` · `E_ROWREF_DANGLING` (perna aponta para linha fora de `sourceRows`) · `E_ACCOUNT_NAME_LEAK` · `E_SCHEMA`. Notas (não são erro): `N_ROWHASH_MISSING`/`N_SOURCE_ROWS_MISSING` ⇒ `provenance: "INCOMPLETE"`; `N_FILENAME_REDACTED`.

Rastreabilidade: `TradeEvidence.sourceRows[]{importId, rowNo, rowHash}` → `ImportRef` (arquivo, SHA-256, parser, versão da reconstrução). Ciclo: `detail: "FULL"` (valores crus por linha, MAE/MFE/ETD **nunca somados**). Trade-linha (`SOURCE_ROW`): `source.rowHash` (campo **novo, opcional, aditivo** do Canonical, preenchido no pipeline só nesses trades) alimenta um ref `detail: "TRADE_VALUES"`; o que só o pipeline conhecia (rótulos, MAE/MFE/ETD crus, acumulado) fica `null` — declarado, não inventado.

Ajustes no schema do E2: removido `TradeEvidence.ambiguities` (única fonte: `reconstruction.ambiguities`); `excursions` estrito (`mfe/maePoints`, `*Reason`, `high/lowPrice`, `conflict`, `origin` — `undefined` do canonical vira `null`); `reconstruction.version` (do `ImportRecord.reconstructionVersion`); `SourceRowRef` ganhou `detail` e `rowHash` nullable.

**Privacidade (fail-closed):** `account.sourceName` e `reconstruction.cycleKey.account` viram `accountRef`; `labels.notes/tags` e `source.fileName/fileHash` não entram. O **`fileName` é mantido** como proveniência, mas nomes de conta conhecidos dentro dele são trocados pelo `accountRef` (nome com ≥ 4 caracteres: por substring; menores: só como token inteiro; sem distinguir caixa). O original continua só no `ImportRecord`. Trava final varre todo valor/chave da saída; achou nome de conta ⇒ `E_ACCOUNT_NAME_LEAK` e nada é devolvido. **Regra do `fileName` (fechada após a revisão do E3):** `ImportRef.fileName` só é exposto quando a lista de contas do import é **completa**; senão é `null` (nota `N_FILENAME_OMITTED`). "Completa" = os nomes distintos informados somam `ImportRecord.accountCount` (campo novo: só a **contagem** de contas distintas de todas as linhas lidas, inclusive rejeitadas — nunca os nomes) e incluem a conta do trade. Sem heurística para descobrir contas pelo nome do arquivo. `explainTrades` monta a lista a partir dos trades que recebe: se receber só um subconjunto de um arquivo multi-conta (ou se houver conta só em linha rejeitada), a lista é incompleta e o `fileName` fica `null`; quem tiver a lista completa pode passá-la em `knownAccountNames`. O nome original permanece só no `ImportRecord` interno.

### 14.4 E4 — `explainMetric` (IMPLEMENTADO em 2026-10-08)

Código: `src/lib/evidence/explain-metric.ts` · trace em `src/lib/metrics/trace.ts` (+ instrumentação de `computeMetricSet`) · testes `scripts/test-evidence-explain-metric.mts`.

```text
MetricsResult ──(mesma passada)──► trace ──► MetricEvidence ──► TradeEvidence ──► SourceRowRef ──► ImportRef
calculateMetricsTraced / aggregateTradesTraced → { result, trace }      (result ≡ calculateMetrics / aggregateTrades)
explainMetric({ metricId, source: METRICS | AGGREGATE{TOTAL|GROUP}, trades: AnalyticsTrade[], importRecords, opts }) → { ok, metricEvidence, tradeEvidences, importRefs, notes } | { ok:false, code }
```
**Sem segundo motor.** O trace é registrado pelo próprio `computeMetricSet` (que já construía vencedores, perdedores, classificados, R conhecido, janela do drawdown, sequências); sem `TraceBuilder` nada muda. `calculateMetrics`/`aggregateTrades` são wrappers do mesmo caminho (`runMetrics`/`runAggregate`): resultado idêntico, incl. `tradeSetHash` (teste de não-regressão e comparação contra o commit anterior). `explainMetric` **copia** valor/população/período/qualidade/avisos do resultado e os contribuintes do trace; só **confere** o `tradeSetHash` (SHA-256 do E2), nunca o recalcula; um teste varre o código-fonte para garantir que não importa motor/filtro/preparo e não faz conta com P&L.

**Contribuintes (G5), vocabulário FECHADO de 18 papéis**, exatamente o que o trace registrou — não é "soma que bate": `winners`→WINNER · `losers`→LOSER · `breakeven`→BREAKEVEN · `classifiedTrades/winRate/lossRate/breakevenRate`→WINNER+LOSER+BREAKEVEN+EXCLUDED_NO_PNL · `grossPnl/netPnl/commission/fees`→INCLUDED+EXCLUDED_UNKNOWN · `winnersTotal/averageWinner`→WINNER · `losersTotal/averageLoser`→LOSER · `payoffRatio/profitFactor`→WINNER+LOSER · `averageTrade`→INCLUDED · `largestWinner/Loser`→LARGEST_* · `largestWinnerSharePct`→LARGEST_WINNER+WINNER · `top3WinnersSharePct`→TOP_WINNER(rank 1–3)+WINNER · `totalR/averageR/winRateR/expectancyR`→R_POSITIVE+R_NEGATIVE+R_ZERO+EXCLUDED_R_UNKNOWN · `averageWinnerR`→R_POSITIVE · `averageLoserR`→R_NEGATIVE · `maxDrawdown/maxDrawdownR`→DRAWDOWN_PEAK / _WINDOW (exclusiva) / _TROUGH / _RECOVERY (rank = posição na sequência de saída) · `maxConsecutiveWins/Losses/currentStreak`→STREAK_RUN · `totalPoints/averagePoints`→INCLUDED (ou EXCLUDED_UNKNOWN com o motivo). **Sem conjunto natural (`applicable:false`, sem papel inventado):** `totalTrades`, `medianR`, `currentDrawdown`, `recoveryFactor`.

**Limite (`tradeIdsLimit`, padrão 500):** até o limite, `population.tradeIds` e os contribuintes vêm completos (`verifiability: FULL`). Acima: `tradeIds = null`, `verifiability: HASH_ONLY`, `contributors.complete = false`, `items` só com as âncoras (LARGEST_*, TOP_WINNER, DRAWDOWN_PEAK/TROUGH/RECOVERY), `roleCounts` **sempre completo**, e o `tradeSetHash` segue sendo o da população COMPLETA. Não se finge que uma lista parcial é a população.

**Grupos:** `scope: "GROUP"` + `query.groupBy` + `groupKey` (dimensão `account` ⇒ `accountRef`); população do grupo = ids do grupo; `tradeSetHash` do grupo conferido contra o trace. O motor só calcula período, qualidade e avisos para a população total: em GROUP ficam `null`/`[]` (não se inventa); `sampleFlag` (OK/LOW/TINY) vem do grupo.

**Privacidade:** `query.filters.account` ⇒ `accountRefs` (lista explícita de campos de filtro: filtro novo só entra por decisão); `label` do grupo nunca entra; nenhum nome de conta em contribuintes/avisos/qualidade; `fileName` segue a regra do E3 (lista completa de contas); trava fail-closed `E_ACCOUNT_NAME_LEAK`. `dataQuality` (contagens do motor) é copiado por cópia profunda — protegido pela trava, não por lista branca campo a campo.

**Identidade:** população com qualquer trade sem `tradeId`/`importId` ⇒ `E_POPULATION_IDENTITY_MISSING` (o motor continua calculando; só não se emite Evidence). Erros: `E_METRIC_UNKNOWN`, `E_SCOPE_INVALID`, `E_RESULT_TRACE_MISMATCH` (resultado e trace de chamadas diferentes), `E_TRADE_UNRESOLVED` (inclui id do motor ≠ `tradeId`), `E_IMPORT_UNRESOLVED`, `E_TRADE_EXPLAIN_FAILED`, `E_ACCOUNT_NAME_LEAK`, `E_SCHEMA`. O resultado do motor e o trace precisam vir da mesma chamada.

Schema (E2→E4, aditivo): `MetricEvidence` ganhou `scope`, `sampleFlag`, `verifiability`, `contributors{applicable,complete,roleCounts,items}`, `query.groupBy`, `period`/`dataQuality` nuláveis. **Fica para o E5:** verificar a métrica (recalcular a partir dos TradeEvidence e conferir hashes); nada disso está no E4. *(O E5.0, §14.5, só garantiu que a Evidence carrega os dados para isso.)*

### 14.5 E5.0 — dados para verificar + `E_DUPLICATE_TRADE_ID` (IMPLEMENTADO em 2026-10-09)

**Preparação do E5 (`verifyEvidence`), sem implementá-lo.** Nada é recalculado: nenhuma métrica, nenhum `tradeSetHash` e nenhum resultado do motor mudou (provado contra o commit anterior, `88cdad3`: golden pinado em `test-evidence-explain-metric.mts`, 234 `MetricEvidence` idênticos e 66 comparações de hash/resultado iguais em sintético + 2 fixtures reais, ciclos e linhas). Continua `evidence/1`: não há persistência nem consumidor externo, então a mudança é **aditiva e sem `evidence/2`**; os bundles já gerados não são lidos por nada (o `evidenceHash` dos bundles muda **de propósito**, porque `TradeEvidence` ganhou campos).

**Campos novos no `TradeEvidence` (todos OBRIGATÓRIOS e `strict`; cópia fiel do `CanonicalTrade`, sem conta):**

| Campo | Origem | Para quê |
|---|---|---|
| `r.net` | `trade.r.net` | R líquido (fingerprint + `totalR`/`averageR`/… com `rBasis: NET`) |
| `r.netReason` | `trade.r.netReason` (`NET_PNL_UNAVAILABLE` · `RISK_UNKNOWN` · `RISK_USD_UNAVAILABLE` \| null) | motivo de `r.net` ser null (`dataQuality.r.unknownByReason`) |
| `r.points` | `trade.r.points` | R em pontos (fingerprint + `rBasis: POINTS`) |
| `risk.reason` | `trade.risk.reason` (`STOP_MISSING` · `STOP_WRONG_SIDE` · `STOP_EQUALS_ENTRY` \| null) | motivo do R em pontos (`rBasis: POINTS`) |
| `pointsPerContract` | `trade.pointsPerContract` | `totalPoints`/`averagePoints` |

Os enums vêm de **uma fonte só** (`RiskReasonSchema`/`RNetReasonSchema`, exportados de `domain/canonical.ts` e usados pelo Canonical e pela Evidence — sem duplicar a lista). **Não entram** `stopPrice`, `targetPrice`, `riskPoints`, `riskUsd` nem `riskSource` (nenhuma métrica os lê; a Evidence não vira cópia do Canonical). `labels.strategyName` e `sessionHint` também ficam de fora de propósito: só alimentam filtro/agrupamento por estratégia/sessão, que o E5 **não reaplica** (a população do bundle já está definida).

**Fingerprint a partir da Evidence.** `tradeFingerprintFromEvidence(e)` (em `evidence/hash.ts`) produz o MESMO fingerprint de `tradeFingerprint(id, canonical)`: as duas funções chamam a mesma `fingerprintOf` (a fórmula vive num lugar só). Detalhe que importa: **(ajustado em §14.6)** os `rowHashes` do fingerprint são o `rowHash` de todas as linhas de origem do trade — no ciclo, as de `sourceRows`; no trade-linha, o `source.rowHash`. *(Na primeira versão do E5.0 o trade-linha não o incluía; foi corrigido logo depois.)* Testes (sintético + 2 fixtures reais, ciclos e linhas, com e sem stops): fingerprint da Evidence ≡ fingerprint do Canonical, por trade; `tradeSetHash` refeito da Evidence ≡ o do motor.

**Reconstrução provada em teste (sem `verifyEvidence`).** Um *probe* de teste (`scripts/_evidence-fixtures.mts → probeFromEvidence`) monta `AnalyticsTrade` **só** com campos do `TradeEvidence`; o MESMO `calculateMetricsTraced` sobre eles devolve resultado completo e trace idênticos (JSON canônico) ao do Canonical — R líquido e em pontos, pontos, P&L bruto/líquido, fuso e âncora (`America/New_York`/`EXIT`), `tradeIdsLimit` baixo, `minSample`, e agregados por `hour`/`direction`/`dayOfWeek`. O pipeline do NT8 nunca produz R (a linha não traz stop); para exercitar R com valores e motivos, os testes aplicam stops determinísticos via `computeRisk`/`rMultiple*` do próprio domínio (`withRisk`: R válido, `STOP_WRONG_SIDE`, `STOP_EQUALS_ENTRY`, `STOP_MISSING`). Agrupar por **conta/estratégia/sessão** não é reproduzível só com a Evidence (nome da conta nunca sai; estratégia/sessão não vão) — e não precisa ser, pelo motivo acima.

**`E_DUPLICATE_TRADE_ID` (novo código do `explainMetric`).** Se o conjunto `trades` tem o mesmo `tradeId` mais de uma vez (caso típico: o mesmo arquivo importado duas vezes ⇒ mesmo `importId` ⇒ mesmos `tradeId`), a Evidence é **recusada**, com mensagem que cita a causa (nº de ids repetidos, o menor id e sua contagem, o `importId`; sem nome de conta; determinística). Valem as regras: (1) o motor **não mudou** — `calculateMetrics` continua aceitando e contando cada ocorrência, desambiguando por dentro com o sufixo `#n` (que só garante unicidade ao motor); (2) esse sufixo **não é identidade** — antes o erro aparecia como `E_TRADE_UNRESOLVED` ("id do motor ≠ tradeId"), escondendo a causa; (3) **nada** é deduplicado em silêncio nem contado em dobro sem aviso; (4) a checagem olha o conjunto de entrada inteiro (inclusive repetição que o filtro deixaria fora da população e limites baixos/`HASH_ONLY`); (5) sem `tradeId` o erro continua `E_POPULATION_IDENTITY_MISSING`. O dedupe de verdade entre exports sobrepostos segue **não decidido** (a decisão virá com a persistência).

**Limites que o E5 deve declarar (decididos em 2026-10-09):**
- **`evidenceHash` não é assinatura digital.** É um selo de integridade interna: quem altera o conteúdo **e recalcula** o hash obtém um bundle com selo válido. A verificação de população e métricas (V3/V4) pega edição inconsistente; edição consistente + novo selo só se prova contra o **CSV original** (E5b, opcional) ou com assinatura/âncora externa (fora de escopo).
- **O E5 verifica a população DECLARADA, não a correção da seleção original.** O bundle não traz o conjunto de entrada completo (`inputTrades` é só uma contagem), então não prova que os filtros escolheram essa população.
- **`HASH_ONLY` (população > 500) nunca é `VALID`:** status geral `UNVERIFIABLE`, com V0 (formato), V1 (selo) e V2 (referências) executados quando possível, V3 e V4 marcados `SKIPPED`, e âncora adulterada detectada sempre que os dados disponíveis permitirem. `VALID` exige a população completa verificável.
- `rowHash` e `tradeId` não são recalculáveis só com o bundle (o `rowHash` usa horário cru, conta e ativo; o `tradeId` usa um ordinal entre duplicatas); só se provam contra o CSV original.

### 14.6 Ajuste pós-E5.0 — `rowHash` no fingerprint dos trades `SOURCE_ROW` (2026-10-09)

**Decisão do usuário:** a identidade do trade (`tradeId`) não substitui a verificação da integridade da **referência à linha de origem**. Antes, o fingerprint de um trade-linha não incluía o `rowHash` (só o `tradeId`, que deriva dele): trocar o `rowHash` na Evidence e recalcular o `evidenceHash` passava despercebido, porque o `tradeSetHash` não mudava. Agora:

- **Canônico:** `tradeFingerprint` usa `source.rowHash` nos `SOURCE_ROW` (e continua usando os `sourceRows[].rowHash` nos `POSITION_CYCLE`, inalterado).
- **Evidência:** `tradeFingerprintFromEvidence` usa o `rowHash` de todas as `sourceRows` do `TradeEvidence` (as `FULL` do ciclo; a única `TRADE_VALUES` do trade-linha). Fórmula única em `fingerprintOf`.
- **Efeito nos hashes:** o `tradeSetHash` de populações de **trades-linha** mudou (e, por consequência, o `evidenceHash` dos bundles dessas populações). O de **ciclos** é **idêntico** ao anterior. **Nenhum valor de métrica mudou:** `metrics`, resultado do motor sem o campo `tradeSetHash`, métricas por grupo e traces são byte a byte iguais aos do commit anterior (sintético e as 2 fixtures reais, ciclos e linhas; golden pinado em `test-evidence-explain-metric.mts`; `calculateMetrics` ≡ `calculateMetricsTraced` segue valendo).
- **O que isso detecta — e o que não:** detecta **inconsistência entre os hashes**: alguém troca o `rowHash` (e até recalcula o `evidenceHash`), mas o `tradeSetHash` declarado no `MetricEvidence` continua o antigo ⇒ o hash refeito a partir dos `TradeEvidence` diverge. **Não prova autenticidade** contra uma alteração **coordenada** de todos eles (`rowHash` + `tradeSetHash` + `evidenceHash`): esse bundle é internamente consistente. Essa prova depende de **comparar com o CSV original** (E5b).

**Agrupamentos no E5 inicial (decidido em 2026-10-09; sem ampliar o schema agora):** o E5 verifica os cálculos **sobre a população declarada no bundle**; isso não prova que a seleção original dos trades foi correta nem completa.
- **Conta:** conferir a associação por `accountRef` (`TradeEvidence.accountRef` × `groupKey`/`filters.accountRefs` do `MetricEvidence`) quando os dados estiverem presentes.
- **Estratégia e sessão:** o `TradeEvidence` não tem referência correspondente (nome de estratégia e `sessionHint` ficam fora de propósito; **não** entram em texto aberto). O verificador **não afirma** que a associação ao grupo foi verificada: o check de associação é `SKIPPED` (não verificável) conforme o contrato do verificador. O valor da métrica do grupo continua verificável sobre os trades listados.
- **Evolução futura:** possível (ex.: referência não reversível de estratégia/sessão, como já é o `accountRef`), mas **fora do escopo agora**.

**E5b (verificação contra o CSV original) — fica para depois:** reexecuta a ingestão sobre o arquivo e compara `fileSha256`, `importId`, `rowHash` e `tradeId`. O E5 atual verifica a **consistência interna** do bundle e os cálculos sobre a população declarada; **não afirma provar a origem dos dados**.

### 14.7 E5.1 — `verifyEvidence`: V0 formato · V1 selo · V2 referências (IMPLEMENTADO em 2026-10-09)

> **Atualizado pelo E5.2 (§14.8):** V3 e V4 agora existem e `VALID` passou a ser produzido. Este §14.7 descreve V0–V2 e o raciocínio do status; onde diz "V3/V4 não existem" ou "nunca VALID", vale o §14.8.

Código: `src/lib/evidence/verify.ts` · testes `scripts/test-evidence-verify.mts`. **Só V0, V1 e V2.** V3 (população: `tradeSetHash` refeito dos `TradeEvidence`) e V4 (métricas recalculadas pelo motor) **não existem ainda** (E5.2). Puro (sem relógio, random, banco, CSV, rede), nunca lança para dado malformado e **não é segundo motor nem segunda implementação de hash**: o selo usa `computeEvidenceHash` (JSON canônico + SHA-256 do E2); um teste varre o código-fonte (imports permitidos, sem `node:crypto`, sem cálculo com P&L/R/pontos, sem `VALID`).

```text
verifyEvidence(input: unknown) → { schema: "verify/1", status, checks: [{ id, level, status: PASS|FAIL|SKIPPED, code, detail }] }
status: INVALID_FORMAT | TAMPERED | UNVERIFIABLE      (VALID existe no tipo, mas NUNCA é produzido no E5.1)
```

**Status geral (E5.1):** V0 falhou → `INVALID_FORMAT` · V1 ou V2 falhou → `TAMPERED` · V0+V1+V2 passaram → **`UNVERIFIABLE`** (V3/V4 `SKIPPED` com `S_NOT_IMPLEMENTED`). Ausência de implementação **não** é aprovação nem adulteração: nunca vira PASS, nunca vira FAIL. Os 21 checks aparecem sempre, na mesma ordem; PASS ⇔ sem código; FAIL tem código `V_*`; SKIPPED tem motivo `S_*` (`S_NOT_IMPLEMENTED`, `S_FORMAT_INVALID` — V1/V2 não rodam sobre formato inválido —, `S_NO_METRICS`).

| Nível | Check (`id`) | Falha (`code`) |
|---|---|---|
| V0 | `V0.structure` — schema `evidence/1` estrito | `V_FORMAT_INVALID` (caminho do problema) |
| V0 | `V0.schema-id` — `schema == "evidence/1"` | `V_SCHEMA_UNKNOWN` |
| V0 | `V0.seal-format` — `evidenceHash` com 64 hex minúsculos (ausente/truncado/maiúsculas/tipo errado) | `V_SEAL_MALFORMED` |
| V0 | `V0.canonical-json` — bundle é JSON puro (a estrutura aceita `NaN` em campos livres) | `V_FORMAT_NOT_CANONICAL` |
| V0 | `V0.unknown-fields` — nenhum campo fora do contrato em NENHUM nível | `V_FORMAT_UNKNOWN_FIELD` |
| V1 | `V1.seal` — `evidenceHash` recalculado = declarado | `V_SEAL_MISMATCH` |
| V2 | `V2.trade-ids-unique` · `V2.import-ids-unique` | `V_DUP_TRADE_ID` · `V_DUP_IMPORT_ID` |
| V2 | `V2.import-refs` (todo trade tem seu `ImportRef`) · `V2.import-unreferenced` (nenhum `ImportRef` sem trade) | `V_REF_IMPORT_MISSING` · `V_IMPORT_UNREFERENCED` |
| V2 | `V2.row-import` (`sourceRows[].importId` = `importId` do trade) · `V2.row-dangling` (`rowRefs` das pernas ∈ `sourceRows`) · `V2.row-unique` | `V_ROWREF_IMPORT_MISMATCH` · `V_ROWREF_DANGLING` · `V_ROWREF_DUPLICATE` |
| V2 | `V2.population-shape` (`tradeIds` × `verifiability` × `afterFilters` × `contributors.complete`; id repetido) · `V2.population-refs` | `V_POPULATION_MISMATCH` · `V_REF_TRADE_MISSING` |
| V2 | `V2.contributor-refs` · `V2.contributor-counts` (`roleCounts` × `items`) | `V_REF_TRADE_MISSING` · `V_CONTRIBUTORS_MISMATCH` |
| V2 | `V2.unreferenced-trades` (trade fora de população/contributors/subject) · `V2.subject` | `V_TRADE_UNREFERENCED` · `V_SUBJECT_UNRESOLVED` |
| V3 | `V3.population` | `SKIPPED` — `S_NOT_IMPLEMENTED` |
| V4 | `V4.metrics` | `SKIPPED` — `S_NOT_IMPLEMENTED` |

**Regras que valem a pena registrar**
- **V0 e os sub-schemas não-`strict`.** O `evidence/1` reaproveita sub-schemas do Canonical que **não** são `strict` (`entry.at`, pernas, `exitLegs[].pnl`, `exitSummary`, `issues`…): um campo extra ali (inclusive `sourceName`) era **descartado em silêncio** no parse. O E5.1 **não** altera o schema: `V0.unknown-fields` compara o bundle de entrada com a saída do schema e acusa a primeira chave descartada (caminho completo). Tornar esses sub-schemas `strict` é melhoria possível, fora do escopo.
- **Malformado × adulterado.** Hash truncado/malformado é `INVALID_FORMAT` (V0); hash bem formado porém diferente do recalculado é `TAMPERED` (V1). V1/V2 não rodam sobre formato inválido.
- **`contributors`:** completos (`complete=true`) ⇒ igualdade `roleCounts` × `items` por papel; incompletos (`HASH_ONLY`) ⇒ só papéis âncora e `items` ≤ `roleCounts`; sem contribuintes (`applicable=false`) ⇒ `roleCounts` e `items` vazios. Id repetido (mesmo papel + trade + rank) não é aceito.
- **Bundle sem métricas** (ex.: de trade): os checks que dependem da população/contributors ficam `SKIPPED` (`S_NO_METRICS`).
- **Nada é deduplicado nem alterado:** o verificador só descreve; o bundle de entrada fica intacto.

**Limites desta etapa (leia antes de confiar no resultado)**
- **O selo não é assinatura digital.** Quem altera o conteúdo e **recalcula** o `evidenceHash` passa em V0 e V1 (teste explícito: valor, P&L, `r` e até o `tradeSetHash` declarado alterados com novo selo ⇒ V1 PASS, status `UNVERIFIABLE`). Detectar isso é trabalho de V3/V4 (E5.2) — e só quando a edição é **inconsistente**; uma alteração **coordenada** de tudo é consistente e só se prova contra o CSV original (E5b).
- **V2 prova coerência estrutural, não verdade.** Garante que as referências do bundle fecham entre si; não prova que os valores dos trades estão certos nem que as métricas conferem (V3/V4) nem a origem dos dados (E5b).
- **`UNVERIFIABLE` não é "quase válido".** Significa apenas que nada acusou adulteração nos níveis implementados e que V3/V4 não rodaram.
- Agrupamentos por estratégia/sessão e verificação contra o CSV original seguem como decidido em §14.6.

**Resultados (sintético + 2 fixtures reais locais):** 1.034 bundles verificados (ciclos e linhas × todas as métricas × total/grupos/`HASH_ONLY`), 0 `FAIL` em bundles limpos, todos `UNVERIFIABLE`; 857 ataques em amostra (trade removido/extra, `ImportRef` removido, `sourceRows[].importId`, `roleCounts`, valor sem novo selo): 857 detectados, 0 perdidos; 16 mutações no próprio verificador, todas pegas pelos testes.

### 14.8 E5.2 — V3 população e V4 métricas (IMPLEMENTADO em 2026-10-09)

Código: `src/lib/evidence/verify.ts` (V3/V4) · `src/lib/evidence/to-analytics.ts` (conversão mecânica `TradeEvidence → AnalyticsTrade`) · `sampleFlagOf` exportado de `metrics/calculate.ts` (a MESMA regra do agregado, antes inline) · testes `scripts/test-evidence-verify-math.mts` (e `test-evidence-verify.mts` ajustado). **Nenhuma fórmula nova e nenhum resultado do motor mudou**: o verificador **chama** o motor e **compara**.

**Status geral (agora completo):** formato inválido → `INVALID_FORMAT` · qualquer `FAIL` em V1–V4 (selo, referências, população, cálculos) → `TAMPERED` · sem `FAIL`, mas algo obrigatório ficou `SKIPPED` → `UNVERIFIABLE` · tudo que se aplica passou e nada bloqueante foi pulado → **`VALID`**. `SKIPPED` nunca vira `PASS`. O único `SKIPPED` que não impede `VALID` é `S_NOT_APPLICABLE` (o check não se aplica àquele bundle: ex. âncoras numa população completa, associação num total sem filtros). O relatório tem agora **31 checks** (30 até o E5.2; `V4.sequence` entrou em §14.9) e o campo **`limitations`** (sempre as mesmas 3 entradas, também em `VALID`).

**V3 — população** (`tradeFingerprintFromEvidence` + `tradeSetHash`, sem lógica própria de hash)
- `V3.population`: refaz o `tradeSetHash` dos `TradeEvidence` listados em `population.tradeIds` e compara com o declarado ⇒ `V_TRADESET_HASH_MISMATCH`. O fingerprint cobre `tradeId`, `importId`, `rowHash` (ciclo: `sourceRows`; trade-linha: o próprio, §14.6), identidade da reconstrução (método, confiança, completude, integridade, ambiguidades), P&L (líquido, bruto, comissão, taxas), R (`net`, `points`) e os instantes de entrada/saída. Independe da ordem.
- `V3.provenance`: `withIdentity + withoutIdentity = afterFilters` (senão `V_PROVENANCE_MISMATCH`); trade com `provenance INCOMPLETE`, linha sem `rowHash` ou `withoutIdentity > 0` ⇒ `SKIPPED S_PROVENANCE_INCOMPLETE` (os números podem fechar, mas **não se alega verificação completa**).
- `HASH_ONLY` (população acima do limite): `SKIPPED S_HASH_ONLY`. **Nunca** se refaz hash com amostra.

**V4 — métricas** (o MESMO `calculateMetricsTraced` sobre os trades reconstruídos, ordem canônica por `tradeId`; **sem filtros**, porque a população declarada já é o resultado do filtro)
- `V4.versions`: `engineVersion`/`definitionVersion` diferentes do motor atual ⇒ `SKIPPED S_VERSION_INCOMPATIBLE` (**`UNVERIFIABLE`, não `TAMPERED`**: não dá para reproduzir com este motor); métrica inexistente no motor atual com a mesma versão ⇒ `V_METRIC_UNKNOWN`.
- `V4.query`: opções declaradas válidas (enums, fuso, `minSample`, `tradeIdsLimit`) ⇒ senão `V_QUERY_INVALID`.
- `V4.population`: `tradeSetHash` segundo o próprio motor (caminho independente do V3) ⇒ `V_TRADESET_HASH_MISMATCH`.
- `V4.metric-value` (`V_METRIC_VALUE_MISMATCH`) · `V4.metric-fields`: `unit`, `basis`, `sampleSize`, `coverage`, `reason` (`V_METRIC_FIELD_MISMATCH`) · `V4.contributors`: papéis, itens, `roleCounts`, `applicable`, `complete` contra o trace do motor (`V_CONTRIBUTORS_MISMATCH`) · `V4.quality`: `dataQuality`, período e avisos no TOTAL (`V_QUALITY_MISMATCH`; em grupo o bundle precisa declarar `null`/`[]`, o motor não os calcula por grupo).
- **Comparação exata**, sem tolerância: `canonicalJson` dos dois lados (compatível com a aritmética em inteiros escalados do domínio).
- `V4.association` (`V_ASSOCIATION_MISMATCH`): `accountRef` dos trades × chave do grupo e `filters.accountRefs`; dimensões do grupo derivadas só do que a Evidence carrega (`day`, `tradingDay`, `week`, `month`, `dayOfWeek`, `hour`, `symbol`, `direction`) conferidas **pelo próprio motor** (`aggregateTradesTraced` sobre a população ⇒ exatamente 1 grupo com a mesma chave); filtros derivados (`from`, `to`, `symbol`, `direction`, `hour`, `dayOfWeek`, `tradingDay`) reaplicados pelo motor (a população declarada não pode violá-los); `sampleFlag` pela mesma `sampleFlagOf`. **Estratégia, sessão, setup, timeframe** (dimensão ou filtro) **não têm referência na Evidence** ⇒ `SKIPPED S_ASSOCIATION_UNVERIFIABLE` (o que tem referência é conferido; o resto não é afirmado). Isto prova que a população declarada é **consistente** com a consulta declarada, não que a seleção original foi correta (§14.6).
- `V4.anchors` (só `HASH_ONLY`): para `largestWinner`/`largestLoser`, o MESMO motor sobre a âncora reproduz o `value` (`V_ANCHOR_MISMATCH`); as demais métricas não são iguais ao P&L de um trade ⇒ `S_NO_ANCHOR_CHECK`. O V2 também passou a exigir, em lista incompleta, **todas** as âncoras (`items` = `roleCounts` por papel âncora): remover uma âncora é detectado.

**Achado: o motor depende da ordem de entrada quando saídas empatam.** Em trades-linha (reduções de posição no mesmo instante) `maxDrawdown`, `maxConsecutiveWins` e `maxConsecutiveLosses` mudam conforme a ordem em que os trades chegam ao motor (o desempate é a ordem dos dados, documentado em `prepare.ts`). Na primeira versão do E5.2 o V4 marcava isso como `S_ORDER_AMBIGUOUS`. **Resolvido em §14.9** (decisão do usuário, 09/10: registrar a ordem na Evidence, sem mudar o motor); `S_ORDER_AMBIGUOUS` deixou de existir.

**O que `VALID` significa — e o que não** (`limitations`, sempre no relatório): `VALID` = os números **deste bundle** são reproduzíveis pelo motor a partir dos trades declarados e todos os selos/hashes/referências fecham. **Não** significa: origem provada (`L_ORIGIN_NOT_PROVEN` — E5b contra o CSV), seleção original correta ou completa (`L_SELECTION_NOT_PROVEN`), assinatura digital (`L_SEAL_NOT_SIGNATURE`: alteração coordenada e consistente de tudo é consistente), nem que **todo campo** de cada `TradeEvidence` é autêntico: campo que nem o fingerprint nem a métrica do bundle usam (ex.: `pointsPerContract` num bundle de `netPnl`, `risk.reason`, quantidades, preços) só é protegido pelo selo. Há teste explícito desse limite.

**Resultados** (sintético + 2 fixtures reais locais, ciclos e linhas × com e sem R × todas as 39 métricas × total/grupos/`HASH_ONLY`): **5.274 bundles verificados, 0 `FAIL` em bundle limpo** (5.097 `VALID`; 177 `UNVERIFIABLE` = 36 `HASH_ONLY` + 141 com ordem ambígua — *posição do E5.2; com §14.9 os 141 viraram `VALID`*); **6.303 ataques em amostra, 6.303 detectados** (P&L, `rowHash`, `tradeSetHash`, `value`, âncora, trade removido; `engineVersion` ⇒ `UNVERIFIABLE`); 18 mutações no verificador/conversão, todas pegas. `maxDrawdownR` tem teste dedicado com oráculo à mão (R conhecido, pico/janela/vale, `rBasis` NET e POINTS).

### 14.9 Ordem da sequência registrada na Evidence (IMPLEMENTADO em 2026-10-10)

**Decisão do usuário (opção 3):** registrar na Evidence a ordem EXATA que o motor usa, **sem mudar resultado nenhum** e **sem criar desempate novo**.

**Como o motor ordena (inspecionado).** `sequenceOrder` (`prepare.ts`) ordena por `orderKey` e, no empate, por `index` = posição do trade no array de entrada. `orderKey` = instante de saída; sem ele, o de entrada (`orderApprox`); sem ele, a data local às 00:00 UTC. As duas sequências do cálculo (P&L: trades com P&L; R: trades com R conhecido) saem da MESMA ordem total, restritas ao seu subconjunto. Usam a ordem: `maxDrawdown`, `currentDrawdown`, `recoveryFactor`, `maxDrawdownR`, `maxConsecutiveWins`, `maxConsecutiveLosses`, `currentStreak` (lista única: `SEQUENCE_METRICS`, `metrics/sequence.ts`). Empate de **entrada** com saídas distintas não é problema (a ordem é a das saídas); o desempate só atua em **saídas no mesmo instante** (ou sem instante).

**Motor.** Fórmulas e ordenação **intactas**. Só no caminho *traced*, `computeMetricSet` registra como subproduto: `MetricsTrace.sequence` (ids da população inteira, `sequenceOrder(rows)` — mesma função e mesmo comparador) e `MetricTrace.sequenceDependent`. Uma **invariante** dentro do cálculo exige que as sequências de P&L e de R realmente usadas sejam subsequências da ordem registrada (senão lança: a Evidence não pode mentir sobre a ordem). Cada grupo tem o trace do seu próprio `TraceBuilder`, então a ordem de um grupo é a do próprio grupo (subsequência da ordem total).

**Schema `evidence/1` (aditivo; sem persistência nem consumidor externo, sem `evidence/2`).** `MetricEvidence.population.sequence = { dependent: boolean, order: string[] | null }`. `order` = tradeIds da população **inteira** na ordem do motor, só quando a métrica é sequencial **e** a população é `FULL`; `null` caso contrário (métrica não sequencial, ou `HASH_ONLY`: a sequência completa não está no bundle e **não se alega tê-la verificado**). Só `tradeId`s: nenhum nome de conta/estratégia/sessão. Campo `strict` e obrigatório. Entra no `evidenceHash` (normalização inalterada: o campo é parte do `MetricEvidence`); o `tradeSetHash` **continua independente da ordem** (mesma população em outra ordem ⇒ mesmo `tradeSetHash`, outro `evidenceHash`). Os `evidenceHash` já gerados mudam (campo novo), como em E5.0.

**Verificador.** `V4.sequence` (novo; `V_SEQUENCE_MISMATCH`). **Não reordena nada:** alimenta o MESMO motor (`calculateMetricsTraced`) com os trades na ordem registrada (o desempate do motor é a ordem de recebimento) e confere:
- `dependent` declarado = `sequenceDependent` do motor (senão `FAIL`: não dá para esconder a dependência);
- `order` é permutação da população (sem id faltando, repetido ou inventado) ⇒ senão `FAIL`;
- o motor, alimentado com ela, produz **a mesma** sequência (`trace.sequence` = `order`) ⇒ senão `FAIL` (a ordem contradiz os instantes de saída);
- métrica não sequencial não pode trazer ordem; ordem sem população listada (`HASH_ONLY`) é forma inválida (`V2.population-shape`).
Depois `V4.metric-value`/`fields`/`contributors` comparam com o motor (os `rank` dos contribuintes são posições nessa sequência).
- **Sem ordem registrada** (bundle antigo/removido) numa métrica sequencial: **sem empate de instante** a ordem é determinada só pelos instantes ⇒ `PASS`; **com empate** ⇒ `SKIPPED S_ORDER_NOT_RECORDED` ⇒ `UNVERIFIABLE`, com o motivo no detalhe. O teste das 4 ordens do E5.2 saiu (era um paliativo para a ausência desta informação).
- `HASH_ONLY` ⇒ `S_HASH_ONLY` (o detalhe diz que a sequência completa não está no bundle).

**O que a ordem registrada prova — e o que não.** Prova que *aquela* ordem reproduz o valor e os contribuintes declarados. Entre trades empatados no instante, qualquer permutação é coerente com os instantes; se ela muda o resultado, `value`/`contributors` acusam (`TAMPERED`). Uma troca de empatados que não altera nenhum valor nem contribuinte é indistinguível e inofensiva para as alegações do bundle. Que a ordem seja a **ordem original de entrada dos dados** só se prova contra o CSV (E5b).

**Garantias testadas** (`scripts/test-evidence-sequence.mts`, 13 testes; no `test:domain`): (0) baseline congelado de ANTES da mudança (`fixtures/_synthetic/engine-baseline-pre-sequence.json`, 120 hashes de `calculateMetrics`/`aggregateTrades`: empates de saída, de entrada, em pares, sem empate × 3 ordens de entrada × com/sem R × 4 agrupamentos) idêntico; traced ≡ normal; oráculo à mão (centavos) de empate de saída, drawdown, drawdown em R e sequências em duas ordens de entrada; entradas iguais; reconstrução pelo verificador; grupos; adulteração com selo refeito (troca de empatados, ordem contra os instantes, id removido/repetido/inventado, lista vazia, `dependent` mentindo); ordem removida; `HASH_ONLY` × `FULL`; privacidade; schema strict. Uma mutação no verificador (ignorar a ordem registrada) é pega pelos testes.

**Resultados nas fixtures reais** (mesma amostra do §14.8): **5.274 bundles, 0 `FAIL` em bundle limpo, 5.238 `VALID`, 36 `UNVERIFIABLE` (todos `HASH_ONLY`; 0 por ordem)**; 6.324 ataques em amostra, todos detectados. Os 141 bundles que eram `UNVERIFIABLE` por ordem ambígua agora são `VALID`.

### 14.10 E5.3 — auditoria final do verificador e fechamento do contrato (2026-10-10)

Sem mudança de motor, de schema nem de resultado. Esta etapa **audita e fecha** o que E5.0–E5.2 e §14.9 construíram. Nada de E5b, E6/G6, Prisma, persistência, UI pública ou agente.

**Distinções que o contrato afirma (e que nenhum status apaga):**
1. **Ordem registrada para reproduzir o resultado do motor** — `population.sequence.order` é a ordem que o motor *usou* (instante de saída; empate → posição no array de entrada), copiada do trace. O verificador prova que **esta ordem, alimentada ao mesmo motor, reproduz** `value`, campos e contribuintes declarados.
2. **Ordem original dos dados de origem** — NÃO é provada. Entre trades empatados no instante, qualquer permutação é coerente com os instantes. **Trocar a ordem de trades empatados e recalcular o selo não é, por si só, uma adulteração detectável** quando `value` e contribuintes declarados continuam iguais: o verificador valida as afirmações efetivamente contidas no bundle, não inventa uma prova da sequência original. Se a troca muda o resultado, `V4.metric-value`/`V4.contributors` acusam (`TAMPERED`). Medido: nas fixtures reais, 152 trocas de ordem em amostra ⇒ 142 `TAMPERED` e 10 `VALID` (imateriais).
3. **Verificação matemática sobre a população declarada** — V3/V4: os números do bundle são reproduzíveis pelo motor a partir dos `TradeEvidence` listados; não prova que a seleção original de trades foi a correta (`L_SELECTION_NOT_PROVEN`).
4. **Comprovação de origem** — depende do **E5b** (reexecutar a ingestão contra o CSV original e comparar `fileSha256`, `importId`, `rowHash`, `tradeId`, e a ordem original). Até lá, `VALID` nunca significa "veio deste CSV" (`L_ORIGIN_NOT_PROVEN`) e o selo não é assinatura (`L_SEAL_NOT_SIGNATURE`).

**Auditoria (resultado).**
- **`SKIPPED` nunca é `PASS`.** Único ponto onde checks por métrica são combinados: `combine()` (FAIL > SKIPPED > PASS; só PASS se *todas* as métricas aplicáveis passam). Status geral: `VALID` só com zero FAIL e nenhum SKIPPED ≠ `S_NOT_APPLICABLE`. **Achado e correção:** o `combine` recebia `p.r[id] ?? NA("não se aplica")`, ou seja, um check que algum caminho do verificador esquecesse de preencher viraria "não se aplica" (não bloqueante). Medido: nenhum caminho dependia disso (instrumentado com `throw` sobre toda a suíte e fixtures), mas era um buraco latente; agora o default é `SKIPPED S_CHECK_NOT_EXECUTED` (bloqueante ⇒ `UNVERIFIABLE`) e um teste varre a fonte contra `?? NA(`.
- **`S_ORDER_AMBIGUOUS` não existe mais** em `src/` (teste varre o código). Com a sequência registrada e reproduzível **nenhum** check é pulado por ordem (todas as métricas sequenciais × total/grupos × 4 conjuntos, incluindo empates). `S_ORDER_NOT_RECORDED` só ocorre quando a ordem **não** está no bundle **e** há empate de instante; sem empate a ordem é determinada pelos instantes (`PASS`).
- **`HASH_ONLY`:** `V4.sequence` = `S_HASH_ONLY`; `population.sequence.order` é `null`; injetar uma ordem num `HASH_ONLY` é forma inválida (`V2.population-shape`, `TAMPERED`).
- **Códigos:** todo `SKIPPED` tem `S_*` e explicação; todo `FAIL` tem o `V_*` do contrato; lista de 31 checks fixa e ordenada; `limitations` (3) sempre presentes (testado em ~1.050 bundles e ~2.265 mutações).
- **Privacidade:** nenhum nome de conta em bundle nem em relatório (corpus com contas nomeadas); a ordem só tem `tradeId`s.
- **Consistência hash:** `tradeSetHash` independe da ordem; `evidenceHash` a inclui; sem mudança em fingerprints.
- **Ainda vale (limites documentados):** alteração **coordenada** de tudo é consistente; campo do `TradeEvidence` que nem o fingerprint nem a métrica do bundle usam só é protegido pelo selo; sub-schemas herdados do Canonical não são `strict` (o V0 compensa com `V0.unknown-fields`).

**Testes:** `scripts/test-evidence-audit.mts` (7 testes, no `test:domain`): invariantes do relatório sobre ~1.050 bundles íntegros (todas as métricas × total/grupos/`HASH_ONLY` × 4 conjuntos: empate de saída, em pares, de entrada, sem empate) e ~2.265 mutações com selo refeito ou não (os 4 estados são alcançados; todo `VALID` pós-mutação é **sem efeito**, **troca imaterial de empatados** ou **ordem redundante onde não há empate**); cada motivo de `SKIPPED` bloqueante ⇒ `UNVERIFIABLE`; varredura da fonte; privacidade; ordem × hashes. `test-evidence-verify-math.mts` passou a contar o status de cada ataque e a incluir ataques de formato e de ordem.

**Resultados (após `83d4408` + E5.3), fixtures reais locais (ciclos e linhas × com/sem R × 39 métricas × total/grupos/`HASH_ONLY`):** 5.274 bundles íntegros: **5.238 `VALID`, 36 `UNVERIFIABLE` (todos `HASH_ONLY`), 0 `TAMPERED`, 0 `INVALID_FORMAT`, 0 `FAIL`**. Ataques em amostra: **7.536, 7.536 detectados** ⇒ 5.406 `TAMPERED` · 1.060 `INVALID_FORMAT` · 1.060 `UNVERIFIABLE` (`engineVersion`) · 10 `VALID` (trocas de empatados imateriais, esperado). Motor: 120 hashes de referência idênticos.

**Melhoria opcional futura (não bloqueia):** cenário visual no Evidence Lab de *ordem trocada com selo recalculado*, para mostrar a diferença entre integridade interna e comprovação da ordem original.
