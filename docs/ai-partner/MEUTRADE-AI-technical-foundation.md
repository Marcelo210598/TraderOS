# MeuTrade AI — Technical Foundation (v0.1, 01/10/2026)

> **Status:** especificação para revisão. **Nenhum código, migration, Prisma, UI ou integração foi alterado.**
> Complementa `MEUTRADE-AI-plano-estrategico.md` (visão, custos, mercado). Este documento responde **"como isso vira arquitetura implementável sem reconstruir o MeuTrade"**.
> Legenda: 🟢 verificado no código/fonte oficial · 🟡 fonte secundária · 🔴 premissa minha / a validar · ⚠️ achado de auditoria.
> Contratos abaixo são **especificações conceituais** (nomes e campos), não código de implementação.

---

## 0. Resumo executivo

1. **Princípio: evoluir, não reconstruir.** 34 arquivos leem `prisma.trade`. O "TradeV2" é a **mesma tabela `trades` com colunas aditivas e nulas** + tabelas satélite (`Fill`, `TradeContext`, etc.). Nada de tabela paralela nem big-bang.
2. **Auditoria encontrou 5 problemas reais no que já existe** (⚠️ seção O/P) que contaminam qualquer pesquisa futura: horário perdido na importação CSV (todos viram 09:00 BRT), importação sem deduplicação e sem limite de plano, semântica ambígua de `pnl`/`pnlPoints`/MFE-MAE, `pointValue` com default silencioso de NQ, e **parser de Tradovate incompatível com os exports reais** (Orders/Fills).
3. **Você usa Tradovate hoje → a importação por arquivo é o caminho real.** O Tradovate **exclui contas de prop/avaliação da API** 🟡 e as credenciais OAuth só vão para parceiros aprovados do NinjaTrader Ecosystem 🟡. Conector automático para você = indisponível/caro; **o 1º parser a construir é "Tradovate Orders/Fills (CSV)"**.
4. **Arquitetura em 3 camadas independentes**, ligadas por contratos: **(a) dados do trader** (Trade/Fill/Strategy/Memory), **(b) conhecimento e pesquisa** (Hypothesis/Experiment/Evidence), **(c) mercado e execução** (MarketDataProvider/BacktestEngine). O agente só enxerga **ferramentas determinísticas**, nunca tabelas.
5. **Uma única biblioteca de métricas** (funções puras) serve trades reais **e** trades simulados do futuro backtest. Já existe um embrião disso em `analytics-insights.ts` (🟢 funções puras, sem Prisma/React).
6. **Evidence é obrigatório:** todo número sai de uma tool com `evidenceId`; toda conclusão exige ≥ 1 evidência; verificador numérico no final.
7. **StrategyVersion = JSON declarativo versionado** (vocabulário fechado de primitivas + ambiguidades resolvidas explicitamente). O LLM *traduz*, o engine *executa*; nenhum código gerado é executado.
8. **Migração: expand → backfill → switch → (muito depois) contract**, testada primeiro em **branch do Neon**, com *flags* (padrão que você já usa em `integration-flags.ts`) e **desfazer importação por job**.
9. **Ordem proposta: 12 incrementos pequenos** (seção Q), cada um entregável e reversível; os dois primeiros **não tocam o banco**.

---

## A. Arquitetura geral

### A.1 Camadas e módulos (continua monólito Next.js; worker só no Estágio de backtest)

```
UI (Next App Router)  ─────────────────────────────────────────────────────────
  Chat do agente · Importação (preview) · Journal/Analytics (visões) · Ficha do trader
                                    │
API / Server Actions  ───────────────────────────────────────────────────────── (auth, plano, rate limit já existentes)
                                    │
┌───────────────────────────────────▼───────────────────────────────────────────┐
│ DOMÍNIO (src/lib/<módulo>) — regra: módulos puros NÃO importam Prisma/LLM     │
│                                                                                │
│  ingest/      parsers · normalizers · reconciler · validators · dedupe        │
│  trades/      repositório de Trade/Fill/Account (única porta p/ Prisma)       │
│  metrics/     catálogo de métricas (funções puras)  ◄── reaproveita analytics │
│  strategy/    schema da spec · validação · primitivas · renderizador pt-BR    │
│  memory/      itens de memória · Trader Card · propostas                      │
│  research/    hipótese · experimento · resultado · conclusão                  │
│  evidence/    registro imutável de origem de cada número                      │
│  agent/       orquestrador · roteador de modelo · tools · guardrails · evals  │
│  marketdata/  interface MarketDataProvider + adapters (SÓ interface agora)    │
│  backtest/    interface BacktestEngine (SÓ interface agora)                   │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                    │
Neon Postgres (transacional)  ·  Object storage (arquivos brutos, artefatos)  ·  Worker Python/Railway (futuro)
```

### A.2 Regras de dependência (o que evita bagunça em 6 meses)
1. **`metrics`, `strategy`, `evidence` (tipos) e os contratos de `marketdata`/`backtest` são puros** (sem I/O). Testáveis com os scripts `scripts/test-*.mts` (padrão que você já usa).
2. **Só `trades/` (repositório) fala com Prisma sobre Trade.** O resto recebe dados por parâmetro. Isso destrava trocar o storage depois.
3. **O agente nunca recebe SQL nem linhas cruas por padrão**: recebe **resultados de tools** (agregados + `evidenceId` + `coverage`).
4. **Tudo que cria dado derivado grava versão** (`toolVersion`, `engineVersion`, `schemaVersion`, `specHash`, `dataHash`).
5. **Feature flags por capacidade** (como `NT8_ENABLED`): `INGEST_V2_ENABLED`, `AGENT_V1_ENABLED`, `STRATEGY_SPEC_ENABLED`… Desligar = comportamento antigo intacto.
6. **Estrangulamento (strangler):** rotas e telas novas convivem com as antigas (`/api/trades/import`, Vega `/api/ask-claude`) até as novas provarem valor.

### A.3 Fluxo ponta a ponta (mapeia seu diagrama)
```
 Fonte (arquivo/print/manual)  ──►  ImportJob  ──►  Fill/Trade (TradeV2)  ──►  MemoryItem (fatos)
                                                          │                          │
 Strategy/Version ──────────────────────────────────────►│                          ▼
                                                          ▼                    Trader Card
                                         metrics (determinístico) ──► Evidence ──► Agent ──► resposta (+ evidências)
                                                          ▲
 Hypothesis ► Experiment ► Result ► Conclusion ───────────┘   (Experiment usa metrics + [futuro] MarketData + BacktestEngine)
```

---

## B. TradeV2

### B.1 Decisão estrutural (opções)
| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| **A) Evoluir `trades` in-place** (colunas novas nulas + tabelas satélite) | 34 consumidores continuam funcionando; migração reversível; links públicos (`shareToken`) e gamificação intactos | colunas legadas convivem por um tempo | **Recomendado** |
| B) Nova tabela `trades_v2` + backfill + trocar leitores | modelo "limpo" | big-bang em dashboard/analytics/share/print/drawdown/gamificação; risco alto | Não |
| C) Event-sourcing (só fills) e `Trade` 100% derivado | máxima rastreabilidade | reescreve tudo; overengineering para o estágio | Não agora; **Fill já nos dá 80% do benefício** |

### B.2 Princípios do modelo
- **Execuções (`Fill`) são fatos brutos imutáveis; `Trade` é derivado** (round-turn reconstruível). Formatos que já trazem round-turn (NT8 Trades, template MeuTrade) entram direto como `Trade` com `Fill` opcional.
- **Tempo em UTC** (Prisma/Postgres: `timestamp` sem tz → sempre UTC) + **fuso da bolsa** guardado no `Instrument`. Dia de pregão e sessão são **derivados por função determinística**, não digitados.
- **Proveniência por campo** quando o valor pode ser incerto (stop, alvo, MFE/MAE, horário): `riskSource`, `mfeSource`, `timePrecision`, `fieldProvenance`.
- **Constrained strings > enums Postgres** para conjuntos que crescem (`source`, `riskSource`, `pnlBasis`…): você já evitou migration de enum no plano (`TRADER` exibido como "Starter") e `db push`/migrate de enum em banco gerenciado é atrito. Usar **string + validação Zod/TS + CHECK**; manter enum Prisma só para conjuntos estáveis (`Direction`, `TradeResult`).
- **Derivado não vira coluna** a menos que seja consultado em filtro quente (ex.: `rMultiple`). Sessão, hora, dia da semana, duração: **funções** em `metrics/`.

### B.3 Catálogo de campos (decisão: coluna / relação / enum / JSON / tabela separada)

**Legenda de destino:** `COL` coluna em `trades` · `REL` relação 1:N · `1:1` tabela satélite · `JSON` coluna JSON · `FN` função derivada (não armazena) · `EXISTE` já existe.

