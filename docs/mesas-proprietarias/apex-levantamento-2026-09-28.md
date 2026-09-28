# Apex Trader Funding: levantamento oficial, 28/09/2026

Fonte: `apextraderfunding.com` (home + seletor de produtos) e o Help Center oficial (`/help-center/...`, 93 artigos; 38 lidos, os de regra). **Lido pelo Chrome do Marcelo**, porque o site inteiro e o suporte ficam atrás de Cloudflare (403 pro servidor). Não burlamos anti-robô, e por isso o cron NÃO vigia a Apex: a conferência é manual (ver `apex-conferencia.md`). Marco zero dos textos em `fontes/apex-hashes-2026-09-28.txt`.
O PDF "CONTAS - APEX" que existia na memória é material da Nômade Trader (terceiro). Os números dele bateram com o site oficial, mas a fonte de verdade é o site.
Link dos botões: `https://apextraderfunding.com/` (sem código).

## Estrutura (contas NOVAS, compradas a partir de 01/03/2026)
Duas trilhas: **EOD** (drawdown de fim de dia) e **Intraday** (drawdown em tempo real). Cada uma vem em **Standard** ou **"No Activation Fee"** (paga mais na avaliação e não paga a taxa de ativação da PA). Plataformas: Tradovate, Rithmic, WealthCharts (contas não convertem entre plataformas).
**Contas legadas** (compradas antes de 01/03/2026): regras antigas, assinatura recorrente, resets só nelas, não convertem pras novas. Fora da comparação. Uma promoção "Legacy accounts are back" aparece na home por tempo limitado.

## Fluxo
1. **Avaliação (EA):** pagamento **único** (não é assinatura), 30 dias corridos de acesso (fim às 18:00 ET do dia 30), **sem reset e sem extensão**: falhou ou expirou, compra outra. Sem dias mínimos (passa em 1 dia). **Sem reembolso.**
2. Passou: revisão às 16:59:59 ET, marcada como "Passed" depois das 18:00 ET. **7 dias corridos pra ativar a PA** pagando a **taxa de ativação** (única, não reembolsável). Perdeu o prazo = precisa passar outra avaliação. A PA sai em até 6h (compra depois do fechamento de sexta só cria no domingo 18:00 ET).
3. **PA (Performance Account):** conta **simulada** (Sim Funded), mesmo tamanho e tipo da avaliação. Split **100%** dos saques aprovados. Até **20 PAs** ao mesmo tempo (soma legado + EOD + Intraday). Sem limite de avaliações.
4. Live: por convite da Apex (ver abaixo).

## Números por tamanho (25K / 50K / 100K / 150K)
| | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| Meta da avaliação | $1.500 | $3.000 | $6.000 | $9.000 |
| Perda máxima (EOD e Intraday, eval e PA) | $1.000 | $2.000 | $3.000 | $4.000 |
| Contratos na avaliação (fixo, iguais nas duas trilhas) | 4 | 6 | 8 | 12 |
| Contratos máximos na PA (topo do escalonamento) | 2 | 4 | 6 | 10 |
| DLL na avaliação EOD | $500 | $1.000 | $1.500 | $2.000 |
| DLL na avaliação Intraday | não tem | não tem | não tem | não tem |
10 micros = 1 contrato. Consistência e escalonamento **não** se aplicam na avaliação. Ordem acima do limite é rejeitada sem violação.

### Preços de tabela (home, seletor de produtos; o cupom SAVENOW dá até 90% de desconto, promoções são constantes)
| Avaliação | 25K | 50K | 100K | 150K |
|---|---|---|---|---|
| Intraday Standard | $167 | $249 | $790 | $1.190 |
| Intraday "No Activation Fee" | $690 | $799 | $999 | $1.890 |
| EOD Standard | $490 | $590 | $1.190 | $2.190 |
| EOD "No Activation Fee" | $1.090 | $1.190 | $1.590 | $2.490 |
**Taxa de ativação da PA (Standard):** Intraday **$59**, EOD **$90** (todos os tamanhos). "No Activation Fee": grátis.
Pacote de 5 avaliações do mesmo tamanho/tipo tem desconto (ex.: Intraday Standard 25K $749,50; 50K $950; 100K $3.450; 150K $4.950; EOD Standard 25K $2.250; 50K $2.450; 100K $4.950; 150K $9.950), mesmo prazo de 30 dias, contas independentes. PA não vende em pacote.
Dados L1 incluídos; profundidade de mercado (DOM) é à parte (Rithmic expira no fim do mês; Tradovate/WealthCharts cancela lá).

