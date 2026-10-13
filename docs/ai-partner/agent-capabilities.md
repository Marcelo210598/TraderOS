# Contrato de capacidades do agente — `agent-capabilities/1` (E6.5-1)

> **Só documento.** Nenhuma capacidade, validador, projetor ou integração com LLM/Vega IA existe. Tipos e schemas vêm no E6.5-2; código (combinado, validador, PromptViews) só no E6.6, com aprovação própria.
> Origem: `agent-contract-plano.md` (D1–D10, A1–A3 aprovados em 12/10/2026) e `scripts/expectations/agent-contract.expected.json`. Fundamentos: `E6-G6-plano.md` §6.1 (veredito combinado), `data-contract.md` §14.13–14.15 (E5b, sourceLabel, sal), `salt-policy-plano.md`.

## 0. Constantes fixadas
| Constante | Valor | Onde vale |
|---|---|---|
| `AGENT_MAX_REGENERATIONS` (**N**) | **2** — até 2 regerações (3 tentativas) com o motivo da rejeição como feedback; depois, resposta canônica de §5.4 | validador (E6.6) |
| `EXPLAIN_MAX_TRADES` (**K**) | **20** trades por chamada de `evidence.explain` | §8 |
| `REF_FORMAT` | `^ev_[0-9a-f]{32}$` (= prefixo de 32 hex do `evidenceHash`) | §2 |
| Versão do contrato | `agent-capabilities/1` | `CapabilityResult.contract` |
Mudar N, K ou qualquer frase canônica exige entrada em `_meta.history` do arquivo de expectativas e bump do contrato.

## 1. Princípios
1. O agente **nunca calcula, arredonda ou digita número**: chama capacidades determinísticas e cita `evidenceRef`; o servidor renderiza os números (slots, §4).
2. Sem `evidenceRef`, ou com veredito combinado fora de `VERIFIED`/`VERIFIED_PARTIAL`, ele **declara a limitação** (única exceção, rotulada: `NOT_VERIFIED` com `verify = VALID`, §6).
3. O bundle **nunca** entra no prompt: só a PromptView (lista branca) e, sob demanda, o `evidence.explain`, ambos pela **mesma** projeção (§8).
4. `verify` e `verifySource` **não** são ferramentas do agente: rodam dentro de cada capacidade (ler o E5b isolado é proibido pelo §6.1 do E6-G6).

