# PASSO A REVISAR — rodada 3: E6.6-2c (seu achado #1, validador de imperativos de mercado)

- **Commits:** `ba63147` (expectativa) e `e7ba31f` (código + testes). SÓ LOCAIS. Backup privado está em `ce767a3`.
- **Diff:** `git diff ce767a3..e7ba31f`. Em `src/` mudou SÓ `src/lib/agent/lexicon.ts` (ADVICE 83 → 178 termos). `validate-text.ts` NÃO mudou.
- **Ambiente:** `node_modules` pronto, NÃO rode install. Esperado: `npm run test:domain` exit 0 com **984 ✓**; `npx tsc --noEmit` 0.
- **Regra decidida:** verbos unívocos soltos (compre, zere, alavanque, desalavanque, proteja, aguarde); homônimos (venda, entre, corte, saia, compra, vende, feche, realize, segure, fique, opere) NUNCA soltos, só locução composta. `entre comprado`/`entre vendido` ficaram de fora DE PROPÓSITO ("a distinção entre comprado e vendido" é análise legítima). Falsos negativos pinados em `e66_2c.known_false_negatives_2c`. Não os reporte como achado novo, a menos que você ache um CASO PIOR que os 10 declarados.
- **Arquivos-chave:** `src/lib/agent/lexicon.ts`, `scripts/test-agent-validate-text.mts` (seção "E6.6-2c": H2–H6; L0 e T1 ajustados), bloco `e66_2c` em `scripts/expectations/agent-answer.expected.json`, `agent-answer-plano.md` §20.
- **Foco desta rodada:**
  1. **Burla:** gere frases de ordem de mercado que continuam passando e que NÃO estejam entre as 10 declaradas (variações de pessoa/tempo verbal, perífrase, "Vamos comprar…", "É hora de vender", "Que tal fechar…", "sugiro" já é pego; ordem em inglês/espanhol, sem acento, MAIÚSCULAS, letras separadas, Unicode). Traga a entrada exata e o `validateText` real.
  2. **Falso positivo:** gere frases ANALÍTICAS legítimas (o agente descrevendo dados, sem dar ordem) que agora são rejeitadas por um dos 95 termos novos. Ex.: "fique de fora" em descrição, "mantenha" em contexto de dado, "close the trade" descritivo, "proteja" etc. Traga a entrada exata.
  3. Algum dos 95 termos colide com os OUTROS léxicos ou com os 231 casos do corpus do e66_2b de forma que o teste não pegue?
  4. **Honestidade:** o §20 e o `e66_2c` descrevem fielmente o que foi feito? Algo superdeclarado (ex.: "11 mutações, todas pegas")? Reproduza 2 ou 3 delas.
  5. Já sei de um falso positivo PREEXISTENTE (`analise` rejeita o substantivo "análise"); não reporte, mas me diga se há OUTROS termos antigos do ADVICE com o mesmo problema (substantivo × imperativo), com prova.

SÓ LEITURA. Mesmo formato de saída; "nada encontrado em #N" quando for o caso.
