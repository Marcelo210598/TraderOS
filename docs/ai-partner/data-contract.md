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
`from`/`to` (data local `YYYY-MM-DD`, inclusivo, do instante âncora), `symbol`, `direction`, `account`, `session` (`AM`/`PM`/`OVERNIGHT`, derivada em ET), `hour` (0–23 no fuso), `dayOfWeek` (0=dom), `tradingDay` (dia de pregão CME), `strategyId`, `strategyName`, `strategyVersionId`, `setup`, `timeframe`, `exitReason` (E6.0, §15.1).
**AND entre campos; array = OR dentro do campo.** Atributo **desconhecido** no trade (ex.: filtro de hora num trade só com data) ⇒ o trade é **excluído e contado** em `report.excluded[campo].unknown` (nunca "passa por não saber"). Filtro inválido (`from > to`, hora 24…) ⇒ `MetricsInputError` (não é ignorado). Filtros são ecoados **normalizados** (caixa, ordenados, sem repetição).

### 11.5 Dimensões (`groupBy`, uma ou várias)
`day`, `tradingDay`, `week` (segunda-feira), `month`, `dayOfWeek`, `hour`, `session`, `symbol`, `direction`, `account`, `strategy` (`strategyId ?? nome`), `strategyVersion`, `setup`, `timeframe`, `exitReason` (E6.0, §15.1).
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

### 14.11 E5b — `verifyEvidenceSource`: proveniência contra o CSV original (IMPLEMENTADO em 2026-10-10)

**Finalidade.** Até o E5.3 o verificador provava consistência interna (V0–V3) e reprodução matemática da população declarada (V4). O E5b **liga o bundle ao arquivo**: recebe o `EvidenceBundle` e os **bytes exatos** do CSV de cada import, reexecuta a ingestão e compara identidade e valores. Código: `src/lib/evidence/verify-source.ts` · testes `scripts/test-evidence-source.mts`. Função isolada, **sem alterar `verifyEvidence`** nem o schema `evidence/1` (nenhuma mudança de contrato): `SOURCE_VERIFIED` + `VALID` juntos é o que se afirma; nenhum dos dois prova o outro.

```ts
verifyEvidenceSource(bundle: unknown, files: Record<importId, Uint8Array> | Map<importId, Uint8Array>,
  options?: { accountRefSalt?, foldPolicy?, exitReasonMap?, parsers? }): SourceVerifyReport   // nunca lança
```
Puro (sem relógio, random, banco, Prisma, UI nem caminho de arquivo — quem chama entrega os bytes); o CSV **nunca** entra no bundle nem no relatório. Reuso, sem segundo pipeline nem segundo hash: `runImportPipeline` (reingestão), `describeText`/`sha256Hex` (SHA-256 do texto e dos bytes), `explainTrades` (E3, a mesma projeção por lista branca aplicada ao Canonical reingerido) e `canonicalJson`. Um teste varre a fonte contra `node:fs`/`node:crypto`/Prisma/relógio/random.

**Auditoria de viabilidade (o que o `ImportRef` permite reconstruir).** Suficiente no bundle: `fileSha256`, `fileBytes`, `hasBom`, `lineEnding`, `parserId/Version`, `reconstructionMethod/Version`, `settings` (`sourceTz` + `sourceTzOrigin`, `dateOrder`, `numberLocale`, `excursionUnit`, `declaredPnlBasis`), contagens de linhas e contas. **Não registrado** (vira opção do chamador, declarado em `limitations`): `accountRefSalt` (entra no `rowHash` e portanto no `tradeId`), `foldPolicy`, `exitReasonMap`; as versões internas de `rowHash`/`tradeId` também não são gravadas (uma mudança nelas apareceria como divergência total). `fileName` e `importedAt` ficam fora de qualquer comparação. **`fileSha256` é hash do TEXTO UTF-8** (`hashBasis: UTF8_TEXT`, não dos bytes brutos): o E5b decodifica UTF-8 **estrito** (`fatal`) **preservando o BOM** e exige que `SHA-256(bytes) = SHA-256(texto)` — para UTF-8 válido o round-trip é exato, então o hash é, de fato, dos bytes. Arquivo que não é UTF-8 válido ⇒ `UNVERIFIABLE` (`S_ENCODING_UNSUPPORTED`): o import original foi sobre texto decodificado de um jeito que os bytes não determinam.

**Checks (relatório `verify-source/1`, 8 checks fixos, `limitations` sempre presentes).**
| Check | O que confere | FAIL | SKIPPED (motivo) |
|---|---|---|---|
| `V5.format` | bundle é `evidence/1` (schema strict) | `V_SOURCE_FORMAT_INVALID` ⇒ `INVALID_FORMAT` | — |
| `V5.file` (V5.1) | SHA-256 dos bytes, tamanho, BOM, quebra de linha, `hashBasis` = registrados; sem normalizar nada | `V_FILE_MISMATCH` (o motivo lista o que difere: SHA-256 · tamanho · BOM · quebra de linha) | `S_SOURCE_NOT_PROVIDED` · `S_ENCODING_UNSUPPORTED` · `S_NO_IMPORTS` |
| `V5.context` (V5.2) | parser existe e tem a versão registrada; reconstrução (`NT8_ROW_INTERVALS_V1` + `RECONSTRUCTION_VERSION`); origem do fuso reproduzível (`USER` com `sourceTz`; `DEFAULT` só se o padrão atual é o mesmo; `FILE_OFFSET`) | — | `S_VERSION_INCOMPATIBLE` (**não é adulteração**) · `S_CONTEXT_INSUFFICIENT` · `S_REINGEST_FAILED` · `S_FILE_NOT_VERIFIED` |
| `V5.import-id` (V5.3) | `importId` reconstruído (função canônica do E1) e o registro do import (parser, linhas lidas/aceitas/rejeitadas, contas, configurações) | `V_IMPORT_ID_MISMATCH` · `V_IMPORT_RECORD_MISMATCH` | idem |
| `V5.rows` (V5.4) | cada `(rowNo, rowHash)` citado existe na reingestão com aquele hash; sem linha citada por dois trades | `V_ROW_MISSING` · `V_ROWHASH_MISMATCH` · `V_ROWREF_DUPLICATE` | `S_ROWHASH_MISSING` · `S_ACCOUNT_REF_UNVERIFIED` |
| `V5.trades` (V5.5) | `tradeId` produzido pela reingestão — **ciclos e linhas** (`run.trades` + `run.rowTrades`: espaços de id disjuntos; correção de 12/10/2026, antes só ciclos) (id interno `#n` **não** é identidade canônica; repetido, falha); granularidade `SOURCE_ROW`/`POSITION_CYCLE`, conta, reconstrução e composição de linhas iguais | `V_TRADE_ID_MISMATCH` · `V_TRADE_STRUCTURE_MISMATCH` · `V_IMPORT_REF_MISSING` | idem |
| `V5.values` (V5.5) | valores **derivados do arquivo**: instrumento, direção, quantidade, preços, horários, P&L, pontos/contrato, pernas, excursões e linhas de origem — projeção E3 da reingestão × `TradeEvidence` | `V_TRADE_VALUES_MISMATCH` (lista só os **nomes dos campos**, nunca os valores) | idem |
| `V5.coverage` (V5.6) | população declarada **inteira** listada (FULL) | — | `S_POPULATION_PARTIAL` (não bloqueante: vira `SOURCE_VERIFIED_PARTIAL`) |

**Por que comparar valores, não só ids.** `rowHash` e `tradeId` derivam do **arquivo**, não do que o bundle diz sobre o trade. Um bundle forjado que altera o P&L no `TradeEvidence` e regenera `tradeSetHash` e selo mantém `rowHash`/`tradeId` do CSV e passa por `verifyEvidence` como `VALID` (o limite documentado em §14.7/§14.10). Só a comparação de valores com a reingestão o denuncia: teste 5 (a forja é `VALID` no E5 e `SOURCE_MISMATCH` com `V_TRADE_VALUES_MISMATCH` no E5b, com o arquivo e as linhas em `PASS`).