## 2. Envelope de toda capacidade
```ts
CapabilityResult<T> = {
  contract: "agent-capabilities/1"
  capability: string              // "metrics.query@1"
  ok: boolean                     // a CAPACIDADE executou (não é veredito de evidência)
  data: T | null                  // PromptView da capacidade (§8); nunca o bundle
  evidence: EvidenceHandle | null // null só se ok=false
  limits: Limit[]                 // {code, text}: frases canônicas do servidor (§6)
  error?: { code: CapabilityErrorCode }   // ok=false: ARGS_INVALID | NOT_FOUND | BUDGET_EXCEEDED | ENGINE_REFUSED | FILE_NOT_AVAILABLE
}
EvidenceHandle = {
  evidenceRef: "ev_" + 32 hex     // D1
  evidenceHash: string            // 64 hex (server-side; o modelo só vê evidenceRef)
  subject: { type: "METRIC"|"TRADE"|"DERIVED", id: string }
  scope: "TOTAL" | "GROUP"
  population: { declared: number, verifiability: "FULL"|"HASH_ONLY", sampleFlag?: "OK"|"LOW"|"TINY", conclusive?: boolean, confidence?: "OK"|"LIMITED"|"UNRELIABLE" }
  refEpoch: string                // saltId vigente na geração dos refs (§7)
  verdict: {
    verify:  { status: "VALID"|"TAMPERED"|"UNVERIFIABLE"|"INVALID_FORMAT", codes: string[] }
    source:  { status: "SOURCE_VERIFIED"|"SOURCE_VERIFIED_PARTIAL"|"SOURCE_MISMATCH"|"UNVERIFIABLE"|"NOT_RUN", codes: string[] }
    combined: "VERIFIED"|"VERIFIED_PARTIAL"|"NOT_VERIFIED"|"TAMPERED_OR_MISMATCH"
  }
  freshness: "CURRENT" | "STALE"  // STALE: gerado numa refEpoch anterior (§7)
}
```
- **Os dois veredictos andam juntos** sobre o **mesmo** `evidenceHash` (§6.1 do E6-G6). Um schema que aceite só um dos dois é inválido (CP1). Não existe campo `ok`/`verified` agregado sem os dois componentes e o escopo (CP2).
- **`combined` vem de uma única função pura** (E6.6, D8), com a semântica já fixada: `VERIFIED` = `VALID` ∧ `SOURCE_VERIFIED`; `VERIFIED_PARTIAL` = `VALID` ∧ `SOURCE_VERIFIED_PARTIAL`; `TAMPERED_OR_MISMATCH` = verify `TAMPERED`/`INVALID_FORMAT` ∨ source `SOURCE_MISMATCH`; **`NOT_VERIFIED` = qualquer `UNVERIFIABLE` e também `source = NOT_RUN` (D4)**. Precedência: `TAMPERED_OR_MISMATCH` > `NOT_VERIFIED` > `VERIFIED_PARTIAL` > `VERIFIED`.
- `evidenceRef` é **endereçado por conteúdo**: mesmo bundle ⇒ mesmo ref; qualquer mudança ⇒ outro. Só vale o ref que o **ledger** da conversa emitiu (§4.2).
- **Orçamento por turno** (O-E, aprovado): no máximo **8 chamadas** de capacidade. A 9ª **não é executada**: o servidor devolve `BUDGET_EXCEEDED` e o agente **para e declara** (§5.5). Nunca trunca e responde como se tivesse terminado.

## 3. Catálogo de capacidades (todas somente leitura)
`userId` vem **sempre da sessão**, nunca do modelo. Argumentos validados por zod; nome de conta/estratégia entra como **alias** que o servidor resolve para o ref do usuário.

| Capacidade | Entrada (resumo) | Motor/derivado por baixo | `data` (PromptView) |
|---|---|---|---|
| `metrics.query@1` | `metricIds[]` (das 39 do catálogo), filtros do motor, opções (base NET/GROSS, R) | `calculateMetricsTraced` + `explainMetric` | por métrica: valor, unidade, base, amostra, cobertura, motivo de indisponibilidade |
| `metrics.groups@1` | `groupBy` (dimensões do motor, inclui `exitReason`), `metricIds[]`, filtros | `aggregateTradesTraced` + bundle de grupo | grupos (chave = alias/valor de dimensão), valores, `sampleFlag` |
| `exit.breakdown@1` | filtros | E6.1 (`exitBreakdown`, perna e trade) | quebra por motivo (perna **e** trade, unidades nunca misturadas), cobertura, conferência perna×trade |
| `metrics.compare@1` | grupo A, grupo B, `metricIds[]` **ou** dois períodos | `GROUP_COMPARISON`, `PERIOD_COMPARISON` | deltas, razões, `conclusive`, confiança |
| `rank.groups@1` | `groupBy`, métrica, ordem, `where` | `GROUP_RANKING`, `LEG_GROUP_RANKING` | ranking, contribuição, participação |
| `exit.analysis@1` | filtros, motivo | `EXIT_REASON_ANALYSIS`, `EXIT_REASON_COMPARISON_LEGS`, `EXIT_REASON_COMPARISON_TRADES` | análise por motivo, comparação STOP×TARGET etc. |
| `evidence.explain@1` | `evidenceRef`, `page` | só leitura do bundle do ledger | ≤ **K = 20** trades/pernas por chamada (§8, T2) |
| `evidence.refresh@1` | `evidenceRef` | regera a Evidence com o sal atual a partir do arquivo | novo `EvidenceHandle` (§7) |
- **Cada** capacidade que devolve número roda `verifyEvidence` **e** `verifyEvidenceSource` sobre o mesmo bundle antes de responder. Sem o arquivo original (hoje, sempre) o `source` é `NOT_RUN`.
- Capacidade **nunca** escreve em banco/arquivo, nunca chama LLM, nunca aceita `userId`.
- Versionamento `nome@semver`; mudança de `definitionVersion`/`engineVersion` do motor ⇒ bump registrado; a versão do prompt vai no `AgentRun`.

