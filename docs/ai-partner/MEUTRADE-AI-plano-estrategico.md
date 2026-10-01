# MeuTrade AI — Plano estratégico (v0.1, 01/10/2026)

> **Status:** documento de discussão. Nenhum código foi alterado.
> **Posicionamento:** *"Seu parceiro de pesquisa para descobrir o que realmente funciona no seu trading."*
> **Legenda de confiança:** 🟢 verificado em fonte oficial · 🟡 fonte secundária/blog · 🔴 premissa minha (a validar/medir)

---

## 0. Resumo em 12 linhas

1. O **gargalo do produto é a ingestão**, não a IA. Sem horário de entrada/saída, stop, alvo e R por trade, o agente não tem o que pesquisar.
2. A decisão de arquitetura mais importante: **o LLM nunca calcula nem inventa números.** Ele traduz linguagem natural em *specs* estruturadas e interpreta resultados; quem calcula são ferramentas determinísticas. Todo número na resposta aponta para um `evidence_id`.
3. Dá pra entregar **"o agente descobre o que funciona" sem comprar dado de mercado**: a primeira camada de pesquisa roda sobre **os próprios trades do usuário** (fatias por horário, setup, volatilidade, remoção dos top-N, OOS por data, bootstrap). Backtest de candles vem depois.
4. **Dado de mercado é o maior risco jurídico/financeiro — e agora está investigado (seção M).** A CME restringe **redistribuição** de histórico (licença de US$ 30.000/ano por DCM, 🟡), **mas uso interno para backtest não exige licença de exchange** segundo a Databento (🟡). Das 5 fontes que você trouxe, **só a MarketParquet é utilizável** (licença clara); cme-futures-ohlc, nq-futures e bar-engine **não** são fontes (sem licença / sem dados / só referência) e a London Strategic Edge é **INCERTO** (proveniência não declarada). Melhor caminho: **Databento pago-por-uso com crédito grátis** + **FirstRate/MarketParquet** p/ cross-check, **Parquet em R2 + DuckDB/Polars**, camada de dados **trocável**, e **flags de licença por dataset**.
5. **Compute de backtest é barato** (centavos por usuário/mês, 🔴 a medir). **O custo variável dominante é token de IA.** Isso define o desenho de planos: limites de IA, não de backtest.
6. Custo variável por usuário/mês (premissas 🔴): Leve ≈ US$ 0,49 · Médio ≈ US$ 2,52 · Pesado ≈ US$ 8,41 · Quant ≈ US$ 44,32. O "Quant" sem teto **dá prejuízo** em qualquer preço razoável → **créditos + tetos são obrigatórios**.
7. Motor de backtest: **motor próprio e fino** (Python) nos estágios 1–2, NautilusTrader só se/quando entrar tick e slippage realista. Nenhuma lib resolve sozinha "LLM gera estratégia" com segurança (não executamos código gerado).
8. Concorrentes de journal já têm IA (TradeZella: créditos + backtests de IA; TraderSync: Cypher com teto diário). **Ninguém que eu achei** combina: memória do trader + registro de hipóteses + robustez com consciência de múltiplos testes + regras de mesa + PT-BR.
9. Brasil: journals locais custam R$ 29,90–39,90/mês (🟡). O Pro atual (R$ 97) já está acima; planos novos precisam provar valor de pesquisa.
10. **Não pesquisei** (e deveria): APIs de plataformas brasileiras (Profit/Nelogica, Tryd), regulação CVM sobre "recomendação", Reddit (bloqueado pra mim). Ver seção L.
11. Proposta de primeiro passo: **contrato de dados (TradeV2 + Strategy + Memory) → ingestão universal (CSV/Excel/PDF/print) → Agente v1 só-leitura com evidências → pesquisa sobre os próprios trades.**
12. Decisões que preciso de você estão na seção K.3.

---

## A — Visão do produto

### A.1 O que é / o que não é
| É | Não é |
|---|---|
| Parceiro de pesquisa que **conhece seus dados, regras e histórico** | "ChatGPT para traders" |
| Ajuda a ir de **ideia → hipótese → teste → playbook → execução → revisão** | IA de sinais / previsão de mercado |
| Diz **"não dá pra testar"** quando falta dado | Robô milagroso / guru |
| Cita a origem de cada número | Resposta confiante sem evidência |

### A.2 Loop central do produto
```
IDEIA → HIPÓTESE → REGRAS OBJETIVAS → DADOS NECESSÁRIOS → TESTE → ANÁLISE → ROBUSTEZ
   ↑                                                                              ↓
APRENDIZADO ← REVISÃO ← EXECUÇÃO ← PRE-TRADE ← PLAYBOOK ← CONCLUSÃO ← MEMÓRIA ←──┘
```

### A.3 Um sistema, não dez ferramentas
O agente é a **interface principal**; as telas atuais (Dashboard, Journal, Analytics, Drawdown, Mesas, Setups) viram **"visões" dos mesmos dados** que o agente consulta via ferramentas. Regra de UX: tudo que o agente mostra tem botão "abrir no Journal / Analytics" (e vice-versa: em qualquer tela, "perguntar ao agente sobre isto").

- **Ficha do trader** (visível e editável): perfil, mercados, horários, risco, estratégias, playbook. É a memória *legível* — transparência gera confiança e permite corrigir.
- **Caderno de pesquisa**: lista de hipóteses/experimentos com status (testando / validada / descartada / inconclusiva).
- **Inbox do agente**: propostas que exigem confirmação (importações duvidosas, regras inferidas, atualização de playbook).

### A.4 Uso diário (o que faz o trader voltar)
- Pré-sessão: "O que meu playbook diz para hoje? Existe evento de notícia? Meus limites de mesa?"
- Durante: "Estou pensando em entrar vendido aqui" → checklist contra o setup (**7 de 8 critérios; falta X**).
- Pós-trade: print/importação → "Você perdeu, mas executou conforme o plano" ou "Ganhou violando 2 regras".
- Semanal: revisão automática (batch, barata) + 1 hipótese sugerida a partir dos seus dados.

### A.5 Princípios (guard-rails de produto)
1. Sem previsão de preço, sem "compre/venda". Linguagem: *seu método, suas evidências*.
2. Honestidade estatística: amostra pequena → o agente avisa e mostra intervalo.
3. Cada afirmação rastreável. Cada pesquisa registrada. Nada some.
4. Fricção mínima de entrada de dados > qualquer feature de IA.

---

## B — Arquitetura do agente

### B.1 Visão em camadas
```
                     ┌──────────────── UI (chat + visões) ────────────────┐
                     └───────────────────────┬────────────────────────────┘
                                             │
                          ┌──────────────────▼──────────────────┐
                          │   ORQUESTRADOR (loop de tool use)   │
                          │  roteador de modelo · orçamento ·   │
                          │  guardrails · auditoria (AgentRun)  │
                          └───┬───────────┬───────────┬─────────┘
              leitura         │  cálculo  │  escrita  │  visão
        ┌─────────────────────▼┐ ┌────────▼───────┐ ┌─▼────────────┐ ┌──────────────┐
        │ query_trades, stats, │ │ run_backtest   │ │ propose_*    │ │ extract_from │
        │ get_strategy, memory │ │ (job assíncr.) │ │ (confirma)   │ │ _image       │
        └──────────┬───────────┘ └───────┬────────┘ └──────┬───────┘ └──────┬───────┘
                   └──────────┬──────────┴─────────────────┴────────────────┘
                              ▼
             Postgres (Neon): trades · fills · strategies · experiments · memória
                              ▲
                   Worker Python (Railway): ingestão pesada + backtests
```

### B.2 Princípio-chave: o LLM não calcula
- **Ferramentas determinísticas** produzem todos os números (stats, R, expectancy, backtests). Cada resultado volta com `evidence_id`, `engine_version`, `data_hash`.
- O LLM faz: (a) **entender** a intenção; (b) **traduzir** hipótese em spec; (c) **pedir o que falta**; (d) **interpretar** resultados; (e) **explicar** em PT-BR.
- Fonte para essa abordagem (🟡): *"mantenha o LLM fora do loop de replay; deixe-o traduzir a estratégia em regras determinísticas uma vez e backteste essas regras do modo clássico"* (Obside).

### B.3 Ferramentas (catálogo inicial) e permissões
| Tier | Ferramenta | O que faz | Confirmação |
|---|---|---|---|
| **Leitura** | `query_trades(filtros)` | trades do usuário (paginado, escopo por `userId`) | não |
| | `trade_stats(grupo, métrica)` | win rate, expectancy (R), PF, MFE/MAE, DD por fatia | não |
| | `get_profile / get_strategy / get_playbook` | ficha, regras, versões | não |
| | `search_memory(query)` | hipóteses/conclusões/notas anteriores (estruturado + semântico) | não |
| | `check_data_availability(instrumento, tf, período)` | existe dado para testar? | não |
| **Cálculo** | `run_slice_test(hipótese)` | teste sobre **os próprios trades** (sem dado de mercado) | não |
| | `run_backtest(spec, dataset, custos)` | job assíncrono no worker | consome crédito |
| | `robustness_suite(run_id)` | OOS, walk-forward, sensibilidade, top-N, Monte Carlo | consome crédito |
| | `compare_runs`, `compare_backtest_vs_live` | | não |
| **Escrita (propõe)** | `propose_strategy_version`, `propose_playbook_change`, `propose_fact` | cria **rascunho** no Inbox | **sim, sempre** |
| | `save_experiment` | grava hipótese/resultado/conclusão | automático (é log) |
| **Visão** | `extract_from_image(img)` | devolve **rascunho** de trade + confiança | **sim** (nunca grava direto) |
| **Proibido** | apagar dados, executar ordens, rodar código gerado, acessar outro usuário | — | — |

### B.3.1 Segurança
- **Prompt injection:** conteúdo de arquivo/print/PDF é **dado**, nunca instrução. Texto extraído vai em bloco marcado, ferramentas não aceitam "comandos" vindos desse bloco.
- Argumentos de ferramenta validados (Zod); `userId` vem da sessão, **nunca** do modelo.
- Specs de estratégia são JSON declarativo — **não existe execução de código gerado por IA** (elimina a maior superfície de ataque de "AI quant").
- Auditoria: `AgentRun` guarda cada chamada de tool, tokens, custo, modelo. Dados sensíveis (credenciais de corretora) **nunca** passam pelo LLM.
- LGPD: já existe exclusão de conta com cascade; memória e experimentos entram no mesmo cascade.

### B.4 Memória (4 camadas)
| Camada | Conteúdo | Armazenamento | Como entra no contexto |
|---|---|---|---|
| **Perfil** | mercados, horários, corretoras, mesas, risco, objetivos | tabelas estruturadas | resumo fixo (cacheado) |
| **Conhecimento de método** | estratégias, versões, playbook (aprovado/testando/descartado), regras pessoais | tabelas + JSON versionado | sob demanda via tool |
| **Episódica** | conversas resumidas, sessões, hipóteses, experimentos, conclusões | tabelas + resumos | `search_memory` |
| **Semântica (RAG)** | notas livres, resumos de conversas, textos de análise | **pgvector no Neon** (suportado, 🟡) | só texto livre; o resto é consulta estruturada |

Regras de memória: cada **fato** tem `fonte` (usuário/import/IA), `confiança`, `válido_de/até`, `substituído_por`. O agente **propõe** fatos novos; o usuário confirma. Fato contraditório gera pergunta, não sobrescreve.

> Por que não só RAG? Quase tudo que o agente precisa lembrar (resultados de experimentos, regras, versões) é **estruturado e numérico** — consulta SQL é mais correta, barata e auditável que similaridade vetorial.

### B.5 Construção de contexto (substitui o "despejo" atual da Vega)
Hoje: até 120 trades dos últimos 90 dias + setups no system prompt a cada pergunta. Novo:
1. **Prefixo estável e cacheado**: instruções + ficha do trader + definição das tools (prompt caching: leitura = 0,1× do preço de entrada, 🟢).
2. **Recuperação por pergunta**: o agente chama tools e recebe **resumos agregados** (não linhas cruas), com `evidence_id`.
3. Linhas cruas só quando a pergunta é sobre trades específicos.