**Estados** (nunca confundem indisponibilidade com adulteração): `INVALID_FORMAT` · `SOURCE_MISMATCH` (qualquer `FAIL`) · `UNVERIFIABLE` (sem `FAIL`, mas algo bloqueante não pôde ser conferido: arquivo ausente, encoding, contexto, versão, sal) · `SOURCE_VERIFIED_PARTIAL` (tudo o que está no bundle confere, mas alguma métrica é `HASH_ONLY`) · `SOURCE_VERIFIED` (tudo o que está no bundle confere e toda população declarada está listada). **Critério de sucesso:** zero `FAIL` e nenhum `SKIPPED` além de `S_NOT_APPLICABLE`/`S_POPULATION_PARTIAL`. O relatório traz `coverage` (imports, linhas e trades citados × verificados, métricas FULL × HASH_ONLY) e três campos fixos `NOT_VERIFIED`: `selection`, `originalSequenceOrder`, `userEnrichment`.

**Consistência matemática × proveniência.** V0–V4 respondem *"os números do bundle saem destes trades?"*; o E5b responde *"estes trades saem deste arquivo?"*. São independentes (o E5b não relê selo nem refaz métricas; o `evidenceHash` é só ecoado no relatório e **não muda** por verificar).

**Compatibilidade de versões.** Parser ou reconstrução com versão diferente da registrada ⇒ `UNVERIFIABLE` (`S_VERSION_INCOMPATIBLE`); o arquivo ainda é conferido (V5.1), mas `importId`/linhas/trades ficam `SKIPPED`. Fuso assumido (`DEFAULT`) que não é o padrão atual ⇒ `S_CONTEXT_INSUFFICIENT`. Salt: se **todas** as contas citadas divergem da reingestão, o problema é o contexto ⇒ `S_ACCOUNT_REF_UNVERIFIED` (arquivo e `importId` seguem conferidos; o sal nunca é impresso); se só alguma diverge, é divergência real.

**Limites (documentados em `limitations`, sempre no relatório).**
- **População parcial / `HASH_ONLY`:** só as referências presentes (âncoras) são conferidas; o status é `SOURCE_VERIFIED_PARTIAL` e o relatório diz que a população completa **não** foi conferida. Bundle `HASH_ONLY` sem nenhuma âncora (ex.: drawdown zero) não tem referência alguma ⇒ `UNVERIFIABLE`/`S_NO_IMPORTS`.
- **Seleção original não provada** (`L_SELECTION_NOT_PROVEN`): confere que as linhas/trades **citados** vêm do arquivo, não que os filtros sobre o conjunto de entrada foram os corretos. Provar a seleção exigiria reaplicar os filtros declarados ao conjunto reingerido (possível extensão futura; não feita).
- **Ordem original da sequência não provada** (`L_SEQUENCE_ORIGINAL_ORDER_NOT_PROVEN`): a ordem do array de entrada do motor depende de quem o chamou, não do CSV. A ordem registrada continua sendo a que reproduz o motor (§14.9).
- **R, risco, stop, `issues`, `fieldProvenance`** (`L_USER_ENRICHMENT_NOT_PROVEN`): podem ser acrescentados depois da importação (o pipeline do NT8 não produz R); ficam fora da comparação de valores.
- **Contexto do chamador** (`L_CONTEXT_FROM_BUNDLE_AND_CALLER`): `accountRefSalt`, `foldPolicy`, `exitReasonMap` não estão no bundle. **Proposta (não implementada, exigiria decisão):** gravar no `ImportRecord` a versão das funções de identidade e um indicador do `foldPolicy`/`exitReasonMap` efetivos tornaria a reprodução totalmente autocontida.
- **BOM:** o E5b compara com o texto **exatamente como foi ingerido** (`hasBom`). Um chamador que remova o BOM antes de ingerir registra `hasBom=false`; entregar o arquivo original com BOM é, corretamente, uma divergência de bytes.
- Selo e consistência interna do bundle não são relidos aqui (`L_BUNDLE_INTEGRITY_NOT_CHECKED`): rodar `verifyEvidence` antes.

**Testes (`test-evidence-source.mts`, 25 testes, no `test:domain`).** Os 18 cenários pedidos (arquivo correto; 1 byte; quebra de linha; BOM; célula + forja coordenada; `importId`; `rowHash`; `tradeId`; linha inexistente; referência duplicada; fuso; versão/configuração do parser; ciclo com identidade divergente; arquivo ausente; contexto insuficiente/sal; população parcial; `HASH_ONLY`; arquivo íntegro com referências inconsistentes) verificam **status, código e mensagem**; mais: formato inválido, determinismo/pureza (bundle e `evidenceHash` intactos), privacidade (sem nomes de conta, CSV, sal, valores nem hashes completos nos detalhes), varredura da fonte, não regressão e fixtures reais. 4 mutações no verificador (não comparar valores, hash do arquivo, `rowHash`, versão do parser) são pegas pelos testes.

**Resultados nas 2 fixtures NT8 PT-BR reais (locais, ignoradas pelo Git; o contexto sai só do `ImportRef`, não do `context.json`):** 288 bundles (ciclos e linhas × métricas × total/grupos/`HASH_ONLY`): **273 `SOURCE_VERIFIED`, 7 `SOURCE_VERIFIED_PARTIAL`, 8 `UNVERIFIABLE` (`HASH_ONLY` sem nenhuma âncora), 0 `SOURCE_MISMATCH`**; **17 ciclos + 34 trades-linha** distintos e **34 linhas** `(importId, rowNo, rowHash)` conferidos; 0 divergências de `importId`/`rowHash`/`tradeId`/valores em bundle limpo; reexecução determinística; **552 ataques em amostra, 552 detectados**.

### 14.12 Contexto reproduzível da importação — `ImportRecord.reproducibility` (IMPLEMENTADO em 2026-10-10)

**Origem.** Proposta registrada no §14.11 e aprovada: o E5b dependia de `foldPolicy`, `exitReasonMap`, versões das funções de identidade e do sal informados pelo chamador, porque o `ImportRecord` não os guardava. Auditoria (código): `importId = H(fileSha256, parserId/Version, settings públicas)`; `rowHash` inclui os instantes UTC (então o `foldPolicy` o afeta, mas o `importId` não); `exitReasonMap` não entra em hash algum (só nos motivos de saída das pernas); `ROW_HASH_VERSION`/`TRADE_ID_VERSION`/`IMPORT_ID_VERSION`/domínio do `accountRef` eram constantes não registradas. A versão do algoritmo de reconstrução **já** estava registrada (`reconstructionMethod/Version`): nada a acrescentar.

**Mudança mínima, compatível com `evidence/1` (aditiva e opcional).** Novo bloco **opcional** `reproducibility` no `ImportRecord` (e, por cópia explícita em lista branca, no `ImportRef` do bundle):
```
reproducibility?: { version: 1,
  identity: { importId, rowHash, tradeId: number; accountRef: string },   // versões das funções de identidade (hoje 1/1/1 e "meutrade/accountRef/1")
  foldPolicy: "EARLIER" | "LATER",                                         // efetivo (padrão EARLIER)
  exitReasonMap: { pattern, reason }[],                                    // normalizado, na ORDEM aplicada (a 1ª regra que casa vence); [] = só as padrão
  accountRefSalted: boolean }                                              // houve sal? O VALOR NUNCA é gravado
```
- **Fora do `importId`** (decisão deliberada): assim `importId`, `rowHash`, `tradeId` e `tradeSetHash` ficam **idênticos** aos de antes. Provado contra o commit anterior (worktree de `da65ea6`): valores literais pinados em `test-evidence-import-context.mts` (linhas, ciclos e import com sal). Consequência assumida: dois imports do mesmo arquivo com `foldPolicy`/`exitReasonMap` diferentes têm o mesmo `importId` — era assim antes; agora a diferença fica **registrada** e verificável.
- **Compatibilidade:** imports anteriores não têm o bloco e **nunca são retro-preenchidos** (teste: um registro sem o bloco continua válido no schema, no `explainTrade`, no `verifyEvidence` e no E5b, que o trata como antes e diz no `V5.context` que o import é *anterior ao contexto reproduzível*). Bundles **novos** têm `evidenceHash` diferente (o `ImportRef` entra no selo), como no E5.0; nenhum valor financeiro, métrica ou fingerprint muda (baseline de 120 hashes do motor idêntico).
- **Segredo:** o sal **não** é persistido (nem em texto aberto, nem hash — um hash de sal de baixa entropia seria força-bruta); só `accountRefSalted`. Não existe hoje um identificador estável e seguro de "versão da chave de sal", e não foi inventado um sistema de segredos. `exitReasonMap` passa pela trava fail-closed de nome de conta do E3 (mapa com nome de conta é recusado). Sem contas, sem sal e sem CSV no bundle.