| Campo conceitual | Destino | Tipo / valores | Nulo? | Motivo |
|---|---|---|---|---|
| id, userId | EXISTE | cuid | não | — |
| **account** | EXISTE (`accountId` → `TradingAccount`) | FK | sim | já há separação por conta real (`brokerName`) |
| accountLabel, accountName | EXISTE (legado) | string | — | denormalizados; manter leitura, **deixar de escrever como fonte de verdade** (derivar da conta) |
| **symbol (raiz)** | EXISTE `instrument` | string ("NQ","MNQ") | não | mantém compatibilidade |
| **contractCode** | COL novo | string ("NQZ6") | sim | rolagem/backtest/dedupe; hoje `stripContractExpiry` **descarta** o contrato |
| **instrumentId** | COL novo → `Instrument` | FK | sim | referência única de tick/ponto/fuso/sessão (substitui `POINT_VALUES`) |
| **asset class** | via `Instrument.assetClass` | string-constrained {FUTURES, FOREX, STOCK, OPTION, CRYPTO, CFD} | — | derivado do instrumento, não do trade |
| direction | EXISTE | enum Direction | não | estável |
| **quantity** | EXISTE `quantity` | Decimal | não | **semântica:** contratos no pico da posição; detalhe nos `Fill` |
| entryPrice / exitPrice | EXISTE | Decimal | não | **semântica:** preço médio ponderado |
| **entryAt / exitAt** | COL novo | DateTime UTC | **sim** (legado) | **ausentes hoje**; destrava hora/duração/ordem. `date` legado permanece |
| **timePrecision** | COL novo | string-constrained {DATETIME, DATE_ONLY, EXIT_ONLY, UNKNOWN} | não (default UNKNOWN) | ⚠️ trades antigos têm horário falso (ver O.2); análises por hora devem ignorar `DATE_ONLY` |
| **tradingDay** | COL novo | `DATE` | sim | dia de pregão da bolsa (CME vira 18:00 ET) para regras diárias de mesa e agrupamentos corretos; **derivado em escrita**, recalculável |
| **initialStopPrice** | COL novo | Decimal | sim | base do R |
| **targetPrice** (inicial) | COL novo | Decimal | sim | análise plano×execução, backtest comparável |
| **riskPoints** | COL novo | Decimal | sim | \|entry − stop\| (derivável, mas consultado em filtro) |
| **riskUsd** | COL novo | Decimal | sim | riskPoints × pointValue × quantity (+ opcional comissão) |
| **rMultiple** | COL novo | Decimal | sim | `pnlNet / riskUsd`; **só existe se riskUsd conhecido** (nunca estimado em silêncio) |
| **riskSource** | COL novo | string-constrained {USER_ENTERED, FROM_ORDERS, FROM_PLAN, AI_ESTIMATED, DEFAULT_RULE} | sim | **credibilidade do R**: o agente informa "R disponível em N de M trades" |
| pnl | EXISTE | Decimal | não | ⚠️ base bruto/líquido **desconhecida** hoje |
| **pnlBasis** | COL novo | string-constrained {GROSS, NET, UNKNOWN} | não (default UNKNOWN) | NT8 "Profit" pode vir líquido; Tradovate costuma vir bruto 🟡 |
| pnlPoints | EXISTE | Decimal | não | ⚠️ semântica inconsistente (import = Δpreço×qtd; sync = vem do AddOn). **Canônico novo: pontos por contrato**; manter coluna legada |
| commission | EXISTE | Decimal | não | total do trade |
| **fees** | COL novo | Decimal | não (default 0) | taxas de bolsa/NFA separadas |
| **slippageTicks** | COL novo | Decimal | sim | só calculável com plano/intent ou ordens; fonte registrada em `fieldProvenance` |
| mfe / mae | EXISTE | Decimal | sim | **canônico: pontos por contrato, positivos** (hoje o import converte $→pts; unidade não documentada) |
| **mfeMaeSource** | COL novo | string-constrained {BROKER, COMPUTED_BARS, ESTIMATED} | sim | NT8 entrega; Tradovate não; backtest/bars podem calcular |
| **timeframe** (do gráfico/entrada) | COL novo | string ("5m") | sim | análise por timeframe; vem do usuário/IA |
| **sessionType** | EXISTE | enum AM/PM/OVERNIGHT | não | manter; **sessão rica** (Asia/London/NY open/lunch/close, RTH/ETH) = `FN` a partir de `entryAt` + calendário do `Instrument` |
| **strategyVersionId** | COL novo → `StrategyVersion` | FK | sim | análise por estratégia **e versão** |
| setupId | EXISTE (legado) | FK | sim | convive até migrar Setup→Strategy (seção N) |
| **strategyAttribution** | COL novo | string-constrained {USER_TAGGED, AI_SUGGESTED, AUTO_MATCHED, LEGACY_SETUP} | sim | auditar de onde veio a estratégia |
| **intentId** | COL novo → `TradeIntent` | FK | sim | plano pré-trade × execução |
| **source** | EXISTE (string) | constrained {MANUAL, NINJATRADER, TRADOVATE, RITHMIC, CSV, PDF, IMAGE, MT5…} | não | hoje string livre ("MANUAL" até para CSV) |
| **externalId** | EXISTE | string | sim | `@@unique([userId, externalId])` — **NULL não deduplica** (⚠️ O.3) |
| **dedupeKey** | COL novo | string (hash canônico) | sim | dedupe sem id externo (conta+contrato+tempos+qtd+preços) |
| **importJobId** | COL novo → `ImportJob` | FK | sim | rastreio + **desfazer por job** |
| **dataQuality** | COL novo | string-constrained {COMPLETE, PARTIAL, ESTIMATED} | não | agente avisa "dado parcial" |
| **fieldProvenance** | JSON | `{campo: {source, confidence, confirmedByUser, userEdited}}` | sim | esparso e evolutivo → JSON, não coluna por campo |
| tags | EXISTE (`TradeTag`) | REL 1:N | — | + colunas `category` {SETUP, MISTAKE, EMOTION, CONTEXT} e `source` {USER, AI} (aditivo) |
| notes | EXISTE | string | sim | — |
| aiAnalysis | EXISTE (legado) | string | sim | substituído por `TradeAnalysis` versionada (ver H); manter leitura |
| screenshots | EXISTE (`TradeScreenshot`) | REL 1:N | — | + `kind` {CHART, ENTRY, RESULT, HISTORY} e `extractionId` |
| **market context** | **1:1 `TradeContext`** | tabela satélite | sim | ver B.4 |
| **fills** | **REL `Fill` + `TradeFill`** | tabelas | — | ver B.5 |
| shareToken, shareIncludeAnalysis | EXISTE | — | — | **não tocar** (links públicos em produção) |

### B.4 `TradeContext` (1:1, derivado, versionado — o "feature store" do trader)
Campos tipados para o que já se sabe que a pesquisa usa + `extra JSON` para o que ainda não se sabe:
- `atrDaily`, `atrIntraday(tf)`, `priorDayRange`, `priorDayHigh/Low`, `gapPct`, `dayRangeSoFarPts`, `volatilityRegime` (tercil), `newsEventFlag` + `newsEvent`, `dayOfWeek`, `tradeNumberOfDay`, `minutesSinceOpen`.
- Cada linha: `computedAt`, `source` {MARKET_DATA, CALENDAR, MANUAL}, `datasetVersion`/`dataHash`, `contextVersion`.
- **Por que tabela separada:** é **recalculável** (mudou o dataset ou a definição de ATR ⇒ recomputa), não deve inflar `trades`, e mistura dado de fontes diferentes. **Entra só depois** de existir fonte de mercado; até lá pode ficar vazia.

### B.5 `Fill` (execução) e vínculo
- `Fill`: `id`, `userId`, `accountId`, `importJobId`, `externalId`, `orderId`, `contractCode`, `instrumentId`, `side`, `quantity`, `price`, `filledAt` (UTC), `commission`, `fees`, `raw JSON`, `fillKey` (dedupe).
- `TradeFill`: `tradeId`, `fillId`, `role` {ENTRY, EXIT, SCALE_IN, SCALE_OUT}.
- **Por que agora:** Tradovate (Orders/Fills) e NT8 (Executions) entregam **fills**, não trades. O reconciliador (FIFO por conta+contrato, parciais, scale-in/out, flip de posição 🟡) precisa de onde apoiar e provar a origem.
- `BrokerOrder` (tipo STOP/LIMIT, preço, status, tempos): **opcional, fase posterior** — permite **extrair `initialStopPrice` automaticamente** do histórico de ordens (maior ganho de R sem esforço do usuário).

### B.6 `Instrument` (referência global, não por usuário)
`root`, `assetClass`, `exchange`, `currency`, `tickSize`, `tickValue` (ou `pointValue`), `exchangeTz`, `sessionCalendarId`, `defaultCommissionRT?`, `micro_of` (MNQ→NQ), `active`. Seed a partir de `POINT_VALUES` (🟢 NQ 20, MNQ 2, ES 50, MES 5, YM 5, RTY 50, CL 1000, GC 100, SI 5000, ZB 1000, 6E 125000) **e conferido com especificações oficiais**. ⚠️ Hoje `pointValueFor` **devolve 20 (NQ) para instrumento desconhecido** em silêncio — no novo modelo, desconhecido = erro de validação.

### B.7 Índices (para as perguntas do Research Agent)
`(userId, entryAt)`, `(userId, strategyVersionId, entryAt)`, `(userId, instrumentId, entryAt)`, `(accountId, tradingDay)`, `(userId, dedupeKey)` único parcial (onde não nulo), `(importJobId)`.

### B.8 Definições canônicas (evitam divergência entre telas)
- **R-multiple** = `pnlNet / riskUsd`, onde `pnlNet = pnl − (pnlBasis=GROSS ? commission+fees : 0)`. Sem `riskUsd` ⇒ R = null (**nunca** estimar silenciosamente).
- **Expectancy (R)** = média de R **somente dos trades com R**, **sempre acompanhada de `n` e `coverage`** (n_com_R / n_total).
- **MFE/MAE** em pontos por contrato, valores positivos; direção interpretada pela `direction`.
- **Sessão/horário** sempre calculados em **fuso explícito** (ET para pregão CME; BRT só para exibição). ⚠️ O código atual agrupa por **hora BRT** (`hourBR`) — manter na UI, mas a pesquisa usa ET.

---

## C. Strategy

### C.1 Modelo
```
Strategy                         (o "conceito": ex. "ORB 15 min")
  id, userId, name, description, status {ACTIVE, ARCHIVED}
  defaultInstruments[], tags[]
  legacySetupId?                 (vínculo com Setup antigo — migração lazy)
  currentVersionId?              (ponteiro p/ versão "em uso"/aprovada)
  createdAt, updatedAt
```
- **Strategy ≠ Setup:** `Setup` é nome+texto livre. `Strategy` é entidade com versões objetivas. Setup continua existindo; um Setup vira Strategy **sob demanda** (ao ser usado numa pesquisa/versão), sem migração em massa.
- **Playbook** = conjunto de `Strategy` com versão `APPROVED` + regras pessoais (Memory `PERSONAL_RULE`) + exceções. Não precisa de tabela própria no V1: é uma **consulta** (`status=APPROVED`) + memória.

### C.2 Ciclo de vida de status (por versão, ver D)
`DRAFT → TESTING → APPROVED | DISCARDED → ARCHIVED`. **Transições registradas** (quem, quando, por quê, evidência que sustentou). `APPROVED` exige ≥ 1 `Conclusion` com evidência **ou** confirmação explícita do usuário ("aprovo por conta própria", registrado como tal).

---

## D. StrategyVersion

