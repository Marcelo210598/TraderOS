# E7-15a — Laço do chat com MODELO FALSO: decisões e expectativa (21/10/2026)

Só documento. Nenhum código de produção. Sem rede, sem Groq, sem custo, sem banco.

## 1. Fatos medidos (21/10/2026)
- Existem e estão testados: `agent/turn.ts` (8 chamadas, 2 regerações), 8 capacidades, `validateAnswer` (18 motivos), `renderAnswer`/`stopResponse`, `infra/turn-session.ts` (`openTurn/call/validate/commit`), conversa com mensagens.
- Falta: prompt do sistema, definição das ferramentas, porta do modelo (`ModelPort`) e o laço. Também NÃO existe armazenamento de cota (ver D-L7).
- Sonda `probe-think.mts` (validateAnswer, ledger vazio): texto simples ⇒ OK; `<think>…</think>` ⇒ `MODEL_ARITHMETIC`; `a < b` ⇒ `MODEL_ARITHMETIC`; "Foram 5 trades." ⇒ `NUMBER_OUTSIDE_SLOT`; "Compre agora com stop curto." ⇒ `OPERATIONAL_ADVICE`; número da pergunta entre aspas (≤24 car.) ⇒ OK.
- Conclusões da sonda: (a) o validador JÁ barra `<think>` e conselho operacional, mas cada rejeição queima uma regeração (custo); por isso o `<think>` deve ser removido antes (E7-15c) e o laço tolera; (b) resposta SÓ de texto, sem claims, é válida ⇒ uma recusa educada é resposta legítima (defesa contra injeção); (c) citar entre aspas número da própria pergunta é regra DESENHADA (não defeito): o usuário só vê de volta o número que ele mesmo escreveu.
- Revisor (Antigravity, 21/10): achados 1–5 aceitos; o de `userNumbers` rebaixado a "por desenho, risco baixo"; `<think>` confirmado, mas por via indireta (MODEL_ARITHMETIC).

## 2. Decisões do E7-15a
- **D-L1 Porta do modelo:** `ModelPort.complete({ messages, tools, toolChoice }) ⇒ { kind: "tool_calls", calls[] } | { kind: "final", content } | { kind: "error", code }`, com `usage.totalTokens` sempre. Modelo falso roteirizado nos testes. O arquivo do laço não importa rede, `fetch` nem `process.env`.
- **D-L2 Laço** (`infra/chat-turn.ts`): `openTurn` ⇒ mensagens [sistema, pergunta literal] ⇒ modelo ⇒ `tool_calls` ⇒ `session.call` ⇒ devolve ao modelo SÓ o envelope (PromptView) ⇒ `final` ⇒ parse do JSON ⇒ `session.validate` ⇒ OK ⇒ `commit`; `REGENERATE` ⇒ devolve SÓ os códigos de rejeição; `STOP` ⇒ commit da resposta canônica.
- **D-L3 Teto de tokens por turno:** `MAX_TOKENS_PER_TURN = 16000` (soma dos `usage.totalTokens`). Estourou ⇒ para SEM nova chamada ao modelo e comita a resposta canônica de orçamento (`BUDGET_CALLS`, sem código novo no contrato). Valor é ponto de partida; o E7-15d mede e ajusta.
- **D-L4 Ferramenta inválida:** 2 `ARGS_INVALID` seguidos ⇒ o laço força a resposta final (sem mais ferramentas).
- **D-L5 Injeção de prompt:** o prompt manda recusar (resposta válida só de texto) pedido de conselho operacional ou de mudar o formato. Teste: modelo falso "obediente" à injeção gera 3 rejeições ⇒ para, resposta canônica, no máximo 3 respostas finais e nenhum texto da injeção chega ao `rendered`.
- **D-L6 Sem streaming:** a resposta só existe depois do validador. O laço expõe passos determinísticos (rótulos de `CAPABILITY_LABELS`) para a tela mostrar "Consultando…"; nada de texto token a token.
- **D-L7 Cota (NÃO é E7-15a; E7-15b):** tabela própria de uso mensal; NÃO derivar das mensagens (apagar conversa pela LGPD zeraria a cota; e o store não lista conversas). Reserva atômica no início (`UPDATE … WHERE used < limite`), fail-closed, 1 turno ativo por usuário (trava com prazo no banco, serverless não aceita trava em memória), devolve a reserva em falha de infraestrutura (5xx/timeout); consome em resposta válida ou canônica. Exige migration em produção: só com backup e OK explícito.
- **D-L8 Groq (E7-15c):** remover `<think>…</think>` antes do parse; `GROQ_MODEL` em variável de ambiente; sem pin ⇒ a rota nem chama o modelo.

## 3. Expectativa de testes (`scripts/test-chat-turn.mts`, offline)
L1 caminho feliz: 1 capacidade + resposta válida ⇒ commit, 1 mensagem user + 1 assistant.
L2 a resposta do modelo é só texto sem claims (recusa) ⇒ aceita.
L3 rejeição ⇒ regera com SÓ códigos; 2ª resposta válida ⇒ commit.
L4 3 rejeições ⇒ `REGEN_EXHAUSTED`, resposta canônica, 3 chamadas finais no máximo.
L5 tokens acima de 16000 ⇒ para sem nova chamada ao modelo; resposta canônica de orçamento.
L6 9ª capacidade ⇒ `BUDGET_EXCEEDED`, não executa.
L7 2 `ARGS_INVALID` seguidos ⇒ força final; não chega à 8ª.
L8 injeção obediente ⇒ L4 + nenhum texto da injeção no `rendered`.
L9 `<think>` no conteúdo final ⇒ rejeitado pelo validador e conta uma regeração.
L10 o modelo NUNCA recebe `evidenceHash`, nome de arquivo, CSV, alias ↔ valor (varredura de todas as mensagens enviadas).
L11 erro do modelo (`kind:"error"`) ⇒ turno termina sem commit de resposta, sem mensagem do assistente; usuário não perde dado.
L12 `commit` com CONFLICT ⇒ propaga, sem retry.
L13 determinismo: mesmo roteiro ⇒ mesmo commit.
L14 passos de progresso só com rótulos do catálogo.
L15 o arquivo do laço não contém `fetch`, `process.env`, `groq`.
L16 pergunta literal e ≤ 4000 vai ao modelo sem alteração.
Mutações previstas (EL1…): remover o teto de tokens; mandar o hash ao modelo; regerar sem limite; aceitar `<think>`; ignorar `ARGS_INVALID`; comitar após erro do modelo; trocar códigos de rejeição por texto da resposta rejeitada.
