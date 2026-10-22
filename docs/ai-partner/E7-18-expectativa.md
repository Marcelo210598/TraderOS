# E7-18 — Teste logado em produção, só para o Marcelo (22/10/2026)

Só documento. Nenhum código, nenhum deploy, nenhuma escrita em produção até haver OK explícito do Marcelo e backup.

## 1. Fatos medidos (hoje)
1. **A página escondida não protege a API.** `/api/ai-partner/chat` (e `/imports`) só exigem login e plano (`_ctx.ts`): não olham `AI_PARTNER_UI`. Se o chat for ao ar, **qualquer usuário logado** pode fazer `POST` direto, mesmo sem ver a tela. Hoje em produção está só a rota `imports` (E7-14, de 20/10); a rota `chat` e a tela **ainda não foram ao ar**.
2. **Já existem em produção (Vercel, "Production")**: `GROQ_API_KEY`, `SALT_MASTER_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. **Não existe** `AI_PARTNER_UI` (nem qualquer lista de usuários permitidos). (Só nomes e idades lidos; nenhum valor.)
3. A tabela `ai_chat_usage` já está em produção (Portão D, 21/10). As 4 tabelas `ai_*` também (20/10).
4. Groq: conta no nível base (8K tokens/min, 200K/dia, organização inteira); upgrade para Developer indisponível hoje por alta demanda. Para teste de um usuário isso basta (~130 turnos/dia).
5. O guard atual da tela real é `AI_PARTNER_UI === "1"`; a sessão tem `user.email` (usado no Header).

## 2. Decisões (D-L*) — pedem OK
- **D-L1 — acesso por lista de e-mails, nos DOIS lugares.** Nova variável de servidor `AI_PARTNER_ALLOWED_EMAILS` (e-mails separados por vírgula, comparação sem diferença de maiúsculas, espaços ignorados). Função pura `isAiPartnerUserAllowed(env, email)` em `src/lib/ai-partner-ui/guards.ts`: exige `AI_PARTNER_UI === "1"` **e** e-mail na lista; lista ausente/vazia ⇒ ninguém. Aplicada em:
  - **página `/ai-partner`:** quem não passa recebe `notFound()` (igual a hoje);
  - **rota do chat (`aiPartnerChatCtx`):** quem não passa tem `deps: null` ⇒ a rota responde 503 `NOT_CONFIGURED` (mesmo corpo de "feature desligada"; não revela que existe lista).
- **D-L2 — `/imports` fica como está** (já em produção desde 20/10, testada logada, limitada por plano/cota). Registrado como decisão: não é parte deste teste; se quiser a mesma trava lá, é outra mudança.
- **D-L3 — Neon:** snapshot (branch) antes do deploy, **criado por você** (ou com o seu OK explícito para eu criar via CLI): ex. `backup-pre-ai-partner-ui-live`. Nunca tocar em `backup-pre-ai-partner` e `backup-pre-chat-usage`.
- **D-L4 — variáveis na Vercel (Production), feitas por você** com `! …` (o Claude Code bloqueia escrita em produção): `AI_PARTNER_UI=1` e `AI_PARTNER_ALLOWED_EMAILS=<seu e-mail de login no MeuTrade>`. Nada disso vai ao repositório. Só confirmo tamanho/formato, sem imprimir o e-mail se você preferir.
- **D-L5 — deploy:** `vercel deploy --prod` da raiz (regra do projeto), **só depois** de: commit no backup, snapshot do Neon, variáveis criadas, e o seu OK explícito. Conferir o `.vercelignore` (nenhum `.env*` como fonte) antes.
- **D-L6 — rollback:** (a) remover `AI_PARTNER_UI` (ou a lista) na Vercel + novo deploy/redeploy ⇒ tela e chat somem; (b) se precisar, `vercel rollback` para o deploy anterior. Dados de teste: apagar o arquivo pela tela (cascata já testada).

## 3. Testes antes do código
- **L1 `isAiPartnerUserAllowed`:** `UI≠"1"` ⇒ não, mesmo com e-mail na lista; lista ausente/vazia/só vírgulas ⇒ ninguém; e-mail na lista (maiúsculas, espaços, vários) ⇒ sim; e-mail `null`/`undefined`/vazio ⇒ não; e-mail parecido (`a@x.com` vs `ba@x.com`, `a@x.com.br`) ⇒ não (comparação exata, nunca "contém").
- **L2 página:** teste de código-fonte: `(app)/ai-partner/page.tsx` chama `isAiPartnerUserAllowed` com o e-mail da sessão e `notFound()` antes de renderizar a tela.
- **L3 chat:** `aiPartnerChatCtx` devolve `deps: null` quando o e-mail não passa (teste de código-fonte + lógica pura); comportamento da rota com `deps: null` (503 `NOT_CONFIGURED`) já coberto por `test-ai-partner-chat`.
- **L4 guarda estática:** nenhum valor de e-mail no repositório (varredura do diff por `@`-endereços novos; o e-mail só vive na variável da Vercel).
- Mutações: `&&`→`||`; comparação "contém"; ignorar maiúsculas desligado; lista vazia ⇒ todos.

## 4. Roteiro do teste logado (depois do deploy)
1. Abrir `https://meutrade.app/ai-partner` logado: tela carrega com plano e cota. Outro usuário (ou janela anônima) ⇒ 404 na página e 503 `NOT_CONFIGURED` no `POST /api/ai-partner/chat`.
2. Enviar um CSV real pequeno; confirmar na lista.
3. 1 pergunta (resultado e taxa de acerto): conferir "Analisando…", veredito em palavras, cota subindo (ex.: 1 de N).
4. Conferir logs da Vercel (sem erro) e o tempo de resposta.
5. Apagar o arquivo pela tela; confirmar que some da lista.
Custo: ≈ R$ 0,01 por pergunta (Groq nível base, medido em E7-16). Sem cartão.

## 5. Riscos e avisos
- Escrita em produção (deploy + variáveis): só com OK explícito e backup, e executada por você nos passos que o Claude Code bloqueia.
- Deploy leva **também** a rota `chat` (ainda não publicada) e a tela; com D-L1 ela só responde a você.
- Se o e-mail da lista não bater com o e-mail da sessão, você mesmo recebe 404/503 (falha fechada, nunca aberta).
- `hobby` no plano Vercel: checar termos comerciais antes de liberar a usuários (não afeta este teste).

## 6. Ordem
1. aprovado ⇒ 2. commit da expectativa e fase vermelha (L1–L4) ⇒ 3. testes ⇒ 4. código (guards + página + `_ctx`) ⇒ 5. verde (mutações, tsc, ESLint, `test:domain`) ⇒ relatório e OK ⇒ commit + backup ⇒ **parada**: snapshot Neon + variáveis + deploy só com novo OK seu.
