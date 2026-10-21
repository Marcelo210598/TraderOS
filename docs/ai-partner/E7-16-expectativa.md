# E7-16 — Resposta montada pelo servidor: o modelo só escolhe a ferramenta (21/10/2026)

Só documento. Nenhum código de produção, nenhum deploy, nenhum dado de produção. Substitui o desenho "o modelo escreve o JSON da resposta" do E7-15a.

## 1. Por que (fatos medidos no E7-15d, dataset sintético, `qwen/qwen3.8-27b`, base tier)
1. **Escolher ferramenta: o modelo acerta.** Em 6 turnos reais escolheu a capacidade certa em todos (e recusou o pedido operacional).
2. **Escrever a resposta: o modelo falha por formato.** No diagnóstico de 1 turno, os slots/refs/paths estavam certos, mas o JSON veio com erro de sintaxe (`{"kind":"text","text" e sua taxa…`) nas 2 respostas finais ⇒ `STRUCTURE_INVALID`. Nos 6 turnos: `NUMBER_OUTSIDE_SLOT`, `SLOT_PATH_INVALID`, `SCOPE_OVERCLAIM`, `INCONCLUSIVE_AS_CONCLUSIVE`.
3. **O laço convida a repetir ferramenta.** Com o resultado já na conversa o modelo chamou `metrics_query` de novo (chamada 2); depois de "resposta rejeitada" chamou a ferramenta em vez de corrigir o JSON (chamadas 4 e 6). 6 chamadas, 17.178 tokens, turno terminou em STOPPED.
4. **Limites da conta (base tier):** 8K tokens/min e 200K/dia, da organização inteira; sem cache de prompt. Um turno de 6 chamadas não cabe.

## 2. Desenho
```
pergunta ──► MODELO (1 chamada, só tool_calls) ──► servidor executa as capacidades ──► COMPOSITOR (servidor) ──► validateAnswer ──► renderAnswer ──► resposta
```
- **O modelo não escreve nada que o usuário veja.** O `content` do modelo é descartado. Só `tool_calls` são usados. Nenhum texto, número ou JSON do modelo chega à tela.
- **Compositor** (novo, puro, determinístico, sem rede/relógio): recebe as entradas do ledger geradas neste turno e devolve um `AgentAnswer` (segments + claims) feito só de: (a) rótulos fixos escritos pelo servidor, (b) `slot` para TODO valor, (c) `phrase` canônicas (população declarada, "resultado indicativo", etc.).
- **O pipeline auditado continua** e vira auto-checagem: a saída do compositor passa por `session.validate` (= `validateAnswer`) e `renderAnswer` sem alteração. Banner de veredito, frases de verificação parcial/estrutural, `LABELED` para valor não verificado, `INCONCLUSIVE`… tudo continua vindo do que já foi testado (1454 ✓).
- **Se o compositor ou o validador falhar** (bug nosso, não do modelo): resposta canônica de parada, **sem regerar**, turno devolve a cota (código novo `COMPOSE_FAILED` na lista de REFUND).

## 3. Decisões (D-S*)
- **D-S1 — 1 chamada por turno; reparo só de argumentos.** Se TODAS as chamadas de ferramenta falharem com `ARGS_INVALID`, 1 (uma) segunda chamada ao modelo com o código do erro, e só. `MAX_MODEL_CALLS_PER_TURN` 12 → 2. `MAX_TOKENS_PER_TURN` 16000 → 6000.
- **D-S2 — modelo sem ferramenta (só texto).** Resposta fixa do servidor: "Só analiso os dados de trades que você importou. Reformule a pergunta sobre eles." (cobre pedido operacional, injeção, assunto fora do escopo). **Consome cota** (houve custo de modelo); o texto do modelo é descartado.
- **D-S3 — várias ferramentas na mesma resposta:** executa até **3**, em ordem; excedentes ignorados. Cada evidência vira um bloco separado na resposta.
- **D-S4 — ferramentas do chat: 6.** `evidence_explain` e `evidence_refresh` saem do chat (precisam de um `evidenceRef` que o modelo, sem histórico entre turnos, não conhece). Menos tokens por chamada.
- **D-S5 — prompt do sistema encolhe:** sai a seção "FORMATO DA RESPOSTA FINAL" e a lista de códigos de frase; ficam recusas, regra de não dar conselho, lista de `metricIds`/`groupBy`/filtros. Teste de tamanho (limite fixado na fase vermelha).
- **D-S6 — rótulos de métrica:** tabela própria do servidor (`METRIC_TEXT`: só letras, sem `&`/dígitos, ex. `netPnl` → "Resultado líquido"), com guarda de build: métrica nova no `METRIC_CATALOG` sem rótulo derruba o teste (mesmo padrão dos catálogos de frases).
- **D-S7 — corte de linhas:** o validador limita 200 segmentos; o compositor mostra no máximo as primeiras N linhas de `metrics.groups`/`rank.groups` (N fixado para caber) e acrescenta uma frase fixa sem número ("Mostrando só os primeiros grupos; refine o filtro para ver o resto."). Nunca corta em silêncio.
- **D-S8 — sem "empate":** o compositor não escreve a palavra empate (não há folha de slot para `tiedWithPrevious`); posição vem do slot `rank`.
- **D-S9 — remoção do laço antigo:** o ciclo "modelo escreve → valida → regera" sai de `chat-turn.ts` (YAGNI; fica no histórico do git e no backup). `validateAnswer`/`renderAnswer`/`stopResponse` permanecem.
- **D-S10 — tela:** esta etapa devolve `RenderedAnswer` (o mesmo formato que a tela do E7-15e já esperava). Cartões/tabelas ricos a partir da view estruturada = etapa posterior (E7-16b), decisão sua.