### B.6 Roteamento de modelos (preços oficiais 🟢, US$/MTok in/out)
| Tarefa | Modelo | Preço | Por quê |
|---|---|---|---|
| Classificar intenção, extrair campos de CSV/print simples, mapear colunas | **Haiku 4.5** | 1 / 5 | barato; tarefa estruturada |
| Conversa/análise padrão com tools | **Sonnet 5.5** | 2 / 10 | melhor custo-benefício para raciocínio com ferramentas |
| Planejar pesquisa, interpretar robustez, hipóteses ambíguas | **Opus 5.5** | 4 / 20 | só planos pagos/créditos |
| Resumos semanais, reprocessamento em lote | **Batch API** (−50%) | metade | não precisa ser instantâneo |
| (Fable 5.1: 10 / 50) | — | — | não justificável no uso atual |

Notas 🟢: tokenizer dos modelos 4.7+ gera **~30% mais tokens** pro mesmo texto (já incluído nas contas); cache hit no Opus 5.5 custa 0,05× (US$ 0,20/MTok).

### B.7 Anti-alucinação — contrato de resposta
1. **Citação obrigatória:** frase com número ⇒ `[evid:abc123]`. Um **verificador pós-resposta** checa que cada número aparece num resultado de ferramenta; se não, a resposta é regenerada ou o trecho removido.
2. **Protocolo de dados insuficientes:** limiares por tipo de afirmação (ex.: N < 30 trades por fatia → "amostra pequena; intervalo de confiança X–Y; não conclua"). Sem dado → "não consigo testar isso porque falta ___; você pode ___".
3. **Protocolo de ambiguidade:** antes de rodar, checklist da spec (instrumento, timeframe, janela horária, definição exata de "rompimento"/"pullback", stop, alvo, gestão, custos). Faltou → pergunta; nunca assume em silêncio. Mostra *"Entendi assim: …"* e espera confirmação.
4. **Backtest só nasce de ferramenta.** Se o job não terminou/falhou, o agente diz isso.
5. **Consistência:** temperatura baixa, saídas estruturadas (JSON) para extração; rubrica de análise **versionada**; estatísticas determinísticas ⇒ a mesma pergunta dá o mesmo número.
6. **Eval harness:** conjunto dourado (trades reais seus + perguntas com resposta conhecida) rodando em CI a cada mudança de prompt/modelo.

### B.8 Pre-trade e Analyzer como capacidades (não produtos)
- **Analyzer:** `trade` + `estratégia/versão` + `RuleCheck` (cada regra: seguida/violada/n.a.) + trades parecidos + stats ⇒ "resultado ≠ qualidade de execução".
- **Pre-trade:** intenção descrita em texto/print ⇒ spec parcial ⇒ checklist do setup + contexto (horário, notícia, risco da conta/mesa) + histórico de situações parecidas. **Nunca** "vai subir/descer".

---

## C — Modelo de dados conceitual (antes de qualquer migration)

### C.1 Princípios
1. **Execuções brutas imutáveis** (`Fill`) + **Trade derivado** (reconstruível). Se o algoritmo de agrupamento mudar, reprocessa.
2. **Tempo sempre em UTC + timezone da bolsa**; sessão (AM/PM/overnight, RTH/ETH) **calculada**, não digitada.
3. **Tudo versionado:** estratégia, regras, engine, dataset.
4. **Proveniência por campo:** `origem` (import/edição/IA), `confiança`, `confirmado_pelo_usuário`.
5. **Dinheiro:** decimal + moeda; ponto/tick/valor do ponto vêm do **cadastro de instrumento**.
6. Multi-tenant: `userId` em tudo, índice composto, cascade (já é o padrão do projeto).
7. Migração **aditiva** a partir do schema atual (colunas/tabelas novas, nulas, com backfill).

### C.2 Entidades

**Identidade e conta**
- `User` (existe) · `TradingAccount` (existe; + `tipo` eval/PA/live/sim, `mesa`, `planoMesa`, `regras` json já existe em `drawdownRules`) · `SourceConnection` (plataforma, método, status, último sync, **sem guardar senha em claro**).

**Mercado**
- `Instrument` — símbolo, raiz do contrato, `tickSize`, `tickValue`/`pointValue`, moeda, bolsa, fuso, calendário de sessão, comissão-padrão, multiplicador (NQ vs MNQ). *(Resolve o bug histórico "NQ×MNQ rendiam igual".)*
- `MarketDataset` — instrumento, timeframe, período, provedor, **licença/origem** (usuário/curado), cobertura, `hash`.
- `Bar` (OHLCV, em storage colunar/parquet; **não** linha-a-linha no Postgres para milhões de barras).
- `MarketContextDaily` — ATR, range, gap, dia da semana, evento de notícia (sim/não/tipo), rótulo de regime (calculado).

**Execução e trade**
- `Fill` — conta, instrumento, lado, qtd, preço, **timestamp**, comissão, id externo, `ImportBatch`.
- `Trade` (derivado) — `entryAt`, `exitAt`, lado, qtd, `avgEntry`, `avgExit`, P&L bruto/líquido, taxas, pontos, **`stopInicial`, `alvoInicial`, `riscoInicial$` → `R` realizado**, `MFE/MAE` (pontos, $, R, **timestamps**), duração, `tf`, sessão (calculada), `strategyVersionId`, `intencaoId`, qualidade de dados (`completo`/`parcial`/`estimado`).
- `TradeIntent` (plano pré-trade) — setup pretendido, entrada/stop/alvo planejados, tese, contexto, screenshot do plano. Permite medir **plano vs execução** (slippage de decisão).
- `RuleCheck` — trade × regra da versão: `seguida/violada/n.a.`, quem avaliou (usuário/IA/auto), evidência.
- `Tag`/`Mistake` (taxonomia: FOMO, revenge, overtrading, saiu cedo…) e `Emotion` (check-in já existe).
- `Attachment` (print) + `Extraction` (JSON bruto da IA, confiança por campo, confirmado?).

**Método**
- `Strategy` → `StrategyVersion` — **spec JSON** (universo, timeframe, janelas, gatilho, filtros, stop, alvo, gestão, sizing, parâmetros), `status` (rascunho/testando/aprovada/descartada), `hash`, `notasDeMudança`.
- `Playbook` (conjunto de versões aprovadas + regras pessoais + exceções).

**Pesquisa**
- `Hypothesis` — texto original, spec resultante, estado.
- `Experiment` / `BacktestRun` — `strategyVersionId`, `datasetId`, parâmetros, **modelo de custos** (comissão, slippage, spread), divisão (IS/OOS/WF), `engineVersion`, `dataHash`, `seed`, `status`, métricas, ponteiro p/ curva de equity e lista de trades simulados.
- `ExperimentSeries` — agrupa variações (para **contar quantos testes foram feitos** → aviso de múltiplos testes).
- `Conclusion` — veredito (validada/descartada/inconclusiva), regime onde vale, ressalvas, link p/ runs.

**Memória e agente**
- `MemoryFact` (chave, valor, fonte, confiança, vigência) · `Conversation`/`Message` · `AgentRun` (tools, tokens, custo, modelo, versão do prompt) · `Insight` · `PreTradeCheck` · `UsageEvent`/`CreditLedger`.

**Ingestão**
- `ImportBatch` (origem, hash do arquivo, perfil de mapeamento usado, contagens, erros, status) · `MappingProfile` (assinatura de cabeçalho → mapeamento confirmado; **reutilizável**).

### C.3 Teste do modelo: "o Research Agent consegue responder?"
Cada pergunta abaixo precisa ser respondível por consulta + dado existente (checklist para validar o schema **antes** de migrar):

| # | Pergunta | Campos críticos |
|---|---|---|
| 1 | Win rate e expectancy (R) por faixa horária | `entryAt`, `R` |
| 2 | Resultado quando ATR > média | `MarketContextDaily.ATR` |
| 3 | Qual % do P&L vem dos 10 melhores trades? | P&L por trade |
| 4 | Aderência às regras × resultado | `RuleCheck` |
| 5 | Setup v2 vs v1 da mesma estratégia | `StrategyVersion` |
| 6 | Quanto MFE eu deixo na mesa por saída? | `MFE`, `exitAt` |
| 7 | Slippage real vs backtest | `Fill` × `BacktestRun.custos` |
| 8 | Já testamos X? Quantas variações até aqui? | `Hypothesis`, `ExperimentSeries` |
| 9 | Desempenho nos dias de notícia | `evento` |
| 10 | Plano vs execução (entrada/stop planejados × reais) | `TradeIntent` |
| 11 | Efeito da regra de consistência da mesa | `TradingAccount.regras` |
| 12 | Após 2 stops seguidos, como opero? | sequência temporal |

### C.4 Lacunas do schema atual (🟢 lido no código)
`Trade` tem só `date` (sem entrada/saída), `mfe/mae` opcionais, `setupId` sem versão, **sem stop/alvo/R, timeframe, estratégia versionada**; `Setup.rules` é texto livre; `PlanKey` = FREE|TRADER|PRO (enum). Tudo isso entra aditivamente.

---

## D — Estratégia de ingestão

### D.1 Pipeline único (todas as fontes caem aqui)
```
ARQUIVO / CONEXÃO / IMAGEM / MANUAL
        ↓
 RAW STORE  (imutável, hash do arquivo → dedupe, reprocessável)
        ↓
 PARSERS    determinístico por assinatura → se desconhecido: LLM propõe mapeamento (Haiku)
        ↓
 NORMALIZADOR  (colunas → Fill; fuso → UTC; símbolo → Instrument; moeda; decimal BR/US)
        ↓
 RECONCILIADOR (Fills → Trades; dedupe; scale-in/out; contas)
        ↓
 VALIDADOR     (recalcula P&L = Δpreço × pointValue × qtd − taxas; fora da tolerância → flag)
        ↓
 CONFIRMAÇÃO   "Encontrei 142 trades. 6 precisam de você." (só o que é duvidoso)
        ↓
 COMMIT → eventos → memória/agente
```
**Ideia central — MappingProfile:** a primeira vez que aparece um formato novo, o LLM propõe o mapeamento e o usuário confirma **uma vez**; a assinatura do cabeçalho fica salva. Dali em diante o import é determinístico e **sem custo de IA**. A biblioteca de formatos cresce com o uso.

### D.2 Nível 1 — Conexão automática (pesquisa)
| Plataforma | API? | Custo | Uso comercial / acesso | Sync automático | Dificuldade | Observações |
|---|---|---|---|---|---|---|
| **NinjaTrader 8** | Sem API cloud pública; **AddOn/Indicator local** (NinjaScript) e SQLite local 🟡 | grátis | nosso AddOn; alternativa terceira: CrossTrade (REST via AddOn) 🟡 | sim, **exige app rodando no PC** | média | Você já tem `TraderOSSync.cs` (pausado por flag desde 17/09). |
| **Tradovate** | Sim (REST/WS) 🟡 | **US$ 25/mês + conta financiada ≥ US$ 1.000** para ter API própria; **credenciais OAuth só p/ membros aprovados do NinjaTrader Ecosystem** 🟡 | dado de mercado exige licença CME (US$ 290–500/mês) 🟡 | sim | alta (aprovação) | TradeZella sincroniza via **pop-up de login (usuário/senha, 2FA)**, a cada 3h 🟡. Modelo que exige confiança e cuida de ToS. |
| **Rithmic** | R\|API+, R\|Protocol (WebSocket + protobuf) 🟡 | **US$ 100/mês de API + US$ 25 de User ID** 🟡 | vendor precisa **passar em conformance** p/ produção 🟡 | possível | alta | TradeZella: Rithmic = **só arquivo (sem auto-sync)** 🟡. TradesViz: login manual a cada sync, ou **CSV periódico do R\|Trader → Google Drive** 🟡. |
| **ProjectX / TopstepX** | Sim | **US$ 29/mês** (🟡 há cupom) | **ProjectX ficou exclusiva da Topstep desde 28/02/2026**; Bulenox/Tradeify/Lucid migraram de plataforma 🟡 | sim | média | ⚠️ A **plataforma atual de cada mesa que você cobre precisa ser re-verificada**. |
| **BlackArrow** | **Não encontrei API pública** | — | — | não (CSV) | baixa | Export: lista de ordens → botão direito → Export (🟡); TradesViz suporta por CSV. |
| **MetaTrader 4/5** | Sem API oficial para terceiros; **MetaApi** (cloud) ou EA próprio | MetaApi: **US$ 30–100/mês** + cobrança por uso 🟡 | ok | sim (EA envia / MetaApi puxa) | média | Seu EA MT5 está desligado ("sync nunca chegou"). |
| **TradingView** | **Sem API REST oficial de histórico**; só **webhooks de alertas** 🟡 | — | — | não p/ histórico | — | Papel no produto: **print/screenshot** + alertas, não ingestão. |
| **Interactive Brokers** | Web API (Client Portal) + **Flex Queries** | grátis | **vendor precisa de aprovação de Compliance; OAuth 1.0a** 🟡 | via Flex | média-alta | TradeZella: usuários reclamam do setup do Flex 🟡. |
| **cTrader** (forex) | **Open API, OAuth 2.0**, histórico de deals 🟡 | aparentemente grátis (⚠️ não confirmei termos comerciais) | OAuth por usuário | sim | média | Boa candidata a "primeira conexão oficial" em forex. |
| **Cripto (Binance, Bybit…)** | API com **chave somente-leitura** do usuário 🟡 | grátis | ok | sim | baixa | Bybit ~2 anos de histórico; limites por segundo/minuto 🟡. |
| **Agregador SnapTrade** (ações/opções) | Sim | **US$ 100/mês + US$ 1–2/usuário conectado** 🟡 | ok | sim | baixa | Não cobre futuros de mesa prop; só faz sentido se houver demanda de ações. |