**Uso no E5b.** Com o bloco, ele **manda** na reingestão: `foldPolicy` e `exitReasonMap` vêm do registro (opções do chamador conflitantes são ignoradas); o sal só é usado se `accountRefSalted` (informado a mais num import sem sal é ignorado e dito no relatório). Novos comportamentos: versão de identidade ≠ atual ⇒ `UNVERIFIABLE` (`S_VERSION_INCOMPATIBLE`, não adulteração); registro exige sal e nenhum foi informado ⇒ `UNVERIFIABLE` (`S_ACCOUNT_REF_UNVERIFIED`) com arquivo e `importId` ainda conferidos; o bloco reingerido precisa reproduzir o registrado (`V_IMPORT_RECORD_MISMATCH`), exceto a bandeira de sal quando o sal não foi informado. `coverage.imports.contextRecorded` diz quantos imports têm contexto registrado. Limite: uma adulteração de `exitReasonMap`/`foldPolicy` só é detectável quando muda algo **afirmado** pelo bundle (ex.: motivo de saída das pernas de ciclos; instante/`rowHash` em horário ambíguo); em trades-linha o mapa não aparece em valor algum.

**Testes** (`scripts/test-evidence-import-context.mts`, 7, no `test:domain`): não regressão de identidades (pinadas), registro (ordem do mapa, bandeira de sal, sem vazamento do sal), compatibilidade com imports antigos, E5b reproduzindo sozinho um import com `foldPolicy LATER` em horário ambíguo (America/New_York, 01/11/2026 01:30) + mapa + sal, sal ausente/errado/ignorado, versão de identidade incompatível, bloco adulterado/inválido, privacidade.



### 14.13 E5b e derivados — população declarada de cada análise (IMPLEMENTADO em 2026-10-12)

`verifyEvidenceSource` passa a considerar `evidence.derived[]` (E6.3), sem exigir `metrics[]`. **Contrato novo (aditivo):** check `V5.derived` (catálogo do E5b: 8 → 9 checks) e `coverage.derived` (`total/full/hashOnly/partial`, `trades {declared, inBundle, verified}`, `legRefs {declared, verified}`, `scope: "DECLARED_POPULATION"`). `coverage.populations.metrics/full/hashOnly` continuam **só das métricas** (bundles anteriores: idênticos); `populations.complete` agora vale também para derivados (derivado-only FULL ⇒ `true`; antes era sempre `false`).

**O que `V5.derived` confere, por derivado:** (1) **FULL** — todos os `population.tradeIds` estão em `evidence.trades` **e** foram conferidos com a reingestão (`V5.trades`/`V5.values`: identidade, linhas+`rowHash`, valores derivados do arquivo); (2) as **pernas citadas** em `refs.legs.items` (`tradeId`, `legIndex`, `rowNos`) batem com `exitLegs[legIndex].rowRefs` da reingestão (`V_DERIVED_LEG_REF_MISMATCH` ⇒ `SOURCE_MISMATCH`). **Estados:** `PASS` (tudo da população declarada conferido); `S_POPULATION_PARTIAL` (não bloqueia; vira `SOURCE_VERIFIED_PARTIAL`): **HASH_ONLY** (só `tradeSetHash`, nenhum trade referenciado), **ids declarados fora do bundle** ou população vazia — o que está presente foi conferido, o resto **não** pode ser; `S_DERIVED_TRADES_NOT_VERIFIED` (bloqueia ⇒ `UNVERIFIABLE`): trades presentes que não puderam ser conferidos (arquivo/contexto/sal ausentes); `S_NOT_APPLICABLE` sem derivados (não é PASS vazio). Ausência de dado **nunca** é adulteração. Derivado HASH_ONLY sem trades no bundle fica `UNVERIFIABLE` (`V5.file: S_NO_IMPORTS`) com `V5.derived` explícito sobre o HASH_ONLY.

**Escopo (distinção obrigatória).** Conferir **todos** os trades de um derivado prova que os trades **declarados** na população vêm do arquivo e que seus valores conferem; **não** prova que os filtros originais selecionaram a população correta, **nem** que ela é a população completa da importação, nem a ordem original ou o que o usuário acrescentou (R/stop). O relatório diz isso: `coverage.selection = NOT_VERIFIED` e, **só quando há derivados**, a limitação `L_DERIVED_POPULATION_SCOPE` (6ª; bundles sem derivados mantêm exatamente as 5 anteriores). `V5.coverage` descreve a população "declarada", não a importação.

**Casos de borda das pernas citadas (`refs.legs.items`) — resultado verificado, expectativa em `scripts/expectations/derived-legrefs-edge.expected.json`:** `legIndex` fora do intervalo, `legIndex` trocado entre duas pernas do mesmo trade e `rowNos` a mais ou vazio ⇒ **FAIL** nos dois (V6.refs e E5b `V_DERIVED_LEG_REF_MISMATCH`); `tradeId` citado inexistente no bundle ⇒ V6.refs FAIL e E5b `S_POPULATION_PARTIAL` (**conserto de 12/10:** antes o E5b dava PASS em silêncio); item **duplicado**, lista **fora de ordem** ou item **removido** ⇒ só o **V6** acusa (V6.quality, pela comparação com o recálculo) — o E5b confere cada citação individualmente e **não julga completude/ordem/duplicidade da lista**. Mudança de contrato registrada em `CHANGELOG-contratos.md`.

**Não muda:** `tradeSetHash`, métricas, fórmulas do E6.2, `verifyEvidence`/V6 (independentes: um derivado adulterado com selo refeito segue `SOURCE_VERIFIED` no E5b e `TAMPERED` no V6), o comportamento e os textos de bundles sem derivados (V5.coverage idêntico; os outros 8 checks continuam PASS). Teste: `scripts/test-evidence-source-derived.mts` (11) + fixtures reais; o `test-evidence-source.mts` ganhou só a exceção `V5.derived = S_NOT_APPLICABLE`.

### 14.12.1 Nota (S2b, 12/10/2026): o mapa de motivos do usuário na Evidence
No `ImportRef` (Evidence) o `exitReasonMap` de §14.12 passa a ser `{ patternRef, reason }[]` (o regex em claro fica só no `ImportRecord` interno). Consequência para o E5b: imports com mapa não vazio exigem que o chamador informe o mapa (conferido pelos `patternRef`); ausente/divergente ⇒ `UNVERIFIABLE (S_CONTEXT_INSUFFICIENT)`. Detalhes em `CHANGELOG-contratos.md`.

### 14.14 Pseudônimos da Evidence e política de sal — limite DOCUMENTADO, decisão pendente (12/10/2026)
`accountRef` (`acc_…`), `strategyRef` (`str_…`) e `labelRef` (`lbl_…`) e `patternRef` (`pat_…`) são **pseudônimos determinísticos** (SHA-256 truncado em 24 hex, domínio próprio de cada um). **Não são anonimização criptográfica.** O sal (`accountRefSalt`) é **opcional e por import**; **sem sal, textos curtos ou comuns (nome de conta, de estratégia, rótulo de ordem, padrão de regra) são adivinháveis por dicionário** — vale para os quatro refs juntos, não só para o rótulo. Com sal, quem verifica precisa tê-lo (o valor nunca é gravado no bundle). **Decisão pendente:** a política de sal por usuário (quem gera, onde guarda, rotação, se é obrigatório para exportar a terceiros/IA); até lá nenhum ref deve ser tratado como anônimo e nenhuma exigência de sal foi criada. Plano do `sourceLabel`: `docs/ai-partner/sourceLabel-plano.md` (decisões A–E de 12/10/2026).

