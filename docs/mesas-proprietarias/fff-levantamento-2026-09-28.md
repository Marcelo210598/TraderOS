# Funded Futures Family (FFF): levantamento oficial, 28/09/2026

Fonte: site oficial `fundedfuturesfamily.com` (WordPress, abre por HTTP normal, sem Cloudflare, `robots.txt` libera tudo). Páginas de plano, `/payout-rules/`, `/payout-speed/`, Termos e 27 FAQs. As 35 URLs monitoradas estão em `fontes/fff-urls.txt`; o texto bruto fica só local (`fontes/fff-site-2026-09-28.txt`, no `.gitignore`).
**Blog NÃO é fonte de regra**: são comparativos de marketing (ex.: "FFF vs Lucid").
Link usado nos botões: `https://www.fundedfuturesfamily.com/` **sem** `ref_code` (o código do link recebido "não é de ninguém").

## Resumo
- Conta é **simulada com dados de mercado ao vivo; os saques são reais** (FAQ oficial). Pode migrar pra conta Live (Rithmic) depois do 1º pedido de saque ou de $5.000 de lucro reconhecido, com análise e papelada.
- **Split 90/10** em todos os planos, desde o 1º dólar. **Sem limite de perda diário em nenhum plano.** Notícia liberada. Sem taxa de ativação.
- **Avaliações são ASSINATURA MENSAL** ("/mo"); **Straight to Funded (S2F) é pagamento único.** Taxas são finais e **não reembolsáveis** (Termos).
- Até **5 contas financiadas ativas por domicílio** (todos os planos somados). **Teto de $100K de saque por usuário.** Reset de conta financiada: até 3 por conta.
- Saque via **Rise (Riseworks)**, KYC obrigatório (KYB pra LLC). Aprovação instantânea; dinheiro na Rise em algumas horas.
- Plataformas: Tradovate, TradingView e NinjaTrader (via Tradovate), WealthCharts. Mercados: índices e commodities (petróleo, gás, ouro, prata, agrícolas).
- **Brasil não está na lista de países restritos** (lista atualizada em 01/09/2026; muda com sanções).
- Preço de tabela: as páginas dizem que promoções cortam forte (códigos "FFF", "first50" citados por eles). Não usamos preço promocional.

## Regras que valem pra todos os planos
- **Dia qualificado:** dia com pelo menos $200 de lucro.
- **Conduta:** mais de 50% dos trades **e** mais de 50% do lucro precisam vir de posições seguradas por mais de 10 segundos; sem robôs/algoritmos; sem hedge entre contas; conta em nome próprio. VPN/VPS permitido por conta e risco do trader.
- **Posições:** dá pra segurar à noite, mas tudo precisa estar fechado até **16:15 (Nova York, "EST")** todo dia. Mercado reabre às 18:00. Nada aberto no fechamento diário nem no fim de semana.
- **Monitoramento** desde o 1º trade. Problema corrigível = aviso. Violação séria = conta fechada na hora. Termos: a FFF decide o que é conduta proibida; violação pode ser tratada como reprovação, apagar trades ou encerrar a conta sem reembolso.
- **Avaliação não ativada em 30 dias** é suspensa (pode pedir renovação em até 6 meses). Mais de 3 resets em 24h ou várias avaliações ao mesmo tempo podem gerar suspensão de novos pedidos.
- Termos têm cláusula dura contra **chargeback** (perda de saques/benefícios e ressarcimento). Abrir ticket antes de qualquer disputa.
- Scalp manual e micros liberados (respeitando a regra dos 10 segundos).

## Escalonamento (contas financiadas, tabela oficial por lucro simulado, atualiza no fim da sessão)
| Lucro | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| $0–999 | 1/10 | 3/30 | 4/40 | 5/50 |
| $1.000–1.499 | 2/20 | 3/30 | 4/40 | 5/50 |
| $1.500–1.999 | 2/20 | 4/40 | 6/60 | 7/70 |
| $2.000–2.999 | 3/30 (máx) | 5/50 (máx) | 7/70 | 10/100 |
| $3.000–4.499 | | | 10/100 (máx) | 12/120 |
| $4.500+ | | | | 15/150 (máx) |
(minis/micros.) Não vale na avaliação. O limite efetivo também respeita o máximo de posição da versão comprada.

## Planos

### Prime (avaliação mensal, drawdown EOD)
- Avaliação: passa em 1 dia, **sem consistência**, sem limite diário, resets e avaliações ilimitados; passar ativa a financiada na hora.
- Drawdown **EOD** (trava no saldo inicial depois que o saldo passa do nível inicial).
- Financiada: saque a cada 3 dias de trading, **consistência 40%** por ciclo (zera a cada saque), saldo acima de drawdown + $100.
- Duas versões por tamanho: **Incluída** (mais barata) e **Prime Max** (mais contratos).
| | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| Incluída /mês | $129 (2 minis/20 micros) | $179 (4/40) | $279 (6/60) | $365 (10/100) |
| Prime Max /mês | $144 (3/30) | $204 (5/50) | $319 (10/100) | $425 (15/150) |
| Meta | $1.250 | $3.000 | $6.000 | $9.000 |
| Perda máxima | $1.000 | $2.000 | $3.000 | $4.500 |
| Reset financiada | $499 | $649 | $1.099 | $1.499 |
| Meta de lucro entre saques | $300 | $500 | $750 | $1.000 |
| Saldo mínimo (buffer) | $26.100 | $52.100 | $103.100 | $154.600 |
| Máx. saque 1º | $1.000 | $2.000 | $3.000 | $3.500 |
| Máx. saque 2º+ | $1.500 | $2.500 | $3.500 | $4.000 |