**Leitura honesta:** para **futuros de mesa prop (seu público)**, as APIs oficiais são **caras, burocráticas ou exigem app local**. Os líderes de mercado resolvem com **mistura de arquivo + login + AddOn**. Recomendo **não começar por conexões**; começar por arquivo/print (que cobrem 100% das plataformas) e usar dados reais de uso para decidir *qual* conexão vale o custo.

### D.3 Nível 2 — Importação
- **CSV/Excel/TXT:** detecção por assinatura (já existe para NT8 EN/PT-BR, Tradovate, MeuTrade) + **mapper LLM** para desconhecidos + `MappingProfile`. Excel via leitura de planilha no worker.
- **PDF:** texto embutido → parse; PDF escaneado → visão. Relatórios de mesa/corretora entram aqui.
- **Relatórios de prop firm:** tratados como formato comum + metadados (conta, regras) que alimentam `TradingAccount`.
- Limite atual de 500 linhas por request vira **importação em lote assíncrona** (worker) com barra de progresso.

### D.4 Nível 3 — Visão computacional
Três casos, três níveis de ambição:
1. **Print de histórico/resultado (tabela)** → linhas de `Fill/Trade`. Confiável (texto legível) — **alto valor, baixo risco**.
2. **Print do TradingView com ferramenta de posição (Long/Short)** → entrada/stop/alvo são legíveis. Bom para `TradeIntent`.
3. **Print de gráfico "cru"** → entrada/stop *aproximados* a partir do eixo de preço. **Sempre marcado "estimado"**.

Limites 🟢 (docs Anthropic): *"pode alucinar em imagens de baixa qualidade, giradas ou muito pequenas"*; saídas espaciais/coordenadas são **aproximadas**. Política: **confiança por campo + usuário confirma** + (quando houver candles) **encaixar na barra** do horário. Custo 🟢: tokens = ⌈largura/28⌉×⌈altura/28⌉; ≈ 1,6 mil tokens num print comum no tier padrão; até 4,8 mil em alta resolução (Sonnet/Opus 4.7+) → **reduzir a imagem antes de enviar** quando não precisa de detalhe.

### D.5 Nível 4 — Manual
Formulário rápido **+ entrada em linguagem natural** ("comprei 2 MNQ às 10:42 a 21.450, stop 21.430, saí 21.490") → rascunho para confirmar.

### D.6 Métricas de ingestão (norte do produto)
Tempo até o primeiro insight (meta < 5 min) · % de linhas que exigem confirmação · taxa de formatos reconhecidos sem IA · trades com `stop` e `R` preenchidos (**é o que destrava a pesquisa**).

---

## E — Research + Backtest

### E.1 Fluxo (máquina de estados)
```
IDEIA → [1] ENTENDER (reformular em regras)
      → [2] CHECKLIST de ambiguidade → pergunta ao usuário se faltar
      → [3] SPEC (JSON) mostrada em português: "Entendi assim…" → usuário confirma
      → [4] DADOS: check_data_availability → se faltar: "não consigo testar; preciso de X"
      → [5] EXECUÇÃO (slice test nos trades  OU  backtest de candles, job assíncrono)
      → [6] ANÁLISE (métricas + custos aplicados)
      → [7] ROBUSTEZ (suite)
      → [8] CONCLUSÃO (com ressalvas, N e intervalos)
      → [9] MEMÓRIA (Hypothesis + Experiment + Conclusion; atualiza contagem de testes)
```
Regras de ouro: **nunca inventar resultado**; **spec ambígua ⇒ perguntar**; **sem dado ⇒ dizer que não dá**.

### E.2 Três tipos de teste (é como a fundação serve aos 2 estágios)
| Tipo | Precisa de dado de mercado? | O que responde | Quando |
|---|---|---|---|
| **1. Slice test nos seus trades** | **Não** | "Meu setup funciona melhor 10:30–12:00? com ATR alto? sem os top-10?" | **MVP (Estágio 1→2a)** |
| **2. Backtest de candles (OHLCV 1m/5m)** | Sim | "E se eu aplicasse essa regra em todos os dias, não só nos que eu operei?" | Estágio 2b |
| **3. Tick / order book / slippage realista** | Sim (caro) | execução realista, microestrutura | Estágio 3 |

O tipo 1 já entrega boa parte do "descobrir o que funciona" **sem custo de dado e sem risco de licença**, e usa o mesmo registro de hipóteses/experimentos dos tipos 2 e 3.

### E.3 Suite de robustez
IS/OOS por data · **walk-forward** · sensibilidade de parâmetros (**platô vs pico**) · **remover os N melhores trades** · **Monte Carlo** (reamostragem/embaralhamento de trades) · divisão por regime (tercis de ATR, ano) · **estresse de custos** (2× slippage/comissão) · **intervalos de confiança** e amostra mínima · **penalidade de múltiplos testes** (o sistema sabe quantas variações já foram testadas na mesma série ⇒ avisa que o "melhor resultado" provavelmente é sorte).
Contexto 🟡: fontes de mercado citam que a maioria das estratégias com backtest bonito falha ao vivo por overfitting/seleção/custos; e que **limites de mesa (perda diária, trailing DD)** podem derrubar o PF de uma estratégia — daí integrar **regras de mesa** (já temos o `drawdown-engine`) como filtro de viabilidade.