### 14.15 `sourceLabel` na Evidence: vocabulário fechado + token (IMPLEMENTADO em 12/10/2026, S0–S5)
- **Projeção (só na Evidence; o Canonical interno não muda):** `entryLabel`, `exitLabel` e `sourceLabel` das pernas carregam **a palavra do vocabulário v1** (`""`, `Entry`, `Target<0–99>`, `Stop<0–99>`, `Zerar`; casamento da string inteira após normalizar; saída = texto original aparado) **ou** o token `lbl_<24 hex>` (domínio `meutrade/labelRef/1`, mesmo `accountRefSalt` opcional). Texto livre **nunca** entra. `projectLabel` não é idempotente de propósito (evita injeção de formato); protege o produtor, não contra edição de bundle (o E5b detecta).
- **Schema:** `ProjectedLabelSchema` — o V0 rejeita texto livre mesmo com selo refeito (`INVALID_FORMAT`). `ImportRef.labelVocab` opcional (ausente = 1; ≠ 1 ⇒ E5b `UNVERIFIABLE`, `S_VERSION_INCOMPATIBLE`).
- **Hash:** `evidenceHash` muda em todo bundle com ≥ 1 `ImportRef` (por `labelVocab`); remover `labelVocab` e recalcular o selo reproduz o baseline (prova dos 9 bundles). Bundle sem `ImportRef` não muda. `importId/rowHash/tradeId/tradeSetHash` não mudam.
- **Mapa de motivos do usuário (decisão C):** `reproducibility.exitReasonMap` = `{patternRef, reason}[]` (regex só no `ImportRecord` interno); o E5b exige o mapa do chamador, conferido regra a regra/ordem/motivo/sal; ausente/divergente ⇒ `UNVERIFIABLE` (`S_CONTEXT_INSUFFICIENT`); salgado sem sal ⇒ `S_ACCOUNT_REF_UNVERIFIED`.
- **E5b:** reprojeta o rótulo do CSV e compara; token trocado por outro bem formado ⇒ `SOURCE_MISMATCH` em `V5.values` (o V0–V6 não vê). Estado do E5b **nunca é lido isolado** (veredito combinado, E6-G6-plano §6.1).
- **Vocabulário v2 (guardado):** `Flat`/`Close` ficam fora da v1 por decisão; entram numa v2 com `labelVocab: 2`.
- **Matriz de combinações (prática geral):** todo recurso novo que interage com sal/rótulo/mapa/derivado deve ser testado na matriz **sal × rótulo (padrão/livre) × mapa (vazio/usuário) × tipo de bundle (métrica/derivado)**, incluindo entrada errada no verificador (sal/mapa a menos, a mais, errado) e geração sem sal. Implementada em `scripts/test-evidence-sourcelabel-s4.mts` (16 combinações do caminho correto, variantes de entrada errada, adulteração, geração sem sal). O bug de sal do E5b (E6.0→S1) passou 3 etapas por falta da combinação sal + estratégia-sem-sal.
- **Lacuna conhecida (com pista):** sal esquecido na GERAÇÃO e sem mapa ⇒ `SOURCE_MISMATCH` (parece adulteração); o texto do check traz "possível causa: o sal do import não foi propagado". Veredito inalterado.
- **Guarda de propagação do sal (`test-evidence-salt-propagation.mts`) — cobertura boa, NÃO é prova formal.** Camadas: 1 (funções de ref nomeiam o sal), 2 (todo `explain*(` em `src/` passa o sal), 2b (uma só fonte de sal no `explain-trade`), **2c (só arquivos aprovados importam `explain-trade/metric/derived`; arquivo novo falha até revisão)**, 3/3b/3c/3d (comportamentais, com controle negativo). **Falsos-negativos que RESTAM mesmo com a 2c:**
  1. **Aprovação por engano / wrapper dentro de um arquivo aprovado:** um arquivo da lista aprovada pode ganhar um wrapper/alias de nome novo que chama o gerador sem sal; as camadas 1/2 só enxergam nomes conhecidos e a 2c só vê *quem importa*, não *o que faz*. Vale também se alguém incluir um arquivo na lista sem revisar.
  2. **Sal errado com `opts` presente:** a camada 2 aceita `accountRefSalt|opts|...opts` no texto da chamada; `opts` com o sal errado (outro import, outra variável) passa. Só os testes comportamentais (3b) pegam, e só nos geradores que exercitam.
  3. **Geração indireta/dinâmica ou fora de `src/`:** import por caminho montado em runtime, reexport por barrel novo com outro nome, ou gerador fora de `src/` (scripts, rotas de outro pacote) não são varridos. A análise é textual (regex), não de fluxo de dados.
  Registrado para não perder: a cobertura é boa, não é prova formal. Resolver só com decisão do Marcelo.

## 15. E6 — motivo de saída, grupos e comparações (plano aprovado em 2026-10-12; só o E6.0 implementado)

### 15.1 E6.0 — dimensão/filtro `exitReason` (motivo de saída AGREGADO POR TRADE) e `strategyRef` (IMPLEMENTADO em 2026-10-12)

**Origem do motivo (não muda no E6.0).** O motivo nasce **por perna** na ingestão: `exitLegs[].reason ∈ {TARGET, STOP, MANUAL, UNKNOWN}`, decidido pelo **nome** da ordem de saída (regra padrão `Target*`→TARGET, `Stop*`→STOP, `Zerar/Flat/Close`→MANUAL; mapa do usuário tem prioridade, `reasonRule` = `LABEL_RULE`/`USER_MAP`/`NONE`). É o **rótulo**, não o tipo real da ordem: `Stop` em break-even continua STOP; MANUAL = "comando de zerar", não decisão discricionária. O motivo **nunca** é inferido do P&L, do sinal do resultado, do preço nem da estratégia (teste: `Stop` com lucro = STOP; `Target` com prejuízo = TARGET; rótulo desconhecido com lucro ou prejuízo = UNKNOWN).

**Agregação por trade** (`src/lib/metrics/exit-reason.ts`, função pura; usada por `prepareTrades`): seja D o conjunto de motivos **distintos de todas as pernas de saída** (parciais e final), com `UNKNOWN` contando como um valor:

| D | bucket | `exitReasonPartial` |
|---|---|---|
| 1 valor (`TARGET`/`STOP`/`MANUAL`) | esse valor (várias saídas do mesmo motivo = o mesmo motivo) | false |
| só `UNKNOWN` | `UNKNOWN` | false |
| ≥ 2 valores conhecidos | `MIXED` | false |
| ≥ 2 valores, **incluindo `UNKNOWN`** (conhecido + desconhecido na mesma operação) | `MIXED` | **true** |
| sem pernas (trade-linha `SOURCE_ROW`, ou ciclo sem `exitLegs`) | `UNKNOWN` (`exitReasonSource = NONE`) | false |

Sem `exitLegs` mas com `exitSummary.byReason`, aplica-se a mesma regra às chaves com quantidade > 0 (`exitReasonSource = SUMMARY`). Valor fora do enum nunca vira motivo conhecido. **Decisão da regra "conhecido + desconhecido":** vira `MIXED` + `partial` (e não o motivo conhecido) para não atribuir à operação inteira um motivo que só vale para parte das saídas e para não esconder a saída desconhecida; a quebra fina por perna é o E6.1. Diferente do `exitSummary.finalReason` do Canonical (só a perna que zera a posição): o E6.0 olha **todas** as saídas.

**Dimensão e filtro.** `groupBy: "exitReason"` (e combinações, ex. `["exitReason","direction"]`) e `filters.exitReason` (valor ou lista, caixa normalizada, inválido ⇒ `E_FILTER_INVALID`). Chave **nunca `null`**: `UNKNOWN` e `MIXED` são grupos explícitos ("Desconhecido", "Misto (motivos diferentes)"); Σ amostras = população e Σ P&L por bucket = total (centavos). Nenhuma das 39 métricas muda de fórmula/versão (`DEFINITION_VERSION` intacta); `tradeSetHash`, `tradeId` e `rowHash` idênticos (o motivo **não entra** no fingerprint). Trades-linha ⇒ `UNKNOWN` ("não sei", não "sem stop"): relatórios devem mostrar a cobertura.

