# E7-15b — Cota mensal do chat (+ trava de 1 turno ativo): decisões e expectativa (21/10/2026)

Só documento. Nenhum código de produção, nenhuma migração aplicada, nenhuma chamada de rede.

## 1. Fatos medidos (21/10/2026)
- **Plano** vem do BANCO a cada pedido (`prisma.user.findUnique({ select: { plan } })` em `src/app/api/ai-partner/_ctx.ts`); enum `Plan { FREE, TRADER, PRO }`.
- **Não existe onde guardar a cota**: o `ConversationStore` não lista conversas e as mensagens vivem dentro dos deltas; `purgeUserData`/`deleteConversation` (E7-7) apagam conversas ⇒ contar por mensagens deixaria o usuário zerar a cota apagando a conversa.
- **Padrão a seguir** (E7-13): tabelas `ai_*` sem FK para `User`, datas e JSON em TEXTO, porta `PrismaPort` injetada (nada importa `@prisma/client`), `updateMany`+`countOf` como compare-and-set (já validado ao vivo com 10 commits concorrentes). `PrismaModelPort.updateMany` aceita `data` com objetos (serve a `{ increment: 1 }`).
- **Cota de arquivos (E7-12)** é "macia" (sem transação); esta NÃO pode ser: custo variável em dólar.
- **Rate limit** (`hit`, Upstash) é fail-open: serve ao limite por minuto, nunca à cota.
- **Rota**: só a de teste de cron tem `maxDuration` (60 s). A rota do chat (E7-15c) precisará declarar `maxDuration`; a trava de turno ativo usa prazo (lease) maior que isso.
- **Branch Neon de teste** `e7-ai-partner-test` está VIVA hoje (`select 1` ok) mas expira em 21/10; para o Portão C uso a atual enquanto viver ou peço uma nova ao Marcelo.
- Preços: Trader R$19,90 e Pro R$97 (`plans.ts`); custo por mensagem ainda NÃO medido (E7-15d).

## 2. Decisões
- **D-C1 Limites por MÊS (provisórios até medir o custo):** `PLAN_CHAT_QUOTAS = { FREE: 15, TRADER: 100, PRO: 300 }` em `plans.ts`, fora de `PlanLimits`, congelado. Conta TURNOS (uma pergunta = 1), não chamadas ao modelo.
- **D-C2 Mês = mês civil em UTC** (`YYYY-MM`); renova no 1º dia UTC (≈ 21h BRT do último dia). Ponto de decisão do Marcelo: alternativa seria ciclo de cobrança por usuário (mais complexo, não recomendo agora).
- **D-C3 Tabela própria `ai_chat_usage`** (`AiChatUsage`): `userId`, `month`, `used Int`, `leaseId String?`, `leaseUntil String?` (ISO UTC, 24 car.), `updatedAt String`; PK (`userId`,`month`). Sem FK, sem conteúdo de conversa: só contadores.
- **D-C4 Reserva atômica no INÍCIO, fail-closed:** UMA instrução `updateMany where { userId, month, used < limite, OR [ leaseUntil null, leaseUntil < agora ] } data { used +1, leaseId, leaseUntil }`. 1 linha ⇒ reservou. 0 linhas ⇒ lê a linha: `used ≥ limite` ⇒ `QUOTA_EXCEEDED` (tem prioridade); senão ⇒ `TURN_IN_PROGRESS`. Linha inexistente ⇒ `create` com `used = 1` (violação de unicidade P2002 ⇒ repete o `updateMany` UMA vez). Erro de banco ⇒ `STORAGE_ERROR` e o modelo NÃO é chamado.
- **D-C5 Trava = a própria reserva** (lease de 90 s, `CHAT_LEASE_MS`): um único turno ativo por usuário; lease vencido (processo morreu) permite novo turno, e o consumo do turno morto FICA contado (fail-closed).
- **D-C6 Liquidação (`settle`) só pelo dono do lease** (`where userId, month, leaseId`): `CONSUME` libera o lease e mantém o uso; `REFUND` libera e devolve 1 (`used > 0`). Idempotente (0 linhas ⇒ `applied:false`). Dono antigo depois de takeover não afeta nada.
- **D-C7 Quem consome e quem devolve** (`withChatQuota`): DEVOLVE em `INVALID_ARGS`, `SALT_REQUIRED`, `NOT_FOUND`, `MODEL_ERROR`, `STORAGE_ERROR` e se `fn` lançar (nada foi entregue). CONSOME em `ANSWERED`/`STOPPED` e em `TURN_CONFLICT`, `LIMIT_EXCEEDED`, `COMMIT_REJECTED`, `TURN_CLOSED` (o modelo pode ter rodado: devolver aí permitiria uso grátis infinito). Limite declarado: erros de upstream induzidos são devolvidos; o freio é o limite por minuto + 1 turno por vez.
- **D-C8 LGPD:** apagar conversa/dados de IA (`purgeUserData`) NÃO mexe no uso (senão zera a cota). Os contadores só saem na exclusão da CONTA (`deleteChatUsageForUser`). Ponto de decisão do Marcelo (base legal: prevenção de abuso/cobrança; guardam só contadores).
- **D-C9 Plano muda no meio do mês:** limite vem do plano atual a cada reserva; subir libera na hora; descer não apaga uso (acima do limite novo ⇒ barrado).
- **D-C10 Resultado público** sem `userId`, `leaseId` nem texto: `{ ok:false, code:"QUOTA_EXCEEDED", limit, used, suggestedPlan }`, `{ ok:false, code:"TURN_IN_PROGRESS" }`, `{ ok:false, code:"INVALID_ARGS"|"STORAGE_ERROR" }`; `getChatUsage ⇒ { used, limit, remaining, resetsAt }`.
- **D-C11 Portões (como o E7-13):** B (schema + migração SQL em arquivo + adaptador + testes offline com cliente de mentira) ⇒ C (ao vivo em branch descartável: 10 reservas concorrentes com limite 3 ⇒ exatamente 3) ⇒ D (produção: backup, ensaio em cópia com dados, OK explícito). Migração é só CRIAR TABELA (aditiva); tabelas legadas intocadas.