### D.1 Modelo
```
StrategyVersion
  id, strategyId, versionNumber (1,2,3…), status {DRAFT, TESTING, APPROVED, DISCARDED, ARCHIVED}
  spec            JSON      (validada por schema versionado)
  specSchemaVersion string  ("meutrade.strategy/1")
  specHash        string    (hash do JSON canônico)
  humanSummary    text      (pt-BR, renderizado por TEMPLATE a partir da spec — não por LLM)
  completeness    {DRAFT_INCOMPLETE, TESTABLE}  (computado pelo validador)
  assumptions     JSON      (ambiguidades resolvidas: cada uma com confirmedByUser)
  changeNote, parentVersionId, createdBy {USER, AI_PROPOSED, IMPORT, MIGRATION}, confirmedAt
```
**Imutabilidade:** versão `TESTING/APPROVED` não muda; qualquer alteração de spec cria **nova versão**. **Parâmetros** variam em **experimentos** (varredura "stop 10/15/20/25" = 1 versão, N configurações); **promover** um valor vira nova versão com o default alterado.

### D.2 Pesquisa de referência (formatos existentes) — o que aproveitar
- Projetos open source de DSL de estratégia (🟡): condições comparando **operandos** (campo de preço com *bars-ago*, indicador com parâmetros/saída/fonte, constante, aritmética, campo de posição em regras de saída); regras `longEntry/longExit` + bloco `risk`; stops (percentual, ATR, expressão) e alvos (percentual, ATR, **múltiplo de risco**) como bracket; operadores `range/trend/change/isTrue`, **regras temporais** (`withinBars`, `trueForBars`), **máx. de barras, cooldown, pyramiding, sizing (risco %, contratos fixos)** e **filtros de sessão/dia/data**.
- Um engine determinístico open source declara a separação que adotamos: *"DSL gera sinais; risk engine valida; **LLM/RAG fica fora do caminho de decisão**"* (🟡).
- TradingView/Pine trata estratégia como código imperativo — **não serve** para nós (queremos dado, validável e sem execução arbitrária).
- **Decisão de design (nossa):** JSON declarativo com **vocabulário fechado** de primitivas versionadas + **seção de ambiguidades** + **checklist discricionário** (regras que o trader usa mas o engine não consegue testar).

### D.3 Estrutura da `spec` (schema `meutrade.strategy/1`)
```
{
  "schema": "meutrade.strategy/1",
  "meta":   { "name", "description", "tags": [] },

  "market": {
    "instruments": ["MNQ"],            // raízes; engine resolve contrato/rolagem
    "executionTimeframe": "1m",        // granularidade da simulação/entrada
    "signalTimeframe": "5m",           // opcional
    "calendar": "CME_EQUITY_INDEX",    // sessão/feriados vêm do Instrument
    "tz": "America/New_York"
  },

  "params": {                           // tudo que pode variar em experimento
    "or_minutes": { "type": "int", "default": 15, "space": [5,10,15,20,30] },
    "stop_points": { "type": "number", "default": 20, "space": [10,15,20,25] },
    "target_r":    { "type": "number", "default": 2,  "space": [1,1.5,2] }
  },

  "time": {
    "tradeWindows": [ { "from": "09:45", "to": "11:30" } ],
    "daysOfWeek": [1,2,3,4,5],
    "excludeDates": [],                 // ex.: dias de FOMC, se o usuário quiser
    "flatBy": "15:55",
    "maxTradesPerDay": 1,
    "cooldownBars": 0
  },

  "context": [                          // níveis/séries NOMEADAS (primitivas do catálogo)
    { "id": "orh", "use": "opening_range", "args": { "from": "09:30", "minutes": "$or_minutes", "output": "high" } },
    { "id": "orl", "use": "opening_range", "args": { "from": "09:30", "minutes": "$or_minutes", "output": "low"  } },
    { "id": "atr14", "use": "atr", "args": { "period": 14, "timeframe": "1d" } }
  ],

  "filters": [                          // vetos opcionais
    { "id": "vol_ok", "all": [ { "gt": [ {"ref":"atr14"}, 0 ] } ] }
  ],

  "entries": [
    { "id": "long_break",  "side": "LONG",
      "when": { "all": [ { "crosses_above": [ {"price":"close"}, {"ref":"orh"} ] } ] },
      "order": { "type": "MARKET" } },
    { "id": "short_break", "side": "SHORT",
      "when": { "all": [ { "crosses_below": [ {"price":"close"}, {"ref":"orl"} ] } ] },
      "order": { "type": "MARKET" } }
  ],

  "stop":   { "type": "fixed_points", "value": "$stop_points" },
  "targets":[ { "type": "r_multiple", "value": "$target_r", "qtyPct": 100 } ],
  "management": [],                     // ex.: {type:"breakeven", triggerR:1}, {type:"trail", points:10}, {type:"time_stop", bars:60}

  "sizing": { "type": "fixed_contracts", "value": 1 },   // ou risk_usd / risk_pct

  "discretionary": {                    // regras reais do trader que NÃO são testáveis pelo engine
    "checklist": [ { "id": "no_news", "text": "Sem notícia de alto impacto nos próximos 15 min", "kind": "manual" } ]
  },

  "assumptions": [                      // ambiguidades resolvidas — rastreáveis
    { "id": "a1", "question": "Máxima do range usa pavios (high) ou fechamentos?", "answer": "usa high/low", "confirmedByUser": true }
  ]
}
```

**Vocabulário (primitivas v1 — fechado e versionado):** `opening_range`, `prior_day_levels` (H/L/C), `session_vwap`, `ema`/`sma`, `atr`, `swing_high/low`, `gap`, `time_of_day`, `pullback` (definição **explícita**: retração % de uma perna/impulso), `day_of_week`, `bars_since`. **Operadores:** `gt/gte/lt/lte/eq`, `between`, `crosses_above/below`, `all/any/not`, `within_bars`, `true_for_bars`. **Operandos:** `price(field, barsAgo)`, `ref(id)`, `const`, `param`, aritmética simples.
Se a ideia exigir algo fora do vocabulário ⇒ o agente **diz que não é expressável ainda** (e registra como pedido de nova primitiva), **não improvisa**.

### D.4 Validação em dois níveis
1. **Schema válido** (estrutura/tipos) ⇒ pode salvar como `DRAFT_INCOMPLETE`.
2. **Testável** (`TESTABLE`) ⇒ todos os campos obrigatórios resolvidos (instrumento, janela, gatilho, stop, alvo ou saída, tamanho), **sem `assumptions` pendentes**, parâmetros dentro do espaço, e todas as primitivas suportadas pelo engine (`capabilities()`).
O **checklist de ambiguidade** que o agente percorre é derivado automaticamente dos campos faltantes.

### D.5 Exemplo de tradução
> "Quero testar rompimento da máxima dos primeiros 15 minutos"

O agente **não roda nada**; produz spec parcial + perguntas **geradas pelo validador**:
1. Instrumento(s)? (MNQ/NQ…) 2. "Primeiros 15 min" a partir de 09:30 ET (abertura RTH)? 3. Rompimento = **toque** na máxima (ordem stop) ou **fechamento** acima? 4. Só compra ou também vende na mínima? 5. Janela para operar (até que horas)? 6. Stop (fixo em pontos? lado oposto do range?) 7. Alvo (múltiplo de R? pontos?) 8. Quantos trades por dia? 9. Fechar posição até quando? 10. Há filtro (volatilidade, notícia)?
Resposta do agente após respostas: **"Entendi assim: …" (renderizado pelo template de `humanSummary`)** e só então marca `TESTABLE`.

### D.6 Link com o resto
`Trade.strategyVersionId`; `RuleCheck` usa os `id` das regras (`entries[].id`, `discretionary.checklist[].id`) para **aderência**; `Experiment.strategyVersionId` + `specHash`; `Hypothesis` referencia a estratégia.
**`RuleCheck`** (trade × regra): `ruleId`, `result` {FOLLOWED, VIOLATED, NA, UNKNOWN}, `evaluator` {USER, AI, AUTO}, `evidence`. Base de "você ganhou violando 2 regras".

---

## E. Memory

### E.1 Princípio
**Estruturas diferentes para coisas diferentes**; um **índice único** para busca. Memória **nunca** é "histórico de chat reenviado".

| Categoria (suas 7) | Onde mora | Por quê |
|---|---|---|
| **Fatos** ("Opera MNQ") | `MemoryItem` kind=FACT | frase curta + estrutura opcional |
| **Preferências** ("prefere 10:30–12:00") | `MemoryItem` kind=PREFERENCE | idem; pode influenciar sugestões |
| **Regras pessoais** ("não operar depois das 12h") | `MemoryItem` kind=PERSONAL_RULE **+ `structured`** | **máquina-verificável** (alimenta RuleCheck/pre-trade) |
| **Estratégias** | tabelas `Strategy/StrategyVersion` | estrutura rica já definida |
| **Hipóteses** | tabela `Hypothesis` | ciclo de vida próprio |
| **Experimentos** | tabelas `Experiment/Result` | dados volumosos, reprodutíveis |
| **Conclusões** | tabela `Conclusion` | exigem evidência |

### E.2 `MemoryItem`
`id`, `userId`, `kind` {FACT, PREFERENCE, PERSONAL_RULE}, `subject` (instrument, schedule, risk, psychology, account, platform…), `statement` (pt-BR), `structured JSON` (ex.: `{"type":"time_window","allowedTo":"12:00","tz":"America/Sao_Paulo"}`), `status` {PROPOSED, ACTIVE, SUPERSEDED, REJECTED}, `source` {USER_STATED, USER_CONFIRMED_PROPOSAL, IMPORT_DERIVED, AGENT_INFERRED}, `confidence`, `evidenceId?`, `validFrom`, `validTo`, `supersedesId`, `reviewAfter?`.
**Regras:** `AGENT_INFERRED` **só nasce `PROPOSED`** e só vira `ACTIVE` por confirmação do usuário; contradição ⇒ pergunta (nunca sobrescreve); `IMPORT_DERIVED` (ex.: "opera MNQ — 87% dos trades") carrega `evidenceId`.