**Evidence.** `analyticsTradeFromEvidence` passa a **copiar** `exitLegs`/`exitSummary` do `TradeEvidence` (já presentes) para o motor; assim a dimensão e o filtro `exitReason` entram em `ENGINE_DIMS`/`ENGINE_FILTERS` do verificador: `V4.association` **verifica** que todos os trades do grupo pertencem ao bucket declarado, a partir das pernas que a Evidence carrega (adulterar a chave do grupo ou o motivo de uma perna, mesmo com selo refeito ⇒ `FAIL`/`TAMPERED`). **Limite dito:** isso prova a **consistência da agregação** com as pernas da Evidence; a **veracidade do motivo** (rótulo → motivo, mapa do usuário) é a do E5b (`V5.values`, com `reproducibility.exitReasonMap`) e continua sendo o nome da ordem, não o tipo real. Bucket `UNKNOWN` verificado = "os trades do grupo realmente não têm motivo conhecido", nunca "motivo verificado".

**`strategyRef` (decisão 5 do E6).** `reconstruction.cycleKey.strategy` (nome da estratégia em texto aberto, achado do E3) foi **substituído** por `cycleKey.strategyRef` = `str_` + 24 hex de SHA-256(`meutrade/strategyRef/1` ∥ sal ∥ nome aparado); determinístico, distingue estratégias, mesmo sal do `accountRef` (`accountRefSalt`), domínio próprio (o mesmo texto não gera o mesmo ref de conta), nome vazio ⇒ `null`. Continua `evidence/1` (sem `evidence/2`); bundles **novos** têm `evidenceHash` diferente (como no E5.0/§14.12). **Varredura de caminhos de exposição** (todos tratados e testados): (1) `TradeEvidence.reconstruction.cycleKey`; (2) `MetricEvidence.query.filters.strategyName/strategyId` → `strategyNameRefs`/`strategyIdRefs`; (3) `query.groupKey` de `groupBy: "strategy"` → `strategyRef`; (4) mensagens de `issues`/`warnings`/`ambiguities`/`fileName`: **trava fail-closed** `E_STRATEGY_NAME_LEAK` (mesmo mecanismo da conta) em `explainTrade` e `explainMetric`, procurando em todo o bundle os nomes de estratégia do `labels.strategyName`, do `cycleKey` e dos filtros/chaves pedidos. **Limites assumidos:** `strategyVersionId`, `setup` e `timeframe` continuam em claro nos filtros (são rótulos do usuário, não o nome da estratégia; se contiverem o nome, a trava acusa quando coincide com um nome conhecido); `strategyRef` é pseudônimo (sem sal, nome curto/comum é adivinhável por dicionário, como o `accountRef`); `labels.strategyName` não está no `TradeEvidence` (nunca esteve). O **motor** continua agrupando/filtrando pelo nome (privacidade é da Evidence, não do motor); a associação a grupos por estratégia segue `SKIPPED S_ASSOCIATION_UNVERIFIABLE` (a Evidence não tem a estratégia para conferir). `strategyRef` **não** altera `importId`/`rowHash`/`tradeId` (o nome da estratégia continua dentro do hash da linha, como antes).

**Testes.** `scripts/test-metrics-exit-reason.mts` (24; no `test:domain`): tabela da regra, pipeline real (11 ciclos: alvo, alvo×2, stop, stop com lucro, alvo com prejuízo, manual, alvo+stop, stop+manual, rótulo desconhecido, sem rótulo, alvo+desconhecido), mapa do usuário, trade-linha, partição/reconciliação em centavos, total idêntico com/sem a dimensão, multidimensão, determinismo (ordem de chegada), filtro, Evidence (associação PASS, adulteração), `strategyRef` e privacidade (incl. fail-closed), identidade intacta, e as fixtures reais locais (sem números no repositório).

**Fora do E6.0 (continua pendente, ver §15.2 para o E6.1):** E6.1 quebra por perna (`exitBreakdown`), E6.2 ranking/contribuição/comparação, E6.3 Evidence dos derivados (`claim.kind`/`derived[]`, V6), E6.4 aba no Lab, E6.5 contrato do agente. Sem integração com a Vega IA, sem Prisma, sem UI de produto.

### 15.2 E6.1 — `exitBreakdown`: resultado por PERNA de saída (IMPLEMENTADO em 2026-10-12)

`exitBreakdown(trades, { filters, ...options })` em `src/lib/metrics/legs.ts` (função pura; população, filtros e bucket por trade vêm de `prepareTrades`/`applyFilters`/E6.0; o `tradeSetHash` é o do motor). Resultado tipado `metrics-exit-breakdown/1` (versão `1.0.0`), determinístico, pronto para o E6.2 (rank/contribuição/comparação) e o E6.3 (Evidence dos derivados). **Não altera** `DEFINITION_VERSION`, nenhuma das 39 métricas, o `tradeSetHash`, a ingestão nem o schema `evidence/1` (nenhuma mudança de schema).

**O que existe por perna (auditado) e o que NÃO existe.**
| Dado | Por perna? | Fonte |
|---|---|---|
| quantidade, motivo, `reasonRule`, `rowRefs`, papel | sim | `exitLegs[]` (ciclos NT8) |
| P&L líquido, bruto, comissão, taxas | sim, **como o relatório traz por linha-lote** | `exitLegs[].pnl` = `sumMoney` das linhas casadas com aquela saída pelo próprio NT8 (nada é rateado por nós) |
| base do P&L (`basis`), `netStatus`, P&L "reportado" | **não** — só no trade | `trade.pnl.basis/netStatus/reported` |
| `rowHash` | por linha de origem | `sourceRows[]` do trade (entra no `legSetHash`) |
| trade-linha (`SOURCE_ROW`) | **sem pernas** | fora do breakdown, contado |
| caminho de fills (`executions.ts`) | só comissão/taxas; net/gross `null` | indisponível, nunca 0 |

**Regras financeiras.** Só valores de origem das pernas; nada de ratear o P&L do trade, dividir por igual, recalcular por preço, alocar custos ou inferir motivo do resultado. **Valor ausente = ausente**: `null` + cobertura (`legsKnown`/`legsUnavailable`), fora da soma, nunca zero. **net/gross só são afirmados se o trade tem base conhecida** (a perna não guarda base; com `basis = UNKNOWN` o número da linha não é atribuído — `BASIS_UNKNOWN`). Comissão/taxas independem da base, mas só contam se a linha as trouxe. Soma em centavos inteiros (`exact.ts`); quantidade em 1e-6.

**Saída.** `byReason` com as 4 chaves `TARGET|STOP|MANUAL|UNKNOWN` (sempre presentes; sem pernas ⇒ valores `null`) + `total` (todas as pernas; Σ motivos = total em contagens e centavos). **`MIXED` não existe por perna** (uma perna tem um motivo): ele continua sendo o bucket **do trade** (E6.0, regra intacta, `MIXED+partial` preservado) e aparece como `legsInMixedTrades`/`legsInPartialTrades` e em `population.tradesByBucket` — mostra quanto de cada motivo vive em trades de saídas mistas, **sem** jogar o P&L do trade num motivo só. Por motivo: `legs`, `quantity`, `trades`, `byRule` (LABEL_RULE/USER_MAP/NONE — nenhum rótulo), `net/gross/commission/fees` (`MoneySum`), `winners/losers/breakeven` e `averageNet` (sobre as pernas com `net` conhecido), `contributionToNet` (net do motivo ÷ net de todas as pernas, 4 casas; `null` se o total é 0, desconhecido ou incompleto; pode ser >1 ou <0 com sinais opostos), `legSetHash` e `legRefs`.

