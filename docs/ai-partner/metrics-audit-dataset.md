# Dataset de auditoria das métricas — "TEN" (10 trades de MNQ)

Montado para você **conferir à mão** cada número do motor (`src/lib/metrics/`). É o mesmo dataset de `scripts/_metrics-fixtures.mts → ten()`.
Premissas: **MNQ**, 1 contrato, **US$ 2 por ponto**, comissão **1,00** + taxas **0,20** por trade ⇒ **líquido = bruto − 1,20**.
Horários em `America/New_York`. Bruto = pontos × 2.

## Trades

| id | data | entrada → saída (ET) | lado | preço | pontos | bruto | **líquido** | stop | risco (US$) | **R líq** | R pts | estratégia / versão | setup | tf |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t1 | seg 12/01 | 09:35 → 09:50 | LONG | 21000 → 21020 | +20 | +40,00 | **+38,80** | 20990 | 20 | **+1,94** | +2,0 | orb / orb-v1 | breakout | 5m |
| t2 | seg 12/01 | 10:10 → 10:25 | SHORT | 21050 → 21060 | −10 | −20,00 | **−21,20** | 21060 | 20 | **−1,06** | −1,0 | orb / orb-v1 | pullback | 5m |
| t3 | seg 12/01 | 11:05 → 11:20 | LONG | 21070 → 21070 | 0 | 0,00 | **−1,20** | 21060 | 20 | **−0,06** | 0,0 | orb / orb-v1 | — | 5m |
| t4 | ter 13/01 | 09:40 → 09:48 | LONG | 21100 → 21130 | +30 | +60,00 | **+58,80** | — | — | — | — | orb / orb-v2 | breakout | 5m |
| t5 | ter 13/01 | 10:30 → 10:45 | SHORT | 21140 → 21125 | +15 | +30,00 | **+28,80** | 21150 | 20 | **+1,44** | +1,5 | orb / orb-v2 | pullback | 5m |
| t6 | ter 13/01 | 14:00 → 14:30 | LONG | 21120 → 21100 | −20 | −40,00 | **−41,20** | 21110 | 20 | **−2,06** | −2,0 | fade / fade-v1 | — | 1m |
| t7 | qua 14/01 | 09:32 → 09:40 | LONG | 21200 → 21212,5 | +12,5 | +25,00 | **+23,80** | — | — | — | — | fade / fade-v1 | breakout | 1m |
| t8 | qua 14/01 | 10:00 → 10:50 | SHORT | 21230 → 21240 | −10 | −20,00 | **−21,20** | — | — | — | — | fade / fade-v1 | pullback | 1m |
| t9 | qua 14/01 | 15:00 → 15:10 | LONG | 21210 → 21210 | 0 | 0,00 | **−1,20** | — | — | — | — | — | — | — |
| t10 | qua 14/01 | 19:00 → 19:30 (overnight) | SHORT | 21190 → 21170 | +20 | +40,00 | **+38,80** | — | — | — | — | — | — | — |

Risco: `|entrada − stop| × 2 US$/pt × 1`. Ex.: t1 = 10 pts × 2 = 20 ⇒ R = 38,80 / 20 = **1,94**. t3 tem bruto 0 mas **líquido −1,20** (a comissão o torna perdedor): R = −1,20/20 = **−0,06**.

## Totais (base líquida, R líquido)

| Métrica | Conta | Valor |
|---|---|---|
| bruto | 40−20+0+60+30−40+25−20+0+40 | **115,00** |
| comissão / taxas | 10 × 1,00 / 10 × 0,20 | **10,00 / 2,00** |
| **líquido** | 115 − 10 − 2 | **103,00** |
| vencedores | t1, t4, t5, t7, t10 | **5** |
| perdedores | t2, t3, t6, t8, t9 | **5** (empates: 0) |
| win rate | 5/10 | **50,00 %** |
| soma dos vencedores | 38,80+58,80+28,80+23,80+38,80 | **189,00** |
| soma dos perdedores | −21,20−1,20−41,20−21,20−1,20 | **−86,00** |
| trade médio | 103 / 10 | **10,30** |
| vencedor médio / perdedor médio | 189/5 · −86/5 | **37,80 / −17,20** |
| maior vencedor / perdedor | t4 / t6 | **58,80 / −41,20** |
| **profit factor** | 189 / 86 | **2,1977** |
| payoff | 37,80 / 17,20 | **2,1977** |
| maior vencedor / ganhos | 58,80 / 189 | **31,11 %** |
| top 3 vencedores / ganhos | (58,80+38,80+38,80) / 189 (empate t1/t10 por id) | **72,17 %** |
| pontos | 20−10+0+30+15−20+12,5−10+0+20 | **57,5 total · 5,75 médio** |

