# Lucid Trading — levantamento oficial (28/09/2026)

Passo 1 da seção "Mesas Proprietárias". **Fonte = só sites oficiais da Lucid.** Nada de guia de cupom / terceiros.

- Site: https://lucidtrading.com/#plans (planos e preços) — lido pelo Chrome (curl dá 403 Cloudflare).
- Help Center: https://support.lucidtrading.com/en/ — **abre por curl (200), 59 artigos**. É a fonte ideal pro cron.
- Texto bruto dos 59 artigos: `fontes/lucid-helpcenter-2026-09-28.txt` (baseline pro hash do cron). URLs em `fontes/lucid-helpcenter-urls.txt`.
- `verificadoEm`: 2026-09-28.

## 1. Os planos (4 públicos + 1 por convite)

Todos: tamanhos 25K / 50K / 100K / 150K · sem mensalidade · **taxa de ativação da financiada = grátis** · split **90/10** · 5 saques → entra na fila pra Live · plataformas: NinjaTrader, Tradovate, TradingView (CQG) e Rithmic (Quantower, MotiveWave, Sierra Chart, Bookmap, ATAS, R|Trader Pro, etc.).

| | **LucidPro** | **LucidFlex** | **LucidDaily** | **LucidDirect** |
|---|---|---|---|---|
| Ideia | Avaliação → financiada | Avaliação → financiada, regra mais simples | Avaliação → financiada com saque **diário** | **Pula a avaliação** (já entra financiada) |
| Drawdown | EOD | EOD | Aval: EOD **ou** Intraday (escolhe) · Financiada: **sempre Intraday** | EOD |
| DLL | Opcional (liga/desliga na compra) | Opcional | Opcional | 25K: nenhum · 50K+: DLL fixo até o "trail", depois LucidScale |
| Consistência (aval) | Não tem | 50% | 50% | — |
| Consistência (financiada) | **40%** | **Não tem** | **Não tem** | **20%** |
| Passa em 1 dia | Sim | 2 dias (cushion da consistência) | 2 dias | n/a |
| Saque | Meta de lucro + consistência + buffer | 5 dias com lucro mín. + lucro líquido > 0 | Lucro acima do buffer + lucro líquido > 0 | Meta de lucro + consistência 20% |
| Notícia (red folder USD) | Liberado | Liberado | **Proibido (breach)**: flat de 1 min antes a 1 min depois | Liberado |
| Escalonamento de lotes | Não | **Sim** | Não | Não |
| Financiada quebrada | reset só aparece documentado pra **avaliação**; pra financiada o Help Center não diz (doc antigo assumia "compra outra") — confirmar | idem | idem | idem |

### Números por tamanho (avaliação)

| Tamanho | Meta | Max Loss (MLL) | DLL (se ligado) | Lotes máx. |
|---|---|---|---|---|
| 25K | $1.250 | $1.000 | $600 | 2 mini / 20 micro |
| 50K | $3.000 | $2.000 | $1.200 | 4 mini / 40 micro |
| 100K | $6.000 | $3.000 | $1.800 | 6 mini / 60 micro |
| 150K | $9.000 | $4.500 | $2.700 | 10 mini / 100 micro |

Vale pra Pro, Flex e Daily. **Direct** tem MLL diferente: 25K $1.000 · 50K $2.000 · **100K $3.500** · **150K $5.000** (DLL 50K $1.200 · 100K $2.100 · 150K $3.000).

### Drawdown (todos os EOD)
- MLL sobe com o **maior saldo de fechamento do dia** até o "Initial Trail Balance"; depois trava em **saldo inicial + $100**.
- Trail balance: 25K $26.100 · 50K $52.100 · 100K $103.100 · 150K $154.600 (Direct 100K $103.600 · 150K $155.100).
- Flex: ao pedir saque, o MLL trava automaticamente.
- Tocou no MLL = conta quebrada.

### DLL
- **Soft breach**: bateu, fica travado até a próxima sessão; **não perde a conta**.
- Pro/Direct financiada: DLL fixo até passar o Initial Trail; depois vira **LucidScale DLL = 60% do maior lucro de fim de dia** (só sobe).
- Daily: DLL fixo ($600/$1.200/$1.800/$2.700) nas duas fases.

### Saques