### E.3 Como o agente recupera **sem mandar histórico ao LLM**
1. **Trader Card** (snapshot determinístico, ~500–800 tokens): perfil (facts/preferences ACTIVE), regras pessoais ACTIVE, estratégias `APPROVED` (resumos), mesas/contas, "pesquisas em andamento". Renderizado por template, **cacheado** no prefixo do prompt; recalculado quando algo muda (`TraderCardSnapshot`: `version`, `hash`, `renderedText`).
2. **`search_memory`** (tool): filtros estruturados (kind/subject/tags/período) primeiro; **busca semântica (pgvector) só para texto livre** (conclusões, notas).
3. **`MemoryDocument`** (índice unificado): `userId`, `refType` {MEMORY_ITEM, STRATEGY, HYPOTHESIS, CONCLUSION}, `refId`, `text`, `tags[]`, `embedding?`, `updatedAt` — evita consultar 5 tabelas e permite um único `search_memory`.
4. **"Já testamos isso?"** = `check_prior_research`: (a) igualdade de `specHash` + filtros; (b) similaridade semântica da hipótese; retorna fichas com links.
5. **Conversas:** `ConversationSummary` serve de contexto auxiliar, **nunca é fonte de verdade**; o que importa vira `MemoryItem` confirmado.

### E.4 Ciclo de vida e governança
`reviewAfter` para fatos sujeitos a mudança (tamanho de conta, horário preferido); histórico preservado via `supersedesId`; **exportável/apagável** (cascade LGPD já existente); **visível/editável** na "Ficha do trader".

---

## F. Hypothesis

```
Hypothesis
  id, userId, strategyId?, seriesId (ExperimentSeries)
  statement       (texto original do usuário)
  normalized JSON {metric, condition, comparator, scope}   (ex.: expectancy_r(ORB | ATR>média) > expectancy_r(ORB | ATR≤média))
  status {PROPOSED, SPEC_READY, TESTING, SUPPORTED, REFUTED, INCONCLUSIVE, ABANDONED}
  createdBy {USER, AGENT}, parentHypothesisId?, createdAt, updatedAt
```
- **`ExperimentSeries`** agrupa variações da **mesma família** de hipótese; guarda **quantas configurações já foram testadas** ⇒ base da **penalidade de múltiplos testes** (aviso quando o "melhor" resultado sai de muitas tentativas).
- **Origem:** do usuário **ou** de `scan_patterns` (detector determinístico; o LLM só **escolhe e formula** a hipótese a partir de padrões listados pela tool).
- Transições são eventos auditáveis (`HypothesisEvent`: de→para, motivo, `evidenceId`).

---

## G. Experiment

### G.1 Modelo
```
Experiment
  id, hypothesisId, type {SLICE_OWN_TRADES, BACKTEST, WALK_FORWARD, MONTE_CARLO, COMPARE}
  strategyVersionId?, specHash?
  dataRef JSON   { kind: OWN_TRADES | DATASET, tradeFilter?/filterHash?, datasetId?, datasetVersion?, dataHash?, asOf }
  config  JSON   { costModel?, executionModel?, split {IS/OOS/WF}, paramGrid?, seed, metrics[] }
  status {QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED, INVALID_DATA}
  engine {name, version}  | tool {name, version}
  requestedBy, creditsUsed, startedAt, finishedAt, error?

ExperimentResult
  experimentId, kind {SUMMARY, BY_PARAM, BY_PERIOD, BY_SLICE, EQUITY, TRADE_LIST, DISTRIBUTION}
  n (amostra), metrics JSON (schema versionado), artifactKey? (arquivo grande em object storage), hash

RobustnessCheck
  experimentId, checkType {OOS, WALK_FORWARD, PARAM_SENSITIVITY, TOP_N_REMOVED, MONTE_CARLO, COST_STRESS, REGIME_SPLIT, MIN_SAMPLE}
  outcome {PASS, WARN, FAIL}, details JSON, evidenceId
```
### G.2 Tipos por estágio
- **`SLICE_OWN_TRADES` (V1.5, sem dado de mercado):** responde sobre os **trades reais** (horário, estratégia/versão, volatilidade quando houver contexto). Roda **dentro do Next**, usando `metrics/`.
- **`BACKTEST/WALK_FORWARD/MONTE_CARLO`:** exigem `BacktestEngine` + `MarketDataProvider` (seções L/M); só entram depois.
### G.3 Reprodutibilidade
`reproduce(experimentId)` re-executa com `specHash`+`dataRef`+`config`+`seed`+`engine.version` e **compara o `hash` do resultado**; divergência ⇒ marca `DRIFT` e explica (ex.: trades editados depois de `asOf`).

### G.4 Fluxo completo e rastreabilidade (seu diagrama)
```
IDEIA ─► HIPÓTESE ─► REGRAS (StrategyVersion TESTABLE) ─► DADOS (dataRef) ─► EXPERIMENTO ─► RESULTADOS ─► ROBUSTEZ ─► CONCLUSÃO ─► MEMÓRIA
 texto     Hypothesis      specHash                      OWN_TRADES|DATASET    Experiment    Result+Evidence  RobustnessCheck  Conclusion(+evidenceIds ≥1)  MemoryDocument
```
**Conclusion:** `hypothesisId`, `verdict` {SUPPORTED, REFUTED, INCONCLUSIVE, INSUFFICIENT_DATA}, `statement` (pt-BR), `scope` (condições em que vale), `caveats[]`, `evidenceIds[]` (**mínimo 1, validado no serviço**), `supersedesId`, `createdBy`, `userConfirmedAt?`. **Rubrica de veredito versionada** (ex.: SUPPORTED exige n mínimo, IC que exclui zero **e** robustez sem FAIL) — assim a mesma evidência produz o mesmo veredito.
**Regra de ouro:** o agente **não consegue** salvar conclusão sem evidência; e ao falar uma conclusão, ele **cita** `Conclusion → Evidence → Experiment → (specHash + dataRef)`.

---

## H. Evidence

### H.1 O que é
Registro **imutável** que liga **cada número exibido** à sua origem determinística.

```
Evidence
  id (ULID), userId, kind {METRIC, TRADE_SET, EXPERIMENT_RESULT, IMPORT_FACT, MEMORY_ITEM, MARKET_FACT}
  metricKey        ("expectancy_r")             metricVersion ("1")
  value (Json/Decimal), unit ("R"), n (amostra), ci {low, high, level}?   coverage {n_total, n_used}
  calculation      { tool, toolVersion, formulaId, params }
  inputs           { sourceType: TRADE_QUERY|EXPERIMENT|IMPORT_JOB|MEMORY,
                     sourceId?, filters JSON, filterHash, period {from,to,tz},
                     tradeSetHash, tradeIds? (≤ N, comprimido), asOf, dataVersion }
  runId (AgentRun), computedAt, expiresAt?
```
### H.2 Exemplo — "Seu expectancy foi +0,31R"
`kind=METRIC · metricKey=expectancy_r · value=0.31 · unit=R · n=143 · coverage {143 de 160} · calculation {tool: calculate_metrics@1, formula: mean(R)} · inputs {TRADE_QUERY, filters {strategyVersionId: X, instrument: MNQ}, period 2026-06-01..2026-09-30 ET, tradeSetHash …, asOf …}`.

### H.3 Auditar depois (trades mudam)
- Guardar **filtros + `asOf` + `tradeSetHash`** (+ lista de ids quando ≤ N). Reauditoria = reexecutar a tool com os mesmos filtros e `asOf` e comparar o hash; se algum trade foi editado depois (`updatedAt > asOf`) ⇒ **"drift"** com o motivo.
- Evidências de **experimento** apontam para `experimentId` + `resultHash`.

### H.4 Protocolo de citação
1. Toda tool retorna `{ data, evidence[], coverage, warnings[] }`.
2. A resposta final do agente é **estruturada**: trechos de texto + `evidenceRefs[]`.
3. **Verificador numérico** (pós-LLM): extrai números do texto e confere com `evidence.value` (tolerância de arredondamento); número sem evidência ⇒ **regenera ou remove o trecho**.
4. UI: cada número vira "chip" com **"Por quê?"** → cálculo, filtros, período, `n`, lista de trades, link para o Journal filtrado.
5. **Retenção:** evidência vive enquanto a mensagem/pesquisa existir (cascade na exclusão da conta).

---

## I. Ingestion Architecture

### I.1 Viabilidade das plataformas prioritárias (pesquisa de 01/10/2026)

> **Contexto novo:** você usa **Tradovate**. Para conta de **prop/avaliação**, a API é inacessível (abaixo) ⇒ **arquivo é o caminho**.

| | **NinjaTrader 8** | **Rithmic** | **Tradovate** | **TopstepX/ProjectX** |
|---|---|---|---|---|
| API oficial p/ terceiros | **Não há API cloud**; integração = **NinjaScript AddOn local** (você já tem `TraderOSSync.cs`) 🟢 | R\|API+ (C++/.NET), **R\|Protocol (WebSocket+protobuf)**, R\|Diamond 🟡 | **REST/WebSocket** 🟡 | **Gateway API** (REST) 🟡 |
| Acesso/auth | usuário instala o AddOn; **API key MeuTrade** (já existe) | usuário/senha + host (Rithmic) ou credencial de API; **vendor precisa passar em *conformance*** p/ produção 🟡 | **conta live ≥ US$ 1.000 + US$ 25/mês**; **credenciais OAuth só p/ parceiros aprovados do NinjaTrader Ecosystem** (revisão formal) 🟡 | assinatura da API **US$ 29/mês**; exclusiva Topstep desde 28/02/2026 🟡 |
| Contas de **prop/avaliação** | depende da corretora/feed; o AddOn lê o que o NT8 vê | Rithmic é a rota de **72 prop firms** 🟡; **acesso de API a conta de prop não confirmado** (INCERTO) | **excluídas da API** ("prop e avaliação não qualificam") 🟡 (fórum + vendors; não achei declaração oficial) | automação **proibida na conta Live** 🟡 |
| Custo | grátis p/ usuário; **listagem no Ecosystem** exige ser vendor (serviço de licença gratuito p/ vendors qualificados 🟢) | **~US$ 100/mês de API + US$ 25 de User ID** 🟡 | US$ 25/mês (se elegível) | US$ 29/mês |
| Como os concorrentes fazem | **AddOn/arquivo** (TradesViz, SCS, TradeJournal) 🟡 | TradeZella: **só arquivo** 🟡; TradesViz: **login do usuário a cada sync (não guarda senha)** ou **CSV periódico do R\|Trader → Google Drive** 🟢 | TradeZella: **pop-up com usuário/senha (2FA)**, sync a cada 3 h 🟡 | — |
| Riscos | usuário precisa deixar o NT8 aberto; **distribuição**: não distribuir `.cs` fonte se for comercial 🟢 | custo, conformance, ToS | **ToS/segurança de pedir senha**; prop excluída | só Topstep |
| **Exportação (arquivo)** | **Trade Performance → Trades/Executions → Export CSV/Excel** 🟢; Executions: *Instrument, Action, Quantity, Price, Time, ID, E/X, Position, Order ID, Name, Commission, Rate, Account, Connection* 🟡; **MAE/MFE/ETD/Bars** no display Trades 🟢 | **R\|Trader Pro: salvar execuções automaticamente em CSV/Excel** 🟡 | **Reports → Orders (CSV)**: *orderId, Account, B/S, Contract, Product, avgPrice, filledQty, Fill Time, Status, Timestamp…* 🟡; **Fills** (com comissão) 🟡; **Performance** não serve para vários importadores 🟡 | — |
| Armadilhas | formato de data/idioma do export (PT-BR vs EN) 🟡 | — | **Orders exige FIFO** (fills por ordem), **fuso = fuso da conta**, **comissão pode vir vazia** no Orders 🟡, flips de posição | — |
| **Viabilidade de conector** | **Média** (já temos AddOn; falta decidir distribuição/licença) | **Baixa-Média** (custo + conformance) | **Baixa p/ prop**; **média** só p/ conta live própria | **Baixa** (só se você/usuários forem Topstep) |

