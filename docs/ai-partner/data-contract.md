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
