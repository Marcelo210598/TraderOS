# Validação com export REAL do NT8 (grade PT-BR) — 01/10/2026

Arquivo: *NinjaTrader Grid 2026-09-21* (7 linhas, conta de simulador). **Original intacto** (sha256 conferido na cópia).
A cópia vive em `fixtures/ninjatrader/trade-performance/` e é **local e não versionada** (o repositório é **público**; `.gitignore` bloqueia tudo em `fixtures/` exceto `_synthetic/`, READMEs e `.gitkeep`). Os testes usam o **próprio CSV como oráculo**, sem números embutidos.

## Resultado
O parser `ninjatrader-trades-ptbr` leu **7/7 linhas sem erro**, sem alteração de código para o formato em si. Rodado **antes** de qualquer ajuste, para medir divergências.

## Divergências encontradas
| # | Divergência | Impacto | Tratamento |
|---|---|---|---|
| 1 | **MGC (Micro Ouro) fora do catálogo** ⇒ `pointValue = null` ⇒ 4 das 7 linhas sem bruto/líquido, base de P&L `UNKNOWN`, MFE/MAE não convertidos (comportamento **correto por desenho**, mas dado real exigia o instrumento) | métricas em dólar exclu­íam 4/7 trades | **MGC = US$ 10/ponto adicionado ao catálogo**, com evidência do próprio arquivo: `pontos × 10 − corretagem = Profit` exato nas 4 linhas |
| 2 | Nenhuma outra divergência de parsing: vírgula decimal **sem** separador de milhar (`30554,50`), acentos nos cabeçalhos (`Sáída` com acento extra), **coluna final vazia** (`;` no fim), CRLF, UTF-8 — todos tratados | — | confirmado |

## Confirmado pelos dados reais (antes eram suposições)
- **`Profit` do NT8 PT-BR é LÍQUIDO de corretagem** (reconciliado nas 7 linhas; a base é inferida pelos preços e carimbada `INFERRED_FROM_PRICES`). A coluna **"Acu lucro líquido"** confirma: o motor reproduz o acumulado **linha a linha**.
- **Taxas** (Compensação, Bolsa, IP, NFA) existem como colunas separadas (aqui todas zero) ⇒ `commission` (corretagem) e `fees` separados funcionam.
- **MAE/MFE em dólar TOTAL da linha**: o valor escala com a quantidade (qtd 2 ⇒ o dobro de qtd 1 para o mesmo movimento); convertidos para **pontos por contrato** ficam idênticos entre linhas da mesma entrada. `excursionUnit = USD_TOTAL` está correto para este formato.
- Coerência MFE/MAE × resultado realizado: nenhum aviso.

## Observações / decisões em aberto
1. **Fuso de origem NÃO confirmado.** `sourceTz = America/Sao_Paulo` foi **assumido** no `.context.json` (marcado como pendente). Os testes de regressão comparam o horário **local do arquivo** (independente do fuso), mas qualquer análise por hora/sessão depende da confirmação. *Pergunta ao usuário: qual o fuso do PC/NT8 que exportou?*
2. **Uma linha = uma SAÍDA, não uma entrada.** Linhas de uma mesma entrada (mesmo horário e preço de entrada, saídas diferentes: `Target1`, `Stop2`, `Zerar`…) viram trades separados. Isso é fiel ao NT8, mas **conta vários "trades" para uma entrada** (infla contagem/win rate). Decisão pendente: agrupar por entrada (posição) para a análise?
3. As colunas **"Entrada"/"Sáída"** (nomes de ordem: `Entry`, `Target1`, `Stop2`, `Zerar`) hoje são **ignoradas**; seriam um `exitReason` útil para a análise (alvo × stop × saída manual). Não implementado.
4. **Sem stop no export** ⇒ R indisponível (nunca inferido), como previsto.
5. Ainda **sem validação real** para: NT8 em inglês, Tradovate (Orders/Fills) e Rithmic.

## Atualização — reconstrução de ciclos

O fixture real agora é validado **por ciclo** (7 linhas → 2 Trades; `integrity CONSISTENT`, 0 ambiguidades, bordas `UNVERIFIED_BOTH`, confiança HIGH). O P&L total é idêntico antes/depois; só contagem e médias mudam. Fuso de origem continua **assumido** (America/Sao_Paulo, `sourceTzOrigin` ausente ⇒ aviso) até confirmação do usuário.

## Segundo fixture real — `nt8-grid-ptbr-2026-10-01` (local, ignorado pelo git)

Export real PT-BR de 01/10/2026: 27 linhas → **15 ciclos**, um único contrato (MNQ), 2 contas (uma com estratégia e nomes de ordem; outra sem nenhum dos dois). Integridade `CONSISTENT`, confiança HIGH. **Sem valores de P&L neste documento** (repositório público).

Validado pela primeira vez em dado real: ciclos perdedores, vários ciclos por chave, bordas `VERIFIED`, scale-in, scale-out, saídas simultâneas, preços de entrada diferentes, `Stop1/Stop2` e `Zerar`, valores negativos (`-$ 99,99`), múltiplas contas, linhas **sem estratégia/rótulo** (⇒ `exitReason UNKNOWN`, `reasonRule NONE`) e **um `EXCURSION_CONFLICT`** (MAE/MFE divergentes entre linhas do mesmo ciclo).

Validação: invariantes financeiros preservados antes/depois da reconstrução e **oráculo independente** (`scripts/oracle-nt8-cycles.py`, sem dependência do TypeScript) com 0 divergências nos dois fixtures. `.context.json` **sem `sourceTz`** (fuso do Windows não confirmado) ⇒ `sourceTzOrigin = DEFAULT` + `W_SOURCE_TZ_DEFAULTED`. O arquivo original fica **fora de qualquer repositório git**.