## 3. Expectativa de testes
`scripts/test-chat-quota.mts` (offline, memória + cliente Prisma de mentira):
- Q1 `PLAN_CHAT_QUOTAS` (15/100/300, inteiros positivos, crescentes, congelado).
- Q2 mês UTC (virada 31/12→01/01, fuso ignorado), `resetsAt`.
- Q3 reserva até o limite; limite+1 ⇒ `QUOTA_EXCEEDED{limit,used}`; sem escrita.
- Q4 lease: 2ª reserva ⇒ `TURN_IN_PROGRESS`; após `settle` ⇒ permitida; após vencer ⇒ takeover e `settle` do dono antigo é no-op.
- Q5 `CONSUME` mantém, `REFUND` devolve 1, 2× só devolve 1, nunca abaixo de 0.
- Q6 mapeamento D-C7 completo (todos os códigos do `ChatTurnCode`); `fn` que lança ⇒ devolve e resultado `STORAGE_ERROR`.
- Q7 `fn` NÃO é chamada com cota esgotada, turno em andamento, plano inválido ou erro de banco; plano inválido sem I/O.
- Q8 50 chamadas paralelas: nunca mais de `limite` reservas, nunca 2 `fn` ao mesmo tempo.
- Q9 meses e usuários independentes; subir/descer de plano (D-C9).
- Q10 `purgeUserData` e `deleteConversation` reais NÃO alteram o uso (o furo da LGPD); `deleteChatUsageForUser` apaga.
- Q11 resultados sem `userId`/`leaseId`/texto; `getChatUsage`.
- Contrato `C1–C8` do `ChatQuotaStore` rodando em memória e no adaptador Prisma de mentira (e ao vivo com `PRISMA_LIVE=1`, 10 concorrentes).
- Adaptador Prisma `P1–P6`: forma exata do `where`/`data` (`used lt`, `OR` do lease, `increment`), `create`+P2002 ⇒ repete 1×, qualquer erro ⇒ `STORAGE_ERROR`, sem `@prisma/client` nem SQL cru.
- Guardas: SG nominais para `chat-quota.ts` (usa `ChatTurnCode`) e atualização das listas de `infra/`.
Mutações previstas (EQ1…): tirar `used < limite`; ignorar o lease; `settle` sem `leaseId`; REFUND sem `used > 0`; fail-open em erro de banco; mês pelo fuso local; `purgeUserData` tocando o uso; consumir em `MODEL_ERROR`; devolver em `LIMIT_EXCEEDED`; usar limite do plano antigo; vazar `userId` no resultado.

## 4. Pendências do Marcelo (decisões)
1. Mês civil UTC (D-C2) — ok?
2. Contadores sobrevivem a "apagar meus dados de IA" e saem só com a conta (D-C8) — ok?
3. Migration em produção (tabela nova, aditiva) só no Portão D, com backup, ensaio e seu OK.

## 5. Emenda (21/10/2026) — plano Free no mínimo do mínimo (decisão do Marcelo)
- **D-C1 revisada:** `PLAN_CHAT_QUOTAS.FREE` passa de 15 para **3** turnos/mês (uma "provinha"); Trader 100 e Pro 300 seguem provisórios.
- **D-C12 Pool global do Free:** `FREE_CHAT_POOL_PER_MONTH = 300` turnos/mês para TODOS os usuários Free somados ⇒ teto fixo de gasto (≈ R$ 15–50/mês por estimativa), qualquer que seja o número de contas Free. Esgotado ⇒ `FREE_POOL_EXHAUSTED` (`upgrade:true, suggestedPlan:"TRADER"`).
- **Mecânica:** o pool é uma linha da MESMA tabela `ai_chat_usage` (userId reservado `pool-free-chat`, mês, `used`, SEM lease): **nenhuma migração nova**. Novas operações do `ChatQuotaStore`: `poolTake({month,limit,now})` (atômica: `updateMany used < limite` com `increment`; linha ausente ⇒ `create`; P2002 ⇒ repete 1×), `poolGive({month,now})` (`used > 0`, `decrement`, idempotente) e `poolUsage({month})`. O userId do pool é RECUSADO nas reservas/uso de usuário e `deleteForUser` não o apaga.
- **Ordem em `withChatQuota` (plano Free):** reserva do usuário primeiro (cota e lease); só então toma 1 do pool; se o pool falha ⇒ devolve a reserva do usuário (REFUND) e responde `FREE_POOL_EXHAUSTED`/`STORAGE_ERROR` SEM rodar a fn. Cota do usuário esgotada NÃO consome o pool. No REFUND o pool também recebe de volta; no CONSUME fica. Trader/Pro nunca tocam no pool.
- **Códigos que devolvem a reserva:** `BUSY` entra na lista (a guarda global da Groq passa a rodar DENTRO do turno, depois da reserva, para que Free sem cota/pool nunca a consuma e nunca bloqueie pagantes).
- Testes: C10–C11 (contrato do pool em memória, Prisma de mentira e ao vivo), Q14, P7; Q1, Q3, Q8, Q9, Q10, Q12 ajustados ao 3.