**Conclusões:** (1) **Nenhum conector entra agora.** (2) Ordem dos **parsers de arquivo**: **Tradovate Orders/Fills → NT8 Trades/Executions (EN+PT-BR) → Rithmic R|Trader CSV**. (3) Conectores só depois, por demanda real: NT8 AddOn (reativar, já existe) é o mais barato. (4) **Perguntas para você** (seção final): qual prop firm/tipo de conta no Tradovate, e envie exports reais (anonimizados) para virarem *fixtures*.

⚠️ **O parser atual de Tradovate (`parseTradovate`, 🟢) espera colunas de "Closed Positions" (`open_date`, `close_date`, `pl_…`) — não as de Orders/Fills.** Provável que **não leia um export real** do Tradovate. Validar com um arquivo seu.

### I.2 Pipeline único
```
 Fonte ──► ImportJob ──► [Parser] ──► [Normalizer] ──► [Reconciler] ──► [Validator] ──► [Dedupe/Conflict] ──► PREVIEW ──► COMMIT ──► Trade/Fill (TradeV2) + Evidence/Source
 CSV/Excel/PDF/Imagem/Manual/(NT8/Rithmic/Tradovate conector no futuro)                                             (usuário revisa)
```
Todos os formatos **convergem em 2 formas canônicas**: `CanonicalFill` (execuções) ou `CanonicalTrade` (round-turn já pronto). O **Reconciler** só roda sobre fills.

### I.3 Entidades
- **`ImportSource`**: `type` {FILE_CSV, FILE_XLSX, FILE_PDF, IMAGE, MANUAL, CONNECTOR}, `platformHint` {TRADOVATE, NINJATRADER, RITHMIC, …}, metadados do arquivo (nome, tamanho, `fileHash`, `rawStorageKey` no object storage).
- **`ImportJob`**: `userId`, `sourceId`, `status` {UPLOADED → PARSING → NORMALIZING → RECONCILING → VALIDATING → PREVIEW_READY → AWAITING_USER → COMMITTING → COMMITTED | FAILED | CANCELLED}, `parserId`+`parserVersion`, `mappingProfileId?`, `accountDecision`, `timezoneDecision`, contagens (lidas/novas/duplicadas/conflitos/erros), `errorSummary`, `createdAt/committedAt`. **Idempotência:** `fileHash`+conta ⇒ reutiliza job.
- **`ImportStagedRow`**: `jobId`, `rowNo`, `raw JSON`, `normalized JSON`, `status` {OK, WARNING, ERROR, DUPLICATE, CONFLICT, EXCLUDED}, `issues[]` (código + campo + sugestão), `resolution`. **É o que alimenta o preview e as correções** (nada vai ao `trades` antes do commit).
- **`MappingProfile`**: `scope` {GLOBAL, USER}, `platform`, `headerSignature` (hash), `mapping JSON`, `timezone?`, `confirmedBy`, `version`. **1ª vez de um formato novo**: LLM propõe mapeamento a partir de ~20 linhas ⇒ usuário confirma **uma vez** ⇒ vira perfil determinístico (**custo de IA ~0 daí em diante**).

### I.4 Contratos (conceituais)
```
Parser         canParse(input) -> { confidence 0..1, platform?, reasons[] }
               parse(input, ctx) -> RawRecords[]                      // sem interpretar semântica
Normalizer     normalize(RawRecords, ctx{tz, accountHints, instrumentCatalog}) -> CanonicalFill[] | CanonicalTrade[] + issues[]
Reconciler     reconcile(CanonicalFill[], policy{FIFO|LIFO, flipHandling}) -> CanonicalTrade[] (+ TradeFill links) + issues[]
Validator      validate(CanonicalTrade, rules) -> issues[]           // regras: P&L recomputado ≈ informado; preço ∈ [mín,máx] do contrato; horário ordenado; instrumento conhecido; qty > 0 …
Dedupe         match(CanonicalTrade, existing) -> {NEW | DUPLICATE | CONFLICT(with diff)}
```
**Registro de parsers** (`ParserDescriptor {id, version, formats, detect, parse, fixtures}`): **adicionar formato = novo módulo + entrada no registro + fixtures**; **zero mudança no núcleo**.

### I.5 Deduplicação (3 níveis)
1. **Exato:** `externalId` (+ `source`+`accountId`) ou `fillKey` (orderId/fillId).
2. **Canônico:** `dedupeKey = hash(account, contract, entryAt, exitAt, qty, entryPrice, exitPrice, side)` com tolerância de arredondamento.
3. **Heurístico:** **anti-espelho** (já existe no sync NT8, 🟢: mesmo |pnl|, preços trocados, direção oposta, janela de 12 h) + janela de tempo ± N s para fills parciais.
⚠️ Hoje **a importação por CSV não deduplica nada** (O.3).

### I.6 Resolução de conflito (match com trade existente)
Política **padrão = enriquecer, nunca sobrescrever**: preenche campos **nulos** (ex.: stop, MFE, entryAt) e registra `fieldProvenance`; **campos editados pelo usuário** (`userEdited=true`) **nunca** são alterados. Opções por job: `SKIP`, `ENRICH` (padrão), `REPLACE` (explícito, com confirmação).

### I.7 Preview e erros
- **Preview:** resumo (N lidas · novas · duplicadas · conflitos · erros), **mapa de contas** (`APEX-…` → conta MeuTrade), fuso confirmado, amostra de trades, **itens duvidosos em destaque** ("6 precisam de você"), diff dos conflitos, **qualidade dos campos** (quantos têm stop/horário), botão **Confirmar** e **Cancelar**.
- **Erros:** códigos estáveis (`E_PARSE_HEADER`, `E_TZ_AMBIGUOUS`, `E_INSTRUMENT_UNKNOWN`, `W_COMMISSION_MISSING`, `W_PNL_MISMATCH`…) com **linha, coluna, mensagem e sugestão**; **CSV de erros** baixável.
- **Desfazer importação** (`importJobId` em Trade/Fill): reverte o job inteiro (soft-delete + log). **Obrigatório** antes de liberar para outros usuários.
- Efeitos colaterais **preservados**: XP/streak/conquistas (hoje o import faz em lote) e **limite mensal do plano** (hoje o import **não aplica**, ⚠️).

### I.8 Fontes → como entram
| Fonte | Parser | Notas |
|---|---|---|
| CSV (Tradovate Orders/Fills, NT8, Rithmic, template) | determinístico por assinatura; fallback LLM-mapper | fixtures reais |
| Excel | leitura de planilha ⇒ mesmo pipeline do CSV | — |
| PDF | texto embutido → tabelas; escaneado → visão | confiança por campo |
| Screenshot | visão (extração) ⇒ `ImportStagedRow` com `confidence` | **nunca grava direto**; confirmação obrigatória; encaixe na barra quando houver dados |
| Manual | formulário/linguagem natural ⇒ rascunho | — |
| Conectores (futuro) | adaptadores que alimentam o **mesmo** pipeline | NT8 AddOn primeiro |

---

## J. Agent V1

### J.1 Escopo
**Somente-leitura sobre os dados do trader** (não cria/edita/apaga trades). Pode **escrever apenas em estruturas próprias** e sempre rastreáveis: rascunhos de memória (`PROPOSED`), hipóteses, resultados de experimento e conclusões (com evidência). **Não** roda backtest, **não** extrai de imagem (isso é ingestão), **não** envia ordens.

### J.2 O que o V1 faz (mapa → tools)
| Capacidade pedida | Tool(s) |
|---|---|
| consultar trades | `query_trades`, `get_trade` |
| estratégias | `list_strategies`, `get_strategy_version` |
| métricas | `calculate_metrics`, `distribution`, `data_quality_report` |
| memória | `get_trader_card`, `search_memory`, `propose_memory_item` |
| análises determinísticas | `calculate_metrics(groupBy)`, `compare_groups`, `rule_adherence` |
| gerar hipóteses | `scan_patterns` (**detector determinístico**) + LLM formula |
| comparar períodos | `compare_periods` |
| identificar padrões | `scan_patterns` (+ sequências comportamentais já existentes) |
| registrar pesquisas | `create_hypothesis`, `check_prior_research`, `log_experiment` (slice) |
| salvar conclusões | `save_conclusion` (**exige `evidenceIds`**) |