### E.4 Escolha de engine (🔴 não rodei benchmark; comparo licença/manutenção/escopo)
| Opção | Licença | Estado | Futuros / intraday / tick | Observação para nós |
|---|---|---|---|---|
| **Motor próprio fino** (Python + numpy/polars/numba) | nossa | nossa | só o que implementarmos | Totalmente controlável; **spec declarativa → engine**; fácil de testar; custo de dev baixo p/ OHLCV |
| **VectorBT** | Apache 2.0 + **Commons Clause** 🟡 | OSS parado há +1 ano; evolução no PRO (~US$ 150/mês 🟡) | vetorizado, rápido; futuros sem suporte de primeira classe | Dá p/ embutir num SaaS (não revender "só ele"); bom p/ varredura de parâmetros |
| **Backtrader** | (não verifiquei) | "modo manutenção", lento 🟡 | event-driven | evitar |
| **Zipline-reloaded** | (não verifiquei) | ativo 🟡 | foco ações/diário | pouco aderente a intraday/futuros |
| **backtesting.py** | **AGPL-3.0** 🟡 | ativo | 1 instrumento | AGPL em SaaS ⇒ obrigação de publicar modificações do componente; evitar no núcleo |
| **NautilusTrader** | **LGPL-3.0** 🟡 | muito ativo (Rust core) | **multi-ativo, futuros, tick/book** | Estágio 3 (tick/slippage); curva de aprendizado alta |
| **LEAN (QuantConnect)** | **Apache 2.0** 🟡 | ativo | futuros, forex, cripto; plugin Databento | Pesado (C#/infra de dados); excelente referência, exagero p/ MVP |

**Recomendação (decisão D3):** **motor próprio fino** nos Estágios 1–2 (cálculo de futuros: tick/ponto, comissão, slippage em ticks, regra pessimista quando stop e alvo caem na mesma barra, sessões), **VectorBT opcional** para varreduras grandes, **Nautilus** só se entrar tick. Motivo central: o agente gera **specs**, não código — um engine pequeno que *entendemos 100%* é mais seguro e testável do que adaptar uma lib genérica.

### E.5 Infra de execução
- **Jobs em tabela Postgres** (`SELECT … FOR UPDATE SKIP LOCKED`) — **sem Redis/fila nova** no início (você já tem Upstash, mas não precisa).
- **Worker Python no Railway** (já é seu padrão): backtests e importação pesada. Timeout, limite de memória, **cota por usuário** (créditos) e fila justa.
- Resultados: métricas em JSONB; curvas e trades simulados em arquivo comprimido (R2/S3) com ponteiro.
- Determinismo: `engineVersion + dataHash + seed` ⇒ run reproduzível.

### E.6 Research Memory — exemplo de "ficha"
```
HIPÓTESE #032  "ORB funciona melhor com ATR > média"      status: validada (com ressalvas)
dados: MNQ 1m, 2022–2026 (usuário)   variações testadas na série: 7
resultado: PF 1,42 · expectancy +0,37R · 483 trades · IC95% [+0,12, +0,61]R
robustez: OOS 2025–26 ok · sem top-10 trades: +0,21R · parâmetros: platô
conclusão: "Edge concentrado em alta volatilidade; não use em dia de baixa."
```
Pergunta futura "já testamos isso?" ⇒ `search_memory` ⇒ resposta com link para a ficha.

---

## F — Concorrência (pesquisa de 01/10/2026)

### F.1 Quadro comparativo
| Produto | Público | Preço (mensal) | IA | Backtest | Ingestão | Observações |
|---|---|---|---|---|---|---|
| **TradeZella** 🟢 | day traders (todas as classes), prop | Essential **US$ 35** · Pro **59** · Ultra **99** (anual: 26/44/74) | **Zella AI** com **créditos** (500/1.500/3.000 por mês) + agentes (auto-tag, briefing, revisão) | manual (Essential); **10 / 100 backtests de IA por mês** (Pro/Ultra) | 500+ corretoras; sync a cada 3h; **Rithmic = só arquivo** | reajustou +US$ 6/+10 em 2026; **o mais próximo do nosso modelo** |
| **TraderSync** 🟡 | idem | Pro **29,95** · Premium **49,95** · Elite **79,95** | **Cypher**: **5 / 15 / 60 msgs por dia** | backtesting + replay | 900+ corretoras (alegado) | IA com teto diário; reclamação recorrente de import/bugs |
| **TradesViz** 🟡 | analytics pesado, multi-ativo | Basic grátis · Pro **~US$ 15** · Platinum **~US$ 22,49** (anual) | Q&A em linguagem natural (Platinum) | simuladores segundo-a-segundo | forte (inclui Rithmic via login) | **mais barato**; foco em métricas |
| **Tradervue** 🟡 | traders de ações | Silver **29,95** · Gold **49,95** | pouca | não | 80+ corretoras | clássico, UI datada |
| **Edgewonk** 🟡 | psicologia/disciplina | **US$ 197/ano** (única) | não | não | importação automática | amado por quem quer só diário |
| **TrendSpider** 🟡 | análise técnica automatizada | **US$ 82–321/mês** | **Sidekick** US$ 49–349 por **100–1.000 msgs** | backtest por plano; 1m só no Enhanced+ | — | foco em gráficos/screening |
| **QuantConnect** 🟡 | quants/algo | grátis → **US$ 60–1.080/usuário/mês** + nós de computação **~US$ 14–96** | — | engine LEAN completo | próprio | não é journal; barreira técnica alta |
| **Trade Copilot** 🟡 | **cripto** | **US$ 49/mês + uso de IA cobrado a custo** | coach que lê suas posições; **grade seu setup contra suas regras antes da entrada** | prática/backtest | Binance, Bybit, OKX, Coinbase, Hyperliquid (read-only) | **mais próximo em "pre-trade vs suas regras"**, mas cripto |
| **TradingAgents** 🟡 | pesquisa/open-source (Apache 2.0) | grátis | multi-agentes LLM que **decidem** trades | — | — | oposto do nosso posicionamento (sinal) |
| **Chartlog** 🟡 | traders | — | coach com Claude | — | — | "journal que pensa com você" |
| **Tradelyze** 🟡 | **algo/Pine Script** | — | converte Pine→Backtrader, **walk-forward**, valida **50+ regras de prop firm** | **sim** | TradingView | **sobreposição parcial** com robustez + mesa |
| **Locais BR** 🟡 | traders de mini índice/forex | **TradeMind R$ 29,90** · **Diário do Trader a partir de R$ 39,90** · Trade Diário (Profit/Tryd/MT5) | IA simples | não | CSV Profit/Tryd/MT5 | baratos e simples |

### F.2 Dores reais (fontes: Trustpilot/reviews; **Reddit inacessível ao meu crawler — ver L**)
- **Confiabilidade do sync** é a queixa técnica nº 1 (token do Schwab expira em 6–7 dias e o gap passa despercebido; Flex do IBKR) 🟡.
- **IA que atrapalha:** tags contraditórias em centenas de trades, lentidão 🟡; **limites de mensagens** que matam o hábito (5/dia) 🟡.
- **Primeira semana:** setup/importação quebram; "quando funciona é ótimo, quando quebra o preço pesa" 🟡.
- **Cobrança/cancelamento** confuso (caso de tentativas diárias de cobrança) 🟡.
- **Preço:** TradeZella considerado caro; opções baratas existem 🟡.
- Aviso: vários "comparativos" são **blogs dos próprios concorrentes** (viés) — usei como pista, não como prova.

### F.3 Onde existe espaço (hipóteses a validar)
1. **Memória + pesquisa, não só Q&A:** journals tratam IA como camada de perguntas/tags. **Registro de hipóteses com contagem de testes e robustez** não apareceu em nenhum journal que li.
2. **Trader discricionário** entre dois mundos: journals (sem pesquisa séria) × QuantConnect/Tradelyze (exigem código/algo).
3. **Honestidade como diferencial:** "não consigo testar" e "amostra pequena" num mercado cheio de promessas.
4. **Mesas + PT-BR:** você já tem a seção Mesas e o motor de drawdown; concorrentes globais não localizam e os locais não têm pesquisa.
5. **Ingestão sem fricção** (mapper com memória + print) ataca a dor nº 1.
Riscos: TradeZella já caminha para "AI backtests" e tem escala; precisamos ser **mais profundo em pesquisa** e **mais honesto**, não "mais features".

---

## G — APIs e dados

### G.1 Dados de mercado (futuros)
| Fonte | Preço | Pontos-chave |
|---|---|---|
| **Databento** 🟢 (site) | CME Globex MDP 3.0: **Standard US$ 199/mês**, Plus **1.750**, Unlimited **4.500** (desde 22/06/2026); histórico **a partir de US$ 0,50/GB** pago por uso; **US$ 125 de crédito** grátis/6 meses | 16+ anos de OHLCV (L0) no Standard; **direitos de distribuição externa só no Plus** |
| **Licença CME** 🟡 | uso não-display p/ não-profissional a partir de **US$ 36,50/mês**; profissional US$ 1.219/mês (repasse pela Databento) | e **"Historical Information" distribuída a terceiros exige licença: US$ 30.000/ano por DCM** (tarifa de 2021) |
| **Dados do próprio usuário** | US$ 0 | export de candles (NT8/Tradovate/TradingView) — fricção, **risco jurídico mínimo** |

**Estimativa 🔴:** NQ 1-minuto de 15 anos ≈ 5 M de barras ≈ ~0,3 GB ⇒ na faixa de **centavos a poucos dólares** por download no pago-por-uso (se OHLCV tiver preço/GB parecido). O custo real de dado **não é o download — é a licença de exibição/distribuição**.

**Conclusão (D2):** MVP com **(a) trades do usuário + (b) candles que o usuário traz**. Só considerar dataset nosso **depois de resposta por escrito de Databento/CME** sobre: (i) uso interno para computar estatísticas derivadas; (ii) exibir gráficos de candles ao usuário; (iii) persistir. Mostrar *derivados* (equity, métricas) é bem diferente de redistribuir barras.

### G.2 Modelos de IA — preços por 1 M de tokens (entrada / saída)
| Modelo | US$ | Fonte |
|---|---|---|
| Claude **Haiku 4.5** | 1 / 5 · cache hit 0,10 · batch 0,50/2,50 | 🟢 oficial |
| Claude **Sonnet 5.5** | **2 / 10** · cache hit 0,20 · batch 1/5 | 🟢 oficial (**blogs ainda citam 3/15; o oficial diz que o preço de lançamento 2/10 virou definitivo**) |
| Claude **Opus 5.5** | 4 / 20 · cache hit **0,20** · batch 2/10 | 🟢 |
| Claude **Fable 5.1** | 10 / 50 · cache hit 0,25 · batch 5/25 | 🟢 |
| OpenAI GPT-5.6 Luna / Terra / Sol | 0,20/1,20 · 2/12 · 4/20 (promo) | 🟡 |
| Gemini 3.8 Flash | 0,75/3,75 (**introdutório**; 1,50/7,50 em 01/01/2027) · 2.5 Flash-Lite 0,10/0,40 | 🟡 |
| Groq: gpt-oss-120b / Qwen 3.6 27B | 0,15/0,60 · 0,60/3,00 · **Llama só via Enterprise** | 🟡 |

**Recomendação (D7):** manter **Anthropic** (já integrado; tool use e visão fortes; mesmo SDK) atrás de uma **camada de abstração de provedor**, com roteamento Haiku/Sonnet/Opus. Modelos baratos de outros provedores ficam como otimização futura para tarefas simples **depois** de termos o eval harness (sem eval, trocar de modelo é voar às cegas). Web search/fetch da API: US$ 10/1.000 buscas 🟢 — não é necessário no núcleo.

### G.3 Infra e pagamentos
| Item | Custo | Nota |
|---|---|---|
| **Neon** 🟡 | Launch: **US$ 0,106/CU-h + US$ 0,35/GB-mês** (~US$ 19 de entrada); pgvector ✅ | você já usa |
| **Railway** 🟡 | **US$ 20/vCPU-mês + US$ 10/GB-mês**; Hobby US$ 5, Pro US$ 20 (inclui US$ 20 de uso) | worker de backtest |
| **Upstash / UploadThing / Vercel / observabilidade** | **não pesquisei preço atual** 🔴 | já em uso |
| **Asaas** 🟡 | Pix **R$ 0,99** (3 primeiros meses) depois **R$ 1,99**; cartão **1,99% + R$ 0,49** *(promocional 3 meses; taxa cheia pós-promoção não confirmada)* | continua adequado: PT-BR, Pix, recorrência. **Limitação:** cobra em BRL; se um dia vender fora do Brasil, precisará de Stripe/Paddle |

---

## H — Custos

### H.1 Custo unitário (🔴 premissas de tokens — **medir no protótipo**)
Preços 🟢 oficiais; tokenizer +30% aplicado a Sonnet/Opus.

| Unidade de trabalho | Hipótese de tokens | Haiku | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|
| Turno de chat com tools (≈3 chamadas) | 8k novos + 12k cache + 1k saída | **US$ 0,018** | **0,047** | 0,090 |
| Extrair trade de 1 print | 1 imagem (~1,6k) + 1k prompt + 0,5k JSON | **0,005** | 0,013 | 0,027 |
| Analisar 1 trade (contexto + print) | ~8k + 3k cache + 0,9k | 0,013 | **0,033** | 0,066 |
| Pesquisar 1 hipótese (≈8 chamadas) | 24k + 40k cache + 5k | 0,060 | **0,157** | 0,304 |
| 1 backtest / slice (≈15 s, 1 vCPU + 1 GB) | — | **≈ US$ 0,00017** (compute Railway) | | |

→ **Compute de backtest é irrelevante** (milhares de execuções = centavos). Se estiver errado por 100×, ainda é pequeno. **Token de IA é o custo real.**

### H.2 Perfis de uso (por usuário/mês)
| Perfil | Chat (H/S/O) | Prints | Análises | Hipóteses (S/O) | Backtests |
|---|---|---|---|---|---|
| **Leve** | 12 / 3 / 0 | 5 | 3 | 0 | 2 |
| **Médio** | 45 / 15 / 0 | 20 | 12 | 3 / 0 | 40 |
| **Pesado** | 120 / 60 / 0 | 60 | 40 | 10 / 0 | 400 |
| **Quant** | 250 / 250 / 100 | 150 | 100 | 30 / 30 | 3.000 |

### H.3 Custo variável resultante (US$/usuário/mês)
| Perfil | IA | Backtest | Storage | **Total** | ≈ R$ (US$1 = R$ 5,50 🔴) |
|---|---|---|---|---|---|
| Leve | 0,48 | 0,00 | 0,01 | **0,49** | 2,7 |
| Médio | 2,48 | 0,01 | 0,03 | **2,52** | 13,9 |
| Pesado | 8,16 | 0,07 | 0,17 | **8,41** | 46,3 |
| **Quant** | 43,11 | 0,51 | 0,70 | **44,32** | **243,8** |

### H.4 Custos fixos mensais (ordem de grandeza)
| Cenário de dados | Fixo/mês (US$) | Composição |
|---|---|---|
| **A — dados do usuário** (recomendado no MVP) | **≈ 50–80** 🔴 | Neon ~19+, worker Railway ~20, resto de infra |
| **B — Databento Standard** | **≈ 260–290** | A + 199 + repasse de licença CME (a partir de 36,50) — **uso/distribuição a confirmar** |
| **C — Databento Plus (distribuição externa)** | **≈ 1.800+** | A + 1.750 + taxas CME de exibição |

Break-even (margem de contribuição de um Pro "médio" ≈ R$ 102/mês): **A ≈ 3 usuários · B ≈ 14 · C ≈ 97**. *(Mostra por que o caminho de dados muda a estratégia comercial.)*

### H.5 O que mais move o custo (análise de sensibilidade)
1. **Tokens por turno** (premissa nº 1 — medir). 2. **% de uso do Opus.** 3. **Tamanho/quantidade de imagens.** 4. **Licença de dados.** 5. Cache hit rate (se o prefixo não for estável, perde-se ~90% da economia de entrada).

---

## I — Unit economics

Premissas 🔴: câmbio R$ 5,50 · taxa de pagamento 3,5% + R$ 0,49 · imposto 6% (**validar com contador; depende do enquadramento da sua empresa**) · CAC fora do escopo agora (não há dado).

### I.1 Margem bruta por preço × perfil (sobre o preço)
| Preço (R$/mês) | Leve | Médio | Pesado | Quant |
|---|---|---|---|---|
| 49 | 84% | 61% | **−5%** | −408% |
| 79 | 87% | 72% | 31% | −219% |
| 97 *(Pro atual)* | 87% | 76% | 42% | −161% |
| 129 | 88% | 79% | 54% | −99% |
| 199 | 89% | 83% | 67% | −32% |
| 249 | 89% | 85% | 72% | **−8%** |
| 349 | 90% | 86% | 77% | +21% |

**Leitura:** o plano normal aguenta usuário leve/médio com folga. **O usuário "quant" sem teto é prejuízo em qualquer preço razoável** ⇒ créditos e tetos são parte do produto, não detalhe.

### I.2 Orçamento de custo variável para manter **70% de margem bruta**
| Plano (R$) | Teto de custo variável |
|---|---|
| Trader R$ 59 | **US$ 2,11** |
| Pro R$ 129 | **US$ 4,72** |
| Quant R$ 249 | **US$ 9,19** |

### I.3 Mecanismo de proteção da margem
- **Créditos de IA mensais** (unidade ≈ custo real; Opus consome ~2× Sonnet, que consome ~2,5× Haiku), **sem rollover** (ou rollover parcial). Mesmo conceito dos concorrentes (TradeZella usa créditos; TraderSync usa teto diário).
- **Cota de backtests por plano** (protege fila/worker, não margem) + **prioridade de fila** por plano.
- **Pacote extra de créditos** (pay-as-you-go) — o usuário pesado paga pelo que usa; Trade Copilot cobra uso de IA "a custo" 🟡 (modelo de referência).
- Alertas de consumo e **hard stop** com mensagem honesta.
- **Cache + Batch + roteamento** como alavancas de margem (Opus 5.5 com cache hit a 5%).

---

## J — Monetização (**hipóteses de teste**, não decisão)

### J.1 Referências de mercado
TradeZella US$ 35/59/99 · TraderSync 29,95/49,95/79,95 · TradesViz ≈15/22,49 · Edgewonk ≈US$ 16/mês (197/ano) · locais BR R$ 29,90–39,90. O Pro atual do MeuTrade (R$ 97) fica entre os locais e os globais, **sem pesquisa ainda**.

### J.2 Estrutura proposta
| Plano | Preço (hipótese) | Para quem | Limites (pacote máximo → custo se **gastar tudo**) | Margem no teto de uso |
|---|---|---|---|---|
| **FREE** | R$ 0 | experimentar | ingestão (CSV/print) + painéis + **poucas** perguntas de IA (**teto de custo ≈ US$ 0,30**) | — |
| **TRADER** | **R$ 59** | journal + agente "me conhece" | 40 chats Haiku/10 Sonnet · 20 prints · 6 análises · 2 hipóteses · 100 runs ⇒ **≈ US$ 1,82** | ≈ **72%** |
| **PRO** | **R$ 129** | pesquisa regular | 80 Haiku/40 Sonnet · 60 prints · 20 análises · 8 hipóteses · 600 runs ⇒ **≈ US$ 5,63** | **≈ 66%** no teto; **~79%** no uso médio |
| **QUANT** | **R$ 249** | pesquisa intensa | 120 H/80 S/20 O · 120 prints · 40 análises · 15+10 hipóteses (Opus) · 3.000 runs ⇒ **≈ US$ 15,55** | **≈ 56%** no teto; maior no uso real |

Observações: (i) **uso real costuma ficar bem abaixo do teto** (premissa 🔴 — medir); (ii) anual com desconto; (iii) **Pro atual R$ 97 → grandfathering** para quem já paga (D9); (iv) valores acima **precisam de teste de disposição a pagar** com traders reais antes de publicar.

### J.3 O que **não** fazer
Cobrar por "sinal"; prometer rentabilidade; esconder o limite de IA (a dor nº 1 dos usuários de TraderSync é limite opaco/baixo).

---

## K — Roadmap do MVP

### K.1 Estágios (tamanho relativo: S/M/L; **não** estimei calendário)
| Estágio | Entrega | Tamanho |
|---|---|---|
| **0 — Fundação (design, sem UI)** | modelo de dados fechado (C), spec de estratégia (JSON), contratos das ferramentas, eval harness com **seus trades reais**, medição de tokens | M |
| **1 — "O agente conhece meu trading" (MVP 1)** | ingestão níveis 2/3/4 (mapper + `MappingProfile` + print + manual); `TradeV2` aditivo + backfill; **Ficha do trader** + memória (propor→confirmar); agente com **tools de leitura/estatística**, evidência `[evid]`, protocolos de dados insuficientes/ambiguidade; **Analyzer** (regra seguida/violada); créditos + medidor | L |
| **2a — Pesquisa sobre os próprios trades** | hipóteses/experimentos; `run_slice_test`; robustez-lite (OOS por data, top-N, bootstrap/IC, **contagem de testes**); Caderno de pesquisa; **Pre-trade v1** (checklist contra o playbook) | M |
| **2b — Laboratório de backtest** | worker Python (Railway) + jobs; motor próprio (OHLCV 1m/5m); dataset **trazido pelo usuário**; walk-forward/Monte Carlo; backtest × real | L |
| **3 — Ampliar** | conexões automáticas escolhidas **por demanda**; dataset licenciado (se jurídico OK); tick/slippage (Nautilus); alertas pré-sessão; app/PWA | L+ |

**Por que 2a antes de 2b:** entrega "descobrir o que funciona" **sem licença de dado** e **valida o fluxo hipótese→conclusão→memória** com usuários reais antes de investir no engine.

### K.2 Riscos principais
1. **Licença/custo de dados** (G.1). 2. **Qualidade da ingestão** (se `stop`/R vierem vazios, o agente pesquisa pouco) — mitigação: pedir só o que falta, mapper com memória, meta de completude. 3. **Alucinação** — verificador numérico + eval. 4. **Custo de IA fora de controle** — créditos + hard stop + cache. 5. **Expectativa:** "IA que acha edge" — posicionamento e UX honestos. 6. **Regulatório (CVM) não pesquisado** (L). 7. **Overengineering** — cada estágio acima só começa com o anterior validado por usuários.

### K.3 Decisões que preciso de você (com minha recomendação)
| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| **D1** | Onde roda backtest/ingestão pesada | A) tudo Vercel · B) **worker Python no Railway + jobs no Postgres** | **B** |
| **D2** | Dados de mercado | A) do usuário + trades · B) licenciado (Databento etc.) | **Revisada na seção M.17:** Databento PAYG (crédito grátis) p/ dev/MVP, uso **só interno**, com **resposta escrita** da Databento; slice-test nos trades do usuário continua sendo o Estágio 2a |
| **D3** | Engine | A) **próprio fino** · B) VectorBT · C) Nautilus · D) LEAN | **A** (+B p/ varredura; C só p/ tick) |
| **D4** | Memória | A) **Postgres estruturado + pgvector p/ texto livre** · B) vector DB externo | **A** |
| **D5** | Schema | A) **TradeV2 aditivo + backfill** · B) reescrever | **A** |
| **D6** | 1º conector automático | NT8 AddOn (reviver) · Tradovate · Rithmic CSV→Drive · cTrader · cripto | **Só decidir depois do Estágio 1**, com dado de qual plataforma seus usuários usam (você sabe isso melhor que eu: **qual são as 3 mais usadas?**) |
| **D7** | Provedor de IA | A) **Anthropic + roteamento** · B) multi-provedor já | **A** (com abstração) |
| **D8** | Preços | decidir agora vs testar | **testar** com traders reais |
| **D9** | Base atual de assinantes | grandfathering do Pro R$ 97? migração de limites da Vega | **grandfathering** |
| **D10** | Jurídico | disclaimers + checagem CVM antes de lançar "agente" | **pesquisar antes do lançamento** |