## Drawdown
- **EOD:** calculado 1x por dia às 16:59:59 ET pelo saldo de fechamento, segue o maior saldo de fechamento, nunca desce; é imposto em tempo real na sessão seguinte. Tocou = posições liquidadas e avaliação reprovada / PA fechada. **Na PA trava** quando o threshold chega ao saldo inicial + $100 (50K: $50.100, quando o maior saldo de fechamento chega a $52.100). Na avaliação: Rithmic/WealthCharts trava quando o threshold chega ao saldo da meta; Tradovate segue indefinidamente.
- **Intraday:** segue o maior saldo (Peak Balance) em tempo real, **incluindo lucro aberto**, nunca desce. **Na PA para de subir** em saldo inicial + $100 (mesmo nível do EOD). Avaliação: mesma diferença por plataforma.
- **DLL** (limite de perda diário): pausa a sessão (fecha posições, não fecha a conta), reseta às 18:00 ET. Vale na avaliação EOD (valores acima) e na **PA (EOD e Intraday), onde escala com o nível**.

## Escalonamento da PA (por lucro da conta; atualiza 1x por dia antes da sessão pelo saldo de fechamento; nunca muda dentro da sessão; nunca cai abaixo do nível 1)
| | Lucro | Contratos | DLL |
|---|---|---|---|
| 25K | $0–999 | 1 | $500 |
| | $1.000–1.999 | 2 | $500 |
| | $2.000+ | 2 | $1.250 |
| 50K | $0–1.499 | 2 | $1.000 |
| | $1.500–2.999 | 3 | $1.000 |
| | $3.000–5.999 | 4 | $2.000 |
| | $6.000+ | 4 | $3.000 |
| 100K | $0–1.999 | 3 | $1.750 |
| | $2.000–2.999 | 4 | $1.750 |
| | $3.000–4.999 | 5 | $1.750 |
| | $5.000–9.999 | 6 | $2.500 |
| | $10.000+ | 6 | $3.500 |
| 150K | $0–1.999 | 4 | $2.500 |
| | $2.000–2.999 | 5 | $2.500 |
| | $3.000–4.999 | 7 | $2.500 |
| | $5.000–9.999 | 10 | $3.000 |
| | $10.000+ | 10 | $4.000 |
(Um artigo escreve "$5,999 & Up" no 50K; o outro, "$6,000". Usamos $6.000.)

## Saque (PA)
- Mínimo de **5 dias qualificados** (não precisam ser seguidos, sem prazo). Dia qualificado = lucro líquido mínimo no dia: **EOD** $100 / $250 / $300 / $350; **Intraday** $100 / $200 / $250 / $300.
- **Consistência de 50%:** o maior dia lucrativo precisa ser **menor que 50%** do lucro líquido desde o último saque aprovado (ou do início da conta). Dias de prejuízo reduzem o lucro líquido. Não reprova a conta: só some o botão de saque. Zera a cada saque aprovado.
- **Safety net** = drawdown + $100, vale pra vida toda da PA: saldo precisa ficar acima. **Saldo mínimo pra pedir:** $26.600 / $52.600 / $103.600 / $154.600. **Mínimo por pedido: $500.**
- **Máximo de 6 saques por PA**; depois a PA fecha e só se obtém outra passando em outra avaliação.
- Máximo por saque (nº 1 a 6): 25K $1.000 em todos; **EOD** 50K 1.500/1.500/2.000/2.500/2.500/3.000 · 100K 2.000/2.500/2.500/3.000/4.000/4.000 · 150K 2.500/3.000/3.000/3.000/4.000/5.000; **Intraday** 50K 1.500/2.000/2.500/2.500/3.000/3.000 · 100K 2.000/2.500/3.000/3.000/4.000/4.000 · 150K 2.500/3.000/3.000/4.000/4.000/5.000.
- Pode operar depois de pedir; se o saldo cair abaixo do mínimo, o pedido é negado automaticamente.
- Processo (Help Center): análise em até 2 dias úteis, envio em 3–4 dias úteis, banco/provedor 3–7 dias úteis; total típico 5–11 dias úteis. EUA: ACH. **Fora dos EUA: Plane** (convite por e-mail em 1–4 dias úteis depois do 1º saque aprovado; conta bancária **no país de residência declarada**; ID/passaporte; a Apex não emite formulário fiscal pra não americanos).