### J.3 Orquestrador
`pergunta → monta prefixo (instruções + protocolo de evidência + Trader Card, cacheado) → modelo decide tools → executa tools (escopo por userId da sessão) → resultados estruturados → modelo interpreta → resposta estruturada com evidenceRefs → verificador numérico → entrega`.
- **Orçamentos:** máx. de chamadas de tool por turno, tokens, tempo; falha de tool ⇒ **o agente diz que falhou**.
- **Roteador de modelo** (preços oficiais 🟢): Haiku 4.5 (US$ 1/5) p/ classificar/extrair; Sonnet 5.5 (US$ 2/10) padrão; Opus 5.5 (US$ 4/20) p/ planejar pesquisa/interpretar robustez (planos pagos); Batch p/ resumos semanais.
- **Persistência:** `Conversation`, `Message` (conteúdo estruturado + `evidenceRefs`), `AgentRun` (modelo, tokens, custo, tools, versão do prompt). Alimenta custos/créditos e auditoria.
- **Convivência:** a **Vega atual** (`/api/ask-claude`, Haiku, contexto despejado) **continua**; Agent V1 entra em **rota/flag separados** (`AGENT_V1_ENABLED`), inicialmente só para você. Reaproveita `rate-limit` (Upstash), `plan-guard` e `excludeArchivedTrades`.
- **Comportamentos obrigatórios:** dados insuficientes (n < limiar) ⇒ avisa + IC; **R indisponível** ⇒ "R em 41 de 160 trades; mostrando pontos"; ambiguidade ⇒ pergunta; sem trades ⇒ caminho de onboarding/importação.
- **Segurança:** conteúdo de arquivos/prints/notas é **dado, não instrução**; tools validam argumentos (Zod) e **nunca** recebem `userId` do modelo.
- **Avaliação:** *golden set* com **seus trades reais** + perguntas de resposta conhecida; roda a cada mudança de prompt/modelo/tool (padrão `scripts/test-*.mts`).

---

## K. Tool Architecture

### K.1 Contrato de tool
```
Tool { name, version, description(pt), input (schema), output (schema),
       tier {READ | COMPUTE | WRITE_OWN},  cost {FREE | CREDITS},
       idempotent, timeoutMs, rateLimit }
ToolResult { data, evidence[], coverage {n_total, n_used, notes}, warnings[], toolVersion }
```
`userId`, `accountScope` e `asOf` vêm do **contexto de execução** (sessão), não dos argumentos. **Toda** tool COMPUTE registra `Evidence`.

### K.2 Catálogo V1
| Tool | Entrada (resumo) | Saída / observações |
|---|---|---|
| `get_trader_card` | — | texto + `version/hash` |
| `search_memory` | `query?, kind?, subject?, tags?, period?` | itens + score |
| `propose_memory_item` | `kind, subject, statement, structured?, evidenceId?` | cria `PROPOSED` (usuário confirma) |
| `list_strategies` / `get_strategy_version` | filtros | resumos / spec + `humanSummary` |
| `query_trades` | filtros (período, conta, instrumento, estratégia/versão, direção, sessão, resultado, tags) + `fields` + `limit≤200` | trades compactos + `tradeSetHash` |
| `get_trade` | `tradeId` | trade + fills + screenshots (metadados) + contexto |
| `calculate_metrics` | `filters, metrics[], groupBy?, basis{NET|GROSS}` | métricas **do catálogo** + `n` + `coverage` + evidências |
| `compare_groups` | `A, B, metric` | diferença + **IC/teste de permutação** + `n` |
| `compare_periods` | `periodA, periodB, filters, metrics` | idem |
| `distribution` | `metric, bins?` | histograma/quantis |
| `scan_patterns` | `dimensions[], minN, correction` | **fatias notáveis** com p-valor ajustado (múltiplos testes) + aviso de exploração |
| `rule_adherence` | `strategyVersionId, filters` | % seguida/violada × resultado (**exige `RuleCheck`**) |
| `data_quality_report` | `filters` | cobertura de campos (stop, R, horário, MFE/MAE) |
| `get_account_rules` | `accountId` | regras de mesa/drawdown (já existem) |
| `check_prior_research` | `query \| specHash` | fichas anteriores |
| `create_hypothesis` / `log_experiment` | … | registro (tier WRITE_OWN) |
| `save_conclusion` | `hypothesisId, verdict, statement, scope, caveats, evidenceIds[≥1]` | **rejeita sem evidência** |
**Fora do V1:** `run_backtest`, `extract_from_image`, qualquer escrita em `trades`, `get_market_bars`.

### K.3 Catálogo de métricas (definições fixas = determinismo)
Cada métrica tem `id`, **fórmula**, **entradas exigidas**, **n mínimo**, **unidade**, **versão**: `n_trades`, `win_rate`, `avg_win`, `avg_loss`, `payoff`, `profit_factor` (Σganhos/|Σperdas|), `expectancy_usd` (média de P&L líquido), **`expectancy_r`** (média de R; só trades com R), `median_r`, `max_drawdown` (sobre curva de P&L líquido), `max_consecutive_losses`, `mfe_avg/mae_avg` (pontos), **`mfe_capture`** (= pnlPoints/MFE), `avg_hold_time`, `trades_per_day`, `pnl_top_n_share` (concentração), `consistency_pct` (regra de mesa), `time-bucket` (hora/dia da semana/sessão em ET), `streaks`. **Reaproveita** as funções puras de `analytics-insights.ts` (hourStats, dowStats, simulador "E se", MFE deixado na mesa, sequências de revenge) **depois de** corrigir a base temporal (O.2). `MIN_SAMPLE=30` e `MIN_BUCKET=3` **já existem** (🟢) e viram os limiares do protocolo de "dados insuficientes".

### K.4 Onde computa
Volume de trades por usuário é pequeno (milhares): **V1 computa dentro do Next** (funções puras). Worker/Python só quando entrar backtest.

---

## L. Market Data Interface

> **Sem escolher fornecedor** (conclusão atual mantida: Databento é a candidata de desenvolvimento; MarketParquet/FirstRate p/ cross-check; ver seção M do plano estratégico).

### L.1 Contrato conceitual
```
MarketDataProvider
  capabilities() -> { timeframes[], supportsTicks, supportsAdjusted, supportsOrderBook, sessions }
  getBars(q{ root|contract, timeframe, from, to, adjust{NONE|…}, session{RTH|ETH|ALL} }) -> BarSeries
  getTicks(q{ contract, from, to, kind{TRADES|QUOTES} })                                 -> TickStream   (opcional)
  getSessions(root, from, to)                                                            -> Session[]    (calendário/feriados/horários)
  getContractInfo(root|contract)                                                         -> ContractInfo { tickSize, multiplier, expiry, currency, exchange }
  getRolls(root, from, to)                                                               -> Roll[]
  coverage(root, timeframe)                                                              -> { from, to, gaps[], version, dataHash }
  license()                                                                              -> { allowInternalBacktest, allowDisplayRaw, allowRedistribute, status, termsRef }
```
**Tipos canônicos:** `Bar{ tsOpenUtc, o,h,l,c, volume, contract? }` (**timestamp = abertura da barra, UTC, documentado**), `Tick{ tsUtc, price, size, side?, bid?, ask? }`, `Session`, `ContractInfo`, `Roll{ ts, fromContract, toContract, rule }`.
### L.2 Camadas
```
Provider (Databento | FirstRate | MarketParquet | UserFile | LSE-experimental)
        ▼  Adapter  (traduz formato/fuso/símbolos/rolagem → canônico; checa licença)
        ▼  Canonical Market Data (Parquet particionado + manifest {dataHash, version})
        ▼  MarketDataProvider (interface acima, consumida pelo Backtest Engine e por check_data_availability)
```
Trocar fornecedor = **trocar o adapter e reingerir**; engine e agente não mudam.
### L.3 `MarketDataset` (registro) — conceitual
`id, provider, root, timeframe, from, to, adjust, version, dataHash, storageKey, licenseFlags{internalBacktest, displayRaw, redistribute}, licenseStatus{ok|pending|blocked}, termsCapturedAt/termsHash, quality {gaps, checks}`.
### L.4 Regras
- **Série contínua construída por nós** (não-ajustada + tabela de rolagem) para manter **níveis reais** (stops em pontos); ajustada só como visão opcional.
- **Portão de licença:** barras brutas só saem do worker/engine; web e agente veem **`coverage()` e derivados**.
- **Validação de qualidade:** timestamps monotônicos, sanidade OHLC, gaps, duplicatas, **DST**, e **reconciliação com seus fills reais** (preço/horário do fill ∈ barra).
- **Armazenamento:** Parquet em object storage + cache no volume do worker (DuckDB/Polars); **nunca** barras no Neon.

---

## M. Backtest Interface

### M.1 Contrato conceitual
```
BacktestEngine
  capabilities() -> { primitives[], orderTypes[], managementActions[], timeframes[], supportsTicks }
  run(request)   -> BacktestResult | UnsupportedFeature(list) | InvalidData(list)

request {
  strategyVersion { spec, specHash, paramOverrides? }          // spec JSON da seção D
  data          { datasetRefs[] (resolvidos pelo MarketDataProvider), window {from,to}, splits? {IS/OOS | WF{train,test,step}} }
  costModel     { commissionPerSideUsd, feesUsd, slippageTicks }          // custos pertencem ao EXPERIMENTO, não à estratégia
  executionModel{ intrabarConflictRule {PESSIMISTIC|OPTIMISTIC}, fillAssumptions, sessionRules, rolloverRule }
  mode          { SINGLE | SWEEP(paramGrid) | WALK_FORWARD | MONTE_CARLO(n, resampling) }
  seed
}
result {
  schemaVersion, engineVersion, specHash, dataHash, config, warnings[],
  trades[]  (formato COMPATÍVEL com TradeV2, marcados SIMULATED),   // → mesma biblioteca de métricas dos trades reais
  equityRef, metrics (do catálogo K.3), perParam?, perSplit?, diagnostics{ lookaheadGuard, dataGaps }
}
```
### M.2 Princípios
- **Puro:** sem rede e sem banco; **entrada = arquivos/objetos; saída = arquivos/objetos**; o worker faz a cola (jobs, créditos, storage).
- **Mesma `metrics` lib** para real e simulado ⇒ comparar "backtest × real" sem tradução.
- **`UnsupportedFeature`** é o mecanismo honesto do agente: *"ainda não consigo testar trailing por estrutura"*.
- **Determinismo:** `engineVersion + specHash + dataHash + seed` ⇒ resultado idêntico.
- **Pluggable:** engine próprio (barras 1 m) primeiro; NautilusTrader (tick) depois, **sem mudar request/result**.
- **Não implementar agora.**