**Conferência perna × trade (`reconciliation`).** Por trade com pernas e por campo (net, gross, commission, fees): `RECONCILED` (Σ pernas = valor do trade, em centavos), `DIVERGENT` (mostrada em `divergences[]`: trade, campo, soma das pernas, valor do trade, diferença — **nunca forçada**, o número da perna é o que a perna traz) ou `NOT_COMPARABLE` (`LEG_VALUE_MISSING` | `TRADE_VALUE_MISSING` | `BASIS_UNKNOWN`). Também: quantidade (Σ pernas × `trade.quantity`) e linhas (`duplicatedRowRefs`: linha em >1 perna ⇒ dupla contagem; `uncoveredSourceRows`: linha do trade fora das pernas). Avisos: `W_TRADES_WITHOUT_LEGS`, `W_VALUE_UNAVAILABLE`, `W_RECONCILIATION_DIVERGENT`, `W_ROW_REFS_INCONSISTENT`, `W_UNKNOWN_REASON_SHARE` (INFO). `contribuição` e somas só falam do que tem valor; a cobertura sempre acompanha.

**Rastreabilidade e privacidade.** `legRefs` = `{tradeId, legIndex, rowNos}` (até `tradeIdsLimit`; acima, `null` e vale o `legSetHash`). `legSetHash` (SHA-256, domínio `meutrade/exitLegSet/1`) cobre tradeId, índice, motivo, regra, quantidade, `rowNo`s, **`rowHash`**s e valores: muda se qualquer perna/linha/valor mudar. **`sourceLabel` nunca sai** (pode ter texto do usuário), nem conta, estratégia ou nome de arquivo; nenhum trecho do CSV. Como o `TradeEvidence` já carrega as pernas, os `rowHash` e a base do P&L, o breakdown calculado a partir da Evidence é **idêntico** ao do Canonical (testado, incl. fixtures reais) — reproduzível sem exigir mais nada.

**Limites ditos.** Motivo = nome da ordem (+ mapa do usuário), não o tipo real (`Stop` em break-even continua STOP; MANUAL = "zerar/fechar", não prova de decisão discricionária); `UNKNOWN` ≠ "sem stop" (nas fixtures reais ~metade das pernas é UNKNOWN: rótulo fora de Target/Stop/Zerar); trades-linha ficam fora (contados); em trade com bases mistas por linha o `net` do trade é `null` e o das pernas não é afirmado. Não há ainda Evidence dos derivados (E6.3), ranking/comparação (E6.2), aba no Lab (E6.4) nem contrato do agente (E6.5).

**Testes.** `scripts/test-metrics-exit-breakdown.mts` (20; no `test:domain`): oráculo independente calculado das linhas do CSV (7 ciclos/14 pernas: todas target, todas stop, manual, target+stop, conhecido+desconhecido, tudo desconhecido, quantidades 3/2/1), comissão/taxas por linha, valores ausentes e base desconhecida, divergência (valor e quantidade), referências e `legSetHash`, privacidade (inclui rótulo "sensível"), equivalência Evidence↔Canonical, determinismo (ordem de chegada), regressão E6.0, reconciliação contra o `calculateMetrics` independente e detecção de dupla contagem, vazio/filtros/trade-linha/mapa do usuário e as 2 fixtures reais locais (sem números no repositório).

### 15.3 E6.2 — ranking, contribuição e comparação de grupos (IMPLEMENTADO em 2026-10-12)

`src/lib/metrics/analysis.ts` (funções puras; **sem 2º motor**: usam `aggregateTradesTraced`, `calculateMetrics`, `exitBreakdown` e `exitReasonOf`; só escolhem, ordenam, dividem e subtraem números já calculados, em inteiros escalados de `exact.ts`). Resultados tipados (`metrics-analysis/1`, `1.0.0`), determinísticos e prontos para a Evidence dos derivados (E6.3, **não implementada**). Nada muda em fórmulas, `tradeSetHash`, `tradeId`/`importId`/`rowHash`, buckets do E6.0, `evidence/1` ou ingestão (só um export novo, `dimensionLabel`).

**Regras gerais.** (1) Toda saída declara a **unidade**: `TRADE` (grupos do motor) ou `LEG` (pernas do E6.1) — nunca se mistura contagem de pernas com contagem de trades; as duas aparecem lado a lado e rotuladas em `exitReasonAnalysis`. (2) Indisponível = `value: null` + `reason` (`NO_LEGS`, `VALUE_NOT_AVAILABLE_ON_LEGS`, `NO_TRADES`, `METRIC_NOT_COMPUTED`…); **nunca zero**. (3) Fração/percentual só com **denominador válido** (conhecido e ≠ 0); senão `null` com motivo (`DENOMINATOR_ZERO`, `DENOMINATOR_UNAVAILABLE`); denominador de cobertura parcial devolve o número **com** `reason: DENOMINATOR_PARTIAL_COVERAGE`. (4) **Inferência só descritiva** (`inference: "DESCRIPTIVE_ONLY"`): amostra, `sampleFlag`, cobertura, delta e razão. Sem p-valor, sem "significativo", sem "melhor"/"pior": ordenação por critério explícito (`order`), não por mérito. (5) `confidence` ∈ `OK | LIMITED | UNRELIABLE` + `limitations[]` (códigos estáveis: `SAMPLE_TINY/LOW`, `METRIC_UNAVAILABLE`, `COVERAGE_PARTIAL`, `UNKNOWN_GROUP`, `UNKNOWN_EXIT_REASON`, `TRADES_WITHOUT_LEGS`, `RECONCILIATION_DIVERGENT/PARTIAL`, `GROUP_NOT_FOUND`, `PERIOD_EMPTY`, `PERIODS_OVERLAP`). `UNRELIABLE` = amostra minúscula, métrica indisponível, divergência perna×trade, grupo/período inexistente; **`OK` não é significância estatística**. (6) R só onde o motor o tem (stop/risco informado e validado): a cobertura diz quantos trades; nada é inferido do resultado.

**Funções.**
- `rankGroups(trades, { groupBy, metric = "netPnl", order = "DESC", where?, filters?, … })` — **UNIDADE: trades**. Cada linha: chave/rótulo, `sampleSize`/`sampleFlag`, `value`/`net`/`gross`/`averageNet` (células com cobertura), `winners/losers/breakeven`, `shareOfTrades`, `contributionToSubset` (líquido do grupo ÷ líquido do recorte `where`) e `contributionToTotal` (÷ líquido do total), `exit` (contexto de saída do grupo: trades por bucket, parcela `UNKNOWN`/`MIXED` em trades e `UNKNOWN` em pernas, trades sem pernas, status da reconciliação perna×trade do subconjunto), `limitations`, `confidence`, `tradeSetHash` (= o do motor para o grupo). **Ordenação:** valor (conforme `order`) → maior amostra → chave; empate marcado em `tiedWithPrevious`. **Só recebe posição** (`rank`) grupo com valor disponível e amostra ≠ TINY; os demais ficam **listados** (grupo desconhecido, UNKNOWN, MIXED, TINY, métrica indisponível) e explicados — nada é descartado para "melhorar" o ranking. `where` restringe a dimensões presentes em `groupBy` (ex.: só `exitReason = STOP`, ranqueando por hora).
- `compareGroups(trades, { groupBy, a, b, metrics? })` e `comparePeriods(trades, { a: {from,to}, b: {from,to}, metrics? })` — **UNIDADE: trades**. Por métrica (padrão: `totalTrades, netPnl, grossPnl, averageTrade, winRate, profitFactor, totalR, averageR`): células A/B, `delta = B − A` (exato, em inteiros escalados da unidade), `ratio = B ÷ A` **só** com A ≠ 0 e mesmo sinal (senão `null` + `RATIO_A_ZERO`/`RATIO_SIGN_DIFFERS`), `conclusive` (amostra OK **e** cobertura completa nos dois lados — descritivo). Cada lado precisa informar **todas** as dimensões de `groupBy`. Período = filtros `from`/`to` do **mesmo** motor (data local do instante âncora); sobreposição e período vazio viram limitação. Dimensões suportadas = as 15 do motor: `day, tradingDay, week, month, dayOfWeek, hour, session, symbol, direction, account, strategy, strategyVersion, setup, timeframe, exitReason` (e combinações).
- `exitReasonAnalysis(trades, …)` — **as duas unidades lado a lado**: `legs` (UNIDADE: LEG; valores **observados nas pernas**, 4 motivos; MIXED não existe por perna; ranking por líquido das pernas; contribuição ao líquido das pernas; `legsInMixedTrades/Partial`) e `trades` (UNIDADE: TRADE; valores **calculados sobre o trade completo** por bucket do E6.0 — `TARGET, STOP, MANUAL, MIXED, UNKNOWN` sempre presentes; inclui `totalR/averageR` só dos trades com stop informado). O P&L de um trade MIXED fica no bucket MIXED do lado trade e **nunca** é atribuído a um motivo; as pernas mostram o que cada saída trouxe. `reconciliation` (`FULL | PARTIAL | DIVERGENT | NO_LEGS`) + parcela UNKNOWN: divergência perna×trade rebaixa **todas** as linhas de perna a `UNRELIABLE` e é mostrada (política do E6.1 mantida: avisa, não bloqueia, não força); parcela `UNKNOWN` presente ⇒ `UNKNOWN_EXIT_REASON` (LIMITED) também nos motivos conhecidos.
- `compareExitReasons(analysis, "STOP", "TARGET")` (pernas) e `compareTradeBuckets(analysis, "STOP", "TARGET")` (trades, R só com stop informado); `rankGroupsByExitLegs(trades, { groupBy, reason, order = "ASC", where? })` — onde as pernas de um motivo rendem mais/menos (hora, sessão, direção, conta…), com denominador = pernas desse motivo nos grupos selecionados e a reconciliação do **subconjunto** de cada grupo.