## 4. Citação: ledger, resposta estruturada e slots
### 4.1 Resposta do agente
```ts
AgentAnswer = {
  segments: Array<
    | { kind: "text"; text: string }                       // sem dígitos de resultado; ver 4.4
    | { kind: "slot"; ref: EvidenceRef; path: string }      // número/valor vindo da PromptView
    | { kind: "phrase"; code: PhraseCode; ref?: EvidenceRef } // frase canônica do servidor (§6)
  >
  claims: Array<{ ref: EvidenceRef; path: string; mode: "ASSERT" | "LABELED" }>
}
```
O modelo escreve `text` e escolhe `slot`/`phrase`; **o servidor** renderiza os valores e as frases. O modelo não produz número nem texto de limitação.
### 4.2 Ledger
O servidor mantém, **por conversa**, `evidenceRef → EvidenceHandle` para tudo que as capacidades emitiram. O validador só aceita ref presente no ledger **daquela conversa e daquele usuário** (R3/R4: um ref bem formado que o ledger não emitiu é rejeitado).
### 4.3 Slots e formatos (O-F, aprovado e CORRIGIDO)
**É só exibição.** O valor interno do motor (centavos inteiros, R em 1e-4) e a lógica de comparação, ranking e desempate **não são afetados**: o texto renderizado nunca volta ao motor, e o validador não compara números exibidos.
O formato é **ditado pela unidade do campo** (o modelo não escolhe precisão). Locale pt-BR: vírgula decimal, ponto de milhar, sinal `-`. **A exibição usa EXATAMENTE as casas decimais que o motor já usa na saída** (`exact.ts`: dinheiro 2, R 4, percentual 2, razões 4; pontos até 6) — **preenche zeros, nunca arredonda de novo.** (Correção: a proposta anterior de "2 casas para tudo" faria uma segunda rodada de arredondamento sobre R e razões, que o motor guarda com 4 casas.)
| Unidade | Renderização | Casas | Exemplo |
|---|---|---|---|
| `count` | inteiro | 0 | `1.234` |
| `usd` | `US$` + valor | 2 | `-US$ 1.234,56` |
| `R` | valor + ` R` | 4 | `1,2500 R` |
| `percent` | valor + `%` | 2 | `55,56%` |
| `ratio` | valor | 4 | `1,8400` |
| `points` | valor + ` pts` | mín. 2, máx. 6 (zeros à direita aparados até 2) | `12,50 pts` |
Valor `null` ⇒ `indisponível` **mais** o motivo (`reason` do motor), nunca `0`, nunca em branco. Slot de dado não numérico (alias, rótulo, motivo de saída) usa a palavra canônica correspondente.
**Empate:** o motor marca `tiedWithPrevious` comparando valores **já no escalonamento da saída** (as mesmas casas da exibição); logo, dois valores exibidos iguais ⇔ empate do motor. O agente só pode dizer "empate"/"iguais" quando `tiedWithPrevious = true` (`TIE_OVERCLAIM`).
### 4.4 O que o texto livre pode e não pode
- Pode: texto **qualitativo sem número de resultado** e sem causa.
- **Número que o usuário digitou** na pergunta pode ser repetido **entre aspas, como citação**, nunca como afirmação do agente (O-A, aprovado).
- Não pode: número fora de slot (inclui "cerca de", "mil", "metade"), aritmética (soma/razão/diferença escrita pelo modelo), afirmação de **causa**, "stop real"/tipo real da ordem, recomendação operacional, "seu histórico inteiro" (escopo = **população declarada**, n), conclusão com `conclusive=false` ou `sampleFlag` LOW/TINY.

