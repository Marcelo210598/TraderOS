# E7-20 — Respostas em cartões e tabelas, com explicação (22/10/2026)

Só documento. Nenhum código, nenhum deploy, nenhuma mudança em produção.

## 1. Fatos medidos
1. **Feedback do teste logado (prints do Marcelo):** o texto corrido com um chip "✓ VERIFICADO" em cada valor (até em rótulos como "manual", "pernas") é poluído; "Saídas por motivo" fica ilegível; falta explicação do que cada número significa.
2. **A estrutura já existe nos dados.** Cada valor renderizado (`RenderedSegment` `value`) leva `ref` + `path` (ex.: `groups[1].metrics[2].value`) e o veredito próprio; a `view` de cada evidência no ledger tem grupos, métricas, motivos de saída, chaves. Não precisa mudar o compositor nem o contrato do validador.
3. **A resposta gravada na conversa é estrita** (`parseMessages` recusa campo novo): o layout NÃO pode ir dentro de `rendered`. Ele é derivado a cada resposta e vai só na resposta HTTP.
4. **Protótipo na prévia do Marcelo (22/10):** cartões para resultados soltos, tabela por grupo (no celular, um cartão por linha), duas tabelas em "saídas por motivo", selo uma única vez no topo, só negativo em vermelho. Marcelo: "parece ter ficado ok". A tela (`layout.ts`, `answer-layout.tsx`) e os cenários de prévia já existem; falta o servidor produzir o layout.
5. **Tudo que for texto fixo precisa respeitar o léxico do servidor** (`validateText`: sem dígitos, sem "líquido/bruto/maior/vencedor/empate"…); o protótipo tinha dígitos em frases ("27 linhas viram 15 trades") e "maior ganho": isso sai.

## 2. Decisões (D-Y*) — pedem OK
- **D-Y1 — onde nasce o layout:** função pura nova `buildLayout({ledger, refs}, rendered)` em `src/lib/agent/layout.ts`. Lê a `view` das evidências (estrutura) e busca CADA valor no `rendered` pelo par `(ref, path)`: **todo número e todo veredito do layout vêm do mesmo `RenderedSegment` que o texto corrido usa**. Nenhum número novo nasce aqui.
- **D-Y2 — onde vai:** `ChatTurnResult` ganha `layout` (ou `null`); a rota devolve `response: { …rendered, layout }` **só quando não for null**. Nada novo gravado na conversa. O texto corrido continua sendo gerado e é o fallback da tela.
- **D-Y3 — falha segura:** qualquer anomalia (célula sem valor renderizado, evidência de capacidade desconhecida, exceção) ⇒ `layout = null` ⇒ a tela mostra o texto corrido de hoje. Nunca quebra a resposta; nunca mostra meia tabela.
- **D-Y4 — fidelidade ao texto corrido:** só entram no layout as linhas que o texto corrido também mostra (respeita `COMPOSER_MAX_ROWS` e o corte de segmentos); se houve corte, o layout acrescenta a mesma frase `CUT_TEXT`.
- **D-Y5 — capacidades cobertas (as 6 do chat):**
  - `metrics.query` → cartões (rótulo, valor grande, explicação curta) + linha de período;
  - `metrics.groups` → tabela (linhas = grupos; colunas = métricas; etiqueta `sampleFlag` na linha);
  - `rank.groups` → tabela (posição, grupo, valor, etiqueta de amostra);
  - `exit.breakdown` → duas tabelas (por perna / por trade, agrupando as faixas pela `unit` bruta) + linha de conciliação;
  - `metrics.compare` → tabela (linhas = métricas; colunas "primeiro / segundo / diferença") + linha "Entre X e Y";
  - `exit.analysis` → as tabelas de saída + a de comparação.
  Evidência adulterada/ilegível (frase de integridade, sem números) ⇒ sem layout.