---

## N. Migration Strategy

### N.1 Princípios
**Expand → backfill → switch → contract.** Só **aditivo** nas fases iniciais. Migrations **revisadas (SQL)**, executadas **primeiro em branch do Neon** (seu padrão) com **cópia dos dados reais**, depois produção. **Feature flags** em cada passo. **Desfazer = desligar flag** (esquema antigo intacto).

### N.2 Passos
| Passo | O quê | Reversível? |
|---|---|---|
| **N0** | **Backup/branch** do Neon; **diagnósticos de leitura** (N.4) | — |
| **N1 (expand)** | colunas novas **nulas** em `trades` (+ defaults seguros); tabelas novas: `Instrument`, `Fill`, `TradeFill`, `ImportJob`, `ImportSource`, `ImportStagedRow`, `MappingProfile`; (depois) `Strategy`, `StrategyVersion`, `MemoryItem`, `Hypothesis`, `Experiment`, `Evidence`… | sim (drop das novas) |
| **N2 (dual-write)** | importador novo (flag) e sync NT8 passam a gravar campos novos; legado intacto | sim (flag) |
| **N3 (backfill idempotente)** | scripts em `scripts/` (padrão `.mjs`): `timePrecision`, `pnlBasis=UNKNOWN`, `source` normalizado, `instrumentId`, `tradingDay` onde possível | sim (campos nulos) |
| **N4 (switch gradual)** | leitores novos usam `entryAt` quando `timePrecision=DATETIME`; Analytics por hora **ignora** `DATE_ONLY` | sim (flag) |
| **N5 (contract)** | só **bem depois**: parar de escrever `accountLabel/aiAnalysis/setupId`; Setup→Strategy consolidado | planejado |

### N.3 Regras de backfill (por origem do dado legado)
| Origem (🟢 código) | `date` hoje | Backfill |
|---|---|---|
| **CSV importado** | **dia @ 12:00:00Z** (`row.date + "T12:00:00.000Z"`); o parser **lê** `entry_time` mas **descarta** | `timePrecision=DATE_ONLY`; `entryAt/exitAt` = null |
| **Sync NT8** | `exitTime` (instante real); `entryTime` **recebido e descartado** | `timePrecision=EXIT_ONLY`; `exitAt=date`; `entryAt` = null |
| **Manual** | o que o formulário mandou (`new Date(data.date)`) | `timePrecision=UNKNOWN` (ou DATETIME se hora ≠ 12:00Z — decidir após diagnóstico) |
| `pnl` | — | `pnlBasis=UNKNOWN` (**não inventar**) |
| `source` | string livre | normalizar p/ constrained set; "MANUAL" de CSV ⇒ `CSV` quando `importJobId` futuro indicar; antigos ficam como estão |
| `instrument` | raiz | `instrumentId` por lookup; desconhecido ⇒ null + relatório |
| Setup→Strategy | texto livre | **lazy**: cria `Strategy` + `StrategyVersion v1 DRAFT_INCOMPLETE` (regras legadas como texto em `meta.legacyRules`) só quando o usuário usar |

### N.4 Diagnósticos de leitura (propor, **não rodei** — exigem sua autorização por usar credencial do banco)
Contagem de trades por `source`; % com `date` exatamente 12:00:00Z; trades com `mfe/mae` nulos; **duplicatas** por (userId, accountId, instrument, date, entryPrice, exitPrice, quantity); trades com `quantity` não inteiro; **amostra de `pnlPoints` vs (exit−entry)** para `qty>1`; contas com `brokerName` nulo; trades órfãos de `Setup`; quantos `shareToken` ativos.

### N.5 Dados que **precisam** ser preservados
Todos os trades (inclui `shareToken`/`shareIncludeAnalysis` — **links públicos em produção**), screenshots (UploadThing keys), tags, notas/`aiAnalysis`, `TradingAccount.drawdownRules`, `BalanceTransaction`, `Setup`, `CheckIn`, `TradePlan`, XP/streaks/conquistas, assinaturas Asaas, chaves de API (NT8).

---

## O. Reusable Existing Code (auditoria 🟢 — leitura de 01/10/2026)

### O.1 Mapa reaproveitar / modificar / manter / depreciar
| Item (arquivo) | Veredito | Observação |
|---|---|---|
| `lib/analytics-insights.ts` (383 l, **funções puras**: `hourStats`, `dowStats`, simulador "E se?", MFE deixado na mesa, sequências rápidas) | **REUTILIZAR → núcleo de `metrics/`** | extrair, versionar, **testar**, adicionar `coverage`/evidência; **corrigir base temporal** (O.2) |
| `lib/drawdown-engine.ts` + `drawdown-rules.ts` + `TradingAccount.drawdownRules` (testes existentes) | **MANTER** + expor `get_account_rules` | filtro de viabilidade de mesa para pesquisa futura |
| `lib/account.ts` (`ensureAccount`, `excludeTestTrades`, `excludeArchivedTrades`) | **MANTER** (envelopar no repositório) | identidade por `brokerName` é boa; filtros viram parte do contexto de tools |
| `lib/account-label.ts` (`detectAccountLabel`) | **MANTER** (heurística de tipo de conta) | passa a ser etapa do Normalizer |
| `lib/instruments.ts` (`POINT_VALUES`) | **SUBSTITUIR por `Instrument`** | ⚠️ default silencioso 20 (NQ) p/ desconhecido |
| `components/journal/importar-client.tsx` (766 l, parsing **no cliente**) | **MODIFICAR/REFATORAR** | helpers (`detectSep`, `splitLine`, `normalizeDate`, `stripContractExpiry`) vão para `ingest/`; UI vira shell do wizard com preview |
| `api/trades/import/route.ts` | **SUBSTITUIR por ImportJob** (manter legado enquanto flag off) | ⚠️ sem dedupe, sem limite de plano, `date` fixo 12:00Z |
| `api/sync/ninjatrader/route.ts` + `ninjatrader/TraderOSSync.cs` | **MANTER pausado** | futuro "conector NT8"; **reaproveitar o anti-espelho** no dedupe; passar a **guardar `entryTime`** |
| `api/sync/mt5`, `metatrader/*.mq5` | **MANTER pausado** | — |
| `api/ask-claude/route.ts` (Vega) | **MANTER** (convive) | reaproveitar rate-limit/plan-guard; **não** estender com tools |
| `api/trades/[id]/analyze` (Sonnet 4.6, `aiAnalysis` texto) | **MANTER → substituir por `TradeAnalysis` + evidência** | hoje texto livre sem fonte |
| `lib/plans.ts`, `plan-guard.ts` | **REUTILIZAR + estender** | créditos de IA; ⚠️ `QUANT` exige mudar enum `Plan` |
| `lib/rate-limit.ts` (Upstash) | **REUTILIZAR** | agente e importação |
| UploadThing + `TradeScreenshot` | **MANTER** | + `kind`, `extractionId`; mesma base p/ visão |
| `lib/gamification.ts` | **MANTER** | o pipeline novo deve disparar XP/streak em lote (como o import atual) |
| `components/journal/trade-execution-chart.tsx` (delta entrada/saída + MFE/MAE) | **MANTER** | depois recebe `entryAt/exitAt` |
| `Setup` + páginas `/setups` | **MANTER → depreciar aos poucos** (→ Strategy) | sem migração em massa |
| `TradePlan` (plano **diário**: maxLoss, meta, setups) | **MANTER** | **diferente** de `TradeIntent` (plano **por trade**) |
| `CheckIn` (emocional) | **MANTER** | vira fonte de contexto/evidência (humor × performance) |
| `lib/mesas/*` (regras de mesas, quiz, monitor) | **MANTER** | base de conhecimento para o agente (`get_prop_firm_rules`) |
| `lib/date.ts` (formatação BRT), `dayKeyBR` | **MANTER p/ UI**; pesquisa usa **ET** | evitar misturar |
| `share/[token]` (páginas públicas) | **NÃO TOCAR** | garantir que campos novos **não vazem** |
| scripts `test-*.mts` | **ESTENDER** | padrão de testes; sem runner formal (⚠️ cobertura baixa) |

### O.2 ⚠️ Achado: horário falso nos trades importados por CSV
`importar-client` converte `entry_time` para só **data**; a API grava `date = data + "T12:00:00.000Z"`. `hourBR` (analytics) lê `date` ⇒ **todo trade de CSV cai em 09:00 BRT**. **Consequência:** "melhor horário", "excluir hora X" e o simulador "E se" por hora **estão distorcidos** para quem importou CSV; para trades do sync NT8 o `date` é `exitTime` (hora de **saída**, não de entrada). **A pesquisa por horário exige `entryAt` real.**

### O.3 ⚠️ Achado: importação sem deduplicação e sem limite de plano
`createMany` sem `externalId`/`skipDuplicates`: reimportar o mesmo arquivo **duplica** trades (`@@unique([userId, externalId])` não protege `NULL`). O limite `tradesPerMonth` só é checado em `POST /api/trades`, **não** no import nem no sync.

### O.4 ⚠️ Achado: semânticas ambíguas
`pnlPoints`: import = Δpreço × **quantidade**; sync = valor do AddOn (provável por contrato) ⇒ `analytics` mistura com MFE/MAE por contrato; `pnl` bruto/líquido desconhecido; `mfe/mae` convertidos de $ para pontos **sem unidade documentada**; `instrument` sem contrato.

---

## P. Technical Risks