**As seis perguntas → funções.** (1) "Perdi mais em stops?" → `exitReasonAnalysis().legs` (+ `compareExitReasons`); (2) "De onde vem meu lucro?" → `legs.rows[].contributionToLegNet` e `trades.rows[].contributionToTotalNet`; (3) hora/dia/conta/ativo/sessão → `rankGroups`; (4) conta A×B, semana × semana → `compareGroups`/`comparePeriods`; (5) R de stops × targets → `compareTradeBuckets` (cobertura de R; indisponível se não há stop informado); (6) condições onde perco nos stops → `rankGroupsByExitLegs` (por perna) ou `rankGroups` com `where: { exitReason: "STOP" }` (por trade).

**Privacidade.** Por padrão (`redact: true`) as dimensões `account` e `strategy` saem como `accountRef`/`strategyRef` (mesmo mecanismo e sal da Evidence: `refSalt`), em chaves **e** rótulos, inclusive nos ecos de `where`/`a`/`b` e quando o grupo pedido não existe; `redact: false` (nomes) é opt-in local e **não** deve alimentar Evidence/agente. Nenhum `sourceLabel`, nome de arquivo ou trecho do CSV. Limite assumido (igual ao §15.1): `strategyVersion`, `setup` e `timeframe` saem como o usuário os rotulou.

**Limites ditos.** Perguntas só até onde os dados vão: motivo = nome da ordem; trades-linha sem pernas ficam fora do lado `legs` (contados em `tradesWithoutLegs`) e aparecem como `UNKNOWN` no lado `trades`; nas fixtures reais pequenas quase todo grupo é `LOW/TINY` (sem numeração) — é o comportamento correto, não um defeito. Sem Evidence dos derivados (E6.3), Lab (E6.4), contrato do agente (E6.5), Vega IA, Prisma ou UI.

**Testes.** `scripts/test-metrics-analysis.mts` (21; no `test:domain`): dataset de trades com oráculo à mão (contas, horas, direções, semanas, R parcial) e 8 ciclos do pipeline (alvo, stop, manual, misto, desconhecido, quantidades 3/2/1); cobre ranking positivo/negativo (DESC/ASC), contribuição e denominador zero, amostras OK/LOW/TINY, UNKNOWN/MIXED preservados, contas por `accountRef` (e sal), períodos (sobreposição/vazio), hora×direção, motivo de saída por perna e por trade, cobertura parcial, divergência (UNRELIABLE e valores perna×trade lado a lado), grupos não comparáveis, privacidade, determinismo (ordem de chegada e empate), não regressão do E6.0/E6.1 (hashes) e as 2 fixtures reais locais (Σ amostras e Σ líquido = total do motor).

### 15.4 E6.3 — Evidence dos derivados e verificação V6 (IMPLEMENTADO em 2026-10-12)

Os resultados do E6.2 (ranking, contribuição, comparação) viram Evidence **rastreável e reproduzível**, como a métrica faz com o V4: o verificador **reexecuta a mesma função** do E6.2 sobre os `TradeEvidence` do bundle e compara. **Não há segunda implementação** de ranking, contribuição, delta, razão nem comparação (`verify.ts` só chama `computeDerived`; um teste de arquitetura trava isso). `evidence/1` continua; a extensão é **aditiva** (sem `evidence/2`).

**Schema (aditivo).** `claim.kind` e `subject.type` ganham `"DERIVED"`; `evidence.derived?: DerivedEvidence[]` (opcional ⇒ bundles anteriores continuam válidos e com o **mesmo** `evidenceHash`). `DerivedEvidence` (strict): `derivedId` (`drv_` + 32 hex = SHA-256, domínio `meutrade/derived/1`, de operação + argumentos + filtros + opções + `tradeSetHash` + versões; sem relógio/random) · `analysis {op, unit, schema, definitionVersion, engineVersion}` · `query {args, filters, options{timeZone, timeAnchor, pnlBasis, rBasis, minSample, tradeIdsLimit}}` · `population {afterFilters, tradeSetHash, tradeIds|null}` · `verifiability FULL|HASH_ONLY` · `result` (o JSON do E6.2, verificado por igualdade com o recálculo — por isso o schema fixa só o envelope) · `summary {inference:"DESCRIPTIVE_ONLY", confidence|null, limitations[], reconciliation|null}` (pior confiança, união das limitações e pior reconciliação, calculados do `result`) · `refs.legs {applicable, items|null}` (pernas `{tradeId, legIndex, rowNos}`, só em operações de perna) · `computedAt` (fora do hash). Operações (`op`): `GROUP_RANKING`, `GROUP_COMPARISON`, `PERIOD_COMPARISON`, `EXIT_REASON_ANALYSIS`, `EXIT_REASON_COMPARISON_LEGS`, `EXIT_REASON_COMPARISON_TRADES`, `LEG_GROUP_RANKING`. **Unidade preservada:** `TRADE` (calculado sobre o trade completo), `LEG` (valor atribuído às pernas) e `TRADE_AND_LEG` (`EXIT_REASON_ANALYSIS`, que traz os dois lados rotulados); o `result` mantém `unit` nas seções. `OK/LIMITED/UNRELIABLE` e os códigos de `limitations[]` do E6.2 são copiados sem reinterpretar; **`UNRELIABLE` = sem base para conclusão comparativa confiável, não "dados falsos"; `OK` ≠ significância estatística** (sem p-valor).

**Construção** (`explainDerived`, `evidence/explain-derived.ts`; núcleo único `evidence/derived.ts`). Os trades passam por uma **"visão por refs"** antes de qualquer cálculo: nome da conta e da estratégia viram `accountRef`/`strategyRef` (`trade.account.ref` ou `accountRef(nome, sal)`), o E6.2 roda com `keysAreRefs` e os argumentos/filtros de conta/estratégia são guardados **como refs** (`filters.account`, `strategyId`, `strategyName` e as chaves de `where`/`a`/`b`). O mesmo caminho (mesma função, mesma forma de entrada) é o do verificador. A população é a **filtrada** (`tradeSetHash` do motor/E2); o `result` é calculado sobre ela (`inputTrades` = tamanho da população declarada). Trava fail-closed `E_ACCOUNT_NAME_LEAK`/`E_STRATEGY_NAME_LEAK` sobre todo o bundle; erros `E_DERIVED_SPEC_INVALID`, `E_DERIVED_COMPUTE_FAILED`, `E_POPULATION_IDENTITY_MISSING`, `E_DUPLICATE_TRADE_ID`, `E_IMPORT_UNRESOLVED`, `E_TRADE_EXPLAIN_FAILED`, `E_SCHEMA`. `tradeIds` até `tradeIdsLimit`; acima, **HASH_ONLY** (sem trades/pernas no bundle).