## 4. O que o compositor escreve, por capacidade
| Capacidade | Conteúdo |
|---|---|
| `metrics.query` | uma linha por métrica: rótulo + slot `value`; período (slots `from`/`to`) se houver; frase de população |
| `metrics.groups` | uma linha por grupo: slots `key[]` + rótulo + slot `value`; slot `sampleFlag`; corte D-S7 |
| `exit.breakdown` | uma linha por motivo: slot `reason`, `count`, `unit`, `pnlNet`, `share`; slot `reconciliation` |
| `metrics.compare` | por métrica: rótulo, slots `a`, `b`, `delta`; se `conclusive=false` ⇒ frase "Resultado indicativo, não conclusivo." |
| `rank.groups` | uma linha por posição: slot `rank` (ou "sem posição"), `key[]`, `value`, `sampleFlag` |
| `exit.analysis` | como `exit.breakdown` + bloco de comparação se existir |
Valor `null` continua saindo pelo motivo do formatador (`reasonField`), nunca como número inventado.

## 5. Expectativas escritas (testes antes do código)
**Compositor (novo `test-answer-composer.mts`)**
- C1 Para cada uma das 6 capacidades × (verificado, NOT_RUN/estrutural, valor `null`, amostra LOW/TINY, cobertura parcial, `TAMPERED_OR_MISMATCH`): a saída passa em `validateAnswer` E `renderAnswer`, sem nenhum dígito fora de `slot`.
- C2 Todo `slot` aponta para folha existente na `LEAF_TABLE` e tem `claim` com o modo certo (`ASSERT` verificado, `LABELED` não verificado).
- C3 Determinismo: mesma entrada ⇒ mesma saída (deep-equal); entrada congelada, saída congelada; nunca lança.
- C4 Guarda de completude: todo `metricId` do `METRIC_CATALOG` tem `METRIC_TEXT`; todo texto do compositor passa em `validateText`.
- C5 Corte D-S7: com 40 grupos, ≤ 200 segmentos e frase de corte presente; com poucos grupos, sem a frase.
- C6 Texto do modelo jamais entra (propriedade: compositor não recebe `content`).

**Laço (reescrita de `test-chat-turn.mts`)**
- L1 Caminho feliz: modelo falso devolve 1 `tool_calls` ⇒ **exatamente 1 chamada ao modelo**, `ANSWERED`, commit.
- L2 Só texto ⇒ resposta fixa D-S2; 1 chamada; consome cota; texto do modelo (com dígitos/injeção) ausente da resposta.
- L3 `ARGS_INVALID` em todas ⇒ 2ª chamada com o código; sucesso ⇒ `ANSWERED` (2 chamadas); falha de novo ⇒ `STOPPED` sem 3ª chamada.
- L4 4+ `tool_calls` ⇒ executa 3, ignora o resto.
- L5 `MODEL_ERROR` ⇒ sem commit, cota devolvida (como hoje).
- L6 Orçamento de tokens 6000 respeitado (uso ausente = teto, como hoje).
- L7 Falha do compositor/validador ⇒ `COMPOSE_FAILED`, sem commit, cota devolvida.
- L8 Resposta gravada na conversa tem só o que o servidor escreveu (nunca texto do modelo).

**Cliente/rota (ajustes)** — ferramentas = 6; teste do corpo da Groq atualizado; REFUND ganha `COMPOSE_FAILED`; prompt: sem seção de formato, abaixo do limite de tamanho.

**Mutações** (runner `COLLECT=1`): trocar `ASSERT`↔`LABELED`; pular o corte D-S7; deixar `content` do modelo vazar; aceitar 4ª ferramenta; permitir 3ª chamada ao modelo; não devolver cota em `COMPOSE_FAILED`. Todas devem ser pegas (equivalentes documentadas).

## 6. Medição esperada (a CONFIRMAR ao vivo, não é fato ainda)
- Entrada por chamada: hoje 2.168 tokens (prompt 4.283 chars + 8 ferramentas). Com D-S4/D-S5 espera-se **menos** (meta ≤ 1.600; a medir).
- Saída: ~40 tokens (só `tool_calls`).
- Turno típico: **1 chamada ≈ 1.6–2.2K tokens** (hoje: 11–17K em 4–6 chamadas). Com 200K/dia ⇒ **≥ 90 turnos/dia**; com 8K/min ⇒ ~3–4 turnos/min na organização.
- Custo (estimado, US$0,80/M entrada, US$4/M saída, R$5,50): ≈ R$ 0,01 por turno. Mede-se no E7-16 ao vivo: 6 perguntas, ~12K tokens, 1 execução, com aborto em 429.

## 7. Limitações assumidas (e honestas)
- Sem memória entre turnos: pergunta de acompanhamento ("e na semana passada?") exige que o usuário repita o contexto. Igual ao E7-15a.
- A resposta é objetiva e padronizada (rótulo + valor + ressalvas do motor); não há "análise" em prosa. Interpretação em prosa, se um dia houver, seria outra etapa com outro risco.
- Se o modelo escolher ferramenta errada, o usuário vê o dado que veio (verdadeiro, mas não o pedido). Medir no ao vivo.

## 8. Fora do escopo
Tela (E7-15e), cartões ricos (E7-16b), plano Developer da Groq, produção/deploy, `origin`.

## 9. Ordem
1. (este documento) aprovado ⇒ 2. commit local da expectativa + fase vermelha (testes C1–C6/L1–L8 falhando) ⇒ 3. testes completos antes do código ⇒ 4. compositor ⇒ 5. laço novo + prompt/ferramentas ⇒ 6. verde (mutações, `tsc` 0, ESLint, `test:domain`) ⇒ 7. medição ao vivo (6 perguntas) ⇒ relatório e OK ⇒ commit + backup.