## Regras de conduta e horário
- Tudo fechado **antes das 16:59 ET** (responsabilidade do trader; posição aberta no fechamento = perde a conta e os saldos). Agrícolas fecham antes (pecuária 14:05 ET, grãos 14:20 ET). Pode fechar mais cedo em feriado. Volta às 18:00 ET. Dia de trading: 18:00 ET até 16:59 ET.
- **Obrigatório** ter stop (pendente ou mental) e gestão de risco definida. Proibido: risco desproporcional (ex.: alvo de 5 ticks com stop de 150), usar o threshold inteiro como stop, empilhar avaliações com desconto pra estourar, HFT, bracket não direcional (ordens dos dois lados), exceder contratos.
- **Sem hedge de qualquer tipo** (long e short ao mesmo tempo no mesmo instrumento ou correlacionado): fecha a conta na hora. **Sem automação/algoritmo.**
- Notícia: permitida com a sua estratégia normal; proibido "perseguir" o mercado ou apostar nos dois lados.
- Não compartilhar acesso, computador, MAC, IP, cartão nem copiar trades entre traders. Pagar e receber só em contas/cartões em seu nome. VPN/proxy/cloud pra mascarar identidade, aparelho ou local é proibido. Várias contas de usuário = banimento. Violação leva a "Trader Probation".
- **Inatividade (PA):** precisa de 2 dias com lucro líquido de pelo menos $50 dentro de qualquer janela móvel de 30 dias corridos. Aos 15 dias a conta vira "dormente" (avisos nos dias 15 e 20); aos 30 dias fecha e perde o direito a saques. Trade sem $50 de lucro não conta.
- Instrumentos: índices, moedas, agrícolas, energia, metais, micros e cripto micro (MBT/MET). EUREX só na Tradovate.

## Países
"Mais de 100 países". Lista de restritos, exatamente como está no site: Afghanistan, Algeria, Azerbaijan, Bahrain, Bangladesh, Belarus, Benin, Brunei, Burkina Faso, Burundi, Cameroon, Central African Republic, Chad, China, Congo, Cote D'Ivoire, Cuba, Cyprus, Egypt, Eritrea, Gabon, Grenada, Guinea, Guinea-Bissau, Haiti, Iran, Iraq, Jersey, Jordan, Kazakhstan, Kenya, Kuwait, Latvia, Lebanon, Lesotho, Liberia, Libya, Madagascar, Maldives, Mauritania, Mauritius, Mongolia, Morocco, Mozambique, Myanmar, Namibia, Nepal, New Caledonia, Nicaragua, Niger, Nigeria, North Korea, Occupied Palestinian Territory, Oman, Pakistan, Papua New Guinea, Qatar, Republic of Moldova, Republic of the Congo, Reunion, Russia, Rwanda, Saint Pierre and Miquelon, Saudi Arabia, Senegal, Serbia, Somalia, South Africa, South Sudan, Sri Lanka, Sudan, Syria, Tanzania, Togo, Trinidad and Tobago, Tunisia, Turkey, Uganda, Ukraine, Uzbekistan, Vanuatu, Venezuela, Vietnam, Western Sahara, Yemen, Zambia, Zimbabwe. **O Brasil NÃO está na lista.** Aceitam-se apenas IDs físicos (não cópia, não digital). Quem está em país restrito não compra, não saca e não opera.
O aviso de risco do site diz também "serviços destinados a usuários dos EUA, não oferecidos onde a lei local proíbe" e que "saques são discricionários e sujeitos a elegibilidade, conformidade e leis fiscais" (tensão com o "sem negativa de saque" da home).

## Live (Apex Live Prop Trading Program): só por convite
- **Não é automático.** A Apex decide quando mover (disciplina, consistência, risco, histórico, saques simulados totais). Pode começar a monitorar após, por exemplo, 3 saques seguidos de uma PA. Selecionado, **não pode manter contas simuladas ao mesmo tempo**.
- 1 conta live inicial (estrutura única), saldo $0, drawdown **$3.000 EOD** que trava em +$100 quando o lucro chega a +$3.100. Uma conta nova a cada $4.500 de lucro, até 5.
- Nível 1 ($0–10.000): 3 minis/30 micros, sem DLL, sem consistência. Nível 2 ($10.000–50.000): 10 minis/100 micros, DLL de $5.000. Acima de $50.000: revisão personalizada.
- Split **90/10**, saque **diário**, mínimo $500, sem teto, sem dias mínimos, só do lucro acima do safety net de $3.100. Sem taxa mensal e sem taxa única da conta live. Bonus Vault: 20% mensal sobre saques live (40% no 1º mês) enquanto durar.
- Inatividade: 30 dias sem operar pode fechar. Falhou: caminho de requalificação, com probation depois de várias falhas.

## Divergências e pendências
- Artigo geral de saque (© 2023) fala em "8 dias com 5 de $50+" pro próximo saque; as páginas atuais de EOD/Intraday exigem 5 dias com lucro mínimo de $100 a $350. Valem as atuais.
- A home diz "sem revisão de saque, sem saque negado"; o Help Center fala em análise de até 2 dias úteis e prazo total de 5–11 dias úteis.
- Não lemos as coleções de plataformas e o legado a fundo (fora da comparação).
