# E7-15e — Tela do AI Partner (21/10/2026)

Só documento. Nenhum código, nenhum deploy, nenhuma mudança em produção. O backend (rotas `imports` e `chat`) já existe e não muda.

## 1. Fatos medidos (o que a tela precisa respeitar)
1. **Não existe UI do AI Partner** (nem upload). O chat devolve 409 `NO_IMPORTS` sem arquivo importado, então a tela precisa de **upload + chat**.
2. **Upload:** `POST /api/ai-partner/imports` aceita multipart (arquivo) ou JSON `{text, fileName?, context?}`; teto 4 MiB, UTF-8 estrito; `context` é opcional (fuso padrão é registrado e avisado). `GET` devolve `{usage:{files,bytes,limits,remaining}, imports:[{fileSha256,importId,fileName,fileBytes,createdAt}]}`. `DELETE /imports/[sha]` apaga.
3. **Chat:** `POST /api/ai-partner/chat` `{question≤4000, conversationId?, fileSha256?}` ⇒ 200 `{ok, conversationId, outcome, response:{segments,banner,stopReason}, usage:{used,limit,remaining}}`; erros `{ok:false, code, error}` (códigos: `QUOTA_EXCEEDED` 403 c/ `upgrade`/`suggestedPlan`, `FREE_POOL_EXHAUSTED` 403, `TURN_IN_PROGRESS` 409, `BUSY` 429 c/ `retry-after`, `MODEL_UNAVAILABLE` 503, `NO_IMPORTS` 409, `NOT_FOUND` 404, `TURN_CONFLICT` 409, `CONVERSATION_FULL` 409, `RATE_LIMITED` 429, `STORAGE_ERROR` 500…).
4. **Resposta é um único corpo** (sem streaming, por desenho: só existe depois do validador). Progresso na tela = estado "analisando", não etapas ao vivo.
5. **Segmentos renderizados:** `text`, `value {text, combined, mode}`, `phrase {code,text}`, `server_text`; `banner {combined,label}`; `stopReason`.
6. **Login local está quebrado** (`redirect_uri_mismatch`) e o backend real precisa de Neon/R2/sessão: **a tela não dá para testar de ponta a ponta no localhost**. Precisa de uma prévia com transporte falso (padrão do Evidence Lab: `/dev/*` só com `NODE_ENV=development`).
7. O app é Next 16.3.6 com mudanças de API: **ler `node_modules/next/dist/docs/` antes de escrever a página** (AGENTS.md).

## 2. Decisões (D-U*) — pedem OK
- **D-U1 — duas entradas, mesma tela:**
  - `/dev/ai-partner` (prévia): só em `NODE_ENV=development`, transporte FALSO com cenários (verificado, não verificado, parcial, indicativo, fora de escopo, cota esgotada, pool esgotado, ocupado, sem importação, erro, adulterado, lista longa). É o que eu e você veremos no localhost.
  - `/ai-partner` (real): dentro do `(app)` (login), transporte real (`fetch` às rotas), **escondida**: fora do menu e `notFound()` a menos que a variável de servidor `AI_PARTNER_UI=1`. Em produção a variável não existe ⇒ 404 ⇒ nenhum usuário vê. Liberar = decisão sua, depois do plano Developer da Groq.
