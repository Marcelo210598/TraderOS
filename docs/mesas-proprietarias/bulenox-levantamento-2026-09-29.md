# Bulenox — levantamento oficial (29/09/2026)

Fonte: site oficial `bulenox.com` (Accounts & Pricing, FAQ, Help Center, PDF de comissões). Blog/reviews de terceiros NÃO são fonte.

## Como o site entrega o conteúdo (importante pro cron)
- O site é uma SPA: o HTML vem vazio e o texto do Help Center/FAQ vem de uma **API pública do próprio site** (`/cms/items/help_items`, `/cms/items/faq_items`, `/cms/items/help_categories`), que o `robots.txt` deixa aberta de propósito ("AI crawlers welcome", `/llms.txt`). Abre por curl, **sem Cloudflare** → dá pra monitorar automaticamente (precisa de um leitor de JSON no cron; o de HTML atual não serve).
- Os **preços da Qualification** (145/175/215/325) só existem dentro do JS do site (arquivo com hash no nome, muda a cada build) → esses ficam pra conferência manual/lembrete. Preços do Fast Track e Momentum também aparecem nas tabelas do Help Center.
- Texto bruto local (gitignorado): `fontes/bulenox-helpcenter-2026-09-29.txt`.

## Três produtos (todos pagamento ÚNICO, sem mensalidade)
Cada conta escolhe, ANTES de comprar e de forma definitiva, um de dois modelos de risco:
- **Opção 1 (Trailing, sem escalonamento):** drawdown acompanha o maior valor da conta em tempo real, incluindo lucro aberto; contratos cheios desde o dia 1.
- **Opção 2 (EOD):** drawdown só atualiza no fechamento; escalonamento por "cash on hand" (na Qualification/Master) ou contratos fixos menores (Fast Track e Momentum); limite de perda diário (pausa o dia).

| | Qualification (→ Master) | Fast Track | Momentum |
|---|---|---|---|
| Caminho | Passa a meta → revisão → Master (paga ativação) | Sem avaliação, financiada simulada no dia 1 | Qualification que já inclui a Master de graça |
| Preço 25/50/100/150 | 145 / 175 / 215 / 325 | 338 / 488 / 648 / 788 | 94 / 143 / 248 / 358 |
| Ativação da Master | 143 / 148 / 248 / 498 (uma vez, 7 dias pra pagar após o link) | não tem | não tem |
| Meta | 1.500 / 3.000 / 6.000 / 9.000 | — | 1.500 / 3.000 / 6.000 / 9.000 |
| Drawdown | 1.500 / 2.500 / 3.000 / 4.500 | 1.000 / 2.250 / 4.000 / 5.500 | 1.000 / 2.250 / 4.000 / 5.500 |
| DLL (só Opção 2) | 500 / 1.100 / 2.200 / 3.300 | — / 1.200 / 2.500 / 3.300 | 600 / 1.200 / 2.500 / 3.300 |
| Contratos Opção 1 | 3 / 7 / 12 / 15 | 3 / 7 / 12 / 15 | 3 / 7 / 12 / 15 |
| Contratos Opção 2 | Qual.: 3/7/12/15 com escalonamento (abaixo) | 2 / 4 / 8 / 12 fixo | 2 / 4 / 8 / 12 fixo |
| Consistência | Avaliação: nenhuma · Master: 40% do lucro TOTAL (não zera após saque) | 20% (1º saque) · 25% (2º) · 30% (3º+), por ciclo | 35% do lucro do ciclo |
| Dias mínimos p/ sacar | 10 dias de trading por saque | nenhum | 5 dias com lucro ≥ 100/150/200/250 |
| Mín. por pedido | 1.000 | 1.000 | 500 / 1.000 / 1.000 / 1.000 |
| Meta de lucro | — (reserva de segurança 1.600 / 2.600 / 3.100 / 4.600 acima do inicial) | 1º: 1.500/3.000/6.000/9.000 · depois: 1.000/2.000/3.000/4.500 de lucro NOVO | saldo mínimo 26.500 / 53.000 / 104.500 / 156.500 |
| Teto por saque | 1º-3º: 1.000 / 1.500 / 1.750 / 2.000 · 4º+: sem teto | 1º-3º: 1.000 / 2.000 / 2.500 / 3.000 · 4º+: 1.250 / 2.500 / 3.000 / 3.500 | 1º: 1.000/1.500/2.000/2.500 · 2º: 1.000/2.000/2.500/3.000 · 3º: 1.000/2.500/3.000/4.000 · 4º+: 1.000/3.000/4.000/5.000 |
| Quando paga | 1x por semana, quarta (pedido até sexta 23:59 CT) | Mesmo dia se pedir até 12:01 CT (seg–sex) | Mesmo dia (mesma regra de horário do Fast Track, conforme FAQ) |
| Reset | Qualification: $78 (não estende o acesso de 30 dias) · Master: valor individual, via suporte | Não informado | Não informado |
| Acesso | 30 dias (avaliação) | — | 30 dias (qualification) |