| | Pro | Flex | Daily | Direct |
|---|---|---|---|---|
| Mínimo | $500 | $500 | $500 | $500 |
| Meta/critério | Lucro no ciclo: 25K $250 · 50K $500 · 100K $750 · 150K $1.000 | **5 dias** com lucro ≥ $100/$150/$200/$250 (25K/50K/100K/150K) + lucro líquido positivo | Lucro acima do buffer + lucro líquido positivo desde o último saque | Meta: 1º saque 25K $1.500 · 50K $3.000 · 100K $6.000 · 150K $9.000; depois $1.250/$2.500/$3.500/$4.500 |
| Consistência | 40% | — | — | 20% |
| Buffer | MLL inicial + $100 | **não tem** | MLL inicial + $100 | — |
| Máximo | 1º: 25K $1.000 · 50K $2.000 · 100K $2.500 · 150K $3.000. 2º+: $1.500 / $2.500 / $3.000 / $3.500 | **50% do lucro, até** $1.000 / $2.000 / $2.500 / $3.000 (não escala) | Todo o lucro acima do buffer. Teto de lucro no dia (25K $6.000 · 50K $8.000 · 100K $10.000 · 150K $12.000) → **vai pra Live** | Saques 1-3: $1.000 / $2.000 / $2.500 / $3.000 · 4-5: $1.000 / $2.500 / $3.000 / $3.500 |
| Nº de saques | 5 (site: "Payouts to Live: 5") | 5 | não informado (sem teto por pedido; vai pra Live pelo teto diário/critério de risco) | 5 |

- Pedido de saque é **final** (não edita nem cancela). Não operar entre pedir e processar (se cair no buffer, pode ser negado).
- Aprovado: sai da conta em minutos, cai **em até 2 dias úteis**. Sem janela fixa.
- Ciclo: os requisitos **zeram a cada saque**.
- Métodos: **Plaid** (só EUA, instantâneo) · **WorkMarket (ADP)** (EUA e internacional, banco ou PayPal, ~1 dia útil) · **Cripto** (internacional: BTC, ETH, LTC, USDT, USDC).
- Cadastro como empresa exige documentos; conta pessoal **não converte** pra empresa (e vice-versa). Só **1 perfil por trader**.

### Escalonamento (só Flex financiada)
Lote liberado conforme lucro simulado (atualiza no **fim da sessão**; saque pode descer o degrau):

| Lucro | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| $0–999 | 1 mini/10 micro | 2/20 | 3/30 | 4/40 |
| $1.000–1.999 | 2/20 | 3/30 | 4/40 | 5/50 |
| $2.000–2.999 | — | 4/40 | 5/50 | 6/60 |
| $3.000–4.499 | — | — | 6/60 | 8/80 |
| $4.500+ | — | — | — | 10/100 |

### Live (novo modelo)
- Entra na **fila de análise** após o 5º saque, ou muito lucro acumulado, ou desempenho excepcional. **Decisão do time de risco** (5º saque não garante).
- Uma conta Live por financiada (cada uma precisa de ≥ 1 saque). Começa com $0, **saque diário, drawdown EOD, sem DLL, sem consistência**.
- Drawdown inicial Live = MLL da financiada ($1.000 / $2.000 / $3.000 / $4.500). Trava em $100 quando o lucro Live iguala o drawdown inicial.
- **Live Bonus** (1x, split 90/10): 25K $1.000 · 50K $2.000 · 100K $3.000 · 150K $4.500, ao fechar a sessão com lucro Live ≥ meta de $1.100 / $2.100 / $3.100 / $4.600 (tabela oficial "Live Target").
- Ao ir pra Live, **todas as contas simuladas são fechadas**; financiada com 0 saque é reembolsada (se sobrou ≥ 50% do drawdown).
- Se um da casa está Live, os outros **não podem operar sim**.
- Quebrou a Live: cooldown padrão de **2 semanas** (maior se for "yolo").
- Contas compradas/resetadas **até 27/02/2026** seguem o modelo Live antigo (legacy). Pro tem consistência 35% em contas de antes de 28/11/2025.
- **LucidMaxx**: só por convite (não vende ao público) — saque diário sem teto, sem DLL. Não entra na seção como plano à venda; no máximo 1 linha explicando.
- **LucidBlack**: legado, fora do ar.

## 2. Regras gerais (importante pro iniciante)

- **Feche tudo até 16:45 ET** (Pro/Flex/Direct). Passar do horário **não quebra a conta**, a Lucid fecha por você. Reabre 18:00 ET dom–qui.
- **Permitido:** scalping genuíno, DCA/escalar entrada, robôs e copiadores (você responde pelos erros), flipping, notícia (exceto Daily).
- **Proibido:** hedge (mesma conta, contas diferentes, entre mesas; inclui long ES numa conta e short NQ noutra), **HFT**, **microscalping** (>50% do lucro em trades de ≤ 5 s), explorar erro/atraso de sistema.
- Punição: hedge = reseta pro saldo do dia anterior; reincidência = quebra e pode banir. HFT = aviso, depois perde lucro/conta. Microscalping = revisão manual, aviso, depois perde lucro.
- **Limites de contas:** até 10 avaliações ativas + 5 financiadas por casa (máx. 10 no total); 5 Live.
- **Inatividade:** conta sem lucro/prejuízo ≥ $1 em 30 dias é **deletada**. Conta quebrada é deletada em 30 dias se não resetar.
- **Pagamento:** só cartão (Visa, Mastercard, Amex, Discover, Diners, Maestro).
- **Brasil NÃO está na lista de países restritos** (conferido: lista completa no artigo "restricted countries").