- **D-U2 — separação:** lógica pura testável em `src/lib/ai-partner-ui/` (`RenderedAnswer → blocos de exibição`, `código de erro → mensagem/ação`, reducer do chat) e componente de apresentação que recebe um `transport` por propriedade. Nada de fetch dentro do componente de apresentação.
- **D-U3 — escopo v1:** (a) enviar arquivo CSV (seletor + arrastar; só o arquivo, `context` padrão), listar importações (nome, tamanho, data) e apagar uma; (b) conversa: caixa de pergunta (limite 4000 com contador), lista de mensagens, estado "analisando…", resposta com valores destacados; (c) uso "x de y turnos neste mês"; (d) erros por código com ação (upgrade, tentar de novo em N s, importar arquivo). **Fora:** histórico de conversas entre visitas (não há endpoint de listagem; a conversa vive na memória da página), cartões/gráficos (E7-16b), escolha entre vários arquivos (usa o mais recente; `fileSha256` só se houver seletor, adiado), contexto avançado de importação.
- **D-U4 — segurança de renderização:** só nós de texto do React (nunca `dangerouslySetInnerHTML`); nenhum campo da resposta vira HTML, link ou `href`; a pergunta do usuário nunca volta do servidor (a tela mostra a que o usuário digitou). Nenhum segredo, hash de arquivo nem `evidenceRef` aparece na tela (a resposta renderizada não os contém; teste varre).
- **D-U5 — veredito visível:** cada `value` mostra um marcador conforme `combined` (verificado / parcial / não verificado / não confere) com texto, não só cor; o banner da resposta fica acima; frases (`phrase`) como notas pequenas; `server_text` em texto normal. Acessível: rótulo textual, foco visível, `aria-live` na área de respostas.
- **D-U6 — responsivo:** testado a 320, 390 e 768 px (Playwright na prévia); sem rolagem horizontal; textarea cresce até um limite; Enter envia, Shift+Enter quebra linha; botão desabilitado durante o turno (evita `TURN_IN_PROGRESS`).
- **D-U7 — direção visual:** usa os tokens/estilo do app (Tailwind + shadcn já instalados, mesma casca do `(app)`: `Header`, sidebar); invoco o skill `frontend-design` na implementação para evitar cara de template; sem diagnóstico de infra na tela (regra do Marcelo: "UI nível produto").
- **D-U8 — pergunta de exemplo:** 4 sugestões clicáveis quando a conversa está vazia, todas dentro do que o motor responde (resultado e taxa de acerto; melhor conta; saídas por motivo; trades por hora). Sem sugestão de comprar/vender.

## 3. Testes escritos antes do código
**Lógica pura (`test-ai-partner-ui.mts`, node)**
- U1 `RenderedAnswer` ⇒ blocos: cada `value` preserva `text`, rótulo do veredito e modo; `phrase`/`server_text`/`text` nas ordens certas; banner presente/ausente; `stopReason` tratado.
- U2 Mapa de erros: TODO código do backend (`MESSAGES` do chat e do upload) tem mensagem, tipo de ação (`upgrade`, `retry(n)`, `import`, `none`) — guarda de completude: código novo no backend sem mapa derruba o teste.
- U3 Reducer do chat: pergunta → pendente → resposta/erro; bloqueia envio durante pendente; guarda `conversationId`; `CONVERSATION_FULL` oferece nova conversa; `TURN_CONFLICT`/`BUSY` permitem reenviar a MESMA pergunta; pergunta vazia/só espaço/>4000 não envia.
- U4 Segurança: nenhuma saída da lógica contém HTML interpretável (texto com `<script>` passa como texto); varredura sem `ev_`+32 hex, sem 64 hex, sem nome de arquivo.
- U5 Guardas de acesso (puros): `/dev/ai-partner` só com `NODE_ENV=development`; `/ai-partner` só com `AI_PARTNER_UI=1` (qualquer outro valor ⇒ não); decisão testada com `env` injetado.
- U6 Transporte real: monta o pedido certo (método, JSON, `credentials`, sem cabeçalhos extras), interpreta 200/4xx/5xx/corpo não-JSON/rede caída ⇒ erro tipado, sem lançar; respeita `Retry-After`.
- Mutações no runner (`COLLECT=1`).

**Visual (Playwright na prévia, 320/390/768 px)** — para cada cenário de D-U1: captura + checagem objetiva (sem rolagem horizontal, botão desabilitado no pendente, texto do veredito presente). Eu comparo valores objetivos, não só screenshot.

## 4. Custos / riscos / avisos
- Custo: zero (nada de Groq nesta etapa; transporte falso).
- Risco: página real só pode ser testada de ponta a ponta com login — **não será liberada** sem teste logado em produção com a variável ligada só para o seu usuário; isso é um passo futuro separado, com sua autorização.
- `/dev/*` e a variável `AI_PARTNER_UI` não vão para produção.

## 5. Ordem
1. aprovado ⇒ 2. commit local da expectativa e fase vermelha (testes U1–U6 falhando) ⇒ 3. testes completos ⇒ 4. lógica pura ⇒ 5. componente + prévia (skills `frontend-design`, `web-design-guidelines`) ⇒ 6. página real escondida ⇒ 7. verde (mutações, `tsc`, ESLint, `test:domain`) + Playwright 320/390/768 ⇒ relatório e OK ⇒ commit + backup.