Escalonamento Opção 2 (Qualification/Master, por lucro acumulado): 25K até 1.500: 2 · 1.501+: 3 | 50K até 1.500: 2 · 1.501–4.000: 4 · 4.001+: 7 | 100K até 2.000: 3 · 2.001–3.000: 5 · 3.001–5.000: 8 · 5.001+: 12 | 150K até 4.000: 5 · 4.001–8.000: 8 · 8.001–12.000: 10 · 12.001+: 15. Vale nos dois sentidos (pode cair se o saldo cair).

Master: o drawdown trava em saldo inicial + $100 (saldo de trava 26.600 / 52.600 / 103.100 / 154.600) e o DLL some quando trava.

## Regras comuns
- Dia de trading 17:00–16:00 CT; tudo fechado até 15:59 CT; overnight/fim de semana proibido.
- Notícia liberada, sem blackout. Micro e mini juntos (1 mini = 10 micros).
- Robô/algoritmo/copiador permitidos SÓ se for ferramenta própria de uso pessoal (comercial/compartilhada/alugada proibida). Conectar via API de terceiros no Rithmic = $100/mês.
- Plataforma: só via Rithmic (20+ plataformas; NinjaTrader 8 com licença grátis na Master). **Rithmic só roda no Windows** (não macOS/ChromeOS).
- Dados de mercado: não profissional = grátis; profissional = $116/mês (página de preços e artigo Status; o artigo de conexão cita $112 por bolsa). Escolha no acordo Rithmic é definitiva.
- Até 5 contas de nível Master somando Master, Fast Track e Momentum Master; Qualification ilimitadas. 1 perfil e 1 Rithmic User ID por trader.
- Split: primeiros US$ 10.000 em saques = 100% seu (por trader, somando todas as contas); depois 90/10.
- Pagamento de saque: ACH/wire ou PayPal; sem taxa da Bulenox. Documentos: formulário de saque + ID + W-8BEN (não americanos) **assinado à mão, sem assinatura eletrônica**.
- Compra: cartão, PayPal, cripto. **Sem reembolso** depois que a conta é criada e acessada. Não há o que cancelar: expira sozinha.
- Instrumentos: 40–41 futuros CME/CBOT/NYMEX/COMEX. Comissão all-in por lado (PDF de 11/08/2026): ES/NQ $2,09 (ida e volta $4,18) · MES/MNQ $0,61 ($1,22).
- Live: após 3 saques a conta pode ser considerada pra Funded (critério da Bulenox, não automático; Fast Track: 3 saques + 30 dias de trading). Lucro não migra; cada Funded começa com drawdown EOD 1.500 / 2.000 / 3.000 / 4.500. Sem consentir, a Master fecha.
- Sem verificação de antecedentes; sem mínimo de dias na avaliação.

## Países
Lista com ~100 países restritos no FAQ. **Brasil NÃO aparece.**

## Ambiguidades / pontos a conferir
- Acesso de 30 dias da Qualification/Momentum (página de preços, llms.txt, artigo de reset) × FAQ "não há máximo de dias de trading". Planejar dentro de 30 dias.
- Fast Track/Momentum "pagos no mesmo dia" (FAQ e Help Center) × Master semanal na quarta.
- Momentum: reset e regra de trava do drawdown na Master do Momentum não estão descritos.
- Preços da Qualification só na página de preços (JS).
