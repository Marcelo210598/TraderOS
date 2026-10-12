# Expectativas de cenários (escritas ANTES da implementação)

Regra (a partir de 12/10/2026, pedida na revisão do E6.4/E5b-derivados):
1. Para todo cenário novo de verificação/Lab, o veredito esperado e os checks esperados são escritos num arquivo `*.expected.json` desta pasta e **commitados antes** do código que os faz passar. O teste lê o arquivo; nunca se ajusta a expectativa para acompanhar o resultado sem justificar no `_meta.history`.
2. Mudar uma expectativa existente exige uma entrada em `_meta.history` com data, motivo e quem pediu.
3. A expectativa é **separada** do resultado: o resultado vem da execução real; o arquivo diz o que o contrato prevê.

Arquivos:
- `lab-derived.expected.json` — os 17 cenários da aba Derivados (E6.4). **Congelado APÓS a execução** (os 17 foram previstos no próprio `derived.ts`, campo `expected`, antes da 1ª execução, mas sem arquivo separado; este arquivo formaliza o que já foi verificado). Não é uma previsão independente: é uma trava contra regressão.
- `derived-legrefs-edge.expected.json` — casos de borda de referências de pernas (`refs.legs.items`). **Escrito ANTES** do conserto do E5b que silenciava referência não conferida: o caso `tradeId_inexistente` previa `SOURCE_VERIFIED_PARTIAL` enquanto o código ainda dava `SOURCE_VERIFIED`.
- `sourcelabel.expected.json` — S0 do plano do `sourceLabel` (`docs/ai-partner/sourceLabel-plano.md`). **Escrito ANTES de qualquer código**: tabela rótulo → saída (vocabulário v1, decisões A/B), propriedades do token, rejeições do V0, invariantes de hash com pins de baseline do commit `804def3`, E5b com rótulo livre, `exitReasonMap` (decisão C), `labelVocab` (decisão D) e Lab. O teste que a consome é escrito no S1+ (ainda não existe).