### R (só t1, t2, t3, t5, t6 — 5 de 10 ⇒ cobertura 50 %)
| Métrica | Conta | Valor |
|---|---|---|
| R total | 1,94 − 1,06 − 0,06 + 1,44 − 2,06 | **+0,20** |
| R médio / expectancy | 0,20 / 5 | **+0,04** |
| R mediano | ordenado: −2,06 · −1,06 · **−0,06** · 1,44 · 1,94 | **−0,06** |
| win rate em R | R>0: t1, t5 ⇒ 2/5 | **40 %** |
| R médio vencedor / perdedor | (1,94+1,44)/2 · (−1,06−0,06−2,06)/3 | **+1,69 / −1,06** |
| identidade | 0,4 × 1,69 + 0,6 × (−1,06) | 0,676 − 0,636 = **0,04** ✓ |
| R em pontos (rBasis POINTS) | 2 − 1 + 0 + 1,5 − 2 | **+0,50 total · mediana 0** |

### Drawdown e sequências (ordem de saída = ordem dos ids)
Equity líquida acumulada: **38,80 · 17,60 · 16,40 · 75,20 · 104,00 · 62,80 · 86,60 · 65,40 · 64,20 · 103,00**.
- Picos: 38,80 (t1) → 75,20 (t4) → **104,00 (t5)**. Quedas: após t6 = 104,00 − 62,80 = **41,20** (a maior); após t8 = 38,60; após t9 = 39,80.
- **maxDrawdown = 41,20** (pico t5 → fundo t6); **não recuperado** (final 103,00 < 104,00); **currentDrawdown = 1,00**; **recoveryFactor = 103,00 / 41,20 = 2,5**.
- **maxDrawdown em R** (curva de R de t1,t2,t3,t5,t6: 1,94 · 0,88 · 0,82 · 2,26 · 0,20): pico 2,26 → fundo 0,20 ⇒ **2,06**.
- Sequência W L L W W L W L L W: **2 vitórias** (t4, t5) · **2 derrotas** (t2, t3) · atual **+1** (t10).
- Base **bruta** (t3 e t9 viram empates): vencedores 5 · perdedores 3 (t2, t6, t8) · empates 2 · soma 195/−80 ⇒ PF **2,4375**; drawdown máx **40,00** (pico 110 → fundo 70) **recuperado em t10** (115 ≥ 110, 4 trades depois).

## Agrupamentos (líquido) — fuso America/New_York, âncora = entrada

| Dimensão | Grupos (trades → líquido) |
|---|---|
| **hora** | 09h: 3 → **+121,40** · 10h: 3 → **−13,60** · 11h: 1 → −1,20 · 14h: 1 → −41,20 · 15h: 1 → −1,20 · 19h: 1 → +38,80 |
| dia da semana | seg: 3 → +16,40 · ter: 3 → +46,40 · qua: 4 → +40,20 |
| sessão (ET) | AM: 7 → +106,60 · PM: 2 → −42,40 · OVERNIGHT: 1 → +38,80 |
| direção | LONG: 6 → +77,80 · SHORT: 4 → +25,20 |
| dia | 12/01: +16,40 · 13/01: +46,40 · 14/01: +40,20 |
| dia de **pregão** CME | 12/01: +16,40 · 13/01: +46,40 · 14/01: **+1,40** · **15/01: +38,80** (o overnight t10 já é o pregão do dia seguinte) |
| estratégia | fade: 3 → −38,60 · orb: 5 → +104,00 · (sem): 2 → +37,60 |
| versão | fade-v1 −38,60 · orb-v1 +16,40 · orb-v2 +87,60 · (sem) +37,60 |
| setup | breakout: 3 → +121,40 · pullback: 3 → −13,60 · (sem): 4 → −4,80 |
| timeframe | 1m: 3 → −38,60 · 5m: 5 → +104,00 · (sem): 2 → +37,60 |

**R por hora:** 09h → R só em t1 (**1 de 3**, cobertura 0,3333) = +1,94 · 10h → t2 + t5 (**2 de 3**) = −1,06 + 1,44 = **+0,38** · 14h → t6 = −2,06.
**Invariante:** a soma dos grupos de **qualquer** dimensão é 10 trades e **103,00** (testado em todas).

## Exemplo de saída (`aggregateTrades(ten, { groupBy: "hour" })`, trecho)
```
09:00 → 3 trades → +121,40   (R: 1 de 3 trades com risco → +1,94)        [amostra LOW]
10:00 → 3 trades →  −13,60   (R: 2 de 3 → +0,38)                          [amostra LOW]
11:00 → 1 trade  →   −1,20                                                 [amostra TINY]
```
Cada linha vem com `sampleSize`, `coverage`, `basis` e `definitionVersion`; o resultado total traz filtros, período, `tradeSetHash` e avisos.