---

## M — MARKET DATA & BACKTESTING (investigação de 01/10/2026)

> Objetivo: dado histórico **para uso interno em backtests** (o usuário não recebe barras brutas). Cada fonte foi lida no repositório/site/termos; onde a página não carregou ou o termo é ambíguo, marquei **INCERTO** e **não** assumi autorização.
> Legenda: 🟢 lido na fonte primária · 🟡 fonte secundária/resumo · 🔴 premissa/estimativa minha.

### M.1 O que a investigação mudou no plano (resumo)
1. **Dos 5 alvos que você trouxe, só um é fonte utilizável de verdade (MarketParquet) — e mesmo ele tem ressalvas.** Os outros 4 são: código sem licença/dados de origem não autorizada (cme-futures-ohlc), repositório **sem dados** (nq-futures), projeto de **referência de engenharia** sem dados de índice (market-microstructure-bar-engine) e um catálogo grátis cuja **proveniência e licença de exchange não estão declaradas** (London Strategic Edge).
2. **Achado jurídico central (🟢/🟡):** a Databento afirma que **dado histórico (>24 h) não exige licença de exchange**, e que usuários podem usar os dados **para qualquer finalidade interna, comercial ou não**. A **exceção é CME (e ICE): restringe *redistribuição* de histórico.** Isso casa com o seu caso: **usar internamente para computar backtests ≠ redistribuir barras.**
3. **Armadilha técnica que ninguém mencionou: série contínua "ratio back-adjusted"** (usada pelo MarketParquet) **muda o nível absoluto de preço no passado**. Stops/alvos em **pontos** (ex.: "stop de 15 pontos") ficam errados em dados antigos. Para estratégias em pontos/ticks precisamos de **preços reais (não ajustados)** + tabela de rolagem, ou refazer a série nós mesmos.
4. **MNQ e MES não precisam de dado próprio:** acompanham o mesmo índice de NQ/ES (só mudam multiplicador e liquidez). Dá pra testar "MNQ" com barras de NQ trocando o valor do ponto (🔴 pequena diferença de microestrutura; MNQ existe desde 2019).
5. **Para as perguntas que você listou, barras de 1 minuto bastam** (ORB 10:30–11:30, stops 10/15/20/25, alvos 1/1,5/2R, dia da semana, horário, regimes de volatilidade, walk-forward, Monte Carlo). **Tick não é necessário no MVP.**
6. **Cenário econômico viável:** **US$ 0 a ~US$ 80 de dado** no desenvolvimento e MVP (Databento com US$ 125 de crédito grátis, pago-por-uso; ou pacotes de arquivo de pagamento único), sem assinatura mensal de dado.

### M.2 Fontes investigadas — achados por fonte

**1) `axb0306/cme-futures-ohlc`** (🟢 README)
- **O que é:** 51 futuros CME/COMEX/NYMEX/CBOT (inclui **NQ, MNQ, ES, MES**, YM, RTY, GC, CL, FX, juros, grãos). **8 timeframes** (tick-bar, 1m, 5m, 15m, 30m, 1h, 4h, 1d), **CSV** `datetime,open,high,low,close,volume`, **UTC**, atualização noturna por cron em VPS.
- **Origem:** *"All data is from TopstepX via the ProjectX Gateway API"* — o script exige **credenciais próprias** do usuário (`config.json`).
- **Não informa:** profundidade de histórico, tratamento de contratos/rolagem, tamanho, **licença, termos dos dados**. **Sem arquivo de licença** (19 estrelas, 27 commits).
- **Contexto da origem (🟡):** a ProjectX virou **exclusiva da Topstep desde 28/02/2026**; a API custa **US$ 29/mês**; `retrieveBars` limita **20.000 barras/requisição** e **50 req/30 s** (🟡). Não consegui ler os Termos da ProjectX (HTTP 403).
- **Avaliação:** quem publicou **raspou dados licenciados de uma plataforma de terceiros e republicou no GitHub** — exatamente o tipo de caso em que "público no GitHub" **não** significa "livre". **Não usar como fonte.** Útil apenas como **ideia/estrutura de pastas** e como evidência de que a API da ProjectX entrega 1 m/tick-bars.

**2) London Strategic Edge (LSE)** (🟢 site + README do `lse-data`; 🟡 buscas)
- **Alegação:** *"133 bilhões de ticks, 118.000 datasets, 27 classes de ativos"*; ações (desde 2003), forex (2009), cripto (2017), opções (2014), **54 futuros**; candles em **14 resoluções** (1s…1mo), **tick via "vault"**; **Parquet ou CSV** com **uma chave grátis**; API REST/WebSocket; **limite grátis: 10 downloads/hora, até 1.000.000 linhas cada**.
- **Termos que consegui ler (README):** o cliente é **MIT**; dados *"podem ser usados para sua própria pesquisa, trading e treino de modelos, **inclusive para fins comerciais**"*, mas **não podem ser redistribuídos, revendidos ou disponibilizados a terceiros**, nem via feed/download/interface concorrente.
- **O que NÃO consegui confirmar:** a página de **Termos completos não carregou** (conteúdo dinâmico). **Quais futuros** existem: uma issue pública (#11) menciona **NQ.F e ES.F** e **pergunta justamente "qual é a fonte e a licença da exchange" e se são séries contínuas ou front-month — sem resposta, aberta**. **MNQ/MES: não confirmado.** Proveniência: só diz que sai do "LSE vault" (ClickHouse próprio).
- **Avaliação:** **promissor para protótipo** (grátis, Parquet, API), mas **proveniência não declarada** + limite de 10 downloads/h + futuros não documentados ⇒ **INCERTO para produção**. Se usar, tratar como "fonte experimental", com `license_status = pending`.

**3) `apointandaline/nq-futures`** (🟢)
- É um **app de barras/gráfico sobre tick de NQ** (CSV `;`, registros Tipo 1 quote/Tipo 2 trade, timestamp com microssegundos, barras 233T/500T/1000T e 1m–diário).
- **Os dados NÃO estão no repositório** (aponta para `R:\Futures Data\NQ - Tick Chart`, disco local do autor); fala em "centenas de milhões de ticks" mas **sem fonte, qualidade, gaps ou rolagem**. **Sem licença**, 1 commit, 1 estrela.
- **Avaliação:** **não é fonte de dado.** Serve só como referência do *formato* de tick exportado por plataformas.