## 3. Preços (snapshot 28/09 — VOLÁTIL)

Cupom **VAULT** (banner do próprio site). Preços mudam com "limited time". Valores lidos na tela:

| | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| **Pro** (lista) | $123 | $192 | $307 | $410 |
| Pro final, DLL **ligado** | $70,60 | $115,40 | $180,40 | $245,50 |
| Pro final, DLL **desligado** | $90,60 | $140,40 | $225,40 | $300,50 |
| **Flex** (lista) | $89 | $146 | $293 | $407 |
| Flex final, DLL ligado | n/l | $90,20 | $170,60 | $250,40 |
| Flex final, DLL desligado | $65,30 | $105,20 | $215,60 | $295,40 |
| **Direct** (lista) | $329 | $515 | $700 | $836 |
| Direct c/ cupom | $230,30 | $360,50 | $490,00 | $585,20 |
| **Daily** | depende das 4 combinações (DLL × drawdown da avaliação) — não capturado |

`n/l` = não lido. Reset = igual ao preço final (ex.: Pro 25K DLL ligado reset $70; Flex 50K DLL ligado reset $90).
> Flex 50K com DLL = $90,20 bate com o que o Marcelo viu.

**Sugestão:** na seção mostrar só "a partir de" + link pra Lucid, NÃO cravar preço (muda toda semana). Regras (estáveis) ficam como dado; preço com `verificadoEm` bem visível.

## 4. Validação do doc antigo (`trades-pessoais-marcelo/docs/lucid-flex-50k-analise.md`)

**Confere com o oficial:** meta $3.000, MLL $2.000, DLL $1.200, consistência 50% na avaliação, saque mín. $500 / máx. 50% até $2.000, split 90/10, 5 saques, 5 dias ≥ $150, escalonamento do 50K, trava do piso em $50.100 no 1º saque, reset $90 com DLL, Live Bonus $2.000, pagamento só por cartão, WorkMarket pro Brasil.

**Diferenças / o que o oficial resolveu:**
1. **"Meta mín. 2 dias"**: o oficial não fala em mínimo de dias na Flex. Os 2 dias vêm do *cushion* da consistência de 50% (dá pra passar em 2 dias). Na Pro dá pra passar em 1 dia.
2. **Pergunta 3 (ciclo dos 5 dias recomeça a cada saque?)** → **Sim**: "reset e precisa ser ganho de novo após cada saque aprovado".
3. **Pergunta 7 (linha Direct)** → existe: **LucidDirect** (entra financiada direto). 50K = $515 lista / $360,50 c/ cupom, mas com consistência de 20% no saque e meta de $3.000 no 1º saque.
4. **Live**: o doc antigo dizia "mín/máx/split não publicados". Agora há a estrutura nova publicada (saque diário, sem DLL, Live Bonus, fila de análise). Split 90/10 no bônus.
5. **Restrito ao antigo:** conta comprada até 27/02/2026 segue Live legado.
6. Ainda **NÃO** respondido pelo oficial: VPS/VPN (pergunta 4) e "dia da sessão de domingo" (pergunta 2) — falta ler o Terms/FAQ completo; conferir com o suporte.
7. "Metade no COMEX" do lote Live: no oficial, a tabela de Live tem limite por bolsa (CME/CBOT/NYMEX/COMEX) e o COMEX é menor (25K: 0 mini/5 micro). Bate com a ideia.

## 5. Viabilidade do cron (7 dias)

- **Help Center responde 200 por curl** → o cron não precisa de Chrome nem burla nada. 59 URLs, ~100KB de texto. Hash por artigo, só chama IA se mudou.
- **Site principal (`/#plans`, termos, afiliado)** dá 403 Cloudflare pra curl → **não** entra no cron automático. Preço/planos: checagem semi-manual (colar print/texto de vez em quando) ou só regra estável do Help Center.
- Os artigos do help center têm regras completas (tabelas de saque, drawdown, DLL, escalonamento). O que **só** aparece no site é o preço e o cupom.
- Sugestão: cron só nos artigos-chave por plano (evaluation/funded/payouts/drawdown/DLL/consistency/scaling/live + regras gerais), ~35 URLs.

## 6. Decisões pra o Marcelo

1. **Escopo dos planos na v1:** Pro + Flex + Daily + Direct (os 4 públicos)? LucidMaxx/Black só citados/legado?
2. **Preço:** "a partir de" + link, ou tabela com data do snapshot?
3. **Cupom VAULT:** é o código do banner da Lucid, **não** é seu afiliado — não usar como se fosse. Afiliado depois.
4. **Cron:** só Help Center (recomendado) ou também tentar o site?