## 5. Validador e protocolo de regeração (implementação em E6.6)
### 5.1 Regras e motivos de rejeição
`INCOMPLETE_PRESENTED_AS_COMPLETE` · `TIE_OVERCLAIM` · `NUMBER_OUTSIDE_SLOT` · `REF_NOT_IN_LEDGER` · `SLOT_PATH_INVALID` · `MODEL_ARITHMETIC` · `NUMBER_FROM_UNVERIFIED_EVIDENCE` · `MISSING_NOT_VERIFIED_LABEL` · `UNVERIFIED_USED_FOR_CONCLUSION` · `REF_EPOCH_MIX` · `STALE_REF` · `CAUSAL_CLAIM` · `EXIT_REASON_OVERCLAIM` · `SCOPE_OVERCLAIM` · `MISSING_PARTIAL_PHRASE` · `INCONCLUSIVE_AS_CONCLUSIVE` · `STRUCTURE_INVALID` (E6.6-2a: resposta fora do `AgentAnswerSchema` ou violação de forma do validador estrutural). Casos AV1–AV24 no arquivo de expectativas.
### 5.2 Ordem
(1) estrutura/zod → (2) refs no ledger e frescor → (3) slots/paths → (4) veredito × modo (§6) → (5) texto livre (dígitos, aritmética, causa, escopo) → (6) frases obrigatórias presentes.
### 5.3 Regeração (**N = 2**)
Rejeitou ⇒ nova tentativa com a lista de motivos **sem expor dado novo**; até 2 regerações. Os motivos viajam como códigos, nunca como valores.
### 5.4 Resposta canônica de falha
Após esgotar: *"Não consigo afirmar isso com evidência verificável agora."* + as capacidades tentadas + o motivo da última rejeição (código traduzido por frase canônica). **Nenhum número do modelo.** Falha de capacidade: o agente diz que falhou; nunca preenche. Orçamento de chamadas estourado: ver §5.5.
### 5.5 Motivos de parada (explícitos, nunca silenciosos)
| Motivo | Quando | O que acontece | Frase canônica (renderizada pelo servidor) |
|---|---|---|---|
| `BUDGET_CALLS` | as **8** chamadas do turno se esgotaram | a 9ª **não executa**; o modelo recebe `BUDGET_EXCEEDED` e tem **uma** resposta final **sem ferramentas** | *"Atingi o limite de consultas deste turno. Abaixo está o que apurei até aqui; o restante não foi apurado."* |
| `REGEN_EXHAUSTED` | a resposta foi rejeitada **N = 2** vezes (§5.3) | resposta canônica de falha (§5.4), sem número do modelo | *"Não consigo afirmar isso com evidência verificável agora."* |
| `CAPABILITY_FAILED` | `ok = false` (`ARGS_INVALID`, `NOT_FOUND`, `ENGINE_REFUSED`) | o agente diz que a consulta falhou; não preenche com memória | *"Uma consulta falhou e não consegui apurar essa parte."* |
| `FILE_NOT_AVAILABLE` | `evidence.refresh` sem arquivo armazenado | limitação **estrutural** (§6.2) | texto estrutural |
**Regras do `BUDGET_CALLS` (O-E):** (1) a resposta final **só pode afirmar o que está sustentado por chamadas já concluídas**, cada uma com o próprio veredito e modo (§6); (2) **deve** conter o segmento `phrase BUDGET_LIMIT_REACHED` — frase do servidor, que o modelo não consegue omitir nem parafrasear; sem ela ⇒ `INCOMPLETE_PRESENTED_AS_COMPLETE`; (3) é **proibido** truncar e responder como se tivesse terminado; (4) o orçamento de regeração (N = 2) vale para essa resposta final, e a resposta canônica de falha **também** carrega a frase de limite; (5) o ledger persiste: o usuário pode continuar no turno seguinte (orçamento novo) e os refs já emitidos seguem citáveis.