**4) `Tejemouti/market-microstructure-bar-engine`** (🟢)
- Motor **Numba** que gera barras **Time/Tick/Volume/Dollar/CME-Daily** a partir de ticks, **~1,8 M ticks/s** (vs ~2,4 mil/s na abordagem ingênua, segundo o README) + **simulador de execução** (limit "trade-through", **stop-first** em conflito, fila de prioridade p/ slots de portfólio). **Licença MIT.** **Parquet com partição Hive.**
- **Dados:** os **~296 M de ticks são de futuros de moeda CME (6E, 6B, 6J, 6C, 6S, 6N)** — **não NQ/ES** — e **não estão no repo**; só um `sample_cme_ticks.parquet` (<1 MB). Período não informado. **1 commit, 0 estrelas.**
- **Avaliação:** **não é fonte de dado**; **é boa referência de engenharia** (conceito de barras alternativas, regra "stop primeiro", Parquet particionado, Numba). Código MIT permite estudar/adaptar, mas **maturidade mínima** → **não depender**; reescrever o que precisarmos.

**5) MarketParquet** (🟢 site, `/license`, `/data-quality`)
- **Cobertura:** "Futures" como classe; **históricos de 2007-12-31 a 2026-09-30**; **1min, 5min, 30min, 1h e diário**; **~21.000 símbolos** (ações com deslistadas), futuros como **contínuos "ratio back-adjusted"** sob símbolos-raiz (ES, CL, GC aparecem como exemplo). **NQ/MNQ/MES: não confirmados nas páginas que li** (a página de símbolos retornou 404).
- **Formato:** Parquet (snappy), "pandas/Polars/DuckDB ready". **Timestamps US/Eastern, sem timezone, marcando a abertura da barra**; futuros 00:00–23:59 ET. *"Sem barras sintéticas, nada forward-fill."* Fonte: *"um provedor institucional"* (**não nomeado**).
- **Preço:** **arquivo completo US$ 79 (pagamento único)**; **+US$ 15/mês** só se quiser atualização diária ("Keep Current"). **Grátis:** diário dos últimos 7 dias + pacote de amostra (1 semana, 30 símbolos).
- **Licença (citações):** permitido *"backtest, model, analyze — commercially or otherwise"*; *"armazenar cópias nos seus servidores e nuvem privada"*; *"alimentar modelos de IA e agentes de código que você opera"*; permitido **publicar resultados derivados** (gráficos, estatísticas, desempenho de estratégia). **Proibido:** redistribuir os arquivos brutos, **oferecer os dados (ou cópia trivialmente transformada) como dataset, API ou download a terceiros**.
- **Avaliação:** **a licença mais clara de todas as gratuitas/baratas e compatível com o nosso uso interno.** Pendências: (i) **confirmar NQ/MNQ/ES/MES e histórico por símbolo**; (ii) **série ajustada por razão** (ver M.1-3); (iii) **cadeia a montante** (o vendor tem direito de CME para revender histórico? **INCERTO**); (iv) tick **não** disponível.

### M.3 Outras fontes encontradas
| Fonte | O que oferece | Licença/uso comercial interno | Veredito |
|---|---|---|---|
| **Databento** 🟢 | CME Globex MDP 3.0 **direto da fonte**: **tick (trades), MBP, MBO, OHLCV 1s/1m/1h/1d**, ns UTC, simbologia contínua; **16+ anos** de OHLCV no plano Standard; **pago-por-uso a partir de US$ 0,50/GB**; **US$ 125 de crédito** (6 meses); **Standard US$ 199/mês** | 🟡 Databento: *"licença não é necessária para histórico"*; uso **interno** (display e não-display) permitido; **redistribuição de histórico CME é restrita** → **Plus (US$ 1.750/mês) tem direitos de distribuição externa** | **Melhor candidata para produção**; **melhor opção p/ desenvolver** (crédito grátis, API, cobre tick) |
| **FirstRate Data** 🟢 (FAQ + página NQ) | Futuros "most active" (**130 contratos**): **1m/5m/30m/1h/diário**, **de 2008 a hoje**, **contratos individuais + 3 contínuos (não-ajustado, absoluto, razão)**; CSV zip; **fuso ET**; **sem tick de futuros**; atualização US$ 59–119/mês (bundle) / US$ 99,95/ano (por dataset) | 🟢 *"A licença permite trabalhos derivados e **uso comercial** de todos os datasets. **Não** permite redistribuir o dado bruto"*; **inclui treino de IA**; múltiplos usuários só dentro da mesma empresa | **Ótima p/ MVP:** traz **não-ajustado** (certo p/ stops em pontos). **Preço de compra do NQ/bundle não consegui ler** (página falhou) — **cotar** |
| **Kaggle** (NQ 1m 2022–2025, ~1,05 M linhas; outros) 🟡 | datasets de usuários, "obtidos do TradingView" | termos do TradingView proíbem raspagem/redistribuição → **NÃO** | só para **testar parser**, nunca produção |
| **Hugging Face — amostra "equity index futures"** 🟢 | NQ/ES/RTY/HSI, minuto + diário, 904.659 obs.; **licença "other"**; **amostra de avaliação** de produto pago | **INCERTO**; "para inspeção de esquema/integração" | bom p/ **teste de integração**, não para pesquisa |
| **Yahoo, Stooq, TurtleTrader, Investing** 🟡 | **só diário**, rolagem pouco documentada | termos pessoais | **inadequado** (sem intraday) |
| **Barchart** 🟡 | até ~10 anos de 1 m para download | termos pessoais | **NÃO** assumir uso comercial |
| **Dukascopy** (forex/metais/índices), **Binance Public Data** (cripto) 🟡 | tick/1m gratuitos | **INCERTO**: ferramentas são MIT, **dados têm termos próprios**; issues abertas no repo da Binance perguntando justamente sobre **uso comercial em SaaS** | só se um dia entrarem forex/cripto |
| **Dados do próprio usuário** (NT8, Rithmic, Tradovate, TradingView) | candles/tick exportados | **só para aquele usuário** — termos de Kinetick/CQG/etc. costumam ser pessoais; **não** pode virar base compartilhada | complemento opcional |
| **Polygon/Massive, Tiingo, Alpaca, Nasdaq Data Link, CME DataMine, TickData, Portara, Norgate, AlgoSeek** | — | **não investiguei** | ver L |

### M.4 Tabela comparativa pedida
`✓` confirmado · `~` não confirmado/parcial · `✗` não · `n/a`

| Fonte | NQ | MNQ | ES | MES | Tick | 1m | Histórico | API | Download | Gratuito | Uso comercial (interno) | Licença clara |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cme-futures-ohlc | ✓ | ✓ | ✓ | ✓ | "tick-bar" (não trades brutos) | ✓ | **não informado** | ✗ (script c/ credencial ProjectX) | ✓ git/CSV | ✓ | **NÃO/INCERTO** | **NÃO** |
| London Strategic Edge | ~ (NQ.F citado) | ~ | ~ (ES.F) | ~ | ~ ("tick vault", futuros não confirmado) | ✓ | futuros **não informado**; ações 2003+ | ✓ REST/WS | ✓ Parquet/CSV | ✓ (10 dl/h) | **INCERTO** (README ok; ToS/proveniência não) | **INCERTO** |
| nq-futures | só código | ✗ | ✗ | ✗ | (dados **não incluídos**) | n/a | n/a | ✗ | ✗ | ✓ código | **NÃO** | **NÃO** |
| market-microstructure-bar-engine | ✗ | ✗ | ✗ | ✗ | só FX futures (**não incluídos**) | n/a | n/a | ✗ | só amostra <1 MB | ✓ código MIT | n/a (código OK) | ✓ MIT (código) |
| MarketParquet | ~ | ~ | ~ (ES citado) | ~ | ✗ | ✓ | 2007–2026 (arquivo; por símbolo ~) | ✗ (arquivos) | ✓ | parcial (7 dias+amostra) | **OK** | **✓** (dado) |
| FirstRate Data | ✓ | ✓ | ~ | ~ | ✗ (futuros) | ✓ | **2008–hoje** | ✗ | ✓ CSV zip | ✗ (pago) | **OK** | **✓** |
| Databento | ✓ | ✓ | ✓ | ✓ | ✓ (trades/MBP/MBO) | ✓ | **16+ anos** (🟢 site) | ✓ | ✓ | crédito US$ 125 | **OK** (🟡 confirmar por escrito) | ✓ (restrição CME p/ redistribuir) |

### M.5 Tabela técnica por fonte
| Fonte | Origem | Qualidade / gaps | Contratos contínuos | Fuso | Sessão | Volume | OI | Bid/Ask | Trades | Book | Tamanho (🔴 est.) | Formato | Ingestão |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cme-futures-ohlc | TopstepX/ProjectX API | não declarada | não informado | UTC | ETH (24 h) | ✓ | ✗ | ✗ | ✗ | ✗ | ? | CSV | fácil |
| LSE | "LSE vault" (ClickHouse próprio) | não declarada | **não declarado** | ? | ? | ? | ? | ? | tick (~) | ? | ? | Parquet/CSV | média (limite 1M linhas/slice) |
| MarketParquet | "vendor institucional" (exchange trade feeds) | **"sem barras sintéticas, sem forward-fill"**, QA por gates | **contínuo ratio-adjusted** | **ET sem tz** (open da barra) | futuros 24 h | ✓ | ✗ | ✗ | ✗ | ✗ | NQ 1m 15 anos ≈ 5 M linhas ≈ 50–100 MB Parquet | Parquet | **fácil** (Polars/DuckDB) |
| FirstRate | "direto das bolsas quando possível; senão vendors enterprise" | contratos individuais + 3 contínuos | **3 tipos** (incl. não-ajustado) | **ET** | ? | ✓ | ✗ (🔴) | ✗ | ✗ (futuros) | ✗ | NQ 1m ≈ 5 M linhas ≈ 230 MB CSV | CSV zip | **fácil** |
| Databento | feed **direto CME MDP 3.0** | timestamps ns PTP, completo | simbologia **contínua** (calendário/volume/OI) + por contrato | **UTC ns** | 24 h | ✓ | via definições | ✓ (MBP-1) | ✓ | ✓ (MBO) | 1m: pequeno; **tick NQ: GBs/ano** | DBN / CSV / Parquet | fácil (SDK Python) |

### M.6 Classificação de licença (A–E) — **OK / NÃO / INCERTO**
| Fonte | A. Código open source | B. Dado público | C. Pessoal | D. **Comercial interno** (nossos cálculos/backtests) | E. Redistribuir bruto |
|---|---|---|---|---|---|
| cme-futures-ohlc | **NÃO** (sem licença ⇒ todos os direitos reservados) | sim (GitHub) | INCERTO | **NÃO/INCERTO** (dado vem de plataforma privada; termos não lidos) | **NÃO** |
| LSE | OK (cliente MIT) | sim, com chave grátis | OK | **INCERTO** — README permite "inclusive comercial", mas ToS completo não lido e **proveniência/licença de exchange não declarada** | **NÃO** |
| nq-futures | **NÃO** (sem licença) | **dado inexistente no repo** | — | — | — |
| bar-engine | **OK (MIT)** | só amostra | — | n/a (sem dado útil) | n/a |
| MarketParquet | n/a | parcial (7 dias) | OK | **OK** (citação expressa; inclui SaaS/IA internos) + **cadeia a montante INCERTA** | **NÃO** (derivados/estatísticas **OK**) |
| FirstRate | n/a | pago | OK | **OK** (citação expressa) + cadeia a montante parcialmente declarada | **NÃO** (derivados OK) |
| Databento | n/a (SDK Apache/MIT 🔴) | pago/crédito | OK | **OK** 🟡 (confirmar por escrito) | **NÃO p/ CME** sem Plus |

**Regra operacional:** cada dataset no sistema recebe flags **`allow_internal_backtest`**, **`allow_display_raw`**, **`allow_redistribute`** (todas `false` por padrão) e `license_status` (`ok | pending | blocked`). O agente/UI **só expõe barras brutas se `allow_display_raw` = true**; mostrar **derivados** (métricas, equity, trades simulados) segue a cláusula de cada licença. *(Cuidado: um gráfico de candles com 1 mês de histórico já é "dado bruto" na prática — tratar como display.)*

