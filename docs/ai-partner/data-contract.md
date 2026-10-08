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
- **O id é por import.** Reordenar as linhas do arquivo (ou qualquer byte novo) gera outro `importId` e portanto outros `tradeId`; o que permanece invariante é o `rowHash` e a composição dos ciclos. Dedupe do mesmo trade entre exports diferentes/sobrepostos **não** foi decidido (usar `rowHash` quando chegar a hora).
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

**Privacidade (fail-closed):** `account.sourceName` e `reconstruction.cycleKey.account` viram `accountRef`; `labels.notes/tags` e `source.fileName/fileHash` não entram. O **`fileName` é mantido** como proveniência, mas nomes de conta conhecidos dentro dele são trocados pelo `accountRef` (nome com ≥ 4 caracteres: por substring; menores: só como token inteiro; sem distinguir caixa). O original continua só no `ImportRecord`. Trava final varre todo valor/chave da saída; achou nome de conta ⇒ `E_ACCOUNT_NAME_LEAK` e nada é devolvido. Limite conhecido: a redação só conhece as contas **informadas**; por isso `explainTrades` reúne as contas do import inteiro (o `ImportRef` fica idêntico em todos os trades). Quem chamar `explainTrade` avulso num import multi-conta deve passar `knownAccountNames`.