- **D-Y6 — texto fixo (do servidor, nunca do modelo):** títulos, rótulos de coluna e uma tabela `METRIC_HELP` (explicação de 1 linha por métrica; ausente ⇒ sem explicação) + notas fixas ("um trade é uma posição do início ao fim…"). **Todo texto fixo passa em `validateText` e não tem dígito** (teste de varredura, como o das frases).
- **D-Y7 — valor indisponível:** o formatador já gera "indisponível (motivo)"; o layout mostra "—" e o motivo em letra pequena (derivado desse texto, por regra única e testada).
- **D-Y8 — selo:** cada célula leva o `combined` do seu valor (formato do contrato); a tela mostra o selo só quando ≠ VERIFIED, e o banner único no topo (já feito na tela).
- **D-Y9 — contrato da tela:** `layout.ts` passa a aceitar `combined` do servidor (hoje aceita palavras da UI) e ganha o bloco `line` (texto + células inline: período, chaves, conciliação) no lugar de `subtitle`.
- **D-Y10 — sem mudança nos limites:** mesmo modelo, mesma chamada, mesmo custo em tokens (o layout é montado no servidor depois da resposta).

## 3. Testes escritos antes do código
- **Y1 por capacidade (6):** evidência de teste real (dataset sintético em memória) → `buildLayout` → estrutura esperada (blocos/colunas/linhas na ordem), com cada texto de célula **igual** ao `text` do `RenderedSegment` de mesmo `(ref, path)`.
- **Y2 fidelidade:** com 40 grupos (corte), linhas do layout = linhas do texto corrido + `CUT_TEXT`; nenhuma linha com célula faltando.
- **Y3 falha segura:** `rendered` sem um valor, capacidade desconhecida, ledger inválido, entradas congeladas/malformadas ⇒ `null`, sem lançar.
- **Y4 integridade:** evidência TAMPERED/NOT_VERIFIED inválida ⇒ `null`; `VERIFIED_PARTIAL`/`NOT_VERIFIED` válido ⇒ células com o `combined` certo.
- **Y5 texto fixo:** varredura: todo texto fixo passa em `validateText`, sem dígito, sem vocabulário proibido; todo `metricId` com ajuda existe no catálogo; guarda de completude como a de `METRIC_TEXT`.
- **Y6 indisponível:** "indisponível (…)" ⇒ célula "—" + motivo; texto normal intacto.
- **Y7 laço/rota:** `runChatTurn` devolve `layout` em turno respondido; `null` em recusa/fora de escopo/interrompido; a conversa gravada NÃO contém `layout` (mensagens idênticas às de hoje); a rota inclui `layout` só quando existe; `compose`/memória inalterados.
- **Y8 tela:** `toLayout` aceita o formato do servidor (`combined`, `line`) e recusa malformado ⇒ `null`; limites (≤30 blocos, ≤60 linhas, ≤12 colunas); congelado; sem HTML.
- **Mutações:** trocar `(ref,path)` entre células; usar valor do texto fixo em vez do renderizado; deixar passar célula faltante; incluir `layout` em `rendered`; esquecer o corte; deixar vazar dígito no texto fixo.
- **Ao vivo (1 execução, aborto em 429):** as mesmas perguntas do teste logado (resultado e taxa; por conta; saídas por motivo) — conferir que o layout sai e bate com o texto corrido. ~6K tokens.

## 4. Riscos e limitações honestas
- Duas representações (texto corrido + layout): custo de manter coerência; os testes Y1/Y2 travam isso célula a célula.
- A explicação de cada métrica é texto NOSSO: precisa de revisão do Marcelo (conteúdo financeiro). Entrego a primeira versão, ele ajusta.
- Gráficos continuam fora (E7-16b futuro).
- Não muda: memória (E7-19), limites, produção. **Deploy só com novo OK.**

## 5. Ordem
1. aprovado ⇒ 2. commit da expectativa + fase vermelha (Y1–Y8 falhando) ⇒ 3. testes ⇒ 4. `layout.ts` (servidor) + `chat-turn` + rota + ajuste do contrato da tela ⇒ 5. verde (mutações, `tsc`, ESLint, `test:domain`) ⇒ 6. medição ao vivo ⇒ relatório e OK ⇒ commit + backup ⇒ deploy por você.