## 6. Comportamento por veredito e frases canônicas
### 6.1 Matriz
| Combinado | Números | Obrigatório | Proibido |
|---|---|---|---|
| `VERIFIED` | sim (`ASSERT`) | frase de **população declarada** (n) | "histórico inteiro"; conclusivo se `conclusive=false`/LOW/TINY; "confiável" |
| `VERIFIED_PARTIAL` | sim, com a frase | frase da razão parcial (§6.3); "indicativo" | generalizar além da população coberta |
| `NOT_VERIFIED`, `verify = VALID` | **rotulados** (`LABELED`) | §6.2 (estrutural e/ou específico) | usar em comparação/conclusão/recomendação |
| `NOT_VERIFIED`, `verify ≠ VALID` | **não** | frase específica (§6.2) | qualquer número |
| `TAMPERED_OR_MISMATCH`, `INVALID_FORMAT` | **não** | frase de integridade (§6.4); regeração feita **pelo servidor**; auditoria | número "da memória", especular causa, acusar o usuário |
Resposta mista: cada claim com o próprio modo; banner da resposta = o **pior**. Aritmética entre refs só via capacidade.
### 6.2 `NOT_VERIFIED`: dois textos distintos (A1)
**Estrutural** (código `VERIFICATION_INFRA_MISSING`; quando `source = NOT_RUN` por falta do arquivo armazenado). **Um único texto, idêntico em toda resposta, em posição fixa (banner/rodapé; forma visual é da UI — O-D):**
> *"Este valor foi calculado pelo motor do MeuTrade, mas ainda não foi conferido contra o arquivo original que você importou: essa verificação ainda não está disponível."*

**Específico** (um por código; **inline** no claim afetado; nunca fundido ao estrutural; se os dois se aplicam, aparecem os dois, o específico primeiro). **Não há frase de reserva:** código sem frase aqui faz o build do catálogo falhar (SG3). Códigos = os que `verify.ts`/`verify-source.ts` emitem hoje:

| Código | Frase canônica |
|---|---|
| `S_SOURCE_NOT_PROVIDED` | O arquivo original deste cálculo não foi fornecido para a conferência. |
| `S_ENCODING_UNSUPPORTED` | O arquivo original não pôde ser lido na codificação registrada; a conferência contra ele não foi feita. |
| `S_VERSION_INCOMPATIBLE` | Este cálculo foi feito com uma versão do motor/leitor diferente da atual e não pode ser reproduzido; isso não indica erro nos dados. |
| `S_CONTEXT_INSUFFICIENT` | Faltou o contexto da importação (por exemplo, o mapa de motivos de saída que você definiu) para reproduzir o cálculo. |
| `S_REINGEST_FAILED` | Não foi possível refazer a importação a partir do arquivo para conferir o cálculo. |
| `S_FILE_NOT_VERIFIED` | O arquivo fornecido não pôde ser validado antes da conferência; nada que dependa dele foi checado. |
| `S_ACCOUNT_REF_UNVERIFIED` | Sem o sal de identificação das contas não dá para conferir a ligação deste valor às suas contas. |
| `S_ROWHASH_MISSING` | Faltam as marcas de linha necessárias para ligar este valor ao arquivo. |
| `S_NO_IMPORTS` | Este valor não tem nenhuma importação associada; não há arquivo a conferir. |
| `S_DERIVED_TRADES_NOT_VERIFIED` | Parte dos trades que sustentam esta análise não pôde ser conferida com o arquivo. |
| `S_SALT_UNKNOWN` | Não há mais sal conhecido que reproduza as identificações deste valor; isto não é prova de integridade (nada que dependa do sal foi conferido). |
| `S_SALT_RETIRED` | O sal usado neste valor foi aposentado; regere a análise para voltar a conferi-la. |
| `S_NO_METRICS` | Não há métrica neste resultado para conferir. |
| `S_HASH_ONLY` | A população é grande demais para ser listada: só a assinatura dela foi conferida, não cada trade. |
| `S_REFS_BROKEN` | As referências internas deste resultado estão incompletas; a conferência não pôde ser feita. |
| `S_PROVENANCE_INCOMPLETE` | A origem deste cálculo está incompleta; a conferência de proveniência não pôde ser feita. |
| `S_ASSOCIATION_UNVERIFIABLE` | A associação deste grupo (por exemplo, por estratégia) não tem referência no resultado e não pôde ser conferida. |
| `S_ORDER_NOT_RECORDED` | A ordem em que os trades foram processados não foi registrada; a conferência da sequência não foi feita. |
| `S_NO_ANCHOR_CHECK` | Não há âncora numérica para conferir este valor. |
| `S_QUERY_INVALID` | A consulta registrada neste resultado é inválida; o valor não pôde ser reproduzido. |
| `S_CHECK_NOT_EXECUTED` | Uma das conferências não foi executada; por segurança o valor é tratado como não verificado. |