### Velocity (avaliação mensal, drawdown INTRADAY)
- Avaliação: mínimo **3 dias**, **consistência 40%**, resets/avaliações ilimitados. Drawdown **intraday trailing** (avaliação e financiada): sobe com o lucro aberto, nunca desce.
- Financiada padrão: saque a cada 3 dias (3 dias com $200+ e lucro exigido), consistência 40% (zera a cada saque).
- **Add-on de saque diário** ($29–$69/mês): saque diário, sem exigência de dias e **sem consistência** na financiada.
| | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| Base /mês | $79 | $125 | $225 | $325 |
| Com add-on /mês | $108 | $164 | $284 | $394 |
| Meta | $2.500 | $4.000 | $7.000 | $10.000 |
| Perda máxima | $1.250 | $2.250 | $3.250 | $4.750 |
| Posição máx. | 3 minis/30 micros | 5/50 | 10/100 | 15/150 |
| Reset financiada | $499 | $649 | $1.099 | $1.499 |
| Lucro exigido entre saques | $1.500 | $3.000 | $6.000 | $9.000 |
| Máx. por saque (padrão) | $750 | $1.250 | $2.250 | $3.250 |
| Máx. por saque (add-on) | $600 | $1.000 | $1.500 | $2.500 |

### Premier+ (avaliação mensal, você escolhe o drawdown)
- **Fast Pass**: pode passar em 1 dia qualificado, **sem consistência na avaliação**. **Standard**: 2+ dias, **consistência 50% só na avaliação**, mais barato.
- Escolha entre drawdown **Intraday** e **EOD** (preço e perda máxima mudam). No EOD trava no saldo base.
- Saque: **5 dias qualificados**, sem buffer, basta **$1 de lucro líquido desde o último saque**. Máximo: 50% do lucro, até $1.000 / $2.000 / $2.500 / $3.000.
- **Regra mudou em 09/09/2026:** contas compradas a partir dessa data têm **consistência 40% na financiada** e **contratos fixos (25K=2, 50K=4, 100K=6, 150K=10 minis), sem escalonamento**. Contas anteriores: sem consistência na financiada e escalonamento antigo (25K=3, 50K=5, 100K=10, 150K=15 minis no máximo).
- ⚠️ Ambíguo no site: o texto diz que a consistência de 50% do Standard vale "só na avaliação", e a regra de 40% da financiada aparece ligada ao Premier+ em geral. Confirmar no site se o Standard também tem o 40% na financiada.
| Intraday /mês | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| Fast Pass | $114 | $154 | $229 | $319 |
| Standard | $89 | $119 | $189 | $259 |
| Perda máxima | $1.000 | $2.000 | $3.000 | $4.500 |
| **EOD /mês** | | | | |
| Fast Pass | $144 | $194 | $299 | $529 |
| Standard | $119 | $159 | $249 | $459 |
| Perda máxima | $750 | $1.500 | $2.500 | $4.000 |
Meta (todas): $1.500 / $3.000 / $6.000 / $9.000. Reset financiada: $649 / $649 / $1.099 / $1.499.

### S2F Standard (sem avaliação, pagamento único)
- Conta financiada simulada desde o 1º trade; só valem as regras de financiada.
- Saque: **7 dias qualificados** ($200+), saques a cada 7 dias, **consistência 25%** (zera a cada saque), drawdown **EOD** que trava no saldo inicial.
- Preços únicos: 25K $329 · 50K $469 · 100K $629 · 150K $734. Perda máxima $1.000 / $2.000 / $3.000 / $4.500. Posição máx.: 1 mini/10 micros · 5/50 · 10/100 · 15/150 (com escalonamento).
- Meta de lucro: 1º saque $1.500 / $3.000 / $6.000 / $9.000; 2º+ $1.000 / $2.000 / $3.000 / $4.500. Máx.: saques 1–3 $1.000 / $2.000 / $2.500 / $3.000; saque 4 $1.000 / $2.500 / $3.000 / $3.500.
- Nível inicial do trailing: $26.000 / $52.000 / $103.000 / $154.500; trava em $25.000 / $50.000 / $100.000 / $150.000.

### S2F Accelerate (só 50K, lançado em 09/2026)
- Pagamento único, sem avaliação. Preço de tabela **$499**; existe oferta de lançamento (no dia da leitura, $49.90), o código first50 não vale aqui.
- **5 minis/50 micros desde o 1º dia** (sem escalonamento). Drawdown **intraday de $2.000 que nunca trava**.
- **Consistência 25% pra vida toda da conta** (não zera após saque). 5 dias qualificados ($200+ de lucro fechado).
- Saldo acima de $52.100 pra pedir saque. Máx.: $1.250 (1º e 2º), $1.500 (do 3º em diante). Mínimo $500. Não é plano pra iniciante, segundo o próprio site.

## Pendências / não sabemos
- Mínimo de saque dos demais planos (só o Accelerate cita $500).
- Se o Premier+ Standard tem consistência de 40% na financiada (ver acima).
- Bônus ao ir pra Live: não há valor publicado.
- Quantos saques até a análise pra Live: a regra é "1º pedido ou $5.000", não uma contagem.
- S2F Standard 25K: a tabela de especificações mostra 1 mini/10 micros de posição máxima, mas a tabela de escalonamento chega a 3 minis. Estamos usando a de especificações (1 mini).
- A tabela de escalonamento parece ser a da versão "Max" (o teto de cada tamanho bate com o Prime Max/Velocity). O site não explica se a versão Incluída do Prime é limitada abaixo disso; os dados mostram o teto por versão na linha "Lote máximo".
- FAQs da FFF não têm `<article>`: o monitor lê o `<main>` deles. Se o layout do WordPress mudar, o cron avisa por "muitos erros".