| # | Risco | Gravidade | Mitigação |
|---|---|---|---|
| 1 | **Horário falso/ausente** contamina qualquer análise temporal (O.2) | Alta | `timePrecision`; reimport com horário; análises ignoram `DATE_ONLY`; mostrar cobertura |
| 2 | **Duplicatas** por reimportação (O.3) | Alta | `dedupeKey` + preview + desfazer por job; limpar legado com relatório prévio |
| 3 | Semântica de `pnl/pnlPoints/mfe/mae` inconsistente (O.4) | Alta | definições canônicas (B.8) + `pnlBasis`/`mfeMaeSource`; **não corrigir legado sem diagnóstico** |
| 4 | **Parser Tradovate não lê export real** | Alta p/ você | fixtures reais; Orders/Fills + FIFO + fuso da conta |
| 5 | Migration em banco de produção (Prisma 7 + Neon; histórico `db push` × `migrate`) | Média-Alta | branch Neon + cópia de dados; só aditivo; flags |
| 6 | Enum `Plan` (QUANT) | Média | adiar; usar string/limites por tabela; avaliar mudar enum só quando necessário |
| 7 | Links públicos de share e vazamento de campos novos | Média | allowlist explícita de campos na página pública; teste |
| 8 | Verificador numérico (falso positivo/negativo) | Média | tolerância configurável; log de regenerações; eval |
| 9 | Crescimento de `Evidence`/`Message` | Baixa-Média | retenção por conversa; compactar `tradeIds` |
| 10 | Fuso/DST (ET × BRT × tz da conta) | Média | tudo UTC no banco; fuso explícito em cada função; testes de DST |
| 11 | Custo de IA fora de controle | Média | créditos/limites/hard stop (plano estratégico, I.3) |
| 12 | **Prompt injection** via arquivo/print/nota | Média | dado ≠ instrução; tools validadas; sem tool de escrita perigosa |
| 13 | Conectores com **senha do usuário** (ToS/segurança) | Média | **não fazer**; preferir arquivo/AddOn/OAuth oficial |
| 14 | Licença de dados de mercado (CME) | Alta (futuro) | flags de licença; só derivados; confirmação escrita |
| 15 | Next 16 com breaking changes (`AGENTS.md` manda ler `node_modules/next/dist/docs/`) | Baixa-Média | ler docs antes de cada incremento de UI/rotas |
| 16 | Baixa cobertura de testes | Média | metrics/ingest com testes + fixtures antes de depender deles |
| 17 | pgvector disponibilidade/plano no Neon | Baixa | validar na branch antes de depender (suporte confirmado 🟡) |
| 18 | Escopo (overengineering) | Média | incrementos pequenos; "não construir ainda" explícito |

---

## Q. Implementation Order (incrementos pequenos; cada um entregável e reversível)

> Sem datas. **Regra:** um incremento só começa quando o anterior foi usado com **dados reais seus**.

| # | Incremento | Toca banco? | Valor imediato | Pronto quando |
|---|---|---|---|---|
| **0** | **Preparação:** fixtures reais (Tradovate Orders/Fills; NT8 Trades/Executions EN/PT-BR; Rithmic CSV) **anonimizados**; **diagnósticos de leitura** (N.4, com sua autorização); fechar **catálogo de métricas** e **definições canônicas** (B.8) | não | descobrir o tamanho dos problemas O.2–O.4 | relatório de diagnóstico + fixtures no repo |
| **1** | **`metrics/` puro** (extrair de `analytics-insights`) + testes + `coverage`; tabela `Instrument` **como dado em código** (ainda sem banco) | não | métricas confiáveis e testadas; erro explícito p/ instrumento desconhecido | testes verdes; Analytics igual ou melhor |
| **2** | **Expand do schema** (N1): colunas nulas em `trades` + `Instrument/Fill/TradeFill/ImportJob/ImportSource/ImportStagedRow/MappingProfile` — **branch Neon → prod** | **sim (aditivo)** | nenhum (fundação) | app idêntico; flags off |
| **3** | **Ingestão v2 (núcleo)**: pipeline + registro de parsers + **Tradovate Orders/Fills** + reconciliador FIFO + dedupe + **preview** + **desfazer** (flag) | sim | **seus trades do Tradovate entram com horário e sem duplicar** | importa seu export real corretamente; desfazer testado |
| **4** | Parsers **NT8 (EN/PT-BR)** e **Rithmic CSV** no mesmo pipeline; **guardar `entryTime`** (também no sync pausado, p/ quando voltar) | não | cobertura das 3 plataformas prioritárias por arquivo | fixtures dos 3 formatos passam |
| **5** | **Mapper universal** CSV/Excel (LLM propõe → usuário confirma → `MappingProfile`) | sim (perfil) | qualquer formato novo sem código | 2 formatos "desconhecidos" importados |
| **6** | **Strategy/StrategyVersion** + schema da spec + validador + `humanSummary` + vínculo lazy com Setup (UI mínima, só leitura/edição simples) | sim | estratégia objetiva por versão; `Trade.strategyVersionId` | ORB de exemplo salva como `TESTABLE` |
| **7** | **Memory + Trader Card + Inbox de propostas** | sim | agente passa a "te conhecer" (visível/editável) | Card renderiza; propostas confirmáveis |
| **8** | **Evidence + Agent V1** (tools de leitura/métricas, `scan_patterns`, verificador numérico, `Conversation/AgentRun`) — **flag só p/ você** + *golden set* | sim | **primeira versão do parceiro**, com "Por quê?" | golden set aprovado; nenhum número sem evidência |
| **9** | **Hypothesis/Experiment/Conclusion** (`SLICE_OWN_TRADES`) + `ExperimentSeries` + robustez-lite (OOS por data, top-N, bootstrap/IC) | sim | **"descobrir o que funciona" nos seus trades** | ciclo hipótese→conclusão→memória com evidência |
| **10** | **Visão (print/PDF)** no mesmo pipeline (staged rows com confiança) | não | menos fricção de entrada | print do histórico vira preview confirmável |
| **11** | **MarketDataProvider + Dataset Registry + P0 de dados** (baixar amostra, **reconciliar com seus fills**, flags de licença) — **sem backtest** | sim | validar qualidade antes de investir | relatório de reconciliação |
| **12** | **BacktestEngine v0** atrás da interface (OHLCV 1 m, ORB) + worker | sim | backtest comparável ao real | spec ORB roda e reproduz hash |

---

## RESUMO FINAL

### O que já temos
- **Dados e produto em produção:** Journal, Analytics (funções puras de métricas/insights), Drawdown (motor + regras por conta), Mesas (conhecimento de regras), contas por identidade real (`brokerName`), screenshots, tags, check-ins, gamificação, share público.
- **Infra reutilizável:** auth, planos/`plan-guard`, rate limit (Upstash), cron, UploadThing, push, Asaas, SDK Anthropic, padrão de flags (`integration-flags.ts`), AddOn NT8 + rota de sync (pausados) com anti-espelho, scripts de teste.
- **Conceitos já certos:** separação de conta real, `MIN_SAMPLE=30`/`MIN_BUCKET=3`, exclusão de contas arquivadas, extração do `stripContractExpiry`.

### O que precisamos criar
`Instrument` · `Fill/TradeFill` · `ImportJob/Source/StagedRow/MappingProfile` + registro de parsers + reconciliador/dedupe/preview/desfazer · `Strategy/StrategyVersion` + schema da spec + validador · `MemoryItem/MemoryDocument/TraderCardSnapshot` · `Hypothesis/Experiment/Result/RobustnessCheck/Conclusion` · `Evidence` + verificador numérico · `Conversation/Message/AgentRun` · catálogo de tools · interfaces `MarketDataProvider` e `BacktestEngine` (só contratos) · `TradeContext`/`TradeIntent`/`RuleCheck` (quando o uso pedir).

### O que precisamos modificar
Importador CSV (horário, dedupe, limite de plano, parser Tradovate) · `analytics-insights` (base temporal, evidência/coverage, ET) · `instruments.ts` (sem default silencioso) · sync NT8 (guardar `entryTime`) · `Trade` (colunas aditivas) · `TradeTag`/`TradeScreenshot` (categoria/kind) · `plans/plan-guard` (créditos) · definição canônica de `pnl/pnlPoints/mfe/mae`.

### O que **não** devemos construir ainda
Conectores automáticos (NT8/Rithmic/Tradovate/Topstep) · **backtest engine** e worker · dado de mercado licenciado/tick · `TradeContext` preenchido · pre-trade em tempo real · busca vetorial (até haver volume de texto) · multi-agente/frameworks de agente · plano QUANT/billing por créditos completo · UI elaborada do Caderno de pesquisa · app nativo · Monte Carlo/walk-forward (só depois do engine).

---

## Perguntas para você (bloqueiam o incremento 0)
1. **Qual prop firm e tipo de conta** você usa no Tradovate (avaliação/PA/live própria)? Define se **qualquer** conector é possível.
2. Pode me **mandar exports reais** (anonimizados) do Tradovate (**Orders e Fills**) e, se tiver, do NT8 e Rithmic? Viram *fixtures* e validam o parser.
3. **Autoriza diagnósticos de leitura** no banco de produção (N.4)? Uso a credencial do `.env`; **só `SELECT`**, e mostro as queries antes.
4. Aprova a decisão **TradeV2 = evoluir `trades` in-place** (B.1-A) e **string+CHECK em vez de enums novos**?
5. Convenção de R: **líquido de comissão** (padrão proposto) ou bruto?
6. Prefere começar pelo **incremento 0/1** (sem banco) ou já planejar o **incremento 2** na branch do Neon?

## Fontes (adicionais a esta etapa)
- Tradovate API/prop/OAuth: https://community.tradovate.com/t/third-party-oauth-integration/12456 · https://community.tradovate.com/t/prop-account-api-access/10430 · https://community.tradovate.com/t/api-access-for-3rd-party-app-development/11941 · https://blog.pickmytrade.trade/tradovate-api-access-without-1000-minimum-2026-options/
- Tradovate relatórios/export: https://support.tradovate.com/s/article/Tradovate-Account-Reports?language=en_US · https://www.tradedeck.io/blog/import-tradovate-orders-fifo · https://journalit.co/docs/broker-guides-tradovate
- NinjaTrader: https://static.ninjatrader.com/support/helpGuides/nt8/trade_performance.htm · https://ninjatrader.com/support/helpGuides/nt8/best_practices.htm · https://developer.ninjatrader.com/docs/ecosystem · https://forum.ninjatrader.com/forum/ninjatrader-8/platform-technical-support-aa/100325-executions-tab-export-date-format-not-as-expected
- Rithmic: https://www.tradesviz.com/blog/auto-import-rithmic/ · https://faq.ampfutures.com/hc/en-us/articles/360060137993-Rithmic-Pricing · https://damnpropfirms.com/prop-firms-with-rithmic/
- Spec/DSL de estratégia: https://github.com/Pavel14701/deterministic-trading-engine · https://github.com/sutarrohit/Quant/pull/16
- (do plano estratégico) ProjectX/Topstep, Anthropic pricing, Databento, etc.
