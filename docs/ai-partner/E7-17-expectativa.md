# E7-17 — `metrics.compare` PERIOD: verificação intermitente em métricas de sequência (22/10/2026)

Só documento. Nenhum código, nenhum deploy, nenhuma mudança em produção.

## 1. Fatos medidos
1. **O bug é intermitente, não determinístico por entrada.** Mesmo CSV sintético (60 linhas) e mesma chamada `metrics.compare` modo PERIOD com `maxDrawdown`, rodada 8 vezes em processos novos: **7× `TAMPERED`** (`V_DERIVED_RESULT_MISMATCH` + `V_DERIVED_DERIVATION_MISMATCH`) e **1× `VALID`**. Em outra série de 6 rodadas: 5× TAMPERED, 1× VALID. (O resumo anterior dizia "4 métricas sempre"; era uma foto de uma rodada só. Hoje `recoveryFactor` e `maxDrawdown` falharam; `currentDrawdown`/`maxConsecutiveWins` apareceram VALID numa rodada e TAMPERED em outras não foi reexaminado.)
2. **Variável que muda entre rodadas = o sal** (`InMemorySaltKeyring` aleatório): ele muda os `tradeId`/refs.
3. **Mecanismo (lido no código):**
   - `prepare.ts:195` `sequenceOrder`: ordena por `orderKey` (instante de saída) e desempata por `index` = **posição do trade no array de entrada**.
   - Construtor (`computeDerived` com `select:true`) recebe os trades na ordem original dos dados.
   - Verificador (`verify.ts` ~l.714–737) remonta os trades pela ordem de `population.tradeIds`, que é `kept.map(r => r.id).sort()` (`calculate.ts:398`) = **ordem alfabética do id salgado**, ou seja, aleatória a cada sal.
   - Quando há **empate de instante de saída**, o desempate por `index` dá ordens diferentes no construtor e no verificador ⇒ curva de patrimônio diferente ⇒ `maxDrawdown`/`recoveryFactor` (dependem da sequência) divergem ⇒ TAMPERED. Sem empate, a ordem não importa.
4. **Controle:** mesma consulta com CSV sem empates de saída (minutos/segundos distintos por linha): **8/8 `VALID`**. Com empates (dado original): 7/8 TAMPERED.
5. **Relevância real:** exportações de corretora têm saídas no mesmo segundo (parciais, ordens a mercado em lote). Em dado real o bug aparece de forma intermitente, não só em sintético.
6. **A barreira de integridade funcionou:** o chat escondeu os números (veredito "não confere"). Nenhum número errado chegou ao usuário; o custo é resposta sem valor.
7. **Precedente no motor:** `calculate.ts:164–165` já desempata rankings por `id` (`byIdAsc`), então desempate por id não é conceito novo.
8. **Não medido ainda:** (a) se `metrics.groups`/`rank.groups` de métricas de sequência têm o mesmo risco quando há empates (as rodadas de `groups` deram VALID, mas com uma rodada só); (b) se todo `AnalyticsTrade` do verificador preserva o mesmo `id` do construtor (esperado, o `tradeSetHash` depende dele).

## 2. Opções (decisão pede OK)
- **A — Verificador reproduz a ordem do construtor.** Exige uma ordem canônica gravada na Evidence (ex.: número da linha de origem). Mexe no formato da Evidence (`schema`), mais invasivo.
- **B — Tornar o motor independente da ordem de entrada: desempate por `id` em vez de `index`** (`sequenceOrder`). Mesmo conjunto de trades ⇒ mesmo resultado, em qualquer ordem. Uma linha de código no motor, mais testes. **Efeito colateral honesto:** em dado com empates, o valor de `maxDrawdown`/`recoveryFactor`/sequências pode mudar em relação ao de hoje (hoje depende da ordem do array). Como o `id` contém o hash do arquivo/linha, a ordem entre empates vira "estável, mas não a ordem do arquivo".
- **C — Verificador reordena as sondas pela ordem original antes de recalcular.** Precisa do dado de ordem (mesma exigência de A).

**Recomendação: B.** Garante a propriedade certa (resultado = função do conjunto, não da ordem), é pequeno, e já há precedente no motor. Ponto a decidir por você: se a ordem entre empates deveria seguir a ordem do arquivo (então A/C) ou se basta ser determinística (B). Para métricas de sequência com saídas empatadas, não existe ordem "verdadeira" — o instante é idêntico.

## 3. Testes escritos antes do código (fase vermelha)
- **T1 Reprodução determinística (sem sal aleatório):** população com empates de saída; construir com ordem X e verificar com ordem inversa ⇒ hoje diverge. Deve falhar antes da correção e passar depois.
- **T2 Propriedade de ordem:** para `maxDrawdown`, `currentDrawdown`, `recoveryFactor`, `maxConsecutiveWins/Losses` (e demais métricas de sequência do catálogo): `calculateMetrics(trades)` = `calculateMetrics(embaralhar(trades))` em N permutações com empates.
- **T3 Ponta a ponta:** `metrics.compare` PERIOD com 60 linhas (as do repro) × 20 sais diferentes ⇒ 20× `VALID` (hoje ~85% TAMPERED). `metrics.groups` e `rank.groups` com métricas de sequência também.
- **T4 Sem regressão:** população sem empates ⇒ valores idênticos aos de hoje (golden dos testes existentes); `test:domain` inteiro verde.
- **Mutação:** voltar o desempate para `index`; desempatar só em parte (ex.: ignorar um dos campos); trocar ASC/DESC. Todas devem ser pegas.
- **Prompt do chat:** depois de corrigido e medido, remover o aviso "evite `maxDrawdown`… em compare PERIOD" do prompt (volta a economizar tokens).

## 4. Custos / riscos
- Custo: zero (sem Groq, sem produção).
- Risco B: muda valor de sequência em dados com empates (a decidir/aceitar). Bump de `ENGINE_VERSION` ("metrics/1.0.0") só se você preferir sinalizar a mudança de comportamento; evidências antigas deixariam de verificar (`V6.versions`). Não há evidência persistida em produção hoje (ledger/ Evidence são do turno) — **a confirmar no código antes de decidir o bump**.
- Nada disso toca `origin`, produção ou o backup além do commit habitual.

## 5. Ordem
1. aprovado ⇒ 2. commit local da expectativa + fase vermelha (T1–T3 falhando) ⇒ 3. testes completos ⇒ 4. correção (B ou a que você escolher) ⇒ 5. verde (mutações, `tsc`, ESLint, `test:domain`) ⇒ relatório e OK ⇒ commit + backup.