Para a **versão final** das frases (revisão de redação) basta alterar este arquivo e o catálogo no E6.5-2; o conjunto de **códigos** é o que o teste deriva do código-fonte.
### 6.3 Frases de verificação parcial (`VERIFIED_PARTIAL`)
| Origem | Frase canônica |
|---|---|
| `S_POPULATION_PARTIAL` | Só parte da população foi conferida contra o arquivo; trate como indicativo. |
| `L_SALT_CHECK_DIVERGENT` | A conferência bateu. Os dados conferem; há uma inconsistência interna no registro de sal que não afeta este valor. |
| `L_SALT_ID_NOT_RESOLVED` | A conferência bateu com outro sal seu; a identificação de sal declarada no bundle estava errada. |
### 6.3b Frases de escopo (acrescentadas no E6.5-2)
| Código | Frase canônica |
|---|---|
| `POPULATION_DECLARED` | Considerando a população declarada de {n} trades. |
| `INDICATIVE_ONLY` | Resultado indicativo, não conclusivo. |
`{n}` é o único placeholder permitido e é preenchido pelo servidor a partir do handle.

### 6.4 Frases de integridade (`TAMPERED_OR_MISMATCH`, `INVALID_FORMAT`)
| Situação | Frase canônica |
|---|---|
| verify `TAMPERED` | O resultado não confere com o seu próprio selo de integridade; não vou citar números dele. Vou pedir que seja regerado. |
| source `SOURCE_MISMATCH` | O resultado não confere com o arquivo original; não vou citar números dele. Vou pedir que seja regerado. |
| `INVALID_FORMAT` | O resultado está ilegível ou fora do formato; não vou citar números dele. |
Sem especular causa e sem acusar o usuário. Regeração e auditoria são do servidor.
### 6.5 Limitações padrão (sob demanda)
`L_SEAL_NOT_SIGNATURE`, `L_SELECTION_NOT_PROVEN`, `L_ORIGIN_NOT_PROVEN`, `L_USER_ENRICHMENT_NOT_PROVEN`, `L_SEQUENCE_ORIGINAL_ORDER_NOT_PROVEN`, `L_DERIVED_POPULATION_SCOPE`: o agente mostra o **texto original do código** (`verify.ts`/`verify-source.ts`), nunca uma paráfrase.

## 7. Rotação de sal, memória e `refEpoch` (D6, O-B)
- Todo resultado com refs traz `refEpoch` (= `saltId`). Igualar/compar refs de **épocas diferentes** é proibido (`REF_EPOCH_MIX`).
- Após `rotate`, todo `evidenceRef` emitido na época anterior vira `STALE` no ledger; citá-lo sem `evidence.refresh` ⇒ `STALE_REF`.
- `evidence.refresh` regera a Evidence **sob o sal atual** a partir do arquivo original; devolve novo `evidenceRef`; o antigo permanece para auditoria. **Sem o arquivo armazenado, o refresh falha com `FILE_NOT_AVAILABLE`** e o agente declara a limitação **estrutural** (§6.2); nada é inventado.
- Sal **aposentado**: o bundle antigo verifica `NOT_VERIFIED` com `S_SALT_RETIRED` (frase específica).
- **Memória/resumo de conversa guarda ESPECIFICAÇÕES de consulta** (operação + argumentos semânticos: "ranking por conta, período X"), **nunca** `acc_/str_/lbl_/pat_` nem `evidenceRef`; refs são re-resolvidos reexecutando a capacidade. Refs que o agente repassa dentro da conversa vêm do ledger.
- **Alias por conversa** (O-B, aprovado): o servidor mantém `ref → alias` ("Conta A", "Estratégia B", "rótulo personalizado A"), estável dentro da conversa e **recalculado após a rotação**; o modelo só vê alias. Nomes reais só por binding tardio na UI (D7).