### M.7 Fontes gratuitas × pagas — leitura honesta
- **Grátis utilizável com segurança jurídica: praticamente nenhuma para NQ/ES.** As "grátis" ou (i) não têm licença (GitHub), (ii) não declaram origem (LSE) ou (iii) violam termos de origem (Kaggle/TradingView).
- **Baratas e com licença clara:** MarketParquet (**US$ 79 único**) e FirstRate (**preço a cotar**; atualização US$ 59–119/mês no bundle ou US$ 99,95/ano por dataset).
- **Cadeia mais limpa:** **Databento** (direto da bolsa): **pague pelo que baixa** + crédito de US$ 125 (🟢) — para **barras de 1 m de poucos símbolos**, o custo de download fica **na casa de centavos a poucos dólares** (🔴 estimativa; **a calculadora de custo da API dá o número exato antes de baixar**).

### M.8 Recomendações
- **Melhor para DESENVOLVER (agora):** **Databento pago-por-uso com o crédito grátis** → baixar **NQ, ES, MNQ, MES em OHLCV-1m** (por contrato + definições) **e uma amostra de tick de NQ (poucos meses)** para validar o motor. **Por que:** cadeia de dados mais limpa, **sem assinatura**, **cobre tick** para o futuro, reproduzível por API. **Ressalva:** confirmar por escrito o "uso interno comercial + armazenamento + resultados derivados".
- **Alternativa/complemento barato para MVP:** **FirstRate** (não-ajustado + contratos individuais, ET) **ou MarketParquet** (Parquet pronto, **mas ratio-adjusted**).
- **Melhor POTENCIAL para PRODUÇÃO:** **Databento** (Standard, US$ 199/mês, se a escala justificar; **Plus US$ 1.750** só se um dia formos **exibir/distribuir** barras). Com a **camada desacoplada (M.10)**, trocar de fornecedor não afeta engine nem agente.
- **LSE:** manter como **fonte experimental** de forex/cripto/macro (quando fizer sentido) — **não** ancorar o núcleo nela até a proveniência ser esclarecida (**vale escrever pra eles perguntando o que a issue #11 já pergunta**).
- **Descartar como fonte:** cme-futures-ohlc, nq-futures, Kaggle/Barchart. **Estudar como referência:** market-microstructure-bar-engine.

### M.9 Riscos jurídicos / licenciamento
| Risco | Gravidade | Mitigação |
|---|---|---|
| Republicar/mostrar histórico CME a usuários (**restrição CME**; licença de distribuição histórica citada a **US$ 30.000/ano por DCM**, 🟡 2021) | **Alta** | `allow_display_raw=false`; só derivados; **resposta escrita** de Databento/CME antes de qualquer exibição |
| Cadeia a montante dos vendors baratos (MarketParquet/FirstRate/LSE) — o vendor tem direito de revender? | Média | preferir fonte direta (Databento); guardar contrato/ToS e **hash do ToS vigente** por dataset |
| Usar dado raspado (cme-futures-ohlc/Kaggle) | **Alta** (reputacional + legal) | **não usar** |
| Mudança de preço/termos (Databento alterou plano em 22/06/2026) | Média | camada desacoplada + cache próprio dos arquivos adquiridos |
| Exibir "resultados derivados" demais (ex.: reconstruir barras a partir de trades simulados) | Média | revisar caso a caso; nunca devolver séries reconstruíveis |
| Usar dado de um usuário para outro | Média | dados do usuário ficam **isolados** por `userId` |

### M.10 Arquitetura recomendada (desacoplada e trocável)
```
 FONTES (adapters)                    CAMADA DE DADOS                          EXECUÇÃO                RESULTADO
┌────────────────────┐       ┌────────────────────────────────────┐     ┌───────────────────┐   ┌───────────┐
│ DatabentoAdapter   │       │ Dataset Registry (Neon)            │     │ Backtest Worker   │   │ Neon      │
│ FirstRateAdapter   │ ───►  │  provider · licença (flags) ·      │ ──► │ (Python, Railway) │──►│ runs ·    │──► Research Agent
│ MarketParquetAdp.  │       │  cobertura · hash · versão         │     │ DuckDB/Polars lê  │   │ métricas ·│     (só vê derivados)
│ UserFileAdapter    │       │ Canonical Bars (Parquet, R2)       │     │ Parquet + engine  │   │ evidência │
│ LSEAdapter (exp.)  │       │  particionado por símbolo/ano      │     └───────────────────┘   └───────────┘
└────────────────────┘       │ Contract/Roll table · Instrument    │
        ▲                    └────────────────────────────────────┘
   trocar de fornecedor = trocar adapter + re-ingestão, **nada mais muda**
```
- **Contrato de dados canônico** (o que o engine enxerga, independente do fornecedor): `ts_utc`, `contract_id`/`root`, `open/high/low/close`, `volume`, `session_flag`, (opcional) `bid/ask`, `ticks`; **preços não ajustados** + **tabela de rolagem** (`roll_ts`, de→para, regra); metadados `provider`, `dataset_version`, `license_flags`.
- **Série contínua construída por nós** (regra de rolagem escolhida pelo usuário/padrão: volume ou data) ⇒ níveis reais de preço (certo p/ pontos) e reprodutibilidade; ajustes por razão só como **visão opcional** p/ retorno percentual.
- **Interface `MarketDataProvider`** (`get_bars(root, tf, start, end, adjust="none")`, `coverage()`, `describe_license()`) usada por engine **e** pelo `check_data_availability` do agente — **o agente nunca cita fornecedor**, só "dados disponíveis: NQ 1m, 2015–2026".
- **Portão de licença** na camada de ferramentas: bloqueia `allow_display_raw=false` para qualquer saída que exponha barras.
- **Validação de qualidade usando os dados reais do trader:** conferir se **preço e horário dos fills do usuário caem dentro da barra correspondente** (high/low); divergência sistemática ⇒ problema de fuso/rolagem/dataset. *Isso também alimenta o diferencial "seus 143 trades × 5 anos de histórico".*
- **Fuso:** guardar **UTC** e converter na borda; datasets ET-naive (MarketParquet/FirstRate) exigem tratamento de **DST** explícito (🔴 fonte comum de bug).

**Esta arquitetura (Parquet → DuckDB/Polars → worker → Neon) faz sentido?** **Sim**, com ressalvas honestas:
| Pergunta | Resposta |
|---|---|
| Por que não Neon p/ barras? | 🔴 **1 m de 5 símbolos × 15 anos ≈ 25 M linhas ≈ 2–3 GB com índices** (≈ US$ 1/mês de storage a US$ 0,35/GB) — **cabe**, mas cada backtest faria varreduras de milhões de linhas pela rede e consumiria **CU-horas** (US$ 0,106/CU-h). **Tick (centenas de milhões) não cabe.** Parquet em objeto + leitura local no worker é **mais rápido e mais barato**, e **isola** o dado licenciado do banco transacional. |
| DuckDB × Polars? | Ambos MIT 🟡. DuckDB: **limita memória** (bom em Railway cobrado por GB) e lê Parquet com *pushdown*; **leitura direta de S3 pode gerar muitas requisições HTTP** e ficar lenta 🟡 ⇒ **baixar/cachear o Parquet no volume do worker** e ler local. Polars: ótimo p/ transformação/laços; consome mais memória em arquivos enormes. **Plano:** DuckDB p/ filtrar/agregar, Polars/Numba p/ simulação. |
| Onde guardar? | **Cloudflare R2**: **US$ 0,015/GB-mês, egress grátis**, 10 GB grátis (🟡) ⇒ 10 GB de Parquet ≈ **US$ 0/mês**. |
| Resultado onde? | **Neon** (só **derivados**: runs, métricas, trades simulados, evidência) — pequeno e transacional. |

### M.11 Formatos — trade-offs
| Formato | Prós | Contras | Uso aqui |
|---|---|---|---|
| **CSV** | universal, fácil de depurar, é o que vendors entregam | grande (~4–5× o Parquet), lento, sem tipos | **entrada** (staging); nunca consultar direto |
| **Parquet** | colunar, comprimido, tipado, *predicate pushdown*, padrão de fato; Hive-partition | não é "banco" (sem updates pontuais) | **formato canônico** de barras/ticks |
| **DuckDB** (arquivo/embutido) | SQL sobre Parquet, memória limitada, rápido, sem servidor | mono-escritor; S3 direto pode ser lento | **motor de consulta** no worker |
| **Timescale/Postgres** | SQL, integra com o resto, bom p/ séries moderadas | custo/IO de milhões de linhas; ticks inviáveis em Neon; exigiria extensão/outro host | só se precisarmos de consulta online de barras recentes |
| **Object storage (R2/S3)** | barato, durável, egress grátis (R2), versionável | latência; precisa de cache local | **armazém** dos Parquets + manifest/hash |

### M.12 Backtest engine — comparação (agora com o seu checklist)
Legenda: ✓ nativo · ~ parcial/via código nosso · ✗ não · ? não verificado 🔴 (conhecimento prévio; **validar em protótipo**).

| Engine | Licença (uso em SaaS) | Velocidade | Tick | Intraday/Futuros | Slippage/comissão | Stop/alvo/trailing | Walk-forward / Monte Carlo / otimização | Rodar no Railway | Manutenção | Integração c/ agente |
|---|---|---|---|---|---|---|---|---|---|---|
| **VectorBT** | Apache-2.0 + **Commons Clause** (🟡: ok embutir; não revender "só ele") | **muito alta** (vetorizado/Numba) | ~ | ~ (sem noção nativa de tick/valor do ponto) | ✓ (taxas/slippage) | ✓ (sl/tp/trailing, 🔴) | otimização ✓; WF/MC **~** (mais no PRO ≈ US$ 150/mês 🟡) | ✓ | **OSS parado >1 ano** (🟡) | média: código Python gerado ⇒ **não executar código de LLM** |
| **Backtrader** | **GPL-3.0** (🟡) ⇒ **evitar** em produto fechado | baixa | ✗ | ~ | ✓ | ✓ | WF manual | ✓ | "manutenção" (🟡) | baixa |
| **Zipline-reloaded** | Apache-2.0 (🟡) | média | ✗ | foco ações/diário | ✓ | ~ | ✗ | ✓ | ativo (🟡) | baixa p/ futuros |
| **backtesting.py** | **AGPL-3.0** (🟡) ⇒ **evitar** | média | ✗ | 1 instrumento | ✓ | ✓ | otimização ✓ | ✓ | ativo | baixa |
| **LEAN (QuantConnect)** | **Apache-2.0** (🟡) | alta | ✓ | **✓ futuros** | ✓ modelos de fill | ✓ | ✓ (via framework) | **pesado** (C#/.NET, dados no formato LEAN) | ativo | média; **exagero p/ MVP** |
| **NautilusTrader** | **LGPL-3.0** (🟡) | **muito alta** (Rust) | **✓ (tick/book)** | **✓** | ✓ avançado | ✓ | ~ (nosso código) | ✓ | **muito ativo** (🟡) | média; curva alta |
| **Engine próprio** (Polars/Numba, barras 1 m) | **nossa** | alta (≈ 5 M barras em segundos, 🔴 medir) | ✗ (fase 3) | ✓ **modelado p/ futuros** (tick, valor do ponto, comissão, sessão, rolagem) | ✓ (ticks de slippage, comissão/RT) | ✓ (inclui regra "stop-first" na mesma barra) | WF ✓ · MC ✓ · grade de parâmetros ✓ (nós escrevemos) | ✓ leve | **depende de nós** | **a melhor**: spec JSON → engine; **zero código gerado executado** |
| *(radar)* **Ziplime** (Zipline sobre Polars, com **MCP p/ agentes**; ações/ETFs/futuros) | **não verificada** | ? | ? | ~ | ? | ? | ? | ? | novo | interessante p/ observar |

**Recomendação (evidências, não "use X"):**
1. As perguntas do MVP (ORB em janela horária, stops/alvos em pontos/R, cortes por dia/hora/volatilidade, WF e Monte Carlo) são **barras de 1 min + regras declarativas**. Isso é um laço simples; **o difícil é o que é específico de futuros** (valor do ponto, tick, comissão por lado, sessão, rolagem, ordem stop×alvo dentro da barra) — **e isso nós precisamos modelar de qualquer jeito**, em qualquer lib.
2. **Segurança:** as libs genéricas assumem **código Python de estratégia**. Nosso agente emite **spec JSON** — um engine que **só entende a spec** elimina execução de código gerado.
3. **Licença:** GPL (Backtrader) e AGPL (backtesting.py) são **fricção jurídica** num SaaS; VectorBT tem Commons Clause.
4. **Plano:** **engine próprio fino no Estágio 2b**, desenhado com **interface `Engine`** (`run(spec, bars, cost_model) → resultado`), para **plugar NautilusTrader (tick/slippage realista) no Estágio 3** sem tocar no agente. VectorBT só se precisarmos de varredura massiva (não parece o caso).

### M.13 Estimativa de armazenamento e custo (🔴 premissas explícitas)
**Linhas de 1 minuto (24 h × 5 dias):** ≈ 1.380/dia útil ≈ **~350 mil por ano por símbolo**.
| Conjunto | Linhas | Parquet (≈ 10–20 B/linha, zstd) | CSV (≈ 45 B/linha) | R2 (US$ 0,015/GB) |
|---|---|---|---|---|
| NQ 1m, 15 anos | ~5,2 M | **~50–100 MB** | ~230 MB | < US$ 0,01 |
| NQ+ES+MNQ(2019+)+MES(2019+), 1m | ~13 M | **~130–260 MB** | ~600 MB | < US$ 0,01 |
| + contratos individuais (p/ rolagem), 5 anos extras de bordas | +30–50% | +~100 MB | — | desprezível |
| **Tick NQ, vários anos** | **centenas de M de trades** (o repo nq-futures cita "centenas de milhões") | **~3–10 GB** (🔴) | dezenas de GB | ~US$ 0,05–0,15/mês |
| Neon se colocássemos **1 m** (25 M linhas c/ índices) | — | **~2–3 GB** | — | ~US$ 1/mês + CU-h de varredura |

**Custo de dado (US$):**
| Cenário | Desenvolvimento | MVP | Produção (escala) |
|---|---|---|---|
| **Databento PAYG** | **US$ 0** (crédito de US$ 125) | **~US$ 0–20** (1 m de 4 símbolos + reposições) 🔴 | **Standard US$ 199/mês** se usar atualização contínua / mais histórico incluído |
| **MarketParquet** | US$ 0 (amostra) | **US$ 79 único** (+US$ 15/mês só p/ atualização) | — (tick não tem) |
| **FirstRate** | — | **a cotar** (+ atualização US$ 59–119/mês bundle ou US$ 99,95/ano) | — |
| **Plus (distribuição externa)** | — | — | **US$ 1.750/mês** (só se exibirmos barras) |
| Armazenamento (R2) + worker | ~US$ 0 | ~US$ 0–1 + worker ~US$ 20 | ~US$ 20–100 |

### M.14 O cenário ideal de MVP — é possível começar muito barato?
**Sim:** `Databento (crédito grátis) → Parquet no R2 → DuckDB/Polars → engine próprio no Railway → Neon → agente` custa **~US$ 20–25/mês de infra + US$ 0–20 de dado**.
**As suas 9 perguntas de exemplo** cabem em **barras de 1 min** (🔴 a validar com protótipo e testes de reconciliação):
- *ORB 10:30–11:30, últimos 3 anos* → ~1 M barras · *stops 10/15/20/25 × alvos 1/1,5/2R* → **12 combinações** · *dia da semana / horário / volatilidade* → agrupamentos · *walk-forward / Monte Carlo* → **pós-processamento** das listas de trades.
- Limites: **intrabarra** (stop e alvo na mesma barra de 1 m ⇒ regra pessimista); slippage fixo em ticks; **sem fila/book** (isso é tick/Estágio 3).

### M.15 "Dados do trader × histórico externo" — o diferencial
Pipeline conceitual: `Trades reais do setup (N=143)` → **spec** do setup → **mesma spec no histórico (5 anos)** → compara **distribuições** (win rate, expectancy em R, horário, MFE/MAE) → resposta do agente: *"Em 143 trades seu setup deu +0,31R; no histórico, aplicando as mesmas regras, +0,12R com IC [−0,05, +0,29] — seu resultado está acima do que a regra sozinha explica; possível contribuição de execução/seleção"* (**honesto, com IC e contagem de testes**). Requer: mesmos `Instrument`/custos, **alinhar fuso/rolagem** e **validar fills × barras** (M.10).

### M.16 Plano de evolução
| Fase | Fonte | Camada | Engine |
|---|---|---|---|
| **P0 – validar** (dias) | Databento crédito grátis: NQ/ES/MNQ/MES 1 m + 2–3 meses de tick NQ | Parquet local → DuckDB; **teste de reconciliação com seus fills reais** | protótipo do engine (1 estratégia: ORB) |
| **P1 – MVP** | Databento PAYG (e/ou FirstRate/MarketParquet p/ comparar) | R2 + worker Railway; `Dataset Registry` + flags de licença | engine próprio (OHLCV 1 m) + suíte de robustez |
| **P2 – produção** | Databento Standard (se justificar) | atualização incremental diária; monitoramento de qualidade | + modelo de custos/slippage por horário |
| **P3 – avançado** | Databento tick/MBP | Parquet particionado de tick | **plug do NautilusTrader**; barras alternativas (referência: bar-engine) |
| **Se um dia exibirmos candles** | Databento **Plus** (US$ 1.750/mês) ou **acordo com CME** | gate de licença liberado por dataset | — |

### M.17 Decisões novas / ajustadas (para você)
| # | Decisão | Recomendo |
|---|---|---|
| **D2 (revisada)** | Fonte de dado de backtest | **Databento (PAYG + crédito)** p/ P0/P1; **cotar FirstRate** (não-ajustado) como 2ª fonte para **cross-check**; **não** usar cme-futures-ohlc/nq-futures/Kaggle |
| **D11** | Séries contínuas | **construir nós mesmos** (não-ajustado + tabela de rolagem), **não** depender de ratio-adjusted |
| **D12** | Licença | **mandar e-mail p/ Databento** (e guardar a resposta) cobrindo: uso interno comercial em SaaS, armazenamento em R2, resultados derivados exibidos a usuários; e **perguntar à LSE** o que a issue #11 pergunta |
| **D13** | Armazenamento | **Parquet em R2 + DuckDB/Polars no worker**; Neon só p/ derivados |
| **D14** | Teste de reconciliação | **usar seus trades reais (NT8/Rithmic) para validar o dataset antes de confiar nele** |

**Limitações específicas desta etapa:** não consegui ler (i) Termos da ProjectX/Topstep (403), (ii) Termos completos da LSE (conteúdo dinâmico), (iii) página de símbolos do MarketParquet (404), (iv) preço do pacote de futuros da FirstRate (500); **não baixei amostras** para auditar gaps/rolagens (🔴 próximo passo: baixar uma amostra de cada candidata e medir). **Reddit continua inacessível** ao meu crawler.

---

## L — Limitações desta pesquisa (leia antes de decidir)
- **Reddit foi inacessível** ao meu crawler; as "dores" vêm de Trustpilot, reviews e fóruns — **vale você (ou eu, via navegador) colher threads reais** de r/FuturesTrading, r/Daytrading etc. antes de fechar posicionamento.
- **Não pesquisei:** APIs/formatos do **ecossistema brasileiro** (Profit/Nelogica, Tryd, Clear/XP, B3) — relevante se parte do público operar WIN/WDO; **regulação CVM**; preço atual de Upstash/UploadThing; licenças de Backtrader/Zipline; **quais plataformas as mesas (Lucid, Tradeify, Bulenox…) usam hoje** após a saída da ProjectX; termos comerciais do cTrader Open API; **taxa cheia de cartão do Asaas** pós-promoção.
- **Não rodei benchmark** de engine nem medi tokens reais — os custos da seção H são **premissas explícitas** a validar no Estágio 0.
- Preços de IA fora da Anthropic e de concorrentes vêm de **sites secundários** (🟡); os da Anthropic vêm do **site oficial** (🟢). Preços de TradeZella: página oficial (🟢) e blogs (🟡).
- Câmbio, taxa de pagamento e imposto são **premissas minhas**.

---

## Fontes da seção M (market data & backtest)
- cme-futures-ohlc: https://github.com/axb0306/cme-futures-ohlc · London Strategic Edge: https://londonstrategicedge.com/ · https://github.com/londonstrategicedge/lse-data · https://github.com/londonstrategicedge/lse-data/issues/11
- nq-futures: https://github.com/apointandaline/nq-futures · bar engine: https://github.com/Tejemouti/market-microstructure-bar-engine
- MarketParquet: https://marketparquet.com/ · https://marketparquet.com/license · https://marketparquet.com/data-quality
- FirstRate: https://firstratedata.com/about/FAQ · https://firstratedata.com/i/futures/NQ · Hugging Face amostra: https://huggingface.co/datasets/lynx1231/historical-equity-index-futures-data-sample
- Databento: https://databento.com/pricing · https://databento.com/blog/understanding-exchange-fees · https://databento.com/blog/introduction-market-data-licensing
- ProjectX `retrieveBars`: https://gateway.docs.projectx.com/docs/api-reference/market-data/retrieve-bars/ · Binance public data (issues de licença comercial): https://github.com/binance/binance-public-data/issues/478
- R2: https://www.budgetforge.dev/tools/cloudflare-r2-pricing-2026 · DuckDB×Polars: https://www.codecentric.de/en/knowledge-hub/blog/duckdb-vs-polars-performance-and-memory-with-massive-parquet-data · Backtrader/Zipline licenças: https://pipekit.io/blog/python-backtesting-frameworks-six-options-to-consider

## Fontes principais
- Anthropic — preços: https://platform.claude.com/docs/en/about-claude/pricing · visão: https://platform.claude.com/docs/en/build-with-claude/vision
- TradeZella — planos: https://www.tradezella.com/pricing · TraderSync: https://www.stockbrokers.com/review/tools/tradersync · TradesViz: https://www.tradesviz.com/tradesviz-vs-tradersync/ · Tradervue/Edgewonk: https://www.stockbrokers.com/review/tools/tradervue
- TrendSpider: https://www.stockbrokers.com/review/tools/trendspider · QuantConnect: https://www.quantconnect.com/docs/v2/cloud-platform/organizations/tier-features · Trade Copilot: https://tradecopilot.app/ · TradingAgents: https://github.com/TauricResearch/TradingAgents · Tradelyze: https://tradelyze.io/
- Locais BR: https://trademind.portalapp.com.br/ · https://dtdotrader.com.br/ · https://tradediario.com.br/
- Tradovate API: https://community.tradovate.com/t/api-access-for-3rd-party-app-development/11941 · https://blog.pickmytrade.trade/tradovate-api-access-without-1000-minimum-2026-options/
- Rithmic: https://www.rithmic.com/apis · https://faq.ampfutures.com/hc/en-us/articles/360060137993-Rithmic-Pricing · TradesViz×Rithmic: https://www.tradesviz.com/blog/auto-import-rithmic/
- ProjectX/Topstep: https://blog.pickmytrade.io/topstepx-automation-2026/ · MetaApi: https://metaapi.cloud/ · IBKR: https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/ · cTrader: https://help.ctrader.com/open-api/ · SnapTrade: https://snaptrade.com/pricing
- BlackArrow export: https://www.tradesviz.com/brokers/BlackArrow
- Databento: https://databento.com/pricing · https://databento.com/blog/updates-to-subscription-pricing · https://databento.com/blog/understanding-exchange-fees · CME historical: https://www.cmegroup.com/market-data/distributor/files/cme-group-data-licensing-policy-guidelines-historical-information-distribution.pdf
- Engines: https://vectorbt.dev/terms/license/ · https://github.com/kernc/backtesting.py/blob/master/LICENSE.md · https://nautilustrader.io/legal/open-source-licensing/ · https://www.lean.io/
- Neon: https://comparedge.com/tools/neon-db/pricing · Railway: https://www.budgetforge.dev/tools/railway-pricing-2026 · Asaas: https://blog.asaas.com/taxas-asaas/ · Groq: https://www.cloudzero.com/blog/groq-pricing/