**V6 (8 checks novos; o catálogo passa de 31 para 39; sem derivados, todos `S_NOT_APPLICABLE` e o status dos bundles anteriores não muda).** `V6.versions` (contrato do E6.2, definição e motor atuais; senão `S_VERSION_INCOMPATIBLE`, não é adulteração) · `V6.query` (unidade coerente com a operação, argumentos no contrato **e normalizados**, opções/filtros aceitos pelo motor; dimensão/filtro sem referência na Evidence — estratégia, setup, timeframe, sessão… — ⇒ `S_ASSOCIATION_UNVERIFIABLE`) · `V6.refs` (shape FULL×tradeIds, `afterFilters`, população e pernas citadas existem, `rowNos` ⊆ `rowRefs` da perna, `refs` coerente) · `V6.population` (`tradeSetHash` refeito dos `TradeEvidence` e filtros verificáveis respeitados) · `V6.result` (grupos, chaves e **valores** recalculados) · `V6.derived` (**deltas, razões, contribuições, posições e participações**) · `V6.quality` (amostra, cobertura, `sampleFlag`, `confidence`, `limitations`, reconciliação, resumo e pernas) · `V6.determinism` (duas execuções idênticas). A classificação das divergências entre os três checks de resultado é só de **caminho** (`classOfPath`), não de fórmula. FAIL = inconsistência **detectada** (`V_DERIVED_QUERY_INVALID`, `V_DERIVED_REF_MISSING`, `V_TRADESET_HASH_MISMATCH`, `V_DERIVED_RESULT_MISMATCH`, `V_DERIVED_DERIVATION_MISMATCH`, `V_DERIVED_QUALITY_MISMATCH`, `V_DERIVED_NONDETERMINISTIC`, `V_DERIVED_VERSION_UNKNOWN`); impossibilidade = SKIPPED `S_*` (**nunca PASS**): HASH_ONLY ⇒ `S_HASH_ONLY`, referência quebrada ⇒ `S_REFS_BROKEN`, versão ⇒ `S_VERSION_INCOMPATIBLE`, dimensão sem referência ⇒ `S_ASSOCIATION_UNVERIFIABLE` — todos resultam em `UNVERIFIABLE` (ou `TAMPERED` se houver FAIL). Dimensões recalculáveis a partir da Evidence: `day, tradingDay, week, month, dayOfWeek, hour, symbol, direction, account (por accountRef), exitReason`; filtros: `from, to, symbol, direction, hour, dayOfWeek, tradingDay, exitReason, account`. Ajustes em V2/V3/V4: bundle **só com derivados** ⇒ checagens de população/contributors de *métrica* e V3/V4 = `S_NOT_APPLICABLE`; `V2.unreferenced-trades` e `V2.subject` passam a considerar a população e o `derivedId` dos derivados; um bundle pode ter métrica **e** derivado (V4 e V6 rodam).

**O que `VALID` diz (e não diz).** O derivado é **reproduzível** pela função real do E6.2 a partir dos trades declarados e todos os hashes/referências fecham. **Não prova** a origem do CSV (E5b — que continua separado e lê o bundle de derivados; sua checagem de "população completa" só considera `metrics[]`, então fica conservadora para bundles só com derivados), **nem** que a seleção original foi correta, e o selo **não é assinatura** (adulteração coordenada com selo refeito é pega pelo recálculo do V6, mas quem controla todos os trades do bundle controla o resultado). Divergência perna×trade é **declarada**, não escondida: `summary.reconciliation = DIVERGENT` + `UNRELIABLE`; o V6 confirma o que foi declarado, e **declarar `FULL` quando o recálculo diz `DIVERGENT` é adulteração (V6.quality)**.

**Hashes.** Nenhum algoritmo novo (`canonicalJson` + `sha256Hex`; `derivedId` é 1 SHA-256 por derivado). `tradeSetHash` = o do motor (E2); `tradeId`/`importId`/`rowHash`/métricas/buckets/breakdown/rankings do E6.2 **idênticos**. `normalizeForHash` só inclui `derived` quando há itens (ordenado por `derivedId`, sem `computedAt`): **bundles sem derivados hasheiam exatamente como antes** (testado contra o cálculo antigo refeito à mão); bundles **com** derivados têm `evidenceHash` novo — esperado e documentado.

**Privacidade (auditoria).** Caminhos verificados: `query.args`/`filters`, chaves e rótulos do `result` (conta/estratégia = refs, inclusive no eco de grupo inexistente), `summary`, `refs`, `TradeEvidence`/`ImportRef` (E3), mensagens de erro e warnings, relatório do verificador. Nenhum nome de conta, de estratégia, nome de arquivo nem sal; trava fail-closed. **Limite honesto (pré-existente, E3):** o `TradeEvidence` já carrega o rótulo de origem das ordens em `exitLegs[].sourceLabel` e `sourceRows[].entryLabel/exitLabel` (o E5b precisa deles para reconferir o motivo contra o CSV); o E6.3 **não os replica** em nenhuma parte do derivado, mas eles continuam dentro dos `TradeEvidence` do bundle — se esse dado puder conter texto do usuário, remover/hashear exige **decisão separada** (muda o E3, o `evidenceHash` e o E5b). `accountRef`/`strategyRef` são **pseudônimos, não anonimização criptográfica** (sem sal, nomes curtos/comuns são adivinháveis por dicionário); exposição à Vega IA ou a terceiros herda esse limite. `strategyVersion`, `setup` e `timeframe` saem como o usuário os rotulou (a trava acusa quando coincidem com nome de conta/estratégia conhecido).

**Testes.** `scripts/test-evidence-derived.mts` (20; no `test:domain`): íntegros (9 operações ⇒ V6 todo PASS e `VALID`), contrato/unidades, UNKNOWN/MIXED e confidence/limitações, valor indisponível, grupo/período inexistente, divergência de reconciliação (declarada e não escondível), adulteração com selo refeito (valor, delta, razão, contribuição, posição, amostra/`sampleFlag`, confiança/limitações), referências (trade/perna/`rowNos`/shape/subject/hash), grupo/dimensão/métrica/ordem/filtro/operação/unidade/opções/argumentos trocados, campos desconhecidos, `HASH_ONLY`, versões incompatíveis, associação inverificável (estratégia), determinismo (mesmo bundle e mesmo `evidenceHash`, ordem de chegada, sem relógio/random), privacidade (inclui sal e trava fail-closed) e hashes (aditivo, `tradeSetHash` do motor), não regressão (V0–V4, `calculateMetrics ≡ calculateMetricsTraced(...).result`, E6.0/E6.1/E6.2, métrica+derivado no mesmo bundle), E5b e as 2 fixtures reais locais (19 derivados, nenhum FAIL, 19/19 adulterações detectadas). Testes de catálogo de V0–V4 atualizados de 31 para 39 checks (V6 acrescenta 8; a lista de imports do guard de arquitetura do `verify.ts` foi atualizada conscientemente).

**Fora do E6.3 (pendente):** E6.4 aba no Evidence Lab, E6.5 contrato do agente; sem Vega IA, Prisma, persistência nem UI de produto.

### 15.5 E6.4 — Evidence Lab: aba Derivados (IMPLEMENTADO em 2026-10-12)

Só ferramenta de desenvolvimento (`/dev/evidence-lab?tab=derived`, `NODE_ENV=development`); **nenhuma mudança** em contrato, schema, hashes, métricas, verificadores ou fórmulas. Detalhes e garantias em `docs/ai-partner/evidence-lab.md` (“Aba Derivados”). Resumo: 17 cenários sintéticos executados com as funções reais (explainDerived, selo, verifyEvidence V0–V6, verifyEvidenceSource); unidades TRADE/LEG rotuladas; V6 com os 8 checks e SKIPPED sempre “não verificado”; rótulos de origem não exibidos; sem endpoint novo; produção → 404. **Pendência antes do agente (E6.5):** minimizar/substituir `sourceLabel` nos `TradeEvidence` sem perder a verificação de origem (E5b). Fora do E6.4: E6.5, Vega IA, Prisma, persistência, UI de produto.