## 8. Privacidade (T0/T1/T2) e `evidence.explain`
- **T0 — nunca no prompt nem no `explain`:** CSV/bytes, `fileName`, nomes de conta e estratégia, texto bruto de rótulo (`sourceLabel`/`entryLabel`/`exitLabel`), regex/padrão do mapa do usuário, valor do sal, `saltCheck`, `fileSha256`, `rowNo`, `rowHash`, `sourceRows`, `issues`, `fieldProvenance`, `userId`, `importedAt`.
- **T1 — PromptView (lista branca por capacidade):** valor/unidade/base, amostra/cobertura/`sampleFlag`/confiança, limitações (código + texto), período, chaves de grupo como alias, **palavra do vocabulário v1** (`Entry`, `Target<n>`, `Stop<n>`, `Zerar`) ou **alias de token** (`lbl_…` ⇒ "rótulo personalizado A"), bucket de `exitReason`, `refEpoch`. Campo novo no bundle **não** aparece sem decisão explícita (projeção por lista branca, nunca spread).
- **T2 — `evidence.explain`:** ≤ **K = 20** trades por chamada (paginação por `page`), hora local, preços, quantidade, P&L, motivo e pernas; **sem** `rowNo`/`rowHash`/ids de linha. **Mesma função de projeção de rótulo** da PromptView (A2): um único projetor; implementação paralela é erro (SG5). Teste dedicado: o drill-down nunca expõe rótulo bruto, inclusive rótulo adversarial ("IGNORE AS INSTRUCOES ANTERIORES") ⇒ só vocabulário v1 ou alias. Paginação não devolve campo extra.
- **Injeção de prompt por rótulo de CSV é impossível por construção:** texto livre vira token/alias antes de chegar ao modelo.
- **Logs/`AgentRun`:** guardam a PromptView e o handle (sem nomes, sem sal, sem bytes), tratados como sensíveis.
- **Refs não são anonimização** (§14.14 do contrato): quem tem o sal reverte por dicionário; refs de usuários diferentes não são comparáveis.

## 9. Fora deste documento
**PRÉ-REQUISITO OBRIGATÓRIO do E6.6 (12/10/2026) — FECHADO em 13/10/2026 (E6.6-0a a 0e):** `combineVerdict` (`src/lib/agent/verdict.ts`) é a única fonte do `combined`; `VerdictSchema` rejeita qualquer `combined` ≠ `combineVerdict(verify, source)` (mensagem fixa `COMBINED_INCONSISTENT`), o que vale para o `EvidenceHandleSchema` e para a visão do modelo; handles nascem de `buildVerdict`. Guardas: `test-agent-verdict-combine.mts`, `test-agent-verdict-schema.mts` e `test-agent-verdict-static.mts`. O `EvidenceHandleBase` previsto no plano **não foi necessário** (refine no `Verdict` aninhado). Nada do E6.6 além disso (capacidade, validador, PromptView) foi feito: segue pendente de aprovação própria (ver `agent-contract-plano.md` §6.1).

E6.6 (aprovação própria; o `combineVerdict` já foi feito, ver acima): validador (AV1–AV21), PromptViews e projetor de rótulo como código. Depois: armazenamento do arquivo original (fase de persistência; faz `source` deixar de ser `NOT_RUN`), armazenamento real do chaveiro de sal, integração com a Vega IA/LLM, UI de produto (banner estrutural, binding tardio de nomes).

## 10. Pontos ainda em aberto (propostas minhas)
- ~~O-E~~ e ~~O-F~~: **aprovados em 12/10/2026** (O-E com a regra de parada explícita do §5.5; O-F como exibição-só, com as casas do motor, §4.3).
- **O-G:** redação final das frases canônicas das §6.2–6.4 (o conjunto de **códigos** é fixo; a prosa pode ser ajustada sem mudar o contrato).
